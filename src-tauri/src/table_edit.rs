use crate::{column_keys::{self, ColumnKey}, database::{Connection, Engine}, foreign_keys::quote};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tokio_util::compat::TokioAsyncWriteCompatExt;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change { pub row_index: usize, pub column: String, pub value: Option<String> }
#[derive(Debug, Serialize)]
pub struct Statement { pub sql: String, pub parameters: Vec<String> }
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities { pub columns: Vec<String>, pub json_columns: Vec<String>, pub uuid_columns: Vec<String>, pub date_columns: std::collections::BTreeMap<String, String>, pub insert_columns: Vec<InsertColumn>, pub row_identity_columns: std::collections::BTreeMap<String, Vec<String>> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertColumn { pub name: String, pub generated: bool, pub nullable: bool, pub default_expression: Option<String>, pub editable: bool }
#[derive(Clone, Deserialize)]
pub struct Insert { pub values: std::collections::BTreeMap<String, Option<String>> }
fn normalized_type(t: &str) -> String {
    if let Some((base, suffix)) = t.split_once('(') {
        if let Some((_, tail)) = suffix.split_once(')') { return format!("{base}{tail}"); }
    }
    t.into()
}
fn temporal(t: &str, e: &Engine) -> bool {
    let normalized = normalized_type(t);
    match e {
        Engine::Sqlserver => matches!(normalized.trim(), "date"|"time"|"datetime"|"datetime2"|"smalldatetime"|"datetimeoffset"),
        Engine::Postgres => matches!(normalized.trim(), "date"|"time without time zone"|"time with time zone"|"timestamp without time zone"|"timestamp with time zone"),
    }
}
fn supported(t: &str, e: &Engine) -> bool {
    let normalized = normalized_type(t);
    let base = normalized.trim();
    match e {
        Engine::Sqlserver => matches!(base, "int"|"bigint"|"smallint"|"tinyint"|"bit"|"decimal"|"numeric"|"money"|"smallmoney"|"uniqueidentifier"|"varchar"|"nvarchar"|"char"|"nchar"|"date"|"datetime"|"datetime2"|"smalldatetime"|"datetimeoffset"|"time"),
        Engine::Postgres => matches!(base, "json"|"jsonb"|"integer"|"bigint"|"smallint"|"boolean"|"numeric"|"text"|"character varying"|"character"|"uuid"|"date"|"timestamp without time zone"|"timestamp with time zone"|"time without time zone"|"time with time zone"),
    }
}
pub async fn metadata(c: &Connection, password: &str, base: &str) -> Result<(Vec<ColumnKey>, Capabilities), String> {
    let keys = column_keys::load(c, password, base).await?;
    let pk: Vec<_> = keys.iter().filter(|k| k.primary_key).collect();
    if pk.is_empty() || pk.iter().any(|k| !supported(&k.data_type, &c.engine)) { return Err("Editing requires a primary key with supported scalar types.".into()); }
    let table = base.split_once(" FROM ").ok_or("Unknown table")?.1.replace('\'', "''");
    let sql = match c.engine {
        Engine::Sqlserver => format!("SELECT c.name, CASE WHEN c.is_computed=1 OR c.is_identity=1 OR c.generated_always_type<>0 OR c.system_type_id=189 THEN '1' ELSE '0' END, CASE WHEN c.is_nullable=1 THEN '1' ELSE '0' END, d.definition FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id LEFT JOIN sys.default_constraints d ON d.object_id=c.default_object_id WHERE t.object_id=OBJECT_ID(N'{table}')"),
        Engine::Postgres => format!("SELECT a.attname, CASE WHEN a.attgenerated<>'' OR a.attidentity<>'' THEN '1' ELSE '0' END, CASE WHEN a.attnotnull THEN '0' ELSE '1' END, pg_get_expr(d.adbin,d.adrelid) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class t ON t.oid=a.attrelid LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE t.oid=to_regclass('{table}') AND t.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped"),
    };
    let result = crate::database::execute(c, password, &sql).await?;
    if result.truncated { return Err("Editing metadata is incomplete.".into()); }
    let insert_columns: Vec<_> = result.sets.iter().flat_map(|s| &s.rows).filter_map(|r| {
        let name = r.first()?.as_ref()?.clone();
        let generated = r.get(1)?.as_deref() == Some("1");
        let editable = !generated && keys.iter().any(|k| k.name == name && supported(&k.data_type, &c.engine));
        Some(InsertColumn { name, generated, nullable: r.get(2)?.as_deref() == Some("1"), default_expression: r.get(3).cloned().flatten(), editable })
    }).collect();
    let allowed: HashSet<_> = insert_columns.iter().filter(|c| c.editable).map(|c| c.name.clone()).collect();
    let columns = keys.iter().filter(|k| !k.primary_key && supported(&k.data_type, &c.engine) && allowed.contains(&k.name)).map(|k| k.name.clone()).collect();
    let json_columns = keys.iter().filter(|k| matches!(k.data_type.as_str(), "json"|"jsonb")).map(|k| k.name.clone()).collect();
    let uuid_columns = keys.iter().filter(|k| matches!(k.data_type.as_str(), "uuid"|"uniqueidentifier")).map(|k| k.name.clone()).collect();
    let date_columns = keys.iter().filter(|k| temporal(&k.data_type, &c.engine)).map(|k| (k.name.clone(), k.data_type.clone())).collect();
    Ok((keys, Capabilities { columns, json_columns, uuid_columns, date_columns, insert_columns, row_identity_columns: Default::default() }))
}
fn bind(value: &str, key: &ColumnKey, engine: &Engine, params: &mut Vec<String>) -> String {
    params.push(value.into());
    match engine { Engine::Postgres => format!("CAST(CAST(${} AS text) AS {})", params.len(), key.data_type), Engine::Sqlserver => format!("@P{}", params.len()) }
}
pub fn plan(table: &str, engine: &Engine, keys: &[ColumnKey], allowed: &[String], columns: &[String], rows: &[(usize, Vec<Option<String>>)], changes: &[Change]) -> Result<Vec<Statement>, String> {
    if changes.is_empty() || changes.len() > 100 { return Err("Apply between 1 and 100 cell changes at a time.".into()); }
    let pk: Vec<_> = keys.iter().filter(|k| k.primary_key).collect();
    if pk.is_empty() || pk.iter().any(|k| !supported(&k.data_type, engine) || !columns.contains(&k.name)) { return Err("The complete primary key must be present.".into()); }
    let mut unique = HashSet::new();
    for change in changes {
        if !allowed.contains(&change.column) || !unique.insert((change.row_index, change.column.clone())) { return Err("Column is read-only or edited twice.".into()); }
        if change.value.as_ref().map_or(false, |v| v.len() > 1_000_000) { return Err("Edited value exceeds 1 MB.".into()); }
    }
    let mut statements = vec![];
    for (row_index, row) in rows {
        let edits: Vec<_> = changes.iter().filter(|c| c.row_index == *row_index).collect();
        if edits.is_empty() { continue; }
        let mut parameters = vec![]; let mut sets = vec![]; let mut predicates = vec![];
        for key in &pk {
            let i = columns.iter().position(|c| c == &key.name).ok_or("Missing primary key")?;
            let value = row.get(i).and_then(|v| v.as_deref()).ok_or("Primary key is NULL")?;
            predicates.push(format!("{} = {}", quote(&key.name, engine), bind(value, key, engine, &mut parameters)));
        }
        for edit in edits {
            let key = keys.iter().find(|k| k.name == edit.column && !k.primary_key).ok_or("Unknown or read-only column")?;
            let i = columns.iter().position(|c| c == &edit.column).ok_or("Column not present in results")?;
            let old = row.get(i).ok_or("Incomplete row")?;
            predicates.push(match old { Some(value) => {
                let param = bind(value, key, engine, &mut parameters);
                if matches!(engine, Engine::Sqlserver) && matches!(key.data_type.as_str(), "varchar"|"nvarchar"|"char"|"nchar") {
                    format!("CONVERT(varbinary(max), CONVERT(nvarchar(max), {})) = CONVERT(varbinary(max), {param})", quote(&key.name, engine))
                } else if matches!(engine, Engine::Postgres) && key.data_type == "json" { format!("CAST({} AS text) = CAST({param} AS text)", quote(&key.name, engine)) } else { format!("{} = {param}", quote(&key.name, engine)) }
            }, None => format!("{} IS NULL", quote(&key.name, engine)) });
            let value = edit.value.as_deref().map(|v| bind(v, key, engine, &mut parameters)).unwrap_or_else(|| "NULL".into());
            sets.push(format!("{} = {value}", quote(&key.name, engine)));
        }
        statements.push(Statement { sql: format!("UPDATE {table} SET {} WHERE {};", sets.join(", "), predicates.join(" AND ")), parameters });
    }
    if statements.is_empty() { return Err("No editable rows found.".into()); }
    Ok(statements)
}

pub fn plan_operations(table: &str, engine: &Engine, keys: &[ColumnKey], caps: &Capabilities, columns: &[String], rows: &[(usize, Vec<Option<String>>)], changes: &[Change], inserts: &[Insert], deletes: &[usize]) -> Result<Vec<Statement>, String> {
    let count = changes.len() + inserts.len() + deletes.len();
    if count == 0 || count > 100 { return Err("Submit between 1 and 100 changes at a time.".into()); }
    let unique: HashSet<_> = deletes.iter().collect();
    if unique.len() != deletes.len() || changes.iter().any(|c| deletes.contains(&c.row_index)) { return Err("Duplicate or overlapping row operations.".into()); }
    let mut statements = if changes.is_empty() { vec![] } else { plan(table, engine, keys, &caps.columns, columns, rows, changes)? };
    for index in deletes {
        let row = &rows.iter().find(|(i, _)| i == index).ok_or("Missing original row")?.1;
        if !keys.iter().any(|k| k.primary_key) || keys.iter().filter(|k| k.primary_key).any(|k| !columns.contains(&k.name) || !supported(&k.data_type, engine)) { return Err("The complete primary key must be present.".into()); }
        let mut parameters = vec![]; let mut predicates = vec![];
        for key in keys.iter().filter(|k| supported(&k.data_type, engine)) {
            let Some(i) = columns.iter().position(|c| c == &key.name) else { continue; };
            let name = quote(&key.name, engine);
            predicates.push(match row.get(i).ok_or("Incomplete original row")? {
                None if key.primary_key => return Err("Primary key is NULL".into()),
                None => format!("{name} IS NULL"),
                Some(value) => {
                    let param = bind(value, key, engine, &mut parameters);
                    if matches!(engine, Engine::Sqlserver) && matches!(key.data_type.as_str(), "varchar"|"nvarchar"|"char"|"nchar") { format!("CONVERT(varbinary(max), CONVERT(nvarchar(max), {name})) = CONVERT(varbinary(max), {param})") }
                    else if matches!(engine, Engine::Postgres) && key.data_type == "json" { format!("CAST({name} AS text) = CAST({param} AS text)") }
                    else { format!("{name} = {param}") }
                }
            });
        }
        statements.push(Statement { sql: format!("DELETE FROM {table} WHERE {};", predicates.join(" AND ")), parameters });
    }
    for insert in inserts {
        let mut names = vec![]; let mut values = vec![]; let mut parameters = vec![];
        for col in &caps.insert_columns {
            if !col.generated && !col.nullable && col.default_expression.is_none() && !insert.values.contains_key(&col.name) { return Err(format!("{} requires a value.", col.name)); }
        }
        for (name, value) in &insert.values {
            let col = caps.insert_columns.iter().find(|c| &c.name == name && c.editable).ok_or("Unknown or generated insert column")?;
            if value.is_none() && !col.nullable { return Err(format!("{name} cannot be NULL.")); }
            if value.as_ref().is_some_and(|v| v.len() > 1_000_000) { return Err("Inserted value exceeds 1 MB.".into()); }
            let key = keys.iter().find(|k| &k.name == name).ok_or("Unknown column")?;
            names.push(quote(name, engine));
            values.push(value.as_deref().map(|v| bind(v, key, engine, &mut parameters)).unwrap_or_else(|| "NULL".into()));
        }
        let sql = if names.is_empty() { format!("INSERT INTO {table} DEFAULT VALUES;") } else { format!("INSERT INTO {table} ({}) VALUES ({});", names.join(", "), values.join(", ")) };
        statements.push(Statement { sql, parameters });
    }
    Ok(statements)
}

pub async fn apply(c: &Connection, password: &str, statements: &[Statement]) -> Result<(), String> {
    apply_inner(c, password, statements).await.map_err(|e| e.to_string())
}
async fn apply_inner(c: &Connection, password: &str, statements: &[Statement]) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match c.engine {
        Engine::Postgres => {
            let mut config = tokio_postgres::Config::new();
            config.host(&c.host).port(c.port).user(&c.username).password(password).dbname(&c.database).connect_timeout(std::time::Duration::from_secs(10)).ssl_mode(if c.tls { tokio_postgres::config::SslMode::Require } else { tokio_postgres::config::SslMode::Disable });
            let mut tls = native_tls::TlsConnector::builder();
            tls.danger_accept_invalid_certs(c.trust_certificate).danger_accept_invalid_hostnames(c.trust_certificate);
            let (mut client, connection) = config.connect(postgres_native_tls::MakeTlsConnector::new(tls.build()?)).await?;
            let task = tokio::spawn(async move { let _ = connection.await; });
            // Aborting the connection on any early exit rolls back an open transaction.
            struct Guard(tokio::task::JoinHandle<()>); impl Drop for Guard { fn drop(&mut self) { self.0.abort(); } }
            let _guard = Guard(task);
            let tx = client.transaction().await?;
            tx.batch_execute("SET LOCAL statement_timeout = '30s'; SET LOCAL lock_timeout = '10s'").await?;
            for statement in statements {
                let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = statement.parameters.iter().map(|v| v as _).collect();
                if tx.execute(statement.sql.as_str(), &params).await? != 1 { tx.rollback().await?; return Err("Row changed or was deleted since loading. Nothing was saved; reload the results.".into()); }
            }
            tx.commit().await?;
        },
        Engine::Sqlserver => {
            let mut config = tiberius::Config::new(); config.host(&c.host); config.port(c.port); config.database(&c.database);
            config.authentication(tiberius::AuthMethod::sql_server(&c.username, password));
            config.encryption(if c.tls { tiberius::EncryptionLevel::Required } else { tiberius::EncryptionLevel::NotSupported });
            if c.trust_certificate { config.trust_cert(); }
            let tcp = tokio::time::timeout(std::time::Duration::from_secs(10), tokio::net::TcpStream::connect(config.get_addr())).await??;
            tcp.set_nodelay(true)?;
            let mut client = tiberius::Client::connect(config, tcp.compat_write()).await?;
            client.simple_query("SET XACT_ABORT ON; SET LOCK_TIMEOUT 10000; BEGIN TRANSACTION").await?.into_results().await?;
            for statement in statements {
                let params: Vec<&dyn tiberius::ToSql> = statement.parameters.iter().map(|v| v as _).collect();
                if client.execute(statement.sql.as_str(), &params).await?.total() != 1 {
                    client.simple_query("ROLLBACK TRANSACTION").await?.into_results().await?;
                    return Err("Row changed or was deleted since loading. Nothing was saved; reload the results.".into());
                }
            }
            client.simple_query("COMMIT TRANSACTION").await?.into_results().await?;
        },
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn temporal_columns_respect_engine_and_precision() {
        assert!(super::temporal("timestamp(3) with time zone", &super::Engine::Postgres));
        assert!(super::supported("time(6) without time zone", &super::Engine::Postgres));
        assert!(super::temporal("datetime2", &super::Engine::Sqlserver));
        assert!(!super::temporal("timestamp", &super::Engine::Sqlserver));
        assert!(!super::temporal("varchar(20)", &super::Engine::Sqlserver));
    }

    use super::*;
    fn keys() -> Vec<ColumnKey> { vec![
        ColumnKey { name: "k1".into(), primary_key: true, foreign_key: false, data_type: "integer".into() },
        ColumnKey { name: "k2".into(), primary_key: true, foreign_key: false, data_type: "integer".into() },
        ColumnKey { name: "value".into(), primary_key: false, foreign_key: false, data_type: "text".into() },
    ] }
    #[test]
    fn plans_composite_keys_original_values_and_bound_input() {
        let columns = vec!["k1".into(), "k2".into(), "value".into()];
        let rows = vec![(4, vec![Some("1".into()), Some("2".into()), None])];
        let changes = vec![Change { row_index: 4, column: "value".into(), value: Some("'; DROP TABLE users; --".into()) }];
        let statements = plan("\"public\".\"items\"", &Engine::Postgres, &keys(), &["value".into()], &columns, &rows, &changes).unwrap();
        assert!(statements[0].sql.contains("\"k1\" =")); assert!(statements[0].sql.contains("\"k2\" ="));
        assert!(statements[0].sql.contains("\"value\" IS NULL")); assert!(!statements[0].sql.contains("DROP"));
        assert_eq!(statements[0].parameters[2], "'; DROP TABLE users; --");
        assert!(plan("items", &Engine::Postgres, &keys(), &["value".into()], &columns[1..], &rows, &changes).is_err());
        let bad = vec![Change { row_index: 4, column: "k1".into(), value: Some("7".into()) }];
        assert!(plan("items", &Engine::Postgres, &keys(), &["value".into()], &columns, &rows, &bad).is_err());
    }
    #[tokio::test]
    #[ignore = "Requires disposable editing containers"]
    async fn live_edit_transactions() {
        assert_eq!(std::env::var("DATAGOBLIN_EDIT_ISOLATED").as_deref(), Ok("yes"));
        for engine in [Engine::Postgres, Engine::Sqlserver] {
            let pg = matches!(engine, Engine::Postgres);
            let c = Connection { id: "edit-test".into(), name: "Disposable edit test".into(), engine, host: "127.0.0.1".into(), port: if pg {55439} else {51439}, database: if pg {"datagoblin_edit"} else {"master"}.into(), username: if pg {"postgres"} else {"sa"}.into(), tls: false, trust_certificate: true };
            let password = "GoblinEdit_TestOnly2026";
            let table = if pg { "public.dg_edit_fixture" } else { "dbo.dg_edit_fixture" };
            let create = if pg { "CREATE TABLE public.dg_edit_fixture (k1 int, k2 int, value text, amount int CHECK(amount>=0), derived int GENERATED ALWAYS AS (k1+1) STORED, PRIMARY KEY(k1,k2))" } else { "CREATE TABLE dbo.dg_edit_fixture (k1 int, k2 int, value nvarchar(100), amount int CHECK(amount>=0), derived AS (k1+1), PRIMARY KEY(k1,k2))" };
            crate::database::execute(&c, password, create).await.unwrap();
            crate::database::execute(&c, password, &format!("INSERT INTO {table} (k1,k2,value,amount) VALUES (1,1,'old',10),(1,2,'second',20)")).await.unwrap();
            let base = format!("SELECT COUNT(*) FROM {table}");
            let (keys, cap) = metadata(&c, password, &base).await.unwrap();
            assert!(cap.columns.contains(&"value".into())); assert!(!cap.columns.contains(&"derived".into())); assert!(!cap.columns.contains(&"k1".into()));
            let original = crate::database::execute(&c, password, &format!("SELECT k1,k2,value,amount,derived FROM {table} ORDER BY k2")).await.unwrap();
            let set = &original.sets[0]; let rows: Vec<_> = set.rows.iter().cloned().enumerate().collect();
            let changes = vec![Change { row_index: 0, column: "value".into(), value: Some("quoted ' value".into()) }, Change { row_index: 1, column: "value".into(), value: None }];
            let statements = plan(table, &c.engine, &keys, &cap.columns, &set.columns, &rows, &changes).unwrap();
            apply(&c, password, &statements).await.unwrap();
            let current = crate::database::execute(&c, password, &format!("SELECT k1,k2,value,amount,derived FROM {table} ORDER BY k2")).await.unwrap();
            assert_eq!(current.sets[0].rows[0][2].as_deref(), Some("quoted ' value")); assert_eq!(current.sets[0].rows[1][2], None);
            let set = &current.sets[0]; let rows: Vec<_> = set.rows.iter().cloned().enumerate().collect();
            // The first row update must roll back when the second violates a constraint.
            let invalid = vec![Change { row_index: 0, column: "amount".into(), value: Some("11".into()) }, Change { row_index: 1, column: "amount".into(), value: Some("-1".into()) }];
            let statements = plan(table, &c.engine, &keys, &cap.columns, &set.columns, &rows, &invalid).unwrap();
            assert!(apply(&c, password, &statements).await.is_err());
            let check = crate::database::execute(&c, password, &format!("SELECT amount FROM {table} WHERE k2=1")).await.unwrap(); assert_eq!(check.sets[0].rows[0][0].as_deref(), Some("10"));
            // A concurrent edit on the second row also rolls back the first row update.
            crate::database::execute(&c, password, &format!("UPDATE {table} SET amount=21 WHERE k2=2")).await.unwrap();
            let stale = vec![Change { row_index: 0, column: "amount".into(), value: Some("12".into()) }, Change { row_index: 1, column: "amount".into(), value: Some("22".into()) }];
            let statements = plan(table, &c.engine, &keys, &cap.columns, &set.columns, &rows, &stale).unwrap();
            assert!(apply(&c, password, &statements).await.unwrap_err().contains("Row changed"));
            let check = crate::database::execute(&c, password, &format!("SELECT amount FROM {table} WHERE k2=1")).await.unwrap(); assert_eq!(check.sets[0].rows[0][0].as_deref(), Some("10"));
            if pg {
                crate::database::execute(&c, password, &format!("ALTER TABLE {table} ADD COLUMN payload json, ADD COLUMN binary_payload jsonb; UPDATE {table} SET payload='{{\"id\":9007199254740993}}', binary_payload='{{\"ok\":false}}'")).await.unwrap();
                let (keys, cap) = metadata(&c, password, &base).await.unwrap();
                assert!(cap.json_columns.contains(&"payload".into())); assert!(cap.json_columns.contains(&"binary_payload".into()));
                let snapshot = crate::database::execute(&c, password, &format!("SELECT * FROM {table} ORDER BY k2")).await.unwrap();
                let set = &snapshot.sets[0]; let rows: Vec<_> = set.rows.iter().cloned().enumerate().collect();
                let edits = vec![Change { row_index: 0, column: "payload".into(), value: Some("{\"id\":9007199254740994}".into()) }, Change { row_index: 0, column: "binary_payload".into(), value: Some("{\"ok\":true}".into()) }];
                let statements = plan(table, &c.engine, &keys, &cap.columns, &set.columns, &rows, &edits).unwrap();
                apply(&c, password, &statements).await.unwrap();
                let updated = crate::database::execute(&c, password, &format!("SELECT payload::text, binary_payload::text FROM {table} WHERE k2=1")).await.unwrap();
                assert!(updated.sets[0].rows[0][0].as_ref().unwrap().contains("9007199254740994"));
                assert!(updated.sets[0].rows[0][1].as_ref().unwrap().contains("true"));
                assert!(apply(&c, password, &statements).await.unwrap_err().contains("Row changed"));
            }

            // Mixed insert/delete submissions must preserve defaults and roll back as a unit.
            let row_table = if pg { "public.dg_row_fixture" } else { "dbo.dg_row_fixture" };
            let definition = if pg { "id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text DEFAULT 'untitled', amount integer NOT NULL DEFAULT 7 CHECK(amount>=0)" } else { "id int IDENTITY PRIMARY KEY, label nvarchar(100) DEFAULT 'untitled', amount int NOT NULL DEFAULT 7 CHECK(amount>=0)" };
            crate::database::execute(&c, password, &format!("CREATE TABLE {row_table} ({definition})")).await.unwrap();
            let (row_keys, row_cap) = metadata(&c, password, &format!("SELECT COUNT(*) FROM {row_table}")).await.unwrap();
            assert!(row_cap.insert_columns.iter().any(|c| c.name == "id" && c.generated && !c.editable));
            assert!(row_cap.insert_columns.iter().any(|c| c.name == "amount" && c.default_expression.is_some() && !c.nullable));
            let defaults = Insert { values: Default::default() };
            let statements = plan_operations(row_table, &c.engine, &row_keys, &row_cap, &[], &[], &[], &[defaults.clone()], &[]).unwrap();
            assert!(statements[0].sql.contains("DEFAULT VALUES"));
            apply(&c, password, &statements).await.unwrap();
            let snapshot = crate::database::execute(&c, password, &format!("SELECT * FROM {row_table}")).await.unwrap();
            let set = &snapshot.sets[0]; let rows: Vec<_> = set.rows.iter().cloned().enumerate().collect();
            assert_eq!(set.rows[0][1].as_deref(), Some("untitled")); assert_eq!(set.rows[0][2].as_deref(), Some("7"));
            let invalid = Insert { values: [("amount".into(), Some("-1".into()))].into() };
            let statements = plan_operations(row_table, &c.engine, &row_keys, &row_cap, &set.columns, &rows, &[], &[invalid], &[0]).unwrap();
            assert!(apply(&c, password, &statements).await.is_err());
            let retained = crate::database::execute(&c, password, &format!("SELECT COUNT(*) FROM {row_table}")).await.unwrap();
            assert_eq!(retained.sets[0].rows[0][0].as_deref(), Some("1"));
            let replacement = Insert { values: [("label".into(), Some("quote ' preserved".into()))].into() };
            let statements = plan_operations(row_table, &c.engine, &row_keys, &row_cap, &set.columns, &rows, &[], &[replacement], &[0]).unwrap();
            apply(&c, password, &statements).await.unwrap();
            let replaced = crate::database::execute(&c, password, &format!("SELECT * FROM {row_table}")).await.unwrap();
            assert_eq!(replaced.sets[0].rows.len(), 1); assert_eq!(replaced.sets[0].rows[0][1].as_deref(), Some("quote ' preserved"));
            // The original snapshot cannot delete a replacement row or leave an inserted row behind.
            assert!(apply(&c, password, &statements).await.unwrap_err().contains("Row changed"));
            let generated = Insert { values: [("id".into(), Some("99".into()))].into() };
            assert!(plan_operations(row_table, &c.engine, &row_keys, &row_cap, &[], &[], &[], &[generated], &[]).is_err());
            println!("Row operations: defaults, generated identity, parameterized insert, delete, mixed rollback and stale deletion passed");
            println!("{}: edits, NULL, composite keys, generated columns, constraint rollback and conflict rollback passed", if pg {"PostgreSQL"} else {"SQL Server"});
        }
    }
}
