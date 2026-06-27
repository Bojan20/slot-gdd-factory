"""Example 5 — Cash Eruption / Money Train hold-and-win core (Markov DP).

Pattern: Player triggers respin feature (e.g. 6+ money symbols land on a
single spin). Each respin, every empty cell may land a money symbol with
value drawn from a distribution. Respins counter resets on each hit.
Closed-form RTP via Markov DP over (respins_left, cells_filled) state.

Industry references:
  * Pragmatic Money Train, Money Train 2/3/4
  * Hacksaw Cash Eruption
  * Big Time Gaming Buffalo Bonus Hold & Spin
"""
from slot_math_kernels import money_collect as mc

# Designer config: 15 cells (5×3 reels). Trigger requires 6 hits in
# base spin; per-cell hit prob during respins = 0.10.
params = mc.MoneyCollectParams(
    p_per_cell=0.10,
    n_cells=15,
    trigger_count_min=6,
    value_table={
        1.0: 0.60,   # 60% chance of 1× bet symbol
        5.0: 0.30,   # 30% chance of 5× bet
        25.0: 0.09,  # 9% chance of 25× bet
        100.0: 0.01, # 1% chance of jackpot symbol
    },
    respins_reset=3,
)

r = mc.money_collect_rtp_contribution(params)

print(f"Initial trigger prob:  {r['trigger_p']:.6f}")
print(f"Per-cell hit prob:     {params.p_per_cell}")
print(f"Expected symbol value: {r['expected_value_per_money']:.4f}× bet")
print(f"Expected episode E:    {r['expected_total_per_episode']:.4f}× bet")
print(f"Per-spin RTP:          {r['rtp_contribution']:.6f}")
