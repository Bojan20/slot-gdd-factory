#!/usr/bin/env node
/**
 * W213 Faza 700.1 — CDN distribution prep.
 *
 * Simulates upload of per-operator pitch tarballs to a private CDN (Cloudflare
 * R2 / S3 style) by mirroring the layout under `dist/cdn/`.
 *
 *   dist/cdn/
 *     index.json                                 — directory of all bundles
 *     pitch/lw/v20260518.tar.gz                  — canonical operator path
 *     pitch/lw/v20260518.tar.gz.manifest.json
 *     pitch/lw/v20260518.tar.gz.signed-url.json  — TTL-signed URL stub
 *     pitch/aristocrat/v20260518.tar.gz
 *     ...
 *
 * Each upload entry records:
 *   - operatorId, bundleVersion, url, size, sha256
 *   - uploadedAt, expiresAt, ttlSeconds
 *   - signature (a stable HMAC-style stub so verifyCdnIndex can detect tamper)
 *
 * Pure Node stdlib. No real network IO.
 *
 * Exports:
 *   - distributeToCdn({ tarballs, root, base, defaultTtlSec })
 *   - buildCdnIndex(entries)
 *   - generateSignedUrl({ operatorId, bundleVersion, format, ttlSec, baseUrl })
 *   - verifyCdnIndex(index)
 */

import { promises as fs, existsSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

export const DEFAULT_CDN_ROOT = resolve(REPO_ROOT, 'dist/cdn');
export const DEFAULT_BASE_URL = 'https://cdn.slotmath.example/pitch';
export const CDN_INDEX_SCHEMA = 'pitch-cdn-index-v1';
export const URL_SIGNING_SALT = 'slot-math-engine-cdn-signing-salt-v1';
export const DEFAULT_TTL_SEC = 7 * 86_400; // 7 days

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function generateSignedUrl(opts) {
  const {
    operatorId,
    bundleVersion,
    format = 'tar.gz',
    ttlSec = DEFAULT_TTL_SEC,
    baseUrl = DEFAULT_BASE_URL,
    now = new Date().toISOString(),
    salt = URL_SIGNING_SALT,
  } = opts;
  if (!operatorId) throw new Error('generateSignedUrl: operatorId required');
  if (!bundleVersion) throw new Error('generateSignedUrl: bundleVersion required');
  const expiresEpoch = Math.floor(new Date(now).getTime() / 1000) + ttlSec;
  const path = `/${operatorId}/${bundleVersion}.${format}`;
  const canonical = `${baseUrl}${path}|expires=${expiresEpoch}`;
  const sig = createHmac('sha256', salt).update(canonical).digest('hex').slice(0, 32);
  return {
    url: `${baseUrl}${path}?expires=${expiresEpoch}&sig=${sig}`,
    expiresAt: new Date(expiresEpoch * 1000).toISOString(),
    expiresEpoch,
    ttlSec,
    signature: sig,
  };
}

export async function distributeToCdn(opts = {}) {
  const root = resolve(opts.root ?? DEFAULT_CDN_ROOT);
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const defaultTtl = opts.defaultTtlSec ?? DEFAULT_TTL_SEC;
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? new Date().toISOString();
  const tarballs = opts.tarballs ?? [];

  if (!Array.isArray(tarballs) || tarballs.length === 0) {
    throw new Error('distributeToCdn: tarballs array is required');
  }

  const entries = [];
  for (const t of tarballs) {
    const operatorId = t.operatorId ?? 'lw';
    const bundleVersion = t.bundleVersion;
    const format = t.format ?? 'tar.gz';
    if (!bundleVersion) throw new Error(`distributeToCdn: bundleVersion required for ${operatorId}`);
    let data = t.data;
    let manifestBytes = t.manifestBytes ?? null;
    if (!data && t.sourcePath) {
      data = await fs.readFile(t.sourcePath);
    }
    if (!data) throw new Error(`distributeToCdn: data/sourcePath required for ${operatorId}`);
    const sha = sha256Hex(data);
    const signed = generateSignedUrl({ operatorId, bundleVersion, format, ttlSec: t.ttlSec ?? defaultTtl, baseUrl, now });
    const entry = {
      operatorId,
      bundleVersion,
      format,
      size: data.length,
      sha256: sha,
      url: signed.url,
      uploadedAt: now,
      expiresAt: signed.expiresAt,
      ttlSec: signed.ttlSec,
      signature: signed.signature,
      cdnPath: `pitch/${operatorId}/${bundleVersion}.${format}`,
    };
    entries.push(entry);

    if (!dryRun) {
      const dir = resolve(root, 'pitch', operatorId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolve(dir, `${bundleVersion}.${format}`), data);
      if (manifestBytes) {
        await fs.writeFile(resolve(dir, `${bundleVersion}.${format}.manifest.json`), manifestBytes);
      }
      await fs.writeFile(
        resolve(dir, `${bundleVersion}.${format}.signed-url.json`),
        JSON.stringify(signed, null, 2) + '\n'
      );
    }
  }

  const index = buildCdnIndex(entries, { generatedAt: now });
  if (!dryRun) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(resolve(root, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  }
  return { root, entries, index };
}

export function buildCdnIndex(entries, opts = {}) {
  const sorted = [...entries].sort((a, b) => a.operatorId.localeCompare(b.operatorId));
  return {
    schema: CDN_INDEX_SCHEMA,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    operatorCount: new Set(sorted.map((e) => e.operatorId)).size,
    bundleCount: sorted.length,
    totalSizeBytes: sorted.reduce((s, e) => s + e.size, 0),
    bundles: sorted,
  };
}

export function verifyCdnIndex(index) {
  if (!index || index.schema !== CDN_INDEX_SCHEMA) {
    return { ok: false, reason: 'unknown schema' };
  }
  const issues = [];
  for (const b of index.bundles ?? []) {
    const expected = createHmac('sha256', URL_SIGNING_SALT)
      .update(b.url.split('?')[0] + `|expires=${b.url.match(/expires=(\d+)/)?.[1]}`)
      .digest('hex')
      .slice(0, 32);
    if (b.signature !== expected) {
      issues.push(`${b.operatorId}/${b.bundleVersion}: signature mismatch`);
    }
    if (b.size <= 0) issues.push(`${b.operatorId}/${b.bundleVersion}: zero size`);
    if (!/^[0-9a-f]{64}$/.test(b.sha256)) issues.push(`${b.operatorId}/${b.bundleVersion}: bad sha`);
  }
  return { ok: issues.length === 0, issues, bundleCount: index.bundles?.length ?? 0 };
}

// ─── CLI ─────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'help';
  if (cmd === 'help' || cmd === '--help') {
    process.stdout.write(
      'cdn-distribute — simulate per-operator CDN uploads\n\n' +
        'Usage:\n' +
        '  cdn-distribute prep [--src-dir=dist/pitch] [--out=dist/cdn]\n' +
        '\n'
    );
  } else if (cmd === 'prep') {
    const srcArg = args.find((a) => a.startsWith('--src-dir='));
    const outArg = args.find((a) => a.startsWith('--out='));
    const srcDir = resolve(srcArg ? srcArg.slice(10) : 'dist/pitch');
    const outDir = resolve(outArg ? outArg.slice(6) : DEFAULT_CDN_ROOT);
    if (!existsSync(srcDir)) {
      console.error('cdn-distribute: src-dir not found:', srcDir);
      process.exit(2);
    }
    const files = (await fs.readdir(srcDir)).filter((n) => /\.tar\.gz$|\.zip$|\.tar$/.test(n));
    const tarballs = files.map((name) => {
      const m = name.match(/slot-math-engine-pitch-(?:([a-z0-9_-]+)-)?(v\d+[a-zA-Z0-9._-]*)-[a-z0-9]+\.(tar\.gz|zip|tar)$/);
      return {
        operatorId: m?.[1] ?? 'lw',
        bundleVersion: m?.[2] ?? 'unknown',
        format: m?.[3] ?? 'tar.gz',
        sourcePath: resolve(srcDir, name),
      };
    });
    const r = await distributeToCdn({ tarballs, root: outDir });
    console.log(`cdn-distribute: prepared ${r.entries.length} bundles → ${r.root}`);
    for (const e of r.entries) {
      console.log(`  ${e.operatorId}/${e.bundleVersion}.${e.format} (${e.size} bytes)`);
    }
  } else {
    console.error('cdn-distribute: unknown command', cmd);
    process.exit(2);
  }
}
