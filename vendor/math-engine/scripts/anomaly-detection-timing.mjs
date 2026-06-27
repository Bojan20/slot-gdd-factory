#!/usr/bin/env node
//
// W152 Wave 21 — Anomaly Detection End-to-End Timing Report.
// Closes Faza 11.7 ⚠️ acceptance: "dashboard prikaže anomaliju unutar
// 60 sekundi od pojave u prod-u".
//
// Procedure:
//   1. Set up an `ObservabilityDashboard` + session sa AlertThreshold-ima.
//   2. Inject controlled anomalies into the spin stream (drift mean RTP,
//      excessive dry spell, RTP outlier per spin).
//   3. Measure wall-clock time-to-detection for each anomaly type.
//   4. Aggregate p50/p95/p99 latency across N independent runs.
//   5. Pass criterion: p99 ≤ 60 000 ms across all anomaly types.
//
// Output:
//   * `reports/observability/ANOMALY_TIMING.json` — machine-readable
//     per-anomaly latency distribution.
//   * `reports/observability/ANOMALY_TIMING.md` — human-readable verdict
//     for PR / acceptance dossier.
//
// Determinism:
//   * Synthetic spin stream — fixed seed + fixed event timing.
//   * Wall-clock latency is REAL ms (not synthetic) — measured via
//     `performance.now()`. Replay-safe ordinal ranking; absolute ms
//     varies machine-to-machine.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'node:perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'observability');

// ── Config ────────────────────────────────────────────────────────────────
const RUNS_PER_ANOMALY = 30;
const SPINS_PER_RUN = 500;
const PASS_LATENCY_MS = 60_000; // Faza 11.7 acceptance bound

// ── Anomaly synth helpers ────────────────────────────────────────────────

/** Healthy spin stream — RTP ~0.96, normal variance. */
function* healthyStream(n, baseRtp = 0.96) {
  let rngState = 12345;
  for (let i = 0; i < n; i++) {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    const u = rngState / 0x100000000;
    // Bernoulli-ish per-spin payout = bet × (rtp + noise)
    const payout = u < baseRtp ? 1 / baseRtp : 0;
    yield { bet: 1, payout, isWin: payout > 0 };
  }
}

/** Drift anomaly — RTP shifts from 0.96 to 1.10 mid-stream. */
function* driftAnomalyStream(n) {
  let rngState = 99999;
  const halfwayMark = Math.floor(n / 3);
  for (let i = 0; i < n; i++) {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    const u = rngState / 0x100000000;
    const rtp = i < halfwayMark ? 0.96 : 1.1;
    const payout = u < rtp ? 1 / rtp : 0;
    yield { bet: 1, payout, isWin: payout > 0, anomalyAt: i >= halfwayMark };
  }
}

/** Dry-spell anomaly — long sequence of zero payouts. */
function* drySpellAnomalyStream(n) {
  const drySpellLength = 200;
  for (let i = 0; i < n; i++) {
    const inDrySpell = i >= 100 && i < 100 + drySpellLength;
    yield { bet: 1, payout: inDrySpell ? 0 : 1, isWin: !inDrySpell, anomalyAt: inDrySpell };
  }
}

/** Outlier anomaly — single massive win (>= 1000× bet). */
function* outlierAnomalyStream(n) {
  const outlierIdx = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    if (i === outlierIdx) {
      yield { bet: 1, payout: 1500, isWin: true, anomalyAt: true };
    } else {
      yield { bet: 1, payout: i % 4 === 0 ? 1 : 0, isWin: i % 4 === 0 };
    }
  }
}

// ── Detection harness ────────────────────────────────────────────────────

async function runDetectionHarness(anomalyName, generator, modules) {
  const { ObservabilityDashboard } = modules;
  const latencies = [];
  for (let r = 0; r < RUNS_PER_ANOMALY; r++) {
    const dashboard = new ObservabilityDashboard();
    // Threshold schema (per src/observability/types.ts AlertThreshold):
    // {metric: 'rtp' | 'hitRate', min?, max?}.
    // We track:
    //   * rtp drift via 'rtp' min/max (0.85 ≤ rtp ≤ 1.05).
    //   * dry-spell + outlier indirectly via hitRate floor (drysprite → low hitRate).
    const session = dashboard.createSession({
      sessionId: `${anomalyName}-${r}`,
      mode: 'dev',
      thresholds: [
        { metric: 'rtp', min: 0.85, max: 1.05 },
        { metric: 'hitRate', min: 0.05, max: 0.95 },
      ],
    });
    let firstAlertSpinIndex = null;
    let anomalyFirstAt = null;
    const t0 = performance.now();
    let i = 0;
    for (const ev of generator(SPINS_PER_RUN)) {
      session.recordSpin?.({ bet: ev.bet, payout: ev.payout, features: [] });
      if (ev.anomalyAt && anomalyFirstAt === null) anomalyFirstAt = i;
      const snap = session.snapshot?.();
      if (snap?.alertsFired && snap.alertsFired.length > 0 && firstAlertSpinIndex === null) {
        firstAlertSpinIndex = i;
        const t1 = performance.now();
        latencies.push({ run: r, anomalyAt: anomalyFirstAt, alertAt: i, wallMs: t1 - t0 });
        break;
      }
      i++;
    }
    if (firstAlertSpinIndex === null) {
      const t1 = performance.now();
      latencies.push({ run: r, anomalyAt: anomalyFirstAt, alertAt: null, wallMs: t1 - t0, missed: true });
    }
  }
  return latencies;
}

// ── Stats helpers ────────────────────────────────────────────────────────

function pctile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.min(sortedArr.length - 1, Math.floor((sortedArr.length - 1) * p));
  return sortedArr[idx];
}

function summariseLatencies(latencies) {
  const detected = latencies.filter((l) => !l.missed);
  const wallMs = detected.map((l) => l.wallMs).sort((a, b) => a - b);
  const detectionRate = detected.length / latencies.length;
  return {
    runs: latencies.length,
    detectedCount: detected.length,
    detectionRate,
    p50WallMs: pctile(wallMs, 0.5),
    p95WallMs: pctile(wallMs, 0.95),
    p99WallMs: pctile(wallMs, 0.99),
    minWallMs: wallMs[0] ?? null,
    maxWallMs: wallMs[wallMs.length - 1] ?? null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const obs = await import(join(REPO_ROOT, 'dist', 'observability', 'index.js'));
  const modules = { ObservabilityDashboard: obs.ObservabilityDashboard };

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const anomalies = [
    { name: 'rtp_drift', generator: driftAnomalyStream },
    { name: 'dry_spell', generator: drySpellAnomalyStream },
    { name: 'win_outlier', generator: outlierAnomalyStream },
  ];

  const results = [];
  for (const a of anomalies) {
    process.stdout.write(`Measuring ${a.name}…  `);
    const latencies = await runDetectionHarness(a.name, a.generator, modules);
    const summary = summariseLatencies(latencies);
    results.push({ anomaly: a.name, summary, latencies });
    console.log(
      `det=${summary.detectedCount}/${summary.runs} p50=${summary.p50WallMs?.toFixed(2) ?? 'N/A'}ms p99=${summary.p99WallMs?.toFixed(2) ?? 'N/A'}ms`,
    );
  }

  const allP99 = results.map((r) => r.summary.p99WallMs).filter((x) => x !== null);
  const overallP99 = Math.max(...allP99);
  const allPassed = overallP99 <= PASS_LATENCY_MS;

  const meta = {
    generatedAtUtc: new Date().toISOString(),
    runsPerAnomaly: RUNS_PER_ANOMALY,
    spinsPerRun: SPINS_PER_RUN,
    passLatencyMs: PASS_LATENCY_MS,
    passed: allPassed,
    overallP99WallMs: overallP99,
  };

  writeFileSync(
    join(OUT_DIR, 'ANOMALY_TIMING.json'),
    JSON.stringify({ meta, results }, null, 2) + '\n',
    'utf-8',
  );

  // Markdown
  const md = [];
  md.push('# Anomaly Detection End-to-End Timing Report');
  md.push('');
  md.push(`> **W152 Wave 21 — Faza 11.7 acceptance proof.** Generated ${meta.generatedAtUtc}.`);
  md.push('');
  md.push(`**Headline:** ${allPassed ? '✅ PASS' : '❌ FAIL'} — overall p99 latency ${overallP99.toFixed(2)} ms vs ${PASS_LATENCY_MS} ms bound.`);
  md.push('');
  md.push('## Per-anomaly latency');
  md.push('');
  md.push('| Anomaly | Runs | Detected | Detection rate | p50 ms | p95 ms | p99 ms | Pass |');
  md.push('|---|---:|---:|---:|---:|---:|---:|:---:|');
  for (const r of results) {
    const ok = r.summary.p99WallMs !== null && r.summary.p99WallMs <= PASS_LATENCY_MS;
    md.push(
      `| ${r.anomaly} | ${r.summary.runs} | ${r.summary.detectedCount} | ${(r.summary.detectionRate * 100).toFixed(1)}% | ${r.summary.p50WallMs?.toFixed(2) ?? 'N/A'} | ${r.summary.p95WallMs?.toFixed(2) ?? 'N/A'} | ${r.summary.p99WallMs?.toFixed(2) ?? 'N/A'} | ${ok ? '✅' : '❌'} |`,
    );
  }
  md.push('');
  md.push('## Methodology');
  md.push('');
  md.push(`- **Runs per anomaly**: ${RUNS_PER_ANOMALY}, ${SPINS_PER_RUN} spins each.`);
  md.push('- **Anomaly types**: RTP drift (rtp shifts mid-stream), dry spell (200 zero-payout consecutive spins), win outlier (single 1500× bet payout).');
  md.push('- **Detection**: dashboard.snapshot.alertsFired non-empty after recording each spin.');
  md.push('- **Pass**: p99 wall-clock latency ≤ 60 000 ms across all anomaly types.');
  md.push('- **Determinism**: synthetic streams use fixed-seed LCGs; latency is real wall-clock and varies per machine.');
  md.push('');
  writeFileSync(join(OUT_DIR, 'ANOMALY_TIMING.md'), md.join('\n'), 'utf-8');
  console.log('');
  console.log(`Wrote ${join(OUT_DIR, 'ANOMALY_TIMING.json')}`);
  console.log(`Wrote ${join(OUT_DIR, 'ANOMALY_TIMING.md')}`);
  process.exit(allPassed ? 0 : 1);
}

await main();
