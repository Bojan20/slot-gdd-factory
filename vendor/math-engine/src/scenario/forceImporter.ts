/**
 * W152 Wave 18 — Scenario Force Importer (Faza 15.A.11).
 *
 * Industry-generic alternative to seed-driven replay. Where the engine's
 * primary replay path uses `(seed, spinIndex)` reproducibility, the
 * scenario file path uses an EXPLICIT outcome script:
 *
 *   {
 *     "scenarioId": "fs_trigger_then_megawin",
 *     "baseReelSelect": [0, 12, 7, 5, 3, 18],
 *     "featureForceTriggers": [
 *       { "feature": "free_spins", "forceParams": { "scatters": 4 } },
 *       { "feature": "wheel_pick", "forceParams": { "wheelPointer": 7 } }
 *     ],
 *     "expectedOutcome": { "totalWinX": 250, "featureCount": 1 }
 *   }
 *
 * The CLI consumes this via `slot-sim sim --scenario <file>` and the
 * engine bypasses RNG for any dimension covered by the script. Used
 * heavily by:
 *   * QA — reproduce a customer-reported edge case from a single file.
 *   * Acceptance harness — pin specific feature-trigger sequences for
 *     regression testing.
 *   * Cert / regulator demo — show specific spin outcomes on demand
 *     without revealing the engine's RNG seed.
 *
 * Naming: `scenarioForce` is the engine-generic name. Vendor-specific
 * implementations exist under different proprietary names — those
 * terms are documented in `docs/glossary.md` (RESERVED TERMS).
 */

import { z } from 'zod';

// ════════════════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════════════════

export const FeatureForceTriggerZ = z
  .object({
    feature: z.string().min(1),
    /** Free-form parameter bag — feature evaluator interprets. */
    forceParams: z.record(z.string(), z.unknown()),
  })
  .strict();

export const ExpectedOutcomeZ = z
  .object({
    totalWinX: z.number().nonnegative().optional(),
    featureCount: z.number().int().nonnegative().optional(),
    triggeredFeatures: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

export const ScenarioForceZ = z
  .object({
    scenarioId: z.string().min(1),
    /** Per-reel forced stop indices for the base game spin. */
    baseReelSelect: z.array(z.number().int().nonnegative()).min(1),
    /**
     * Optional: per-reel stops for a subsequent free-spins reel set.
     * Distinct from `baseReelSelect` so the importer can model the
     * full base→FS transition.
     */
    freeSpinsReelSelect: z.array(z.number().int().nonnegative()).optional(),
    /** Forced feature triggers in declared order. */
    featureForceTriggers: z.array(FeatureForceTriggerZ).optional(),
    /** Expected post-spin assertions. Acceptance harness diffs vs actual. */
    expectedOutcome: ExpectedOutcomeZ,
    /** Optional metadata — operator-provided. */
    notes: z.string().optional(),
    author: z.string().optional(),
    createdAtUtc: z.string().optional(),
  })
  .strict();

export type FeatureForceTrigger = z.infer<typeof FeatureForceTriggerZ>;
export type ExpectedOutcome = z.infer<typeof ExpectedOutcomeZ>;
export type ScenarioForce = z.infer<typeof ScenarioForceZ>;

/** Parse + validate a scenario JSON. Throws on schema violation. */
export function parseScenarioForce(input: unknown): ScenarioForce {
  return ScenarioForceZ.parse(input);
}

// ════════════════════════════════════════════════════════════════════════════
// Diff against actual run output (used by acceptance harness)
// ════════════════════════════════════════════════════════════════════════════

export interface ScenarioDiffResult {
  scenarioId: string;
  passed: boolean;
  failures: Array<{ field: string; expected: unknown; actual: unknown }>;
}

/** Compare a scenario's `expectedOutcome` against an actual outcome blob. */
export function diffScenarioOutcome(
  scenario: ScenarioForce,
  actual: { totalWinX?: number; featureCount?: number; triggeredFeatures?: string[] },
): ScenarioDiffResult {
  const failures: ScenarioDiffResult['failures'] = [];
  const expected = scenario.expectedOutcome;
  if (expected) {
    if (
      expected.totalWinX !== undefined &&
      Math.abs((actual.totalWinX ?? 0) - expected.totalWinX) > 1e-9
    ) {
      failures.push({
        field: 'totalWinX',
        expected: expected.totalWinX,
        actual: actual.totalWinX,
      });
    }
    if (expected.featureCount !== undefined && actual.featureCount !== expected.featureCount) {
      failures.push({
        field: 'featureCount',
        expected: expected.featureCount,
        actual: actual.featureCount,
      });
    }
    if (expected.triggeredFeatures !== undefined) {
      const e = [...expected.triggeredFeatures].sort();
      const a = [...(actual.triggeredFeatures ?? [])].sort();
      if (e.length !== a.length || e.some((v, i) => v !== a[i])) {
        failures.push({
          field: 'triggeredFeatures',
          expected: expected.triggeredFeatures,
          actual: actual.triggeredFeatures,
        });
      }
    }
  }
  return { scenarioId: scenario.scenarioId, passed: failures.length === 0, failures };
}

// ════════════════════════════════════════════════════════════════════════════
// Reel-stop applicator — wraps stops to per-reel strip length
// ════════════════════════════════════════════════════════════════════════════

/**
 * Map raw stop indices onto a strip-bounded set. Throws on negative
 * stop, mismatched reel count, or empty strip.
 *
 * Used by the orchestrator: when running with a scenario, it overrides
 * the RNG-driven stop selection with these wrapped values.
 */
export function applyForcedStops(
  stops: number[],
  stripLengths: number[],
): number[] {
  if (stops.length !== stripLengths.length) {
    throw new Error(
      `applyForcedStops: stops.length (${stops.length}) != stripLengths.length (${stripLengths.length})`,
    );
  }
  return stops.map((stop, i) => {
    const len = stripLengths[i];
    if (!Number.isInteger(len) || len <= 0) {
      throw new Error(`applyForcedStops: stripLengths[${i}] = ${len} is not a positive integer`);
    }
    if (!Number.isInteger(stop) || stop < 0) {
      throw new RangeError(`applyForcedStops: stops[${i}] = ${stop} must be non-negative integer`);
    }
    return stop % len;
  });
}
