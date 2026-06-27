#!/usr/bin/env node
/**
 * W212 Faza 800.0 — Pitch Tarball Bundler — verifier.
 *
 * CLI:
 *   npm run pitch:verify <tarball-path>
 *   node scripts/pitch/verify-pitch-tarball.mjs <tarball-path>
 *
 * Extracts the archive into a temporary directory, parses MANIFEST.json,
 * recomputes SHA-256 over every listed file, and reports any mismatch,
 * missing file, or extra file.
 *
 * Exit codes:
 *   0  → every file present + every hash matches
 *   1  → at least one tampered, missing, or extra entry
 *   2  → archive corrupt or MANIFEST.json missing
 *
 * Pure Node 18+ stdlib (node:crypto + node:zlib + node:fs.promises).
 * Supports .tar.gz, .tgz, .tar, and .zip archives.
 */

import { promises as fs, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

export const VERDICT_OK = 'OK';
export const VERDICT_FAIL = 'FAIL';
export const VERDICT_CORRUPT = 'CORRUPT';

export function parseArgs(argv) {
  const a = { tarball: null, verbose: false, json: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--verbose') a.verbose = true;
    else if (arg === '--json') a.json = true;
    else if (!a.tarball) a.tarball = arg;
  }
  return a;
}

// ─── archive readers (decompress + extract) ────────────────────────────

export function parseTar(buf) {
  if (buf.length < 512) {
    throw new Error('tar corrupt: input shorter than one 512-byte header block');
  }
  const entries = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    // EOF on two consecutive zero blocks (or first zero block in many tars).
    if (header.every((b) => b === 0)) break;
    // Validate ustar magic at offset 257 ("ustar" or "ustar  ").
    const magic = bufString(header, 257, 5);
    if (magic !== 'ustar') {
      throw new Error(`tar corrupt: missing ustar magic at offset ${off}`);
    }
    const name = bufString(header, 0, 100).replace(/\0+$/, '').replace(/ +$/, '');
    if (!name) break;
    const sizeOctal = bufString(header, 124, 12).replace(/\0+$/, '').trim();
    const size = parseInt(sizeOctal, 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`tar corrupt: bad size for ${name}`);
    }
    off += 512;
    const data = buf.subarray(off, off + size);
    entries.push({ path: name, data: Buffer.from(data) });
    off += size;
    const pad = (512 - (size % 512)) % 512;
    off += pad;
  }
  return entries;
}

function bufString(buf, start, len) {
  return buf.subarray(start, start + len).toString('utf8');
}

export function parseZip(buf) {
  // Locate EOCD by scanning the last 64KiB for the signature 0x06054b50.
  const sigEocd = 0x06054b50;
  let eocdOff = -1;
  const minSearch = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minSearch; i--) {
    if (buf.readUInt32LE(i) === sigEocd) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error('zip corrupt: EOCD not found');
  const totalEntries = buf.readUInt16LE(eocdOff + 10);
  const cdSize = buf.readUInt32LE(eocdOff + 12);
  const cdOff = buf.readUInt32LE(eocdOff + 16);
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`zip corrupt: central dir entry ${i} bad sig`);
    }
    const compressionMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (compressionMethod !== 0) {
      throw new Error(`zip ${name}: only stored (method=0) supported (got ${compressionMethod})`);
    }
    // Read local header to find data offset.
    if (buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new Error(`zip corrupt: local header at ${localOff} bad sig`);
    }
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + lhNameLen + lhExtraLen;
    const data = buf.subarray(dataOff, dataOff + uncompressedSize);
    if (data.length !== uncompressedSize) {
      throw new Error(`zip corrupt: short read for ${name}`);
    }
    entries.push({ path: name, data: Buffer.from(data) });
    // (compressedSize unused since method=0 means compressed===uncompressed)
    void compressedSize;
  }
  return entries;
}

export function extractArchive(tarballPath, buf) {
  const lower = tarballPath.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return parseTar(gunzipSync(buf));
  }
  if (lower.endsWith('.tar')) return parseTar(buf);
  if (lower.endsWith('.zip')) return parseZip(buf);
  // Sniff magic bytes as a fallback.
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return parseTar(gunzipSync(buf));
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return parseZip(buf);
  return parseTar(buf);
}

// ─── verifier core ────────────────────────────────────────────────────

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function verifyEntries(entries) {
  const manifestEntry = entries.find((e) => e.path.endsWith('MANIFEST.json'));
  if (!manifestEntry) {
    return {
      verdict: VERDICT_CORRUPT,
      reason: 'MANIFEST.json missing',
      filesChecked: 0,
      tampered: [],
      missing: [],
      extra: [],
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch (e) {
    return {
      verdict: VERDICT_CORRUPT,
      reason: `MANIFEST.json parse error: ${e.message}`,
      filesChecked: 0,
      tampered: [],
      missing: [],
      extra: [],
    };
  }
  if (!Array.isArray(manifest.files)) {
    return {
      verdict: VERDICT_CORRUPT,
      reason: 'MANIFEST.json missing "files" array',
      filesChecked: 0,
      tampered: [],
      missing: [],
      extra: [],
    };
  }
  const wanted = new Map(manifest.files.map((f) => [f.path, f]));
  const seen = new Set();
  const tampered = [];
  const extra = [];
  for (const entry of entries) {
    if (entry.path === manifestEntry.path) continue;
    const expect = wanted.get(entry.path);
    if (!expect) {
      extra.push(entry.path);
      continue;
    }
    seen.add(entry.path);
    const got = sha256Hex(entry.data);
    if (got !== expect.sha256) {
      tampered.push({ path: entry.path, expected: expect.sha256, actual: got });
    }
    if (entry.data.length !== expect.size) {
      tampered.push({ path: entry.path, expected: expect.size, actual: entry.data.length, kind: 'size' });
    }
  }
  const missing = [];
  for (const path of wanted.keys()) {
    if (!seen.has(path)) missing.push(path);
  }
  // Ignore the embedded verify.mjs from the "missing" calc explicitly.
  const verdict =
    tampered.length === 0 && missing.length === 0 && extra.length === 0
      ? VERDICT_OK
      : VERDICT_FAIL;
  return {
    verdict,
    manifest,
    filesChecked: seen.size,
    tampered,
    missing,
    extra,
  };
}

export async function verifyTarball(tarballPath) {
  if (!existsSync(tarballPath)) {
    return { verdict: VERDICT_CORRUPT, reason: `not found: ${tarballPath}` };
  }
  const buf = await fs.readFile(tarballPath);
  let entries;
  try {
    entries = extractArchive(tarballPath, buf);
  } catch (e) {
    return { verdict: VERDICT_CORRUPT, reason: `extract failed: ${e.message}` };
  }
  return verifyEntries(entries);
}

// ─── CLI ──────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv);
  if (!a.tarball) {
    console.error('usage: pitch:verify <tarball-path>');
    process.exit(2);
  }
  verifyTarball(a.tarball).then((r) => {
    if (a.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    } else {
      if (r.verdict === VERDICT_OK) {
        console.log(`OK ${r.filesChecked} files verified in ${a.tarball}`);
      } else if (r.verdict === VERDICT_CORRUPT) {
        console.error(`CORRUPT ${a.tarball}: ${r.reason}`);
      } else {
        console.error(`FAIL ${a.tarball}: tampered=${r.tampered.length} missing=${r.missing.length} extra=${r.extra.length}`);
        if (a.verbose) {
          for (const t of r.tampered) console.error('  tampered:', t.path);
          for (const m of r.missing) console.error('  missing:', m);
          for (const x of r.extra) console.error('  extra:', x);
        }
      }
    }
    process.exit(r.verdict === VERDICT_OK ? 0 : r.verdict === VERDICT_CORRUPT ? 2 : 1);
  }).catch((err) => {
    console.error('FAILED', err);
    process.exit(2);
  });
}
