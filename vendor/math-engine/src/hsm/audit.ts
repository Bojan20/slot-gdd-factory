/**
 * Append-only HSM audit log implementations.
 *
 * Two flavours:
 *   - `JsonlAuditLog` — writes JSONL to a file path. fsync per record.
 *   - `InMemoryAuditLog` — keeps records in memory, no persistence.
 *     Test-only.
 *
 * Operators wanting Splunk / S3 / CloudWatch can implement their own
 * `AuditLog` — the interface is intentionally tiny.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { open } from 'node:fs/promises';
import { HsmError, type AuditLog, type AuditRecord } from './types.js';

export class InMemoryAuditLog implements AuditLog {
  private readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push({ ...record });
  }

  async *read(): AsyncIterable<AuditRecord> {
    for (const r of this.records) yield r;
  }

  async size(): Promise<number> {
    return this.records.length;
  }

  /** Test-only — snapshot the current state. */
  snapshot(): AuditRecord[] {
    return [...this.records];
  }
}

export class JsonlAuditLog implements AuditLog {
  private readonly path: string;
  private count = 0;

  constructor(path: string) {
    this.path = path;
  }

  async append(record: AuditRecord): Promise<void> {
    // Defensive: ensure parent dir exists. We tolerate the directory
    // existing race-freely (idempotent mkdir).
    await fs.mkdir(dirname(this.path), { recursive: true });
    const line = JSON.stringify(record) + '\n';
    // Open with O_APPEND + sync, write, close. Each call is atomic on
    // POSIX for writes ≤ PIPE_BUF (4 KiB) — our records are well under.
    let handle: import('node:fs/promises').FileHandle | null = null;
    try {
      handle = await open(this.path, 'a');
      await handle.appendFile(line, 'utf8');
      // fsync the file so the record is durable before the sign call
      // returns to the caller. This is the difference between a real
      // audit log and a buffered debug log.
      await handle.sync();
      this.count++;
    } catch (err) {
      throw new HsmError('AuditWriteFailure', `failed to append audit record: ${String(err)}`, { cause: err });
    } finally {
      if (handle) await handle.close().catch(() => undefined);
    }
  }

  async *read(): AsyncIterable<AuditRecord> {
    let text: string;
    try {
      text = await fs.readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      yield JSON.parse(line) as AuditRecord;
    }
  }

  async size(): Promise<number> {
    if (this.count > 0) return this.count;
    // Cold-start: count by reading. Cheap unless the log is huge.
    try {
      const text = await fs.readFile(this.path, 'utf8');
      this.count = text.split('\n').filter((l) => l.trim()).length;
      return this.count;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }
  }
}
