use crate::database::Engine;

// Deliberately accept a single plain table SELECT. Never execute the original SQL
// again or guess at batch/CTE/join semantics to implement the count button.
pub fn table_count(sql: &str, engine: &Engine) -> Option<String> {
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
    if let Some(rest) = input.strip_prefix(';') {
        input = rest.trim();
    }
    if !input.is_empty() {
        return None;
    }
    let count = if matches!(engine, Engine::Sqlserver) {
        "COUNT_BIG(*)"
    } else {
        "COUNT(*)"
    };
    Some(format!(
        "SELECT {count} AS total_rows FROM {}",
        parts.join(".")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
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
            "select * from jobs where active = 1",
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
