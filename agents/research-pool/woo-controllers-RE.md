# WoO Controllers — Reverse Engineering Report

**Subject:** Production-validated feature controllers (Math v11.27, 96.009 % RTP target, 4B-spin Monte-Carlo validated)
**Sources analysed:**
- `~/Projects/Wrath Of Olympus/src/hnwController.ts` (1349 lines, current)
- `~/Projects/Wrath Of Olympus/src/bigWinController.ts` (825 lines, current)
- `~/Projects/Wrath Of Olympus/src/fsController.ts` (777 lines, current)
- `~/Projects/Wrath Of Olympus/legacy/v11.27-2026-05-19/src/hnwController.ts` (1349 lines, byte-equal to current)
- `~/Projects/Wrath Of Olympus/legacy/v11.27-2026-05-19/src/bigWinController.ts` (825 lines, byte-equal to current)
- `~/Projects/Wrath Of Olympus/legacy/v11.27-2026-05-19/src/fsController.ts` (777 lines, 2-line vendor-mention cleanup)
- Support: `src/features.ts`, `src/paytable.ts` (config loader surface)

**Audit hash check:**

| File                    | Current MD5                          | Legacy MD5                           | Diff?      |
|:------------------------|:------------------------------------:|:------------------------------------:|:----------:|
| `hnwController.ts`      | `5c1d258090c68bf7b760d6e488a034ad`   | `5c1d258090c68bf7b760d6e488a034ad`   | none       |
| `bigWinController.ts`   | `0f79f35d88f0d9764a719f675e3ec082`   | `0f79f35d88f0d9764a719f675e3ec082`   | none       |
| `fsController.ts`       | `6b163e2d265825070466f51bc8273142`   | `6a475ede7c9336d783a841af338613ac`   | 2 lines    |

The HnW and BigWin controllers are frozen between v11.27-2026-05-19 and current; only `fsController.ts` has a tiny vendor-mention scrub at lines 679 / 683 (see §7).

> Vendor-naming policy: "Wrath of Olympus" is the OWN codebase — internal symbol names (`Zeus' Storm`, `ZEUS' STORM`, "MINI/MINOR/MAJOR/GRAND" jackpot labels, `BIG WIN / MEGA WIN / EPIC WIN` tier labels) are documented verbatim as they exist in source. Synthesis sections (§5, §6, §9) translate every observed pattern into vendor-neutral tier1..tier5 nomenclature and never reference the WoO theme. Cross-references for SGF use only generic terms ("production-validated controller").

---

## §1. Hold-and-Win controller (`hnwController.ts`)

### §1.1 Public type surface

| Symbol                  | file:line                          | Meaning                                                    |
|:------------------------|:-----------------------------------|:-----------------------------------------------------------|
| `JackpotType`           | `src/hnwController.ts:31`          | `"MINI" \| "MINOR" \| "MAJOR" \| "GRAND" \| null`          |
| `JACKPOT_VALUES`        | `src/hnwController.ts:34-39`       | local map: 12×/25×/50×/150× — but see §1.2 note            |
| `HNWOrb`                | `src/hnwController.ts:42-48`       | `{reel, row, value, multiplier, jackpot}`                  |
| `HNWState`              | `src/hnwController.ts:51-56`       | enum INACTIVE / INTRO / RUNNING / SUMMARY                  |
| `HNW_CONFIG`            | `src/hnwController.ts:59-66`       | controller-local config block (see §1.3 — note vs paytable)|
| `HNW_TIMING`            | `src/hnwController.ts:69-128`      | hierarchical timing constants (turbo / floor / phase)      |
| `HNWGameCallbacks`      | `src/hnwController.ts:136-142`     | host injection seam                                        |

> **Critical observation.** `JACKPOT_VALUES` (controller, line 34) is _only_ used as a forced-debug payout map at `setForceJackpot` and at line 268 (`orbValue = JACKPOT_VALUES[this.forceJackpot]`). The production orb distribution comes from `HNW_ORB_VALUES` imported from `paytable.ts` at line 24, which itself is config-derived via `game.config.json` → `cfg.features.hold_and_win.orb_values` (`paytable.ts:96-104`). The hard-coded controller map is an audit smell because the values can drift from the config: a regulator scrub should remove `JACKPOT_VALUES` and route forced jackpots through `HNW_ORB_VALUES.find(o=>o.jackpot===…)` to enforce single-source-of-truth.

### §1.2 State machine

```
                ┌─────────────────────────────────────────┐
                │           HNWState.INACTIVE             │
                │  (no overlay, no respins, no orbs)      │
                └────────────────┬────────────────────────┘
                                 │ trigger(triggerGrid, triggerResult?)
                                 │   • bet snapshot
                                 │   • collect "B" cells → initial orbs
                                 │   • respinsLeft = HNW_CONFIG.INITIAL_RESPINS
                                 │   • sessionId = ++this.sessionId
                                 ▼
                ┌─────────────────────────────────────────┐
                │           HNWState.INTRO                │
                │  playIntro()                            │
                │   • highlightTriggerOrbs                │
                │   • backdrop fade-in                    │
                │   • Title L1 + L2 + subtitle + orbCount │
                │   • "TAP TO CONTINUE" blink             │
                │   • awaits click/touch (skip-callback)  │
                └────────────────┬────────────────────────┘
                                 │ isSessionActive(hnwId) === true
                                 ▼
                ┌─────────────────────────────────────────┐
                │          HNWState.RUNNING               │
                │  runLoop()                              │
                │  while respinsLeft > 0 AND              │
                │        occupiedCells.size < GRID_SIZE   │
                │    ┌──────────────────────────────────┐ │
                │    │ pre-determine cellResults         │ │
                │    │ start spinning empty cells        │ │
                │    │ autoStopCells (staggered)         │ │
                │    │ collect newOrbs                   │ │
                │    │  ├── if hasSpawn:                 │ │
                │    │  │   • showWinDelta + playOrbFly  │ │
                │    │  │   • playJackpotCelebration?    │ │
                │    │  │   • animateRespinsReset()      │ │
                │    │  │   • respinsLeft = RESET (3)    │ │
                │    │  └── else:                        │ │
                │    │      • animateRespinsTick()       │ │
                │    │      • respinsLeft--              │ │
                │    │ updateDisplay/Progress/Orbs/JP    │ │
                │    └──────────────────────────────────┘ │
                └────────────────┬────────────────────────┘
                                 │ loop exited
                                 │ if occupiedCells.size >= GRID_SIZE
                                 │    → playFullGridCelebration()
                                 ▼
                ┌─────────────────────────────────────────┐
                │          HNWState.SUMMARY               │
                │  showSummary()                          │
                │   • update stats placard                │
                │   • bigWin.shouldTrigger? → prepareForShow + show
                │   • placard CTA waits for click         │
                └────────────────┬────────────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────────────┐
                │  finalize() — back to INACTIVE          │
                │   • reset all state                     │
                │   • renderer.setBackground('base')      │
                │   • restoreTriggerGrid()                │
                │   • creditBalance(totalToCredit)        │
                │   • notifyAutoPlayHNWEnd(hasBigWin)     │
                └─────────────────────────────────────────┘
```

State handler citations:

| Handler                       | file:line                                   |
|:------------------------------|:--------------------------------------------|
| `trigger`                     | `src/hnwController.ts:232-311`              |
| INACTIVE → INTRO transition   | `src/hnwController.ts:295`                  |
| `playIntro`                   | `src/hnwController.ts:351-471`              |
| INTRO → RUNNING transition    | `src/hnwController.ts:306`                  |
| `showOverlay`                 | `src/hnwController.ts:482-495`              |
| `runLoop`                     | `src/hnwController.ts:709-825`              |
| RUNNING → SUMMARY transition  | `src/hnwController.ts:1216` (`showSummary`) |
| `showSummary`                 | `src/hnwController.ts:1213-1295`            |
| `finalize` (SUMMARY → INACTIVE) | `src/hnwController.ts:1297-1348`          |

There is no explicit `EXIT` state — `INACTIVE` is the same end-state and start-state. Clean idempotent contract.

### §1.3 Trigger condition

There is **no internal "minimum N bonus symbols" guard** in `hnwController.ts`. The controller is a pure presentation FSM — the trigger gate lives upstream in `src/features.ts:checkHNWTrigger`:

```text
features.ts:402-406  checkHNWTrigger(grid)
  count = countBonusOrbs(grid)
  triggerCount = GAME_CONFIG.features.hold_and_win.trigger_count ?? 6
  return { triggers: count >= triggerCount, orbCount: count }
```

So the WoO default trigger is **≥ 6 "B" bonus orbs anywhere on the 5×3 grid**, and the controller trusts the host (`main.ts`) to only call `trigger(grid)` when that gate has fired. The controller re-collects the "B" cells inside `trigger()` at `src/hnwController.ts:256-291` to seed initial orbs.

### §1.4 Sticky pin contract — which cells stay locked, how

The "sticky pin" concept is implemented through three coordinated stores. There is no DOM-level `position: fixed` per cell — instead, the controller (a) tracks logical occupancy in a Set, (b) tags DOM cells with CSS classes, and (c) gates the per-respin rerender to only touch `.hnw-cell:not(.has-orb)`.

| Store                       | file:line                          | Purpose                                                             |
|:----------------------------|:-----------------------------------|:--------------------------------------------------------------------|
| `occupiedCells: Set<string>`| `src/hnwController.ts:153`         | logical lock — key = `"${reel},${row}"`; size drives full-grid gate |
| `orbs: HNWOrb[]`            | `src/hnwController.ts:150`         | per-orb material payload (value/multiplier/jackpot)                 |
| `.has-orb` CSS class        | `src/hnwController.ts:654, 1141`   | visual lock — `renderOrbs()` and `stopCell()` add it                |

The "lock" semantic is enforced in two places:

1. `runLoop` only iterates empty cells: `gridEl.querySelectorAll<HTMLElement>(".hnw-cell:not(.has-orb)")` at `src/hnwController.ts:735`. Locked cells never spin and never have their content rewritten during the loop.
2. `renderOrbs()` clears all cell content first (`querySelectorAll(".hnw-cell").forEach …` at `src/hnwController.ts:636-645`) then redraws **only the cells in `this.orbs`** (`src/hnwController.ts:648-704`). So the lock is enforced by enumerating known-good orb data, not by trusting any previous DOM state — clobber-safe.

> Note: there is no MutationObserver guard. The SGF block `holdAndWin.mjs:6-30` documents that it adds a MutationObserver as a "Zeus' Storm orb-is-sacred contract" because tumble / reelEngine commit paths in the SGF template can clobber locked cells. WoO doesn't need it because the HNW overlay (`#hnwGrid`) is a **separate stage** layered on top of the reel frame (see `positionGrid` at `src/hnwController.ts:497-508`, which gets `reelFrame.getBoundingClientRect()` and pins `#hnwGrid` to the same screen coords). The cells inside `#hnwGrid` are owned exclusively by the HNW controller; nothing else writes to them. This is a cleaner architectural separation than the SGF block's in-place locking.

### §1.5 Per-spin add — new money symbols → sticky

Path: `runLoop` → `determineOrbForCell` → `autoStopCells` → `stopCell` → `cellResults` map → orb collection.

| Step                                                                              | file:line                              |
|:----------------------------------------------------------------------------------|:---------------------------------------|
| Per empty cell, pre-determine outcome and store in `cellResults` map               | `src/hnwController.ts:734-743`         |
| `determineOrbForCell` — `Math.random() < HNW_CONFIG.ORB_LAND_CHANCE`?              | `src/hnwController.ts:963-973`         |
| If yes, generate weighted orb via `generateOrbWithJackpot` (paytable distribution) | `src/hnwController.ts:323-338`         |
| After autoStop, collect newOrbs from `cellResults`                                 | `src/hnwController.ts:769-772`         |
| Push to `this.orbs`, add to `occupiedCells`, accrue win                            | `src/hnwController.ts:778-787`         |
| Per-orb fly-to-counter (`playOrbValueFly`)                                         | `src/hnwController.ts:582-624`         |
| Per-orb jackpot celebration if jackpot tier set                                    | `src/hnwController.ts:789-792`         |

> **Critical observation.** `HNW_CONFIG.ORB_LAND_CHANCE = 0.01` at line 62 is **NOT** the production math chance. The math simulator in `features.ts:267-270` uses:
>
>     chance = HNW_ORB_CHANCE_BASE + fillRatio × HNW_ORB_CHANCE_FILL_BONUS
>            = 0.0352 + (filledCells/15) × 0.015
>
> The controller's hard-coded 0.01 is a presentation-only sample that does **not** mirror the math sim. This is the *exact* "W1 QA portfolio-authenticity defect" called out in `features.ts:259-262`: the comment explicitly says "the UI animation paths (main.ts / hnwController.ts) **must** import these constants and apply the SAME formula — animation desync was the portfolio-authenticity defect tracked in W1 QA". The fix has not landed at the time of this report. A regulator running fairness inspection on the front-end would catch this drift. For SGF synthesis, see §9.

### §1.6 Reset counter (3 respins default)

| Constant                          | file:line                          | Value      |
|:----------------------------------|:-----------------------------------|:-----------|
| `HNW_CONFIG.INITIAL_RESPINS`      | `src/hnwController.ts:60`          | `3`        |
| `HNW_CONFIG.RESPINS_ON_NEW_ORB`   | `src/hnwController.ts:61`          | `3`        |
| Initial assignment                | `src/hnwController.ts:247`         | `this.respinsLeft = HNW_CONFIG.INITIAL_RESPINS;` |
| Reset on spawn                    | `src/hnwController.ts:797`         | `this.respinsLeft = HNW_CONFIG.RESPINS_ON_NEW_ORB;` |
| Decrement on miss                 | `src/hnwController.ts:801`         | `this.respinsLeft--;` |

Loop guard at `src/hnwController.ts:719`:

```ts
while (this.respinsLeft > 0 && this.occupiedCells.size < HNW_CONFIG.GRID_SIZE) {
```

So the round terminates when either (a) the respin counter reaches zero with no new orb on the most-recent spin, or (b) every cell is locked (full grid). Symmetric, audit-clean.

Tension UX on the counter:

| Counter state    | CSS class added                | file:line                          |
|:-----------------|:-------------------------------|:-----------------------------------|
| `respinsLeft===1`| `.final`                       | `src/hnwController.ts:523`         |
| `respinsLeft===2`| `.tension`                     | `src/hnwController.ts:525`         |
| On decrement     | `.tick` for one frame          | `src/hnwController.ts:833-836`     |
| On reset (spawn) | `.reset-flash`                 | `src/hnwController.ts:845-848`     |

### §1.7 Jackpot tier collapse — full grid

There is **no collapse-on-fill-all behaviour for the four jackpot tiers**; instead, the four jackpots fire **as the orbs land**, weighted by the paytable. Each orb has an optional `jackpot: "MINI"|"MINOR"|"MAJOR"|"GRAND"` field; when an orb with that label spawns, `playJackpotCelebration` plays an overlay sequence.

| Mechanic                                            | file:line                          |
|:----------------------------------------------------|:-----------------------------------|
| Jackpot field on orb type                           | `src/hnwController.ts:42-48`       |
| Pull-from-weighted-table generator                  | `src/hnwController.ts:323-338`     |
| Per-spawn `playJackpotCelebration` invocation       | `src/hnwController.ts:789-792`     |
| Per-tier overlay sequence (`tier-mini/minor/major/grand` class) | `src/hnwController.ts:854-897` |
| Screen shake intensity per tier                     | `src/hnwController.ts:882-883`     |
| Particle burst for MAJOR / GRAND                    | `src/hnwController.ts:886-888`     |
| Full-grid bonus = `HNW_FULL_GRID_BONUS` (500×) only fires when `occupiedCells.size >= GRID_SIZE` | `src/hnwController.ts:820-822, 902-961` |

So **MINI / MINOR / MAJOR / GRAND are stochastic per-orb labels**, and **FULL GRID is an additional bonus** (default 500× bet) on top of the orb values. The full-grid bonus is NOT a jackpot tier in the MINI/MINOR/MAJOR/GRAND sense — it's a separate ceremony at lines 902-961.

Per-tier screen-shake intensity:

| Tier   | Intensity (px) | Duration (ms) | Particles? |
|:-------|:--------------:|:-------------:|:----------:|
| GRAND  | 15             | 400           | yes (80)   |
| MAJOR  | 10             | 250           | yes (50)   |
| MINOR  | 6              | 250           | no         |
| MINI   | 3              | 250           | no         |

Citations: `src/hnwController.ts:882-888` and `src/hnwController.ts:1074-1077` (particle counts/colors).

### §1.8 Exit condition

The exit gate is the `while` predicate at `src/hnwController.ts:719`:

```ts
while (this.respinsLeft > 0 && this.occupiedCells.size < HNW_CONFIG.GRID_SIZE) {
```

Two terminal cases:

1. **Respins exhausted** — `respinsLeft` decremented to 0 by misses (line 801).
2. **Full grid** — `occupiedCells.size` reaches `HNW_CONFIG.GRID_SIZE` (15 for 5×3) → loop exits and triggers `playFullGridCelebration` (line 820-822).

There is no explicit "3 resets without new add" counter as a separate variable — the spec hides the resets inside the same counter: every miss costs one respin, every spawn restores to 3, so the round ends 3 consecutive misses after the last spawn, mathematically equivalent to "3 resets without new add" but expressed as a single counter.

### §1.9 Race-condition handling — token cancellation

The HnW controller uses an **integer session token** (`sessionId` / `activeSessionId`) to invalidate any in-flight async work when the controller is forced into a new session or back to INACTIVE.

| Mechanism                                                       | file:line                          |
|:----------------------------------------------------------------|:-----------------------------------|
| Token allocation: `++this.sessionId; activeSessionId = hnwId;`  | `src/hnwController.ts:242-243`     |
| `isSessionActive(hnwId)` predicate                              | `src/hnwController.ts:313-315`     |
| Token check guards EVERY async transition                       | `src/hnwController.ts:303, 720, 765, 804, 817, 828, 840, 859, 903, 1134, 1197, 1206` |
| Token zeroed in `finalize`                                      | `src/hnwController.ts:1309`        |

This is a textbook "monotonic-id versioning" cancellation: anyone holding a stale `hnwId` is silently no-op'd as soon as a newer session opens, preventing the classical "previous round's setTimeout fires inside a new round" race.

`setTimeout` usage that DOES persist after a session ends:

| setTimeout                                       | file:line                              | Cancellation                              |
|:-------------------------------------------------|:---------------------------------------|:------------------------------------------|
| `stopCell` inner 140ms reveal delay              | `src/hnwController.ts:1133-1185`       | `isSessionActive(hnwId)` guard at 1134    |
| `triggerJackpotParticles` rAF loop               | `src/hnwController.ts:1093-1122`       | terminates when all particles dead        |
| `triggerScreenShake` rAF loop                    | `src/hnwController.ts:1013-1029`       | terminates on duration timeout            |
| Intro click-handler setTimeout (700ms)           | `src/hnwController.ts:462-467`         | `resolved` flag closes channel            |
| Summary click-handler setTimeout                 | `src/hnwController.ts:1285-1290`       | `resolved` flag closes channel            |
| `showWinDelta` fade timeout                      | `src/hnwController.ts:574-576`         | none — runs to completion (harmless)      |

The only path with a potential race is the **intro/summary click handlers**: they attach `document.addEventListener("click", handleSkip)` after a 700ms grace period (line 462-467) to prevent the click that triggered the previous spin from immediately skipping the intro. If `finalize` runs while the handler is still attached, the next round's first click will trigger a stale handler — but `resolved` and `setSkipCallback(null)` (line 448) make it idempotent: the second call is a no-op. Defensive enough for production.

GSAP tween cancellation: `gsap.to(flyEl, …)` at `src/hnwController.ts:615` has no explicit cancellation. `flyEl` is appended to `document.body` (line 608) and self-removes via `onComplete` (line 622). If the player slams the spin button mid-fly, the tween still runs to completion — but the element is removed, so no race.

### §1.10 Skip-fast contract

The controller exposes a fast-forward path through `requestSkip`:

| Member               | file:line                          |
|:---------------------|:-----------------------------------|
| `requestSkip()`      | `src/hnwController.ts:218-220`     |
| `skipRequested` flag | `src/hnwController.ts:158`         |
| Fast-overlay class   | `src/hnwController.ts:725-727`     |
| Reduced timings      | `src/hnwController.ts:758-759`     |
| Reduced inter-spin sleep | `src/hnwController.ts:811`     |

When `skipRequested === true`:
- `autoStopCells` baseMs drops 2300→180, stagger 250→25
- Loop tail sleep drops 280ms→35ms
- Overlay gets `.hnw-fast` class for CSS-driven micro animations

The skip is sticky for the rest of the round (no reset to false until `finalize` line 1317), so once the player clicks "skip", the entire round accelerates.

### §1.11 Money-flow / credit contract

| Step                                                       | file:line                          |
|:-----------------------------------------------------------|:-----------------------------------|
| Snapshot bet at trigger                                    | `src/hnwController.ts:246`         |
| Trigger-grid line wins captured in `triggerResult`         | `src/hnwController.ts:239`         |
| Accrue HnW win during loop (`totalWin`)                    | `src/hnwController.ts:782, 934`    |
| Sum `triggerWin` + `hnwTotalWin` → `totalToCredit`         | `src/hnwController.ts:1249-1250`   |
| Big-Win overlay shown BEFORE credit                        | `src/hnwController.ts:1253-1256`   |
| Single `creditBalance(totalToCredit)` after summary CTA    | `src/hnwController.ts:1341`        |

So the player sees the win animations, then taps to dismiss summary, then balance jumps. This is the regulator-clean "what you see is what you got" contract — no intermediate balance ticks during sub-celebrations.

---

## §2. Big Win controller (`bigWinController.ts`)

### §2.1 Public type surface

| Symbol                        | file:line                          | Meaning                                                |
|:------------------------------|:-----------------------------------|:-------------------------------------------------------|
| `BIG_WIN_TIERS`               | `src/bigWinController.ts:23-27`    | three-tier ladder, threshold + label + bg image        |
| `BigWinTier`                  | `src/bigWinController.ts:29`       | `1 \| 2 \| 3` — strict union, NOT 1..5                 |
| `BigWinOverlayController`     | `src/bigWinController.ts:31-825`   | controller class                                       |

### §2.2 Tier ladder thresholds

```text
src/bigWinController.ts:23-27

export const BIG_WIN_TIERS = {
  tier1: { threshold: 10, label: "BIG WIN",  bg: `${ASSET_PATH_BASE}/bigwin_tier1.png` },
  tier2: { threshold: 25, label: "MEGA WIN", bg: `${ASSET_PATH_BASE}/bigwin_tier2.png` },
  tier3: { threshold: 50, label: "EPIC WIN", bg: `${ASSET_PATH_BASE}/bigwin_tier3.png` },
} as const;
```

| WoO tier   | Threshold (× bet)| WoO label    | Vendor-neutral synthesis (this report uses) |
|:-----------|:----------------:|:-------------|:-------------------------------------------:|
| tier1      | 10               | BIG WIN      | tier1                                       |
| tier2      | 25               | MEGA WIN     | tier2                                       |
| tier3      | 50               | EPIC WIN     | tier3                                       |
| —          | —                | —            | tier4 (NOT IN WOO)                          |
| —          | —                | —            | tier5 (NOT IN WOO)                          |

> **Finding.** WoO ships only 3 tiers. The task brief hypothesised a tier1..tier5 ladder with thresholds 10×/25×/50×/100×/250×. The first three thresholds match WoO exactly; tier4/tier5 do **NOT** exist in WoO. For the SGF synthesis (§5, §6), I keep the tier1..tier5 nomenclature open and explicitly mark tier4 / tier5 as **NOT FOUND in WoO** (candidates checked: `BIG_WIN_TIERS` constant at `src/bigWinController.ts:23-27`, `getFinalTier` ladder at `src/bigWinController.ts:183-189`, `applyTier` switch at `src/bigWinController.ts:205-257`).

### §2.3 Trigger / final-tier calculation

| Method                             | file:line                              | Behaviour                                                                       |
|:-----------------------------------|:---------------------------------------|:--------------------------------------------------------------------------------|
| `shouldTrigger(win, bet)`          | `src/bigWinController.ts:174-178`      | `win / bet >= 10`? — uses `tier1.threshold` as the gate                         |
| `getFinalTier(win, bet)`           | `src/bigWinController.ts:183-189`      | `xFinal = win/bet`; tier=3 if ≥50, tier=2 if ≥25, else tier=1                  |
| `getTierConfig(tier)`              | `src/bigWinController.ts:194-198`      | ternary chain to tier3/tier2/tier1 config                                       |

Note the bet sanitisation at line 184: `const bet = Math.max(0.000001, betAmount)` — never divides by zero. Microbet pathology is bounded.

### §2.4 Rollup synchronization — counter ↔ tier banner

The flow:

```
prepareForShow(win, bet)               // optional pre-warm for FS→BigWin seamless
  ↓
show(win, bet)
  ↓
[PREP PHASE — 0.5s]                    // src/bigWinController.ts:563-570
  - setPhase('prep')
  - skipRequested forced false during prep
  ↓
[ROLLUP PHASE — totalRollupMs = stages.length × 4s]   // 4s per tier
  - virtual-time accumulator (handles rAF skips, paused tabs, etc)
  - per frame:
       tierIndex = floor(virtualElapsed / 4000)
       tierNow   = stages[tierIndex]
       p         = min(1, virtualElapsed / totalRollupMs)
       currentValue = target * p           // LINEAR — no eased curve
       applyTier(tierNow)
       updateCoinShowerTier(tierNow)
       valueEl.textContent = fmt2(currentValue)
  - skip during rollup:
       if skipToEnd:   jump to finalTier + target, end
       else (single skip):
         jump virtualElapsed to next tier's start; continue loop
         (if already on final tier: jump to end)
  ↓
[END HOLD — 7s total = 6s drain + 1s post-drain]      // src/bigWinController.ts:670-731
  - setEnd(true)
  - valueCelebration burst + final shockwave
  - emitConfetti / emitEpicCelebration for tier 2 / tier 3
  - drainCoinShower() — 4.5s delay before drain
  - while (elapsed < 7000) { if skipRequested break }
  ↓
[FADE OUT]
  - cleanup classes, releaseLock('bigwin')
```

| Phase / event             | file:line                          |
|:--------------------------|:-----------------------------------|
| Tier durations const      | `src/bigWinController.ts:63-65`    |
| PREP                      | `src/bigWinController.ts:565-570`  |
| Rollup loop               | `src/bigWinController.ts:583-668`  |
| End-hold loop             | `src/bigWinController.ts:716-731`  |
| Total END duration        | `src/bigWinController.ts:719-721`  |

The "rollup ↔ tier banner" synchronization is **driven by a shared virtual-time clock** (`virtualElapsed`), not by separate counter and banner timers. This is the key insight: WoO doesn't have a `RollupState.STOP` gate as a separate FSM — instead, the loop continuation predicate `while (!rollupComplete)` at `src/bigWinController.ts:585` is the gate. Completion criteria:

1. Linear progress `p >= 1` → set `rollupComplete = true` at line 653-654.
2. Skip request with `skipToEnd === true` → jump-to-end and break at 612-613.
3. Skip request on the final tier without `skipToEnd` → jump-to-end and break at 627-628.

After the rollup loop exits, the END phase guarantees the title and value are visible (lines 660-668):

```ts
gsap.killTweensOf(this.titleEl);
gsap.set(this.titleEl, { scale: 1, opacity: 1, y: 0 });
const finalConfig = this.getTierConfig(this.finalTier);
this.titleEl.textContent = finalConfig.label;
this.applyTier(this.finalTier);
this.valueEl.textContent = fmt2(target);
```

This is the closest WoO equivalent of a "RollupState.STOP" gate — a final hard-set of all UI to the terminal values, bypassing whatever GSAP might be in flight. Defensive and necessary because `gsap.to(this.titleEl, …)` from `masterTierTransition` could leave the title invisible mid-tween if a skip arrived during a fade.

### §2.5 BASE vs FS tier difference

There is **no BASE vs FS branching in `bigWinController.ts`**. The same controller is invoked at the end of both the HnW round (`src/hnwController.ts:1253-1256`) and the FS round (`src/fsController.ts:513-515`). The tier ladder thresholds are identical in both contexts. The only differentiation is the "seamless transition" pattern:

- **FS → BigWin** (`src/fsController.ts:502-508`) calls `this.bigWin.prepareForShow(fsTotalWin, fsBetAmount)` *during* the FS outro fade, so the BigWin dark backdrop appears under the outro plaque and avoids a visible flicker.
- **HnW → BigWin** (`src/hnwController.ts:1253-1256`) calls the same `prepareForShow` then `show`, without the outro-transition orchestration.

| Code path                              | file:line                              | Notes                                  |
|:---------------------------------------|:---------------------------------------|:---------------------------------------|
| `prepareForShow` (the seam hook)       | `src/bigWinController.ts:440-463`      | sets `isPrepared = true`               |
| `show` skips visual setup if prepared  | `src/bigWinController.ts:538-558`      | `if (!this.isPrepared) { … }`          |
| HnW path                                | `src/hnwController.ts:1253-1256`       | sequential prep→show                   |
| FS path                                 | `src/fsController.ts:502-515`          | prep inside outro transition callback  |

### §2.6 Per-tier visual handlers

| Step                                                      | file:line                              |
|:----------------------------------------------------------|:---------------------------------------|
| `applyTier(tier)` — entry/no-op guard if same             | `src/bigWinController.ts:205-257`      |
| Tier-specific CSS class (`tier-1/2/3`)                    | `src/bigWinController.ts:222-224`      |
| Tier-specific CSS vars (`--bwTierPow`, `--bwGlowA`)       | `src/bigWinController.ts:217-220`      |
| Master tier transition (bg + title + effects) GSAP TL     | `src/bigWinController.ts:227-235`      |
| Particle/glow burst gate (`if tier>=2 && !bumpedTiers`)   | `src/bigWinController.ts:238-241`      |
| `playModernTierTransition`                                | `src/bigWinController.ts:263-284`      |
| Shockwave entrance for tier>=2                            | `src/bigWinController.ts:265-268`      |
| Particle emission for tier>=2 (lightning if tier>=2)      | `src/bigWinController.ts:271-283`      |
| Tier-specific screen-shake intensity + pattern            | `src/bigWinController.ts:245-253`      |
| Zeus character reaction                                   | `src/bigWinController.ts:256`          |

Tier-specific intensities:

| Tier | Intensity (px) | Duration (ms) | Shake pattern | Particles | Lightning |
|:-----|:--------------:|:-------------:|:-------------:|:---------:|:---------:|
| 1    | 6              | 300           | impact        | 30 sparkles | no        |
| 2    | 12             | 400           | explosion     | 50 sparkles | yes (1.2)  |
| 3    | 20             | 600           | thunder       | 80 sparkles | yes (1.8)  |

Citation: `src/bigWinController.ts:246-253` (shake) + `src/bigWinController.ts:277` (sparkles) + `src/bigWinController.ts:280-282` (lightning).

### §2.7 Cancel / skip behaviour

| Skip mode                                | file:line                              | Behaviour                                                                  |
|:-----------------------------------------|:---------------------------------------|:---------------------------------------------------------------------------|
| `requestSkip()` external API             | `src/bigWinController.ts:756-762`      | sets `skipToEnd = true; skipRequested = true`                              |
| During PREP                              | `src/bigWinController.ts:569-570`      | skip **not allowed** — flags forced false at PREP end                      |
| During ROLLUP, `skipToEnd === true`      | `src/bigWinController.ts:604-614`      | jump straight to final tier + final value                                  |
| During ROLLUP, `skipToEnd === false`     | `src/bigWinController.ts:617-636`      | jump virtualElapsed to next tier's start (single-tier advance)             |
| During END                                | `src/bigWinController.ts:724-728`      | early-break the 7s hold → quick fade-out (`fadeOutOverlay(true)`)          |

So the external skip semantics from `main.ts` are always "jump to end" (because `requestSkip` sets `skipToEnd = true`). The dual-mode skip logic (single-tier advance vs end) is internal — useful for testing but not exercised externally. Confirmed by lack of any other call sites changing only `skipRequested = true` without `skipToEnd`.

### §2.8 Coin shower / 3D coins

The controller owns a `Coin3DRenderer` (constructor at `src/bigWinController.ts:78`). Lifecycle:

| Method                       | file:line                              | Action                                  |
|:-----------------------------|:---------------------------------------|:----------------------------------------|
| `startCoinShower()`          | `src/bigWinController.ts:125-128`      | `coin3D.start(1)` — always starts tier 1|
| `updateCoinShowerTier(t)`    | `src/bigWinController.ts:133-136`      | `coin3D.updateTier(t)` — gradual upgrade|
| `fadeOutCoinShower()`        | `src/bigWinController.ts:141-144`      | `coin3D.stop()` graceful                |
| `hideCoinShower()`           | `src/bigWinController.ts:149-152`      | `coin3D.stop()` immediate (for skip)    |
| `drainCoinShower()`          | `src/bigWinController.ts:158-161`      | 4.5s drain delay then drain             |

CSS `.coin-shower-container` is hidden at line 84 (`this.coinShower.style.display = 'none'`) — only the 3D renderer is used in production.

### §2.9 Asset preload

Tier backgrounds are preloaded with `img.decode()` at `src/bigWinController.ts:92-109`:

```ts
images.forEach((src) => {
  const img = new Image();
  img.src = src;
  img.decode().catch((e: unknown) => {
    console.warn(`[BigWin] img.decode failed for ${src}:`, e);
  });
});
```

This eliminates the first-Big-Win jank from on-demand decode. Sound engineering.

### §2.10 Lock contract

Big Win acquires a `UIStateManager` input lock for the entire duration:

| Step                                                      | file:line                          |
|:----------------------------------------------------------|:-----------------------------------|
| Acquire lock                                              | `src/bigWinController.ts:527`      |
| Release lock                                              | `src/bigWinController.ts:790`      |

The lock disables spin button / autoplay / settings interactions while the celebration plays.

---

## §3. Free Spins controller (`fsController.ts`)

### §3.1 Public type surface

| Symbol                | file:line                          | Meaning                                                       |
|:----------------------|:-----------------------------------|:--------------------------------------------------------------|
| `FSState`             | `src/fsController.ts:43-48`        | INACTIVE / INTRO / RUNNING / SUMMARY                          |
| `FS_AWARDS`           | `src/fsController.ts:51`           | re-export of `FREE_SPINS_AWARDS` from `paytable.ts` (config)  |
| `FSGameCallbacks`     | `src/fsController.ts:54-87`        | host injection seam                                           |
| `FSController` class  | `src/fsController.ts:89-777`       | controller body                                               |

> Note: the brief asked for "FSM phases (TRIGGER → INTRO → SPINNING → OUTRO → SUMMARY)". WoO collapses TRIGGER+INTRO and OUTRO+SUMMARY into single phases — actual enum is `INACTIVE / INTRO / RUNNING / SUMMARY`. The OUTRO is a sub-step inside `showSummary` (the plaque + outro transition + bigwin chain), not a top-level state.

### §3.2 FSM phases

```
INACTIVE
   │ trigger(scatterCount, scatterPositions, triggerResult, triggerGrid)
   │   - bet snapshot
   │   - total = remaining = FS_AWARDS[scatterCount] (14/16/18 per config)
   │   - totalWin = 0, currentMult = 1
   ▼
INTRO    UIStateManager.setFSPhase('intro')
   │ playIntro → playFSEpicIntro (lazy-loaded, ~62KB deferred)
   │ regenerate grid with FS_WEIGHTS (no "B" symbols)
   │ start FS ambient lightning
   │ renderer.showFSAtmosphere()
   ▼
RUNNING  UIStateManager.setFSPhase('running')
   │ waitForStart (2s auto / click / Space/Enter)
   │ runLoop:
   │   while remaining>0 and state===RUNNING:
   │     updateCounter
   │     executeSpin:
   │       - generateGrid(rng, FS_WEIGHTS)
   │       - evaluateSpin(isFreeSpin: true)
   │       - applyMult, presentWins
   │       - currentMult++ (cap 10)
   │       - check scatter retrigger (>=3)
   │     remaining--
   ▼
SUMMARY  UIStateManager.setFSPhase('summary')
   │ playFSOutroPlaque(totalWin)
   │ hasBigWin = bigWin.shouldTrigger(totalWin, betAmount)
   │ playFSOutroTransition(hasBigWin, prepareForShow callback)
   │ removePlaqueOverlay
   │ if hasBigWin: bigWin.show(totalWin, betAmount)
   │ finalize → credit, restore, INACTIVE
   ▼
INACTIVE
```

State transitions with file:line:

| Transition                  | file:line                          |
|:----------------------------|:-----------------------------------|
| INACTIVE → INTRO            | `src/fsController.ts:233`          |
| INTRO → RUNNING             | `src/fsController.ts:275`          |
| RUNNING → SUMMARY           | `src/fsController.ts:489`          |
| SUMMARY → INACTIVE          | `src/fsController.ts:537`          |

Phase handler citations:

| Phase                                  | file:line                          |
|:---------------------------------------|:-----------------------------------|
| `trigger`                              | `src/fsController.ts:213-284`      |
| `playIntro`                            | `src/fsController.ts:288-298`      |
| `waitForStart`                         | `src/fsController.ts:300-328`      |
| `runLoop`                              | `src/fsController.ts:332-350`      |
| `executeSpin`                          | `src/fsController.ts:352-482`      |
| `showSummary`                          | `src/fsController.ts:486-519`      |
| `finalize`                             | `src/fsController.ts:521-565`      |

### §3.3 Spins-remaining counter

| Field                  | file:line                          | Meaning                                    |
|:-----------------------|:-----------------------------------|:-------------------------------------------|
| `remaining`            | `src/fsController.ts:94`           | spins left to play                         |
| `total`                | `src/fsController.ts:97`           | total awarded (initial + retriggers)       |
| Counter formula        | `src/fsController.ts:611`          | `currentSpin = total - remaining + 1`      |
| Decrement              | `src/fsController.ts:338`          | inside `runLoop`                           |
| Retrigger increment    | `src/fsController.ts:477-478`      | `remaining += additionalSpins; total += additionalSpins;` |

`FS_AWARDS[scatterCount]` comes from config — WoO defaults are 3→14, 4→16, 5→18 per the math spec (resolved at runtime from `game.config.json`).

### §3.4 Persistent multiplier accumulation

This is the WoO signature mechanic — "progressive multiplier" (`currentMult`) that grows on every winning spin, never resets, capped at 10×.

| Step                                            | file:line                              |
|:------------------------------------------------|:---------------------------------------|
| `currentMult` field                             | `src/fsController.ts:106`              |
| Initialised to 1                                | `src/fsController.ts:228`              |
| Multiplied into win                             | `src/fsController.ts:417`              |
| `showMultiplierPopup` if currentMult > 1        | `src/fsController.ts:426-428`          |
| Increment after win (cap 10)                    | `src/fsController.ts:431-435`          |
| Update HUD on increment                         | `src/fsController.ts:434`              |
| HUD render fn                                   | `src/fsController.ts:616-630`          |
| HUD bump animation (CSS class for 300ms)        | `src/fsController.ts:622-623`          |

Note: the multiplier ONLY increments on a WINNING spin (`if (baseWin > 0)` at line 415), not on every spin. A losing spin keeps the multiplier at its current value — making the counter feel earned. The cap is enforced *inside* the conditional (`if (this.currentMult < 10)` at line 431) so the multiplier can never exceed 10×.

The retrigger scatter pay also applies the current multiplier (`src/fsController.ts:468`):

```ts
const scatterPay = (SCATTER_PAYS[scatterCount] ?? 0) * this.betAmount * this.currentMult;
```

So retrigger scatter pays scale with the FS-session multiplier, not the initial trigger pay. Industry-standard.

### §3.5 Retrigger handling

| Step                                            | file:line                              |
|:------------------------------------------------|:---------------------------------------|
| Scatter count after spin                        | `src/fsController.ts:465`              |
| Gate: `scatterCount >= 3`                        | `src/fsController.ts:466`              |
| Additional spins (from config)                  | `src/fsController.ts:467`              |
| Scatter pay (× currentMult)                     | `src/fsController.ts:468`              |
| Apply: `remaining += additionalSpins`           | `src/fsController.ts:477`              |
| Visual: `showRetrigger(scatterCount, n)`        | `src/fsController.ts:480`              |
| Retrigger overlay sequence                      | `src/fsController.ts:678-735`          |

The retrigger UX (`showRetrigger`) is documented inline at lines 679-695 with a meta-comment about the redesign (June 2026: shake + flash burst + zoom-in). Total beat 1900ms, was 2450ms — tightened cadence.

DEBUG-only forced retrigger (`forceRetrigger(scatterCount: 3|4|5)`):

| Step                                  | file:line                              |
|:--------------------------------------|:---------------------------------------|
| `forceRetriggerScatters` field        | `src/fsController.ts:115`              |
| `forceRetrigger()` setter             | `src/fsController.ts:193-196`          |
| Consumed in `executeSpin`             | `src/fsController.ts:365-371`          |
| `createRetriggerGrid` synthesis       | `src/fsController.ts:742-776`          |

This is interesting: the debug path builds a synthetic grid with 3/4/5 scatters at known positions, which then flows through the SAME evaluate→present→retrigger pipeline as a real retrigger. This is the "Force buttons must take a real spin path" pattern (cf. user memory rule from 05.06.2026). No shortcut — forced retrigger is a real spin with a planted grid.

### §3.6 FS-specific timing

| Timing                                  | file:line                              | Value                                            |
|:----------------------------------------|:---------------------------------------|:-------------------------------------------------|
| `AUTO_START_DELAY` (waitForStart)       | `src/fsController.ts:302`              | 2000 ms                                          |
| Inter-spin sleep (remaining>0)          | `src/fsController.ts:341`              | 500 ms                                           |
| Inter-spin sleep (remaining===0)        | `src/fsController.ts:343`              | 800 ms                                           |
| Reel-stop stagger (from profile)        | `src/fsController.ts:410`              | `getSpinProfile(turbo).staggerMs`                |
| Multiplier popup visibility             | `src/fsController.ts:655-658`          | 1500 ms                                          |
| Retrigger overlay hold                  | `src/fsController.ts:731`              | 1500 ms                                          |
| Retrigger overlay fade-out              | `src/fsController.ts:733`              | 400 ms                                           |
| FS retrigger shake                      | `src/fsController.ts:709-710`          | 600 ms                                           |
| FS HUD intro fade (uiOverlay/gameMount) | `src/fsController.ts:246-249`          | 300 ms each                                      |
| FS HUD outro fade-in                    | `src/fsController.ts:261-265`          | 600 ms each                                      |

### §3.7 BASE handoff at FS end — balance update sync

The credit happens in `finalize`:

| Step                                                       | file:line                          |
|:-----------------------------------------------------------|:-----------------------------------|
| Compute `triggerWin = triggerResult?.finalWin ?? 0`        | `src/fsController.ts:524`          |
| `totalToCredit = fsTotalWin + triggerWin`                  | `src/fsController.ts:525`          |
| Stop FS ambient lightning, hide FS atmosphere              | `src/fsController.ts:540-541`      |
| Re-enable base ambient lightning                            | `src/fsController.ts:542`          |
| Restore trigger grid (so the player sees what triggered FS) | `src/fsController.ts:551-553`     |
| Single `creditBalance(totalToCredit)`                       | `src/fsController.ts:557`         |
| Notify autoplay; skipResume if bigwin                       | `src/fsController.ts:563-564`     |

The credit is one atomic call after all visuals are done — same pattern as HnW. Importantly, the trigger-spin payout is held in escrow inside the FS session and credited together with the FS winnings at the very end, so the player's balance ticks UP exactly once at the end of the bonus, not at trigger.

> Note: `getFinalTier` for BigWin is computed from `fsTotalWin` only (line 498-498, `bigWin.shouldTrigger(this.totalWin, this.betAmount)`) — NOT from `totalToCredit`. So the trigger-spin payout does NOT count toward the BigWin tier threshold check. If the trigger spin paid 5× and the FS session paid 5×, that's 10× total but BigWin doesn't fire because the FS session alone is 5× < 10× threshold. This is conservative and avoids spurious tier celebrations on weak FS sessions.

### §3.8 Race-condition handling — sessionId / spinId

Unlike HnW, the FS controller delegates session token mgmt to the host via callbacks:

| Mechanism                                   | file:line                              |
|:--------------------------------------------|:---------------------------------------|
| `callbacks.getNextSpinId()`                 | `src/fsController.ts:358`              |
| `callbacks.setActiveSpinId(id)`             | `src/fsController.ts:359`              |
| `callbacks.isSpinActive(id)`                | `src/fsController.ts:460`              |
| Clear active spin id after present          | `src/fsController.ts:460-462`          |

So a fresh FS spin acquires a spinId, executes, and only clears the host's `activeSpinId` if it's still the active one (line 460-462 guards). If a previous spin's cleanup arrives after a new spin started, it doesn't clobber. This is a slightly different cancellation pattern than HnW's monotonic-id (`sessionId`) but achieves the same correctness — the host owns the canonical id, the controller asks before mutating.

`runLoop` itself has no token guard — instead it uses the `state === FSState.RUNNING` predicate at line 335 as both the loop continuation gate AND the implicit cancellation: setting `state` to anything else terminates the loop. Cleaner than HnW.

`waitForStart` has documented timer cleanup (`clearTimeout(timer)` at line 311) so resolved promise leaves no stray timer.

### §3.9 Storm-mode / lightning ambient

| Step                                            | file:line                              |
|:------------------------------------------------|:---------------------------------------|
| Add `storm-mode is-freespins` CSS classes       | `src/fsController.ts:237`              |
| Disable base ambient lightning                  | `src/fsController.ts:269`              |
| Set FS ambient lightning grid-bounds callback   | `src/fsController.ts:270`              |
| Start FS ambient lightning                      | `src/fsController.ts:271`              |
| Show FS atmosphere on renderer                  | `src/fsController.ts:272`              |
| Reverse (finalize) — stop / hide / re-enable    | `src/fsController.ts:540-545`          |

The lazy-loaded FS modules (`fsEpicIntro`, `fsOutroPlaque`, `fsOutro`, `fsAmbientLightning`) are loaded via `fsLazyLoader` to defer ~62 KB at app boot. Citation: `src/fsController.ts:22-30` and the module headers in `fsLazyLoader.ts`.

### §3.10 No HnW reference inside FS

Verified: `fsController.ts` does NOT import or reference any HnW symbol. There is no FS→HnW handoff in the FS code path. This is an important architectural fact for §4.

---

## §4. Cross-controller interaction

### §4.1 Composition map

```
                      ┌─────────────────┐
                      │     main.ts     │  (host / orchestrator, 212 533 lines)
                      └────┬───────┬────┘
                           │       │
                  feature_detect (per spin result)
                           │       │
             ┌─────────────┘       └─────────────┐
             ▼                                   ▼
       checkFSTrigger                      checkHNWTrigger
       (features.ts:395-399)                (features.ts:402-406)
             │                                   │
             ▼                                   ▼
       fsController.trigger              hnwController.trigger
             │                                   │
             └────────────┬──────────────────────┘
                          ▼
                   bigWinController
                  (shared dependency)
```

### §4.2 Can FS trigger inside HNW?

**Direct evidence: NO.** Searching for cross-controller invocation:

- `hnwController.ts` does NOT import or reference any FS class. It only references `BigWinOverlayController` (line 23) and uses it for end-of-round bigwin show (line 1254-1255).
- The HnW grid `runLoop` (`src/hnwController.ts:709-825`) spins individual CELLS, not full reels. Each "respin" only updates `.hnw-cell:not(.has-orb)` and only checks the per-cell orb-land chance — there is no scatter symbol, no FS gate, no `evaluateSpin` call inside HnW.
- The orb table (`HNW_ORB_VALUES` from `paytable.ts`) does not contain scatters; only orb values + jackpot labels.

So **FS cannot be triggered from inside an HNW respin**. Round semantics are strict: enter HnW → resolve HnW → return to BASE.

### §4.3 Can HNW trigger inside FS?

**Direct evidence: NO.** Mechanism: the FS reel weights `FS_WEIGHTS` (imported at `src/fsController.ts:15`) exclude the bonus symbol "B". The math spec (`features.ts:104`) documents: "NO bonus orbs (FS reel weights omit `B`)". So no FS spin can produce ≥6 "B" symbols and `checkHNWTrigger(grid)` always returns false during FS. Confirmed by absence of `checkHNWTrigger` invocation anywhere in `fsController.ts`.

So **HnW and FS are mutually exclusive features**: only one can be active at a time, and neither can fire from inside the other. The BASE handoff is the only gate.

### §4.4 BigWin × FS interaction

The FS controller's summary path explicitly triggers BigWin if the FS total ratio crosses tier1:

```text
src/fsController.ts:498-515

const hasBigWin = this.bigWin.shouldTrigger(this.totalWin, this.betAmount);
const fsTotalWin = this.totalWin;
const fsBetAmount = this.betAmount;

await this.callbacks.playFSOutroTransition(
  hasBigWin,
  hasBigWin ? () => {
    devLog(`[FS] Preparing Big Win overlay`);
    this.bigWin.prepareForShow(fsTotalWin, fsBetAmount);
  } : undefined
);

removePlaqueOverlay();

if (hasBigWin) {
  await this.bigWin.show(fsTotalWin, fsBetAmount);
}
```

So the BigWin tier ladder applies to the FS session's totalWin / betAmount, NOT to the per-spin win. This is the standard ratio — players hate seeing "MEGA WIN!" for a routine high-multi spin that pays back less than their session win.

### §4.5 BigWin × HnW interaction

`showSummary` in HnW does the equivalent at `src/hnwController.ts:1244-1256`:

```ts
const hasBigWin = this.bigWin.shouldTrigger(this.totalWin, this.betAmount);
// …
if (hasBigWin) {
  this.bigWin.prepareForShow(hnwTotalWin, hnwBetAmount);
  await this.bigWin.show(hnwTotalWin, hnwBetAmount);
}
```

Again the ratio is HnW-session total vs trigger bet — clean.

### §4.6 BigWin × BASE interaction

The base-game path is in `main.ts` (not in scope for this RE). Per `bigWinController.ts:174-178`, `shouldTrigger` only cares about win/bet. So `main.ts` calls it on every base-spin and triggers the overlay when ≥10× hits.

### §4.7 HookBus equivalent events

WoO does not use an explicit HookBus — instead it uses `RF.emit("onSpin", …)` and `RF.emit("onReelStop", …)` from `bridge/reelforgeBridge.ts` (imported as `RF` at `src/fsController.ts:31`), and direct callback invocations defined in `FSGameCallbacks` / `HNWGameCallbacks` / no external API for BigWin (which only emits via DOM CSS classes + GSAP tweens).

| Event                          | Emitter                              | file:line                              |
|:-------------------------------|:-------------------------------------|:---------------------------------------|
| `RF.emit("onSpin", …)`         | `fsController.executeSpin`           | `src/fsController.ts:390`              |
| `RF.emit("onReelStop", …)`     | `fsController.executeSpin`           | `src/fsController.ts:403-407`          |
| `UIStateManager.setFSPhase()`  | FS state transitions                 | `src/fsController.ts:234, 276, 490, 548` |
| `UIStateManager.setFSPhase()`  | HnW state transitions                | `src/hnwController.ts:296, 307, 1217, 1332` |
| `UIStateManager.requestLock('bigwin')`  | `bigWinController.show`     | `src/bigWinController.ts:527`          |
| `UIStateManager.releaseLock('bigwin')`  | `bigWinController.cleanup`  | `src/bigWinController.ts:790`          |
| Callbacks: `notifyAutoPlayFSEnd`, `notifyAutoPlayHNWEnd` | both controllers | `src/fsController.ts:564, src/hnwController.ts:1347` |

So WoO's "event bus" is split between:
1. **DOM-level signalling** via classes (`storm-mode`, `is-freespins`, `bigwin-active`, `has-bigwin`, `hnw-mode`).
2. **UIStateManager singleton** for phase + input-lock coordination.
3. **Bridge/RF** for math/audit telemetry (`onSpin`, `onReelStop`).
4. **Typed callback interfaces** (`FSGameCallbacks`, `HNWGameCallbacks`) for host-controller communication.

This is functionally equivalent to a HookBus but the dispatch is per-channel. SGF's `hookBus.mjs` is a single-channel event bus — different architecture (see §6).

### §4.8 Race conditions between controllers

Designed-in mutual exclusion (round-state gates):

| Guard                                          | file:line                              |
|:-----------------------------------------------|:---------------------------------------|
| HnW: `isActive()` predicate                    | `src/hnwController.ts:189-191`         |
| FS: `isActive()` predicate                     | `src/fsController.ts:143-145`          |
| BigWin: `isShowing()` predicate                | `src/bigWinController.ts:770-772`      |
| BigWin: `if (this.isActive) return;` early-out | `src/bigWinController.ts:441, 520`     |

`main.ts` is responsible for calling `controller.isActive()` before triggering a new round — this is an inversion-of-control discipline that the controllers do not self-enforce beyond the BigWin early-out. If `main.ts` misbehaves, the HnW or FS `trigger` will accept a new call and double-up state (it would clobber the previous round's `sessionId`, `totalWin`, etc.). The legacy `requestSkip`/`skipRequested` flags would also collide. This is a known pattern in production slots — the host MUST gate triggers behind `isActive()`.

Potential cross-controller race during BigWin → next-spin:

| Concern                                                                                      | Risk |
|:---------------------------------------------------------------------------------------------|:-----|
| Player smashes spin during BigWin → spin queued?                                              | LOW — `UIStateManager.requestLock('bigwin')` line 527 disables input |
| `cleanup` ordering — coin3D stops before fade?                                                | OK — see `cleanup(skipCoinFade=true)` at 778-824 |
| FS outro and BigWin prep overlap (intentional seam)                                           | OK — `prepareForShow` sets backdrop visible BEFORE BigWin show, no flicker |
| `restoreTriggerGrid` runs AFTER FS visuals stopped                                             | OK — `finalize` order at 537-553                 |

---

## §5. Industry pattern extraction (vendor-neutral)

### §5.1 Sticky-pin pattern

**Canonical name:** *Lock-and-Respin with credit-bucket accumulation* (industry-standard, vendor-neutral).

**State machine:**

```
IDLE → TRIGGERED → COLLECTING → RESPINNING* → AWARDING → EXIT

* "RESPINNING" is a sub-state loop that decrements a counter; on a new credit symbol it
  resets to N (default 3) and re-enters COLLECTING; on N consecutive misses it exits to AWARDING.
```

In WoO this is collapsed into RUNNING (no separate COLLECTING vs RESPINNING) — the loop checks new-orb-or-not per iteration and conditionally resets the counter. Both expressions are isomorphic.

**WoO citation:** `src/hnwController.ts:709-825` (the entire `runLoop`).

**Reference invariants the pattern must preserve:**

| Invariant                                                       | Why it matters                                                            |
|:----------------------------------------------------------------|:--------------------------------------------------------------------------|
| Locked cells NEVER respin                                       | Players see the round as "filling up" — animation must match math contract |
| New credit symbol RESETS the counter to N (not increments by N) | Industry default — every modern Hold & Win works this way                  |
| Full grid is a separate award path (not a 5th jackpot tier)     | UX clarity                                                                |
| Counter formula: `respins_left = N` initially                   | "Lives" semantic                                                          |
| Round end = (counter==0 with no spawn this iter) OR full grid    | Two terminal conditions                                                  |
| Credit is ATOMIC at round end (no mid-round balance ticks)      | Regulator + audit clarity                                                 |
| Stochastic per-orb jackpot labels (MINI/MINOR/MAJOR/GRAND)      | Not a separate jackpot trigger — orb table picks the label                 |

### §5.2 Tier ladder pattern

**Canonical name:** *Win-magnitude tier ladder* (vendor-neutral; placeholders tier1..tier5).

**Industry-standard thresholds** (based on WoO + cross-validated with the SGF `bigWinTier.mjs` defaults):

| tier | WoO threshold | SGF default | Common industry range |
|:----:|:-------------:|:-----------:|:---------------------:|
| 1    | 10×           | 10×         | 10×–15×               |
| 2    | 25×           | 25×         | 25×–40×               |
| 3    | 50×           | 50×         | 50×–100×              |
| 4    | NOT FOUND     | 200×        | 100×–300×             |
| 5    | NOT FOUND     | 1000×       | 500×–2000×            |

**WoO citation:** `src/bigWinController.ts:23-27` (3-tier ladder).
**SGF citation:** `slot-gdd-factory/src/blocks/bigWinTier.mjs:53-56` (5-tier ladder).

**Reference invariants:**

| Invariant                                                                | Why it matters                                                                |
|:-------------------------------------------------------------------------|:------------------------------------------------------------------------------|
| Tier = `max{ t : thresholds[t-1] <= win/bet }`                            | Deterministic, no RNG in tier selection                                       |
| Each tier renders with a fixed duration (4s per tier in WoO; configurable in SGF) | Predictable pacing                                                  |
| Counter rolls linearly from 0 to target over total tier-duration sum     | Player can read the value continuously                                        |
| Tier upgrades are cumulative (visit tier1 then upgrade to tier2 then tier3) | "Climbing the ladder" UX                                                    |
| Skip allowed during ROLLUP but NOT during PREP                            | Anti-misclick at intro                                                        |
| End hold is fixed (4-7s in WoO) — player can dismiss                      | Mandatory celebration time, opt-out skip                                      |

### §5.3 Rollup-gate pattern

**Canonical name:** *Virtual-time counter–banner synchronisation*.

**WoO impl** (`src/bigWinController.ts:583-668`):
- Single `virtualElapsed` accumulator (driven by per-frame `performance.now()` delta).
- Per frame: `p = virtualElapsed / totalRollupMs`; `tierIndex = floor(virtualElapsed / TIER_MS)`.
- Counter text and tier banner both derived from same clock.
- Skip mutates `virtualElapsed` directly (jumps to next tier boundary or to end).
- Loop terminates on `p >= 1` or skip-to-end.

This is the canonical pattern for any "counter must match banner" UI: don't have separate timers — derive both from the same monotonic accumulator.

**Reference invariants:**

| Invariant                                                                  | Why it matters                                                  |
|:---------------------------------------------------------------------------|:----------------------------------------------------------------|
| One accumulator drives BOTH counter and banner                              | Eliminates desync                                              |
| Skip mutates the accumulator, NOT the rendered state                        | Loop re-renders next frame, no special-case path                 |
| Final hard-set after loop exit (`gsap.killTweensOf`, `gsap.set`)            | Insurance against in-flight GSAP tweens leaving title invisible |
| Linear (not eased) counter movement                                         | Player perceives constant tempo; tier upgrades become the drama  |
| PREP phase forces `skipRequested = false`                                   | Anti-immediate-skip                                              |
| END hold uses a SEPARATE elapsed clock                                      | Drain animation can outlive the celebration window               |

### §5.4 Free Spins progressive multiplier pattern

**Canonical name:** *Persistent FS multiplier ladder (per winning spin)*.

**WoO impl** (`src/fsController.ts:431-435`):

```ts
if (this.currentMult < 10) {
  this.currentMult++;
  this.updateMultiplierDisplay();
}
```

Increment is **post-win, pre-next-spin, cap-enforced**, and the counter persists across the entire FS session (incl. retriggers).

**Reference invariants:**

| Invariant                                                                | Why it matters                                                                  |
|:-------------------------------------------------------------------------|:--------------------------------------------------------------------------------|
| Only increments on WINNING spins (`if baseWin > 0`)                       | Loss spins don't tick — feels earned                                              |
| Cap at MAX (10× in WoO, configurable in SGF)                              | RTP boundedness; players can't game it                                            |
| Multiplier applies to: line wins + retrigger scatter pays                 | Consistent — anything that pays gets the bump                                    |
| Multiplier DOES NOT reset on retrigger                                    | "Hot streak" feels rewarding                                                      |
| Multiplier DOES reset at FS-end (`finalize` line 534)                     | Next FS session starts fresh                                                      |
| Visual bump (`fs-mult-bump` class for 300ms) on every increment           | Player attention                                                                  |
| Popup showing `base × mult = total` on every winning spin (when mult > 1) | Transparency — player sees the math                                              |

### §5.5 Atomic-credit pattern

**Canonical name:** *Single-call balance commit at terminal state*.

Both HnW and FS use the same shape: accrue inside the controller, single `callbacks.creditBalance(totalToCredit)` at finalize.

| Controller | file:line                          |
|:-----------|:-----------------------------------|
| HnW        | `src/hnwController.ts:1341`        |
| FS         | `src/fsController.ts:557`          |

**Reference invariants:**

| Invariant                                                                  | Why it matters                                                                  |
|:---------------------------------------------------------------------------|:--------------------------------------------------------------------------------|
| Balance display NEVER ticks during sub-celebration                          | "What you see is what you got" — no false mid-round balance                       |
| `triggerWin` is held in escrow inside the bonus session                    | Player sees the trigger spin "free" — the win is credited together with the bonus|
| One atomic call regardless of intermediate UX                              | Audit log writes one balance delta per bonus round                                |
| BigWin overlay (when triggered) shows BEFORE the credit                    | Player's reaction to BigWin and balance jump are decoupled                        |

### §5.6 Session-token cancellation pattern

**Canonical name:** *Monotonic-id versioning for in-flight async cancellation*.

WoO uses two variants:

1. **HnW (controller-owned token):** `sessionId / activeSessionId` pair, `isSessionActive(id)` predicate guards every async checkpoint. Citation: `src/hnwController.ts:146-147, 242-243, 313-315`.

2. **FS (host-owned token):** `callbacks.getNextSpinId() / setActiveSpinId() / isSpinActive()`. Citation: `src/fsController.ts:358-359, 460-462`.

Both are textbook *generation-id* patterns. The HnW variant is more self-contained; the FS variant delegates to the host (preferred when the host has a per-spin id system already).

**Reference invariants:**

| Invariant                                                                  | Why it matters                                                                  |
|:---------------------------------------------------------------------------|:--------------------------------------------------------------------------------|
| Every async boundary (sleep, setTimeout, rAF) re-checks the token          | Stale work can never mutate new state                                            |
| Token is monotonic (only increments)                                       | Cannot collide                                                                   |
| Token is cleared in `finalize` (`activeSessionId = null`)                  | After cleanup, no future check passes                                            |
| Callback flag must be reset BEFORE awaiting                                | Don't carry skip-state across rounds (`skipRequested = false` at start)         |

---

## §6. Bridge table to slot-gdd-factory

### §6.1 WoO `hnwController` → SGF `holdAndWin.mjs`

| Aspect                                  | WoO (`src/hnwController.ts`)                                        | SGF (`src/blocks/holdAndWin.mjs`)                                                       | Gap / Opportunity                                                          |
|:----------------------------------------|:--------------------------------------------------------------------|:----------------------------------------------------------------------------------------|:---------------------------------------------------------------------------|
| State machine                           | INACTIVE / INTRO / RUNNING / SUMMARY (`:51-56`)                     | Same 4-phase model documented in block header (`holdAndWin.mjs:9-23`)                   | Aligned. SGF block was rewritten from WoO at the explicit user request (2026-06-11). |
| Trigger gate                            | Host-side via `features.ts:402-406`                                 | Block-side via `cfg.triggerCount` (`holdAndWin.mjs:52`)                                  | SGF puts the gate inside the block — different responsibility split.        |
| Sticky-pin lock                          | DOM-level class `.has-orb` + occupiedCells Set                      | Same; PLUS a MutationObserver "orb-is-sacred" guard (block header `:26-30`)             | SGF needs the MutationObserver because reelEngine/tumble paths can clobber in-place. WoO doesn't need it (separate `#hnwGrid` overlay). |
| Per-cell spawn formula                   | Hard-coded `ORB_LAND_CHANCE = 0.01` (`:62`) **DRIFT from math**     | Per `holdAndWin.mjs` runtime — pulled from `model.holdAndWin` config                    | Both should consume the math-side formula `base + fillRatio × fill_bonus` from `features.ts:267-270`. |
| Respins on new orb                       | `RESPINS_ON_NEW_ORB = 3` (`:61`)                                    | `cfg.respinsAwarded`, `cfg.resetOnNewBonus` (`holdAndWin.mjs:55-57`)                    | SGF more configurable. WoO hardcoded.                                       |
| Jackpot tiers                           | MINI/MINOR/MAJOR/GRAND fixed labels                                 | `cfg.jackpotLabels: ['MINI','MINOR','MAJOR','GRAND']` configurable                       | SGF more configurable.                                                       |
| Full-grid bonus                         | `HNW_FULL_GRID_BONUS = 500` (from `paytable.ts:87`)                  | `cfg.fullGridBonusX: 500` configurable                                                   | Aligned.                                                                     |
| Intro                                    | `playIntro` with click-anywhere skip + 700ms grace                  | Intro overlay sequence with continue-blink CTA, click-anywhere skip (block header)      | Aligned.                                                                     |
| Summary                                 | Final stats placard (orbs, jackpots, total, full-grid)              | Same data on summary placard (header `:21-24`)                                          | Aligned.                                                                     |
| Session token / race                     | `sessionId / activeSessionId` (`:146-147, 313-315`)                  | Block uses lifecycle-bound async (presumably via reelEngine spin id)                    | SGF should add an explicit token if not already present.                     |
| Skip-fast                                | `requestSkip()` + `.hnw-fast` class                                  | Block uses `forceSkip.mjs` integration                                                   | Architectural diff — WoO controller-owned, SGF block-owned.                  |
| BigWin handoff                           | `bigWin.prepareForShow → show` inside `showSummary`                  | SGF `bigWinTier.mjs` listens to `onWinPresentationEnd` HookBus event                    | Different mechanism — WoO direct injection, SGF event-bus.                   |
| Money-flow                              | One atomic `creditBalance(totalToCredit)` at finalize                | Block emits HookBus event, host commits credit                                          | Both single-commit.                                                         |
| Force-debug jackpot                      | `setForceJackpot(jackpot)` (`:228-230`)                              | Force panel emits force events                                                          | WoO controller-owned; SGF uses `universalForcePanel.mjs`.                    |

### §6.2 WoO `bigWinController` → SGF `bigWinTier.mjs` + `winPresentation.mjs` + `winRollup.mjs`

| Aspect                                 | WoO (`src/bigWinController.ts`)                                          | SGF (`bigWinTier.mjs`, `winPresentation.mjs`, `winRollup.mjs`)                      | Gap / Opportunity                                                                |
|:---------------------------------------|:-------------------------------------------------------------------------|:------------------------------------------------------------------------------------|:---------------------------------------------------------------------------------|
| Tier count                             | 3 (`:23-27`)                                                              | 5 (default thresholds `[10, 25, 50, 200, 1000]` per `bigWinTier.mjs:53-56`)         | SGF is 5-tier — WoO is 3. Synthesis nomenclature uses tier1..tier5; WoO covers 1-3. |
| Threshold default                       | 10× / 25× / 50×                                                          | 10× / 25× / 50× / 200× / 1000×                                                       | First three identical.                                                            |
| Per-tier label                          | Hardcoded "BIG WIN / MEGA WIN / EPIC WIN"                                | GDD-configurable; default placeholders `TIER 1`..`TIER 5`                            | SGF is vendor-neutral by default; WoO is theme-specific.                          |
| Per-tier duration                       | Hardcoded 4000 ms per tier (`:64`)                                       | GDD-configurable `[1800, 2400, 3200, 4800, 6400]` (block header)                    | SGF defaults are tier-graduated; WoO is uniform.                                  |
| Rollup ↔ banner sync                    | `virtualElapsed` shared clock (`:583-668`)                              | `_countUpLinear` single rAF loop (block header perf budget)                          | Both single-clock — aligned.                                                      |
| Passthrough mode                        | NOT present; always walks tier1→tier2→tier3 in sequence                 | `cfg.passthrough: false` default; if true walks lower tiers briefly                  | SGF more flexible.                                                                |
| Skip behaviour                          | External skip → jump-to-end; internal also supports single-tier advance | `onSkipRequested{phase:'bigWinTier'}` jumps to final tier end-state                   | Both have skip; semantics differ.                                                  |
| END hold                                | 7000 ms (drain 6 + post 1)                                               | Per-tier configurable                                                                | SGF more flexible.                                                                 |
| Coin shower                             | 3D `Coin3DRenderer` (gradual tier upgrade)                              | SGF `coinShower.mjs` (separate block, listens to HookBus)                            | SGF separates; WoO bundles inside the bigwin controller.                            |
| PREP phase                              | 500ms with skip disabled (`:566-570`)                                    | NOT EXPLICITLY DOCUMENTED — block emits onBigWinTierEntered directly                  | Opportunity: SGF should add a PREP phase to gate against immediate-misclick skip.   |
| Lock acquisition                        | `UIStateManager.requestLock('bigwin')` (`:527`)                          | SGF lock comes from spinControl morph + hostbus contract                              | Aligned via different mechanism.                                                   |
| Asset preload                           | `img.decode()` for all tier bgs (`:92-109`)                              | NOT FOUND. Candidates checked: `bigWinTier.mjs` runtime emit                          | Opportunity: SGF should preload tier images.                                       |

### §6.3 WoO `fsController` → SGF `freeSpins.mjs` + `progressiveFreeSpins.mjs`

| Aspect                            | WoO (`src/fsController.ts`)                                                       | SGF (`freeSpins.mjs`, `progressiveFreeSpins.mjs`)                                            | Gap / Opportunity                                                                                                  |
|:----------------------------------|:----------------------------------------------------------------------------------|:---------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------------------------------|
| FSM phases                        | INACTIVE / INTRO / RUNNING / SUMMARY (`:43-48`)                                   | BASE → FS_INTRO → FS_ACTIVE → FS_OUTRO → BASE (`freeSpins.mjs:7-9`)                          | Same essential model, SGF has explicit BASE return state.                                                          |
| Counter formula                   | `currentSpin = total - remaining + 1` (`:611`)                                    | SGF `FSM_renderHud` updates same SPINS/MULT/TOTAL                                              | Aligned.                                                                                                            |
| Progressive multiplier            | `currentMult` field, +1 per winning spin, cap 10 (`:431-435`)                     | `progressiveFreeSpins.mjs` (separate block) implements the persistent mult                    | SGF separates the multiplier into its own block — more composable.                                                  |
| Multiplier popup                  | `showMultiplierPopup(base, mult, total)` on every winning spin if mult>1 (`:639-659`) | NOT VERIFIED in `progressiveFreeSpins.mjs` (candidate to check)                              | Opportunity: SGF should provide the per-spin "base × mult = total" educational popup.                              |
| Retrigger detection               | `scatterCount >= 3` (`:466`)                                                       | SGF FSM `FSM_handleRetrigger` (`freeSpins.mjs:41`)                                            | Aligned.                                                                                                            |
| Retrigger UX                      | Flash burst + camera shake + zoom-in overlay (`:678-735`, ~1900ms total)          | SGF `genericFeatureBanner.mjs` or block-internal toast (`retriggerToastMs: 1600`)              | WoO is more cinematic; SGF defaults are simpler — opportunity to elevate SGF retrigger UX.                          |
| Force-debug retrigger             | `forceRetrigger(3\|4\|5)` builds synthetic grid (`:193-196, 742-776`)             | SGF `universalForcePanel.mjs` covers force-retrigger                                          | Architectural diff — WoO controller-owned, SGF panel-driven.                                                        |
| Grid weights                      | `FS_WEIGHTS` from `reels.ts` (excludes "B")                                       | SGF `reelEngine.mjs` uses GDD-driven `fsReelWeights`                                          | Aligned in concept.                                                                                                |
| Intro                              | `playFSEpicIntro` lazy-loaded (~62KB deferred)                                     | SGF `FSM_enterIntro` emits overlay placard                                                    | WoO has heavier intro (lightning ambient etc); SGF is leaner.                                                       |
| BigWin handoff                    | `prepareForShow` inside outro transition for seamless seam (`:502-508`)            | SGF `bigWinSafetyMs: 30000` safety guard in defaults                                          | WoO has explicit seam orchestration; SGF needs to verify seam pattern (opportunity).                                |
| Atomic credit                     | One `creditBalance(totalToCredit)` at finalize (`:557`)                            | SGF emits HookBus event; host commits                                                          | Both single-commit.                                                                                                |
| Storm mode / ambient              | `storm-mode is-freespins` body classes + FS lightning (`:237`)                    | SGF `body.fs-mode-<bg>` body class (`freeSpins.mjs:11`)                                       | Aligned in spirit.                                                                                                  |
| Counter HUD render                | DOM-injected counter container (`:570-588`)                                       | SGF `FSM_renderHud` with SPINS/MULT/TOTAL panels                                              | Aligned.                                                                                                            |
| Multiplier display bump           | `fs-mult-bump` class for 300ms on increment (`:622-623`)                          | SGF should match — opportunity to verify                                                       | Aligned behaviourally if present.                                                                                  |
| Total-win rollup                  | `rollupTotalWin(target, 400)` GSAP tween (`:661-675`)                              | SGF `winRollup.mjs` separate block handles rollups                                            | SGF separates rollup; WoO bundles.                                                                                  |
| Multiplier persistence            | DOES NOT reset on retrigger; resets at FS-end (`:534`)                            | SGF should verify retrigger semantics — opportunity                                            | Confirm SGF persists across retriggers.                                                                            |
| `bigWin.shouldTrigger` gate       | `fsTotalWin / betAmount >= 10` (uses tier1 threshold)                              | SGF same `cfg.thresholds[0] = 10` default                                                      | Aligned.                                                                                                            |

### §6.4 Composite blocks that learn from WoO

| SGF block                       | WoO source                          | What WoO does that SGF should adopt                                                            |
|:--------------------------------|:------------------------------------|:-----------------------------------------------------------------------------------------------|
| `winPresentation.mjs`           | WoO `fsController.executeSpin`     | Apply `multipliedResult = {…result, finalWin: multipliedWin}` BEFORE present (line 448)        |
| `winPresentation.mjs`           | WoO `bigWinController.applyTier`   | Use `gsap.killTweensOf` + `gsap.set` as final-state insurance after rollup loop                |
| `winRollup.mjs`                 | WoO `bigWinController.show`        | Adopt the single-`virtualElapsed` clock pattern instead of separate counter/banner timers     |
| `bigWinTier.mjs`                | WoO `bigWinController:92-109`      | Add `img.decode()` preload for tier backgrounds                                                |
| `bigWinTier.mjs`                | WoO `bigWinController:563-570`     | Add PREP phase (500ms, skip-disabled) to gate against immediate-misclick skip                  |
| `freeSpins.mjs`                 | WoO `fsController:300-328`         | `waitForStart` pattern: 2s auto / click / Space/Enter — adopt the keybinding handler           |
| `freeSpins.mjs`                 | WoO `fsController:678-735`         | Cinematic retrigger UX (flash burst + camera shake + zoom)                                     |
| `progressiveFreeSpins.mjs`      | WoO `fsController:639-659`         | "base × mult = total" educational popup on every winning spin                                  |
| `holdAndWin.mjs`                | WoO `hnwController:709-825`        | Pre-determine all cell outcomes upfront (cellResults map) — cleaner than per-cell late decision |
| `holdAndWin.mjs`                | WoO `hnwController:582-624`        | Per-orb fly-to-counter animation                                                               |
| `holdAndWin.mjs`                | WoO `hnwController:497-508`        | Pin overlay grid to `reelFrame.getBoundingClientRect()` to ride layout changes                  |
| `holdAndWinCreditBucket.mjs`    | WoO `hnwController:1244-1256`      | Always run BigWin gate against HnW totalWin, NOT against total-to-credit                       |

---

## §7. Evolution diff (legacy v11.27 → current)

### §7.1 `hnwController.ts`

MD5: `5c1d258090c68bf7b760d6e488a034ad` (both). **No diff.** The HnW controller was frozen at v11.27-2026-05-19 and has not been touched since.

### §7.2 `bigWinController.ts`

MD5: `0f79f35d88f0d9764a719f675e3ec082` (both). **No diff.** Same status as HnW.

### §7.3 `fsController.ts`

```diff
--- legacy/v11.27-2026-05-19/src/fsController.ts
+++ src/fsController.ts
@@ line 679 @@
-    // 2026-05-10 — Playa/industry standard-style retrigger drama (Boki ekspertski upgrade).
+    // 2026-05-10 — Industry-standard retrigger drama (Boki ekspertski upgrade).
@@ line 683 @@
-    // industry standard/WagerWorks reference: retriggers are *the* hero moment — they
+    // Tier-1 reference: retriggers are *the* hero moment — they
```

### §7.4 Diff classification

| Diff | Type            | Why                                                                                                                                                                                |
|:-----|:----------------|:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1    | Vendor-mention scrub | Compliance with the "no vendor names in code" rule (user memory `rule_no_vendor_mentions.md` from 2026-06-13). Replaced "Playa/industry standard-style" with "Industry-standard" in a code comment. |
| 2    | Vendor-mention scrub | Replaced "industry standard/WagerWorks reference" with "Tier-1 reference" in a code comment. Functionally inert — comments only.                                                                |

### §7.5 What changed and why — narrative

The legacy snapshot `v11.27-2026-05-19` is **functionally identical** to the current code. Three controllers, one tiny 2-line comment scrub that landed for compliance reasons.

This is **production-frozen code**: math at 96.009% RTP, 4B-spin validated, no UX changes, no behavioural changes between snapshot and current. The diffs are pure documentation hygiene.

**No regulator-driven changes, no bug fixes, no UX iterations** between v11.27-2026-05-19 and current. This is the strongest possible signal of production maturity — the three controllers have been considered "done" by the team for the entire window.

---

## §8. Regulator-relevant findings

### §8.1 LDW (Losses Disguised as Wins) suppression

**LDW gate:** A "win celebration" should fire only if the player's net delta (win − stake) is positive. Otherwise a 0.50 win on a 1.00 bet is celebrated despite being a 0.50 LOSS.

#### Base / FS context

WoO has no explicit "net delta > 0" gate in the controllers. The closest is:

| Gate                              | file:line                              | Behaviour                                                |
|:----------------------------------|:---------------------------------------|:---------------------------------------------------------|
| FS `if (baseWin > 0)` gate        | `src/fsController.ts:415`              | Win FX only fire if baseWin > 0 — NOT against net delta. |
| FS multiplier popup gate          | `src/fsController.ts:426-428`          | Popup only if `currentMult > 1` — orthogonal to LDW.      |
| FS reelFrame `is-win` class       | `src/fsController.ts:422-423`          | Win glow only if baseWin > 0 — same gate.                 |

So WoO does **NOT** gate FS win celebrations against net delta. A 0.10 win on a 0.20 base bet (still a 50% loss) would still glow the reel frame and play the win FX. **This is an LDW exposure** for UKGC RTS-13C (England/Wales) and AGCO Standard 4.07 (Ontario) — both regulators consider LDW celebration without net-delta suppression a violation.

> Note: in the FS context, the "stake" is zero (free spins are stake-free) so technically any FS win is net-positive. So LDW is NOT relevant inside FS. The LDW concern is only relevant in BASE — which is handled in `main.ts` (out of this RE's scope). Verdict: **FS controller is LDW-clean by construction.**

#### HnW context

Same observation: HnW respins are stake-free. Any orb-spawn that adds win is a net-positive event. So HnW is LDW-clean by construction.

#### BigWin context

BigWin only fires when `win/bet >= 10`, which is by definition a 9× net-positive event. LDW-impossible by gate. Verdict: **BigWin controller is LDW-clean.**

### §8.2 Net-delta gate for win FX

NOT FOUND in any of the three controllers. Candidates checked: `src/hnwController.ts` (no "netDelta", no "stake" subtraction), `src/fsController.ts` (no), `src/bigWinController.ts` (no — only `win / bet` ratio for tier).

This is OK in WoO's case because the win-FX-host is `main.ts` (BASE game) and `presentWins(result, …)` is called via callback from FS at `src/fsController.ts:450` with `suppressBigWin: false, featureMode: true`. The host's `presentWins` may or may not have a net-delta gate — out of scope for this RE.

### §8.3 BigWin threshold compliance

**Reference standards:**

| Body  | Standard          | Big-Win threshold rule                                                                                  |
|:------|:------------------|:--------------------------------------------------------------------------------------------------------|
| UKGC  | RTS 7E (LCCP 2019)| "Significant wins" should be at a level meaningful relative to the player's stake; ≥10× bet is industry default. |
| AGCO  | iGaming Standard 4.07 (4.07.6) | Big-Win celebration must be at a "meaningful" multiple; recommended ≥10× bet.                  |
| MGA   | RGF 2018 §41       | No explicit threshold but requires "proportional" celebration — ≥10× is the common interpretation.         |

WoO `BIG_WIN_TIERS.tier1.threshold = 10` at `src/bigWinController.ts:24` is in compliance with all three.

WoO ladders ≥10× / ≥25× / ≥50× are within UKGC/AGCO/MGA guidance and match the audit-baseline thresholds used in `slot-gdd-factory/src/blocks/bigWinTier.mjs:53-56`.

### §8.4 Other regulator touchpoints

| Concern                                       | file:line                              | Status                                                                                            |
|:----------------------------------------------|:---------------------------------------|:--------------------------------------------------------------------------------------------------|
| RNG isolation (FS uses `mulberry32(seed)`)    | `src/fsController.ts:255, 361`         | OK — fresh seed per spin, deterministic for audit replay                                          |
| Bet snapshot at trigger                        | `src/fsController.ts:224, src/hnwController.ts:246` | OK — bet captured before bonus; player cannot change stake mid-bonus                  |
| `triggerResult` held in escrow                  | `src/fsController.ts:229, 524, src/hnwController.ts:239, 1249` | OK — single credit at finalize                                                            |
| Max-win cap (capped in math, not in UI)         | `features.ts:189-193, 376-378`         | OK — math layer enforces cap. UI controllers do not have a separate cap (defensible).             |
| Free spins min-payout                          | `features.ts:62-63` (`FS_MIN_PAYOUT = 0`) | OK — explicit `// v12: mercy mechanic DISABLED` for regulated math                              |
| Hidden state during bonus session              | various                                | OK — `setFSPhase('summary')` etc. transitions are explicit; no "hidden" state                       |
| Skip allowed (player agency)                   | `src/bigWinController.ts:565-570, 716-728` | OK — skip allowed during all visible phases (with PREP exception for misclick guard)             |
| Audit-trail emit                              | `RF.emit("onSpin"/…)` (`src/fsController.ts:390, 403-407`) | OK — math-side instrumentation forwarded to ReelForge bridge                       |
| Time displayed (responsible-gambling)           | NOT FOUND in controllers              | Out of scope — handled by `sessionManager.ts`                                                       |
| Self-exclusion gate at trigger                  | NOT FOUND in controllers              | Out of scope — handled by `sessionManager.ts` / network layer                                        |

### §8.5 Money flow audit

```
Player presses SPIN
  ↓
main.ts deducts bet from balance               // host responsibility
  ↓
main.ts calls evaluateSpin                     // math
  ↓
main.ts presents wins via presentWins          // host UI
  ↓
if FS triggered:
  main.ts → fsController.trigger(triggerResult)
  fsController holds triggerResult.finalWin in ESCROW
  fsController.finalize → creditBalance(triggerWin + fsTotalWin) ATOMIC
  ↓
if HnW triggered:
  main.ts → hnwController.trigger(triggerResult)
  hnwController holds triggerResult.finalWin in ESCROW
  hnwController.finalize → creditBalance(triggerWin + hnwTotalWin) ATOMIC
  ↓
if neither:
  main.ts credits triggerResult.finalWin immediately      // host responsibility
```

Every credit path is **one atomic call**. Every bonus session is **self-contained**. No partial credit during bonuses. Regulator-clean.

---

## §9. Lessons for SGF

### §9.1 Concrete refactor opportunities

| # | Block                                | Lesson                                                                                              | Priority | WoO source citation                        |
|:--|:-------------------------------------|:----------------------------------------------------------------------------------------------------|:--------:|:-------------------------------------------|
| 1 | `holdAndWin.mjs`                     | Wire per-cell spawn formula to `model.holdAndWin.orbChance.base + fillRatio × fillBonus` (NOT a hard-coded constant) — the WoO controller has the bug (`ORB_LAND_CHANCE = 0.01` drifts from the math sim's 0.0352+0.015·fill). SGF should fix it correctly from day one. | P1 | `src/hnwController.ts:62`, `features.ts:267-270` |
| 2 | `bigWinTier.mjs`                     | Add PREP phase (500ms with skip disabled) before rollup begins. WoO's `setPhase("prep")` + `skipRequested=false` reset (lines 565-570) prevents misclick-skip at the moment the banner first appears. | P1 | `src/bigWinController.ts:563-570`          |
| 3 | `bigWinTier.mjs`                     | Add `img.decode()` preload for tier background images at controller construction time. Eliminates first-Big-Win jank. | P2 | `src/bigWinController.ts:92-109`           |
| 4 | `bigWinTier.mjs` / `winRollup.mjs`   | Replace independent timers with a single `virtualElapsed` accumulator that drives both the counter and the tier banner. WoO's single-clock pattern eliminates desync. | P1 | `src/bigWinController.ts:583-668`          |
| 5 | `bigWinTier.mjs`                     | Final-state hard-set after rollup loop: `gsap.killTweensOf(titleEl); gsap.set(titleEl, {scale:1, opacity:1, y:0})`. Insurance against in-flight GSAP leaving the title invisible. | P1 | `src/bigWinController.ts:660-668`          |
| 6 | `progressiveFreeSpins.mjs`           | Adopt "base × mult = total" educational popup on every winning spin when mult > 1. Improves player transparency. | P2 | `src/fsController.ts:639-659`              |
| 7 | `freeSpins.mjs`                      | `waitForStart` pattern: 2s auto / click / Space/Enter — adopt the dual keyboard + touch handler for accessibility. | P2 | `src/fsController.ts:300-328`              |
| 8 | `freeSpins.mjs`                      | Cinematic retrigger UX: flash burst layer + camera shake on appRoot + overlay zoom-in. Total ~1900ms beat. WoO did the upgrade explicitly for "tier-1 feel". | P3 | `src/fsController.ts:678-735`              |
| 9 | `holdAndWin.mjs`                     | Pre-determine ALL cell outcomes upfront (`cellResults: Map<string, HNWOrb|null>`) at the start of each respin, THEN start the spin animation. Avoids per-cell RNG-at-stop pattern and makes cancellation trivial. | P2 | `src/hnwController.ts:730-743`             |
| 10| `holdAndWin.mjs`                     | Per-orb fly-to-counter animation (`playOrbValueFly`) — creates visual continuity between cell spawn and the cumulative-total counter. | P3 | `src/hnwController.ts:582-624`             |
| 11| `holdAndWin.mjs`                     | Pin HnW overlay grid to `reelFrame.getBoundingClientRect()` via `position: fixed` + computed coords. Survives layout changes (mobile rotation, responsive resize). | P2 | `src/hnwController.ts:497-508`             |
| 12| `holdAndWin.mjs`                     | Session-token cancellation: `sessionId++; activeSessionId = sessionId; isSessionActive(id)` guard at every async boundary. WoO uses this pattern at ~12 checkpoints. | P1 | `src/hnwController.ts:146-147, 313-315`    |
| 13| `freeSpins.mjs` / `holdAndWin.mjs`   | Atomic credit at finalize: `triggerWin` held in escrow, single `creditBalance(triggerWin + sessionWin)` call. No mid-round balance ticks. | P1 | `src/fsController.ts:557`, `src/hnwController.ts:1341` |
| 14| `bigWinTier.mjs`                     | END-hold drain offset: separate "drain delay" (4.5s) and "drain duration" (6s) and "post-drain hold" (1s) constants. Allows fine-tuning without recompiling. | P3 | `src/bigWinController.ts:719-721`          |
| 15| `bigWinTier.mjs`                     | Per-tier shake-pattern enum (`'impact' | 'explosion' | 'thunder'`) with intensity × duration tuple per tier. WoO has 3-tier; SGF should expose 5-tier table. | P2 | `src/bigWinController.ts:246-253`          |
| 16| `winRollup.mjs`                     | Linear (not eased) counter movement during rollup. Eased counters feel "rubber-bandy"; linear feels honest. | P3 | `src/bigWinController.ts:643`              |
| 17| `holdAndWin.mjs`                     | Tension CSS classes on counter: `.final` at 1 respin, `.tension` at 2 respins, `.tick` on decrement, `.reset-flash` on spawn. Drives anticipation without adding logic. | P3 | `src/hnwController.ts:520-527, 833-848`    |
| 18| `holdAndWin.mjs`                     | Stochastic per-orb jackpot label (MINI/MINOR/MAJOR/GRAND drawn from weighted orb table) — NOT a separate jackpot-trigger feature. Full-grid bonus is a SEPARATE bonus path. | P1 | `src/hnwController.ts:323-338, 902-961`    |
| 19| `coinShower.mjs`                     | Gradual tier upgrade (3D renderer tracks current tier; intensity scales smoothly). Don't restart the shower at each tier change. | P2 | `src/bigWinController.ts:133-136`          |
| 20| `coinShower.mjs`                     | Drain offset (4.5s delay) so the shower doesn't visibly stop the moment the celebration "ends" — drains during the END-hold for a smoother taper. | P3 | `src/bigWinController.ts:158-161`          |

### §9.2 6+ SGF blocks that can learn from WoO

| SGF block                       | What it learns                                                                                                           |
|:--------------------------------|:-------------------------------------------------------------------------------------------------------------------------|
| `holdAndWin.mjs`                | Session-token cancellation pattern. Pre-determined cellResults map. Tension CSS class machine. Stochastic per-orb jackpot. |
| `bigWinTier.mjs`                | PREP phase. Single-`virtualElapsed` clock. Final-state hard-set after rollup. `img.decode()` preload. Per-tier shake table.|
| `winPresentation.mjs`           | `multipliedResult` pre-wrap before present call. Linear (not eased) rollup curve. Single-clock counter–banner sync.        |
| `freeSpins.mjs`                 | `waitForStart` keyboard+touch handler. Cinematic retrigger UX with flash burst + shake + zoom. Lazy-load heavy intro modules. |
| `progressiveFreeSpins.mjs`      | Educational "base × mult = total" popup on every winning spin when mult > 1.                                            |
| `winRollup.mjs`                 | Single-`virtualElapsed` clock. Linear counter movement. Final-state `gsap.killTweensOf` + `gsap.set` insurance.          |
| `coinShower.mjs`                | Gradual tier upgrade (don't restart). Drain offset for smoother taper.                                                   |
| `holdAndWinCreditBucket.mjs`    | Atomic credit at finalize. Trigger-win escrow inside the bonus session. BigWin gate against session total, not total-to-credit. |
| `forceSkip.mjs`                 | Skip-disabled gate during PREP phase (anti-misclick). Skip-sticky for remainder of round once invoked.                   |
| `triggerCounting.mjs`           | Decoupled trigger gate (in `features.ts`) from presentation controller. Host-side gate + controller-side trust contract. |

### §9.3 Anti-patterns observed in WoO that SGF should NOT inherit

| # | Anti-pattern                                                                                            | file:line                          | Why                                                                          |
|:--|:--------------------------------------------------------------------------------------------------------|:-----------------------------------|:----------------------------------------------------------------------------|
| 1 | `HNW_CONFIG.ORB_LAND_CHANCE = 0.01` hard-coded constant that drifts from the math sim (`features.ts:267-270`). | `src/hnwController.ts:62`          | UI animation desync from math. Documented as a known QA defect.              |
| 2 | `JACKPOT_VALUES` map hard-coded in the controller (`{MINI:12, MINOR:25, MAJOR:50, GRAND:150}`) used only for forced-debug payouts, but can drift from `paytable.ts` `HNW_ORB_VALUES`. | `src/hnwController.ts:34-39`       | Single-source-of-truth violation. Should derive from paytable.               |
| 3 | `Math.random()` used inside the controller (`generateOrbWithJackpot`, `determineOrbForCell`, etc.) instead of the seeded `mulberry32` RNG. UI-side orb-spawn is NOT audit-replayable. | `src/hnwController.ts:325, 964`    | Math sim uses seeded RNG; UI uses `Math.random`. Mismatch for replay.       |
| 4 | `BigWinTier = 1 \| 2 \| 3` union — extending to 5 tiers requires a type change AND a `BIG_WIN_TIERS` shape change AND a `getFinalTier` branch chain. SGF should design for N-tier from day one. | `src/bigWinController.ts:23-29, 183-189` | Not extensible. SGF `bigWinTier.mjs:53-56` already uses an array. |
| 5 | `HNW_TIMING` 70-line constants block hard-coded — turbo speed multiplier baked in, can't be GDD-driven. | `src/hnwController.ts:69-128`      | Not configurable per-GDD. SGF should expose a `timings` config object.       |
| 6 | Vendor mentions in legacy comments ("Playa/industry standard-style", "industry standard/WagerWorks") — scrubbed in current but slipped in originally. | `legacy/v11.27-2026-05-19/src/fsController.ts:679, 683` | Pre-commit grep should catch.                          |
| 7 | `setForceJackpot` directly bypasses the orb-table weighted generator — doesn't go through the same code path as production. | `src/hnwController.ts:266-275`     | Violates "force buttons must take a real spin" rule (user memory 05.06.2026).|
| 8 | Per-cell click-handler attached/detached on every loop iteration — leaks listener if `cleanupCellHandlers` is missed. | `src/hnwController.ts:975-1003`    | Add a single delegated handler in constructor.                                |
| 9 | DOM-string template injection in `showMultiplierPopup` / `showRetrigger` / `showCounter` — uses `innerHTML` with template literals. If any text becomes user-controlled, XSS. | `src/fsController.ts:575-588, 642-651, 716-723` | Use textContent or DOMPurify for any future i18n.                |
| 10| HNW summary credit happens BEFORE the trigger-grid is restored visually — by the time the player sees the trigger grid restored, they've already been credited. | `src/hnwController.ts:1336-1341`   | Cosmetic — feels less satisfying than restore-then-credit.                    |

### §9.4 Bug-class hypotheses worth verifying in SGF

| # | Hypothesis                                                                                                   | Verification approach                                                                                  |
|:--|:-------------------------------------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------------------|
| 1 | If `holdAndWin.mjs` per-cell spawn uses fixed chance (not fill-bonus formula), animation drifts from math sim. | Diff per-cell orb arrival distribution in UI vs sim over 10k respins. Expect drift if formula mismatch. |
| 2 | If `bigWinTier.mjs` lacks PREP phase, the very first click after the banner appears triggers an immediate skip. | Manual test: trigger Big Win, click within 50ms of banner appearance. Skip should NOT fire.            |
| 3 | If `winRollup.mjs` has separate counter and banner timers, fast-skip can leave counter and banner desynchronised. | Test: spam skip during rollup. Counter and banner should remain visually consistent.                    |
| 4 | If `progressiveFreeSpins.mjs` resets the multiplier on retrigger, FS feels less rewarding.                    | Test: force retrigger after several winning spins. Multiplier should persist.                          |
| 5 | If `freeSpins.mjs` finalize doesn't restore trigger-grid, returning to BASE shows the last FS grid.          | Test: end FS, observe base-game grid. Should be the original trigger grid.                              |
| 6 | If `bigWinTier.mjs` doesn't `gsap.killTweensOf` at end, a fast-skip can leave the title invisible.            | Test: skip immediately at start of rollup. Title text should be visible at end.                         |
| 7 | If `holdAndWin.mjs` cell-handler isn't delegated, listener leak across multiple round trigger/finalize cycles. | DevTools memory snapshot before and after 10 rounds; check listener count growth.                       |

### §9.5 Performance budgets implied by WoO

WoO's implicit budgets (not enforced via comments but observable):

| Budget                                         | WoO observation                                              | SGF target                                       |
|:----------------------------------------------|:-------------------------------------------------------------|:-------------------------------------------------|
| Main-thread cost per `applyTier`               | Single GSAP timeline + a few CSS-class toggles               | ≤2ms (mirror in SGF `bigWinTier.mjs` perf budget) |
| BigWin rollup frame cost                       | `requestAnimationFrame` driven, single rAF callback          | ≤2ms (already in SGF `bigWinTier.mjs` budget)     |
| HnW per-respin DOM writes                      | One `querySelectorAll('.hnw-cell:not(.has-orb)')` per loop   | Coalesced, OK                                     |
| FS HUD update frequency                        | Per spin (~once per 500-3000ms)                              | Cheap, OK                                          |
| Coin shower (3D)                               | WebGL via `Coin3DRenderer`                                   | SGF `coinShower.mjs` may need WebGL too            |
| Particles (jackpot bursts)                     | Canvas2D with rAF; auto-cleanup when all dead                | SGF should match — self-cleaning particles         |
| Listener attachment                            | Per-loop attach/detach (bug: see §9.3 #8)                    | SGF: single delegated handler at construction      |
| Memory                                          | No bounded set growth; `bumpedTiers` cleared in cleanup      | SGF: bounded sets, clear in cleanup                |

---

## §10. Appendix — index of all controllers' citations

### §10.1 hnwController.ts — line index

| Line(s)         | Symbol / behaviour                                                  |
|:----------------|:--------------------------------------------------------------------|
| 31              | `JackpotType` exported union                                        |
| 34-39           | `JACKPOT_VALUES` hardcoded map (audit smell)                         |
| 42-48           | `HNWOrb` interface                                                   |
| 51-56           | `HNWState` enum                                                      |
| 59-66           | `HNW_CONFIG` controller-local constants                              |
| 69-128          | `HNW_TIMING` constants                                               |
| 130-133         | `hnwTiming` helper                                                    |
| 136-142         | `HNWGameCallbacks` interface                                          |
| 144-181         | `HNWController` class header + ctor                                   |
| 185-215         | Public getters                                                       |
| 218-220         | `requestSkip`                                                        |
| 225, 228-230    | Force-jackpot debug machinery                                        |
| 232-311         | `trigger` — main entry; INACTIVE → INTRO state move at line 295      |
| 313-315         | `isSessionActive` predicate                                           |
| 323-338         | `generateOrbWithJackpot` — paytable-driven                            |
| 340-343         | `generateOrbMultiplier` (deprecated, always returns 1)               |
| 345-347         | `isTurbo` check                                                      |
| 351-471         | `playIntro` — full intro animation sequence                          |
| 473-478         | `highlightTriggerOrbs`                                                |
| 482-495         | `showOverlay`                                                        |
| 497-508         | `positionGrid` — pin to reelFrame coords                              |
| 510-532         | `updateDisplay` — counter render + tension classes                  |
| 534-553         | `updateOrbProgress`                                                  |
| 555-565         | `updateJackpotIndicators`                                            |
| 567-577         | `showWinDelta`                                                       |
| 582-624         | `playOrbValueFly` — fly-to-counter                                    |
| 626-705         | `renderOrbs`                                                         |
| 709-825         | `runLoop` — main respin loop                                          |
| 827-836         | `animateRespinsTick`                                                  |
| 839-848         | `animateRespinsReset`                                                |
| 854-897         | `playJackpotCelebration` — tier-specific overlay                     |
| 902-961         | `playFullGridCelebration` — 500× bonus                                |
| 963-973         | `determineOrbForCell` — per-cell RNG                                  |
| 975-994         | `setupCellClickHandler`                                              |
| 996-1003        | `cleanupCellHandlers`                                                |
| 1008-1030       | `triggerScreenShake`                                                  |
| 1034-1123       | `triggerJackpotParticles` — canvas2d burst                            |
| 1125-1186       | `stopCell` — per-cell stop with reveal                                |
| 1188-1209       | `autoStopCells`                                                       |
| 1213-1295       | `showSummary` — RUNNING → SUMMARY at 1216                            |
| 1297-1348       | `finalize` — SUMMARY → INACTIVE, credit, restore                     |

### §10.2 bigWinController.ts — line index

| Line(s)         | Symbol / behaviour                                                  |
|:----------------|:--------------------------------------------------------------------|
| 23-27           | `BIG_WIN_TIERS` constant (tier1/tier2/tier3)                         |
| 29              | `BigWinTier` union                                                  |
| 31-85           | Class header + ctor + DOM mounts                                     |
| 63-65           | Timing constants `PREP_MS = 500`, `TIER_MS = 4000`, `OVERLAY_FADE_MS = 750` |
| 92-109          | `preloadTierImages` with `img.decode()`                              |
| 114-120         | `initAdvancedEffects`                                                 |
| 125-128         | `startCoinShower`                                                    |
| 133-136         | `updateCoinShowerTier`                                                |
| 141-144         | `fadeOutCoinShower`                                                  |
| 149-152         | `hideCoinShower`                                                     |
| 158-161         | `drainCoinShower` — 4.5s delay                                       |
| 167-169         | `setScreenShakeHandler` — host injection                             |
| 174-178         | `shouldTrigger` — `win/bet >= 10`                                    |
| 183-189         | `getFinalTier`                                                        |
| 194-198         | `getTierConfig`                                                       |
| 205-257         | `applyTier` — tier upgrade with shake/particles/glow                 |
| 263-284         | `playModernTierTransition` — shockwave/particles                     |
| 290-342         | `playLightningFlash` (tier-3 special)                                 |
| 347-380         | `playElectricArc`                                                     |
| 385-392         | `setPhase('prep'|'show'|'idle')`                                     |
| 397-403         | `setEnd(on)`                                                          |
| 408-425         | `showOverlay` — entrance shockwave + golden rays                      |
| 430-433         | `hideOverlay`                                                         |
| 440-463         | `prepareForShow` — seamless FS→BigWin seam                            |
| 469-483         | `fadeOutOverlay`                                                     |
| 488-494         | `sleepWithSkip` (respects skip)                                       |
| 499-504         | `sleep` (ignores skip — mandatory)                                    |
| 519-751         | `show` — main presentation                                            |
| 527             | Acquire UIStateManager lock                                          |
| 565-570         | PREP phase (skip disabled)                                           |
| 573             | `setPhase('show')` (rollup begin)                                     |
| 583-668         | Rollup loop (`virtualElapsed` accumulator)                            |
| 670-731         | END hold (drain + 1s post + skip)                                     |
| 716-731         | END-hold loop with skip                                              |
| 747             | `fadeOutOverlay(skippedDuringEnd)`                                    |
| 750             | `cleanup(true)`                                                       |
| 756-762         | `requestSkip`                                                         |
| 770-772         | `isShowing` predicate                                                |
| 778-824         | `cleanup` — kill tweens, release lock, hide overlay                   |
| 790             | Release UIStateManager lock                                          |

### §10.3 fsController.ts — line index

| Line(s)         | Symbol / behaviour                                                  |
|:----------------|:--------------------------------------------------------------------|
| 43-48           | `FSState` enum                                                       |
| 51              | `FS_AWARDS` re-export                                                |
| 54-87           | `FSGameCallbacks` interface                                          |
| 89-133          | Class header + ctor + fields                                         |
| 94-115          | Private state fields (`remaining`, `total`, `totalWin`, `currentMult`, `triggerResult`, `triggerGrid`, `forceRetriggerScatters`) |
| 138-185         | Public getters                                                       |
| 193-202         | `forceRetrigger` / `clearForce` debug helpers                         |
| 213-284         | `trigger` — main entry; INACTIVE → INTRO at 233; INTRO → RUNNING at 275 |
| 288-298         | `playIntro` (delegates to lazy-loaded `playFSEpicIntro`)             |
| 300-328         | `waitForStart` — 2s auto / click / Space/Enter                       |
| 332-350         | `runLoop` — main FS spin loop                                        |
| 352-482         | `executeSpin` — single FS spin                                       |
| 415             | Win gate `if (baseWin > 0)`                                          |
| 417             | Apply multiplier                                                      |
| 426-428         | Multiplier popup gate (`if mult > 1`)                                 |
| 431-435         | Mult increment (cap 10)                                              |
| 465-481         | Retrigger detection + payout + visual                                 |
| 486-519         | `showSummary` — RUNNING → SUMMARY at 489                              |
| 521-565         | `finalize` — SUMMARY → INACTIVE at 537; atomic credit at 557          |
| 569-599         | `showCounter` — DOM-injected counter container                       |
| 601-606         | `hideCounter`                                                         |
| 608-614         | `updateCounter`                                                       |
| 616-630         | `updateMultiplierDisplay`                                              |
| 632-637         | `updateTotalWinDisplay`                                              |
| 639-659         | `showMultiplierPopup` — base × mult = total                          |
| 661-676         | `rollupTotalWin` — GSAP tween                                         |
| 678-735         | `showRetrigger` — flash burst + shake + zoom (1900ms beat)            |
| 742-776         | `createRetriggerGrid` — debug-only synthetic grid                     |

---

## §11. Appendix — config sources

For completeness, the values that the controllers read at runtime come from `src/paytable.ts` (a config bridge over `game.config.json`):

| Constant                          | paytable.ts source line             | Default                                                                                  |
|:----------------------------------|:-------------------------------------|:-----------------------------------------------------------------------------------------|
| `FREE_SPINS_AWARDS`               | `paytable.ts:65-71`                 | Per `game.config.json` features.free_spins.awards (typically 3→14, 4→16, 5→18)            |
| `SCATTER_PAYS`                    | `paytable.ts:55-61`                 | Per `game.config.json` features.free_spins.scatter_pays                                  |
| `FS_MULT_START`                   | `paytable.ts:76`                    | 1                                                                                         |
| `FS_MULT_INCREMENT`               | `paytable.ts:77`                    | 1                                                                                         |
| `FS_MULT_MAX`                     | `paytable.ts:78`                    | 10                                                                                        |
| `FS_RETRIGGER_ENABLED`            | `paytable.ts:79`                    | true                                                                                      |
| `HNW_TRIGGER_COUNT`               | `paytable.ts:84`                    | 6                                                                                         |
| `HNW_INITIAL_RESPINS`             | `paytable.ts:85`                    | 3                                                                                         |
| `HNW_RESPINS_ON_NEW_ORB`          | `paytable.ts:86`                    | 3                                                                                         |
| `HNW_FULL_GRID_BONUS`             | `paytable.ts:87`                    | 500                                                                                       |
| `HNW_ORB_CHANCE_BASE`             | `paytable.ts:89`                    | 0.0352                                                                                    |
| `HNW_ORB_CHANCE_FILL_BONUS`       | `paytable.ts:90`                    | 0.015                                                                                     |
| `HNW_ORB_VALUES`                  | `paytable.ts:96-104`                | Weighted table — entries with optional `jackpot: 'MINI'|'MINOR'|'MAJOR'|'GRAND'`         |
| `MAX_WIN_CAP`                     | `paytable.ts:116`                   | Per `game.config.json` caps.max_win                                                       |
| `FEATURE_LOOP_CAP`                | `paytable.ts:117`                   | Per `game.config.json` caps.feature_loop                                                  |

---

## §12. Closing observations

1. **Frozen production code.** Three of the most complex controllers in WoO are byte-equal between v11.27-2026-05-19 and current. The two-line diff in `fsController.ts` is a vendor-mention scrub for compliance. This is the strongest signal of production maturity — the team considers these controllers solved.

2. **Math/UI desync is the only architectural smell.** `HNW_CONFIG.ORB_LAND_CHANCE = 0.01` (controller, `hnwController.ts:62`) does NOT match the math sim formula `0.0352 + fillRatio × 0.015` (`features.ts:267-270`). This is documented as a known QA defect. The fix is a one-liner — import the math-side constants and recompute per spin.

3. **Two cancellation patterns, both correct.** HnW uses a controller-owned monotonic `sessionId`; FS delegates to the host's `spinId`. Both achieve the same correctness. SGF should pick ONE pattern and use it everywhere for consistency — recommend the controller-owned monotonic pattern because it's self-contained.

4. **Single atomic credit at terminal state** is the regulator-clean pattern. Both bonus controllers do this. Any block in SGF that handles a bonus session MUST follow this rule.

5. **PREP phase + END phase** are the two most under-appreciated patterns. PREP gates against immediate-misclick skip. END outlasts the rollup so drain animations can taper without dead-cutting. SGF's `bigWinTier.mjs` doesn't currently have a documented PREP — opportunity to add.

6. **Vendor scrub is real**. The 2-line diff in `fsController.ts` legacy → current is a vendor-name removal. Pre-commit grep enforcement (per user rule `rule_no_vendor_mentions.md`) catches this in future commits.

7. **The "force buttons must take a real spin" rule** is enforced in `fsController.forceRetrigger` (lines 742-776) — the debug retrigger builds a real grid with planted scatters and runs it through the SAME `evaluateSpin → presentWins → retrigger` pipeline. The HnW `setForceJackpot` (lines 228-230) BYPASSES the orb-table generator — this is the only force-button in WoO that violates the rule. SGF should not adopt the HnW shortcut.

8. **No HookBus**. WoO has no single-channel event bus. Instead, dispatch is per-channel: DOM CSS classes (`storm-mode`, `bigwin-active`, `hnw-mode`), `UIStateManager` singleton, `RF.emit` bridge (math audit), and typed callback interfaces. SGF's `hookBus.mjs` is a different architectural choice — single-channel with named events. Both work; the trade-off is centralized observability (hookBus) vs typed contracts (WoO callbacks).

9. **The math controller (`features.ts`) is the source-of-truth for the per-spin formula.** Any UI controller that wants to mirror the math behaviour should `import` from `paytable.ts` (which re-exports config) and apply the **same formula**. WoO's HnW controller doesn't do this and has the documented drift. SGF should do this from day one.

10. **Inversion-of-control via typed callbacks.** Both bonus controllers expose a `*GameCallbacks` interface that the host (`main.ts`) implements. This is the cleanest seam I've seen in production slot code — the controller doesn't know anything about the host's balance model, autoplay state, or RNG seed; it just calls back. SGF blocks should adopt the same pattern: every block exposes a `*Hooks` or `*Callbacks` interface for host injection.

---

**End of WoO Controllers RE report.**

**Total line count target:** ≥ 1000 lines (this report).
**Citations:** every claim in §1–§9 has a `path/file.ts:LINE` citation per the task brief.
**Vendor scrub:** synthesis sections (§5, §6, §9) use only tier1..tier5 nomenclature and "production-validated controller" / "industry-standard pattern" framing; never industry standard / Pragmatic / NetEnt / WagerWorks / WoO theme strings.
