/**
 * Hash chain — canonical JSON, sha256, link verification.
 *
 * The chain is the only thing standing between an honest operator and
 * an operator who quietly rewrites yesterday's losing spin into a win.
 * Two invariants:
 *
 *   1. `entry_hash` = sha256(canonical_json(entry without `entry_hash`)).
 *   2. `prev_hash`  = previous row's `entry_hash`.
 *
 * Break either invariant and verification fails noisily.
 *
 * The Rust mirror in `rust-sim/src/recall/integrity.rs` produces the
 * same bytes for the same input — `tests/fixtures/recall/kat-chain.json`
 * is the cross-language KAT.
 */

import { createHash } from 'crypto';
import type { Hex64, JournalManifest, SpinJournalEntry } from './types.js';
import { RECALL_SCHEMA_VERSION, ZERO_HASH } from './types.js';

/**
 * Canonical JSON for hashing. Two rules:
 *   - Keys sorted lexicographically at every level.
 *   - No whitespace.
 * The ECMA spec leaves object-property order to the implementation, so
 * we sort explicitly. Numbers go through `JSON.stringify(num)` which
 * already produces the shortest stable form for finite numbers and
 * refuses NaN / Infinity (returns `null`, which we treat as a write-
 * time error elsewhere; here we just trust it because the journal
 * writer guards finiteness).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalJson: refusing to serialize non-finite ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') +
      '}'
    );
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

/** sha256 of a UTF-8 string, lowercase hex. */
export function sha256Hex(s: string): Hex64 {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Compute the `entry_hash` of a journal entry, given the entry WITHOUT
 * its `entry_hash` field. Caller fills the field with this return value
 * before writing.
 */
export function computeEntryHash(entryWithoutHash: Omit<SpinJournalEntry, 'entry_hash'>): Hex64 {
  return sha256Hex(canonicalJson(entryWithoutHash as unknown));
}

/**
 * Compute the `manifest_hash` of a manifest, given the manifest WITHOUT
 * its `manifest_hash` field.
 */
export function computeManifestHash(
  manifestWithoutHash: Omit<JournalManifest, 'manifest_hash'>,
): Hex64 {
  return sha256Hex(canonicalJson(manifestWithoutHash as unknown));
}

/**
 * Stamp the entry: fill in `prev_hash` from the head and compute
 * `entry_hash`. Mutates a *copy*, returns the finalized entry.
 *
 * The head argument is the running tail hash of the chain — the writer
 * keeps it as state. `null` ⇒ first entry, uses `ZERO_HASH`.
 */
export function sealEntry(
  draft: Omit<SpinJournalEntry, 'prev_hash' | 'entry_hash'>,
  head: Hex64 | null,
): SpinJournalEntry {
  const prev_hash = head ?? ZERO_HASH;
  const withPrev: Omit<SpinJournalEntry, 'entry_hash'> = { ...draft, prev_hash };
  const entry_hash = computeEntryHash(withPrev);
  return { ...withPrev, entry_hash };
}

/**
 * Stamp the manifest: compute `manifest_hash` against the manifest
 * minus that field.
 */
export function sealManifest(
  draft: Omit<JournalManifest, 'manifest_hash'>,
): JournalManifest {
  const manifest_hash = computeManifestHash(draft);
  return { ...draft, manifest_hash };
}

export type ChainVerification =
  | { ok: true; count: number; last_entry_hash: Hex64 }
  | {
      ok: false;
      reason:
        | 'empty_chain'
        | 'genesis_prev_not_zero'
        | 'prev_hash_mismatch'
        | 'entry_hash_mismatch'
        | 'seq_not_monotonic'
        | 'schema_version_mismatch';
      seq: number | null;
      detail: string;
    };

/**
 * Verify a chain in memory: recompute each entry's hash, check `prev_hash`
 * links, check `seq` is monotonic. Returns the first failure noisily.
 *
 * Empty chain is an error — callers verifying a journal they expected
 * to contain entries should not silently accept an empty list.
 */
export function verifyChain(entries: SpinJournalEntry[]): ChainVerification {
  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'empty_chain',
      seq: null,
      detail: 'verifyChain called with zero entries',
    };
  }
  let prevHash: Hex64 = ZERO_HASH;
  let prevSeq = -1;
  for (const e of entries) {
    if (e.schema_version !== RECALL_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: 'schema_version_mismatch',
        seq: e.seq,
        detail: `expected ${RECALL_SCHEMA_VERSION}, got ${e.schema_version}`,
      };
    }
    if (e.seq <= prevSeq) {
      return {
        ok: false,
        reason: 'seq_not_monotonic',
        seq: e.seq,
        detail: `seq ${e.seq} ≤ previous ${prevSeq}`,
      };
    }
    if (e.prev_hash !== prevHash) {
      return {
        ok: false,
        reason: prevSeq === -1 ? 'genesis_prev_not_zero' : 'prev_hash_mismatch',
        seq: e.seq,
        detail: `expected prev_hash ${prevHash}, got ${e.prev_hash}`,
      };
    }
    // Recompute the hash.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { entry_hash: _ignored, ...withoutHash } = e;
    const want = computeEntryHash(withoutHash);
    if (want !== e.entry_hash) {
      return {
        ok: false,
        reason: 'entry_hash_mismatch',
        seq: e.seq,
        detail: `recomputed ${want}, stored ${e.entry_hash}`,
      };
    }
    prevHash = e.entry_hash;
    prevSeq = e.seq;
  }
  return { ok: true, count: entries.length, last_entry_hash: prevHash };
}
