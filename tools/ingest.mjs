#!/usr/bin/env node
/**
 * tools/ingest.mjs
 *
 * Wave UQ-14 (2026-06-21) — End-to-end one-shot GDD ingest.
 *
 * One command goes from "give me a PDF / URL" to "open a playable HTML
 * slot in the browser". No manual parser / V1-V5 / buildSlotHTML steps.
 *
 * USAGE
 *   node tools/ingest.mjs --file ./path/to/gdd.pdf
 *   node tools/ingest.mjs --url https://example.com/gdd.pdf
 *   node tools/ingest.mjs --file ./gdd.md  --slug my-game
 *   node tools/ingest.mjs --file ./gdd.pdf --no-llm   (skip Kimi V1..V5)
 *   node tools/ingest.mjs --file ./gdd.pdf --open     (auto-open in browser)
 *
 * PIPELINE
 *   1. Resolve source
 *      · --file → read from disk
 *      · --url  → fetch via global fetch() with timeout
 *   2. Extract text
 *      · .pdf  → pdftotext -layout
 *      · .md / .txt → read as-is
 *      · .json → parsed directly via normalizeFromJSON
 *   3. Parse: parseGDD(text, ext) → model
 *   4. SmartDefaults: applySmartDefaults(model) (autofix + backfill)
 *   5. LLM (optional, default ON): V1..V5 Kimi reconcile via existing
 *      tools/_wave-v-kimi-reconcile.mjs pipeline (only when --no-llm
 *      is NOT passed and the slug isn't already cached)
 *   6. Build: buildSlotHTML(model) → standalone HTML
 *   7. Write: dist/ingest/<slug>/{index.html, model.json, raw.txt, ingest.log}
 *   8. (Optional --open) macOS `open` on index.html
 *
 * EXIT CODES
 *   0 success — all steps green
 *   1 source/parse/build hard failure
 *   2 bad CLI usage
 *   3 (UQ-FORTIFY3) ingest finished but Kimi reconcile soft-failed —
 *     parser baseline shipped but agent V6 layer is degraded.
 *     CI should treat as WARN; downstream tools can decide whether to
 *     gate on this or accept the parser-only output.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync as nodeRealpathSync, statSync as nodeStatSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID, createHash as _createHash } from 'node:crypto';
const nodeCrypto = { createHash: _createHash };
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/ingest');

/* ── arg parsing ──────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
function has(name)  { return args.includes(name); }

const filePath = flag('--file');
const urlArg   = flag('--url');
const slugArg  = flag('--slug');
const noLlm    = has('--no-llm');
const openAfter= has('--open');
const dryRun   = has('--dry-run');
/* N+2 D — opcioni PAR sheet (XLSX/CSV/JSON). Calibrates math layer
 * to declared RTP via single-payline oracle (±0.05% precision band). */
const parPath  = flag('--par');
const parSheet = flag('--par-sheet');

if (!filePath && !urlArg) {
  console.error('Usage: node tools/ingest.mjs --file <path> | --url <url>');
  console.error('       [--slug <name>] [--no-llm] [--open] [--dry-run]');
  console.error('       [--par <xlsx|csv|json>] [--par-sheet <sheetName>]');
  process.exit(2);
}

/* ── helpers ──────────────────────────────────────────────────────────── */

/* UQ-DEEP-D regression fix (INGEST-1): timestamp in log prefix breaks
 * stdout determinism — two consecutive ingests of the same input would
 * produce different log streams just by HH:MM:SS. That breaks hash-
 * based caching, diff-based audit, and the idempotency gate (which
 * captures ingest stdout for some flows). Honor --verbose for the
 * timestamp; default prefix is timestamp-free. */
const VERBOSE = process.argv.includes('--verbose');
function log(msg) {
  if (VERBOSE) {
    console.log(`[ingest ${new Date().toISOString().slice(11, 19)}] ${msg}`);
  } else {
    console.log(`[ingest] ${msg}`);
  }
}

/**
 * Slug derivation with Unicode + collision hardening.
 *
 * UQ-DEEP-A 2026-06-23 — UNICODE SAFETY:
 * Previously any non-ASCII basename (emoji / cyrillic / RTL / CJK)
 * collapsed to the literal string "gdd" because the strip regex
 * `[^a-z0-9]+` zapped every code point above U+007A. Two such PDFs
 * dropped in the same session overwrote each other's `dist/ingest/gdd/`.
 *
 * Fix: NFKD-normalize → strip combining marks → drop extension → strip
 * non-ASCII → if the result is empty/degenerate fall back to a SHA-1
 * fingerprint of the ORIGINAL name (deterministic across runs, unique
 * per distinct unicode title).
 */
function slugify(name) {
  const raw = String(name || 'gdd');
  /* NFKD decomposes accented chars to base+combining; the
   * `\p{Mn}` strip then removes combining marks so "Ö" → "O". */
  const ascii = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   /* combining marks */
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')        /* drop extension */
    .replace(/[^a-z0-9]+/g, '-')        /* coalesce non-ASCII to `-` */
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (ascii && ascii !== 'gdd') return ascii;
  /* Degenerate result (empty after strip OR collided with the literal
   * fallback "gdd"). Append SHA-1[0..8] of raw name → deterministic,
   * collision-safe across emoji/CJK/cyrillic titles. */
  // eslint-disable-next-line no-unused-vars
  const { createHash } = nodeCrypto;
  const fp = createHash('sha1').update(raw, 'utf8').digest('hex').slice(0, 8);
  return ascii ? `${ascii}-${fp}` : `gdd-${fp}`;
}

async function fetchToTmp(url) {
  log(`fetching ${url}`);
  /* UQ-AUDIT fix: refuse non-https URLs (avoid plaintext / file://) and
     disallow redirect-chains (SSRF guard — attacker-controlled host
     could redirect from a known-good URL through open redirects to
     internal endpoints). Manual redirect follow with hard cap.
     UQ-DEEP-D regression fix (INGEST-3): the comment said "refuse non-
     https" but the guard ALSO accepted http: — a coffee-shop MitM could
     swap the PDF payload on the wire. Tighten to https: only. Same for
     redirect chain below. */
  let u;
  try { u = new URL(url); }
  catch (_) { throw new Error('bad URL: ' + url); }
  if (u.protocol !== 'https:') {
    throw new Error('only https:// URLs accepted (got ' + u.protocol + ') — plain http is MitM-vulnerable');
  }
  const ext = extname(u.pathname) || '.pdf';
  const tmp = resolve(tmpdir(), 'ingest-' + randomUUID() + ext);
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 60000);
  try {
    let res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    let hops = 0;
    while (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect without Location header');
      if (++hops > 3) throw new Error('too many redirects (>3) from ' + url);
      const next = new URL(loc, u);
      if (next.protocol !== 'https:') {
        throw new Error('redirect to non-https protocol: ' + next.protocol);
      }
      log(`  redirect ${hops}: ${next.href}`);
      res = await fetch(next.href, { signal: ctrl.signal, redirect: 'manual' });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(tmp, buf);
    return tmp;
  } finally {
    clearTimeout(to);
  }
}

/**
 * Inject a `<meta>` tag into the first `<head>` element of a HTML
 * document. Case-insensitive head match so attribute-bearing or
 * uppercase `<HEAD>` future variants don't slip the regex.
 *
 * UQ-DEEP-A 2026-06-23 — SELF-CLOSE EXPANSION.
 * `<head/>` self-close (XHTML-strict) previously matched the
 * `<head\b[^>]*>` regex but the replace appended meta as a sibling of
 * the empty head — invalid HTML5 (meta orphaned in body). Detect
 * self-close, expand it to `<head>…<meta…></head>`.
 *
 * Fallbacks (in order):
 *   1. `<head/>` self-close → expand into proper head with meta inside
 *   2. `<head\b[^>]*>` — preserves any existing head attributes
 *   3. `<html\b[^>]*>` — places meta as first node after html open
 *   4. Prepend at top of document (worst-case but never throws)
 *
 * Pure function — no I/O, returns new string. DRY-shared by V8 + V9
 * receipt injection so any future regression fixes apply once.
 */
function injectMetaIntoHead(html, metaTag) {
  /* Self-close: `<head/>` or `<head attr="x"/>`. */
  const headSelfClose = html.match(/<head\b[^>]*\/>/i);
  if (headSelfClose) {
    const opening = headSelfClose[0].replace(/\s*\/>$/, '>');
    return html.replace(headSelfClose[0], `${opening}\n  ${metaTag}\n</head>`);
  }
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (headOpen) {
    return html.replace(headOpen[0], `${headOpen[0]}\n  ${metaTag}`);
  }
  const htmlOpen = html.match(/<html\b[^>]*>/i);
  if (htmlOpen) {
    return html.replace(htmlOpen[0], `${htmlOpen[0]}\n${metaTag}`);
  }
  return metaTag + '\n' + html;
}

/**
 * Whitelist-validate a verdict string for safe injection into HTML
 * data-* attributes.
 *
 * UQ-DEEP-A 2026-06-23 — VERDICT WHITELIST.
 * Previous `String(v).replace(/[^A-Z]/g, '')` silently stripped
 * lowercase chars — `'Pass'` → `'P'`. Future LLM path returning
 * mixed-case would have produced single-letter verdicts in the meta
 * tag. Whitelist + uppercase guarantees one of the known verdicts or
 * `UNKNOWN` (never an arbitrary substring).
 */
function safeVerdict(raw, allowed = ['PASS', 'WARN', 'FAIL']) {
  const v = String(raw || '').toUpperCase().trim();
  return allowed.includes(v) ? v : 'UNKNOWN';
}

/* UQ-DEEP-D regression fix (INGEST-4): pdftotext was previously spawned
 * with no timeout. A malicious PDF (recursive font cycle, decompression
 * bomb, infinite loop in Type 3 font) could hang the child forever,
 * blocking ingest indefinitely. Real PDFs extract in < 5s; cap at 30s
 * to leave generous headroom while killing pathological inputs. */
const PDFTOTEXT_TIMEOUT_MS = 30_000;
const PDFTOTEXT_MAX_BUFFER = 64 * 1024 * 1024; /* 64 MB extracted text */

function pdfToText(pdfPath) {
  const r = spawnSync('pdftotext', ['-layout', pdfPath, '-'], {
    encoding: 'utf8',
    timeout: PDFTOTEXT_TIMEOUT_MS,
    maxBuffer: PDFTOTEXT_MAX_BUFFER,
  });
  /* UQ-FORTIFY7 #1 — also surface signal-killed children. r.status is
     null when the child was killed by a signal (SIGTERM/SIGKILL/SIGSEGV);
     the original `status !== 0` check silently treated that as failure
     but lost the signal information. */
  if (r.error && r.error.code === 'ETIMEDOUT') {
    throw new Error(`pdftotext timed out after ${PDFTOTEXT_TIMEOUT_MS}ms (likely corrupted or adversarial PDF)`);
  }
  if (r.signal === 'SIGTERM') {
    /* spawnSync sends SIGTERM on timeout per Node docs. */
    throw new Error(`pdftotext SIGTERM'd after ${PDFTOTEXT_TIMEOUT_MS}ms timeout`);
  }
  if (r.signal) throw new Error('pdftotext killed by signal ' + r.signal);
  if (r.status !== 0) throw new Error('pdftotext failed: ' + (r.stderr || 'no stderr'));
  return r.stdout;
}

/* ── main ─────────────────────────────────────────────────────────────── */

/* UQ-DEEP-D regression fix (INGEST-6): full source path leaks PII
 * (home dir, username) and potentially vendor names from operator's
 * desktop into dist/ingest/<slug>/ingest.log. Keep only the basename
 * for the persisted log; --verbose can restore the full path for
 * operator debugging. Internal cache key uses the full hash so this
 * doesn't affect collision detection. */
function _sanitizeSource(s) {
  if (!s) return '(unknown)';
  if (VERBOSE) return s;
  try {
    /* URL: keep host + last path segment; strip credentials, query. */
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      return `${u.protocol}//${u.host}/${basename(u.pathname)}`;
    }
  } catch { /* fallthrough */ }
  return basename(s);
}

const summary = {
  source: _sanitizeSource(filePath || urlArg),
  startedAt: new Date().toISOString(),
  steps: [],
};
/* Wave UQ-CASH A5 + UQ-FORTIFY F5+F6 — cache invalidation key.
 * Hashes EVERY source file that influences either the parsed model or the
 * agent-generated reconcile. Hash drift on ANY of these → cache invalidates.
 *   Parser pipeline:
 *     src/parser.mjs
 *     src/registry/smartDefaults.mjs
 *     src/registry/featureArchetypes.mjs
 *   Build pipeline (F5):
 *     src/buildSlotHTML.mjs
 *     src/registry/blockCatalog.json
 *     src/registry/blockMapper.mjs
 *   Agent semantics (F6):
 *     agents/parser-pool/V1_TOPOLOGY.md
 *     agents/parser-pool/V2_SYMBOLS.md
 *     agents/parser-pool/V3_FEATURE.md
 *     agents/parser-pool/V4_UX.md
 *     agents/parser-pool/V5_COMPLIANCE.md
 *     agents/parser-pool/V6_RECONCILE.md
 *     agents/parser-pool/SELF_CORRECTION.md  (UQ-TRAIN)
 *
 * Agent prompt files are bundled in because when calibration trainer
 * stamps AGENT_CALIBRATION blocks the prompt semantics change — cached
 * V6 responses were generated under the OLD prompt and should not be
 * trusted after the change.
 */
let _parserHashCache = null;
async function _computeParserHash() {
  if (_parserHashCache) return _parserHashCache;
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const SOURCES = [
    /* Parser */
    resolve(REPO, 'src/parser.mjs'),
    resolve(REPO, 'src/registry/smartDefaults.mjs'),
    resolve(REPO, 'src/registry/featureArchetypes.mjs'),
    /* Build (F5) */
    resolve(REPO, 'src/buildSlotHTML.mjs'),
    resolve(REPO, 'src/registry/blockCatalog.json'),
    resolve(REPO, 'src/registry/blockMapper.mjs'),
    /* UQ-FORTIFY6 #1 — multi-process safety primitives. The pipeline
       imports these in the reconcile + cache stamp path, so changes to
       their semantics must invalidate the V6 cache. */
    resolve(REPO, 'src/registry/fileLock.mjs'),
    resolve(REPO, 'src/registry/tmpFileCleanup.mjs'),
    /* Agent prompts (F6) */
    resolve(REPO, 'agents/parser-pool/V1_TOPOLOGY.md'),
    resolve(REPO, 'agents/parser-pool/V2_SYMBOLS.md'),
    resolve(REPO, 'agents/parser-pool/V3_FEATURE.md'),
    resolve(REPO, 'agents/parser-pool/V4_UX.md'),
    resolve(REPO, 'agents/parser-pool/V5_COMPLIANCE.md'),
    resolve(REPO, 'agents/parser-pool/V6_RECONCILE.md'),
    resolve(REPO, 'agents/parser-pool/SELF_CORRECTION.md'),
    /* UQ-DEEP-A 2026-06-23 — V8 + V9 live wire (N+1 A/B).
     * ingest.mjs now embeds V8 receipt + V9 verdict into HTML output.
     * Changes to V8 rule logic, V9 selectors, or assembly rules table
     * must invalidate the V6 cache — otherwise the cached reconcile
     * matches the OLD V8/V9 verdict and the receipt drifts silently. */
    resolve(REPO, 'tools/v8-assembly-orchestrator.mjs'),
    resolve(REPO, 'tools/v8-assembly-rules.json'),
    resolve(REPO, 'tools/v9-visual-qa.mjs'),
  ];
  const h = createHash('sha256');
  for (const p of SOURCES) {
    try {
      const buf = await readFile(p, 'utf8');
      /* Wave UQ-FORTIFY4 H6 — normalize whitespace before hashing.
       * Editor settings (LF vs CRLF), trailing newlines, BOM markers
       * trigger spurious hash drift that invalidates 338 cache entries
       * → burst Kimi calls. Semantic content unchanged. */
      const normalized = buf
        .replace(/^﻿/, '')      /* strip BOM */
        .replace(/\r\n/g, '\n')      /* CRLF → LF */
        .replace(/[ \t]+$/gm, '')    /* strip trailing spaces per line */
        .replace(/\n+$/, '\n');      /* collapse trailing newlines to single */
      h.update(normalized);
    } catch (_) { /* file missing — fold null into hash */ h.update('MISSING:' + p); }
  }
  _parserHashCache = h.digest('hex');
  return _parserHashCache;
}

function step(label, fn) {
  return Promise.resolve(fn()).then(
    (v) => { summary.steps.push({ label, ok: true }); log(`✓ ${label}`); return v; },
    (e) => { summary.steps.push({ label, ok: false, error: e.message }); throw e; }
  );
}

/* UQ-DEEP-B 2026-06-23 — INPUT GUARDS.
 *
 * Two production-scenario findings from paralel-agent audit:
 *
 *   BUG-D: a 100 MB plain-text `.md` ingest accepted silently, parser
 *          produced garbage model, V8/V9 PASS-ed, raw.txt 100MB written
 *          into dist/. DoS surface + storage poison.
 *
 *   EDGE-E: a symlink GDD pointing at `/etc/passwd` was followed by
 *          ingest before pdftotext rejected it as non-PDF — SSRF analog
 *          on the filesystem. With a symlink to a VALID PDF outside the
 *          repo (e.g. another user's home), ingest would silently slurp
 *          arbitrary content into dist/<slug>/raw.txt.
 *
 * Hard caps:
 *   - MAX_INPUT_BYTES = 5 MB — real GDD PDFs cap at ~2 MB, text/md
 *     equivalents stay under 500 KB. 5 MB is generous headroom; anything
 *     larger is either adversarial or operator error.
 *   - ALLOWED_INPUT_ROOTS — realpath of the resolved file MUST start
 *     with one of these prefixes. Override via env CORTEX_INGEST_ROOTS
 *     (colon-separated) for non-default operator setups.
 */
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const ALLOWED_INPUT_ROOTS = (() => {
  const env = process.env.CORTEX_INGEST_ROOTS;
  if (env) return env.split(':').filter(Boolean).map(p => resolve(p));
  const home = process.env.HOME || '/tmp';
  return [
    resolve(home, 'Desktop/GDD'),
    /* UQ-DEEP-L fix (Boki 2026-06-23): operator drži PAR sheets u
     * različitim folderima na ~/Desktop (ParSheets/, Bojan/, Slot
     * simulator  Doc/...). Pre fix-a path-allow guard je blokirao
     * sve sem Desktop/GDD pa nije bilo moguće ingest-ovati GDD +
     * external PAR. ~/Desktop je operator-controlled trusted root
     * — proširujemo allow listu da pokrije sve sub-foldere bez
     * potrebe za env CORTEX_INGEST_ROOTS override. */
    resolve(home, 'Desktop'),
    resolve(home, 'Projects/slot-gdd-factory'),
    /* /tmp/ accepted because tests use mkdtempSync(tmpdir()) for fixtures. */
    resolve('/tmp'),
    /* macOS resolves /tmp through /private/tmp (symlink); accept both. */
    resolve('/private/tmp'),
    /* Also accept /var/folders tmpdirs (os.tmpdir() expansion target). */
    resolve('/var/folders'),
    resolve('/private/var/folders'),
  ];
})();

/**
 * Resolve a user-supplied path through realpath (follows symlinks),
 * then assert the resolved location lives under one of the allow-listed
 * roots. Blocks SSRF-style symlink attacks where the symlink in the
 * GDD folder points at a sensitive system file.
 */
function assertPathAllowed(localPath) {
  const fs = nodeRealpathSync(localPath);
  for (const root of ALLOWED_INPUT_ROOTS) {
    if (fs === root || fs.startsWith(root + '/')) return fs;
  }
  throw new Error(
    `symlink target outside allowed roots: ${fs} ` +
    `(allowed: ${ALLOWED_INPUT_ROOTS.join(', ')}); ` +
    `override with env CORTEX_INGEST_ROOTS=...`
  );
}

try {
  /* Step 1: resolve source */
  const localPath = await step('resolve source', async () => {
    if (filePath) {
      const abs = resolve(process.cwd(), filePath);
      if (!existsSync(abs)) throw new Error('file not found: ' + abs);
      /* Realpath + allow-list — blocks symlink-based path-escape (EDGE-E). */
      assertPathAllowed(abs);
      return abs;
    }
    return await fetchToTmp(urlArg);
  });

  /* Step 2: extract text */
  const ext = extname(localPath).toLowerCase().replace(/^\./, '');
  let rawText = '';
  await step('extract text (' + ext + ')', async () => {
    /* UQ-DEEP-B BUG-D — pre-flight size guard.
     * Real GDDs cap at ~2 MB PDF / ~500 KB MD; anything ≥ MAX_INPUT_BYTES
     * is adversarial (DoS via 100 MB plain-text). For MD/TXT/JSON we
     * stat the file directly. PDF size is enforced by pdftotext (extracted
     * text size is far smaller than the PDF), but we also bound stdout. */
    if (ext === 'md' || ext === 'txt' || ext === 'mdx' || ext === 'json') {
      const sz = nodeStatSync(localPath).size;
      if (sz > MAX_INPUT_BYTES) {
        throw new Error(`source too large: ${sz} bytes > MAX_INPUT_BYTES ${MAX_INPUT_BYTES} (adversarial DoS guard)`);
      }
    }
    if (ext === 'pdf') {
      rawText = pdfToText(localPath);
    } else if (ext === 'md' || ext === 'txt' || ext === 'mdx') {
      rawText = await readFile(localPath, 'utf8');
    } else if (ext === 'json') {
      rawText = await readFile(localPath, 'utf8');
    } else {
      throw new Error('unsupported extension: .' + ext);
    }
    if (!rawText || rawText.length < 32) {
      throw new Error('extracted text too short (' + rawText.length + ' chars) — bad source?');
    }
    /* Post-extraction guard — PDFs can decompress dramatically. */
    if (rawText.length > MAX_INPUT_BYTES) {
      throw new Error(`extracted text too large: ${rawText.length} bytes > MAX_INPUT_BYTES ${MAX_INPUT_BYTES} (adversarial DoS guard)`);
    }
    return rawText.length;
  });

  /* Step 3: slugify */
  const slug = slugify(slugArg || basename(localPath));
  log(`slug = ${slug}`);

  /* Step 4: parse + smart defaults */
  const { parseGDD, normalizeFromJSON } = await import(resolve(REPO, 'src/parser.mjs'));
  const { applySmartDefaults } = await import(resolve(REPO, 'src/registry/smartDefaults.mjs'));

  let model;
  await step('parse + smart defaults', () => {
    if (ext === 'json') {
      /* UQ-AUDIT fix: validate the parsed JSON has at least one
         field expected by normalizeFromJSON before handing it over,
         so we fail fast with a clear message instead of an opaque
         throw deeper in the parser. */
      let obj;
      try { obj = JSON.parse(rawText); }
      catch (e) { throw new Error('bad JSON: ' + e.message); }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error('JSON ingest expects a top-level object');
      }
      const expected = ['topology', 'symbols', 'features', 'paytable', 'name', 'gameName'];
      if (!expected.some(k => k in obj)) {
        throw new Error('JSON missing every expected GDD field — got keys: ' +
          Object.keys(obj).slice(0, 10).join(','));
      }
      model = normalizeFromJSON(obj);
    } else {
      model = parseGDD(rawText, ext);
    }
    applySmartDefaults(model);
    summary.modelStats = {
      symbols: ((model.symbols && model.symbols.high) || []).length +
               ((model.symbols && model.symbols.mid) || []).length +
               ((model.symbols && model.symbols.low) || []).length,
      features: (model.features || []).length,
      topologyKind: (model.topology && model.topology.kind) || 'unknown',
      autofixed: Object.keys((model.confidence || {})._autofixedBy || {}).length,
      derived: Object.keys((model.confidence || {})._derivedBy || {}).length,
    };
  });

  /* Step 4.5: optional PAR sheet ingest + math precision calibration.
   *
   * N+2 D (2026-06-23) — When `--par <path>` is provided:
   *   1. Bridge dispatches to vendor adapter (XLSX → Python, CSV → MJS,
   *      JSON → inline) via tools/par-sheet-bridge.mjs.
   *   2. Applies PAR weights + paytable as additive overlay on model.
   *   3. Runs math-precision-calibrator → emits ±0.05% verdict
   *      (PASS / WARN / FAIL / NON_BINDING / NON_BINDING_LINE_EXPANSION).
   *   4. Stores receipt under summary.par for downstream meta tag.
   *
   * NEVER blocks ingest: Python missing / file missing / adapter
   * failure → WARN with skip flag, model continues parser-only path.
   *
   * Audit fixes (post-implementation paralel-agent audit 2026-06-23):
   *   HIGH-1: PAR path passes through assertPathAllowed + MAX_INPUT_BYTES
   *           same as the primary GDD input (EDGE-E class symlink guard).
   *   MED-2:  Step 4.5 placed AFTER Kimi reconcile (see below) so PAR
   *           overlay is the LAST writer to model.reelStrips and cannot
   *           be clobbered by a stale V6 cache reconcile.
   *   MED-3:  Calibrator soft-fail path uses CALIBRATOR_ERROR verdict
   *           so meta-tag readers distinguish from legitimate NON_BINDING. */
  let parReceipt = null;
  let calibration = null;
  /* MED-2: PAR ingest is moved to a function so it can run AFTER Kimi
   * reconcile (Step 5b below). PAR is ground truth — must be last writer
   * to model.reelStrips. */
  async function runParStep() {
    await step('PAR sheet ingest + calibration', async () => {
      /* HIGH-1: validate PAR path through same allow-list + size cap as
       * the primary GDD input. assertPathAllowed throws on symlink escape;
       * size cap rejects DoS payloads BEFORE handing off to the bridge. */
      const parAbs = resolve(process.cwd(), parPath);
      if (!existsSync(parAbs)) throw new Error('PAR file not found: ' + parAbs);
      try { assertPathAllowed(parAbs); }
      catch (e) { throw new Error('PAR path blocked: ' + e.message); }
      try {
        const st = nodeStatSync(parAbs);
        if (st.size > MAX_INPUT_BYTES) {
          throw new Error(`PAR file > ${MAX_INPUT_BYTES} bytes (got ${st.size}b)`);
        }
      } catch (e) {
        if (/PAR file >/.test(e.message)) throw e;
        /* UQ-DEEP-D regression fix (INGEST-5): only swallow ENOENT
         * (file genuinely missing). EACCES (permission denied), EISDIR
         * (path points to directory), EMFILE (fd exhausted) etc. were
         * silently swallowed before — operator saw an opaque skip with
         * no actionable diagnostic. Surface those loudly. */
        const code = e && e.code;
        if (code && code !== 'ENOENT') {
          throw new Error(`PAR stat failed (${code}): ${e.message}`);
        }
        /* ENOENT or no code → fall through to bridge for graceful skip. */
      }
      const { bridgeIngest, sanitizeVendorKey } = await import(resolve(REPO, 'tools/par-sheet-bridge.mjs'));
      const opts = parSheet ? { sheet: parSheet } : {};
      const bridge = await bridgeIngest(parAbs, model, opts);
      if (!bridge.ok) {
        log(`  PAR skip: ${bridge.reason} (model continues parser-only)`);
        parReceipt = {
          ok: false,
          skip: !!bridge.skip,
          reason: bridge.reason,
          /* UQ-DEEP-AL FIX-A — sanitize vendor route key za par.json artifact
           * (anti-vendor-lint HIGH cap). Internal routing keepa raw key kroz
           * bridge.vendor; samo operator-visible par.json sanitize-ujemo. */
          vendor: bridge.vendor ? sanitizeVendorKey(bridge.vendor) : null,
          format: bridge.format || null,
        };
        return;
      }
      /* Swap in the PAR-merged model so downstream V8/V9/buildSlotHTML
       * see the calibrated reels + paytable overlay. */
      model = bridge.model;
      parReceipt = {
        ok: true,
        /* UQ-DEEP-AL FIX-A — sanitize vendor route key u operator-visible
         * par.json artifact. Internal model.reelStrips.par_sheet_source
         * keepa raw key. */
        vendor: bridge.vendor ? sanitizeVendorKey(bridge.vendor) : null,
        format: bridge.format,
        adapter: bridge.adapter,
        signals: bridge.signals,
        appliedFields: bridge.appliedFields,
        reelCount: bridge.reelCount,
        symbolCount: bridge.symbolCount,
        paytableRowCount: bridge.paytableRowCount,
        warnings: bridge.warnings,
      };
      /* Calibration uses PAR blob + model; non-blocking.
       * MED-3: distinct verdict for calibrator throw vs legitimate
       * NON_BINDING (no declared RTP) so meta tag readers can tell apart. */
      try {
        const { calibrate } = await import(resolve(REPO, 'tools/math-precision-calibrator.mjs'));
        calibration = calibrate(model, bridge.parSheet);
        log(`  calibration verdict: ${calibration.verdict} (${calibration.reason})`);
      } catch (e) {
        log(`  calibration soft-fail: ${e.message}`);
        calibration = {
          verdict: 'CALIBRATOR_ERROR',
          reason: `calibrator threw: ${e.message}`,
          declaredRtp: null,
          parRtp: null,
          deltaPct: null,
          bandPct: 0.05,
        };
      }
      summary.par = parReceipt;
      summary.calibration = calibration ? {
        declaredRtp: calibration.declaredRtp,
        parRtp: calibration.parRtp,
        deltaPct: calibration.deltaPct,
        bandPct: calibration.bandPct,
        verdict: calibration.verdict,
        reason: calibration.reason,
      } : null;
    }).catch((e) => {
      /* Bridge layer is never-throws but defensive in case. */
      log(`  PAR step soft-fail: ${e.message}`);
      parReceipt = { ok: false, skip: false, reason: e.message };
      summary.par = parReceipt;
      /* F-HIGH-4: append to softFails array + keep legacy single field. */
      const sf = { stage: 'PAR ingest', reason: e.message };
      summary.softFail = summary.softFail || sf;
      (summary.softFails = summary.softFails || []).push(sf);
    });
  }
  /* MED-2 fix: defer PAR ingest to AFTER Kimi reconcile (Step 5b below). */

  /* Step 5: optional LLM reconcile */
  if (!noLlm) {
    await step('Kimi V1..V5 reconcile (optional)', async () => {
      const cacheFile = resolve(REPO, `tools/_wave-v-cache/${slug}.json`);
      /* Wave UQ-CASH A5 — cache invalidation by parser source hash.
       * When src/parser.mjs / src/registry/smartDefaults.mjs changes, the cached
       * V6 reconcile becomes structurally outdated (it captures a snapshot of
       * model shape from a prior parser run). We hash a stable set of source
       * files and compare against the cached `__parser_hash__` field; mismatch
       * → delete cache, re-run (when Kimi available) or fall through.
       *
       * UQ-FORTIFY5 #1 — acquire the cache lock BEFORE the first hash
       * computation. Previously a sibling process running the calibration
       * trainer could rewrite V1..V5 prompts AFTER our hash snapshot but
       * BEFORE our cache read, making the comparison stale and the
       * invalidation incorrect. Lock ensures the hash + cache read are a
       * single atomic moment from the perspective of any other writer. */
      const fsp = await import('node:fs/promises');
      const cacheDir0 = resolve(REPO, 'tools/_wave-v-cache');
      try { await fsp.mkdir(cacheDir0, { recursive: true }); } catch (_) {}
      const { acquireLock, releaseLock } = await import('../src/registry/fileLock.mjs');
      let preLock = null;
      try { preLock = acquireLock(cacheFile); } catch (_) { /* lock failure → fall through */ }
      /* Clear any stale memoization so we capture the live source set. */
      _parserHashCache = null;
      const parserHash = await _computeParserHash();
      if (existsSync(cacheFile)) {
        try {
          const raw = await fsp.readFile(cacheFile, 'utf8');
          const cached = JSON.parse(raw);
          const cachedHash = cached && cached.__parser_hash__;
          if (cachedHash === parserHash) {
            log('  cache hit (hash match) — skip Kimi call');
            if (preLock) releaseLock(preLock);
            return;
          }
          log(`  cache stale (hash drift ${(cachedHash || 'none').slice(0, 8)} → ${parserHash.slice(0, 8)}) — invalidating`);
          await fsp.unlink(cacheFile).catch(() => {});
        } catch (e) {
          log('  cache parse failed (' + e.message + ') — invalidating');
          await fsp.unlink(cacheFile).catch(() => {});
        }
      }
      /* Release the pre-Kimi lock — Kimi call itself can take minutes and
         our lock policy steals after 60s. The post-Kimi stamp re-acquires
         (see below) for the read-modify-write of __parser_hash__. */
      if (preLock) releaseLock(preLock);
      /* Skip silently if Kimi binary missing — keep pipeline working offline. */
      const kimiBin = resolve(process.env.HOME || '/tmp', 'Projects/cortex/scripts/cortex-kimi-ask');
      if (!existsSync(kimiBin)) {
        log('  cortex-kimi-ask not found — skip Kimi step');
        return;
      }
      /* Write raw.txt where the reconcile tool expects it, then invoke. */
      const ddir = resolve(REPO, `dist/real-games/${slug}`);
      await mkdir(ddir, { recursive: true });
      await writeFile(resolve(ddir, 'raw.txt'), rawText, 'utf8');
      await writeFile(resolve(ddir, 'model.json'), JSON.stringify(model, null, 2), 'utf8');
      const r = spawnSync('node', [
        resolve(REPO, 'tools/_wave-v-kimi-reconcile.mjs'),
        '--slug', slug,
      ], { stdio: 'inherit', cwd: REPO });
      /* UQ-FORTIFY7 #1 — signal-killed reconcile (OOM kill / CTRL-C /
         SIGTERM) returns r.status === null, which the original
         `status !== 0` check passed silently (null !== 0 is truthy)
         but produced the message "reconcile exit null". That left
         ambiguity between "tool ran and failed" and "tool was killed
         mid-flight". A killed-mid-flight child must HARD-FAIL: never
         leave a partial cache entry that next ingest could hit. We
         throw a marked error so the catch above routes to hard exit 1
         (not soft-fail exit 3) and the lock is released cleanly. */
      if (r.signal) {
        const err = new Error('reconcile killed by signal ' + r.signal);
        err.hardFail = true;
        throw err;
      }
      if (r.status !== 0) throw new Error('reconcile exit ' + r.status);
      /* Stamp parser hash — F2 recompute + F7 mkdir + G3 orphan cleanup
       * + G4 file lock. */
      const cacheDir = resolve(REPO, 'tools/_wave-v-cache');
      try { await fsp.mkdir(cacheDir, { recursive: true }); } catch (_) {}
      /* G3 — opportunistically GC orphan tmps every ingest run. */
      try {
        const { cleanupOrphanTmps } = await import('../src/registry/tmpFileCleanup.mjs');
        const gc = cleanupOrphanTmps([cacheDir]);
        if (gc.deleted > 0) log(`  gc: deleted ${gc.deleted} orphan tmp file(s)`);
      } catch (_) { /* non-fatal */ }
      if (existsSync(cacheFile)) {
        const { acquireLock, releaseLock } = await import('../src/registry/fileLock.mjs');
        let lockTok = null;
        try {
          /* G4 — file lock around read-modify-write to avoid race with
           * concurrent ingest of same slug. */
          lockTok = acquireLock(cacheFile);
          /* Invalidate memoized hash so we re-read the (possibly changed) source. */
          _parserHashCache = null;
          const freshHash = await _computeParserHash();
          if (freshHash !== parserHash) {
            log(`  warn: parser source changed mid-Kimi (${parserHash.slice(0, 8)} → ${freshHash.slice(0, 8)})`);
          }
          const cur = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
          cur.__parser_hash__ = freshHash;
          cur.__stamped_at__ = new Date().toISOString();
          /* UQ-FORTIFY3 #3 — durable atomic write.
             Previous design wrote tmp + rename. POSIX rename is atomic
             when source + dest live on the same filesystem, but a power
             loss or crash between the writeFile callback and the rename
             can leave the on-disk bits cached. Force the data and the
             enclosing directory through fsync before swapping so a
             crash never resurrects a half-written file. */
          /* INFRA-1 — entropy-based tmp suffix (see atomicWrite comment). */
          const tmpFile = cacheFile + '.tmp.' + (await import('node:crypto')).randomBytes(8).toString('hex');
          const fh = await fsp.open(tmpFile, 'w');
          try {
            await fh.writeFile(JSON.stringify(cur, null, 2), 'utf8');
            await fh.sync();
          } finally {
            await fh.close();
          }
          await fsp.rename(tmpFile, cacheFile);
          /* fsync the parent dir so the rename itself survives crash. */
          try {
            const { dirname } = await import('node:path');
            const dh = await fsp.open(dirname(cacheFile), 'r');
            try { await dh.sync(); } finally { await dh.close(); }
          } catch (_) { /* directory fsync best-effort */ }
        } catch (e) {
          log('  warn: could not stamp parser hash: ' + e.message);
        } finally {
          if (lockTok) releaseLock(lockTok);
        }
      }
    }).catch((e) => {
      /* UQ-FORTIFY7 #1 — escalate hard-fail (signal-killed child) to
         the outer try/catch so the process exits 1, not soft-fail 3.
         A SIGKILL during reconcile leaves a partial state we must NOT
         silently accept; the next ingest would hit a stale cache and
         permanently lock in the degraded model. */
      if (e && e.hardFail) {
        log('  reconcile HARD-FAIL: ' + e.message);
        throw e;
      }
      log('  reconcile soft-fail: ' + e.message + ' (continuing without)');
      /* UQ-FORTIFY3 #6 — record soft-fail so the final exit code is 3
         instead of 0. CI / downstream tools can decide whether to gate.
         Note: --no-llm explicit skip is NOT a soft-fail (operator chose). */
      {
        const sf = { stage: 'kimi-reconcile', reason: e.message };
        summary.softFail = summary.softFail || sf;
        (summary.softFails = summary.softFails || []).push(sf);
      }
    });
  } else {
    log('--no-llm — skipping reconcile');
  }

  /* Step 5a0: Self-healing parser (N+2 E, 2026-06-23).
   *
   * After parser + smart defaults + (optional) Kimi reconcile, diagnose
   * the model. If severity is CRITICAL/CATASTROPHIC (missing topology,
   * paytable, or symbols), invoke LLM healer to generate a structured
   * fix patch. Max 3 attempts, $0.15 cost ceiling, 90s wall-clock cap.
   *
   * Skips silently when --no-llm is set OR when healer binary is missing
   * (Kimi unavailable). Pipeline continues with whatever the parser+
   * smart-defaults produced. Operator sees `__healing__` flag in receipt
   * when healing happened so audit knows which fields are LLM-supplied.
   *
   * Soft-fail on healer error — never blocks ingest. */
  let healingReceipt = null;
  if (!noLlm) {
    await step('self-healing parser (diagnose + optional heal)', async () => {
      const { diagnoseModel, healModel } = await import(resolve(REPO, 'tools/self-healing-parser.mjs'));
      const diag = diagnoseModel(model);
      if (!diag.actionable) {
        log(`  healing skipped: severity=${diag.severity} (no critical gaps)`);
        healingReceipt = {
          ok: true, skipped: true, severity: diag.severity,
          attempts: 0, fieldsRepaired: [], costEstimateUsd: 0,
        };
        return;
      }
      log(`  healing trigger: severity=${diag.severity} gaps=${diag.criticalGaps.length}`);
      const r = await healModel(rawText, model, { maxAttempts: 3 });
      if (r.ok) {
        model = r.model;
        log(`  ✓ healed in ${r.attempts} attempt(s) — fields: ${r.receipt.fieldsRepaired.join(', ') || 'none'}`);
      } else if (r.skipped) {
        log(`  healing skipped: ${r.reason}`);
      } else {
        log(`  healing inconclusive: finalSeverity=${r.receipt.finalSeverity}`);
      }
      healingReceipt = {
        ok: r.ok,
        skipped: !!r.skipped,
        reason: r.reason,
        attempts: r.attempts,
        fieldsRepaired: r.receipt.fieldsRepaired,
        costEstimateUsd: r.receipt.costEstimateUsd,
        initialSeverity: r.receipt.initialSeverity,
        finalSeverity: r.receipt.finalSeverity,
        llmProvider: r.receipt.llmProvider,
        totalDurationMs: r.receipt.totalDurationMs,
        attemptsLog: r.receipt.attempts,
      };
      summary.healing = healingReceipt;
    }).catch((e) => {
      log(`  healing step soft-fail: ${e.message}`);
      healingReceipt = { ok: false, skipped: false, reason: e.message, attempts: 0 };
      summary.healing = healingReceipt;
    });
  }

  /* Step 5a: PAR ingest + calibration (deferred from Step 4.5 per
   * MED-2 audit fix — PAR is GROUND TRUTH and must be the LAST writer
   * to model.reelStrips so V6 cache reconcile cannot clobber the overlay.
   * Runs only when --par was provided. */
  if (parPath) {
    await runParStep();
  }

  /* Step 5a1: Auto-scaffold detector (N+2 G, 2026-06-23).
   *
   * Posle parse/heal/PAR, model.features može imati kind-ove koji NISU
   * u block catalog-u. Ranije bi ovo proizvelo `unknownFeatureKinds`
   * receipt sa nullskim ponašanjem. Sad: detektor poziva
   * suggestArchetype i za svaki match ≥ 0.7 confidence emit-uje
   * STUB blok u src/blocks/_auto-scaffolded/ + test, plus log entry u
   * reports/auto-scaffold-pending.json za code review backlog.
   *
   * NEVER blocks ingest — every error path je soft-fail. Max 5 stub-ova
   * per ingest (sigurnosni cap). Anti-vendor: banned-name regex blokira
   * scaffold za sumnjive kindove. */
  let scaffoldReceipt = null;
  await step('auto-scaffold detector (unknown feature kinds)', async () => {
    try {
      const { runScaffolds } = await import(resolve(REPO, 'tools/auto-scaffold-detector.mjs'));
      scaffoldReceipt = await runScaffolds(model, { slug });
      const c = scaffoldReceipt.created.length;
      const s = scaffoldReceipt.skipped.length;
      const b = scaffoldReceipt.blocked.length;
      if (c > 0) {
        log(`  ✓ auto-scaffolded ${c} stub block(s): ${scaffoldReceipt.created.map(x => x.kind).join(', ')}`);
      } else if (s + b > 0) {
        log(`  no scaffolds (${s} skipped, ${b} blocked)`);
      } else {
        log(`  no unknown feature kinds`);
      }
      summary.autoScaffold = {
        ok: scaffoldReceipt.ok,
        createdCount: c,
        skippedCount: s,
        blockedCount: b,
        capExceeded: scaffoldReceipt.capExceeded,
        pendingTotal: scaffoldReceipt.pending.length,
      };
    } catch (e) {
      log(`  auto-scaffold soft-fail: ${e.message}`);
      scaffoldReceipt = { ok: false, reason: e.message };
      summary.autoScaffold = { error: e.message };
    }
  });

  /* Step 5b: V8 GAME ASSEMBLY rule engine (live wire 2026-06-23).
   *
   * After smart-defaults (+ optional V6 reconcile) the model shape is
   * frozen. We deterministically decide which blocks should mount
   * (enabledBlocks), which are off (disabledBlocks), and why
   * (reasonByBlock). Conflicts + missingMandatory surface verdict FAIL
   * for operator review.
   *
   * Output is dual-channel:
   *   1. `dist/ingest/<slug>/v8.json` — full receipt (audit deliverable)
   *   2. `<meta name="v8-receipt">` injected into the final HTML so
   *      downstream tools (web-dashboard, V9, regulator export) can
   *      re-extract WITHOUT re-running the rule engine, by decoding
   *      base64-JSON from the content attribute.
   *
   * V8 must NEVER block ingest — even a verdict FAIL ships the HTML so
   * the operator can inspect. CI gates separately by reading v8.json. */
  let v8Receipt = null;
  await step('V8 assembly receipt', async () => {
    try {
      const { assemble } = await import(resolve(REPO, 'tools/v8-assembly-orchestrator.mjs'));
      v8Receipt = assemble(slug, model);
      summary.v8 = {
        verdict: v8Receipt.verdict,
        enabledCount: v8Receipt.assembly.enabledBlocks.length,
        disabledCount: v8Receipt.assembly.disabledBlocks.length,
        conflicts: v8Receipt.conflicts.length,
        missingMandatory: v8Receipt.missingMandatory.length,
        selectedEngine: v8Receipt.__meta__.selectedEngine,
      };
    } catch (e) {
      log('  V8 soft-fail: ' + e.message);
      summary.v8 = { error: e.message };
      /* UQ-DEEP-A 2026-06-23 — propagate via softFail so exit code 3
       * surfaces to CI. Without this, V8 import error silently shipped
       * HTML without the audit receipt; operator believed pipeline OK. */
      {
        const sf = { stage: 'V8 assembly', reason: e.message };
        summary.softFail = summary.softFail || sf;
        (summary.softFails = summary.softFails || []).push(sf);
      }
    }
  });

  /* Step 6: build HTML */
  let html;
  await step('buildSlotHTML', async () => {
    const { buildSlotHTML } = await import(resolve(REPO, 'src/buildSlotHTML.mjs'));
    html = buildSlotHTML(model);
    summary.htmlBytes = html ? html.length : 0;
    if (!html || html.length < 1000) throw new Error('HTML output too small: ' + (html ? html.length : 0));

    /* Step 6b: embed V8 receipt as <meta> in <head>.
     * Receipt is base64(JSON) — avoids any HTML escape edge case
     * (`"` `<` `>` etc.) and keeps content attribute single-line.
     * Decoder: JSON.parse(Buffer.from(content, 'base64').toString()).
     * We inject AFTER buildSlotHTML so buildSlotHTML stays
     * receipt-agnostic (any GDD without V8 still renders). */
    if (v8Receipt) {
      const payload = {
        verdict: v8Receipt.verdict,
        enabledBlocks: v8Receipt.assembly.enabledBlocks,
        disabledBlocks: v8Receipt.assembly.disabledBlocks,
        reasonByBlock: v8Receipt.assembly.reasonByBlock,
        conflicts: v8Receipt.conflicts,
        missingMandatory: v8Receipt.missingMandatory,
        missingJurGates: v8Receipt.missingJurGates,
        selectedEngine: v8Receipt.__meta__.selectedEngine,
        /* UQ-DEEP-A 2026-06-23 — DETERMINISTIC PAYLOAD.
         * `__meta__.ts` intentionally NOT embedded into the meta payload.
         * Including it caused two ingests of the same GDD to produce
         * different `<meta content="…">` byte streams; any upstream gate
         * hashing the HTML for "changed?" detection would false-positive.
         * The full receipt (with ts) still lives in `v8.json` next to the
         * HTML for audit-trail purposes — only the embedded payload is
         * pure content-dependent. */
      };
      const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
      const verdictSafe = safeVerdict(payload.verdict);
      const safeEngine  = String(payload.selectedEngine || '').replace(/[^A-Za-z0-9_-]/g, '');
      const metaTag = `<meta name="v8-receipt" data-verdict="${verdictSafe}" data-engine="${safeEngine}" content="${b64}">`;
      html = injectMetaIntoHead(html, metaTag);
      summary.htmlBytes = html.length;
    }

    /* Step 6b1: embed healing meta tag (N+2 E).
     * Allows dashboard / regulator export to see whether the model was
     * LLM-supplemented WITHOUT re-running diagnose. */
    if (healingReceipt) {
      const finalSev = String(healingReceipt.finalSeverity || 'UNKNOWN')
        .replace(/[^A-Z_]/g, '');
      const initialSev = String(healingReceipt.initialSeverity || 'UNKNOWN')
        .replace(/[^A-Z_]/g, '');
      const provider = String(healingReceipt.llmProvider || 'none')
        .replace(/[^a-z0-9_-]/gi, '');
      const cost = Number.isFinite(healingReceipt.costEstimateUsd)
        ? healingReceipt.costEstimateUsd.toFixed(4) : '0';
      const repaired = (healingReceipt.fieldsRepaired || []).slice(0, 8).join(',')
        .replace(/[^a-zA-Z0-9_,.-]/g, '');
      const skipped = healingReceipt.skipped ? '1' : '0';
      const healMetaTag =
        `<meta name="self-healing" data-ok="${healingReceipt.ok ? '1' : '0'}" ` +
        `data-skipped="${skipped}" data-attempts="${healingReceipt.attempts | 0}" ` +
        `data-initial-severity="${initialSev}" data-final-severity="${finalSev}" ` +
        `data-provider="${provider}" data-cost-usd="${cost}" ` +
        `data-fields-repaired="${repaired}">`;
      html = injectMetaIntoHead(html, healMetaTag);
      summary.htmlBytes = html.length;
    }

    /* Step 6b2: embed PAR calibration meta tag (N+2 D).
     * Allows downstream dashboard / regulator export to read
     * declared/par/delta/verdict WITHOUT re-running calibrator. */
    if (parReceipt && parReceipt.ok && calibration) {
      /* PAR calibrator uses 6-verdict ladder (PASS/WARN/FAIL +
       * NON_BINDING + NON_BINDING_LINE_EXPANSION + CALIBRATOR_ERROR).
       * Extend safeVerdict whitelist for this attribute only. */
      const verdictSafe = safeVerdict(calibration.verdict,
        ['PASS', 'WARN', 'FAIL', 'NON_BINDING', 'NON_BINDING_LINE_EXPANSION', 'CALIBRATOR_ERROR']);
      const declared = Number.isFinite(calibration.declaredRtp)
        ? calibration.declaredRtp.toFixed(4) : 'null';
      const parRtp = Number.isFinite(calibration.parRtp)
        ? calibration.parRtp.toFixed(4) : 'null';
      const delta = Number.isFinite(calibration.deltaPct)
        ? calibration.deltaPct.toFixed(4) : 'null';
      const band = Number.isFinite(calibration.bandPct)
        ? calibration.bandPct.toFixed(4) : '0.0500';
      const vendorSafe = String(parReceipt.vendor || '').replace(/[^a-z0-9_-]/gi, '');
      const formatSafe = String(parReceipt.format || '').replace(/[^a-z0-9_-]/gi, '');
      const parMetaTag =
        `<meta name="par-calibrated" data-verdict="${verdictSafe}" ` +
        `data-declared-rtp="${declared}" data-par-rtp="${parRtp}" ` +
        `data-delta-pct="${delta}" data-band-pct="${band}" ` +
        `data-vendor="${vendorSafe}" data-format="${formatSafe}">`;
      html = injectMetaIntoHead(html, parMetaTag);
      summary.htmlBytes = html.length;
    }
  });

  /* Step 6c: V9 VISUAL QA deterministic check on built HTML (live wire).
   *
   * Runs the SAME deterministic structural invariants the corpus
   * orchestrator runs (parseSlot + 10 checks → score → PASS/WARN/FAIL).
   * Verifies the *just-built* HTML actually carries the expected DOM
   * markers (hub controls, viewport, manifest, theme vars, paytable
   * rows, engine block marker). Catches build regressions where the
   * pipeline produces HTML that no longer matches GDD intent.
   *
   * Output is dual-channel like V8:
   *   1. `dist/ingest/<slug>/v9.json` — full deterministic receipt
   *   2. `<meta name="v9-verdict" data-verdict data-score>` injected
   *      into the HTML so downstream readers don't re-run the suite.
   *
   * Like V8, V9 never blocks ingest — even a verdict FAIL ships HTML
   * (operator decides). CI verify gate reads v9.json separately. */
  let v9Receipt = null;
  await step('V9 visual QA receipt', async () => {
    try {
      const { verifyHtml } = await import(resolve(REPO, 'tools/v9-visual-qa.mjs'));
      v9Receipt = verifyHtml(slug, model, html);
      summary.v9 = {
        verdict: v9Receipt.verdict,
        score: v9Receipt.score,
        passCount: v9Receipt.checks.filter(c => c.verdict === 'PASS').length,
        warnCount: v9Receipt.checks.filter(c => c.verdict === 'WARN').length,
        failCount: v9Receipt.checks.filter(c => c.verdict === 'FAIL').length,
      };
      /* Inject v9-verdict meta tag so downstream tools don't re-run.
       * Numeric score uses fixed(2) to avoid 9.999999999 noise; defensive
       * fallback to 0 in case verifyHtml ever returns a non-number
       * (today scoreChecks returns 0 on empty input, but guard keeps the
       * pipeline alive against future regressions). */
      const v9Score = typeof v9Receipt.score === 'number' ? v9Receipt.score : 0;
      const v9VerdictSafe = safeVerdict(v9Receipt.verdict);
      const metaTag = `<meta name="v9-verdict" data-verdict="${v9VerdictSafe}" data-score="${v9Score.toFixed(2)}" data-checks="${v9Receipt.checks.length}">`;
      html = injectMetaIntoHead(html, metaTag);
      summary.htmlBytes = html.length;
    } catch (e) {
      log('  V9 soft-fail: ' + e.message);
      summary.v9 = { error: e.message };
      {
        const sf = { stage: 'V9 visual QA', reason: e.message };
        summary.softFail = summary.softFail || sf;
        (summary.softFails = summary.softFails || []).push(sf);
      }
    }
  });

  /* Step 7: write outputs (atomic per-file write-then-rename).
   *
   * UQ-DEEP-A 2026-06-23 — CONCURRENT WRITE HARDENING.
   * UQ-DEEP-B 2026-06-23 — DOUBLE-LOCK PLACEBO FIX.
   *
   * Previous version called `acquireLock(outDir + '.lock')`, but
   * `fileLock.mjs:71` internally appends `.lock` to whatever path it
   * receives — so the actual lock file was `<outDir>.lock.lock`,
   * NOT `<outDir>.lock`. The mutual-exclusion contract was effectively
   * placebo: two parallel ingests with the same slug each created
   * their own distinct lock files and never serialized.
   *
   * The fix is one line: pass `outDir` (NOT `outDir + '.lock'`) to
   * acquireLock — the function will create `<outDir>.lock` as documented.
   *
   * Defense in depth:
   *   1. Acquire file lock keyed on `outDir`. fileLock will:
   *      - create `<outDir>.lock` exclusively,
   *      - steal stale locks > 60s,
   *      - PID-liveness check the lock holder.
   *   2. cleanupOrphanTmps([outDir]) BEFORE writes — sweep any
   *      `*.tmp.<pid>` from a previous SIGKILL'd run in the same dir.
   *      Without this, dead-tmp files pile up forever (UQ-DEEP-B CRIT-3).
   *   3. tmp + fsync + rename for each file — POSIX-atomic rename on
   *      same filesystem, fsync survives crash mid-write.
   * Lock released after dir fully populated. */
  const outDir = resolve(DIST, slug);
  await step('write outputs', async () => {
    await mkdir(outDir, { recursive: true });
    const { acquireLock, releaseLock } = await import('../src/registry/fileLock.mjs');
    const { cleanupOrphanTmps } = await import('../src/registry/tmpFileCleanup.mjs');
    const fsp = await import('node:fs/promises');
    let lockTok = null;
    try {
      /* fileLock appends `.lock` internally — pass outDir, NOT outDir+'.lock'. */
      lockTok = acquireLock(outDir);
      /* Sweep any orphan `*.tmp.<pid>` left by a previous crash. */
      try {
        const gc = cleanupOrphanTmps([outDir]);
        if (gc.deleted > 0) log(`  gc: cleared ${gc.deleted} orphan tmp file(s) in ${outDir}`);
      } catch (_) { /* non-fatal — orphan tmp doesn't block this run */ }
      /* UQ-DEEP-D regression fix (INFRA-1): tmp suffix was
       * `.tmp.${process.pid}` which collides after PID space wraps on
       * long-uptime systems. If a previous crash left an orphan
       * `.tmp.1234`, a new process 1234 truncates and reuses the same
       * tmp file without realizing. Replace pid with crypto randomBytes
       * — 8 hex chars = 4 bytes entropy = 2^32 space, safe against
       * concurrent collision and PID reuse. */
      async function atomicWrite(absPath, content) {
        const tmp = absPath + '.tmp.' + (await import('node:crypto')).randomBytes(8).toString('hex');
        const fh = await fsp.open(tmp, 'w');
        try {
          await fh.writeFile(content, 'utf8');
          await fh.sync();
        } finally {
          await fh.close();
        }
        await fsp.rename(tmp, absPath);
      }
      await atomicWrite(resolve(outDir, 'index.html'), html);
      await atomicWrite(resolve(outDir, 'model.json'), JSON.stringify(model, null, 2));
      await atomicWrite(resolve(outDir, 'raw.txt'), rawText);
      if (v8Receipt) {
        await atomicWrite(resolve(outDir, 'v8.json'), JSON.stringify(v8Receipt, null, 2));
      }
      if (v9Receipt) {
        await atomicWrite(resolve(outDir, 'v9.json'), JSON.stringify(v9Receipt, null, 2));
      }
      /* N+2 E — Self-healing receipt (when healer ran). */
      if (healingReceipt) {
        await atomicWrite(resolve(outDir, 'healing.json'),
          JSON.stringify(healingReceipt, null, 2));
      }
      /* N+2 G — Auto-scaffold receipt (always written for traceability). */
      if (scaffoldReceipt) {
        await atomicWrite(resolve(outDir, 'auto-scaffold.json'),
          JSON.stringify(scaffoldReceipt, null, 2));
      }
      /* N+2 D — PAR + calibration receipt (when --par used).
       * Even skipped path writes par.json so operator + dashboard can
       * see the attempt + reason (e.g. "Python missing"). */
      if (parReceipt || calibration) {
        const parOut = {
          par: parReceipt,
          calibration: calibration
            ? {
                declaredRtp: calibration.declaredRtp,
                parRtp: calibration.parRtp,
                deltaPct: calibration.deltaPct,
                bandPct: calibration.bandPct,
                verdict: calibration.verdict,
                reason: calibration.reason,
                contributions: calibration.contributions,
                totals: calibration.totals,
                assumptions: calibration.assumptions,
              }
            : null,
        };
        await atomicWrite(resolve(outDir, 'par.json'), JSON.stringify(parOut, null, 2));
      }
      summary.outDir = outDir;
      summary.finishedAt = new Date().toISOString();
      /* UQ-DEEP-D regression fix (INGEST-2): startedAt/finishedAt make
       * ingest.log non-deterministic across runs (wall-clock changes
       * every invocation). The idempotency gate hashes ingest.log to
       * detect silent model drift — without freezing, two identical
       * runs would falsely flag drift. Strip timestamps from the
       * persisted artifact; keep them on the in-memory `summary` for
       * the post-ingest console line. Restore via --verbose for
       * operator debugging. */
      const persistedSummary = VERBOSE
        ? summary
        : { ...summary, startedAt: '__omitted_for_determinism__',
                        finishedAt: '__omitted_for_determinism__' };
      await atomicWrite(resolve(outDir, 'ingest.log'), JSON.stringify(persistedSummary, null, 2));
    } finally {
      if (lockTok) releaseLock(lockTok);
    }
  });

  log('✓ done → ' + outDir);
  log(`  ${summary.modelStats.symbols} symbols · ${summary.modelStats.features} features · ` +
      `topology=${summary.modelStats.topologyKind} · ` +
      `${summary.modelStats.autofixed} autofix · ${summary.modelStats.derived} derived · ` +
      `${(summary.htmlBytes / 1024).toFixed(1)} KB`);

  /* Step 8: optional open */
  if (openAfter && !dryRun) {
    spawn('open', [resolve(outDir, 'index.html')], { detached: true, stdio: 'ignore' }).unref();
    log('  opened in browser');
  }

  /* UQ-FORTIFY3 #6 — distinct exit code for "finished with soft-fail" so
   * CI can WARN (3) without falsely passing (0) or hard-failing (1).
   *
   * UQ-DEEP-F F-HIGH-4 fix: summary.softFail = X || X kept ONLY first
   * soft-fail. Two soft-fails reported as one — second silently dropped.
   * Now: maintain softFails ARRAY in addition to legacy single field for
   * back-compat; log ALL stages in exit message. */
  if (summary.softFail) {
    const all = summary.softFails || [summary.softFail];
    log(`⚠ exit 3 — soft-fail in ${all.length} stage(s):`);
    for (const sf of all) {
      log(`   · ${sf.stage}: ${String(sf.reason || '').slice(0, 100)}`);
    }
    process.exit(3);
  }
  process.exit(0);
} catch (e) {
  console.error('✗ ingest failed:', e.message);
  process.exit(1);
}
