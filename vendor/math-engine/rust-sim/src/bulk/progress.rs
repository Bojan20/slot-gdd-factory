//! Progress reporting for `BulkDispatcher` runs.
//!
//! Two callers want this: humans watching a terminal (`StdoutProgress`,
//! ETA + rolling throughput + 0.1% resolution) and scripts that pipe
//! output into a log aggregator (`JsonLineProgress`, one NDJSON line per
//! tick). `NoOpProgress` is the default for tests / benchmarks.
//!
//! The dispatcher calls `report(snapshot)` at most `target_ticks_per_run`
//! times so a 1T run doesn't produce a million log lines. Tick frequency
//! is driven by the dispatcher; reporters only format what they receive.

use std::io::{self, Write};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ProgressSnapshot {
    pub completed_spins: u64,
    pub total_spins: u64,
    pub elapsed: Duration,
    pub spins_per_sec: f64,
    /// Estimated time remaining; `None` until we have a reliable rate.
    pub eta: Option<Duration>,
    /// Chunk index just finished, 0-based.
    pub chunk_index: u64,
    /// Total chunks scheduled.
    pub chunks_total: u64,
}

impl ProgressSnapshot {
    pub fn fraction(&self) -> f64 {
        if self.total_spins == 0 {
            return 0.0;
        }
        self.completed_spins as f64 / self.total_spins as f64
    }
}

pub trait ProgressReporter: Send + Sync {
    fn report(&self, snap: &ProgressSnapshot);
    /// Called once at the end so reporters can flush newline / json
    /// `done: true` marker.
    fn finish(&self, snap: &ProgressSnapshot);
}

// ─── NoOpProgress ──────────────────────────────────────────────────────

pub struct NoOpProgress;
impl ProgressReporter for NoOpProgress {
    fn report(&self, _: &ProgressSnapshot) {}
    fn finish(&self, _: &ProgressSnapshot) {}
}

// ─── StdoutProgress ─────────────────────────────────────────────────────

/// Single-line bar that overwrites itself on each tick. The line is
/// safe to interleave with `eprintln!` only — anything written to stdout
/// MUST go through this reporter to avoid garbled output.
pub struct StdoutProgress {
    width: usize,
}
impl StdoutProgress {
    pub fn new() -> Self {
        Self { width: 40 }
    }
}
impl Default for StdoutProgress {
    fn default() -> Self {
        Self::new()
    }
}
impl ProgressReporter for StdoutProgress {
    fn report(&self, snap: &ProgressSnapshot) {
        let pct = snap.fraction() * 100.0;
        let filled = ((self.width as f64) * snap.fraction()).round() as usize;
        let filled = filled.min(self.width);
        let bar: String = "█".repeat(filled) + &"░".repeat(self.width - filled);
        let eta_str = snap.eta.map(fmt_duration).unwrap_or_else(|| "??".into());
        let elapsed = fmt_duration(snap.elapsed);
        let throughput = fmt_throughput(snap.spins_per_sec);
        // `\r` rewrites the same line; trailing whitespace pads against
        // a previously longer line so we don't leave artifacts.
        let line = format!(
            "\r[{bar}] {pct:6.2}%  {throughput}  elapsed {elapsed}  ETA {eta_str}  chunk {}/{}            ",
            snap.chunk_index + 1,
            snap.chunks_total
        );
        let mut out = io::stderr().lock();
        let _ = out.write_all(line.as_bytes());
        let _ = out.flush();
    }
    fn finish(&self, snap: &ProgressSnapshot) {
        // Repaint as 100% then move to a new line.
        let bar: String = "█".repeat(self.width);
        let elapsed = fmt_duration(snap.elapsed);
        let throughput = fmt_throughput(snap.spins_per_sec);
        let line = format!(
            "\r[{bar}] 100.00%  {throughput}  total {elapsed}                                \n",
        );
        let mut out = io::stderr().lock();
        let _ = out.write_all(line.as_bytes());
        let _ = out.flush();
    }
}

// ─── JsonLineProgress ───────────────────────────────────────────────────

pub struct JsonLineProgress;
impl ProgressReporter for JsonLineProgress {
    fn report(&self, snap: &ProgressSnapshot) {
        let line = format!(
            "{{\"event\":\"progress\",\"completed\":{},\"total\":{},\"fraction\":{:.6},\"elapsed_ms\":{},\"spins_per_sec\":{:.2},\"eta_ms\":{},\"chunk\":{},\"chunks_total\":{}}}",
            snap.completed_spins,
            snap.total_spins,
            snap.fraction(),
            snap.elapsed.as_millis(),
            snap.spins_per_sec,
            snap.eta.map(|d| d.as_millis() as i64).unwrap_or(-1),
            snap.chunk_index,
            snap.chunks_total
        );
        let mut out = io::stderr().lock();
        let _ = writeln!(out, "{line}");
    }
    fn finish(&self, snap: &ProgressSnapshot) {
        let line = format!(
            "{{\"event\":\"done\",\"completed\":{},\"total\":{},\"elapsed_ms\":{},\"spins_per_sec\":{:.2}}}",
            snap.completed_spins,
            snap.total_spins,
            snap.elapsed.as_millis(),
            snap.spins_per_sec
        );
        let mut out = io::stderr().lock();
        let _ = writeln!(out, "{line}");
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────

pub(crate) fn fmt_duration(d: Duration) -> String {
    let total_secs = d.as_secs();
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    if h > 0 {
        format!("{h}h{m:02}m{s:02}s")
    } else if m > 0 {
        format!("{m}m{s:02}s")
    } else {
        format!("{s}.{:03}s", d.subsec_millis())
    }
}

pub(crate) fn fmt_throughput(per_sec: f64) -> String {
    if !per_sec.is_finite() || per_sec <= 0.0 {
        return "?? spins/s".into();
    }
    if per_sec >= 1e12 {
        format!("{:.2}T spins/s", per_sec / 1e12)
    } else if per_sec >= 1e9 {
        format!("{:.2}B spins/s", per_sec / 1e9)
    } else if per_sec >= 1e6 {
        format!("{:.2}M spins/s", per_sec / 1e6)
    } else if per_sec >= 1e3 {
        format!("{:.2}K spins/s", per_sec / 1e3)
    } else {
        format!("{per_sec:.0} spins/s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fmt_throughput_units() {
        assert_eq!(fmt_throughput(1e3), "1.00K spins/s");
        assert_eq!(fmt_throughput(1.5e9), "1.50B spins/s");
        assert_eq!(fmt_throughput(1.2e12), "1.20T spins/s");
        assert_eq!(fmt_throughput(0.0), "?? spins/s");
        assert_eq!(fmt_throughput(f64::NAN), "?? spins/s");
    }

    #[test]
    fn fmt_duration_buckets() {
        assert_eq!(fmt_duration(Duration::from_millis(250)), "0.250s");
        assert_eq!(fmt_duration(Duration::from_secs(75)), "1m15s");
        assert_eq!(fmt_duration(Duration::from_secs(3725)), "1h02m05s");
    }

    #[test]
    fn snapshot_fraction() {
        let s = ProgressSnapshot {
            completed_spins: 250,
            total_spins: 1000,
            elapsed: Duration::from_secs(1),
            spins_per_sec: 250.0,
            eta: None,
            chunk_index: 0,
            chunks_total: 4,
        };
        assert!((s.fraction() - 0.25).abs() < 1e-9);
    }
}
