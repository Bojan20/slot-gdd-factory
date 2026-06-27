/**
 * W241 — Real-Time Stream Latency SLA Compliance Analyzer (98. solver).
 *
 * UKGC RTS 14F latency disclosure + MGA QoS Standards §16 + EU EBA Real-Time
 * Standards 2024 (mandatory <500ms end-to-end). Models per-spin latency
 * Log-Normal distribution; SLA breach probability; refund/credit exposure.
 */

export interface StreamLatencyConfig {
  /** Median latency (ms) — Log-Normal median. */
  medianLatencyMs: number;
  /** σ of Log-Normal latency. */
  latencyLogStd: number;
  /** SLA threshold (ms) — typical 500ms (UKGC). */
  slaThresholdMs: number;
  /** Spins per day. */
  spinsPerDay: number;
  /** Refund per SLA breach (currency). */
  refundPerBreach: number;
  /** Annual operator revenue. */
  operatorAnnualRevenue: number;
}

export interface StreamLatencyResult {
  meanLatencyMs: number;
  p99LatencyMs: number;
  probSlaBreach: number;
  expectedDailyBreaches: number;
  expectedAnnualBreaches: number;
  expectedAnnualRefundCost: number;
  refundCostShareOfRevenue: number;
  slaComplianceScore: number;
  isCompliantUkgcRts14f: boolean;
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function normQuantile(p: number): number {
  // Beasley-Springer-Moro (simplified for typical use)
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const q = p - 0.5;
  const r = q * q;
  return (((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5])) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function validate(c: StreamLatencyConfig): void {
  if (!Number.isFinite(c.medianLatencyMs) || c.medianLatencyMs <= 0) throw new Error('medianLatencyMs > 0');
  if (!Number.isFinite(c.latencyLogStd) || c.latencyLogStd <= 0) throw new Error('latencyLogStd > 0');
  if (!Number.isFinite(c.slaThresholdMs) || c.slaThresholdMs <= 0) throw new Error('slaThresholdMs > 0');
  if (!Number.isFinite(c.spinsPerDay) || c.spinsPerDay < 1) throw new Error('spinsPerDay ≥ 1');
  if (!Number.isFinite(c.refundPerBreach) || c.refundPerBreach < 0) throw new Error('refundPerBreach ≥ 0');
  if (!Number.isFinite(c.operatorAnnualRevenue) || c.operatorAnnualRevenue <= 0) throw new Error('operatorAnnualRevenue > 0');
}

export function solveStreamLatency(cfg: StreamLatencyConfig): StreamLatencyResult {
  validate(cfg);
  const muLog = Math.log(cfg.medianLatencyMs);
  const sigma = cfg.latencyLogStd;
  const meanLatencyMs = Math.exp(muLog + sigma * sigma / 2);
  const p99LatencyMs = Math.exp(muLog + sigma * normQuantile(0.99));
  const probSlaBreach = 1 - normCdf((Math.log(cfg.slaThresholdMs) - muLog) / sigma);
  const expectedDailyBreaches = cfg.spinsPerDay * probSlaBreach;
  const expectedAnnualBreaches = expectedDailyBreaches * 365;
  const expectedAnnualRefundCost = expectedAnnualBreaches * cfg.refundPerBreach;
  const refundCostShareOfRevenue = expectedAnnualRefundCost / cfg.operatorAnnualRevenue;
  const slaComplianceScore = Math.max(0, Math.min(1, 1 - probSlaBreach * 20));
  const isCompliantUkgcRts14f = probSlaBreach <= 0.05 && cfg.slaThresholdMs <= 500;
  return {
    meanLatencyMs, p99LatencyMs, probSlaBreach,
    expectedDailyBreaches, expectedAnnualBreaches,
    expectedAnnualRefundCost, refundCostShareOfRevenue,
    slaComplianceScore, isCompliantUkgcRts14f,
  };
}

function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StreamLatencyMcResult {
  episodes: number;
  observedProbSlaBreach: number;
}

export function simulateStreamLatency(cfg: StreamLatencyConfig, seed: number, episodes: number): StreamLatencyMcResult {
  validate(cfg);
  if (!Number.isInteger(episodes) || episodes < 100) throw new Error('episodes ≥ 100');
  const rng = makeRng(seed);
  const muLog = Math.log(cfg.medianLatencyMs);
  let breaches = 0;
  for (let i = 0; i < episodes; i++) {
    let u1 = rng(); while (u1 < 1e-15) u1 = rng();
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const latency = Math.exp(muLog + cfg.latencyLogStd * z);
    if (latency > cfg.slaThresholdMs) breaches++;
  }
  return { episodes, observedProbSlaBreach: breaches / episodes };
}
