/**
 * W152 P1-8 — PAR sheet versioning + diff.
 *
 * GLI-19 §3.3.4 + UKGC RTS 7 mandate that **every** RTP change creates
 * a new certified game. A PAR-sheet diff is the operational unit that
 * tells engineering "this change forces a re-certification".
 *
 * This module deliberately consumes the existing `PARSheet` type from
 * `src/statistics/parSheet.ts` rather than introducing a parallel
 * schema. The diff is a pure function over two PARSheet snapshots: no
 * IO, no engine state, no jurisdiction lookup. Higher-level tooling
 * (cert pipeline, dashboard) layers regulatory routing on top.
 *
 * Output shape:
 *   * `summary` — six booleans flagging the most common
 *     re-certification triggers (RTP, max-win, volatility, jackpot,
 *     compliance, jurisdictions). The cert pipeline filters by
 *     `summary.requiresRecertification`.
 *   * `details` — per-section numeric deltas. Empty when nothing
 *     changed in that section. Field names mirror `PARSheet` so
 *     reviewers can grep across the codebase.
 *
 * Numerical conventions:
 *   * All deltas are `next − previous` so a positive delta means "the
 *     new version increased the value".
 *   * Booleans diff as a `{previous, next}` pair, never collapsed —
 *     audit trail must preserve both observations.
 *   * RTP deltas are reported in **percentage points** (so a 96.5 →
 *     97.0 move shows up as `+0.5`, not `+0.005`).
 */

import type {
  ComplianceSection,
  HitFreqSection,
  PARSheet,
  RTPSection,
  StatisticalSection,
  VolatilitySection,
} from '../../statistics/parSheet.js';

// ─── Output types ──────────────────────────────────────────────────────────

export interface RTPDelta {
  totalRtpPct?: number;
  baseRtpPct?: number;
  freeSpinsRtpPct?: number;
  holdAndWinRtpPct?: number;
  cascadeRtpPct?: number;
  jackpotRtpPct?: number;
  targetRtpPct?: number;
  rtpTolerancePct?: number;
  withinTolerance?: { previous: boolean; next: boolean };
}

export interface HitFreqDelta {
  overallHitRatePct?: number;
  avgFsSpins?: number;
  avgHnwRespins?: number;
  /** Feature name → previous + next, only when the trigger frequency changed. */
  featureFreq?: Record<string, { previous: number; next: number }>;
}

export interface VolatilityDelta {
  cv?: number;
  variance?: number;
  maxWinX?: number;
  category?: { previous: VolatilitySection['category']; next: VolatilitySection['category'] };
}

export interface ComplianceDelta {
  jurisdictionsAdded?: string[];
  jurisdictionsRemoved?: string[];
  rtpRangeRequired?: { previous: [number, number]; next: [number, number] };
  rtpWithinRequired?: { previous: boolean; next: boolean };
  maxWinCapRequired?: number;
  maxWinWithinCap?: { previous: boolean; next: boolean };
  nearMissRule?: { previous: string; next: string };
  ldwDisclosure?: { previous: boolean; next: boolean };
  sessionTimeDisplay?: { previous: boolean; next: boolean };
}

export interface StatisticalDelta {
  ci95Low?: number;
  ci95High?: number;
  stdError?: number;
  stdDevAcrossSeeds?: number;
  confidenceAdequate?: { previous: boolean; next: boolean };
}

export interface PARDiffSummary {
  /** Any RTP-bearing field moved. */
  rtpChanged: boolean;
  /** Max-win cap moved (regulatory critical — UK RTS 7). */
  maxWinChanged: boolean;
  /** Volatility category moved (e.g. HIGH → ULTRA). */
  volatilityCategoryChanged: boolean;
  /** Jackpot list changed (tiers added/removed/repaid). */
  jackpotsChanged: boolean;
  /** Compliance flag(s) flipped or jurisdiction set changed. */
  complianceChanged: boolean;
  /**
   * Aggregate: any combination of (rtp | maxWin | volatilityCategory |
   * jackpots | complianceJurisdictions) demands a new cert. Other
   * deltas (hit-rate, CI) require operator review but not a fresh
   * cert run — flagged via `summary.requiresOperatorReview`.
   */
  requiresRecertification: boolean;
  /** Hit-rate or statistical confidence moved past human-review threshold. */
  requiresOperatorReview: boolean;
}

export interface PARDiff {
  /** `next.meta.gameVersion` for cross-reference in audit dossier. */
  gameVersionPrev: string;
  gameVersionNext: string;
  generatedAtPrev: string;
  generatedAtNext: string;
  summary: PARDiffSummary;
  details: {
    rtp: RTPDelta;
    hitFrequency: HitFreqDelta;
    volatility: VolatilityDelta;
    compliance: ComplianceDelta;
    statistics: StatisticalDelta;
  };
}

// ─── Tolerances ────────────────────────────────────────────────────────────

/**
 * RTP delta below this is treated as Monte-Carlo noise and does NOT
 * trigger a re-cert. 0.005 % matches the Faza 10.5 acceptance gate.
 */
const RTP_NOISE_PCT = 0.005;

/**
 * Hit-rate change above this triggers operator review. 0.5 % is
 * roughly two standard errors at 10⁷ spins — a real shift not
 * Monte-Carlo noise.
 */
const HIT_RATE_REVIEW_PCT = 0.5;

/** Max-win cap is an integer multiplier — any change is significant. */
const MAX_WIN_NOISE_X = 0.0;

// ─── Helpers ───────────────────────────────────────────────────────────────

function diffNumber(
  previous: number,
  next: number,
  noise: number,
): number | undefined {
  const delta = next - previous;
  return Math.abs(delta) > noise ? Number(delta.toFixed(6)) : undefined;
}

function diffBool(
  previous: boolean,
  next: boolean,
): { previous: boolean; next: boolean } | undefined {
  return previous === next ? undefined : { previous, next };
}

function diffString<T extends string>(
  previous: T,
  next: T,
): { previous: T; next: T } | undefined {
  return previous === next ? undefined : { previous, next };
}

function diffTuple(
  previous: [number, number],
  next: [number, number],
): { previous: [number, number]; next: [number, number] } | undefined {
  if (previous[0] === next[0] && previous[1] === next[1]) return undefined;
  return { previous, next };
}

function setSymmetricDiff(
  previous: readonly string[],
  next: readonly string[],
): { added: string[]; removed: string[] } {
  const prevSet = new Set(previous);
  const nextSet = new Set(next);
  const added = [...nextSet].filter((x) => !prevSet.has(x)).sort();
  const removed = [...prevSet].filter((x) => !nextSet.has(x)).sort();
  return { added, removed };
}

// ─── Section diffs ─────────────────────────────────────────────────────────

function diffRtp(a: RTPSection, b: RTPSection): RTPDelta {
  const out: RTPDelta = {};
  const totalRtp = diffNumber(a.totalRtpPct, b.totalRtpPct, RTP_NOISE_PCT);
  if (totalRtp !== undefined) out.totalRtpPct = totalRtp;
  const base = diffNumber(a.baseRtpPct, b.baseRtpPct, RTP_NOISE_PCT);
  if (base !== undefined) out.baseRtpPct = base;
  const fs = diffNumber(a.freeSpinsRtpPct, b.freeSpinsRtpPct, RTP_NOISE_PCT);
  if (fs !== undefined) out.freeSpinsRtpPct = fs;
  const hnw = diffNumber(a.holdAndWinRtpPct, b.holdAndWinRtpPct, RTP_NOISE_PCT);
  if (hnw !== undefined) out.holdAndWinRtpPct = hnw;
  const casc = diffNumber(a.cascadeRtpPct, b.cascadeRtpPct, RTP_NOISE_PCT);
  if (casc !== undefined) out.cascadeRtpPct = casc;
  const jp = diffNumber(a.jackpotRtpPct, b.jackpotRtpPct, RTP_NOISE_PCT);
  if (jp !== undefined) out.jackpotRtpPct = jp;
  const target = diffNumber(a.targetRtpPct, b.targetRtpPct, RTP_NOISE_PCT);
  if (target !== undefined) out.targetRtpPct = target;
  const tol = diffNumber(a.rtpTolerancePct, b.rtpTolerancePct, RTP_NOISE_PCT);
  if (tol !== undefined) out.rtpTolerancePct = tol;
  const within = diffBool(a.withinTolerance, b.withinTolerance);
  if (within) out.withinTolerance = within;
  return out;
}

function diffHitFreq(a: HitFreqSection, b: HitFreqSection): HitFreqDelta {
  const out: HitFreqDelta = {};
  const hr = diffNumber(a.overallHitRatePct, b.overallHitRatePct, HIT_RATE_REVIEW_PCT);
  if (hr !== undefined) out.overallHitRatePct = hr;
  const fs = diffNumber(a.avgFsSpins, b.avgFsSpins, 0.01);
  if (fs !== undefined) out.avgFsSpins = fs;
  const hnw = diffNumber(a.avgHnwRespins, b.avgHnwRespins, 0.01);
  if (hnw !== undefined) out.avgHnwRespins = hnw;
  const ff: Record<string, { previous: number; next: number }> = {};
  const allKeys = new Set([
    ...Object.keys(a.featureFreq ?? {}),
    ...Object.keys(b.featureFreq ?? {}),
  ]);
  for (const k of allKeys) {
    const av = a.featureFreq?.[k] ?? Number.POSITIVE_INFINITY;
    const bv = b.featureFreq?.[k] ?? Number.POSITIVE_INFINITY;
    if (av !== bv) ff[k] = { previous: av, next: bv };
  }
  if (Object.keys(ff).length > 0) out.featureFreq = ff;
  return out;
}

function diffVolatility(
  a: VolatilitySection,
  b: VolatilitySection,
): VolatilityDelta {
  const out: VolatilityDelta = {};
  const cv = diffNumber(a.cv, b.cv, 0.001);
  if (cv !== undefined) out.cv = cv;
  const variance = diffNumber(a.variance, b.variance, 0.0001);
  if (variance !== undefined) out.variance = variance;
  const maxw = diffNumber(a.maxWinX, b.maxWinX, MAX_WIN_NOISE_X);
  if (maxw !== undefined) out.maxWinX = maxw;
  const cat = diffString(a.category, b.category);
  if (cat) out.category = cat;
  return out;
}

function diffCompliance(
  a: ComplianceSection,
  b: ComplianceSection,
): ComplianceDelta {
  const out: ComplianceDelta = {};
  const j = setSymmetricDiff(a.jurisdictions, b.jurisdictions);
  if (j.added.length > 0) out.jurisdictionsAdded = j.added;
  if (j.removed.length > 0) out.jurisdictionsRemoved = j.removed;
  const range = diffTuple(a.rtpRangeRequired, b.rtpRangeRequired);
  if (range) out.rtpRangeRequired = range;
  const rwr = diffBool(a.rtpWithinRequired, b.rtpWithinRequired);
  if (rwr) out.rtpWithinRequired = rwr;
  const mwc = diffNumber(a.maxWinCapRequired, b.maxWinCapRequired, MAX_WIN_NOISE_X);
  if (mwc !== undefined) out.maxWinCapRequired = mwc;
  const mww = diffBool(a.maxWinWithinCap, b.maxWinWithinCap);
  if (mww) out.maxWinWithinCap = mww;
  const nm = diffString(a.nearMissRule, b.nearMissRule);
  if (nm) out.nearMissRule = nm;
  const ldw = diffBool(a.ldwDisclosure, b.ldwDisclosure);
  if (ldw) out.ldwDisclosure = ldw;
  const sess = diffBool(a.sessionTimeDisplay, b.sessionTimeDisplay);
  if (sess) out.sessionTimeDisplay = sess;
  return out;
}

function diffStatistics(
  a: StatisticalSection,
  b: StatisticalSection,
): StatisticalDelta {
  const out: StatisticalDelta = {};
  const ciLo = diffNumber(a.ci95Low, b.ci95Low, 0.001);
  if (ciLo !== undefined) out.ci95Low = ciLo;
  const ciHi = diffNumber(a.ci95High, b.ci95High, 0.001);
  if (ciHi !== undefined) out.ci95High = ciHi;
  const se = diffNumber(a.stdError, b.stdError, 0.0001);
  if (se !== undefined) out.stdError = se;
  const sd = diffNumber(a.stdDevAcrossSeeds, b.stdDevAcrossSeeds, 0.0001);
  if (sd !== undefined) out.stdDevAcrossSeeds = sd;
  const conf = diffBool(a.confidenceAdequate, b.confidenceAdequate);
  if (conf) out.confidenceAdequate = conf;
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Compare two PAR sheets and emit a structured diff.
 *
 * Schema-version check: both sheets MUST share `schemaVersion`. A
 * version bump is considered a structural change that the diff
 * function refuses to interpret — call sites must migrate first.
 */
export function diffParSheets(previous: PARSheet, next: PARSheet): PARDiff {
  if (previous.schemaVersion !== next.schemaVersion) {
    throw new Error(
      `PAR sheet schema mismatch: ${previous.schemaVersion} vs ${next.schemaVersion}`,
    );
  }

  const rtp = diffRtp(previous.rtp, next.rtp);
  const hitFrequency = diffHitFreq(previous.hitFrequency, next.hitFrequency);
  const volatility = diffVolatility(previous.volatility, next.volatility);
  const compliance = diffCompliance(previous.compliance, next.compliance);
  const statistics = diffStatistics(previous.statistics, next.statistics);

  const rtpChanged =
    rtp.totalRtpPct !== undefined ||
    rtp.baseRtpPct !== undefined ||
    rtp.freeSpinsRtpPct !== undefined ||
    rtp.holdAndWinRtpPct !== undefined ||
    rtp.cascadeRtpPct !== undefined ||
    rtp.jackpotRtpPct !== undefined ||
    rtp.targetRtpPct !== undefined ||
    rtp.withinTolerance !== undefined;
  const maxWinChanged =
    volatility.maxWinX !== undefined ||
    compliance.maxWinCapRequired !== undefined ||
    compliance.maxWinWithinCap !== undefined;
  const volatilityCategoryChanged = volatility.category !== undefined;
  // Jackpot list: shallow compare by id + multiplier.
  const jackpotsChanged = !sameJackpots(previous.jackpots, next.jackpots);
  const complianceChanged =
    (compliance.jurisdictionsAdded?.length ?? 0) > 0 ||
    (compliance.jurisdictionsRemoved?.length ?? 0) > 0 ||
    compliance.rtpRangeRequired !== undefined ||
    compliance.nearMissRule !== undefined ||
    compliance.ldwDisclosure !== undefined ||
    compliance.sessionTimeDisplay !== undefined;

  const requiresRecertification =
    rtpChanged || maxWinChanged || volatilityCategoryChanged || jackpotsChanged ||
    (compliance.jurisdictionsAdded?.length ?? 0) > 0 ||
    (compliance.jurisdictionsRemoved?.length ?? 0) > 0;
  const requiresOperatorReview =
    hitFrequency.overallHitRatePct !== undefined ||
    statistics.confidenceAdequate !== undefined ||
    complianceChanged;

  return {
    gameVersionPrev: previous.meta.gameVersion,
    gameVersionNext: next.meta.gameVersion,
    generatedAtPrev: previous.meta.generatedAtUtc,
    generatedAtNext: next.meta.generatedAtUtc,
    summary: {
      rtpChanged,
      maxWinChanged,
      volatilityCategoryChanged,
      jackpotsChanged,
      complianceChanged,
      requiresRecertification,
      requiresOperatorReview,
    },
    details: { rtp, hitFrequency, volatility, compliance, statistics },
  };
}

// PARSheet jackpots are `JackpotMetrics[]`; shallow compare by id + tier.
function sameJackpots(
  a: PARSheet['jackpots'],
  b: PARSheet['jackpots'],
): boolean {
  if (a.length !== b.length) return false;
  // Sort by id so cosmetic order changes don't trigger a diff.
  const sortFn = (x: PARSheet['jackpots'][number], y: typeof x) =>
    (x.id ?? '').localeCompare(y.id ?? '');
  const ax = [...a].sort(sortFn);
  const bx = [...b].sort(sortFn);
  for (let i = 0; i < ax.length; i++) {
    if (JSON.stringify(ax[i]) !== JSON.stringify(bx[i])) return false;
  }
  return true;
}

/**
 * Format a `PARDiff` as a single-line "headline" suitable for CI logs.
 *
 * Examples:
 *   "PAR diff v1.2 → v1.3: RTP +0.18pp; cert RE-REQUIRED"
 *   "PAR diff v2.0 → v2.0: clean"
 *   "PAR diff v1.5 → v1.6: hit-rate -0.7pp; review needed"
 */
export function formatDiffHeadline(diff: PARDiff): string {
  const parts: string[] = [];
  const { details, summary } = diff;
  if (details.rtp.totalRtpPct !== undefined) {
    const sign = details.rtp.totalRtpPct >= 0 ? '+' : '';
    parts.push(`RTP ${sign}${details.rtp.totalRtpPct}pp`);
  }
  if (details.volatility.category) {
    parts.push(
      `volatility ${details.volatility.category.previous}→${details.volatility.category.next}`,
    );
  }
  if (details.compliance.jurisdictionsAdded?.length) {
    parts.push(`+jx:${details.compliance.jurisdictionsAdded.join(',')}`);
  }
  if (details.compliance.jurisdictionsRemoved?.length) {
    parts.push(`-jx:${details.compliance.jurisdictionsRemoved.join(',')}`);
  }
  if (details.hitFrequency.overallHitRatePct !== undefined) {
    const sign = details.hitFrequency.overallHitRatePct >= 0 ? '+' : '';
    parts.push(`hit-rate ${sign}${details.hitFrequency.overallHitRatePct}pp`);
  }
  const verdict = summary.requiresRecertification
    ? 'cert RE-REQUIRED'
    : summary.requiresOperatorReview
      ? 'review needed'
      : 'clean';
  const body = parts.length > 0 ? parts.join('; ') : 'no material change';
  return `PAR diff v${diff.gameVersionPrev} → v${diff.gameVersionNext}: ${body}; ${verdict}`;
}
