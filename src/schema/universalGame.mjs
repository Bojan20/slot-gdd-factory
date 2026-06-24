/**
 * src/schema/universalGame.mjs
 *
 * MATH-DEEP HYB-1 (2026-06-22) — Universal Game Schema (single source of truth).
 *
 * Purpose
 *   A vendor-neutral Zod schema describing the shape of a parsed slot model.
 *   This is the cross-vendor canonical contract that the parser MUST emit and
 *   that every downstream consumer (math engines, walkers, render, V2-V14
 *   agents, ingest pipelines, par-sheet ingesters) MUST agree to.
 *
 * Why
 *   Before HYB-1 the model.json shape lived implicitly across `src/parser.mjs`,
 *   `tools/v8-assembly-orchestrator.mjs`, `tools/v10-industry-compliance-spec.mjs`,
 *   `tools/v11-deep-industry-spec.mjs`, `tools/v12-deeper-industry-spec.mjs`,
 *   `tools/v14-math-compliance.mjs`, `src/blocks/*`, etc. Adding a field meant
 *   chasing 15+ files. Now every consumer imports this schema; any drift is a
 *   regression caught at parse time.
 *
 * Industry reference
 *   Field names mirror GLI-19/ISO 27001 par sheet schemas. Vendor-specific
 *   add-ons (e.g. Pragmatic "Gates of Olympus 1000" payAnywhere, L&W
 *   "Megaways" reel mechanic) extend the schema via `vendorExtensions`
 *   namespace — they do NOT pollute the canonical shape.
 *
 * Lifecycle
 *   - Parser writes a model object → `UniversalGameSchema.parse(model)`
 *   - Failing parse = SCHEMA REGRESSION (gate fails, parser must fix)
 *   - Walkers/blocks read via `model.field` after parse() succeeded
 *   - HYB-2 LLM fallback uses this schema as the structured output target
 *
 * Performance budget
 *   Zod parse on a 400-field model ≤ 8 ms (acceptable per spin/per render
 *   cycle). Validation is one-shot at ingest, not per frame.
 *
 * HARD RULE #1 (vendor-neutral)
 *   No vendor product name appears in field names or enum literals. Vendor
 *   marks (industry standard/Pragmatic/L&W/Microgaming) only appear in commentary, never
 *   in `.shape` exports. PAR sheet vendor adapters convert into this shape.
 *
 * Public API
 *   - UniversalGameSchema        — full game model schema (top-level)
 *   - TopologySchema             — reels / rows / paylines / kind
 *   - SymbolsSchema              — high / mid / low / specials
 *   - PaytableRowSchema          — single paytable row
 *   - FreeSpinsSchema            — FS trigger / awards / retrigger / multiplier
 *   - HoldAndWinSchema           — H&W feature config (cashPool / fsTrigger)
 *   - JackpotSchema              — jackpot tiers + share + GRAND prob
 *   - ComplianceSchema           — jurisdictions array
 *   - PaybackSchema              — RTP + hit frequency + breakdown
 *   - ParSheetSchema             — par sheet sub-object (reelStrips + paytable)
 *   - validateModel(obj)         — convenience: returns { ok, errors, parsed }
 *
 * GDD keys consumed
 *   Topology (§3.1), Symbols (§3.3), Paytable (§6.2), Bet ladder (§5.5),
 *   FS (§8), H&W (§4.8), Jackpots (§10), Compliance (§14), RTP (§4.2).
 */

import { z } from 'zod';

/* ── Primitive helpers ────────────────────────────────────────────────── */

/* Slug ID: lower-kebab-case, 2-80 chars (per UQ-FORTIFY9 NFKD slug norm). */
const SlugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug must be lower-kebab-case');

/* Probability: 0..1 inclusive. */
const ProbSchema = z.number().min(0).max(1);

/* RTP percentage: 0..100 (allow over-bonuses for variant RTPs up to 130%). */
const RtpPctSchema = z.number().min(0).max(130);

/* Symbol ID: short identifier (1..20 chars).
 * NOTE 2026-06-22: corpus has heterogeneous ID conventions including
 * Unicode glyphs (★ for scatter), UPPERCASE (R7/W), mixed-case (CashWild),
 * snake_case (bonus_trig). Schema accepts any printable non-whitespace
 * string ≤ 20 chars. Canonical-case enforcement is the parser idMap's job,
 * not the schema's — schema only catches "empty" / "absurdly long" drift. */
const SymIdSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(/^\S+$/, 'symbol id must be non-empty and contain no whitespace');

/* Confidence: 0..1 inclusive. */
const ConfSchema = z.number().min(0).max(1);

/* ── Topology ─────────────────────────────────────────────────────────── */

export const TopologySchema = z.object({
  reels: z.number().int().min(3).max(12).optional(),
  rows:  z.number().int().min(1).max(20).optional(),
  paylines: z.number().int().min(0).max(2_097_152).optional(),
  /* Evaluation kind. Parser may emit extended tokens (e.g. 'cluster' as
   * shorthand) — schema accepts a string in known taxonomy or any
   * non-empty string for forward compatibility with new evaluators. */
  evaluation: z.string().min(1).max(40).optional(),
  kind: z.string().optional(), /* free-form topology marker (legacy compat) */
  is_plinko: z.boolean().optional(),
  is_slingo: z.boolean().optional(),
  is_hex:    z.boolean().optional(),
  is_wheel:  z.boolean().optional(),
  is_radial: z.boolean().optional(),
  is_crash:  z.boolean().optional(),
}).partial();

/* ── Symbols ──────────────────────────────────────────────────────────── */

const PaySchema = z.object({
  '3': z.number().int().min(0).max(100_000).optional(),
  '4': z.number().int().min(0).max(100_000).optional(),
  '5': z.number().int().min(0).max(1_000_000).optional(),
  '6': z.number().int().min(0).max(5_000_000).optional(),
}).partial();

const SymbolEntrySchema = z.object({
  id: SymIdSchema,
  label: z.string().min(1).max(40).optional(),
  /* Tier: canonical set is HP/MP/LP/SPECIAL/SCATTER/CASH/WILD/BONUS, but
   * parser also emits descriptive strings ("high", "mid"). Accept any
   * 1..20 char string — V14 walker enforces canonical taxonomy when needed. */
  tier: z.string().min(1).max(20).optional(),
  pay: PaySchema.optional(),
});

const SpecialSymbolSchema = SymbolEntrySchema.extend({
  /* 2026-06-22: corpus uses extended kind tokens beyond the original 8.
   * String validator (1..40 chars) is lenient enough to catch typos but
   * doesn't lock us into a closed enum. The V7 block liveness walker is
   * the source of truth for valid kinds (see src/registry/blockCatalog). */
  kind: z.string().min(1).max(40).optional(),
});

export const SymbolsSchema = z.object({
  high:     z.array(SymbolEntrySchema).optional(),
  mid:      z.array(SymbolEntrySchema).optional(),
  low:      z.array(SymbolEntrySchema).optional(),
  specials: z.array(SpecialSymbolSchema).optional(),
}).partial();

/* ── Paytable (alternative flat representation when symbols.* not enough) ─ */

export const PaytableRowSchema = z.object({
  symbolId: SymIdSchema.optional(),
  label: z.string().optional(),
  combos: z.record(z.string(), z.number().min(0)).optional(),
}).passthrough();

/* ── Free Spins ───────────────────────────────────────────────────────── */

const FsAwardSchema = z.union([
  z.number().int().min(1).max(500),
  z.object({
    scatters: z.number().int().min(2).max(15).optional(),
    spins: z.number().int().min(1).max(500),
    value: z.number().int().min(1).max(500).optional(),
  }),
]);

const FsRetriggerSchema = z.object({
  enabled: z.boolean(),
  /* count=0 is valid when enabled=false (parser convention for the disabled
   * retrigger sentinel). Min raised to 0 to accept the disabled form. */
  count: z.number().int().min(0).max(15).optional(),
  spins: z.number().int().min(0).max(50).optional(),
  hardCap: z.number().int().min(5).max(500).optional(),
}).partial();

const FsMultiplierSchema = z.object({
  type: z.enum(['static', 'progressive', 'random', 'sticky', 'orb']).optional(),
  start: z.number().min(1).max(1000).optional(),
  step: z.number().min(0).max(100).optional(),
  cap: z.number().min(1).max(100_000).optional(),
}).partial();

export const FreeSpinsSchema = z.object({
  enabled: z.boolean().optional(),
  triggerCount: z.number().int().min(2).max(15).optional(),
  scatterTrigger: z.number().int().min(2).max(15).optional(),
  awards: z.array(FsAwardSchema).optional(),
  retrigger: FsRetriggerSchema.optional(),
  multiplier: FsMultiplierSchema.optional(),
  avgSpinsPlayed: z.number().min(1).max(500).optional(),
  maxCap: z.number().int().min(5).max(500).optional(),
}).partial();

/* ── Hold & Win ───────────────────────────────────────────────────────── */

const CashPoolSchema = z.object({
  min: z.number().int().min(0).max(100_000).optional(),
  max: z.number().int().min(1).max(100_000).optional(),
}).partial();

export const HoldAndWinSchema = z.object({
  enabled: z.boolean().optional(),
  triggerCount: z.number().int().min(3).max(20).optional(),
  fsTriggerCount: z.number().int().min(2).max(30).optional(),
  respins: z.number().int().min(1).max(10).optional(),
  cashPool: CashPoolSchema.optional(),
  pots: z.array(z.object({
    tier: z.string().min(1).max(20),
    credits: z.number().int().min(1),
  })).optional(),
}).partial();

/* ── Jackpot ──────────────────────────────────────────────────────────── */

export const JackpotSchema = z.object({
  enabled: z.boolean().optional(),
  type: z.enum(['fixed', 'standalone', 'progressive', 'pooled', 'mystery']).optional(),
  values: z.record(z.string(), z.number().int().min(1)).optional(),
  share: z.number().min(0).max(1).optional(),
  shareWithinFeature: z.record(z.string(), ProbSchema).optional(),
}).partial();

/* ── Compliance ───────────────────────────────────────────────────────── */

const JurisdictionEntrySchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(1).max(80).optional(),
});

export const ComplianceSchema = z.array(JurisdictionEntrySchema);

/* ── Payback / RTP ────────────────────────────────────────────────────── */

const RtpBreakdownSchema = z.object({
  baseLine: RtpPctSchema.optional(),
  hwBase:   RtpPctSchema.optional(),
  fsLine:   RtpPctSchema.optional(),
  hwFs:     RtpPctSchema.optional(),
}).partial();

export const PaybackSchema = z.object({
  rtp: RtpPctSchema.optional(),
  /* rtpVariants: parser emits entries with either `variant` OR `name`,
   * and `rtp` as required. Accept either form via partial passthrough. */
  rtpVariants: z.array(z.object({
    variant: z.string().min(1).max(40).optional(),
    name:    z.string().min(1).max(80).optional(),
    rtp: RtpPctSchema,
  }).passthrough()).optional(),
  hitFrequency: z.number().min(0).max(100).optional(),
  volatilityIdx: z.number().int().min(1).max(10).optional(),
  maxWinX: z.number().int().min(1).max(10_000_000).optional(),
  rtpBreakdown: RtpBreakdownSchema.optional(),
}).partial();

/* ── Bet ladder ───────────────────────────────────────────────────────── */

const BetSchema = z.object({
  minBet: z.number().min(0.01).max(10_000).optional(),
  maxBet: z.number().min(0.01).max(1_000_000).optional(),
  defaultBet: z.number().min(0.01).max(1_000_000).optional(),
  stepCount: z.number().int().min(2).max(100).optional(),
  steps: z.array(z.number().min(0.01)).optional(),
  currency: z.string().min(3).max(5).optional(),
}).partial();

/* ── Par sheet sub-object ─────────────────────────────────────────────── */

const ReelStripSchema = z.array(SymIdSchema);

export const ParSheetSchema = z.object({
  reels: z.array(ReelStripSchema).optional(),
  paytable: z.array(PaytableRowSchema).optional(),
  rtp: RtpPctSchema.optional(),
  hitFrequency: z.number().min(0).max(100).optional(),
  volatilityIdx: z.number().int().min(1).max(10).optional(),
  vendor: z.string().min(1).max(30).optional(),
}).partial();

/* ── Feature configs (kept loose; specialized blocks self-validate) ───── */

const ExpandingWildSchema = z.object({
  enabled: z.boolean().optional(),
  onlyIfWinning: z.boolean().optional(),
  reels: z.array(z.number().int().min(1).max(12)).optional(),
}).partial();

const PatternWinSchema = z.object({
  enabled: z.boolean().optional(),
  awardX: z.number().int().min(1).max(1_000_000).optional(),
  description: z.string().max(200).optional(),
}).partial();

const ScatterSchema = z.object({
  symbolName: z.string().min(1).max(40).optional(),
  countMode: z.enum(['perReel', 'any']).optional(),
  payTable: z.record(z.string(), z.number().int().min(0).max(10_000)).optional(),
}).partial();

const BonusBuySchema = z.object({
  enabled: z.boolean().optional(),
  costX: z.number().min(0).max(1000).optional(),
  avgPayXBet: z.number().min(0).max(10_000).optional(),
  variants: z.array(z.unknown()).optional(),
  /* forceScatters: corpus has either boolean (enabled flag) or number
   * (forced scatter count). Accept both — semantic disambiguation done
   * downstream in the bonus_buy block. */
  forceScatters: z.union([z.boolean(), z.number().int().min(0).max(15)]).optional(),
}).partial();

const ComplianceGateSchema = z.object({
  enabled: z.boolean(),
}).passthrough();

const NetLossIndicatorSchema = z.object({
  enabled: z.boolean(),
}).passthrough();

/* ── Universal Game Schema (top-level) ────────────────────────────────── */

/**
 * Top-level model contract.
 *
 * Most fields are .optional() because parser produces partial models when
 * GDD prose is incomplete; downstream walkers report missing fields as gate
 * findings (HARD or SOFT depending on field criticality), they do NOT
 * silently fail validation. The schema's job is to catch SHAPE drift, not
 * COMPLETENESS — completeness is the V10/V11/V12/V14 walker's job.
 */
export const UniversalGameSchema = z.object({
  /* Identity */
  id: SlugSchema.optional(),
  slug: SlugSchema.optional(),
  name: z.string().min(1).max(80).optional(),
  swid: z.string().max(40).optional(),

  /* Structural */
  topology: TopologySchema.optional(),
  symbols: SymbolsSchema.optional(),
  paytable: z.array(PaytableRowSchema).optional(),

  /* Features */
  freeSpins: FreeSpinsSchema.optional(),
  holdAndWin: HoldAndWinSchema.optional(),
  jackpot: JackpotSchema.optional(),
  expandingWild: ExpandingWildSchema.optional(),
  patternWin: PatternWinSchema.optional(),
  scatter: ScatterSchema.optional(),
  bonusBuy: BonusBuySchema.optional(),

  /* Economics */
  bet: BetSchema.optional(),
  payback: PaybackSchema.optional(),
  winCap: z.object({
    enabled: z.boolean().optional(),
    maxWinX: z.number().int().min(1).max(10_000_000).optional(),
    mode: z.enum(['spin', 'round']).optional(),
  }).optional(),

  /* Compliance */
  compliance: ComplianceSchema.optional(),
  ukgcComplianceGate:        ComplianceGateSchema.optional(),
  mgaComplianceGate:         ComplianceGateSchema.optional(),
  swedenComplianceGate:      ComplianceGateSchema.optional(),
  germanyComplianceGate:     ComplianceGateSchema.optional(),
  netherlandsComplianceGate: ComplianceGateSchema.optional(),
  franceComplianceGate:      ComplianceGateSchema.optional(),
  italyComplianceGate:       ComplianceGateSchema.optional(),
  spainComplianceGate:       ComplianceGateSchema.optional(),
  ontarioComplianceGate:     ComplianceGateSchema.optional(),
  denmarkComplianceGate:     ComplianceGateSchema.optional(),
  netLossIndicator:          NetLossIndicatorSchema.optional(),

  /* Par sheet (vendor sub-object) */
  par_sheet: ParSheetSchema.optional(),
  par_sheet_paytable: z.array(PaytableRowSchema).optional(),
  reelStrips: ParSheetSchema.optional(),

  /* Confidence + metadata */
  confidence: z.object({
    topology:   ConfSchema.optional(),
    symbols:    ConfSchema.optional(),
    features:   ConfSchema.optional(),
    compliance: ConfSchema.optional(),
    bet:        ConfSchema.optional(),
    jackpot:    ConfSchema.optional(),
    _derivedBy: z.record(z.string(), z.string()).optional(),
  }).passthrough().optional(),
  __meta__: z.record(z.string(), z.unknown()).optional(),
  /* __activeFeatures__: corpus emits either strings (kind list) or richer
   * objects (kind + source + confidence). Accept both. */
  __activeFeatures__: z.array(z.union([
    z.string().min(1).max(40),
    z.object({
      kind:       z.string().min(1).max(40),
      source:     z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }).passthrough(),
  ])).optional(),

  /* Vendor-specific extensions (does NOT pollute canonical shape) */
  vendorExtensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough(); /* passthrough preserves unknown legacy fields without
                   * blocking new ones added later; schema is additive,
                   * not exclusive. */

/* ── Convenience validator ─────────────────────────────────────────────── */

/**
 * @param {unknown} obj — candidate model.json object
 * @returns {{ ok: boolean, errors: string[], parsed: object | null }}
 *
 * Returns structured result instead of throwing — easier to integrate into
 * walker / parser receipt chains. Errors are flattened to dotted paths.
 */
export function validateModel(obj) {
  /* QA Agent#2 finding (2026-06-23 LOW#2): circular-reference guard.
   * Zod's safeParse handles plain objects but doesn't natively detect cycles
   * in the user-supplied input. A model with `model.foo = model` would
   * later crash JSON.stringify (used by receipt-chain hash + pipeline
   * report writer). Detect cycles up-front via WeakSet traversal; reject
   * with structured error matching the schema-failure envelope. */
  if (obj !== null && typeof obj === 'object') {
    const seen = new WeakSet();
    const cycleCheck = (node) => {
      if (node === null || typeof node !== 'object') return false;
      if (seen.has(node)) return true;
      seen.add(node);
      for (const key of Object.keys(node)) {
        try {
          if (cycleCheck(node[key])) return true;
        } catch { /* getter that throws — treat as no cycle */ }
      }
      return false;
    };
    if (cycleCheck(obj)) {
      return {
        ok: false,
        errors: ['<root>: circular reference detected in model object'],
        parsed: null,
      };
    }
  }
  const result = UniversalGameSchema.safeParse(obj);
  if (result.success) {
    return { ok: true, errors: [], parsed: result.data };
  }
  const errors = (result.error.issues || []).map(iss => {
    const path = iss.path.join('.');
    return `${path || '<root>'}: ${iss.message}`;
  });
  return { ok: false, errors, parsed: null };
}

/* Export schema versioning marker (HARD RULE: bump on every shape change). */
export const SCHEMA_VERSION = '1.0.0';
export const SCHEMA_INTRODUCED = '2026-06-22';
export const SCHEMA_OWNER = 'MATH-DEEP HYB-1';
