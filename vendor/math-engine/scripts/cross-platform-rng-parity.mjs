#!/usr/bin/env node
// Cross-Platform RNG Byte-Parity Gate — Wave 48 (Faza 7.3 sales-blocker closeout)
//
// Sales claim: "Same seed → same first 100,000 RNG outputs on Linux-x64,
// macOS-arm64, macOS-x64, AND Windows-x64." Until Wave 48 the engine had:
//
//   - Linux + macOS verified via tests/rng_parity.test.ts (TS↔Rust same-OS)
//   - Windows-x64 ❌ — no CI artifact comparing Windows output to other OS-es
//
// This script generates 100,000 outputs from each of the 5 in-process RNG
// backends (mulberry32, pcg64, xoshiro256ss, philox4x32, chacha20) under
// the same seed (12345), SHA-256 hashes each stream, and compares against
// a committed golden snapshot. If hashes differ on ANY OS → engine claim
// breaks → CI fails loudly.
//
// Why 100k not 1M:
//   - Mulberry32 period is 2^32 so 100k samples is statistically negligible
//   - SHA-256 of any deterministic stream is exact (no statistical noise);
//     100k vs 1M only changes wall time, not the byte-parity claim
//   - CI runtime budget: ~1.5s per OS × 4 OS = 6s total. 1M would push to
//     ~15s per OS = 60s for the matrix.
//
// Determinism guarantees we rely on:
//   - Mulberry32: Math.imul + u32 arithmetic only (ECMA spec exact)
//   - PCG-64: BigInt 64-bit multiply-add (ECMA BigInt spec exact)
//   - Xoshiro256SS: BigInt 64-bit rotates + XOR (ECMA BigInt spec exact)
//   - Philox4x32: u32 multiply-high via BigInt (ECMA spec exact)
//   - ChaCha20: u32 ops via @noble/hashes (exact across V8 / SpiderMonkey
//     / JSC; pure JS, no native code)
//
// Output:
//   reports/parity/CROSS_PLATFORM_RNG_PARITY.json — per-backend SHA-256 +
//     OS/arch/Node version metadata + verdict
//   reports/parity/CROSS_PLATFORM_GOLDEN.json — committed reference
//     (generated once on dev box, verified on CI matrix)
//
// Usage:
//   npm run cross-platform-rng-parity                  # generate + compare
//   node scripts/cross-platform-rng-parity.mjs --update-golden  # rebuild golden
//   node scripts/cross-platform-rng-parity.mjs --verify-only    # CI verify

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { platform, arch, version as nodeVersion } from 'node:process';

import { Mulberry32 } from '../dist/rng/backends/Mulberry32.js';
import { PCG64 } from '../dist/rng/backends/PCG64.js';
import { Xoshiro256SS } from '../dist/rng/backends/Xoshiro256SS.js';
import { Philox4x32 } from '../dist/rng/backends/Philox4x32.js';
import { ChaCha20 } from '../dist/rng/backends/ChaCha20.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PARITY_DIR = join(ROOT, 'reports', 'parity');
const GOLDEN_PATH = join(PARITY_DIR, 'CROSS_PLATFORM_GOLDEN.json');
const REPORT_PATH = join(PARITY_DIR, 'CROSS_PLATFORM_RNG_PARITY.json');

const args = new Set(process.argv.slice(2));
const UPDATE_GOLDEN = args.has('--update-golden');
const VERIFY_ONLY = args.has('--verify-only');

const SEED = 12345;
const SAMPLES = 100_000;

const BACKENDS = [
  {
    id: 'mulberry32',
    create: () => new Mulberry32(SEED),
    // Mulberry32 is pure u32; we capture nextF64 (which returns step() in [0,1))
    // and re-encode as the canonical raw u32 to make hashing robust against
    // any V8 float formatting drift (there should be none, but defensive).
    sample: (rng) => {
      // step() returns float in [0,1); re-extract the underlying u32 by
      // multiplying back. step() is private so we use nextF64 which is the
      // same internal call.
      const f = rng.nextF64();
      return Math.floor(f * 4294967296) >>> 0;
    },
    encoder: 'u32',
  },
  {
    id: 'pcg64',
    create: () => new PCG64(SEED),
    // PCG64 nextU64 returns [hi, lo] u32 pair
    sample: (rng) => {
      const [hi, lo] = rng.nextU64();
      return [hi >>> 0, lo >>> 0];
    },
    encoder: 'u32x2',
  },
  {
    id: 'xoshiro256ss',
    create: () => new Xoshiro256SS(SEED),
    sample: (rng) => {
      const [hi, lo] = rng.nextU64();
      return [hi >>> 0, lo >>> 0];
    },
    encoder: 'u32x2',
  },
  {
    id: 'philox4x32',
    create: () => new Philox4x32(SEED),
    sample: (rng) => {
      const [hi, lo] = rng.nextU64();
      return [hi >>> 0, lo >>> 0];
    },
    encoder: 'u32x2',
  },
  {
    id: 'chacha20',
    create: () => new ChaCha20(SEED),
    sample: (rng) => {
      const [hi, lo] = rng.nextU64();
      return [hi >>> 0, lo >>> 0];
    },
    encoder: 'u32x2',
  },
];

function hashBackend(backend) {
  const rng = backend.create();
  const hash = createHash('sha256');
  // Pre-allocate buffers; SHA-256 over u32-LE bytes — endianness explicit.
  const buf4 = new ArrayBuffer(4);
  const view4 = new DataView(buf4);
  const buf8 = new ArrayBuffer(8);
  const view8 = new DataView(buf8);

  for (let i = 0; i < SAMPLES; i++) {
    const v = backend.sample(rng);
    if (backend.encoder === 'u32') {
      view4.setUint32(0, v, true); // little-endian, canonical
      hash.update(Buffer.from(buf4));
    } else if (backend.encoder === 'u32x2') {
      view8.setUint32(0, v[0], true);
      view8.setUint32(4, v[1], true);
      hash.update(Buffer.from(buf8));
    }
  }
  return hash.digest('hex');
}

function envFingerprint() {
  return {
    os: platform,
    arch,
    nodeVersion,
    timestamp: new Date().toISOString(),
  };
}

function generateReport() {
  const env = envFingerprint();
  const backends = {};
  for (const backend of BACKENDS) {
    const t0 = Date.now();
    const hash = hashBackend(backend);
    const dt = Date.now() - t0;
    backends[backend.id] = {
      sha256: hash,
      samples: SAMPLES,
      seed: SEED,
      encoder: backend.encoder,
      wallTimeMs: dt,
    };
  }
  return { env, samples: SAMPLES, seed: SEED, backends };
}

function compareToGolden(actual, golden) {
  const drifts = [];
  for (const [id, exp] of Object.entries(golden.backends)) {
    const got = actual.backends[id];
    if (!got) {
      drifts.push(`${id}: missing in actual report`);
      continue;
    }
    if (got.sha256 !== exp.sha256) {
      drifts.push(`${id}: expected ${exp.sha256.slice(0, 16)}… got ${got.sha256.slice(0, 16)}…`);
    }
  }
  for (const id of Object.keys(actual.backends)) {
    if (!golden.backends[id]) {
      drifts.push(`${id}: present in actual but missing from golden`);
    }
  }
  return drifts;
}

mkdirSync(PARITY_DIR, { recursive: true });

if (UPDATE_GOLDEN) {
  console.log(`[xplat-rng-parity] Generating golden snapshot...`);
  const report = generateReport();
  const golden = {
    note: 'Cross-platform RNG byte-parity golden snapshot. SHA-256 of first ' +
      `${SAMPLES.toLocaleString()} outputs per backend at seed=${SEED}. ` +
      'Bit-identical across linux-x64, macos-arm64, macos-x64, windows-x64 ' +
      'is the engine determinism contract. Verify on every CI run; update ' +
      'ONLY when intentionally changing an RNG algorithm.',
    generatedAtOS: report.env,
    samples: report.samples,
    seed: report.seed,
    backends: Object.fromEntries(
      Object.entries(report.backends).map(([id, b]) => [id, { sha256: b.sha256, samples: b.samples, encoder: b.encoder }]),
    ),
  };
  writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + '\n');
  console.log(`[xplat-rng-parity] Golden saved: ${GOLDEN_PATH}`);
  for (const [id, b] of Object.entries(report.backends)) {
    console.log(`  ${id.padEnd(15)} ${b.sha256.slice(0, 24)}…  ${b.wallTimeMs}ms`);
  }
  console.log('');
  console.log(`✅ Golden snapshot generated on ${report.env.os}/${report.env.arch} node ${report.env.nodeVersion}`);
  process.exit(0);
}

// Generate report
console.log(`[xplat-rng-parity] Generating report on ${platform}/${arch} node ${nodeVersion}...`);
const report = generateReport();

// Save report
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(`[xplat-rng-parity] Report saved: ${REPORT_PATH}`);

// Print per-backend
console.log('');
console.log('Backend         SHA-256 (first 24 hex)       Samples   Time');
console.log('──────────────────────────────────────────────────────────────');
for (const [id, b] of Object.entries(report.backends)) {
  console.log(`${id.padEnd(15)} ${b.sha256.slice(0, 24)}…  ${String(b.samples).padStart(7)}  ${String(b.wallTimeMs).padStart(4)}ms`);
}
console.log('');

// Compare to golden
if (!existsSync(GOLDEN_PATH)) {
  console.error(`❌ Golden snapshot missing: ${GOLDEN_PATH}`);
  console.error('   Run: node scripts/cross-platform-rng-parity.mjs --update-golden');
  process.exit(2);
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
const drifts = compareToGolden(report, golden);

if (drifts.length === 0) {
  console.log(`✅ Byte-parity PASS — all ${BACKENDS.length} backends match golden snapshot`);
  console.log(`   (Golden generated on ${golden.generatedAtOS.os}/${golden.generatedAtOS.arch}; ` +
              `verified on ${platform}/${arch})`);
  process.exit(0);
} else {
  console.error(`❌ Byte-parity FAIL — ${drifts.length} backend(s) drifted from golden:`);
  for (const d of drifts) console.error(`  - ${d}`);
  console.error('');
  console.error('This is a CRITICAL determinism violation. One of:');
  console.error('  1. RNG algorithm changed intentionally → run --update-golden');
  console.error('  2. RNG algorithm changed unintentionally → revert');
  console.error('  3. Cross-platform numeric drift detected → file P0 bug');
  process.exit(1);
}
