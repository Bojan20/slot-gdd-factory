"""W244 wave 12 — closed-form analytical model for `must_hit_by` jackpots.

Industry pattern (NGCB-style Mystery Jackpot, IGT "Must Hit By" pots,
Aristocrat "Lightning Link" guaranteed-strike pots, ScientificGames
"Dollar Storm" mystery levels):

  Mystery jackpot dynamics
  ------------------------
    A Mystery pot is seeded at `seed_x_bet` and grows by `contribution_x`
    fraction of every bet across the network. The pot is **guaranteed to
    hit by** `must_hit_by_x_bet` total cumulative bet — i.e. when pot
    value reaches that cap, a forced strike fires regardless of normal
    triggers.

    Two trigger modes per spin:
      (a) Normal random trigger: P(strike) per spin (often tied to
          symbol landings or a separate weighted roll).
      (b) Forced strike: if pot value reaches `must_hit_by_x_bet`
          before a normal trigger, the next spin MUST hit.

  Closed-form RTP contribution
  ----------------------------
    Per-spin RTP contribution from a single mystery pot:

        contrib_x_per_spin = total_contribution_x  (constant — paid out)

    By conservation: every dollar contributed eventually pays out. So
    the long-run RTP contribution from the pot equals the per-spin
    contribution rate. No probability needed; it's a flow argument.

    The interesting closed-form is the EXPECTED STRIKE AMOUNT
    distribution given the spread between seed and must-hit-by cap.
    If `p_strike` is the per-spin natural trigger probability and
    pot grows linearly:

        E[strike_at] = ∫_0^must-hit-by  (pot_value × P(strike at this value)) dx
                       + must_hit_by_x_bet × P(forced)

    where P(forced) = (1 - p_strike)^expected_spins_to_reach_cap.

    Simplification (most common form):
      * If `p_strike` is small, geometric arrival with mean
        E[arrival_bets] = 1 / p_strike.
      * If E[arrival_bets] < spins_to_cap: natural trigger first
        → E[strike] ≈ seed + (1/p_strike) × contribution_x × bet.
      * Otherwise: forced strike at cap →
        E[strike] = must_hit_by_x_bet.

  Multi-pot ladders
  -----------------
    Mini / minor / major / grand stacks are independent — each pot
    has its own (seed, contribution, must_hit_by) tuple. RTP
    contributions sum linearly.

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_must_hit_by_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_must_hit_by_kernel.py` for pin
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class MustHitByPot:
    """One mystery pot tier."""
    name: str                        # "mini" | "minor" | "major" | "grand"
    seed_x_bet: float                # initial pot value (in × current bet)
    contribution_x: float            # per-bet contribution share (0..1)
    must_hit_by_x_bet: float         # guaranteed-strike cap
    p_strike_per_spin: float = 1e-6  # natural strike probability per spin

    def __post_init__(self):
        if self.seed_x_bet < 0:
            raise ValueError(f"seed_x_bet {self.seed_x_bet} must be ≥ 0")
        if not (0.0 < self.contribution_x < 1.0):
            raise ValueError(
                f"contribution_x {self.contribution_x} must be in (0, 1)"
            )
        if self.must_hit_by_x_bet <= self.seed_x_bet:
            raise ValueError(
                f"must_hit_by_x_bet ({self.must_hit_by_x_bet}) must exceed "
                f"seed_x_bet ({self.seed_x_bet})"
            )
        if not (0.0 <= self.p_strike_per_spin <= 1.0):
            raise ValueError(
                f"p_strike_per_spin {self.p_strike_per_spin} outside [0,1]"
            )


@dataclass(frozen=True)
class MustHitByParams:
    """Closed-form model inputs (one or more pots)."""
    pots: tuple[MustHitByPot, ...]

    def __post_init__(self):
        if not self.pots:
            raise ValueError("pots must be non-empty")


def expected_spins_to_cap(pot: MustHitByPot) -> float:
    """E[spins for pot to grow from seed to must_hit_by_x_bet].

    Pot grows by `contribution_x × bet` per spin. With bet = 1 (× bet
    accounting), the pot increment per spin is `contribution_x`.

    spins_to_cap = (must_hit_by - seed) / contribution_x.
    """
    delta = pot.must_hit_by_x_bet - pot.seed_x_bet
    return delta / pot.contribution_x


def probability_forced_strike(pot: MustHitByPot) -> float:
    """P(no natural strike before cap reached) = (1 - p_strike)^spins_to_cap."""
    n = expected_spins_to_cap(pot)
    # For small p_strike, (1-p)^n ≈ exp(-n*p)
    p = pot.p_strike_per_spin
    if p == 0:
        return 1.0
    if p == 1:
        return 0.0 if n > 0 else 1.0
    # Use log for numerical stability when n is large
    log_p_no_strike = n * math.log1p(-p)
    return math.exp(log_p_no_strike)


def expected_strike_value(pot: MustHitByPot) -> float:
    """E[pot value at strike] in × bet units.

    Decomposed:
      * Natural strike (P = 1 - forced_p): expected pot growth from seed
        following geometric arrival with mean 1/p_strike spins.
      * Forced strike (P = forced_p): pot value = must_hit_by_x_bet.

    The natural-strike conditional expectation requires the geometric-
    arrival mean of the pot growth, bounded by the cap. Closed-form:

      E[pot @ natural | natural occurs before cap]
        = seed + contribution_x × E[arrival_spins | < spins_to_cap]

    For p_strike small relative to 1/spins_to_cap the conditional
    expectation simplifies to seed + contribution_x / p_strike.
    """
    p_forced = probability_forced_strike(pot)
    p_natural = 1.0 - p_forced

    # Natural arrival mean (geometric, truncated at spins_to_cap)
    # For our typical regime (p_strike ~ 1e-6, spins_to_cap large),
    # the truncation is the dominant constraint — pot strikes at cap
    # ~exponentially with the truncation.
    if p_natural <= 0:
        e_pot_natural = pot.must_hit_by_x_bet
    else:
        # Untruncated geometric mean spins = 1 / p_strike
        # Truncate to spins_to_cap = (must_hit_by - seed) / contribution_x
        spins_cap = expected_spins_to_cap(pot)
        e_spins_natural = min(1.0 / pot.p_strike_per_spin, spins_cap)
        e_pot_natural = pot.seed_x_bet + pot.contribution_x * e_spins_natural

    e = p_natural * e_pot_natural + p_forced * pot.must_hit_by_x_bet
    return e


def per_pot_rtp_contribution(pot: MustHitByPot) -> float:
    """Per-spin RTP contribution from this pot (flow argument).

    By conservation: every contributed dollar eventually pays out as
    a strike. So per-spin RTP contribution = contribution_x.

    NOTE: this is the FLOW component. The HEADLINE jackpot is what the
    winning player sees — `expected_strike_value`. The two are different
    metrics serving different audit purposes.
    """
    return pot.contribution_x


def must_hit_by_rtp(params: MustHitByParams) -> dict:
    """Full per-spin RTP contribution + per-pot breakdown."""
    per_pot = []
    total_rtp = 0.0
    for p in params.pots:
        rtp = per_pot_rtp_contribution(p)
        e_strike = expected_strike_value(p)
        spins_cap = expected_spins_to_cap(p)
        p_forced = probability_forced_strike(p)
        per_pot.append({
            "name": p.name,
            "seed_x_bet": p.seed_x_bet,
            "contribution_x": p.contribution_x,
            "must_hit_by_x_bet": p.must_hit_by_x_bet,
            "p_strike_per_spin": p.p_strike_per_spin,
            "expected_spins_to_cap": spins_cap,
            "probability_forced_strike": p_forced,
            "expected_strike_value_x_bet": e_strike,
            "per_spin_rtp_contribution": rtp,
        })
        total_rtp += rtp
    return {
        "rtp_contribution": total_rtp,
        "pots": per_pot,
    }
