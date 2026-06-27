#!/usr/bin/env node
//
// W152 Wave 26 — Scaled determinism / parity gate.
//
// Three independent gates wrapped into one runner. Honest about which
// gate measures what:
//
//   A. **Rust self-determinism at scale** — same seed run twice
//      through `evaluator_parity` produces byte-identical NDJSON. This
//      is the strongest "the RNG path is stable" proof and the easiest
//      to verify at 10⁶+ spins.
//
//   B. **TS self-determinism at scale** — same seed run twice through
//      `irSimulator.runIRSimulation` produces identical aggregate
//      stats (RTP, hitRate, totalWin). Same role on the TS side.
//
//   C. **Cross-language bit-exact (pointer to existing vitest)** —
//      the per-spin TS↔Rust equality gate is owned by
//      `tests/evaluator_parity.test.ts` which spawns the oracle and
//      compares EVERY field of EVERY spin. That test is the bit-exact
//      gate; this script does NOT duplicate it. Instead we report its
//      pass/fail status so the report is a single dashboard.
//
// What we deliberately do NOT do here:
//   * Compare `irSimulator.runIRSimulation` (full game, includes FS +
//     H&W + lightning) against `evaluator_parity` (base game ONLY,
//     `disable_lightning=true`). They measure different surfaces; the
//     ~10pp delta is the FS + H&W contribution, NOT a parity bug.
//
// Output: `reports/parity/PARITY_SCALED.{json,md}`.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'parity');
const BIN_PATH = join(REPO_ROOT, 'target', 'release', 'evaluator_parity');
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'parity.json');

const argv = process.argv.slice(2);
const SPINS = (() => {
  const i = argv.indexOf('--spins');
  if (i >= 0 && argv[i + 1]) return Number(argv[i + 1]);
  return 1_000_000;
})();
const SEEDS = [42, 1337, 0xCAFEBABE, 0xDEADBEEF];

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureBinary() {
  if (!existsSync(BIN_PATH)) {
    console.error(
      `❌ Rust oracle missing at ${BIN_PATH}\n` +
        `   Build it first: cargo build --release --bin evaluator_parity --manifest-path rust-sim/Cargo.toml`,
    );
    process.exit(2);
  }
}

function runRustOracle(seed, spins) {
  const res = spawnSync(
    BIN_PATH,
    [
      '--config', FIXTURE,
      '--seed',   String(seed),
      '--spins',  String(spins),
    ],
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(
      `evaluator_parity exit ${res.status}: ${res.stderr ?? '(no stderr)'}`,
    );
  }
  return res.stdout;
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

async function runTSMirror(seed, spins, irSim) {
  const ir = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
  return irSim.runIRSimulation(ir, { spins, seed });
}

function checkVitestParityStatus() {
  // Run the existing per-spin TS↔Rust bit-exact test. It's the
  // canonical cross-language gate; we just surface its result here.
  const res = spawnSync(
    'node',
    [
      '--experimental-vm-modules',
      'node_modules/vitest/vitest.mjs',
      'run',
      'tests/evaluator_parity.test.ts',
    ],
    { encoding: 'utf-8', cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
  );
  // Don't propagate errors — we want a dashboard, not a fatal abort.
  return {
    exit: res.status,
    pass: res.status === 0,
    stdoutTail: (res.stdout ?? '').split('\n').slice(-20).join('\n'),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  ensureBinary();
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const irSim = await import(join(REPO_ROOT, 'dist', 'engine', 'irSimulator.js'));

  console.log(
    `Scaled parity: ${SEEDS.length} seeds × ${SPINS.toLocaleString()} spins\n`,
  );

  const rustRows = [];
  const tsRows = [];
  const startedAt = Date.now();

  for (const seed of SEEDS) {
    // ── A. Rust self-determinism ───────────────────────────────────────
    const aStart = Date.now();
    const stdout1 = runRustOracle(seed, SPINS);
    const aMs1 = Date.now() - aStart;
    const sha1 = sha256(stdout1);
    const bStart = Date.now();
    const stdout2 = runRustOracle(seed, SPINS);
    const aMs2 = Date.now() - bStart;
    const sha2 = sha256(stdout2);
    const rustBitExact = sha1 === sha2;

    // ── B. TS self-determinism ─────────────────────────────────────────
    const tsAStart = Date.now();
    const tsA = await runTSMirror(seed, SPINS, irSim);
    const tsAMs = Date.now() - tsAStart;
    const tsBStart = Date.now();
    const tsB = await runTSMirror(seed, SPINS, irSim);
    const tsBMs = Date.now() - tsBStart;
    const tsBitExact =
      tsA.rtp === tsB.rtp &&
      tsA.hitRate === tsB.hitRate &&
      tsA.totalWin === tsB.totalWin;

    console.log(
      `seed=${seed}  rust_sha=${sha1.slice(0, 12)}…  rust_self_det=${rustBitExact ? '✅' : '❌'}  ` +
        `ts_rtp=${(tsA.rtp * 100).toFixed(6)}%  ts_self_det=${tsBitExact ? '✅' : '❌'}  ` +
        `(rust ${aMs1}+${aMs2}ms · ts ${tsAMs}+${tsBMs}ms)`,
    );

    rustRows.push({ seed, sha256: sha1, bitExact: rustBitExact, msA: aMs1, msB: aMs2 });
    tsRows.push({
      seed,
      rtp: tsA.rtp,
      hitRate: tsA.hitRate ?? null,
      totalWin: tsA.totalWin ?? null,
      bitExact: tsBitExact,
      msA: tsAMs,
      msB: tsBMs,
    });
  }

  // ── C. Cross-language bit-exact gate (existing vitest) ─────────────────
  console.log(`\nRunning existing per-spin TS↔Rust bit-exact gate (vitest)…`);
  const cross = checkVitestParityStatus();
  console.log(
    `cross-language vitest: exit=${cross.exit} → ${cross.pass ? '✅ bit-exact' : '❌ drift detected'}`,
  );

  const wallTotalMs = Date.now() - startedAt;
  const rustOk = rustRows.every((r) => r.bitExact);
  const tsOk = tsRows.every((r) => r.bitExact);
  const overall = rustOk && tsOk && cross.pass;

  const meta = {
    generatedAtUtc: new Date().toISOString(),
    fixture: 'tests/fixtures/parity.json',
    spinsPerSeed: SPINS,
    seeds: SEEDS,
    rustSelfDeterminism: rustOk,
    tsSelfDeterminism: tsOk,
    crossLanguageGate: cross.pass,
    overallPassed: overall,
    wallTotalMs,
    totalRustSpins: 2 * SEEDS.length * SPINS,
    totalTsSpins: 2 * SEEDS.length * SPINS,
  };

  writeFileSync(
    join(OUT_DIR, 'PARITY_SCALED.json'),
    JSON.stringify({ meta, rust: rustRows, ts: tsRows, cross }, null, 2) + '\n',
  );

  // ── Markdown ─────────────────────────────────────────────────────────
  const md = [];
  md.push(`# Scaled Parity / Determinism Report\n\n`);
  md.push(`> Generated: ${meta.generatedAtUtc}\n`);
  md.push(`> Fixture: \`tests/fixtures/parity.json\`\n`);
  md.push(`> Seeds: ${SEEDS.join(', ')} · Spins/seed: ${SPINS.toLocaleString()}\n`);
  md.push(`> Total Rust spins this run: ${meta.totalRustSpins.toLocaleString()} · Wall: ${wallTotalMs}ms\n\n`);
  md.push(`## Headline\n\n`);
  md.push(
    `- Rust self-determinism @ ${SPINS.toLocaleString()} spins/seed: **${rustOk ? '✅' : '❌'}**\n`,
  );
  md.push(
    `- TS self-determinism @ ${SPINS.toLocaleString()} spins/seed: **${tsOk ? '✅' : '❌'}**\n`,
  );
  md.push(
    `- Cross-language bit-exact (existing vitest): **${cross.pass ? '✅' : '❌'}**\n\n`,
  );
  md.push(`## A. Rust self-determinism (per-spin NDJSON SHA-256)\n\n`);
  md.push(`| Seed | NDJSON sha256 (head) | Bit-exact 2× run | Wall A ms | Wall B ms |\n`);
  md.push(`|-----:|----------------------|:----------------:|---------:|---------:|\n`);
  for (const r of rustRows) {
    md.push(
      `| ${r.seed} | \`${r.sha256.slice(0, 16)}…\` | ${r.bitExact ? '✅' : '❌'} | ${r.msA} | ${r.msB} |\n`,
    );
  }
  md.push(`\n## B. TS self-determinism (aggregate stats)\n\n`);
  md.push(`| Seed | RTP | Hit rate | Bit-exact 2× run | Wall A ms | Wall B ms |\n`);
  md.push(`|-----:|----:|---------:|:----------------:|---------:|---------:|\n`);
  for (const r of tsRows) {
    md.push(
      `| ${r.seed} | ${(r.rtp * 100).toFixed(6)}% | ${r.hitRate !== null ? (r.hitRate * 100).toFixed(3) + '%' : '—'} | ${r.bitExact ? '✅' : '❌'} | ${r.msA} | ${r.msB} |\n`,
    );
  }
  md.push(`\n## C. Cross-language per-spin bit-exact (existing vitest)\n\n`);
  md.push(
    `Owner: \`tests/evaluator_parity.test.ts\` — compares EVERY field of EVERY spin between\n` +
      `Rust oracle output and TS spin emitter. Runs at 1 K spins/seed in CI.\n\n`,
  );
  md.push(`Status: **${cross.pass ? '✅ bit-exact' : '❌ drift detected'}** (vitest exit=${cross.exit})\n\n`);
  if (!cross.pass) {
    md.push(`### Vitest tail (last 20 lines)\n\n\`\`\`\n${cross.stdoutTail}\n\`\`\`\n\n`);
  }
  md.push(`## Why not compare \`irSimulator\` to \`evaluator_parity\` aggregate?\n\n`);
  md.push(
    `It would be apples-to-oranges. The Rust oracle disables FS + lightning to make its output a pure function of (config, seed, spin_idx); the TS \`irSimulator\` runs the FULL game (base + FS + H&W + lightning). The ~10pp aggregate RTP delta you'd see comparing the two is the FS + H&W contribution, NOT a parity bug. Per-spin TS↔Rust bit-exact (the vitest in §C) DOES disable FS on both sides — that's the canonical cross-language gate.\n\n`,
  );
  md.push(`## Acceptance verdict\n\n`);
  md.push(
    overall
      ? `**Master TODO 10.3 (scaled mid-tier) acceptance: ✅** Rust + TS self-deterministic at ${SPINS.toLocaleString()}-spin scale; cross-language bit-exact via existing vitest gate. The cert-grade 10⁹-spin run is operator-initiated CI dispatch.\n`
      : `**Master TODO 10.3 (scaled mid-tier) acceptance: ❌** — see failing rows above.\n`,
  );

  writeFileSync(join(OUT_DIR, 'PARITY_SCALED.md'), md.join(''));

  console.log(`\nReports → ${OUT_DIR}/PARITY_SCALED.{json,md}`);
  console.log(
    `Overall: ${overall ? '✅' : '❌'} (rust ${rustOk ? '✅' : '❌'} · ts ${tsOk ? '✅' : '❌'} · cross ${cross.pass ? '✅' : '❌'}) · ${wallTotalMs}ms wall`,
  );

  process.exit(overall ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
