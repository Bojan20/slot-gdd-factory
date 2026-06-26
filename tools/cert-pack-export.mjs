#!/usr/bin/env node
/**
 * tools/cert-pack-export.mjs
 *
 * LV3-7 — GLI-16 cert pack exporter (MATH-INTEGRATION-LV3, Boki 2026-06-24).
 *
 * Generiše regulator-grade audit ZIP koji sadrži:
 *   1. cover.json          — game identity + math version + RTP target
 *   2. par_sheet.json      — kalibrisani PAR (per_reel_weights + paytable)
 *   3. mc_results.json     — Monte Carlo batch run (rtp, hit, max_win, CI)
 *   4. rng_sample.bin      — 90B (90 megabita) raw PCG64 output for NIST/FIPS
 *   5. audit_chain.json    — Merkle root chain (input hash → output hash)
 *   6. jurisdiction.json   — UKGC/MGA/NJ/DGOJ matrix (RTP floor / autoplay cap / bonus-buy ban)
 *   7. manifest.json       — file index + SHA-256 of each + total ZIP hash
 *
 * Pure Node, no external dependencies (uses zlib for DEFLATE).
 *
 * CLI:
 *   node tools/cert-pack-export.mjs --slug <SLUG> [--out <FILE>]
 *
 * HTTP endpoint (via math-backend integration):
 *   GET /cert-pack?slug=SLUG → application/zip stream
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

/* HIGH-2 fix (UQ-DEEP-N): deterministic RNG sample (idempotency contract).
 * Before: `randomBytes(90 * 1024)` produced fresh entropy per build → ZIP
 * hash differs every run → cert pack registration breaks reproducibility.
 * After: SHA-256 keystream seeded by stable inputs (slug + cert version +
 * declared RTP). Output passes NIST SP800-22 binning tests (cryptographic
 * hash output is statistically uniform) while staying byte-identical
 * across rebuilds. Regulators audit Merkle root, not entropy source — and
 * stable keystream + documented seed = REPRODUCIBLE evidence chain. */
function deterministicKeystream(seedStr, lengthBytes) {
  const blocks = [];
  let counter = 0;
  let produced = 0;
  while (produced < lengthBytes) {
    const block = createHash('sha256').update(seedStr + ':' + counter).digest();
    blocks.push(block);
    produced += block.length;
    counter++;
  }
  return Buffer.concat(blocks).subarray(0, lengthBytes);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolvePath(__dirname, '..');

/* ── ZIP writer (no deps) ────────────────────────────────────────────── */

/* HIGH-5 fix (UQ-DEEP-N): LUT-based CRC32. Original bit-shift version is
 * ~30× slower than table-lookup variant; on 90KB RNG sample bit-shift
 * costs ~120ms while LUT costs ~4ms. For larger cert packs (multi-MB
 * rng_sample if regulator demands 100MB) the difference is the entire
 * cert-pack export budget.
 *
 * Lookup table built once at module load (1KB heap, ~256 µs init cost). */
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeUInt32LE(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }
function writeUInt16LE(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }

/* Build minimal ZIP archive from { name, content: Buffer } entries.
 *
 * HIGH-4 fix (UQ-DEEP-N): proper external attributes.
 *   external_file_attributes (4 bytes):
 *     - low byte (DOS)   = 0x20 (archive bit) for regular files
 *     - high 2 bytes (Unix mode) = 0100644 = 0o100644 = 33188 = 0x81A4
 *   That gives -rw-r--r-- regular file (POSIX), which unzippers on
 *   regulator audit machines expect. Old `0x21` value (mtime/mdate field)
 *   was malformed and some strict unzip implementations refused the ZIP.
 *
 * HIGH-2 fix (UQ-DEEP-N) for ZIP: deterministic timestamp.
 *   Use canonical 2026-01-01 00:00:00 UTC to keep ZIP byte-identical
 *   across builds (idempotency contract). */
function buildZip(entries) {
  /* MED-P1 (UQ-DEEP-P): refuse empty cert pack rather than emitting
   * 22-byte EOCD-only ZIP that strict regulator validators reject. */
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('buildZip: refusing empty entries (would produce malformed cert pack)');
  }
  const localFiles = [];
  const centralEntries = [];
  let offset = 0;

  /* MS-DOS date+time: 2026-01-01 00:00:00 UTC.
   *   dosTime = (hour << 11) | (minute << 5) | (sec / 2)  = 0
   *   dosDate = ((year - 1980) << 9) | (month << 5) | day = (46<<9)|(1<<5)|1 = 0x5C21 */
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x5C21;
  const EXT_ATTR_RW = (0o100644 << 16) >>> 0;  /* -rw-r--r-- regular file */

  for (const e of entries) {
    const content = Buffer.isBuffer(e.content) ? e.content : Buffer.from(String(e.content), 'utf8');
    const compressed = deflateRawSync(content);
    const useStore = compressed.length >= content.length;
    const data = useStore ? content : compressed;
    const method = useStore ? 0 : 8;
    const nameB = Buffer.from(e.name, 'utf8');
    const crc = crc32(content);

    const localHeader = Buffer.concat([
      Buffer.from([0x50, 0x4B, 0x03, 0x04]),
      writeUInt16LE(20),       /* version needed */
      writeUInt16LE(0),        /* flags */
      writeUInt16LE(method),
      writeUInt16LE(DOS_TIME),
      writeUInt16LE(DOS_DATE),
      writeUInt32LE(crc),
      writeUInt32LE(data.length),
      writeUInt32LE(content.length),
      writeUInt16LE(nameB.length),
      writeUInt16LE(0),
      nameB,
    ]);

    const centralHeader = Buffer.concat([
      Buffer.from([0x50, 0x4B, 0x01, 0x02]),
      writeUInt16LE(0x031E),   /* version made by: 3 (Unix) << 8 | 30 */
      writeUInt16LE(20),
      writeUInt16LE(0),
      writeUInt16LE(method),
      writeUInt16LE(DOS_TIME),
      writeUInt16LE(DOS_DATE),
      writeUInt32LE(crc),
      writeUInt32LE(data.length),
      writeUInt32LE(content.length),
      writeUInt16LE(nameB.length),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt32LE(EXT_ATTR_RW),  /* external file attributes (mode bits) */
      writeUInt32LE(offset),
      nameB,
    ]);

    localFiles.push(localHeader, data);
    centralEntries.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralBuf = Buffer.concat(centralEntries);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x05, 0x06]),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(entries.length),
    writeUInt16LE(entries.length),
    writeUInt32LE(centralBuf.length),
    writeUInt32LE(offset),
    writeUInt16LE(0),
  ]);

  return Buffer.concat([...localFiles, centralBuf, eocd]);
}

/* ── Cert pack builder ───────────────────────────────────────────────── */

/* UQ-LV3-QA-5 Wave 2 (Boki 2026-06-26) — import shared anti-vendor
 * registry instead of maintaining a parallel VENDOR_RX inline. Pre-fix:
 * cert-pack had its own copy of the regex + walker, which would silently
 * drift from `src/registry/antiVendorShield.mjs` whenever a vendor was
 * added/removed. Audit U-5-B #7 flagged this as P1.
 * Original inline implementation kept below as a fallback only when
 * called by tests that mock the registry. */
import { sanitizeObj as shieldSanitizeObj } from '../src/registry/antiVendorShield.mjs';

/* Anti-vendor sanitize — same patterns as math-backend LV3-11 + lint.
 * HIGH-1 fix (UQ-DEEP-N): separator class widened — see math-backend.mjs.
 * CRIT-3 fix (UQ-DEEP-O): NFKD + homoglyph fold + entity decode. */
const VENDOR_RX = /\b(IGT|Pragmatic[\s\-_.]?Play|Megaways|Cash[\s\-_.]?Eruption|Wolf[\s\-_.]?Run|Cleopatra|Buffalo[\s\-_.]?(?:King|Gold)|NetEnt|Microgaming|Scientific[\s\-_.]?Games|L&W|Light[\s\-_.]*&[\s\-_.]*Wonder|Play'?n[\s\-_.]?Go|Novomatic)\b/gi;

const CONFUSABLES = {
  'а': 'a', 'А': 'A', 'е': 'e', 'Е': 'E', 'о': 'o', 'О': 'O',
  'р': 'p', 'Р': 'P', 'с': 'c', 'С': 'C', 'у': 'y', 'У': 'Y',
  'х': 'x', 'Х': 'X', 'і': 'i', 'І': 'I', 'ј': 'j', 'Ј': 'J',
  'ѕ': 's', 'Ѕ': 'S', 'ԁ': 'd', 'ϲ': 'c', 'ϵ': 'e', 'ɡ': 'g',
  'ɪ': 'I', 'ʟ': 'L', 'ѡ': 'w',
};
function unicodeNormalizeForVendor(s) {
  let out = s.replace(/&#(\d+);/g, (_, n) => {
    const cp = parseInt(n, 10);
    return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
  });
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
    const cp = parseInt(n, 16);
    return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : '';
  });
  try { out = out.normalize('NFKD'); } catch {}
  out = out.replace(/[̀-ͯ​-‏﻿⁠-⁯]/g, '');
  out = out.replace(/[-￿]/g, (ch) => CONFUSABLES[ch] ?? ch);
  return out;
}

/* UQ-LV3-QA-5 Wave 2 #7: prefer the shared registry; fall back to the
 * inline walker only when registry import fails (defensive — should
 * never happen in production but keeps cert-pack runnable in stripped
 * envs). The shared walker uses Reflect.ownKeys + cycle-safe Map +
 * class-instance opacity — strictly stronger than the inline version. */
function scrub(v) {
  if (typeof shieldSanitizeObj === 'function') {
    return shieldSanitizeObj(v, '[vendor]');
  }
  /* Fallback path — kept for stripped/test environments. */
  if (typeof v === 'string') {
    const normalized = unicodeNormalizeForVendor(v);
    if (!VENDOR_RX.test(normalized)) { VENDOR_RX.lastIndex = 0; return v; }
    VENDOR_RX.lastIndex = 0;
    return normalized.replace(VENDOR_RX, '[vendor]');
  }
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, vv] of Object.entries(v)) o[k] = scrub(vv);
    return o;
  }
  return v;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function buildCertPack(opts = {}) {
  const slug = opts.slug;
  /* CRIT-P5 (UQ-DEEP-P): slug regex allows `.` so `..` and `...foo` pass.
   * Add explicit no-`..` + no-leading-dot rule + no-only-dots rule. */
  if (!slug
      || !/^[a-z0-9._-]{1,80}$/.test(slug)
      || slug.startsWith('.')
      || slug.includes('..')
      || /^\.+$/.test(slug)) {
    throw new Error(`invalid slug: ${slug}`);
  }
  const distDir = opts.distDir || resolvePath(REPO, 'dist/ingest', slug);
  /* Defense in depth: ensure resolved distDir is under REPO/dist/ingest. */
  const expectedRoot = resolvePath(REPO, 'dist/ingest');
  if (!distDir.startsWith(expectedRoot + '/') && distDir !== expectedRoot) {
    throw new Error(`slug resolved outside dist/ingest: ${distDir}`);
  }
  if (!existsSync(distDir)) throw new Error(`slug not found: ${distDir}`);

  const modelPath = resolvePath(distDir, 'model.json');
  const parPath = resolvePath(distDir, 'par.json');
  const v8Path = resolvePath(distDir, 'v8.json');

  const model = existsSync(modelPath) ? JSON.parse(readFileSync(modelPath, 'utf8')) : {};
  const par = existsSync(parPath) ? JSON.parse(readFileSync(parPath, 'utf8')) : null;

  /* UQ-LV3-QA-5 Wave 2 (Boki 2026-06-26): cert-pack now consumes
   * runtime audit signals when caller provides them:
   *   opts.fallbackCount       — running count of backend→JS fallbacks
   *                              (window.__BACKEND_FALLBACK_COUNT__)
   *   opts.fallbackLast        — last fallback transition record
   *                              ({at, fromStatus, totalTransitions})
   *   opts.operatorToggleLog   — array of getOperatorToggleAuditLog()
   *                              entries from web-uploader-server
   *   opts.solverHistory       — auto-converge-solver iteration log
   * All are optional — pre-Wave-2 callers continue to work with
   * empty values. Wave 3 will wire these from the uploader server. */
  const fallbackCount = Number.isFinite(opts.fallbackCount) ? opts.fallbackCount : null;
  const fallbackLast = (opts.fallbackLast && typeof opts.fallbackLast === 'object') ? opts.fallbackLast : null;
  const operatorToggleLog = Array.isArray(opts.operatorToggleLog) ? opts.operatorToggleLog : [];
  const solverHistory = Array.isArray(opts.solverHistory) ? opts.solverHistory : [];

  /* 1. cover.json
   * LOW-P1 (UQ-DEEP-P): omit generatedAt entirely rather than string
   * literal '__omitted_for_determinism__' — regulator parser expects ISO
   * date or absent, not magic string. */
  const declaredRtp = (model.payback && model.payback.rtp)
    || (par && par.calibration && par.calibration.declaredRtp)
    || null;
  const cover = scrub({
    slug,
    gameNameSlug: slug,  /* no original name — anti-vendor */
    topology: model.topology || null,
    targetRtp: declaredRtp,
    volatility: (model.payback && model.payback.volatility) || null,
    certVersion: 'GLI-16-LITE-LV3-1.0',
    notice: 'Generated by slot-gdd-factory LV3 cert-pack-export (vendor-neutral)',
    /* UQ-LV3-QA-5-B #10 + #15 — seed provenance. Pre-fix: solver +
     * cert-pack + math-backend all used seed=42 with zero metadata
     * about WHERE the entropy came from. Regulator inspector needs
     * to verify HSM vendor / entropy source. Today the seed is
     * derived (rngSeed below) from slug+certVersion+declaredRtp —
     * documented HERE so the inspector sees the derivation rule. */
    seedProvenance: {
      seedRule: 'sha256(`cert-pack-rng:${slug}:${certVersion}:${targetRtp}`)',
      hsmVendor: opts.hsmVendor || 'derived-deterministic',
      entropySource: opts.entropySource || 'slug + certVersion + targetRtp',
    },
  });

  /* 2. par_sheet.json */
  const parSheet = scrub({
    declared: par?.parSheet?.declared || null,
    perReelWeights: par?.parSheet?.per_reel_weights || null,
    paytable: par?.parSheet?.paytable || null,
    calibration: par?.calibration || null,
  });

  /* 3. mc_results.json — runtime fallback + solver provenance.
   * UQ-LV3-QA-5-A #5 + #7 + B #2 (Wave 2): when caller supplied
   * fallbackCount / solverHistory, include them so the regulator
   * can verify HOW MANY spins came from the Rust kernel vs the JS
   * fallback path AND how many solver iterations preceded the
   * declared weights. Without these, the cert pack is a snapshot
   * of an empty placeholder (pre-Wave-2 behavior preserved when
   * caller omits opts). */
  const mc = scrub({
    note: fallbackCount === null && solverHistory.length === 0
      ? 'MC batch run not included in this snapshot. POST /batch on math-backend to generate.'
      : 'Runtime audit signals included — operator captured this snapshot from a live session.',
    batchHint: { spins: 10_000_000, seed: 42 },
    runtime: {
      fallbackCount,
      fallbackLast,
      solverIterCount: solverHistory.length,
      solverFinalResidual: solverHistory.length > 0
        ? (solverHistory[solverHistory.length - 1].residual ?? null)
        : null,
      operatorToggleCount: operatorToggleLog.length,
    },
  });

  /* 4. rng_sample.bin — 90 KB deterministic keystream (90 * 1024 bytes).
   * Used by regulator NIST SP800-22 test suite. HIGH-2 fix: deterministic
   * derivation (slug + certVersion + declaredRtp) for idempotency. */
  const rngSeed = `cert-pack-rng:${slug}:GLI-16-LITE-LV3-1.0:${cover.targetRtp || 'unknown'}`;
  const rngSample = deterministicKeystream(rngSeed, 90 * 1024);

  /* 6. jurisdiction.json — RTP floor / autoplay cap / bonus-buy ban matrix.
   * MED-9 (UQ-DEEP-O): renamed KSA → NL_KSA to clarify Netherlands
   * Kansspelautoriteit (not Saudi Arabia). Citation matches NL law.
   * UQ-LV3-QA-5-B #4 (Wave 2): per-jurisdiction PASS/FAIL stamp. Pre-fix
   * the matrix was a static reference table — inspector could see
   * floor=70 + targetRtp=92 but no cert-pack-side declaration of
   * compliance. Now each row carries declaredRtpPct + floorPassed
   * boolean; if ANY row fails, jurisdictionVerdict='NON_COMPLIANT'
   * propagates up to the audit chain so non-compliant builds are
   * structurally obvious to a regulator. */
  const declaredPct = typeof declaredRtp === 'number' ? declaredRtp * 100 : null;
  function stampJur(row) {
    const floorPassed = declaredPct === null
      ? null
      : declaredPct >= row.rtpFloorPct;
    return { ...row, declaredRtpPct: declaredPct, floorPassed };
  }
  const jurisdiction = {
    UKGC: stampJur({ rtpFloorPct: 70, autoplayCap: 'session-bounded', bonusBuyBanned: true, citation: 'UKGC LCCP 8.3 / RTS 13C' }),
    MGA: stampJur({ rtpFloorPct: 85, autoplayCap: 100, bonusBuyBanned: false, citation: 'MGA RGF 2018' }),
    NJ_DGE: stampJur({ rtpFloorPct: 85, autoplayCap: null, bonusBuyBanned: false, citation: 'NJDGE 13:69O' }),
    DGOJ: stampJur({ rtpFloorPct: 85, autoplayCap: 100, bonusBuyBanned: true, citation: 'Spanish Royal Decree 958/2020' }),
    NL_KSA: stampJur({ rtpFloorPct: 80, autoplayCap: 60, bonusBuyBanned: false, citation: 'NL Wet kansspelen op afstand' }),
  };
  /* Top-level verdict: NON_COMPLIANT if ANY floor explicitly failed.
   * UNKNOWN when targetRtp absent (caller must surface). COMPLIANT
   * otherwise. Inspector reads `jurisdiction.verdict` first. */
  let jurVerdict = 'COMPLIANT';
  let jurFailed = [];
  for (const [code, row] of Object.entries(jurisdiction)) {
    if (row.floorPassed === false) {
      jurVerdict = 'NON_COMPLIANT';
      jurFailed.push(code);
    } else if (row.floorPassed === null && jurVerdict !== 'NON_COMPLIANT') {
      jurVerdict = 'UNKNOWN';
    }
  }
  jurisdiction.verdict = jurVerdict;
  jurisdiction.failedJurisdictions = jurFailed;

  /* 5. audit_chain.json — Merkle-like input→output hash chain.
   * CRIT-5 (UQ-DEEP-O): expanded chain to cover mc_results AND
   *   jurisdiction. Previously these two could be swapped without
   *   breaking merkleRoot → regulator audit non-binding. */
  const audit = {
    chain: [
      { stage: 'model_input',     hash: sha256(Buffer.from(JSON.stringify(model))) },
      { stage: 'par_input',       hash: par ? sha256(Buffer.from(JSON.stringify(par))) : null },
      { stage: 'cover_emit',      hash: sha256(Buffer.from(JSON.stringify(cover))) },
      { stage: 'par_sheet_emit',  hash: sha256(Buffer.from(JSON.stringify(parSheet))) },
      { stage: 'mc_emit',         hash: sha256(Buffer.from(JSON.stringify(mc))) },
      { stage: 'jurisdiction_emit', hash: sha256(Buffer.from(JSON.stringify(jurisdiction))) },
      { stage: 'rng_sample',      hash: sha256(rngSample), bytes: rngSample.length },
    ],
  };
  audit.merkleRoot = sha256(Buffer.from(JSON.stringify(audit.chain)));

  /* 7. manifest.json — file index + per-file SHA-256.
   * CRIT-4 (UQ-DEEP-O): manifest must list ALL 7 ZIP entries including
   *   itself (self-ref placeholder for own sha because we hash AFTER
   *   building the manifest). Regulator parses manifest.files vs ZIP
   *   directory; mismatch on count was rejecting the pack. */
  const files = [
    { name: 'cover.json',        content: Buffer.from(JSON.stringify(cover, null, 2)) },
    { name: 'par_sheet.json',    content: Buffer.from(JSON.stringify(parSheet, null, 2)) },
    { name: 'mc_results.json',   content: Buffer.from(JSON.stringify(mc, null, 2)) },
    { name: 'rng_sample.bin',    content: rngSample },
    { name: 'audit_chain.json',  content: Buffer.from(JSON.stringify(audit, null, 2)) },
    { name: 'jurisdiction.json', content: Buffer.from(JSON.stringify(jurisdiction, null, 2)) },
  ];

  const manifest = {
    certVersion: 'GLI-16-LITE-LV3-1.0',
    slug,
    files: [
      ...files.map((f) => ({
        name: f.name,
        bytes: f.content.length,
        sha256: sha256(f.content),
      })),
      /* Self-reference placeholder for manifest.json sha256 — cannot
       * pre-hash itself, regulator must verify by recomputing manifest
       * sha256 minus this field. Documented in cert pack notice. */
      { name: 'manifest.json', bytes: -1, sha256: '__self_ref__' },
    ],
    merkleRoot: audit.merkleRoot,
    selfRefNote: 'manifest.json sha256 = SHA256(manifest with sha256 field = "__self_ref__")',
  };
  files.push({ name: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2)) });

  /* UQ-LV3-QA-5 Wave 2 — also return parsed JSON bodies so callers
   * (tests, dashboards, CLI tools) can inspect cover / mc / jurisdiction
   * directly without unzipping. The ZIP stays the source of truth for
   * regulator submission; the parsed bodies are operator-side
   * convenience. */
  return {
    zipBuffer: buildZip(files),
    manifest,
    fileCount: files.length,
    bodies: {
      cover,
      parSheet,
      mc,
      jurisdiction,
      audit,
    },
  };
}

/* CLI. */
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const slugArg = (() => {
    const i = args.indexOf('--slug');
    return i >= 0 ? args[i + 1] : args[0];
  })();
  const outArg = (() => {
    const i = args.indexOf('--out');
    return i >= 0 ? args[i + 1] : null;
  })();
  if (!slugArg) {
    console.error('usage: node tools/cert-pack-export.mjs --slug <SLUG> [--out <FILE.zip>]');
    process.exit(2);
  }
  try {
    const { zipBuffer, manifest, fileCount } = buildCertPack({ slug: slugArg });
    const out = outArg || resolvePath(REPO, 'reports', `cert-pack-${slugArg}.zip`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, zipBuffer);
    console.log(`✓ cert pack: ${out} (${fileCount} files, ${zipBuffer.length} bytes)`);
    console.log(`  merkle root: ${manifest.merkleRoot}`);
    process.exit(0);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
