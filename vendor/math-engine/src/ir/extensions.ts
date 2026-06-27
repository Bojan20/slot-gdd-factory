/**
 * W152 Wave 18 — IR Schema Extensions (Faza 15.A schema primitives).
 *
 * EIGHT opt-in schema primitives that extend the canonical IR without
 * touching `types.ts` / `schema.ts`. The base IR remains stable for the
 * Rust parity gate; consumers that need richer math metadata import
 * extensions individually and validate them separately.
 *
 *   15.A.1  HitProbabilityRow      — per-row probability annotation on a paytable entry
 *   15.A.2  RtpBands               — bet-band-dependent RTP windows + volatility curve
 *   15.A.3  WinCapPerCurrency      — per-currency max-win caps
 *   15.A.4  PaylineLadder          — regulator-compliant payline stepping
 *   15.A.5  JackpotOddsByBetBand   — per-band jackpot hit odds
 *   15.A.8  EngineKindEnum         — explicit reel-engine taxonomy
 *   15.A.9  ReelSetSelector        — weighted reel-set variant selection
 *   15.A.10 ExtrasBag              — ad-hoc forward-compat key/value storage
 *
 * Naming policy: every exported identifier is engine-generic (no IGT,
 * Aristocrat, BTG, NetEnt, or Pragmatic vendor terms). Validators are
 * Zod-based for runtime safety and produce structured error reports
 * suitable for jurisdiction reviewers.
 *
 * Determinism: all parsers are pure — same input → same output → same
 * serialised bytes. Suitable for hash-chain audit envelopes.
 */

import { z } from 'zod';

// ════════════════════════════════════════════════════════════════════════════
// 15.A.1 — Hit-probability row (per-symbol per-count probability annotation)
// ════════════════════════════════════════════════════════════════════════════

export const HitProbabilityRowZ = z
  .object({
    symbolId: z.string().min(1),
    /** Symbol count this row scores (e.g. 3, 4, 5). */
    count: z.number().int().positive(),
    /** Payout multiplier (in stake-multiples). */
    payout: z.number().nonnegative(),
    /**
     * Probability of this exact symbol+count event landing on a single
     * spin. Range [0, 1]. Used by the analytical RTP solver and the
     * rare-win FX trigger logic. Optional — omitted if the operator
     * trusts the simulator's MC estimate over a closed-form annotation.
     */
    hitProbability: z.number().min(0).max(1).optional(),
  })
  .strict();

export type HitProbabilityRow = z.infer<typeof HitProbabilityRowZ>;

/** Validate an array of hit-probability rows. */
export function parseHitProbabilityRows(input: unknown): HitProbabilityRow[] {
  return z.array(HitProbabilityRowZ).parse(input);
}

// ════════════════════════════════════════════════════════════════════════════
// 15.A.2 — RTP bands + volatility curve (bet-dependent RTP windows)
// ════════════════════════════════════════════════════════════════════════════

export const RtpBandZ = z
  .object({
    minBet: z.number().nonnegative(),
    maxBet: z.number().nonnegative(),
    minRtp: z.number().min(0).max(1.5),
    maxRtp: z.number().min(0).max(1.5),
    minSingleRtp: z.number().min(0).max(1.5).optional(),
    maxSingleRtp: z.number().min(0).max(1.5).optional(),
  })
  .strict()
  .refine((b) => b.maxBet >= b.minBet, { message: 'maxBet must be >= minBet' })
  .refine((b) => b.maxRtp >= b.minRtp, { message: 'maxRtp must be >= minRtp' });

export const VolatilityPointZ = z
  .object({
    bet: z.number().nonnegative(),
    expectedSigma: z.number().nonnegative(),
  })
  .strict();

export const RtpBandsBundleZ = z
  .object({
    bands: z.array(RtpBandZ).min(1),
    volatilityCurve: z.array(VolatilityPointZ).optional(),
  })
  .strict();

export type RtpBand = z.infer<typeof RtpBandZ>;
export type VolatilityPoint = z.infer<typeof VolatilityPointZ>;
export type RtpBandsBundle = z.infer<typeof RtpBandsBundleZ>;

/**
 * Validate that an RTP bands array has monotonically non-decreasing
 * bet boundaries AND no gaps / overlaps. Returns the validated array
 * sorted by `minBet` ascending — operator can rely on the result for
 * O(log N) lookup.
 *
 * Throws on overlap (`band[i].maxBet > band[i+1].minBet`) or gap
 * (`band[i+1].minBet - band[i].maxBet > epsilon`).
 */
export function validateMonotonicCoverage(bands: RtpBand[], epsilon = 1e-9): RtpBand[] {
  if (bands.length === 0) {
    throw new Error('validateMonotonicCoverage: empty bands list');
  }
  const sorted = [...bands].sort((a, b) => a.minBet - b.minBet);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.minBet < prev.maxBet - epsilon) {
      throw new Error(
        `validateMonotonicCoverage: overlap between band [${prev.minBet}, ${prev.maxBet}] and [${curr.minBet}, ${curr.maxBet}]`,
      );
    }
    if (curr.minBet > prev.maxBet + epsilon) {
      throw new Error(
        `validateMonotonicCoverage: gap between band [${prev.minBet}, ${prev.maxBet}] and [${curr.minBet}, ${curr.maxBet}]`,
      );
    }
  }
  return sorted;
}

/** O(log N) bet → band lookup. Returns null if bet is out of range. */
export function getRtpBandForBet(bands: RtpBand[], bet: number): RtpBand | null {
  if (!Number.isFinite(bet) || bet < 0) return null;
  let lo = 0;
  let hi = bands.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = bands[mid];
    if (bet < b.minBet) hi = mid - 1;
    else if (bet > b.maxBet) lo = mid + 1;
    else return b;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// 15.A.3 — Win cap per currency
// ════════════════════════════════════════════════════════════════════════════

export const WinCapModeZ = z.enum(['strict', 'inclusive', 'soft']);

export const WinCapEntryZ = z
  .object({
    capX: z.number().positive(),
    mode: WinCapModeZ,
  })
  .strict();

/** ISO 4217 currency code (3-letter). Validated as 3 uppercase chars. */
const CurrencyCodeZ = z.string().regex(/^[A-Z]{3}$/, 'must be ISO 4217 (3 uppercase letters)');

export const WinCapPerCurrencyZ = z.record(CurrencyCodeZ, WinCapEntryZ);

export type WinCapMode = z.infer<typeof WinCapModeZ>;
export type WinCapEntry = z.infer<typeof WinCapEntryZ>;
export type WinCapPerCurrency = z.infer<typeof WinCapPerCurrencyZ>;

/**
 * Resolve the active win cap for a (currency, default-cap) pair. If the
 * currency has an entry in `caps`, it wins; otherwise fallback to
 * `defaultCapX` with mode `'strict'`. Returns `null` only when neither
 * is provided.
 */
export function resolveWinCap(
  caps: WinCapPerCurrency,
  currency: string,
  defaultCapX?: number,
): WinCapEntry | null {
  const direct = caps[currency];
  if (direct !== undefined) return direct;
  if (defaultCapX !== undefined) return { capX: defaultCapX, mode: 'strict' };
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// 15.A.4 — Payline ladder (regulator-stepped payline counts per bet)
// ════════════════════════════════════════════════════════════════════════════

export const PaylineLadderRungZ = z
  .object({
    paylines: z.number().int().positive(),
    allowedBets: z.array(z.number().positive()).min(1),
  })
  .strict();

export const PaylineLadderZ = z.array(PaylineLadderRungZ).min(1);

export type PaylineLadderRung = z.infer<typeof PaylineLadderRungZ>;
export type PaylineLadder = z.infer<typeof PaylineLadderZ>;

/**
 * Returns the rung whose `paylines` matches `requestedPaylines`, or `null`.
 */
export function getLadderRung(ladder: PaylineLadder, requestedPaylines: number): PaylineLadderRung | null {
  return ladder.find((r) => r.paylines === requestedPaylines) ?? null;
}

/**
 * Verify that a (paylines, bet) pair is allowed by the ladder. Returns
 * `{ ok: true }` on success, `{ ok: false, reason }` describing why.
 */
export function checkLadderCompliance(
  ladder: PaylineLadder,
  paylines: number,
  bet: number,
): { ok: true } | { ok: false; reason: string } {
  const rung = getLadderRung(ladder, paylines);
  if (rung === null) {
    return { ok: false, reason: `payline count ${paylines} not in ladder` };
  }
  if (!rung.allowedBets.includes(bet)) {
    return {
      ok: false,
      reason: `bet ${bet} not in allowed list for ${paylines} paylines (allowed: ${rung.allowedBets.join(', ')})`,
    };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// 15.A.5 — Jackpot odds by bet band (per-band hit-rate annotation)
// ════════════════════════════════════════════════════════════════════════════

export const JackpotBetBandOddsZ = z
  .object({
    minBet: z.number().nonnegative(),
    maxBet: z.number().nonnegative(),
    /** Inverse odds — `1 / oddsX` = per-spin hit probability. */
    oddsX: z.number().positive(),
  })
  .strict()
  .refine((b) => b.maxBet >= b.minBet, { message: 'maxBet must be >= minBet' });

export const JackpotOddsByBetBandZ = z
  .object({
    /** Per-tier identifier (free-form string — operator's choice). */
    tierId: z.string().min(1),
    bands: z.array(JackpotBetBandOddsZ).min(1),
    /** RTP contribution at the cycle reset point. */
    resetRtp: z.number().min(0).max(1).optional(),
    /** Sampled RTP measurements over the lifetime cycle. */
    rtpSamples: z.array(z.number().min(0).max(1)).optional(),
  })
  .strict();

export type JackpotBetBandOdds = z.infer<typeof JackpotBetBandOddsZ>;
export type JackpotOddsByBetBand = z.infer<typeof JackpotOddsByBetBandZ>;

/** Per-spin hit probability for a (tier, bet) pair. Returns 0 if out of range. */
export function jackpotHitProbabilityForBet(
  tier: JackpotOddsByBetBand,
  bet: number,
): number {
  for (const b of tier.bands) {
    if (bet >= b.minBet && bet <= b.maxBet) return 1 / b.oddsX;
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════════════
// 15.A.8 — Engine kind enum (explicit reel-engine taxonomy)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Industry-generic taxonomy of reel-engine kinds. None of these are
 * brand-specific — they describe how a spin's symbol grid is realised:
 *
 *   * `standard`    — independent reel strips, full grid replaced per spin.
 *   * `independent` — each reel evaluates independently of others
 *                     (no shared state across reels).
 *   * `stepper`     — discrete-stop mechanical-style reel motion;
 *                     visible "click" between stops.
 *   * `pyramid`     — cone topology where lower reels expose more rows
 *                     than upper reels (or vice versa).
 *   * `tumbling`    — winning symbols removed; remaining symbols fall +
 *                     new symbols enter from above. Recursive cascade.
 */
export const EngineKindZ = z.enum(['standard', 'independent', 'stepper', 'pyramid', 'tumbling']);
export type EngineKind = z.infer<typeof EngineKindZ>;

// ════════════════════════════════════════════════════════════════════════════
// 15.A.9 — Reel-set selector (weighted variant pick per spin)
// ════════════════════════════════════════════════════════════════════════════

export const ReelSetVariantZ = z
  .object({
    variantId: z.string().min(1),
    weight: z.number().positive(),
  })
  .strict();

export const ReelSetSelectorZ = z
  .object({
    variants: z.array(ReelSetVariantZ).min(2),
  })
  .strict();

export type ReelSetVariant = z.infer<typeof ReelSetVariantZ>;
export type ReelSetSelector = z.infer<typeof ReelSetSelectorZ>;

/**
 * Pick a variant id given a uniform [0, 1) draw. Deterministic and
 * pure — caller supplies the random source. Use for replay parity.
 *
 * Throws if `selector.variants` is empty (Zod prevents construction
 * but defensive guard for hand-rolled callers).
 */
export function pickReelSetVariant(selector: ReelSetSelector, uniform01: number): string {
  if (selector.variants.length === 0) {
    throw new Error('pickReelSetVariant: empty variants');
  }
  if (!Number.isFinite(uniform01) || uniform01 < 0 || uniform01 >= 1) {
    throw new RangeError(`pickReelSetVariant: uniform01 must be in [0, 1) (got ${uniform01})`);
  }
  const totalWeight = selector.variants.reduce((s, v) => s + v.weight, 0);
  let target = uniform01 * totalWeight;
  for (const v of selector.variants) {
    target -= v.weight;
    if (target < 0) return v.variantId;
  }
  // Floating-point catch-all — return last variant.
  return selector.variants[selector.variants.length - 1].variantId;
}

// ════════════════════════════════════════════════════════════════════════════
// 15.A.10 — Extras bag (forward-compat ad-hoc storage)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Recursive JSON value type — anything `JSON.stringify` accepts.
 * Operators can stash custom fields here without bumping the IR
 * schema version. Validators NEVER reject unknown keys inside extras,
 * but DO refuse non-JSON values (functions, undefined, NaN, Infinity).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const JsonValueZ: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().refine((n) => Number.isFinite(n), { message: 'must be a finite number' }),
    z.boolean(),
    z.null(),
    z.array(JsonValueZ),
    z.record(z.string(), JsonValueZ),
  ]),
);

export const ExtrasBagZ = z.record(z.string(), JsonValueZ);

export type ExtrasBag = z.infer<typeof ExtrasBagZ>;

/**
 * Type-guarded reader for a string-keyed extras path. Returns `null`
 * if the key is missing. Operator can layer their own type assertion
 * on top — extras are inherently untyped.
 */
export function getExtra(bag: ExtrasBag, key: string): JsonValue | null {
  return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Bundle for cross-extension validation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Single-call validator for an entire extension bundle. Convenient when
 * an operator stores all extensions under a top-level `extensions` key
 * in their config JSON.
 */
export const ExtensionsBundleZ = z
  .object({
    hitProbabilityRows: z.array(HitProbabilityRowZ).optional(),
    rtpBands: RtpBandsBundleZ.optional(),
    winCapPerCurrency: WinCapPerCurrencyZ.optional(),
    paylineLadder: PaylineLadderZ.optional(),
    jackpotOdds: z.array(JackpotOddsByBetBandZ).optional(),
    engineKind: EngineKindZ.optional(),
    reelSetSelector: ReelSetSelectorZ.optional(),
    extras: ExtrasBagZ.optional(),
  })
  .strict();

export type ExtensionsBundle = z.infer<typeof ExtensionsBundleZ>;

/**
 * Parse + cross-validate. Throws on schema violation; returns a typed
 * bundle on success. `monotonicCoverage` is enforced for `rtpBands` if
 * present.
 */
export function parseExtensions(input: unknown): ExtensionsBundle {
  const parsed = ExtensionsBundleZ.parse(input);
  if (parsed.rtpBands) {
    validateMonotonicCoverage(parsed.rtpBands.bands);
  }
  return parsed;
}
