/**
 * Faza 8.6 — Server-side Casino Protocols: shared types.
 *
 * Core types used by all protocol adapters (G2S, SAS, GAT-IV).
 * These are serialization-layer types — they do NOT carry engine logic.
 */

export interface MeterSnapshot {
  gamesPlayed: number;
  totalWagered: number; // in base units (cents or credits)
  totalWon: number;
  netRevenue: number;   // wagered - won
  jackpotTotal: number;
}

export interface SpinEvent {
  sessionId: string;
  spinIndex: number;
  timestamp: string;    // ISO 8601
  wagered: number;
  won: number;
  features: string[];   // triggered feature kinds
  grid?: string[][];    // optional grid snapshot
}

export interface GameIdentity {
  gameId: string;
  gameName: string;
  version: string;
  targetRtp: number;
  jurisdiction: string;
  certificationId?: string;
}

export type ProtocolMessage =
  | { protocol: 'G2S'; messageType: string; payload: string }                // XML string
  | { protocol: 'SAS'; command: number; data: Buffer | Uint8Array }          // binary
  | { protocol: 'GAT4'; messageType: string; payload: object };              // JSON object
