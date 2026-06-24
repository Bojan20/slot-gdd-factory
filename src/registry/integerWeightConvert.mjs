/**
 * src/registry/integerWeightConvert.mjs
 *
 * UQ-DEEP-AG · IGT-grade integer-weight conversion (Boki 2026-06-24).
 *
 * IGT math server (GLE) is INTEGER-ONLY. Float probabilities cause:
 *   • Silent rejection by SGS validator (`cmd=113`)
 *   • Rounding drift in stop-distribution sampler (±0.05% RTP)
 *   • Non-reproducible runs across architectures
 *
 * IGT contract (`IGT_SLOT_GAME_SETTINGS_CONTRACT.md` §4.8 + P2.1):
 *   Per-element scale by 10^k where k = max(decimals across all elements).
 *   Decimal count via Number.toString() (preserves "1e-7" scientific notation
 *   footgun — IGT QA tools rely on this exact quirk).
 *
 * Vendor-neutral implementation — no IGT symbol references in output, only
 * the math contract.
 */

/* IGT-equivalent of `getDecimalsCountForNumber(n)`. JavaScript toString()
 * may yield "0.0000001" for 1e-7 or "1e-7" depending on magnitude. IGT
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
 * UQ-DEEP-AG · IGT `convertToServerValues(arr)` byte-equivalent.
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
