"""Example 1 — Starburst-style charge meter (Wald identity multi-tier).

Pattern: Charge meter that fills as the player spins; reaching a threshold
awards a multiplier. Closed-form RTP via Wald's identity.

Industry references:
  * NetEnt Starburst expanding-wild meter
  * Hacksaw Money Cart respin meter
  * Pragmatic Power Stacks meter
"""
from slot_math_kernels import charge_meter as cm

# Designer inputs:
#   - On average, each spin contributes 0.5 charge units
#   - Single tier: at 50 units we award 10× bet
params = cm.ChargeMeterParams(
    expected_charge_per_spin=0.5,
    tiers=(
        cm.ChargeTier(name="classic", threshold=50.0, award_value_x_bet=10.0),
    ),
)

result = cm.charge_meter_rtp(params)
print(f"RTP contribution: {result['rtp_contribution']:.4f}")
print(f"Per-tier:         {result['tiers']}")
print(f"Persistent?       {result['persistent_across_sessions']}")

# Wald: RTP = award_value / spins_to_threshold
#     = 10.0 / (50 / 0.5) = 10.0 / 100 = 0.10
assert abs(result["rtp_contribution"] - 0.10) < 1e-12, result
print("✓ Wald identity check passed")
