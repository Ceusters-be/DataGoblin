//! Conservative lineage for SELECT * over multiple base tables. Unsupported query
//! shapes remain read-only; output names are never used to guess a source table.
use crate::{
    column_keys::ColumnKey,
    database::{self, Connection, Engine, ResultSet},
    foreign_keys::{literal, quote},
    table_edit::{self, Capabilities, Change, Statement},
};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug)]
struct Token {
    text: String,
    identifier: bool,
    quoted: bool,
}
fn tokens(sql: &str) -> Option<Vec<Token>> {
    let mut rest = sql;
    let mut out = vec![];
    while !rest.is_empty() {
        rest = rest.trim_start();
        if rest.is_empty() {
            break;
        }
        if rest.starts_with("--") {
            rest = rest.find('\n').map(|i| &rest[i + 1..]).unwrap_or("");
            continue;
        }
        if rest.starts_with("/*") {
            return None;
        } // Nested comment dialects differ.
        let first = rest.chars().next()?;
        if matches!(first, '[' | '"' | '\'') {
            let end = if first == '[' { ']' } else { first };
            rest = &rest[first.len_utf8()..];
            let mut text = String::new();
            loop {
                let ch = rest.chars().next()?;
                rest = &rest[ch.len_utf8()..];
                if ch == end {
                    if rest.starts_with(end) {
                        rest = &rest[end.len_utf8()..];
                        text.push(end);
                    } else {
                        break;
                    }
                } else {
                    text.push(ch);
                }
            }
            if first == '\'' && text.contains('\\') {
                return None;
            }
            out.push(Token {
                text,
                identifier: first != '\'',
                quoted: true,
            });
        } else if first.is_alphabetic() || first == '_' {
            let n = rest
                .char_indices()
                .take_while(|(_, c)| c.is_alphanumeric() || matches!(c, '_' | '$'))
                .map(|(i, c)| i + c.len_utf8())
                .last()?;
            out.push(Token {
                text: rest[..n].into(),
                identifier: true,
                quoted: false,
            });
            rest = &rest[n..];
        } else {
            out.push(Token {
                text: first.to_string(),
                identifier: false,
                quoted: false,
            });
            rest = &rest[first.len_utf8()..];
        }
    }
    Some(out)
}
// Shared conservative WHERE validation: one scalar predicate, no nested queries,
// clauses, parameters or additional statements. Strings/quoted identifiers are atomic.
pub(crate) fn scalar_predicate(sql: &str) -> bool {
    let Some(ts) = tokens(sql) else { return false; };
    if ts.is_empty() { return false; }
    let mut depth = 0;
    for t in ts {
        if t.quoted { continue; }
        if t.identifier {
            if ["select", "from", "join", "union", "intersect", "except", "order", "group", "having",
                "limit", "offset", "fetch", "option", "for", "into", "insert", "update", "delete", "merge",
                "exec", "execute", "create", "alter", "drop", "truncate", "grant", "revoke", "with",
                "declare", "set", "use", "go", "return", "waitfor", "begin", "commit", "rollback"]
                .iter().any(|w| t.text.eq_ignore_ascii_case(w)) { return false; }
        } else {
            match t.text.as_str() {
                "(" => depth += 1,
                ")" => { depth -= 1; if depth < 0 { return false; } },
                "," | "." | "=" | "<" | ">" | "!" | "+" | "-" | "*" | "/" | "%" | "|" | "&" | "^" | "~" => {},
                value if value.chars().all(|c| c.is_ascii_digit()) => {},
                _ => return false,
            }
        }
    }
    depth == 0
}
fn keyword(t: Option<&Token>, word: &str) -> bool {
    t.is_some_and(|t| !t.quoted && t.text.eq_ignore_ascii_case(word))
}
#[derive(Debug)]
struct Source {
    table: String,
    alias: String,
}
fn shape(sql: &str, engine: &Engine) -> Option<Vec<Source>> {
    let ts = tokens(sql)?;
    let mut i = 0;
    let take = |i: &mut usize, word: &str| {
        if keyword(ts.get(*i), word) {
            *i += 1;
            true
        } else {
            false
        }
    };
    if !take(&mut i, "select") || !take(&mut i, "*") || !take(&mut i, "from") {
        return None;
    }
    let name = |t: &Token| {
        if matches!(engine, Engine::Postgres) && !t.quoted {
            t.text.to_lowercase()
        } else {
            t.text.clone()
        }
    };
    let source = |i: &mut usize| -> Option<Source> {
        let mut parts = vec![];
        loop {
            let t = ts.get(*i)?;
            if !t.identifier {
                return None;
            }
            parts.push(name(t));
            *i += 1;
            if !take(i, ".") {
                break;
            }
        }
        if parts.len() > 2 {
            return None;
        }
        let mut alias = parts.last()?.clone();
        let has_as = take(i, "as");
        if has_as
            || ts.get(*i).is_some_and(|t| {
                t.identifier
                    && !["inner", "join", "on", "left", "right", "full", "cross"]
                        .iter()
                        .any(|w| keyword(Some(t), w))
            })
        {
            let t = ts.get(*i)?;
            if !t.identifier {
                return None;
            }
            alias = name(t);
            *i += 1;
        }
        Some(Source {
            table: parts
                .iter()
                .map(|p| quote(p, engine))
                .collect::<Vec<_>>()
                .join("."),
            alias,
        })
    };
    let mut sources = vec![source(&mut i)?];
    let mut aliases = HashSet::new();
    aliases.insert(sources[0].alias.to_lowercase());
    loop {
        take(&mut i, "inner");
        if !take(&mut i, "join") { return None; }
        let next = source(&mut i)?;
        if !aliases.insert(next.alias.to_lowercase()) { return None; }
        sources.push(next);
        if !take(&mut i, "on") { return None; }
        let start = i;
        let mut depth = 0;
        let mut tail = false;
        while i < ts.len() {
            let t = &ts[i];
            if t.quoted { i += 1; continue; }
            if depth == 0 && (keyword(Some(t), "join") || keyword(Some(t), "inner")) {
                if tail { return None; }
                break;
            }
            if depth == 0 && (keyword(Some(t), "where") || keyword(Some(t), "order")) {
                if i == start { return None; }
                tail = true;
            }
            if t.text == "(" { depth += 1; }
            if t.text == ")" { depth -= 1; if depth < 0 { return None; } }
            if t.text == "$" || t.text == ";" && (i != ts.len() - 1 || depth != 0) { return None; }
            if (keyword(Some(t), "left") || keyword(Some(t), "right")) && !ts.get(i + 1).is_some_and(|next| next.text == "(") { return None; }
            if ["select", "from", "join", "group", "having", "union", "intersect", "except",
                "into", "for", "option", "with", "insert", "update", "delete", "merge", "exec",
                "execute", "drop", "alter", "create", "truncate", "full", "cross", "apply", "natural"]
                .iter().any(|w| keyword(Some(t), w)) { return None; }
            i += 1;
        }
        if i == start || depth != 0 { return None; }
        if i == ts.len() { break; }
    }
    Some(sources)
}

pub struct Target {
    table: String,
    alias: String,
    keys: Vec<ColumnKey>,
    caps: Capabilities,
    offset: usize,
}
pub struct JoinEdit {
    pub sql: String,
    targets: Vec<Target>,
}
impl JoinEdit {
    fn original_columns(&self) -> Vec<String> {
        self.targets
            .iter()
            .flat_map(|t| t.keys.iter().map(|k| k.name.clone()))
            .collect()
    }
    fn labels(&self) -> Vec<String> {
        self.targets
            .iter()
            .flat_map(|t| {
                t.keys
                    .iter()
                    .map(move |k| format!("{}.{}", t.alias, k.name))
            })
            .collect()
    }
    pub fn validate(&self, columns: &[String]) -> Result<(), String> {
        if columns != self.original_columns() {
            return Err(
                "Source columns changed or cannot be mapped safely. Run the query again.".into(),
            );
        }
        Ok(())
    }
    pub fn decorate(&self, set: &mut ResultSet) {
        match self.validate(&set.columns) {
            Ok(()) => {
                set.columns = self.labels();
                set.join_editable = true;
            }
            Err(e) => set.edit_reason = Some(e),
        }
    }
    pub fn capabilities(&self) -> Capabilities {
        let mut out = Capabilities::default();
        for t in &self.targets {
            let label = |s: &str| format!("{}.{}", t.alias, s);
            let identity: Vec<_> = t
                .keys
                .iter()
                .filter(|k| k.primary_key)
                .map(|k| label(&k.name))
                .collect();
            for c in &t.caps.columns {
                let c = label(c);
                out.row_identity_columns.insert(c.clone(), identity.clone());
                out.columns.push(c);
            }
            out.json_columns
                .extend(t.caps.json_columns.iter().map(|s| label(s)));
            out.uuid_columns
                .extend(t.caps.uuid_columns.iter().map(|s| label(s)));
            out.date_columns.extend(
                t.caps
                    .date_columns
                    .iter()
                    .map(|(s, t)| (label(s), t.clone())),
            );
        }
        out
    }
    pub fn column_keys(&self) -> Vec<ColumnKey> {
        self.targets
            .iter()
            .flat_map(|t| {
                t.keys.iter().cloned().map(move |mut k| {
                    k.name = format!("{}.{}", t.alias, k.name);
                    k
                })
            })
            .collect()
    }
    pub fn plan(
        &self,
        engine: &Engine,
        columns: &[String],
        rows: &[(usize, Vec<Option<String>>)],
        changes: &[Change],
    ) -> Result<Vec<Statement>, String> {
        self.validate(columns)?;
        if changes.is_empty() || changes.len() > 100 {
            return Err("Submit between 1 and 100 changed cells.".into());
        }
        let caps = self.capabilities();
        if changes.iter().any(|c| !caps.columns.contains(&c.column)) {
            return Err("Unknown or read-only source column.".into());
        }
        let mut statements = vec![];
        for t in &self.targets {
            // Collapse repeated result rows to one update per physical primary key.
            let mut grouped: BTreeMap<
                Vec<String>,
                (Vec<Option<String>>, BTreeMap<String, Option<String>>),
            > = BTreeMap::new();
            for change in changes {
                let Some(column) = t
                    .keys
                    .iter()
                    .find(|k| format!("{}.{}", t.alias, k.name) == change.column)
                else {
                    continue;
                };
                let row = &rows
                    .iter()
                    .find(|(index, _)| *index == change.row_index)
                    .ok_or("Original row is unavailable")?
                    .1;
                let values = row
                    .get(t.offset..t.offset + t.keys.len())
                    .ok_or("Incomplete source row")?
                    .to_vec();
                let identity = t
                    .keys
                    .iter()
                    .enumerate()
                    .filter(|(_, k)| k.primary_key)
                    .map(|(i, _)| values[i].clone().ok_or("Source primary key is NULL"))
                    .collect::<Result<Vec<_>, _>>()?;
                let (original, edits) = grouped
                    .entry(identity)
                    .or_insert_with(|| (values.clone(), BTreeMap::new()));
                if original != &values {
                    return Err(
                        "Repeated source rows have inconsistent original values. Reload results."
                            .into(),
                    );
                }
                if let Some(previous) = edits.insert(column.name.clone(), change.value.clone()) {
                    if previous != change.value {
                        return Err("Conflicting edits to the same source cell.".into());
                    }
                }
            }
            for (_, (row, edits)) in grouped {
                let changes: Vec<_> = edits
                    .into_iter()
                    .map(|(column, value)| Change {
                        row_index: 0,
                        column,
                        value,
                    })
                    .collect();
                let columns: Vec<_> = t.keys.iter().map(|k| k.name.clone()).collect();
                statements.extend(table_edit::plan(
                    &t.table,
                    engine,
                    &t.keys,
                    &t.caps.columns,
                    &columns,
                    &[(0, row)],
                    &changes,
                )?);
            }
        }
        Ok(statements)
    }
}
pub async fn prepare(
    c: &Connection,
    password: &str,
    sql: &str,
) -> Result<Option<JoinEdit>, String> {
    let Some(sources) = shape(sql, &c.engine) else {
        return Ok(None);
    };
    let mut targets = vec![];
    let mut offset = 0;
    let mut seen = HashSet::new();
    for source in sources {
        let name = literal(&source.table, &c.engine);
        let resolve=match c.engine {
            Engine::Sqlserver=>format!("SELECT s.name,t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE t.object_id=OBJECT_ID({name})"),
            Engine::Postgres=>format!("SELECT s.nspname,t.relname FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace s ON s.oid=t.relnamespace WHERE t.oid=to_regclass({name}) AND t.relkind IN ('r','p')"),
        };
        let result = database::execute(c, password, &resolve).await?;
        let row = result
            .sets
            .first()
            .and_then(|s| s.rows.first())
            .ok_or("JOIN editing requires base tables, each with a primary key.")?;
        let schema = row
            .first()
            .and_then(|v| v.as_deref())
            .ok_or("Missing source schema")?;
        let table = row
            .get(1)
            .and_then(|v| v.as_deref())
            .ok_or("Missing source table")?;
        let table = format!("{}.{}", quote(schema, &c.engine), quote(table, &c.engine));
        if !seen.insert(table.clone()) {
            return Err("Self-join results are read-only.".into());
        }
        let (keys, caps) =
            table_edit::metadata(c, password, &format!("SELECT COUNT(*) FROM {table}")).await?;
        let count = keys.len();
        targets.push(Target {
            table,
            alias: source.alias,
            keys,
            caps,
            offset,
        });
        offset += count;
    }
    let result = JoinEdit {
        sql: sql.into(),
        targets,
    };
    let labels = result.labels();
    if labels.iter().collect::<HashSet<_>>().len() != labels.len() {
        return Err("Source column labels are ambiguous.".into());
    }
    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> JoinEdit {
        let keys = vec![
            ColumnKey {
                name: "id".into(),
                primary_key: true,
                foreign_key: false,
                data_type: "integer".into(),
            },
            ColumnKey {
                name: "tenant".into(),
                primary_key: true,
                foreign_key: false,
                data_type: "integer".into(),
            },
            ColumnKey {
                name: "name".into(),
                primary_key: false,
                foreign_key: false,
                data_type: "text".into(),
            },
        ];
        JoinEdit {
            sql: String::new(),
            targets: vec![
                Target {
                    table: "\"public\".\"agreements\"".into(),
                    alias: "a".into(),
                    keys: keys.clone(),
                    caps: Capabilities {
                        columns: vec!["name".into()],
                        ..Default::default()
                    },
                    offset: 0,
                },
                Target {
                    table: "\"public\".\"roles\"".into(),
                    alias: "r".into(),
                    keys,
                    caps: Capabilities {
                        columns: vec!["name".into()],
                        ..Default::default()
                    },
                    offset: 3,
                },
            ],
        }
    }
    fn row(values: &[&str]) -> Vec<Option<String>> {
        values.iter().map(|s| Some((*s).into())).collect()
    }
    fn change(index: usize, column: &str, value: &str) -> Change {
        Change {
            row_index: index,
            column: column.into(),
            value: Some(value.into()),
        }
    }
    #[test]
    fn supports_chains_and_routes_changes_from_all_sources() {
        for engine in [Engine::Postgres, Engine::Sqlserver] {
            let parsed = shape("SELECT * FROM a JOIN b ON (a.id=b.id) INNER JOIN c ON c.id=b.id JOIN d ON d.id=c.id WHERE d.name='join' ORDER BY a.id;", &engine).unwrap();
            assert_eq!(parsed.iter().map(|s| s.alias.as_str()).collect::<Vec<_>>(), vec!["a", "b", "c", "d"]);
        }
        let mut join = fixture();
        for (alias, offset) in [("c", 6), ("d", 9)] {
            join.targets.push(Target { table: format!("\"public\".\"{alias}\""), alias: alias.into(), keys: join.targets[0].keys.clone(), caps: Capabilities { columns: vec!["name".into()], ..Default::default() }, offset });
        }
        let rows = vec![(0, row(&["1","7","a","2","7","r","3","7","c","4","7","d"])), (1, row(&["1","7","a","2","7","r","3","7","c","5","7","d2"]))];
        let columns = join.original_columns();
        let changes = vec![change(0,"a.name","A"), change(0,"r.name","R"), change(0,"c.name","C"), change(1,"c.name","C"), change(1,"d.name","D")];
        let plan = join.plan(&Engine::Postgres, &columns, &rows, &changes).unwrap();
        assert_eq!(plan.len(),4);
        assert!(plan[2].sql.contains("\"public\".\"c\""));
        assert!(plan[3].sql.contains("\"public\".\"d\""));
        assert_eq!(plan[3].parameters[0], "5");
        assert_eq!(join.capabilities().row_identity_columns["d.name"], vec!["d.id", "d.tenant"]);
        assert!(join.plan(&Engine::Postgres, &columns, &rows, &[change(0,"c.name","one"),change(1,"c.name","two")]).is_err());
    }
    #[test]
    fn supports_inner_joins_aliases_filtering_sorting_and_quoted_names() {
        for sql in ["SELECT * FROM Agreement INNER JOIN AgreementPartyRole ON Agreement.AgreementId=AgreementPartyRole.AgreementId;", "SELECT * FROM [dbo].[Agreement] AS a JOIN [dbo].[Role] r ON a.id=r.id AND a.tenant=r.tenant WHERE r.name='join' ORDER BY a.id DESC;"] {
            let result=shape(sql,&Engine::Sqlserver).unwrap();assert_eq!(result.len(),2);
        }
        let result = shape(
            "SELECT * FROM \"public\".\"MixedCase\" a JOIN public.roles r ON a.id=r.id",
            &Engine::Postgres,
        )
        .unwrap();
        assert_eq!(result[0].table, "\"public\".\"MixedCase\"");
    }
    #[test]
    fn refuses_ambiguous_or_unsupported_query_shapes() {
        for sql in [
            "SELECT a.*,r.name FROM a JOIN r ON a.id=r.id",
            "SELECT DISTINCT * FROM a JOIN r ON a.id=r.id",
            "SELECT * FROM a LEFT JOIN r ON a.id=r.id",
            "SELECT * FROM a a JOIN r a ON a.id=a.id",
            "SELECT * FROM a JOIN r ON a.id=r.id LEFT JOIN third t ON t.id=a.id",
            "SELECT * FROM a JOIN r ON a.id=r.id JOIN third a ON a.id=r.id",
            "SELECT * FROM a JOIN r ON a.id=r.id JOIN third t ON EXISTS(SELECT 1)",
            "SELECT * FROM a JOIN r ON a.id=r.id JOIN third t ON t.id=a.id; DELETE FROM a",
            "SELECT * FROM a JOIN r ON a.id=r.id JOIN third t ON (t.id=a.id",
            "SELECT * FROM a JOIN r ON JOIN third t ON t.id=a.id",
            "SELECT * FROM (SELECT * FROM a) a JOIN r ON a.id=r.id",
            "SELECT * FROM a JOIN r ON a.id=r.id; DELETE FROM a",
            "SELECT * FROM db.dbo.a a JOIN r ON a.id=r.id",
            "SELECT * FROM a JOIN r ON a.id=r.id UNION SELECT * FROM a",
            "SELECT * FROM a JOIN r ON a.id=r.id GROUP BY a.id",
            "SELECT * FROM a JOIN r ON EXISTS(SELECT 1)",
            "SELECT * FROM a JOIN r ON r.name=$$x$$",
            "SELECT * FROM a JOIN r ON r.name=E'back\\slash'",
        ] {
            assert!(shape(sql, &Engine::Sqlserver).is_none(), "{sql}");
        }
    }
    #[test]
    fn maps_duplicate_labels_and_source_primary_keys_by_ordinal() {
        let join = fixture();
        let mut set = ResultSet {
            columns: join.original_columns(),
            ..Default::default()
        };
        join.decorate(&mut set);
        assert!(set.join_editable);
        assert_eq!(
            set.columns,
            vec!["a.id", "a.tenant", "a.name", "r.id", "r.tenant", "r.name"]
        );
        let caps = join.capabilities();
        assert!(caps.insert_columns.is_empty());
        assert_eq!(
            caps.row_identity_columns["r.name"],
            vec!["r.id", "r.tenant"]
        );
        assert!(!caps.columns.contains(&"a.id".into()));
        let mut bad = ResultSet {
            columns: vec!["name".into()],
            ..Default::default()
        };
        join.decorate(&mut bad);
        assert!(!bad.join_editable);
        assert!(bad.edit_reason.is_some());
    }
    #[test]
    fn routes_both_tables_and_deduplicates_repeated_source_rows() {
        let join = fixture();
        let rows = vec![
            (500, row(&["1", "7", "old", "11", "7", "role1"])),
            (501, row(&["1", "7", "old", "12", "7", "role2"])),
        ];
        let changes = vec![
            change(500, "a.name", "new"),
            change(501, "a.name", "new"),
            change(501, "r.name", "'; DROP TABLE x; --"),
        ];
        let plan = join
            .plan(&Engine::Postgres, &join.original_columns(), &rows, &changes)
            .unwrap();
        assert_eq!(plan.len(), 2);
        assert!(plan[0].sql.starts_with("UPDATE \"public\".\"agreements\""));
        assert!(plan[1].sql.starts_with("UPDATE \"public\".\"roles\""));
        assert!(!plan[1].sql.contains("DROP"));
        assert_eq!(plan[0].parameters, vec!["1", "7", "old", "new"]);
        assert_eq!(plan[1].parameters[0], "12");
        assert!(plan[0].sql.contains("\"tenant\" ="));
        assert!(plan[0].sql.contains("AND \"name\" ="));
    }
    #[test]
    fn rejects_conflicting_edits_null_keys_and_unknown_columns() {
        let join = fixture();
        let rows = vec![
            (0, row(&["1", "7", "old", "11", "7", "role1"])),
            (1, row(&["1", "7", "old", "12", "7", "role2"])),
        ];
        let cols = join.original_columns();
        assert!(join
            .plan(
                &Engine::Postgres,
                &cols,
                &rows,
                &[change(0, "a.name", "one"), change(1, "a.name", "two")]
            )
            .unwrap_err()
            .contains("Conflicting"));
        assert!(join
            .plan(&Engine::Postgres, &cols, &rows, &[change(0, "a.id", "99")])
            .is_err());
        assert!(join
            .plan(&Engine::Postgres, &cols, &rows, &[change(0, "name", "99")])
            .is_err());
        assert!(join
            .plan(
                &Engine::Postgres,
                &cols,
                &rows,
                &[change(9, "a.name", "99")]
            )
            .is_err());
        let mut rows = rows;
        rows[0].1[0] = None;
        assert!(join
            .plan(
                &Engine::Postgres,
                &cols,
                &rows,
                &[change(0, "a.name", "99")]
            )
            .is_err());
    }

    #[tokio::test]
    #[ignore = "Requires disposable containers; scripts/validate-join-edits.ps1"]
    async fn live_join_transactions() {
        assert_eq!(
            std::env::var("DATAGOBLIN_JOIN_ISOLATED").as_deref(),
            Ok("yes")
        );
        for engine in [Engine::Postgres, Engine::Sqlserver] {
            let pg = matches!(engine, Engine::Postgres);
            let port = std::env::var(if pg {
                "DATAGOBLIN_JOIN_PG_PORT"
            } else {
                "DATAGOBLIN_JOIN_SQL_PORT"
            })
            .unwrap()
            .parse()
            .unwrap();
            let c = Connection {
                id: "join-test".into(),
                name: "Disposable JOIN test".into(),
                engine,
                host: "127.0.0.1".into(),
                port,
                database: if pg { "datagoblin_join" } else { "master" }.into(),
                username: if pg { "postgres" } else { "sa" }.into(),
                tls: false,
                trust_certificate: true,
            };
            let password = "GoblinJoin_TestOnly2026";
            let mut ready = false;
            for _ in 0..45 {
                if database::execute(&c, password, "SELECT 1").await.is_ok() {
                    ready = true;
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
            assert!(ready, "Disposable database did not start");
            let prefix = if pg { "public" } else { "dbo" };
            let text = if pg { "text" } else { "nvarchar(100)" };
            let a = format!("{prefix}.dg_join_agreement");
            let r = format!("{prefix}.dg_join_role");
            let hidden = if pg { "" } else { ", SysStartTime datetime2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL DEFAULT SYSUTCDATETIME(), SysEndTime datetime2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL DEFAULT CONVERT(datetime2,'9999-12-31 23:59:59.9999999'), PERIOD FOR SYSTEM_TIME (SysStartTime,SysEndTime)" };
            database::execute(&c,password,&format!("CREATE TABLE {a} (id int,tenant int,name {text}{hidden},PRIMARY KEY(id,tenant)); CREATE TABLE {r} (id int PRIMARY KEY,agreement_id int,tenant int,name {text},amount int CHECK(amount>=0), FOREIGN KEY(agreement_id,tenant) REFERENCES {a}(id,tenant)); INSERT INTO {a} (id,tenant,name) VALUES (1,7,'old'); INSERT INTO {r} VALUES (11,1,7,'role1',10),(12,1,7,'role2',20);")).await.unwrap();
            let sql=format!("SELECT * FROM {a} a INNER JOIN {r} r ON a.id=r.agreement_id AND a.tenant=r.tenant ORDER BY r.id");
            let join = prepare(&c, password, &sql).await.unwrap().unwrap();
            let result = database::execute(&c, password, &sql).await.unwrap();
            let set = &result.sets[0];
            let rows: Vec<_> = set.rows.iter().cloned().enumerate().collect();
            assert_eq!(rows.len(), 2);
            if !pg {
                let old_catalog = crate::column_keys::query(&format!("SELECT COUNT(*) FROM {a}"), &c.engine).unwrap().replace("AND c.is_hidden=0 ", "");
                let old_metadata = database::execute(&c,password,&old_catalog).await.unwrap();
                assert_eq!(old_metadata.sets[0].rows.len(),5,"Fixture must expose two hidden catalog columns");
                assert_eq!(join.targets[0].keys.len(),3,"SELECT * must map only visible columns");
                assert!(!join.capabilities().columns.iter().any(|name|name.contains("SysStartTime")||name.contains("SysEndTime")));
            }
            join.validate(&set.columns).unwrap();
            let changes = vec![
                change(0, "a.name", "new"),
                change(1, "a.name", "new"),
                change(1, "r.name", "updated"),
            ];
            let plan = join.plan(&c.engine, &set.columns, &rows, &changes).unwrap();
            assert_eq!(plan.len(), 2);
            table_edit::apply(&c, password, &plan).await.unwrap();
            let current = database::execute(&c, password, &sql).await.unwrap();
            let set = &current.sets[0];
            let rows: Vec<_> = set.rows.iter().cloned().enumerate().collect();
            assert_eq!(rows[0].1[2].as_deref(), Some("new"));
            assert_eq!(rows[1].1[2].as_deref(), Some("new"));
            assert_eq!(rows[1].1[6].as_deref(), Some("updated"));
            // A failing second-table write must roll back the first-table write.
            let plan = join
                .plan(
                    &c.engine,
                    &set.columns,
                    &rows,
                    &[
                        change(0, "a.name", "must roll back"),
                        change(1, "r.amount", "-1"),
                    ],
                )
                .unwrap();
            assert!(table_edit::apply(&c, password, &plan).await.is_err());
            let check = database::execute(&c, password, &format!("SELECT name FROM {a}"))
                .await
                .unwrap();
            assert_eq!(check.sets[0].rows[0][0].as_deref(), Some("new"));
            // A concurrent update also rolls back all tables in the submission.
            database::execute(
                &c,
                password,
                &format!("UPDATE {r} SET name='concurrent' WHERE id=12"),
            )
            .await
            .unwrap();
            let plan = join
                .plan(
                    &c.engine,
                    &set.columns,
                    &rows,
                    &[
                        change(0, "a.name", "must roll back"),
                        change(1, "r.name", "overwrite"),
                    ],
                )
                .unwrap();
            assert!(table_edit::apply(&c, password, &plan).await.is_err());
            let check = database::execute(&c, password, &format!("SELECT name FROM {a}"))
                .await
                .unwrap();
            assert_eq!(check.sets[0].rows[0][0].as_deref(), Some("new"));
            // Three-table updates commit together, and a failure in the final
            // source rolls back the earlier two source updates as well.
            let third = format!("{prefix}.dg_join_detail");
            database::execute(&c, password, &format!("CREATE TABLE {third} (id int PRIMARY KEY,role_id int,amount int CHECK(amount>=0),FOREIGN KEY(role_id) REFERENCES {r}(id)); INSERT INTO {third} VALUES (21,11,1),(22,12,2);")).await.unwrap();
            let sql3 = format!("SELECT * FROM {a} a JOIN {r} r ON a.id=r.agreement_id AND a.tenant=r.tenant INNER JOIN {third} d ON d.role_id=r.id ORDER BY d.id");
            let join3 = prepare(&c,password,&sql3).await.unwrap().unwrap();
            assert_eq!(join3.targets.len(),3);
            let before = database::execute(&c,password,&sql3).await.unwrap();
            let rows3: Vec<_> = before.sets[0].rows.iter().cloned().enumerate().collect();
            let plan3 = join3.plan(&c.engine,&before.sets[0].columns,&rows3,&[change(0,"a.name","three"),change(1,"a.name","three"),change(0,"r.name","three-role"),change(0,"d.amount","3")]).unwrap();
            assert_eq!(plan3.len(),3);
            table_edit::apply(&c,password,&plan3).await.unwrap();
            let committed = database::execute(&c,password,&sql3).await.unwrap();
            assert_eq!(committed.sets[0].rows[0][2].as_deref(),Some("three"));
            assert_eq!(committed.sets[0].rows[0][6].as_deref(),Some("three-role"));
            assert_eq!(committed.sets[0].rows[0].last().unwrap().as_deref(),Some("3"));
            let rows3: Vec<_> = committed.sets[0].rows.iter().cloned().enumerate().collect();
            let failure = join3.plan(&c.engine,&committed.sets[0].columns,&rows3,&[change(0,"a.name","rollback"),change(0,"r.name","rollback"),change(0,"d.amount","-1")]).unwrap();
            assert!(table_edit::apply(&c,password,&failure).await.is_err());
            let after = database::execute(&c,password,&sql3).await.unwrap();
            assert_eq!(after.sets[0].rows,committed.sets[0].rows);
            database::execute(&c,password,&format!("DROP TABLE {third}")).await.unwrap();
            // A self-join is not made editable even under different aliases.
            assert!(prepare(
                &c,
                password,
                &format!("SELECT * FROM {a} a JOIN {a} b ON a.id=b.id")
            )
            .await
            .is_err());
            database::execute(&c, password, &format!("DROP TABLE {r}; DROP TABLE {a};"))
                .await
                .unwrap();
        }
    }
}
