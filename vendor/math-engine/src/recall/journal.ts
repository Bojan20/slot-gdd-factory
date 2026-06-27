/**
 * Journal writers / readers — `MemoryJournal` and `NdjsonFileJournal`.
 *
 * Both expose the same `Journal` interface so callers (engine
 * simulator, replay tooling, tests) pick storage at construction and
 * never branch on it after.
 *
 * The on-disk format is NDJSON: one entry per line, UTF-8, append-only.
 * No JSON-array wrapping — that would require rewriting the file's
 * closing `]` on every append, which defeats "append-only".
 */

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync, renameSync } from 'fs';
import type {
  Hex64,
  JournalManifest,
  SchemaVersion,
  SpinJournalEntry,
} from './types.js';
import { RECALL_SCHEMA_VERSION, ZERO_HASH } from './types.js';
import { sealEntry, sealManifest, verifyChain } from './integrity.js';

/**
 * Minimal storage interface. `head_hash` is the running chain tail —
 * callers do not pass it; the journal tracks it.
 */
export interface Journal {
  /** Append a finalized entry. The journal stamps `prev_hash` +
   * `entry_hash` for you given the entry minus those two fields. */
  append(draft: Omit<SpinJournalEntry, 'prev_hash' | 'entry_hash'>): SpinJournalEntry;
  /** Read all entries (memory journal). FileJournal also supports
   * streaming via `iterate` for large files. */
  readAll(): SpinJournalEntry[];
  /** Current chain head (last `entry_hash`) or `null` if empty. */
  head(): Hex64 | null;
  /** Number of entries written so far. */
  size(): number;
  /** Produce a manifest pinning the current state. */
  buildManifest(): JournalManifest;
}

// ─── MemoryJournal ─────────────────────────────────────────────────────

export class MemoryJournal implements Journal {
  private entries: SpinJournalEntry[] = [];
  private headHash: Hex64 | null = null;
  private nextSeq = 0;

  append(draft: Omit<SpinJournalEntry, 'prev_hash' | 'entry_hash'>): SpinJournalEntry {
    if (draft.seq !== this.nextSeq) {
      throw new Error(`MemoryJournal: expected seq ${this.nextSeq}, got ${draft.seq}`);
    }
    if (draft.schema_version !== RECALL_SCHEMA_VERSION) {
      throw new Error(
        `MemoryJournal: schema_version mismatch (want ${RECALL_SCHEMA_VERSION}, got ${draft.schema_version})`,
      );
    }
    const sealed = sealEntry(draft, this.headHash);
    this.entries.push(sealed);
    this.headHash = sealed.entry_hash;
    this.nextSeq++;
    return sealed;
  }

  readAll(): SpinJournalEntry[] {
    return this.entries.slice();
  }

  head(): Hex64 | null {
    return this.headHash;
  }

  size(): number {
    return this.entries.length;
  }

  buildManifest(): JournalManifest {
    return buildManifestFor(this.entries, '<memory>');
  }
}

// ─── NdjsonFileJournal ─────────────────────────────────────────────────

export class NdjsonFileJournal implements Journal {
  private headHash: Hex64 | null = null;
  private nextSeq = 0;
  private count = 0;
  private rotationMaxBytes: number;

  /**
   * @param path Path to the NDJSON file. If it exists, the journal
   *   recovers its head + seq counter from the last line.
   * @param rotationMaxBytes Rotate when the file crosses this size.
   *   The new file's first entry's `prev_hash` chains from the rotated
   *   one. Default 256 MiB.
   */
  constructor(
    private readonly path: string,
    rotationMaxBytes = 256 * 1024 * 1024,
  ) {
    this.rotationMaxBytes = rotationMaxBytes;
    this.recover();
  }

  private recover(): void {
    if (!existsSync(this.path)) return;
    const raw = readFileSync(this.path, 'utf8');
    if (raw.length === 0) return;
    const lines = raw.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) return;
    for (const line of lines) {
      const e = JSON.parse(line) as SpinJournalEntry;
      // Streaming verification — fail loud on tampered tail.
      if (e.prev_hash !== (this.headHash ?? ZERO_HASH)) {
        throw new Error(
          `NdjsonFileJournal.recover: chain break at seq ${e.seq} — expected prev_hash ${this.headHash ?? ZERO_HASH}, got ${e.prev_hash}`,
        );
      }
      if (e.seq !== this.nextSeq) {
        throw new Error(
          `NdjsonFileJournal.recover: seq gap at line — expected ${this.nextSeq}, got ${e.seq}`,
        );
      }
      this.headHash = e.entry_hash;
      this.nextSeq = e.seq + 1;
      this.count++;
    }
  }

  append(draft: Omit<SpinJournalEntry, 'prev_hash' | 'entry_hash'>): SpinJournalEntry {
    if (draft.seq !== this.nextSeq) {
      throw new Error(
        `NdjsonFileJournal: expected seq ${this.nextSeq}, got ${draft.seq}`,
      );
    }
    const sealed = sealEntry(draft, this.headHash);
    const line = JSON.stringify(sealed) + '\n';
    appendFileSync(this.path, line, 'utf8');
    this.headHash = sealed.entry_hash;
    this.nextSeq++;
    this.count++;
    this.maybeRotate();
    return sealed;
  }

  private maybeRotate(): void {
    try {
      const bytes = statSync(this.path).size;
      if (bytes < this.rotationMaxBytes) return;
    } catch {
      return;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = this.path.replace(/(\.ndjson)?$/, `-${ts}.ndjson`);
    renameSync(this.path, rotatedPath);
    // New file inherits the chain tail — first entry's `prev_hash`
    // will equal `this.headHash`, so the chain stays unbroken across
    // rotations. We leave `nextSeq` continuous so consumers walking
    // both files see a single monotonic sequence.
  }

  readAll(): SpinJournalEntry[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, 'utf8');
    if (raw.length === 0) return [];
    return raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as SpinJournalEntry);
  }

  head(): Hex64 | null {
    return this.headHash;
  }

  size(): number {
    return this.count;
  }

  buildManifest(): JournalManifest {
    return buildManifestFor(this.readAll(), this.path);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function buildManifestFor(
  entries: SpinJournalEntry[],
  journalFile: string,
): JournalManifest {
  if (entries.length === 0) {
    return sealManifest({
      schema_version: RECALL_SCHEMA_VERSION as SchemaVersion,
      engine_version: getEngineVersion(),
      journal_file: journalFile,
      first_seq: 0,
      last_seq: -1,
      first_timestamp_utc: '',
      last_timestamp_utc: '',
      last_entry_hash: ZERO_HASH,
    });
  }
  // Verifying as we manifest is cheap and catches drift before a
  // regulator does.
  const ver = verifyChain(entries);
  if (!ver.ok) {
    throw new Error(`buildManifest: chain verification failed at seq=${ver.seq}: ${ver.detail}`);
  }
  const first = entries[0];
  const last = entries[entries.length - 1];
  return sealManifest({
    schema_version: RECALL_SCHEMA_VERSION as SchemaVersion,
    engine_version: getEngineVersion(),
    journal_file: journalFile,
    first_seq: first.seq,
    last_seq: last.seq,
    first_timestamp_utc: first.timestamp_utc,
    last_timestamp_utc: last.timestamp_utc,
    last_entry_hash: last.entry_hash,
  });
}

/**
 * Engine version surfaced into every manifest. Pulled from the
 * package.json at build time would be cleanest but the engine doesn't
 * ship a build step — keep this as a single source-of-truth constant.
 */
export function getEngineVersion(): string {
  // Keep in sync with rust-sim/Cargo.toml `version`.
  return '0.5.0';
}

/** Write a manifest atomically (write to .tmp + rename). */
export function writeManifest(path: string, manifest: JournalManifest): void {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  renameSync(tmp, path);
}

/** Load a manifest, return `null` if file missing. */
export function readManifest(path: string): JournalManifest | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as JournalManifest;
}
