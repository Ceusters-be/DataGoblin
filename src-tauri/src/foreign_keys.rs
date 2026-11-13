use crate::database::{Connection, Engine};
use serde::Serialize;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: String,
    pub name: String,
    pub schema: String,
    pub table: String,
    pub columns: Vec<String>,
    pub target_columns: Vec<String>,
}
pub fn quote(v: &str, e: &Engine) -> String {
    match e {
        Engine::Postgres => format!("\"{}\"", v.replace('"', "\"\"")),
        Engine::Sqlserver => format!("[{}]", v.replace(']', "]]")),
    }
}
pub fn literal(v: &str, e: &Engine) -> String {
    match e {
        Engine::Sqlserver => format!("N'{}'", v.replace('\'', "''")),
        Engine::Postgres => format!("E'{}'", v.replace('\\', "\\\\").replace('\'', "''")),
    }
}
pub fn catalog(base: &str, e: &Engine) -> Result<String, String> {
    let table = base
        .split_once(" FROM ")
        .ok_or("Unknown source table")?
        .1
        .replace('\'', "''");
    Ok(match e {
 Engine::Sqlserver=>format!("SELECT CAST(f.object_id AS varchar(20)),f.name,s.name,t.name,c.name,rc.name FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id JOIN sys.tables t ON t.object_id=f.referenced_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=f.parent_object_id AND c.column_id=fc.parent_column_id JOIN sys.columns rc ON rc.object_id=f.referenced_object_id AND rc.column_id=fc.referenced_column_id WHERE f.parent_object_id=OBJECT_ID(N'{table}') ORDER BY f.object_id,fc.constraint_column_id"),
 Engine::Postgres=>format!("SELECT k.oid::text,k.conname,n.nspname,t.relname,a.attname,b.attname FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class t ON t.oid=k.confrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL unnest(k.conkey,k.confkey) WITH ORDINALITY AS pairs(src,dst,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=pairs.src JOIN pg_catalog.pg_attribute b ON b.attrelid=k.confrelid AND b.attnum=pairs.dst WHERE k.contype='f' AND k.conrelid=to_regclass('{table}') ORDER BY k.oid,pairs.ord")})
}
pub async fn load(
    c: &Connection,
    password: &str,
    base: &str,
    column: &str,
) -> Result<Vec<Reference>, String> {
    let result = crate::database::execute(c, password, &catalog(base, &c.engine)?).await?;
    if result.truncated {
        return Err("Relationship metadata exceeded the limit".into());
    }
    let mut refs: Vec<Reference> = vec![];
    for row in &result.sets.first().ok_or("No relationship metadata")?.rows {
        let f = row
            .iter()
            .map(|v| v.as_deref().ok_or("Incomplete relationship metadata"))
            .collect::<Result<Vec<_>, _>>()?;
        if f.len() != 6 {
            return Err("Invalid relationship metadata".into());
        }
        if refs.last().map(|r| r.id.as_str()) != Some(f[0]) {
            refs.push(Reference {
                id: f[0].into(),
                name: f[1].into(),
                schema: f[2].into(),
                table: f[3].into(),
                columns: vec![],
                target_columns: vec![],
            });
        }
        let r = refs.last_mut().unwrap();
        r.columns.push(f[4].into());
        r.target_columns.push(f[5].into());
    }
    Ok(refs
        .into_iter()
        .filter(|r| r.columns.iter().any(|c| c == column))
        .collect())
}
pub fn filters(
    r: &Reference,
    columns: &[String],
    row: &[Option<String>],
) -> Result<Vec<crate::table_browser::Filter>, String> {
    r.columns
        .iter()
        .zip(&r.target_columns)
        .map(|(source, target)| {
            let index = columns
                .iter()
                .position(|c| c == source)
                .ok_or("A composite key column is missing")?;
            let value = row
                .get(index)
                .and_then(|v| v.clone())
                .ok_or("This foreign key contains NULL and has no referenced record")?;
            Ok(crate::table_browser::Filter {
                column: target.clone(),
                operator: "equals".into(),
                value,
                values: vec![],
            })
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn composite_keys() {
        let r = Reference {
            id: "1".into(),
            name: "fk".into(),
            schema: "dbo".into(),
            table: "parent".into(),
            columns: vec!["a".into(), "b".into()],
            target_columns: vec!["x".into(), "y".into()],
        };
        let cols = vec!["b".into(), "a".into()];
        let f = filters(&r, &cols, &[Some("2".into()), Some("1".into())]).unwrap();
        assert_eq!(f[0].value, "1");
        assert_eq!(f[1].column, "y");
        assert!(filters(&r, &cols, &[None, Some("1".into())]).is_err());
    }
    #[test]
    fn escaped_literals() {
        assert_eq!(literal("O'Reilly", &Engine::Sqlserver), "N'O''Reilly'");
        assert_eq!(literal("a\\b", &Engine::Postgres), "E'a\\\\b'");
        assert_eq!(quote("a]b", &Engine::Sqlserver), "[a]]b]");
    }
}
