# `slot-math-wasm`

**5 hot W244 closed-form kernels compiled to WebAssembly.** For browser-side
RTP evaluation — embed in math-designer studio UI, vendor preview, etc.

## Build

```bash
cd packages/slot-math-wasm
RUSTUP_TOOLCHAIN=stable wasm-pack build --target web --release
# → pkg/slot_math_wasm.{js, _bg.wasm, .d.ts}
```

Targets: `web` (ES module), `nodejs`, `bundler` (webpack/rollup) — re-run
with desired `--target`.

## Exposed kernels

| Function | Returns | Industry pattern |
|---|---|---|
| `both_ways_rtp(ltr_only_rtp, line_pay_share)` | f64 | Thunderstruck II / Starburst |
| `charge_meter_tier_rtp(expected_charge, threshold, award_x_bet)` | f64 | Starburst meter (Wald) |
| `buy_feature_rtp(bonus, cost)` | f64 | BTG / Pragmatic Bonus Buy |
| `buy_feature_ukgc_rts13c_pass(bonus, cost, base_rtp, tol_pp)` | bool | UKGC RTS 13C gate |
| `buy_feature_mga_pass(bonus, cost, ceiling)` | bool | MGA RG 2021/02 gate |
| `pay_anywhere_expected_pay(n_cells, p, pay_keys, pay_values)` | f64 | Sweet Bonanza scatter |
| `binomialPmfGe(n, p, k_min)` | f64 | helper utility |
| `wheel_rtp(trigger_p, terminal_award_x_bet, p_again)` | f64 | Mega Fortune / WoF |
| `ways_total(per_reel_symbols)` | u64 | Megaways 117649 / 1024 / 243 |
| `crash_probability_below(house_edge, m)` | f64 | Stake-style Crash |

## Browser usage (vanilla)

```html
<script type="module">
  import init, {
    both_ways_rtp, charge_meter_tier_rtp, buy_feature_rtp,
    wheel_rtp, ways_total, crash_probability_below,
  } from './pkg/slot_math_wasm.js';

  await init();

  console.log(both_ways_rtp(0.96, 0.7));        // → 1.632
  console.log(charge_meter_tier_rtp(0.5, 50, 10));  // → 0.10 (Wald)
  console.log(ways_total(new Uint32Array([7,7,7,7,7,7])));  // → 117649n
  console.log(crash_probability_below(0.01, 2.0));  // → 0.505
</script>
```

## Node.js usage

```bash
RUSTUP_TOOLCHAIN=stable wasm-pack build --target nodejs --release

cat > demo.js <<'EOF'
const k = require('./pkg/slot_math_wasm.js');
console.log('both_ways:', k.both_ways_rtp(0.96, 0.7));
EOF
node demo.js
```

## Output size

| File | Size |
|---|---:|
| `slot_math_wasm_bg.wasm` | ~17 KB |
| `slot_math_wasm.js` | ~8.6 KB |
| `slot_math_wasm.d.ts` | ~4 KB |
| **Total** | **~30 KB** |

(Note: `wasm-opt` skipped because current Rust 1.95 emits features that
the bundled wasm-opt doesn't support. Re-enable in `Cargo.toml` once
upstream catches up.)

## Numerical parity

Pure-stdlib math, ULP-identical to:
- `slot_math_kernels` (Python PyPI package) — same closed-form formulas
- `slot_sim::kernels::*` (Rust monorepo) — same logic, lighter deps

Verified by acceptance tests in
[`tools/tests/test_w244_wasm_build.py`](../../tools/tests/test_w244_wasm_build.py)
and the package's own `cargo test`.

## License

MIT.
