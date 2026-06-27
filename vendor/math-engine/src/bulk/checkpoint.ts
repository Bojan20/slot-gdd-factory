/**
 * Faza 9.8 — TS-side checkpoint I/O. Mirrors
 * `rust-sim::bulk::checkpoint` so a checkpoint written by either
 * engine resumes cleanly on the other.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { BulkCheckpoint } from './types.js';

export const CHECKPOINT_SCHEMA_VERSION = '1.0.0';

/** Atomic save: temp file → rename. Crash mid-write keeps the prior
 *  checkpoint intact. */
export function saveCheckpoint(path: string, chk: BulkCheckpoint): void {
  if (chk.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    throw new Error(
      `saveCheckpoint: schemaVersion ${chk.schemaVersion} != ${CHECKPOINT_SCHEMA_VERSION}`,
    );
  }
  // tempfile sibling — same directory so rename is atomic on most fs.
  const tmpName = path.endsWith('.ckpt') ? path + '.tmp' : path + '.ckpt.tmp';
  writeFileSync(tmpName, JSON.stringify(chk, null, 2));
  renameSync(tmpName, path);
}

export function loadCheckpoint(path: string): BulkCheckpoint | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as BulkCheckpoint;
  if (parsed.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    throw new Error(
      `loadCheckpoint: schema version ${parsed.schemaVersion} != ${CHECKPOINT_SCHEMA_VERSION}`,
    );
  }
  return parsed;
}

/** Test helper — produce a unique path under the OS temp dir. */
export function tempCheckpointPath(prefix = 'slot-bulk'): string {
  const stamp = `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return join(tmpdir(), `${stamp}.ckpt`);
}
