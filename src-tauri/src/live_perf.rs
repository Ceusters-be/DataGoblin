use crate::{
    column_keys,
    database::{self, Connection, Engine},
    result_session, table_browser,
};
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
const PASSWORD: &str = "GoblinPerf_2026_TestOnly";
struct Report {
    engine: String,
    values: Vec<Value>,
}
impl Report {
    fn record(&mut self, name: &str, start: Instant, details: Value) {
        let value = json!({"check":name,"elapsedMs":start.elapsed().as_secs_f64()*1000.0,"details":details});
        println!("{} {}", self.engine, value);
        self.values.push(value);
        if let Ok(dir) = std::env::var("DATAGOBLIN_PERF_REPORT_DIR") {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                std::path::Path::new(&dir).join(format!("{}.json", self.engine)),
                serde_json::to_vec_pretty(
                    &json!({"engine":self.engine,"fixtureRows":1000000,"checks":self.values}),
                )
                .unwrap(),
            )
            .unwrap();
        }
    }
}
fn stream(c: &Connection, sql: String) -> result_session::Session {
    let c = c.clone();
    result_session::start(move |events| database::stream(c, PASSWORD.into(), sql, events)).unwrap()
}
async fn scalar(c: &Connection, sql: &str) -> Result<u64, String> {
    let r = database::execute(c, PASSWORD, sql).await?;
    r.sets
        .iter()
        .flat_map(|s| &s.rows)
        .find_map(|r| r.first().and_then(|s| s.as_deref()))
        .ok_or("No scalar")?
        .parse::<u64>()
        .map_err(|e| e.to_string())
}
async fn run(engine: Engine) -> Result<(), String> {
    if std::env::var("DATAGOBLIN_PERF_ISOLATED").as_deref() != Ok("yes") {
        return Err("Only run against the disposable performance containers.".into());
    }
    let pg = matches!(engine, Engine::Postgres);
    let label = if pg { "postgres" } else { "sqlserver" };
    let port = std::env::var(if pg {
        "DATAGOBLIN_PERF_PG_PORT"
    } else {
        "DATAGOBLIN_PERF_SQL_PORT"
    })
    .map_err(|e| e.to_string())?
    .parse::<u16>()
    .map_err(|e| e.to_string())?;
    let mut c = Connection {
        id: "performance-test".into(),
        name: "Disposable performance database".into(),
        engine,
        host: "127.0.0.1".into(),
        port,
        database: if pg { "datagoblin_perf" } else { "master" }.into(),
        username: if pg { "postgres" } else { "sa" }.into(),
        tls: false,
        trust_certificate: true,
    };
    let mut report = Report {
        engine: label.into(),
        values: vec![],
    };
    let start = Instant::now();
    for attempt in 0..60 {
        if database::execute(&c, PASSWORD, "SELECT 1").await.is_ok() {
            break;
        }
        if attempt == 59 {
            return Err("Database did not become ready".into());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    report.record("connect_ready", start, json!({"port":port}));
    if !pg {
        database::execute(&c, PASSWORD, "CREATE DATABASE datagoblin_perf").await?;
        c.database = "datagoblin_perf".into();
    }
    let version = database::execute(
        &c,
        PASSWORD,
        if pg {
            "SELECT version()"
        } else {
            "SELECT @@VERSION"
        },
    )
    .await?;
    report.record("server_version", Instant::now(), json!(version.sets));
    let start = Instant::now();
    let fixture = if pg {
        "CREATE TABLE perf_rows(id integer PRIMARY KEY,bucket integer NOT NULL,payload varchar(256) NOT NULL,optional_value integer); INSERT INTO perf_rows SELECT i,i%100,repeat('x',192),CASE WHEN i%10=0 THEN NULL ELSE i END FROM generate_series(1,1000000) i; CREATE INDEX perf_bucket ON perf_rows(bucket,id); ANALYZE perf_rows;"
    } else {
        "CREATE TABLE dbo.perf_rows(id int NOT NULL PRIMARY KEY,bucket int NOT NULL,payload varchar(256) NOT NULL,optional_value int NULL); WITH d(n) AS (SELECT n FROM (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) v(n)), numbers AS (SELECT 1+a.n+10*b.n+100*c.n+1000*d.n+10000*e.n+100000*f.n AS i FROM d a CROSS JOIN d b CROSS JOIN d c CROSS JOIN d d CROSS JOIN d e CROSS JOIN d f) INSERT dbo.perf_rows SELECT i,i%100,REPLICATE('x',192),CASE WHEN i%10=0 THEN NULL ELSE i END FROM numbers; CREATE INDEX perf_bucket ON dbo.perf_rows(bucket,id); UPDATE STATISTICS dbo.perf_rows;"
    };
    database::execute(&c, PASSWORD, fixture).await?;
    report.record(
        "fixture_create",
        start,
        json!({"rows":1000000,"payloadBytesPerRow":192}),
    );
    let table = if pg {
        "public.perf_rows"
    } else {
        "dbo.perf_rows"
    };
    let ordered = format!("SELECT * FROM {table} ORDER BY id");
    for iteration in 0..3 {
        let session = stream(&c, ordered.clone());
        let start = Instant::now();
        let first = session.first_page(500).await?;
        assert_eq!(first.rows.len(), 500);
        assert_eq!(first.total_rows, 501);
        assert_eq!(first.rows[0][0].as_deref(), Some("1"));
        assert!(first.has_more);
        report.record(
            "first_page_500",
            start,
            json!({"iteration":iteration,"cachedRows":first.total_rows}),
        );
        let start = Instant::now();
        let next = session.page(0, 500, 500).await?;
        assert_eq!(next.rows[0][0].as_deref(), Some("501"));
        assert_eq!(next.total_rows, 1001);
        report.record(
            "next_page_500",
            start,
            json!({"iteration":iteration,"cachedRows":next.total_rows}),
        );
        let start = Instant::now();
        let previous = session.page(0, 0, 500).await?;
        assert_eq!(previous.rows, first.rows);
        report.record(
            "cached_previous_page",
            start,
            json!({"iteration":iteration}),
        );
        let start = Instant::now();
        let count = scalar(&c, &format!("SELECT COUNT(*) FROM {table}")).await?;
        assert_eq!(count, 1000000);
        let after = session.page(0, 0, 500).await?;
        assert_eq!(after.total_rows, 1001);
        report.record(
            "separate_count",
            start,
            json!({"count":count,"cachedRowsAfterCount":after.total_rows}),
        );
        if iteration == 0 {
            let start = Instant::now();
            let far = session.page(0, 100000, 500).await?;
            assert_eq!(far.rows[0][0].as_deref(), Some("100001"));
            assert_eq!(far.total_rows, 100501);
            report.record(
                "forward_to_row_100001",
                start,
                json!({"cachedRows":far.total_rows}),
            );
        }
        session.cancel();
    }
    let base_sql = format!("SELECT * FROM {table}");
    let base = table_browser::initial(&base_sql, &c.engine).unwrap();
    let count = crate::count_query::table_count(&base_sql, &c.engine).unwrap();
    let keys = column_keys::load(&c, PASSWORD, &count).await?;
    let filters = vec![table_browser::Filter {
        column: "bucket".into(),
        operator: "equals".into(),
        value: "7".into(),
        values: vec![],
    }];
    let plan = table_browser::build(
        &base,
        filters,
        Some(table_browser::Sort {
            column: "id".into(),
            descending: true,
        }),
        &keys,
        &c.engine,
    )?;
    let start = Instant::now();
    let cc = c.clone();
    let sql = plan.browser.sql.clone();
    let params = plan.browser.parameters.clone();
    let session = result_session::start(move |events| {
        database::stream_params(cc, PASSWORD.into(), sql, params, events)
    })?;
    let page = session.first_page(500).await?;
    assert_eq!(page.rows[0][0].as_deref(), Some("999907"));
    assert!(page.rows.iter().all(|row| row[1].as_deref() == Some("7")));
    report.record(
        "filtered_sorted_first_page",
        start,
        json!({"cachedRows":page.total_rows}),
    );
    let start = Instant::now();
    let count =
        database::execute_params(&c, PASSWORD, &plan.count, &plan.browser.parameters).await?;
    assert_eq!(count.sets[0].rows[0][0].as_deref(), Some("10000"));
    report.record("filtered_count", start, json!({"count":10000}));
    let start = Instant::now();
    let (sql, params) = table_browser::choices(&plan.browser, "bucket", "7", &keys, &c.engine)?;
    let choices = database::execute_params(&c, PASSWORD, &sql, &params).await?;
    assert_eq!(choices.sets[0].rows.len(), 19);
    assert!(choices.sets[0]
        .rows
        .iter()
        .all(|r| r[1].as_deref() == Some("10000")));
    report.record("distinct_values_search", start, json!({"values":19}));
    let start = Instant::now();
    let all = session.page(0, 0, 0).await?;
    assert_eq!(all.rows.len(), 10000);
    assert!(!all.has_more);
    assert_eq!(all.rows.last().unwrap()[0].as_deref(), Some("7"));
    report.record("all_filtered_10000", start, json!({"rows":all.rows.len()}));
    session.cancel();
    let start = Instant::now();
    let null_plan = table_browser::build(
        &base,
        vec![table_browser::Filter {
            column: "optional_value".into(),
            operator: "isNull".into(),
            value: String::new(),
            values: vec![],
        }],
        None,
        &keys,
        &c.engine,
    )?;
    let null_count = database::execute_params(
        &c,
        PASSWORD,
        &null_plan.count,
        &null_plan.browser.parameters,
    )
    .await?;
    assert_eq!(null_count.sets[0].rows[0][0].as_deref(), Some("100000"));
    let escaped_plan = table_browser::build(
        &base,
        vec![table_browser::Filter {
            column: "payload".into(),
            operator: "contains".into(),
            value: "%_' OR 1=1 --".into(),
            values: vec![],
        }],
        None,
        &keys,
        &c.engine,
    )?;
    let escaped_count = database::execute_params(
        &c,
        PASSWORD,
        &escaped_plan.count,
        &escaped_plan.browser.parameters,
    )
    .await?;
    assert_eq!(escaped_count.sets[0].rows[0][0].as_deref(), Some("0"));
    report.record(
        "null_and_escaped_filters",
        start,
        json!({"nullRows":100000,"literalSearchRows":0}),
    );
    // Confirm cancellation on the server, not merely a closed UI request.
    let slow = if pg {
        "SELECT pg_sleep(30) /* datagoblin_perf_cancel_probe */"
    } else {
        "WAITFOR DELAY '00:00:30'; SELECT 1 /* datagoblin_perf_cancel_probe */"
    };
    let monitor = if pg {
        "SELECT COUNT(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query LIKE '%datagoblin_perf_cancel_probe%'"
    } else {
        "SELECT COUNT(*) FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t WHERE r.session_id<>@@SPID AND t.text LIKE '%datagoblin_perf_cancel_probe%'"
    };
    let session = Arc::new(stream(&c, slow.into()));
    let pending = session.clone();
    let pending = tokio::spawn(async move { pending.first_page(500).await });
    let deadline = Instant::now() + Duration::from_secs(10);
    while scalar(&c, monitor).await? == 0 {
        if Instant::now() > deadline {
            return Err("Slow query was not observed on server".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let start = Instant::now();
    session.cancel();
    assert!(tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?
        .is_err());
    while scalar(&c, monitor).await? != 0 {
        if start.elapsed() > Duration::from_secs(5) {
            return Err("Cancelled query still running on server after 5 seconds".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    report.record(
        "cancel_server_confirmed",
        start,
        json!({"remainingRequests":0}),
    );
    // Wide All requests must stop at the cache budget, rather than exhaust memory.
    let session = stream(&c, ordered);
    let start = Instant::now();
    let all = session.page(0, 0, 0).await?;
    assert!(all.result.truncated);
    assert!(all.rows.len() < 1000000);
    report.record(
        "all_cache_budget",
        start,
        json!({"rows":all.rows.len(),"truncated":all.result.truncated}),
    );
    session.cancel();
    Ok(())
}
#[tokio::test]
#[ignore = "Requires disposable databases; use scripts/validate-performance.ps1"]
async fn postgres() {
    tokio::time::timeout(Duration::from_secs(300), run(Engine::Postgres))
        .await
        .unwrap()
        .unwrap();
}
#[tokio::test]
#[ignore = "Requires disposable databases; use scripts/validate-performance.ps1"]
async fn sqlserver() {
    tokio::time::timeout(Duration::from_secs(300), run(Engine::Sqlserver))
        .await
        .unwrap()
        .unwrap();
}
