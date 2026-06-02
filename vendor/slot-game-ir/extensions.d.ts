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
export declare const HitProbabilityRowZ: z.ZodObject<{
    symbolId: z.ZodString;
    count: z.ZodNumber;
    payout: z.ZodNumber;
    hitProbability: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type HitProbabilityRow = z.infer<typeof HitProbabilityRowZ>;
/** Validate an array of hit-probability rows. */
export declare function parseHitProbabilityRows(input: unknown): HitProbabilityRow[];
export declare const RtpBandZ: z.ZodObject<{
    minBet: z.ZodNumber;
    maxBet: z.ZodNumber;
    minRtp: z.ZodNumber;
    maxRtp: z.ZodNumber;
    minSingleRtp: z.ZodOptional<z.ZodNumber>;
    maxSingleRtp: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const VolatilityPointZ: z.ZodObject<{
    bet: z.ZodNumber;
    expectedSigma: z.ZodNumber;
}, z.core.$strict>;
export declare const RtpBandsBundleZ: z.ZodObject<{
    bands: z.ZodArray<z.ZodObject<{
        minBet: z.ZodNumber;
        maxBet: z.ZodNumber;
        minRtp: z.ZodNumber;
        maxRtp: z.ZodNumber;
        minSingleRtp: z.ZodOptional<z.ZodNumber>;
        maxSingleRtp: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    volatilityCurve: z.ZodOptional<z.ZodArray<z.ZodObject<{
        bet: z.ZodNumber;
        expectedSigma: z.ZodNumber;
    }, z.core.$strict>>>;
}, z.core.$strict>;
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
export declare function validateMonotonicCoverage(bands: RtpBand[], epsilon?: number): RtpBand[];
/** O(log N) bet → band lookup. Returns null if bet is out of range. */
export declare function getRtpBandForBet(bands: RtpBand[], bet: number): RtpBand | null;
export declare const WinCapModeZ: z.ZodEnum<{
    inclusive: "inclusive";
    strict: "strict";
    soft: "soft";
}>;
export declare const WinCapEntryZ: z.ZodObject<{
    capX: z.ZodNumber;
    mode: z.ZodEnum<{
        inclusive: "inclusive";
        strict: "strict";
        soft: "soft";
    }>;
}, z.core.$strict>;
export declare const WinCapPerCurrencyZ: z.ZodRecord<z.ZodString, z.ZodObject<{
    capX: z.ZodNumber;
    mode: z.ZodEnum<{
        inclusive: "inclusive";
        strict: "strict";
        soft: "soft";
    }>;
}, z.core.$strict>>;
export type WinCapMode = z.infer<typeof WinCapModeZ>;
export type WinCapEntry = z.infer<typeof WinCapEntryZ>;
export type WinCapPerCurrency = z.infer<typeof WinCapPerCurrencyZ>;
/**
 * Resolve the active win cap for a (currency, default-cap) pair. If the
 * currency has an entry in `caps`, it wins; otherwise fallback to
 * `defaultCapX` with mode `'strict'`. Returns `null` only when neither
 * is provided.
 */
export declare function resolveWinCap(caps: WinCapPerCurrency, currency: string, defaultCapX?: number): WinCapEntry | null;
export declare const PaylineLadderRungZ: z.ZodObject<{
    paylines: z.ZodNumber;
    allowedBets: z.ZodArray<z.ZodNumber>;
}, z.core.$strict>;
export declare const PaylineLadderZ: z.ZodArray<z.ZodObject<{
    paylines: z.ZodNumber;
    allowedBets: z.ZodArray<z.ZodNumber>;
}, z.core.$strict>>;
export type PaylineLadderRung = z.infer<typeof PaylineLadderRungZ>;
export type PaylineLadder = z.infer<typeof PaylineLadderZ>;
/**
 * Returns the rung whose `paylines` matches `requestedPaylines`, or `null`.
 */
export declare function getLadderRung(ladder: PaylineLadder, requestedPaylines: number): PaylineLadderRung | null;
/**
 * Verify that a (paylines, bet) pair is allowed by the ladder. Returns
 * `{ ok: true }` on success, `{ ok: false, reason }` describing why.
 */
export declare function checkLadderCompliance(ladder: PaylineLadder, paylines: number, bet: number): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare const JackpotBetBandOddsZ: z.ZodObject<{
    minBet: z.ZodNumber;
    maxBet: z.ZodNumber;
    oddsX: z.ZodNumber;
}, z.core.$strict>;
export declare const JackpotOddsByBetBandZ: z.ZodObject<{
    tierId: z.ZodString;
    bands: z.ZodArray<z.ZodObject<{
        minBet: z.ZodNumber;
        maxBet: z.ZodNumber;
        oddsX: z.ZodNumber;
    }, z.core.$strict>>;
    resetRtp: z.ZodOptional<z.ZodNumber>;
    rtpSamples: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
}, z.core.$strict>;
export type JackpotBetBandOdds = z.infer<typeof JackpotBetBandOddsZ>;
export type JackpotOddsByBetBand = z.infer<typeof JackpotOddsByBetBandZ>;
/** Per-spin hit probability for a (tier, bet) pair. Returns 0 if out of range. */
export declare function jackpotHitProbabilityForBet(tier: JackpotOddsByBetBand, bet: number): number;
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
export declare const EngineKindZ: z.ZodEnum<{
    standard: "standard";
    independent: "independent";
    stepper: "stepper";
    pyramid: "pyramid";
    tumbling: "tumbling";
}>;
export type EngineKind = z.infer<typeof EngineKindZ>;
export declare const ReelSetVariantZ: z.ZodObject<{
    variantId: z.ZodString;
    weight: z.ZodNumber;
}, z.core.$strict>;
export declare const ReelSetSelectorZ: z.ZodObject<{
    variants: z.ZodArray<z.ZodObject<{
        variantId: z.ZodString;
        weight: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ReelSetVariant = z.infer<typeof ReelSetVariantZ>;
export type ReelSetSelector = z.infer<typeof ReelSetSelectorZ>;
/**
 * Pick a variant id given a uniform [0, 1) draw. Deterministic and
 * pure — caller supplies the random source. Use for replay parity.
 *
 * Throws if `selector.variants` is empty (Zod prevents construction
 * but defensive guard for hand-rolled callers).
 */
export declare function pickReelSetVariant(selector: ReelSetSelector, uniform01: number): string;
/**
 * Recursive JSON value type — anything `JSON.stringify` accepts.
 * Operators can stash custom fields here without bumping the IR
 * schema version. Validators NEVER reject unknown keys inside extras,
 * but DO refuse non-JSON values (functions, undefined, NaN, Infinity).
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export declare const ExtrasBagZ: z.ZodRecord<z.ZodString, z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
export type ExtrasBag = z.infer<typeof ExtrasBagZ>;
/**
 * Type-guarded reader for a string-keyed extras path. Returns `null`
 * if the key is missing. Operator can layer their own type assertion
 * on top — extras are inherently untyped.
 */
export declare function getExtra(bag: ExtrasBag, key: string): JsonValue | null;
/**
 * Single-call validator for an entire extension bundle. Convenient when
 * an operator stores all extensions under a top-level `extensions` key
 * in their config JSON.
 */
export declare const ExtensionsBundleZ: z.ZodObject<{
    hitProbabilityRows: z.ZodOptional<z.ZodArray<z.ZodObject<{
        symbolId: z.ZodString;
        count: z.ZodNumber;
        payout: z.ZodNumber;
        hitProbability: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    rtpBands: z.ZodOptional<z.ZodObject<{
        bands: z.ZodArray<z.ZodObject<{
            minBet: z.ZodNumber;
            maxBet: z.ZodNumber;
            minRtp: z.ZodNumber;
            maxRtp: z.ZodNumber;
            minSingleRtp: z.ZodOptional<z.ZodNumber>;
            maxSingleRtp: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        volatilityCurve: z.ZodOptional<z.ZodArray<z.ZodObject<{
            bet: z.ZodNumber;
            expectedSigma: z.ZodNumber;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    winCapPerCurrency: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        capX: z.ZodNumber;
        mode: z.ZodEnum<{
            inclusive: "inclusive";
            strict: "strict";
            soft: "soft";
        }>;
    }, z.core.$strict>>>;
    paylineLadder: z.ZodOptional<z.ZodArray<z.ZodObject<{
        paylines: z.ZodNumber;
        allowedBets: z.ZodArray<z.ZodNumber>;
    }, z.core.$strict>>>;
    jackpotOdds: z.ZodOptional<z.ZodArray<z.ZodObject<{
        tierId: z.ZodString;
        bands: z.ZodArray<z.ZodObject<{
            minBet: z.ZodNumber;
            maxBet: z.ZodNumber;
            oddsX: z.ZodNumber;
        }, z.core.$strict>>;
        resetRtp: z.ZodOptional<z.ZodNumber>;
        rtpSamples: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strict>>>;
    engineKind: z.ZodOptional<z.ZodEnum<{
        standard: "standard";
        independent: "independent";
        stepper: "stepper";
        pyramid: "pyramid";
        tumbling: "tumbling";
    }>>;
    reelSetSelector: z.ZodOptional<z.ZodObject<{
        variants: z.ZodArray<z.ZodObject<{
            variantId: z.ZodString;
            weight: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    extras: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>>;
}, z.core.$strict>;
export type ExtensionsBundle = z.infer<typeof ExtensionsBundleZ>;
/**
 * Parse + cross-validate. Throws on schema violation; returns a typed
 * bundle on success. `monotonicCoverage` is enforced for `rtpBands` if
 * present.
 */
export declare function parseExtensions(input: unknown): ExtensionsBundle;
//# sourceMappingURL=extensions.d.ts.map