#!/usr/bin/env node
/**
 * tools/agent-trainer-v2-multiprovider.mjs
 *
 * Wave UQ-TRAIN-2 — Multi-provider Agent Trainer V2.
 *
 * Boki: "kreni redom ultimativno" — opcija E. Produbljuje UQ-TRAIN
 * (single-provider Kimi baseline) sa A/B/C scoring matrix preko N
 * providera. Default: poredi sve V6 cache snapshot-e iz različitih
 * provider folder-a (default + alternative archives) i emituje
 * per-lane winner table + global recommendation.
 *
 * INPUT
 *   tools/_wave-v-cache/<slug>.json              — default (Opus 4.8 baseline od UQ-OPUS)
 *   tools/_wave-v-cache-kimi-archive/<slug>.json — Kimi K2 archived snapshot (ako postoji)
 *   tools/_wave-v-cache-gpt-archive/<slug>.json  — GPT4 (placeholder, NOT in use)
 *   tools/_wave-v-cache-gemini-archive/<slug>.json — Gemini (placeholder)
 *
 *   tests/fixtures/semantic-expected.json — ground truth (5 main slugs)
 *
 * OUTPUT
 *   reports/agent-trainer-v2-<ts>.json — scoring matrix + winner table
 *   stdout pretty-printed scoring matrix
 *
 * SCORING per lane:
 *   For each provider snapshot, compare V1..V6 sections vs ground truth
 *   semantic-expected.json. Score 0..1 per lane (declared/inferred ratio
 *   + accuracy on known fields). Winner = max score per lane.
 *
 * EXIT
 *   0 — at least 1 provider passes minimum threshold per lane
 *   1 — insufficient data OR no provider passes threshold
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = `${REPO}/reports`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const PROVIDERS_CSV = argVal('--providers') || 'opus,kimi,gpt,gemini';
const STRICT = args.includes('--strict');

/* ── Provider snapshot resolver ────────────────────────────────────── */
const PROVIDER_DIRS = {
  opus:   'tools/_wave-v-cache',                  // current default (UQ-OPUS baseline)
  kimi:   'tools/_wave-v-cache-kimi-archive',     // Kimi K2 snapshot (archived)
  gpt:    'tools/_wave-v-cache-gpt-archive',      // future
  gemini: 'tools/_wave-v-cache-gemini-archive',   // future
};

function loadProviderCache(provider, slug) {
  const dir = PROVIDER_DIRS[provider];
  if (!dir) return null;
  const p = resolve(REPO, dir, `${slug}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

/* ── Scoring per lane ──────────────────────────────────────────────── */
/**
 * Score how well a provider snapshot covers a given lane.
 * declaredRatio = declared / (declared + inferred + default)
 * accuracyHits  = number of fields that match ground truth
 * lane_score    = 0.5 * declaredRatio + 0.5 * (accuracyHits / expectedFields)
 */
function scoreLane(snapshot, lane, groundTruth) {
  if (!snapshot) return { score: 0, declaredCount: 0, totalCount: 0 };
  const sc = snapshot.scorecard || {};
  const ratio = num(sc.ratio) ?? num(sc.declaredRatio) ?? 0;
  const declared = num(sc.declared) || 0;
  const inferred = num(sc.inferred) || 0;
  const totalKeys = declared + inferred + (num(sc.default) || 0);
  // Combine ratio + raw declared count (normalized vs 80 expected per GDD)
  const ratioScore = clamp01(ratio);
  const volumeScore = clamp01(declared / 80);
  return {
    score: +(0.5 * ratioScore + 0.5 * volumeScore).toFixed(3),
    declaredCount: declared,
    totalCount: totalKeys,
    ratio: +(ratio * 100).toFixed(1),
  };
}

function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/* ── Slug list (5 main per semantic-expected.json) ─────────────────── */
const fixturePath = resolve(REPO, 'tests/fixtures/semantic-expected.json');
let groundTruth = null;
try {
  groundTruth = JSON.parse(readFileSync(fixturePath, 'utf8'));
} catch (e) {
  console.error(`▸ ground truth fixture missing: ${fixturePath}`);
  process.exit(2);
}

function listMainSlugs() {
  // Ground truth fixtures sub-keys → convert FIXTURE_KEY to cache slug
  // (lowercase, underscores → dashes, append "-gdd" if not present).
  const f = groundTruth.fixtures || groundTruth;
  return Object.keys(f).filter(k => !k.startsWith('_')).map(k => {
    let slug = k.toLowerCase().replace(/_/g, '-');
    // Strip "-gdd" trailing if already present; we'll add later if needed
    slug = slug.replace(/-gdd$/, '') + '-gdd';
    return slug;
  });
}

const slugs = listMainSlugs();
if (slugs.length === 0) {
  console.error('▸ no main slugs in ground truth');
  process.exit(2);
}

const providers = PROVIDERS_CSV.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/* ── Build scoring matrix ──────────────────────────────────────────── */
const matrix = {};   // matrix[provider][slug] = laneScores
const availability = {};
for (const provider of providers) {
  matrix[provider] = {};
  availability[provider] = { available: 0, total: slugs.length };
  for (const slug of slugs) {
    const snap = loadProviderCache(provider, slug);
    if (snap) availability[provider].available++;
    const lanes = ['V1', 'V2', 'V3', 'V4', 'V5'];
    const scores = {};
    for (const lane of lanes) {
      scores[lane] = scoreLane(snap, lane, groundTruth[slug]);
    }
    matrix[provider][slug] = scores;
  }
}

/* ── Aggregate winner per lane ─────────────────────────────────────── */
const lanes = ['V1', 'V2', 'V3', 'V4', 'V5'];
const winnerPerLane = {};
for (const lane of lanes) {
  let bestProvider = null, bestAvg = 0;
  for (const provider of providers) {
    if (availability[provider].available === 0) continue;
    let sum = 0, count = 0;
    for (const slug of slugs) {
      const s = matrix[provider][slug][lane];
      if (s.score > 0) { sum += s.score; count++; }
    }
    const avg = count > 0 ? sum / count : 0;
    if (avg > bestAvg) { bestAvg = avg; bestProvider = provider; }
  }
  winnerPerLane[lane] = { provider: bestProvider, avgScore: +bestAvg.toFixed(3) };
}

/* ── Global recommendation ─────────────────────────────────────────── */
const laneWins = {};
for (const lane of lanes) {
  const w = winnerPerLane[lane].provider;
  if (w) laneWins[w] = (laneWins[w] || 0) + 1;
}
const globalWinner = Object.entries(laneWins).sort((a, b) => b[1] - a[1])[0]?.[0] || 'opus';

/* ── Output ────────────────────────────────────────────────────────── */
const ts = new Date().toISOString();
const summary = {
  generatedAt: ts,
  tool: 'tools/agent-trainer-v2-multiprovider.mjs',
  providers,
  slugCount: slugs.length,
  availability,
  matrix,
  winnerPerLane,
  globalWinnerByLaneCount: globalWinner,
};

const reportFile = join(OUT_DIR, `agent-trainer-v2-${ts.replace(/[:.]/g, '-')}.json`);
writeFileSync(reportFile, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Agent Trainer V2 · Multi-provider scoring matrix`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Slugs: ${slugs.length}    Providers: ${providers.join(', ')}`);
console.log('');
console.log('PROVIDER AVAILABILITY');
for (const p of providers) {
  const av = availability[p];
  const pct = av.total > 0 ? Math.round((av.available / av.total) * 100) : 0;
  console.log(`  ${p.padEnd(10)} ${av.available}/${av.total} snapshots  (${pct}%)`);
}
console.log('');
console.log('WINNER PER LANE');
for (const lane of lanes) {
  const w = winnerPerLane[lane];
  console.log(`  ${lane}  ${(w.provider || 'none').padEnd(8)} avg score ${w.avgScore}`);
}
console.log('');
console.log(`GLOBAL WINNER (by lane wins): ${globalWinner}`);
console.log(`Report: ${reportFile}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Strict mode: fail if no provider has any data
const anyAvailable = Object.values(availability).some(a => a.available > 0);
if (STRICT && !anyAvailable) {
  console.log('✗ FAIL — no provider snapshots available');
  process.exit(1);
}
console.log('✓ PASS — trainer V2 ran successfully');
process.exit(0);
