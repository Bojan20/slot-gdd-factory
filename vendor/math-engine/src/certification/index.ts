/**
 * FAZA 14.2 — Continuous Certification module.
 *
 * Usage:
 *   import { ContinuousCertifier, InMemoryTransport } from '../certification/index.js';
 *   const cert = new ContinuousCertifier({ gameId: 'my-game', ... });
 *   cert.addSpin({ spinIndex: 0, bet: 1, win: 0, bonusTriggered: false, auditHash: '...', timestampMs: Date.now(), sessionId: 's1' });
 *   const report = await cert.generateDailyReport(startMs, endMs);
 *   await cert.emitToRegulator(report);
 */
export { ContinuousCertifier, verifyHashChain } from './certifier.js';
export type { HashChainEntry } from './certifier.js';
export {
  InMemoryTransport,
  FailingTransport,
} from './types.js';
export type {
  ContinuousCertConfig,
  CertSpinRecord,
  DailyReport,
  DailyRtpStats,
  DailyHashChainSummary,
  ComplianceStatus,
  ComplianceFlag,
  CertificationEvent,
  RegulatorTransport,
} from './types.js';
