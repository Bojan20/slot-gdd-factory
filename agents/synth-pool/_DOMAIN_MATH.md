# Domain Agent · MATH_ARCHITECT

Wave Z2 — math expertise that scaffolder injects when archetype's
agent owner = MATH_ARCHITECT.

## Mission

Insulate the synthesized block from math-layer responsibility. If a
GDD describes a feature that depends on RTP, volatility tier, weighted
bucket, jackpot pool value, autoplay cap floor, handpay threshold,
multiplier ladder rungs, FS award table, or any other parametric
value — that value MUST come from `model.payback.*` / `model.math.*`
fields, NOT from block-local constants.

## Hard rules

1. **NIKAD ne hardcode RTP, hit frequency, volatility tier u block-u.**
   Block reads `model.payback.rtp`, `model.payback.hitFrequency`,
   `model.theme.volatility` via `resolveConfig(model)`.

2. **Weighted buckets žive u model.{feature}.weights, NIKAD u block code.**
   Primer: `model.lightning.weights = [{value: 2, weight: 50}, {value: 10, weight: 5}]`.
   Block instanced `resolveConfig` čita ovu listu i koristi je za draw.

3. **Jackpot tier values žive u model.jackpot.tiers — kompliance + math composite.**
   Per US handpay $1200, EU jurisdiction varies. Block ne sme da nagađa.

4. **FS award table je MATH attestation.**
   `model.freeSpins.awards = [{count: 3, fs: 10}, {count: 4, fs: 15}, {count: 5, fs: 20}]`.
   Block čita; ne sme dodavati ladder iz tin air.

5. **Multiplier ladder rungs — strict ordered ascend.**
   `model.multiplierLadder.rungs = [1, 2, 3, 5, 10]`. Block ne smije skipping rungs.

6. **Win cap / max win cap je IBINOMINAL hard cap.**
   `model.winCap.maxWinX = 5000`. Block ne sme amplify-ovati iznad ovoga.

7. **NIKAD math fix u block-u — math fix ide u model.json, parser, ili PAR sheet.**

## Scaffolder injection patterns

When generating a MATH_ARCHITECT-owned block, scaffolder MUST include:

```js
const cfg = resolveConfig(model);
/* Math values resolved from model — NEVER from block constants. */
const BUCKET   = cfg.weightedBucket;   // from model.<feature>.weights
const CAPACITY = cfg.capacity;          // from model.<feature>.threshold
const MAX_X    = cfg.maxWinX;           // from model.winCap.maxWinX
```

And explicit comment header:

```js
/**
 * Math gate:
 *   Block does NOT touch RTP / volatility / hit frequency / weighted
 *   bucket. All parametric values resolved from `model.<feature>` via
 *   `resolveConfig`. Math-layer attestation lives in `model.payback`,
 *   `model.theme.volatility`, `model.jackpot.tiers`, etc. Compliance
 *   with `rule_no_math_unless_asked` enforced at scaffold time.
 */
```

## Testing

Scaffolder MUST emit test case "math values come from model, not block":

```js
block('Math-from-model contract', () => {
  const c1 = resolveConfig({ <feature>: { weights: [{value: 99, weight: 1}] } });
  t('1. weighted bucket read from model', c1.weightedBucket[0].value === 99);
  const c2 = resolveConfig({ winCap: { maxWinX: 1234 } });
  t('2. maxWinX read from model', c2.maxWinX === 1234);
});
```
