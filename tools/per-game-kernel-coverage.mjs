#!/usr/bin/env node
/**
 * tools/per-game-kernel-coverage.mjs
 *
 * For each baseline GDD, identify ALL sister-repo kernels that apply
 * (topology + feature match) and call each one. Emit a per-game
 * "kernel coverage" report with analytical RTP per applicable kernel.
 *
 * Why
 *   Operators want to see "for game X, here are ALL the math kernels
 *   that touch its mechanics + their analytical RTP contributions".
 *   This lets them audit whether the JS probe heuristic agrees with
 *   the closed-form analytical answers — apples-to-apples.
 *
 * USAGE
 *   node tools/per-game-kernel-coverage.mjs                  # 5 baselines
 *   node tools/per-game-kernel-coverage.mjs --slug X         # single game
 *   node tools/per-game-kernel-coverage.mjs --slugs A,B,C    # custom set
 *
 * OUTPUT
 *   reports/per-game-kernel-coverage/<slug>.json (per game)
 *   reports/per-game-kernel-coverage/_summary-<ts>.json (aggregate)
 *
 * EXIT
 *   0 — all games walked successfully
 *   1 — at least one game failed
 *   2 — missing dist/real-games or invalid arg
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KERNEL_REGISTRY, listKernels } from '../src/blocks/featureSimPlugins/kernelRegistry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = join(REPO, 'dist/real-games');
const OUT_DIR    = join(REPO, 'reports/per-game-kernel-coverage');

const BASELINE_SLUGS = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  return args[idx].includes('=') ? args[idx].split('=')[1] : args[idx + 1];
};

/* ── Topology-aware kernel selection ─────────────────────────────────── */

function topologyHints(model) {
  const t = model?.topology || {};
  const hints = new Set();
  if (t.is_plinko) hints.add('plinko');
  if (t.is_slingo) hints.add('slingo');
  if (t.is_hex) hints.add('hex');
  if (t.is_wheel) hints.add('wheel');
  if (t.is_crash) hints.add('crash');
  /* Combine kind + evaluation — many games declare kind="rectangular"
   * but evaluation="pay_anywhere" (Gates of Olympus); both must seed hints. */
  const kindRaw = (t.kind || '').toString().toLowerCase();
  const evalRaw = (t.evaluation || '').toString().toLowerCase();
  const combined = `${kindRaw} ${evalRaw}`;
  if (combined.includes('cluster'))     hints.add('cluster');
  if (combined.includes('cascade'))     hints.add('cascade');
  if (combined.includes('tumble'))      hints.add('tumble');
  if (combined.includes('lock'))        { hints.add('lock_respin'); hints.add('hold_and_win'); }
  if (combined.includes('ways'))        hints.add('ways');
  if (combined.includes('pay_anywhere')) hints.add('pay_anywhere');
  if (combined.includes('lines') || hints.size === 0) hints.add('lines');
  /* Cascade feature → cascade hint even if topology silent. */
  const features = Array.isArray(model?.features) ? model.features : [];
  if (features.some(f => /cascade|tumble/i.test(f?.kind || f?.label || ''))) {
    hints.add('cascade'); hints.add('tumble');
  }
  /* Feature-based hints. */
  if (model?.holdAndWin?.enabled || Number.isFinite(model?.holdAndWin?.triggerCount)) {
    hints.add('hold_and_win');
  }
  return hints;
}

/* Determine which kernels apply to a game. */
function applicableKernels(model) {
  const hints = topologyHints(model);
  return listKernels().filter(k => {
    if (k.topology.includes('any')) return true;
    return k.topology.some(t => hints.has(t));
  });
}

/* ── Call each applicable kernel and collect analytical RTPs ─────────── */

async function _safeCallKernel(kernelMeta, model) {
  try {
    const bridgePath = `../src/blocks/featureSimPlugins/${kernelMeta.bridgeModule}`;
    const mod = await import(bridgePath);
    const fn = mod[kernelMeta.bridgeFunction];
    if (typeof fn !== 'function') {
      return { ok: false, reason: `bridge fn ${kernelMeta.bridgeFunction} not exported` };
    }
    /* Solver kernels (inverse_solver, multi_dim_inverse_solver) need
     * config not bare model — skip in coverage walk. They're called
     * via operator-driven solve, not auto-discovery. */
    if (kernelMeta.category === 'inverse-solver') {
      return { ok: false, reason: 'inverse-solver — operator-driven, skipped in coverage walk' };
    }
    /* Bridge call shape varies by module. */
    let result;
    if (kernelMeta.bridgeModule === 'holdAndWinKernelBridge.mjs' ||
        kernelMeta.bridgeModule === 'clusterEvalKernelBridge.mjs') {
      result = await fn(model);
    } else {
      /* extraKernelBridges bridges accept (opts) — pass model when bridge
       * signature accepts it, else empty opts. Some bridges need a model
       * argument (pay_anywhere, stacked_wilds), most need opts only. */
      result = kernelMeta.name === 'pay_anywhere' || kernelMeta.name === 'stacked_wilds'
        ? await fn(model)
        : await fn({});
    }
    return result;
  } catch (e) {
    return { ok: false, reason: `bridge call threw: ${e.message}` };
  }
}

async function walkGame(slug) {
  const modelPath = join(REAL_GAMES, slug, 'model.json');
  if (!existsSync(modelPath)) {
    return { slug, ok: false, error: `model.json missing` };
  }
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const applicable = applicableKernels(model);
  const kernels = [];
  let totalAnalyticalXBet = 0;
  for (const meta of applicable) {
    const result = await _safeCallKernel(meta, model);
    const entry = {
      name: meta.name,
      category: meta.category,
      feature: meta.feature,
      ok: !!result.ok,
    };
    if (result.ok) {
      entry.rtpContribution = result.rtpContribution ?? result.rtp ?? null;
      if (Number.isFinite(entry.rtpContribution)) {
        totalAnalyticalXBet += entry.rtpContribution;
      }
      if (result.moneyComponent) entry.moneyComponent = result.moneyComponent;
      if (result.jackpotComponent) entry.jackpotComponent = result.jackpotComponent;
    } else {
      entry.reason = result.reason;
    }
    kernels.push(entry);
  }
  const okCount = kernels.filter(k => k.ok).length;
  return {
    slug,
    ok: true,
    topology: model.topology?.kind || model.topology?.evaluation || 'unknown',
    declaredRTP: model.payback?.rtp ?? null,
    kernelsApplicable: applicable.length,
    kernelsOk: okCount,
    totalAnalyticalSumXBet: +totalAnalyticalXBet.toFixed(4),
    kernels,
  };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('per-game-kernel-coverage.mjs')) {
  const slugArg = argVal('--slug');
  const slugsArg = argVal('--slugs');
  let slugs;
  if (slugArg) slugs = [slugArg];
  else if (slugsArg) slugs = slugsArg.split(',').map(s => s.trim());
  else slugs = BASELINE_SLUGS;

  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing — run parse-real-pdfs.mjs first`);
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Per-game kernel coverage · ${slugs.length} games\n`);
  const reports = [];
  let exit = 0;
  for (const slug of slugs) {
    const r = await walkGame(slug);
    reports.push(r);
    if (!r.ok) {
      console.log(`✗ ${slug}: ${r.error}`);
      exit = 1;
      continue;
    }
    console.log(`✓ ${slug}  (${r.topology}, declared ${r.declaredRTP ?? '—'}%, ` +
                `${r.kernelsOk}/${r.kernelsApplicable} kernels OK, ` +
                `Σ analytical ${r.totalAnalyticalSumXBet}× bet)`);
    /* Per-game report. */
    writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify(r, null, 2));
  }
  /* Summary aggregate. */
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const summary = {
    generatedAt: new Date().toISOString(),
    tool: 'tools/per-game-kernel-coverage.mjs',
    gamesProbed: reports.length,
    gamesOk: reports.filter(r => r.ok).length,
    avgKernelsApplicable: reports.length > 0
      ? +(reports.filter(r => r.ok).reduce((s, r) => s + r.kernelsApplicable, 0) / reports.filter(r => r.ok).length).toFixed(2)
      : 0,
    perGame: reports.map(r => ({
      slug: r.slug, ok: r.ok, topology: r.topology,
      kernelsApplicable: r.kernelsApplicable, kernelsOk: r.kernelsOk,
      totalAnalyticalSumXBet: r.totalAnalyticalSumXBet,
    })),
  };
  const summaryPath = join(OUT_DIR, `_summary-${ts}.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nSummary: ${summary.gamesOk}/${summary.gamesProbed} ok · avg ${summary.avgKernelsApplicable} applicable kernels/game`);
  console.log(`Reports: ${OUT_DIR}/`);
  process.exit(exit);
}

export { walkGame, applicableKernels, topologyHints };
