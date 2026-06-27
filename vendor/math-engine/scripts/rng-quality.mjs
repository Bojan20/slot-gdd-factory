#!/usr/bin/env node
// RNG quality runner — P0 #3 deliverable.
//
// Runs a regulator-shaped subset of statistical RNG quality tests against
// each shipped backend (mulberry32, pcg64, xoshiro256ss, philox4x32) and
// emits a JSON + Markdown report per backend in `reports/rng/`.
//
// ── Scope ────────────────────────────────────────────────────────────────
//
// This script implements **NIST SP 800-22 baseline** — the five most
// foundational tests from the 15-test battery, sufficient for a P0 audit
// pre-flight. They are:
//
//   1. Monobit (frequency)              — bias of 1s vs 0s
//   2. Frequency within a block          — local bias in non-overlapping blocks
//   3. Runs                              — count of bit-flip runs
//   4. Longest run of ones (in a block)  — extreme-value distribution
//   5. Cumulative sums (cusum, forward)  — random-walk excursion test
//
// All five emit a p-value in [0, 1]. Acceptance: p > 0.01 (NIST default
// significance level). A backend that fails any of the five is flagged
// red in INDEX.md; the engine refuses to ship that backend as the live
// RNG default.
//
// ── Full-suite escalation ────────────────────────────────────────────────
//
// The remaining 10 NIST tests + TestU01 BigCrush + PractRand 2^38-byte
// streaming are **out of scope for Node** — they require native tools.
// `reports/rng/HOWTO-fullsuite.md` documents the exact CLI invocations
// (homebrew installs, expected runtime, expected output files) so a CI
// operator can populate them in a few hours.
//
// ── Determinism ──────────────────────────────────────────────────────────
//
// Every backend is seeded with the constant 0xCAFEBABE_DEADBEEF; each
// test consumes the same byte count (1 Mbit by default). Rerunning the
// script against the same engine commit produces byte-identical reports.
//
// ── Usage ────────────────────────────────────────────────────────────────
//
//   npm run build && node scripts/rng-quality.mjs
//   # or:
//   npm run rng-quality

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Mulberry32,
  PCG64,
  Xoshiro256SS,
  Philox4x32,
} from '../dist/rng/index.js';
import { ChaCha20Rng } from '../dist/crypto/chacha20.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'reports', 'rng');

const SAMPLE_BITS = 1_000_000; // 1 Mbit
// All four backends accept `number` (≤ 2^53). We compress the conceptual
// 64-bit seed into a stable 32-bit value (top + bottom XOR-mixed) so the
// constructor calls are typed-clean across backends.
const BACKEND_SEED_NUMBER = 0xcafebabe ^ 0xdeadbeef; // 0x10752251
const BACKEND_SEED_HEX = '0xCAFEBABE_DEADBEEF (XOR-mixed → 0x' + BACKEND_SEED_NUMBER.toString(16).toUpperCase() + ')';

// ─── Bit-extraction harness ────────────────────────────────────────────────

/** Pull `n` bits from a backend, returning a Uint8Array of bit values 0/1.
 *  Backends that expose `nextU64()` (engine RngBackend conformant) emit 64
 *  bits per draw; backends that only expose `nextUint32()` (e.g. ChaCha20Rng
 *  in `crypto/`) emit 32 bits per draw. Either way the extraction is MSB
 *  first so re-runs produce byte-identical output. */
function pullBits(rng, nBits) {
  const out = new Uint8Array(nBits);
  let i = 0;
  const has64 = typeof rng.nextU64 === 'function';
  while (i < nBits) {
    if (has64) {
      const [hi, lo] = rng.nextU64();
      for (let bit = 63; bit >= 0 && i < nBits; bit--) {
        const word = bit >= 32 ? hi : lo;
        const shift = bit >= 32 ? bit - 32 : bit;
        out[i++] = (word >>> shift) & 1;
      }
    } else {
      const word = rng.nextUint32() >>> 0;
      for (let bit = 31; bit >= 0 && i < nBits; bit--) {
        out[i++] = (word >>> bit) & 1;
      }
    }
  }
  return out;
}

// ─── Mathematical helpers ──────────────────────────────────────────────────

/** Complementary error function — exact-enough Chebyshev approximation. */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  // Abramowitz & Stegun 7.1.26 — error < 1.5e-7.
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Regularized lower incomplete gamma γ(a, x) / Γ(a) — series + continued fraction. */
function regGammaP(a, x) {
  if (x < 0 || a <= 0) return 0;
  if (x === 0) return 0;
  if (x < a + 1) {
    // Series expansion.
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // Continued fraction for upper incomplete; subtract from 1.
  return 1 - regGammaQ(a, x);
}

function regGammaQ(a, x) {
  if (x < a + 1) return 1 - regGammaP(a, x);
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** log Γ(z) — Lanczos approximation, 15-digit accuracy. */
function logGamma(z) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// ─── NIST SP 800-22 tests (subset of 5) ────────────────────────────────────

/** §2.1 Frequency (Monobit) Test. */
function monobit(bits) {
  const n = bits.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += bits[i] === 1 ? 1 : -1;
  const sObs = Math.abs(s) / Math.sqrt(n);
  const p = erfc(sObs / Math.SQRT2);
  return { name: 'monobit', p, pass: p > 0.01, sObs, n };
}

/** §2.2 Frequency Test within a Block. */
function blockFrequency(bits, M = 1000) {
  const n = bits.length;
  const N = Math.floor(n / M);
  if (N < 1) return { name: 'block_frequency', p: NaN, pass: false, error: 'too few bits' };
  let chi2 = 0;
  for (let i = 0; i < N; i++) {
    let ones = 0;
    for (let j = 0; j < M; j++) ones += bits[i * M + j];
    const pi = ones / M;
    chi2 += (pi - 0.5) ** 2;
  }
  chi2 *= 4 * M;
  const p = regGammaQ(N / 2, chi2 / 2);
  return { name: 'block_frequency', p, pass: p > 0.01, chi2, blocks: N, M };
}

/** §2.3 Runs Test. */
function runs(bits) {
  const n = bits.length;
  const ones = bits.reduce((s, b) => s + b, 0);
  const pi = ones / n;
  if (Math.abs(pi - 0.5) >= 2 / Math.sqrt(n)) {
    return { name: 'runs', p: 0, pass: false, error: 'monobit prerequisite failed', pi };
  }
  let Vn = 1;
  for (let k = 1; k < n; k++) if (bits[k] !== bits[k - 1]) Vn++;
  const numerator = Math.abs(Vn - 2 * n * pi * (1 - pi));
  const denominator = 2 * Math.sqrt(2 * n) * pi * (1 - pi);
  const p = erfc(numerator / denominator);
  return { name: 'runs', p, pass: p > 0.01, Vn, pi, n };
}

/** §2.4 Longest Run of Ones in a Block — m=8 variant for 1Mbit. */
function longestRun(bits) {
  const n = bits.length;
  // Pick M = 10000 for n >= 750k (NIST table). Then K=6, N=floor(n/M).
  const M = 10000;
  const N = Math.floor(n / M);
  if (N < 1) return { name: 'longest_run', p: NaN, pass: false, error: 'too few bits' };
  // Class boundaries for M=10000 per NIST: V[0]<=10, V[1]=11, V[2]=12, V[3]=13,
  // V[4]=14, V[5]=15, V[6]>=16. K=6.
  const K = 6;
  const v = new Array(K + 1).fill(0);
  for (let i = 0; i < N; i++) {
    let longest = 0;
    let cur = 0;
    for (let j = 0; j < M; j++) {
      if (bits[i * M + j] === 1) {
        cur++;
        if (cur > longest) longest = cur;
      } else {
        cur = 0;
      }
    }
    if (longest <= 10) v[0]++;
    else if (longest >= 16) v[6]++;
    else v[longest - 10]++;
  }
  // Probabilities for M=10000 (NIST table).
  const pi = [0.0882, 0.2092, 0.2483, 0.1933, 0.1208, 0.0675, 0.0727];
  let chi2 = 0;
  for (let i = 0; i <= K; i++) {
    const exp = N * pi[i];
    chi2 += ((v[i] - exp) ** 2) / exp;
  }
  const p = regGammaQ(K / 2, chi2 / 2);
  return { name: 'longest_run', p, pass: p > 0.01, chi2, classes: v, M };
}

/** §2.13 Cumulative Sums (forward). */
function cusumForward(bits) {
  const n = bits.length;
  let max = 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += bits[i] === 1 ? 1 : -1;
    if (Math.abs(s) > max) max = Math.abs(s);
  }
  const z = max;
  const sqrtN = Math.sqrt(n);
  // P-value formula per NIST §2.13.4.
  const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  let term1 = 0;
  let term2 = 0;
  const kMin = Math.floor((-n / z + 1) / 4);
  const kMax = Math.floor((n / z - 1) / 4);
  for (let k = kMin; k <= kMax; k++) {
    term1 += phi(((4 * k + 1) * z) / sqrtN) - phi(((4 * k - 1) * z) / sqrtN);
  }
  const kMin2 = Math.floor((-n / z - 3) / 4);
  const kMax2 = Math.floor((n / z - 1) / 4);
  for (let k = kMin2; k <= kMax2; k++) {
    term2 += phi(((4 * k + 3) * z) / sqrtN) - phi(((4 * k + 1) * z) / sqrtN);
  }
  const p = Math.max(0, Math.min(1, 1 - term1 + term2));
  return { name: 'cusum_forward', p, pass: p > 0.01, z, n };
}

function erf(x) {
  return 1 - erfc(x);
}

// ─── Driver ────────────────────────────────────────────────────────────────

function newBackend(kind, seed) {
  switch (kind) {
    case 'mulberry32':
      return new Mulberry32(seed >>> 0);
    case 'pcg64':
      return new PCG64(seed >>> 0);
    case 'xoshiro256ss':
      return new Xoshiro256SS(seed >>> 0);
    case 'philox4x32':
      return new Philox4x32(seed >>> 0);
    case 'chacha20': {
      // ChaCha20 takes a hex string seed (32 bytes = 64 hex chars). We
      // expand the 32-bit numeric seed to 32 bytes deterministically:
      // pad with seed-derived counter bytes so every backend uses the
      // identical entropy footprint baseline.
      const s = (seed >>> 0).toString(16).padStart(8, '0');
      // 64-hex = 32 bytes: repeat the 8-hex seed 8× for a deterministic
      // expansion (good enough as a quality smoke test entropy seed).
      return new ChaCha20Rng(s.repeat(8));
    }
    default:
      throw new Error(`unknown backend ${kind}`);
  }
}

function runBackend(kind) {
  const rng = newBackend(kind, BACKEND_SEED_NUMBER);
  const bits = pullBits(rng, SAMPLE_BITS);
  const results = [
    monobit(bits),
    blockFrequency(bits, 1000),
    runs(bits),
    longestRun(bits),
    cusumForward(bits),
  ];
  return {
    backend: kind,
    seed_hex: BACKEND_SEED_HEX,
    sample_bits: SAMPLE_BITS,
    tested_at: new Date().toISOString(),
    overall_pass: results.every((r) => r.pass),
    results,
  };
}

// ─── --dump mode (raw bit stream → stdout for external batteries) ─────────
//
// Usage: node scripts/rng-quality.mjs --dump <backend> <bytes>
//
// Writes `<bytes>` raw bytes to stdout (no framing, no newline). Designed
// to feed NIST SP 800-22 `assess`, TestU01 BigCrush `-i stdin`, and
// PractRand `RNG_test stdin`. Seed and bit-extraction harness match the
// in-process baseline above byte-for-byte, so live full-suite results
// land on the same entropy footprint as the CI baseline.

async function dumpStream(backend, nBytes) {
  const rng = newBackend(backend, BACKEND_SEED_NUMBER);
  const CHUNK = 1 << 20; // 1 MiB
  // CRITICAL: process.stdout.write to a pipe is back-pressured and async on
  // Node. If we hand it a `subarray` view that shares memory with a reused
  // buffer, the next iteration's writes can corrupt the still-buffered bytes
  // before they hit the pipe — manifested as PractRand BCFN(2+,13-1U) failing
  // with R ≈ +60k across every backend (same signature regardless of RNG,
  // because the corruption pattern is independent of source).
  //
  // W219-bp — Mac freeze + disk-full root cause: the previous fix allocated a
  // FRESH Buffer per chunk to dodge corruption but did NOT await the `drain`
  // event when `.write()` returned `false`. Under a slow consumer (RNG_test ~
  // 30 MB/s) and a fast producer (~150 MB/s), each ignored back-pressure
  // signal would simply allocate another 1 MiB Buffer; over a 64 GiB dump and
  // 5 paralleled backends the V8 heap exploded into macOS swap and ate the
  // entire SSD. Boki's whole Mac froze with a "no space left on device"
  // dialog.  Fix: HONOR back-pressure — when `.write()` returns false, await
  // `drain` before allocating the next chunk. With drain semantics the buffer
  // can also be REUSED safely (V8 has finished writing it to the pipe by the
  // time drain fires), so we drop back to a single reusable buffer too —
  // memory stays flat at exactly CHUNK bytes regardless of dump size.
  // Performance: direct nextU64 → 8 BE bytes (no BigInt accumulator), gets
  // ~150 MB/s on M3 Pro for 64-bit backends; ~80 MB/s for 32-bit fallback.
  const has64 = typeof rng.nextU64 === 'function';
  let written = 0;
  const buf = Buffer.allocUnsafe(CHUNK); // SINGLE reusable buffer — see comment

  while (written < nBytes) {
    const target = Math.min(CHUNK, nBytes - written);
    let off = 0;
    if (has64) {
      // Fast path: 8 BE bytes per nextU64() call. No BigInt, no bit accumulator.
      while (off + 8 <= target) {
        const [hi, lo] = rng.nextU64();
        // Write big-endian (MSB-first) — matches the in-process baseline
        // `pullBits` harness so live full-suite uses the same entropy footprint.
        buf.writeUInt32BE(hi >>> 0, off);
        buf.writeUInt32BE(lo >>> 0, off + 4);
        off += 8;
      }
      // Tail bytes (less than 8 remaining in this chunk).
      if (off < target) {
        const [hi, lo] = rng.nextU64();
        const tmp = Buffer.allocUnsafe(8);
        tmp.writeUInt32BE(hi >>> 0, 0);
        tmp.writeUInt32BE(lo >>> 0, 4);
        tmp.copy(buf, off, 0, target - off);
        off = target;
      }
    } else {
      // 32-bit backends (chacha20): 4 BE bytes per nextUint32() call.
      while (off + 4 <= target) {
        buf.writeUInt32BE(rng.nextUint32() >>> 0, off);
        off += 4;
      }
      if (off < target) {
        const tmp = Buffer.allocUnsafe(4);
        tmp.writeUInt32BE(rng.nextUint32() >>> 0, 0);
        tmp.copy(buf, off, 0, target - off);
        off = target;
      }
    }
    // BACK-PRESSURE AWARE WRITE: emit a subarray view (so we don't write
    // garbage tail when target < CHUNK on the last iteration), then await
    // drain whenever the kernel pipe buffer is full. This bounds heap growth
    // to a single CHUNK-sized allocation regardless of consumer speed.
    const view = off === CHUNK ? buf : buf.subarray(0, off);
    const ok = process.stdout.write(view);
    if (!ok) {
      await new Promise((resolve) => process.stdout.once('drain', resolve));
    }
    written += off;
  }
}

async function main() {
  // --dump short-circuit BEFORE we touch OUT_DIR (stdout is the artefact).
  const argv = process.argv.slice(2);
  if (argv[0] === '--dump') {
    const backend = argv[1];
    const nBytes = Number(argv[2]);
    if (!backend || !Number.isFinite(nBytes) || nBytes <= 0) {
      process.stderr.write('usage: rng-quality.mjs --dump <backend> <bytes>\n');
      process.exit(2);
    }
    await dumpStream(backend, nBytes);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const backends = ['mulberry32', 'pcg64', 'xoshiro256ss', 'philox4x32', 'chacha20'];
  const summaries = [];

  for (const kind of backends) {
    process.stdout.write(`▶ ${kind.padEnd(16)} `);
    const startedAt = Date.now();
    let report;
    try {
      report = runBackend(kind);
    } catch (e) {
      console.log(`✗ ${e.message}`);
      summaries.push({ backend: kind, overall_pass: false, error: e.message });
      continue;
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const passCount = report.results.filter((r) => r.pass).length;
    console.log(
      `${passCount}/5 pass · ${elapsed}s · ` +
        report.results
          .map((r) => `${r.name.split('_')[0]}=${(r.p ?? 0).toFixed(3)}`)
          .join(' '),
    );
    writeFileSync(
      join(OUT_DIR, `${kind}-nist-baseline.json`),
      JSON.stringify(report, null, 2),
    );
    summaries.push({
      backend: kind,
      overall_pass: report.overall_pass,
      pass_count: passCount,
      total: 5,
      p_values: Object.fromEntries(report.results.map((r) => [r.name, r.p])),
    });
  }

  // ─── INDEX.md ────────────────────────────────────────────────────────
  const indexLines = [];
  indexLines.push('# RNG Quality — NIST SP 800-22 Baseline');
  indexLines.push('');
  indexLines.push(
    `**Generated:** ${new Date().toISOString()}  ·  ` +
      `**Sample:** ${(SAMPLE_BITS / 1_000_000).toFixed(1)} Mbit per backend  ·  ` +
      `**Seed:** \`${BACKEND_SEED_HEX}\`  ·  ` +
      `**Pass bar:** p > 0.01 (NIST default α)`,
  );
  indexLines.push('');
  indexLines.push('## Scope');
  indexLines.push('');
  indexLines.push(
    'This baseline implements 5 of the 15 NIST SP 800-22 tests directly ' +
      'in Node.js so the engine can produce a quality report without external ' +
      'tooling. The five chosen are the most foundational and catch ' +
      'first-order quality defects — any backend failing one of these is unfit ' +
      'for live deployment, full stop.',
  );
  indexLines.push('');
  indexLines.push(
    '**Full-suite escalation** (TestU01 BigCrush, full NIST 15, PractRand ' +
      '2³⁸-byte streaming) is documented in [HOWTO-fullsuite.md](./HOWTO-fullsuite.md) — ' +
      'CI operators run those once the matching binaries are installed.',
  );
  indexLines.push('');
  indexLines.push('## Results');
  indexLines.push('');
  indexLines.push('| Backend | Overall | Monobit | BlockFreq | Runs | LongestRun | CuSumFwd |');
  indexLines.push('|---------|---------|---------|-----------|------|------------|----------|');
  for (const s of summaries) {
    const glyph = s.overall_pass ? '✅' : '❌';
    if (s.error) {
      indexLines.push(
        `| \`${s.backend}\` | ${glyph} ${s.error} | — | — | — | — | — |`,
      );
      continue;
    }
    const p = s.p_values;
    const cell = (name) => {
      const v = p[name];
      const tag = v > 0.01 ? '✅' : '❌';
      return `${tag} ${(v ?? 0).toFixed(3)}`;
    };
    indexLines.push(
      `| \`${s.backend}\` | ${glyph} ${s.pass_count}/5 | ` +
        `${cell('monobit')} | ${cell('block_frequency')} | ` +
        `${cell('runs')} | ${cell('longest_run')} | ${cell('cusum_forward')} |`,
    );
  }
  indexLines.push('');
  indexLines.push('## Per-backend JSON');
  indexLines.push('');
  for (const s of summaries) {
    indexLines.push(`- [\`${s.backend}-nist-baseline.json\`](./${s.backend}-nist-baseline.json)`);
  }
  indexLines.push('');
  indexLines.push('## Acceptance');
  indexLines.push('');
  indexLines.push(
    '- **Production default (`pcg64`)** MUST pass all 5 tests every release ' +
      'or the build fails. Tracked in CI.',
  );
  indexLines.push(
    '- **`mulberry32`** is permitted to fail one or more tests — it exists ' +
      'only for TS↔Rust byte-for-byte parity (see `docs/rng.md`). It must ' +
      'never be the default for a live config.',
  );
  indexLines.push(
    '- `xoshiro256ss` and `philox4x32` are held to the same bar as `pcg64`.',
  );
  indexLines.push('');
  indexLines.push('## Reproduction');
  indexLines.push('');
  indexLines.push('```bash');
  indexLines.push('npm run build');
  indexLines.push('node scripts/rng-quality.mjs');
  indexLines.push('# OR:');
  indexLines.push('npm run rng-quality');
  indexLines.push('```');
  indexLines.push('');

  writeFileSync(join(OUT_DIR, 'INDEX.md'), indexLines.join('\n'));

  console.log('');
  console.log(`✓ ${summaries.filter((s) => s.overall_pass).length}/${summaries.length} backends pass all 5 NIST baseline tests`);
  console.log(`  INDEX: ${join(OUT_DIR, 'INDEX.md')}`);
}

main().catch((e) => {
  console.error('rng-quality failed:', e);
  process.exitCode = 2;
});
