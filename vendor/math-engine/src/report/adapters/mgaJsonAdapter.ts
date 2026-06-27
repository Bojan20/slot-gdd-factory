/**
 * W152 P0-6 — Malta MGA operator portal JSON adapter.
 *
 * MGA's online operator portal accepts a stable JSON shape per reporting
 * cycle. Field names are snake_case (per the published OpenAPI spec, rev
 * 2024-09). Monetary fields are sent as integer **eurocents** (no
 * decimals on the wire) plus a separate `currency` field — defensive
 * against locale-dependent decimal parsing on the regulator side.
 *
 * RTP is `total_returned_eurocents / total_wagered_eurocents` computed
 * client-side and reported with 6 decimal places. The portal performs
 * its own audit and warns if the operator-side number drifts > 0.0001.
 *
 * Schema version 1.0.0 (KIMI W152 §3.6).
 */

import {
  ReportAdapter,
  JurisdictionalReport,
  computeRtp,
} from './types.js';

/** Convert millicredits → integer eurocents (round half to even). */
function mcToEurocents(mc: number): number {
  if (!Number.isFinite(mc) || mc < 0) return 0;
  // millicredits / 10 = eurocents (since 1 EUR = 1000 mc = 100 cents).
  const whole = Math.trunc(mc / 10);
  const rem = mc - whole * 10; // 0 .. 9
  if (rem < 5) return whole;
  if (rem > 5) return whole + 1;
  // Banker's rounding at halves.
  return whole % 2 === 0 ? whole : whole + 1;
}

export const MGAJsonAdapter: ReportAdapter = {
  name: 'mga-portal-json',
  mimeType: 'application/json; charset=utf-8',
  emit(r: JurisdictionalReport): string {
    const rtp = computeRtp(r);
    const payload = {
      schema_version: '1.0.0',
      jurisdiction: 'MGA',
      operator_license_id: r.operatorLicenseId,
      game_license_id: r.gameLicenseId,
      game_name: r.gameName,
      game_version: r.gameVersion,
      currency: r.currency,
      period_start_utc: r.periodStartUtc,
      period_end_utc: r.periodEndUtc,
      total_spins: r.totalSpins,
      unique_players: r.uniquePlayers,
      total_wagered_eurocents: mcToEurocents(r.totalWageredMc),
      total_returned_eurocents: mcToEurocents(r.totalWonMc),
      largest_win_eurocents: mcToEurocents(r.largestWinMc),
      rtp: Number(rtp.toFixed(6)),
    };
    // Deterministic key order: alphabetical. We don't use
    // JSON.stringify's default insertion order because some
    // bundlers/transpilers may reorder object keys (V8 doesn't, but be
    // defensive — the regulator-side replay relies on byte-identity).
    const orderedKeys = Object.keys(payload).sort() as Array<keyof typeof payload>;
    const orderedPayload: Record<string, unknown> = {};
    for (const k of orderedKeys) orderedPayload[k] = payload[k];
    return JSON.stringify(orderedPayload, null, 2) + '\n';
  },
};

/** Exposed for unit tests. */
export const __mgaInternals = { mcToEurocents };
