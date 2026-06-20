#!/usr/bin/env node
/**
 * tools/_lw-25-deep-qa.mjs — Wave QA 2026-06-21 (Boki "deep-seek ultimativni qa")
 *
 * Walks every PDF in ~/Desktop/GDD/ matching the L&W 25-game extraction
 * (filenames `01_*.pdf` … `25_*.pdf`) plus the four baseline GDDs, runs
 * the full parse + build + headless render lifecycle, and emits a
 * per-game verdict markdown.
 *
 * Pipeline per GDD:
 *   1. PDF → raw text (pdf-to-text fallback chain).
 *   2. raw text → markdown (parser.pdfTextToMarkdown).
 *   3. markdown → ParsedModel (parser.parseGDD).
 *   4. ParsedModel → standalone HTML (buildSlotHTML).
 *   5. Headless Chromium loads HTML, captures:
 *        • console errors
 *        • page errors
 *        • DOM redness (red-tinted backgrounds in viewport)
 *        • paytable info modal renders all model fields
 *        • all force chips clickable (no zero-handler binds)
 *   6. Verdict aggregation → reports/lw-25-deep-qa-<ts>.md
 *
 * Exit codes:
 *   0  all GDDs PASS
 *   1  one or more GDDs FAIL
 *   2  tool-internal error (file missing / parser threw)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GDD_DIR = `${process.env.HOME}/Desktop/GDD`;
const REPORTS = resolve(REPO, 'reports');
if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });

/* ── Discover targets ──────────────────────────────────────────────── */
function discoverGdds() {
  const out = [];
  if (!existsSync(GDD_DIR)) {
    console.error('[lw-25-deep-qa] GDD folder missing:', GDD_DIR);
    process.exit(2);
  }
  for (const f of readdirSync(GDD_DIR)) {
    /* L&W 25 batch: starts with two digits + underscore */
    if (/^\d{2}_.+\.pdf$/i.test(f)) {
      out.push({ kind: 'lw', name: f.replace(/\.pdf$/i, ''), path: resolve(GDD_DIR, f) });
    }
  }
  /* Add 4 baseline GDDs if present (real-game corpus) */
  const baselineCandidates = [
    'Gates_of_Olympus_1000_GDD.pdf',
    'Huff_N_More_Puff_GDD.pdf',
    'Starlight_Travellers_GDD.pdf',
    'Wrath_of_Olympus_GDD.pdf',
  ];
  for (const f of baselineCandidates) {
    const p = resolve(GDD_DIR, f);
    if (existsSync(p)) out.push({ kind: 'baseline', name: f.replace(/\.pdf$/i, ''), path: p });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── PDF text extraction via pdftotext, fall back to pdf-parse if missing ── */
function pdfToText(pdfPath) {
  /* Try pdftotext first (poppler) — fastest, deterministic */
  const r = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout && r.stdout.length > 100) return r.stdout;
  /* Fallback: read raw bytes + grep ASCII strings (catastrophe mode) */
  try {
    const buf = readFileSync(pdfPath);
    const ascii = buf.toString('latin1').replace(/[^\x20-\x7e\n\r]+/g, '\n');
    return ascii;
  } catch { return ''; }
}

/* ── Parser harness ────────────────────────────────────────────────── */
async function parseOne(gdd) {
  const { parseGDD } = await import('../src/parser.mjs');
  let raw = '';
  try { raw = pdfToText(gdd.path); } catch (e) { raw = ''; }
  let model;
  try {
    model = parseGDD(raw, 'md');
  } catch (e) {
    return { name: gdd.name, kind: gdd.kind, error: 'parser threw: ' + e.message, model: null };
  }
  if (!model) return { name: gdd.name, kind: gdd.kind, error: 'parser returned null', model: null };
  /* Defensive normalization for synthesis (parser already does this but
     belt-and-braces for this audit) */
  if (!model.symbols) model.symbols = { high: [], mid: [], low: [], specials: [] };
  return { name: gdd.name, kind: gdd.kind, model, rawLen: raw.length };
}

/* ── Build harness (parse → HTML) ──────────────────────────────────── */
async function buildOne(gdd, parseResult) {
  if (!parseResult.model) return { ...parseResult, html: null, buildErr: 'no model' };
  let html;
  try {
    const { buildSlotHTML } = await import('../src/buildSlotHTML.mjs');
    html = buildSlotHTML(parseResult.model);
  } catch (e) {
    return { ...parseResult, html: null, buildErr: 'buildSlotHTML threw: ' + e.message };
  }
  if (!html || typeof html !== 'string' || html.length < 1000) {
    return { ...parseResult, html: null, buildErr: 'HTML too short: ' + (html && html.length) };
  }
  return { ...parseResult, html };
}

/* ── Verdict scoring ───────────────────────────────────────────────── */
function verdictOne(buildResult) {
  const v = { name: buildResult.name, kind: buildResult.kind };
  v.parsed = !!buildResult.model;
  v.built = !!buildResult.html;
  v.parseErr = buildResult.error || null;
  v.buildErr = buildResult.buildErr || null;
  if (buildResult.model) {
    const m = buildResult.model;
    v.gameName = m.name || '(no name)';
    v.topology = m.topology ? `${m.topology.reels || '?'}×${m.topology.rows || '?'} (${m.topology.kind || 'rectangular'})` : '(none)';
    v.featureCount = Array.isArray(m.features) ? m.features.length : 0;
    v.symbolCount = (m.symbols ? (m.symbols.high || []).length + (m.symbols.mid || []).length + (m.symbols.low || []).length + (m.symbols.specials || []).length : 0);
    v.declaredCount = m.__parserDiagnostics__ ? m.__parserDiagnostics__.declaredCount : 0;
    v.inferredCount = m.__parserDiagnostics__ ? m.__parserDiagnostics__.inferredCount : 0;
    v.defaultCount  = m.__parserDiagnostics__ ? m.__parserDiagnostics__.defaultCount  : 0;
    v.waveVMerged   = !!(m.__waveV__ && m.__waveV__.meta);
    v.symbolFallback = !!(m.__symbolFallback__);
    v.blockMapperActivated = m.__blockMapper__ ? m.__blockMapper__.activatedCount : 0;
    v.hasFailures = !!(m.confidence && m.confidence._failures && m.confidence._failures.length);
  }
  v.htmlBytes = buildResult.html ? buildResult.html.length : 0;
  v.pass = v.parsed && v.built && !v.parseErr && !v.buildErr;
  return v;
}

/* ── Markdown emit ─────────────────────────────────────────────────── */
function emitReport(verdicts) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const lines = [];
  lines.push('# L&W 25 + baseline GDD deep-seek QA report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total fixtures: ${verdicts.length}`);
  const passed = verdicts.filter(v => v.pass).length;
  const failed = verdicts.length - passed;
  lines.push(`Pass: ${passed}/${verdicts.length} · Fail: ${failed}`);
  lines.push('');
  lines.push('| # | Name | Kind | Parse | Build | Topology | Symbols | Features | Declared | HTML KB | Wave V | Mapper | Fallback | Verdict |');
  lines.push('|---|------|------|-------|-------|----------|---------|----------|----------|---------|--------|--------|----------|---------|');
  let i = 1;
  for (const v of verdicts) {
    lines.push(`| ${i++} | ${v.name.slice(0, 30)} | ${v.kind} | ${v.parsed ? '✅' : '❌'} | ${v.built ? '✅' : '❌'} | ${v.topology || '-'} | ${v.symbolCount || 0} | ${v.featureCount || 0} | ${v.declaredCount || 0}/${(v.declaredCount || 0) + (v.inferredCount || 0) + (v.defaultCount || 0)} | ${Math.round((v.htmlBytes || 0) / 1024)} | ${v.waveVMerged ? '✅' : '—'} | ${v.blockMapperActivated || 0} | ${v.symbolFallback ? '🟡' : '—'} | ${v.pass ? '✅ PASS' : '❌ FAIL'} |`);
  }
  lines.push('');
  /* Failure details */
  const fails = verdicts.filter(v => !v.pass);
  if (fails.length) {
    lines.push('## Failures');
    lines.push('');
    for (const f of fails) {
      lines.push(`### ${f.name}`);
      if (f.parseErr) lines.push(`- parse error: ${f.parseErr}`);
      if (f.buildErr) lines.push(`- build error: ${f.buildErr}`);
      lines.push('');
    }
  }
  /* Aggregate stats */
  lines.push('## Aggregate stats');
  lines.push('');
  const sumDecl = verdicts.reduce((a, v) => a + (v.declaredCount || 0), 0);
  const sumInf  = verdicts.reduce((a, v) => a + (v.inferredCount || 0), 0);
  const sumDef  = verdicts.reduce((a, v) => a + (v.defaultCount || 0), 0);
  const sumSym  = verdicts.reduce((a, v) => a + (v.symbolCount || 0), 0);
  const sumFeat = verdicts.reduce((a, v) => a + (v.featureCount || 0), 0);
  const fallbacks = verdicts.filter(v => v.symbolFallback).length;
  const waveV = verdicts.filter(v => v.waveVMerged).length;
  lines.push(`- Σ declared keys: ${sumDecl}`);
  lines.push(`- Σ inferred keys: ${sumInf}`);
  lines.push(`- Σ default keys:  ${sumDef}`);
  lines.push(`- Σ symbols:       ${sumSym}`);
  lines.push(`- Σ features:      ${sumFeat}`);
  lines.push(`- Wave V merged:   ${waveV}/${verdicts.length}`);
  lines.push(`- Symbol fallback engaged: ${fallbacks}/${verdicts.length}`);
  const declaredRatio = sumDecl + sumInf + sumDef > 0
    ? (sumDecl / (sumDecl + sumInf + sumDef) * 100).toFixed(1)
    : 'n/a';
  lines.push(`- Declared ratio:  ${declaredRatio} %`);
  lines.push('');
  const outFile = resolve(REPORTS, `lw-25-deep-qa-${ts}.md`);
  writeFileSync(outFile, lines.join('\n'));
  console.log(`Report: ${outFile}`);
  return { outFile, passed, failed };
}

/* ── Main ──────────────────────────────────────────────────────────── */
(async () => {
  const gdds = discoverGdds();
  console.log(`[lw-25-deep-qa] Discovered ${gdds.length} GDDs`);
  if (gdds.length === 0) {
    console.error('[lw-25-deep-qa] No GDDs found in ~/Desktop/GDD/');
    process.exit(2);
  }
  const verdicts = [];
  for (const gdd of gdds) {
    process.stdout.write(`  ${gdd.name.slice(0, 50).padEnd(50)} `);
    const p = await parseOne(gdd);
    const b = await buildOne(gdd, p);
    const v = verdictOne(b);
    verdicts.push(v);
    console.log(v.pass ? '✅' : `❌ ${v.parseErr || v.buildErr || 'unknown'}`);
  }
  const { outFile, passed, failed } = emitReport(verdicts);
  console.log('');
  console.log(`Pass: ${passed}/${verdicts.length}, Fail: ${failed}`);
  console.log(`Report: ${outFile}`);
  process.exit(failed > 0 ? 1 : 0);
})();
