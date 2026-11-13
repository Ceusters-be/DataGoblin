use crate::database::{Connection, Engine};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnKey {
    pub name: String,
    pub primary_key: bool,
    pub foreign_key: bool,
    pub data_type: String,
}

pub fn query(count_sql: &str, engine: &Engine) -> Option<String> {
    let (_, table) = count_sql.split_once(" FROM ")?;
    if matches!(engine, Engine::Sqlserver) && table.matches("].[").count() > 1 {
        return None;
    }
    let table = table.replace('\'', "''");
    Some(match engine {
        Engine::Sqlserver => format!(
            r#"SELECT c.name,
            CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic
                ON ic.object_id=i.object_id AND ic.index_id=i.index_id
                WHERE i.object_id=c.object_id AND i.is_primary_key=1 AND ic.column_id=c.column_id AND ic.key_ordinal>0) THEN 1 ELSE 0 END,
            CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_key_columns fk
                WHERE fk.parent_object_id=c.object_id AND fk.parent_column_id=c.column_id) THEN 1 ELSE 0 END, TYPE_NAME(c.user_type_id)
            FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'{table}') ORDER BY c.column_id"#
        ),
        Engine::Postgres => format!(
            r#"SELECT a.attname,
            CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                WHERE k.conrelid=a.attrelid AND k.contype='p' AND a.attnum=ANY(k.conkey)) THEN 1 ELSE 0 END,
            CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                WHERE k.conrelid=a.attrelid AND k.contype='f' AND a.attnum=ANY(k.conkey)) THEN 1 ELSE 0 END, pg_catalog.format_type(a.atttypid,a.atttypmod)
            FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('{table}')
                AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum"#
        ),
    })
}

pub async fn load(
    connection: &Connection,
    password: &str,
    count_sql: &str,
) -> Result<Vec<ColumnKey>, String> {
    let sql = query(count_sql, &connection.engine).ok_or("Column source is unknown.")?;
    let result = crate::database::execute(connection, password, &sql).await?;
    if result.truncated {
        return Err("Column metadata exceeded the result limit.".into());
    }
    Ok(result
        .sets
        .first()
        .map(|set| {
            set.rows
                .iter()
                .filter_map(|row| {
                    Some(ColumnKey {
                        name: row.first()?.clone()?,
                        data_type: row.get(3)?.clone()?,
                        primary_key: row.get(1)?.as_deref() == Some("1"),
                        foreign_key: row.get(2)?.as_deref() == Some("1"),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn builds_key_catalog_queries_with_escaped_names() {
        let sql = query(
            "SELECT COUNT_BIG(*) AS total_rows FROM [dbo].[Job's]",
            &Engine::Sqlserver,
        )
        .unwrap();
        assert!(sql.contains("OBJECT_ID(N'[dbo].[Job''s]')"));
        assert!(sql.contains("i.is_primary_key=1"));
        assert!(sql.contains("fk.parent_column_id=c.column_id"));
        let sql = query(
            "SELECT COUNT(*) AS total_rows FROM \"public\".\"Jobs\"",
            &Engine::Postgres,
        )
        .unwrap();
        assert!(sql.contains("to_regclass('\"public\".\"Jobs\"')"));
        assert!(sql.contains("a.attnum=ANY(k.conkey)"));
    }
}
