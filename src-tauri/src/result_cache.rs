use serde::Serialize;
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};

const MAX_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ROWS: usize = 1_000_000;
pub const FIRST_PAGE: usize = 500;
type Row = Vec<Option<String>>;

// Anonymous temporary file: query data is removed when the cache is dropped.
pub struct ResultCache {
    file: BufWriter<std::fs::File>,
    needs_seek: bool,
    sets: Vec<Vec<(u64, usize)>>,
    bytes: u64,
    rows: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub rows: Vec<Row>,
    pub total_rows: usize,
}

impl ResultCache {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            file: BufWriter::new(tempfile::tempfile().map_err(|e| e.to_string())?),
            needs_seek: false,
            sets: vec![],
            bytes: 0,
            rows: 0,
        })
    }

    pub fn append(&mut self, set: usize, row: &Row) -> Result<bool, String> {
        let encoded = serde_json::to_vec(row).map_err(|e| e.to_string())?;
        if self.bytes + encoded.len() as u64 > MAX_BYTES || self.rows >= MAX_ROWS {
            return Ok(false);
        }
        while self.sets.len() <= set {
            self.sets.push(vec![]);
        }
        if self.needs_seek {
            self.file
                .seek(SeekFrom::Start(self.bytes))
                .map_err(|e| e.to_string())?;
            self.needs_seek = false;
        }
        self.file.write_all(&encoded).map_err(|e| e.to_string())?;
        self.sets[set].push((self.bytes, encoded.len()));
        self.bytes += encoded.len() as u64;
        self.rows += 1;
        Ok(true)
    }

    pub fn count(&self, set: usize) -> usize {
        self.sets.get(set).map_or(0, Vec::len)
    }

    pub fn page(&mut self, set: usize, offset: usize, size: usize) -> Result<Page, String> {
        let total = self.count(set);
        let size = if size == 0 {
            total
        } else if size <= 10_000 {
            size
        } else {
            return Err("Page size must be between 1 and 10,000.".into());
        };
        self.file.flush().map_err(|e| e.to_string())?;
        self.needs_seek = true;
        let mut rows = Vec::new();
        if let Some(index) = self.sets.get(set) {
            // Read sequential rows through one buffer, reusing the row allocation.
            // Result sets may be interleaved, so retain indexed seeks across gaps.
            let mut reader = BufReader::new(self.file.get_mut());
            let mut next_position = None;
            let mut encoded = Vec::new();
            for &(position, length) in index.iter().skip(offset).take(size) {
                if next_position != Some(position) {
                    reader
                        .seek(SeekFrom::Start(position))
                        .map_err(|e| e.to_string())?;
                }
                encoded.resize(length, 0);
                reader.read_exact(&mut encoded).map_err(|e| e.to_string())?;
                next_position = Some(position + length as u64);
                rows.push(serde_json::from_slice(&encoded).map_err(|e| e.to_string())?);
            }
        }
        Ok(Page {
            rows,
            total_rows: total,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pages_beyond_old_limit_and_keeps_result_sets_separate() {
        let mut cache = ResultCache::new().unwrap();
        for i in 0..1251 {
            assert!(cache.append(0, &vec![Some(i.to_string()), None]).unwrap());
        }
        cache.append(2, &vec![Some("a\n\"b".into())]).unwrap();
        let page = cache.page(0, 1000, 500).unwrap();
        assert_eq!(page.total_rows, 1251);
        assert_eq!(page.rows.len(), 251);
        assert_eq!(page.rows[0], vec![Some("1000".into()), None]);
        assert_eq!(cache.page(0, 0, 10).unwrap().rows[0][0], Some("0".into()));
        assert!(cache.page(1, 0, 500).unwrap().rows.is_empty());
        assert_eq!(
            cache.page(2, 0, 500).unwrap().rows[0][0],
            Some("a\n\"b".into())
        );
        assert_eq!(cache.page(0, 0, 0).unwrap().rows.len(), 1251);
        assert!(cache.page(0, usize::MAX, 500).unwrap().rows.is_empty());
        assert!(cache.page(0, 0, 10001).is_err());
    }
    #[test]
    fn limits_do_not_insert_partial_rows() {
        let mut cache = ResultCache::new().unwrap();
        cache.bytes = MAX_BYTES;
        assert!(!cache.append(0, &vec![Some("row".into())]).unwrap());
        assert_eq!(cache.count(0), 0);
        cache.bytes = 0;
        cache.rows = MAX_ROWS;
        assert!(!cache.append(0, &vec![None]).unwrap());
    }

    #[test]
    fn buffered_pages_preserve_gaps_large_rows_and_append_after_read() {
        let mut cache = ResultCache::new().unwrap();
        let large = vec![Some("é\n".repeat(20_000)), None];
        cache.append(0, &vec![Some("first".into())]).unwrap();
        cache.append(1, &vec![Some("other set".into())]).unwrap();
        cache.append(0, &large).unwrap();
        assert_eq!(
            cache.page(0, 0, 0).unwrap().rows,
            vec![vec![Some("first".into())], large.clone()]
        );
        // Reading a short page can leave the physical file position ahead of it.
        assert_eq!(cache.page(0, 0, 1).unwrap().rows.len(), 1);
        cache.append(0, &vec![Some("last".into())]).unwrap();
        assert_eq!(
            cache.page(0, 1, 500).unwrap().rows,
            vec![large, vec![Some("last".into())]]
        );
        assert_eq!(
            cache.page(1, 0, 1).unwrap().rows,
            vec![vec![Some("other set".into())]]
        );
    }
}

#[cfg(test)]
mod performance {
    use super::*;
    // Previous implementation, retained only for the manual comparison.
    fn unbuffered_page(cache: &mut ResultCache, size: usize) -> Vec<Row> {
        cache.file.flush().unwrap();
        cache.needs_seek = true;
        cache.sets[0]
            .iter()
            .take(size)
            .map(|&(position, length)| {
                let mut encoded = vec![0; length];
                cache
                    .file
                    .get_mut()
                    .seek(SeekFrom::Start(position))
                    .unwrap();
                cache.file.get_mut().read_exact(&mut encoded).unwrap();
                serde_json::from_slice(&encoded).unwrap()
            })
            .collect()
    }
    #[test]
    #[ignore = "manual local cache timing; no machine-dependent threshold"]
    fn cached_page_timing() {
        let mut cache = ResultCache::new().unwrap();
        for i in 0..10_000 {
            cache
                .append(0, &vec![Some(i.to_string()), Some("x".repeat(192)), None])
                .unwrap();
        }
        for size in [500, 10_000] {
            let mut samples = Vec::new();
            let mut previous = Vec::new();
            for _ in 0..21 {
                let start = std::time::Instant::now();
                let expected = unbuffered_page(&mut cache, size);
                previous.push(start.elapsed().as_secs_f64() * 1000.0);
                let start = std::time::Instant::now();
                let actual = cache.page(0, 0, size).unwrap().rows;
                samples.push(start.elapsed().as_secs_f64() * 1000.0);
                assert_eq!(actual, expected);
            }
            samples.remove(0);
            previous.remove(0);
            samples.sort_by(f64::total_cmp);
            previous.sort_by(f64::total_cmp);
            println!(
                "CACHE_BENCHMARK rows={size} before_ms={:.3} after_ms={:.3}",
                previous[previous.len() / 2],
                samples[samples.len() / 2]
            );
        }
    }
}
