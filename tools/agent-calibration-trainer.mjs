#!/usr/bin/env node
/**
 * tools/agent-calibration-trainer.mjs · Wave UQ-TRAIN
 *
 * Boki direktiva: "odradi im trening ili kako gode misli sfuturisticki da
 * je bolje" (2026-06-21).
 *
 * Closed-loop calibration trainer for V1..V5 Kimi lane agents:
 *
 *   1. For each of 5 baseline GDDs (Cash Eruption + 4 baselines):
 *      a. Load pinned ground truth from tests/fixtures/semantic-expected.json
 *      b. Load cached V6 reconcile from tools/_wave-v-cache/<slug>.json
 *      c. Diff agent output vs ground truth + parser baseline
 *   2. Aggregate diffs into per-lane "calibration delta" report:
 *      - V1 (topology): how often did agent miss reels/rows/paylines?
 *      - V2 (symbols): how often did agent fail to capture named symbols?
 *      - V3 (features): how often did agent miss declared feature kinds?
 *      - V4 (UX): how often did agent miss theme.* fields?
 *      - V5 (compliance): how often did agent miss jurisdiction fields?
 *   3. Emit `AGENT_CALIBRATION` block updates to each lane prompt
 *      (agents/parser-pool/V1_TOPOLOGY.md, etc.) with concrete corrections
 *      tied to specific PDF quotes — surgical, not generic.
 *   4. Write reports/agent-calibration-<timestamp>.md
 *
 * The output is INFORMATIONAL — does NOT mutate lane prompt files unless
 * `--apply` flag is passed. Default mode is dry-run / report-only so
 * Boki can review before approval.
 *
 * Exit codes:
 *   0  calibration report written, no fatal errors
 *   1  insufficient data (< 5 fixtures with cache hits)
 *   2  tool-internal error
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const APPLY = process.argv.includes('--apply');
const CALIBRATE_ALL = process.argv.includes('--all-corpus');

const fixturePath = resolve(REPO, 'tests/fixtures/semantic-expected.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

function resolveHome(p) { return p.replace(/^~/, process.env.HOME || ''); }
function pdfToText(p) {
  const r = spawnSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8', maxBuffer: 50_000_000 });
  return r.status === 0 ? r.stdout : '';
}
function toCacheSlug(s) { return s.toLowerCase().replace(/_/g, '-'); }

const { parseGDD } = await import('../src/parser.mjs');

/* ── Calibration deltas accumulator ───────────────────────────────────── */
const lanes = {
  V1: { name: 'topology', misses: [], correctCount: 0, totalCount: 0 },
  V2: { name: 'symbols',  misses: [], correctCount: 0, totalCount: 0 },
  V3: { name: 'features', misses: [], correctCount: 0, totalCount: 0 },
  V4: { name: 'ux',       misses: [], correctCount: 0, totalCount: 0 },
  V5: { name: 'compliance', misses: [], correctCount: 0, totalCount: 0 },
};

/* ── Discover fixtures (5 baseline or full corpus) ───────────────────── */
let fixtures = Object.entries(fixture.fixtures);
if (CALIBRATE_ALL) {
  /* Iterate every cache entry — pin parser baseline only (no ground truth). */
  const cacheDir = resolve(REPO, 'tools/_wave-v-cache');
  const cacheFiles = readdirSync(cacheDir).filter(f => f.endsWith('.json'));
  fixtures = cacheFiles.map(f => [f.replace(/\.json$/, ''), { pdf: null }]);
}

let cacheHits = 0;

console.log(`UQ-TRAIN — Agent Calibration Trainer (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
console.log(`Fixtures: ${fixtures.length}${CALIBRATE_ALL ? ' (full corpus)' : ' (baseline 5)'}`);
console.log('═'.repeat(74));

for (const [slug, expected] of fixtures) {
  const cachePath = resolve(REPO, `tools/_wave-v-cache/${toCacheSlug(slug)}.json`);
  if (!existsSync(cachePath)) continue;
  cacheHits++;

  const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
  const delta = cached.model_delta || {};
  const meta = cached.__meta__ || {};

  /* Parser baseline for diff (skip in --all-corpus mode to save time) */
  let parserModel = null;
  if (!CALIBRATE_ALL && expected.pdf) {
    const pdfPath = resolveHome(expected.pdf);
    if (existsSync(pdfPath)) {
      const raw = pdfToText(pdfPath);
      try { parserModel = parseGDD(raw, 'md'); } catch (_) {}
    }
  }

  /* V1: topology */
  lanes.V1.totalCount++;
  if (delta.topology) {
    const t = delta.topology;
    let v1Ok = true;
    if (expected.topology && expected.topology.reels !== undefined) {
      if (t.reels !== expected.topology.reels) {
        v1Ok = false;
        lanes.V1.misses.push({ slug, field: 'reels', agent: t.reels, expected: expected.topology.reels });
      }
    }
    if (expected.topology && expected.topology.rows !== undefined) {
      if (t.rows !== expected.topology.rows) {
        v1Ok = false;
        lanes.V1.misses.push({ slug, field: 'rows', agent: t.rows, expected: expected.topology.rows });
      }
    }
    if (v1Ok) lanes.V1.correctCount++;
  }

  /* V2: symbols (named symbols presence) */
  lanes.V2.totalCount++;
  if (expected.namedSymbols && expected.namedSymbols.length > 0) {
    const allLabels = (Array.isArray(delta.symbols)
      ? delta.symbols.map(s => (s.name || s.label || '').toLowerCase())
      : []);
    let v2Ok = true;
    for (const want of expected.namedSymbols) {
      if (!allLabels.some(l => l.includes(want.toLowerCase()))) {
        v2Ok = false;
        lanes.V2.misses.push({ slug, field: `symbol "${want}"`, agent: 'absent', expected: 'present' });
      }
    }
    if (v2Ok) lanes.V2.correctCount++;
  } else if (Array.isArray(delta.symbols) && delta.symbols.length >= 3) {
    lanes.V2.correctCount++;
  }

  /* V3: features */
  lanes.V3.totalCount++;
  const featCount = Array.isArray(delta.features) ? delta.features.length : 0;
  const minCount = (expected.features && expected.features.minCount) || 3;
  if (featCount >= minCount) lanes.V3.correctCount++;
  else lanes.V3.misses.push({ slug, field: 'features.length', agent: featCount, expected: `≥ ${minCount}` });

  /* V4: ux — theme.* coverage */
  lanes.V4.totalCount++;
  const themeKeys = (delta.theme && typeof delta.theme === 'object')
    ? Object.keys(delta.theme).filter(k => delta.theme[k] !== null && delta.theme[k] !== undefined)
    : [];
  if (themeKeys.length >= 3) lanes.V4.correctCount++;
  else lanes.V4.misses.push({ slug, field: 'theme.* fields', agent: themeKeys.length, expected: '≥ 3' });

  /* V5: compliance */
  lanes.V5.totalCount++;
  const compliancePresent = (delta.compliance && typeof delta.compliance === 'object' &&
                             Object.keys(delta.compliance).length > 0) ||
                            (delta.cert && typeof delta.cert === 'object' &&
                             Object.keys(delta.cert).length > 0);
  if (compliancePresent) lanes.V5.correctCount++;
  else lanes.V5.misses.push({ slug, field: 'compliance', agent: 'empty', expected: 'has fields' });
}

if (cacheHits < (CALIBRATE_ALL ? 50 : 4)) {
  console.error(`✗ insufficient cache hits (${cacheHits}) — fail`);
  process.exit(1);
}

/* ── Print per-lane summary ──────────────────────────────────────────── */
console.log('');
console.log('Per-lane calibration:');
console.log('');
console.log('| Lane | Name       | Correct | Total | Accuracy | Top misses |');
console.log('|------|------------|--------:|------:|---------:|------------|');
for (const [code, l] of Object.entries(lanes)) {
  const acc = l.totalCount > 0 ? (l.correctCount / l.totalCount * 100).toFixed(0) : '—';
  const topMisses = l.misses.slice(0, 3).map(m => `${m.field}: ${m.agent}→${m.expected}`).join('; ');
  console.log(`| ${code}   | ${l.name.padEnd(10)} | ${String(l.correctCount).padStart(7)} | ${String(l.totalCount).padStart(5)} | ${acc.padStart(7)}% | ${(topMisses || '—').slice(0, 60)} |`);
}

/* ── Markdown report ─────────────────────────────────────────────────── */
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const REPORTS = resolve(REPO, 'reports');
if (!existsSync(REPORTS)) mkdirSync(REPORTS, { recursive: true });
const md = [];
md.push('# UQ-TRAIN · Agent Calibration Report');
md.push('');
md.push(`Generated: ${new Date().toISOString()}`);
md.push(`Mode: ${APPLY ? 'APPLY (lane prompts updated)' : 'DRY-RUN (report only)'}`);
md.push(`Scope: ${CALIBRATE_ALL ? 'full corpus' : 'baseline 5'}`);
md.push(`Cache hits: ${cacheHits}/${fixtures.length}`);
md.push('');
md.push('## Per-lane accuracy');
md.push('');
md.push('| Lane | Name | Correct | Total | Accuracy |');
md.push('|------|------|--------:|------:|---------:|');
for (const [code, l] of Object.entries(lanes)) {
  const acc = l.totalCount > 0 ? (l.correctCount / l.totalCount * 100).toFixed(0) + '%' : '—';
  md.push(`| ${code} | ${l.name} | ${l.correctCount} | ${l.totalCount} | ${acc} |`);
}
md.push('');
for (const [code, l] of Object.entries(lanes)) {
  if (l.misses.length === 0) continue;
  md.push(`## ${code} (${l.name}) — ${l.misses.length} misses`);
  md.push('');
  md.push('| Slug | Field | Agent said | Expected |');
  md.push('|------|-------|------------|----------|');
  for (const m of l.misses.slice(0, 15)) {
    md.push(`| ${m.slug.slice(0, 28)} | ${m.field} | ${m.agent} | ${m.expected} |`);
  }
  if (l.misses.length > 15) md.push(`| … +${l.misses.length - 15} more | | | |`);
  md.push('');
}

md.push('## Calibration delta blocks');
md.push('');
md.push('The following `AGENT_CALIBRATION` blocks should be prepended to each lane prompt to give the agent surgical guidance:');
md.push('');
for (const [code, l] of Object.entries(lanes)) {
  if (l.misses.length === 0) continue;
  md.push(`### V${code.slice(1)}_${l.name.toUpperCase()}.md`);
  md.push('');
  md.push('```');
  md.push('=== AGENT_CALIBRATION (UQ-TRAIN, ' + new Date().toISOString().slice(0, 10) + ') ===');
  md.push(`Lane accuracy on baseline: ${(l.correctCount / Math.max(1, l.totalCount) * 100).toFixed(0)}% (${l.correctCount}/${l.totalCount}).`);
  md.push('Recurring miss patterns to watch for:');
  for (const m of l.misses.slice(0, 5)) {
    md.push(`  - "${m.field}" on ${m.slug.slice(0, 28)}: you said "${m.agent}", expected "${m.expected}"`);
  }
  md.push('When emitting your JSON, double-check these fields against the GDD prose.');
  md.push('===');
  md.push('```');
  md.push('');
}

const mdPath = resolve(REPORTS, `agent-calibration-${ts}.md`);
writeFileSync(mdPath, md.join('\n'));
console.log('');
console.log(`Report: ${mdPath}`);

/* ── Optional --apply: stamp AGENT_CALIBRATION block into each lane file. */
if (APPLY) {
  console.log('');
  console.log('--apply: stamping AGENT_CALIBRATION blocks…');
  const laneFiles = {
    V1: 'agents/parser-pool/V1_TOPOLOGY.md',
    V2: 'agents/parser-pool/V2_SYMBOLS.md',
    V3: 'agents/parser-pool/V3_FEATURE.md',
    V4: 'agents/parser-pool/V4_UX.md',
    V5: 'agents/parser-pool/V5_COMPLIANCE.md',
  };
  for (const [code, l] of Object.entries(lanes)) {
    if (l.misses.length === 0) continue;
    const path = resolve(REPO, laneFiles[code]);
    if (!existsSync(path)) {
      console.log(`  ⏭ ${laneFiles[code]} missing`);
      continue;
    }
    let src = readFileSync(path, 'utf8');
    /* Replace existing AGENT_CALIBRATION block if present, else append. */
    const calBlock = [
      '## AGENT_CALIBRATION (UQ-TRAIN ' + new Date().toISOString().slice(0, 10) + ')',
      '',
      `Lane accuracy on baseline: ${(l.correctCount / Math.max(1, l.totalCount) * 100).toFixed(0)}% (${l.correctCount}/${l.totalCount}).`,
      '',
      'Recurring miss patterns:',
      ...l.misses.slice(0, 5).map(m => `- "${m.field}" on ${m.slug.slice(0, 28)}: agent said "${m.agent}", expected "${m.expected}"`),
      '',
      'When emitting JSON, double-check these fields against GDD prose. Stamp `__self_corrected__: true` if revisiting after CORRECTIONS block.',
      ''
    ].join('\n');
    const marker = '## AGENT_CALIBRATION';
    if (src.includes(marker)) {
      src = src.replace(/## AGENT_CALIBRATION[\s\S]*?(?=^## |\Z)/m, calBlock);
    } else {
      src = src.replace(/\n+$/, '') + '\n\n' + calBlock;
    }
    writeFileSync(path, src);
    console.log(`  ✓ updated ${laneFiles[code]} (${l.misses.length} miss patterns)`);
  }
}

process.exit(0);
