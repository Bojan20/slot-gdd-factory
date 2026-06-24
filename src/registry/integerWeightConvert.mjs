/**
 * src/registry/integerWeightConvert.mjs
 *
 * UQ-DEEP-AG · industry-grade integer-weight conversion (Boki 2026-06-24).
 * UQ-DEEP-AL · FIX-C · per-element scaling (byte-exact wire equivalence).
 *
 * industry math server (GLE) is INTEGER-ONLY. Float probabilities cause:
 *   • Silent rejection by SGS validator (`cmd=113`)
 *   • Rounding drift in stop-distribution sampler (±0.05% RTP)
 *   • Non-reproducible runs across architectures
 *
 * industry contract (`industry-settings-contract.md` §4.8 + P2.1):
 *   PER-ELEMENT scale by 10^k where k = decimals(element_i) — every value gets
 *   its OWN 10^k factor (canonical wire form). The legacy array-wide variant
 *   (single global 10^max(k) scale) is mathematically equivalent but produces
 *   a different byte sequence on the wire — preserved for back-compat only.
 *
 *   Decimal count via Number.toString() (preserves "1e-7" scientific notation
 *   footgun — industry QA tools rely on this exact quirk for byte-exact mode).
 *
 * Vendor-neutral implementation — no symbol references in output, only
 * the math contract.
 *
 * ── Public surface ─────────────────────────────────────────────────────
 *   convertToServerValuesPerElement(arr)            ★ canonical (IGT-spec)
 *   restoreFloatsFromServerValuesPerElement(v, s)   ★ inverse of above
 *   getDecimalsCountForNumberIgtCompat(n)           ★ opt-in bug-compat
 *   convertToServerValues(arr)            (legacy, @deprecated array-wide)
 *   restoreFloatsFromServerValues(srv)    (legacy inverse)
 *   getDecimalsCountForNumber(n)          (correct-mode decimal counter)
 *   maxDecimalsInArray(arr)               (helper, used by legacy path)
 */

/* wire-equivalent of `getDecimalsCountForNumber(n)`. JavaScript toString()
 * may yield "0.0000001" for 1e-7 or "1e-7" depending on magnitude. industry standard
 * QA accepts both via this branch logic — we reproduce it byte-for-byte. */
export function getDecimalsCountForNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n === 0) return 0;
  if (Number.isInteger(n)) return 0;
  const s = n.toString();
  /* Scientific notation: "1.234e-7" → decimals = mantissa_decimals + exponent_abs */
  const sciMatch = s.match(/^-?(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (sciMatch) {
    const mantissaDec = sciMatch[2] ? sciMatch[2].length : 0;
    const exp = parseInt(sciMatch[3], 10);
    return Math.max(0, mantissaDec - exp);   /* exp negative → adds to decimals */
  }
  /* Regular fixed notation. */
  const dotIdx = s.indexOf('.');
  if (dotIdx < 0) return 0;
  return s.length - dotIdx - 1;
}

/**
 * UQ-DEEP-AL · IGT bug-compat decimal counter (opt-in).
 *
 * IGT's reference implementation does `n.toString().split('.')` and counts
 * the second segment length — this gives 0 decimals for any number that
 * JavaScript serializes in scientific notation (1e-7 → "1e-7" → no dot → 0).
 *
 * That is INCORRECT math (1e-7 has 7 decimals of precision) but it is the
 * byte-exact behavior of the industry QA tool. Use this variant ONLY when
 * you need wire-level reproducibility with a server that mirrors the quirk.
 *
 * Default codebase path uses `getDecimalsCountForNumber` (correct mode).
 */
export function getDecimalsCountForNumberIgtCompat(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n === 0) return 0;
  if (Number.isInteger(n)) return 0;
  const s = n.toString();
  const dotIdx = s.indexOf('.');
  if (dotIdx < 0) return 0;                  /* scientific notation → bug-compat 0 */
  /* Strip any trailing scientific exponent if present after the dot (rare). */
  const tail = s.slice(dotIdx + 1);
  const eIdx = tail.search(/[eE]/);
  return eIdx < 0 ? tail.length : eIdx;
}

/* Returns the maximum decimal count across an array of numbers — used to
 * compute the global 10^k scale factor for the array's integer conversion. */
export function maxDecimalsInArray(arr) {
  if (!Array.isArray(arr)) return 0;
  let max = 0;
  for (const v of arr) {
    const d = getDecimalsCountForNumber(v);
    if (d > max) max = d;
  }
  return max;
}

/**
 * UQ-DEEP-AL · FIX-C · canonical IGT per-element integer conversion.
 *
 * For each float `v[i]`, compute its OWN scale `10^decimals(v[i])` and emit
 * `value[i] = round(v[i] * scale[i])`. This is the byte-exact wire form
 * required by the IGT_SLOT_GAME_SETTINGS_CONTRACT.md §P2.1.
 *
 * Example (IGT canonical):
 *   convertToServerValuesPerElement([33.33, 0.5])
 *     → { values: [3333, 5], scales: [100, 10], schemaVersion: '1' }
 *
 * Contrast with legacy `convertToServerValues` (single array-wide scale):
 *   convertToServerValues([33.33, 0.5])
 *     → { values: [3333, 50], scale: 100, max_decimals: 2 }
 *
 * Both are mathematically equivalent after restore, but only the per-element
 * form matches the IGT wire byte sequence and avoids 25bps RTP drift in the
 * canonical SGS validator.
 *
 * Edge cases:
 *   - empty input → { values: [], scales: [], schemaVersion: '1' }
 *   - all integers → values=input copy, scales=[1, 1, …]
 *   - mixed mag.   → each element scaled independently (no precision loss)
 *   - negatives    → preserved via Math.round (banker-safe for our domain)
 *   - non-finite   → coerced to 0 with scale 1 (defensive)
 */
export function convertToServerValuesPerElement(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return { values: [], scales: [], schemaVersion: '1' };
  }
  const values = new Array(arr.length);
  const scales = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      values[i] = 0;
      scales[i] = 1;
      continue;
    }
    const d = getDecimalsCountForNumber(v);
    const s = Math.pow(10, d);
    scales[i] = s;
    /* Math.round avoids 0.1 * 10 = 1.0000000000000002 IEEE-754 drift. */
    values[i] = Math.round(v * s);
  }
  return { values, scales, schemaVersion: '1' };
}

/**
 * UQ-DEEP-AL · FIX-C · inverse of `convertToServerValuesPerElement`.
 *
 * Accepts two parallel arrays. Returns `value[i] / scales[i]` per element.
 * Byte-symmetric within IEEE-754 ulp for the original float input.
 *
 * Defensive: missing/zero scale → divides by 1 (returns the integer).
 */
export function restoreFloatsFromServerValuesPerElement(values, scales) {
  if (!Array.isArray(values)) return [];
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const s = Array.isArray(scales) && scales[i] > 0 ? scales[i] : 1;
    out[i] = values[i] / s;
  }
  return out;
}

/**
 * @deprecated UQ-DEEP-AL · FIX-C · prefer `convertToServerValuesPerElement`
 * for IGT byte-exact wire output. This array-wide variant is preserved for
 * back-compat with `tools/sgs-compiler.mjs` and legacy callers; values are
 * mathematically equivalent but the wire bytes differ from the IGT canonical
 * form (single global 10^max scale vs per-element 10^k).
 *
 * For an array of floats (probabilities/weights), find the maximum decimal
 * count and multiply every element by 10^maxDecimals to get an integer
 * array. Returns { values: int[], scale: int, max_decimals: int }.
 *
 * Example:
 *   convertToServerValues([0.5, 0.25, 0.125])
 *     → { values: [500, 250, 125], scale: 1000, max_decimals: 3 }
 *
 * Edge cases:
 *   - empty input → { values: [], scale: 1, max_decimals: 0 }
 *   - all integers → { values: input copy, scale: 1, max_decimals: 0 }
 *   - mixed scales → preserves max precision (no rounding loss)
 *   - scientific notation → handled via getDecimalsCountForNumber
 */
export function convertToServerValues(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return { values: [], scale: 1, max_decimals: 0 };
  }
  const max = maxDecimalsInArray(arr);
  const scale = Math.pow(10, max);
  const values = arr.map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
    /* Use Math.round to avoid 0.1 * 10 = 1.0000000000000002 IEEE-754 drift. */
    return Math.round(v * scale);
  });
  return { values, scale, max_decimals: max };
}

/**
 * UQ-DEEP-AG · Inverse — used by /converge consumer to re-normalize integer
 * weights into floats for Wilson CI computation. NOT byte-symmetric (small
 * rounding error) but mathematically equivalent within 1ulp.
 */
export function restoreFloatsFromServerValues(serverValues) {
  if (!serverValues || !Array.isArray(serverValues.values)) return [];
  const scale = serverValues.scale > 0 ? serverValues.scale : 1;
  return serverValues.values.map((v) => v / scale);
}
