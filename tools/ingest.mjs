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
 *   0 success
 *   1 source/parse/build failure
 *   2 bad CLI usage
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
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

if (!filePath && !urlArg) {
  console.error('Usage: node tools/ingest.mjs --file <path> | --url <url>');
  console.error('       [--slug <name>] [--no-llm] [--open] [--dry-run]');
  process.exit(2);
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function log(msg) {
  console.log(`[ingest ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function slugify(name) {
  return String(name || 'gdd')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'gdd-' + Date.now();
}

async function fetchToTmp(url) {
  log(`fetching ${url}`);
  /* UQ-AUDIT fix: refuse non-https URLs (avoid plaintext / file://) and
     disallow redirect-chains (SSRF guard — attacker-controlled host
     could redirect from a known-good URL through open redirects to
     internal endpoints). Manual redirect follow with hard cap. */
  let u;
  try { u = new URL(url); }
  catch (_) { throw new Error('bad URL: ' + url); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('only http(s) URLs accepted (got ' + u.protocol + ')');
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
      if (next.protocol !== 'https:' && next.protocol !== 'http:') {
        throw new Error('redirect to non-http(s) protocol: ' + next.protocol);
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

function pdfToText(pdfPath) {
  const r = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('pdftotext failed: ' + (r.stderr || 'no stderr'));
  return r.stdout;
}

/* ── main ─────────────────────────────────────────────────────────────── */

const summary = {
  source: filePath || urlArg,
  startedAt: new Date().toISOString(),
  steps: [],
};
/* Wave UQ-CASH A5 — parser source hash (cache invalidation key).
 * Hashes a stable set of source files that influence the parsed model:
 *   src/parser.mjs · src/registry/smartDefaults.mjs · src/registry/featureArchetypes.mjs
 * Result is a hex digest stored in V6 cache entries as __parser_hash__.
 * If any source file changes between runs, hash drifts → cache invalidates. */
let _parserHashCache = null;
async function _computeParserHash() {
  if (_parserHashCache) return _parserHashCache;
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const SOURCES = [
    resolve(REPO, 'src/parser.mjs'),
    resolve(REPO, 'src/registry/smartDefaults.mjs'),
    resolve(REPO, 'src/registry/featureArchetypes.mjs'),
  ];
  const h = createHash('sha256');
  for (const p of SOURCES) {
    try { h.update(await readFile(p)); } catch (_) { /* file missing — fold null into hash */ h.update('MISSING:' + p); }
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

try {
  /* Step 1: resolve source */
  const localPath = await step('resolve source', async () => {
    if (filePath) {
      const abs = resolve(process.cwd(), filePath);
      if (!existsSync(abs)) throw new Error('file not found: ' + abs);
      return abs;
    }
    return await fetchToTmp(urlArg);
  });

  /* Step 2: extract text */
  const ext = extname(localPath).toLowerCase().replace(/^\./, '');
  let rawText = '';
  await step('extract text (' + ext + ')', async () => {
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

  /* Step 5: optional LLM reconcile */
  if (!noLlm) {
    await step('Kimi V1..V5 reconcile (optional)', async () => {
      const cacheFile = resolve(REPO, `tools/_wave-v-cache/${slug}.json`);
      /* Wave UQ-CASH A5 — cache invalidation by parser source hash.
       * When src/parser.mjs / src/registry/smartDefaults.mjs changes, the cached
       * V6 reconcile becomes structurally outdated (it captures a snapshot of
       * model shape from a prior parser run). We hash a stable set of source
       * files and compare against the cached `__parser_hash__` field; mismatch
       * → delete cache, re-run (when Kimi available) or fall through. */
      const parserHash = await _computeParserHash();
      const fsp = await import('node:fs/promises');
      if (existsSync(cacheFile)) {
        try {
          const raw = await fsp.readFile(cacheFile, 'utf8');
          const cached = JSON.parse(raw);
          const cachedHash = cached && cached.__parser_hash__;
          if (cachedHash === parserHash) {
            log('  cache hit (hash match) — skip Kimi call');
            return;
          }
          log(`  cache stale (hash drift ${(cachedHash || 'none').slice(0, 8)} → ${parserHash.slice(0, 8)}) — invalidating`);
          await fsp.unlink(cacheFile).catch(() => {});
        } catch (e) {
          log('  cache parse failed (' + e.message + ') — invalidating');
          await fsp.unlink(cacheFile).catch(() => {});
        }
      }
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
      if (r.status !== 0) throw new Error('reconcile exit ' + r.status);
      /* Stamp parser hash so future runs detect cache staleness. */
      if (existsSync(cacheFile)) {
        try {
          const cur = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
          cur.__parser_hash__ = parserHash;
          await fsp.writeFile(cacheFile, JSON.stringify(cur, null, 2), 'utf8');
        } catch (e) {
          log('  warn: could not stamp parser hash: ' + e.message);
        }
      }
    }).catch((e) => {
      log('  reconcile soft-fail: ' + e.message + ' (continuing without)');
    });
  } else {
    log('--no-llm — skipping reconcile');
  }

  /* Step 6: build HTML */
  let html;
  await step('buildSlotHTML', async () => {
    const { buildSlotHTML } = await import(resolve(REPO, 'src/buildSlotHTML.mjs'));
    html = buildSlotHTML(model);
    summary.htmlBytes = html ? html.length : 0;
    if (!html || html.length < 1000) throw new Error('HTML output too small: ' + (html ? html.length : 0));
  });

  /* Step 7: write outputs */
  const outDir = resolve(DIST, slug);
  await step('write outputs', async () => {
    await mkdir(outDir, { recursive: true });
    await writeFile(resolve(outDir, 'index.html'), html, 'utf8');
    await writeFile(resolve(outDir, 'model.json'), JSON.stringify(model, null, 2), 'utf8');
    await writeFile(resolve(outDir, 'raw.txt'), rawText, 'utf8');
    summary.outDir = outDir;
    summary.finishedAt = new Date().toISOString();
    await writeFile(resolve(outDir, 'ingest.log'), JSON.stringify(summary, null, 2), 'utf8');
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

  process.exit(0);
} catch (e) {
  console.error('✗ ingest failed:', e.message);
  process.exit(1);
}
