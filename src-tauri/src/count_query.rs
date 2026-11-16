use crate::database::Engine;

// Accept one table SELECT with an optional scalar WHERE predicate. Keep the
// physical table separate from filtered counts and refresh SQL; reject batches,
// nested queries and other query shapes whose lineage is not established here.
pub struct TableQuery {
    pub base_count: String,
    pub count: String,
    pub source: Option<String>,
}
pub fn table_count(sql: &str, engine: &Engine) -> Option<String> {
    Some(table_query(sql, engine)?.count)
}
pub fn table_query(sql: &str, engine: &Engine) -> Option<TableQuery> {
    let mut input = sql.trim();
    fn keyword<'a>(input: &mut &'a str, word: &str) -> Option<()> {
        let prefix = input.get(..word.len())?;
        if !prefix.eq_ignore_ascii_case(word) {
            return None;
        }
        let rest = &input[word.len()..];
        if rest.starts_with(|c: char| c.is_alphanumeric() || c == '_') {
            return None;
        }
        *input = rest.trim_start();
        Some(())
    }
    keyword(&mut input, "select")?;
    input = input.strip_prefix('*')?.trim_start();
    keyword(&mut input, "from")?;
    let mut parts = Vec::new();
    loop {
        let mut name = String::new();
        let first = input.chars().next()?;
        if first == '"' || first == '[' && matches!(engine, Engine::Sqlserver) {
            let close = if first == '[' { ']' } else { '"' };
            input = &input[first.len_utf8()..];
            loop {
                let ch = input.chars().next()?;
                input = &input[ch.len_utf8()..];
                if ch == close {
                    if input.starts_with(close) {
                        input = &input[close.len_utf8()..];
                        name.push(close);
                    } else {
                        break;
                    }
                } else {
                    name.push(ch);
                }
            }
        } else {
            if !(first.is_alphabetic() || first == '_') {
                return None;
            }
            let length = input
                .char_indices()
                .take_while(|(_, ch)| ch.is_alphanumeric() || *ch == '_' || *ch == '$')
                .map(|(offset, ch)| offset + ch.len_utf8())
                .last()?;
            name = input[..length].to_owned();
            input = &input[length..];
            if matches!(engine, Engine::Postgres) {
                name = name.to_ascii_lowercase();
            }
        }
        if name.is_empty() {
            return None;
        }
        parts.push(match engine {
            Engine::Sqlserver => format!("[{}]", name.replace(']', "]]")),
            Engine::Postgres => format!("\"{}\"", name.replace('"', "\"\"")),
        });
        input = input.trim_start();
        if let Some(rest) = input.strip_prefix('.') {
            input = rest.trim_start();
        } else {
            break;
        }
    }
    if parts.len()
        > if matches!(engine, Engine::Sqlserver) {
            4
        } else {
            2
        }
    {
        return None;
    }
    let predicate = if input.get(..5).is_some_and(|prefix| prefix.eq_ignore_ascii_case("where"))
        && !input[5..].starts_with(|c: char| c.is_alphanumeric() || c == '_') {
        input = input[5..].trim();
        let value = input.strip_suffix(';').unwrap_or(input).trim();
        if !crate::join_edit::scalar_predicate(value) { return None; }
        Some(value)
    } else {
        if let Some(rest) = input.strip_prefix(';') { input = rest.trim(); }
        if !input.is_empty() { return None; }
        None
    };
    let count = if matches!(engine, Engine::Sqlserver) {
        "COUNT_BIG(*)"
    } else {
        "COUNT(*)"
    };
    let base_count = format!("SELECT {count} AS total_rows FROM {}", parts.join("."));
    Some(TableQuery {
        count: match predicate { Some(p) => format!("{base_count} WHERE {p}\n"), None => base_count.clone() },
        source: predicate.map(|p| format!("SELECT * FROM {} WHERE {p}\n", parts.join("."))),
        base_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filtered_table_keeps_count_separate_from_edit_metadata() {
        let sql = "select * from Invoice\n  where InvoiceNumber = 'V.DOCKS.6 26000485';";
        let parsed = table_query(sql, &Engine::Sqlserver).unwrap();
        assert_eq!(parsed.base_count, "SELECT COUNT_BIG(*) AS total_rows FROM [Invoice]");
        assert!(parsed.count.contains("WHERE InvoiceNumber = 'V.DOCKS.6 26000485'"));
        assert!(parsed.source.unwrap().contains("FROM [Invoice] WHERE InvoiceNumber"));
        for engine in [Engine::Postgres, Engine::Sqlserver] {
            assert!(table_query("select * from jobs where (active = 1 OR name = 'a; DROP TABLE x') AND id IN (1,2);", &engine).is_some());
            for invalid in [
                "select * from jobs where id=1; delete from jobs",
                "select * from jobs where id IN (select id from other)",
                "select * from jobs where id=1 UNION SELECT * FROM other",
                "select * from jobs where id=1 ORDER BY id",
                "select * from jobs where (id=1",
                "select * from jobs where id=1) OR (id=2",
                "select * from jobs where id=@value",
                "select * from jobs where name='unterminated",
            ] { assert!(table_query(invalid, &engine).is_none(), "{invalid}"); }
        }
    }
    #[test]
    fn builds_scalar_counts_for_both_engines() {
        assert_eq!(
            table_count("select *\nfrom JobExecution;", &Engine::Sqlserver).unwrap(),
            "SELECT COUNT_BIG(*) AS total_rows FROM [JobExecution]"
        );
        assert_eq!(
            table_count("SELECT * FROM [dbo].[Jobs]]Archive] ;", &Engine::Sqlserver).unwrap(),
            "SELECT COUNT_BIG(*) AS total_rows FROM [dbo].[Jobs]]Archive]"
        );
        assert_eq!(
            table_count("select * from public.Jobs", &Engine::Postgres).unwrap(),
            "SELECT COUNT(*) AS total_rows FROM \"public\".\"jobs\""
        );
        assert_eq!(
            table_count("select * from \"JobExecution\"", &Engine::Postgres).unwrap(),
            "SELECT COUNT(*) AS total_rows FROM \"JobExecution\""
        );
    }
    #[test]
    fn does_not_guess_at_other_query_shapes() {
        for sql in [
            "select * from jobs; delete from jobs",
            "select * from jobs where active = 1 UNION SELECT * FROM other",
            "select distinct * from jobs",
            "select * from jobs join other on 1=1",
            "select * from #temp",
            "select * from jobs()",
            "select * into copy from jobs",
            "select * from [unclosed",
        ] {
            assert!(table_count(sql, &Engine::Sqlserver).is_none(), "{sql}");
        }
    }
}
