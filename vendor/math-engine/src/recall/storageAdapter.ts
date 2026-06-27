/**
 * W152 Wave 16 — Pluggable storage backend adapters for spin recall journal.
 *
 * The base `Journal` interface (in `journal.ts`) speaks "appended NDJSON
 * to a single file". That works on a single host but doesn't compose with:
 *   * S3 / GCS / Azure Blob — operator wants journal in object storage
 *     for durable cross-region replication.
 *   * IPFS / Filecoin — operator wants content-addressed, tamper-evident
 *     publication for crypto-casino settings.
 *   * SQLite / Postgres / DynamoDB — operator wants random-access query
 *     by spin signature, not just sequential append.
 *
 * The right shape is a `StorageAdapter` interface that the journal
 * delegates batch flushes to. The journal still owns hash-chaining,
 * sealing, and seq tracking — the adapter only sees finished
 * `SpinJournalEntry` records and decides where to put them.
 *
 * Three reference adapters ship in this module:
 *
 *   1. `MemoryStorageAdapter`        — in-process, zero I/O, for tests
 *      and ephemeral demo runs. Backed by a plain array.
 *
 *   2. `ShardedFsStorageAdapter`     — local filesystem, sharded by
 *      ISO-date prefix (`2026-05-15/000.ndjson`). Better than a single
 *      growing file for forensic queries ("show me all spins on day X")
 *      and supports rotation by both date AND row count.
 *
 *   3. `PluggableUploaderAdapter`    — the polymorphism point for
 *      S3/IPFS/SQLite. Caller supplies an async `upload(bytes, key)`
 *      callback; adapter buffers entries, batch-flushes on threshold,
 *      and tracks delivery status per batch. Failed uploads are
 *      retained in-memory until a retry succeeds — operator never
 *      loses a spin to transient cloud outage.
 *
 * Why callback-based for the cloud path: keeps this module zero-deps
 * (no aws-sdk, no ipfs-http-client). Operator wires their own SDK once
 * and the engine stays portable.
 */

import { mkdirSync, appendFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { SpinJournalEntry, JournalManifest, Hex64 } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Adapter contract
// ═══════════════════════════════════════════════════════════════════════════

export interface StorageAdapter {
  /**
   * Persist a sealed entry. Returns void on success; throws on a fatal
   * write error. Adapters that batch internally MUST track the entry
   * even before the actual I/O completes — `flush()` and `pendingCount()`
   * give the caller visibility.
   */
  store(entry: SpinJournalEntry): void | Promise<void>;
  /** Total entries successfully persisted (excluding pending). */
  storedCount(): number;
  /** Entries accepted but not yet flushed to backing store. */
  pendingCount(): number;
  /** Force any buffered entries through to backing store. */
  flush(): void | Promise<void>;
  /** Persist a manifest snapshot. Optional — backends that don't need
   * manifest publication (e.g. in-memory test adapter) may no-op. */
  storeManifest?(manifest: JournalManifest): void | Promise<void>;
  /** Read all stored entries (for verification / replay). Backends that
   * are write-only (e.g. one-way IPFS publish) may throw. */
  readAll(): SpinJournalEntry[] | Promise<SpinJournalEntry[]>;
}

// ═══════════════════════════════════════════════════════════════════════════
// MemoryStorageAdapter
// ═══════════════════════════════════════════════════════════════════════════

export class MemoryStorageAdapter implements StorageAdapter {
  private entries: SpinJournalEntry[] = [];
  private manifests: JournalManifest[] = [];

  store(entry: SpinJournalEntry): void {
    this.entries.push(entry);
  }
  storedCount(): number {
    return this.entries.length;
  }
  pendingCount(): number {
    return 0;
  }
  flush(): void {
    /* no-op — memory adapter writes synchronously */
  }
  storeManifest(manifest: JournalManifest): void {
    this.manifests.push(manifest);
  }
  readAll(): SpinJournalEntry[] {
    return this.entries.slice();
  }
  /** Test inspector: most-recent manifest, or null if none. */
  lastManifest(): JournalManifest | null {
    return this.manifests.length === 0 ? null : this.manifests[this.manifests.length - 1];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ShardedFsStorageAdapter
// ═══════════════════════════════════════════════════════════════════════════

export interface ShardedFsOptions {
  /** Base directory. Created if missing. */
  baseDir: string;
  /** ISO-date provider so tests can pin "today". Default `() => new Date()`. */
  clock?: () => Date;
  /** Max entries per shard file before rotation. Default 100_000. */
  maxEntriesPerShard?: number;
}

export class ShardedFsStorageAdapter implements StorageAdapter {
  private readonly baseDir: string;
  private readonly clock: () => Date;
  private readonly maxEntriesPerShard: number;
  private currentShardKey: string | null = null;
  private currentShardCount = 0;
  private currentShardIndex = 0;
  private storedTotal = 0;

  constructor(opts: ShardedFsOptions) {
    this.baseDir = opts.baseDir;
    this.clock = opts.clock ?? (() => new Date());
    this.maxEntriesPerShard = opts.maxEntriesPerShard ?? 100_000;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private isoDate(): string {
    const d = this.clock();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private currentShardPath(): string {
    const date = this.isoDate();
    if (this.currentShardKey !== date) {
      // Date rolled over → start a new shard at index 0.
      this.currentShardKey = date;
      this.currentShardCount = 0;
      this.currentShardIndex = 0;
    } else if (this.currentShardCount >= this.maxEntriesPerShard) {
      // Same date, max rows hit → roll over to next index within the day.
      this.currentShardIndex++;
      this.currentShardCount = 0;
    }
    const shardDir = join(this.baseDir, this.currentShardKey);
    if (!existsSync(shardDir)) {
      mkdirSync(shardDir, { recursive: true });
    }
    const idx = String(this.currentShardIndex).padStart(3, '0');
    return join(shardDir, `${idx}.ndjson`);
  }

  store(entry: SpinJournalEntry): void {
    const path = this.currentShardPath();
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
    this.currentShardCount++;
    this.storedTotal++;
  }
  storedCount(): number {
    return this.storedTotal;
  }
  pendingCount(): number {
    return 0;
  }
  flush(): void {
    /* writes are synchronous via appendFileSync */
  }
  storeManifest(manifest: JournalManifest): void {
    const path = join(this.baseDir, 'MANIFEST.json');
    appendFileSync(path, JSON.stringify(manifest) + '\n', 'utf-8');
  }
  readAll(): SpinJournalEntry[] {
    const out: SpinJournalEntry[] = [];
    if (!existsSync(this.baseDir)) return out;
    const dateDirs = readdirSync(this.baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    for (const dateDir of dateDirs) {
      const fullDateDir = join(this.baseDir, dateDir);
      const shards = readdirSync(fullDateDir).filter((f) => f.endsWith('.ndjson')).sort();
      for (const shard of shards) {
        const text = readFileSync(join(fullDateDir, shard), 'utf-8');
        for (const line of text.split('\n')) {
          if (line.trim() === '') continue;
          out.push(JSON.parse(line) as SpinJournalEntry);
        }
      }
    }
    return out;
  }
  /** Test inspector: list shard relative paths in chronological order. */
  listShards(): string[] {
    if (!existsSync(this.baseDir)) return [];
    const out: string[] = [];
    const dateDirs = readdirSync(this.baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    for (const d of dateDirs) {
      for (const f of readdirSync(join(this.baseDir, d)).sort()) {
        if (f.endsWith('.ndjson')) out.push(`${d}/${f}`);
      }
    }
    return out;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PluggableUploaderAdapter — for S3 / IPFS / SQLite via callback
// ═══════════════════════════════════════════════════════════════════════════

export interface PluggableUploaderOptions {
  /** Caller-provided uploader. Receives a UTF-8 NDJSON byte string and
   *  a stable key (e.g. `2026-05-15/batch-000042.ndjson`). Must return
   *  a promise that resolves on success or rejects on transient error. */
  upload: (bytes: string, key: string) => Promise<void>;
  /** Flush after this many entries are buffered. Default 1000. */
  batchSize?: number;
  /** Key prefix joiner. Default `slot-recall/`. */
  keyPrefix?: string;
  /** Clock for date-based key partitioning. Default `() => new Date()`. */
  clock?: () => Date;
}

interface PendingBatch {
  key: string;
  entries: SpinJournalEntry[];
  attempts: number;
  lastError?: string;
}

export class PluggableUploaderAdapter implements StorageAdapter {
  private readonly upload: PluggableUploaderOptions['upload'];
  private readonly batchSize: number;
  private readonly keyPrefix: string;
  private readonly clock: () => Date;
  private buffer: SpinJournalEntry[] = [];
  private pendingBatches: PendingBatch[] = [];
  private storedTotal = 0;
  private batchCounter = 0;
  /** First store() timestamp seen — for buffer time-tracking, optional use. */
  private firstBufferTs: number | null = null;

  constructor(opts: PluggableUploaderOptions) {
    this.upload = opts.upload;
    this.batchSize = opts.batchSize ?? 1000;
    this.keyPrefix = opts.keyPrefix ?? 'slot-recall/';
    this.clock = opts.clock ?? (() => new Date());
  }

  store(entry: SpinJournalEntry): void {
    this.buffer.push(entry);
    if (this.firstBufferTs === null) this.firstBufferTs = this.clock().getTime();
    if (this.buffer.length >= this.batchSize) {
      // Move buffer to pending; actual upload deferred to flush() call —
      // keeping store() synchronous so the engine hot-path doesn't await.
      this.queueBufferAsBatch();
    }
  }

  private queueBufferAsBatch(): void {
    if (this.buffer.length === 0) return;
    const d = this.clock();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const idx = String(this.batchCounter++).padStart(6, '0');
    const key = `${this.keyPrefix}${yyyy}-${mm}-${dd}/batch-${idx}.ndjson`;
    this.pendingBatches.push({ key, entries: this.buffer, attempts: 0 });
    this.buffer = [];
    this.firstBufferTs = null;
  }

  async flush(): Promise<void> {
    // Move any open buffer into a final batch.
    if (this.buffer.length > 0) this.queueBufferAsBatch();
    // Drain pending batches in order.
    while (this.pendingBatches.length > 0) {
      const batch = this.pendingBatches[0];
      const bytes = batch.entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      try {
        await this.upload(bytes, batch.key);
        this.storedTotal += batch.entries.length;
        this.pendingBatches.shift();
      } catch (e) {
        batch.attempts++;
        batch.lastError = e instanceof Error ? e.message : String(e);
        // Bail out — caller will retry flush() later. We never lose entries.
        throw new Error(
          `PluggableUploaderAdapter: upload failed for key '${batch.key}' (attempt ${batch.attempts}): ${batch.lastError}`,
        );
      }
    }
  }

  storedCount(): number {
    return this.storedTotal;
  }
  pendingCount(): number {
    return this.buffer.length + this.pendingBatches.reduce((s, b) => s + b.entries.length, 0);
  }
  async storeManifest(manifest: JournalManifest): Promise<void> {
    const d = this.clock();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const key = `${this.keyPrefix}${yyyy}-${mm}-${dd}/MANIFEST-${manifest.last_entry_hash.slice(0, 16)}.json`;
    await this.upload(JSON.stringify(manifest) + '\n', key);
  }
  readAll(): never {
    throw new Error(
      'PluggableUploaderAdapter is write-through — readAll() is not supported. Use a separate downloader against the backing store.',
    );
  }
  /** Test inspector: peek pending batch metadata without forcing flush. */
  inspectPending(): { key: string; size: number; attempts: number; lastError?: string }[] {
    return this.pendingBatches.map((b) => ({
      key: b.key,
      size: b.entries.length,
      attempts: b.attempts,
      lastError: b.lastError,
    }));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Adapter-aware journal wrapper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lightweight wrapper that delegates to a `StorageAdapter` while still
 * tracking head-hash and seq locally. This lets a caller use any of the
 * 3 adapters without re-implementing chain-sealing logic.
 *
 * NOT a full `Journal` (no `buildManifest()` here — that lives in
 * `journal.ts` and depends on engine version metadata). Use this when
 * you want pluggable storage but don't need the full Journal surface.
 */
export class AdapterBackedSink {
  private headHash: Hex64 | null = null;
  private nextSeq = 0;

  constructor(private readonly adapter: StorageAdapter) {}

  /** Push a sealed entry into the adapter and update local head/seq. */
  pushSealed(entry: SpinJournalEntry): void {
    if (entry.seq !== this.nextSeq) {
      throw new Error(`AdapterBackedSink: expected seq ${this.nextSeq}, got ${entry.seq}`);
    }
    void this.adapter.store(entry);
    this.headHash = entry.entry_hash;
    this.nextSeq++;
  }

  head(): Hex64 | null {
    return this.headHash;
  }
  size(): number {
    return this.nextSeq;
  }
  pendingCount(): number {
    return this.adapter.pendingCount();
  }
  async flush(): Promise<void> {
    await this.adapter.flush();
  }
}
