/**
 * Faza 8.6 — Protocol Bridge.
 *
 * Bridges the engine's native types (IRWinResult, SpinJournalEntry) to
 * casino protocol adapters (G2S, SAS, GAT-IV).
 *
 * This is a pure adapter layer — no simulation logic, no RNG.
 */

import type { SlotGameIR } from '../ir/types.js';
import type { IRWinResult } from '../engine/irEvaluator.js';
import type { SpinJournalEntry } from '../recall/types.js';
import type { SpinEvent, GameIdentity, MeterSnapshot } from './types.js';
import { G2SAdapter } from './g2s.js';

export class ProtocolBridge {
  private _identity: GameIdentity;
  private _sessionId: string;

  constructor(ir: SlotGameIR, sessionId: string) {
    this._sessionId = sessionId;
    this._identity = {
      gameId: ir.meta.id,
      gameName: ir.meta.name,
      version: ir.meta.version,
      targetRtp: ir.limits.target_rtp,
      jurisdiction:
        ir.compliance.jurisdictions.length > 0
          ? (ir.compliance.jurisdictions[0] ?? 'UNKNOWN')
          : 'UNKNOWN',
    };
  }

  // ─── identity ────────────────────────────────────────────────────────────

  /** The GameIdentity derived from the SlotGameIR. */
  get identity(): GameIdentity {
    return this._identity;
  }

  // ─── spinEvent ───────────────────────────────────────────────────────────

  /**
   * Convert IRWinResult → SpinEvent for protocol use.
   *
   * @param result   - The win result from the IR evaluator.
   * @param spinIndex - The spin number in the session (0-based or 1-based, caller decides).
   * @param wagered   - Total amount wagered on this spin (in base units). Defaults to 1.
   */
  spinEvent(result: IRWinResult, spinIndex: number, wagered = 1): SpinEvent {
    const won = result.totalPayout * result.spinMultiplier * result.lineMultiplier;

    // Extract grid from spinState if available
    const grid: string[][] | undefined = result.spinState?.grid;

    return {
      sessionId: this._sessionId,
      spinIndex,
      timestamp: new Date().toISOString(),
      wagered,
      won,
      features: [...result.triggeredFeatures],
      grid,
    };
  }

  // ─── meterSnapshot ───────────────────────────────────────────────────────

  /**
   * Build a MeterSnapshot from accumulated session stats.
   * No division-by-zero risk: if spins = 0, all values stay 0.
   */
  meterSnapshot(spins: number, totalWagered: number, totalWon: number): MeterSnapshot {
    return {
      gamesPlayed: spins,
      totalWagered,
      totalWon,
      netRevenue: totalWagered - totalWon,
      jackpotTotal: 0, // jackpot total is not tracked at bridge level without explicit input
    };
  }

  // ─── recallToG2S ─────────────────────────────────────────────────────────

  /**
   * Convert a recall journal entry → G2S spinHistory XML.
   * Bridges SpinJournalEntry to the G2S adapter.
   */
  recallToG2S(entry: SpinJournalEntry): string {
    const event: SpinEvent = {
      sessionId: entry.session_id,
      spinIndex: entry.spin_index,
      timestamp: entry.timestamp_utc,
      wagered: entry.bet_total_mc / 1000, // millicredits → credits
      won: entry.result.total_win_mc / 1000,
      features: entry.result.triggered_features,
    };
    return G2SAdapter.spinHistory(event, this._identity);
  }
}
