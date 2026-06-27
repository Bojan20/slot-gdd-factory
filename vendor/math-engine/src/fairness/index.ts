/**
 * W152 Faza 14.8 — Fairness module barrel export.
 *
 * Statistical fairness across player segments. Pure-functional helpers
 * that take pre-tagged spin records and answer the regulator-facing
 * question: "Does every segment see the same expected RTP?"
 */

export {
  aggregateBySegment,
  chiSquareGoodnessOfFit,
  fairnessReport,
  pairwiseZ,
  pValueFromChiSquare,
  upperTailStandardNormal,
  type FairnessReport,
  type SegmentStats,
  type SpinRecord,
} from './segment-rtp.js';
