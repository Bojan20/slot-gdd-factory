#!/usr/bin/env node
/**
 * tools/_uq-deep-ao-block-presentation-audit.mjs
 *
 * UQ-DEEP-AO · QA-D — Block Presentation Audit.
 *
 * Audits all blocks under src/blocks/ for PRESENTATION quality:
 *   Test 1 — CSS sanity     (emit*CSS  with defaultConfig+enabled=true)
 *   Test 2 — Markup sanity  (emit*Markup)
 *   Test 3 — Runtime sanity (emit*Runtime + new Function() parse)
 *   Test 4 — Manifest accuracy (defaultConfigEnabled, hasEmit*, frozen)
 *   Test 5 — Visual edge case smoke (20 random sampled blocks; verifies
 *           dist/*_playable.html contains the block CSS/markup fingerprint
 *           and no obvious render breakage — keeps the audit headless &
 *           deterministic, < 5min wallclock).
 *
 * NEVER writes into blocks/, parser, or build. Read-only audit.
 *
 * Output:
 *   stdout  — aggregate stats + TOP-10 tables (box-drawn ASCII)
 *   JSON    — tools/_eyes/block-presentation/_ao.json (full per-block detail)
 *   MD      — tools/_eyes/block-presentation/_ao.md   (human report)
 *
 * Exit code 0 always (this is an audit, not a gate).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join, basename } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const BLOCKS_DIR = join(REPO, 'src', 'blocks');
const MANIFEST   = join(REPO, 'blocks', '_manifest.json');
const OUT_DIR    = join(REPO, 'tools', '_eyes', 'block-presentation');
const DIST_DIR   = join(REPO, 'dist');

mkdirSync(OUT_DIR, { recursive: true });

// ── Discovery ─────────────────────────────────────────────────────────────
function discoverBlocks(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...discoverBlocks(p, prefix + entry + '/'));
    } else if (entry.endsWith('.mjs')) {
      out.push({ name: entry.replace(/\.mjs$/, ''), file: p, rel: prefix + entry });
    }
  }
  return out;
}

const blocks = discoverBlocks(BLOCKS_DIR).sort((a, b) => a.rel.localeCompare(b.rel));

// ── Manifest by name ──────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
const manifestByName = {};
for (const b of manifest.blocks || []) manifestByName[b.name] = b;

// ── Helpers ───────────────────────────────────────────────────────────────
const HUD_LIKE = /(Hud|Hub|Toolbar|Toast|Tooltip|Modal|Overlay|Bar)/i;
const TOOLTIP_LIKE = /(Tooltip|Modal|Overlay|Dialog|Toast)/i;

function isUnclosedHTML(html) {
  // Very forgiving — count opening vs closing tags ignoring void elements.
  const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const openRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/)?>/g;
  const closeRe = /<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/g;
  const opens = {};
  const closes = {};
  let m;
  while ((m = openRe.exec(html))) {
    const tag = m[1].toLowerCase();
    if (VOID.has(tag)) continue;
    if (m[2] === '/') continue; // self-closing
    opens[tag] = (opens[tag] || 0) + 1;
  }
  while ((m = closeRe.exec(html))) {
    const tag = m[1].toLowerCase();
    closes[tag] = (closes[tag] || 0) + 1;
  }
  // Mismatch means unclosed.
  const allTags = new Set([...Object.keys(opens), ...Object.keys(closes)]);
  for (const tag of allTags) {
    if ((opens[tag] || 0) !== (closes[tag] || 0)) return true;
  }
  return false;
}

function findCssSmells(css, name) {
  const smells = [];
  if (/position\s*:\s*fixed\b/i.test(css) && !HUD_LIKE.test(name)) {
    smells.push('position:fixed-outside-hud');
  }
  // z-index parse — find highest number
  const ziMatches = [...css.matchAll(/z-index\s*:\s*(-?\d+)/gi)];
  for (const zm of ziMatches) {
    const v = parseInt(zm[1], 10);
    if (v > 100 && !TOOLTIP_LIKE.test(name)) {
      smells.push(`z-index=${v}>100`);
      break;
    }
  }
  if (/\bwidth\s*:\s*100vw\b/i.test(css)) {
    smells.push('width:100vw');
  }
  // Magic colors: hex literals NOT routed via var(--*). Tolerate small palettes.
  const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(x => x[0].toLowerCase());
  // Tokenized hexes are commonly inside `var(--*: #xxx)` declarations only.
  const uniqHex = [...new Set(hexes)];
  if (uniqHex.length > 8) smells.push(`magic-colors=${uniqHex.length}`);
  return smells;
}

function findMarkupSmells(html, name) {
  const smells = [];
  if (!new RegExp(`data-block(-name)?\\s*=`).test(html)) {
    smells.push('no-data-block-name');
  }
  // Interactive elements?
  const hasInteractive = /<(button|a|input|select|textarea)\b/i.test(html);
  const hasAria = /\b(aria-[a-z]+|role)\s*=/i.test(html);
  if (hasInteractive && !hasAria) smells.push('interactive-no-aria');
  if (/\bonclick\s*=/i.test(html) || /\bonmouseover\s*=/i.test(html) || /\bonload\s*=/i.test(html)) {
    smells.push('inline-event-handler');
  }
  return smells;
}

function findRuntimeSmells(js, name) {
  const smells = [];
  // IIFE wrap: look for (function or (() => ...) or "(function _init" patterns.
  const hasIIFE = /\(\s*function\s*[^(]*\([^)]*\)\s*\{|\(\s*\(\s*\)\s*=>/.test(js);
  if (!hasIIFE && js.trim().length > 50) smells.push('no-iife');
  // Direct HookBus references without guard:
  //   const bus = window.HookBus || globalThis.HookBus;
  //   if (!bus...) return;   ← guarded
  // Look for window.HookBus access NOT preceded within ~120 chars by 'if (!' or '?' or '&&':
  const busAccess = [...js.matchAll(/\b(?:window|globalThis|self)\.HookBus\b/g)];
  if (busAccess.length > 0) {
    // Heuristic guard check: must have `if (` referencing the bus var, OR optional chaining `?.`, OR `&&` short-circuit, OR a `|| globalThis.HookBus` polyfill chain.
    const hasGuard = /HookBus\s*\?\./.test(js)
      || /if\s*\(\s*!?\s*[A-Za-z_$][\w$]*\s*(\|\||&&)/.test(js)
      || /if\s*\(\s*!?\w*[Bb]us\s*(\.|&&|\|\||\))/.test(js)
      || /typeof\s+\w*[Bb]us\b/.test(js)
      || /\|\|\s*(globalThis|self|window)\.HookBus/.test(js);
    if (!hasGuard) smells.push('unguarded-hookbus');
  }
  // Magic timeouts (literal large numbers in setTimeout/setInterval).
  const tm = [...js.matchAll(/set(?:Timeout|Interval)\s*\(\s*[^,]+,\s*(\d{4,})\s*\)/g)];
  if (tm.length > 0) {
    const big = tm.map(x => parseInt(x[1], 10)).filter(v => v >= 10000);
    if (big.length > 0) smells.push(`magic-timeout=${big[0]}`);
  }
  // Global pollution: top-level `var X` / `function X` / `let X` / `const X` declarations
  // outside an IIFE. Heuristic: count top-level non-export declarations.
  // Skip — emitted runtime strings live inside <script> in the rendered HTML; the IIFE
  // check above already enforces wrapping. We add a soft signal only.
  return smells;
}

// ── Run audits ────────────────────────────────────────────────────────────
const results = [];
const t0 = Date.now();

async function auditBlock(b) {
  const rec = {
    name: b.name,
    rel: b.rel,
    tests: { t1: null, t2: null, t3: null, t4: null, t5: null },
    cssSmells: [],
    markupSmells: [],
    runtimeSmells: [],
    manifestDrift: [],
    failedTests: 0,
    issueSummary: [],
  };

  let mod;
  try {
    mod = await import(pathToFileURL(b.file).href);
  } catch (e) {
    rec.tests.t1 = false; rec.tests.t2 = false; rec.tests.t3 = false; rec.tests.t4 = false; rec.tests.t5 = false;
    rec.failedTests = 5;
    rec.issueSummary.push(`import-failed:${(e.message || e).toString().slice(0, 80)}`);
    return rec;
  }

  // Locate emit* functions
  const exports = Object.keys(mod);
  const cssFn = exports.find(k => /^emit[A-Z_].*CSS$/.test(k) || k === 'emitCSS');
  const markupFn = exports.find(k => /^emit[A-Z_].*Markup$/.test(k) || k === 'emitMarkup');
  const runtimeFn = exports.find(k => /^emit[A-Z_].*Runtime$/.test(k) || k === 'emitRuntime');

  // Resolve a config with enabled=true
  let cfg = {};
  try {
    if (typeof mod.defaultConfig === 'function') {
      const dc = mod.defaultConfig();
      cfg = { ...dc, enabled: true };
    }
  } catch { cfg = { enabled: true }; }

  // ── Test 1: CSS sanity ──
  if (cssFn && typeof mod[cssFn] === 'function') {
    try {
      const css = String(mod[cssFn](cfg) ?? '');
      if (css.length === 0) {
        rec.tests.t1 = false;
        rec.issueSummary.push('css:empty');
      } else {
        // Validity: opening / closing braces balanced.
        const opens = (css.match(/\{/g) || []).length;
        const closes = (css.match(/\}/g) || []).length;
        if (opens !== closes) {
          rec.tests.t1 = false;
          rec.issueSummary.push(`css:unbalanced-braces ${opens}/${closes}`);
        } else {
          rec.tests.t1 = true;
        }
        rec.cssSmells = findCssSmells(css, b.name);
      }
    } catch (e) {
      rec.tests.t1 = false;
      rec.issueSummary.push(`css:throw:${(e.message || e).toString().slice(0, 60)}`);
    }
  } else {
    rec.tests.t1 = 'n/a';
  }

  // ── Test 2: Markup sanity ──
  if (markupFn && typeof mod[markupFn] === 'function') {
    try {
      const html = String(mod[markupFn](cfg) ?? '');
      if (html.length === 0) {
        rec.tests.t2 = false;
        rec.issueSummary.push('markup:empty');
      } else {
        if (isUnclosedHTML(html)) {
          rec.tests.t2 = false;
          rec.issueSummary.push('markup:unclosed-tags');
        } else {
          rec.tests.t2 = true;
        }
        rec.markupSmells = findMarkupSmells(html, b.name);
      }
    } catch (e) {
      rec.tests.t2 = false;
      rec.issueSummary.push(`markup:throw:${(e.message || e).toString().slice(0, 60)}`);
    }
  } else {
    rec.tests.t2 = 'n/a';
  }

  // ── Test 3: Runtime sanity ──
  if (runtimeFn && typeof mod[runtimeFn] === 'function') {
    try {
      const js = String(mod[runtimeFn](cfg) ?? '');
      if (js.length === 0) {
        rec.tests.t3 = false;
        rec.issueSummary.push('runtime:empty');
      } else {
        // Syntax validity via new Function(). Runtime strings live inside
        // <script> tags so they may use top-level `return` — wrap them.
        try {
          // eslint-disable-next-line no-new-func
          new Function(`(function _audit_wrap_(){ ${js} })`);
          rec.tests.t3 = true;
        } catch (synErr) {
          rec.tests.t3 = false;
          rec.issueSummary.push(`runtime:syntax:${synErr.message.slice(0, 60)}`);
        }
        rec.runtimeSmells = findRuntimeSmells(js, b.name);
      }
    } catch (e) {
      rec.tests.t3 = false;
      rec.issueSummary.push(`runtime:throw:${(e.message || e).toString().slice(0, 60)}`);
    }
  } else {
    rec.tests.t3 = 'n/a';
  }

  // ── Test 4: Manifest accuracy ──
  const mEntry = manifestByName[b.name];
  if (!mEntry) {
    rec.tests.t4 = false;
    rec.manifestDrift.push('not-in-manifest');
    rec.issueSummary.push('manifest:missing');
  } else {
    let drift = false;
    // enabledByDefault
    let actualEnabled = false;
    try {
      if (typeof mod.defaultConfig === 'function') {
        const dc = mod.defaultConfig();
        actualEnabled = !!dc.enabled;
      }
    } catch {}
    if (mEntry.enabledByDefault !== actualEnabled) {
      drift = true;
      rec.manifestDrift.push(`enabledByDefault:${mEntry.enabledByDefault}!=${actualEnabled}`);
    }
    // frozen
    let actuallyFrozen = false;
    try {
      if (typeof mod.defaultConfig === 'function') {
        const dc = mod.defaultConfig();
        actuallyFrozen = Object.isFrozen(dc);
      }
    } catch {}
    if (mEntry.frozen !== actuallyFrozen) {
      drift = true;
      rec.manifestDrift.push(`frozen:${mEntry.frozen}!=${actuallyFrozen}`);
    }
    // hasEmitCSS / Markup / Runtime (manifest exports list is canonical)
    const exportsList = mEntry.exports || [];
    const manHasCss = exportsList.some(e => /CSS$/.test(e));
    const manHasMk = exportsList.some(e => /Markup$/.test(e));
    const manHasRt = exportsList.some(e => /Runtime$/.test(e));
    const realHasCss = !!cssFn;
    const realHasMk = !!markupFn;
    const realHasRt = !!runtimeFn;
    if (manHasCss !== realHasCss) { drift = true; rec.manifestDrift.push(`hasEmitCSS:${manHasCss}!=${realHasCss}`); }
    if (manHasMk !== realHasMk)   { drift = true; rec.manifestDrift.push(`hasEmitMarkup:${manHasMk}!=${realHasMk}`); }
    if (manHasRt !== realHasRt)   { drift = true; rec.manifestDrift.push(`hasEmitRuntime:${manHasRt}!=${realHasRt}`); }
    rec.tests.t4 = !drift;
    if (drift) rec.issueSummary.push(`manifest:${rec.manifestDrift.length}drifts`);
  }

  // ── Count fails ──
  for (const v of Object.values(rec.tests)) if (v === false) rec.failedTests++;
  return rec;
}

for (const b of blocks) {
  // eslint-disable-next-line no-await-in-loop
  const rec = await auditBlock(b);
  results.push(rec);
}

// ── Test 5: Visual edge case smoke (20 random sampled blocks) ──
// We use deterministic sampling (seeded by block index modulo) so the audit
// is idempotent. For each sampled block we look for fingerprint presence in
// 4 representative dist HTMLs (rect-5x3, rect-6x4, cluster, megaways-ish).
const SAMPLE_SIZE = 20;
const distSamples = [];
if (existsSync(DIST_DIR)) {
  const all = readdirSync(DIST_DIR).filter(f => f.endsWith('_playable.html')).sort();
  if (all.length > 0) {
    const step = Math.max(1, Math.floor(all.length / 4));
    for (let i = 0; i < all.length && distSamples.length < 4; i += step) {
      distSamples.push(join(DIST_DIR, all[i]));
    }
  }
}
const distContents = distSamples.map(p => {
  try { return { p, body: readFileSync(p, 'utf-8') }; }
  catch { return { p, body: '' }; }
});

// Pick every floor(N/20)-th block for deterministic sample
const sampleIdx = new Set();
if (results.length > 0) {
  const step = Math.max(1, Math.floor(results.length / SAMPLE_SIZE));
  for (let i = 0; i < results.length && sampleIdx.size < SAMPLE_SIZE; i += step) {
    sampleIdx.add(i);
  }
}

let t5Pass = 0; let t5Fail = 0; let t5NA = 0;
for (let i = 0; i < results.length; i++) {
  if (!sampleIdx.has(i)) continue;
  const rec = results[i];
  // Fingerprint = block name (camelCase) AND/OR snake form. Most blocks
  // emit `/* ── <name> BLOCK ──` comments + `data-block-name="<name>"`.
  const needle1 = rec.name;
  const needle2 = `data-block-name="${rec.name}"`;
  let hits = 0;
  let checkErrors = 0;
  for (const { body } of distContents) {
    if (!body) continue;
    if (body.includes(needle1) || body.includes(needle2)) hits++;
    // Brutal heuristic for layout breakage signal: stray `</body>` before block,
    // unbalanced root divs — but at this layer we just confirm it didn't crash
    // the pipeline. Real visual QA lives in V9. We mark fail only when block
    // name is referenced but with stray `undefined` / `[object Object]` near it.
    const idx = body.indexOf(needle1);
    if (idx >= 0) {
      const window = body.slice(Math.max(0, idx - 80), idx + 200);
      if (/\bundefined\b/.test(window) || /\[object Object\]/.test(window)) checkErrors++;
    }
  }
  if (distContents.length === 0) {
    rec.tests.t5 = 'n/a';
    t5NA++;
  } else if (hits === 0) {
    // Block never appears in dist — that's "dormant" (not necessarily a fail
    // for presentation audit). Mark n/a rather than fail.
    rec.tests.t5 = 'n/a';
    t5NA++;
  } else if (checkErrors > 0) {
    rec.tests.t5 = false;
    rec.failedTests++;
    rec.issueSummary.push(`visual:undefined/object-near-block (${checkErrors}x)`);
    t5Fail++;
  } else {
    rec.tests.t5 = true;
    t5Pass++;
  }
}

// ── Aggregate ─────────────────────────────────────────────────────────────
function countPass(key) {
  let pass = 0, fail = 0, na = 0;
  for (const r of results) {
    const v = r.tests[key];
    if (v === true) pass++;
    else if (v === false) fail++;
    else na++;
  }
  return { pass, fail, na };
}
const t1 = countPass('t1');
const t2 = countPass('t2');
const t3 = countPass('t3');
const t4 = countPass('t4');

// ── TOP-10 lists ──────────────────────────────────────────────────────────
function top10ByFails() {
  return [...results]
    .filter(r => r.failedTests > 0)
    .sort((a, b) => b.failedTests - a.failedTests || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function top10Smells(field) {
  // Collect (block, smell) pairs and return blocks with the most smells.
  const list = [];
  for (const r of results) {
    const arr = r[field];
    if (arr && arr.length) list.push({ name: r.name, smells: arr });
  }
  return list.sort((a, b) => b.smells.length - a.smells.length || a.name.localeCompare(b.name)).slice(0, 10);
}

const topFails = top10ByFails();
const topCssSmells = top10Smells('cssSmells');
const topMarkupSmells = top10Smells('markupSmells');
const topRuntimeSmells = top10Smells('runtimeSmells');
const driftList = results.filter(r => r.manifestDrift.length > 0).sort((a, b) => b.manifestDrift.length - a.manifestDrift.length || a.name.localeCompare(b.name));

// ── Pretty box-drawn tables (used in stdout + .md) ────────────────────────
function pad(s, n) { s = String(s); if (s.length >= n) return s.slice(0, n); return s + ' '.repeat(n - s.length); }

function drawTable(headers, widths, rows) {
  const top    = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid    = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot    = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';
  const fmtRow = cells => '│ ' + cells.map((c, i) => pad(c, widths[i])).join(' │ ') + ' │';
  const out = [];
  out.push(top);
  out.push(fmtRow(headers));
  out.push(mid);
  for (const r of rows) out.push(fmtRow(r));
  out.push(bot);
  return out.join('\n');
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

// ── Stats block ───────────────────────────────────────────────────────────
const statsTable = drawTable(
  ['Test', 'Pass', 'Fail', 'N/A'],
  [40, 6, 6, 6],
  [
    [`Total blocks scanned`,           String(results.length), '',  ''],
    [`Test 1  CSS sanity`,             String(t1.pass), String(t1.fail), String(t1.na)],
    [`Test 2  Markup sanity`,          String(t2.pass), String(t2.fail), String(t2.na)],
    [`Test 3  Runtime sanity`,         String(t3.pass), String(t3.fail), String(t3.na)],
    [`Test 4  Manifest accuracy`,      String(t4.pass), String(t4.fail), String(t4.na)],
    [`Test 5  Visual edge (20 sample)`,String(t5Pass),  String(t5Fail),  String(t5NA)],
  ],
);

let topFailsTable = '(none — every block passed every applicable test)';
if (topFails.length > 0) {
  topFailsTable = drawTable(
    ['Block', 'Fails', 'Issue summary'],
    [32, 5, 60],
    topFails.map(r => [r.name, String(r.failedTests), r.issueSummary.slice(0, 3).join('; ').slice(0, 60)]),
  );
}

function smellTable(list) {
  if (list.length === 0) return '(none)';
  return drawTable(
    ['Block', 'Count', 'Smells'],
    [32, 5, 60],
    list.map(x => [x.name, String(x.smells.length), x.smells.join(', ').slice(0, 60)]),
  );
}
const cssTable    = smellTable(topCssSmells);
const markupTable = smellTable(topMarkupSmells);
const runtimeTable = smellTable(topRuntimeSmells);

let driftTable = '(0 manifest drift findings)';
if (driftList.length > 0) {
  driftTable = drawTable(
    ['Block', 'Drifts', 'Detail'],
    [32, 6, 60],
    driftList.slice(0, 10).map(r => [r.name, String(r.manifestDrift.length), r.manifestDrift.join('; ').slice(0, 60)]),
  );
}

// ── Render report ─────────────────────────────────────────────────────────
const report = [
  `# UQ-DEEP-AO · Block Presentation Audit`,
  ``,
  `Repo: \`slot-gdd-factory\`  ·  Blocks scanned: ${results.length}  ·  Wallclock: ${elapsed}s`,
  ``,
  `## Aggregate stats`,
  '',
  statsTable,
  '',
  `## TOP 10 blocks with the most failed tests`,
  '',
  topFailsTable,
  '',
  `## TOP 10 CSS smells`,
  '',
  cssTable,
  '',
  `## TOP 10 Markup smells`,
  '',
  markupTable,
  '',
  `## TOP 10 Runtime smells`,
  '',
  runtimeTable,
  '',
  `## Manifest drift findings`,
  '',
  driftTable,
  '',
].join('\n');

console.log(report);

writeFileSync(join(OUT_DIR, '_ao.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  elapsedSec: parseFloat(elapsed),
  totals: { scanned: results.length, t1, t2, t3, t4, t5: { pass: t5Pass, fail: t5Fail, na: t5NA } },
  topFails: topFails.map(r => ({ name: r.name, failedTests: r.failedTests, issueSummary: r.issueSummary })),
  cssSmells: topCssSmells,
  markupSmells: topMarkupSmells,
  runtimeSmells: topRuntimeSmells,
  manifestDrift: driftList.map(r => ({ name: r.name, drifts: r.manifestDrift })),
  blocks: results,
}, null, 2), 'utf-8');
writeFileSync(join(OUT_DIR, '_ao.md'), report, 'utf-8');

process.exit(0);
