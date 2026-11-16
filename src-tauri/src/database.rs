use crate::result_session::Event;
use futures_util::{pin_mut, TryStreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::compat::TokioAsyncWriteCompatExt;

const ROW_LIMIT: usize = 1000;
const BYTE_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub engine: Engine,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub tls: bool,
    pub trust_certificate: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Postgres,
    Sqlserver,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResultSet {
    pub join_editable: bool,
    pub edit_reason: Option<String>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected: Option<u64>,
    pub total_rows: Option<usize>,
    pub has_more: bool,
    pub page_size: Option<usize>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub sets: Vec<ResultSet>,
    pub truncated: bool,
    pub elapsed_ms: u128,
    pub cache_id: Option<String>,
    pub complete: bool,
    pub page_size: Option<usize>,
    pub browser: Option<crate::table_browser::Browser>,
}

// Closing a socket alone does not interrupt server-side PostgreSQL work (e.g. pg_sleep).
// Send the driver's authenticated cancellation request before stopping the connection task.
struct AbortConnection {
    task: Option<tokio::task::JoinHandle<()>>,
    cancel: tokio_postgres::CancelToken,
    tls: native_tls::TlsConnector,
    complete: bool,
}
impl Drop for AbortConnection {
    fn drop(&mut self) {
        let Some(task) = self.task.take() else { return };
        if self.complete {
            task.abort();
            return;
        }
        let cancel = self.cancel.clone();
        let tls = self.tls.clone();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                let _ = tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    cancel.cancel_query(postgres_native_tls::MakeTlsConnector::new(tls)),
                )
                .await;
                task.abort();
            });
        } else {
            task.abort();
        }
    }
}

pub async fn execute(c: &Connection, password: &str, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let mut result = match c.engine {
        Engine::Postgres => postgres(c, password, sql, None, None).await,
        Engine::Sqlserver => sqlserver(c, password, sql, None, None).await,
    }
    .map_err(|e| e.to_string())?;
    result.elapsed_ms = start.elapsed().as_millis();
    result.complete = true;
    Ok(result)
}

pub async fn stream(c: Connection, password: String, sql: String, events: mpsc::Sender<Event>) {
    let outcome = match c.engine {
        Engine::Postgres => postgres(&c, &password, &sql, Some(&events), None).await,
        Engine::Sqlserver => sqlserver(&c, &password, &sql, Some(&events), None).await,
    }
    .map(|_| ())
    .map_err(|e| e.to_string());
    let _ = events.send(Event::Finished(outcome)).await;
}

pub async fn execute_params(
    c: &Connection,
    password: &str,
    sql: &str,
    params: &[String],
) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let mut result = match c.engine {
        Engine::Postgres => postgres(c, password, sql, None, Some(params)).await,
        Engine::Sqlserver => sqlserver(c, password, sql, None, Some(params)).await,
    }
    .map_err(|e| e.to_string())?;
    result.elapsed_ms = start.elapsed().as_millis();
    result.complete = true;
    Ok(result)
}

pub async fn stream_params(
    c: Connection,
    password: String,
    sql: String,
    params: Vec<String>,
    events: mpsc::Sender<Event>,
) {
    let outcome = match c.engine {
        Engine::Postgres => postgres(&c, &password, &sql, Some(&events), Some(&params)).await,
        Engine::Sqlserver => sqlserver(&c, &password, &sql, Some(&events), Some(&params)).await,
    }
    .map(|_| ())
    .map_err(|e| e.to_string());
    let _ = events.send(Event::Finished(outcome)).await;
}

async fn postgres(
    c: &Connection,
    password: &str,
    sql: &str,
    events: Option<&mpsc::Sender<Event>>,
    params: Option<&[String]>,
) -> Result<QueryResult, Box<dyn std::error::Error + Send + Sync>> {
    let mut config = tokio_postgres::Config::new();
    config
        .host(&c.host)
        .port(c.port)
        .user(&c.username)
        .password(password)
        .dbname(&c.database)
        .connect_timeout(std::time::Duration::from_secs(10))
        .ssl_mode(if c.tls {
            tokio_postgres::config::SslMode::Require
        } else {
            tokio_postgres::config::SslMode::Disable
        });
    let mut tls = native_tls::TlsConnector::builder();
    tls.danger_accept_invalid_certs(c.trust_certificate)
        .danger_accept_invalid_hostnames(c.trust_certificate);
    let tls = tls.build()?;
    let (client, connection) = config
        .connect(postgres_native_tls::MakeTlsConnector::new(tls.clone()))
        .await?;
    let mut guard = AbortConnection {
        task: Some(tokio::spawn(async move {
            let _ = connection.await;
        })),
        cancel: client.cancel_token(),
        tls,
        complete: false,
    };
    if let Some(params) = params {
        // Generated PostgreSQL queries project text and explicitly type each bound parameter as text.
        let statement = client.prepare(sql).await?;
        let columns = statement
            .columns()
            .iter()
            .map(|column| column.name().to_owned())
            .collect();
        let mut set = ResultSet::default();
        if let Some(events) = events {
            events.send(Event::Start(columns)).await?;
        } else {
            set.columns = columns;
        }
        let parameters: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = params
            .iter()
            .map(|value| value as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();
        let stream = client.query_raw(&statement, parameters).await?;
        pin_mut!(stream);
        let mut result = QueryResult::default();
        let mut bytes = 0;
        while let Some(row) = stream.try_next().await? {
            let values: Vec<Option<String>> = (0..row.len())
                .map(|index| row.try_get(index))
                .collect::<Result<_, _>>()?;
            if let Some(events) = events {
                events.send(Event::Row(values)).await?;
            } else {
                bytes += values.iter().flatten().map(String::len).sum::<usize>();
                if set.rows.len() >= ROW_LIMIT || bytes > BYTE_LIMIT {
                    result.truncated = true;
                    break;
                }
                set.rows.push(values);
            }
        }
        if events.is_none() {
            result.sets.push(set);
        }
        guard.complete = !result.truncated;
        return Ok(result);
    }
    let stream = client.simple_query_raw(sql).await?;
    pin_mut!(stream);
    let mut result = QueryResult::default();
    let mut current = ResultSet::default();
    let mut count = 0;
    let mut bytes = 0;
    while let Some(message) = stream.try_next().await? {
        match message {
            tokio_postgres::SimpleQueryMessage::RowDescription(columns) => {
                let columns = columns.iter().map(|c| c.name().to_owned()).collect();
                if let Some(events) = events {
                    events.send(Event::Start(columns)).await?;
                } else {
                    current.columns = columns;
                }
            }
            tokio_postgres::SimpleQueryMessage::Row(row) => {
                let values: Vec<Option<String>> = (0..row.len())
                    .map(|i| row.get(i).map(str::to_owned))
                    .collect();
                if let Some(events) = events {
                    events.send(Event::Row(values)).await?;
                    continue;
                }
                bytes += values.iter().flatten().map(String::len).sum::<usize>();
                if count >= ROW_LIMIT || bytes > BYTE_LIMIT {
                    result.truncated = true;
                    result.sets.push(current);
                    guard.complete = !result.truncated;
                    return Ok(result);
                }
                current.rows.push(values);
                count += 1;
            }
            tokio_postgres::SimpleQueryMessage::CommandComplete(affected) => {
                if let Some(events) = events {
                    events.send(Event::End(Some(affected))).await?;
                    continue;
                }
                current.affected = Some(affected);
                result.sets.push(std::mem::take(&mut current));
            }
            _ => {}
        }
    }
    guard.complete = !result.truncated;
    Ok(result)
}

async fn sqlserver(
    c: &Connection,
    password: &str,
    sql: &str,
    events: Option<&mpsc::Sender<Event>>,
    params: Option<&[String]>,
) -> Result<QueryResult, Box<dyn std::error::Error + Send + Sync>> {
    let mut config = tiberius::Config::new();
    config.host(&c.host);
    config.port(c.port);
    config.database(&c.database);
    config.authentication(tiberius::AuthMethod::sql_server(&c.username, password));
    config.encryption(if c.tls {
        tiberius::EncryptionLevel::Required
    } else {
        tiberius::EncryptionLevel::NotSupported
    });
    if c.trust_certificate {
        config.trust_cert();
    }
    let tcp = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::net::TcpStream::connect(config.get_addr()),
    )
    .await??;
    tcp.set_nodelay(true)?;
    let mut client = tiberius::Client::connect(config, tcp.compat_write()).await?;
    let mut prepared = tiberius::Query::new(sql);
    if let Some(params) = params {
        for value in params {
            prepared.bind(value.clone());
        }
    }
    let mut stream = if params.is_some() {
        prepared.query(&mut client).await?
    } else {
        client.simple_query(sql).await?
    };
    let mut result = QueryResult::default();
    let mut count = 0;
    let mut bytes = 0;
    while let Some(item) = stream.try_next().await? {
        match item {
            tiberius::QueryItem::Metadata(metadata) => {
                let columns = metadata
                    .columns()
                    .iter()
                    .map(|c| c.name().to_owned())
                    .collect();
                if let Some(events) = events {
                    events.send(Event::Start(columns)).await?;
                } else {
                    result.sets.push(ResultSet {
                        columns,
                        ..Default::default()
                    });
                }
            }
            tiberius::QueryItem::Row(row) => {
                let values = row
                    .cells()
                    .map(|(_, value)| cell(value))
                    .collect::<Vec<_>>();
                if let Some(events) = events {
                    events.send(Event::Row(values)).await?;
                    continue;
                }
                bytes += values.iter().flatten().map(String::len).sum::<usize>();
                if count >= ROW_LIMIT || bytes > BYTE_LIMIT {
                    result.truncated = true;
                    break;
                }
                if let Some(set) = result.sets.last_mut() {
                    set.rows.push(values);
                }
                count += 1;
            }
        }
    }
    Ok(result)
}

fn cell(value: &tiberius::ColumnData<'_>) -> Option<String> {
    use tiberius::ColumnData::*;
    match value {
        U8(v) => v.map(|v| v.to_string()),
        I16(v) => v.map(|v| v.to_string()),
        I32(v) => v.map(|v| v.to_string()),
        I64(v) => v.map(|v| v.to_string()),
        F32(v) => v.map(|v| v.to_string()),
        F64(v) => v.map(|v| v.to_string()),
        Bit(v) => v.map(|v| v.to_string()),
        String(v) => v.as_ref().map(|v| v.to_string()),
        Guid(v) => v.map(|v| v.to_string()),
        Numeric(v) => v.map(|v| v.to_string()),
        Xml(v) => v.as_ref().map(|v| v.to_string()),
        Binary(v) => v
            .as_ref()
            .map(|v| v.iter().map(|b| format!("{b:02x}")).collect()),
        DateTime(v) => temporal::<chrono::NaiveDateTime>(&DateTime(*v)),
        SmallDateTime(v) => temporal::<chrono::NaiveDateTime>(&SmallDateTime(*v)),
        DateTime2(v) => temporal::<chrono::NaiveDateTime>(&DateTime2(*v)),
        Time(v) => temporal::<chrono::NaiveTime>(&Time(*v)),
        Date(v) => temporal::<chrono::NaiveDate>(&Date(*v)),
        DateTimeOffset(v) => temporal::<chrono::DateTime<chrono::FixedOffset>>(&DateTimeOffset(*v)),
    }
}

fn temporal<'a, T: tiberius::FromSql<'a> + std::fmt::Display>(
    value: &'a tiberius::ColumnData<'static>,
) -> Option<String> {
    match T::from_sql(value) {
        Ok(value) => value.map(|value| value.to_string()),
        Err(error) => Some(format!("[conversion error: {error}]")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tiberius::{ColumnData, ToSql};
    #[test]
    fn preserves_null_and_large_integers() {
        assert_eq!(cell(&ColumnData::I64(None)), None);
        assert_eq!(
            cell(&ColumnData::I64(Some(i64::MAX))),
            Some("9223372036854775807".into())
        );
    }
    #[test]
    fn renders_dates_and_binary_without_debug_structures() {
        let date = chrono::NaiveDate::from_ymd_opt(2026, 11, 12).unwrap();
        assert_eq!(cell(&date.to_sql()), Some("2026-11-12".into()));
        assert_eq!(
            cell(&ColumnData::Binary(Some(vec![0, 255, 16].into()))),
            Some("00ff10".into())
        );
    }
    #[test]
    fn connection_serialization_has_no_password_field() {
        let config = Connection {
            id: "test".into(),
            name: "Test".into(),
            engine: Engine::Postgres,
            host: "localhost".into(),
            port: 5432,
            database: "postgres".into(),
            username: "postgres".into(),
            tls: true,
            trust_certificate: false,
        };
        let value = serde_json::to_value(config).unwrap();
        assert!(value.get("password").is_none());
    }
}
