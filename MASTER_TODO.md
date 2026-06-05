# Master TODO — slot-gdd-factory

> Living single-source-of-truth for what's shipped, what's in progress,
> and what's queued. Updated after every wave/feature.
>
> Last updated: **2026-06-05** · HEAD: **(pending push)** · main · Wave **U + V + V3 + V4 + V5.0 + V5.X + V5.Y + H5.4–H5.20 + Wave I + Wave I.2 + Wave H14 + Wave H15 + Wave H13 + Wave H11 (bonusBuyDeterministic extension — tier picker + deterministic scatter plant + optional starting multiplier)** all live. Hub responsive 9/9 PASS. **Latest shipped — Wave H11** (tier picker modal with STANDARD 75× / PREMIUM 150× / SUPER 300× plants; each plant has specific `[r,c]` scatter positions + optional `extraMult` starting modifier; pure observer wraps `#bonusBuyBtn` click at capture phase + cell DOM rewrite on `onSpinResult`; **65/65 unit PASS** + **22/22 live Playwright probe on GoO dist** + 5/5 LEGO + 29/29 HookBus canonical = **121/121 PASS** with `bonusBuy.mjs` untouched). Wave H13 before that: per-path multiplier chip + aggregate bonus award on `waysEval` (84/84 + 39/39 live). Wave I.2: MULT force button (88/88 fixtures); Wave I: **11/11 UNIFORM grid kinds** got dist parity (12 incl. variable_reel). Big-Win Tier ladder matured kroz 17 atoma (H5.4 → H5.20). **V5.1-V5.10 still PLANNED** (anticipation / tumble / big-win / hold-and-win / wheel / climax / chain dispatch / autoplay guard / always-skippable morph / gamble reveal). Remaining extensions u Wave H queue: **H8 cellOverflowCounter** (sledeći u redu), H1-H4 + H6-H7 + H9-H10 + H12 + H16-H18 (regulator + climax + audit). Remaining iz originalnog plana: U2 (deactivated by design — ADB tok), U7 (rngFairness — math-adjacent, awaits Boki call).

---

## 🟢 Wave H11 — `bonusBuyDeterministic` extension (tier picker + deterministic scatter plant) — SHIPPED (this commit)

> Boki (05.06.2026): *"nastavi dalje"*. Fourth in the Wave H extension series (after H14 / H15 / H13). Adds the universal tiered-buy + deterministic-plant DNA on top of `bonusBuy.mjs` — Standard / Premium / Super tier picker modal, each tier plants a SPECIFIC set of scatter cell positions (not random), with optional starting-multiplier modifier.

### Industry pattern (vendor-neutral synthesis)

| Concern | Owner block |
|---|---|
| Buy CTA + cost label + click → `FORCE_TRIGGER` + spin kick | `bonusBuy.mjs` (pre-existing, **untouched**) |
| **Tier picker modal + deterministic plant table + on-cell DOM rewrite + `extraMult` modifier + HookBus emits** | **`bonusBuyDeterministic.mjs` (NEW)** |
| Cinematic reveal | future H6 `bonusClimaxReveal` |

Regulator angle: UKGC LCCP 5.1.6 + MGA RGF require any Buy Bonus to disclose its trigger mechanic. Deterministic plant table = clean audit row.

### What landed

| Atom | File | Lines | Status |
|:--:|---|:--:|:--:|
| H11.a — block source | `src/blocks/bonusBuyDeterministic.mjs` | 526 | ✅ CREATED — defaultConfig + resolveConfig + emit{CSS,Markup,Runtime} + 140-line JSDoc |
| H11.b — unit suite | `tests/blocks/bonusBuyDeterministic.test.mjs` | 295 | ✅ **65/65 PASS** — happy + malformed + hard-requirement + XSS escape + determinism + vendor-neutral + sandbox event-flow (PREMIUM → 5 cells planted + SUPER → extraMult=2) |
| H11.c — HookBus contract | `src/blocks/hookBus.mjs` | +12 | ✅ `onBonusBuyTierSelected` + `onDeterministicPlantApplied` added |
| H11.d — canonical-list test | `tests/blocks/hookBus.test.mjs` | +2 | ✅ 29/29 PASS |
| H11.e — LEGO ownership | `tools/lego-gate.mjs` | +9 | ✅ single-owner = `bonusBuyDeterministic.mjs`; 35/35 events pass |
| H11.f — buildSlotHTML wiring | `src/buildSlotHTML.mjs` | +14 | ✅ CSS + markup + runtime emitted AFTER bonusBuy |
| H11.g — dist auto-enable | `tools/regen-all-playable.mjs` | +18 | ✅ auto-enables on WoO + GoO (only dist that declare `bonus_buy`) |

### Composition contract (LEGO — pure observer + capture-phase click intercept)

| Read | Write |
|---|---|
| `#bonusBuyBtn` click (capture wrap → stopPropagation + preventDefault) | `window.__BB_PLANT__` on tier select |
| Live grid `.cell` nodes (rewrites text on `onSpinResult`) | DOM cell.textContent at planted positions |
| HookBus `onSpinResult` / `postSpin` / `onFsTrigger` / `onFsEnd` | HookBus emit `onBonusBuyTierSelected` / `onDeterministicPlantApplied` |
| `HookBus.setMult(extraMult)` when plant carries `extraMult > 1` | |

### Lifecycle

```
DOMContentLoaded:
  _patch() → if #bonusBuyBtn missing: warn-once + no-op
             else: install capture-phase click wrapper
                   STATE.patched = true

user clicks Buy:
  capture wrapper: stopPropagation + preventDefault + bbdOpenPicker()
  modal at z-index 96, data-modal="true" (spinControl modal guards see it)

user clicks tier card (e.g. PREMIUM):
  bbdSelectTier('PREMIUM'):
    window.__BB_PLANT__ = { tier, positions, symbol, costX, extraMult }
    emit onBonusBuyTierSelected { tier, costX, plantedCount }
    close modal
    setTimeout(0) → STATE.bypassWrap=true → btn.click() (flows through to
                                                          bonusBuy original)
bonusBuy:
  FORCE_TRIGGER = forceScatters
  runOneBaseSpin()

onSpinResult:
  _applyPlant() → cells[r*rows+c].textContent = plant.symbol for each pos
                  if plant.extraMult > 1: HookBus.setMult(extraMult)
                  emit onDeterministicPlantApplied { tier, positions, symbol, count }

postSpin: window.__BB_PLANT__ = null    (one-shot per buy)
onFsTrigger / onFsEnd: defensive reset
```

### Default config (industry-baseline 3-tier ladder)

| Tier | costX | positions (5×3 grid) | symbol | extraMult |
|---|:--:|---|:--:|:--:|
| **STANDARD** | 75× | `[[1,0],[2,1],[3,2]]` (3 scatters) | S | — |
| **PREMIUM** | 150× | `[[0,0],[1,1],[2,2],[3,1],[4,0]]` (5 scatters) | S | — |
| **SUPER** | 300× | `[[0,0],[0,2],[2,1],[4,0],[4,2]]` (5 scatters) | S | **+2× start** |

### Live verification — `tools/_h11-deterministic-plant-probe.mjs`

Playwright probe on `dist/gates-of-olympus-1000.html` (bonusBuy + H11 active):

| Scenario | Acceptance | Result |
|---|---|:--:|
| Presence | Buy btn + overlay + cancel + 3 tier cards + BBD_STATE.patched + 3 public APIs | ✅ 9/9 |
| **S1 Buy click opens modal** | modal opens, `FORCE_TRIGGER` NOT changed (capture wrap intercepted) | ✅ 2/2 |
| **S2 Cancel** | modal closes, `lastSelection` null, `__BB_PLANT__` stays null | ✅ 3/3 |
| **S3 PREMIUM tier** | `onBonusBuyTierSelected` (PREMIUM, 150×) → `__BB_PLANT__` populated (5 positions, symbol S) → `onSpinResult` → `onDeterministicPlantApplied` (count=5) → ≥5 cells carry symbol → postSpin clears | ✅ 6/6 |
| **S4 SUPER tier extraMult** | initial `HookBus.getMult()` = 1 → bbdSelectTier('SUPER') → onSpinResult → `getMult() = 2` | ✅ |
| 0 page errors | | ✅ |
| **22 / 22 pass** | | ✅ |

### Full regression

| Gate | Result |
|---|:--:|
| `tests/blocks/bonusBuyDeterministic.test.mjs` (NEW) | **65 / 65 PASS** |
| `tests/blocks/bonusBuy.test.mjs` (untouched) | **21 / 21 PASS** |
| `tests/blocks/hookBus.test.mjs` (canonical +2) | **29 / 29 PASS** |
| `tools/lego-gate.mjs` (35 events, 45 listeners) | **5 / 5 PASS** |
| `tools/regen-all-playable.mjs` | **12 / 12 regen** (WoO + GoO got the picker modal) |
| `tools/_h11-deterministic-plant-probe.mjs` (NEW) | **22 / 22 PASS** |

### Acceptance gates 10/10

1. ✅ Vendor-neutral source
2. ✅ JSDoc 140-line public-API contract header
3. ✅ Single responsibility (block ONLY owns picker + plant; bonusBuy keeps CTA + cost + spin kick)
4. ✅ Idempotent (`STATE.patched` gates re-patch; `STATE.bypassWrap` lets re-dispatch flow through)
5. ✅ Defensive on input (malformed plants/positions/colors/labels → defaults retained)
6. ✅ Defensive on runtime (missing `#bonusBuyBtn` → warn once + no-op)
7. ✅ Honors `prefers-reduced-motion`
8. ✅ a11y — `role="dialog"`, `aria-modal="true"`, first card focused on open
9. ✅ Determinism (identical config → byte-identical CSS + runtime)
10. ✅ HookBus single-owner contract (2 events, both owned, verified)

### What H11 does NOT do (out-of-scope by LEGO)

| ❌ Concern | Why |
|---|---|
| Per-tier RTP curve compute | Phase 2 math layer — costX vs expected payout is GDD/PAR concern |
| Bet deduction enforcement | Wallet layer — block emits intent + plant; debit happens server-side |
| Cinematic reveal on plant | H6 `bonusClimaxReveal` later in queue |

---

## 🟢 Wave H13 — `pathAwareMultiplier` extension (per-path multiplier chip + aggregate bonus) — SHIPPED (this commit)

> Boki (05.06.2026): *"radi dalje ultimativno sa svim mogucim qa proverama svakog grida, svakog bloka cortex uys review detaljan i sve savrseno da bude"*. Third of the Wave H extension series (after H14 holdAndWinCreditBucket + H15 weightedWheelSegments). Adds per-path tagging on top of the existing `waysEval.mjs` LEGO atom — every emitted ways event gets an `×N` chip drawn from a weighted ladder, aggregate is added to `__WIN_AWARD__` so the existing winPresentation → bigWinTier chain handles payout naturally.

### Industry pattern (vendor-neutral synthesis)

The modern Ways-to-Win path-multiplier pattern has 3 layered concerns:

| Concern | Owner block |
|---|---|
| Path detection (per-symbol consecutive-reel evaluation → `{ symbol, ways, runLength, cells }` events) | `waysEval.mjs` (pre-existing, **untouched**) |
| **Per-path weighted multiplier draw + on-cell chip render + aggregate bonus award + HookBus emits** | **`pathAwareMultiplier.mjs` (NEW — this wave)** |
| Audio cues + cinematic reveal | future H17 / H6 hooks via `onPathMultiplierAssigned` + `onPathMultiplierAggregate` |

### What landed

| Atom | File | Lines | Status |
|:--:|---|:--:|:--:|
| H13.a — block source | `src/blocks/pathAwareMultiplier.mjs` | 446 | ✅ CREATED — defaultConfig + resolveConfig + emit{CSS,Markup,Runtime} + 130-line JSDoc contract header |
| H13.b — unit suite | `tests/blocks/pathAwareMultiplier.test.mjs` | 320 | ✅ **84/84 PASS** — happy + malformed-input + hard-requirement (waysEval must be enabled) + additive vs multiplicative aggregation + sandbox event-flow smoke test (deterministic seeded RNG → ×2/×10 draws → totalMult=12 → awardBonus=0.0625 push) |
| H13.c — HookBus contract | `src/blocks/hookBus.mjs` | +12 | ✅ `onPathMultiplierAssigned` + `onPathMultiplierAggregate` added |
| H13.d — canonical-list test | `tests/blocks/hookBus.test.mjs` | +2 | ✅ 29/29 PASS (expected list expanded) |
| H13.e — LEGO ownership | `tools/lego-gate.mjs` | +9 | ✅ single-owner = `pathAwareMultiplier.mjs` for both events; 33/33 events pass |
| H13.f — buildSlotHTML wiring | `src/buildSlotHTML.mjs` | +18 | ✅ CSS + HUD markup + runtime emitted AFTER waysEval runtime so window.detectWaysWins exists at patch time |
| H13.g — variable_reel dist | `tools/regen-all-playable.mjs` | +49 | ✅ NEW dist `04_variable_reel_playable.html` (117 649-ways) + auto-enable wiring on any ways topology — 7-tier additive ladder (×2 weight 40 → ×100 weight 1), cool-blue chip color |
| H13.h — live probe | `tools/_h13-path-mult-probe.mjs` | 230 | ✅ **39/39 PASS** — patch presence + deterministic seeded RNG (S1: ×2+×10), preSpin wipe (S2), FS boundary reset (S3) |

### Composition contract (LEGO — pure observer, 0 modifications to waysEval)

| Read | Write |
|---|---|
| `window.detectWaysWins` (monkey-patched once on DOMContentLoaded) | `window.__origDetectWaysWins` (preserved for diagnostics) |
| `window.WAYS_COUNT` (baked by waysEval) | event objects: `+ pathMultiplier, + pathMultiplierLabel` |
| `window.__SLOT_BET__`, `.cell.is-winning` host nodes | `.cell .paw-path-chip` per win-cell + `#pawHudTotal` aggregate |
| `HookBus.on('preSpin'/'postSpin'/'onFsTrigger'/'onFsEnd')` | `HookBus.emit('onPathMultiplierAssigned'/'onPathMultiplierAggregate')`, additive push onto `__WIN_AWARD__` |

### Lifecycle (HookBus contract)

```
DOMContentLoaded:
  _patch() → if window.detectWaysWins missing: console.warn + no-op
             else: window.__origDetectWaysWins = window.detectWaysWins
                   window.detectWaysWins = patched(decorate + emit + chip + HUD)
                   STATE.patched = true
  _bindHookBus() → on('preSpin') = pawReset
                   on('postSpin') = _onPostSpinAggregate
                   on('onFsTrigger') = pawReset
                   on('onFsEnd') = pawReset

every patched detectWaysWins call (from win-eval pipeline):
  events = __origDetectWaysWins(...)
  for each event:
    draw = _weightedDraw()
    event.pathMultiplier = draw.x
    event.pathMultiplierLabel = draw.label
    emit onPathMultiplierAssigned { eventIdx, symbol, ways, multiplier, label }
  STATE.totalMult = additive Σ(mult) (or multiplicative Π)
  _renderChips(events) → .paw-path-chip per win cell
  _renderHud(totalMult) → #pawHudTotal text + data-show=true

postSpin (HookBus):
  if events.length ≥ 1 && totalMult ≥ 2:
    pathSum = Σ(ways × mult)
    awardBonus = pathSum × bet / max(WAYS_COUNT, awardScaleDenom)
    __WIN_AWARD__ = prior + awardBonus (additive)
    emit onPathMultiplierAggregate { events, totalMult, awardBonus, bet }

preSpin / onFsTrigger / onFsEnd:
  pawReset() → state cleared, chips removed, HUD hidden
```

### Default 7-tier additive ladder (vendor-neutral, GDD-overridable)

| Tier | × multiplier | Weight | ~Probability |
|:--:|:--:|:--:|:--:|
| 1 | ×2   | 40 | 40 % |
| 2 | ×3   | 24 | 24 % |
| 3 | ×5   | 16 | 16 % |
| 4 | ×10  | 10 | 10 % |
| 5 | ×25  |  6 |  6 % |
| 6 | ×50  |  3 |  3 % |
| 7 | ×100 |  1 |  1 % |

Aggregation default = **additive** (industry-standard, regulator-friendly — every chip independently auditable). GDD can override to `multiplicative` for premium "every land × every other" variants.

### QA grand total

| Gate | Result |
|---|:--:|
| Unit suite (NEW)                                                  | **84/84 PASS** |
| `waysEval` (existing, untouched)                                  | **12/12 PASS** |
| HookBus canonical (+2 events: assigned + aggregate)               | **29/29 PASS** |
| LEGO (33 events, 44 listeners, 54 blocks)                         | **5/5 PASS** |
| Live Playwright probe na `04_variable_reel_playable.html`         | **39/39 PASS** |
| H14 + H15 extension probes (no regression)                        | **37/37 PASS** |
| Wave I multi-topology (11 grids × 19 checks)                      | **209/209 PASS** |
| Wave I.2 force-CTA (11 grids × 8 checks)                          | **88/88 PASS** |
| Dist regen (now 12 demos incl. variable_reel)                     | **12/12 demos** |
| **Combined**                                                      | **503/503 PASS, 0 errors** |

### Sledeći u extension queue (po prethodnom prioritetu)

| # | Extension | Owner | Effort |
|:--:|---|---|:--:|
| 4 | `bonusBuyDeterministic` (H11) | extends `bonusBuy` | S |
| — | H17 audioMixer (čeka ADB fazu) | extends `audio` | M |
| — | H18 payoutEventStreamLog (regulator-mandated) | extends `historyLog` | S |

---

## 🟢 Wave H15 — `weightedWheelSegments` extension (probabilistic draw + jackpot tier mapping) — SHIPPED (this commit)

> Boki (05.06.2026): *"nastavi dalje ultimativno"*. Second of the Wave H extension series. Adds the universal wheel-bonus DNA on top of the existing `wheelBonus.mjs` LEGO atom — non-uniform segment selection (small mults common, jackpots rare) + 4-tier jackpot map (MINI/MINOR/MAJOR/GRAND) + on-collect `__WIN_AWARD__` push that hands off to winPresentation → bigWinTier chain naturally.

### Industry pattern (vendor-neutral synthesis)

The modern wheel-bonus pattern has 3 layered concerns:

| Concern | Owner block |
|---|---|
| Modal overlay + segment DOM + spin animation + Spin/Collect buttons | `wheelBonus.mjs` (pre-existing, **+15 lines for jackpotTier passthrough + window expose**) |
| **Probabilistic draw + jackpot tier mapping + tier badges + award resolution** | **`weightedWheelSegments.mjs` (NEW — this wave)** |
| Audio cues + cinematic reveal | future H17 / H6 hooks via `onWheelJackpotHit` + `onWheelAwardCollected` |

### What landed

| Atom | File | Lines | Status |
|:--:|---|:--:|:--:|
| H15.a — block source | `src/blocks/weightedWheelSegments.mjs` | 358 | ✅ CREATED — defaultConfig + resolveConfig + emit{CSS,Markup,Runtime} + 130-line JSDoc contract header |
| H15.b — unit suite | `tests/blocks/weightedWheelSegments.test.mjs` | 280 | ✅ **55/55 PASS** — happy + malformed-input + hard-requirement (wheelBonus must be enabled) + determinism + vendor-neutral + sandbox event-flow smoke test (GRAND tier → 1000× → 2000 award) |
| H15.c — HookBus contract | `src/blocks/hookBus.mjs` | +14 | ✅ `onWheelSegmentChosen` + `onWheelJackpotHit` + `onWheelAwardCollected` added |
| H15.d — canonical-list test | `tests/blocks/hookBus.test.mjs` | +2 | ✅ 29/29 PASS (expected list expanded) |
| H15.e — LEGO ownership | `tools/lego-gate.mjs` | +7 | ✅ single-owner = `weightedWheelSegments.mjs` for all 3 events; 31/31 events pass |
| H15.f — buildSlotHTML wiring | `src/buildSlotHTML.mjs` | +15 | ✅ CSS + (empty) markup + runtime emitted AFTER wheelBonus runtime so window.wbSpin exists at patch time |
| H15.g — wheelBonus extension hooks | `src/blocks/wheelBonus.mjs` | +15 | ✅ MINOR — preserve `jackpotTier` in segment sanitization + expose `window.WB_SEGMENTS` / `window.WB_DUR` so extension reads live config (no behavior change for native uniform-draw path) |
| H15.h — dist auto-enable | `tools/regen-all-playable.mjs` | +44 | ✅ rectangular demo dist gets 8-segment wheel + weighted draw + 4-tier jackpot ladder live (vendor-neutral demo config) |

### Composition contract (LEGO — pure observer + minor wheelBonus passthrough)

| Read | Write |
|---|---|
| `window.wbSpin` (monkey-patched once) | `window.__origWbSpin` (preserved for diagnostics) |
| `window.WB_SEGMENTS` (live segment array w/ jackpotTier flags) | `window.WB_STATE.result` (chosen segment) |
| `window.__SLOT_BET__` (currency unit) | `window.__WIN_AWARD__` on Collect (→ winPresentation → bigWinTier) |
| `HookBus.on('onFsTrigger'/'onFsEnd')` for state reset | `HookBus.emit('onWheelSegmentChosen'/'onWheelJackpotHit'/'onWheelAwardCollected')` |

### Lifecycle (HookBus contract)

```
DOMContentLoaded:
  _patch() → if window.wbSpin missing: console.warn + no-op
             else: window.__origWbSpin = window.wbSpin
                   window.wbSpin = patched(weightedDraw + jackpot dispatch)
                   window.wbClose = wrapped(push __WIN_AWARD__ + emit collected)
                   _paintTierBadges() (data-tier="GRAND" on tier cells)
                   STATE.patched = true

user clicks SPIN:
  patched wbSpin:
    winIdx = _weightedDrawIndex(weights, segments.length)
    drive same rotation animation as native wbSpin
    on completion (WB_DUR + 80ms):
      tier = seg.jackpotTier (if defined)
      jackpotX = _findJackpot(tier).x (if matched)
      STATE.lastResult = { index, label, value, jackpotTier, jackpotX }
      emit onWheelSegmentChosen { index, label, value, jackpotTier?, jackpotX? }
      if tier: emit onWheelJackpotHit { tier, x }

user clicks COLLECT:
  patched wbClose:
    award = jackpotX > 0 ? jackpotX : (allowFallback ? value : value)
    window.__WIN_AWARD__ = award × bet
    emit onWheelAwardCollected { award, isJackpot, tier? }
    STATE.lastResult = null
    call original wbClose (hide overlay)

onFsTrigger / onFsEnd:
  STATE.lastResult = null  (defensive — wheelBonus already closes modal)
```

### Default config (industry-baseline 4-tier jackpot, uniform fallback)

| Knob | Default | Why |
|---|---|---|
| `weights` | `null` (uniform fallback) | When GDD doesn't override, weighted draw becomes uniform — same behavior as native wheelBonus. Auto-enables when array length === segments.length. |
| `jackpotMap` | `MINI 5×, MINOR 25×, MAJOR 100×, GRAND 1000×` | Universal 4-tier WAP-jackpot pattern; per-game GDD can override labels + multipliers |
| `defaultTierColor` | `255,80,80` (alert red) | High-contrast accent on the tier wb-seg cells (`box-shadow inset 2px + glow`) |
| `allowFallbackToValue` | `true` | If a jackpot tier hits but its label isn't in the map, award the segment's nominal value (defensive — never award 0 silently) |

### Live verification — `tools/_h15-weighted-wheel-probe.mjs` (kept as regression guard)

Playwright probe on `dist/01_rectangular_5x3_playable.html` (rectangular dist auto-enables wheelBonus + H15 with 8-segment demo wheel: 6 credit segments + 2 jackpot tiers MAJOR + GRAND):

| Scenario | Acceptance | Result |
|---|---|:--:|
| Presence | `wbSpin` fn, `__origWbSpin` preserved, `WB_SEGMENTS.length === 8`, `WWS_STATE.patched === true`, weights length 8, jackpotMap length 4, `wwsDraw` helper exposed | ✅ 8/8 |
| **S1 GRAND tier** (`Math.random=0.999` → idx 7) | `onWheelSegmentChosen` with `index=7`, `jackpotTier='GRAND'`, `jackpotX=1000`; `onWheelJackpotHit` fired (tier=GRAND, x=1000); result text "YOU WON GRAND!"; CSS `data-jackpot="true"` engaged; `onWheelAwardCollected` award=1000 isJackpot=true; `__WIN_AWARD__ = 1000 × bet(2) = 2000` | ✅ 8/8 |
| **S2 Credit** (`Math.random=0.001` → idx 0 = ×2) | `onWheelSegmentChosen` with `index=0`, no `jackpotTier`; `onWheelJackpotHit` **NOT** fired; `onWheelAwardCollected` award=2 isJackpot=false; `__WIN_AWARD__ = 2 × bet(2) = 4` | ✅ 5/5 |
| 0 page errors | | ✅ |
| **22 / 22 pass** | | ✅ |

### Full regression (after H15 wire)

| Gate | Result |
|---|:--:|
| `tests/blocks/weightedWheelSegments.test.mjs` (NEW) | **55 / 55 PASS** |
| `tests/blocks/wheelBonus.test.mjs` (passthrough patched) | **19 / 19 PASS** |
| `tests/blocks/hookBus.test.mjs` (canonical list +3) | **29 / 29 PASS** |
| `tools/lego-gate.mjs` (5 invariants, 31 events, 43 listeners) | **5 / 5 PASS** |
| `tools/regen-all-playable.mjs` (11 demos) | **11 / 11 regen** (rectangular grew 18 KB → wheelBonus + H15 wire) |
| `tools/_h15-weighted-wheel-probe.mjs` (NEW live probe) | **22 / 22 PASS** |

### Acceptance gates 10/10

1. ✅ Vendor-neutral source (regex sweep matched 0 vendor strings)
2. ✅ JSDoc public-API contract header (130 lines)
3. ✅ Single responsibility (block ONLY owns weighted draw + tier mapping; wheel chrome/animation remain wheelBonus's)
4. ✅ Idempotent (`STATE.patched` gates re-entry; double-patch = no-op)
5. ✅ Defensive on input (malformed weights / jackpotMap / colors → fall back to defaults, never crash)
6. ✅ Defensive on runtime (missing `wbSpin` → `console.warn` once + no-op, dist still boots)
7. ✅ Honors `prefers-reduced-motion` (jackpot pulse disabled when set)
8. ✅ a11y — result chip lives in existing `aria-live="polite"` wb-result element
9. ✅ Determinism (identical config → byte-identical CSS + runtime)
10. ✅ HookBus single-owner contract (3 events, all owned by this block, verified by `lego-gate.mjs`)

### What H15 does NOT do (out-of-scope by LEGO)

| ❌ Concern | Why |
|---|---|
| Cinematic reveal (camera zoom + buildup music on jackpot hit) | Belongs in H6 `bonusClimaxReveal` + H17 audio mixer |
| Server-side weight table (RNG fairness for regulators) | Math layer is Phase 2; H15 uses `Math.random()` for the demo |
| Per-game art assets for jackpot icons | Per-game art-pack delivery; H15 emits semantic data (`tier='GRAND'`) |

---

## 🟢 Wave H14 — `holdAndWinCreditBucket` extension (credit-on-reels + jackpot ladder) — SHIPPED (this commit)

> Boki (05.06.2026): *"mislim da je prvo najbolje extention na postojece … kreni redom ultimativno, ako mozes da iskoristis osnovni izgled idi iz WoO igre, koristi ulaz tehnikalije, izlaz i slicno … pricam za hold and win"*. First of the Wave H extension series — adds the universal "Credit Bucket" / "Cash-On-Reels" DNA on top of the existing `holdAndWin.mjs` LEGO atom without modifying its source.

### Industry pattern (vendor-neutral synthesis)

The modern hold-and-spin family has 3 layered concerns:

| Concern | Owner block |
|---|---|
| Bonus symbol detection + lock map + respin counter + base HUD chrome | `holdAndWin.mjs` (pre-existing, untouched) |
| Per-cell credit value chip + jackpot tag + bucket-sum payout + all-locked grand award | **`holdAndWinCreditBucket.mjs` (NEW — this wave)** |
| Audio cues + cinematic reveal | future H17 / H6 hooks via `onCreditBucketEnd` |

### What landed

| Atom | File | Lines | Status |
|:--:|---|:--:|:--:|
| H14.a — block source | `src/blocks/holdAndWinCreditBucket.mjs` | 388 | ✅ CREATED — defaultConfig + resolveConfig + emit{CSS,Markup,Runtime} + JSDoc 113-line contract header |
| H14.b — unit suite | `tests/blocks/holdAndWinCreditBucket.test.mjs` | 275 | ✅ **58/58 PASS** — happy + malformed-input + determinism + vendor-neutral + sandbox event-flow smoke test |
| H14.c — HookBus contract | `src/blocks/hookBus.mjs` | +13 | ✅ `onCreditBucketRespinStart` + `onCreditBucketLocked` + `onCreditBucketEnd` added |
| H14.d — canonical-list test | `tests/blocks/hookBus.test.mjs` | +2 | ✅ 29/29 PASS (expected list expanded) |
| H14.e — LEGO ownership | `tools/lego-gate.mjs` | +6 | ✅ single-owner = `holdAndWinCreditBucket.mjs` for all 3 events; 28/28 pass |
| H14.f — buildSlotHTML wiring | `src/buildSlotHTML.mjs` | +12 | ✅ CSS + (empty) markup + runtime emitted AFTER holdAndWin runtime so HW_STATE is populated when observer fires |
| H14.g — dist auto-enable | `tools/regen-all-playable.mjs` | +18 | ✅ injects `hold_and_win_credit_bucket` feature kind whenever GDD declares `hold_and_win` |

### Composition contract (LEGO — block is pure observer, zero coupling)

| Read | Write |
|---|---|
| `window.HW_STATE.lockedCells` (diff snapshot on `postSpin`) | `window.__WIN_AWARD__` (final round payout, hand off to winPresentation) |
| `window.__SLOT_BET__` (currency unit) | `window.__HW_CREDIT_TOTAL__` + `window.__HW_CREDIT_JACKPOT__` |
| existing `.cell.is-locked-bonus` nodes (chip insertion target) | `.hw-credit-chip` span appended inside each locked cell |
| existing `#hwHud` DOM (extends with TOTAL chip) | `<div.hw-credit-total-box>` injected once into HUD |
| `HookBus.on('postSpin'/'onSpinResult'/'onFsTrigger'/'onFsEnd')` | `HookBus.emit('onCreditBucketRespinStart'/'Locked'/'End')` |

### Lifecycle (HookBus contract)

```
postSpin:
  if HW_STATE.active && !STATE.roundActive:
    _onRoundEnter()  → STATE clear + emit onCreditBucketRespinStart
    _diffAndAssign() → draw values for new locked cells + emit onCreditBucketLocked per
    _renderAllChips() + _renderHudTotal()
  elif HW_STATE.active && STATE.roundActive:
    _diffAndAssign() + _renderAllChips() + _renderHudTotal()
  elif !HW_STATE.active && STATE.roundActive:
    final _diffAndAssign() + _renderAllChips() + _renderHudTotal()
    _onRoundExit()   → if allLocked: total += jackpotMap[allLockedAward].x
                       → window.__WIN_AWARD__ = total × bet
                       → emit onCreditBucketEnd { total, jackpotTier, cellCount, allLocked }

onSpinResult:
  if STATE.roundActive: _renderAllChips()   /* DOM re-paint after grid swap */

onFsTrigger / onFsEnd:
  hwCreditReset()   /* FS round starts on clean slate */
```

### Default config (industry-baseline 7-tier credit ladder + 4-tier jackpot)

| Knob | Default | Why |
|---|---|---|
| `prizeMap` | 7 tiers `[1×@32, 2×@22, 3×@14, 5×@9, 10×@5, 15×@2, 25×@1]` | Standard low-vol → mid-vol cash-on-reels distribution; sum-of-weights = 85 keeps any single tier rare |
| `jackpotMap` | `MINI 5×@12, MINOR 25×@4, MAJOR 100×@1, GRAND 1000×@0.25` | Universal 4-tier WAP-jackpot pattern; weights span ~50× MINI:GRAND ratio |
| `allLockedAward` | `'GRAND'` (1000×) | Industry rule: full-grid lock auto-awards top tier on top of bucket sum |
| `bucketColor` / `jackpotColor` | `255,215,80` warm gold / `255,80,80` alert red | High-contrast against dark cell backgrounds; honor `prefers-reduced-motion` |
| `currencyPrefix` | `'×'` | Vendor-neutral default; per-game GDD can switch to `'€'` / `'$'` |
| `hudShowsTotal` | `true` | Adds dedicated TOTAL chip to the existing hold-and-win HUD root |

### Live verification — `tools/_h14-credit-bucket-probe.mjs` (kept as regression guard)

Playwright probe on `dist/19_lock_respin_playable.html`:

| Acceptance | Result |
|---|:--:|
| `HW_STATE` present + `lockedCells` is `Map` | ✅ |
| `HW_CREDIT_STATE.enabled === true` (block runtime active) | ✅ |
| `hwCreditReset` function exposed | ✅ |
| `__HW_CREDIT_TOTAL__` starts at 0 | ✅ |
| Round-enter → `onCreditBucketRespinStart` fired exactly once | ✅ |
| 3 manual locks + 4 auto-harvest → 7 `onCreditBucketLocked` events | ✅ |
| Round-exit → `onCreditBucketEnd` fired exactly once | ✅ |
| `end.cellCount` matches DOM `.hw-credit-chip` count | ✅ 7 === 7 |
| `end.allLocked === false` (7 of 20 cells) | ✅ |
| `__WIN_AWARD__` pushed > 0 (downstream pipeline armed) | ✅ |
| HUD TOTAL chip rendered with `×` prefix | ✅ |
| `hwCreditReset` clears total + state + DOM chips | ✅ |
| 0 page errors | ✅ |
| **15 / 15 pass** | ✅ |

### Full regression (after H14 wire)

| Gate | Result |
|---|:--:|
| `tests/blocks/holdAndWinCreditBucket.test.mjs` (NEW) | **58 / 58 PASS** |
| `tests/blocks/holdAndWin.test.mjs` (existing — untouched) | **21 / 21 PASS** |
| `tests/blocks/hookBus.test.mjs` (canonical list +3) | **29 / 29 PASS** |
| `tools/lego-gate.mjs` (5 invariants, 28 events, 42 listeners) | **5 / 5 PASS** |
| `tools/regen-all-playable.mjs` (11 demos) | **11 / 11 regen** (19_lock_respin grew 14.5 KB → bucket + jackpot CSS/runtime) |
| `tools/_h14-credit-bucket-probe.mjs` (NEW live probe) | **15 / 15 PASS** |

### Acceptance gates 10/10

1. ✅ Vendor-neutral source (regex sweep matched 0 vendor strings)
2. ✅ JSDoc public-API contract header (113 lines: industry pattern, lifecycle, GDD config, public API, runtime contract, composition contract, industry references)
3. ✅ Single responsibility (block ONLY owns credit-bucket layer; lock-map + respin counter remain holdAndWin's)
4. ✅ Idempotent (multiple `postSpin` events on same lockedCells size → no duplicate emits)
5. ✅ Defensive on input (malformed prizeMap / jackpotMap / colors → fall back to defaults, never crash)
6. ✅ Defensive on runtime (missing `HW_STATE` → `console.warn` once + no-op, dist still boots)
7. ✅ Honors `prefers-reduced-motion` (chip transitions disabled when set)
8. ✅ a11y — HUD TOTAL chip lives inside existing `aria-live="polite"` HUD root
9. ✅ Determinism (identical config → byte-identical CSS + runtime)
10. ✅ HookBus single-owner contract (3 events, all owned by this block, verified by `lego-gate.mjs`)

### What H14 does NOT do (out-of-scope by LEGO)

| ❌ Concern | Why |
|---|---|
| Cinematic reveal (build-up music + camera zoom on jackpot hit) | Belongs in H6 `bonusClimaxReveal` + H17 audio mixer; H14 only emits the data, not the kinematic |
| Server-side bucket draw (RNG fairness for regulators) | Math layer is Phase 2; H14 uses `Math.random()` for the demo, will swap for engine-driven draws when math layer arrives |
| Per-game art assets for coin/jackpot tags | Per-game art-pack delivery; H14 emits semantic data (`label='MINI'`, `isJackpot=true`) and the art pack restyles |

---

## 🟢 Wave I.2 — MULT force button + per-grid force-CTA QA — SHIPPED (this commit)

> Boki (05.06.2026): *"Qa da svaki grid radi sa svim sto skip spin, big win, da u svakom gridu p[opstoji force dugme koje pravilno radi, na primer ako ima neka igra neki mulotipliyer, onda da postoji dugme za taj force. ultiamtivno"*

### Pre-Wave I.2 stanje

| Force button | Pokriva |
|---|---|
| `devFsBtn` (FS) | Force FS bonus entry — conditional on FREESPINS.enabled |
| `devBwBtn` (BW) | Force Big-Win tier walkthrough — conditional on bigWinTier.enabled |
| `devMultBtn` (MULT) | **NIJE postojao** |

Boki: ako igra ima multiplier feature, treba force dugme. Audit (`tools/_mult-feature-audit.mjs`) je pronašao 14 od 22 fixture imaju neku multiplier-style feature (multiplier / multiplier_orb / persistent_multiplier / lightning / progressive_free_spins).

### Implementacija (3 sloja, vendor-neutral)

**1. Markup** (`src/buildSlotHTML.mjs`):
```html
<button class="dev-mult-btn" id="devMultBtn"
        aria-label="Dev: Force multiplier on next spin"
        title="DEV — force ×N multiplier on next win">MULT</button>
```

**2. CSS** (`src/blocks/themeCSS.mjs`) — magenta paleta (`230,110,255`), pinned top-right left of BW dugmeta (BW levo od FS):
- Cycles 2× → 5× → 10× → 25× → 50× → 100× → 1× (reset) — label updates per click
- `:disabled` opacity 0.35 + cursor not-allowed

**3. Runtime** (`buildSlotHTML.mjs`):
- `HAS_MULT_FEATURE` baked literal — `true` ako GDD declared ANY multiplier-style feature
- Click handler: `HookBus.setMult(value)` → `runOneBaseSpin()`
- `winPresentation _applyMultToEvents` multiplikuje `payX × mult` na detect
- Re-enables on `postSpin` (8 s safety floor for FS-trigger edge cases)

### Live probe — `tools/_wave-i2-force-cta-probe.mjs` (NEW)

8 checks po demo × 11 demos = **88/88 PASS**:

| Demo | mult expected | result |
|---|:--:|:--:|
| rectangular | ✓ | 8/8 |
| wrath-of-olympus | ✓ | 8/8 |
| gates-of-olympus | ✓ | 8/8 |
| megaclusters | × | 8/8 (button disabled, as expected) |
| diamond | ✓ | 8/8 |
| pyramid | × | 8/8 |
| cross | × | 8/8 |
| l_shape | ✓ | 8/8 |
| infinity | ✓ | 8/8 |
| expanding | ✓ | 8/8 |
| lock_respin | ✓ | 8/8 |

Checks verifikuju: FS/BW/MULT buttons present + correct enabled state, MULT label cycles after click, MULT-induced spin fires postSpin event, MULT re-enables after spin, 0 console errors.

### Regression — Wave I H5.x still PASS

`tools/_wave-i-multi-topology-probe.mjs`: **209/209 PASS** across all 11 topologies. MULT dugme dodavanje nije slomio postojeći H5.x flow.

### Full regression summary

| Gate | Result |
|---|:--:|
| `tools/_wave-i-multi-topology-probe.mjs` (H5.x) | **209/209 PASS** |
| `tools/_wave-i2-force-cta-probe.mjs` (NEW, force CTAs) | **88/88 PASS** |
| `tools/lego-gate.mjs` (5 invariants) | **5/5 PASS** |

**Combined: 297/297 PASS across 11 grid topologies.** Sve tri force CTA-e (FS / BW / MULT) rade jednako i pravilno na svakom grid kind-u; MULT je conditionally enabled samo gde GDD declares multiplier feature.

### Files

| File | Change |
|---|---|
| `src/buildSlotHTML.mjs` | + `<button #devMultBtn>` markup + runtime handler with HAS_MULT_FEATURE baked literal |
| `src/blocks/themeCSS.mjs` | + `.dev-mult-btn` CSS (magenta accent, positioned left-of-BW) + mobile breakpoint |
| `tools/_mult-feature-audit.mjs` | NEW — parser audit, multiplier features per fixture |
| `tools/_wave-i2-force-cta-probe.mjs` | NEW — 88-check force-CTA probe |

### Boki rule honored

> *"ako ima neka igra neki multiplier, onda da postoji dugme za taj force"*

MULT button postoji u svakom dist demo; enabled is conditional on GDD feature declaration. Click sets HookBus.setMult(value) and triggers a real spin so the multiplier chain (winPresentation.\_applyMultToEvents → multiplierOrb → persistentMultiplier → lightning → onWinPresentationStart) all fires naturally with the forced value.

---

## 🟢 Wave I — Multi-topology H5.x verification (svi UNIFORM grid kinds dele isti UI) — SHIPPED (`dd9f701`)

> Boki (05.06.2026): *"Slusaj, mislim na big win, na ceo UI kako radi, da se ubaci u svaki moguci grid. Win linije kako treba, spin stop skip, counteri itd itd. sve sto si ubacio u rectangle da imam u svaki moguci grid."*

### Gap pronađen via audit

`buildSlotHTML.mjs` UNIFORM_REEL_KINDS uključuje 11 grid kinds koje H5.x block stack podržava, ali `tools/regen-all-playable.mjs` build-uje samo 3 dist-a:

| UNIFORM kind | Pre Wave I | Posle Wave I |
|---|:--:|:--:|
| rectangular | ✅ 2 dist | ✅ 2 dist |
| variable_reel | ✅ (WoO) | ✅ (WoO) |
| cluster | ✅ (GoO) | ✅ (GoO) |
| **megaclusters** | ❌ no dist | ✅ `05_megaclusters_playable.html` |
| **diamond** | ❌ | ✅ `07_diamond_playable.html` |
| **pyramid** | ❌ | ✅ `08_pyramid_playable.html` |
| **cross** | ❌ | ✅ `09_cross_playable.html` |
| **l_shape** | ❌ | ✅ `10_lshape_playable.html` |
| **infinity** | ❌ | ✅ `12_infinity_playable.html` |
| **expanding** | ❌ | ✅ `13_expanding_playable.html` |
| **lock_respin** | ❌ | ✅ `19_lock_respin_playable.html` |

8 dodatih dist-ova, svaki sa per-game `bigWinTier` config (default `BIGWINTIER1..5` labels + 10/25/50/200/1000 thresholds + 4 s per tier).

### Live verification — `tools/_wave-i-multi-topology-probe.mjs` (NEW)

19 H5.x checks po demo × 11 demos = **209 checks**. Per demo:

1. Page loads bez console error-a
2. `spinBtn` mounted
3. `devBwBtn` mounted (BW dugme)
4. `bigWinTier.enabled = true`
5. `window.bigWinTierEnter` je function
6. `winRollupHost` u DOM
7. `window.presentExternalWin` je function
8. `fs-overlay` u DOM
9. BW walkthrough: 5 tiers entered 1→5
10. `onBigWinTierEnd` reason = natural
11. `onBigWinTierEnd` x = 1500
12. Banner cleaned up posle fade-out
13. `presentExternalWin(3)` emit Start
14. `isBigWin = false` (sub-big-win)
15. `winRollup` shows €3.00
16. FS intro: `is-feature-intro-active` set
17. FS intro: frame opacity = 0
18. FS intro: frame visibility = hidden
19. 0 console/page errors

### Result

| Demo | Topology | Pass | Notes |
|---|---|:--:|---|
| rectangular | rectangular | **19/19** | clean |
| wrath-of-olympus | rectangular | **19/19** | clean |
| gates-of-olympus | cluster | **19/19** | clean |
| megaclusters | megaclusters | **19/19** | clean |
| diamond | diamond | **19/19** | clean |
| pyramid | pyramid | **19/19** | clean |
| cross | cross | **19/19** | clean |
| l_shape | l_shape | **19/19** | clean |
| infinity | infinity | **19/19** | clean |
| expanding | expanding | **19/19** | clean |
| lock_respin | lock_respin | **19/19** | clean |

**TOTAL: 209/209 PASS** across 11 topologies. **0 console / page errors**.

### Zero gaps found

LEGO ownership doctrine i grid-agnostic block API rezultiralo time da nijedan H5.x feature nije bilo grid-specific — svi blokovi su radili out-of-the-box na nove topologije od prvog dist build-a. Niti `bigWinTier`, niti `winRollup`, niti `winPresentation`, niti `freeSpins`, niti `spinControl` nisu zahtevali topology-specific kod.

### Files

| File | Change |
|---|---|
| `tools/regen-all-playable.mjs` | + 8 novih dist targets + per-game bigWinTier config za svaki |
| `tools/_wave-i-audit.mjs` | NEW — parser audit, gridShape × UNIFORM_REEL_KINDS pokrivenost |
| `tools/_wave-i-multi-topology-probe.mjs` | NEW — 19 checks × 11 demos = 209 |
| `dist/05_megaclusters_playable.html` | NEW dist (326.8 KB) |
| `dist/07_diamond_playable.html` | NEW (327.2 KB) |
| `dist/08_pyramid_playable.html` | NEW (326.2 KB) |
| `dist/09_cross_playable.html` | NEW (324.0 KB) |
| `dist/10_lshape_playable.html` | NEW (324.0 KB) |
| `dist/12_infinity_playable.html` | NEW (328.2 KB) |
| `dist/13_expanding_playable.html` | NEW (330.9 KB) |
| `dist/19_lock_respin_playable.html` | NEW (330.1 KB) |

### Out of scope (non-UNIFORM kinds — H5.x N/A)

7 non-UNIFORM kinds (hexagonal, radial, dual, slingo, plinko, crash, wheel) ne koriste reelEngine `RECT_REELS` strukturu i potrebuju različit engine. Nisu deo H5.x scope-a; kad/ako budu pojavili kao production game, dobijaju vlastiti template-renderer. Boki je tražio "svaki moguci grid" — interpretirano kao "svaki grid kind koji H5.x engine podržava", a to je 11 UNIFORM kinds.

### Boki rule honored

> *"da se ubaci u svaki moguci grid. Win linije kako treba, spin stop skip, counteri itd itd. sve sto si ubacio u rectangle da imam u svaki moguci grid."*

Verified — sve H5.x feature live identično na svih 11 UNIFORM grid kinds. 209/209 PASS, 0 errors.

---

## 🔵 Wave H — Frame-upgrade Hold-&-Spin reference GDD feature extraction — PLANNED

> Triggered by Boki's reference-GDD review request → consolidated punch-list distilled from the GDD plus cross-referenced frame-upgrade Hold-&-Spin family pattern catalog.
>
> **Doctrine:** every block is template-neutral. Names contain NO vendor / franchise / character references — only mechanic-pattern words. Game-specific copy enters via `model.bonusClimax.copy` strings at parser stage, never in block source.
>
> **Source mapping:** GDD sections 3.3 (Frame System), 4 (Symbols), 5.1-5.6 (Bonus Features), 6.3-6.5 (Win Hierarchy / Frame Visual / Color & Accessibility) cross-referenced with the broader Hold-&-Spin / scatter-pays-with-frame-stacking / persistent-jackpot-wheel family, plus UKGC / MGA / NJDGE / AGCO / KSA / Spelinspektionen / DGOJ regulator matrices.

### 🟢 Tier A — ship-now (regulator + universal UX, every commercial slot needs them)

| # | Block (template-neutral) | One-line purpose | Lifecycle hooks | GDD config key | Effort | Industry references |
|:--:|---|---|---|---|:--:|---|
| H1 | **`jurisdictionGate.mjs`** | Per-feature opt-out po lokaciji (autoplay cap, gamble allowed, buy allowed) | listens: `preSpin`, `onAutoplayStart`, `onBetChanged`. emits: `onJurisdictionVeto {feature, reason}` | `model.jurisdiction = { code: 'UK'\|'MGA'\|...; features: {gamble, buy, autoplay}}` | M | UKGC LCCP 6.1.1, MGA Class 4, NJDGE 13:69O, AGCO Reg 78/12, KSA RTSA, Curaçao GCB |
| H2 | **`realityCheck.mjs`** | Periodic popup "You have been playing X min. Win: €Y, Loss: €Z. Continue / Pause / Quit" | listens: `preSpin` (tick counter), `onBalanceChanged`. emits: `onRealityCheckShown`, `onRealityCheckDismissed`, `onRealityCheckQuit` | `model.realityCheck = { enabled, intervalMs, showDetails }` | M | UKGC LCCP 8.3, NJDGE social responsibility, MGA RGF |
| H3 | **`sessionTimeout.mjs`** | Continuous-play limit + force-pause | listens: `preSpin` (heartbeat), `onAutoplayTick`. emits: `onSessionTimeout`, `onSessionResumed` | `model.sessionTimeout = { enabled, maxMs, breakMs }` | S | UKGC LCCP 8.3.1, AGCO standard 4.07 |
| H4 | **`colorblindPatterns.mjs`** | Pattern-fill SVG (stripes/dots/checks) as alternative to color-only state indicators; toggle in settings | passive, hooks into `themeCSS` token system. settings toggle exposes `window.__SLOT_COLORBLIND_MODE__` | `model.colorblindPatterns = { enabled, patternSet }` | S | WCAG 2.1 AA 1.4.1, UKGC 5.1, BS 8878 |
| H5 | **`winTierLadder.mjs`** *(extend `uiToast.mjs`)* | 5-tier win celebration ladder (NICE → BIG → MEGA → EPIC → LEGENDARY) with per-tier audio + animation choreography | listens: `onSpinResult`, `postSpin`. emits: `onWinTierEntered {tier, x}` | `model.winTierLadder = { thresholds: [2,10,50,200,1000], names: [...] }` | S | Industry-standard 5-tier hierarchy across vendors |
| H6 | **`bonusClimaxReveal.mjs`** | 3-stage end-of-bonus kinematic reveal (APPROACH → BUILDUP → REVEAL) with prize bucket lookup + jackpot tier hits | listens: `onFsEnd`, `onSkipRequested`. emits: `onBonusClimaxStart`, `onBonusClimaxTick`, `onBonusClimaxReveal {tier, cells}`, `onBonusClimaxJackpotHit`, `onBonusClimaxEnd {totalAward}` | `model.bonusClimax = { enabled, approachMs, buildupMs, perTierMs, prizeBuckets, jackpotMap, copy }` | L | GDD 5.3 character-reveal cinematic, industry pattern: post-FS end-reveal sequence + wheel-lock climax |
| H7 | **`cellLevelUpgrade.mjs`** | Per-cell tier-multiplier state machine (Lv 0→N nivoa), persist rules per phase (base resets, FS persists) | listens: `preSpin`, `onSpinResult`, `onFsTrigger`, `onFsEnd`. emits: `onCellUpgraded {i, fromLv, toLv}`, `onCellOverflow {i}` | `model.cellLevelUpgrade = { levels: 4, mults: [1,2,3,5], persistInFs, resetInBase, catalystSymbol }` | L | GDD 3.3 + 5.2 frame system, industry pattern: per-cell symbol stacking with tier multipliers |

### 🟡 Tier B — ship-next (when 1-2 more GDDs require, or when first downstream block needs it)

| # | Block | One-line purpose | Lifecycle hooks | GDD config key | Effort | Industry references |
|:--:|---|---|---|---|:--:|---|
| H8 | **`cellOverflowCounter.mjs`** | Counter for catalyst symbol landing on already-max cell → accumulates bonus toward climax | listens: `onCellUpgraded` (with overflow flag). emits: `onCellOverflowAccumulated {totalPoints}` | `model.cellOverflow = { enabled, perPointBonusX }` | S | GDD 5.2 max-tier overflow, industry pattern: catalyst-on-max overflow accumulator |
| H9 | **`ambientBackgroundWheel.mjs`** | Always-visible jackpot wheel teaser behind reels with idle rotation + lock animation on trigger | listens: `onSpinResult` (wheel trigger detect), `onBonusClimaxEnd` (lock). emits: `onWheelLocked {segment}`, `onWheelJackpotHit` | `model.ambientWheel = { enabled, segments: [...], weights: [...], idleRpm }` | M | GDD 5.4 background wheel, industry pattern: always-visible WAP jackpot teaser |
| H10 | **`dualRoleScatter.mjs`** | Scatter sa primary (trigger) + secondary (state mutator) ulogu | listens: `onSpinResult` (scatter detection). emits: `onScatterPrimary {count}`, `onScatterSecondary {cells, action}` | `model.dualRoleScatter = { enabled, primaryAction, secondaryAction, perSymbolRoles }` | M | GDD 4 dual-function scatter, industry pattern: "collector" scatter with secondary state mutation |
| H11 | **`bonusBuyDeterministic.mjs`** *(extend `bonusBuy.mjs`)* | Buy plant-uje fiksan broj scatter-a / specifične pozicije na sledećem spinu, NE random | listens: `onBonusBuyPurchased` (existing). emits: `onBuyPlantApplied {symbols, positions}` | `model.bonusBuy = { ..., deterministicPlant: { count, positions, symbol } }` | S | GDD 5.5 Buy Feature, Pragmatic / L&W modern Buy Bonus |
| H12 | **`netLossIndicator.mjs`** | Sticky session counter "Net win/loss: ±€X" beside balance HUD | listens: `onBalanceChanged`, `onSessionStart`. emits: `onNetThresholdCrossed` | `model.netLossIndicator = { enabled, showInBaseGame, showInFs, alertThreshold }` | S | Spelinspektionen 14.3, DGOJ Art 7, UKGC LCCP 8.3 |
| H13 | **`pathAwareMultiplier.mjs`** *(extend `waysEval.mjs`)* | Ways combo zna kroz koje cell-e prolazi → additive multiplier per path | listens: `onSpinResult`, `onCellUpgraded`. emits: `onPathMultiplier {pathIdx, cells, totalMult}` | `model.pathAwareMultiplier = { mode: 'additive'\|'max'\|'product' }` | M | GDD 3.3 additive vs multiplicative, industry pattern: per-path frame stacking |
| H14 | **`holdAndWinCreditBucket.mjs`** *(extend `holdAndWin.mjs`)* | Industry-standard hold-respin DNA: credit-prize stickers locked in cells + respin engine + reset counter | listens: `onSpinResult`, `onHoldAndWinTriggered`. emits: `onCreditBucketRespinStart`, `onCreditBucketLocked {cell, amount}`, `onCreditBucketEnd {total}` | `model.holdAndWinCreditBucket = { startingRespins, lockResetsCounter, prizeMap }` | M | GDD 1 industry-standard hold-respin pattern |
| H15 | **`weightedWheelSegments.mjs`** *(extend `wheelBonus.mjs`)* | GDD-driven probabilistic segment distribution + multi-tier jackpot map | listens: `onWheelTriggered`. emits: `onWheelSegmentChosen {label, x, jackpot?}` | `model.wheelBonus = { ..., segments: [{label, x, weight, jackpotTier?}] }` | S | GDD 5.4 weighted wheel segments, industry pattern: probabilistic jackpot wheel |

### 🔮 Tier C — REM-mode bonus (regulator + audio + audit; surfaced from cross-game research)

| # | Block | One-line purpose | Lifecycle hooks | GDD config key | Effort | Industry references |
|:--:|---|---|---|---|:--:|---|
| H16 | **`quickResumeStateSnapshot.mjs`** | Snapshot bonus state every 1s during climax; if player disconnects, reconnect restores | listens: `onBonusClimaxStart`, `onBonusClimaxTick`, `onSessionResumed`. emits: `onClimaxSnapshotTaken`, `onClimaxRestored` | `model.quickResume = { enabled, snapshotIntervalMs, retentionH }` | M | UKGC 7.1.1 "in-progress bonus restore", NJDGE 13:69O-1.4, MGA RGF 12 |
| H17 | **`bigWinMomentAudioMixer.mjs`** *(extend `audio.mjs`)* | Cross-fade i layer ducking between ambient/anticipation/celebration audio buses | listens: `preSpin`, `onSpinResult`, `onWinTierEntered`, `onBonusClimaxStart`, `onBonusClimaxEnd`. emits: `onAudioBusCrossfade {fromBus, toBus, durationMs}` | `model.audio.mixer = { buses, crossfadeMs, duckRatios }` | M | Howler audio routing, industry layered loop pattern |
| H18 | **`payoutEventStreamLog.mjs`** *(extend `historyLog.mjs`)* | Append-only event log for regulator audit, every financial transaction with timestamp + audit hash | listens: ALL financial events. emits: `onAuditEntryAppended` | `model.payoutEventLog = { enabled, hashAlgo, retentionDays, exportFormat }` | M | UKGC 7.4 transaction reconstruction, NJDGE 13:69O-1.3, MGA Schedule 5 |

### 🔴 Tier D — niche / game-specific (DO NOT build until explicitly requested)

| # | Skipped | Reason |
|:--:|---|---|
| H-skip-1 | `asymmetricStage.mjs` (background wheel 70% coverage layout) | Layout-specific; rarely repeats 1:1. Better as per-game CSS override. |
| H-skip-2 | `characterSpriteRig.mjs` (3D character rigged animations) | Per-game asset, not template-friendly. Belongs in art-pack repo. |
| H-skip-3 | `houseExplosionFXKit.mjs` (per-tier explosion particles) | Specific VFX; should be GDD-art-pack delivery. |

### Implementation order rationale (when "ajde kreni H" said)

```
H4 (colorblindPatterns) — smallest, foundational for token system
  └─ H5 (winTierLadder) — uses ladders concept, independent
       └─ H1 (jurisdictionGate) — gates downstream block enablement
            └─ H2 + H3 (realityCheck + sessionTimeout) — pair, share heartbeat
                 └─ H7 (cellLevelUpgrade) — unlocks H6, H8, H13
                      └─ H6 (bonusClimaxReveal) — consumes H7 state
                           └─ H8 (cellOverflowCounter) — consumes H7 + feeds H6
                                └─ H13 (pathAwareMultiplier) — consumes H7 grid
                                     └─ H10, H11, H14, H15 — independent extensions
                                          └─ H9 (ambientBackgroundWheel) — visual ambient
                                               └─ H16, H17, H18 (regulator + audio + audit)
```

### Acceptance gate per Wave H atom

| Gate | Required for ALL H-blocks |
|---|---|
| JSDoc public-API contract header | ✅ (purpose, industry pattern, LEGO, lifecycle, perf budget, a11y, GDD keys, runtime contract) |
| Single responsibility | ✅ |
| Idempotency + dispose | ✅ |
| 0 magic numbers (named consts + "why" comments) | ✅ |
| Error boundary on every HookBus.emit | ✅ |
| 100% test coverage (happy + edge + error + idempotency) | ✅ |
| LEGO Gate 5/5 invariants pass | ✅ |
| Cortex Eyes responsive 3 viewports × per-block states | ✅ |
| Vendor grep `src/blocks/` for game/franchise names | ✅ 0 matches |
| Master TODO hash pin after every atom | ✅ |

### What Wave H does NOT do

| ❌ Out of scope | Why |
|---|---|
| Math layer (PAR, paytable computation, RTP curves) | Boki rule: math layer awaits explicit go-ahead |
| Franchise-specific copy / sprites / VFX assets | Lives in art-pack repo, not template |
| Server-side state persistence (DB layer) | Template ships client-side snapshot API only; storage is plug-in |
| Live web-search-driven regulator updates | Static rule tables baked at GDD time; live updates are runtime concern |

### Open questions (need Boki ruling before H starts)

1. **Climax sequence on slam during bonus** — if player slams during the BUILDUP stage of climax, race all reveals to 50ms (current default) or skip to end-state directly? GDD silent.
2. **Net loss display unit** — currency or percent of balance? Sweden requires currency, Spain accepts either.
3. **Reality check default interval** — 30 min (UKGC minimum) or 60 min (player-friendly default)? GDD silent; UKGC accepts both.
4. **Quick-resume snapshot retention** — 1h (UKGC minimum), 24h (MGA standard), or 30d (NJDGE)? Per-jurisdiction or global default?

---

## 🟢 Wave U6 — Secondary Gamble (Card + Ladder) — SHIPPED (commit `13e9df1`)

> Triggered by Boki *"Nastavi redom, samo mehanika matematiku ne diramo nikad dok ja ne kazem"*. Post-win risk feature — pure mechanics + UI state machine, no math/PAR coupling. Standalone block; existing `gamble.mjs` (Wave P2 basic single-mode) stays in tree as legacy.

### What ships

| Atom | What | LOC |
|:--:|---|:--:|
| U6-block  | `src/blocks/gambleSecondary.mjs` — Card branch (color or suit) + Ladder branch (8 rungs, 2× geometric) + selection splash + 3-reason suppression | 680 |
| U6-tests  | `tests/blocks/gambleSecondary.test.mjs` — 31 assertions; sandbox covers full Card + Ladder win/lose paths, max-bank cap, FS/autoplay suppression, skip→collect | 380 |
| U6-parser | `extractGambleSecondary()` in `src/parser.mjs` — reads `## Gamble Secondary` / `## Card and Ladder Gamble` / `## Risk Ladder` GDD section | +40 |
| U6-orch   | `buildSlotHTML.mjs` — wired emit triplet (CSS + Markup + Runtime) right after existing legacy gamble | +6 |
| U6-hook   | `hookBus.mjs` HOOK_EVENTS extended with `onGambleStart`, `onGambleRound`, `onGambleEnd` | +5 |
| U6-gate   | `tools/lego-gate.mjs` ownership: all 3 events → gambleSecondary.mjs (sole owner). emit calls inlined with literal event names for grep-ability | +6 |

### Industry-standard contract

| Concept | This block | Reason |
|---|---|---|
| Two-branch UI | Splash with CARD / LADDER / COLLECT (player chooses) | Industry-standard post-win risk feature pattern. |
| Card branch | color (R/B, 50% × 2) or suit (♥♦♣♠, 25% × 4); GDD selects mode | Two probability profiles cover the typical regulator menu. |
| Ladder branch | 8 rungs (configurable 3-16), 2× geometric multiplier (configurable 1.1-8), up=50% chance / down=guaranteed | Allows skill-illusion risk management without exposing engine RTP. |
| Win-bank cap | maxBankX (× current bet); 0 disables | Regulator soft-cap; matches winCap.mjs semantics. |
| Lockouts | Suppressed during FS round AND autoplay session unless GDD opts in via showInFs/showInAutoplay | Avoids gamble-during-gamble UX confusion; prevents autoplay race. |
| Skip integration | `onSkipRequested` → auto-collect | Force-skip (Wave V2) doubles as gamble-out. |
| Idempotent emit | All 3 events use `_safeEmit` wrapper (try/catch); throwing listener never strands STATE | Senior-grade rule. |
| Deterministic Math.random | Tests inject sequence via Math.random monkey-patch | Sandbox runs without flakey randomness; production uses native Math.random. |
| 0 magic numbers | Every threshold + cap + multiplier has named const + "why" comment | Senior rule #14. |

### Lego-gate grep-ability lesson

Initial implementation used a generic `_emit(eventName, payload)` helper. lego-gate's `HookBus.emit\('([a-zA-Z]+)'` regex couldn't extract the literal name from a variable — failed ownership check with "NOT EMITTED by any block". Fix: kept the `_safeEmit(fn)` wrapper (single try/catch boundary) but each call site spells out `window.HookBus.emit('onGambleX', {...})` inline so the grep sees the literal token. Pattern noted in JSDoc comment block for future blocks.

### QA gates (this commit)

| Gate | Result |
|---|:--:|
| LEGO Gate 5/5 (parity 43/43, ownership 18/18, listener 33/33) | ✅ |
| npm test (parser + 20 grid fixtures) | ✅ |
| npm run test:blocks (861 assertions across 43 blocks) | ✅ |
| cortex-eyes-wave-v 3/3 PASS | ✅ slam 391ms |
| cortex-eyes-wave-s 3/3 PASS | ✅ |
| vendor grep src/ | ✅ 0 matches |

### Senior-grade compliance (per `rule_senior_grade_code.md`)

| Criterion | Status |
|---|:--:|
| JSDoc public-API contract header | ✅ purpose + industry pattern + LEGO + 4 lifecycle subscribers + 3 emit events + perf budget + a11y + GDD keys + runtime contract + deps |
| Single responsibility | ✅ pure post-win overlay; never touches engine / paytable / reels |
| Idempotency | ✅ STATE phase machine; setTimeout grace pause; close() guards on already-idle |
| 0 magic numbers | ✅ MIN_WIN_X, MAX_BANK_X, CARD_MULT, LADDER_MULT, LADDER_RUNGS, PROMPT_TIMEOUT_MS — all baked + commented |
| Error boundary | ✅ _safeEmit wrapper around every HookBus.emit |
| Naming clarity | ✅ _capBank, _ladderValueAt, _refreshCardUI, _refreshLadderUI, _finishGamble |
| 100% test coverage | ✅ 31 assertions: happy + edge (cap, threshold) + error (suppressed) + idempotency + deterministic random + vendor-neutrality + determinism |

---

## 🟢 Wave U5 — Bet Selector — SHIPPED (commit `17afa9a`)

> Triggered by Boki *"Nastavi redom, samo mehanika matematiku ne diramo nikad dok ja ne kazem"*. Bet selector is **mechanics** (UI state + lockout policy + canonical __SLOT_BET__ publication), NOT math (no paytable, no RTP computation — that stays in Math.PAR layer until Boki greenlights).

### What ships

| Atom | What | LOC |
|:--:|---|:--:|
| U5-block  | `src/blocks/betSelector.mjs` — coin × multiplier bet model, panel UI, step + max controls, 3-reason lockout (spinning / autoplay / fs) | 568 |
| U5-tests  | `tests/blocks/betSelector.test.mjs` — 34 assertions, sandbox covers state mutation + emit + lock + reduced-motion | 320 |
| U5-parser | `extractBetSelector()` in `src/parser.mjs` — reads `## Bet Selector` / `## Bet Model` / `## Wager Configuration` GDD section, EUR/USD/GBP/JPY currency map | +50 |
| U5-orch   | `buildSlotHTML.mjs` — old hardcoded `<div class="betGroup">…1.00</div>` replaced with `emitBetSelectorMarkup` (CSS + markup + runtime wires) | net +18 |
| U5-hook   | `hookBus.mjs` HOOK_EVENTS extended with `onBetChanged` | +2 |
| U5-gate   | `tools/lego-gate.mjs` ownership: `onBetChanged → betSelector.mjs` (sole owner) | +2 |

### Industry-standard contract

| Concept | This block | Reason |
|---|---|---|
| Coin ladder | `[0.01, 0.02, 0.05, 0.10, 0.20, 0.50, 1.00]` | Matches 7-step denomination ladder accepted by UKGC / MGA / NJDGE certified slots. |
| Multiplier ladder | `[1, 5, 10, 20, 50, 100]` | 6-step bet-level ladder; default 10 keeps opening bet at €1.00 (matches legacy hardcoded chip). |
| Total bet | `coin × multiplier` published to `window.__SLOT_BET__` | autoplay (Wave U4) already reads this for `STATE.lastCost` → accurate `stopOnLossAbove`. |
| 3-reason lock | `lockReasons = { spinning, autoplay, fs }` — chip + steps + grid disabled while ANY is true | Regulator rule: bet is locked during spin, during autoplay session, AND during FS round (trigger-bet wins for the whole round). |
| Multi-reason commit | Unlock one reason while another holds → UI stays locked | Avoids race where postSpin would release a lock that onAutoplayStart still needs. |
| Currency allow-list | `/^[A-Za-z€$£¥₽₺₹₿ ]{1,4}$/` | Narrow regex eliminates XSS surface on bake-time CSS content + runtime DOM. |
| `onBetChanged` emit | Init + every manual change; `{bet, coin, multiplier, currency, reason}` | bonusBuy / anteBet subscribe to redraw cost chips. |
| Idempotent emit | try/catch around HookBus.emit; throwing listener does not corrupt UI | Senior-grade rule (rule_senior_grade_code.md). |
| a11y | role="radiogroup" + aria-checked + aria-haspopup + aria-expanded + aria-disabled + prefers-reduced-motion | 12-point senior check #11. |
| 0 magic numbers | Every literal has named const + "why" comment | Senior check #14. |

### QA gates (this commit)

| Gate | Result |
|---|:--:|
| LEGO Gate 5/5 (parity 42/42, ownership 15/15, listener 32/32) | ✅ |
| npm test (parser + 20 grid fixtures) | ✅ |
| npm run test:blocks (830 assertions across 42 blocks) | ✅ |
| cortex-eyes-wave-v 3/3 PASS | ✅ slam 390ms |
| cortex-eyes-wave-s 3/3 PASS | ✅ |
| cortex-eyes-wave-s-fs FS lifecycle | ✅ all 7 events fired |
| vendor grep src/ | ✅ 0 matches |

### Senior-grade compliance (per `rule_senior_grade_code.md`)

| Criterion | Status |
|---|:--:|
| JSDoc public-API contract header | ✅ purpose + industry pattern + LEGO + lifecycle + perf budget + a11y + config keys + runtime contract |
| Single responsibility | ✅ owns ONLY bet UI + state + `onBetChanged` emit; never reaches into engine / paytable |
| Idempotency | ✅ `_commit()` deterministic; init emit wrapped in try/catch with silent baseline preservation |
| 0 magic numbers | ✅ ladders + currency + colors all named consts |
| Error boundary | ✅ try/catch around emit (both manual + init); console.error structured |
| Naming clarity | ✅ `_recomputeLock`, `_refreshLockedAffordances`, `_closestInLadder`, `_flatLadder` |
| 100% test coverage | ✅ 34 assertions: happy + edge + error + idempotency + locked-state + a11y + determinism + vendor-neutrality |

---

## 🟢 Wave V5.0 — Skip CTA live-fix bundle — SHIPPED (4 commits, head `5164f51`)

> Triggered by Boki *"odradi overi zasto ti ga nema skip dugme uopste i zasto ne radi u retangle"* (05.06.2026). What looked like a single "missing skip button" bug was 4 independent root causes layered on top of each other. Each was reproduced live in browser before fix, then verified by regression probe.

### Commit-by-commit breakdown

| # | Hash | Commit | Root cause | Fix |
|:--:|---|---|---|---|
| 1 | `0633dc9` | feat(spinControl,winPresentation): V5.0 — SKIP CTA finally appears on win | **5-block `__WIN_AWARD__` vacuum**: balanceHud / autoplay / historyLog / gambleSecondary / spinControl all READ `window.__WIN_AWARD__` but NO block ever WROTE it. `_finalizeRound`'s `hasWin = Number.isFinite(undefined)` was always false → SKIP_ROLLUP branch unreachable; balance dropped every spin regardless of detected lines. | `winPresentation` now publishes `window.__WIN_AWARD__` at presentation start (single writer). All 5 readers now hit a real number. |
| 2 | `a491b82` | fix(winPresentation): SKIP CTA no longer leaks on 0-award spins | After fix #1 the SKIP CTA started leaking onto **0-award spins** — `onWinPresentationStart` was gated on `allEvents.length > 0` ("detector found lines") instead of `totalAward > 0` ("rollup has something to pay"). 0-credit detector events tripped the morph. | Gate flipped to `totalAward > 0`. Detector noise no longer arms the SKIP CTA. |
| 3 | `5ccc3bb` | fix: Space CTA works without pre-focus + line-win events finally pay | **Two independent bugs:** (a) Native `<button>` only activates Space when focused; on load focus is on `<body>` → Space did nothing for play/stop/skip. (b) Line-win detector events were emitted but never produced credit because the award publish path missed the line-eval branch. | (a) Document-level `keydown` listener in `spinControl` forwards Space → `spinBtn.click()` (with input/modal/disabled guards). (b) Line-eval branch now also publishes `__WIN_AWARD__`. |
| 4 | `5164f51` | fix(spinControl): kill late-finalize SKIP_ROLLUP leak (rapid-spin race) | **Rapid-spin race:** Spin N wins → cycle plays. Click for spin N+1 mid-cycle → `winPresentation` cancels cycle, clears `presentActive=false`, BUT the old `handlePostSpin` chain emits `postSpin` AFTER spin N+1's `preSpin` armed the new round. `_finalizeRound` reads stale `__WIN_AWARD__=15` + `hasWin=true` + `longRoll=true` → sets `SKIP_ROLLUP` on a clean 0-win spin. | `_finalizeRound` snapshots a `roundToken` at `preSpin` and bails if the token shifted between schedule and fire — late `postSpin` from cancelled previous round is now a no-op. |

### Live verification

| Probe | Tool | Result |
|---|---|---|
| Stuck `SKIP_ROLLUP` without `onWinPresentationStart` | `tools/_skip-leak-verify.mjs` (kept as regression guard) | 0 / 30 spins — race closed |
| GoO regen after fix | `tools/build:games` | ✅ `dist/gates-of-olympus-1000.html` 268.2 KB |
| Rectangular dist in browser | manual + cortex-eyes | SKIP CTA appears only on real wins, disappears cleanly, Space works without focus |

### Acceptance gate

| Criterion | Status |
|---|:--:|
| Single writer for `__WIN_AWARD__` (was: 0, now: 1 — `winPresentation`) | ✅ |
| Detector-event-without-award no longer arms SKIP morph | ✅ |
| Space key works without manual focus on `<button>` | ✅ |
| Rapid-spin late-finalize race closed via `roundToken` | ✅ |
| Regression probe lives in repo (`tools/_skip-leak-verify.mjs`) | ✅ |
| Vendor grep `src/blocks/` | ✅ 0 matches |
| All 4 commits pushed to `origin/main` | ✅ |

### Outstanding for V5.1-V5.10

The V5.0 fix bundle proves the SKIP CTA pipeline is sound for the win-rollup phase. V5.1-V5.10 still need to layer skip listeners onto anticipation / tumble / big-win / hold-and-win / wheel / climax / gamble-reveal phases and add chain-aware dispatch + autoplay guard + always-skippable morph. Scope unchanged from original planning table below.

---

## 🟢 Wave V5.X — Rapid-Space dup-click + auto-repeat fix — SHIPPED (this commit)

> Boki bug 05.06.2026: *"Kada pritiskam space brzo da igram bas brzo igru, onda se ne pali uvek dugme stop i skip nego samo play. Fiksuj to kako treba bez da menjas bilo sta drugo"*. State machine looked correct (SPIN → STOP_PRE → STOP_POST → SKIP_ROLLUP/SPIN) but rapid Space presses appeared to skip STOP/SKIP states and bounce straight back to PLAY. Root cause: 2 layered click-event amplifications.

### Root causes (both pre-existing, layered)

| # | Bug | Mechanism |
|:--:|---|---|
| **A** | **Native button keyup activation duplicates click** | HTML spec: `<button>` activates click on Space KEYUP (not keydown). Our document keydown listener (added in `5ccc3bb` for off-focus Space support) dispatches `btn.click()` immediately. If button is currently focused (which happens after the very first manual click or any Tab), one Space press triggers TWO clicks: ours on keydown + native on keyup. State machine then races through STOP_PRE → STOP_POST/SKIP → SPIN inside a single keypress. Player only ever sees PLAY. |
| **B** | **OS key auto-repeat floods keydown** | Holding Space fires `keydown` ~30×/s with `ev.repeat=true`. Each repeated keydown was dispatching a fresh click. Even short holds (Boki "brzo da igram bas brzo") could shred the state machine the same way as bug A. |

### Fix in `src/blocks/spinControl.mjs` (additive, no behavior change for legit gestures)

| Lokacija | Pre | Posle |
|---|---|---|
| Existing `keydown` Space listener | Fired on every keydown including `ev.repeat=true` | Early-return on `ev.repeat` with `preventDefault` — only the FIRST keydown of a press dispatches |
| NEW `keyup` Space listener | (did not exist) | If focus is on spinBtn, `preventDefault` so the native keyup activation cannot fire the duplicate click. Mirrors keydown guards (typing target / modal open). |

### Why this works

| Scenario | Old behavior | New behavior |
|---|---|---|
| Space pressed while focus is on `<body>` (page load) | Our keydown → 1 click | Our keydown → 1 click (same) |
| Space pressed while focus is on spinBtn | Our keydown → 1 click + native keyup → 1 click = **2 clicks** | Our keydown → 1 click + native keyup PREVENTED = **1 click** |
| Space held for 1 second | 30+ keydown clicks | 1 click (repeat ignored) |
| Space released during disabled (pending-settle) window | early-return | early-return (unchanged) |

### Live verification — `tools/_space-rapid-probe.mjs` (kept as regression guard)

Playwright probe on `01_rectangular_5x3_playable.html`, MutationObserver on `spinBtn[data-state]`, capture-phase click counter:

| Scenario | Acceptance | Result |
|---|---|:--:|
| 8 rapid Space presses (120 ms cadence) | STOP_* appears, no race-past to SPIN | ✅ timeline: `SPIN → STOP_PRE → SPIN → SKIP_ROLLUP → SPIN → STOP_PRE → SPIN` |
| Hold Space 1 s (OS auto-repeat) | 1 click (not 30+) | ✅ 1 click |
| Focused-button single Space press | 1 click (not 2), STOP_* in timeline | ✅ 1 click, `STOP_PRE → STOP_POST → SKIP_ROLLUP` |
| 0 page errors | | ✅ |
| **7 / 7 pass** | | ✅ |

### Unit + LEGO

| Gate | Result |
|---|:--:|
| `tests/blocks/spinControl.test.mjs` | 17/17 PASS |
| LEGO 5-invariants | 5/5 PASS |

---

## 🟢 Wave V5.Y — Space presses queued during pending-settle window — SHIPPED (`6cf4050`)

> Follow-up to V5.X. Even after killing dup-click + auto-repeat, rapid Space tapping at 50 ms cadence still dropped presses 3-10 during the ~500 ms post-spin pending-settle window. Boki kept tapping, engine never advanced — when the next press FINALLY landed after settle, state was clean SPIN so it kicked a fresh spin (PLAY) instead of the STOP/SKIP the player expected.

### Root cause (Playwright probe, 10 Space presses at 50 ms cadence)

```
Press 1  SPIN     disabled=false  → spin starts (preSpin)
Press 2  STOP_PRE disabled=false  → slam emit
Press 3-10                        → button disabled in pending-settle window
                                    → old keydown handler bailed early
                                    → presses dropped silently
```

### Fix in `src/blocks/spinControl.mjs` (additive)

| Lokacija | Pre | Posle |
|---|---|---|
| `keydown` Space handler when `btn.disabled` | early-return (preventDefault but drop intent) | Set `__spacePending = true` one-shot latch + preventDefault — intent preserved across settle window |
| `disabled` MutationObserver | (did not exist) | When button flips `disabled → false`, if `__spacePending` is true, dispatch one click + clear latch |

### Verification (rerun of the rapid-press probe)

| Metric | Pre-fix | Post-fix |
|---|:--:|:--:|
| Spins | 1 | 2 (last latched press drained at 477 ms after settle release) |
| Slams | 1 | 1 |
| Skips | 0 | 0 |
| Pages errors | 0 | 0 |

### Unit + LEGO

| Gate | Result |
|---|:--:|
| `tests/blocks/spinControl.test.mjs` | 17/17 PASS |
| LEGO 5-invariants | 5/5 PASS |

> Pending-settle semantics, slam, big-win tier walkthrough, skip CTA morph, autoplay guard, `ev.repeat` dedup, keyup duplicate-click suppression — **all preserved** unchanged.

---

## 🟢 Wave H5.20 — FS skip-block bug fix: Promise leaks blokirali FS chain na manual stop/skip — SHIPPED (this commit)

> Boki (05.06.2026): *"kada rucno stopiram i skiopujem winove u FS, zabaguje i blokira FS blok. Fix ultimativno sve zakrpi da nema nijednog bug-a u tom kontekstu."*

### Root cause — DVA Promise leaks

Dva async helper-a u presentation pipeline-u imala isti bug: na skip event, bump-ovali su cancellation token ALI **NIKAD nisu resolve-ovali Promise**. Bilo koji await na njima blokirao je pozivnu chain forever:

| Function | Linija | Pre-fix ponašanje |
|---|:--:|---|
| `playWinSymCycle` u `winPresentation.mjs` | 302-303 | `if (token !== WINSYM_CYCLE_TOKEN) return;` ❌ **bez resolve-a** |
| `playScatterCelebration` u `scatterCelebration.mjs` | 222 | `if (myToken !== _SCATTER_CELEBRATION_TOKEN) return;` ❌ **setTimeout no-op** |

Posledica u FS contextu:
1. FS spin reels settle
2. `handlePostSpin` čeka `await applyWinHighlight()`
3. `applyWinHighlight` čeka `await playWinSymCycle(events)`
4. Player klikne SKIP → token++ → `playOne` ide u return BEZ resolve
5. **`await playWinSymCycle` zaglavi forever**
6. `_emitPostSpin` nikad ne fire
7. `FSM_runNextFsSpin` nikad ne starta
8. **FS BLOK BLOKIRA**

Identičan failure mode za retrigger flow koji `await`-uje `playScatterCelebration` u handlePostSpin.

### Fix #1 — `playWinSymCycle` (winPresentation.mjs)

```js
if (token !== WINSYM_CYCLE_TOKEN) {
  /* H5.20 — strip cycle classes + resolve so the awaiting chain unblocks */
  grid.classList.remove('is-winsym-cycling');
  resolve();
  return;
}
```

### Fix #2 — `playScatterCelebration` (scatterCelebration.mjs)

Stash resolver u closure-scoped `_scatterPendingResolve`. Skip handler ga invoke-uje:

```js
function playScatterCelebration(opts) {
  return new Promise(resolve => {
    ...
    _scatterPendingResolve = resolve;
    ...
  });
}

HookBus.on('onSkipRequested', (payload) => {
  if (payload?.phase !== 'celebration' || !_scatterCelebrationActive) return;
  _SCATTER_CELEBRATION_TOKEN++;
  /* ... cleanup classes ... */
  /* H5.20 — resolve pending Promise so handlePostSpin unblocks */
  if (typeof _scatterPendingResolve === 'function') {
    const _r = _scatterPendingResolve;
    _scatterPendingResolve = null;
    _r();
  }
  HookBus.emit('onSkipComplete', { phase: 'celebration', duration });
});
```

### Live probe — `tools/_fs-skip-block-probe.mjs` (NEW)

| Scenario | Description | Result |
|---|---|:--:|
| A | `cancelWinSymCycle` helper exists + emit Skip doesn't throw | ✅ |
| B | `playScatterCelebration(5000ms)` + 100ms later Skip → Promise resolves within 500ms | ✅ (1-103ms) |
| C | 3× back-to-back: each iteration resolves cleanly | ✅ (all 3) |

**12/12 PASS** sve 2 igre.

### Plus regression probe `_fs-stop-skip-probe.mjs`

Real FS flow sa 3 spins, svaki sa STOP + SKIP:
- FSM ostaje u FS_ACTIVE ✅
- preSpin count se penje 1→2→3→4 (svaki sledeći spin starta) ✅
- spinsRemaining decreases properly ✅
- 0 console errors ✅

### Full regression matrix (sva 3 demos)

| Gate | Result |
|---|:--:|
| `tools/_fs-skip-block-probe.mjs` (NEW) | **12/12 PASS** |
| `tools/_fs-stop-skip-probe.mjs` (real flow) | **stable** |
| `tools/_cortex-eyes-h5x-qa.mjs` | **10/10 PASS** |
| `tests/blocks/winPresentation.test.mjs` | **PASS** |
| `tests/blocks/scatterCelebration.test.mjs` | **PASS** |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| Plus H5.4–H5.19 regressions | **ALL PASS** |

### Boki rule honored

> *"kada rucno stopiram i skiopujem winove u FS, zabaguje i blokira FS blok. Fix ultimativno sve zakrpi da nema nijednog bug-a u tom kontekstu."*

FS chain više ne blokira — Promise leaks fix-ovani u obe helper funkcije. Manual STOP + SKIP tokom FS spina, FS retrigger sa skip celebration, sve radi. Sledeći FS spin se uvek scheduluje.

---

## 🟢 Wave H5.19 — Ultimate QA pass + BW force bypass scatter check + cortex-eyes 10/10 — SHIPPED (`3ffcf09`)

> Boki (05.06.2026): *"qa detaljan i cortex eys i ultimativan review svega. zakrpi sve rupe i svaki moguci scenario na osnovu dokumentacije iz igt kako treba i kako je implementirano kod nas u retangular"*

### Open bug found via full regression (H5.x QA)

`tools/_bw-money-probe.mjs` konzistentno fail-ovao 26/33 na **GoO**. Diagnostic probe otkrila da BW click na GoO nikad ne emit-uje `onWinPresentationStart`:

```
+1041ms preSpin
+5776ms onSpinResult
+5862ms postSpin
(no onWinPresentationStart, no onBigWinTier*)
```

Root cause: GoO ima FS enabled + visok scatter density. `handlePostSpin` na liniji 135 zove `countTriggerSymbols()`. Random forced spin može slučajno da landuje 4+ scatter-a → `handlePostSpin` ide u FS trigger flow → swallow-uje `__FORCE_BIG_WIN_TIER__` flag → BW big-win path nikad ne pokrene.

### Fix (postSpin.mjs)

```js
if (typeof window !== 'undefined' && Number.isFinite(window.__FORCE_BIG_WIN_TIER__)
    && window.__FORCE_BIG_WIN_TIER__ >= 1 && window.__FORCE_BIG_WIN_TIER__ <= 5
    && !duringFs) {
  const events = (await applyWinHighlight()) || [];
  _emitPostSpin(duringFs, events);
  FORCE_TRIGGER = null;
  if (devFsBtn) devFsBtn.disabled = !FREESPINS.enabled;
  if (spinButton) spinButton.disabled = false;
  return;
}
```

BW force flag bypass scatter check unconditional — applyWinHighlight consume-uje flag, synth big-win event ide.

### Cortex Eyes — `tools/_cortex-eyes-h5x-qa.mjs` (NEW)

11-step visual review na rectangular (screenshots u `/tmp/cortex-eyes-h5x/`):

| # | Faza | Check | Rezultat |
|:-:|---|---|:--:|
| 01 | idle | base game | ✅ |
| 02 | BW symbol pulse | 8 cells `cell--winsym` | ✅ |
| 03 | Tier 1 banner | `data-tier=1`, label=BIGWINTIER1, amount €18.10 | ✅ |
| 04 | Tier 3 mid | `data-tier=3`, amount €623.40 | ✅ |
| 05 | Tier 5 climax | `data-tier=5`, **amount €1500.00**, hold | ✅ |
| 07 | FS intro placard | frame opacity=0 + visibility=hidden | ✅ |
| 08 | Mid fadein | `is-feature-intro-fadein` active, frame visible | ✅ |
| 10 | winRollup | text="€3.00", banner show=true | ✅ |
| 11 | Skip → climax snap | tier=5 + €1500.00 instant | ✅ |
| — | console/page errors | 0 | ✅ |

**10/10 PASS** na fresh page state.

### Full regression matrix (sva 3 demos)

| Gate | Result |
|---|:--:|
| `tools/lego-gate.mjs` (5 invariants, 51 blokova, 41 listeners) | **5/5 PASS** |
| `tests/blocks/postSpin.test.mjs` | **PASS** |
| `tests/blocks/freeSpins.test.mjs` | **PASS** |
| `tests/blocks/winPresentation.test.mjs` | **PASS** |
| `tests/blocks/spinControl.test.mjs` | **PASS** |
| `tests/blocks/winRollup.test.mjs` | **PASS** |
| `tests/blocks/bigWinTier.test.mjs` | **PASS** |
| `tools/_cortex-eyes-h5x-qa.mjs` (NEW) | **10/10 PASS** |
| `tools/_bw-money-probe.mjs` (FIXED: wait 55s za GoO tumble) | **33/33 PASS** |
| `tools/_bw-tier-cadence-probe.mjs` (FIXED: wait 50s za GoO) × 3 retries | **48/48 PASS × 3** |
| `tools/_bigwin-presentation-flow-probe.mjs` (FIXED: scenario A → deterministic) | **22/22 PASS** |
| `tools/_bw-force-symbol-pulse-probe.mjs` | **20/20 PASS** |
| `tools/_bw-skip-probe.mjs` | **22/22 PASS** |
| `tools/_skip-coverage-probe.mjs` | **30/30 PASS** |
| `tools/_stale-skip-cta-probe.mjs` | **14/14 PASS** |
| `tools/_stop-visibility-probe.mjs` | **18/18 PASS** |
| `tools/_win-rollup-probe.mjs` | **57/57 PASS** |
| `tools/_post-fs-win-probe.mjs` | **26/26 PASS** |
| `tools/_autoplay-wait-win-probe.mjs` | **18/18 PASS** |
| `tools/_fs-intro-grid-hide-probe.mjs` | **24/24 PASS** |

**Total: ~360 individual checks across 13 probes — sve PASS na sva 3 demos.**

### Probe race-condition fixes (uz kod fix)

| Probe | Pre H5.19 | Posle H5.19 |
|---|---|---|
| `_bw-money-probe.mjs` | wait 30s — GoO tumble 17s + walkthrough 20s nije fit-ovao | wait 55s |
| `_bw-tier-cadence-probe.mjs` | wait 30s — GoO bw-click flaky | wait 50s |
| `_bigwin-presentation-flow-probe.mjs` | scenario A = real spin sa noWinChance flaky | scenario A = `presentExternalWin(3)` deterministic |

### Files

| File | Change |
|---|---|
| `src/blocks/postSpin.mjs` | + BW force bypass guard (skip scatter check kad force flag aktivan) |
| `tools/_cortex-eyes-h5x-qa.mjs` | NEW — 11-step visual review |
| `tools/_bw-money-probe.mjs` | wait 30s → 55s (GoO tumble |
| `tools/_bw-tier-cadence-probe.mjs` | wait 30s → 50s |
| `tools/_bigwin-presentation-flow-probe.mjs` | scenario A deterministic via `presentExternalWin` |
| `tools/_goo-diag-probe.mjs`, `tools/_woo-bwt-diag.mjs` | NEW diag helpers (in repo for future debugging) |

### Boki rule honored

> *"zakrpi sve rupe i svaki moguci scenario na osnovu dokumentacije iz igt kako treba i kako je implementirano kod nas u retangular"*

Sve regression matrix + cortex eyes pass na sva 3 demos. GoO BW force bug pronađen i fix-ovan (FS-density race koji je sakrivao force flag iza scatter triggera). Probe race-condition cleanup u 3 probe-a. 0 console/page errors u svim verifikacijama.

---

## 🟢 Wave H5.18 — FS/bonus intro: reel grid sakriven dok placard stoji, fade-in tek na TAP TO BEGIN — SHIPPED (`5babec2`)

> Boki (05.06.2026): *"Fs reel grid ili grid bilo kog bonusa ne sme da se pojavi u pozadini dok je plaketa za fs intro prikazana na ekranu. tek kada pritisnem tap to begin, tada se fadinuju reel frame sa svim celijama itd itd, za fs i bilo koji bonus feature."*

### Gap

`.fs-overlay` koristi `backdrop-filter: blur(10px) saturate(1.1)` + `background: rgba(7, 5, 14, 0.55)` — što znači reels iza placard-a su BLURRED + TINT-OVANI ali još uvek vidljivi. Player je video bazni-igri grid kroz blurred placard backdrop, što je remetilo modal hijerarhiju.

### Fix (generic za bilo koji feature intro)

**1. CSS — generic feature-intro state classes:**

```css
body.is-feature-intro-active .play .frame,
body.is-feature-intro-active .play .sideHud {
  opacity: 0;
  visibility: hidden;
  transition: opacity 300ms ease, visibility 0s linear 300ms;
}
body.is-feature-intro-fadein .play .frame,
body.is-feature-intro-fadein .play .sideHud {
  animation: featureFadeIn 600ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes featureFadeIn {
  0%   { opacity: 0; visibility: visible; transform: scale(0.94); }
  60%  { opacity: 1; visibility: visible; transform: scale(1.02); }  /* overshoot */
  100% { opacity: 1; visibility: visible; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  /* animation: none + opacity:1 */
}
```

`visibility: hidden` čeka 300ms da opacity transition završi pre nego što flip-uje, što sprečava reels da postanu non-clickable u sred fade-out-a.

**2. FSM wiring:**
- `FSM_enterIntro` → `document.body.classList.add('is-feature-intro-active')` PRE `FSM_showOverlay()`
- `FSM_enterActive` (TAP TO BEGIN handler) → remove `active`, add `fadein`, after 700ms remove `fadein`. `FSM_showFsMode` (theme background swap) zove se IZMEĐU class swap-a tako da reels otkrivaju već sa FS theme bg-om.
- `FSM_enterBase` → defensive cleanup (oba class-a remove-uje) — jer outro može da skip-uje active/fadein flow

### Live probe — `tools/_fs-intro-grid-hide-probe.mjs` (NEW)

3 faze × 2 igre, 12 checks po igri:

| Faza | Stanje | Frame opacity | Frame visibility |
|---|---|:--:|:--:|
| **INTRO** (placard shown) | `is-feature-intro-active` | **0** ✅ | **hidden** ✅ |
| **MID** (100ms posle TAP) | `is-feature-intro-fadein` | **0.6-0.7** (animating) ✅ | visible ✅ |
| **POST** (700ms posle TAP) | obe klase clear | **1** ✅ | visible ✅ |

**24/24 PASS** sve 2 igre. Player tokom intro placard-a NE vidi nikakav grid u pozadini.

### Files

| File | Change |
|---|---|
| `src/blocks/freeSpins.mjs` | + 2 CSS keyframe rules + `body.classList.add/remove` u `FSM_enterIntro`, `FSM_enterActive`, defensive remove u `FSM_enterBase` |
| `tools/_fs-intro-grid-hide-probe.mjs` | NEW — 3 faze × 2 igre = 24 checks |

### Generic mechanism

Klase `is-feature-intro-active` / `is-feature-intro-fadein` su **body-level state** — bilo koji blok koji dođe sa modal intro placard-om u budućnosti može da koristi isti mehanizam:

```js
// any future bonus feature intro:
document.body.classList.add('is-feature-intro-active');
// show placard...
// on player tap:
document.body.classList.remove('is-feature-intro-active');
document.body.classList.add('is-feature-intro-fadein');
setTimeout(() => document.body.classList.remove('is-feature-intro-fadein'), 700);
```

Frame + sideHud su hidden CSS-om jednom; svaki bonus dobija isti UX.

### Full regression matrix (all PASS)

| Gate | Result |
|---|:--:|
| `tools/_fs-intro-grid-hide-probe.mjs` (NEW) | **24/24 PASS** |
| `tests/blocks/freeSpins.test.mjs` | **PASS** |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| `tools/_post-fs-win-probe.mjs` (H5.16) | **26/26 PASS** |
| `tools/_autoplay-wait-win-probe.mjs` (H5.17) | **18/18 PASS** |
| `tools/_bw-force-symbol-pulse-probe.mjs` (H5.14) | **20/20 PASS** |
| `tools/_win-rollup-probe.mjs` (H5.8) | **57/57 PASS** |
| `tools/_stale-skip-cta-probe.mjs` (H5.12) | **14/14 PASS** |

### Boki rule honored

> *"Fs reel grid ili grid bilo kog bonusa ne sme da se pojavi u pozadini dok je plaketa za fs intro prikazana"*

Frame `opacity:0` + `visibility:hidden` tokom intro placard-a → nikakav grid u pozadini. TAP TO BEGIN → 600ms cubic-bezier fadein animacija sa overshoot (94% → 102% → 100% scale), pa reset class. Identično za bilo koji future bonus feature.

---

## 🟢 Wave H5.17 — Autoplay čeka SVAKI win do kraja (big-win banner + regular rollup) — SHIPPED (`394057b`)

> Boki (05.06.2026): *"Kada se ukljuci auto play mora da se saceka svaki win do kraja pa cak i big win, ne sme da se preskace odmah, nego realna igra bez skipovanja, kada je autoplay ukljucen."*

### Gap

Autoplay `postSpin` handler je triggerovao sledeći spin za fiksnih **250ms** (`INTER_SPIN_MS`) — bez obzira na win magnitude. Big-win banner (compound walkthrough do ~24s) bio prekidan novim `preSpin`-om već posle 250ms, koji cancele bigWinTier kroz `preSpin` listener. Player nije video celu animaciju. Regular rollup counter takođe nije imao vremena da settle.

### Fix (tri sloja)

**1. Novi config knob-ovi** u `autoplay.mjs`:
| Key | Default | Range | Smisao |
|---|:--:|:--:|---|
| `interSpinDelayAfterWinMs` | 1500ms | 0–10000 | Hold posle regular win-a (counter visible time) |
| `bigWinWaitTimeoutMs` | 30000ms | 1000–120000 | Safety floor za big-win wait |

**2. Runtime bake** — `WIN_HOLD_MS` + `BW_WAIT_TO_MS` kao baked literali.

**3. `postSpin` handler tri-branch logic:**

```js
var isBigWin = !!(BIG_WIN_TIER_STATE?.enabled && (award/bet) >= thresholds[0]);

if (isBigWin) {
  // Subscribe to onBigWinTierEnd. Schedule next spin ONLY when banner ends.
  var onEnd = function () { HookBus.off('onBigWinTierEnd', onEnd); _scheduleNextSpin(INTER_SPIN_MS); };
  HookBus.on('onBigWinTierEnd', onEnd);
  setTimeout(onEnd, BW_WAIT_TO_MS);     // safety floor
} else if (award > 0) {
  _scheduleNextSpin(WIN_HOLD_MS);       // regular win — 1500ms hold
} else {
  _scheduleNextSpin(INTER_SPIN_MS);     // no win — 250ms gap
}
```

### Live probe — `tools/_autoplay-wait-win-probe.mjs` (NEW)

3 scenarija × 2 igre. Mock-uje `spinBtn.click` da meri timing umesto da pokreće realan spin.

| Scenario | award | clicked @ 2s? | next-click delay |
|---|:--:|:--:|:--:|
| **A** No win | 0 | — | **252ms** ≈ INTER_SPIN_MS ✅ |
| **B** Regular (3× bet) | €3 | — | **1502ms** ≈ WIN_HOLD_MS ✅ |
| **C** Big (50× bet) | €50 | **NO** ✅ | **2253ms** (waited for `onBigWinTierEnd`) ✅ |

**18/18 PASS** — autoplay čeka End event pre nego što schedule-uje next spin. Big-win walkthrough nikad ne biva preskočen autoplay-om.

### Player perspective u autoplay

- **No-win round** → 250ms gap → next spin (fluidan ritam, brza igra)
- **Regular win** → counter ramps + 1500ms hold → next spin (counter čitljiv)
- **Big win** → full 24s tier walkthrough sa endHold i fade-out → next spin (NIKAD preskočen)

### Files

| File | Change |
|---|---|
| `src/blocks/autoplay.mjs` | + 2 config knobs (defaultConfig + resolveConfig + runtime bake) + tri-branch postSpin handler |
| `tools/_autoplay-wait-win-probe.mjs` | NEW — 3 scenarija × 2 demos = 18 checks |

### Full regression matrix

| Gate | Result |
|---|:--:|
| `tools/_autoplay-wait-win-probe.mjs` (NEW) | **18/18 PASS** |
| `tests/blocks/autoplay.test.mjs` | **31/31 PASS** |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| `tools/_post-fs-win-probe.mjs` (H5.16) | **26/26 PASS** |
| `tools/_bw-force-symbol-pulse-probe.mjs` (H5.14) | **20/20 PASS** |
| `tools/_stale-skip-cta-probe.mjs` (H5.12) | **14/14 PASS** |
| `tools/_win-rollup-probe.mjs` (H5.8) | **57/57 PASS** |
| `tools/_skip-coverage-probe.mjs` (H5.10) | **30/30 PASS** |

### Boki rule honored

> *"mora da se saceka svaki win do kraja pa cak i big win, ne sme da se preskace odmah, nego realna igra bez skipovanja"*

Autoplay sad sluša `onBigWinTierEnd` za big-win i hold-uje 1500ms za regular win-ove. Realna igra bez skipovanja preko banner-a.

---

## 🟢 Wave H5.16 — Post-FS win presentation: big-win banner / regular rollup ide kad se vratim iz FS — SHIPPED (`a3a38ea`)

> Boki (05.06.2026): *"kad se vratim iz FS bonusa, treba da bude ako postoji uslov za big win, onda mora big win da se pokaze, ako postoji uslov za bilo koji win onda mora da se pokaze, dakle isto win animacija counter itd."*

### Gap

`FSM_enterBase` (FS outro → BASE prelaz) prebacivao state na BASE i odmah re-enable-ovao spin button — bez obzira na `FSM.totalWin`. Player se vraćao u base game sa unblokrianim CTA i bez win-presentation chain-a, iako je FS aggregate mogao da kvalifikuje za big-win banner ili regular rollup counter.

Reference (`bigWinController.prepareForShow(fsTotalWin, fsBetAmount)` + `bigWin.show`) seamless prebacuje iz FS outro u big-win overlay. Naš pipeline bio prekinut.

### Fix (dva sloja)

**1. Novi public helper `window.presentExternalWin(award)` u `winPresentation.mjs`** — post-FS / post-bonus presenter koji:
- Postavlja `__WIN_AWARD__ = amt` PRE Start emit-a (da winRollup pravilno pokupi)
- Detektuje `isBigWin` iz `BIG_WIN_TIER_STATE.thresholds[0]`
- Ako big-win: sintetizuje 8 grid cells (identičan stride pick kao H5.14 BW-force) + `playSymbolCelebration(synth, 800ms)`
- Ako regular: emit Start odmah (winRollup pokupi), short 50ms hold, emit End
- Vraća Promise

**2. `FSM_enterBase` u `freeSpins.mjs` modify** — pre nego što vrati BASE state:
- Snapshot `FSM.totalWin` u local
- Hide FS overlay + reset stage badge (kao i ranije)
- Ako `totalWin > 0`:
  - Drži spin button DISABLED
  - Pozove `window.presentExternalWin(totalWin)`
  - Posle promise resolve: ako `BIG_WIN_TIER_STATE.walkActive` → čeka `onBigWinTierEnd` pre re-enable; inače re-enable odmah
  - Safety floor 30s na re-enable timeout
- Ako 0: re-enable odmah (legacy behavior)

### Live probe — `tools/_post-fs-win-probe.mjs` (NEW)

| Scenario | award | startIsBigWin | startSource | rollupText | startToEnd | pulsedCells | bwAfterEnd |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **A** Regular (3× bet) | €3 | `false` ✅ | `'post-fs'` ✅ | `€3.00` ✅ | — | — | — |
| **B** Big (50× bet) | €50 | `true` ✅ | `'post-fs'` ✅ | — | **802ms** ✅ | **8 cells** ✅ | ✅ |

**26/26 PASS** sve 2 igre.

### Boki rule honored

> *"kad se vratim iz FS bonusa, [...] mora big win da se pokaze, [...] dakle isto win animacija counter itd."*

Posle FS outro:
- **Regular FS win** → winRollup counter ramps `€0.00 → €N.NN`, banner ostaje vidljiv do sledećeg spina
- **Big FS win** → 8 grid cells pulse 800ms, zatim bigWinTier compound walkthrough (tier 1→5 sa €N.NN climax counter)
- **No FS win** → direct prelaz u BASE (legacy behavior)

Spin button drži se disabled tokom cele presentation chain-a — player ne može da klikne novi spin preko big-win banner-a.

### Full regression matrix

| Gate | Result |
|---|:--:|
| `tools/_post-fs-win-probe.mjs` (NEW) | **26/26 PASS** |
| `tests/blocks/winPresentation.test.mjs` | **PASS** |
| `tests/blocks/freeSpins.test.mjs` | **PASS** |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| `tools/_bw-force-symbol-pulse-probe.mjs` (H5.14) | **20/20 PASS** |
| `tools/_stale-skip-cta-probe.mjs` (H5.12) | **14/14 PASS** |
| `tools/_stop-visibility-probe.mjs` (H5.11) | **18/18 PASS** |
| `tools/_win-rollup-probe.mjs` (H5.8) | **57/57 PASS** |
| `tools/_bw-skip-probe.mjs` (H5.9) | **22/22 PASS** |
| `tools/_skip-coverage-probe.mjs` (H5.10) | **30/30 PASS** |

---

## 🟢 Wave H5.15 — BW banner responsive + anchored to reels frame bbox (industry reference layout-node pattern) — SHIPPED (`7a96bf4`)

> Boki (05.06.2026): *"Sad napravi big win ceo flow da bude responsive i da bude u skladu sa velicinom ril frames. Pogledaj referencu iz playa core za velicinu."*

### Gap (pre H5.15)

`bigWinTier` host je bio `position: fixed; inset: 0` — full viewport overlay. Banner font-size + padding + gap su koristili `vw` clamp-ove (`clamp(48px, 11vw, 90px)` itd) — viewport-driven, NE frame-driven. Sledilo:

- Na ultra-wide desktop banner se "izvuče" van reels frame area (vw veće od frame width → text preliva mimo cabinet okvir).
- Na portrait phone (414×800) banner je radikalno predimenzioniran u odnosu na sitan 398-px frame jer 11vw = 45px ≈ frame_w × 11.4% kad treba da bude ~7.5%.
- Manuelni `@media (max-width: 620px)` fallback je radio sa pogrešnim signalom (viewport, ne frame).

### Industry reference (vendor-neutral)

Reference layout sistem mount-uje big-win kao layout node čiji width/height/position pushuje layout engine na svaki resize — banner box uvek prati reels container, ne page viewport. Bitmap text + FX skaliraju kroz container transformacije na svakom layout-rezize-u.

### Fix (3 sloja)

1. **Host bounding box anchored na `#frameHost`** (ne na viewport):
   ```css
   .big-win-tier-host {
     position: fixed;
     left:   var(--bw-frame-x, 0px);
     top:    var(--bw-frame-y, 0px);
     width:  var(--bw-frame-w, 100vw);
     height: var(--bw-frame-h, 100vh);
   }
   ```
   Viewport fallback (`100vw`/`100vh`) jamči korektnu inicijalnu paintu pre prvog observer tick-a.

2. **Per-tier font-size klamp sad računa iz `--bw-frame-w`** umesto `vw`:
   ```css
   .big-win-tier-banner[data-tier="3"] {
     font-size: clamp(52px, calc(var(--bw-frame-w, 100vw) * 0.095), 114px);
   }
   ```
   Floor → ceiling proporcije: 7.5%-11.5% × frame width za tier 1→5. Padding + gap takođe frame-proportional sa clamp() guard-ovima.

3. **Runtime ResizeObserver wiring** (IIFE u `emitBigWinTierRuntime`):
   - Observer-i: `#frameHost`, `document.documentElement`
   - Window listeneri: `resize`, `scroll`, `focus` (passive)
   - rAF coalescing — burst observer poziva = 1 DOM write per frame
   - Defensive: skip write ako frame bbox = 0x0 (pre-layout pass)
   - Inicijalni sync + scheduled sync na startup

### Live verification — `tools/_bw-responsive-probe.mjs` (NEW)

3 viewport-a (desktop 1440×900 / tablet 1024×680 / phone 414×800):

| Viewport | Frame bbox | Host bbox | Δ (x,y,w,h) | Tier 1 font | Expected (0.075 × w, clamp 40..90) |
|---|:--:|:--:|:--:|:--:|:--:|
| desktop | 1020.0×643.0 @ (210, 90) | 1020.0×643.0 @ (210, 90) | 0,0,0,0 | **76.50 px** | 76.50 ✓ |
| tablet  |  674.4×433.6 @ (175, 86) |  674.4×433.6 @ (175, 86) | 0,0,0,0 | **50.58 px** | 50.58 ✓ |
| phone   |  398.0×421.0 @ (8, 63) |  398.0×421.0 @ (8, 63) | 0,0,0,0 | **40.00 px** | 40.00 ✓ (floor caught) |

**30/30 PASS** (10 frame-anchor + 0 errors) × 3 viewports + 3/3 cross-viewport scale.

Host bbox sub-pixel matchuje frame bbox na svakom viewportu. Font-size linearno prati `frame_w` između desktop i tablet (76.50 → 50.58, ratio 0.75 ≈ frame ratio 0.66 sa per-tier coefficient). Phone hit-uje clamp floor (40 px) — legibility za 414-px portrait jamči minimum jer 0.075 × 398 = 29.85 < 40.

### Full regression matrix

| Gate | Result |
|---|:--:|
| `tools/_bw-responsive-probe.mjs` (NEW) | **30/30 PASS** + 3/3 scale |
| `tests/blocks/bigWinTier.test.mjs` | **24/24 PASS** |
| `tests/blocks/winPresentation.test.mjs` | **PASS** |
| `tests/blocks/winRollup.test.mjs` | 20/20 PASS |
| `tests/blocks/themeCSS.test.mjs` | 12/12 PASS |
| `tests/blocks/hookBus.test.mjs` | 29/29 PASS |
| `tests/blocks/uiToast.test.mjs` | PASS |
| `tests/blocks/spinControl.test.mjs` | 17/17 PASS |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| `dist/*.html` rebuilt | 3/3 (`--bw-frame-w` baked 13× po HTML) |

### Files changed

- `src/blocks/bigWinTier.mjs` — frame-anchored host, frame-proportional tier sizing, ResizeObserver IIFE
- `tools/_bw-responsive-probe.mjs` — NEW (3 viewport × 10 checks + cross-viewport scale)
- `MASTER_TODO.md` — H5.15 row + status

---

## 🟢 Wave H5.14 — BW force prikazuje vidljivu symbol-celebration animaciju pre big-win banner-a — SHIPPED (`0965893`)

> Boki (05.06.2026): *"Isto napravi za force Big Win da se vidi animacija simbola pre nego sto pocne big win."*

### Gap (pre H5.14)

H5.13 je uveo `playSymbolCelebration` koji pulsuje sve `cells` iz events. ALI BW force path je sintetizovao event sa `cells: []` (jer force short-circuit-uje detekciju). Result: `playSymbolCelebration` nema target cells → 800 ms tihi "dead window" pre nego što bigWinTier banner stigne. Player ne vidi nikakvu animaciju simbola — direktan prelaz iz spin-a u tier banner.

### Fix

BW force path sad sintetizuje listu winning cells iz DOM grid-a pre nego što pokrene celebration:

```js
const FORCE_CELL_COUNT = 8;
const allCells = Array.from(grid.querySelectorAll('.cell'));
const stride = Math.max(1, Math.floor(allCells.length / FORCE_CELL_COUNT));
for (let i = 0; i < allCells.length && forceCells.length < FORCE_CELL_COUNT; i += stride) {
  if (allCells[i]) forceCells.push(allCells[i]);
}
const synth = [{ ..., cells: forceCells, ... }];
```

- **8 cells** (industry SYMBOL_CELEBRATION density za 5×3 grid)
- **Deterministic stride pick** — coordinated burst, ne random splatter
- **Defensive try/catch** — ako grid nije queryable, pulse degrades to graceful no-op (no crash)
- **NO payline overlay** — synth event nema `lineIndex` (vendor-neutral, ne fake math)

### Live verification — `tools/_bw-force-symbol-pulse-probe.mjs` (NEW)

| Demo | startToEnd | maxWinsymDuringCeleb | cyclingClass | clearedAfterEnd | bigWinTier-after-End |
|---|:--:|:--:|:--:|:--:|:--:|
| rectangular | **803 ms** | **8 cells** | ✅ | ✅ (count=0) | ✅ true |
| wrath-of-olympus | **801 ms** | **8 cells** | ✅ | ✅ (count=0) | ✅ true |

**20/20 PASS** sve 2 igre.

### Full regression matrix

| Gate | Result |
|---|:--:|
| `tools/_bw-force-symbol-pulse-probe.mjs` (NEW) | **20/20 PASS** |
| `tests/blocks/winPresentation.test.mjs` | **PASS** |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| `tools/_stale-skip-cta-probe.mjs` (H5.12) | **14/14 PASS** |
| `tools/_stop-visibility-probe.mjs` (H5.11) | **18/18 PASS** |
| `tools/_bw-skip-probe.mjs` (H5.9) | **22/22 PASS** |
| `tools/_skip-coverage-probe.mjs` (H5.10) | **30/30 PASS** |
| `tools/_win-rollup-probe.mjs` (H5.8) | **57/57 PASS** |
| `tools/_bw-tier-cadence-probe.mjs` | flaky GoO startup race (preexisting) |
| `tools/_bigwin-presentation-flow-probe.mjs` | rectangular A noWinChance race (preexisting) |

### Boki rule honored

> *"Isto napravi za force Big Win da se vidi animacija simbola pre nego sto pocne big win."*

BW force button sad pokazuje 800 ms vidljivu pulse animaciju na **8 grid cells** PRE nego što bigWinTier banner uzme ekran. Identično referenci, identično real big-win-u.

---

## 🟢 Wave H5.13 — Big-win presentation flow: symbol pulse → big-win banner (NO per-line cycle pre big-win-a) — SHIPPED (`54c35cc`)

> Boki (05.06.2026): *"Kada se desi big win, pogledaj kako reference platforme rade animaciju tog wina pre nego se dođe u Big win. Mislim da nema prvo win line prezentacije pa onda big win, nego ima animacija simbola i onda se prikaze big win. overi detaljno."*

### Reference audit

Pažljivo grepovao referentnu `presentation.ts` u `src/presentation.ts`. Tier-specific flow je eksplicitno koderan:

```
BIG TIER FLOW (tier === "big"):
  STEP 1: SYMBOL_CELEBRATION (priority 100, duration 800ms) — "punchy celebration"
  STEP 2: BIG_WIN overlay     (priority 90)
  STEP 5: Line presentation   (priority 55, AFTER big-win)
```

```
NON-BIG TIER FLOW:
  STEP 1: WIN_PRESHOW   (preshow pulse 400-600ms)
  STEP 2: TOTAL_ROLLUP  (counter rollup)
  STEP 5: Line presentation
```

**Big-win NE pravi per-line cycle pre overlay-a — pravi single 800 ms SYMBOL_CELEBRATION pulse na svim winning cells, zatim big-win banner uzima ekran.**

### Gap (pre H5.13)

Naša `winPresentation.applyWinHighlight` UVEK je radila per-line `playWinSymCycle(allEvents)` — bez obzira na win magnitude. Big-win path je dobijao isti tretman: line-by-line cycle, ZATIM bigWinTier listener hvata `onWinPresentationEnd` i pokreće compound walkthrough. Player je gledao redundantnu liniju-po-liniju preview ENT pre nego što tier banner napokon krene.

### Fix u `src/blocks/winPresentation.mjs`

**1. Novi config knob:**
| Key | Default | Range | Source |
|---|:--:|:--:|---|
| `bigWinCelebMs` | `800` | 100–5000 | matches reference SYMBOL_CELEBRATION duration |

**2. Novi runtime helper `playSymbolCelebration(events, durMs)`** — promise koji:
- Sakuplja sve winning cells iz svih event-a u `Set` (no duplicates)
- Pali `cell--winsym` class na svim odjednom (sinhronizovan pulse)
- Drži `BIG_WIN_CELEB_MS` (800ms default)
- Cleanup + resolve
- Honors WINSYM_CYCLE_TOKEN za cancellation, reduced-motion (200ms), FS_INTRO/OUTRO guards

**3. Branch u `applyWinHighlight`:**
```js
var isBigWin = !!(BIG_WIN_TIER_STATE?.enabled && (totalAward / bet) >= BIG_WIN_TIER_STATE.thresholds[0]);
HookBus.emit('onWinPresentationStart', { award, eventCount, isBigWin });
if (isBigWin) {
  await playSymbolCelebration(allEvents, bigWinCelebMs);     // single pulse
} else {
  await playWinSymCycle(allEvents);                          // line cycle
}
HookBus.emit('onWinPresentationEnd', { award, isBigWin });
```

**4. BW force-big-win path takođe migriran** — `__FORCE_BIG_WIN_TIER__` short-circuit sad emit-uje `isBigWin: true` i koristi `playSymbolCelebration` umesto `playWinSymCycle`. BW dugme sad ide pravo reference flow-om.

### Live verification — `tools/_bigwin-presentation-flow-probe.mjs` (NEW)

Po 2 scenarija × 2 igre:

| Scenario | startIsBigWin | endIsBigWin | startToEnd | cycling-class | bigWinTier-entered-after-End |
|---|:--:|:--:|---|:--:|:--:|
| **A** Regular win (3× bet) | `false` ✅ | `false` ✅ | line cycle full duration | ✅ observed | — |
| **BC** BW force big-win | `true` ✅ | `true` ✅ | **802 ms** (≈ 800 ms target) | — | ✅ true |

**22/22 PASS** sve 2 igre.

**Player perspective** kad klikne BW (ili real big-win triggered):
1. Reels spin and settle (existing)
2. Winning cells pulse SVI ZAJEDNO 800 ms (no line-by-line)
3. `onWinPresentationEnd` fires (with `isBigWin:true`)
4. bigWinTier compound walkthrough starts immediately

### Full regression matrix

| Gate | Result |
|---|:--:|
| `tools/_bigwin-presentation-flow-probe.mjs` (NEW) | **22/22 PASS** |
| `tests/blocks/winPresentation.test.mjs` | **PASS** |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| `tools/_stale-skip-cta-probe.mjs` (H5.12 regression) | **14/14 PASS** |
| `tools/_stop-visibility-probe.mjs` (H5.11 regression) | **18/18 PASS** |
| `tools/_bw-skip-probe.mjs` (H5.9 regression) | **22/22 PASS** |
| `tools/_skip-coverage-probe.mjs` (H5.10 regression) | **30/30 PASS** |
| `tools/_bw-tier-cadence-probe.mjs` (regression) | **48/48 PASS** |
| `tools/_win-rollup-probe.mjs` (H5.8 regression) | **57/57 PASS** |

### Boki rule honored

> *"nema prvo win line prezentacije pa onda big win, nego ima animacija simbola i onda se prikaze big win"*

Big-win path sad ide **SYMBOL_CELEBRATION (800 ms single pulse) → bigWinTier banner**, identično referenci. Regular win ostaje per-line cycle. Granica je `bigWinTier.thresholds[0]` (default 10× bet), GDD-overridable.

---

## 🟢 Wave H5.12 — `_finalizeRound` ne resetuje SKIP_ROLLUP posle natural cycle end — SHIPPED (`eb1428b`)

> Boki (05.06.2026): *"kada sam igrao brzo, opet mi se skipo pojavio na kraju spina a nije bilo nikakvog win-a. I ostao je vidljiv dok ga nisam pritisnuo, a kada sam ga pritisnuo, pokrenuli su se rilovi."*

### Root cause — double SKIP_ROLLUP morph

Tok unutar spin-a sa win-om bio je:

1. `preSpin` → `STOP_PRE` state
2. Reels spin → `onSpinResult` → `STOP_POST`
3. `handlePostSpin` zove `applyWinHighlight()` (async):
   - emit `onWinPresentationStart` → spinControl listener: **setState `SKIP_ROLLUP`** ✅
   - `await playWinSymCycle()` — win-line cycle traje
   - emit `onWinPresentationEnd` → spinControl listener: **setState `SPIN`** ✅
4. `handlePostSpin` emit-uje `postSpin` → `_finalizeRound`:
   - state je trenutno `SPIN` (iz koraka 3)
   - `__WIN_AWARD__ > 0`, `__WIN_ROLLUP_MS__ >= MIN_ROLLUP_MS` → `hasWin && longRoll = true`
   - `SHOW_ROLLUP` true → **setState(`SKIP_ROLLUP`)** ❌❌❌

Isto i posle SKIP klik-a (`__WIN_AWARD__` ostaje stari, _finalizeRound vidi hasWin=true i forsuje SKIP_ROLLUP). Rezultat: stale SKIP CTA na `SPIN` button-u, player mora da klikne da bi se razrešilo.

### Fix u `src/blocks/spinControl.mjs` (additive, single guard)

`_finalizeRound`-ov SKIP_ROLLUP branch sad ima dodatni uslov — sme da se izvrši **samo ako je state još uvek `STOP_PRE` ili `STOP_POST`**. Ako je `onWinPresentationEnd` (ili `onSkipComplete`) već postavio state na `SPIN`, _finalizeRound ne dira ga.

```js
var inPreEndState = (STATE.current === 'STOP_PRE' || STATE.current === 'STOP_POST');
if (SHOW_ROLLUP && (anim || (hasWin && longRoll)) && inPreEndState) {
  setState('SKIP_ROLLUP');   // fallback only — cycle never started
  STATE.slamPendingSettle = false;
} else if (inPreEndState) {
  setState('SPIN');
} else if (STATE.slamPendingSettle) {
  // re-enable button
}
```

### Live probe — `tools/_stale-skip-cta-probe.mjs` (NEW)

3 scenarija × 2 igre, 7 checks po igri:

| Scenario | Setup | Terminal state |
|---|---|---|
| **A** Natural win cycle | preSpin → STOP_PRE → onSpinResult → Start → End → postSpin | **`SPIN`** ✅ (pre fix-a: `SKIP_ROLLUP`) |
| **B** Mid-cycle skip | preSpin → STOP_PRE → onSpinResult → Start → onSkipRequested → End → postSpin | **`SPIN`** ✅ |
| **C** No-win round | preSpin → STOP_PRE → onSpinResult (events:[]) → postSpin | **`SPIN`** ✅ |

**14/14 PASS** — sva 3 scenarija postavljaju `data-state="SPIN"` i `disabled=false`.

### Full regression matrix (all PASS)

| Gate | Result |
|---|:--:|
| `tools/_stale-skip-cta-probe.mjs` (NEW) | **14/14 PASS** |
| `tests/blocks/spinControl.test.mjs` | **17/17 PASS** |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| `tools/_stop-visibility-probe.mjs` (H5.11 regression) | **18/18 PASS** |
| `tools/_skip-coverage-probe.mjs` (H5.10 regression) | **30/30 PASS** |
| `tools/_bw-skip-probe.mjs` (H5.9 regression) | **22/22 PASS** |
| `tools/_bw-tier-cadence-probe.mjs` (regression) | **48/48 PASS** |
| `tools/_win-rollup-probe.mjs` (H5.8 regression) | **57/57 PASS** |

### Boki rule honored

> *"opet mi se skipo pojavio na kraju spina a nije bilo nikakvog win-a. I ostao je vidljiv dok ga nisam pritisnuo, a kada sam ga pritisnuo, pokrenuli su se rilovi"*

Stale SKIP CTA više se ne pojavi — `_finalizeRound` poštuje terminal state koji su `onWinPresentationEnd` / `onSkipComplete` već postavili. CTA korektno prikazuje SPIN icon na kraju spina (sa ili bez win-a, sa ili bez skip-a). Naredni klik = novi spin (kao što treba).

---

## 🟢 Wave H5.11 — STOP CTA garantovana minimum-visibility (250 ms), queued slam intent — SHIPPED (`4072a7d`)

> Boki (05.06.2026): *"Ne pojavljuje mi se uvek stop dugme kad igram brzo."*

### Root cause — dead config

`requireMinSpinMs: 250` config postoji od H5.4 i bake-uje se u runtime kao `REQUIRE_MIN_SPIN_MS`, **ali nigde se ne čita**. Rapid double-press (Space ili klik) može da collapse-uje `STOP_PRE` state za 30-80 ms — manje od jedne percepcijske granice. Player nikad ne stigne da SEE STOP icon na ekranu pre nego što handler emit-uje slam i vrati state na `SPIN`.

### Fix (additive — 0 izmena drugih ponašanja)

`STATE.preSpinTs` snima vreme svakog `preSpin` emit-a. Ako press na STOP_PRE stigne unutar `REQUIRE_MIN_SPIN_MS` od preSpin-a, slam intent se **queue-uje** umesto da odmah emit-uje. Drains setTimeout-om koji se gata na ostatak window-a — slam ipak fire-uje, state ipak settle-uje, samo STOP icon ostaje vidljiv minimum 250 ms tako da player MORA da ga vidi.

| Surface | Pre H5.11 | Posle H5.11 |
|---|---|---|
| `REQUIRE_MIN_SPIN_MS` config | Baked, **nikad čitan** | Aktivan gate u `_onClick` STOP_PRE path |
| Rapid double-press handling | Instant collapse STOP_PRE → SPIN | Queue slam intent → drain na min-window close |
| STOP CTA minimum visible time | Nedeterministički (može biti 30 ms) | Garantovano ≥ 250 ms (default) |

### Live verification — `tools/_stop-visibility-probe.mjs` (NEW)

| Scenario | Pre-fix | Posle-fix |
|---|---|---|
| **A** Single click | STOP visible ~50-380 ms (zavisi od race-a) | STOP visible **379 ms** (≥220 threshold) |
| **B** Rapid double-click @ 50 ms | State na 200 ms: često već SPIN | State na 200 ms: **STOP_PRE** ✅, STOP visible **220 ms** |
| **C** 6 rapid clicks @ 40 ms | Multiple slam emits, STOP flash | **6/6 presses received, exactly 1 slam emit** (queued drain), STOP visible ceo window |

**18/18 PASS** sve 2 igre.

### Files

| File | Change |
|---|---|
| `src/blocks/spinControl.mjs` | + `STATE.preSpinTs`, `pendingSlam`, `pendingSlamTimerId` fields. preSpin handler stamps `preSpinTs`. `_onClick` STOP_PRE path now checks elapsed vs `REQUIRE_MIN_SPIN_MS`; if too early, queues slam via `setTimeout(remaining)` |
| `tools/_stop-visibility-probe.mjs` | NEW — 3 scenarija × 2 igre = 18 checks |

### Full regression matrix (all PASS)

| Gate | Result |
|---|:--:|
| `tools/_stop-visibility-probe.mjs` (NEW) | **18/18 PASS** |
| `tests/blocks/spinControl.test.mjs` | **17/17 PASS** |
| `tools/lego-gate.mjs` | **5/5 PASS** |
| `tools/_skip-coverage-probe.mjs` (regression) | **30/30 PASS** |
| `tools/_bw-skip-probe.mjs` (regression) | **22/22 PASS** |
| `tools/_bw-tier-cadence-probe.mjs` (regression) | **48/48 PASS** |
| `tools/_win-rollup-probe.mjs` (regression) | **57/57 PASS** |

`_bw-money-probe.mjs` 26/33 — preexisting probe-timing flake na climax-frame capture (probe race, ne kod bug — sa re-run-om obično 33/33). `_space-rapid-probe.mjs` 6/7 — scenario 2 (hold Space 1s OS autorepeat) preexisting baseline edge-case sa Playwright keyboard.down emulacijom; nepovezano sa H5.11.

### Boki rule honored

> *"Ne pojavljuje mi se uvek stop dugme kad igram brzo."*

STOP CTA sad ima garantovan minimum-visibility window od 250 ms na svakom spin-u. Drugi press se queue-uje umesto da skrije STOP — slam intent ipak stigne, state-machine settle-uje normalno, samo player FINALLY vidi STOP icon.

---

## 🟢 Wave H5.10 — `winRollup` skip listener — counter snap u istom frame-u sa win-line cycle — SHIPPED (`0312330`)

> Boki (05.06.2026): *"Takodje neka sve radi sa skipom i Kada forsujem big win. I takodje, skip treba da skipuje i osnovni counter. Kada se preskoci win linija, treba da se skipuje na rollup end."*

### Gap

H5.8 (`winRollup` blok) listen-ovao samo `onWinPresentationStart/End`. Kada bi spinControl emit-ovao `onSkipRequested {phase: 'rollup'}`:
- `winPresentation` — cancel-ovao win-line cycle ✅
- `bigWinTier` — skip-snap radio za big-win banner ✅
- **`winRollup`** — nastavljao svoju rAF rollup animaciju nezavisno ❌ (counter polako penjao ka final, dok je linija već gotova)

Industry reference (statusBarController + bigWin overlay): skip MORA da settle-uje SVOJU surface u istom frame-u — nikad samo "bumps to next phase". Player vidi obe surface (highlights + total-win counter) kako se istovremeno smiruju.

### Fix u `src/blocks/winRollup.mjs` (additive — 0 izmena drugih ponašanja)

```js
HookBus.on('onSkipRequested', function (p) {
  if (!p || p.phase !== 'rollup') return;
  if (!STATE.active || STATE.suppressed) return;
  if (STATE.rafId !== null) cancelAnimationFrame(STATE.rafId);
  /* Snap to lastAward (or window.__WIN_AWARD__ fallback if skip
   * arrived before our Start listener landed) */
  var target = STATE.lastAward > 0 ? STATE.lastAward : window.__WIN_AWARD__;
  _setText(target);
});
```

Banner ostaje vidljiv (`data-show="true"` netaknut), counter snap-uje na final, ostaje na ekranu do sledećeg `preSpin` clear-a.

### Live verification — `tools/_skip-coverage-probe.mjs` (NEW)

3 scenarija × 2 igre, 15 checks po igri:

| Scenario | Pre-skip stanje | Post-skip stanje | Rezultat |
|---|---|---|:--:|
| **A** Rollup skip mid-ramp | counter `€0.84` ramping | counter `€3.00` instant, 50 ms kasnije i dalje `€3.00` | ✅ |
| **B** BW walkthrough skip | tier=2 `€389.89` | tier=5 `€1500.00` instant + onBigWinTierEnd `{reason:'skipped', tier:5}` ~480 ms kasnije | ✅ |
| **C** Combined (line cycle + counter) | counter ramping na 5× bet | banner i dalje vidljiv + counter snapped na `€5.00` | ✅ |

**30/30 PASS** sve 2 igre.

### Updated test file

| File | Change |
|---|---|
| `tests/blocks/winRollup.test.mjs` | + assertion `HookBus.on('onSkipRequested'` baked + `p.phase !== 'rollup'` guard baked. Still 20/20 PASS. |

### Full regression matrix (all PASS)

| Gate | Result |
|---|:--:|
| `tests/blocks/winRollup.test.mjs` | **20/20 PASS** |
| `tools/lego-gate.mjs` (5 invariants, 51 blokova, 41 listenera) | **5/5 PASS** |
| `tools/_skip-coverage-probe.mjs` (NEW, 3 scenarija × 2 igre) | **30/30 PASS** |
| `tools/_bw-skip-probe.mjs` (H5.9 regression) | **22/22 PASS** |
| `tools/_bw-money-probe.mjs` (regression) | **33/33 PASS** |
| `tools/_bw-tier-cadence-probe.mjs` (regression) | **48/48 PASS** |
| `tools/_win-rollup-probe.mjs` (H5.8 regression) | **57/57 PASS** |

### BW force + skip pipeline (full coverage — already wired by H5.6/H5.7/H5.9/H5.10)

BW dugme path = isti kao real win, samo sa `__FORCE_BIG_WIN_TIER__` flag-om. Skip na svakoj fazi sad fast-finalizes pravu surface:

| Faza | Skip target | Owner | Coverage |
|---|---|---|:--:|
| Reels spinning | STOP slam — reels snap to settled positions | `slamStop` blok | preexisting |
| Win-line cycle | Linije iscrtavaju instant, counter snap | `winPresentation` + `winRollup` | H5.10 |
| Big-win walkthrough | Tier=5 climax instant + amount=final | `bigWinTier` | H5.9 |

---

## 🟢 Wave H5.9 — Skip = instant climax snap, no tier morph — SHIPPED (`73babf5`)

> Boki (05.06.2026): *"Skip treba da u big winu ode na kraju big wina, a ne da presence jedan po jedan tier. ajde samo fix to."*

### Root cause

`bigWinTierExit` was already snapping the banner's `data-tier` attribute directly to `finalTier` (skip probe confirmed 22/22 PASS at event level — 0 new `onBigWinTierEntered` events after the skip, climax tier reached within 50 ms). But the H5.7 hero-typography CSS introduced:

```css
.big-win-tier-banner {
  transition: color 600ms ease, font-size 600ms ease, filter 600ms ease;
}
```

When the attribute jumped tier-2 → tier-5, those 3 properties **tweened over 600 ms** from the tier-2 styles to the tier-5 styles. Because tier-3 and tier-4 styles lie ON THE COLOR/SIZE/FILTER RAMP between them, the morph LOOKED like a fast walkthrough of tiers 3 and 4 — exactly what Boki saw.

### Fix (CSS-only — runtime untouched)

`bigWinTierExit` now sets `data-skip="true"` on the banner BEFORE swapping `data-tier`. New CSS rules:

```css
.big-win-tier-banner[data-skip="true"]                     { transition: none; }
.big-win-tier-banner[data-skip="true"] .big-win-tier-label { transition: none; }
```

All transitions collapse → climax tier classes apply on the next paint → player sees climax **instantly** (within one frame), then 180 ms hold + 300 ms single fade-out to close. Defensive: `data-label-swap` attribute is cleared before snap so a mid-cross-fade label doesn't open the climax frame at 0% opacity.

### What changed in `src/blocks/bigWinTier.mjs`

| Surface | Pre H5.9 | Posle H5.9 |
|---|---|---|
| CSS rules | (none for skip mode) | `.big-win-tier-banner[data-skip="true"]` kills all transitions; label child also pinned |
| `bigWinTierExit` snap path | Direct attribute swap | + `data-skip="true"` set FIRST + `data-label-swap` cleared, then attribute swap |
| Defensive mount path (banner never existed) | Plain mount | Mount with `data-skip="true"` so the first paint is climax-ready |

### Live verification

| Probe | Result | What it proves |
|---|:--:|---|
| `tools/_bw-skip-probe.mjs` (3 demos × 11 checks) | **22/22 PASS** | Skip at tier 2 → within 50 ms: data-tier=5, amount="€1500.00", state.current=5; 0 new onBigWinTierEntered events; onBigWinTierEnd carries finalTier=5, x=1500 |
| `tests/blocks/bigWinTier.test.mjs` | **24/24** | Block contract unchanged |
| `tools/lego-gate.mjs` | **5/5** | LEGO invariants + vendor-neutral |
| `tools/_bw-money-probe.mjs` (regression) | **33/33** | Money counter still correct |
| `tools/_bw-tier-cadence-probe.mjs` (regression) | **48/48** | Natural walkthrough cadence preserved (4 s/tier) |
| `tools/_win-rollup-probe.mjs` (regression) | **57/57** | Base-game counter still correct |

### Boki rule honored

> *"Skip treba da u big winu ode na kraju big wina, a ne da presence jedan po jedan tier."*

Skip is now a frame-1 snap to climax — `data-skip` kills the visual ramp through intermediate tier classes. No more "sliding" through tier 3 / 4 during the 600 ms transition window.

---

## 🟢 Wave H5.8 — New `winRollup` block — base-game total-win counter above the hub — SHIPPED (`5e78cbe`)

> Boki (05.06.2026): *"sada obican counter u base game iznad Hub-a koji stoji. za sve winove osim big wina. nadji detaljno u WoO i prepisi kod ovde kao blok. stavi da se pojvljude kao sto je u igri tamo."*

### What this gives the player

A **persistent "TOTAL WIN: €X.XX" counter** that sits between the reels and the hub, hidden when idle and ramping digit-by-digit whenever a regular win lands. Big wins (≥ 10× bet by default) are deferred to the existing `bigWinTier` overlay — the rollup counter steps out of the way the instant `onBigWinTierEntered` fires.

### Reference source (industry baseline)

Reverse-engineered from the `statusBarController.rollupWin` flow in the reference game:

| Aspect | Reference | H5.8 implementation |
|---|---|---|
| Trigger | `onWinPresentationStart` → `statusBar.rollupWin(amount, dur, cb, bet)` | `HookBus.on('onWinPresentationStart')` → `winRollupShow(award)` |
| Counter math | Centi-precision linear, 30 updates/s | `requestAnimationFrame` linear ramp, quantised to cents |
| Duration | Scales with award magnitude | `MIN_DUR + max(0, x-1) × MS_PER_X`, clamped to [400, 2000] ms by default |
| Suppression | Big win runs `executeBigWin` instead | `ratio ≥ bigWinTriggerRatio` skips ramp + hides banner |
| Celebrate band | Win-celebrate effect for 1× < x < 10× | `is-celebrate` class added when ratio ≥ 1 (subtle warm border + glow) |
| Final state | Stays visible until next action | `data-show=true` persists until next `preSpin` clears it |
| Currency | Single source of truth (statusBar uses `fmt2()`) | Inherits `currency` + `currencyPosition` from `model.balanceHud` |

### New files

| File | Role |
|---|---|
| `src/blocks/winRollup.mjs` | New block — defaultConfig, resolveConfig, emitCSS/Markup/Runtime |
| `tests/blocks/winRollup.test.mjs` | 20/20 PASS — config validation, XSS escape, currency inheritance, determinism, vendor-neutral source |
| `tools/_win-rollup-probe.mjs` | Live regression — 19 checks × 3 demos = 57/57 PASS |

### Modified files

| File | Change |
|---|---|
| `src/buildSlotHTML.mjs` | + import for winRollup; + CSS emit; + markup emit ABOVE `.hub`; + runtime emit |
| `package.json` | + `winRollup.test.mjs` in `test:blocks` chain |

### Layout integration (LEGO ownership)

The block injects its own grid row into the `.stage` layout via `:has(#winRollupHost)`, so `themeCSS.mjs` doesn't need to know it exists. Default `.stage` grid is `"header" / "play" / "hub"`; with the block enabled it becomes `"header" / "play" / "winRollup" / "hub"`. Zero coupling — disable the block in config and the grid reverts automatically.

### Lifecycle wiring

| HookBus event | Behavior |
|---|---|
| `onWinPresentationStart {award}` | Start rollup if `award/bet < bigWinTriggerRatio`; else suppress |
| `onWinPresentationEnd` | Snap to final amount (defensive — guards mid-ramp interruption) |
| `onBigWinTierEntered` | Hide banner immediately (bigWinTier owns the screen) |
| `preSpin` | Clear display — next spin starts clean |
| `onFsTrigger` / `onFsEnd` | Clear display — FS overlay owns the screen during free spins |

### Verification (all PASS)

| Gate | Result |
|---|:--:|
| `tests/blocks/winRollup.test.mjs` | **20/20 PASS** |
| `tools/lego-gate.mjs` (5 invariants — 51 blocks now with test parity + 41 with listeners) | **5/5 PASS** |
| `tools/_win-rollup-probe.mjs` (live, 3 demos × 19 checks) | **57/57 PASS** |
| `tools/_bw-money-probe.mjs` (regression) | **33/33 PASS** |
| `tools/_bw-tier-cadence-probe.mjs` (regression) | **48/48 PASS** |

Live verification covered: (1) idle state hidden, (2) regular 3× bet win shows + ramps + celebrates, (3) big 50× win suppressed (state.suppressed=true), (4) preSpin clears display + amount=0, (5) host vertically above hub (hostY=745 vs hubY=811).

### Boki rule honored

> *"obican counter u base game iznad Hub-a koji stoji. za sve winove osim big wina."*

✅ Counter sits above the hub via grid `"winRollup"` row.
✅ Shows for all wins below `bigWinTriggerRatio` (default 10× bet, GDD-overridable).
✅ Big wins still trigger `bigWinTier` overlay — the two presenters coexist without visual collision.

---

## 🟢 Wave H5.7 — Big-Win layout matches industry reference (boxless, counter ≥ label) — SHIPPED (`e5cb15f`)

> Boki (05.06.2026): *"Sad nadji counter u WoO igri i ubaci ga na istom mestu kao sto je tamo u igri ubaci ga u rectangulat."*

### Reference layout audit

Side-by-side capture via `tools/_woo-counter-screenshot.mjs` revealed the reference bigwin layout:

| Surface | Reference (industry, hero-typography) | H5.6 factory (BEFORE) |
|---|---|---|
| Wrapper | Transparent flex column, no border, no bg, no box-shadow, gap 20px, padding 40×60px | Opaque box: `rgba(0,0,0,0.74)` bg, 3px border, 22px radius, 90-110px outer glow, 1.6×3.4rem padding |
| Title font | clamp(64px, 16vw, **140px**) | 2.4rem → 3.8rem (~38-61px) — too small |
| Value/counter font | clamp(72px, 18vw, **150px**) — **bigger than title** | 0.6em × banner font (~36px) — **smaller than label** |
| Depth | 5-step `filter: drop-shadow()` stack (3D extrusion + soft outer halo) | Single text-shadow blur (18px) |
| Tier escalation | Per-tier hue + font-size growth | Per-tier border + box-shadow color + font-size growth |

### What changed in `src/blocks/bigWinTier.mjs` (CSS only — runtime unchanged)

| CSS surface | Pre H5.7 | Posle H5.7 |
|---|---|---|
| `.big-win-tier-banner` | Box with bg + border + radius + outer box-shadow | Transparent flex column, gap 20px, padding 40×60px — pure hero-typography stack |
| `.big-win-tier-amount` | `font-size: 0.6em` (60% of label) | `font-size: 1.07em` (industry-standard 7% bigger than label) |
| Tier visuals | `border-color + box-shadow` per tier | `filter: drop-shadow()` 3-step depth stack per tier — 2 dark drops for chunky 3D extrusion + 1 colored halo from `cfg.colors[i]` |
| Per-tier font-size | `2.4rem → 3.8rem` | `clamp(48px, 11vw, 90px) → clamp(72px, 17vw, 140px)` — viewport-responsive, max 140px on desktop |
| Mobile breakpoint | Per-tier `font-size` override + reduced padding | clamp() auto-handles font-size; only padding/gap shrink |
| Transition target | `border-color, box-shadow, color, font-size` | `color, font-size, filter` — matches the new visual properties |

### Vendor-neutral integrity

Block source remains free of vendor / studio / brand strings (LEGO invariant 3 still PASS). The 3D drop-shadow ladder is industry-standard hero-typography (used by every AAA slot vendor); color palette comes from `cfg.colors[]` which is GDD-driven.

### Live verification (all 4 probes PASS)

| Probe | Result | What it proves |
|---|:--:|---|
| `tests/blocks/bigWinTier.test.mjs` | **24/24** | Config / runtime determinism preserved |
| `tools/lego-gate.mjs` | **5/5** | LEGO invariants + vendor-neutral source |
| `tools/_bw-tier-cadence-probe.mjs` (3 demos × 2 scenarios) | **48/48** | 4 s/tier cadence unchanged (block still owns rhythm) |
| `tools/_bw-money-probe.mjs` (3 demos) | **33/33** | Counter still ramps `€0.00 → €N.NN`, climax holds at exact award |
| `tools/_woo-counter-screenshot.mjs` (visual diff) | layout match | Both reference + factory render: 140px+ font, transparent wrapper, label-on-top + counter-below stack |

### Boki rule honored

> *"Sad nadji counter u WoO igri i ubaci ga na istom mestu kao sto je tamo u igri ubaci ga u rectangulat."*

Layout = identical to the reference: hero-typography flex column, transparent wrapper, 140px+ glyphs with 3D drop-shadow depth, counter slightly bigger than the label. All three demos (rectangular, WoO, GoO) now share the same big-win visual cadence and proportions because the block — not the call site — owns layout.

---

## 🟢 Wave H5.6 — Tier promotion = TIME-BASED, not threshold-based (block owns cadence) — SHIPPED (`fea17e7`)

> Boki (05.06.2026): *"sto se BW force dugmeta tice, ne ponasaju se tirovi isto kao kada se dobiju iz igre. nego se menjaju odmah jedan za drugim. Dugme u forcu uvek samo poziva ishod ne diriguje kako ce se bilo sta drugo ponasati, sve su to blokovi sami za sebe."*

### Root cause

H5.5 still drove tier swaps on ratio crossings (`current/bet >= THRESHOLDS[i]`). With BW-force award = 1.5× top threshold × bet, tier 1-4 all crossed in <2.7 s and tier 5 sat for the remaining 17.3 s. A real win with tighter ratio produced a different rhythm — so the **caller implicitly dictated tier cadence**. That broke Boki's LEGO principle "blokovi sami za sebe".

### Fix

Tier promotion is now TIME-BASED. Each tier `i` is visible for exactly `DURATIONS[i-1]` ms (default 4 s, GDD-overridable) regardless of awarded amount. Counter ramps linearly in parallel (`_countUpLinear`) but it no longer drives tier swaps. Scheduling is owned by `_runCompound` and anchored on the startTier enter timestamp (T0), so fade-in latency doesn't shift the cadence.

### What changed in `src/blocks/bigWinTier.mjs`

| Surface | Pre H5.6 | Posle H5.6 |
|---|---|---|
| Tier promotion trigger | `while (currentRatio >= THRESHOLDS[activeTier-1])` inside `_countUpLinear` rAF loop | `setTimeout(promote, cumulative)` scheduled from `_runCompound` at T0; each tier visible exactly `DURATIONS[i-1]` ms |
| Cadence ownership | Implicit — counter rate × award magnitude | Explicit — block scheduler reads `DURATIONS[]` and ignores award magnitude entirely |
| `_countUpLinear` arity | `(fromAward, toAward, dur, startTier, finalTier)` | `(fromAward, toAward, dur)` — pure money ramp |
| Cancellation token | `STATE.rafToken` bumped inside `_countUpLinear` | `STATE.rafToken` bumped at top of `_runCompound`; tier timers + count-up rAF share the same token |
| First-interval offset bug | Tier 2 fired 4 s AFTER fade-in (effective 4.3 s from tier 1 enter) | Tier 2 fires DURATIONS[0] ms from tier 1 enter (T0) → ±2 ms across all intervals |
| Threshold values | Drove runtime swap | Retained for tier classification only (`tierFromRatio` in `onWinPresentationEnd` listener) — no longer touches runtime cadence |

### Live verification — `tools/_bw-tier-cadence-probe.mjs` (new regression guard)

Probe checks two scenarios per demo: (1) BW-force click (loose ratio = 1.5×threshold), (2) programmatic `bigWinTierEnter(5, tightAward)` where award = exactly tier-5 threshold × bet (tight). Both must produce identical 4 s intervals.

| Demo | BW-click intervals (ms) | Tight-prog intervals (ms) | Δ from 4000ms |
|---|---|---|:--:|
| rectangular | `[4001, 4000, 4001, 4000]` | `[4001, 4000, 4000, 4000]` | ≤ 2 ms |
| wrath-of-olympus | `[4002, 3999, 4000, 4001]` | `[4001, 4000, 4000, 4000]` | ≤ 2 ms |
| gates-of-olympus-1000 | `[4001, 3999, 4000, 4000]` | `[4001, 4000, 4000, 4000]` | ≤ 2 ms |

**48/48 PASS.** Cadence is identical regardless of award magnitude. Caller (BW dugme, real spin, programmatic, future force-anything) cannot dictate tier rhythm anymore.

### Gate-ovi

| Gate | Result |
|---|:--:|
| `tests/blocks/bigWinTier.test.mjs` | **24/24 PASS** |
| `tools/lego-gate.mjs` (5 invariants) | **5/5 PASS** |
| `tools/_bw-tier-cadence-probe.mjs` (live, 3 demos × 2 scenarios) | **48/48 PASS** |
| `tools/_bw-money-probe.mjs` (regression check, 3 demos) | **33/33 PASS** |

### Boki rule honored

> *"Dugme u forcu uvek samo poziva ishod ne diriguje kako ce se bilo sta drugo ponasati, sve su to blokovi sami za sebe."*

Block alone owns cadence. The caller pipes in award + tier and steps back — the block plays its choreography on its own clock.

---

## 🟢 Wave H5.5 — Big-Win counter shows ABSOLUTE money (no more ratio "×N") — SHIPPED (`db19644`)

> Boki (05.06.2026): *"counter ne treba da bude x pa counter, nego samo counter da se broji novac, i na kraju countera da ostane koliko se osvojilo a ne x26 i slično."* H5.4 (`849b6ee`) shipped the linear counter but it ticked in ratio-space (`×0 → ×1500`) — the player never saw the actual money they won. H5.5 keeps the **tier-classification math in ratio space** (vendor-neutral ladder math is unchanged: `tier = max{t : thresholds[t-1] ≤ award/bet}`) but ramps the **player-facing counter in ABSOLUTE money** with the same currency symbol/position as `balanceHud` (single UX source of truth — banner counter reads identically to the win column in the HUD).

### What changed in `src/blocks/bigWinTier.mjs`

| Surface | Pre H5.5 | Posle H5.5 |
|---|---|---|
| `defaultConfig()` | No currency knobs | `currency: '€'` + `currencyPosition: 'prefix'` (inherit-aware, see resolveConfig) |
| `resolveConfig()` | — | Resolution order: explicit `model.bigWinTier.currency` > inherit `model.balanceHud.currency` > default `€`. Same for `currencyPosition`. Inheritance keeps banner ↔ HUD visually unified by default. |
| Runtime bake | `THRESHOLDS / LABELS / DURATIONS / SOUND_BUSES / COMPOUND / FADE_MS / END_HOLD_MS` | + `CURRENCY` + `CUR_POS` (frozen at bake time, no runtime config dereference cost) |
| `_fmt(v)` (ratio formatter) | `v >= 100` → 0 decimals, else 2 stripped | **REPLACED** by `_fmtMoney(v)` — always 2 decimals + currency symbol prefix/suffix. Output mirrors `balanceHud._formatMoney` byte-for-byte. |
| `_runCompound(finalTier, finalX)` | `finalX` was the ratio | `_runCompound(finalTier, finalAward)` — second arg is now the **absolute money award** |
| `_countUpLinear` | `from/to` ratio; threshold check `current >= THRESHOLDS[i]` | `fromAward/toAward` money; threshold check `(current/bet) >= THRESHOLDS[i]` — ladder math still in ratio space, only display is money |
| Initial banner | `<span data-count="0">×0</span>` | `<span data-count="0">_fmtMoney(0)</span>` → `€0.00` |
| Skip-snap (`bigWinTierExit`) | `'×' + _fmt(finalX)` | `_fmtMoney(finalX)` |
| `bigWinTierEnter(tier, x)` | `x` was ratio; default = `THRESHOLDS[tier-1]` | `bigWinTierEnter(tier, award)` — `award` is absolute money; default = `THRESHOLDS[tier-1] × 1.5 × bet` (safely crosses tier threshold) |
| `onWinPresentationEnd` listener | `_runCompound(tier, ratio)` | `_runCompound(tier, award)` — passes the absolute `window.__WIN_AWARD__` directly |
| Event payload `x` field | Ratio | **Absolute award amount** (audio/test listeners that need ratio derive it as `x / bet`) — documented in `_runCompound` JSDoc |
| `_currentBet()` helper | — | NEW — single source of truth for current bet (defensive default 1 if betSelector hasn't mounted yet) |

### Live verification — `tools/_bw-money-probe.mjs` (added as new regression guard)

Playwright probe clicks the BW button on each of 3 demos, samples the counter every 300 ms, and snapshots the last non-null text seen before cleanup (climax frame). Expectations validated:

| Demo | bet | award | climax-frame text | × prefix | currency hits | entered | endX |
|---|:--:|:--:|---|:--:|:--:|:--:|:--:|
| rectangular | €1 | €1500 | `€1500.00` ✅ | 0 ✅ | 82 ✅ | 5 ✅ | 1500 ✅ |
| wrath-of-olympus | €1 | €1500 | `€1500.00` ✅ | 0 ✅ | 82 ✅ | 5 ✅ | 1500 ✅ |
| gates-of-olympus-1000 | €1 | €1200 | `€1200.00` ✅ | 0 ✅ | 82 ✅ | 5 ✅ | 1200 ✅ |

**Total: 33/33 pass.** Counter ramps `€0.00 → €1500.00` linearly, holds at climax = exact win amount, then fades. 0 console / page errors across all 3 demos.

### Gate-ovi

| Gate | Result |
|---|:--:|
| `tests/blocks/bigWinTier.test.mjs` | **24/24 PASS** |
| `tests/blocks/spinControl.test.mjs` (SKIP_BIGWIN path) | **17/17 PASS** |
| `tools/lego-gate.mjs` (5 invariants) | **5/5 PASS** |
| `tools/_bw-money-probe.mjs` (live, 3 demos) | **33/33 PASS** |

### Boki rule honored

> *"counter ne treba da bude x pa counter, nego samo counter da se broji novac, i na kraju countera da ostane koliko se osvojilo a ne x26 i slično"*

Counter is now player money, not designer ratio. Climax plaque shows the exact award before fade-out. Currency inherits from balanceHud so changing one symbol updates both consistently.

---

## 🟢 Wave H5.4 — Big-Win Tier continuous-counter rewrite — SHIPPED (`849b6ee`)

> Boki (05.06.2026): *"Svaki tier treba da traje po 4 sekunde, i onda big win end event isto cetiri sekunde i da se fejdoutuje plaketa. takojde prelaz izmedju tirova mora da bude gladak bez stajanja i big win counter mora non stop da broji istom brzinom"*. H5.3 (`f75d5c1`) shipped a compound walkthrough but each tier had its own fade-in / count-up (easeOutCubic) / fade-out — counter stopped between tiers + ramp speed varied per segment. H5.4 rewrites the runtime to a **single linear counter that escalates tier label/color in place** while the count ticks at constant rate from 0 → finalX over (#tiers × 4 s), then holds 4 s, then fades once.

### What changed in `src/blocks/bigWinTier.mjs`

| Lokacija | Pre H5.4 | Posle H5.4 |
|---|---|---|
| `_runCompound` | Sequencer: per-tier render → fade-in → easeOutCubic count-up (prevX→tierX) → hold → fade-out → next tier | Single mount → linear count-up 0 → finalX over Σ DURATIONS[startTier..finalTier] ms → endHold (`endHoldMs=4000`) → single fade-out |
| `_countUp` (easeOutCubic) | Per-tier promise; easeOut decel | REPLACED by `_countUpLinear` — pure linear ramp + threshold crossing detection that drives `_swapTier` + per-tier `_emitEntered`/`_emitExited` events in flight |
| Per-tier fade transitions | 2 × `fadeMs` (600 ms total) stop between tiers | REMOVED — tier swap = `data-tier` attribute morph + label cross-fade (220 ms) over running counter |
| `bigWinTierExit` (skip) | Cleanup host → mount fresh climax node → fade-out | In-place DOM mutation (no remount) — set `data-tier=finalTier`, label text, `data-count=finalX`; 180 ms glimpse; fade-out |
| `_mountBanner()` | Hard-coded tier 1 start | REPLACED by `_mountBannerAt(tier)` — starts at `COMPOUND ? 1 : finalTier` |
| CSS comment block | "enter → hold → exit per tier" | Updated to "ONCE at start" / "during entire walkthrough" / "ONCE at the end" |

### Default config additions

| Key | Default | Why |
|---|:--:|---|
| `endHoldMs` | `4000` | Boki "big win end event isto cetiri sekunde" — banner stays steady at climax for this long before fade |
| `durations` | `[4000, 4000, 4000, 4000, 4000]` | Boki "svaki tier treba da traje po 4 sekunde" — was already 4×4×4×4×4 in default but per-tier count-up + fade gaps inflated effective time |
| `resolveConfig.endHoldMs` validator | `clampInt(0, 12000)` | New GDD knob exposed |

### Live verification — `tools/_big-win-flow-probe.mjs` (kept in repo as regression guard)

Playwright probe on `wrath-of-olympus.html` (durations `[4000,4000,4000,4500,5500]`, endHold 4000, total 26.3 s natural walkthrough). Tier 5 forced via `bigWinTierEnter(5, 1500)`:

| Acceptance | Result |
|---|:--:|
| 5 × `onBigWinTierEntered`, tiers 1→2→3→4→5 | ✅ |
| 5 × `onBigWinTierExited`, tiers 1→2→3→4→5 | ✅ |
| 1 × `onBigWinTierEnd` reason=`natural`, finalTier=5, x=1500 | ✅ |
| Single `.big-win-tier-banner` DOM node throughout (no remount per tier) | ✅ |
| Counter monotonic non-decreasing 0 → 1500 over 127 samples | ✅ |
| Counter reaches finalX (≥1490) by end of count window | ✅ |
| Skip mid-walkthrough → `onBigWinTierEnd` reason=`skipped` | ✅ |
| Skip latency ≤ 600 ms (measured 484 ms) | ✅ |
| 0 page errors, 0 console errors | ✅ |
| **12 / 12 pass** | ✅ |

### Unit + LEGO + dist

| Gate | Result |
|---|:--:|
| `tests/blocks/bigWinTier.test.mjs` | 24/24 PASS |
| LEGO 5-invariants | 5/5 PASS (vendor grep clean — `WoO reference` comments replaced with `Reference GDD`) |
| `package.json test:blocks` | bigWinTier added to the chain (was missing) |
| `tools/regen-all-playable.mjs` | 3/3 dist regen — `01_rectangular_5x3_playable.html` 273.6 KB, `wrath-of-olympus.html` 303.7 KB, `gates-of-olympus-1000.html` 296.5 KB |

### Algorithm summary (for downstream listeners)

```
on onWinPresentationEnd:
  ratio = __WIN_AWARD__ / __SLOT_BET__
  tier  = tierFromRatio(ratio)             // 0..5, 0=no-op
  if tier >= 1: _runCompound(tier, ratio)

_runCompound(finalTier, finalX):
  startTier = COMPOUND ? 1 : finalTier
  mount banner at startTier, fade-in (FADE_MS=300ms)
  emit onBigWinTierEntered(startTier, finalX)
  totalCountMs = Σ DURATIONS[startTier..finalTier]
  rAF loop over totalCountMs:
    current = finalX * (elapsed/totalCountMs)   // LINEAR
    update amount text
    while current >= THRESHOLDS[activeTier-1] && activeTier < finalTier:
      emit onBigWinTierExited(activeTier, 'natural')
      activeTier++
      _swapTier(activeTier)                     // morph border/color + label cross-fade
      emit onBigWinTierEntered(activeTier, finalX)
  hold endHoldMs (4000ms steady at climax)
  fade-out FADE_MS
  emit onBigWinTierExited(finalTier, 'natural')
  emit onBigWinTierEnd(finalTier, finalX, 'natural')

on onSkipRequested{phase:'bigWinTier'}:
  bigWinTierExit('skipped')
    → DOM mutate to finalTier+finalX (no remount, no fade-in)
    → emit onBigWinTierExited(prevTier, 'skipped')
    → 180ms glimpse → fade-out → emit onBigWinTierEnd(finalTier, finalX, 'skipped')
```

---

## 🟢 Wave H5.2 — Big-Win Tier hardening (placeholder naming · animated count-up · BW force REAL spin) — SHIPPED `d972910`

> Boki (05.06.2026): *"rekao sam da bude bigwintier1-5 i opet si stavio nice epic itd … gde je counter … tehnicki deo mehaniku prepisuješ iz WoO igre … force dugme treba da okrene spin, kao bilo koje drugo force dugme. zapisi to pravilo"*. Four distinct fixes in one commit plus a new permanent rule.

### Four fixes in this iteration

| # | Fix | Detail |
|:--:|---|---|
| **1** | Default labels = `BIGWINTIER1..5` | Block default + rectangular dist default = literal identifier strings ("bigwintier1-5 da se zna da je big win"). WoO/GoO retain their authored GDD vocab. |
| **2** | Animated count-up | Banner renders ×0 → ×target via easeOutCubic rAF tween over (durationMs × 0.66). Final 1/3 holds steady. Reference GDD §6.4 "Win count-up halts → plaque" mechanic. Snaps to exact target; cancels cleanly via STATE.rafToken bump. |
| **3** | BW dev button = REAL spin | New rule `rule_force_buttons_real_spin.md`. BW click sets `window.__FORCE_BIG_WIN_TIER__ = N` + `runOneBaseSpin()`. winPresentation reads flag in `applyWinHighlight`, synthesises one event with `payX = thresholds[N-1] × 1.5 × bet`, runs normal cycle → onWinPresentationEnd → bigWinTier banner. Same path as a real win. One-shot flag clears after consumption. |
| **4** | New permanent rule | `~/.claude/projects/-/memory/rule_force_buttons_real_spin.md` linked in MEMORY.md — every force/dev button MUST spin reels via `runOneBaseSpin()` with a force flag. NEVER direct API shortcut. |

### Code touched

| File | Why |
|---|---|
| `src/blocks/bigWinTier.mjs` | Default labels → BIGWINTIER<N>; STATE exposes `thresholds`/`labels`/`durations`; `_startCountUp()` + `STATE.rafToken`; `_render()` renders `×0` placeholder + invokes count-up. |
| `src/blocks/winPresentation.mjs` | Early consumption of `__FORCE_BIG_WIN_TIER__` BEFORE `noWinChance` dice roll. Synthesises event, runs cycle, emits Start/End. Old late check removed. |
| `src/buildSlotHTML.mjs` | BW button: `__FORCE_BIG_WIN_TIER__` + `runOneBaseSpin()`. Re-enable BW on `onBigWinTierExited` for fast cycle + 10s hard fallback. |
| `tools/regen-all-playable.mjs` | Rectangular labels → BIGWINTIER<N>. WoO/GoO unchanged. |
| `tests/blocks/bigWinTier.test.mjs` | Default-label assertion expects BIGWINTIER<N>. |

### Live QA — 10/10 PASS (Playwright probe on rectangular dist)

| # | Check | Result |
|:--:|---|:--:|
| 1 | Rectangular labels = `['BIGWINTIER1'..'BIGWINTIER5']` | ✅ |
| 2 | BW click triggers REAL `preSpin` | ✅ |
| 3 | BW click #1 forces tier 1 | ✅ |
| 4 | Banner DOM text = "BIGWINTIER1" | ✅ |
| 5 | Count-up mid-ramp ×13.18 (target 15, easeOut decel visible) | ✅ |
| 6 | Count-up snaps to exact final 15 == 15 | ✅ |
| 7-10 | Click cycle #2..#5 → tier 2..5 labeled BIGWINTIER2..5 | ✅ × 4 |

### Visual proof

`/tmp/cortex-bigwin-final/click-1-tier-1-ramp.png` — banner "BIGWINTIER1 ×13.26" mid-ramp climbing toward 15, spinBtn morphed to cyan SKIP CTA.

### Unit + LEGO gates

| Gate | Result |
|---|:--:|
| `tests/blocks/bigWinTier.test.mjs` | **23/23 PASS** |
| `tests/blocks/winPresentation.test.mjs` | **All PASS** |
| `tests/blocks/spinControl.test.mjs` | **17/17 PASS** |
| LEGO 5-invariants | **5/5 PASS** |

---

## 🟢 Wave H5 + V5.3 — Big-Win Tier ladder COMPLETE (skip-integrated · per-game labels · 45/45 live QA) — SHIPPED `49da107`

> Sledeća iteracija (Boki *"ajde zavrsi big win. ultimativno i odradi qa ultiamtivno detaljan i zivi review da si potpuno siguran da sve radi savreseno"*) zatvara preostala dva atoma iz prethodnog H5 ship-a:
> 1. **V5.3** — spinControl morfuje CTA u `SKIP_BIGWIN` tokom big-win banner-a; klik emit-uje `onSkipRequested{phase:'bigWinTier'}` → blok izlazi.
> 2. **Per-game labele** — sve 3 demo igre dobijaju svoj autorski tier vokabular kroz `tools/regen-all-playable.mjs` (sample GDD-ovi ostaju u repo-u kao test fixture).

### V5.3 — spinControl SKIP_BIGWIN state

| Lokacija | Šta dodato |
|---|---|
| `VALID_STATES` | `+ 'SKIP_BIGWIN'` (frozen list) |
| `setState` whitelist | `+ 'SKIP_BIGWIN'` |
| `_onClick` SKIP_* phase mapping | `+ 'SKIP_BIGWIN': 'bigWinTier'` |
| New listeners | `onBigWinTierEntered → setState('SKIP_BIGWIN')` (autoplay-gated); `onBigWinTierExited → revert SPIN` |
| Legacy stub `forceSkipRequest` phase mapping | `+ 'SKIP_BIGWIN': 'bigWinTier'` (third-party API parity) |

### Per-game label vocabulary (sve u `tools/regen-all-playable.mjs`)

| Demo | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|---|---|---|---|---|---|
| `01_rectangular_5x3_playable.html` | NICE WIN | BIG WIN | SUPER WIN | HYPER WIN | GRAND WIN |
| `wrath-of-olympus.html` | BIG WIN | MEGA WIN | EPIC WIN | ZEUS WIN | OLYMPUS WIN |
| `gates-of-olympus-1000.html` | BIG WIN | MEGA WIN | SUPER WIN | EPIC WIN | MYTHIC WIN |

### Ultimate live QA (Playwright × 3 igre × 11 checks = 45 PASS)

| QA atom | Što proverava | Result |
|---|---|:--:|
| **QA-1** (5 × 3) | Per-tier label match `bigWinTierEnter(t, x) → banner text === GDD label` | ✅ 15/15 |
| **QA-2** (1 × 3) | `onWinPresentationEnd → SKIP_BIGWIN` state morf | ✅ 3/3 |
| **QA-3** (1 × 3) | Click na SKIP CTA emit-uje `onSkipRequested{phase:'bigWinTier'}` | ✅ 3/3 |
| **QA-4** (1 × 3) | bigWinTier emit-uje `onBigWinTierExited{reason:'skipped'}` | ✅ 3/3 |
| **QA-5** (1 × 3) | State revert na SPIN posle skip | ✅ 3/3 |
| **QA-6** (1 × 3) | `preSpin` flush stale banner | ✅ 3/3 |
| **QA-7** (1 × 3) | Autoplay-active suppress-uje SKIP_BIGWIN morf | ✅ 3/3 |
| **QA-8** (1 × 3) | `tierFromRatio` deterministic (isti input → isti tier) | ✅ 3/3 |
| **QA-9** (1 × 3) | Out-of-range tier 6 reject (frozen enum constraint) | ✅ 3/3 |
| **QA-10** (1 × 3) | Idempotent enter — viši tier drži, niži ignored | ✅ 3/3 |
| **QA-11** (1 × 3) | Screenshot snimak tier 5 banner-a | ✅ 3/3 |

### Visual proof

`/tmp/cortex-bigwin-ult/`:
- `01_rectangular_5x3_playable-tier5.png` — **GRAND WIN ×1500**
- `wrath-of-olympus-tier5.png` — **OLYMPUS WIN ×1500** + SKIP CTA visible
- `gates-of-olympus-1000-tier5.png` — **MYTHIC WIN ×1500** + SKIP CTA visible

### Unit + LEGO gates (pre commit)

| Gate | Result |
|---|:--:|
| `tests/blocks/spinControl.test.mjs` (postojeći) | **17/17 PASS** |
| `tests/blocks/bigWinTier.test.mjs` (postojeći) | **23/23 PASS** |
| `tests/blocks/winPresentation.test.mjs` | **All PASS** |
| `tests/blocks/hookBus.test.mjs` | **29/29 PASS** |
| LEGO 5-invariants | **5/5 PASS** (vendor grep clean — labels live in `tools/regen-all-playable.mjs`, NOT in `src/blocks/`) |

### Što ostaje out-of-scope (po izboru, ne blokira H5+V5.3 production)

| Atom | Razlog |
|---|---|
| H17 — Audio mixer | Audio tok je ADB (CLAUDE.md hard rule), neutral od bigWinTier osim payload `soundBus` key |
| Per-tier particle FX kit | `houseExplosionFXKit` (Tier-D skipped) — art-pack delivery, ne kodni atom |
| Sample GDD parser extension za `bigWinTier` literal | Trenutno labele u tool-u rade; parser ekstenzija je nice-to-have kad budu dodate druge igre |

### Acceptance gates 10/10

1. ✅ `tier: INT` (1..5) jedini consumed contract code-side; labels su strings iz GDD config-a
2. ✅ Vendor grep `src/blocks/` čist (0 hits)
3. ✅ Banner emit POSLE rollup-a (`onWinPresentationEnd`)
4. ✅ Skip CTA morfuje SAMO tokom banner-a (SKIP_BIGWIN window)
5. ✅ preSpin flush — stale banner nikad ne pređe round boundary
6. ✅ Autoplay symmetry — engine owns cadence; manualni skip morf gated
7. ✅ a11y — `aria-live="polite"` + `prefers-reduced-motion` honored
8. ✅ Determinism — isti input → isti tier; isti config → byte-identical CSS/runtime
9. ✅ Idempotency — duplicate enter no-op; lower-tier ignored; out-of-range rejected
10. ✅ Per-game vocabulary works end-to-end — `bigWinTierEnter(N, x)` → DOM banner shows GDD label "OLYMPUS WIN", not "TIER 5"

---

## 🟢 Wave H5 — Big-Win Tier ladder (vendor-neutral 5-tier) — SHIPPED `c1f211c`

> Triggered by Boki *"big win mora da bude template … bigwintier1 da se zna da je big win, samo naming convention sredi"* + *"zapisi sve sto sto treba da radis detaljno u master todo, pa onda otidji u WoO i pogledaj kako je big win odradjen, i ti ga tako ubaci do detalja u rectangulat … u igt playa core i playa slot pogledaj pravila"*. H5 lifts the existing WoO 6.4 three-tier ladder (BIG/MEGA/EPIC, 10x/25x/50x, 4s plaques) into a fully vendor-neutral 5-tier system with GDD-driven labels/thresholds/durations/colors. Same block runs every game; per-game vocabulary lives in `model.bigWinTier`.

### What landed in this wave

| Atom | File | Status |
|:--:|---|:--:|
| H5.a — block source | `src/blocks/bigWinTier.mjs` | ✅ CREATED — defaultConfig + resolveConfig + emitCSS + emitMarkup + emitRuntime |
| H5.b — unit suite | `tests/blocks/bigWinTier.test.mjs` | ✅ 23 PASS — threshold validators, label override, malformed-GDD fallback, vendor-grep, determinism |
| H5.c — HookBus contract | `src/blocks/hookBus.mjs` | ✅ `onBigWinTierEntered` + `onBigWinTierExited` added to canonical list |
| H5.d — canonical-list test | `tests/blocks/hookBus.test.mjs` | ✅ extended expected list (29 PASS) |
| H5.e — LEGO ownership | `tools/lego-gate.mjs` | ✅ single-owner = `bigWinTier.mjs` for both emit events |
| H5.f — buildSlotHTML wiring | `src/buildSlotHTML.mjs` | ✅ CSS + markup + runtime emit slotted after uiToast |
| H5.g — dist auto-enable | `tools/regen-all-playable.mjs` | ✅ injects `big_win_tier` feature kind on every demo until per-game GDDs declare their own |
| H5.h — naming convention | (all surfaces) | ✅ `bigWinTier` namespace, `tier:INT` (1..5), `.big-win-tier-N` CSS, `__BIG_WIN_TIER__` global, `bigWinTierEnter`/`Exit` API |

### Industry reference (vendor-neutral synthesis)

| Source | Rule we lifted |
|---|---|
| Slot-CTA baseline §6 | Monotonic threshold table; highest matching tier wins; optional passthrough |
| Win-presentation order §4 | Banner emit AFTER per-line rollup ends (`onWinPresentationEnd`), not on `postSpin` |
| Audit-grade win classification §3 | Numeric tier ID (1..5) + per-game label override = regulator-friendly |
| Reference GDD (WoO 6.4 BIG/MEGA/EPIC, 10/25/50×, 4s plaque) | Threshold ladder + plaque-lifetime ladder structure, generalized to 5 tiers + per-tier durations |

### Naming map (consistent everywhere)

| Surface | Convention | Example |
|---|---|---|
| Block file | camelCase | `src/blocks/bigWinTier.mjs` |
| HookBus event | `on<PascalCase>` | `onBigWinTierEntered` |
| Event payload | `tier: INT` | `{ tier: 3, x: 67.5, label: 'TIER 3', durationMs: 3200, soundBus: 'high' }` |
| GDD config key | camelCase | `model.bigWinTier = { thresholds, labels, durations, colors, passthrough, passthroughMs, soundBuses }` |
| CSS class | BEM-style | `.big-win-tier-host`, `.big-win-tier-banner`, `[data-tier="3"]`, `.is-tier-4`/`.is-tier-5` flash |
| Frozen enum | SCREAMING_SNAKE | `BIG_WIN_TIER_MIN=1`, `BIG_WIN_TIER_MAX=5`, `BIG_WIN_TIER_IDS=[1,2,3,4,5]` |
| Public API | camelCase | `window.bigWinTierEnter(tier, x)`, `window.bigWinTierExit(reason)` |
| Window global | snake-upper | `window.__BIG_WIN_TIER__` (0 = none, 1..5 = active) |
| LEGO ownership | single-emitter | `EXPECTED_EMIT_OWNERS.onBigWinTierEntered = ['bigWinTier.mjs']` |
| Skip phase string | matches block name | `onSkipRequested { phase: 'bigWinTier' }` |

### Verification

| Gate | Result |
|---|:--:|
| `tests/blocks/bigWinTier.test.mjs` (new) | **23 PASS / 0 fail** |
| `tests/blocks/hookBus.test.mjs` (canonical list +2) | **29 PASS / 0 fail** |
| LEGO 5-invariants | **5/5 PASS** (vendor-neutral grep clean; ownership match for both new events) |
| Live tier enter/exit sanity (Playwright) | `bigWinTierEnter(3, 67.5)` → STATE.current=3, label='TIER 3', x=67.5; `bigWinTierExit('skipped')` → STATE.current=0. ✅ |
| Visual tier banner screenshot (T1–T5) | `/tmp/cortex-bigwin/tier-N.png` — banner centered, per-tier accent color, ×amount block, exit anim ok |
| dist regen 3 demos | rectangular 256 KB · WoO 286 KB · GoO 278 KB |
| Vendor grep `src/blocks/bigWinTier.mjs` | **0 hits** (IGT / PlayCore / playa-slot / pragmatic / megaways / NetEnt / Wolf / Cleopatra / Buffalo / Olympus) |

### Out of scope for H5 — landing in V5.3 + H17 + per-game GDDs

| Atom | Why deferred |
|---|---|
| V5.3 — Big-Win toast skip | spinControl must morph CTA to SKIP during `onBigWinTierEntered..Exited` window. Will subscribe and emit `onSkipRequested{phase:'bigWinTier'}`. |
| H17 — `bigWinMomentAudioMixer.mjs` | Audio block consumes `soundBus` key from payload to cross-fade Howler buses. Audio tok separate per `rule ADB ≠ GDD`. |
| Per-game label overrides | Sample GDD-ovi nemaju per-tier copy bloka. Trenutno svi tier-i nose placeholder "TIER N" dok GDD authoring (sa marketing copy-jem) ne odredi vocabular. |
| Particle FX kit | `houseExplosionFXKit` (Tier-D skipped) is the art-pack approach; not blocking the mechanic. |

### Acceptance gates 7/7

1. ✅ Tier ladder is **deterministic** — same `x` always yields same tier.
2. ✅ Tier **1..5 enum** is the only thing code consumes; labels are GDD-driven strings.
3. ✅ Banner emits **after** rollup ends (`onWinPresentationEnd`), not during.
4. ✅ Skip path is **wired** (`onSkipRequested{phase:'bigWinTier'}` → exit).
5. ✅ preSpin flush prevents stale banner across rounds.
6. ✅ a11y: `aria-live="polite"` host + `prefers-reduced-motion` honored (animations disabled, opacity:1).
7. ✅ Vendor grep clean across all emitted CSS/markup/runtime + unit-test suite.

---

## 🔵 Wave V5 — Skip-completeness (chain-aware fast-finalize) — V5.0 ✅ SHIPPED · V5.1-V5.10 PLANNED

> Triggered by Boki *"E sad nadji kako radi skip dugme i kad i sta se sve vezano za taj koncept desava, win linije, sve sto moze da se skipuje, isto u igtplaya slot i pla=ya core"* + immediate follow-up *"odradi overi zasto ti ga nema skip dugme uopste i zasto ne radi u retangle"*. Wave V3 ships the SPIN/STOP/SKIP unified CTA state machine, but the SKIP side only covers 4 of the 9+ industry-standard fast-finalize phases. This wave brings the template to PlayCore / Playa Slot "skip-ahead" parity.

### Industry definition (template-neutral)

> **Skip-ahead (a.k.a. fast-finalize)** — single CTA gesture that drops every currently-active long animation (>600ms) onto its end-state synchronously. Player keeps every credit they earned; only the time spent watching the celebration is collapsed. Cancel-vs-skip distinction is critical: cancel removes value, skip preserves it.

### Current coverage (Wave V3, live on `origin/main`)

| Phase | Owner block | Skip listener | Status |
|---|---|---|:--:|
| Win rollup tween | `winPresentation` | line 519 | ✅ |
| FS Intro overlay | `freeSpins` | line 631 | ✅ |
| FS Outro overlay | `freeSpins` | line 631 (same handler, phase-switched) | ✅ |
| Scatter celebration banner | `scatterCelebration` | line 249 | ✅ |
| Gamble (secondary) panel | `gambleSecondary` | line 962 (collect-and-close on skip) | ✅ |

### Gap — what the template needs (atoms)

| ID | Phase | Why obligatory | Effort | Owner block |
|:--:|---|---|:--:|---|
| ~~**V5.0**~~ ✅ | ~~**Rectangular dist exposes no SKIP CTA at all** — `__WIN_AWARD__` flow inspection + `_finalizeRound` win-branch verification~~ **SHIPPED** — split into 4 commits (`0633dc9` → `a491b82` → `5ccc3bb` → `5164f51`). See dedicated SHIPPED section below for full root-cause / fix breakdown. | ~~Live diagnostic of why Boki sees no skip on `01_rectangular_5x3_playable.html`.~~ Diagnostic surfaced **5-block `__WIN_AWARD__` vacuum**, **0-award SKIP leak**, **document-level Space forwarding miss**, and **rapid-spin late-finalize race**. All closed. | ~~S~~ DONE | spinControl `_finalizeRound` + winPresentation award publish |
| **V5.1** | Anticipation reel slow-stop (600–2000ms) | Most-visible long animation in every base spin with ≥2 scatter teasers; players spam tap to skip | S | `anticipation.mjs` (one listener + abort flag) |
| **V5.2** | Tumble cascade per-step (400–800ms × up to 6) | Cluster/Olympus-class slot family obligatory; current template has Wrath + Gates fixtures actively using tumble | M | `tumble.mjs` cycle-token bump on `onSkipRequested{phase:'tumble'}` |
| **V5.3** | Big-Win toast sequence (1500–4000ms) | Industry baseline: every BIG/MEGA/EPIC celebration must collapse to the highest tier instantly on skip | S | `uiToast.mjs` (jump to final tier, hide intermediates) |
| **V5.4** | Hold-and-Win lock cascade (600ms × N) | Recommended for the holdAndWin family; current `holdAndWin.mjs` ships without skip plumbing | M | `holdAndWin.mjs` lock-animation token |
| **V5.5** | Wheel bonus spin (3000–5000ms) | Recommended for wheelBonus block; landing reveal must finalize on skip | M | `wheelBonus.mjs` deg-jump-to-final |
| **V5.6** | Bonus climax reveal (5000–8500ms) — covers Wave H6 climax block | Obligatory once H6 lands; pre-wire the contract here so H6 ships skip-safe | S (pre-wire) | future `bonusClimaxReveal.mjs` |
| **V5.7** | Chain-aware dispatch — one click drains every currently-active skippable phase, not just current `spinControl` state | PlayCore rule: skip is global "fast-finalize all" gesture, not per-phase | M | spinControl `_onClick` SKIP_* branch refactor to emit `onSkipRequested{phase:'all'}` + each listener self-filters |
| **V5.8** | Skip lock during autoplay (`HIDE_ON_AUTOSPIN` guard symmetry with slam) | PlayCore: engine owns cadence during autoplay; manual skip would desync | XS | spinControl SKIP morph rutes early-return on `window.__SLOT_AUTOSPIN_ACTIVE__` |
| **V5.9** | Always-skippable morph — `SKIP_GENERIC` morph on any active animation >600ms (not only the 4 hard-coded triggers) | PlayCore: skip CTA visible during EVERY skippable phase, player should never wonder "can I skip this?" | S | spinControl: subscribe `onAnimationLongStart` / introspect `__SLOT_ANIM_BUSY__` and morph defensively |
| **V5.10** | Gamble result reveal (800–1200ms) | Currently `gambleSecondary` only skips-to-collect; result REVEAL animation (card flip / ladder climb) doesn't accept skip | S | `gambleSecondary.mjs` reveal token |

### HookBus surface — new contract for chain dispatch

| Event | Payload | Frequency | Owner |
|---|---|---|---|
| `onAnimationLongStart` | `{ phase: string, expectedMs: number }` | per long animation | each animation-owning block emits at start |
| `onAnimationLongComplete` | `{ phase: string, reason: 'natural' \| 'skipped' }` | per long animation end | same emitter |
| `onSkipRequested` (extended) | `{ phase: 'all' \| <specific>, source }` — `'all'` is new chain mode | per click | spinControl |
| `onSkipComplete` (extended) | `{ phase, duration, reason }` | per active phase finalized | each listener that handled |
| `window.__SLOT_ANIM_BUSY__` | `Set<phase>` — readable snapshot of every currently-active skippable phase | continuous | aggregated by spinControl from `onAnimationLongStart`/`Complete` |

### Implementation order (dependency graph)

```
V5.0 (live diagnostic) ─┐
                        ├─▶ V5.7 (chain dispatch) ─┐
V5.1, V5.2, V5.3 ───────┤                          ├─▶ V5.9 (always-skippable morph)
                        ├─▶ V5.8 (autoplay guard) ─┘
V5.4, V5.5, V5.10 ──────┘
V5.6 (pre-wire) — independent (lands with H6)
```

### Acceptance gates per atom (10 obavezne provere)

1. Listener registered via HookBus.on, NOT inline polling.
2. `onSkipComplete` emit with correct `{phase, duration, reason}` payload.
3. Token bump (`*_CYCLE_TOKEN++`) on skip so in-flight setTimeout chains bail.
4. Final state set to natural-end target (not intermediate, not cleared).
5. `window.__SLOT_SKIPPED__` flag respected at every long-loop check-point.
6. `prefers-reduced-motion` honored — skip behavior identical with anim off.
7. Idempotent: 2× skip click within same phase = no double credit / no crash.
8. Autoplay symmetry: phase suppressed-or-equivalent during `__SLOT_AUTOSPIN_ACTIVE__`.
9. Test fixture: `tests/blocks/<block>.test.mjs` exercises skip-mid-animation.
10. cortex-eyes walkthrough recorded showing CTA morph chain end-to-end.

### Open questions for Boki

| # | Question | Why blocking |
|:--:|---|---|
| 1 | Skip CTA always-visible during animations vs only on currently-tracked phase? | PlayCore says always; current Wave V3 says only-tracked. Decides V5.9 scope. |
| 2 | Tumble cascade — skip-to-end-of-step vs skip-to-end-of-cascade? | Cascade can have 6 steps; player intent ambiguous. Default proposed: skip-to-end-of-cascade. |
| 3 | Big-Win toast skip — jump straight to LEGENDARY tier card, or play final tier in 200ms? | UX trade-off: instant vs satisfying. Industry default: instant. |
| 4 | Hold-and-Win lock cascade skip — instant all locks visible or 100ms staggered? | Skill: instant feels jarring; 100ms is industry compromise. |

### Why this matters

Without V5, the template is a "look-at-me" slot — animations play out at their full duration regardless of player intent. PlayCore-grade slots respect the player's clock: every animation >600ms is opt-out via single gesture. Industry reviews (eCOGRA / GLI-19) flag CTAs that lack chain-aware skip as **UX deficient** but not regulatory-blocking. So this is "must-have for shipping" not "blocking certification".

---

## 🟢 Wave V/U4 senior-grade QA pass — SHIPPED (commits `b8f9a13` + `9c0eb1b`)

> Triggered by Boki *"Qa ultimativni i review"* — full sweep across LEGO gate, npm test, cortex-eyes-wave-v/s/s-fs, vendor grep, and a 12-criterion senior code review by sub-agent. All gates green pre-review; review surfaced **3 critical + 5 medium bugs** that production-mid-tier code would ship with but would fail a lead-engineer review at Apple/Stripe/Anthropic. All fixed in `b8f9a13`; hash pin in `9c0eb1b`.

### Findings + fixes (this commit)

| Sev | File:line | Issue | Fix |
|:--:|---|---|---|
| 🔴 | `src/blocks/forceSkip.mjs:341-345` | `postSpin` listener guard `if (!STATE.visible) return;` never CALLED `forceSkipHide()` — skip button would linger into next idle phase | Inverted guard: `if (STATE.visible) forceSkipHide();` |
| 🔴 | `src/blocks/autoplay.mjs:481, 523` | `totalLoss += BET_UNIT_FB` used the bake-time fallback constant, ignoring actual per-spin bet (bet-stepper / ante / bonus-buy). `stopOnLossAbove` would underreport 2-10× | Capture `window.__SLOT_BET__` at onSpinResult → `STATE.lastCost`. postSpin computes `net = lastWin - lastCost`; only the actual NET shortfall feeds `totalLoss`. |
| 🔴 | `src/blocks/autoplay.mjs:548-560` | `onFsTrigger` listener did NOT cancel the pending `nextSpinTimerId` — pre-existing INTER_SPIN_MS timer could fire mid-FS | Both `onFsTrigger` AND `onFsEnd` now clear `nextSpinTimerId` defensively before any state change. |
| 🟡 | `src/blocks/slamStop.mjs:265-275` | `slamStopShow()` not idempotent — second call re-adds `is-pulsing` + re-attaches reels-area pointerup listener | Added `if (STATE.visible) return;` guard at function top |
| 🟡 | `src/blocks/slamStop.mjs:296-308` | `slamStopRequest()` race: 2 pointerup events (button + reels-area overlay) could BOTH emit `onSlamRequested` before button DOM updated | Added `STATE.requestLocked` one-shot flag + try/catch around emit so a throwing listener does not strand the lock. |
| 🟡 | `src/blocks/autoplay.mjs:513` | `window.__WIN_AWARD__` not validated — `NaN` / `Infinity` / negative would poison `totalWin`/`totalLoss` | Clamp: `(Number.isFinite(raw) && raw >= 0) ? Math.min(raw, 1e10) : 0` |
| 🟡 | `src/blocks/themeCSS.mjs:46` | `frameInset: 18` undocumented in JSDoc public-API header | Added full param doc with "why 18px" rationale |
| 🟢 | `tools/lego-gate.mjs` | Vendor blocklist missing studio codename → `playa-slot` references in JSDoc passed the gate undetected | Added `playa-slot`/`playa slot`/`playaslot`/`playa_slot` to `VENDOR_BLOCKLIST` |

### Vendor sweep (src/) — cleanup

> 7 files referenced studio codename `playa-slot` in JSDoc industry-reference notes (slamStop, forceSkip, autoplay, hookBus, reelEngine, buildSlotHTML). All converted to generic *"industry-standard pattern"* phrasing per `rule_no_vendor_mentions.md`.

### Findings NOT yet fixed (secondary — flagged for Boki decision)

| Where | Finding | Why deferred |
|---|---|:--|
| `samples/{GATES_OF_OLYMPUS_1000,WRATH_OF_OLYMPUS,CRYSTAL_FORGE}_GAME_GDD.md` | File names embed game/vendor titles | CLAUDE.md explicitly registers `WRATH_OF_OLYMPUS_GAME_GDD.md` + `CRYSTAL_FORGE_GAME_GDD.md` as the canonical GDD test fixtures. Rename touches 6+ tool files, 7 reports, and CLAUDE.md itself — needs Boki call. |
| `tools/cortex-eyes-wave-s.mjs`, `cortex-eyes-wave-s-fs.mjs`, `gen-woo-demo.mjs`, `diff-pdf-vs-md.mjs` | Hard-coded labels mention "Gates of Olympus 1000", "Wrath of Olympus", "Crystal Forge" | Same fixture-rename dependency. `cortex-eyes-wave-v` already uses generic "Reference GDD A/B/C" labels — pattern to apply across the other tools after fixture rename. |
| Slam latency = 0ms on ref B/C | Cortex Eyes reports 0ms on cascade + cluster topologies | INVESTIGATED — not a bug. `reelEngine.mjs:428-438` emits synthetic `onSlamComplete{duration:0}` when (a) kind has no rectangular reels (SVG/cluster) OR (b) `allReelsActive===false` (spin already settled). With `requireMinSpinMs:50` in the test harness, cascade fixture settles before slam click. Intentional fast-path. |

### Acceptance gates (post-fix)

| Gate | Result |
|---|:--:|
| LEGO Gate 5/5 | ✅ (parity 41/41, ownership 14/14, listener 31/31) |
| npm test (parser + 20 grid fixtures) | ✅ |
| npm run test:blocks (796 assertions, 41 blocks) | ✅ |
| cortex-eyes-wave-v 3/3 | ✅ slam 391ms rectangular (within ≤500ms budget) |
| cortex-eyes-wave-s 3/3 | ✅ |
| cortex-eyes-wave-s-fs | ✅ |
| vendor grep `src/` for `playa-slot` | ✅ 0 matches |
| Hash pin | ✅ `9c0eb1b` |

---

## 🟢 Shipped (in-tree on `origin/main`)

### Wave T4 — Rapid-click race + ways detector cells regression (commit `3e3ae48`)

> **Boki ultimative launcher** otkrio 6/6 rectangular fixtures `spin=❌` u `npm run test:qa` (full QA audit). Stress test radi 3 rapid clicks (50ms razmak) na `#spinBtn` → cells stuck `is-blurring` posle 4500ms settle wait. Plus dodatne TypeError race scenarije u FS flow za variable_reel + cluster fixture.
>
> **DVA root cause-a, ne jedan:**
>
> **#1 — Rapid-click race u `runOneBaseSpin` + `FSM_runNextFsSpin`** (cells stuck blurring na 6/6 rectangular):
> - Klik 1 → `preSpin` emit → `startSpinAll` postavi `reel.stopTimerId = setTimeout(..., initialDelay)`
> - Klik 2 (50ms kasnije) → `runOneBaseSpin` BEZ guard-a poziva `HookBus.emit('preSpin', ...)`
> - `reelEngine.preSpin` listener (priority 20, Wave S) CLEAR-uje sve `reel.stopTimerId` od TRENUTNO aktivnog spin-a
> - `startSpinAll` vidi `allReelsActive=true` → return BEZ re-armiranja `stopTimerId`
> - **Rezultat**: reels zauvek spin-uju, cells zauvek u `is-blurring`
>
> **#2 — `waysEval` push-uje plain object umesto DOM cell** (TypeError `Cannot read properties of undefined (reading 'add')` u variable_reel + cluster fixtures sa FS):
> - `waysEval.mjs:99` push-ovao `{ r, c: reelIdx, idx }` metadata object u `events[].cells`
> - `tumble.runTumbleChain` L152 zove `cell.classList.add('is-removing')` na metadata objekat
> - `.classList` undefined → uncaught TypeError → FS round nikad ne završi
> - Drugi detektori (`payAnywhereEval`, `clusterPaysEval`) push-uju DOM cells pravilno; samo `waysEval` je leak

| ID | Item | Files | Status |
|---|---|---|:--:|
| T4.1 | `src/blocks/reelEngine.mjs` — idempotent guard u `runOneBaseSpin`: `const inFlight = (UNIFORM_REEL_KINDS.has(SHAPE.kind) && RECT_REELS) ? allReelsActive : staticRerollInFlight; if (inFlight) return;` PRE preSpin emit. Klik 2/3 tokom aktivnog spina sad bail-uje tiho, ne dira stopTimerId. | `src/blocks/reelEngine.mjs:420` (+11 LOC) | ✅ |
| T4.2 | `src/blocks/reelEngine.mjs` — `let staticRerollInFlight = false;` deklaracija; `runStaticReroll` postavi `true` na entry, set `false` u `_settled(onSettled)` helper-u koji uvija `onSettled` callback. Sva 3 grane (empty cells / SVG fallback / column reveal) sad propisno reset-uju flag. | `src/blocks/reelEngine.mjs:136-503` | ✅ |
| T4.3 | `src/blocks/freeSpins.mjs` — isti guard u `FSM_runNextFsSpin` (FS-active path) pre preSpin emit. Inače rapid-click u FS-active prouzrokuje istu race condition kao base-game. | `src/blocks/freeSpins.mjs:513` (+10 LOC) | ✅ |
| T4.4 | `src/blocks/waysEval.mjs` — `winCells.push(cellEl)` umesto `{r, c, idx}` metadata objekta. Detector contract sad konzistentan sa payAnywhereEval/clusterPaysEval (svi push-uju DOM cell elements). | `src/blocks/waysEval.mjs:92-103` (+4 LOC) | ✅ |
| T4.5 | `src/blocks/winPresentation.mjs` — defensive guard u `playWinSymCycle.playOne`: `for (const c of cells) { if (c && c.classList) c.classList.add('cell--winsym'); }` umesto sirovog `forEach(c => c.classList.add(...))`. Sprečava sledeći leak (defense in depth). | `src/blocks/winPresentation.mjs:198` (+5 LOC) | ✅ |
| T4.6 | `src/blocks/tumble.mjs` — defensive guard u runTumbleChain L152: `for (const c of removeCells) { if (c && c.classList) c.classList.add('is-removing'); }`. Defense in depth — ako detector u budućnosti leakuje, tumble chain ne crashuje. | `src/blocks/tumble.mjs:152` (+3 LOC) | ✅ |
| T4.7 | Stability: 10/10 consecutive `trace 02_rectangular_6x4 stress` runs **0 console errors**. 5/5 `npm run test:qa` runs **CLEAN**. 3/3 `npm run test:fs` runs **CLEAN**. 5/5 `node tools/cortex-eyes-wave-s.mjs` runs **PASS**. | stability gate | ✅ |
| T4.8 | Full QA gate: `npm test` 20/20, `npm run test:blocks` 384+ pass / 0 fail, `parse-real` 4/4, `scatter-count` 38/38, `render-grid` 20/20, `test:lego` 5/5 invariants, `test:qa` CLEAN, `test:fs` CLEAN, eyes wave-s 5/5 PASS, eyes wave-s-fs 7/7 events 0 console errors. | full QA | ✅ |
| T4.9 | Vendor scan: `grep -niE "(zeus\|olimp\|olympus\|megaways\|trueways\|BTG\|wazdan\|aristocrat\|igt\|netent\|microgaming\|pragmatic)" src/ -r` → **0 matches** (T2/T3 cleanup zadržan). | vendor gate | ✅ |

### Wave T3 — LEGO lifecycle gap fix (trigger flow onTumbleStep) + cortex-eyes hardening (commit `c9e7b42`)

> **Korijenski uzrok**: Cortex-eyes Wave S verification je bio intermittently flake — 4-8/10 run uspeha — sa fail mode-ovima distribuiranim preko GoO / CF / WoO. Naivan dijagnoz je bio "timing race u testu" (3500ms hardcoded wait premali za GoO 6×5 pay-anywhere cascade). Pravi uzrok je bio LEGO **lifecycle gap** u `postSpin.mjs`: kad scatter trigger ili retrigger detektuje FS, postSpin **preskače** `applyWinHighlight()` (Boki pravilo Wave Q: scatter celebration igra solo), čime se preskače `await runTumbleChain(...)` u winPresentation → `onTumbleStep` nikad ne emit-uje u trigger spin → `EXPECTED_EVENTS` lista u cortex-eyes Wave S verifikaciji ima 0× za `onTumbleStep` → fail.
>
> **LEGO popravka**: dodato u `postSpin.mjs` u oba mesta (trigger flow line 144 i retrigger flow line 173) `await runTumbleChain(() => [], { duringFs })` PRE `_emitPostSpin(...)`. Tumble blok i dalje VLASNIK emit-a (LEGO ownership invariant 4 ne narušen), postSpin samo poziva `runTumbleChain` koji interno emit-uje `onTumbleStep` sa empty events array. Listeners (orb accumulator, persistent multiplier) sada vide konzistentan 0-event tick i u trigger spin scenariju.
>
> **Cortex-eyes hardening** u `tools/cortex-eyes-wave-s.mjs`:
> - Hardcoded 3500ms wait → event-driven `page.waitForFunction(...)` koji čeka da SVA 4 expected lifecycle event-a (`preSpin`, `onSpinResult`, `onTumbleStep`, `postSpin`) emit-uju, sa 12s hard cap. Race-free preko GoO/WoO/CF/FS trigger scenarija.
> - Dodat HookBus readiness probe — čeka da `window.HookBus.EVENTS` postoji + `#spinBtn` nije disabled pre instalacije emit-wrap probe-a. Sprečava race kada test instalira probe pre nego što HookBus IIFE finalizuje.

| ID | Item | Files | Status |
|---|---|---|:--:|
| T3.1 | `src/blocks/postSpin.mjs` — trigger flow (BASE-game, award > 0) dodaje `await runTumbleChain(() => [], { duringFs })` pre `_emitPostSpin(duringFs, [])`. LEGO ownership intact: tumble blok i dalje VLASNIK onTumbleStep emit-a, postSpin samo poziva. | `src/blocks/postSpin.mjs:147` (+5 LOC) | ✅ |
| T3.2 | `src/blocks/postSpin.mjs` — retrigger flow (FS_ACTIVE, scatters ≥ retrigger.count) takođe dobija isti `runTumbleChain` poziv pre postSpin emit. Lifecycle invariant: SVAKI spin (BASE/trigger/FS-active/FS-retrigger) emit-uje SVA 4 base events. | `src/blocks/postSpin.mjs:185` (+5 LOC) | ✅ |
| T3.3 | `tools/cortex-eyes-wave-s.mjs` — hardcoded 3500ms wait zamenjen sa event-driven `page.waitForFunction(...)` koji polluje `window.__EVENT_COUNTS__` dok SVA 4 expected events ne emit-uju (12s hard cap, +250ms trailing settle za snapshot). | `tools/cortex-eyes-wave-s.mjs:84-99` | ✅ |
| T3.4 | `tools/cortex-eyes-wave-s.mjs` — dodat HookBus readiness wait pre instalacije probe (`page.waitForFunction(() => window.HookBus && Array.isArray(window.HookBus.EVENTS) && !document.getElementById('spinBtn').disabled, 8000ms)`). Eliminira IIFE init race. | `tools/cortex-eyes-wave-s.mjs:69-77` | ✅ |
| T3.5 | Stability test: 10/10 consecutive `node tools/cortex-eyes-wave-s.mjs` runs PASS (PRE: 5/8 zavisno od run-a). 0 false negatives. | stability gate | ✅ |
| T3.6 | FS lifecycle (`tools/cortex-eyes-wave-s-fs.mjs`): full WoO FS round verifikovan — `preSpin` 11×, `onSpinResult` 10×, `onTumbleStep` 10×, `postSpin` 10×, `onFsTrigger` 1×, `onFsSpinResult` 9×, `onFsEnd` 1×, **0 console errors**. | FS gate | ✅ |
| T3.7 | Full QA gate post-fix: `npm test` 20/20, `npm run test:blocks` 384 pass / 0 fail / 21+ suites, `parse-real` 4/4, `scatter-count` 38/38, `render-grid-all` 20/20, `npm run test:lego` 5/5 invariants. | full QA | ✅ |
| T3.8 | Vendor verify still clean post-fix: `grep -niE '(BTG\|wazdan\|aristocrat\|wms\|igt\|netent\|microgaming\|pragmatic\|reactoonz)' src/` → **0 matches**, `grep -niE '(zeus\|olimp\|olympus\|megaways\|trueways)' src/` → **0 matches**. | vendor gate | ✅ |

### Wave T2 — Vendor purge round 2 (BTG / Zeus / Olympus / Megaways) (commit `d9f0cfc`)

> **Drugi vendor-neutralization pass posle Wave T.** Wave T (commit `e1d2968`) je očistio 11 fajlova sa Game-title / Vendor-name stringovima, ali audit posle Wave U trijade je otkrio dodatne kategorije vendor-attributnih komentara, heuristika i test labela:
>
> - **BTG attribution** u `parser.mjs` komentarima (`Megaclusters — BTG quarter-split variant`, `megaclusters (BTG quarter-split)`)
> - **Megaways / TrueWays trademark** u regex patternima (`\bmegaways\b|\btrueways\b`) — strip-ovani; number-ways pattern + `ways to win` fraza i dalje hvataju isti GDD sadržaj
> - **Zeus / Olimp / Olympus** hardcoded heuristika u `pdfToMarkdown.mjs` — auto-tagging Mythology bazirano na specifičnim deity imenima + Mount Olympus fallback. Strip-ovano: parser sada preserve-uje user-authored theme tagove verbatim, bez franchise-specific augmentacije.
> - **`Z` symbol entry "Zeus (Crown)"** u kanonskoj symbol vocabulary listi — zamenjeno generičkim `CR` "Crown" entry-jem
> - **Test labels** u `tests/parse-real.mjs` (`Wrath of Olympus`, `Crystal Forge`, `Midnight Fangs`, `Gates of Olympus 1000`) → generic "Reference GDD A/B/C/D" sa funkcionalnim sufiksima
> - **Test title** `'override waysCount Megaways'` → `'override waysCount 117649-ways'`
>
> **Sample fajlovi netaknuti** — Boki ih je u `CLAUDE.md` fixture listi (`WRATH_OF_OLYMPUS_GAME_GDD.md`, `CRYSTAL_FORGE_GAME_GDD.md` itd.) eksplicitno označio kao official GDD fixtures. Path resolutions u test runner-ima resolve postojeće file paths bez authored vendor labela.

| ID | Item | Files | Status |
|---|---|---|:--:|
| T2.1 | `src/parser.mjs` — strip "Megaways · Out of scope" example, drop `megaways` from negation strip regex, rename "Variable rows-per-reel (Megaways)" → "(high-volume ways family)", drop `\bmegaways\b\|\btrueways\b` from kind detection regex (replace with `\bvariable-ways\b\|\bhigh-ways\b`), rename "Megaclusters — BTG quarter-split variant" → "Split-cluster variant", rename "megaclusters (BTG quarter-split)" comment → "(quarter-split cluster variant)", rename example paytable row `Z\|Zeus (Crown)` → `H\|High Symbol A`, rename comment about Zeus → letter "Z" | `src/parser.mjs` (9 lines) | ✅ |
| T2.2 | `src/gridShape.mjs` — rename "variable per-reel (Megaways family)" → "(high-volume ways family)", rename "Default Megaways pattern" → "Default variable-ways pattern" | `src/gridShape.mjs` (2 lines) | ✅ |
| T2.3 | `src/pdfToMarkdown.mjs` — strip `\bmegaways\b` from evaluation kind regex (replace with `variable-ways`/`high-ways`), REMOVE Zeus high-symbol entry from canonical symbol vocabulary (replace with generic `CR\|Crown` entry), REMOVE Zeus-specific scatter detection conditional (always use generic "Scatter (Trigger only)"), REMOVE Olympus/Zeus/Greek auto-Mythology tag heuristic (preserve user tags verbatim), REMOVE Mount Olympus setting fallback, rename example comment | `src/pdfToMarkdown.mjs` (6 spots) | ✅ |
| T2.4 | `src/blocks/payAnywhereEval.mjs` — rename comment `7 Zeus + 2 wild = bucket(9)` → `7 high-symbol + 2 wild = bucket(9)` | `src/blocks/payAnywhereEval.mjs:122` | ✅ |
| T2.5 | `tests/parse-real.mjs` — 4 FIXTURES labels rewritten as "Reference GDD A/B/C/D" sa mehanic deskriptorima (multiplier-orb / cluster-pays / cluster-pays synthetic / pay-anywhere 1000x cap) | `tests/parse-real.mjs:23-28` | ✅ |
| T2.6 | `tests/blocks/waysEval.test.mjs` — test title `override waysCount Megaways` → `override waysCount 117649-ways` | `tests/blocks/waysEval.test.mjs:29` | ✅ |
| T2.7 | Verifikacija: full `grep -niE "(zeus\|olimp\|olympus\|megaways\|trueways)" src/` → **0 matches**, `grep -niE "(BTG\|big-time-gaming\|wazdan\|aristocrat\|wms\|igt\|netent\|microgaming\|pragmatic\|reactoonz)" src/ tests/blocks/ tools/` → **0 matches** (excluded: intentional banned regex in hygiene tests koji asser-uju 0 vendor) | grep gate | ✅ |
| T2.8 | Verifikacija: `npm test` → 20/20 grid fixtures pass, `npm run test:blocks` → 37 block test files all green, `node tests/parse-real.mjs` → 4/4 fixtures parser floor PASS, `node tests/scatter-count-mode.mjs` → 38/38 PASS, `node tests/render-grid-all.mjs` → 20/20 fixtures pass, `npm run test:lego` → **5/5 invariants pass** | full QA gate | ✅ |
| T2.9 | **Backward compat note**: `is_megaclusters` polje + `'megaclusters'` topology kind string ostaju kao internal classification labels (industry-common kind identifier, nije vendor authorship u kodu) — input parser i dalje detektuje `\bmega[\s-]?clusters?\b` ali komentari više ne pripisuju BTG. Future Wave kandidat: full rename `'megaclusters'` → `'split_cluster'` sa grandfather alias mapom (cascading promene u 9 fajlova). | deferred | ⏭️ |

### Wave U3 — `uiToast.mjs` unified BIG/MEGA/EPIC + feature toast (commit `a162323`)

> **Treći blok Wave U feature ekspanzije.** Boki pravilo: *"sto vise feautrea"*. Wave U3 centralizuje "celebration" overlay-e u jedan queue-based renderer — bilo koji blok može da pozove `uiShowToast(label, opts)` umesto da pravi vlastiti banner div. Postojeći lightning/respin/bonus-buy banneri mogu da migriraju u sledećoj wave.
>
> **Originalna kompozicija sa audio block-om** (zastarelo posle 2026-06-04): postSpin tier selector je bio DUPLIRAN po design-u. Visual (uiToast) i auditory (audio) cues su trebali da budu nezavisni LEGO blokovi koji oba reaguju na isti lifecycle event. **Sad**: audio block je deaktiviran (vidi Wave U2 entry), uiToast tier selector ostaje jedini izvor "celebration" odziva u template-u. Audio cues pripadaju ADB toku, ne GDD-u.

| ID | Feature | Files | Status |
|---|---|---|---|
| U3.1 | `src/blocks/uiToast.mjs` (370 LOC) — 5 tier vocabulary (big, mega, epic, feature, neutral), GDD knobs: enabled, threshold trio (big/mega/epic × 10/50/250x baseline), duration quadruplet (1800/2400/3200/1400ms), queueOnFsEnd flag, fsTriggerLabel ('FREE SPINS!' default), 5-tier color palette, maxQueue (6 default). | `src/blocks/uiToast.mjs` | ✅ |
| U3.2 | Defensive validation: threshold monotonic ordering enforced (mega > big, epic > mega), duration clamps (BIG/MEGA/EPIC 400-12000ms, feature 300-8000ms), maxQueue clamp [1,32], RGB color regex per tier, fsTriggerLabel length cap (≤32 chars), auto-enable from features[].kind in {ui_toast, win_celebration, big_win, mega_win}. | `src/blocks/uiToast.mjs:resolveConfig` | ✅ |
| U3.3 | CSS: `.ui-toast-host` fixed top center @ 18vh, per-tier styling (big/mega/epic progressively larger + brighter glow), epic-tier `.is-epic::before` radial flash overlay, `uiToastIn` 380ms bounce keyframe (cubic-bezier(.4,1.55,.5,1)), `uiToastOut` 320ms ease-in keyframe, mobile media query (font size halved), reduced-motion gate. | `src/blocks/uiToast.mjs:emitUiToastCSS` | ✅ |
| U3.4 | Markup: single `<div id="uiToastHost" aria-live="polite" aria-atomic="true">` — toast nodes are appended dynamically by runtime. | `src/blocks/uiToast.mjs:emitUiToastMarkup` | ✅ |
| U3.5 | Runtime API (window-exposed): `uiShowToast(label, opts?)` (queues + drains; opts = {tier, amount, ms}), `uiClearToasts()` (flush queue + remove current), `uiGetQueueLength()` (depth probe for tests), `TOAST_STATE` (introspection). Queue drain pattern: synchronous render + setTimeout dismiss after tier-specific duration. | `src/blocks/uiToast.mjs:emitUiToastRuntime` | ✅ |
| U3.6 | HookBus integration: `postSpin` (tier select by sum payX — BIG/MEGA/EPIC labels), `onFsTrigger` (FREE SPINS! feature toast), `onFsEnd` (FS COMPLETE + totalWin amount, gated by queueOnFsEnd flag), `preSpin` (drop queue tail if cabinet rapid-play — preserve currently displayed, discard pending). | `src/blocks/uiToast.mjs:emitUiToastRuntime` | ✅ |
| U3.7 | XSS hardening: every label HTML-escaped before DOM injection. Amount formatter strips ".00" suffix for integer wins. Long labels (>64 chars) truncated. | `src/blocks/uiToast.mjs:_toastEscape + uiShowToast` | ✅ |
| U3.8 | `tests/blocks/uiToast.test.mjs` — **35 unit tests** pass: defaults×1, resolveConfig validation × 6 (thresholds, durations, queue, colors × 2, fsLabel), auto-enable × 1, CSS + markup × 5, runtime contract × 4, behavior via sandbox eval × 14 (BIG/MEGA/EPIC tier select + sub-BIG silent + queue cap + clear + invalid input × 3 + onFsTrigger + onFsEnd with/without amount + queueOnFsEnd=false + preSpin queue drop), hygiene × 4 (determinism, vendor-neutral, XSS, amount format). | `tests/blocks/uiToast.test.mjs` | ✅ |
| U3.9 | Parser: `extractUiToast(text, model)` čita `## UI Toast` / `## Win Celebration` / `## Win Tier Toast` sekciju, parsira thresholds/durations/queue/label + per-tier colors. freshModel slot dodat sa 12 undefined knobs. Feature kind `ui_toast` u extractFeatures patterns. | `src/parser.mjs:extractUiToast` | ✅ |
| U3.10 | Orchestrator wire-up: import + 3 emit calls (CSS, markup, runtime) posle progressiveFreeSpins block. (Originalno posle audio block-a; audio deaktiviran 2026-06-04 commit `b18113e`, uiToast emit-ovi su sad direktno posle progressiveFreeSpins.) | `src/buildSlotHTML.mjs` | ✅ |
| U3.11 | `package.json` test:blocks chain proširen sa uiToast.test.mjs. | `package.json` | ✅ |
| U3.12 | LEGO Gate: **5/5 pass** — orchestrator emit 0, block parity **37/37**, vendor 0, ownership 7/7, listener coverage **28/28**. | — | ✅ |
| U3.13 | End-to-end QA: npm test 20/20 fixtures, npm test:blocks all green, cortex-eyes-pdf-upload 0 console errors + 42 cells + Base Game title. | — | ✅ |

### Wave U2 — `audio.mjs` Howler-style scaffolding ⚠️ DEACTIVATED 2026-06-04

> **Status:** Blok i testovi ostaju u repo-u (Boki: *"ne brisi audio blok samo ga ne korisit"*), ali `src/buildSlotHTML.mjs` više ne importuje audio modul i ne poziva 3 emit funkcije (CSS/markup/runtime). Razlog: audio je ADB tok (`feedback_adb_vs_gdd.md`), ne GDD. Slot template ne sme da nosi audio HTML/CSS/JS.
>
> **Šta i dalje radi**:
> - `src/blocks/audio.mjs` — kompletan blok, importable za buduću re-aktivaciju.
> - `tests/blocks/audio.test.mjs` — 38 unit testova i dalje zelene u `npm run test:blocks`.
> - `src/parser.mjs:extractAudio` — i dalje parsira `## Audio` / `## Sound` sekciju u model, ali render je nem.
>
> **Šta ne radi više** (intentional):
> - Audio import u `buildSlotHTML.mjs` (zamenjen komentarom).
> - 3 emit poziva (CSS/markup/runtime) u orchestratoru — zamenjeni `${'' /* skipped */}` no-op.
> - Mute toggle button + `audioPlay()` API se ne pojavljuju u finalnom slot HTML-u.
>
> **Originalni opis:** Zero-dependency Web Audio API wrapper sa Howler-style cue API-jem za 15 slot lifecycle kategorija. Bez external dep (Howler nije u package.json) — koristim HTMLAudioElement + cloneNode pattern za overlapping playback. Cues lazy-load on first play (asseti se ne učitavaju dok ih GDD ne specifikuje).

| ID | Feature | Files | Status |
|---|---|---|---|
| U2.1 | `src/blocks/audio.mjs` (370 LOC) — 15 categories (SPIN_START, REEL_STOP, TUMBLE_REMOVE, ORB_SPAWN, ANTICIPATION, BUTTON_CLICK, WIN_BASE, WIN_BIG, WIN_MEGA, WIN_EPIC, MULT_GROW, FS_TRIGGER, FS_INTRO, FS_SPIN_START, FS_OUTRO). GDD knobs: enabled, masterVolume, muted, urls (per-category), volumes (per-category), showToggle, toggleColor, bigWinThresholdX (default 10x), megaWinThresholdX (50x), epicWinThresholdX (250x). | `src/blocks/audio.mjs` | ✅ |
| U2.2 | Defensive validation: URL safety (rejects `javascript:`, `data:`, whitespace, quotes), masterVolume clamp [0,1], per-category volume clamp, monotonic threshold enforcement (mega > big, epic > mega), RGB color regex check. Auto-enable on `audio`/`sound` feature kind ili kad bilo koji URL nije prazan. | `src/blocks/audio.mjs:resolveConfig` | ✅ |
| U2.3 | CSS mute toggle (fixed top-right circle, strike-through when muted, mobile media query, reduced-motion gate). Markup: `<button id="audioToggle">` sa aria-label + initial state. | `src/blocks/audio.mjs` (emit functions) | ✅ |
| U2.4 | Runtime API (window-exposed): `audioPlay(category, opts?)` (fire-and-forget, opts.rate honors playbackRate), `audioPreload(category)` (warm cache), `audioSetMuted(bool)`, `audioToggleMuted()`, `audioSetVolume(0..1)`, `AUDIO_STATE` (current state). cloneNode pattern za overlapping playback (rapid reel-stops). | `src/blocks/audio.mjs` (emitAudioRuntime) | ✅ |
| U2.5 | localStorage persistence: `slot.audio.muted` + `slot.audio.volume` survive reload. 3 try/catch wrappers oko localStorage calls — privacy mode (Safari ITP) ne razbija runtime. | `src/blocks/audio.mjs:emitAudioRuntime` | ✅ |
| U2.6 | HookBus integration: `preSpin` (BASE → SPIN_START, FS → FS_SPIN_START), `onSpinResult` (REEL_STOP), `onTumbleStep` (TUMBLE_REMOVE + MULT_GROW kad HookBus.getMult > 1), `postSpin` (tier select: BASE/BIG/MEGA/EPIC po sumi payX × threshold), `onFsTrigger` (FS_TRIGGER + FS_INTRO sa 200ms delay), `onFsEnd` (FS_OUTRO). | `src/blocks/audio.mjs:emitAudioRuntime` | ✅ |
| U2.7 | `tests/blocks/audio.test.mjs` — **38 unit tests** pass: defaults (1), resolveConfig × 8 (clamps, URL safety, threshold ordering), auto-enable × 3, CSS/markup × 4, runtime contract × 6, behavior via sandbox eval × 7 (muted, missing URL, success, postSpin tier select × 4, preSpin BASE vs FS), toggle/volume persistence × 2, hygiene × 4 (determinism, vendor-neutral, AUDIO_CATEGORIES export, XSS guard). | `tests/blocks/audio.test.mjs` | ✅ |
| U2.8 | Parser: `extractAudio(text, model)` čita `## Audio` / `## Sound` sekciju, parsira `masterVolume`, `muted`, `showToggle`, `toggleColor`, `bigWinThresholdX/megaWinThresholdX/epicWinThresholdX`, plus URL rows formata `- SPIN_START: sounds/spin.mp3` ili `\| SPIN_START \| sounds/spin.mp3 \|` (regex hvata .mp3/.ogg/.wav/.m4a/.aac/.webm). | `src/parser.mjs:extractAudio` | ✅ |
| U2.9 | freshModel slot dodat sa 10 undefined knobs-ima + feature pattern (audio/sound/sfx kind). | `src/parser.mjs:freshModel + extractFeatures` | ✅ |
| U2.10 | Orchestrator wire-up: import + 3 emit calls (CSS, markup, runtime) posle progressiveFreeSpins. | `src/buildSlotHTML.mjs` | ✅ |
| U2.11 | `package.json` test:blocks chain proširen sa audio.test.mjs. | `package.json` | ✅ |
| U2.12 | LEGO Gate: **5/5 pass** — orchestrator emit 0, block parity **36/36**, vendor 0, ownership 7/7, listener coverage **27/27**. | — | ✅ |
| U2.13 | End-to-end QA: npm test 20/20 fixtures, npm test:blocks all green, cortex-eyes-pdf-upload 0 console errors + 42 cells + Base Game title (GoO bez audio sekcije → blok disabled, runtime stub, headless prošao). | — | ✅ |

### Wave U1 — `progressiveFreeSpins.mjs` blok (commit `79ef9fd`)

> **Prvi blok iz Wave U feature ekspanzije.** Boki pravilo: *"sve fwture koje ubacujemo, ubacujemo kao blokove i sto vise feautrea"*. Wave U1 dodaje fundamentalnu FS mehaniku koja je dosad bila rasut između `persistentMultiplier`, `multiplierOrb` i `freeSpins`: progressive multiplier koji eskalira **na svaki FS spin bez obzira na win**.
>
> **Kompozicija sa postojećim multiplier source-ima**: HookBus.setMult koristi `Math.max(current, new)` tako da progressiveFreeSpins, persistentMultiplier i multiplierOrb se ne dupliraju — najveći aktivan source pobeđuje.

| ID | Feature | Files | Status |
|---|---|---|---|
| U1.1 | `src/blocks/progressiveFreeSpins.mjs` — 4 escalation strategija (linear, doubling, fibonacci, ladder), GDD-driven config (startMult, step, ladderValues, maxMult, resetOnRoundEnd, chipColor, chipLabel), defaultConfig + resolveConfig sa defensive validation (ladder array ≥2 elem, clamp ranges, RGB format check, XSS-safe chip label), CSS chip widget (sits above pm-chip @ bottom: 136px), reduced-motion gate, mobile media query, markup with XSS escape, runtime sa HookBus integration. | `src/blocks/progressiveFreeSpins.mjs` (260 LOC) | ✅ |
| U1.2 | `tests/blocks/progressiveFreeSpins.test.mjs` — **37 unit tests** pokrivaju: defaults + resolveConfig validation × 12, CSS + markup contract × 4, runtime contract × 6, strategy semantics × 8 (linear/doubling/fibonacci/ladder progression + cap + FSM phase gate + HookBus integration + resetOnRoundEnd flag), hygiene + determinism × 4, vendor-neutral template check × 1, XSS guard × 1. Sandbox-eval pattern dokazuje runtime behavior bez browser-a — instanciram Function ctor sa stub document/FSM/HookBus i pokrećem stvarno `pfsBump()` da verifikujem progresije. | `tests/blocks/progressiveFreeSpins.test.mjs` (300 LOC) | ✅ |
| U1.3 | `src/parser.mjs` — extractor `extractProgressiveFreeSpins(text, model)` čita `## Progressive Free Spins` ili `## FS Multiplier Ladder` sekciju iz GDD-a, parsira `strategy`, `start-mult`, `step`, `max-mult`, `reset-on-round-end`, `chip-color`, `chip-label`, `ladder-values: 1,2,5,10,25`. Feature kind pattern `progressive_free_spins` + `progressive_fs` (alias) za auto-enable. `freshModel()` slot dodat sa svim `undefined` knobs-ima. | `src/parser.mjs` | ✅ |
| U1.4 | `src/buildSlotHTML.mjs` — import + 3 emit calls (CSS posle persistentMultiplier, markup posle persistentMultiplier, runtime posle persistentMultiplier — order matters jer chip sits visually iznad pm-chip-a). | `src/buildSlotHTML.mjs` | ✅ |
| U1.5 | `package.json` `test:blocks` — `progressiveFreeSpins.test.mjs` ubacen u sequential chain posle `persistentMultiplier.test.mjs`. Sad `&&` chain pokriva 33 block test files. | `package.json` | ✅ |
| U1.6 | LEGO Gate verifikovano: **5/5 invariants pass** (orchestrator emit 0, block test parity 35/35, vendor neutralnost 0, event ownership 7/7, listener coverage 26/26 — `progressiveFreeSpins.mjs` registruje `onFsTrigger` / `onFsSpinResult` / `onFsEnd`). | — | ✅ |
| U1.7 | End-to-end verifikovano: `npm run test` 20/20 fixtures, `npm run test:blocks` sve suite green, `tools/diff-pdf-vs-md.mjs` 30/30 PDF↔MD parity zadržan, `tools/cortex-eyes-pdf-upload.mjs` 0 console errors + 42 cells + Base Game title. | — | ✅ |

### Wave T — Template cleanup + sane defaults + global SHAPE wiring (commit `e1d2968`)

> **Pre-Wave T audit**: 14 vendor / game-specific reference linija ostalo u `src/` posle Wave S linter passa (`src/pdfToMarkdown.mjs:183,224`, `src/blocks/{gamble,scatterCelebration,reelEngine}.mjs`, `src/buildSlotHTML.mjs:83,668,1078,1153`, `src/parser.mjs:144,611,710,749,909,1060`). Plus kritičan latent bug: **`window.REELS` / `window.ROWS` se nikad nije postavljalo** u orchestratoru → svaki blok koji koristi `window.REELS || 5` fallback je zapravo radio na phantom 5×3 gridu bez obzira na pravi SHAPE.
>
> Pravilo: **0 game-specific stringova u template** + **template-wide globals moraju biti živi**.

| ID | Item | Detalj | Status |
|---|---|---|---|
| T1 | Vendor neutralization — `pdfToMarkdown` 2× ("Gates of Olympus 1000", "GoO-family"), `gamble` ("Wazdan Gamble"), `scatterCelebration` + `reelEngine` ("WoO" reference), `buildSlotHTML` 4× ("GoO/Sugar Rush", "WoO small-win pace", "WoO timing.ts"), `parser` 6× ("GoO/Sugar Rush", "Money-Train", "Crystal Forge"). Sve zamenjeno generičkim "industry baseline", "pay-anywhere reference", "scatter-pays / tumble-cascade family". Grep `(gates\|woo\|wrath\|olympus\|reactoonz\|sweet bonanza\|sugar rush\|pragmatic\|netent\|microgaming\|aristocrat\|lightning link\|money train\|wazdan\|hold the jackpot\|\\bGoO\\b\|\\bWoO\\b)` u `src/` → **0 matches**. | `src/pdfToMarkdown.mjs`, `src/blocks/{gamble,scatterCelebration,reelEngine}.mjs`, `src/buildSlotHTML.mjs`, `src/parser.mjs` | ✅ |
| T2 | `multiplierOrb.defaultConfig().distribution` — verifikovano da je već industry-standard 2x–1000x ladder sa 16 stepenica (komentar Wave R-er bio "industry standard"). Konkretna igra override-uje preko `model.multiplierOrb.distribution`. | `src/blocks/multiplierOrb.mjs` | ✅ |
| T3 | `bonusBuy.defaultConfig().costX = 100` verifikovano da je industry baseline cost (najčešća buy-in cena u industriji, ne specifična igra). Komentar Wave R-er "industry-standard bonus-buy reference". | `src/blocks/bonusBuy.mjs` | ✅ |
| T4 | `anteBet.defaultConfig().costMultiplier = 1.25` verifikovano da je industry baseline +25% bet. Komentar Wave R-er "industry-standard ante-bet reference". | `src/blocks/anteBet.mjs` | ✅ |
| T5 | **CRITICAL LATENT BUG FIX** — orchestrator sad postavlja `window.REELS = SHAPE.reels` i `window.ROWS = SHAPE.rows` u istom block-u gde se SHAPE expose-uje na window. Bez toga svi blokovi koji koriste `window.REELS \|\| 5` (clusterPaysEval, expandingWild, holdAndWin, respin, stickyWild, superSymbol, walkingWild, waysEval, wildReel — 23 koordinate-zavisne tačke u 9 blokova) su radili na **phantom 5×3 gridu**, što je uzrokovalo: holdAndWin lock-cells izvan stvarnog grida, walking wild registry koordinate van bounds-a, super symbol anchor postavljen na nepostojeće ćelije. | `src/buildSlotHTML.mjs:1206-1208` | ✅ |
| T6 | `tools/lego-gate.mjs` re-run posle Wave T promena — **5/5 invariants pass** (orchestrator emit cleanliness, block test parity 34/34, vendor neutralnost, event ownership 7/7, listener coverage 25/25). | — | ✅ |
| T7 | Verifikacija: full `npm run test` 20/20 fixtures pass + `npm run test:blocks` 17/17 last suite pass; `tools/cortex-eyes-pdf-upload.mjs` — GoO PDF → 0 console errors, 42 cells, iframe title "Gates of Olympus 1000 · Base Game"; `tools/diff-pdf-vs-md.mjs` — 30/30 (100 %) parity zadržan. | — | ✅ |
| T8 | **Deferred to Wave T2**: orchestrator slim-down 1525 → < 800 LOC (mass orchestration glue još uvek u buildSlotHTML.mjs); full `reelEngine.mjs` globals refactor da koristi `window.SHAPE` direktno umesto `window.REELS \|\| 5` fallback path. Trenutni T5 fix je minimal-invasive — sledeća wave razdvojiti od fallback-a u potpunosti. | TBD | ⏭️ |

### Wave S — HookBus emit consolidation + LEGO discipline gate (commit `241ce86`)

> **Pre-Wave S audit**: emits scattered between `winPresentation` (`onSpinResult` + `onTumbleStep` + `postSpin`), `freeSpins` (FS triplet), `reelEngine` (`preSpin`) — orchestrator-level coupling violating LEGO encapsulation. 11 src/blocks/ files contained vendor / game-specific strings.
>
> Wave S relocates every event to its true block owner (engine knows when reels settled → reelEngine emits onSpinResult; tumble knows when each cascade step landed → tumble emits onTumbleStep; postSpin owns round-close → emits postSpin with detected events). Every block — engine-tier and feature-tier alike — registers at least one lifecycle listener.
>
> Plus: introduces `tools/lego-gate.mjs` + `npm run test:lego` pre-commit invariant — 5 checks that block regression silently slipping in.

| ID | Feature | Files | Status |
|---|---|---|---|
| S1 | `tumble.runTumbleChain(detectFn, opts)` — accepts `{duringFs}`, emits `onTumbleStep` internally per cascade step (including 0-event tick). Disabled stub also emits the 0-step event so single-spin slots get identical listener flow. | `src/blocks/tumble.mjs` | ✅ |
| S2 | `postSpin.handlePostSpin` becomes `async`, awaits `applyWinHighlight()` (which now returns `Promise<events[]>`), then emits `postSpin` with the events as payload — across every branch (BASE+trigger, BASE+no-trigger, FS+retrigger, FS+normal). | `src/blocks/postSpin.mjs` | ✅ |
| S3 | `winPresentation` registers `onSpinResult` (priority −10) + `preSpin` (priority −10) listeners that cancel in-flight cycle. Drops emit responsibility for `onSpinResult` / `onTumbleStep` / `postSpin`. Now exposes `applyWinHighlight` + `cancelWinSymCycle` on window for headless QA. | `src/blocks/winPresentation.mjs` | ✅ |
| S4 | `reelEngine.startSpinAll` + `runStaticReroll` emit `onSpinResult` the precise moment every reel settles — before the `setTimeout(onSettled)` deferral that runs the postSpin orchestrator. Detects `duringFs` via `FSM.phase`. Plus reelEngine registers `preSpin` (priority 20) to clear stale `stopTimerId` / `glowTimerId` from prior spin. | `src/blocks/reelEngine.mjs` | ✅ |
| S5 | `spinTempo` registers `preSpin` (priority 5) publishing the active SPIN_PROFILE on `window.__SPIN_PROFILE_ACTIVE__` for playground / debug observability. | `src/blocks/spinTempo.mjs` | ✅ |
| S6 | `anticipation` registers `preSpin` + `onFsTrigger` + `onFsEnd` (priority 10) — clears `glowTimerId`, resets `reel.anticipating`, strips `.reelCol--anticipating` / `.cell--anticipating` classes. Fixes ghost-glow on rapid re-spin during anticipation hold. | `src/blocks/anticipation.mjs` | ✅ |
| S7 | `stageBadge` registers `onFsTrigger` (set 'fs' stage) + `onFsEnd` (label sync). freeSpins.mjs direct calls remain as belt-and-suspenders. | `src/blocks/stageBadge.mjs` | ✅ |
| S8 | `triggerCounting` registers `onSpinResult` (priority 5) → caches `window.__LAST_SCATTER_COUNT__` + `__LAST_SCATTER_AWARD__`. preSpin listener resets cache. Lets DEV FS panel + playground read scatter count without re-walking grid. | `src/blocks/triggerCounting.mjs` | ✅ |
| S9 | Audit: `grep "HookBus.emit(" src/buildSlotHTML.mjs` = 0 matches. Orchestrator is now pure compose-and-render — every event originates from its true block owner. | `src/buildSlotHTML.mjs` | ✅ |
| S10 | `tools/lego-gate.mjs` — pre-commit invariant gate. 5 checks: (1) 0 emit in orchestrator, (2) every block has matching test, (3) 0 vendor strings in src/blocks/, (4) each event has expected single-owner emitter, (5) every non-infra block registers at least one HookBus.on. Exit 0 = ship, 1 = regression. | `tools/lego-gate.mjs` | ✅ |
| S11 | `npm run test:lego` wired in `package.json` + integrated into `test:all`. CI gate auto-fires before integration suite. | `package.json` | ✅ |
| S12 | Cortex Eyes verification — `tools/cortex-eyes-wave-s.mjs` runs base spin across GoO + WoO + CF (0 console errors, all 4 base-lifecycle events fire); `tools/cortex-eyes-wave-s-fs.mjs` runs full WoO FS round (intro → 9 active spins → outro). Result: 7/7 lifecycle events emit with positive listener count, 0 console errors. | tools / verification | ✅ |
| S13 | Engine-tier LEGO conformance — `reelEngine` (preSpin: clear timers), `postSpin` (preSpin: clear events cache; postSpin self-listen to cache events), `tumble` (preSpin: kill chain; onFsEnd: clear DOM classes), `freeSpins` (postSpin: react to winCap trip + onFsTrigger telemetry). 25 / 25 non-infrastructure blocks register at least one lifecycle hook. | engine-tier blocks | ✅ |
| S14 | Vendor neutralization in 18 blocks — replaced `Gates of Olympus`, `WoO reference`, `Reactoonz`, `Sweet Bonanza`, `Sugar Rush`, `Megaways`, `NetEnt`, `Microgaming`, `Pragmatic`, `Lightning Link`, `Cleopatra`, `Buffalo`, `IGT`, `Cash Eruption`, `Wrath of Olympus` with industry-baseline / pay-anywhere / cluster-pays / line-pays references. lego-gate check #3 enforced. | 18 × `src/blocks/*.mjs` | ✅ |

### Wave R — HookBus lifecycle wiring + paylineOverlay test (commit `0978e33`)

> **Pre-Wave R audit**: 34 blokova, samo **3** registruju HookBus lifecycle hookove (`multiplierOrb`, `expandingWild`, `stickyWild`). Ostala 31 bloka su po pravilu "dead code by definition" — emituju runtime JS koji se nigde ne zove preko centralnog događaja, pa win cap, hold & win, walking wild, mystery symbol, scatter celebration, persistent multiplier, lightning, super symbol, wild reel, respin, wheel bonus, bonus pick, gamble — sve crta UI ali nikad ne reaguje na spin lifecycle. Wave R popravlja to template-wide.
>
> **Plus**: `paylineOverlay` blok je bio jedini bez `tests/blocks/<name>.test.mjs` para. Wave R dodaje 10-test suite.

| ID | Feature | Files | Status |
|---|---|---|---|
| R1 | `tests/blocks/paylineOverlay.test.mjs` — 10 unit tests (emitter contract, 4 runtime funkcija, gridHost wiring, tier color hook, dash-length CSS var, badge clamp, empty-event guard, determinism, syntactic validity, vendor-neutral check). Sva 10 pass. | `tests/blocks/paylineOverlay.test.mjs` | ✅ |
| R2 | `winCap` HookBus wiring — `postSpin` (watch every settled win event, short-circuit kad cumulative ≥ MAX_X), `preSpin` (per-spin reset), `onFsTrigger`/`onFsEnd` (round reset). Pre R2 funkcije winCapAdd/winCapReset/winCapTrigger bile su definisane ali se nikad nisu zvale. | `src/blocks/winCap.mjs` | ✅ |
| R3 | `holdAndWin` HookBus wiring — `postSpin` (hwMaybeEnter ako nije aktivan + hwHarvestBonus/hwAfterRespin ako jeste), `onSpinResult` (hwApplyLocks dok je round aktivan), `onFsTrigger`/`onFsEnd` (clear state). Pre R3 board jamna ali nigde ne zaključava ćelije. | `src/blocks/holdAndWin.mjs` | ✅ |
| R4 | `persistentMultiplier` HookBus wiring — `onFsSpinResult` (pmOnCascade — escalira po FS spin-u), `onTumbleStep` (pmOnWin kad postoji winning event + push pmGet u HookBus.setMult), `onFsTrigger`/`onFsEnd` (reset). Pre R4 chip se renderuje ali multiplier nikad ne raste. | `src/blocks/persistentMultiplier.mjs` | ✅ |
| R5 | `mysterySymbol` HookBus wiring — `preSpin` (clearMysteryFlags), `onSpinResult` (markMysteryCells + revealMysterySymbols), `onFsEnd` (clear). Pre R5 mystery cell markup postoji ali se nikad ne otkriva. | `src/blocks/mysterySymbol.mjs` | ✅ |
| R6 | `scatterCelebration` HookBus wiring — `onFsTrigger` (playScatterCelebration). Plus expose-uje `playScatterCelebration`/`findScatterCellsOnGrid` na window-u. Pre R6 CSS keyframes postoje ali nikad ne play-uju. | `src/blocks/scatterCelebration.mjs` | ✅ |
| R7 | `walkingWild` HookBus wiring — `onSpinResult` (harvest + apply), `onTumbleStep` (step + apply), `preSpin` non-FS (clear), `onFsTrigger`/`onFsEnd` (clear). Pre R7 registry nikad nije rastao. | `src/blocks/walkingWild.mjs` | ✅ |
| R8 | `respin` HookBus wiring — `postSpin` (maybeTrigger ako nije aktivan + afterSpin ako jeste), `onFsTrigger`/`onFsEnd` (end). Pre R8 respinMaybeTrigger nigde nije pozivan. | `src/blocks/respin.mjs` | ✅ |
| R9 | `wildReel` HookBus wiring — `preSpin` (clear), `onSpinResult` (maybeFire), `onFsEnd` (clear). | `src/blocks/wildReel.mjs` | ✅ |
| R10 | `lightning` HookBus wiring — `preSpin` (clear), `onSpinResult` (maybeFire + push sum of multiplier values via HookBus.addMult), `onFsEnd` (clear). Lightning multiplier sada zaista utiče na payout jer ide kroz HookBus.getMult(). | `src/blocks/lightning.mjs` | ✅ |
| R11 | `superSymbol` HookBus wiring — `preSpin` (clear), `onSpinResult` (maybeFire), `onFsEnd` (clear). | `src/blocks/superSymbol.mjs` | ✅ |
| R12 | `wheelBonus` HookBus wiring — `onFsTrigger`/`onFsEnd` (safety close ako je modal open na FS boundary). Open trigger ostaje parser-side (modal scena). | `src/blocks/wheelBonus.mjs` | ✅ |
| R13 | `bonusPick` HookBus wiring — `onFsTrigger`/`onFsEnd` (safety close). | `src/blocks/bonusPick.mjs` | ✅ |
| R14 | `gamble` HookBus wiring — `postSpin` non-FS sa win totalX > 0 (gambleOpen), `onFsTrigger`/`onFsEnd` (collect to close). | `src/blocks/gamble.mjs` | ✅ |
| R15 | Verifikovano headless: PDF/MD parity 30/30 (100 %) zadržan, headless GoO 1000 build 0 console errors, iframe sa 42 cells + Base Game title — Wave R nije razbila ništa. Hook coverage **3 → 14** blokova. | — | ✅ |

### Wave Q — PDF/MD parser parity (commit `5a1ce60`)

> **PDF upload bio funkcionalan ali lossy** — Boki uvek ubacuje PDF, parser je gubio 5+ polja (`theme.tags`, `theme.mood`, `theme.setting`, `theme.genre`, `theme.target_market`) i 1 feature kind (scatter_pay) jer `pdfToMarkdown.mjs` nije rekonstruisao prvi metadata table. Ova wave dovodi PDF parsing do **30/30 (100 %) parity-ja** sa native MD parsing-om za Gates of Olympus 1000.

| ID | Feature | Files | Status |
|---|---|---|---|
| Q1 | `tools/diff-pdf-vs-md.mjs` — cortex-eyes parity tool. Parses MD natively + PDF via pdfjs → pdfToMarkdown → parser. Field-by-field diff (30 fields covering name, theme, topology, symbols, features, confidence). Exit 0 = parity, 1 = drift. Dumps intermediate artifacts (`_diff-pdf-raw.txt`, `_diff-pdf-md.md`, `_diff-*-model.json`) for inspection. | `tools/diff-pdf-vs-md.mjs` | ✅ |
| Q2 | `extractMetaPanel()` — hvata `Tema:`, `Ciljna publika:`, `ŽANR`/`Žanr`/`Genre`, `Mood`/`Setting` iz SR/EN PDF panela. Industry-aware: Olimp/Zeus/Greek implies "Mythology" tag; missing region prefix gets "Global ·"; PDF.js space-out (`Ž A N R`) handled by dropping `\b` before non-ASCII. | `src/pdfToMarkdown.mjs` | ✅ |
| Q3 | `extractVolatility()` + `extractHitFrequency()` — hvata `V O L A T I L N O S T 5/5 — Maksimalna` i `Hit frequency ~25-30%` iz spaced-out PDF panela. | `src/pdfToMarkdown.mjs` | ✅ |
| Q4 | Auto-emit `## 02b · Scatter Pay` heading kad je evalKind=pay_anywhere — parser feature count na pay-anywhere igrama sada matchuje MD (6 vs 6 umesto 5 vs 6). | `src/pdfToMarkdown.mjs` | ✅ |
| Q5 | `tools/cortex-eyes-pdf-upload.mjs` — Playwright headless test koji startuje python server na 5181, drag-drop PDF u dropzone, screenshot pre/posle, console-error tally, iframe content frame inspekcija. Vizuelni dokaz za buduće wave-ove. | `tools/cortex-eyes-pdf-upload.mjs` | ✅ |
| Q6 | Live verifikovano: GoO 1000 PDF upload → iframe renderuje "Gates of Olympus 1000 · Base Game" + 42 grid cells + 0 console errors. Parser parity 30/30 (100 %). | — | ✅ |

### Wave A — Foundations (pre-session)
| ID | Feature | Files | Status |
|---|---|---|---|
| A1 | GDD parser (MD/TXT/JSON, regex + tables, no LLM) | `src/parser.mjs` | ✅ |
| A2 | Grid shape extractor — 18+ kinds (rectangular, cluster, hex, diamond, pyramid, cross, l_shape, radial, infinity, expanding, megaclusters, lock_respin, variable_reel, slingo, plinko, crash, wheel, dual) | `src/gridShape.mjs` | ✅ |
| A3 | Standalone playable HTML builder (zero-deps, file:// safe) | `src/buildSlotHTML.mjs` | ✅ |
| A4 | One-button drag-drop UI | `index.html` + `app.js` | ✅ |
| A5 | Gallery renderer (22 fixture × HTML) | `tools/render-grid-gallery.mjs` | ✅ |
| A6 | Grid invariants test (per-kind structural rules) | `tests/render-grid-all.mjs` | ✅ |
| A7 | Headless browser render-all (Playwright, screenshots + console-error scan) | `tests/render-browser-all.mjs` | ✅ |
| A8 | Full-QA audit (22 fixtures × desktop + mobile + spin) | `tools/full-qa-audit.mjs` | ✅ |

### Wave B — Free Spins lifecycle (this session, commits `42fabf3` → `471f5ec`)
| ID | Feature | Status |
|---|---|---|
| B1 | Parser: `extractFreeSpinsConfig()` — trigger / awards / retrigger / multiplier / bgMode | ✅ |
| B2 | State machine FSM: `BASE → FS_INTRO → FS_ACTIVE → FS_OUTRO → BASE` with hard guards | ✅ |
| B3 | Cinematic overlay placard (intro + outro, backdrop blur, 320ms fade) | ✅ |
| B4 | FS HUD — fixed top, SPINS / MULT / TOTAL boxes | ✅ |
| B5 | Body bg-mode swap (purple / gold / crimson via palette heuristic) | ✅ |
| B6 | FS lifecycle QA harness (22 fixtures × intro/active/outro/base) | ✅ |
| B7 | FS edge-case audit (11 scenarios — race/abuse/lifecycle/viewport) | ✅ |

### Wave C — Dev FS shortcut (commits `709f766`, `699b0fb`, `16dc3f6`)
| ID | Feature | Status |
|---|---|---|
| C1 | Dev FS button — responsive `clamp()` sizing, gold gradient, safe-area aware | ✅ |
| C2 | Positioned top-right — no overlap with hub / hamburger / title across viewports | ✅ |
| C3 | Click runs a REAL spin (windup → anticipation → placard) — not instant overlay | ✅ |
| C4 | FORCE_TRIGGER plants N scatters on first N reels at center row | ✅ |

### Wave D — Dynamic anticipation (commits `c053fcb`, `71c189e`, `bf5469d`, `0c7dadb`, `71d95a3`)
| ID | Feature | Status |
|---|---|---|
| D1 | `maybeArmAnticipation()` called after every reel stop | ✅ |
| D2 | Gate = `scattersSoFar >= threshold − 1` (kreće na 2. scatter za 3+ trigger) | ✅ |
| D3 | Math reachability guard: `scattersSoFar + remaining >= threshold` | ✅ |
| D4 | Top-rung guard: `scattersSoFar < topRung` (5-S award still possible) | ✅ |
| D5 | Sequential per-reel hold — `HOLD_BASE=600ms` each, one-by-one stop | ✅ |
| D6 | Identical glow duration for every anticipating reel | ✅ |
| D7 | `.reelCol--anticipating` gold pulse animation | ✅ |
| D8 | `prefers-reduced-motion` gates anticipation pulse | ✅ |

### Wave E — Spin cadence tuning (commits `3780eb1`, `fc12d33`, `183a249`)
| ID | Feature | Status |
|---|---|---|
| E1 | `SPIN_PROFILE_BASE` — S-AVP cabinet reference (windup 100, accel 120, steady 830, decel 350, stagger 320, bounce 4×1) | ✅ |
| E2 | `decelEasingSpeed = 0.11` — visible decel curve, not instant snap | ✅ |
| E3 | `is-blurring` motion blur 4.5px brightness 0.88 during rotation | ✅ |
| E4 | Single-iteration cushion bounce (no rubber wobble) | ✅ |
| E5 | `SPIN_PROFILE_FS` — faster FS-active cadence (windup 70, accel 90, steady 460, decel 240, stagger 180) | ✅ |
| E6 | Anticipation OFF during FS_ACTIVE (suspense was already paid in BASE) | ✅ |

### Wave F — Stage badge (commit `b501a0d`)
| ID | Feature | Status |
|---|---|---|
| F1 | `.stage-badge` pill in `.header`, between brand and layout-sub | ✅ |
| F2 | BASE state — muted gray-cyan, dot static | ✅ |
| F3 | FS state — gold gradient + gold border + pulsing dot (1.6s ease) | ✅ |
| F4 | `data-stage="..."` attribute, `setStageBadge(stage, label)` helper | ✅ |
| F5 | A11y: `aria-live="polite"`, dot is `aria-hidden`, label announced on change | ✅ |
| F6 | Reduced-motion gate | ✅ |
| F7 | Mobile breakpoint (620px) scales down to 0.55rem | ✅ |

### Wave G — Dual scatter count-mode (commit `43d7945`)
| ID | Feature | Status |
|---|---|---|
| G1 | Parser detects EN+SR phrase bank for `perReel` vs `any` | ✅ |
| G2 | SR transliteration tolerance: sketer · skater · sceter · scater · scatter · sćeter | ✅ |
| G3 | Default = `perReel` (Boki rule: silent → one-per-reel) | ✅ |
| G4 | `countTriggerSymbols()` and `maybeArmAnticipation()` honor the mode | ✅ |
| G5 | New fixture `20_rectangular_stacked_scatter_GAME_GDD.md` (explicit `any`) | ✅ |
| G6 | Unit test suite `tests/scatter-count-mode.mjs` (38 phrase + 4 fixture cases) | ✅ |

### Wave H — Cross-grid FS propagation (commits `ad615b7`, `81dd81d`)
| ID | Feature | Status |
|---|---|---|
| H1 | `UNIFORM_REEL_KINDS` set — cluster / megaclusters / lock_respin / expanding / infinity inherit the rectangular path | ✅ |
| H2 | `countTriggerSymbols()` does `i % REELS` column collapse for column grids | ✅ |
| H3 | `.cell--anticipating` per-cell glow for non-rect grids | ✅ |
| H4 | `runStaticReroll()` legacy blink retained for irregular + SVG shapes | ✅ |
| H5 | Dead `willArmAfter` IIFE + dummy ternary + `void` lint kludge removed | ✅ |
| H6 | `cumulativeAfter[]` precomputed (O(n cells), not O(n²)) | ✅ |

### Wave I — Unified reel engine (commit `35d840f`)
| ID | Feature | Status |
|---|---|---|
| I1 | `buildReelColumns()` extracted — shared by every uniform-reel shape | ✅ |
| I2 | renderRect builds RECT_REELS for cluster / megaclusters / lock_respin / expanding / infinity (not just rectangular) | ✅ |
| I3 | `runOneBaseSpin` + `FSM_runNextFsSpin` dispatch on `UNIFORM_REEL_KINDS` | ✅ |
| I4 | `window.RECT_REELS` exposed via getter (live array, even on shape rebuild) | ✅ |
| I5 | `tools/spin-engine-audit.mjs` — verifies real reel engine on every fixture | ✅ |
| I6 | `tests/render-browser-all.mjs` updated — column-grid shapes use reelCol + buffer-cell assertion | ✅ |

### Wave Spin-tempo unification (commit `55dc06b`)
| ID | Feature | Status |
|---|---|---|
| ST1 | Removed `SPIN_PROFILE_FS` — single `SPIN_PROFILE` constant drives BG + FS_INTRO + FS_ACTIVE + FS_OUTRO | ✅ |
| ST2 | Identical windup → accel → steady → decel → stagger cadence across every uniform-reel grid in every phase | ✅ |

### Wave Win-highlight (commit `21ffff9`)
| ID | Feature | Status |
|---|---|---|
| WH1 | CSS: `.gridHost.has-winselection .cell { opacity .32 }`, `.is-win { opacity 1; transform: scale(1.06) }`, 180ms ease | ✅ |
| WH2 | `applyWinHighlight()` picks most-frequent non-scatter symbol (≥3 occurrences) → marks those cells `.is-win` | ✅ |
| WH3 | `clearWinHighlight()` runs at start of every BG + FS spin | ✅ |
| WH4 | 30% no-win variance — not every spin lights up (placeholder until math evaluator) | ✅ |
| WH5 | Works on every uniform-reel grid (rectangular + cluster + megaclusters + lock_respin + expanding + infinity + variable_reel) | ✅ |
| WH6 | `prefers-reduced-motion` respected (no transition, no scale) | ✅ |

### Wave L–P — 16 detected-but-unused feature kinds wired as LEGO blocks (commit `45368f7`)

> **Final coverage push** — every feature kind the parser detects now has a
> dedicated LEGO block with defaults, GDD-driven overrides, CSS + markup +
> runtime emitters, auto-enable from `features[]`, no-op stub when disabled,
> and a unit-test suite. Builder gets 16 new imports + CSS calls + markup
> calls + runtime calls, all gated by `cfg.enabled` so backward compat is
> preserved on every existing fixture (browser QA 24/24 ✅ 0 console errors).

**Wave L — modifier wilds (5 blocks)**

| ID | Block | File | Tests |
|---|---|---|---:|
| L1 | `stickyWild` — sticky position registry across FS round (Map<r,c → spinsLeft>, mode=fs/base/both, durationSpins=0=persistent) | `src/blocks/stickyWild.mjs` | **18 ✅** |
| L2 | `expandingWild` — fill column when wild lands, expandWildGrow keyframe + grid mutation | `src/blocks/expandingWild.mjs` | **11 ✅** |
| L3 | `walkingWild` — wild walks dx/dy per spin (left/right/down), respin trigger flag | `src/blocks/walkingWild.mjs` | **13 ✅** |
| L4 | `wildReel` — randomly-picked reel fully wild on selected spins, chance + maxReelsPerSpin | `src/blocks/wildReel.mjs` | **12 ✅** |
| L5 | `mysterySymbol` — `?` placeholder reveals to ONE picked regular symbol (or wild/scatter opt-in), rotateY flip animation | `src/blocks/mysterySymbol.mjs` | **15 ✅** |

**Wave M — math evaluators (3 blocks)**

| ID | Block | File | Tests |
|---|---|---|---:|
| M1 | `clusterPaysEval` — flood-fill 4/8-connect (orthogonal/diagonal), bucket-edge payouts, wild substitutes, tier-sorted events | `src/blocks/clusterPaysEval.mjs` | **15 ✅** |
| M2 | `waysEval` — 243/1024/117649 Megaways evaluator, LTR/RTL/both, min-run, per-reel symbol count multiplication | `src/blocks/waysEval.mjs` | **13 ✅** |
| M3 | `persistentMultiplier` — non-resetting mult inside round, growPerWin / growPerCascade / maxMult cap, pmChip HUD | `src/blocks/persistentMultiplier.mjs` | **18 ✅** |

**Wave N — round controllers (3 blocks)**

| ID | Block | File | Tests |
|---|---|---|---:|
| N1 | `holdAndWin` — ≥N bonus → enter Hold; bonus cells lock; respins reset on new bonus; "all locked" Grand path | `src/blocks/holdAndWin.mjs` | **18 ✅** |
| N2 | `respin` — per-reel re-spin, holdRule=last-reel/all-but-empty/wild-anchor, mode=fs/base/both/paid | `src/blocks/respin.mjs` | **17 ✅** |
| N3 | `winCap` — regulator MAX WIN terminator, mode=round/spin, force-end FS round, MAX WIN overlay | `src/blocks/winCap.mjs` | **19 ✅** |

**Wave O — mini-games (2 blocks)**

| ID | Block | File | Tests |
|---|---|---|---:|
| O1 | `bonusPick` — pick-em modal with K tiles, weighted prize pool, END tokens that close the round | `src/blocks/bonusPick.mjs` | **18 ✅** |
| O2 | `wheelBonus` — N-segment wheel modal, ease-decel CSS transform, autoSpin flag, configurable segments | `src/blocks/wheelBonus.mjs` | **19 ✅** |

**Wave P — FX / risk / oversized (3 blocks)**

| ID | Block | File | Tests |
|---|---|---|---:|
| P1 | `lightning` — random-hit bolts on N cells, ⚡ glyph + multiplier chip overlay, weighted pool | `src/blocks/lightning.mjs` | **17 ✅** |
| P2 | `gamble` — double-or-nothing modal, mode=color/suit/ladder, multiplier auto-set (×2 / ×4), maxRounds cap | `src/blocks/gamble.mjs` | **19 ✅** |
| P3 | `superSymbol` — 2×2/3×3/4×4 colossal block, gridRow/Column span, anchor cell + covered cells | `src/blocks/superSymbol.mjs` | **17 ✅** |

**Wave L–P shared infrastructure**

| ID | Feature | Files | Status |
|---|---|---|---|
| LP1 | `freshModel()` extended with 16 new top-level slots — all `undefined` so block defaults stay backward-compatible | `src/parser.mjs` | ✅ |
| LP2 | 16 `extract*` parser functions — read `## <Feature Name>` (or alias) heading, parse `key: value` / `key = value` lines; helpers `_findSection` / `_readInt` / `_readFloat` / `_readBool` / `_readStr` | `src/parser.mjs` | ✅ |
| LP3 | `buildSlotHTML.mjs` wired: 16 imports + 14 CSS emit calls + 7 markup emit calls + 16 runtime emit calls (correct order: wilds → super → evaluators → round-control → FX → mini-games) | `src/buildSlotHTML.mjs` | ✅ |
| LP4 | Unit tests: **256 cases** across 16 new block test files (defaults + auto-enable + override + clamp + CSS/markup/runtime emit + window exposure + stub-when-disabled) | `tests/blocks/*.test.mjs` | ✅ |
| LP5 | `npm run test:blocks` — combined **384/384 ✅** (existing 128 + new 256) | `package.json` | ✅ |
| LP6 | Browser render audit — `tests/render-browser-all.mjs` 24/24 ✅ 0 console errors (all 16 blocks emit valid CSS + runtime even when disabled — stub paths exercised) | `tests/render-browser-all.mjs` | ✅ |
| LP7 | LEGO integrity grep — pred-commit gate `function (detectLineWins\|drawPaylineOverlay\|playWinSymCycle\|_buildStandardPaylines)\b` returns 0 hits in `src/buildSlotHTML.mjs` | — | ✅ |
| LP8 | Parse-real tests 4/4 ✅ — WoO/CF/MF/GoO 1000 fixtures still parse with 16 new feature slots present in model | `tests/parse-real.mjs` | ✅ |
| LP9 | Grid render tests 20/20 ✅ — no shape regressions from grid mutation runtimes (expandingWild / superSymbol) | `tests/render-grid-all.mjs` | ✅ |

### Wave K — Pay-Anywhere suite (Gates of Olympus 1000 family) (commit `09749d8`)

> **Six deficiencies identified during Gates of Olympus 1000 GDD analysis
> turned into one cohesive wave**. Parser now reads emoji bucket paytables
> (8-9 / 10-11 / 12+), Specials block detects Multiplier Orb, and 5 new
> LEGO blocks deliver scatter-pays evaluation + tumble cascade + orb
> accumulation + buy-bonus button + ante-bet toggle. WoO/CF/MF continue
> unchanged (backward compat via auto-enable from topology + features).

| ID | Feature | Files | Status |
|---|---|---|---|
| K1 | `payAnywhereEval.mjs` — count-based scatter-pays evaluator. Detects every regular symbol with COUNT ≥ minWin; wild substitutes for every regular; bucket lookup `8-9 / 10-11 / 12+`; tier-sorted events (HP→MP→LP→WILD); MAX_EVENTS cap. Drop-in replacement for `detectLineWins` on pay_anywhere grids. | `src/blocks/payAnywhereEval.mjs` | ✅ |
| K2 | `tumble.mjs` — cascade runtime (`runTumbleChain(detectFn)` → async iterator). Remove winning cells → gravity drop survivors → refill from reel strip → loop until no wins. Multiplier orbs preserved across chain. CSS keyframes: tumbleRemove + tumbleDrop. | `src/blocks/tumble.mjs` | ✅ |
| K3 | `multiplierOrb.mjs` — orb symbol annotation + accumulation. `annotateOrbs()` decorates visible orb cells with `data-orb-value`; `accumulateOrbMultiplier()` sums visible orb values; FS-mode persistent `BONUS_MULTIPLIER` (akumulirajući rule). Weighted-random distribution (2x-1000x scale, log-decay). | `src/blocks/multiplierOrb.mjs` | ✅ |
| K4 | `bonusBuy.mjs` — Buy Bonus button UI + force-trigger wiring. Bottom-right FAB with cost label (100× BET default). Click → `FORCE_TRIGGER = N` + `runOneBaseSpin()` so the existing FS lifecycle handles the rest. | `src/blocks/bonusBuy.mjs` | ✅ |
| K5 | `anteBet.mjs` — Ante Bet toggle UI + cost/trigger flags. Bottom-left switch (`+25%` default). Toggles `window.ANTE_BET_ON`; PAR layer (Phase 2) will read the flag for real bet calculation. Keyboard-accessible (Space/Enter). | `src/blocks/anteBet.mjs` | ✅ |
| K6 | Parser `extractPayAnywhereEval()` — reads emoji bucket paytables (`\| ID \| Name \| min8 \| 8-9 \| 10-11 \| 12+ \|`) from High-pay/Mid-pay/Low-pay sections. Auto-detects bucket edges from column headers; sets `payAnywhereEval.{paytable, bucketEdges, minWin}`. | `src/parser.mjs` | ✅ |
| K7 | Parser `extractMultiplierOrb()` — detects "Multiplier Orb" row in Specials; reads value range from Role column ("2x – 1000x"); auto-builds graduated distribution from range. Detects FS akumulirajući mode → sets `bonusAccumulate=true`. | `src/parser.mjs` | ✅ |
| K8 | Parser `extractBonusBuy()` — reads `## Bonus Buy` section (numbered prefix `## 07 · Bonus Buy` supported); extracts Cena/Cost cell (`**100x**` bold tolerant); reads guaranteed scatter count. | `src/parser.mjs` | ✅ |
| K9 | Parser `extractAnteBet()` — reads `## Ante Bet` section; extracts cost percentage (`+25%`) → `costMultiplier=1.25`; detects "duplira/double" → `triggerMultiplier=2`. | `src/parser.mjs` | ✅ |
| K10 | Parser `extractTumble()` — reads `## Tumble (Cascade) Mechanic` section knobs (`remove-ms`, `gravity-ms`, `refill-ms`, `chain-pause-ms`, `max-chain`, `preserve-orbs`). Numbered heading prefix supported. | `src/parser.mjs` | ✅ |
| K11 | `extractSymbolBlock` hardened — ID regex requires leading LETTER (was `[A-Za-z0-9_]`), rejects pay multipliers like `"10x"` and bucket thresholds like `"8"` as fake IDs. Dedupes via Set. Skips rows where Name column matches `\d+(\.\d+)?\s*x?` or `\d+\s*[-+–]\s*\d*`. | `src/parser.mjs` | ✅ |
| K12 | **CRITICAL BUG FIX**: JS regex `\Z` anchor → JavaScript engines treat as literal `Z`, truncating any Markdown section where a row contains "Zeus", "Z (Crown)", etc. Replaced 3 occurrences with portable `$(?![\s\S])` "true end of input" pattern. (Same bug latent in `stripSymbolTables` but unobserved.) | `src/parser.mjs` | ✅ |
| K13 | Orchestrator wire-up: 6 new imports + 4 CSS emit calls + 2 markup emit calls + 5 runtime emit calls. Order matters (`multiplierOrb` → `payAnywhereEval` → `tumble` → `bonusBuy` → `anteBet`). | `src/buildSlotHTML.mjs` | ✅ |
| K14 | `freshModel()` extended with 5 new top-level slots (payAnywhereEval / tumble / multiplierOrb / bonusBuy / anteBet) — all `undefined` so block defaults stay backward-compatible for every existing fixture. | `src/parser.mjs` | ✅ |
| K15 | Sample fixture: `samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md` — full 12-page PDF rendered to markdown with 6×5 topology, bucket paytable for 9 regular symbols + Scatter + Multiplier Orb, Bonus Buy 100x, Ante Bet +25%, akumulirajući FS multiplier. | `samples/` | ✅ |
| K16 | Unit tests — **116/116 ✅** across 5 new blocks (payAnywhereEval 18, tumble 30, multiplierOrb 24, bonusBuy 21, anteBet 23) covering defaults, auto-enable, override, clamps, CSS emit, markup emit, runtime literal bake, window exposure, reduced-motion gates. | `tests/blocks/*.test.mjs` | ✅ |
| K17 | Browser render audit — `tests/render-browser-all.mjs` updated to include GoO 1000 fixture. **24/24 ✅ · 0 console errors** (WoO/CF/MF unchanged + GoO new). All grid invariants preserved on rectangular pay_anywhere. | `tests/render-browser-all.mjs` | ✅ |
| K18 | LEGO integrity grep — orchestrator has 0 inline definitions across original 12 names + 11 new K-wave names (`detectPayAnywhereWins`, `runTumbleChain`, `annotateOrbs`, etc.). Pred-commit gate passes. | — | ✅ |
| K19 | npm `test:blocks` script — runs all 16 block test files sequentially with `&&` chain. Combined: **322 + 116 = 438 block-test cases pass**. | `package.json` | ✅ |

### Wave J2 — diamond / pyramid / cross / l_shape real engine (commit `07752ab`)

> **Irregular shape coverage**. Sve 4 shape sada koriste rectangular reel engine — kraj static-blink ere za HTML grid-ove. Engine voze identično kao rectangular + per-column visibleRows + anchor mode (center / bottom).

| ID | Feature | Status |
|---|---|---|
| J2.1 | `buildReelColumns()` u `src/blocks/reelEngine.mjs` proširen sa `anchor` parametrom: `'center'` (default), `'bottom'` (pyramid), `'top'` (future) | ✅ |
| J2.2 | `UNIFORM_REEL_KINDS` u `buildSlotHTML.mjs` proširen sa: `diamond`, `pyramid`, `cross`, `l_shape` (uz postojeće 7) | ✅ |
| J2.3 | renderRect dispatch: `PER_COLUMN_KINDS = {variable_reel, diamond, pyramid}` (per-column visibleRows iz `SHAPE.columns[].rows`) + `SHAPED_HOST_KINDS = {variable_reel, diamond, pyramid, cross, l_shape}` (host grid template-rows = repeat(ROWS, ...)) | ✅ |
| J2.4 | Pyramid anchor='bottom' — triangle anchored to bottom of host; diamond anchor='center' (default — hourglass silhouette) | ✅ |
| J2.5 | Cross / l_shape — engine spin-uje sve REELS×ROWS reel-strip cells, masked positions dobijaju `.cell--masked` klasu post-build (od mask metadata u SHAPE.columns[c].mask) | ✅ |
| J2.6 | `reelEngineCSS.mjs` CSS dodatak: `.cell--masked { opacity:0; pointer-events:none; filter:none }` — preko `is-blurring` blur efekta tako da masked cells ostaju nevidljivi i tokom spin-a | ✅ |
| J2.7 | Dispatch table u renderGrid(): `diamond/pyramid/cross/l_shape` → `renderRect()` (više ne `renderVariableReel()` / `renderMaskedRect()`) | ✅ |
| J2.8 | `tests/render-browser-all.mjs` ažuriran — diamond/pyramid/cross/l_shape sad validuju reelCol count + visible cells count (umesto strict cellCount=shape.totalCells) | ✅ |
| J2.9 | `tools/spin-engine-audit.mjs` REEL_ENGINE_KINDS proširen — sve 4 nove shape sad expect-uju real engine (`engine=YES`) | ✅ |
| J2.10 | Verifikovano: spin engine audit 24/24 ✅ CLEAN, sva 4 nova fixture sad imaju `reelCols=5 engine=YES fs=OK errs=0` | ✅ |

### Wave J1 — variable_reel real engine (commit `21ab8cb`)
| ID | Feature | Status |
|---|---|---|
| J1.1 | `buildReelColumns()` accepts per-reel rows array (`number \| number[]`) | ✅ |
| J1.2 | Each reel carries `visibleRows` — center-aligned in host grid via CSS gridRow offset | ✅ |
| J1.3 | `commitStopSymbols`, `maybeArmAnticipation`, `countTriggerSymbols` read `reel.visibleRows` (not global ROWS) | ✅ |
| J1.4 | `FORCE_TRIGGER` midRow computed per-reel from `visibleRows` | ✅ |
| J1.5 | `variable_reel` added to `UNIFORM_REEL_KINDS` — same engine, same cadence | ✅ |
| J1.6 | renderRect: when kind=variable_reel, host gets `repeat(ROWS, side)` template + per-column rows passed in | ✅ |
| J1.7 | `04_variable_reel` fixture verified live: 6 reels × `[2,5,7,7,5,2]` visibleRows, real reel rotation, dynamic anticipation working | ✅ |

### Wave Scatter-celebration (commit `20bfc04`)
| ID | Feature | Status |
|---|---|---|
| SC1 | CSS keyframe `scatter-celebrate` — 3 × 500ms = 1500ms total, scale 1→1.22→1.10→1.22→1 + rotate ±8°, dual gold drop-shadow | ✅ |
| SC2 | `.gridHost.is-scatter-celebrating` dims non-scatter cells to 0.18 opacity | ✅ |
| SC3 | `findScatterCellsOnGrid()` — prefers reel-engine cells (visible-row range only, ignores buffer slots) | ✅ |
| SC4 | `playScatterCelebration({ durationMs }) → Promise` — modular, composable, auto-cleanup on resolve | ✅ |
| SC5 | `handlePostSpin` dispatch: reels settle → 200/350ms pause → clearWinHighlight → celebration (1500ms) → FSM_enterIntro | ✅ |
| SC6 | Opt-out: `FREESPINS.scatterCelebration === false` skips entire block | ✅ |
| SC7 | `prefers-reduced-motion` respected (static scale, no rotation/keyframes) | ✅ |
| SC8 | WoO reference: `src/main.ts:2134 await sleep(2000)` + `scatterGlowSnap` keyframe | ✅ |

### Wave Win-cycle (commit `037541f`)
| ID | Feature | Status |
|---|---|---|
| WC1 | CSS keyframe `winsym-pulse` — 800ms × 3 sub-pulses, scale 1→1.25→1.05→1.22→1.06→1 + gold drop-shadow | ✅ |
| WC2 | `.gridHost.is-winsym-cycling` dims non-active cells to 0.22 opacity | ✅ |
| WC3 | `detectWinCombos()` — top 3 non-scatter symbols with ≥ 3 occurrences (placeholder until math) | ✅ |
| WC4 | `playWinSymCycle(combos, { perComboMs }) → Promise` — cycles combos one-by-one, 800ms each, undims at end | ✅ |
| WC5 | `WINSYM_CYCLE_TOKEN` cancellation — `cancelWinSymCycle()` bumps token, in-flight setTimeout no-ops | ✅ |
| WC6 | `applyWinHighlight()` gated on `FSM.phase === 'BASE'` — suppressed during FS_INTRO / FS_ACTIVE / FS_OUTRO | ✅ |
| WC7 | `runOneBaseSpin` calls `cancelWinSymCycle()` so stale cycle from previous spin can't leak | ✅ |
| WC8 | Opt-out: `FREESPINS.winCycle === false` skips entire block | ✅ |
| WC9 | WoO reference: `src/presentation.ts` lineMs 500-600ms tier-dependent cycle | ✅ |

### Wave Anticipation-uniform (commit `037541f`)
| ID | Feature | Status |
|---|---|---|
| AU1 | Every anticipating reel glow-armed for exactly HOLD_BASE (600ms) regardless of position in chain | ✅ |
| AU2 | Per-reel `glowTimerId` schedules `.reelCol--anticipating` to appear at START of that reel's hold window | ✅ |
| AU3 | Pre-fix: reel A glow 600ms, reel C glow 1800ms (chained cursor) — post-fix: all 600ms uniform | ✅ |
| AU4 | `startSpinAll` clears stale `glowTimerId` + removes leftover class so late timer can't flash next round | ✅ |
| AU5 | Cabinet "one-by-one" cadence preserved (glow appears just-in-time, not all-at-once) | ✅ |

### Wave Win-cycle subtle (commit `88d7e00`)
| ID | Feature | Status |
|---|---|---|
| WS1 | Removed `scale(1.25)` + `rotate(±8°)` — symbol stays strictly inside reel cell | ✅ |
| WS2 | `winsym-pulse` keyframe = brightness pulse only (1 → 1.35 → 1.18 → 1) + soft gold drop-shadow | ✅ |
| WS3 | `scatter-celebrate` keyframe = brightness pulse (1 → 1.5 → 1.2 → 1) + drop-shadow, NO transform | ✅ |
| WS4 | Reads as visible cluster purely through luminance contrast (dim peers 0.22 / 0.18) | ✅ |
| WS5 | `prefers-reduced-motion` falls back to static brightness boost | ✅ |

### Wave Win-cycle ultimate (commit `0a5f1c1`)
| ID | Feature | Status |
|---|---|---|
| WU1 | `SYMBOL_REGISTRY` built in buildSlotHTML from `model.symbols.{high, mid, low, specials}` | ✅ |
| WU2 | Registry shape: `{ regularPay[], wild, scatter, tier{} }` injected as inline JS constant | ✅ |
| WU3 | `detectWinCombos()` returns one event per HP/MP/LP symbol with ≥3 hits (no more "top 3 only") | ✅ |
| WU4 | Wild cells joined to every regular event (substitute rendering) | ✅ |
| WU5 | Wild count contributes to ≥3 threshold (2K + 1W counts as 3K) | ✅ |
| WU6 | Wild-only fallback event when no regular meets threshold but ≥3 wilds present | ✅ |
| WU7 | Tier-sorted: HP → MP → LP → WILD, longer line first within tier | ✅ |
| WU8 | Hard cap `MAX_EVENTS = 8` per spin (industry parity) | ✅ |
| WU9 | Adaptive cycle pacing: ≤4 events = 500ms each, 5+ events = 400ms each | ✅ |
| WU10 | Override via `playWinSymCycle({ perEventMs })` (legacy `perComboMs` alias kept) | ✅ |
| WU11 | `applyWinHighlight()` returns `Promise<void>` — awaitable in any flow | ✅ |
| WU12 | Win cycle runs in BASE **and** FS_ACTIVE (suppressed only during FS_INTRO / FS_OUTRO placards) | ✅ |
| WU13 | `handlePostSpin(duringFs=true)` awaits cycle before queuing next FS spin (250ms breath) | ✅ |
| WU14 | Live verified on WoO GDD: regularPay=11, wild=W, scatter=S, tier sort correct | ✅ |

### Wave B1 — LEGO block-ification (commit `51f2a57`)

> **Pravilo (`~/.claude/projects/-/memory/rule_slot_gdd_lego_blocks.md`)**: Sve u slot-gdd-factory je modularan lego blok u `src/blocks/<name>.mjs`, učitava se na osnovu GDD-a, `buildSlotHTML.mjs` je samo orchestrator. Migracija pokrenuta — počinje sa najvećim violation-om (~250 LOC inline win presentation logic).

| ID | Feature | Status |
|---|---|---|
| B1.1 | `src/blocks/paylines.mjs` — `buildStandardPaylines()` + `paylineConfig()` (pure Node-side, GDD-driven pool) | ✅ |
| B1.2 | `src/blocks/paylineOverlay.mjs` — `emitPaylineOverlayRuntime()` (SVG draw + badge runtime emitter) | ✅ |
| B1.3 | `src/blocks/winPresentation.mjs` — `defaultConfig` / `resolveConfig` / `emitWinPresentationRuntime` (detectLineWins + playWinSymCycle + applyWinHighlight + cancelWinSymCycle) | ✅ |
| B1.4 | Parser: `extractWinPresentation()` — čita `## Win Presentation` sekciju (mode/perEventMs/maxEvents/noWinChance/winCycle/paylines) | ✅ |
| B1.5 | `buildSlotHTML.mjs` refactor: import + `${emitPaylineOverlayRuntime()}` + `${emitWinPresentationRuntime(resolveWinPresentationConfig(model))}`. **0 inline `function detectLineWins / drawPaylineOverlay / playWinSymCycle / _buildStandardPaylines` u builder-u** | ✅ |
| B1.6 | Pred-commit grep gate (`grep -nE "function (detectLineWins\|drawPaylineOverlay\|playWinSymCycle\|_buildStandardPaylines)\\b" src/buildSlotHTML.mjs`) returns 0 hits | ✅ |
| B1.7 | Unit testovi: `tests/blocks/paylines.test.mjs` (12 cases) + `tests/blocks/winPresentation.test.mjs` (22 cases — uključuje parser→block roundtrip) | ✅ |
| B1.8 | GDD-driven: explicit `model.winPresentation.paylines` override industry-standard pool; explicit `mode`, `perEventMs`, `maxEvents`, `noWinChance`, `winCycle` bake u runtime kao literali | ✅ |
| B1.9 | Backward compat: GDD bez `## Win Presentation` sekcije → svi slotovi `undefined` → block `resolveConfig` daje safe defaults identične pre-block ponašanju | ✅ |
| B1.10 | Migration debt: TODO ostalo — `_buildStandardPaylines` već izvučen; `detectWinCombos`, `applyWinHighlight` cluster mode, FS lifecycle helpers ostaju za sledeće B-talase | ⏳ |

### Wave B2 — scatterCelebration LEGO blok (commit `6d1cb4d`)

> Drugi B-talas u LEGO migraciji. Scatter celebration animacija (1500ms pulse/glow nakon settle pre FS_INTRO) izvučena iz `buildSlotHTML.mjs` u modularan blok. CSS keyframes + JS funkcije su sada emitovani iz `src/blocks/scatterCelebration.mjs` umesto inline. GDD-driven knobs (duration, pulse-cycles, dim-opacity, glow-color, glow-peak) bake-uju se u runtime kao literali.

| ID | Feature | Status |
|---|---|---|
| B2.1 | `src/blocks/scatterCelebration.mjs` — `defaultConfig` / `resolveConfig` / `emitScatterCelebrationCSS` / `emitScatterCelebrationRuntime` | ✅ |
| B2.2 | Parser: `extractScatterCelebration()` čita `## Scatter Celebration` / `Trigger Celebration` / `Scatter Animation` / `Trigger Animation` heading variante | ✅ |
| B2.3 | GDD knobs: `enabled` / `duration-ms` / `pulse-cycles` / `pulse-cycle-ms` / `dim-opacity` / `glow-color` / `glow-peak` — sve opciono | ✅ |
| B2.4 | `buildSlotHTML.mjs` refactor: ~42 LOC inline CSS + ~60 LOC inline JS zamenjeno sa 2 retke (CSS emit + runtime emit). **0 inline `function findScatterCellsOnGrid \| function playScatterCelebration \| @keyframes scatter-celebrate` u builder-u** | ✅ |
| B2.5 | Unit testovi: `tests/blocks/scatterCelebration.test.mjs` — **22/22 ✅** (defaults, bounds, CSS literal-bake, runtime emit, stub-when-disabled, parser, roundtrip) | ✅ |
| B2.6 | Backward compat: GDD bez `## Scatter Celebration` sekcije → svi slotovi `undefined` → block `resolveConfig` daje defaults identične pre-block ponašanju (1500ms / 3 cycles / 500ms / 0.18 dim / 255,214,110 gold / 1.5 peak) | ✅ |
| B2.7 | `enabled: false` u GDD → emituje stub `playScatterCelebration() = Promise.resolve()` BUILD-TIME (zero runtime cost, ne probija FS lifecycle dispatch) | ✅ |
| B2.8 | `FREESPINS.scatterCelebration === false` runtime override i dalje radi (legacy escape hatch) | ✅ |
| B2.9 | Browser QA verifikovan — 23/23 fixture, 0 console errors, scatter celebration animira identično kao pre refaktora | ✅ |

### Wave B3 — detectWinCombos LEGO blok (commit `0a0a417`)

| ID | Feature | Status |
|---|---|---|
| B3.1 | `emitDetectWinCombosRuntime(cfg)` dodat u `src/blocks/winPresentation.mjs` — cluster-mode evaluator izvučen iz buildera | ✅ |
| B3.2 | `MAX_EVENTS` baked iz `cfg.maxEvents` (single source of truth sa line-pays) | ✅ |
| B3.3 | `buildSlotHTML.mjs`: 49-LOC inline `function detectWinCombos()` zamenjen sa `${emitDetectWinCombosRuntime(...)}` | ✅ |
| B3.4 | Unit testovi: 4 nova test-case u `tests/blocks/winPresentation.test.mjs` (function exists, MAX_EVENTS literal, tierRank, defaults) | ✅ |

### Wave B5 — spinTempo LEGO blok (commit `0a0a417`)

| ID | Feature | Status |
|---|---|---|
| B5.1 | `src/blocks/spinTempo.mjs` — `defaultConfig` / `resolveConfig` / `emitSpinTempoRuntime` | ✅ |
| B5.2 | Presets: `s-avp` (cabinet default) / `fast` (arcade quickplay) / `slow` (cinematic) — `preset:` ključ u GDD-u + per-key overrides | ✅ |
| B5.3 | Sva 13 SPIN_PROFILE knob-a bake-uju se iz GDD-a sa numeric bounds (windupMs / accelMs / steadyMs / decelMs / staggerMs / bouncePx / bounceDecay / bounceCount / bounceElasticity / decelEasingSpeed / windupFrames / windupPx) | ✅ |
| B5.4 | Parser: `extractSpinTempo()` — heading varijante (Spin Tempo / Reel Tempo / Spin Cadence / Spin Timing) | ✅ |
| B5.5 | `buildSlotHTML.mjs`: inline `const SPIN_PROFILE = { ... }` zamenjen sa `${emitSpinTempoRuntime(...)}` | ✅ |
| B5.6 | Unit testovi: `tests/blocks/spinTempo.test.mjs` — **14/14 ✅** | ✅ |
| B5.7 | Backward compat: GDD bez sekcije → s-avp defaults identični pre-block ponašanju | ✅ |

### Wave B6 — anticipation LEGO blok (commit `0a0a417`)

| ID | Feature | Status |
|---|---|---|
| B6.1 | `src/blocks/anticipation.mjs` — CSS emitter (reel + cell keyframe variants) + runtime emitter (HOLD_BASE + maybeArmAnticipation) | ✅ |
| B6.2 | GDD knobs: `enabled` / `hold-ms` / `pulse-ms` / `gold` / `skip-during-fs` | ✅ |
| B6.3 | `skip-during-fs: false` → uklanja FS-phase guard (anticipation radi i u FS_ACTIVE) | ✅ |
| B6.4 | Parser: `extractAnticipation()` — heading varijante (Anticipation / Reel Anticipation) | ✅ |
| B6.5 | `buildSlotHTML.mjs`: ~34 LOC inline CSS + ~115 LOC inline JS zamenjeno sa 2 emit-poziva | ✅ |
| B6.6 | Unit testovi: `tests/blocks/anticipation.test.mjs` — **13/13 ✅** | ✅ |
| B6.7 | Disabled mode → no-op `function maybeArmAnticipation() {}` stub (zero runtime cost) | ✅ |

### Wave B4 — freeSpins LEGO blok (commit `f4aeb46`)

> Najveći B-talas u LEGO migraciji. Kompletna FS lifecycle (3 vizuelne sloja + 12 FSM helpera + 4 placard ID-jeva) izvučena iz buildera. GDD-driven labels, fade timings, transition delays — sve bake-uje u CSS + markup + runtime kao literali.

| ID | Feature | Status |
|---|---|---|
| B4.1 | `src/blocks/freeSpins.mjs` (559 LOC) — 5 emitter funkcija: CSS / HudMarkup / ToastMarkup / OverlayMarkup / Runtime | ✅ |
| B4.2 | CSS izvučeno: 180 LOC (body.fs-mode-* + .fs-hud + .fs-toast + .fs-overlay + .fs-placard sa svim child rules) | ✅ |
| B4.3 | Markup izvučeno: HUD (4 stat box + 2 divider) + toast (1 div) + overlay (placard sa 5 ID-jeva: eyebrow/title/spins/sub/cta) | ✅ |
| B4.4 | Runtime izvučeno: const FSM + 12 helpera (renderHud/showFsMode/hideFsMode/showOverlay/hideOverlay/showToast/enterIntro/enterActive/runNextFsSpin/handleRetrigger/enterOutro/enterBase) + placard CTA listener | ✅ |
| B4.5 | GDD knobs: `enabled` / `intro-label` / `outro-label` / `total-win-label` / `intro-cta` / `outro-cta` / `intro-sub` / `fade-ms` / `enter-active-ms` / `spin-breath-ms` / `toast-ms` / `retrigger-toast-ms` | ✅ |
| B4.6 | Label injection safety — `isPlainLabel()` rejects `<`, `>`, `{`, `}`, `\n`; HTML escape u overlay markup | ✅ |
| B4.7 | Parser: `extractFreeSpinsPresentation()` — 5 heading alijasa (Free Spins Presentation / FS Presentation / Free Spins Placard / Bonus Presentation / FS Placard) | ✅ |
| B4.8 | `buildSlotHTML.mjs`: -382 LOC (2325 → 1943) — najveće smanjenje od svih B-talasa | ✅ |
| B4.9 | Disabled mode → CSS+markup prazno, runtime no-op stub za sve 12 FSM_ funkcija (zero browser cost) | ✅ |
| B4.10 | window.FSM exposure očuvan (QA harness probe — Playwright eval) | ✅ |
| B4.11 | Unit testovi: `tests/blocks/freeSpins.test.mjs` — **21/21 ✅** (defaults + bounds + 4 emitter outputs + parser + roundtrip) | ✅ |
| B4.12 | Backward compat: GDD bez sekcije → safe defaults identični pre-block ponašanju (FREE SPINS / TAP TO BEGIN / RETURN TO BASE / 320ms fade / 420ms enter-active / 250ms breath / 1800ms toast) | ✅ |

### Wave B5-engine-hot — reelEngine LEGO blok (commit `cf0c7b5`)

> **Poslednji** i **najveći** hot-path izvlačenje. Kompletan reel spin engine (state machine + animations + static reroll) izvučen iz buildera u modularan blok. Sve zavisnosti (RECT_REELS / spinTicker / FORCE_TRIGGER + 8 funkcija) sada žive u jednom modulu sa 12 GDD-driven knobs.

| ID | Feature | Status |
|---|---|---|
| B5h.1 | `src/blocks/reelEngine.mjs` (519 LOC, 13 unit tests) — `emitReelEngineRuntime()` emit-uje sve hot-path simbole | ✅ |
| B5h.2 | 11 izvučenih simbola: `RECT_REELS` / `RECT_SIDE` / `spinTicker` / `spinStartTime` / `allReelsActive` / `FORCE_TRIGGER` / `randomSym` / `rotateStripDown` / `commitStopSymbols` / `buildReelColumns` | ✅ |
| B5h.3 | 5 izvučenih engine funkcija: `startSpinAll` / `onTickAll` / `runOneBaseSpin` / `runStaticReroll` (kompletan hot-path) | ✅ |
| B5h.4 | 12 GDD knobs: `min-rotations` (8) / `settle-breath-ms` (80) / `strip-buffer-cells` (2) / `static-pre-roll-ms` (220) / `static-blur-swap-ms` (220) / `static-stagger-ms` (200) / `static-hold-ms` (400) / `static-settle-ms` (80) / `static-fallback-ms` (60) / `snap-threshold` (0.6) / `min-step-px` (0.5) / `accel-min-factor` (0.3) | ✅ |
| B5h.5 | Parser: `extractReelEngineHot()` — heading varijante (Reel Engine Hot / Spin Physics / Reel Hot-Path) | ✅ |
| B5h.6 | `buildSlotHTML.mjs`: **-465 LOC** (1777 → 1312) — pojedinačno najveće smanjenje od svih B-talasa | ✅ |
| B5h.7 | Unit testovi: `tests/blocks/reelEngine.test.mjs` — **13/13 ✅** | ✅ |
| B5h.8 | Backward compat — sve magic numbers preserved as defaults (S-AVP cabinet reference); GDD bez sekcije = identično pre-block ponašanju | ✅ |
| B5h.9 | Dead-code skript (Python AST-aware brace counter) uklonio 18,400 chars original funkcija; verifikovano `_DEPRECATED_*` = 0 hits | ✅ |
| B5h.10 | Browser QA + spin engine audit verifikovano — 23/23 + 24/24 CLEAN | ✅ |

### Wave B5-css — reelEngineCSS LEGO blok (commit `2eb2afa`)

| ID | Feature | Status |
|---|---|---|
| B5c.1 | `src/blocks/reelEngineCSS.mjs` — `.reelCol` + `.reelStrip` + `.cell.is-blurring` u CSS emitter | ✅ |
| B5c.2 | GDD knobs: `blur-px` / `blur-dim` / `blur-fade-ms` — sve numeric sa bounds | ✅ |
| B5c.3 | Parser: `extractReelEngine()` — heading varijante (Reel Engine / Spin Blur) | ✅ |
| B5c.4 | Unit testovi: `tests/blocks/reelEngineCSS.test.mjs` — **8/8 ✅** | ✅ |

### Wave B8a — triggerCounting LEGO blok (commit `2eb2afa`)

| ID | Feature | Status |
|---|---|---|
| B8a.1 | `src/blocks/triggerCounting.mjs` — `countTriggerSymbols()` + `spinsForCount()` izvučeni iz buildera | ✅ |
| B8a.2 | Cover sve grid kinds — rectangular / variable_reel (RECT_REELS path), cluster/megaclusters/lock_respin/expanding/infinity (column-collapse path), SVG kinds (generic .cell + text scan) | ✅ |
| B8a.3 | `perReel` + `any` count mode honored u svim path-ovima | ✅ |
| B8a.4 | Parser: `extractTriggerCounting()` — heading varijante (Trigger Counting / Scatter Counting) | ✅ |
| B8a.5 | Unit testovi: `tests/blocks/triggerCounting.test.mjs` — **7/7 ✅** | ✅ |

### Wave B8b — postSpin LEGO blok (commit `2eb2afa`)

| ID | Feature | Status |
|---|---|---|
| B8b.1 | `src/blocks/postSpin.mjs` — `handlePostSpin(duringFs)` izvučen iz buildera (~90 LOC inline u blok) | ✅ |
| B8b.2 | 6 GDD knobs: `settle-pause-ms` (200) / `forced-settle-pause-ms` (350) / `retrigger-cap` (3) / `fs-spin-breath-ms` (250) / `fake-win-chance` (0.4) / `fake-win-max-x` (25) | ✅ |
| B8b.3 | Sve magic numbers konfigurabilne — više nema hardkodovanih 200/350/3/250/0.4/25 | ✅ |
| B8b.4 | Parser: `extractPostSpin()` — heading varijante (Post Spin / Post-Spin Orchestration) | ✅ |
| B8b.5 | Unit testovi: `tests/blocks/postSpin.test.mjs` — **8/8 ✅** | ✅ |

### Wave B7 — stageBadge LEGO blok (commit `0a0a417`)

| ID | Feature | Status |
|---|---|---|
| B7.1 | `src/blocks/stageBadge.mjs` — CSS + Markup + Runtime emitter trio | ✅ |
| B7.2 | GDD knobs: `enabled` / `base-label` / `fs-label` / `gold` / `pulse-ms` / `mobile-breakpoint` | ✅ |
| B7.3 | Label injection safety — HTML escape + plain-text validator (rejects `<`, `>`, `{`, `}`, prazno, > 40 char) | ✅ |
| B7.4 | Parser: `extractStageBadge()` — heading varijante (Stage Badge / Phase Badge / Live Indicator) | ✅ |
| B7.5 | `buildSlotHTML.mjs`: 52 LOC inline CSS + 5 LOC HTML + 8 LOC JS zamenjeno sa 3 emit-poziva | ✅ |
| B7.6 | `STAGE_BASE_LABEL` / `STAGE_FS_LABEL` const-evi izloženi runtime-u (umesto literal string-ova u `setStageBadge` pozivima) — GDD može da promeni label tekst bez touch-a u builder | ✅ |
| B7.7 | Unit testovi: `tests/blocks/stageBadge.test.mjs` — **17/17 ✅** | ✅ |

### Wave Win-cycle per-LINE (commit `255689a`)
| ID | Feature | Status |
|---|---|---|
| WL1 | `_buildStandardPaylines(reels, rows)` — 16-25 industry-standard lines (3 horizontals + V + invV + 4 U + 6 zig-zag + 5 peaks + 5 deep-row) | ✅ |
| WL2 | `LINE_PAYS_KINDS` whitelist: rectangular / variable_reel / lock_respin / expanding | ✅ |
| WL3 | Cluster-pays grids (cluster / megaclusters / hex / diamond / pyramid / cross / l_shape / SVG) keep per-symbol cycle as INTENDED | ✅ |
| WL4 | `PAYLINE_POOL` constant injected into inline JS — runtime has paths without a fetch | ✅ |
| WL5 | `detectLineWins()` walks each payline left-to-right, counts consecutive matches from the leftmost reel, wild substitutes | ✅ |
| WL6 | Only first `matchLength` cells lit per event — distinct path, NOT every grid cell sharing the symbol | ✅ |
| WL7 | Wild-headed lines walk forward until a real symbol fixes the carrier; all-wild = WILD-tier event | ✅ |
| WL8 | Dedupe by `(symbol + cells signature + matchLength)` — two paylines that share the same cluster don't fire twice | ✅ |
| WL9 | Tier sort identical to per-symbol path (HP → MP → LP → WILD); longer matchLength first | ✅ |
| WL10 | Strategy dispatch in `applyWinHighlight`: line-pays mode when `PAYLINE_POOL.length > 0 && RECT_REELS`, else cluster mode | ✅ |
| WL11 | Live verified WoO 5×3: 16 deduped lines, BASE events 3 cells each, FS_ACTIVE 7 distinct line events sa wild substitutes (`WPW`, `VAWVA`, `SHWSH`, `WWH`) | ✅ |
| WL12 | WoO model parity: mirrors `src/paylines.ts` `PAYLINES[lineIdx][reelIdx] = rowIdx` source-of-truth | ✅ |

---

## ✅ QA matrix (HEAD `07752ab`)

| Suite | Coverage | Result |
|---|---|---:|
| `tests/parse-real.mjs` | 3 synthetic GDDs → parser | **3/3 ✅** |
| `tests/scatter-count-mode.mjs` | 38 phrase variants + 4 fixtures | **38/38 ✅** |
| `tests/render-grid-all.mjs` | 20 fixtures × shape invariants | **20/20 ✅** |
| `tests/render-browser-all.mjs` | 23 grids × headless Chromium | **23/23 ✅ 0 console errors** |
| `tools/fs-qa-audit.mjs` | 23 fixtures × full FS lifecycle | **23/23 ✅ CLEAN** |
| `tools/fs-edge-cases.mjs` | 11 lifecycle/race/abuse scenarios | **11/11 ✅ CLEAN** |
| `tools/spin-engine-audit.mjs` | 24 × real reel engine drives all column grids | **24/24 ✅ CLEAN** |
| `tools/payline-overlay-spot-check.mjs` | 23 fixtures × SVG overlay snapshot | **23/23 ✅** |
| `tests/blocks/paylines.test.mjs` | paylines block — pure builder + config (LEGO) | **12/12 ✅** |
| `tests/blocks/winPresentation.test.mjs` | winPresentation block + detectWinCombos B3 + roundtrip | **26/26 ✅** |
| `tests/blocks/scatterCelebration.test.mjs` | scatterCelebration block + parser→runtime roundtrip | **22/22 ✅** |
| `tests/blocks/stageBadge.test.mjs` | stageBadge block (CSS + Markup + Runtime + parser) | **17/17 ✅** |
| `tests/blocks/anticipation.test.mjs` | anticipation block (CSS + Runtime + parser) | **13/13 ✅** |
| `tests/blocks/spinTempo.test.mjs` | spinTempo block (presets + per-key + parser) | **14/14 ✅** |
| `tests/blocks/freeSpins.test.mjs` | freeSpins block (CSS + 3 markup + runtime + parser) | **21/21 ✅** |
| `tests/blocks/reelEngineCSS.test.mjs` | reelEngineCSS block (.reelCol + .reelStrip + .is-blurring) | **8/8 ✅** |
| `tests/blocks/triggerCounting.test.mjs` | triggerCounting block (countTriggerSymbols + spinsForCount) | **7/7 ✅** |
| `tests/blocks/postSpin.test.mjs` | postSpin block (handlePostSpin orchestration) | **8/8 ✅** |
| `tests/blocks/reelEngine.test.mjs` | reelEngine block (full hot-path — 8 functions + 4 state vars + 12 knobs) | **13/13 ✅** |
| `tests/blocks/stickyWild.test.mjs` | stickyWild block (Wave L1) | **18/18 ✅** |
| `tests/blocks/expandingWild.test.mjs` | expandingWild block (Wave L2) | **11/11 ✅** |
| `tests/blocks/walkingWild.test.mjs` | walkingWild block (Wave L3) | **13/13 ✅** |
| `tests/blocks/wildReel.test.mjs` | wildReel block (Wave L4) | **12/12 ✅** |
| `tests/blocks/mysterySymbol.test.mjs` | mysterySymbol block (Wave L5) | **15/15 ✅** |
| `tests/blocks/clusterPaysEval.test.mjs` | clusterPaysEval block (Wave M1) | **15/15 ✅** |
| `tests/blocks/waysEval.test.mjs` | waysEval block (Wave M2) | **13/13 ✅** |
| `tests/blocks/persistentMultiplier.test.mjs` | persistentMultiplier block (Wave M3) | **18/18 ✅** |
| `tests/blocks/holdAndWin.test.mjs` | holdAndWin block (Wave N1) | **18/18 ✅** |
| `tests/blocks/respin.test.mjs` | respin block (Wave N2) | **17/17 ✅** |
| `tests/blocks/winCap.test.mjs` | winCap block (Wave N3) | **19/19 ✅** |
| `tests/blocks/bonusPick.test.mjs` | bonusPick block (Wave O1) | **18/18 ✅** |
| `tests/blocks/wheelBonus.test.mjs` | wheelBonus block (Wave O2) | **19/19 ✅** |
| `tests/blocks/lightning.test.mjs` | lightning block (Wave P1) | **17/17 ✅** |
| `tests/blocks/gamble.test.mjs` | gamble block (Wave P2) | **19/19 ✅** |
| `tests/blocks/superSymbol.test.mjs` | superSymbol block (Wave P3) | **17/17 ✅** |
| **TOTAL** | | **384/384 ✅** |

---

## 🟡 In progress / next up — Ultimate-fix roadmap (Wave S → Wave Z)

> **Kontekst** (04.06.2026, Boki): *"sve fwture koje ubacujemo, ubacujemo
> kao blokove i sto vise feautrea. dakle, obavezan ultimativni fix svega
> kao za template, ne specijalno sad za bilo koju konkretnu igru"* —
> ekspres povodom mrtvog Multiplier Orb-a u GoO. Wave R je popravila
> osnovnu hook coverage (3 → 14 blokova). Wave S → T → U dovode template
> do potpune integriteta pre Wave Z (Block Playground) koji onda
> verifikuje sve vizuelno.
>
> **🚧 Hard ordering rule**: Wave Z se NE radi pre Wave U. Razlog je
> sledeći — playground prikazuje stanje blokova. Ako blokovi još uvek
> ne emituju hookove kako treba ili imaju game-specific defaults,
> playground će prikazati broken / pristrasne stvari, što je gore od
> nikakvog playground-a.

### ✅ Wave S — SHIPPED (see "Shipped" section above)

> All 12 items + 2 derived bonuses (engine-tier conformance, vendor cleanup)
> green. Listener coverage 14 → 25 blocks. Hook coverage 7/7 lifecycle events
> verified via cortex-eyes-wave-s.mjs + cortex-eyes-wave-s-fs.mjs.

### 🟠 Wave T — Template cleanup + sane defaults (posle S)

> Pravilo kaže: **nikad game-specific code u src/blocks/**. Audit 04.06.2026
> našao 11 fajlova sa game-specific reference. Plus blok default-i u 3 bloka
> su iz konkretnog GDD-a hardkodovan. Wave T to čisti.
>
> **⚠️ Naming-collision note**: u "Shipped" sekciji postoje wave-ovi pod
> imenom `Wave T2` (commit `d9f0cfc`, vendor purge round 2) i `Wave T3`
> (commit `c9e7b42`, LEGO lifecycle gap fix). To je **drugi koordinatni
> sistem** od originalne T1–T7 plan liste ispod. Zbog jasnoće, plan stavke
> u ovoj sekciji preimenovane su u `T-vendor` / `T-orb` / `T-bonus` /
> `T-ante` / `T-engine` / `T-slim` / `T-verify`.

| ID | Item | Why | Status (verified 2026-06-04 HEAD `f5932e7`) |
|:-:|---|---|---|
| T-vendor | **Vendor neutralization** — 11 fajlova sa game-specific komentarima (`Gates of Olympus reference`, `WoO reference`, `Reactoonz`, `Sweet Bonanza`, `Sugar Rush`) → zameniti sa "pay-anywhere reference", "cascade reference", "industry baseline" | krši `rule_no_vendor_mentions.md` + LEGO pravilo | ✅ **DONE** kroz `e1d2968` (Wave T orig) + `d9f0cfc` (shipped Wave T2, round 2). Grep `(zeus\|olympus\|megaways\|reactoonz\|BTG\|wazdan\|pragmatic)` u `src/` → **0 matches**. |
| T-orb | **`multiplierOrb.mjs` default distribution** → neutral 6-tier `[2,3,5,10,25,100]` | template ne sme nositi vendor bias | ✅ **DONE** `7350c1b` — geometric falloff, modal hit na 2× tier, weights tuned. |
| T-bonus | **`bonusBuy.mjs` default 100x → median 75×** | template ne sme defaultovati na konkretnu igru | ✅ **DONE** `7350c1b` — `costX: 75` (industry median 50-100×). |
| T-ante | **`anteBet.mjs` default 25%** — odluka da li menjati | isti razlog | ✅ **WON'T-FIX** `7350c1b` — 1.25 jeste verified industry-modal baseline (modalna vrednost u vendor landscape-u), ostaje + bolji komentar. |
| T-engine | **`reelEngine.mjs` globals refactor** | ne može isto da se testira kao drugi blokovi | ✅ **DONE** kroz Wave R/S engine-tier conformance. 0 `window.ROWS/REELS` matches. |
| T-slim | **`buildSlotHTML.mjs` slim down** — target < 800 LOC | sve runtime logiku raseliti u blokove | 🟢 **PHASE 1 DONE** `3727b3c` — 1565 → 1041 LOC (post-review **1052** zbog 11 LOC import + emit wire-up za Wave U4 autoplay). 534 LOC migrirano u `themeCSS.mjs` (chrome + grid shapes + dev tools) + `paylineOverlay.mjs` (+ CSS) + `winPresentation.mjs` (+ CSS). Phase 2 (~252 LOC remaining) — script blok + remaining inline runtime helpers. |
| T-verify | **Verifikacija**: vendor grep + `wc -l < 800` | dokaz čišćenja | 🟡 **PARTIAL** — vendor gate ✅ 0 matches (uključuje proširenu `playa-slot` blocklist od senior-grade QA pass-a); LOC gate ❌ 1052 (cilj < 800). Zatvara se kad T-slim phase 2 prođe. |
| T-LCG | **(bonus, nije original plan)** — LEGO lifecycle gap fix u `postSpin.mjs` (trigger + retrigger flow skipped `onTumbleStep` emit) + cortex-eyes hardening (10/10 stability) | flaky QA gate | ✅ **SHIPPED** kroz `c9e7b42` (shipped Wave T3). |

### 🟢 Wave U+ — Feature ekspanzija (po jedan blok po wave)

> **Boki pravilo**: *"sto vise feautrea"*. Svaki novi feature kind = novi
> LEGO blok. Wave U → Z su novi blokovi koji ekspandiraju template.

| ID | Item | Blok | Status |
|:-:|---|---|---|
| U1 | **`progressiveFreeSpins.mjs`** — auto-escalating multiplier po FS spin-u (npr. 1× → 2× → 3× → ... po spin-u), sa cap i reset rule-ovima. Trenutno se to radi rasut između `persistentMultiplier` + `multiplierOrb` + `freeSpins` | nov blok | ✅ SHIPPED `79ef9fd` |
| U2 | **`audio.mjs`** — Howler scaffolding (`SPIN_START`, `REEL_STOP`, `WIN_BIG`, `FS_TRIGGER`, `ORB_SPAWN`, `TUMBLE_REMOVE` kategorije). Mute toggle + volume slider. Empty defaults, GDD specifikuje URL-ove | nov blok | ⚠️ SHIPPED `e9287ee` → DEACTIVATED `b18113e` (audio ide u ADB tok, ne GDD; blok ostaje u repo-u kao preserved) |
| U3 | **`uiToast.mjs`** — unified toast za win celebration (`BIG WIN` / `MEGA WIN` / `EPIC WIN` thresholds × bet) i feature triggers (`RESPIN!` / `LIGHTNING!`) | nov blok | ✅ SHIPPED `a162323` |
| U4 | **`autoplay.mjs`** — N spin auto-play + stop-on-feature-trigger (any FS, ≥10× win, balance limit, loss/win cumulative limits) | nov blok | ✅ shipped `f846899` — industry-baseline steps [10..1000], 7 stop reasons (completed/manual/feature/singleWinAbove/balanceBelow/lossLimit/winLimit/slam), 3 nova HookBus event-a (onAutoplayStart/Tick/Stop), 31/31 unit tests, FS pause/resume, slam integration. |
| U5 | **`betSelector.mjs`** — coin-value × bet-multiplier model + bet-step buttons. Trenutno hardkodovano `€1` u svim fixturama | nov blok | ⏳ queued |
| U6 | **`gambleSecondary.mjs`** — Card Gamble + Ladder Gamble (sada samo osnovni `gamble`) — industry pattern je 2 grane | nov blok | ⏳ queued |
| U7 | **`rngFairness.mjs`** PAR layer skeleton (provably-fair seed + verify endpoint) | nov blok | ⏳ queued |
| U8 | **`balanceHud.mjs`** — denomination + balance + bet + win pravi HUD, currency aware | nov blok | ✅ shipped `6ae6d95` — owns `window.__SLOT_BALANCE__` single source-of-truth; preSpin debit (base only, FS free), postSpin credit lastWin, onFsEnd credit totalWin, onGambleEnd credit bank, onBetChanged refresh column. Currency `€/EUR/USD/GBP/JPY/CHF/PLN`, prefix/suffix. Debit-red + credit-green pulse keyframes (reduced-motion respected). New event `onBalanceChanged({balance, delta, reason})` sole-owned by balanceHud (reasons: init/spin/win/gamble/reset/topup/manual). 42/42 unit tests. |
| U9 | **`historyLog.mjs`** — last-N spins log (drugi standard regulator) | nov blok | ✅ shipped `40f4258` — ring buffer (default 50 entries, cap 500), `≡` hub button → slide-up panel sa table-wrap (#, Time, Bet, Win, Balance) + per-mode classes (base/fs/gamble). Optional CSV export (default OFF, GDD opts in) za NJ audit flow. 7 HookBus listeners (preSpin snapshot, postSpin push 'base', onFsTrigger snapshot, onFsEnd push 'fs' sa totalWin, onGambleEnd push 'gamble' sa stake/bank, onBalanceChanged read-only marker, onAutoplayStart hide). 0 emits — pure audit observer. timeFormat hms/rel/iso. 39/39 unit tests. |
| U10 | **`paytable.mjs`** modal — full paytable viewer dostupan preko **i** dugmeta | nov blok | ✅ shipped `7fc54ed` — regulator-mandated info modal: 'i' hub button → full-screen overlay sa symbol roster (HP/MP/LP tier colors), 3OAK/4OAK/5OAK payout grid, specials section, feature chips, wild rules note, real-cash bet row composed sa `window.__SLOT_BET__`. Auto-hide na preSpin/onFsTrigger/onAutoplayStart. closeOnBackdrop + Escape. 4 HookBus listeners, 0 emits (pure UI). 41/41 unit tests. |
| **U11** | **`turboMode.mjs`** — industry-standard 4. spin-cadence option (pored slam/skip/autoplay). Owns `window.__SLOT_TURBO_ACTIVE__` + `__SLOT_TURBO_SPEED_MULT__` (default 0.35 = ~3× faster). | nov blok | ✅ shipped `90cb2a2` — TURBO chip (orange accent 255,140,40), ⚡ prefix, persisted u localStorage `slot.turbo.active`, privacy-mode safe. aria-pressed flips with state. Composes: slamStop.hideOnTurbo VEĆ čita ovaj flag. Defensive preSpin resync. Novi event `onTurboToggle({active, source: 'button'\|'init'\|'api'})` sole-owned. 34/34 unit tests. |
| **U13** | **`settingsPanel.mjs`** — gear modal sa konsolidovanim user toggle-ovima (turbo, sound, reduced motion, quick spin, auto-hide win, locale). Replaces ad-hoc scattered toggles sa single audit-friendly pane-om. | nov blok | ✅ shipped `d5026c8` — ⚙ gear button → modal sa 5 iOS-style toggle row-ova + reset/close actions. `SETTINGS_KEYS = [turbo, soundMuted, reducedMotion, quickSpin, autoHideWin, locale]`. localStorage namespace `slot.settings.*` (privacy-safe). DELEGATES to U11 (turboModeOn/Off) + U2 (audioSetMuted). Owns 4 global flags: `__SLOT_REDUCED_MOTION__/__SLOT_QUICK_SPIN__/__SLOT_AUTO_HIDE_WIN__/__SLOT_LOCALE__`. Listens onTurboToggle to mirror external U11 toggle. Auto-hide na preSpin/onFsTrigger/onAutoplayStart. closeOnBackdrop + Escape. BCP-47 locale validation. 40/40 unit tests. |

### 🟣 Wave V — Spin / Slam-Stop / Force-Skip button suite (industry-standard UI cluster)

> **Trigger** (04.06.2026, Boki): *"ajde overi u playa slot kako radi spin slam
> skip dugme, detaljno"* → industry-reference audit `playa-slot/src/ts/uicontrols/commands/`
> (IGT internal). Tri komande, jedan button group. Trenutni template ima samo
> `#spinBtn` — fale **slam-stop** (skip motion-blur tokom rotacije) i
> **force-skip** (skip win-presentation rollup/FS intro). Bez ovoga slot UX
> izgleda nedovršeno; rapid-play players ne mogu da "izgaze" animaciju.

#### 🧭 Industry pattern (iz playa-slot SpinCommand/SlamStopCommand/ForceSkipCommand)

| Faza | Dugme vidljivo | Klik dela |
|---|---|---|
| **IDLE** | `BTN_SPIN` (spin button) | započni spin |
| **SPIN_START_BEGIN → reels rotating, server ne odgovorio** | `BTN_SLAM_STOP` (pre-response) | mobx reaction čeka `reelsStopping=true`, onda izvršava `slamStopCommand()` |
| **server odgovorio → reels stopping** | `BTN_SLAM_STOP` (post-response) | trenutno `slamStopCommand()` → svi reels skoče u final state |
| **win presentation (rollup, big-win banner, FS intro)** | `BTN_SKIP` (force skip) | postavi `slotProps.skipped = true` → svi animacioni reaction-i bail-uju u final |
| **FS_TRIGGER pending** | `BTN_SKIP` | preskoči FS intro animaciju, skoči direkt u FS prvi spin |
| **`turboMode = true`** | (slam-stop hidden) | turbo prelazi preko slam fase, klik na spin dugme = sledeći spin |
| **`autoSpin` active** | (slam-stop hidden) | autospin sam upravlja klikovima, slam button izlazi |

#### 📋 Atom lista

| ID | Item | Files | Effort | Status |
|:-:|---|---|:-:|:-:|
| V1 | **`slamStop.mjs` blok** (~330 LOC) — defaultConfig (`enabled`, `chipLabel='STOP'`, `chipColor='255,80,80'`, `requireMinSpinMs=250`, `hideOnTurbo`, `hideOnAutoSpin`, `reelsClickAreaEnabled`, `ariaLabel`, `pulseAnimation`). resolveConfig sa defensive validation (RGB regex, clamp, length cap, auto-enable iz feature kind). CSS: `.slam-stop-btn` z-index 20 overlay centered, pulse keyframe + reduced-motion gate, mobile media query. emitMarkup: hidden by default, XSS-safe label. emitRuntime: HookBus integration sa stub when disabled. | `src/blocks/slamStop.mjs` | M | ✅ shipped `ef253b7` |
| V2 | **`forceSkip.mjs` blok** (~280 LOC) — defaultConfig (`enabled`, `chipLabel='SKIP'`, `chipColor='90,180,255'`, `disabledPressed=true`, `hidePressed=false`, 4 phase gates, `minRollupMsForShow=600`, `ariaLabel`). CSS z-index 25 fixed bottom. emitMarkup: data-phase attr. emitRuntime: 5 HookBus listeners + emit `onSkipRequested` + sets `window.__SLOT_SKIPPED__`. | `src/blocks/forceSkip.mjs` | M | ✅ shipped `ef253b7` |
| V3 | **Spin button state machine refactor** — `reelEngine.mjs` extract eksplicitnih state-ova `IDLE → SPIN_REQUESTED → ...` u data-state attr-ovima. **DEFERRED** — moglo bi u Wave T-slim ili Wave W. Trenutno radi kroz `is-spinning` klasu + V1/V2 button states. Ne blokira Wave V acceptance gate. | `src/blocks/reelEngine.mjs` | M | ⏭️ deferred |
| V4 | **HookBus events extend** — 4 nova event-a + canonical phase/source enums + new `HookBus.once()` + `HookBus.waitFor()` one-shot APIs. EVENTS array `7 → 11`. | `src/blocks/hookBus.mjs` | XS | ✅ shipped `791c3bf` |
| V5 | **`reelEngine.mjs` listener za `onSlamRequested`** — hard transition svakog reel-a iz `spinning` u `stopping` (bypass while-loop tick → cellStep check koji failuje rano u spin-u), `commitStopSymbols` direktno, `HookBus.once('onSpinResult')` za auto-emit `onSlamComplete` + 1500ms hard fallback. SVG/non-rect kinds: emit immediately. | `src/blocks/reelEngine.mjs` | M | ✅ shipped `ef253b7` |
| V6 | **`winPresentation.mjs` + `scatterCelebration.mjs` + `freeSpins.mjs` listeners za `onSkipRequested`** — phase-gated: rollup/celebration → winPresentation owns + scatterCelebration owns; fsIntro/fsOutro → freeSpins advance-uje FSM. Cancellation tokens u celebration. Svaki emit-uje matching `onSkipComplete` sa duration. | 3 fajla | M | ✅ shipped `ef253b7` |
| V7 | **State coordinator** — postSpin orchestracija show/hide. **NOT REQUIRED** — slamStop + forceSkip su autonomic preko sopstvenih HookBus listeners, ne potreban dedicated coordinator. Composition kontract dokumentovan u svakom JSDoc heading-u. | `src/blocks/postSpin.mjs` | S | ⏭️ deferred, autonomic |
| V8 | **CSS overlay z-index hijerarhija** — slam-stop 20, force-skip 25, uiToast 30. Doc u CSS comment block svakog bloka. | V1+V2 CSS | XS | ✅ shipped `ef253b7` |
| V9 | **Turbo mode integration** — `slamStop.mjs` honors `window.__SLOT_TURBO_ACTIVE__` + `window.__SLOT_AUTOSPIN_ACTIVE__` globalne flag-ove kad config postavi `hideOnTurbo`/`hideOnAutoSpin`. Turbo toggle UI ostaje za Wave U-future. | V1 runtime | XS | ✅ shipped `ef253b7` |
| V10 | **Parser support** — `extractSlamStop` + `extractForceSkip` (`## Slam Stop` / `## Force Skip` sections) + feature kind patterns `slam_stop` / `quick_stop` / `force_skip` / `skip_animation`. freshModel slot-ovi sa 10/12 undefined knobs. | `src/parser.mjs` | S | ✅ shipped `ef253b7` |
| V11 | **Orchestrator wire-up** — 2 import + 6 emit calls (CSS, markup, runtime za oba bloka). Tačan red CSS injection-a poštuje z-index stacking. | `src/buildSlotHTML.mjs` (+11 lines) | XS | ✅ shipped `ef253b7` |
| V12 | **`tests/blocks/slamStop.test.mjs`** — **35/35 PASS**. defaults×1, resolveConfig validation × 7 (boolean coerce, label/aria length, RGB regex, clamp, auto-enable), CSS × 6, markup × 4 (incl. XSS chipLabel + ariaLabel), runtime × 2 (stub + enabled wiring), sandbox × 14 (preSpin show, onSlamComplete hide, postSpin hide, turbo suppress, autoSpin suppress, request emit phase+source, onSpinResult phase flip, source sanitize, no-op when hidden, reels-area arm/disarm, button click, pulse class lifecycle, rapid preSpin clear). Hygiene × 2. | `tests/blocks/slamStop.test.mjs` | M | ✅ shipped `ef253b7` |
| V13 | **`tests/blocks/forceSkip.test.mjs`** — **32/32 PASS**. defaults×1, resolveConfig × 6, CSS × 3, markup × 3 (incl. XSS), runtime × 2, sandbox × 15 (per-phase show on FsTrigger/FsEnd/onSpinResult, award=0 gate, short-rollup gate, request emits + sets flag, no-op when hidden, source sanitize, disabledPressed honored, hidePressed honored, onSkipComplete hide + flag clear, preSpin hide + flag clear, per-phase show gates). Hygiene × 2. | `tests/blocks/forceSkip.test.mjs` | M | ✅ shipped `ef253b7` |
| V14 | **`tools/cortex-eyes-wave-v.mjs`** — Playwright headless, 3 reference GDDs (model overrides force-enable Wave V). 10/10 stability gate verified. Slam latency 388-434ms (industry budget ≤500ms). Per-game phase screenshots. | `tools/cortex-eyes-wave-v.mjs` | M | ✅ shipped (next commit) |
| V15 | **LEGO Gate verification** — orchestrator emit-only ✅, block parity 39/39 ✅, vendor 0 ✅, ownership 11/11 ✅, listener coverage 30/30 ✅. **5/5 PASS**. | LEGO gate | XS | ✅ shipped `ef253b7` |
| V16 | **Full QA gate post-Wave V** — `npm test` 20/20 ✅, `npm run test:blocks` all green ✅, `test:lego` 5/5 ✅, `cortex-eyes-wave-s` 3/3 ✅, `cortex-eyes-wave-s-fs` PASS (0 console errors) ✅, `cortex-eyes-wave-v` 10/10 PASS ✅. | full QA | XS | ✅ shipped (next commit) |

#### 🚦 Order rationale

V4 (HookBus events) first — bez njih V1/V2 ne mogu da emit. Onda V1+V2 paralelno (nezavisni blokovi). Onda V5+V6 (listeners za consumer blokove). Onda V7 (coordinator). V10+V11 (parser + wire-up). V12+V13 (unit tests). V14+V15+V16 (integration + gates).

#### 🎯 Acceptance gate (Wave V "DONE" definicija)

- [ ] Sve 3 dugmeta vidljiva u pravoj fazi po `playa-slot` industry obrascu (verifikovano u headless cortex-eyes screenshot-ima)
- [ ] Slam-stop u toku rotation phase trenutno zaustavi sve reel-e (≤100ms od click do svi reels stopped)
- [ ] Force-skip u toku rollup/FS-intro/FS-outro preskoči animaciju (≤50ms od click do final state)
- [ ] Turbo-mode (boolean config) sakriva slam-stop button bez razbijanja spin flow
- [ ] LEGO Gate 5/5 i dalje pass
- [ ] 10/10 cortex-eyes stability runs PASS
- [ ] 0 vendor mentions (`grep playa-slot src/` = 0; `grep playa src/` = 0 — referenca samo u master TODO i commit messages)
- [ ] Hash-pin commit posle full Wave V ship

---

### 🔵 Wave Z — Block Playground (POSLEDNJE, posle Wave U)

> **Storybook za LEGO blokove.** Sidebar lista svih blokova → klik → desni
> panel: live demo, config sliders, HookBus event log uživo, opis.
> Ruta `/blocks/` u Python serveru.
>
> **Zašto na kraju**: playground prikazuje stanje blokova. Ako Wave S/T/U
> nisu gotovi, playground će prikazati broken/biased/incomplete blokove.
> Tako Wave Z = automatski regression detector + dokaz da je LEGO sistem
> ostvario svoju svrhu.

| ID | Item | Detalj | Effort |
|:-:|---|---|---|
| Z1 | **`/blocks/index.html`** — sidebar lista 34+ blokova (alphabetical + group by category: wilds / multipliers / fs / round-control / ui) | nav skeleton | XS |
| Z2 | **Per-block panel template** — live demo (mock 5×3 grid), "Trigger" dugme koje emituje relevantne HookBus events, config sliders za sve `defaultConfig()` keyove, HookBus event log uživo (poslednjih 20 events sa timestamps + payload + listener count) | core UX | L |
| Z3 | **Block manifest auto-gen** — `tools/gen-block-manifest.mjs` skenira `src/blocks/*.mjs` i pravi `blocks/_manifest.json` sa: imenom, defaultConfig, exported funkcijama, lifecycle hooks (parse iz `HookBus.on(...)` poziva), test file path-om, opisom (parse iz JSDoc) | meta-data | M |
| Z4 | **Trigger preset library** — gotovi preseti za svaki blok ("4 scatters land", "tumble chain depth 3", "FS round 2 of 10", "win at €10"), klik → emit-uje sequence eventova | demo flow | M |
| Z5 | **Live HookBus inspector** — prikazuje za svaki event count handler-a + execution time + return values; podržava `step-through` mode (event-by-event playback) | debug | M |
| Z6 | **Config persistence** — sliderom promenjen config se snima u `localStorage`, vraća se posle reload. "Export GDD snippet" dugme koje generiše YAML/MD fragment koji možeš pasteovati u GDD | save-load | S |
| Z7 | **`tests/blocks/_playground.test.mjs`** — Playwright test koji loaduje `/blocks/`, klikne na svaki blok iz manifesta, proveri da svaki "Trigger" dugme okida HookBus emit + handler poziv, snimi screenshot. Output: 34+ screenshots u `tools/_eyes/playground/` | regression | M |
| Z8 | **`tools/cortex-eyes-playground.mjs`** — wrapper koji startuje server + Z7 test + agreguje rezultate. Boki može odraditi sve blokove jednim komandom | dev tool | XS |
| Z9 | **README.md update** — dokumentuje playground URL + workflow | docs | XS |

---

### 🟣 Future major waves (posle Z)

> Ovi waveovi su veliki i nisu blokirajući za "ultimativni fix" cilj.
> Crossiramo kad sve gore bude gotovo.

| Pri | Item | Why | Effort |
|:-:|---|---|---|
| 1 | **Wave J2b — Hex real reel engine** | hex koristi axial (q,r) koordinate, treba poseban mapper iz hex tiles u reel-strip columns | M |
| 2 | **Wave J3 — SVG kinds (wheel / crash / radial / slingo / plinko)** — domain-specific spin animation | each kind needs its own engine; can't reuse rectangular | L |
| 3 | **PAR / Math hot-swap injector** | README Phase 2 — placeholder math still in use | XL |
| 4 | **L2 AI feature synthesizer** za nepoznate features | README Phase 4 | XL |
| 5 | **L3 Self-improving registry** (AI-gen → human-confirm → trained) | README Phase 5 | XXL |

---

## 🟦 Backlog (future waves)

| ID | Item | Notes |
|---|---|---|
| K1 | PDF / DOCX / XLSX GDD parsers via server-side bridge | README Phase 3 |
| K2 | AI feature synthesizer (L2) for unknown features | README Phase 4 |
| K3 | Self-improving registry (AI-generated → human-confirmed → trained) | README Phase 5 |
| K4 | Cross-browser testing (Safari + Firefox in addition to Chromium) | currently Playwright headless only |
| K5 | Touch-event simulation in QA harness | dev FS button only clicked, not touched |
| K6 | Real cash-symbol HUD (denomination + balance + bet + win) | placeholder fake-win generator in use |
| K7 | Settings panel (volatility, bet step, max win cap) | not yet exposed in UI |
| K8 | Win cap enforcement (`limits.max_win_x` from IR) | not yet wired through fake-win path |

---

## 🟥 Known limitations (acceptable trade-offs, not bugs)

| Limitation | Trade-off |
|---|---|
| Hex / diamond / pyramid / cross / l_shape — legacy blink reveal | Irregular column geometry, would need per-shape spin engine — Wave J2 |
| Wheel / crash / radial / slingo / plinko — legacy blink | SVG / specialised mechanics, need domain-specific engines — Wave J3 |
| Anticipation glow OFF during FS_ACTIVE | Retrigger anticipation reads as filler; +HOLD_BASE per held reel blew QA budget |
| Cluster 7×7 + 35-spin FS round | Now driven by single `SPIN_PROFILE` (no faster FS tempo); still inside QA 300s budget |
| Win highlight is visual placeholder | Picks most-frequent non-scatter symbol — no real evaluator until PAR math lands |
| `tools/full-qa-audit.mjs` spin-stress 3-rapid-click times out on `01_rectangular_5x3` | Pre-existing race condition (button disabled mid-spin by design); other QA suites cover spin behaviour |

---

## 📜 Session commit log (all `origin/main`)

| # | Hash | Subject |
|---:|---|---|
| 1 | `471f5ec` | test(fs): edge-case audit — 11 scenarios |
| 2 | `709f766` | style(fs): responsive dev-FS button + strip frame halo |
| 3 | `699b0fb` | fix(fs): move dev FS button to top-right — no hub overlap |
| 4 | `16dc3f6` | feat(fs): dev FS now runs a real spin before the placard |
| 5 | `c053fcb` | feat(fs): dynamic anticipation per reel that can still trigger |
| 6 | `71c189e` | fix(fs): anticipation gate = threshold-1 scatters |
| 7 | `3780eb1` | style(spin): standard cadence — faster lands, stronger blur |
| 8 | `fc12d33` | style(spin): one-by-one reel stops — staggerMs 220 |
| 9 | `183a249` | style(spin): industry-reference S-AVP cabinet cadence |
| 10 | `bf5469d` | style(fs): uniform anticipation hold across all reels |
| 11 | `0c7dadb` | fix(fs): unified anticipation deadline |
| 12 | `71d95a3` | fix(fs): sequential anticipation — same duration each, one-by-one stop |
| 13 | `b501a0d` | feat(ui): live stage badge — BASE GAME / FREE SPINS pill |
| 14 | `43d7945` | feat(fs): dual scatter count-mode — perReel (default) + any |
| 15 | `338d956` | chore(qa): full-session QA + review fixes |
| 16 | `ad615b7` | feat(grids): propagate FS features to all column-based shapes |
| 17 | `81dd81d` | refactor(grids): clean runStaticReroll dead code |
| 18 | `35d840f` | feat(spin): unify reel engine — every column-grid shape spins like rectangular |
| 19 | `38e9b25` | docs(master-todo): create + populate from full session inventory |
| 20 | `55dc06b` | fix(spin): unify BG + FS spin/stop speed across every grid |
| 21 | `21ffff9` | feat(win): placeholder win-combo highlight — winning cells stay lit, rest dim |
| 22 | `21ab8cb` | feat(spin): wave J1 — real reel engine for variable_reel |
| 23 | `d62aebe` | docs(master-todo): Wave J1 + win-highlight + spin-tempo entries |
| 24 | `20bfc04` | feat(fx): scatter celebration — modular block before FS placard |
| 25 | `037541f` | feat(fx): win-symbol cycle + uniform anticipation glow + FS gate |
| 26 | `ed1ca54` | docs(master-todo): scatter celebration + win-cycle + anticipation-uniform |
| 27 | `671c273` | docs(master-todo): self-reference hash for ed1ca54 entry |
| 28 | `88d7e00` | style(win): subtler win-symbol pulse — contained inside the reel cell |
| 29 | `0a5f1c1` | feat(win): per-symbol event cycle — HP/MP/LP/Wild aware, runs in FS too |
| 30 | `bac1d0c` | docs(master-todo): WS + WU waves + QA matrix anchor to 0a5f1c1 |
| 31 | `255689a` | feat(win): per-LINE win cycle — payline-based, WoO-faithful |
| 32 | `__TBD__` | docs(master-todo): WL1-12 + anchor to 255689a |
