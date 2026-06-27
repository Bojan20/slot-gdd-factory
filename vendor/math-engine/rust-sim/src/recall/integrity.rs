//! Canonical-JSON + sha256 chain — Rust mirror of `src/recall/integrity.ts`.
//!
//! The canonical-JSON serializer in particular MUST byte-match the TS
//! side, or the cross-language KAT will fail (intentional design — that's
//! exactly what catches drift before it ends up in a regulator's audit
//! mailbox).

use super::types::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Write;

/// Serialize a `serde_json::Value` to canonical JSON: keys sorted at
/// every nesting level, no whitespace, no trailing newline. Numbers go
/// through `serde_json`'s display so finite f64 share the shortest stable
/// representation with TS's `JSON.stringify`. Non-finite numbers are
/// already forbidden by serde_json on the deserialize path.
pub fn canonical_json(value: &Value) -> String {
    let mut buf = Vec::with_capacity(256);
    write_canonical(&mut buf, value);
    // SAFETY: `write_canonical` only emits valid UTF-8.
    String::from_utf8(buf).expect("canonical_json produced invalid UTF-8")
}

fn write_canonical(out: &mut Vec<u8>, value: &Value) {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
        Value::Number(n) => {
            // Reject non-finite — `serde_json::Number` cannot hold NaN/Inf
            // for f64, so this branch is effectively defensive. We still
            // assert to surface a logic bug noisily if it ever changes.
            if let Some(f) = n.as_f64() {
                assert!(
                    f.is_finite(),
                    "canonical_json: non-finite f64 leaked into Value"
                );
            }
            write!(out, "{}", n).unwrap();
        }
        Value::String(s) => {
            // Reuse serde_json's string serializer — it produces the same
            // escape sequence set as JS `JSON.stringify`.
            let s = serde_json::to_string(s).unwrap();
            out.extend_from_slice(s.as_bytes());
        }
        Value::Array(arr) => {
            out.push(b'[');
            for (i, item) in arr.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_canonical(out, item);
            }
            out.push(b']');
        }
        Value::Object(map) => {
            // Sort keys lexicographically.
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push(b'{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                let key_json = serde_json::to_string(k).unwrap();
                out.extend_from_slice(key_json.as_bytes());
                out.push(b':');
                write_canonical(out, &map[*k]);
            }
            out.push(b'}');
        }
    }
}

/// sha256 of a UTF-8 string, lowercase hex.
pub fn sha256_hex(s: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for b in digest.iter() {
        // hex-format byte with leading zero
        out.push_str(&format!("{:02x}", b));
    }
    out
}

/// Compute `entry_hash` for an entry that doesn't yet have one. The TS
/// counterpart strips the `entry_hash` field from the object before
/// canonicalizing; here we emit the entry via serde, remove the field
/// from the resulting `Value`, then canonicalize.
pub fn compute_entry_hash(entry: &SpinJournalEntry) -> String {
    let mut v = serde_json::to_value(entry).expect("entry serializes");
    if let Some(obj) = v.as_object_mut() {
        obj.remove("entry_hash");
    }
    sha256_hex(&canonical_json(&v))
}

/// Compute `manifest_hash` over the manifest minus that field.
pub fn compute_manifest_hash(manifest: &JournalManifest) -> String {
    let mut v = serde_json::to_value(manifest).expect("manifest serializes");
    if let Some(obj) = v.as_object_mut() {
        obj.remove("manifest_hash");
    }
    sha256_hex(&canonical_json(&v))
}

/// Builder helper: fill `prev_hash` from the running chain head and
/// compute `entry_hash`. Returns the finalized entry.
pub fn seal_entry(mut draft: SpinJournalEntry, head: Option<&str>) -> SpinJournalEntry {
    draft.prev_hash = head.unwrap_or(ZERO_HASH).to_string();
    draft.entry_hash = String::new(); // ignored by compute_entry_hash
    let hash = compute_entry_hash(&draft);
    draft.entry_hash = hash;
    draft
}

/// Builder helper for the manifest.
pub fn seal_manifest(mut draft: JournalManifest) -> JournalManifest {
    draft.manifest_hash = String::new();
    let hash = compute_manifest_hash(&draft);
    draft.manifest_hash = hash;
    draft
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainVerification {
    Ok {
        count: usize,
        last_entry_hash: String,
    },
    Empty,
    GenesisPrevNotZero {
        seq: u64,
        detail: String,
    },
    PrevHashMismatch {
        seq: u64,
        detail: String,
    },
    EntryHashMismatch {
        seq: u64,
        detail: String,
    },
    SeqNotMonotonic {
        seq: u64,
        detail: String,
    },
    SchemaVersionMismatch {
        seq: u64,
        detail: String,
    },
}

pub fn verify_chain(entries: &[SpinJournalEntry]) -> ChainVerification {
    if entries.is_empty() {
        return ChainVerification::Empty;
    }
    let mut prev_hash = ZERO_HASH.to_string();
    let mut prev_seq: i64 = -1;
    for e in entries {
        if e.schema_version != RECALL_SCHEMA_VERSION {
            return ChainVerification::SchemaVersionMismatch {
                seq: e.seq,
                detail: format!(
                    "expected {}, got {}",
                    RECALL_SCHEMA_VERSION, e.schema_version
                ),
            };
        }
        if (e.seq as i64) <= prev_seq {
            return ChainVerification::SeqNotMonotonic {
                seq: e.seq,
                detail: format!("seq {} ≤ previous {}", e.seq, prev_seq),
            };
        }
        if e.prev_hash != prev_hash {
            return if prev_seq == -1 {
                ChainVerification::GenesisPrevNotZero {
                    seq: e.seq,
                    detail: format!("expected prev_hash {}, got {}", prev_hash, e.prev_hash),
                }
            } else {
                ChainVerification::PrevHashMismatch {
                    seq: e.seq,
                    detail: format!("expected prev_hash {}, got {}", prev_hash, e.prev_hash),
                }
            };
        }
        let want = compute_entry_hash(e);
        if want != e.entry_hash {
            return ChainVerification::EntryHashMismatch {
                seq: e.seq,
                detail: format!("recomputed {}, stored {}", want, e.entry_hash),
            };
        }
        prev_hash = e.entry_hash.clone();
        prev_seq = e.seq as i64;
    }
    ChainVerification::Ok {
        count: entries.len(),
        last_entry_hash: prev_hash,
    }
}
