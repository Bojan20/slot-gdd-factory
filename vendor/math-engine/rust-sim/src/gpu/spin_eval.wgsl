// Faza 9.8b — Spin evaluator Phase-B.
//
// Thread layout: 1 thread = 1 spin. Workgroup size 64.
// Per-thread RNG: Philox4x32 keyed by (base_seed, slice_index, gid).
// Per-thread output: f32 win in bet multiples, written to wins[gid].
//
// Phase-B additions:
//   - Philox4x32 mul_hi emulated with 16-bit split arithmetic (no u64)
//   - Weighted reel stop generation via inverse CDF (5 symbols, 50 stops/reel)
//   - 5-payline evaluation with wild substitution
//   - Scatter pay (3+ scatters = 2x win)

struct Constants {
    base_seed: u32,
    slice_index_lo: u32,
    slice_index_hi: u32,
    start_spin_lo: u32,
    start_spin_hi: u32,
    span_lo: u32,
    span_hi: u32,
    total_bet_mc: u32,
    reels: u32,
    rows: u32,
}

@group(0) @binding(0) var<uniform> consts: Constants;
@group(0) @binding(1) var<storage, read_write> wins: array<f32>;

// ─── mul_hi: emulate u32 high-word multiply using 16-bit splits ───────────────
//
// a * b = (a_hi * 2^16 + a_lo) * (b_hi * 2^16 + b_lo)
//       = a_hi*b_hi*2^32  +  (a_hi*b_lo + a_lo*b_hi)*2^16  +  a_lo*b_lo
// The high 32 bits = a_hi*b_hi + ((cross + (a_lo*b_lo >> 16)) >> 16)
fn mul_hi(a: u32, b: u32) -> u32 {
    let a_lo = a & 0xFFFFu;
    let a_hi = a >> 16u;
    let b_lo = b & 0xFFFFu;
    let b_hi = b >> 16u;

    let lo_lo = a_lo * b_lo;
    let lo_hi = a_lo * b_hi;
    let hi_lo = a_hi * b_lo;
    let hi_hi = a_hi * b_hi;

    let cross = lo_hi + hi_lo + (lo_lo >> 16u);
    return hi_hi + (cross >> 16u);
}

// ─── Philox4x32 ───────────────────────────────────────────────────────────────

fn philox_round(c0: u32, c1: u32, c2: u32, c3: u32, k0: u32, k1: u32) -> vec4<u32> {
    let mul_a: u32 = 0xD2511F53u;
    let mul_b: u32 = 0xCD9E8D57u;

    let lo_a = c0 * mul_a;
    let hi_a = mul_hi(c0, mul_a);

    let lo_b = c2 * mul_b;
    let hi_b = mul_hi(c2, mul_b);

    return vec4<u32>(
        hi_b ^ c1 ^ k0,
        lo_b,
        hi_a ^ c3 ^ k1,
        lo_a
    );
}

fn philox_key_bump(k: vec2<u32>) -> vec2<u32> {
    return vec2<u32>(k.x + 0x9E3779B9u, k.y + 0xBB67AE85u);
}

// Philox4x32 with 4-round schedule. Counter is passed as two u32 (lo, hi).
fn philox4x32(seed_lo: u32, seed_hi: u32, ctr_lo: u32, ctr_hi: u32) -> vec4<u32> {
    var k = vec2<u32>(seed_lo, seed_hi);
    var r = philox_round(ctr_lo, ctr_hi, 0u, 0u, k.x, k.y);
    k = philox_key_bump(k);
    r = philox_round(r.x, r.y, r.z, r.w, k.x, k.y);
    k = philox_key_bump(k);
    r = philox_round(r.x, r.y, r.z, r.w, k.x, k.y);
    k = philox_key_bump(k);
    r = philox_round(r.x, r.y, r.z, r.w, k.x, k.y);
    return r;
}

// ─── Weighted reel stop via inverse CDF ───────────────────────────────────────
//
// 5 symbols, cumulative weight table (50 total stops per reel):
//   sym 0 (wild)    : weight  2  → cdf =  2
//   sym 1 (high)    : weight 10  → cdf = 12
//   sym 2 (mid)     : weight 15  → cdf = 27
//   sym 3 (low)     : weight 13  → cdf = 40
//   sym 4 (scatter) : weight 10  → cdf = 50
//
// Each reel uses the same distribution for Phase-B simplicity.

fn reel_stop(rnd: u32) -> u32 {
    // Map rnd → [0, 50)
    let r = rnd % 50u;
    if r < 2u  { return 0u; }   // wild
    if r < 12u { return 1u; }   // high
    if r < 27u { return 2u; }   // mid
    if r < 40u { return 3u; }   // low
    return 4u;                   // scatter
}

// ─── Payline evaluation with wild substitution ────────────────────────────────
//
// 5 paylines (rows 0,1,2 middle + diagonals):
//   line 0: [1,1,1,1,1]  — middle row
//   line 1: [0,0,0,0,0]  — top row
//   line 2: [2,2,2,2,2]  — bottom row
//   line 3: [0,1,2,1,0]  — V-shape
//   line 4: [2,1,0,1,2]  — inverted V
//
// Wild (sym=0) substitutes for any symbol in run detection.
// Scatter (sym=4) pays separately.
// Minimum run = 3 consecutive from left.

fn payline_win(grid: array<u32, 15>, pl: u32, rows: u32, wild_sym: u32, scatter_sym: u32) -> f32 {
    // Payline row offsets for each of 5 reels
    var row0: u32; var row1: u32; var row2: u32; var row3: u32; var row4: u32;
    switch pl {
        case 0u: { row0 = 1u; row1 = 1u; row2 = 1u; row3 = 1u; row4 = 1u; }
        case 1u: { row0 = 0u; row1 = 0u; row2 = 0u; row3 = 0u; row4 = 0u; }
        case 2u: { row0 = 2u; row1 = 2u; row2 = 2u; row3 = 2u; row4 = 2u; }
        case 3u: { row0 = 0u; row1 = 1u; row2 = 2u; row3 = 1u; row4 = 0u; }
        default: { row0 = 2u; row1 = 1u; row2 = 0u; row3 = 1u; row4 = 2u; }
    }

    let sym0 = grid[0u * rows + row0];
    let sym1 = grid[1u * rows + row1];
    let sym2 = grid[2u * rows + row2];
    let sym3 = grid[3u * rows + row3];
    let sym4 = grid[4u * rows + row4];

    var syms: array<u32, 5>;
    syms[0] = sym0; syms[1] = sym1; syms[2] = sym2; syms[3] = sym3; syms[4] = sym4;

    // Determine effective symbol (first non-wild)
    var eff = wild_sym;
    for (var i = 0u; i < 5u; i = i + 1u) {
        if syms[i] != wild_sym {
            eff = syms[i];
            break;
        }
    }
    // All-wild or scatter on first → no payline win
    if eff == wild_sym || eff == scatter_sym { return 0.0; }

    // Count run length from left
    var run = 0u;
    for (var i = 0u; i < 5u; i = i + 1u) {
        if syms[i] == eff || syms[i] == wild_sym {
            run = run + 1u;
        } else {
            break;
        }
    }

    if run < 3u { return 0.0; }

    // Payout table: (sym, run) → multiplier
    // sym1 high: 3=5x, 4=10x, 5=20x
    // sym2 mid:  3=3x, 4=6x,  5=12x
    // sym3 low:  3=1x, 4=2x,  5=4x
    var mult = 0.0;
    if eff == 1u {
        if run == 3u { mult = 5.0; }
        else if run == 4u { mult = 10.0; }
        else { mult = 20.0; }
    } else if eff == 2u {
        if run == 3u { mult = 3.0; }
        else if run == 4u { mult = 6.0; }
        else { mult = 12.0; }
    } else if eff == 3u {
        if run == 3u { mult = 1.0; }
        else if run == 4u { mult = 2.0; }
        else { mult = 4.0; }
    }
    return mult;
}

// ─── Main compute entry ───────────────────────────────────────────────────────

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let g = gid.x;
    // span check using lo/hi 32-bit pair (no u64 in WGSL)
    // For simplicity: if span_hi > 0 we pass through; else compare against span_lo
    if consts.span_hi == 0u && g >= consts.span_lo {
        return;
    }

    let key_lo = consts.base_seed ^ consts.slice_index_lo ^ consts.start_spin_lo;
    let key_hi = consts.slice_index_hi ^ consts.start_spin_hi;

    // Generate 5 reel stops: need 5 random values → 2 calls to philox (8 values)
    let rnd0 = philox4x32(key_lo, key_hi, g, 0u);
    let rnd1 = philox4x32(key_lo, key_hi, g, 1u);

    // Grid: 5 reels × 3 rows; fill with same symbol on all rows of a reel
    // (simplified Phase-B: each reel shows 3 identical symbols = single stop)
    var grid: array<u32, 15>;
    let stops = array<u32, 5>(
        reel_stop(rnd0.x),
        reel_stop(rnd0.y),
        reel_stop(rnd0.z),
        reel_stop(rnd0.w),
        reel_stop(rnd1.x),
    );
    for (var r = 0u; r < 5u; r = r + 1u) {
        for (var row = 0u; row < 3u; row = row + 1u) {
            grid[r * 3u + row] = stops[r];
        }
    }

    let wild_sym    = 0u;
    let scatter_sym = 4u;

    // Evaluate 5 paylines
    var total_win = 0.0;
    for (var pl = 0u; pl < 5u; pl = pl + 1u) {
        total_win = total_win + payline_win(grid, pl, 3u, wild_sym, scatter_sym);
    }

    // Scatter pay: count scatter symbols across entire grid
    var scatter_count = 0u;
    for (var r = 0u; r < 5u; r = r + 1u) {
        if stops[r] == scatter_sym {
            scatter_count = scatter_count + 1u;
        }
    }
    if scatter_count >= 3u {
        total_win = total_win + 2.0;
    }

    wins[g] = total_win;
}
