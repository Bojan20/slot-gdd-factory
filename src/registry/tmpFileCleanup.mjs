/**
 * src/registry/tmpFileCleanup.mjs
 *
 * Wave UQ-FORTIFY2 G3 — orphan `.tmp.<pid>` cleanup helper.
 *
 * When ingest / trainer atomic writes (writeFile to tmp → rename to dest)
 * are interrupted (SIGKILL, OOM, panic, parent CTRL-C), the tmp file
 * lingers in the same directory. After enough crashes the cache dir
 * fills with `.tmp.<pid>` zombies that point at dead PIDs.
 *
 * Cleanup policy:
 *   - File must match `*.tmp.<pid>` pattern (digits after last dot)
 *   - File must be older than 5 minutes (so an in-flight write isn't
 *     mistaken for orphan)
 *   - File's `<pid>` must not be a running process
 *
 * Called opportunistically at start of trainer + ingest runs. Pure
 * best-effort — failures swallowed so a permission denied on a single
 * file doesn't block the real work.
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, basename } from 'node:path';

/**
 * @param {string[]} dirs — absolute paths to scan
 * @param {object} [opts]
 * @param {number} [opts.minAgeMs=5*60*1000] — only delete files older than this
 * @returns {{ scanned: number, deleted: number, kept: number, errors: number }}
 */
export function cleanupOrphanTmps(dirs, opts) {
  const minAge = (opts && opts.minAgeMs) || 5 * 60 * 1000;
  const out = { scanned: 0, deleted: 0, kept: 0, errors: 0 };
  const now = Date.now();
  for (const dir of dirs) {
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const m = name.match(/\.tmp\.(\d+)$/);
      if (!m) continue;
      out.scanned++;
      const pid = parseInt(m[1], 10);
      const path = resolve(dir, name);
      let st;
      try { st = statSync(path); } catch { out.errors++; continue; }
      const ageMs = now - st.mtimeMs;
      if (ageMs < minAge) { out.kept++; continue; }
      /* Cheap PID liveness check — kill(pid, 0) throws ESRCH if pid is dead.
       * Wrap in try since we may not have permission (cross-user). When in
       * doubt: keep the file. */
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch (e) {
        if (e.code === 'EPERM') { alive = true; }
        /* ESRCH or other → assume dead */
      }
      if (alive) { out.kept++; continue; }
      try { unlinkSync(path); out.deleted++; } catch { out.errors++; }
    }
  }
  return out;
}
