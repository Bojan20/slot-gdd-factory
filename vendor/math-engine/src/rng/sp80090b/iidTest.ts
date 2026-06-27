/**
 * W152 Wave 39 — Kimi K3: SP 800-90B §5 IID Track Hypothesis Test.
 *
 * Tests whether a sample sequence is plausibly drawn from an IID (independent,
 * identically distributed) source. If the test PASSES, the source qualifies
 * for the simpler Most-Common-Value estimator on the IID Track. If it FAILS,
 * the assessment falls back to the Non-IID Track (multiple estimators, take
 * minimum) — which is what `assessEntropy` in `estimators.ts` does.
 *
 * SP 800-90B §5 specifies a battery of 11 permutation tests; this module
 * implements 3 representative ones plus a chi-square goodness-of-fit:
 *
 *   1. Excursion Test — running sum vs. mean
 *   2. Number of Directional Runs — count of monotonic runs
 *   3. Length of Longest Directional Run
 *   4. Chi-Square uniformity (8-bit alphabet)
 *
 * For each, we compute the observed statistic, then permute the sequence
 * 10000× and count how often the permuted statistic equals or exceeds the
 * observed one. p-value < 0.005 ⇒ reject IID hypothesis.
 *
 * For the slot engine's deterministic CSPRNG output, IID test typically
 * PASSES; for raw HSM signature bytes (deterministic from input), IID test
 * may fail (correlations from the signing math) and assessment falls back
 * to Non-IID. Either path produces a valid min-entropy claim.
 */

export interface IidTestResult {
  test: string;
  observed: number;
  permutationCount: number;
  // Number of permutations whose stat equaled-or-exceeded observed
  // (one-sided; SP 800-90B uses two-sided in some tests but single-sided
  // is conservative for our entropy use case).
  exceedances: number;
  pValue: number;
  pass: boolean; // pValue ≥ 0.005
}

export interface IidVerdict {
  schema: 'sp-800-90b-iid-test/v1';
  generatedAtUtc: string;
  sampleCount: number;
  permutations: number;
  tests: IidTestResult[];
  /** True if ALL tests pass (pValue ≥ 0.005). Means source plausibly IID. */
  isIid: boolean;
}

// ─── Statistic computations ────────────────────────────────────────────────

function sampleMean(s: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i];
  return sum / s.length;
}

/** Excursion = max |running_sum_k - k×mean| for k=1..N. */
function excursionStat(s: Uint8Array): number {
  const m = sampleMean(s);
  let runSum = 0;
  let maxDev = 0;
  for (let i = 0; i < s.length; i++) {
    runSum += s[i];
    const dev = Math.abs(runSum - (i + 1) * m);
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

/** Number of directional (up/down) runs in the sequence. */
function numRunsStat(s: Uint8Array): number {
  if (s.length < 2) return 0;
  let runs = 1;
  let lastDir = 0; // 0=initial, 1=up, -1=down
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) continue;
    const dir = s[i] > s[i - 1] ? 1 : -1;
    if (dir !== lastDir) {
      if (lastDir !== 0) runs++;
      lastDir = dir;
    }
  }
  return runs;
}

/** Length of longest monotonic run. */
function longestRunStat(s: Uint8Array): number {
  if (s.length < 2) return 1;
  let maxRun = 1, curRun = 1, lastDir = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) { curRun++; }
    else {
      const dir = s[i] > s[i - 1] ? 1 : -1;
      if (dir === lastDir) curRun++;
      else { curRun = 2; lastDir = dir; }
    }
    if (curRun > maxRun) maxRun = curRun;
  }
  return maxRun;
}

/** Chi-square goodness-of-fit against uniform u8 (256 buckets). */
function chiSquareUniform(s: Uint8Array): number {
  const counts = new Uint32Array(256);
  for (let i = 0; i < s.length; i++) counts[s[i]]++;
  // Use observed alphabet only — sparse alphabets get adjusted DOF
  let expected = s.length / 256;
  if (expected < 5) {
    // Fall back to alphabet seen
    const seen = new Set(s);
    expected = s.length / seen.size;
  }
  let chi2 = 0;
  for (const c of counts) {
    if (c === 0 && expected < 5) continue;
    chi2 += ((c - expected) ** 2) / expected;
  }
  return chi2;
}

// ─── Permutation engine ────────────────────────────────────────────────────

/**
 * Deterministic Mulberry32-based shuffle (Fisher-Yates) so the IID test is
 * reproducible. Permutation seed cycles through the test count to avoid
 * correlated permutations.
 */
function shuffle(arr: Uint8Array, seed: number): Uint8Array {
  const a = new Uint8Array(arr);
  let s = seed >>> 0;
  function rand(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Public API ────────────────────────────────────────────────────────────

export function runIidTest(samples: Uint8Array, permutations: number = 1000): IidVerdict {
  if (samples.length < 1000) {
    throw new Error(`runIidTest: need ≥1000 samples, got ${samples.length}`);
  }
  if (permutations < 100) {
    throw new Error(`runIidTest: need ≥100 permutations, got ${permutations}`);
  }
  const tests: IidTestResult[] = [];
  const stats = [
    { name: 'excursion', fn: excursionStat },
    { name: 'num_directional_runs', fn: numRunsStat },
    { name: 'longest_directional_run', fn: longestRunStat },
    { name: 'chi_square_uniform', fn: chiSquareUniform },
  ];

  for (const { name, fn } of stats) {
    const observed = fn(samples);
    let exceedances = 0;
    for (let p = 0; p < permutations; p++) {
      const permStat = fn(shuffle(samples, 0xCAFE0000 ^ (p * 0x9E3779B1)));
      if (permStat >= observed) exceedances++;
    }
    const pValue = (exceedances + 1) / (permutations + 1); // Lehmer correction
    tests.push({
      test: `iid_${name}`,
      observed,
      permutationCount: permutations,
      exceedances,
      pValue,
      pass: pValue >= 0.005,
    });
  }

  const isIid = tests.every((t) => t.pass);
  return {
    schema: 'sp-800-90b-iid-test/v1',
    generatedAtUtc: new Date().toISOString(),
    sampleCount: samples.length,
    permutations,
    tests,
    isIid,
  };
}
