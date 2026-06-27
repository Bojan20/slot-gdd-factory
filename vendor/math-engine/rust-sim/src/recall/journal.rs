//! Memory + NDJSON file journals (Rust mirror).
//!
//! Same `Journal` interface as TS — `append`, `read_all`, `head`,
//! `size`, `build_manifest`. The file format is line-compatible: a
//! file written by TS can be read here and vice versa.

use super::integrity::{seal_entry, seal_manifest, verify_chain, ChainVerification};
use super::types::*;
use std::fs::{rename, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

/// Keep in sync with TS `src/recall/journal.ts::getEngineVersion()` and
/// `Cargo.toml` `version`.
pub const ENGINE_VERSION: &str = "0.5.0";

const DEFAULT_ROTATION_MAX_BYTES: u64 = 256 * 1024 * 1024;

pub trait Journal {
    /// Append a draft entry. The draft's `prev_hash` / `entry_hash`
    /// fields are ignored on input — the journal stamps them.
    fn append(&mut self, draft: SpinJournalEntry) -> Result<SpinJournalEntry, String>;
    fn read_all(&self) -> Vec<SpinJournalEntry>;
    fn head(&self) -> Option<String>;
    fn size(&self) -> usize;
    fn build_manifest(&self) -> JournalManifest;
}

// ─── MemoryJournal ──────────────────────────────────────────────────────

pub struct MemoryJournal {
    entries: Vec<SpinJournalEntry>,
    head_hash: Option<String>,
    next_seq: u64,
}

impl Default for MemoryJournal {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryJournal {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            head_hash: None,
            next_seq: 0,
        }
    }
}

impl Journal for MemoryJournal {
    fn append(&mut self, draft: SpinJournalEntry) -> Result<SpinJournalEntry, String> {
        if draft.seq != self.next_seq {
            return Err(format!(
                "MemoryJournal: expected seq {}, got {}",
                self.next_seq, draft.seq
            ));
        }
        if draft.schema_version != RECALL_SCHEMA_VERSION {
            return Err(format!(
                "MemoryJournal: schema_version mismatch (want {}, got {})",
                RECALL_SCHEMA_VERSION, draft.schema_version
            ));
        }
        let sealed = seal_entry(draft, self.head_hash.as_deref());
        self.head_hash = Some(sealed.entry_hash.clone());
        self.next_seq += 1;
        self.entries.push(sealed.clone());
        Ok(sealed)
    }
    fn read_all(&self) -> Vec<SpinJournalEntry> {
        self.entries.clone()
    }
    fn head(&self) -> Option<String> {
        self.head_hash.clone()
    }
    fn size(&self) -> usize {
        self.entries.len()
    }
    fn build_manifest(&self) -> JournalManifest {
        build_manifest_for(&self.entries, "<memory>")
    }
}

// ─── NdjsonFileJournal ──────────────────────────────────────────────────

pub struct NdjsonFileJournal {
    path: String,
    head_hash: Option<String>,
    next_seq: u64,
    count: usize,
    rotation_max_bytes: u64,
}

impl NdjsonFileJournal {
    pub fn new(path: impl Into<String>) -> Result<Self, String> {
        Self::with_rotation(path, DEFAULT_ROTATION_MAX_BYTES)
    }

    pub fn with_rotation(path: impl Into<String>, rotation_max_bytes: u64) -> Result<Self, String> {
        let mut j = Self {
            path: path.into(),
            head_hash: None,
            next_seq: 0,
            count: 0,
            rotation_max_bytes,
        };
        j.recover()?;
        Ok(j)
    }

    fn recover(&mut self) -> Result<(), String> {
        let path = Path::new(&self.path);
        if !path.exists() {
            return Ok(());
        }
        let file = File::open(path).map_err(|e| format!("open {}: {e}", self.path))?;
        let reader = BufReader::new(file);
        for (line_no, line) in reader.lines().enumerate() {
            let line = line.map_err(|e| format!("read line {line_no}: {e}"))?;
            if line.is_empty() {
                continue;
            }
            let e: SpinJournalEntry = serde_json::from_str(&line)
                .map_err(|err| format!("parse line {line_no}: {err}"))?;
            let want_prev = self
                .head_hash
                .clone()
                .unwrap_or_else(|| ZERO_HASH.to_string());
            if e.prev_hash != want_prev {
                return Err(format!(
                    "NdjsonFileJournal::recover: chain break at seq {} — expected prev_hash {}, got {}",
                    e.seq, want_prev, e.prev_hash
                ));
            }
            if e.seq != self.next_seq {
                return Err(format!(
                    "NdjsonFileJournal::recover: seq gap at line {line_no} — expected {}, got {}",
                    self.next_seq, e.seq
                ));
            }
            self.head_hash = Some(e.entry_hash.clone());
            self.next_seq = e.seq + 1;
            self.count += 1;
        }
        Ok(())
    }

    fn maybe_rotate(&self) {
        let path = Path::new(&self.path);
        let Ok(meta) = std::fs::metadata(path) else {
            return;
        };
        if meta.len() < self.rotation_max_bytes {
            return;
        }
        let ts = chrono_like_utc();
        let rotated = if let Some(stripped) = self.path.strip_suffix(".ndjson") {
            format!("{stripped}-{ts}.ndjson")
        } else {
            format!("{}-{ts}.ndjson", self.path)
        };
        let _ = rename(&self.path, &rotated);
    }
}

impl Journal for NdjsonFileJournal {
    fn append(&mut self, draft: SpinJournalEntry) -> Result<SpinJournalEntry, String> {
        if draft.seq != self.next_seq {
            return Err(format!(
                "NdjsonFileJournal: expected seq {}, got {}",
                self.next_seq, draft.seq
            ));
        }
        if draft.schema_version != RECALL_SCHEMA_VERSION {
            return Err(format!(
                "NdjsonFileJournal: schema_version mismatch (want {}, got {})",
                RECALL_SCHEMA_VERSION, draft.schema_version
            ));
        }
        let sealed = seal_entry(draft, self.head_hash.as_deref());
        // serde_json's default emitter doesn't pretty-print and emits
        // valid JSON for each line — fine for NDJSON.
        let line = serde_json::to_string(&sealed)
            .map_err(|e| format!("NdjsonFileJournal: serialize: {e}"))?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| format!("open {} for append: {e}", self.path))?;
        writeln!(file, "{}", line).map_err(|e| format!("write line: {e}"))?;
        drop(file);
        self.head_hash = Some(sealed.entry_hash.clone());
        self.next_seq += 1;
        self.count += 1;
        self.maybe_rotate();
        Ok(sealed)
    }
    fn read_all(&self) -> Vec<SpinJournalEntry> {
        let path = Path::new(&self.path);
        if !path.exists() {
            return Vec::new();
        }
        let file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };
        let reader = BufReader::new(file);
        let mut out = Vec::new();
        for line in reader.lines().map_while(Result::ok) {
            if line.is_empty() {
                continue;
            }
            if let Ok(e) = serde_json::from_str::<SpinJournalEntry>(&line) {
                out.push(e);
            }
        }
        out
    }
    fn head(&self) -> Option<String> {
        self.head_hash.clone()
    }
    fn size(&self) -> usize {
        self.count
    }
    fn build_manifest(&self) -> JournalManifest {
        build_manifest_for(&self.read_all(), &self.path)
    }
}

fn build_manifest_for(entries: &[SpinJournalEntry], journal_file: &str) -> JournalManifest {
    if entries.is_empty() {
        return seal_manifest(JournalManifest {
            schema_version: RECALL_SCHEMA_VERSION.into(),
            engine_version: ENGINE_VERSION.into(),
            journal_file: journal_file.into(),
            first_seq: 0,
            last_seq: -1,
            first_timestamp_utc: String::new(),
            last_timestamp_utc: String::new(),
            last_entry_hash: ZERO_HASH.into(),
            manifest_hash: String::new(),
        });
    }
    match verify_chain(entries) {
        ChainVerification::Ok { .. } => {}
        other => panic!("build_manifest: chain verification failed: {other:?}"),
    }
    let first = &entries[0];
    let last = &entries[entries.len() - 1];
    seal_manifest(JournalManifest {
        schema_version: RECALL_SCHEMA_VERSION.into(),
        engine_version: ENGINE_VERSION.into(),
        journal_file: journal_file.into(),
        first_seq: first.seq as i64,
        last_seq: last.seq as i64,
        first_timestamp_utc: first.timestamp_utc.clone(),
        last_timestamp_utc: last.timestamp_utc.clone(),
        last_entry_hash: last.entry_hash.clone(),
        manifest_hash: String::new(),
    })
}

pub fn write_manifest(path: &str, manifest: &JournalManifest) -> Result<(), String> {
    let tmp = format!("{path}.tmp");
    let payload = serde_json::to_string_pretty(manifest).map_err(|e| format!("serialize: {e}"))?;
    let mut file = File::create(&tmp).map_err(|e| format!("create {tmp}: {e}"))?;
    file.write_all(payload.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    file.sync_all().map_err(|e| format!("sync: {e}"))?;
    rename(&tmp, path).map_err(|e| format!("rename {tmp} → {path}: {e}"))?;
    Ok(())
}

pub fn read_manifest(path: &str) -> Result<Option<JournalManifest>, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(p).map_err(|e| format!("read {path}: {e}"))?;
    let m: JournalManifest =
        serde_json::from_str(&raw).map_err(|e| format!("parse {path}: {e}"))?;
    Ok(Some(m))
}

/// Cheap ISO8601-ish UTC timestamp for file rotation. Avoids pulling
/// `chrono` for one filename suffix.
fn chrono_like_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Suffix is monotonic and unique-enough — full calendar conversion
    // is overkill since this is filesystem metadata, not journal content.
    format!("epoch-{secs}")
}
