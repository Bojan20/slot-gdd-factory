# Domain Agent · COMPLIANCE_ARCHITECT (RG_ARCHITECT)

Wave Z2 — compliance expertise injected when archetype is jurisdiction-
sensitive (jackpot-pool, trigger-then-respin with handpay, large boost
multiplier, autoplay-related, reality check).

## Mission

Ensure synthesized block matches mandatory regulatory windows for
12-jurisdiction matrix (EU-5 + UK/SE/DK/BE/CH/RO) without leaking
math-layer details. Block surfaces window flags + emit events; consumer
gates (UKGC, SGA, DGA, BGC, ESBK, ONJN, German MGStV, NL KOA, FR ANJ,
IT ADM, ES DGOJ, EU AI Act) read those signals.

## Hard rules

1. **Spin-pace floor — minimum spin time** je window flag `__{ISO}_MIN_SPIN_MS__`.
   Block ne smije allow-ovati spin loop < threshold. Default 2,500 ms.
2. **Autoplay cap — UK RTS 11A** = 50 max, ali jurisdiction varies.
   Block reads `cfg.autoplayCap`, ne hardcoded.
3. **Reality check interval** — UK 60 min, DK/CH 30 min.
   `window.__{ISO}_REALITY_CHECK_MS__` available to RC modal block.
4. **Self-exclusion check** — UK GamStop, NL CRUKS, SE Spelpaus, DK ROFUS, RO OSAJ.
   Block emit-uje `on{ISO}SelfExclusionCheckRequired` before first spin.
5. **Handpay threshold** — US $1200, UK £25k, EU varies. Block emit-uje
   `onHandpayThresholdEnforced` before granting jackpot.
6. **Loss display u native currency** — never virtual currency obfuscation.
7. **Big win turbo ban** — France ANJ, Italy ADM bann big-win turbo mode.

## Scaffolder injection patterns

```js
/**
 * Compliance gate:
 *   Block does NOT enforce jurisdiction rules directly. Reads jurisdiction
 *   from `model.responsibleGambling.jurisdiction` and emit-uje audit
 *   events. Mutually exclusive jurisdiction gates (12-matrix) consume.
 *
 *   - onAutoplayBanned         (FR/IT/ES/SE)
 *   - onTurboBanned            (FR/IT)
 *   - onMinSpinDurationEnforced (FR/IT/ES/UK/SE/DK/BE/CH/RO)
 *   - onHandpayThresholdEnforced (US/RO)
 *   - onSelfExclusionCheckRequired (12 variant flavors)
 */
```

```js
/* Compliance-sensitive: respect spin pace floor before allowing block to fire */
HookBus.on('preSpin', () => {
  const minMs = window.__DE_MIN_SPIN_MS__ || window.__UK_MIN_SPIN_MS__ ||
                window.__SE_MIN_SPIN_MS__ || /* ... */ 0;
  if (minMs && Date.now() - lastSpinTs < minMs) {
    /* block this firing */
    return;
  }
});
```

## Testing

```js
block('Compliance contract', () => {
  const rt = emit{Name}Runtime(resolveConfig({ regulator: { profile: 'UKGC' } }));
  t('1. honors __UK_MIN_SPIN_MS__', /__UK_MIN_SPIN_MS__/.test(rt));
  /* Add per-jurisdiction asserts when block surfaces them */
});
```
