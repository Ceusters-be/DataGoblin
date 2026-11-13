use crate::{column_keys::ColumnKey, database::Engine};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub column: String,
    pub operator: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub values: Vec<Option<String>>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Sort {
    pub column: String,
    pub descending: bool,
}
#[derive(Clone, Serialize)]
pub struct Browser {
    pub table: String,
    pub filters: Vec<Filter>,
    pub sort: Option<Sort>,
    pub sql: String,
    pub parameters: Vec<String>,
}
pub struct Plan {
    pub browser: Browser,
    pub count: String,
}
pub fn initial(sql: &str, engine: &Engine) -> Option<Browser> {
    let count = crate::count_query::table_count(sql, engine)?;
    crate::column_keys::query(&count, engine)?;
    Some(Browser {
        table: count.split_once(" FROM ")?.1.into(),
        filters: vec![],
        sort: None,
        sql: sql.into(),
        parameters: vec![],
    })
}
fn quote(s: &str, e: &Engine) -> String {
    match e {
        Engine::Postgres => format!("\"{}\"", s.replace('"', "\"\"")),
        Engine::Sqlserver => format!("[{}]", s.replace(']', "]]")),
    }
}
fn text_column(s: &str, e: &Engine) -> String {
    format!(
        "CAST({} AS {})",
        quote(s, e),
        if matches!(e, Engine::Postgres) {
            "text"
        } else {
            "nvarchar(max)"
        }
    )
}
fn display_column(key: &ColumnKey, e: &Engine) -> String {
    if matches!(e, Engine::Sqlserver)
        && matches!(
            key.data_type.as_str(),
            "date" | "time" | "datetime" | "datetime2" | "datetimeoffset" | "smalldatetime"
        )
    {
        format!("CONVERT(nvarchar(max), {}, 126)", quote(&key.name, e))
    } else {
        text_column(&key.name, e)
    }
}
fn bind(value: String, params: &mut Vec<String>, e: &Engine) -> String {
    params.push(value);
    match e {
        Engine::Postgres => format!("CAST(${} AS text)", params.len()),
        Engine::Sqlserver => format!("@P{}", params.len()),
    }
}
fn escape(s: &str) -> String {
    s.replace('~', "~~")
        .replace('%', "~%")
        .replace('_', "~_")
        .replace('[', "~[")
}
fn predicates(
    filters: &[Filter],
    keys: &[ColumnKey],
    e: &Engine,
    params: &mut Vec<String>,
) -> Result<String, String> {
    if filters.len() > 64 {
        return Err("Too many filters.".into());
    }
    let mut clauses = vec![];
    for f in filters {
        if f.values.len() > 1000 {
            return Err("Select at most 1,000 filter values.".into());
        }
        let key = keys
            .iter()
            .find(|k| k.name == f.column)
            .ok_or("Unknown filter column")?;
        let col = quote(&key.name, e);
        let mut operand = |v: String| {
            let p = bind(v, params, e);
            if matches!(e, Engine::Postgres) {
                format!("CAST({p} AS {})", key.data_type)
            } else {
                p
            }
        };
        let clause = match f.operator.as_str() {
            "isNull" => format!("{col} IS NULL"),
            "notNull" => format!("{col} IS NOT NULL"),
            "in" => {
                let mut parts = vec![];
                for v in &f.values {
                    parts.push(match v {
                        Some(v) => format!("{col} = {}", operand(v.clone())),
                        None => format!("{col} IS NULL"),
                    });
                }
                if parts.is_empty() {
                    "1=0".into()
                } else {
                    format!("({})", parts.join(" OR "))
                }
            }
            "equals" | "notEquals" | "greater" | "less" => format!(
                "{col} {} {}",
                match f.operator.as_str() {
                    "equals" => "=",
                    "notEquals" => "<>",
                    "greater" => ">",
                    _ => "<",
                },
                operand(f.value.clone())
            ),
            "isEmpty" => format!(
                "{} = {}",
                display_column(key, e),
                bind("".into(), params, e)
            ),
            "contains" | "startsWith" | "endsWith" => {
                let v = escape(&f.value);
                let pattern = match f.operator.as_str() {
                    "contains" => format!("%{v}%"),
                    "startsWith" => format!("{v}%"),
                    _ => format!("%{v}"),
                };
                format!(
                    "LOWER({}) LIKE LOWER({}) ESCAPE '~'",
                    display_column(key, e),
                    bind(pattern, params, e)
                )
            }
            _ => return Err("Unsupported filter operator".into()),
        };
        clauses.push(clause);
        if params.len() > 1000 {
            return Err("Select at most 1,000 filter values.".into());
        }
    }
    Ok(if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    })
}
pub fn build(
    base: &Browser,
    filters: Vec<Filter>,
    sort: Option<Sort>,
    keys: &[ColumnKey],
    e: &Engine,
) -> Result<Plan, String> {
    if keys.is_empty() {
        return Err("Table metadata is unavailable.".into());
    }
    let mut parameters = vec![];
    let condition = predicates(&filters, keys, e, &mut parameters)?;
    let mut order = vec![];
    if let Some(s) = &sort {
        if !keys.iter().any(|k| k.name == s.column) {
            return Err("Unknown sort column".into());
        }
        order.push(format!(
            "_dg.{} {}",
            quote(&s.column, e),
            if s.descending { "DESC" } else { "ASC" }
        ));
    }
    for k in keys
        .iter()
        .filter(|k| k.primary_key && sort.as_ref().map(|s| s.column != k.name).unwrap_or(true))
    {
        order.push(format!("_dg.{} ASC", quote(&k.name, e)));
    }
    let order = if order.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", order.join(", "))
    };
    let projection = if matches!(e, Engine::Postgres) {
        keys.iter()
            .map(|k| format!("{} AS {}", text_column(&k.name, e), quote(&k.name, e)))
            .collect::<Vec<_>>()
            .join(", ")
    } else {
        "*".into()
    };
    let count = format!(
        "SELECT {} AS total_rows FROM {}{condition}",
        if matches!(e, Engine::Postgres) {
            "CAST(COUNT(*) AS text)"
        } else {
            "COUNT_BIG(*)"
        },
        base.table
    );
    Ok(Plan {
        browser: Browser {
            table: base.table.clone(),
            sql: format!(
                "SELECT {projection} FROM {} AS _dg{condition}{order}",
                base.table
            ),
            filters,
            sort,
            parameters,
        },
        count,
    })
}
pub fn choices(
    base: &Browser,
    column: &str,
    search: &str,
    keys: &[ColumnKey],
    e: &Engine,
) -> Result<(String, Vec<String>), String> {
    let key = keys
        .iter()
        .find(|k| k.name == column)
        .ok_or("Unknown column")?;
    let filters = base
        .filters
        .iter()
        .filter(|f| f.column != column)
        .cloned()
        .collect::<Vec<_>>();
    let mut params = vec![];
    let mut condition = predicates(&filters, keys, e, &mut params)?;
    let col = display_column(key, e);
    if !search.is_empty() {
        let p = bind(format!("%{}%", escape(search)), &mut params, e);
        condition.push_str(if condition.is_empty() {
            " WHERE "
        } else {
            " AND "
        });
        condition.push_str(&format!("LOWER({col}) LIKE LOWER({p}) ESCAPE '~'"));
    }
    let sql=match e {Engine::Postgres=>format!("SELECT {col} AS value, CAST(COUNT(*) AS text) AS count FROM {}{condition} GROUP BY {col} ORDER BY COUNT(*) DESC, {col} LIMIT 101",base.table),Engine::Sqlserver=>format!("SELECT TOP (101) {col} AS value, COUNT_BIG(*) AS count FROM {}{condition} GROUP BY {col} ORDER BY COUNT_BIG(*) DESC, {col}",base.table)};
    Ok((sql, params))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn null_choices_search_and_typed_sort() {
        for e in [Engine::Postgres, Engine::Sqlserver] {
            let base = initial("SELECT * FROM jobs", &e).unwrap();
            let keys = vec![
                ColumnKey {
                    name: "id".into(),
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
            let p = build(
                &base,
                vec![Filter {
                    column: "name".into(),
                    operator: "in".into(),
                    value: "".into(),
                    values: vec![None, Some("O'Reilly".into())],
                }],
                Some(Sort {
                    column: "name".into(),
                    descending: true,
                }),
                &keys,
                &e,
            )
            .unwrap();
            assert!(p.count.contains("IS NULL"));
            assert!(!p.count.contains("O'Reilly"));
            assert!(p.browser.sql.contains(&format!(
                "ORDER BY _dg.{} DESC, _dg.{} ASC",
                quote("name", &e),
                quote("id", &e)
            )));
            if matches!(e, Engine::Postgres) {
                assert!(p.count.contains("CAST(CAST($1 AS text) AS text)"));
            }
            let (sql, params) = choices(&p.browser, "name", "50%_", &keys, &e).unwrap();
            assert_eq!(params, vec!["%50~%~_%"]);
            assert!(!sql.contains("IS NULL")); // Excludes this column's own selection.
            assert!(sql.contains("101"));
            assert!(choices(&p.browser, "injected;--", "", &keys, &e).is_err());
        }
    }
    #[test]
    fn parameters_and_counts() {
        for e in [Engine::Postgres, Engine::Sqlserver] {
            let base = initial("SELECT * FROM jobs", &e).unwrap();
            let keys = vec![ColumnKey {
                name: "id".into(),
                primary_key: true,
                foreign_key: false,
                data_type: "integer".into(),
            }];
            let p = build(
                &base,
                vec![Filter {
                    column: "id".into(),
                    operator: "equals".into(),
                    value: "1'; DROP TABLE jobs;--".into(),
                    values: vec![],
                }],
                None,
                &keys,
                &e,
            )
            .unwrap();
            assert!(!p.browser.sql.contains("DROP"));
            assert_eq!(p.browser.parameters.len(), 1);
            assert!(p.browser.sql.contains("ORDER BY"));
            assert_eq!(
                p.count.split(" WHERE ").nth(1),
                p.browser
                    .sql
                    .split(" WHERE ")
                    .nth(1)
                    .map(|s| s.split(" ORDER BY ").next().unwrap())
            );
            assert!(build(
                &base,
                vec![],
                Some(Sort {
                    column: "bad".into(),
                    descending: false
                }),
                &keys,
                &e
            )
            .is_err());
        }
    }
}
