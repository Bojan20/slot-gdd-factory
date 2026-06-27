/**
 * FAZA 13.5 — QRNG Bridge public API
 *
 * Quick start:
 *   import { QrngBridge, MockQuantumSource, ChaCha20Source } from '../qrng/index.js';
 *   const bridge = new QrngBridge({ primary: { kind: 'quantinuum', apiKey: process.env.QTUM_KEY } });
 *   const f = await bridge.nextFloat();  // quantum or ChaCha20 fallback
 *
 * Test setup:
 *   const bridge = new QrngBridge({ primary: { kind: 'mock' } });
 */
export { QrngBridge } from './bridge.js';
export { MockQuantumSource, ChaCha20Source, QuantinuumSource, IdQuantiqueSource, createEntropySource, estimateShannonBitsPerByte } from './sources.js';
export type {
  EntropySource,
  EntropySourceKind,
  EntropySourceConfig,
  EntropySourceHealth,
  EntropyBatch,
  QrngBridgeConfig,
} from './types.js';
