use crate::{
    database::{QueryResult, ResultSet},
    result_cache::{ResultCache, FIRST_PAGE},
};
use serde::Serialize;
use std::{future::Future, time::Duration};
use tokio::sync::{mpsc, oneshot};

pub enum Event {
    Start(Vec<String>),
    Row(Vec<Option<String>>),
    End(Option<u64>),
    Finished(Result<(), String>),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub rows: Vec<Vec<Option<String>>>,
    pub total_rows: usize,
    pub has_more: bool,
    pub result: QueryResult,
}

struct Request {
    set: usize,
    offset: usize,
    size: usize,
    reply: oneshot::Sender<Result<Page, String>>,
}

pub struct Session {
    requests: mpsc::Sender<Request>,
    task: tokio::task::AbortHandle,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Session {
    pub fn cancel(&self) {
        self.task.abort();
    }
    pub async fn first_page(&self, size: usize) -> Result<Page, String> {
        let mut index = 0;
        loop {
            let page = self.page(index, 0, size).await?;
            if page.result.complete
                || page
                    .result
                    .sets
                    .get(index)
                    .is_some_and(|set| !set.columns.is_empty())
            {
                return Ok(page);
            }
            index += 1;
        }
    }
    pub async fn page(&self, set: usize, offset: usize, size: usize) -> Result<Page, String> {
        if size > 10000 || offset > 1_000_000 {
            return Err("Invalid page range.".into());
        }
        let (tx, rx) = oneshot::channel();
        self.requests
            .send(Request {
                set,
                offset,
                size,
                reply: tx,
            })
            .await
            .map_err(|_| "Result session is closed. Run the query again to load more rows.")?;
        rx.await
            .map_err(|_| "Result fetching was cancelled. The connection was closed.".to_string())?
    }
}

struct Producer(tokio::task::JoinHandle<()>);
impl Drop for Producer {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub fn start<F, Fut>(produce: F) -> Result<Session, String>
where
    F: FnOnce(mpsc::Sender<Event>) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let cache = ResultCache::new()?;
    // A single-event buffer applies backpressure to both database drivers.
    let (events_tx, events) = mpsc::channel(1);
    let producer = Producer(tokio::spawn(produce(events_tx)));
    let (requests_tx, mut requests) = mpsc::channel::<Request>(8);
    let task = tokio::spawn(async move {
        let mut state = State {
            cache,
            sets: vec![],
            ended: vec![],
            active: None,
            complete: false,
            truncated: false,
            failure: None,
            events,
            producer,
        };
        loop {
            let request = if state.complete || state.failure.is_some() {
                requests.recv().await
            } else {
                match tokio::time::timeout(Duration::from_secs(600), requests.recv()).await {
                    Ok(request) => request,
                    Err(_) => {
                        state.fail("Result session expired after 10 minutes idle. Run the query again to fetch more rows.".into());
                        continue;
                    }
                }
            };
            let Some(request) = request else { break };
            let response =
                match tokio::time::timeout(Duration::from_secs(120), state.fetch(&request)).await {
                    Ok(response) => response,
                    Err(_) => {
                        state.fail(
                            "Fetching timed out after 120 seconds. The connection was closed."
                                .into(),
                        );
                        Err(state.failure.clone().unwrap())
                    }
                };
            let _ = request.reply.send(response);
        }
    });
    Ok(Session {
        requests: requests_tx,
        task: task.abort_handle(),
    })
}

struct State {
    cache: ResultCache,
    sets: Vec<ResultSet>,
    ended: Vec<bool>,
    active: Option<usize>,
    complete: bool,
    truncated: bool,
    failure: Option<String>,
    events: mpsc::Receiver<Event>,
    producer: Producer,
}

impl State {
    fn fail(&mut self, error: String) {
        self.failure = Some(error);
        self.producer.0.abort();
    }
    fn finish_set(&mut self, affected: Option<u64>) {
        if let Some(index) = self.active.take() {
            self.sets[index].affected = affected;
            self.ended[index] = true;
        }
    }
    fn ready(&self, request: &Request) -> bool {
        self.complete
            || self.ended.get(request.set) == Some(&true)
            || (request.size != 0
                && self.cache.count(request.set) > request.offset.saturating_add(request.size))
    }

    async fn fetch(&mut self, request: &Request) -> Result<Page, String> {
        while !self.ready(request) {
            if let Some(error) = &self.failure {
                // Earlier cached pages remain usable after a later fetch failure.
                if request.size > 0
                    && self.cache.count(request.set) >= request.offset.saturating_add(request.size)
                {
                    break;
                }
                return Err(error.clone());
            }
            let Some(event) = self.events.recv().await else {
                let error = "Database stream closed unexpectedly.".to_string();
                self.fail(error.clone());
                return Err(error);
            };
            match event {
                Event::Start(columns) => {
                    self.finish_set(None);
                    self.active = Some(self.sets.len());
                    self.sets.push(ResultSet {
                        columns,
                        ..Default::default()
                    });
                    self.ended.push(false);
                }
                Event::Row(row) => {
                    let index = self
                        .active
                        .ok_or("Received a row without column metadata.")?;
                    let appended = match self.cache.append(index, &row) {
                        Ok(appended) => appended,
                        Err(error) => {
                            self.fail(error.clone());
                            return Err(error);
                        }
                    };
                    if !appended {
                        self.truncated = true;
                        self.complete = true;
                        self.finish_set(None);
                        self.producer.0.abort();
                    }
                }
                Event::End(affected) => {
                    if self.active.is_none() {
                        self.active = Some(self.sets.len());
                        self.sets.push(ResultSet::default());
                        self.ended.push(false);
                    }
                    self.finish_set(affected);
                }
                Event::Finished(outcome) => match outcome {
                    Ok(()) => {
                        self.finish_set(None);
                        self.complete = true;
                    }
                    Err(error) => {
                        self.fail(error.clone());
                        return Err(error);
                    }
                },
            }
        }
        let page = self.cache.page(request.set, request.offset, request.size)?;
        let mut sets = self.sets.clone();
        for (index, set) in sets.iter_mut().enumerate() {
            set.rows = self.cache.page(index, 0, FIRST_PAGE)?.rows;
            set.page_size = Some(FIRST_PAGE);
            set.total_rows = Some(self.cache.count(index));
            set.has_more = !self.complete && !self.ended[index];
        }
        if request.offset == 0 && request.size != 0 {
            if let Some(set) = sets.get_mut(request.set) {
                set.rows = page.rows.clone();
                set.page_size = Some(request.size);
            }
        }
        let has_more = sets.get(request.set).is_some_and(|set| set.has_more);
        Ok(Page {
            rows: page.rows,
            total_rows: page.total_rows,
            has_more,
            result: QueryResult {
                sets,
                truncated: self.truncated,
                complete: self.complete,
                page_size: Some(request.size),
                ..Default::default()
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    fn rows(count: usize, converted: Arc<AtomicUsize>) -> Session {
        start(move |events| async move {
            if events.send(Event::Start(vec!["id".into()])).await.is_err() {
                return;
            }
            for index in 0..count {
                converted.fetch_add(1, Ordering::SeqCst);
                if events
                    .send(Event::Row(vec![Some(index.to_string())]))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            let _ = events.send(Event::Finished(Ok(()))).await;
        })
        .unwrap()
    }

    #[tokio::test]
    async fn first_page_stops_consumption_and_next_resumes_without_rerunning() {
        let converted = Arc::new(AtomicUsize::new(0));
        let session = rows(16954, converted.clone());
        let first = session.page(0, 0, 500).await.unwrap();
        assert_eq!(first.rows.len(), 500);
        assert_eq!(first.total_rows, 501);
        assert!(first.has_more);
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
        let read = converted.load(Ordering::SeqCst);
        assert!(read <= 503, "producer drained {read} rows while idle");
        assert_eq!(
            session.page(0, 0, 10).await.unwrap().rows[0][0],
            Some("0".into())
        );
        assert_eq!(converted.load(Ordering::SeqCst), read);
        let next = session.page(0, 500, 500).await.unwrap();
        assert_eq!(next.rows[0][0], Some("500".into()));
        assert_eq!(next.total_rows, 1001);
        assert!(converted.load(Ordering::SeqCst) <= 1003);
        session.cancel();
        assert!(session.page(0, 1000, 500).await.is_err());
    }

    #[tokio::test]
    async fn exact_and_partial_last_pages_have_known_totals() {
        for count in [0usize, 10, 500, 501, 1251] {
            let session = rows(count, Arc::new(AtomicUsize::new(0)));
            let offset = count.saturating_sub(1) / 500 * 500;
            let page = session.page(0, offset, 500).await.unwrap();
            assert_eq!(page.total_rows, count);
            assert!(!page.has_more);
            assert!(page.result.complete);
            assert_eq!(page.rows.len(), count - offset);
        }
    }

    #[tokio::test]
    async fn different_result_sets_are_discovered_on_demand() {
        let session = start(|events| async move {
            for name in ["first", "second"] {
                events.send(Event::Start(vec![name.into()])).await.unwrap();
                for i in 0..3 {
                    events
                        .send(Event::Row(vec![Some(format!("{name}-{i}"))]))
                        .await
                        .unwrap();
                }
                events.send(Event::End(Some(3))).await.unwrap();
            }
            let _ = events.send(Event::Finished(Ok(()))).await;
        })
        .unwrap();
        let first = session.page(0, 0, 2).await.unwrap();
        assert_eq!(first.result.sets.len(), 1);
        let second = session.page(1, 0, 2).await.unwrap();
        assert_eq!(second.rows[0][0], Some("second-0".into()));
        assert_eq!(second.result.sets.len(), 2);
        assert_eq!(
            session.page(0, 0, 2).await.unwrap().rows[0][0],
            Some("first-0".into())
        );
        assert!(session.page(2, 0, 2).await.unwrap().result.complete);
    }

    #[tokio::test]
    async fn first_page_skips_commands_without_draining_the_following_select() {
        let converted = Arc::new(AtomicUsize::new(0));
        let counter = converted.clone();
        let session = start(move |events| async move {
            if events.send(Event::End(Some(0))).await.is_err() {
                return;
            }
            if events.send(Event::Start(vec!["id".into()])).await.is_err() {
                return;
            }
            for i in 0..16954 {
                counter.fetch_add(1, Ordering::SeqCst);
                if events
                    .send(Event::Row(vec![Some(i.to_string())]))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            let _ = events.send(Event::Finished(Ok(()))).await;
        })
        .unwrap();
        let page = session.first_page(10).await.unwrap();
        assert_eq!(page.rows.len(), 10);
        assert_eq!(page.result.sets.len(), 2);
        assert_eq!(page.result.sets[0].affected, Some(0));
        assert_eq!(page.result.sets[1].page_size, Some(10));
        assert!(converted.load(Ordering::SeqCst) <= 13);
    }

    #[tokio::test]
    async fn all_reads_beyond_10000_and_a_later_error_preserves_cached_pages() {
        let session = rows(16954, Arc::new(AtomicUsize::new(0)));
        let all = session.page(0, 0, 0).await.unwrap();
        assert_eq!(all.rows.len(), 16954);
        assert!(!all.has_more);
        assert_eq!(all.result.sets[0].rows.len(), 500);
        assert_eq!(session.page(0, 0, 500).await.unwrap().rows.len(), 500);
        let session = start(|events| async move {
            events.send(Event::Start(vec!["id".into()])).await.unwrap();
            for i in 0..4 {
                events
                    .send(Event::Row(vec![Some(i.to_string())]))
                    .await
                    .unwrap();
            }
            let _ = events
                .send(Event::Finished(Err("Connection lost".into())))
                .await;
        })
        .unwrap();
        assert_eq!(session.page(0, 0, 2).await.unwrap().rows.len(), 2);
        assert!(session.page(0, 2, 2).await.is_err());
        assert_eq!(session.page(0, 0, 2).await.unwrap().rows.len(), 2);
    }

    #[tokio::test]
    async fn cancelling_a_pending_fetch_closes_the_producer() {
        let session = Arc::new(
            start(|events| async move {
                events.send(Event::Start(vec!["id".into()])).await.unwrap();
                std::future::pending::<()>().await;
            })
            .unwrap(),
        );
        let pending = {
            let session = session.clone();
            tokio::spawn(async move { session.page(0, 0, 500).await })
        };
        tokio::task::yield_now().await;
        session.cancel();
        assert!(tokio::time::timeout(Duration::from_secs(1), pending)
            .await
            .unwrap()
            .unwrap()
            .is_err());
    }
}
