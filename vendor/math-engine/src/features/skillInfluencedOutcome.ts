/**
 * Faza 14.3 — Skill-influenced slot outcome modulator.
 *
 * Nevada Reg 14 §14.040(11) defines a "skill-influenced" slot game
 * category: a player's demonstrated skill at a bonus mini-game (e.g.
 * shoot-em-up, puzzle, reaction-time) modulates the outcome
 * distribution within a regulator-bounded envelope.
 *
 * The math contract (NGCB / NJ DGE):
 *
 *   1. **Base RTP floor** — an unskilled player achieves at least the
 *      declared `rtpFloor`. This is the regulator's safety net.
 *   2. **Skill ceiling** — an expert player can lift the realised RTP
 *      to (but not above) `rtpCeiling`. The delta `(ceiling − floor)`
 *      is the "skill swing".
 *   3. **Per-spin RTP** = `rtpFloor + skillScore × (rtpCeiling − rtpFloor)`
 *      where `skillScore ∈ [0, 1]`.
 *   4. **Audit trail** — every spin must record the skill input that
 *      determined the score, so the regulator can replay the session
 *      and verify the math was applied honestly.
 *
 * This module provides the **pure math** modulator only. The skill
 * mini-game UI / scoring logic lives in the game's bonus state
 * machine; that module reports a `skillScore` per spin, and the
 * modulator applies it to the evaluator output.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SkillEnvelope {
  /** Achievable by an unskilled player (Reg 14 §14.040(11)). */
  readonly rtpFloor: number;
  /** Achievable by an expert (≥ floor + 0.01 per Reg 14 minimum swing). */
  readonly rtpCeiling: number;
  /**
   * Modulator mode:
   *   - 'multiplier' — win is scaled by `realisedRtp / declaredRtp`.
   *   - 'weighting'  — pre-spin reel weights are re-balanced. Out of
   *                    scope here (handled in `src/optimizer/`).
   */
  readonly mode?: 'multiplier' | 'weighting';
}

export interface SkillModulationInput {
  /** Pre-modulation win amount (from the base evaluator). */
  readonly rawWin: number;
  /** Declared base-game RTP — used as the multiplier denominator. */
  readonly declaredRtp: number;
  /** Player's skill score for this spin, in [0, 1]. */
  readonly skillScore: number;
  /** Skill envelope from the IR. */
  readonly envelope: SkillEnvelope;
}

export interface SkillAuditRecord {
  readonly skillScore: number;
  readonly realisedRtp: number;
  readonly declaredRtp: number;
  readonly multiplier: number;
  readonly rawWin: number;
  readonly modulatedWin: number;
}

// ─── Modulator ────────────────────────────────────────────────────────────────

export interface SkillModulationResult {
  /** Win after skill modulation, rounded toward zero (cents → cents). */
  readonly modulatedWin: number;
  /** Realised RTP this spin (between floor and ceiling). */
  readonly realisedRtp: number;
  /** Multiplier applied to `rawWin`. */
  readonly multiplier: number;
  /** Audit record for the regulator-required replay log. */
  readonly audit: SkillAuditRecord;
}

/**
 * Apply the skill modulator. Pure function. Throws when the envelope
 * is malformed (regulator-rejection territory — fail fast at config
 * load, not on the hot path).
 */
export function applySkillModulation(input: SkillModulationInput): SkillModulationResult {
  const { rawWin, declaredRtp, skillScore, envelope } = input;

  if (!Number.isFinite(declaredRtp) || declaredRtp <= 0) {
    throw new RangeError('applySkillModulation: declaredRtp must be > 0');
  }
  if (!Number.isFinite(envelope.rtpFloor) || envelope.rtpFloor <= 0) {
    throw new RangeError('applySkillModulation: envelope.rtpFloor must be > 0');
  }
  if (!Number.isFinite(envelope.rtpCeiling) || envelope.rtpCeiling <= envelope.rtpFloor) {
    throw new RangeError(
      'applySkillModulation: envelope.rtpCeiling must exceed envelope.rtpFloor'
    );
  }
  // Reg 14 §14.040(11) explicit minimum swing.
  if (envelope.rtpCeiling - envelope.rtpFloor < 0.01) {
    throw new RangeError(
      'applySkillModulation: envelope swing must be ≥ 0.01 (Reg 14 §14.040(11))'
    );
  }
  if (!Number.isFinite(skillScore)) {
    throw new RangeError('applySkillModulation: skillScore must be finite');
  }

  // Clamp skill score into [0, 1] — accept noisy input from the bonus
  // mini-game without panicking the math engine.
  const clampedSkill = Math.max(0, Math.min(1, skillScore));
  const realisedRtp =
    envelope.rtpFloor + clampedSkill * (envelope.rtpCeiling - envelope.rtpFloor);
  const multiplier = realisedRtp / declaredRtp;
  // Truncate toward zero so currency rounding is conservative (no
  // free credits from float drift).
  const modulatedWin = Math.trunc(rawWin * multiplier);

  return {
    modulatedWin,
    realisedRtp,
    multiplier,
    audit: {
      skillScore: clampedSkill,
      realisedRtp,
      declaredRtp,
      multiplier,
      rawWin,
      modulatedWin,
    },
  };
}
