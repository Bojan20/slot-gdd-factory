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

import { SlotGameIRZ } from './schema.js';
import type {
  Evaluation,
  Feature,
  Paytable,
  ReelSet,
  SlotGameIR,
  SymbolKey,
  Topology,
} from './types.js';

export * from './types.js';
export {
  SlotGameIRZ,
  MetaZ,
  TopologyZ,
  SymbolZ,
  ReelSetZ,
  EvaluationZ,
  FeatureZ,
  RngZ,
  BetZ,
  LimitsZ,
  ComplianceZ,
  RtpAllocationZ,
  PaytableZ,
} from './schema.js';

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
export function parseGameIR(input: unknown): IRParseResult {
  const zod = SlotGameIRZ.safeParse(input);
  if (!zod.success) {
    return {
      ok: false,
      issues: zod.error.issues.map((i) => ({
        path: '/' + i.path.join('/'),
        message: i.message,
      })),
    };
  }
  const ir = zod.data as SlotGameIR;
  const cross = crossValidate(ir);
  const unknown = collectUnknownTopLevelKeys(input as Record<string, unknown>);
  if (cross.errors.length > 0) {
    return { ok: false, issues: cross.errors };
  }
  return { ok: true, ir, unknown_keys: unknown, warnings: cross.warnings };
}

/**
 * Semantic validator — run *after* Zod accepts the shape. Surfaces
 * issues Zod cannot encode in pure types: cross-field constraints,
 * referential integrity, topology↔eval coherence, paytable coverage.
 */
export function crossValidate(ir: SlotGameIR): {
  errors: IRValidationIssue[];
  warnings: IRValidationIssue[];
} {
  const errors: IRValidationIssue[] = [];
  const warnings: IRValidationIssue[] = [];
  const symIds = new Set<SymbolKey>(ir.symbols.map((s) => s.id));

  // ── Symbol uniqueness ──────────────────────────────────────────────
  // Duplicate symbol IDs silently collapse to a single Set entry,
  // making downstream paytable / reel references ambiguous and causing
  // very-hard-to-diagnose RTP drift (the evaluator picks the *first*
  // occurrence). Surface duplicates here so the cert / simulator never
  // see an IR with shadowed symbols.
  if (symIds.size !== ir.symbols.length) {
    const seen = new Set<SymbolKey>();
    for (const [i, sym] of ir.symbols.entries()) {
      if (seen.has(sym.id)) {
        errors.push({
          path: `/symbols/${i}/id`,
          message: `duplicate symbol id '${sym.id}' — symbol ids must be unique`,
        });
      }
      seen.add(sym.id);
    }
  }

  // ── Symbol referential integrity ────────────────────────────────────
  // paytable keys
  for (const sym of Object.keys(ir.paytable)) {
    if (!symIds.has(sym)) {
      errors.push({ path: `/paytable/${sym}`, message: `unknown symbol id '${sym}'` });
    }
  }
  // reel weights (weighted mode)
  if (ir.reels.mode === 'weighted') {
    ir.reels.base.forEach((map, reel) => {
      for (const k of Object.keys(map)) {
        if (!symIds.has(k)) {
          errors.push({
            path: `/reels/base/${reel}/${k}`,
            message: `unknown symbol id '${k}' on reel ${reel}`,
          });
        }
      }
    });
    if (ir.reels.free_spins) {
      ir.reels.free_spins.forEach((map, reel) => {
        for (const k of Object.keys(map)) {
          if (!symIds.has(k)) {
            errors.push({
              path: `/reels/free_spins/${reel}/${k}`,
              message: `unknown symbol id '${k}' on FS reel ${reel}`,
            });
          }
        }
      });
    }
  } else {
    // strips mode
    ir.reels.base.forEach((strip, reel) => {
      strip.forEach((s, idx) => {
        if (!symIds.has(s)) {
          errors.push({
            path: `/reels/base/${reel}/${idx}`,
            message: `unknown symbol id '${s}' at reel ${reel} stop ${idx}`,
          });
        }
      });
    });
  }
  // wild.substitutes reference
  for (const sym of ir.symbols) {
    if (Array.isArray(sym.substitutes)) {
      for (const t of sym.substitutes) {
        if (!symIds.has(t)) {
          errors.push({ path: `/symbols/${sym.id}/substitutes`, message: `unknown substitute '${t}'` });
        }
      }
    }
  }

  // ── Topology ↔ evaluation coherence ────────────────────────────────
  errors.push(...evalTopologyCoherence(ir.topology, ir.evaluation));

  // ── Paytable shape ↔ evaluation kind ──────────────────────────────
  errors.push(...paytableShapeCheck(ir.paytable, ir.evaluation));

  // ── RTP allocation sums to ≈ target_rtp ───────────────────────────
  const alloc = ir.rtp_allocation;
  const sum = alloc.base_game + alloc.free_spins + alloc.hold_and_win + alloc.jackpot;
  if (Math.abs(sum - ir.limits.target_rtp) > alloc.tolerance) {
    errors.push({
      path: '/rtp_allocation',
      message: `sum ${sum.toFixed(4)} differs from target_rtp ${ir.limits.target_rtp} by more than tolerance ${alloc.tolerance}`,
    });
  }

  // ── Feature ↔ symbol dependency ──────────────────────────────────
  for (const [i, feat] of ir.features.entries()) {
    if (feat.kind === 'hold_and_win') {
      // need at least one bonus symbol
      if (!ir.symbols.some((s) => s.kind === 'bonus')) {
        errors.push({
          path: `/features/${i}`,
          message: `hold_and_win declared but no bonus symbol exists in /symbols`,
        });
      }
    }
    if (feat.kind === 'free_spins' && feat.trigger.by === 'scatter_count') {
      if (!ir.symbols.some((s) => s.kind === 'scatter')) {
        errors.push({
          path: `/features/${i}/trigger`,
          message: `free_spins triggered by scatter_count but no scatter symbol exists`,
        });
      }
    }
    if (feat.kind === 'mystery_symbol') {
      if (!symIds.has(feat.symbol_id)) {
        errors.push({
          path: `/features/${i}/symbol_id`,
          message: `mystery_symbol references unknown symbol '${feat.symbol_id}'`,
        });
      }
      for (const k of Object.keys(feat.reveal_distribution)) {
        if (!symIds.has(k)) {
          errors.push({
            path: `/features/${i}/reveal_distribution/${k}`,
            message: `unknown reveal target '${k}'`,
          });
        }
      }
    }
  }

  // ── Compliance band sanity ─────────────────────────────────────────
  const [rtpLo, rtpHi] = ir.compliance.rtp_range_required;
  if (rtpLo > rtpHi) {
    errors.push({
      path: '/compliance/rtp_range_required',
      message: `range lo (${rtpLo}) > hi (${rtpHi})`,
    });
  }
  if (ir.limits.target_rtp < rtpLo || ir.limits.target_rtp > rtpHi) {
    warnings.push({
      path: '/limits/target_rtp',
      message: `target_rtp ${ir.limits.target_rtp} outside compliance band [${rtpLo}, ${rtpHi}]`,
    });
  }
  if (ir.limits.max_win_x > ir.compliance.max_win_cap_required) {
    warnings.push({
      path: '/limits/max_win_x',
      message: `max_win_x ${ir.limits.max_win_x} exceeds compliance cap ${ir.compliance.max_win_cap_required}`,
    });
  }

  return { errors, warnings };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function collectUnknownTopLevelKeys(input: Record<string, unknown>): string[] {
  const known = new Set([
    'schema_version',
    'meta',
    'topology',
    'symbols',
    'reels',
    'evaluation',
    'paytable',
    'features',
    'rng',
    'bet',
    'limits',
    'compliance',
    'rtp_allocation',
  ]);
  return Object.keys(input).filter((k) => !known.has(k));
}

function evalTopologyCoherence(t: Topology, e: Evaluation): IRValidationIssue[] {
  const issues: IRValidationIssue[] = [];
  if (e.kind === 'lines') {
    const reels =
      t.kind === 'rectangular' ? t.reels : t.kind === 'variable_rows' ? t.reels : 0;
    const rows = t.kind === 'rectangular' ? t.rows : 0;
    if (reels === 0) {
      issues.push({
        path: '/evaluation',
        message: `'lines' evaluation requires rectangular or variable_rows topology, got ${t.kind}`,
      });
      return issues;
    }
    for (const [i, pl] of e.paylines.entries()) {
      if (pl.length !== reels) {
        issues.push({
          path: `/evaluation/paylines/${i}`,
          message: `payline length ${pl.length} ≠ reels ${reels}`,
        });
      }
      if (t.kind === 'rectangular') {
        for (const [j, r] of pl.entries()) {
          if (r < 0 || r >= rows) {
            issues.push({
              path: `/evaluation/paylines/${i}/${j}`,
              message: `row index ${r} out of range [0, ${rows - 1}]`,
            });
          }
        }
      }
    }
  } else if (e.kind === 'cluster') {
    if (t.kind !== 'cluster_grid') {
      issues.push({
        path: '/evaluation',
        message: `'cluster' evaluation requires cluster_grid topology, got ${t.kind}`,
      });
    }
  } else if (e.kind === 'ways') {
    if (t.kind === 'cluster_grid') {
      issues.push({
        path: '/evaluation',
        message: `'ways' evaluation incompatible with cluster_grid topology`,
      });
    }
  }
  return issues;
}

function paytableShapeCheck(p: Paytable, e: Evaluation): IRValidationIssue[] {
  const issues: IRValidationIssue[] = [];
  if (e.kind === 'lines' || e.kind === 'ways') {
    // expect numeric count keys like "3", "4", ...
    for (const [sym, table] of Object.entries(p)) {
      for (const k of Object.keys(table)) {
        if (!/^\d+$/.test(k)) {
          issues.push({
            path: `/paytable/${sym}/${k}`,
            message: `expected numeric OAK count key for '${e.kind}' evaluation, got '${k}'`,
          });
        }
      }
    }
  }
  return issues;
}

/** Re-export Feature / ReelSet for consumers writing transformations. */
export type { Feature, ReelSet };
