/**
 * PAR Sheet Generator — Faza 4.
 *
 * Produces a GLI-16 compliant PAR sheet from MC simulation results. Covers
 * RTP breakdown, hit frequency, volatility classification, win distribution
 * (log-scale HDR buckets), jackpot metrics, compliance, and statistical
 * confidence.
 *
 * The `formatPARSheet` function renders a human-readable ASCII art sheet
 * using box-drawing characters compatible with UTF-8 terminals.
 */

import type { IRSimResult } from '../engine/irSimulator.js';
import type { SlotGameIR } from '../ir/types.js';
import type { JackpotMetrics } from '../features/jackpotManager.js';

// ─── Constants ─────────────────────────────────────────────────────────────

export const HDR_THRESHOLDS = [
  0.1, 0.2, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 10.0, 15.0, 20.0, 30.0, 50.0,
  75.0, 100.0, 150.0, 200.0, 300.0, 500.0, 750.0, 1000.0, 1500.0, 2000.0,
  3000.0, 5000.0, 7500.0, 10000.0, 15000.0, 20000.0, 50000.0,
] as const;

const SCHEMA_VERSION = '1.0.0';
const ENGINE_VERSION = '0.4.0'; // Faza 4

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PARMeta {
  gameId: string;
  gameVersion: string;
  engineVersion: string;
  generatedAtUtc: string;
  totalSpins: number;
  seedsUsed: number;
  rngKind: string;
}

export interface RTPSection {
  totalRtpPct: number;
  baseRtpPct: number;
  freeSpinsRtpPct: number;
  holdAndWinRtpPct: number;
  cascadeRtpPct: number;
  jackpotRtpPct: number;
  targetRtpPct: number;
  rtpTolerancePct: number;
  withinTolerance: boolean;
}

export interface HitFreqSection {
  overallHitRatePct: number;
  /** Feature kind → 1-in-N. Infinity means never triggered. */
  featureFreq: Record<string, number>;
  avgFsSpins: number;
  avgHnwRespins: number;
}

export interface VolatilitySection {
  cv: number;
  variance: number;
  maxWinX: number;
  category: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'EXTREME';
}

export interface WinBucket {
  fromX: number;
  toX: number | null;
  count: number;
  probability: number;
  rtpContribution: number;
}

export interface ComplianceSection {
  jurisdictions: string[];
  rtpRangeRequired: [number, number];
  rtpWithinRequired: boolean;
  maxWinCapRequired: number;
  maxWinWithinCap: boolean;
  nearMissRule: string;
  ldwDisclosure: boolean;
  sessionTimeDisplay: boolean;
}

export interface StatisticalSection {
  ci95Low: number;
  ci95High: number;
  stdError: number;
  stdDevAcrossSeeds: number;
  confidenceAdequate: boolean;
}

export interface PARSheet {
  schemaVersion: string;
  meta: PARMeta;
  rtp: RTPSection;
  hitFrequency: HitFreqSection;
  volatility: VolatilitySection;
  winDistribution: WinBucket[];
  jackpots: JackpotMetrics[];
  compliance: ComplianceSection;
  statistics: StatisticalSection;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface PARConfig {
  gameId: string;
  gameVersion: string;
  targetRtpPct: number;
  rtpTolerancePct: number;
  maxWinCapX: number;
  jurisdictions: string[];
  rtpRangeRequired: [number, number];
  nearMissRule: string;
  ldwDisclosure: boolean;
  sessionTimeDisplay: boolean;
  seedsUsed: number;
  /** Per-spin win history for histogram (may be empty for large sims). */
  winHistory?: number[];
  jackpots?: JackpotMetrics[];
  /** Multi-seed RTP array for CI calculation. */
  seedRtps?: number[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Place a win value into the correct HDR bucket index. */
function bucketIndex(winX: number): number {
  if (winX <= 0) return 0; // bucket 0 = "no win" (below 0.1)
  for (let i = 0; i < HDR_THRESHOLDS.length; i++) {
    const lo = i === 0 ? 0 : HDR_THRESHOLDS[i - 1] ?? 0;
    const hi = HDR_THRESHOLDS[i] ?? Infinity;
    if (winX >= lo && winX < hi) return i; // bucket i covers [lo, hi)
  }
  // Above highest threshold — last bucket.
  return HDR_THRESHOLDS.length;
}

/** Build an empty win-distribution array covering all HDR buckets. */
function emptyBuckets(): WinBucket[] {
  // Bucket 0: no-win [0, HDR_THRESHOLDS[0])
  const buckets: WinBucket[] = [
    { fromX: 0, toX: HDR_THRESHOLDS[0] ?? 0.1, count: 0, probability: 0, rtpContribution: 0 },
  ];
  for (let i = 0; i < HDR_THRESHOLDS.length; i++) {
    const from = HDR_THRESHOLDS[i] ?? 0;
    const to = i < HDR_THRESHOLDS.length - 1 ? (HDR_THRESHOLDS[i + 1] ?? null) : null;
    buckets.push({ fromX: from, toX: to, count: 0, probability: 0, rtpContribution: 0 });
  }
  return buckets;
}

/** Classify volatility category from CV. */
function classifyVolatility(cv: number): VolatilitySection['category'] {
  if (cv < 1) return 'VERY_LOW';
  if (cv < 2) return 'LOW';
  if (cv < 5) return 'MEDIUM';
  if (cv < 10) return 'HIGH';
  if (cv < 20) return 'VERY_HIGH';
  return 'EXTREME';
}

/** Compute sample standard deviation from an array of numbers. */
function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Compute sample mean. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ─── Main generator ────────────────────────────────────────────────────────

export function generatePARSheet(
  result: IRSimResult,
  ir: SlotGameIR,
  config: PARConfig,
): PARSheet {
  const now = new Date().toISOString();
  const spins = result.spins;

  // ── Meta ──────────────────────────────────────────────────────────────
  const meta: PARMeta = {
    gameId: config.gameId,
    gameVersion: config.gameVersion,
    engineVersion: ENGINE_VERSION,
    generatedAtUtc: now,
    totalSpins: spins,
    seedsUsed: config.seedsUsed,
    rngKind: ir.rng.kind,
  };

  // ── RTP Section ────────────────────────────────────────────────────────
  const totalRtpPct = result.rtp * 100;
  const baseRtpPct = result.rtpBreakdown.base * 100;
  const freeSpinsRtpPct = result.rtpBreakdown.free_spins * 100;
  const holdAndWinRtpPct = result.rtpBreakdown.hold_and_win * 100;
  const cascadeRtpPct = result.rtpBreakdown.cascade * 100;

  const jackpots = config.jackpots ?? [];
  const jackpotRtpFraction = jackpots.reduce((s, j) => s + j.contributionRtp, 0);
  const jackpotRtpPct = jackpotRtpFraction * 100;

  const withinTolerance =
    Math.abs(totalRtpPct - config.targetRtpPct) <= config.rtpTolerancePct;

  const rtp: RTPSection = {
    totalRtpPct,
    baseRtpPct,
    freeSpinsRtpPct,
    holdAndWinRtpPct,
    cascadeRtpPct,
    jackpotRtpPct,
    targetRtpPct: config.targetRtpPct,
    rtpTolerancePct: config.rtpTolerancePct,
    withinTolerance,
  };

  // ── Hit Frequency Section ──────────────────────────────────────────────
  const featureFreq: Record<string, number> = { ...result.featureTriggerFreqs };

  // avgFsSpins: use max threshold from the FS feature if available.
  let avgFsSpins = 0;
  const fsFeature = ir.features.find((f) => f.kind === 'free_spins');
  if (fsFeature && fsFeature.kind === 'free_spins') {
    const thresholds = fsFeature.trigger.thresholds;
    if (thresholds) {
      const values = Object.values(thresholds).filter((v) => typeof v === 'number') as number[];
      if (values.length > 0) avgFsSpins = Math.max(...values);
    }
  }

  // avgHnwRespins: use respins_initial from H&W feature if available.
  let avgHnwRespins = 0;
  const hnwFeature = ir.features.find((f) => f.kind === 'hold_and_win');
  if (hnwFeature && hnwFeature.kind === 'hold_and_win') {
    avgHnwRespins = hnwFeature.respins_initial;
  }

  const hitFrequency: HitFreqSection = {
    overallHitRatePct: result.hitRate * 100,
    featureFreq,
    avgFsSpins,
    avgHnwRespins,
  };

  // ── Win Distribution ───────────────────────────────────────────────────
  const winHistory = config.winHistory ?? [];
  const buckets = emptyBuckets();

  if (winHistory.length > 0) {
    for (const win of winHistory) {
      const idx = bucketIndex(win);
      const bucket = buckets[idx];
      if (bucket) {
        bucket.count += 1;
        bucket.rtpContribution += win;
      }
    }
    const totalSpinsForDist = winHistory.length;
    for (const bucket of buckets) {
      bucket.probability = bucket.count / totalSpinsForDist;
      bucket.rtpContribution = bucket.rtpContribution / totalSpinsForDist;
    }
  }

  // ── Volatility Section ─────────────────────────────────────────────────
  let cv = 0;
  let variance = 0;
  if (winHistory.length > 1) {
    const mu = mean(winHistory);
    if (mu > 0) {
      const meanWin = mu;
      const squaredDiffs = winHistory.map((w) => (w - meanWin) ** 2);
      variance = squaredDiffs.reduce((s, d) => s + d, 0) / winHistory.length;
      cv = Math.sqrt(variance) / meanWin;
    }
  }

  const volatility: VolatilitySection = {
    cv,
    variance,
    maxWinX: result.maxWinX,
    category: classifyVolatility(cv),
  };

  // ── Compliance Section ─────────────────────────────────────────────────
  // Check against both the IR's compliance range and config's requirement.
  const irRange = ir.compliance.rtp_range_required;
  const cfgRange = config.rtpRangeRequired;

  // The RTP must fall within BOTH ranges (intersection).
  const loRequired = Math.max(irRange[0], cfgRange[0]);
  const hiRequired = Math.min(irRange[1], cfgRange[1]);
  const rtpWithinRequired = totalRtpPct >= loRequired && totalRtpPct <= hiRequired;

  const maxWinWithinCap = result.maxWinX <= config.maxWinCapX;

  const compliance: ComplianceSection = {
    jurisdictions: config.jurisdictions,
    rtpRangeRequired: cfgRange,
    rtpWithinRequired,
    maxWinCapRequired: config.maxWinCapX,
    maxWinWithinCap,
    nearMissRule: config.nearMissRule,
    ldwDisclosure: config.ldwDisclosure,
    sessionTimeDisplay: config.sessionTimeDisplay,
  };

  // ── Statistical Section ────────────────────────────────────────────────
  const seedRtps = config.seedRtps ?? [];
  let ci95Low: number;
  let ci95High: number;
  let stdError: number;
  let stdDevAcrossSeeds: number;

  if (seedRtps.length >= 2) {
    stdDevAcrossSeeds = sampleStdDev(seedRtps);
    stdError = stdDevAcrossSeeds / Math.sqrt(seedRtps.length);
    const seedMeanRtp = mean(seedRtps) * 100;
    ci95Low = seedMeanRtp - 1.96 * stdError * 100;
    ci95High = seedMeanRtp + 1.96 * stdError * 100;
  } else {
    // Single-seed: use CLT approximation based on hit rate.
    // stdError of proportion = sqrt(p*(1-p)/n); we use hitRate as p.
    const p = result.hitRate;
    stdError = spins > 0 ? Math.sqrt((p * (1 - p)) / spins) : 0;
    ci95Low = totalRtpPct - 1.96 * stdError * 100;
    ci95High = totalRtpPct + 1.96 * stdError * 100;
    stdDevAcrossSeeds = 0;
  }

  const statistics: StatisticalSection = {
    ci95Low,
    ci95High,
    stdError,
    stdDevAcrossSeeds,
    confidenceAdequate: stdError < 0.001, // < 0.1pp
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    meta,
    rtp,
    hitFrequency,
    volatility,
    winDistribution: buckets,
    jackpots,
    compliance,
    statistics,
  };
}

// ─── ASCII art formatter ───────────────────────────────────────────────────

/** Right-pad a string to the given width. */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** Format a floating-point number with a fixed number of decimal places. */
function fmt(n: number, decimals: number = 2): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : '∞';
}

const WIDTH = 72;
const HR = '═'.repeat(WIDTH - 2);

function header(title: string): string {
  const inner = ` ${title} `;
  const pad2 = Math.floor((WIDTH - 2 - inner.length) / 2);
  const fill = '═'.repeat(pad2);
  const right = '═'.repeat(WIDTH - 2 - pad2 - inner.length);
  return `╠${fill}${inner}${right}╣`;
}

function row(label: string, value: string): string {
  const lbl = `  ${label}`;
  const val = value;
  const gap = WIDTH - 2 - lbl.length - val.length - 2;
  return `║${lbl}${' '.repeat(Math.max(1, gap))}${val}  ║`;
}

function divider(): string {
  return `╠${HR}╣`;
}

function top(): string {
  return `╔${HR}╗`;
}

function bottom(): string {
  return `╚${HR}╝`;
}

function titleRow(text: string): string {
  const inner = `  ${text}`;
  return `║${pad(inner, WIDTH - 2)}║`;
}

export function formatPARSheet(par: PARSheet): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push(top());
  lines.push(titleRow(`PAR SHEET — ${par.meta.gameId} v${par.meta.gameVersion}`));
  lines.push(titleRow(`Generated: ${par.meta.generatedAtUtc}  Engine: ${par.meta.engineVersion}`));
  lines.push(titleRow(`Spins: ${par.meta.totalSpins.toLocaleString()}  Seeds: ${par.meta.seedsUsed}  RNG: ${par.meta.rngKind}`));

  // ── RTP ────────────────────────────────────────────────────────────────
  lines.push(divider());
  lines.push(header('RTP'));
  lines.push(row('Total RTP', `${fmt(par.rtp.totalRtpPct, 4)} %`));
  lines.push(row('  Base game', `${fmt(par.rtp.baseRtpPct, 4)} %`));
  lines.push(row('  Free Spins', `${fmt(par.rtp.freeSpinsRtpPct, 4)} %`));
  lines.push(row('  Hold & Win', `${fmt(par.rtp.holdAndWinRtpPct, 4)} %`));
  lines.push(row('  Cascade', `${fmt(par.rtp.cascadeRtpPct, 4)} %`));
  lines.push(row('  Jackpot', `${fmt(par.rtp.jackpotRtpPct, 4)} %`));
  lines.push(row('Target RTP', `${fmt(par.rtp.targetRtpPct, 2)} % ± ${fmt(par.rtp.rtpTolerancePct, 2)} %`));
  lines.push(row('Within tolerance', par.rtp.withinTolerance ? 'YES ✓' : 'NO ✗'));

  // ── HIT FREQUENCY ──────────────────────────────────────────────────────
  lines.push(divider());
  lines.push(header('HIT FREQUENCY'));
  lines.push(row('Overall hit rate', `${fmt(par.hitFrequency.overallHitRatePct, 3)} %`));
  if (par.hitFrequency.avgFsSpins > 0) {
    lines.push(row('Avg free-spin count', `${fmt(par.hitFrequency.avgFsSpins, 1)}`));
  }
  if (par.hitFrequency.avgHnwRespins > 0) {
    lines.push(row('Avg H&W respins', `${fmt(par.hitFrequency.avgHnwRespins, 1)}`));
  }
  for (const [kind, freq] of Object.entries(par.hitFrequency.featureFreq)) {
    const display = Number.isFinite(freq) ? `1-in-${fmt(freq, 1)}` : 'never';
    lines.push(row(`  ${kind}`, display));
  }

  // ── VOLATILITY ─────────────────────────────────────────────────────────
  lines.push(divider());
  lines.push(header('VOLATILITY'));
  lines.push(row('Category', par.volatility.category));
  lines.push(row('CV (σ/μ)', fmt(par.volatility.cv, 4)));
  lines.push(row('Variance', fmt(par.volatility.variance, 4)));
  lines.push(row('Max win observed', `${fmt(par.volatility.maxWinX, 2)} ×`));

  // ── WIN DISTRIBUTION ───────────────────────────────────────────────────
  lines.push(divider());
  lines.push(header('WIN DISTRIBUTION (top 10 non-empty buckets)'));
  const nonEmpty = par.winDistribution
    .filter((b) => b.count > 0)
    .sort((a, b) => b.rtpContribution - a.rtpContribution)
    .slice(0, 10);

  if (nonEmpty.length === 0) {
    lines.push(row('(no win data)', ''));
  } else {
    lines.push(row(pad('Range (×)', 22) + pad('Count', 12) + pad('Prob %', 12), 'RTP Contrib %'));
    for (const b of nonEmpty) {
      const range = b.toX === null
        ? `${fmt(b.fromX, 0)} +`
        : `${fmt(b.fromX, 1)} – ${fmt(b.toX, 1)}`;
      const label = pad(range, 22) + pad(b.count.toString(), 12) + pad(`${fmt(b.probability * 100, 4)}`, 12);
      lines.push(row(label, `${fmt(b.rtpContribution * 100, 4)}`));
    }
  }

  // ── JACKPOTS ───────────────────────────────────────────────────────────
  if (par.jackpots.length > 0) {
    lines.push(divider());
    lines.push(header('JACKPOTS'));
    for (const jp of par.jackpots) {
      lines.push(row(`  [${jp.kind}] ${jp.id} — ${jp.name}`, ''));
      lines.push(row('    Hits', `${jp.hits}`));
      lines.push(row('    Avg interval', Number.isFinite(jp.avgInterval) ? `${fmt(jp.avgInterval, 0)} spins` : 'never hit'));
      lines.push(row('    Total paid', `${fmt(jp.totalPaidX, 2)} ×`));
      lines.push(row('    Contribution RTP', `${fmt(jp.contributionRtp * 100, 4)} %`));
      lines.push(row('    Current pool', `${fmt(jp.currentPoolX, 2)} ×`));
    }
  }

  // ── COMPLIANCE ─────────────────────────────────────────────────────────
  lines.push(divider());
  lines.push(header('COMPLIANCE'));
  lines.push(row('Jurisdictions', par.compliance.jurisdictions.join(', ') || 'N/A'));
  lines.push(row('RTP range required', `${fmt(par.compliance.rtpRangeRequired[0], 1)} % – ${fmt(par.compliance.rtpRangeRequired[1], 1)} %`));
  lines.push(row('RTP within required range', par.compliance.rtpWithinRequired ? 'YES ✓' : 'NO ✗'));
  lines.push(row('Max win cap (×)', `${fmt(par.compliance.maxWinCapRequired, 0)}`));
  lines.push(row('Max win within cap', par.compliance.maxWinWithinCap ? 'YES ✓' : 'NO ✗'));
  lines.push(row('Near-miss rule', par.compliance.nearMissRule));
  lines.push(row('LDW disclosure', par.compliance.ldwDisclosure ? 'YES' : 'NO'));
  lines.push(row('Session time display', par.compliance.sessionTimeDisplay ? 'YES' : 'NO'));

  // ── STATISTICAL ────────────────────────────────────────────────────────
  lines.push(divider());
  lines.push(header('STATISTICAL'));
  lines.push(row('CI 95% low', `${fmt(par.statistics.ci95Low, 4)} %`));
  lines.push(row('CI 95% high', `${fmt(par.statistics.ci95High, 4)} %`));
  lines.push(row('Std error', fmt(par.statistics.stdError, 6)));
  lines.push(row('Std dev across seeds', fmt(par.statistics.stdDevAcrossSeeds, 6)));
  lines.push(row('Confidence adequate', par.statistics.confidenceAdequate ? 'YES ✓' : 'NO — increase spins'));

  lines.push(bottom());

  return lines.join('\n');
}
