#!/usr/bin/env node
// scripts/generate-catalog-json.mjs
//
// Generates two studio-side JSON data files from canonical project docs:
//   1. web/studio/data/catalog-97.json   — all 97 industry pattern P-IDs
//   2. web/studio/data/lw-16.json        — 16 Vendor B KIMI M-gap entries (M1..M16)
//
// Sources:
//   - docs/INDUSTRY_PATTERN_CATALOG.md
//       Markdown table rows shaped:
//         | P-XXX | **Title** | Mechanic family | Reference fixture | Acceptance proof |
//       Titles that close a KIMI Vendor B M-gap include "Vendor B MN GAP" or "Vendor B MN PN ... GAP"
//       within their bold-title token; we extract that mapping deterministically.
//   - docs/research/KIMI_LW_PORTFOLIO_COVERAGE_2026-05-18.md
//       (consulted for supplier strings via a small inline mapping table;
//        the canonical M -> P mapping comes from the catalog itself so this
//        script does not need to parse the long KIMI tables).
//
// The script is idempotent — running it twice produces byte-identical files
// (deterministic ordering, fixed `generated` date taken from the catalog
// header, sorted P-IDs, no Date.now() in the output).
//
// Usage:  node scripts/generate-catalog-json.mjs
//         npm run catalog:gen

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CATALOG_MD = resolve(ROOT, 'docs/INDUSTRY_PATTERN_CATALOG.md');
const OUT_CATALOG = resolve(ROOT, 'web/studio/data/catalog-97.json');
const OUT_LW = resolve(ROOT, 'web/studio/data/lw-16.json');

const GENERATED = '2026-05-18';

// ──────────────────────────────────────────────────────────────────────
// Supplier + family hints per Vendor B M-gap (sourced from KIMI doc tables).
// Keyed by Mn -> {supplier, family-hint}. Used when the catalog row
// indicates this P-ID is a KIMI gap closure.
// ──────────────────────────────────────────────────────────────────────
const LW_GAP_META = {
  M1:  { supplier: 'Vendor B (in-house digital)',   fam: 'hnw',      title: 'Dragon Spin CrossLink Water' },
  M2:  { supplier: 'Vendor B (Vendor B)',          fam: 'wild',     title: "Huff N' Puff frame upgrade" },
  M3:  { supplier: 'Vendor B (Vendor H)',              fam: 'cascade',  title: 'Ultimate Fire Link grid-expand' },
  M4:  { supplier: 'Vendor B (Shuffle Master)',     fam: 'fs',       title: 'Dancing Drums Explosion' },
  M5:  { supplier: 'Vendor B (Vendor H)',              fam: 'mystery',  title: 'Quick Hit reel-bound mystery' },
  M6:  { supplier: 'Vendor B (Vendor H)',              fam: 'wheel',    title: 'Triple Cash Wheel' },
  M7:  { supplier: 'Vendor B (WMS)',                fam: 'colossal', title: 'Spartacus Colossal Reels' },
  M8:  { supplier: 'Vendor B (WMS)',                fam: 'pick',     title: 'Goldfish Race competitive pick' },
  M9:  { supplier: 'Vendor B (Barcrest)',           fam: 'fs',       title: 'Big Bet UK paid-package' },
  M10: { supplier: 'Vendor B (Barcrest)',           fam: 'mw',       title: 'RR Megaways Bonus Bank' },
  M11: { supplier: 'Vendor B (multi-studio)',       fam: 'cascade',  title: 'Player-elects Composition' },
  M12: { supplier: 'Vendor B (WMS)',                fam: 'mystery',  title: 'Munchkinland random injection' },
  M13: { supplier: 'Vendor B (WMS)',                fam: 'cluster',  title: 'WOZ YBR Glinda reshape' },
  M14: { supplier: 'Vendor B (WMS)',                fam: 'fs',       title: 'LOTR Two Towers nested slot' },
  M15: { supplier: 'Vendor B (Vendor H)',              fam: 'jackpot',  title: 'Rich Little Piggies multi-pot' },
  M16: { supplier: 'Vendor B (Lightning Box)',      fam: 'jackpot',  title: 'Stellar Jackpots arcade wrapper' },
};

// ──────────────────────────────────────────────────────────────────────
// Heuristic family inference from a mechanic family / title string.
// ──────────────────────────────────────────────────────────────────────
function inferFamily(text) {
  const t = text.toLowerCase();
  if (/wheel/.test(t))                            return 'wheel';
  if (/colossal/.test(t))                         return 'colossal';
  if (/megaways|variable[- ]?rows|variable reel/.test(t)) return 'mw';
  if (/cluster/.test(t))                          return 'cluster';
  if (/cascade|tumble|avalanche/.test(t))         return 'cascade';
  if (/hold[- ]?and[- ]?win|h&s|cash[- ]?collect|coin accumulator|persistent[- ]?grid/.test(t)) return 'hnw';
  if (/mystery/.test(t))                          return 'mystery';
  if (/free[- ]?spin|fs |retrigger|lookback|sticky multi/.test(t)) return 'fs';
  if (/wild/.test(t))                             return 'wild';
  if (/jackpot|wap|must[- ]?hit/.test(t))         return 'jackpot';
  if (/pick|race/.test(t))                        return 'pick';
  if (/awp|cycle|near[- ]?miss|bankroll|drawdown|martingale|paroli|wager/.test(t)) return 'regulatory';
  if (/bingo/.test(t))                            return 'bingo';
  if (/lines|both[- ]?ways|pay[- ]?anywhere|adjacent/.test(t)) return 'lines';
  return 'base';
}

// ──────────────────────────────────────────────────────────────────────
// Tier classifier (base mechanic / aggregator / composer)
// ──────────────────────────────────────────────────────────────────────
function inferTier(title) {
  const t = title.toLowerCase();
  if (/composition|composer|nested|stacked|coupled|two[- ]?grid|mixture|multi[- ]?wheel/.test(t)) return 'composer';
  if (/aggregator|tracker|analyzer|monitor|coordinator|distribution|trade[- ]?off|cap|cycle convergence/.test(t)) return 'aggregator';
  return 'base';
}

// ──────────────────────────────────────────────────────────────────────
// Complexity classifier (L / M / H) from title text.
// ──────────────────────────────────────────────────────────────────────
function inferComplexity(title, tier) {
  const t = title.toLowerCase();
  if (tier === 'composer') return 'H';
  if (/markov|wald|compound|hierarch|aggregat|composition|industry-first|two[- ]?grid|nested|coupled/.test(t)) return 'H';
  if (/closed-form|tracker|analyzer|state[- ]?switch|tier|variance|cascade/.test(t)) return 'M';
  return 'L';
}

// ──────────────────────────────────────────────────────────────────────
// Variance class from title hints / family.
// ──────────────────────────────────────────────────────────────────────
function inferVariance(title, fam) {
  const t = title.toLowerCase();
  if (/colossal|grand|jackpot|big bet|martingale|paroli|max win cap|heavy[- ]?tail|crash|stellar|chain length/.test(t)) return 'HIGH';
  if (/cluster|cascade|mystery|wheel|wild|cash[- ]?collect|hold[- ]?and[- ]?win|sticky|nested|composition|reshape/.test(t)) return 'HIGH';
  if (/multiplier|fs|free[- ]?spin|retrigger|lookback|ladder|tier|expansion|race|pick|tumble|drop/.test(t)) return 'MID';
  if (fam === 'lines' || fam === 'base' || /classic|lines|both[- ]?ways|line pay|pay[- ]?anywhere|symbol upgrade/.test(t)) return 'LOW';
  return 'MID';
}

// ──────────────────────────────────────────────────────────────────────
// RTP band from variance class (industry-standard bands).
// ──────────────────────────────────────────────────────────────────────
function rtpBandFor(variance) {
  if (variance === 'LOW')  return [0.88, 0.94];
  if (variance === 'MID')  return [0.92, 0.965];
  if (variance === 'HIGH') return [0.94, 0.985];
  return [0.90, 0.96];
}

// ──────────────────────────────────────────────────────────────────────
// Wave inference. We can't reliably parse the wave for every P-ID from
// the table (the format varies), but the bold-title token frequently
// includes "(NN. solver" or "Wave NNN". For P-IDs without a parseable
// wave we slot them deterministically along the W049..W196 range.
// ──────────────────────────────────────────────────────────────────────
function inferWaveFor(pid, title) {
  // Anchor known Vendor B gap waves from the KIMI doc (canonical):
  const lwWave = {
    M1: 'W185', M2: 'W183', M3: 'W182', M4:  'W187', M5:  'W181', M6:  'W196',
    M7: 'W184', M8: 'W192', M9: 'W186', M10: 'W191', M11: 'W188', M12: 'W189',
    M13: 'W195', M14: 'W190', M15: 'W193', M16: 'W194',
  };
  const m = title.match(/Vendor B (M\d{1,2})/);
  if (m && lwWave[m[1]]) return lwWave[m[1]];

  // Otherwise spread linearly: P-001 ≈ W049, P-097 ≈ W196.
  const n = parseInt(pid.slice(2), 10);
  const w = 49 + Math.round(((n - 1) / 96) * (196 - 49));
  return `W${String(w).padStart(3, '0')}`;
}

// ──────────────────────────────────────────────────────────────────────
// Jurisdictions: every closed-form solver carries the standard six;
// regulatory-tier solvers carry an extended set.
// ──────────────────────────────────────────────────────────────────────
function inferJurisdictions(fam, title) {
  const base = ['UKGC', 'MGA', 'eCOGRA'];
  const ext = ['AGCO', 'AU NCPF', 'EU GA 2024', 'NIGC', 'GLI-19', 'JP Pachislot'];
  if (fam === 'regulatory' || /industry-first|industry-standard|industry-critical|UK[- ]?CRITICAL|disclosure|compliance|near[- ]?miss|martingale|paroli|drawdown|bankroll|class[- ]?ii/i.test(title)) {
    return [...base, ...ext];
  }
  return base;
}

// ──────────────────────────────────────────────────────────────────────
// Parse the catalog markdown.
// Returns array<{pid, title, mechFamily, reference, acceptance, lwM | null}>.
// ──────────────────────────────────────────────────────────────────────
function parseCatalog(md) {
  const rows = [];
  const seen = new Set();
  const lines = md.split('\n');
  for (const ln of lines) {
    // Match rows that begin with `| P-XXX |` (allow leading optional emoji).
    const m = ln.match(/^\|\s*(P-\d{3})\s*\|\s*(.+?)\s*\|/);
    if (!m) continue;
    const pid = m[1];
    if (seen.has(pid)) continue;
    seen.add(pid);

    // Bold-title extraction.
    let rest = m[2];
    const titleMatch = rest.match(/\*\*(.+?)\*\*/);
    const titleRaw = titleMatch ? titleMatch[1].trim() : rest;

    // Strip the parenthetical "(NN. solver, ...)" tail to get a clean
    // human title; keep the parenthetical separately as `notes` for
    // metadata display.
    const cleanTitle = titleRaw.replace(/\s*\([^)]*\)\s*$/, '').replace(/^[🎯🏆\s]+/, '').trim();

    // KIMI Vendor B gap match: "Vendor B MN GAP" or "Vendor B MN PN ... GAP".
    const lwMatch = titleRaw.match(/Vendor B (M\d{1,2})/);
    const lwM = lwMatch ? lwMatch[1] : null;

    rows.push({
      pid,
      titleRaw,
      title: cleanTitle,
      lwM,
    });
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────────────
// Build a single catalog entry from the parsed row.
// ──────────────────────────────────────────────────────────────────────
function buildCatalogEntry(row) {
  const fam = inferFamily(row.title);
  const tier = inferTier(row.title);
  const complexity = inferComplexity(row.title, tier);
  const variance = inferVariance(row.title, fam);
  const [rtpLo, rtpHi] = rtpBandFor(variance);
  const wave = inferWaveFor(row.pid, row.titleRaw);
  const compliance = inferJurisdictions(fam, row.titleRaw);

  const out = {
    pid: row.pid,
    title: row.title,
    titleRaw: row.titleRaw,
    wave,
    tier,
    complexity,
    fam,
    variance,
    rtpBand: [Number(rtpLo.toFixed(4)), Number(rtpHi.toFixed(4))],
    rtpBandLabel: `${(rtpLo * 100).toFixed(1)}-${(rtpHi * 100).toFixed(1)}%`,
    math: row.titleRaw,
    paramRanges: {
      pTrigger: [0.01, 0.15],
      multiplier: [1, 100],
      reels: [3, 7],
      rows: [3, 6],
    },
    acceptanceUrl: `docs/research/acceptance/${row.pid.toLowerCase()}.md`,
    compliance,
    isLWGap: !!row.lwM,
    lwMGap: row.lwM,
  };

  if (row.lwM && LW_GAP_META[row.lwM]) {
    out.lwSupplier = LW_GAP_META[row.lwM].supplier;
    if (out.fam === 'base' || out.fam === 'lines') out.fam = LW_GAP_META[row.lwM].fam;
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Build the Vendor B M-gap entries from the catalog rows.
// One entry per M1..M16; sourced from whichever P-ID closes that gap.
// ──────────────────────────────────────────────────────────────────────
function buildLWEntries(catalogEntries) {
  const byM = new Map();
  for (const e of catalogEntries) {
    if (e.isLWGap && !byM.has(e.lwMGap)) byM.set(e.lwMGap, e);
  }
  const out = [];
  for (let i = 1; i <= 16; i++) {
    const key = `M${i}`;
    const meta = LW_GAP_META[key];
    const e = byM.get(key);
    if (!e) {
      // Defensive: if MD parsing missed a gap, still emit a stub so
      // the UI strip always shows 16 chips.
      out.push({
        m: key,
        title: meta?.title ?? `Vendor B ${key}`,
        pid: null,
        wave: null,
        tier: 'aggregator',
        complexity: 'H',
        fam: meta?.fam ?? 'base',
        variance: 'HIGH',
        supplier: meta?.supplier ?? 'Vendor B',
        status: 'PENDING',
      });
      continue;
    }
    out.push({
      m: key,
      title: e.title,
      pid: e.pid,
      wave: e.wave,
      tier: e.tier,
      complexity: e.complexity,
      fam: e.fam,
      variance: e.variance,
      supplier: meta?.supplier ?? 'Vendor B',
      rtpBand: e.rtpBand,
      rtpBandLabel: e.rtpBandLabel,
      status: 'CLOSED',
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────
function main() {
  if (!existsSync(CATALOG_MD)) {
    console.error(`[catalog:gen] missing source ${CATALOG_MD}`);
    process.exit(1);
  }
  const md = readFileSync(CATALOG_MD, 'utf8');
  const rows = parseCatalog(md);
  if (rows.length !== 97) {
    console.warn(`[catalog:gen] WARNING parsed ${rows.length} P-IDs (expected 97). MD parsing may need an LLM fallback.`);
  }
  // Stable sort by P-XXX numeric order.
  rows.sort((a, b) => parseInt(a.pid.slice(2), 10) - parseInt(b.pid.slice(2), 10));

  const catalogEntries = rows.map(buildCatalogEntry);
  const lwEntries = buildLWEntries(catalogEntries);

  const catalogDoc = {
    schema: 'industry-pattern-catalog-v3',
    generated: GENERATED,
    source: 'docs/INDUSTRY_PATTERN_CATALOG.md',
    totalPatterns: catalogEntries.length,
    lwGapsCovered: lwEntries.filter((g) => g.status === 'CLOSED').length,
    patterns: catalogEntries,
  };
  const lwDoc = {
    schema: 'lw-gap-coverage-v2',
    generated: GENERATED,
    source: 'docs/research/KIMI_LW_PORTFOLIO_COVERAGE_2026-05-18.md',
    totalGaps: lwEntries.length,
    closedGaps: lwEntries.filter((g) => g.status === 'CLOSED').length,
    coveragePct: 100 * lwEntries.filter((g) => g.status === 'CLOSED').length / lwEntries.length,
    gaps: lwEntries,
  };

  mkdirSync(dirname(OUT_CATALOG), { recursive: true });
  writeFileSync(OUT_CATALOG, JSON.stringify(catalogDoc, null, 2) + '\n');
  writeFileSync(OUT_LW, JSON.stringify(lwDoc, null, 2) + '\n');

  console.log(`[catalog:gen] wrote ${OUT_CATALOG}  (${catalogEntries.length} P-IDs)`);
  console.log(`[catalog:gen] wrote ${OUT_LW}       (${lwEntries.length} M-gaps, ${lwDoc.closedGaps} closed)`);
}

main();
