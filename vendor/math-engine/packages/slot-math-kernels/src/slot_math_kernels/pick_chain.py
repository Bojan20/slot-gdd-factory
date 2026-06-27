"""W244 wave 13 — closed-form analytical model for `pick_chain` features.

Industry pattern (multi-level pick bonus, Microgaming Mega Moolah pick-pot,
NetEnt "Hall of Spins" tier wheel, Aristocrat "Mighty Cash" pick chain):

  Pick chain dynamics
  -------------------
    Player enters a pick screen with N options. Each option reveals
    either a CREDIT award (value × bet) or a NEXT-LEVEL token. The
    bonus terminates when:
      (a) a "collect" / "end" symbol is revealed, OR
      (b) max_levels reached, OR
      (c) all picks on the current level have been chosen.

    Each level can have its own pick pool (number of options) and
    award table. Levels typically escalate — higher level = larger
    awards but smaller probability of advancing.

  Closed-form RTP contribution
  ----------------------------
    For a single trigger:

      E[total_award | trigger] = sum_over_levels(
          P(reach level L) × E[award per pick at L] × E[picks at L]
      )

    where P(reach level L) is the product over levels < L of the
    "advance probability" for that level.

  Per-spin RTP
  ------------
    RTP[pick_chain] = trigger_p × E[total_award | trigger]

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_pick_chain_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_pick_chain_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PickLevel:
    """One level of a pick chain."""
    name: str                                 # "level_1" | "bronze" | etc.
    pool_size: int                            # number of options on screen
    # {credit_award_x_bet: count_on_pool}
    # Special key 0.0 = "end / collect" symbol that terminates the bonus.
    # Special key -1.0 = "advance token" that moves to next level WITHOUT
    # contributing credit; counted separately for advance probability.
    award_distribution: dict[float, int]

    def __post_init__(self):
        if self.pool_size <= 0:
            raise ValueError(f"pool_size {self.pool_size} must be > 0")
        if not self.award_distribution:
            raise ValueError("award_distribution must be non-empty")
        total_count = sum(self.award_distribution.values())
        if total_count != self.pool_size:
            raise ValueError(
                f"award_distribution counts ({total_count}) must equal "
                f"pool_size ({self.pool_size})"
            )
        if any(c < 0 for c in self.award_distribution.values()):
            raise ValueError("award_distribution counts must be ≥ 0")


@dataclass(frozen=True)
class PickChainParams:
    """Closed-form model inputs."""
    trigger_p: float                          # P(pick bonus triggers per spin)
    levels: tuple[PickLevel, ...]             # ordered low → high

    def __post_init__(self):
        if not (0.0 <= self.trigger_p <= 1.0):
            raise ValueError(f"trigger_p {self.trigger_p} outside [0,1]")
        if not self.levels:
            raise ValueError("levels must be non-empty")


# ─── Closed-form helpers ─────────────────────────────────────────────


def level_advance_probability(level: PickLevel) -> float:
    """P(advance to next level | enter this level, ONE pick).

    Probability = count(advance tokens, key=-1.0) / pool_size.
    """
    advance_count = level.award_distribution.get(-1.0, 0)
    return advance_count / level.pool_size


def level_end_probability(level: PickLevel) -> float:
    """P(bonus ends on this pick) = count(end / collect) / pool_size."""
    end_count = level.award_distribution.get(0.0, 0)
    return end_count / level.pool_size


def level_credit_probability(level: PickLevel) -> float:
    """P(this pick reveals a normal credit award, NOT advance NOT end)."""
    return 1.0 - level_advance_probability(level) - level_end_probability(level)


def expected_credit_per_pick(level: PickLevel) -> float:
    """E[credit × bet | pick reveals credit (not end, not advance)].

    Conditional expectation over the credit awards only.
    """
    total_credit_count = 0
    weighted_sum = 0.0
    for award, cnt in level.award_distribution.items():
        if award > 0:  # only credit awards (skip end=0, advance=-1)
            total_credit_count += cnt
            weighted_sum += award * cnt
    if total_credit_count == 0:
        return 0.0
    return weighted_sum / total_credit_count


def expected_picks_at_level(level: PickLevel) -> float:
    """E[number of picks before bonus ends on this level | entering this level].

    With pool_size n and `end_count` end tokens distributed uniformly,
    picks follow a hypergeometric-like distribution. Assuming the player
    picks until the first end-token OR pool exhaustion:

      E[picks] = sum_{k=1..n} P(end on k-th pick) × k
               + P(all picks exhausted) × n

    For a uniform distribution this is the expected position of the
    first end-token + 1, capped at n.

    Closed form: if there are E end-tokens uniformly placed, E[position
    of first end] = (n + 1) / (E + 1). If E = 0, all n picks taken.
    """
    n = level.pool_size
    end_count = level.award_distribution.get(0.0, 0)
    if end_count == 0:
        return float(n)
    # First-order statistic of E end-tokens among n positions
    return (n + 1.0) / (end_count + 1.0)


def expected_level_credit_contribution(level: PickLevel) -> float:
    """E[total credit from this level | entering this level].

    = E[picks] × P(pick is credit) × E[credit | credit].

    NOTE: this assumes credit/end/advance are uniformly mixed in the
    pool, which is the standard public-spec assumption. Specific
    weighted-placement variants (e.g. end-token guaranteed in last
    quarter) would need a Monte Carlo addendum.
    """
    return (
        expected_picks_at_level(level)
        * level_credit_probability(level)
        * expected_credit_per_pick(level)
    )


def expected_total_award(params: PickChainParams) -> float:
    """E[total bonus award | trigger].

    DP up the level ladder: P(reach level L) × E[credit at L].
    Level L+1 is reached only if level L issued an advance token before
    an end token. Assuming uniform pool, P(advance) = advance/n; but
    multiple picks per level can fire either token. Simplified rule:
    if ANY of E[picks] picks at this level reveals an advance token,
    advance to next level. With expected picks ≈ first-end-position,
    and advance/end uniformly distributed, the probability that the
    first non-end token IS an advance is:

      P(advance | not end) = advance_count / (advance_count + credit_count)

    So P(reach L+1 | reach L) =
        (1 - P(level ends in credit-only run)) × P(advance | not end).

    A tractable closed-form approximation:

      P(reach next | reach this) = advance_p / (advance_p + end_p)
        if advance_p + end_p > 0 else 0
        (the relative odds an advance is hit before an end among the
        non-credit tokens).
    """
    total = 0.0
    p_reach = 1.0
    for level in params.levels:
        total += p_reach * expected_level_credit_contribution(level)
        # Advance probability to next level
        adv_p = level_advance_probability(level)
        end_p = level_end_probability(level)
        denom = adv_p + end_p
        if denom > 0:
            p_advance_given_terminate = adv_p / denom
        else:
            p_advance_given_terminate = 0.0
        p_reach *= p_advance_given_terminate
    return total


def pick_chain_rtp(params: PickChainParams) -> dict:
    """Full per-spin RTP contribution + per-level audit breakdown."""
    per_level = []
    p_reach = 1.0
    for level in params.levels:
        credit_p = level_credit_probability(level)
        end_p = level_end_probability(level)
        adv_p = level_advance_probability(level)
        e_credit = expected_credit_per_pick(level)
        e_picks = expected_picks_at_level(level)
        contrib = p_reach * expected_level_credit_contribution(level)
        per_level.append({
            "name": level.name,
            "pool_size": level.pool_size,
            "p_credit": credit_p,
            "p_end": end_p,
            "p_advance": adv_p,
            "expected_credit_per_pick": e_credit,
            "expected_picks": e_picks,
            "probability_reached": p_reach,
            "credit_contribution_x_bet": contrib,
        })
        denom = adv_p + end_p
        if denom > 0:
            p_reach *= adv_p / denom
        else:
            p_reach *= 0.0

    e_total = sum(L["credit_contribution_x_bet"] for L in per_level)
    rtp = params.trigger_p * e_total
    return {
        "rtp_contribution": rtp,
        "trigger_p": params.trigger_p,
        "expected_total_award_x_bet": e_total,
        "levels": per_level,
    }
