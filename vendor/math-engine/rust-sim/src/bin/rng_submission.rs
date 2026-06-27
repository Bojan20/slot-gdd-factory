//! W152 P0-4 — GLI-19 RNG submission artifact pipeline.
//!
//! Generates the lab-submission bundle a UK/MGA/ADM/AGCO/PGCB/MGCB/DGE
//! testing house expects in their RNG technical certification packet:
//!
//!   * **Raw entropy dumps** — 96 Mbit = 12 MiB per RNG kind. This is
//!     the minimum size BMM/GLI labs use for their TestU01 BigCrush /
//!     PractRand 10TB / NIST STS sanity sweep at the receiving end.
//!     Per KIMI W152 §3.4 (PRNG testing baseline).
//!   * **SHA-256 manifest** — one digest per `.bin` plus a top-level
//!     digest of the manifest itself (tamper-evident chain).
//!   * **Hardware fingerprint** — host OS / arch / cpu / rustc version
//!     so the lab can reproduce in their environment.
//!   * **Seed catalog** — exact seed used per backend (deterministic
//!     replay is a GLI-19 §3.3.2 hard requirement).
//!
//! Output directory layout:
//!
//! ```text
//! <out>/
//! ├── manifest.json            ← per-file SHA-256, hardware, seeds
//! ├── manifest.sha256          ← digest of manifest.json
//! ├── hardware.json            ← uname / cpu / rustc fingerprint
//! ├── pcg64-12MiB.bin          ← 12 MiB raw bytes from each backend
//! ├── xoshiro256ss-12MiB.bin
//! ├── philox4x32-12MiB.bin
//! ├── chacha20-12MiB.bin       ← CSPRNG path (UK / MGA / DE primary)
//! └── mulberry32-12MiB.bin     ← legacy / TS parity backend
//! ```
//!
//! Usage:
//! ```bash
//! cargo run --release --bin rng_submission -- --out reports/cert-bundle
//! cargo run --release --bin rng_submission -- --out /tmp/x --bytes-per 1048576  # quick CI smoke
//! ```
//!
//! The companion shell script `scripts/cert-bundle.sh` wraps this
//! binary, adds the source tarball, and emits a single ZIP for upload.

use clap::Parser;
use serde::Serialize;
use sha2::{Digest, Sha256};
use slot_sim::rng::{create_rng, RngBackend, RngKind};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Format a byte slice as a lowercase hex string. Single allocation
/// (256 bytes for a sha256 digest hex). Avoids the `format!`-in-collect
/// pattern that clippy flags as inefficient.
fn bytes_to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        // unwrap-free: writing to a String is infallible.
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/// Default per-backend dump size. 12 MiB = 96 Mbit — the minimum
/// recommended by GLI for an STS / PractRand sanity pass at the lab.
const DEFAULT_BYTES_PER_BACKEND: usize = 12 * 1024 * 1024;

/// Deterministic submission seed. The lab will rerun with the same seed
/// to verify byte-identical reproduction (GLI-19 §3.3.2). Override via
/// `--seed` if the regulator requests a specific value.
const DEFAULT_SEED: u64 = 0xCAFE_BABE_0001_2345;

// ─── CLI ─────────────────────────────────────────────────────────────────────

#[derive(Parser, Debug)]
#[command(
    name = "rng_submission",
    about = "W152 P0-4 — GLI-19 RNG submission artifact pipeline"
)]
struct Args {
    /// Output directory. Created if absent. Existing files are overwritten.
    #[arg(long)]
    out: PathBuf,

    /// Bytes per backend (default 12 MiB = 96 Mbit).
    #[arg(long, default_value_t = DEFAULT_BYTES_PER_BACKEND)]
    bytes_per: usize,

    /// Seed used for every backend. Deterministic replay is a hard GLI-19
    /// requirement — change only if the lab requests it.
    #[arg(long, default_value_t = DEFAULT_SEED)]
    seed: u64,

    /// Which backends to dump. Defaults to ALL five (Mulberry32, Pcg64,
    /// Xoshiro256SS, Philox4x32, ChaCha20). Comma-separated.
    #[arg(long)]
    backends: Option<String>,

    /// Skip writing the .bin dumps (manifest-only mode for fast CI smoke).
    #[arg(long, default_value_t = false)]
    no_dump: bool,
}

// ─── Backend registry ────────────────────────────────────────────────────────

fn all_backends() -> Vec<(&'static str, RngKind)> {
    vec![
        ("mulberry32", RngKind::Mulberry32),
        ("pcg64", RngKind::Pcg64),
        ("xoshiro256ss", RngKind::Xoshiro256StarStar),
        ("philox4x32", RngKind::Philox4x32),
        ("chacha20", RngKind::ChaCha20),
    ]
}

fn parse_backends(spec: Option<&str>) -> Vec<(&'static str, RngKind)> {
    let all = all_backends();
    let Some(spec) = spec else { return all };
    let want: Vec<&str> = spec.split(',').map(|s| s.trim()).collect();
    all.into_iter()
        .filter(|(name, _)| want.contains(name))
        .collect()
}

// ─── Manifest types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct BackendArtifact {
    name: &'static str,
    rng_kind_wire: &'static str,
    seed: u64,
    bytes: usize,
    file: String,
    sha256: String,
    /// Throughput in bytes/sec measured during the dump.
    throughput_bytes_per_sec: u64,
}

#[derive(Debug, Serialize)]
struct Hardware {
    os: String,
    arch: String,
    cpu: String,
    rustc_version: String,
    rng_submission_version: &'static str,
}

#[derive(Debug, Serialize)]
struct Manifest {
    /// Bundle schema version. Bump when fields change.
    bundle_version: &'static str,
    /// W152 wave tag for cross-referencing with master TODO + audit docs.
    wave: &'static str,
    /// ISO-8601 UTC timestamp.
    generated_at: String,
    /// Per-backend dumps.
    artifacts: Vec<BackendArtifact>,
    /// Sorted map of file → sha256 (redundant but easier for the lab
    /// to verify with `sha256sum -c` style tooling).
    sha256_map: BTreeMap<String, String>,
    hardware: Hardware,
}

// ─── RNG kind wire-format mapping (mirrors `#[serde(rename_all=snake_case)]`) ─

fn rng_kind_wire(kind: RngKind) -> &'static str {
    match kind {
        RngKind::Mulberry32 => "mulberry32",
        RngKind::Pcg64 => "pcg64",
        RngKind::Xoshiro256StarStar => "xoshiro256_star_star",
        RngKind::Philox4x32 => "philox4x32",
        RngKind::ChaCha20 => "cha_cha20",
    }
}

// ─── Hardware fingerprint (best-effort, no external crates) ──────────────────

fn detect_hardware() -> Hardware {
    Hardware {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu: detect_cpu(),
        rustc_version: env!("CARGO_PKG_RUST_VERSION").to_string(),
        rng_submission_version: env!("CARGO_PKG_VERSION"),
    }
}

/// Best-effort CPU detection without external crates. Returns
/// `"unknown"` if no platform-specific path is available.
fn detect_cpu() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
        {
            if out.status.success() {
                return String::from_utf8_lossy(&out.stdout).trim().to_string();
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(s) = std::fs::read_to_string("/proc/cpuinfo") {
            for line in s.lines() {
                if let Some(rest) = line.strip_prefix("model name") {
                    if let Some(v) = rest.split(':').nth(1) {
                        return v.trim().to_string();
                    }
                }
            }
        }
    }
    "unknown".to_string()
}

// ─── Dump generator ──────────────────────────────────────────────────────────

/// Write `bytes` of raw entropy from `rng` into `path` while computing
/// the SHA-256 incrementally. Returns the hex digest and the throughput
/// achieved (bytes/sec). Uses a 64 KiB stack buffer so peak memory stays
/// flat even for 100 MiB+ dumps.
fn dump_one(rng: &mut dyn RngBackend, path: &Path, bytes: usize) -> (String, u64) {
    const BUF_BYTES: usize = 64 * 1024;
    let mut buf = [0u8; BUF_BYTES];
    let mut written = 0usize;
    let mut hasher = Sha256::new();

    let file = File::create(path).expect("open dump file");
    let mut w = BufWriter::with_capacity(BUF_BYTES, file);

    let t0 = Instant::now();
    while written < bytes {
        // Fill the chunk a u64 at a time (8 bytes per next_u64 call).
        let chunk = (bytes - written).min(BUF_BYTES);
        let words = chunk / 8;
        let rem = chunk % 8;
        for i in 0..words {
            let v = rng.next_u64().to_le_bytes();
            buf[i * 8..(i + 1) * 8].copy_from_slice(&v);
        }
        // Handle trailing bytes (< 8) — almost never hit because chunk is
        // a multiple of 64 KiB except possibly the last loop iteration.
        if rem != 0 {
            let v = rng.next_u64().to_le_bytes();
            buf[words * 8..words * 8 + rem].copy_from_slice(&v[..rem]);
        }
        let out = &buf[..chunk];
        w.write_all(out).expect("write chunk");
        hasher.update(out);
        written += chunk;
    }
    w.flush().expect("flush dump file");

    let elapsed = t0.elapsed().as_secs_f64();
    let throughput = if elapsed > 0.0 {
        (bytes as f64 / elapsed) as u64
    } else {
        0
    };

    let digest = hasher.finalize();
    let hex = bytes_to_hex(&digest);
    (hex, throughput)
}

/// Manifest-only mode: still compute SHA-256 over the **would-be** stream
/// without writing it to disk. Useful for CI smoke tests.
fn hash_only(rng: &mut dyn RngBackend, bytes: usize) -> (String, u64) {
    const BUF_BYTES: usize = 64 * 1024;
    let mut buf = [0u8; BUF_BYTES];
    let mut written = 0usize;
    let mut hasher = Sha256::new();
    let t0 = Instant::now();
    while written < bytes {
        let chunk = (bytes - written).min(BUF_BYTES);
        let words = chunk / 8;
        let rem = chunk % 8;
        for i in 0..words {
            let v = rng.next_u64().to_le_bytes();
            buf[i * 8..(i + 1) * 8].copy_from_slice(&v);
        }
        if rem != 0 {
            let v = rng.next_u64().to_le_bytes();
            buf[words * 8..words * 8 + rem].copy_from_slice(&v[..rem]);
        }
        hasher.update(&buf[..chunk]);
        written += chunk;
    }
    let elapsed = t0.elapsed().as_secs_f64();
    let throughput = if elapsed > 0.0 {
        (bytes as f64 / elapsed) as u64
    } else {
        0
    };
    let digest = hasher.finalize();
    let hex = bytes_to_hex(&digest);
    (hex, throughput)
}

// ─── Main entry ──────────────────────────────────────────────────────────────

fn main() {
    let args = Args::parse();

    fs::create_dir_all(&args.out).expect("create output dir");

    let backends = parse_backends(args.backends.as_deref());
    let mut artifacts = Vec::with_capacity(backends.len());
    let mut sha256_map: BTreeMap<String, String> = BTreeMap::new();

    eprintln!(
        "[rng-submission] writing {} backends × {} bytes → {}",
        backends.len(),
        args.bytes_per,
        args.out.display()
    );

    for (name, kind) in &backends {
        let mb = args.bytes_per as f64 / (1024.0 * 1024.0);
        eprintln!("  {name} ({} MiB) ...", mb as u32);

        let mut rng = create_rng(*kind, args.seed);
        let file_name = format!("{}-{}MiB.bin", name, (args.bytes_per / 1024 / 1024).max(1));
        let path = args.out.join(&file_name);

        let (hex, throughput) = if args.no_dump {
            hash_only(rng.as_mut(), args.bytes_per)
        } else {
            dump_one(rng.as_mut(), &path, args.bytes_per)
        };

        let mibs = (throughput as f64) / (1024.0 * 1024.0);
        eprintln!("    sha256: {hex}   {mibs:.1} MiB/s");

        sha256_map.insert(file_name.clone(), hex.clone());
        artifacts.push(BackendArtifact {
            name,
            rng_kind_wire: rng_kind_wire(*kind),
            seed: args.seed,
            bytes: args.bytes_per,
            file: file_name,
            sha256: hex,
            throughput_bytes_per_sec: throughput,
        });
    }

    let hardware = detect_hardware();

    let manifest = Manifest {
        bundle_version: "1.0.0",
        wave: "W152-P0-4",
        generated_at: iso_now(),
        artifacts,
        sha256_map,
        hardware,
    };

    let manifest_path = args.out.join("manifest.json");
    let json = serde_json::to_string_pretty(&manifest).expect("serialize manifest");
    fs::write(&manifest_path, &json).expect("write manifest");

    // Digest the manifest for tamper-evidence.
    let mut h = Sha256::new();
    h.update(json.as_bytes());
    let mhex = bytes_to_hex(&h.finalize());
    fs::write(args.out.join("manifest.sha256"), format!("{mhex}  manifest.json\n"))
        .expect("write manifest.sha256");

    // Hardware report also lives at top level for the lab.
    let hardware_path = args.out.join("hardware.json");
    let hw_json = serde_json::to_string_pretty(&manifest.hardware).expect("serialize hardware");
    fs::write(hardware_path, hw_json).expect("write hardware.json");

    eprintln!("[rng-submission] manifest sha256 = {mhex}");
    eprintln!("[rng-submission] done: {}", args.out.display());
}

/// ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ`. Avoids the `chrono` dep (this
/// binary is pure-Rust + sha2 only, mirroring the slot_sim crate goal).
fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Days-since-epoch breakdown: 1970-01-01 = day 0. Algorithm:
    // Howard Hinnant "date" — civil_from_days.
    let z = now as i64 / 86_400 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + i64::from(m <= 2);

    let secs = now % 86_400;
    let hh = secs / 3600;
    let mm = (secs % 3600) / 60;
    let ss = secs % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}
