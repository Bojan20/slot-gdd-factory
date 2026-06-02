/**
 * Slot Game IR — public entry point.
 *
 * Three things callers want:
 *   1. Strong static types (re-exported from `./types.js`).
 *   2. Runtime parse / validate (`parseGameIR` — Zod under the hood).
 *   3. Semantic checks that go beyond shape (e.g. "every paytable symbol
 *      exists in `symbols[]`", "every reel weight key is a real symbol")
 *      — `crossValidate`, layered on top of Zod parsing.
 *
 * The two-stage design (Zod first, semantic second) means error messages
 * stay precise: a typo in `paytable["S_WLD"]` doesn't fail with "schema
 * mismatch", it fails with "unknown symbol id 'S_WLD' in paytable
 * (did you mean 'S_WILD'?)".
 */
import type { Feature, ReelSet, SlotGameIR } from './types.js';
export * from './types.js';
export { SlotGameIRZ, MetaZ, TopologyZ, SymbolZ, ReelSetZ, EvaluationZ, FeatureZ, RngZ, BetZ, LimitsZ, ComplianceZ, RtpAllocationZ, PaytableZ, } from './schema.js';
/** A cross-validation finding. `path` is JSON-Pointer-ish. */
export interface IRValidationIssue {
    path: string;
    message: string;
}
export interface IRParseSuccess {
    ok: true;
    ir: SlotGameIR;
    unknown_keys: string[];
    warnings: IRValidationIssue[];
}
export interface IRParseFailure {
    ok: false;
    issues: IRValidationIssue[];
}
export type IRParseResult = IRParseSuccess | IRParseFailure;
/**
 * Parse + validate a raw unknown blob into a `SlotGameIR`. Never throws
 * for malformed input — returns a structured failure instead.
 *
 * Stage 1 — Zod parses shape. Stage 2 — semantic cross-checks (symbol
 * references, paytable coverage, evaluation/paytable shape compat,
 * RTP allocation sum, topology↔evaluation coherence).
 */
export declare function parseGameIR(input: unknown): IRParseResult;
/**
 * Semantic validator — run *after* Zod accepts the shape. Surfaces
 * issues Zod cannot encode in pure types: cross-field constraints,
 * referential integrity, topology↔eval coherence, paytable coverage.
 */
export declare function crossValidate(ir: SlotGameIR): {
    errors: IRValidationIssue[];
    warnings: IRValidationIssue[];
};
/** Re-export Feature / ReelSet for consumers writing transformations. */
export type { Feature, ReelSet };
//# sourceMappingURL=index.d.ts.map