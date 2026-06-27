/**
 * Faza 8.6 — Server-side Casino Protocols barrel export.
 *
 * Exports all protocol adapters and shared types.
 */

export type {
  MeterSnapshot,
  SpinEvent,
  GameIdentity,
  ProtocolMessage,
} from './types.js';

export { G2SAdapter } from './g2s.js';
export { SASAdapter, SAS_CMD } from './sas.js';
export { GAT4Adapter } from './gat4.js';
export { ProtocolBridge } from './bridge.js';
