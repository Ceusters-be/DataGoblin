use serde::{Deserialize, Serialize};
use std::{io::Write, path::Path, sync::Mutex};
use tauri::{Manager, State};

const MAX_ENTRIES: usize = 1000;
const MAX_BYTES: usize = 16 * 1024 * 1024;
#[derive(Default)]
pub struct HistoryLock(Mutex<()>);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    #[serde(default)]
    pub query_id: Option<String>,
    pub sql: String,
    pub connection_id: String,
    pub server_name: String,
    pub database: String,
    pub engine: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub status: String,
    pub error: Option<String>,
}
fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("query-history.json"))
}
fn read(path: &Path) -> Result<Vec<Entry>, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("Could not read query history: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}
fn append(path: &Path, entry: Entry) -> Result<(), String> {
    if entry.sql.trim().is_empty() {
        return Ok(());
    }
    if !["completed", "results", "error", "cancelled"].contains(&entry.status.as_str()) {
        return Err("Invalid history status".into());
    }
    if serde_json::to_vec(&entry).map_err(|e| e.to_string())?.len() > MAX_BYTES / 2 {
        return Err("Query is too large to save in history.".into());
    }
    let mut entries = read(path)?;
    entries.retain(|e| e.id != entry.id);
    entries.push(entry);
    entries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    entries.truncate(MAX_ENTRIES);
    let bytes = loop {
        let bytes = serde_json::to_vec(&entries).map_err(|e| e.to_string())?;
        if bytes.len() <= MAX_BYTES {
            break bytes;
        }
        entries.pop();
    };
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing history folder")?)
        .map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn query_history(
    app: tauri::AppHandle,
    state: State<'_, HistoryLock>,
    query_id: Option<String>,
) -> Result<Vec<Entry>, String> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    Ok(read(&path(&app)?)?
        .into_iter()
        .filter(|entry| {
            query_id
                .as_ref()
                .map_or(true, |id| entry.query_id.as_ref() == Some(id))
        })
        .collect())
}
#[tauri::command]
pub fn record_query_history(
    app: tauri::AppHandle,
    state: State<'_, HistoryLock>,
    entry: Entry,
) -> Result<(), String> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    append(&path(&app)?, entry)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn entry(id: &str) -> Entry {
        Entry {
            id: id.into(),
            query_id: Some("query-1".into()),
            sql: "SELECT 'original'".into(),
            connection_id: "server".into(),
            server_name: "Development".into(),
            database: "db".into(),
            engine: "postgres".into(),
            started_at: id.into(),
            duration_ms: 25,
            status: "error".into(),
            error: Some("Missing table".into()),
        }
    }
    #[test]
    fn persists_context_errors_and_deduplicates() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("history.json");
        assert!(read(&p).unwrap().is_empty());
        append(&p, entry("1")).unwrap();
        append(&p, entry("2")).unwrap();
        append(&p, entry("1")).unwrap();
        let entries = read(&p).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].query_id.as_deref(), Some("query-1"));
        assert_eq!(entries[0].id, "2");
        assert_eq!(entries[0].database, "db");
        assert_eq!(entries[0].error.as_deref(), Some("Missing table"));
        assert_eq!(entries[0].sql, "SELECT 'original'");
    }
    #[test]
    fn legacy_history_without_query_id_remains_readable() {
        let mut value = serde_json::to_value(entry("legacy")).unwrap();
        value.as_object_mut().unwrap().remove("queryId");
        let old: Entry = serde_json::from_value(value).unwrap();
        assert!(old.query_id.is_none());
    }
    #[test]
    fn preserves_corrupt_history_instead_of_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("history.json");
        std::fs::write(&p, b"bad").unwrap();
        assert!(append(&p, entry("1")).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), b"bad");
    }
}
