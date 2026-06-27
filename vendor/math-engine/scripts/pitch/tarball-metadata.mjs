#!/usr/bin/env node
/**
 * W212 Faza 800.0 — Pitch Tarball Bundler — metadata module.
 *
 * Generates the structured MANIFEST.json contents for a pitch tarball
 * bundle. Pure Node stdlib (node:crypto + node:fs.promises).
 *
 * Exports:
 *   - sha256Hex(buf)
 *   - guessMimeType(path)
 *   - hashFileEntry({ bundlePath, data })
 *   - resolveGitInfo({ root })
 *   - buildManifest({ entries, engineVersion, bundleVersion, format, root, timestamp, signature? })
 *
 * The manifest schema (versioned: pitch-tarball-manifest-v1) records
 * every included file's path, size, sha256, mime-type, plus top-level
 * counts and the bundle's git/engine identity. Re-running with the same
 * git commit + same timestamp + same entry list MUST produce the same
 * manifest bytes (deterministic).
 */

import { createHash } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const MANIFEST_SCHEMA = 'pitch-tarball-manifest-v1';

export const MIME_BY_EXT = Object.freeze({
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
});

export function guessMimeType(path) {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  const ext = lower.slice(dot);
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function hashFileEntry(entry) {
  const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
  return {
    path: entry.bundlePath,
    size: data.length,
    sha256: sha256Hex(data),
    mime: guessMimeType(entry.bundlePath),
  };
}

export async function resolveGitInfo(opts = {}) {
  const root = opts.root ?? process.cwd();
  const info = {
    commit: process.env.GIT_SHA ?? 'unknown',
    commitShort: 'unknown',
    branch: process.env.GIT_BRANCH ?? 'unknown',
  };
  // Try read .git/HEAD + ref file (no shelling out — pure fs).
  try {
    const headPath = resolve(root, '.git', 'HEAD');
    if (existsSync(headPath)) {
      const head = (await fs.readFile(headPath, 'utf8')).trim();
      if (head.startsWith('ref: ')) {
        const ref = head.slice(5);
        info.branch = ref.replace(/^refs\/heads\//, '');
        const refPath = resolve(root, '.git', ref);
        if (existsSync(refPath)) {
          info.commit = (await fs.readFile(refPath, 'utf8')).trim();
        } else {
          // packed-refs fallback
          const packed = resolve(root, '.git', 'packed-refs');
          if (existsSync(packed)) {
            const text = await fs.readFile(packed, 'utf8');
            for (const line of text.split('\n')) {
              if (line.includes(ref)) {
                info.commit = line.split(/\s+/)[0];
                break;
              }
            }
          }
        }
      } else {
        info.commit = head;
        info.branch = 'detached';
      }
    }
  } catch {
    /* leave defaults */
  }
  info.commitShort = (info.commit ?? 'unknown').slice(0, 8);
  return info;
}

export function buildManifest(opts) {
  const {
    entries,
    engineVersion,
    bundleVersion,
    format,
    git,
    timestamp,
    signature = null,
    operator = null,
    intendedAudience = null,
    pricingTier = null,
    expiresAt = null,
    verifyHint = 'Run `npm run pitch:verify <tarball>` to validate this bundle.',
  } = opts;
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  if (!engineVersion) throw new TypeError('engineVersion required');
  if (!bundleVersion) throw new TypeError('bundleVersion required');
  if (!format) throw new TypeError('format required');
  if (!git) throw new TypeError('git info required');
  if (!timestamp) throw new TypeError('timestamp required');

  const files = entries.map(hashFileEntry).sort((a, b) => a.path.localeCompare(b.path));
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const manifest = {
    schema: MANIFEST_SCHEMA,
    bundleVersion,
    engineVersion,
    format,
    git: {
      commit: git.commit,
      commitShort: git.commitShort,
      branch: git.branch,
    },
    generatedAt: timestamp,
    counts: {
      fileCount: files.length,
      totalSizeBytes: totalSize,
    },
    files,
    verifyHint,
  };
  if (operator) manifest.operator = operator;
  if (intendedAudience) manifest.intendedAudience = intendedAudience;
  if (pricingTier) manifest.pricingTier = pricingTier;
  if (expiresAt) manifest.expiresAt = expiresAt;
  if (signature) manifest.signature = signature;
  return manifest;
}

/** Compute a default expiration timestamp `daysAhead` (default 90) days
 *  past `fromIso`. Returns an ISO-8601 string. */
export function computeExpiresAt(fromIso, daysAhead = 90) {
  const base = new Date(fromIso ?? new Date().toISOString());
  const ms = base.getTime() + daysAhead * 86_400_000;
  return new Date(ms).toISOString();
}

export function manifestToJsonBytes(manifest) {
  return Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export function deriveBundleFilename({ bundleVersion, commitShort, format, operatorId = null }) {
  const safeVer = String(bundleVersion).replace(/[^a-z0-9._-]+/gi, '-');
  const safeSha = String(commitShort).replace(/[^a-z0-9]+/gi, '');
  if (operatorId && operatorId !== 'lw') {
    const safeOp = String(operatorId).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    return `slot-math-engine-pitch-${safeOp}-${safeVer}-${safeSha}.${format}`;
  }
  return `slot-math-engine-pitch-${safeVer}-${safeSha}.${format}`;
}
