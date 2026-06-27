# `slot-math-wasm` — TypeScript wrapper

Strongly-typed namespaced API over the wasm-bindgen generated bindings.

## Build prerequisite

```bash
cd packages/slot-math-wasm
RUSTUP_TOOLCHAIN=stable wasm-pack build --target bundler --release
```

This generates `pkg/slot_math_wasm.js` + `pkg/slot_math_wasm.d.ts` which
the wrapper imports.

## Import (after build)

```ts
import api, { rtp, compliance, helpers } from 'slot-math-wasm/ts';

// 1. Initialize the wasm module
await rtp.init();   // or: api.initWasm();

// 2. RTP kernels
console.log(rtp.bothWays(0.96, 0.7));                  // 1.632
console.log(rtp.chargeMeterTier(0.5, 50, 10));         // 0.10 (Wald)
console.log(rtp.buyFeature(95, 100));                  // 0.95
console.log(rtp.wheel(0.01, 5, 0.2));                  // 0.0625

// 3. Compliance gates
console.log(compliance.ukgcRts13c(95, 100, 0.965, 0.5));  // false
console.log(compliance.mgaRg202102(95, 100, 0.96));       // true

// 4. Helpers
console.log(helpers.binomialPmfGe(10, 0.1, 1));   // ≈ 0.65132
console.log(helpers.waysTotal(new Uint32Array([7, 7, 7, 7, 7, 7]))); // 117649n
console.log(helpers.crashProbabilityBelow(0.01, 2.0));  // 0.505
```

## Namespace map

| Namespace | Functions |
|---|---|
| `rtp.*` | `bothWays`, `chargeMeterTier`, `buyFeature`, `payAnywhere`, `wheel` |
| `compliance.*` | `ukgcRts13c`, `mgaRg202102` |
| `helpers.*` | `binomialPmfGe`, `waysTotal`, `crashProbabilityBelow` |

## Initialization semantics

`initWasm()` returns a Promise that resolves once the wasm module is
loaded + instantiated. **All kernel calls must come after the promise
resolves.** Subsequent calls to `initWasm()` are idempotent — they share
the same underlying init promise (no double-fetch).

## Returns

- All `rtp.*` and `helpers.*` numeric functions return `number` (f64)
  EXCEPT `helpers.waysTotal` which returns `bigint` (u64).
- `compliance.*` returns `boolean`.

Math is ULP-identical to the Python `slot_math_kernels` reference impl
(verified by `tools/parity/w244_wasm_python_parity.py` — 20 fixtures × 7
kernels, max delta 3.4e-15).
