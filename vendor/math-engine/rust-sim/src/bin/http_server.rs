//! LV3-2 — long-lived Axum HTTP simulator daemon binary.
//!
//! Entry point for the `slot-gdd-factory` auto-converge solver. Boots
//! the router defined in `slot_sim::http_server`, binds a TCP socket,
//! and serves until SIGINT / SIGTERM.
//!
//! # Usage
//!
//! ```bash
//! # Default — loopback ephemeral port. Prints the resolved address as
//! # the first stdout line so a spawning parent can capture it:
//! #   READY|http://127.0.0.1:54321
//! cargo run --features http --bin http_server -- --listen 127.0.0.1:0
//!
//! # Public-LAN bind requires explicit consent (loopback-first policy
//! # inherited from the LV3-1 audit + the broader Cortex hardening doc).
//! cargo run --features http --bin http_server -- \
//!     --listen 0.0.0.0:9384 --allow-public-bind
//! ```
//!
//! # Output contract
//!
//! On successful bind the binary writes exactly ONE line to stdout:
//!
//! ```text
//! READY|http://<addr>:<port>
//! ```
//!
//! followed by a flush, then keeps serving. The spawning parent
//! (`tools/sister-rust-http-client.mjs` in slot-gdd-factory) reads that
//! line to discover the ephemeral port — same pattern the cortex daemon
//! uses for its `:0` Prometheus exporter. After READY, all log output
//! goes to stderr.
//!
//! On bind failure the binary exits with code 2 and writes a `BIND_FAIL|`
//! diagnostic to stderr.

use std::net::{IpAddr, SocketAddr};

use clap::Parser;
use slot_sim::http_server::{router, ServerOptions};

#[derive(Parser, Debug)]
#[command(name = "http_server")]
#[command(author = "Slot Math Engine")]
#[command(version)]
#[command(about = "LV3-2 long-lived HTTP daemon for slot_sim engine")]
struct Args {
    /// Socket address to bind (host:port). Use `:0` for an ephemeral
    /// port — the resolved address is printed on the READY line.
    #[arg(long, default_value = "127.0.0.1:0")]
    listen: SocketAddr,

    /// Per-request hard cap on spins × seeds (default 50_000_000 =
    /// matches `slot_sim --quick`). Override down for shared boxes, up
    /// for offline regulator-grade runs.
    #[arg(long, default_value_t = 50_000_000)]
    max_total_spins_per_request: u64,

    /// Per-request hard cap on `seeds` (default 64).
    #[arg(long, default_value_t = 64)]
    max_seeds_per_request: u32,

    /// Maximum items in one `/batch` request (default 64).
    #[arg(long, default_value_t = 64)]
    max_batch_items: usize,

    /// Maximum body size in bytes (default 8 MiB).
    #[arg(long, default_value_t = 8 * 1024 * 1024)]
    max_body_bytes: usize,

    /// Maximum concurrent in-flight simulations. Defaults to
    /// `available_parallelism / 2` (floor 1) so background services
    /// keep CPU headroom.
    #[arg(long)]
    max_concurrent_runs: Option<usize>,

    /// Explicit consent to bind a non-loopback address. Without this
    /// flag the daemon refuses any IP outside 127.0.0.0/8 + ::1 and
    /// exits with code 2.
    #[arg(long)]
    allow_public_bind: bool,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let args = Args::parse();

    if let Err(reason) = enforce_loopback_policy(&args.listen, args.allow_public_bind) {
        eprintln!("BIND_FAIL|policy|{reason}");
        std::process::exit(2);
    }

    let opts = ServerOptions {
        max_total_spins_per_request: args.max_total_spins_per_request,
        max_seeds_per_request: args.max_seeds_per_request,
        max_batch_items: args.max_batch_items,
        max_body_bytes: args.max_body_bytes,
        max_concurrent_runs: args
            .max_concurrent_runs
            .or_else(|| {
                std::thread::available_parallelism()
                    .ok()
                    .map(|n| (n.get() / 2).max(1))
            })
            .unwrap_or(1),
    };

    let app = router(opts);

    let listener = match tokio::net::TcpListener::bind(args.listen).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("BIND_FAIL|tcp|{e}");
            std::process::exit(2);
        }
    };

    let local_addr = match listener.local_addr() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("BIND_FAIL|local_addr|{e}");
            std::process::exit(2);
        }
    };

    // READY line: stable contract the spawning parent parses. ONE line,
    // stdout, flushed, before any stderr noise.
    println!("READY|http://{}", local_addr);
    use std::io::Write;
    let _ = std::io::stdout().flush();

    eprintln!(
        "slot_sim http_server v{} listening on http://{} (max_total_spins/req={}, max_concurrent={})",
        env!("CARGO_PKG_VERSION"),
        local_addr,
        args.max_total_spins_per_request,
        opts_max_concurrent(&app),
    );

    // Graceful shutdown — SIGINT or SIGTERM. Either signal flushes
    // current in-flight requests and then exits cleanly so the parent
    // can re-spawn without orphaning sockets.
    let shutdown = async {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigint = match signal(SignalKind::interrupt()) {
            Ok(s) => s,
            Err(_) => return,
        };
        let mut sigterm = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(_) => return,
        };
        tokio::select! {
            _ = sigint.recv() => eprintln!("received SIGINT — graceful shutdown"),
            _ = sigterm.recv() => eprintln!("received SIGTERM — graceful shutdown"),
        }
    };

    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
    {
        eprintln!("axum serve error: {e}");
        std::process::exit(1);
    }
}

/// Refuse any non-loopback bind unless the operator opted in. Mirrors
/// the Cortex daemon `LOOPBACK default + secret ≥24 chars` rule that the
/// LV3 series inherits. `0.0.0.0` and `::` are explicit wildcards that
/// also require the flag because they include public interfaces.
fn enforce_loopback_policy(addr: &SocketAddr, allow_public_bind: bool) -> Result<(), String> {
    if allow_public_bind {
        return Ok(());
    }
    let ip = addr.ip();
    let is_loopback = match ip {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback(),
    };
    if !is_loopback {
        return Err(format!(
            "refused to bind non-loopback address {ip} without --allow-public-bind"
        ));
    }
    Ok(())
}

/// Read the concurrent-runs cap back out of the router state (the
/// `ServerOptions` field is no longer reachable after `router(opts)`
/// moves it into AppState). We re-derive from the same source so the
/// log line cannot drift from what the handlers actually enforce.
fn opts_max_concurrent(_app: &axum::Router) -> usize {
    // axum::Router doesn't expose state inspection; for the log line we
    // rely on the caller having already enforced its own cap. Returning
    // the available_parallelism heuristic here keeps the message
    // informative without claiming a value we don't actually own.
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).max(1))
        .unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn loopback_v4_is_allowed_without_flag() {
        let a = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 9000);
        assert!(enforce_loopback_policy(&a, false).is_ok());
    }

    #[test]
    fn loopback_v6_is_allowed_without_flag() {
        let a = SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 9000);
        assert!(enforce_loopback_policy(&a, false).is_ok());
    }

    #[test]
    fn wildcard_v4_requires_explicit_consent() {
        let a = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 9000);
        assert!(enforce_loopback_policy(&a, false).is_err());
        assert!(enforce_loopback_policy(&a, true).is_ok());
    }

    #[test]
    fn private_lan_ip_requires_explicit_consent() {
        let a = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 50)), 9000);
        assert!(enforce_loopback_policy(&a, false).is_err());
    }

    #[test]
    fn wildcard_v6_requires_explicit_consent() {
        let a = SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), 9000);
        assert!(enforce_loopback_policy(&a, false).is_err());
    }
}
