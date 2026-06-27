/**
 * W152 Wave 15 — Faza 1.6 — Quick RTP estimate helper.
 *
 * Pure function backing the `slot-sim rtp <config>` CLI subcommand.
 * Extracted so unit tests can verify the math + tolerance gating
 * without spawning a child process. The CLI itself stays a thin
 * print wrapper on top.
 *
 * Contract:
 *   * Accepts raw IR JSON text + run options.
 *   * Parses the IR via the production `parseGameIR` (Zod + semantic).
 *   * Runs `runIRSimulation` deterministically (seed defaults to 12345).
 *   * Emits a structured report including drift vs `limits.target_rtp`
 *     and a `withinTolerance` boolean computed against
 *     `limits.rtp_tolerance`.
 *   * Never throws on math; throws only on IR-parse failure so the
 *     caller can pick exit code semantics.
 */

import { parseGameIR } from '../ir/index.js';
import { runIRSimulation } from '../engine/irSimulator.js';
import type { SlotGameIR } from '../ir/types.js';

export interface RtpReportOpts {
  spins: number;
  seed: number;
}

export interface RtpReport {
  configId: string | null;
  spins: number;
  seed: number;
  rtp: number;
  hitRate: number;
  maxWinX: number;
  targetRtp: number | null;
  tolerance: number | null;
  drift: number | null;
  withinTolerance: boolean | null;
  elapsedMs: number;
  spinsPerSec: number;
  featureTriggerFreqs: Record<string, number>;
  rtpBreakdown: Record<string, number>;
}

/** Parse + validate the IR, returning the typed object or throwing
 *  with a multi-line message. */
export function parseIrOrThrow(irJsonText: string): SlotGameIR {
  let raw: unknown;
  try {
    raw = JSON.parse(irJsonText);
  } catch (e) {
    throw new Error(`IR JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = parseGameIR(raw);
  if (!parsed.ok) {
    const msg = parsed.issues.map((i) => `  ${i.path} ${i.message}`).join('\n');
    throw new Error(`IR validation failed:\n${msg}`);
  }
  return parsed.ir;
}

/** Run the simulator and assemble a structured report. */
export async function computeRtpReport(
  irJsonText: string,
  opts: RtpReportOpts,
): Promise<RtpReport> {
  const ir = parseIrOrThrow(irJsonText);
  const spins = Math.max(1, Math.floor(opts.spins));
  const seed = Math.floor(opts.seed);

  const t0 = Date.now();
  const result = await runIRSimulation(ir, { spins, seed });
  const elapsedMs = Math.max(1, Date.now() - t0);

  const target = ir.limits?.target_rtp ?? null;
  const tolerance = ir.limits?.rtp_tolerance ?? null;
  const drift = target !== null ? Math.abs(result.rtp - target) : null;
  const withinTolerance =
    target !== null && tolerance !== null && drift !== null
      ? drift <= tolerance
      : null;

  return {
    configId: ir.meta?.id ?? null,
    spins,
    seed,
    rtp: result.rtp,
    hitRate: result.hitRate,
    maxWinX: result.maxWinX,
    targetRtp: target,
    tolerance,
    drift,
    withinTolerance,
    elapsedMs,
    spinsPerSec: Math.round((spins / elapsedMs) * 1000),
    featureTriggerFreqs: result.featureTriggerFreqs,
    rtpBreakdown: result.rtpBreakdown,
  };
}

/** Format an `RtpReport` as a single CLI-friendly headline string. */
export function formatRtpHeadline(r: RtpReport): string {
  const parts: string[] = [];
  parts.push(`Config: ${r.configId ?? '<unnamed>'}`);
  parts.push(`Spins: ${r.spins.toLocaleString()} · seed ${r.seed}`);
  parts.push(`RTP: ${(r.rtp * 100).toFixed(4)} %`);
  parts.push(`Hit-rate: ${(r.hitRate * 100).toFixed(4)} %`);
  parts.push(`Max-win-X: ${r.maxWinX.toFixed(2)}×`);
  if (r.targetRtp !== null && r.tolerance !== null) {
    const tag =
      r.withinTolerance === null
        ? 'tolerance n/a'
        : r.withinTolerance
          ? 'WITHIN'
          : 'OUT-OF-RANGE';
    parts.push(`Target ${(r.targetRtp * 100).toFixed(4)} % ± ${(r.tolerance * 100).toFixed(4)} % · ${tag}`);
  }
  parts.push(`${r.elapsedMs} ms (${r.spinsPerSec.toLocaleString()} spins/s)`);
  return parts.join(' | ');
}
