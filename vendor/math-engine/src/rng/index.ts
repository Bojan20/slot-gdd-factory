/**
 * RNG module — Faza 7 barrel export
 *
 * Re-exports the legacy mulberry32 function for backward compatibility,
 * plus all new backend types, the factory, and the interface.
 */

// ── Backward compatibility: legacy mulberry32 function ──────────────────────
// Import from utils/rng (canonical source) and re-export as-is.
export { mulberry32 } from '../utils/rng.js';

// ── Interface & types ────────────────────────────────────────────────────────
export type { RngBackend, RngKind } from './RngBackend.js';
export { u64ToF64, lemireBounded } from './RngBackend.js';

// ── Backends ─────────────────────────────────────────────────────────────────
export { Mulberry32 } from './backends/Mulberry32.js';
export { PCG64 } from './backends/PCG64.js';
export { Xoshiro256SS } from './backends/Xoshiro256SS.js';
export { Philox4x32 } from './backends/Philox4x32.js';
// W152 P0-1 — RFC 8439 ChaCha20 CSPRNG (UK / MGA / DE crypto path).
export { ChaCha20 } from './backends/ChaCha20.js';

// ── Factory ───────────────────────────────────────────────────────────────────
export { createRng } from './RngFactory.js';

// W152 Wave 55 — General Entropy Health Monitor (continuous sliding-window).
export * from './entropyHealthMonitor.js';
