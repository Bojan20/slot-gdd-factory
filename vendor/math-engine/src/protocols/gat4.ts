/**
 * GAT-IV (Gaming Application Toolkit v4) — SG proprietary protocol.
 *
 * JSON-based session/spin result serialization for Bally/WMS/Scientific
 * Games cabinets.
 *
 * Message format:
 * {
 *   "gatVersion": "4.0",
 *   "messageType": "session.spin",
 *   "timestamp": "<ISO 8601>",
 *   "sessionId": "<id>",
 *   "payload": { ... }
 * }
 */

import type { SpinEvent, MeterSnapshot, GameIdentity } from './types.js';

export class GAT4Adapter {
  // ─── Envelope builder ────────────────────────────────────────────────────

  private static envelope(
    messageType: string,
    sessionId: string,
    payload: object,
  ): object {
    return {
      gatVersion: '4.0',
      messageType,
      timestamp: new Date().toISOString(),
      sessionId,
      payload,
    };
  }

  // ─── sessionStart ────────────────────────────────────────────────────────

  /**
   * Build a session.start message for game session initialization
   * with IR metadata.
   */
  static sessionStart(gameId: GameIdentity, sessionId: string): object {
    const payload: Record<string, unknown> = {
      gameId: gameId.gameId,
      gameName: gameId.gameName,
      version: gameId.version,
      targetRtp: gameId.targetRtp,
      jurisdiction: gameId.jurisdiction,
    };
    if (gameId.certificationId !== undefined) {
      payload['certificationId'] = gameId.certificationId;
    }
    return GAT4Adapter.envelope('session.start', sessionId, payload);
  }

  // ─── spinResult ──────────────────────────────────────────────────────────

  /**
   * Build a session.spin message for a single spin result
   * (IRWinResult → GAT-IV SpinResult).
   */
  static spinResult(event: SpinEvent, gameId: GameIdentity): object {
    const payload: Record<string, unknown> = {
      spinIndex: event.spinIndex,
      wagered: event.wagered,
      won: event.won,
      features: event.features,
    };
    if (event.grid !== undefined) {
      payload['grid'] = event.grid;
    }
    payload['gameId'] = gameId.gameId;
    return GAT4Adapter.envelope('session.spin', event.sessionId, payload);
  }

  // ─── sessionEnd ──────────────────────────────────────────────────────────

  /**
   * Build a session.end message with session summary and RTP stats.
   */
  static sessionEnd(
    meters: MeterSnapshot,
    gameId: GameIdentity,
    sessionId: string,
  ): object {
    const rtp =
      meters.totalWagered > 0
        ? meters.totalWon / meters.totalWagered
        : 0;

    const payload: Record<string, unknown> = {
      gameId: gameId.gameId,
      gamesPlayed: meters.gamesPlayed,
      totalWagered: meters.totalWagered,
      totalWon: meters.totalWon,
      netRevenue: meters.netRevenue,
      jackpotTotal: meters.jackpotTotal,
      rtp,
    };

    return GAT4Adapter.envelope('session.end', sessionId, payload);
  }

  // ─── parse ───────────────────────────────────────────────────────────────

  /**
   * Parse a GAT-IV message envelope.
   * Extracts messageType and payload from the outer envelope object.
   */
  static parse(obj: object): { messageType: string; payload: unknown } {
    const record = obj as Record<string, unknown>;
    const messageType =
      typeof record['messageType'] === 'string' ? record['messageType'] : '';
    const payload = record['payload'] ?? null;
    return { messageType, payload };
  }
}
