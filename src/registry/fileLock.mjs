/**
 * src/registry/fileLock.mjs
 *
 * Wave UQ-FORTIFY2 G4 — file-level mutex for cache write safety.
 *
 * Two ingest processes running the same `--slug` concurrently can race on
 * `tools/_wave-v-cache/<slug>.json`: process A finishes Kimi, stamps hash;
 * process B reads stale cache mid-stamp. We avoid the race with a sidecar
 * lock file (`<target>.lock`) that holds the PID + timestamp of the writer.
 *
 * Lock acquisition policy:
 *   - Create `<target>.lock` with `wx` flag — fails if file exists
 *   - On success: write PID + ISO timestamp, return release token
 *   - On conflict: check if lock holder is alive (process.kill(pid, 0))
 *     and lock is < `maxAgeMs` old; otherwise steal the lock
 *   - Caller MUST call release(token) — finally block recommended
 *
 * NOT atomic across NFS / network filesystems — local-only.
 * Wraps node:fs sync primitives so it's safe inside spawnSync chains.
 */
import { writeFileSync, openSync, closeSync, unlinkSync, readFileSync, existsSync, statSync } from 'node:fs';

const DEFAULT_MAX_AGE_MS = 60 * 1000; /* 60s — Kimi rarely runs longer */
const POLL_INTERVAL_MS = 100;
const MAX_WAIT_MS = 30 * 1000;

/* Wave UQ-FORTIFY4 H3 — network/synced filesystem detection.
 * Locks rely on `openSync(path, 'wx')` atomicity which is NOT preserved
 * across NFS, SMB, Dropbox, iCloud, OneDrive synced trees. We probe the
 * path against a curated list of mount-point fragments common on macOS
 * and Linux. If detected, we emit a one-time warning on first
 * acquireLock call so the operator can move the cache off the synced
 * folder if needed. Lock still tries — degraded but better than blocking. */
const _NETWORK_MOUNT_HINTS = [
  '/Dropbox/', '/iCloud Drive/', '/Library/Mobile Documents/',
  '/OneDrive', '/Google Drive/', '/Box/', '/Sync/',
  '/.smb/', '/Volumes/',   /* macOS network mounts */
  '/mnt/',                  /* Linux network mounts */
  '/nfs/',
];
let _nfsWarned = false;
function _maybeWarnNetworkMount(path) {
  if (_nfsWarned) return;
  for (const hint of _NETWORK_MOUNT_HINTS) {
    if (path.includes(hint)) {
      _nfsWarned = true;
      try {
        process.stderr.write(
          `[fileLock] ⚠ path looks like a network / synced mount: ${path}\n` +
          `[fileLock]   lock atomicity may degrade. Consider moving cache to local disk.\n`
        );
      } catch {}
      return;
    }
  }
}

/**
 * Acquire an exclusive lock for `targetPath`. Returns a release token
 * (opaque string) that MUST be passed to releaseLock. Throws on timeout.
 *
 * @param {string} targetPath
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs] — steal lock older than this
 * @param {number} [opts.maxWaitMs] — give up after this much waiting
 * @returns {{ lockPath: string, pid: number }} release token
 */
export function acquireLock(targetPath, opts = {}) {
  /* H3 — detect synced/network filesystem and warn once. */
  _maybeWarnNetworkMount(targetPath);
  const lockPath = targetPath + '.lock';
  const maxAge = opts.maxAgeMs || DEFAULT_MAX_AGE_MS;
  const maxWait = opts.maxWaitMs || MAX_WAIT_MS;
  const start = Date.now();
  /* Sync poll loop. Cheaper than async for a tool that already runs sync. */
  while (true) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        /* UQ-FORTIFY3 #7 — stamp acquiredAt (epoch ms) so the stale-
           lock detector can cross-check against mtime drift. */
        const payload = JSON.stringify({
          pid: process.pid,
          ts: new Date().toISOString(),
          acquiredAt: Date.now(),
        });
        writeFileSync(fd, payload);
      } finally {
        closeSync(fd);
      }
      return { lockPath, pid: process.pid };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      /* Lock exists — check if stale (holder dead OR lock too old). */
      let stolen = false;
      try {
        const st = statSync(lockPath);
        const ageMs = Date.now() - st.mtimeMs;
        let holderAlive = true;
        let pidMismatch = false;
        try {
          const raw = readFileSync(lockPath, 'utf8');
          const meta = JSON.parse(raw);
          if (meta && Number.isFinite(meta.pid)) {
            try { process.kill(meta.pid, 0); } catch (k) {
              if (k.code === 'ESRCH') holderAlive = false;
            }
            /* UQ-FORTIFY3 #7 — PID-reuse guard.
               If the PID space wraps (high-PID Linux boxes after many
               days uptime) the old lock's PID could be reused by an
               unrelated process. signal(0) would say "alive" but the
               process isn't actually our lock holder. Cross-check the
               lock-file mtime against meta.acquiredAt: if the lock is
               older than half maxAge AND the recorded acquiredAt is
               older than the actual file mtime by > 1s, treat the lock
               as untrustworthy (PID likely reused by an unrelated
               process and the original holder died before mtime drift). */
            if (holderAlive && Number.isFinite(meta.acquiredAt)) {
              const recordedAgeMs = Date.now() - meta.acquiredAt;
              const mtimeMs = st.mtimeMs;
              if (recordedAgeMs > maxAge / 2 && Math.abs(mtimeMs - meta.acquiredAt) > 1000) {
                pidMismatch = true;
              }
            }
          }
        } catch { /* corrupt lock — treat as stale */ holderAlive = false; }
        if (!holderAlive || pidMismatch || ageMs > maxAge) {
          /* Steal: remove + retry */
          try { unlinkSync(lockPath); stolen = true; } catch { /* benign race */ }
        }
      } catch { /* stat failed → lock vanished, retry */ }
      if (stolen) continue;
      if (Date.now() - start > maxWait) {
        throw new Error('fileLock: timeout acquiring ' + lockPath);
      }
      /* UQ-FORTIFY6 #2 — proper kernel-level wait, NOT a CPU spin.
         The original `while (Date.now() < end)` was pure busy-loop;
         under high contention (e.g. --all-corpus 338 ingests) it would
         pin a core at 100 % for the full poll interval. Atomics.wait on
         a throwaway SharedArrayBuffer is the only sync primitive Node
         exposes that actually parks the thread on the kernel scheduler.
         Falls back to a single Date.now() spin guard if Atomics is
         disabled (older environments / sandboxed runtimes). */
      try {
        const sab = new SharedArrayBuffer(4);
        const view = new Int32Array(sab);
        /* wait on slot 0 for value 0 — returns 'timed-out' after the
           interval; we never notify so it always times out cleanly. */
        Atomics.wait(view, 0, 0, POLL_INTERVAL_MS);
      } catch (_) {
        /* Fallback: shorter spin so we don't burn the full interval. */
        const end = Date.now() + Math.min(POLL_INTERVAL_MS, 25);
        while (Date.now() < end) { /* fallback spin */ }
      }
    }
  }
}

/**
 * Release a previously acquired lock. Safe to call even if the lock
 * file is already gone (idempotent).
 *
 * @param {{ lockPath: string, pid: number }} token
 */
export function releaseLock(token) {
  if (!token || !token.lockPath) return;
  try {
    if (existsSync(token.lockPath)) {
      /* Defensive: verify we own the lock before deleting (avoid deleting
       * a lock another process just stole). */
      try {
        const meta = JSON.parse(readFileSync(token.lockPath, 'utf8'));
        if (meta && meta.pid && meta.pid !== token.pid) return;
      } catch { /* corrupt — fall through and delete */ }
      unlinkSync(token.lockPath);
    }
  } catch { /* benign */ }
}

/**
 * Convenience wrapper: run `fn` while holding the lock, releasing
 * even on throw.
 */
export function withLock(targetPath, fn, opts) {
  const token = acquireLock(targetPath, opts);
  try { return fn(); } finally { releaseLock(token); }
}
