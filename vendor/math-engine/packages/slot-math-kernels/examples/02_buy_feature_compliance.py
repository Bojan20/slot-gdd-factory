"""Example 2 — Bonus Buy with UKGC / MGA compliance gates.

Pattern: Buy Feature lets the player skip directly to FS by paying N× bet.
This kernel emits buy_rtp + jurisdictional pass/fail flags:
  * UKGC RTS 13C: |buy_rtp - base_rtp| ≤ 0.5 pp
  * MGA RG 2021/02: buy_rtp ≤ 0.96 absolute ceiling

Industry references:
  * Big Time Gaming Bonus Buy (e.g. White Rabbit)
  * Pragmatic Play Bonus Buy (e.g. Sweet Bonanza)
  * Nolimit City xWays Hunters
"""
from slot_math_kernels import buy_feature as bf

# Designer inputs for a Pragmatic-style bonus buy:
params = bf.BuyFeatureParams(
    bonus_average_pay_x_bet=95.0,  # expected bonus value
    buy_cost_x_bet=100.0,           # player pays 100× to skip
    base_game_rtp=0.9650,
    target_buy_rtp=0.95,
)

audit = bf.buy_feature_audit(params)
print(f"Buy RTP:           {audit['buy_rtp']:.4f}")
print(f"Base RTP:          {params.base_game_rtp:.4f}")
print(f"Delta vs base:     {audit['delta_pp_vs_base']:+.3f} pp")
print(f"Fair buy cost:     {audit['fair_buy_cost_x_bet']:.2f}× bet")
print(f"UKGC RTS 13C 0.5pp:{audit['ukgc_rts13c_pass_0p5']}")
print(f"UKGC RTS 13C 1.0pp:{audit['ukgc_rts13c_pass_1p0']}")
print(f"MGA 2021/02 0.96:  {audit['mga_2021_02_pass_0p96']}")
print(f"MGA 2021/02 0.97:  {audit['mga_2021_02_pass_0p97']}")

assert abs(audit["buy_rtp"] - 0.95) < 1e-9, audit
print("✓ Closed-form buy_rtp check passed")
