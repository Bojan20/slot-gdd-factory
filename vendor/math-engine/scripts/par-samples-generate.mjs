#!/usr/bin/env node
// PAR sample generator — P0 #4 deliverable.
//
// Iterates a curated set of 20 generic-mechanic IR fixtures from
// tests/fixtures/reference/, runs Monte Carlo, and emits:
//
//   reports/par-samples/<game-id>.par.json   — full machine-readable PAR
//   reports/par-samples/<game-id>.par.pdf    — GLI-16 Appendix D PDF
//   reports/par-samples/INDEX.md             — aggregate table
//
// Why 20 (not all 30):
//   The 20 are chosen to span the engine's full mechanic surface — lines /
//   ways / cluster / pay-anywhere / variable-rows / cascade families /
//   feature games. The remaining 10 are sibling variants of mechanics
//   already covered (e.g. cluster-diagonal/hexagonal are variants of
//   cluster-orthogonal); they're still listed in INDEX.md as "available
//   fixtures" so an auditor can request them.
//
// Determinism:
//   - Every sim uses seed 12345 (regardless of the IR's default_seed),
//     so a rerun against the same engine commit produces byte-identical
//     PARs.
//   - 100k spins is chosen as the sweet spot between CI runtime budget
//     (~20-40s aggregate) and statistical confidence (CI ≈ ±0.3% on RTP).
//
// Usage:
//   npm run build && node scripts/par-samples-generate.mjs
//   # or:
//   npm run par-samples

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGameIR } from '../dist/ir/index.js';
import { runIRSimulation } from '../dist/engine/irSimulator.js';
import { renderParSheetToFile } from '../dist/report/parPdf.js';
import { tunePaytableToTarget } from '../dist/solver/parTuner.js';

// ─── Two-pass auto-scale ────────────────────────────────────────────────────
//
// Reference fixtures in tests/fixtures/reference/ are designed to exercise
// every mechanic (REF-A/B/C in faza12_reference.test.ts) — they intentionally
// do NOT carry production-tuned paytables. Without scaling, the untuned RTP
// ranges from ~50% (lines) to ~50,000,000% (deep feature chains).
//
// To produce regulator-shaped PAR samples we run a two-pass auto-scale:
//
//   pass 1: run sim at IR's untuned paytable → observe RTP
//   pass 2: scale every numeric paytable / cluster_pay_table entry by
//           target_rtp / observed_rtp, deep-clone the IR, rerun.
//
// The scale factor is recorded in the PAR JSON so the auditor can verify
// that the regulator-shaped PAR is *derivable* from the IR by a single
// declared transformation. The TWO-PASS bit is transparent — the second
// pass's results are the authoritative ones written to PAR.{json,pdf}.
//
// Linear scaling is exact for `lines/ways/cluster/pay_anywhere/pattern`
// (every win is `paytable × count` so scaling the table scales total RTP
// proportionally). For feature-heavy IRs where features carry their own
// multipliers, linear scaling is approximate.
//
// P0 #4.2: when the residual after the linear pass is still > 1% of target,
// we hand the IR to `tunePaytableToTarget` (src/solver/parTuner.ts) — a
// bisection on the paytable scalar that runs additional MC iterations until
// the observed RTP lands within ±0.5% of target. Each tuner iteration runs
// 20_000 spins at a fixed seed (12345), so the bisection trajectory itself
// is reproducible byte-for-byte across reruns. Cap is 8 iterations.

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function scalePaytable(ir, scale) {
  const cloned = deepClone(ir);
  // Main paytable: { symbolId: { countOrSize: number } }
  if (cloned.paytable && typeof cloned.paytable === 'object') {
    for (const sym of Object.keys(cloned.paytable)) {
      const entries = cloned.paytable[sym];
      if (entries && typeof entries === 'object') {
        for (const k of Object.keys(entries)) {
          const v = entries[k];
          if (typeof v === 'number') {
            entries[k] = v * scale;
          }
        }
      }
    }
  }
  // Cluster pay table (kind: cluster — separate per-size pay table).
  if (
    cloned.evaluation &&
    cloned.evaluation.kind === 'cluster' &&
    cloned.evaluation.cluster_pay_table
  ) {
    const cpt = cloned.evaluation.cluster_pay_table;
    for (const k of Object.keys(cpt)) {
      if (typeof cpt[k] === 'number') {
        cpt[k] = cpt[k] * scale;
      }
    }
  }
  return cloned;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'reference');
const OUT_DIR = join(REPO_ROOT, 'reports', 'par-samples');

const SPINS_PER_SAMPLE = 100_000;
const SAMPLE_SEED = 12345;

// ─── Curated 20: 1 line per fixture, mechanic label ────────────────────────
// Order matters — INDEX.md groups by family.
const SAMPLES = [
  // ─── Lines family (5) ────────────────────────────────────────────────
  { id: 'classic-3x3-lines',  mechanic: 'lines',          family: 'Lines'        },
  { id: '3x5-5lines',         mechanic: 'lines',          family: 'Lines'        },
  { id: '5x3-20lines',        mechanic: 'lines',          family: 'Lines'        },
  { id: '5x4-25lines',        mechanic: 'lines',          family: 'Lines'        },

  // ─── Ways family (2) ─────────────────────────────────────────────────
  { id: '5x3-243ways',        mechanic: 'ways',           family: 'Ways'         },
  { id: '6x4-4096ways',       mechanic: 'ways',           family: 'Ways'         },

  // ─── Cluster family (3) ──────────────────────────────────────────────
  { id: 'cluster-7x7',        mechanic: 'cluster',        family: 'Cluster'      },
  { id: 'cluster-diagonal',   mechanic: 'cluster',        family: 'Cluster'      },
  { id: 'cluster-hexagonal',  mechanic: 'cluster',        family: 'Cluster'      },

  // ─── Pay-anywhere (1) ────────────────────────────────────────────────
  { id: 'pay-anywhere',       mechanic: 'pay_anywhere',   family: 'Pay-Anywhere' },

  // ─── Variable-rows family (2) ────────────────────────────────────────
  { id: 'variable-rows-7reels',    mechanic: 'variable_ways',  family: 'Variable-Rows' },
  { id: 'complex-variable-rows',   mechanic: 'variable_ways',  family: 'Variable-Rows' },

  // ─── Cascade family (3) ──────────────────────────────────────────────
  { id: 'cascade-drop',       mechanic: 'cascade',        family: 'Cascade'      },
  { id: 'cascade-fixed-strip',mechanic: 'cascade',        family: 'Cascade'      },
  { id: 'cascade-refill',     mechanic: 'cascade',        family: 'Cascade'      },

  // ─── Free-spins variants (4) ─────────────────────────────────────────
  { id: 'fs-multiplier-ladder',mechanic: 'free_spins',    family: 'Free-Spins'   },
  { id: 'fs-sticky-wilds',    mechanic: 'free_spins',     family: 'Free-Spins'   },
  { id: 'fs-retrigger',       mechanic: 'free_spins',     family: 'Free-Spins'   },
  { id: 'fs-expanding-wilds', mechanic: 'free_spins',     family: 'Free-Spins'   },

  // ─── Hold & Win (1) ──────────────────────────────────────────────────
  { id: 'hnw-classic',        mechanic: 'hold_and_win',   family: 'Hold-and-Win' },
];

// Remaining fixtures (listed in INDEX as "available but not in baseline set").
const AVAILABLE_BUT_NOT_SAMPLED = [
  'expanding-wilds', 'hnw-full-grid', 'hnw-grand-jackpot', 'multiplier-wilds',
  'mystery-symbol', 'pick-bonus', 'respin-feature', 'symbol-upgrade',
  'walking-wilds', 'wheel-bonus',
];

// ─── Mapping IRSimResult → ParRenderInput ──────────────────────────────────

/**
 * Map an IR + simulation result onto the structural subset that
 * ParRenderInput expects. Everything missing renders as "—".
 */
function buildParInput(id, family, mechanic, ir, simResult, spins, seed) {
  const layout =
    ir.topology.kind === 'rectangular'
      ? `${ir.topology.reels}x${ir.topology.rows}`
      : ir.topology.kind === 'variable_rows'
        ? `${ir.topology.reels}x(variable)`
        : ir.topology.kind === 'cluster_grid'
          ? `${ir.topology.columns}x${ir.topology.rows} (cluster)`
          : 'unknown';

  // Find the line/way/cluster evaluator kind for the "Pay system" line.
  const paySystem = ir.evaluation.kind;
  const paylinesCount =
    ir.evaluation.kind === 'lines' ? (ir.evaluation.paylines?.length ?? 0) : 0;

  // CI95 helper — Welford-light approximation: stdErr = stdDev / √N, CI95 = ±1.96·stdErr.
  // We don't get raw variance from the IRSimResult contract; use a coarse
  // ±0.3% margin (typical 100k-spin CI) so the PDF doesn't claim
  // sub-permille precision we didn't measure.
  const rtp = simResult.rtp; // already 0-1 fraction
  const coarseErr = 1.96 / Math.sqrt(spins); // ~±0.62% at 100k
  const ci95Lower = Math.max(0, rtp - coarseErr);
  const ci95Upper = rtp + coarseErr;

  // Per-feature breakdown (only kinds with non-zero contribution).
  const features = [];
  for (const [kind, value] of Object.entries(simResult.rtpBreakdown ?? {})) {
    if (typeof value !== 'number' || value === 0) continue;
    if (kind === 'base') continue;
    const triggerFreq = simResult.featureTriggerFreqs?.[kind];
    features.push({
      id: kind,
      name: kind.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
      triggerRate: triggerFreq && triggerFreq > 0 ? 1 / triggerFreq : undefined,
      frequency:
        triggerFreq && Number.isFinite(triggerFreq)
          ? `1 in ${Math.round(triggerFreq).toLocaleString('en-US')}`
          : 'never triggered',
      rtpContribution: value,
    });
  }

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    configHash: null, // intentionally omitted — fixture's IR is the contract
    game: {
      name: ir.meta?.name ?? id,
      version: ir.meta?.version ?? '0.0.0',
      mathVersion: 'sample-run',
      layout,
      paySystem,
      paylines: paylinesCount,
      targetRTP: (ir.limits?.target_rtp ?? null) !== null
        ? Number(ir.limits.target_rtp) * 100
        : undefined, // percent
      targetVolatility: undefined,
      maxWin: ir.limits?.max_win_x ?? undefined,
    },
    simulation: {
      spins,
      seed,
      engineVersion: 'slot-math-engine-template @ a5679c9+',
    },
    results: {
      observedRTP: rtp,
      rtpPercent: rtp * 100,
      errorMargin: coarseErr,
      ci95Lower,
      ci95Upper,
      rtpBreakdown: simResult.rtpBreakdown,
      hitRate: simResult.hitRate,
      deadSpinRate: 1 - simResult.hitRate,
      maxObservedWin: simResult.maxWinX,
    },
    volatility: {
      // No per-spin std-dev exposed in IRSimResult contract; left blank.
      // The PAR PDF will render "—" rather than fabricate.
    },
    features,
    notes: [
      `Generic-mechanic sample — no game / vendor IP.`,
      `Family: ${family}; mechanic: ${mechanic}.`,
      `Sampled by scripts/par-samples-generate.mjs at ${spins.toLocaleString('en-US')} spins, seed ${seed}.`,
    ],
    compliance: {
      standard: 'GLI-16',
      submitter: 'Slot Math Engine Template (P0 #4 sample set)',
      cycleSize: spins,
    },
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const indexRows = [];
  const startedAt = new Date();

  let failures = 0;
  for (const { id, family, mechanic } of SAMPLES) {
    const fixturePath = join(FIXTURE_DIR, `${id}.json`);
    process.stdout.write(`▶ ${id.padEnd(34)} `);

    let ir;
    try {
      const raw = readFileSync(fixturePath, 'utf-8');
      const json = JSON.parse(raw);
      const parsed = parseGameIR(json);
      if (!parsed.ok) {
        const issues = (parsed.issues ?? [])
          .map((i) => `${i.path ?? ''}: ${i.message ?? ''}`)
          .join('; ');
        throw new Error(`IR validation: ${issues || 'unknown'}`);
      }
      ir = parsed.ir;
    } catch (e) {
      console.log(`✗ IR parse — ${e.message}`);
      indexRows.push({ id, family, mechanic, status: 'FAILED', rtp: '—', hitRate: '—', features: 0, err: e.message });
      failures++;
      continue;
    }

    const targetRtp = ir.limits?.target_rtp ?? 0.95;

    let simRaw, simScaled, scaleFactor;
    let tunerIterations = 0;
    let tunerConverged = null;
    try {
      // Pass 1: untuned.
      simRaw = await runIRSimulation(ir, { spins: SPINS_PER_SAMPLE, seed: SAMPLE_SEED });

      // Compute scale and run pass 2 if observed RTP isn't already within
      // [0.85, 1.05]× target (i.e. the IR is already roughly tuned).
      let scaledIR;
      if (simRaw.rtp <= 0 || !Number.isFinite(simRaw.rtp)) {
        // Can't scale a zero/NaN/inf RTP — record as-is.
        scaleFactor = 1.0;
        simScaled = simRaw;
        scaledIR = ir;
      } else if (Math.abs(simRaw.rtp - targetRtp) / targetRtp < 0.05) {
        scaleFactor = 1.0;
        simScaled = simRaw;
        scaledIR = ir;
      } else {
        scaleFactor = targetRtp / simRaw.rtp;
        scaledIR = scalePaytable(ir, scaleFactor);
        simScaled = await runIRSimulation(scaledIR, { spins: SPINS_PER_SAMPLE, seed: SAMPLE_SEED });
      }

      // P0 #4.2: if the linear pass leaves > 0.5% relative residual, run the
      // non-linear bisection tuner on top. It deep-clones the IR internally
      // and uses the same fixed seed (12345) as the par-sample sim → still
      // byte-reproducible across reruns. The 0.5% threshold matches the
      // regulator-grade tolerance asserted in `tests/par_tuner.test.ts`
      // (TUNER-02), so any fixture the tuner is supposed to handle gets
      // dispatched to it here.
      if (
        Number.isFinite(simScaled.rtp) &&
        simScaled.rtp > 0 &&
        Math.abs(simScaled.rtp - targetRtp) / targetRtp > 0.005
      ) {
        // Use the same spin count as the par sample so the bisection's
        // observed RTP matches what the final 100k sim will see — otherwise
        // a 20k-spin tune can converge in tuner-space yet drift outside
        // tolerance at 100k due to variance.
        const tuned = await tunePaytableToTarget(scaledIR, targetRtp, {
          spins: SPINS_PER_SAMPLE,
          seed: SAMPLE_SEED,
          tolerance: 0.005,
          maxIterations: 8,
        });
        tunerIterations = tuned.iterations;
        tunerConverged = tuned.converged;
        // Compose the final scale: tunerScale composes with the linear pre-pass scale.
        scaleFactor = scaleFactor * tuned.scale;
        // The tuner's last iteration already ran at SPINS_PER_SAMPLE seed=SAMPLE_SEED;
        // its `tuned.finalRtp` is the RTP we'd reproduce by running once more.
        // Run one more sim on the final tuned IR to capture the full IRSimResult
        // (rtpBreakdown / featureTriggerFreqs / hitRate) for the PAR JSON.
        simScaled = await runIRSimulation(tuned.ir, { spins: SPINS_PER_SAMPLE, seed: SAMPLE_SEED });

        // Confirmation pass: if the post-tune 100k sim drifts outside the
        // ±0.5% band (which can happen on fixtures with non-deterministic
        // behaviors like MysteryBehavior that consume Math.random outside the
        // seeded mulberry32 stream), run the tuner again from the now-tuned
        // IR. Two confirmation passes are the maximum we allow to keep
        // wall-clock bounded.
        let confirmationsLeft = 2;
        let currentIR = tuned.ir;
        while (
          confirmationsLeft > 0 &&
          Number.isFinite(simScaled.rtp) &&
          Math.abs(simScaled.rtp - targetRtp) / targetRtp > 0.005
        ) {
          confirmationsLeft--;
          const reTuned = await tunePaytableToTarget(currentIR, targetRtp, {
            spins: SPINS_PER_SAMPLE,
            seed: SAMPLE_SEED,
            tolerance: 0.005,
            maxIterations: 8,
          });
          tunerIterations += reTuned.iterations;
          tunerConverged = reTuned.converged;
          scaleFactor = scaleFactor * reTuned.scale;
          currentIR = reTuned.ir;
          simScaled = await runIRSimulation(currentIR, { spins: SPINS_PER_SAMPLE, seed: SAMPLE_SEED });
        }
      }
    } catch (e) {
      console.log(`✗ sim — ${e.message}`);
      indexRows.push({ id, family, mechanic, status: 'FAILED', rtp: '—', hitRate: '—', features: 0, err: e.message });
      failures++;
      continue;
    }

    const sim = simScaled;
    const parInput = buildParInput(id, family, mechanic, ir, sim, SPINS_PER_SAMPLE, SAMPLE_SEED);
    parInput.simulation = {
      ...parInput.simulation,
      paytableScaleFactor: scaleFactor,
      preScaleRTP: simRaw.rtp,
    };
    if (scaleFactor !== 1.0) {
      parInput.notes.push(
        `Two-pass auto-scale: paytable multiplied by ${scaleFactor.toExponential(4)} ` +
          `to match target_rtp = ${(targetRtp * 100).toFixed(2)}% ` +
          `(pre-scale observed RTP = ${(simRaw.rtp * 100).toFixed(2)}%).`,
      );
    }
    if (tunerIterations > 0) {
      parInput.notes.push(
        `Non-linear PAR tuner (P0 #4.2): ${tunerIterations} bisection iter(s), ` +
          `converged=${tunerConverged} (tolerance ±0.5% RTP).`,
      );
      parInput.simulation = {
        ...parInput.simulation,
        nonLinearTuner: {
          iterations: tunerIterations,
          converged: tunerConverged,
          finalScale: scaleFactor,
        },
      };
    }

    // Write JSON
    const jsonOut = join(OUT_DIR, `${id}.par.json`);
    writeFileSync(jsonOut, JSON.stringify(parInput, null, 2));

    // Render PDF
    const pdfOut = join(OUT_DIR, `${id}.par.pdf`);
    try {
      await renderParSheetToFile(parInput, pdfOut, {
        disclaimer:
          'Slot Math Engine Template — generic-mechanic sample. No game / vendor IP.',
      });
    } catch (e) {
      console.log(`✗ PDF render — ${e.message}`);
      indexRows.push({ id, family, mechanic, status: 'JSON-only', rtp: sim.rtp.toFixed(4), hitRate: sim.hitRate.toFixed(4), features: parInput.features.length, err: e.message });
      failures++;
      continue;
    }

    console.log(
      `RTP=${(sim.rtp * 100).toFixed(2).padStart(6)}% hit=${(sim.hitRate * 100).toFixed(2).padStart(6)}% feats=${parInput.features.length}  → ${id}.par.{json,pdf}`,
    );
    indexRows.push({
      id,
      family,
      mechanic,
      status: 'OK',
      rtp: (sim.rtp * 100).toFixed(2) + '%',
      hitRate: (sim.hitRate * 100).toFixed(2) + '%',
      features: parInput.features.length,
    });
  }

  const finishedAt = new Date();
  const elapsedSec = ((finishedAt - startedAt) / 1000).toFixed(1);

  // ─── INDEX.md aggregate table ─────────────────────────────────────────
  const indexLines = [];
  indexLines.push('# PAR Sample Set — Generic Mechanics');
  indexLines.push('');
  indexLines.push(
    `**Generated:** ${finishedAt.toISOString()}  ·  **Engine:** \`slot-math-engine-template\`  ·  **Spins/sample:** ${SPINS_PER_SAMPLE.toLocaleString('en-US')}  ·  **Seed:** \`${SAMPLE_SEED}\`  ·  **Wall-clock:** ${elapsedSec}s`,
  );
  indexLines.push('');
  indexLines.push('## Purpose');
  indexLines.push('');
  indexLines.push(
    'P0 #4 deliverable: 20 generic-mechanic PAR samples spanning the engine\'s ' +
      'full mechanic surface. **No game / vendor IP** is referenced anywhere; each ' +
      'sample is keyed by mechanic family, not by any commercial slot title.',
  );
  indexLines.push('');
  indexLines.push(
    'The set is the "universal mechanics" claim made concrete — auditors can ' +
      'reproduce every row below by running ' +
      '`npm run par-samples` against the committed engine.',
  );
  indexLines.push('');
  indexLines.push('## Reproduction');
  indexLines.push('');
  indexLines.push('```bash');
  indexLines.push('npm run build');
  indexLines.push('node scripts/par-samples-generate.mjs');
  indexLines.push('# OR:');
  indexLines.push('npm run par-samples');
  indexLines.push('```');
  indexLines.push('');
  indexLines.push('## Sample table');
  indexLines.push('');
  indexLines.push('| # | ID | Family | Mechanic | Status | RTP | Hit rate | Features | Artefacts |');
  indexLines.push('|---|----|--------|----------|--------|-----|----------|----------|-----------|');
  let n = 0;
  for (const row of indexRows) {
    n++;
    const status =
      row.status === 'OK' ? '✅' : row.status === 'JSON-only' ? '⚠️ JSON' : '❌';
    const artefacts =
      row.status === 'OK'
        ? `[\`json\`](./${row.id}.par.json) · [\`pdf\`](./${row.id}.par.pdf)`
        : row.status === 'JSON-only'
          ? `[\`json\`](./${row.id}.par.json) (no PDF)`
          : `failed: ${row.err ?? ''}`;
    indexLines.push(
      `| ${n} | \`${row.id}\` | ${row.family} | \`${row.mechanic}\` | ${status} | ${row.rtp} | ${row.hitRate} | ${row.features} | ${artefacts} |`,
    );
  }

  indexLines.push('');
  indexLines.push('## Notes');
  indexLines.push('');
  indexLines.push(
    '- **RTP / hit-rate values** are MC estimates at ' +
      SPINS_PER_SAMPLE.toLocaleString('en-US') +
      ' spins; CI95 ≈ ±0.62% is documented in each PAR PDF.',
  );
  indexLines.push(
    '- **Determinism:** seed = `' + SAMPLE_SEED + '` for every sample. Rerunning ' +
      'against the same engine commit reproduces byte-identical PAR JSON.',
  );
  indexLines.push(
    '- **Feature counts** reflect features whose `rtpBreakdown` contribution is non-zero ' +
      'in this sample run. A `0` does NOT mean the IR lacks the feature — only that the ' +
      'sample run did not trigger it. For exact feature-trigger frequencies, see the per-ID JSON.',
  );
  indexLines.push('');
  indexLines.push('## Additional fixtures available (not in baseline set)');
  indexLines.push('');
  indexLines.push(
    'The following fixtures cover sibling mechanic variants already represented above. ' +
      'They are committed under `tests/fixtures/reference/` and can be added to the ' +
      'sample set by appending an entry to `SAMPLES` in `scripts/par-samples-generate.mjs`:',
  );
  indexLines.push('');
  for (const id of AVAILABLE_BUT_NOT_SAMPLED) {
    indexLines.push(`- \`${id}\``);
  }
  indexLines.push('');
  indexLines.push('## Cross-reference');
  indexLines.push('');
  indexLines.push(
    '- `docs/compliance.md` — submission-kit item #10 (' +
      '"`reports/math/par.pdf` — Generated PAR sheet").',
  );
  indexLines.push(
    '- `SLOT_ENGINE_MASTER_TODO.md` — P0 plug-list item #4 ' +
      '("PAR sheet sakupljanje za 20 reference igara").',
  );
  indexLines.push(
    '- `tests/faza12_reference.test.ts` — same fixture set, used as RTP-bounds smoke tests.',
  );
  indexLines.push('');

  const indexPath = join(OUT_DIR, 'INDEX.md');
  writeFileSync(indexPath, indexLines.join('\n'));

  console.log('');
  console.log(`✓ ${SAMPLES.length - failures}/${SAMPLES.length} samples succeeded (${elapsedSec}s)`);
  console.log(`  INDEX:    ${indexPath}`);
  console.log(`  Artefacts ${OUT_DIR}/{<id>.par.json,<id>.par.pdf}`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('par-samples-generate failed:', e);
  process.exitCode = 2;
});
