//! API server
//!
//! A tiny HTTP server, written using ONLY Rust's standard library (no outside
//! web frameworks), that puts your engine behind a web dashboard.
//!
//! It serves:
//!   GET  /             -> the dashboard web page (console)
//!   GET  /styles.css   -> dashboard styles
//!   GET  /app.js       -> dashboard script
//!   GET  /api/list     -> all key/value pairs, as JSON
//!   GET  /api/get?key= -> one key's value, as JSON
//!   GET  /api/stats    -> entry & SSTable counts, as JSON
//!   POST /api/put      -> save a key/value (form body: key=...&value=...)
//!   POST /api/delete   -> delete a key       (form body: key=...)
//!   POST /api/flush    -> flush the memtable to a new SSTable
//!   POST /api/compact  -> merge all SSTables into one (compaction)
//!
//! It listens only on 127.0.0.1 (your own machine), so it is not exposed to the
//! internet. Connections are served by a small pool of worker threads (Step 7),
//! so many clients are handled at the same time across all CPU cores. The engine
//! is shared behind a read/write lock: many reads run concurrently, while a write
//! briefly takes exclusive access.

use engine::Store;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, RwLock};

mod pool;
use pool::ThreadPool;

/// A store shared across all worker threads.
///
/// `Arc` lets every thread hold a handle to the same store; `RwLock` lets many
/// threads read at once (`get`, `scan`, `stats`) but gives a writer exclusive
/// access (`put`, `delete`, `flush`, `compact`).
type SharedStore = Arc<RwLock<Store>>;

/// The dashboard files are compiled straight into the program from web/dashboard/.
const DASH_HTML: &str = include_str!("../../web/dashboard/index.html");
const DASH_CSS: &str = include_str!("../../web/dashboard/styles.css");
const DASH_JS: &str = include_str!("../../web/dashboard/app.js");

fn main() -> std::io::Result<()> {
    // The engine stores its files in ./data (same place the demo used).
    let store: SharedStore = Arc::new(RwLock::new(Store::open("data")?));

    // Where to listen. Defaults to localhost-only (safe). Set NAGADB_ADDR to
    // 0.0.0.0:9000 to accept connections from other machines (e.g. on a VPS).
    let addr = std::env::var("NAGADB_ADDR").unwrap_or_else(|_| "127.0.0.1:9000".to_string());
    let listener = TcpListener::bind(&addr)?;

    // One worker per CPU core (falls back to 4 if we can't detect it).
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let pool = ThreadPool::new(workers);

    println!("============================================");
    println!("  Dashboard running!");
    println!("  Open this in your browser:  http://{addr}");
    println!("  Serving with {workers} worker threads.");
    println!("  Press Ctrl+C to stop.");
    println!("============================================");

    for conn in listener.incoming() {
        match conn {
            Ok(stream) => {
                // Each connection becomes a job for the pool. Clone the Arc so
                // the worker thread gets its own handle to the shared store.
                let store = Arc::clone(&store);
                pool.execute(move || {
                    if let Err(e) = handle(stream, &store) {
                        eprintln!("connection error: {e}");
                    }
                });
            }
            Err(e) => eprintln!("accept error: {e}"),
        }
    }
    Ok(())
}

/// Handle a single HTTP request.
fn handle(mut stream: TcpStream, store: &SharedStore) -> std::io::Result<()> {
    let (method, target, body) = read_request(&mut stream)?;

    // Split the request target into a path and a query string (?key=...).
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target.as_str(), ""),
    };

    match (method.as_str(), path) {
        ("GET", "/") => respond(
            &mut stream,
            200,
            "text/html; charset=utf-8",
            DASH_HTML.as_bytes(),
        ),

        ("GET", "/styles.css") => respond(
            &mut stream,
            200,
            "text/css; charset=utf-8",
            DASH_CSS.as_bytes(),
        ),

        ("GET", "/app.js") => respond(
            &mut stream,
            200,
            "application/javascript; charset=utf-8",
            DASH_JS.as_bytes(),
        ),

        ("GET", "/api/list") => {
            // Optional ?prefix= filters keys server-side; ?limit= caps how many
            // rows we return. Both matter once a database holds a lot of keys —
            // returning everything would be huge and would freeze the browser.
            let params = parse_form(query.as_bytes());
            let prefix = get_param(&params, "prefix").unwrap_or("");
            let limit = get_param(&params, "limit").and_then(|s| s.parse::<usize>().ok());
            let json = {
                let store = store.read().unwrap_or_else(|p| p.into_inner());
                list_json(&store, prefix, limit)?
            };
            respond(&mut stream, 200, "application/json", json.as_bytes())
        }

        ("GET", "/api/stats") => {
            let json = {
                let store = store.read().unwrap_or_else(|p| p.into_inner());
                let entries = store.len()?;
                let sstables = store.sstable_count();
                format!("{{\"entries\":{entries},\"sstables\":{sstables}}}")
            };
            respond(&mut stream, 200, "application/json", json.as_bytes())
        }

        ("GET", "/api/get") => {
            let params = parse_form(query.as_bytes());
            match get_param(&params, "key") {
                Some(k) if !k.is_empty() => {
                    let found = {
                        let store = store.read().unwrap_or_else(|p| p.into_inner());
                        store.get(k.as_bytes())?
                    };
                    let json = match found {
                        Some(v) => format!(
                            "{{\"found\":true,\"value\":\"{}\"}}",
                            json_escape(&String::from_utf8_lossy(&v))
                        ),
                        None => String::from("{\"found\":false,\"value\":null}"),
                    };
                    respond(&mut stream, 200, "application/json", json.as_bytes())
                }
                _ => respond(
                    &mut stream,
                    400,
                    "application/json",
                    b"{\"ok\":false,\"error\":\"missing key\"}",
                ),
            }
        }

        ("POST", "/api/put") => {
            let params = parse_form(&body);
            let key = get_param(&params, "key");
            let value = get_param(&params, "value");
            match (key, value) {
                (Some(k), Some(v)) if !k.is_empty() => {
                    {
                        let mut store = store.write().unwrap_or_else(|p| p.into_inner());
                        store.put(k.as_bytes(), v.as_bytes())?;
                    }
                    respond(&mut stream, 200, "application/json", b"{\"ok\":true}")
                }
                _ => respond(
                    &mut stream,
                    400,
                    "application/json",
                    b"{\"ok\":false,\"error\":\"missing key or value\"}",
                ),
            }
        }

        // Bulk insert using the engine's fast group-commit path: many key/value
        // pairs, ONE disk sync. The body is newline-separated lines, each line
        // being `<url-encoded-key>\t<url-encoded-value>`. This is the endpoint a
        // load test (e.g. inserting a million users) should use.
        ("POST", "/api/put_batch") => {
            let text = String::from_utf8_lossy(&body);
            let mut pairs: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
            for line in text.split('\n') {
                if line.is_empty() {
                    continue;
                }
                let mut it = line.splitn(2, '\t');
                let key = url_decode(it.next().unwrap_or(""));
                let value = url_decode(it.next().unwrap_or(""));
                if key.is_empty() {
                    continue;
                }
                pairs.push((key.into_bytes(), value.into_bytes()));
            }

            if pairs.is_empty() {
                respond(
                    &mut stream,
                    400,
                    "application/json",
                    b"{\"ok\":false,\"error\":\"no pairs\"}",
                )
            } else {
                let count = pairs.len();
                {
                    let mut store = store.write().unwrap_or_else(|p| p.into_inner());
                    store.put_batch(&pairs)?;
                }
                let json = format!("{{\"ok\":true,\"count\":{count}}}");
                respond(&mut stream, 200, "application/json", json.as_bytes())
            }
        }

        ("POST", "/api/delete") => {
            let params = parse_form(&body);
            match get_param(&params, "key") {
                Some(k) if !k.is_empty() => {
                    {
                        let mut store = store.write().unwrap_or_else(|p| p.into_inner());
                        store.delete(k.as_bytes())?;
                    }
                    respond(&mut stream, 200, "application/json", b"{\"ok\":true}")
                }
                _ => respond(
                    &mut stream,
                    400,
                    "application/json",
                    b"{\"ok\":false,\"error\":\"missing key\"}",
                ),
            }
        }

        ("POST", "/api/flush") => {
            let json = {
                let mut store = store.write().unwrap_or_else(|p| p.into_inner());
                store.flush()?;
                format!("{{\"ok\":true,\"sstables\":{}}}", store.sstable_count())
            };
            respond(&mut stream, 200, "application/json", json.as_bytes())
        }

        ("POST", "/api/compact") => {
            let json = {
                let mut store = store.write().unwrap_or_else(|p| p.into_inner());
                store.compact()?;
                format!("{{\"ok\":true,\"sstables\":{}}}", store.sstable_count())
            };
            respond(&mut stream, 200, "application/json", json.as_bytes())
        }

        _ => respond(&mut stream, 404, "text/plain", b"Not Found"),
    }
}

/// Read an HTTP request: returns (method, path, body bytes).
fn read_request(stream: &mut TcpStream) -> std::io::Result<(String, String, Vec<u8>)> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];

    loop {
        let n = stream.read(&mut tmp)?;
        if n == 0 {
            break; // connection closed before a full request arrived
        }
        buf.extend_from_slice(&tmp[..n]);

        // Headers end at the first blank line (\r\n\r\n).
        if let Some(pos) = find_subsequence(&buf, b"\r\n\r\n") {
            let header_end = pos + 4;
            let header_str = String::from_utf8_lossy(&buf[..pos]);

            let mut lines = header_str.split("\r\n");
            let request_line = lines.next().unwrap_or("").to_string();

            // Find Content-Length so we know how much body to read.
            let mut content_length = 0usize;
            for line in lines {
                let lower = line.to_ascii_lowercase();
                if let Some(rest) = lower.strip_prefix("content-length:") {
                    content_length = rest.trim().parse().unwrap_or(0);
                }
            }

            // Read the rest of the body if it hasn't all arrived yet.
            while buf.len() < header_end + content_length {
                let n = stream.read(&mut tmp)?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }

            let end = (header_end + content_length).min(buf.len());
            let body = buf[header_end..end].to_vec();

            let mut parts = request_line.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();
            return Ok((method, path, body));
        }
    }

    Ok((String::new(), String::new(), Vec::new()))
}

/// Write an HTTP response and close the connection.
fn respond(
    stream: &mut TcpStream,
    code: u16,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let status = match code {
        200 => "200 OK",
        400 => "400 Bad Request",
        404 => "404 Not Found",
        _ => "500 Internal Server Error",
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

/// Build a JSON array of key/value pairs, optionally filtered by key `prefix`
/// and capped at `limit` rows. An empty prefix means "all keys"; `None` limit
/// means "no cap".
fn list_json(store: &Store, prefix: &str, limit: Option<usize>) -> std::io::Result<String> {
    let mut items = store.scan()?;
    items.sort();

    let prefix_bytes = prefix.as_bytes();
    let mut s = String::from("[");
    let mut n = 0usize;
    for (k, v) in items.iter() {
        if !prefix_bytes.is_empty() && !k.starts_with(prefix_bytes) {
            continue;
        }
        if let Some(max) = limit {
            if n >= max {
                break;
            }
        }
        if n > 0 {
            s.push(',');
        }
        s.push_str("{\"key\":\"");
        s.push_str(&json_escape(&String::from_utf8_lossy(k)));
        s.push_str("\",\"value\":\"");
        s.push_str(&json_escape(&String::from_utf8_lossy(v)));
        s.push_str("\"}");
        n += 1;
    }
    s.push(']');
    Ok(s)
}

// ----------------------------------------------------------------------------
// Small helpers (parsing + escaping), written from scratch.
// ----------------------------------------------------------------------------

/// Find the first position of `needle` inside `haystack`.
fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Parse a form body like `key=hello&value=world` into pairs.
fn parse_form(body: &[u8]) -> Vec<(String, String)> {
    let s = String::from_utf8_lossy(body);
    let mut out = Vec::new();
    for pair in s.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut it = pair.splitn(2, '=');
        let key = url_decode(it.next().unwrap_or(""));
        let value = url_decode(it.next().unwrap_or(""));
        out.push((key, value));
    }
    out
}

fn get_param<'a>(params: &'a [(String, String)], name: &str) -> Option<&'a str> {
    params
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}

/// Decode percent-encoding (%20) and `+` from form/URL data.
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 3;
                }
                _ => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Escape a string so it's safe inside JSON double quotes.
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}
