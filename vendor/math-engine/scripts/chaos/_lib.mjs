/**
 * W212 Faza 600.1 — Shared mini-controller for chaos scenarios.
 *
 * The TS chaos framework lives in `server/lib/chaos/`. Scenarios are
 * runnable as plain `.mjs` against the same conceptual surface without
 * needing the TypeScript build; this file provides the minimal subset
 * (enable/disable/shouldInject) plus a stable deterministic RNG.
 */

export class MiniChaosController {
  constructor({ rng = Math.random, forceEnabled = true } = {}) {
    this.rng = rng;
    this.forceEnabled = forceEnabled;
    this.faults = new Map();
  }
  isEnabled() {
    return this.forceEnabled;
  }
  enable(name, probability) {
    const p = Math.max(0, Math.min(1, probability));
    const existing = this.faults.get(name) ?? { considered: 0, injected: 0 };
    const rec = { name, probability: p, ...existing };
    this.faults.set(name, rec);
    return rec;
  }
  disable(name) {
    return this.faults.delete(name);
  }
  disableAll() {
    this.faults.clear();
  }
  list() {
    return [...this.faults.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  shouldInject(name) {
    if (!this.forceEnabled) return false;
    const r = this.faults.get(name);
    if (!r) return false;
    r.considered++;
    if (this.rng() < r.probability) {
      r.injected++;
      return true;
    }
    return false;
  }
  totals() {
    let considered = 0;
    let injected = 0;
    for (const r of this.faults.values()) {
      considered += r.considered;
      injected += r.injected;
    }
    return { considered, injected };
  }
}

/** Mulberry32 PRNG — small, fast, deterministic. */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Token bucket — simple shared rate-limit used by scenarios. */
export class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.lastMs = Date.now();
  }
  take() {
    const now = Date.now();
    const elapsed = (now - this.lastMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastMs = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

export function pretty(verdict) {
  const status = verdict.pass ? 'PASS' : 'FAIL';
  return `[chaos:${verdict.name}] ${status} ${JSON.stringify(verdict.summary ?? {})}`;
}
