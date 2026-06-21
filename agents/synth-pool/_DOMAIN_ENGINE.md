# Domain Agent · ENGINE_ARCHITECT

Wave Z2 — engine expertise injected when archetype's agent owner =
ENGINE_ARCHITECT (movement, spawn, expand-direction, linked-region,
cascade-collapse, trigger-then-respin, aux-reel).

## Mission

Ensure synthesized block respects ENGINE lifecycle invariants:
single-source-of-truth for grid state, no race conditions, no
late-emit-after-postSpin, idempotent listeners, deterministic state
transitions.

## Hard rules

1. **Grid je single source of truth.** `window.__REELS__` + `window.__ROWS__` su
   immutable u toku spin lifecycle-a osim u eksplicitnim hookovima.

2. **HookBus.emit MORA pratiti ownership.** Block emit-uje ONLY events za
   koje je u `tools/lego-gate.mjs` EXPECTED_EMIT_OWNERS deklarisan kao owner.
   Nikad ne emit-uj tuđa events (`onSpinResult` je reelEngine owner).

3. **Listener lifecycle** — `HookBus.on` mora biti pre `preSpin` first-fire.
   Late-attach listeners su dead code.

4. **postSpin je rollup boundary.** Sva block lifecycle pre postSpin-a (sticky
   plant, walking step, expand reshape) mora završiti. Nakon `postSpin` block
   ne sme mutate-ovati grid state.

5. **Force chip lifecycle:**
   ```
   universalForcePanel.mjs click → window.__FORCE_X__ = value →
   HookBus.emit('onForceFeatureRequested', {kind}) →
   _runSpin() → preSpin → block consumes flag in onSpinResult →
   one-shot delete flag
   ```

6. **Re-evaluation rule:** Ako block mutate-uje grid (spawn / expand), engine
   MORA re-evaluate-ovati win. Block emit-uje `on{Action}Complete` ko signal,
   engine subscribes preko `reelEngine` na re-eval.

7. **FS lifecycle isolation:** BASE state ne curi u FS (unless GDD eksplicitno
   `carryToFs: true`). FS state se reset na `onFsEnd`.

## Scaffolder injection patterns

```js
/* Engine lifecycle ownership — block emits ONLY canonical events for which
 * it is the sole owner declared in tools/lego-gate.mjs EXPECTED_EMIT_OWNERS.
 * Cross-cutting events (onSpinResult, postSpin, onFsTrigger) are subscribed
 * via HookBus.on, never emitted. */
HookBus.on('preSpin', () => { /* prep state */ });
HookBus.on('onSpinResult', (payload) => { /* read landed grid, mutate own state */ });
HookBus.on('postSpin', () => { /* settle state, emit on{Name}Complete */ });
HookBus.on('onFsTrigger', () => { /* clear base state */ });
HookBus.on('onFsEnd', () => { /* restore base state */ });
```

```js
/* Force chip one-shot consumption */
HookBus.on('onSpinResult', () => {
  if (window.__FORCE_{KIND}__) {
    /* apply forced value */
    applyForced(window.__FORCE_{KIND}__);
    /* one-shot cleanup */
    delete window.__FORCE_{KIND}__;
  }
});
```

## Testing

Required asserts in synthesized test:

```js
block('Engine contract', () => {
  /* listener registration */
  const rt = emit{Name}Runtime(cfg);
  t('1. registers preSpin listener', /HookBus\.on\(\s*['"]preSpin['"]/.test(rt));
  t('2. registers postSpin listener', /HookBus\.on\(\s*['"]postSpin['"]/.test(rt));
  t('3. force chip flag consumed', /window\.__FORCE_{KIND}__/.test(rt));
  t('4. force flag one-shot cleanup', /delete\s+window\.__FORCE_{KIND}__/.test(rt));
});

block('LEGO ownership', () => {
  /* Verify lego-gate ownership */
  const legoSrc = readFileSync('tools/lego-gate.mjs', 'utf8');
  for (const ev of soleOwnerEvents) {
    t(`${ev} owner declared in lego-gate`,
      new RegExp(`${ev}:\\s*\\[\\s*['"]<blockFile>['"]\\s*\\]`).test(legoSrc));
  }
});
```
