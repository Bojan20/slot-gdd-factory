"""Example 4 — Wheel of Fortune / Megafortune wheel kernel.

Pattern: Pick a segment uniformly (weighted by sector size); terminal
segments award value × bet; spin-again segments recurse. Closed-form
geometric amortisation handles the recursion.

Industry references:
  * IGT Wheel of Fortune Triple Extreme Spin
  * NetEnt Mega Fortune / Mega Fortune Dreams
  * Pragmatic Dragon Cash Hold & Spin (final wheel)
"""
from slot_math_kernels import wheel

# Designer config: 5 segments — cash awards + 1 spin-again + 1 jackpot.
params = wheel.WheelParams(
    trigger_p=0.01,  # 1% base-spin trigger
    segments=(
        wheel.WheelSegment(kind="credit", weight=10.0, value_x_bet=1.0),
        wheel.WheelSegment(kind="credit", weight=4.0,  value_x_bet=5.0),
        wheel.WheelSegment(kind="credit", weight=1.0,  value_x_bet=25.0),
        wheel.WheelSegment(kind="spin_again", weight=4.0),
        wheel.WheelSegment(kind="jackpot",    weight=0.1,
                           value_x_bet=100.0, jackpot_id="MEGA"),
        wheel.WheelSegment(kind="no_win", weight=1.0),
    ),
    max_spin_again=10,
)

result = wheel.wheel_rtp(params)
print(f"Trigger prob:       {params.trigger_p:.4f}")
print(f"Total weight:       {sum(s.weight for s in params.segments):.2f}")
print(f"Wheel RTP per-spin: {result['rtp_contribution']:.6f}")
for k in ("expected_terminal_award_x_bet", "expected_jackpot_award_x_bet",
          "spin_again_geometric_factor"):
    if k in result:
        print(f"  {k}: {result[k]}")
