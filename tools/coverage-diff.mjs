#!/usr/bin/env node
/**
 * tools/coverage-diff.mjs
 *
 * N6 (2026-06-23) — Git-style diff za per-game kernel coverage A vs B.
 *
 * Učitava reports/per-game-kernel-coverage/*.json iz dva git commit-a
 * (default: HEAD~1 vs HEAD) i izveštava: koje igre su dobile coverage,
 * koje su izgubile, per-kernel delta po igri. Regression tracking
 * deliverable.
 *
 * ## Why
 * Kernel coverage je glavni audit metric. Bez automatic diff alata
 * regression se primeti tek u manuelnom code review-u. Ovaj tool
 * pretvara "po commitu" view u "po kernelu po igri" diff.
 *
 * ## Design
 *   - git show <ref>:reports/per-game-kernel-coverage/<slug>.json
 *     bez checkout-a (radi u dirty working tree).
 *   - Per slug → set diff applicable + ok kernels.
 *   - Total delta: + added kernel coverage, − lost coverage.
 *
 * ## USAGE
 *   node tools/coverage-diff.mjs                       # HEAD~1 vs HEAD
 *   node tools/coverage-diff.mjs --from <ref> --to <ref>
 *   node tools/coverage-diff.mjs --json
 *
 * ## EXIT
 *   0 — diff generated (always; "no change" still exits 0)
 *   2 — invalid refs / git not available
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = join(REPO, 'reports/coverage-diff');

const BASELINE_SLUGS = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

/* ── Git helpers ──────────────────────────────────────────────────────── */

export function gitShow(ref, path) {
  const proc = spawnSync('git', ['show', `${ref}:${path}`],
    { encoding: 'utf8', cwd: REPO, timeout: 5000 });
  if (proc.status !== 0) return null;
  try { return JSON.parse(proc.stdout); } catch { return null; }
}

function loadCoverage(ref, slug) {
  return gitShow(ref, `reports/per-game-kernel-coverage/${slug}.json`);
}

/* ── Diff (pure) ──────────────────────────────────────────────────────── */

export function diffCoverage(covA, covB) {
  const okA = new Set((covA?.kernels || []).filter(k => k.ok).map(k => k.name));
  const okB = new Set((covB?.kernels || []).filter(k => k.ok).map(k => k.name));
  const appA = new Set((covA?.kernels || []).map(k => k.name));
  const appB = new Set((covB?.kernels || []).map(k => k.name));
  return {
    okGained:    [...okB].filter(k => !okA.has(k)).sort(),
    okLost:      [...okA].filter(k => !okB.has(k)).sort(),
    appGained:   [...appB].filter(k => !appA.has(k)).sort(),
    appLost:     [...appA].filter(k => !appB.has(k)).sort(),
    okCountA: okA.size, okCountB: okB.size,
    appCountA: appA.size, appCountB: appB.size,
  };
}

export function buildDiffReport(fromRef, toRef) {
  const perGame = {};
  let totalOkGained = 0, totalOkLost = 0;
  for (const slug of BASELINE_SLUGS) {
    const a = loadCoverage(fromRef, slug);
    const b = loadCoverage(toRef,   slug);
    if (!a && !b) {
      perGame[slug] = { status: 'absent-both' };
      continue;
    }
    if (!a) {
      perGame[slug] = { status: 'added-in-to', okGained: (b?.kernels || []).filter(k => k.ok).map(k => k.name) };
      totalOkGained += perGame[slug].okGained.length;
      continue;
    }
    if (!b) {
      perGame[slug] = { status: 'removed-in-to', okLost: (a?.kernels || []).filter(k => k.ok).map(k => k.name) };
      totalOkLost += perGame[slug].okLost.length;
      continue;
    }
    const d = diffCoverage(a, b);
    perGame[slug] = { status: 'compared', ...d };
    totalOkGained += d.okGained.length;
    totalOkLost   += d.okLost.length;
  }
  return {
    generatedAt: new Date().toISOString(),
    tool: 'tools/coverage-diff.mjs',
    fromRef, toRef,
    summary: {
      totalOkGained, totalOkLost,
      net: totalOkGained - totalOkLost,
      gamesCompared: Object.values(perGame).filter(g => g.status === 'compared').length,
    },
    perGame,
  };
}

/* ── ASCII renderer (box-drawing per HARD RULE #3) ────────────────────── */

function pad(s, w) {
  const str = String(s ?? '');
  if (str.length >= w) return str.slice(0, w);
  return str + ' '.repeat(w - str.length);
}

export function renderDiffReport(report) {
  const out = [];
  out.push(`coverage-diff · ${report.fromRef}  →  ${report.toRef}`);
  out.push(`generated: ${report.generatedAt}`);
  out.push('');
  out.push(`Summary: +${report.summary.totalOkGained} kernels gained · -${report.summary.totalOkLost} lost · net ${report.summary.net >= 0 ? '+' : ''}${report.summary.net} · ${report.summary.gamesCompared} games compared`);
  out.push('');
  out.push('┌──────────────────────────────┬──────────┬──────────┬──────────┐');
  out.push('│ Slug                         │ Status   │ + ok     │ − ok     │');
  out.push('├──────────────────────────────┼──────────┼──────────┼──────────┤');
  for (const [slug, g] of Object.entries(report.perGame)) {
    const gained = g.okGained?.length ?? 0;
    const lost   = g.okLost?.length   ?? 0;
    out.push('│ ' + pad(slug, 28) + ' │ ' + pad(g.status, 8) + ' │ ' +
      pad(gained, 8) + ' │ ' + pad(lost, 8) + ' │');
  }
  out.push('└──────────────────────────────┴──────────┴──────────┴──────────┘');
  out.push('');
  for (const [slug, g] of Object.entries(report.perGame)) {
    if (g.status !== 'compared') continue;
    if (g.okGained?.length || g.okLost?.length) {
      out.push(`▌ ${slug}`);
      if (g.okGained?.length) out.push(`  + ${g.okGained.join(', ')}`);
      if (g.okLost?.length)   out.push(`  - ${g.okLost.join(', ')}`);
      out.push('');
    }
  }
  return out.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('coverage-diff.mjs')) {
  const args = process.argv.slice(2);
  const argVal = (flag) => {
    const i = args.findIndex(a => a === flag || a.startsWith(flag + '='));
    if (i === -1) return null;
    return args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
  };
  const fromRef = argVal('--from') || 'HEAD~1';
  const toRef   = argVal('--to')   || 'HEAD';
  const jsonOnly = args.includes('--json');

  /* Verify git available + refs valid. */
  const gitCheck = spawnSync('git', ['rev-parse', fromRef], { cwd: REPO, encoding: 'utf8' });
  if (gitCheck.status !== 0) {
    console.error(`▸ invalid git ref: ${fromRef}`);
    process.exit(2);
  }

  const report = buildDiffReport(fromRef, toRef);
  mkdirSync(OUT_DIR, { recursive: true });
  const stem = `${fromRef.replace(/[^a-z0-9]/gi, '_')}__${toRef.replace(/[^a-z0-9]/gi, '_')}`;
  writeFileSync(join(OUT_DIR, `${stem}.json`), JSON.stringify(report, null, 2));

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderDiffReport(report));
    console.log(`✓ diff  →  ${join(OUT_DIR, `${stem}.json`)}`);
  }
  process.exit(0);
}

export default { gitShow, diffCoverage, buildDiffReport, renderDiffReport };
