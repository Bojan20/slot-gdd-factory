"""W244 wave 11 — closed-form analytical model for `charge_meter` feature.

Industry pattern (NetEnt Starburst-style meter, Pragmatic Power Stacks,
BTG Bonus Buy charge, Relax Gaming "Money Cart" meter mode):

  Meter dynamics
  --------------
    Every spin: meter += charge_per_spin (constant OR random from
    `charge_distribution`).  When meter ≥ `threshold`, a CHARGE EVENT
    fires: meter -= threshold (rolls excess forward) and the player
    is awarded `award` (typically a multiplier boost, free spin,
    feature trigger, or fixed credit grant).

    Two design knobs:
      * `persistent_across_sessions`: meter survives logout (rare —
        UKGC RTS 7.4 disclosure required)
      * `award_kind`: "credit_x_bet" | "free_spin_trigger" |
        "global_multiplier_inc" | "feature_token"

  Closed-form RTP contribution
  ----------------------------
    Per-spin RTP from charge_meter feature alone:

        E[charges_per_spin] = E[charge_per_spin] / threshold
        RTP_charge_meter    = E[charges_per_spin] × E[award_value_x_bet]

    Derivation: by Wald's identity, expected number of charges over N
    spins is E[total_charge] / threshold = N × E[charge_per_spin]/threshold.
    Linearity ⇒ per-spin contribution = E[charge_per_spin]/threshold.

  Multi-tier charge meters
  ------------------------
    Some pattern carry tiers (small / medium / grand) where each tier
    threshold is higher and award scales. We model them as INDEPENDENT
    per-tier contributions and SUM. Each tier has its own
    (threshold, award_value_x_bet) pair.

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_charge_meter_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_charge_meter_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ChargeTier:
    """One meter-tier definition."""
    name: str
    threshold: float                 # meter value to trigger
    award_value_x_bet: float         # what the award is worth in × bet
    award_kind: str = "credit_x_bet" # see module docstring

    def __post_init__(self):
        if self.threshold <= 0:
            raise ValueError(f"threshold must be > 0 (got {self.threshold})")
        if self.award_value_x_bet < 0:
            raise ValueError("award_value_x_bet must be ≥ 0")


@dataclass(frozen=True)
class ChargeMeterParams:
    """Closed-form model inputs."""
    # E[charge_per_spin] — typically `mean_charge_per_spin` OR
    # `charge_distribution` (a {amount: weight} table).
    expected_charge_per_spin: float
    tiers: tuple[ChargeTier, ...]
    # Optional: persistent across session boundaries (UKGC RTS 7.4 flag)
    persistent_across_sessions: bool = False

    def __post_init__(self):
        if self.expected_charge_per_spin < 0:
            raise ValueError("expected_charge_per_spin must be ≥ 0")
        if not self.tiers:
            raise ValueError("tiers must be non-empty")
        # Sorted-thresholds invariant — tiers should escalate.
        thresholds = [t.threshold for t in self.tiers]
        if thresholds != sorted(thresholds):
            raise ValueError(
                f"tiers must be sorted ascending by threshold; got "
                f"{thresholds}"
            )


def expected_charge_from_distribution(dist: dict[float, float]) -> float:
    """E[charge_per_spin] from a {amount: weight} distribution table."""
    total = sum(dist.values())
    if total <= 0:
        raise ValueError("charge_distribution sum-of-weights must be > 0")
    return sum(amt * (w / total) for amt, w in dist.items())


def rtp_contribution_per_tier(
    expected_charge_per_spin: float,
    tier: ChargeTier,
) -> float:
    """Per-spin RTP contribution for ONE tier.

    Wald: E[charges_per_spin] = E[charge_per_spin] / threshold.
    RTP[tier] = E[charges_per_spin] × award_value_x_bet.
    """
    return (expected_charge_per_spin / tier.threshold) * tier.award_value_x_bet


def charge_meter_rtp(params: ChargeMeterParams) -> dict:
    """Full per-spin RTP contribution + per-tier breakdown."""
    per_tier = []
    total_rtp = 0.0
    for t in params.tiers:
        rtp = rtp_contribution_per_tier(params.expected_charge_per_spin, t)
        per_tier.append({
            "name": t.name,
            "threshold": t.threshold,
            "award_value_x_bet": t.award_value_x_bet,
            "award_kind": t.award_kind,
            "rtp_contribution": rtp,
            "expected_charges_per_spin": (
                params.expected_charge_per_spin / t.threshold
            ),
        })
        total_rtp += rtp
    return {
        "rtp_contribution": total_rtp,
        "expected_charge_per_spin": params.expected_charge_per_spin,
        "tiers": per_tier,
        "persistent_across_sessions": params.persistent_across_sessions,
    }
