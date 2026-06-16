# Reel Engine + Spin Timing — Reverse Engineering Report

> **Subject of reverse-engineering** — production-validated reference game,
> `Wrath Of Olympus`, Math v11.27 / Config v12.1.0 (96.009 % RTP, 4 B-spin
> sealed). Cross-reference / bridge sections (§8) deliberately use vendor-neutral
> language because they feed `slot-gdd-factory` synthesis. Sections §1 – §7 + §9
> are direct WoO source-level dissection — names left intact for citation
> precision (this is OWN code, not third-party material).
>
> **Files inspected**
>
> | Role | Path | LOC |
> |:--|:--|--:|
> | Math reel weights (current) | `~/Projects/Wrath Of Olympus/src/reels.ts` | 294 |
> | Math reel weights (legacy v11.27) | `~/Projects/Wrath Of Olympus/legacy/v11.27-2026-05-19/src/reels.ts` | 442 |
> | Timing primitives (current) | `~/Projects/Wrath Of Olympus/src/timing.ts` | 103 |
> | Timing primitives (legacy v11.27) | `~/Projects/Wrath Of Olympus/legacy/v11.27-2026-05-19/src/timing.ts` | 103 |
> | Visual reel state machine + tick loop | `~/Projects/Wrath Of Olympus/src/renderer.ts` | ≈ 7 800 |
> | Spin orchestrator + anticipation policy | `~/Projects/Wrath Of Olympus/src/main.ts` | ≈ 5 800 |
> | FS reel runner | `~/Projects/Wrath Of Olympus/src/main.ts::executeFSSpin` L3341 |
>
> The two leaf files Boki named — `src/reels.ts` and `src/timing.ts` — turn out
> to be the WEIGHT / PROFILE definitions only. The actual reel STATE MACHINE,
> tick loop, anticipation lifecycle, slam stop, race-condition handling, and
> mobile rAF budgeting all live in `src/renderer.ts` (read end-to-end) and the
> orchestration sits in `src/main.ts` (`GameController.spin` + `stopAll` +
> `executeFSSpin`). Because the brief explicitly asks for a complete RE of the
> "reel engine + spin timing system" — and because the timing.ts profile is dead
> weight without renderer.ts consuming it — this report covers BOTH layers with
> exact `file:line` citations end-to-end.

---

## §1. Reel state machine

### §1.1. The `ReelRuntime` record (one per visible reel column)

`renderer.ts:115-150` declares the entire per-reel runtime contract. There is
**no enum** for reel state in WoO — state is encoded as four boolean flags + a
bounce sub-state machine inside the same record. The flags are read every tick
in `onTick` (renderer.ts:7073) and form the canonical state vector.

```text
renderer.ts:115  type ReelRuntime = {
renderer.ts:116    strip: PIXI.Container;
renderer.ts:117    maskGfx: PIXI.Graphics;
renderer.ts:118    cells: Cell[];
renderer.ts:119    // State machine
renderer.ts:120    spinning: boolean;
renderer.ts:121    stopping: boolean;
renderer.ts:122    stopRequested: boolean;
renderer.ts:123    stopped: boolean;       // Guard against double finalize
renderer.ts:124    // Rotation tracking
renderer.ts:125    offsetPx: number;
renderer.ts:126    rotationCount: number;
renderer.ts:127    minSpinRotations: number;
renderer.ts:128    // Stop target
renderer.ts:129    targetSymbols: SymbolId[];
renderer.ts:130    targetY: number;
renderer.ts:131    committed: boolean;
renderer.ts:132    // Stagger timing
renderer.ts:133    stopDelayMs: number;
renderer.ts:134    stopRequestTime: number;
renderer.ts:135    // PIXI bounce state (AAA multi-bounce physics)
renderer.ts:136    __bouncing?: boolean;
renderer.ts:137    __bounceT?: number;
renderer.ts:138    __bounceBaseY?: number;
renderer.ts:139    __bouncePx?: number;
renderer.ts:140    __bounceDone?: boolean;
renderer.ts:141    __bounceIteration?: number;
renderer.ts:142    __bouncePhase?: 'drop' | 'return';
renderer.ts:143    // Stop phase timing
renderer.ts:144    stopStartMs?: number;
renderer.ts:145    // Windup state
renderer.ts:146    __windupActive?: boolean;
renderer.ts:147    __windupT?: number;
renderer.ts:148    __windupBaseY?: number;
renderer.ts:149    __windupDelayFrames?: number;
renderer.ts:150  };
```

### §1.2. Canonical states (derived from flag tuples)

The brief's `IDLE / SPINNING / STOPPING / LANDING / SETTLED / ANTICIPATING` are
NOT explicit enum values. They are FLAG TUPLES read at `renderer.ts:7112-7378`
inside `onTick`. The mapping below is reverse-engineered from the live branches:

| State | Flag tuple | Tick branch (renderer.ts) | Side effect |
|:--|:--|:--:|:--|
| `IDLE` | `spinning=false, stopping=false, stopped=true, __bouncing=false` | (no branch fires) | `tick` removed if `anyActive=false` (L7382-7385) |
| `WINDUP` | `spinning=true, __windupActive=true` | L7186-7217 | strip.y eased upward, no symbol roll |
| `SPINNING` (`accel`) | `spinning=true, reelElapsed < accelMs` | L7224-7232 | speedPxPerFrame ramps 0.3 → 1.0 × `baseSpeed × speedMul` |
| `SPINNING` (`cruise`) | `spinning=true, reelElapsed ≥ accelMs` | L7220-7278 | constant `speedPxPerFrame = baseSpeed × speedMul`; per-cell rotate at L7238 |
| `STOP_REQUESTED` | `spinning=true, stopRequested=true` | L7257-7277 | gated by `rotationCount ≥ minSpinRotations && stopElapsed ≥ stopDelayMs` |
| `STOPPING` (decel) | `spinning=false, stopping=true` | L7297-7377 | ease toward `targetY` with `easingSpeed` profile |
| `LANDING` (`snap`) | `stopping=true, |delta|≤snapThreshold && inStopMs≥minStopMs` | L7308-7321 | pixel-snap strip.y; hide buffer cells |
| `BOUNCING` | `stopped=true, __bouncing=true` | L7117-7181 | drop/return iterations decay by `bounceDecay` |
| `SETTLED` | `stopped=true, __bouncing=false` | (no branch) | reel idle, awaits next `startSpin` |
| `ANTICIPATING` (visual halo) | (renderer-side overlay, NOT a reel-internal flag) | renderer.ts:953-1128 | `anticipationActive=true`; gold halo container per still-spinning reel |

The reel-runtime record itself has NO `anticipating` field. Anticipation in WoO
is a **renderer-level overlay** (`Renderer.anticipationActive`,
renderer.ts:953-957) that is orthogonal to the per-reel state machine. The
overlay simply paints golden halo containers on whatever reels still report
`stopped === false` at the moment `main.ts` calls `startAnticipation`. This is a
design choice worth flagging for SGF (§8).

### §1.3. Transition events

| From | To | Trigger | Code |
|:--|:--|:--|:--|
| IDLE | WINDUP | `startSpin(spinId)` called from `main.ts` | renderer.ts:1872-1944 |
| WINDUP | SPINNING-accel | `__windupT > windupFrames` | renderer.ts:7211-7217 |
| SPINNING-accel | SPINNING-cruise | `reelElapsed ≥ accelMs` | renderer.ts:7225 (else branch) |
| SPINNING | STOP_REQUESTED | `stopReel(reelIdx, syms)` from main.ts | renderer.ts:1949-1963 |
| STOP_REQUESTED | STOPPING | `rotationCount ≥ minSpinRotations && stopElapsed ≥ stopDelayMs` | renderer.ts:7261-7277 |
| STOPPING | LANDING-snap | `|delta|≤snapThreshold && inStopMs≥minStopMs` | renderer.ts:7308 |
| LANDING-snap | BOUNCING | `profile.bouncePx > 0 && !__bounceDone` | renderer.ts:7325-7340 |
| BOUNCING | SETTLED | `currentAmp < 0.5 || iteration ≥ bounceCount` | renderer.ts:7135-7143 |
| (any) | SETTLED (force) | `slamStopToGrid(grid)` from main.ts | renderer.ts:1970-2028 |
| (any) | SETTLED (panic) | `stopAll()` from renderer | renderer.ts:2034-2083 |
| ANTICIPATING | (no transition — overlay) | `stopAnticipation()` | renderer.ts:1101-1128 |

### §1.4. State-handler file:line map

| Handler | Location |
|:--|:--|
| `startSpin(spinId)` | renderer.ts:1872 |
| `stopReel(reelIndex, syms)` | renderer.ts:1949 |
| `slamStopToGrid(grid)` | renderer.ts:1970 |
| `stopAll()` (panic freeze) | renderer.ts:2034 |
| `commitStopSymbols(reel)` | renderer.ts:2089 |
| `finalizeReelStop(reel, idx)` | renderer.ts:2178 |
| `playReelLandBounce(idx)` | renderer.ts:2222 |
| `emitReelLandDust(idx)` | renderer.ts:2240 |
| `playStopAllAnimation()` | renderer.ts:2281 |
| `applyLandingFx(grid)` | renderer.ts:2111 |
| `startAnticipation(type)` | renderer.ts:975 |
| `stopAnticipation()` | renderer.ts:1101 |
| `onTick(_delta)` | renderer.ts:7073 |
| `setSpinningUI(on)` | renderer.ts:1860 |
| `setTurbo(active)` | renderer.ts:289 |
| `setCellSymbol(cell, sym)` | renderer.ts:1777 |
| `renderGrid(grid)` | renderer.ts:1825 |

### §1.5. Side effects per state

| State | Side effects | Cite |
|:--|:--|:--|
| IDLE | Buffer cells (rows 0 + 4) hidden to prevent leak through mask padding | renderer.ts:1208-1209 |
| `startSpin` enter | (1) `clearPaylines + clearHighlights`, (2) lock turbo profile, (3) record `spinStartTime`, (4) `setSpinningUI(true)` adds `.is-spinning` to reel frame DOM, (5) bump `spinToken` and capture into `tickToken` for stale guard, (6) reset all per-reel flags + windup state, (7) show buffer cells `for (const c of reel.cells) c.container.visible = true`, (8) add PIXI ticker if not active | renderer.ts:1872-1944 |
| WINDUP per reel | Strip pulled UP by `windupPx` over `windupFrames` with cubic ease-in-out; per-reel cascade delay `windupStaggerFrames = 2` (~33 ms @ 60 fps) | renderer.ts:7186-7217, L1930-1934 |
| SPINNING (accel) | Speed ramps `0.3 → 1.0 × baseSpeed × speedMul` linearly (or `getEaseOut` in turbo) over `accelMs`. `baseSpeed = max(20, cellH * 0.25)` | renderer.ts:7076, L7220-7232 |
| SPINNING (cruise / rotate) | When `offsetPx ≥ cellStep`, the strip rotates ONE cell via `pop() + unshift()`, all cell Y positions re-computed, the new top cell gets a random symbol from `allSymbols`. `rotationCount++` | renderer.ts:7237-7254 |
| STOPPING (decel) | Strip Y eased toward `targetY` with `easingSpeed`; forced min 1 px step when `|step|<0.5 && |delta|>snapThreshold` (anti-stall fix) | renderer.ts:7361-7377 |
| LANDING (snap) | Pixel-snap `strip.y = round(targetY)`; lock `targetY` to integer; hide buffer cells (rows 0 + 4); arm bounce if `bouncePx > 0 && !__bounceDone`; reset wobble X | renderer.ts:7308-7353 |
| BOUNCING | 2-iteration cushion bounce (normal profile) with `bounceDecay 0.3`, smooth ease-out drop + ease-in-out return; on terminate fires `playReelLandPulse` (no-op) + `playReelLandDust` (dust particles) | renderer.ts:7117-7181 + L7141-7143 |
| SETTLED (all reels) | When `this.reels.every(r => r.stopped)` → `setSpinningUI(false)` removes `.is-spinning` from reel frame | renderer.ts:7355-7360 |
| Slam Stop | `getSpinProfile(true)` forced (turbo profile); ticker REMOVED immediately; `.is-spinning` removed; every reel: `spinning=false, stopping=false, stopped=true, committed=true`; strip.y = `round(-(cellH+gapY))`; bounce cleared; cell positions reset; symbols set from grid | renderer.ts:1970-2028 |
| Panic stopAll | Snap to nearest cell boundary WITHOUT changing symbols (`snapY = round(round(currentY/cellStep)*cellStep)`); ticker removed; CSS class removed; `playStopAllAnimation()` wave fires | renderer.ts:2034-2083 |

---

## §2. Spin lifecycle (per-spin end-to-end timeline)

### §2.1. preSpin hook origin

There is **NO formal `preSpin` HookBus** in WoO. The pre-spin moment is the
inlined block at `main.ts:2229-2310` inside `GameController.spin()`. Sequence:

| Order | Action | Cite |
|:--|:--|:--|
| 1 | Idempotency guard `if (this.spinning) return` | main.ts:2195 |
| 2 | `canBaseSpin()` check (block during FS / HNW / featureTriggerAnimating) | main.ts:357-363 + L2198 |
| 3 | `triggerHaptic("light")` mobile feedback | main.ts:2264 |
| 4 | `spinHintManager.onSpinStart()` hides hints | main.ts:2267 |
| 5 | `this.setSpinningState(true)` flip + UI sync (`main.ts:1661-1720`) | main.ts:2269 |
| 6 | `spinSeq++` → monotonic spinId; capture into `activeSpinId` | main.ts:2275-2276 |
| 7 | `RF.emit("onSpin", { sessionId, seed, bet })` audio/RTP bus | main.ts:2281 |
| 8 | `renderer.startSpin(sessionId)` — visual machine starts | main.ts:2283 |
| 9 | `hideLightningTooltip()` UI cleanup | main.ts:2286 |
| 10 | `startStormMultiplierSpin()` — separate side reel begins | main.ts:2289 |
| 11 | `evaluateSpin` — math result pre-computed BEFORE reels stop (so `stopAll` can slam) | main.ts:2342-2349 |
| 12 | `pendingSpinResult = { sessionId, result, betAmount, grid, stops }` stashed | main.ts:2401-2408 |
| 13 | `await sleep(DEFAULT_TIMING.reelSpinBase)` (1200 ms) | main.ts:2410 |
| 14 | Abort-token re-check after sleep (race-cond bailout) | main.ts:2415-2418 |

Note (12) — this is the critical design feature: result is determined BEFORE
visual stop. Slam stop becomes trivial because the renderer already knows what
to draw.

### §2.2. Stagger pattern (cascade ms per reel — START)

`renderer.startSpin` assigns staggered START delays via the WINDUP system, NOT
the reel-stop schedule:

```text
renderer.ts:1929 const windupStaggerFrames = 2; // ~33ms at 60fps
renderer.ts:1930 reel.__windupActive = profile.windupPx > 0;
renderer.ts:1933 reel.__windupDelayFrames = i * windupStaggerFrames;
```

So reel 0 starts windup immediately, reel 1 after 2 frames (~33 ms), reel 2
after 4 frames (~67 ms), reel 3 after 6 (~100 ms), reel 4 after 8 (~133 ms).

A SEPARATE stagger drives the per-reel STOP schedule via `profile.staggerMs`:

```text
renderer.ts:1913 reel.stopDelayMs = i * profile.staggerMs;
```

— so per-reel stop delay = `i × 180 ms` in NORMAL profile, `i × 45 ms` in TURBO,
`i × 30 ms` in SLAM.

### §2.3. Velocity ramp

| Phase | Speed | Formula | Cite |
|:--|:--|:--|:--|
| WINDUP | UPWARD pull, eased `0 → windupPx` cubic ease-in-out | `eased = p<0.5 ? 4p³ : 1 − (-2p+2)³/2` | renderer.ts:7205-7209 |
| ACCEL | `baseSpeed × speedMul × (0.3 + 0.7 × easedProgress)` | linear ramp; turbo uses `getEaseOut(2.6)` | renderer.ts:7225-7232 |
| CRUISE | `baseSpeed × speedMul` (constant) | `baseSpeed = max(20, cellH × 0.25)` so on a 198 px cell `baseSpeed = 49.5 px/frame` | renderer.ts:7076 + L7220 |
| DECEL | Tween toward `targetY` with `easingSpeed × (1 + getEaseOut(progress) × 0.5)` | progress-amplified easing | renderer.ts:7361-7368 |
| BOUNCE drop | `currentAmp × (1 − (1−dropProgress)^elasticity)` | elasticity = 1.8 normal, 2.0 turbo | renderer.ts:7153-7158 |
| BOUNCE return | smooth ease-in-out `<0.5 ? 2t² : 1 − (-2t+2)²/2` | symmetric S-curve | renderer.ts:7164-7170 |

Constants — see §3.

### §2.4. Symbol pop-in (off-screen → viewport → settle)

The reel strip has 5 cells: 3 visible (rows 1, 2, 3 by index) + 2 buffer (rows 0
and 4). Buffer cells are hidden at rest to prevent peek-through:

```text
renderer.ts:1190  const totalCells = ROWS + 2; // 3 visible + 2 buffer
renderer.ts:1208  cells[0].container.visible = false;
renderer.ts:1209  cells[totalCells - 1].container.visible = false;
renderer.ts:1213  strip.y = -(this.cellH + this.gapY);
```

When spinning starts, ALL cells become visible (renderer.ts:1923). Cell
rotation in `onTick` does `pop() + unshift() + setCellSymbol(lastCell, randomSym)`
(renderer.ts:7243-7254). After landing, buffer cells are hidden again
(renderer.ts:7320-7321 and renderer.ts:1846-1849).

The "off-screen → viewport" entry timing is implicit: each rotated cell enters
at index 0 (top buffer), traverses down to index 4 (bottom buffer) over `4 ×
cellStep` of strip movement.

### §2.5. Landing pattern

| Step | Action | Cite |
|:--|:--|:--|
| 1 | When `|delta| ≤ snapThreshold && inStopMs ≥ minStopMs`, hard-snap `strip.y = round(targetY)` | renderer.ts:7308-7311 |
| 2 | Lock `targetY = round(strip.y)` to prevent subpixel drift | renderer.ts:7311 |
| 3 | Set `stopping=false, stopped=true, committed=true` | renderer.ts:7313-7315 |
| 4 | Hide buffer cells | renderer.ts:7320-7321 |
| 5 | Arm bounce (`__bouncing=true, __bouncePx=profile.bouncePx, __bounceDone=true`) | renderer.ts:7325-7332 |
| 6 | Reset wobble X to base column | renderer.ts:7353 |
| 7 | If all reels stopped → `setSpinningUI(false)` | renderer.ts:7355-7360 |
| 8 | On bounce terminate → `playReelLandPulse(idx)` (no-op, dead code) + `playReelLandBounce(idx)` (dust particles) | renderer.ts:7141-7143 + L2222-2225 |
| 9 | Landing FX overlay (CSS animation classes on `#landingFxGrid`, DOM-side) — invoked by main.ts only on NO-WIN spins | renderer.ts:2111-2173 |
| 10 | Wave landing animation (sequential cell scale-pulse, left-to-right) | renderer.ts:2335-2371 |

### §2.6. Stop dispatch from main orchestrator

`main.ts:2434-2481` is the per-reel stop loop:

```text
main.ts:2434  for (let r = 0; r < 5; r++) {
main.ts:2436    if (this.spinAbortToken !== myAbortToken || !this.isSpinActive(spinId)) {
main.ts:2438      return;
main.ts:2439    }
main.ts:2443    const anticipation = shouldAnticipate(grid, r);
main.ts:2445    if (anticipation.active && anticipation.type) {
main.ts:2447      if (!anticipationActive) {
main.ts:2451        this.renderer.startAnticipation(anticipation.type);
main.ts:2452      }
main.ts:2455      const spinTime = anticipationDuration + (anticipationReelCount * progressiveStep);
main.ts:2458      await sleep(spinTime);
main.ts:2459      anticipationReelCount++;
main.ts:2460    }
main.ts:2463    const reelSyms = [grid[r][0], grid[r][1], grid[r][2]];
main.ts:2465    this.renderer.stopReel(r, reelSyms);
main.ts:2467    RF.emit("onReelStop", { sessionId, reel: r, stop: stops[r], symbols: reelSyms });
main.ts:2475    if (!anticipation.active) {
main.ts:2476      await sleep(profile.staggerMs);
main.ts:2477    } else {
main.ts:2479      await sleep(100); // shorter delay after anticipation
main.ts:2480    }
main.ts:2481  }
```

So the stop cascade timing per reel is:
- NO anticipation: `profile.staggerMs` (180 ms NORMAL, 45 ms TURBO) between reels.
- WITH anticipation on reel `r`: extra `ANTICIPATION.SPIN_DURATION +
  anticipationReelCount × PROGRESSIVE_STEP` (`2000 + n × 500` NORMAL, `800 + n
  × 200` TURBO) before reel `r` stops, then 100 ms before next reel.

### §2.7. Spin lifecycle file:line per phase

| Phase | main.ts (orchestrator) | renderer.ts (engine) |
|:--|:--|:--|
| preSpin | L2229-2310 | L1872-1944 (`startSpin`) |
| WINDUP | — | L7186-7217 |
| Result pre-compute | L2342-2349 (`evaluateSpin`) | — |
| Stash pendingResult | L2401-2408 | — |
| `await sleep(reelSpinBase)` | L2410 | — |
| Per-reel stop loop | L2434-2481 | L1949-1963 (`stopReel`) |
| Anticipation arm | L2445-2452 | L975 (`startAnticipation`) |
| Reel decel | — | L7297-7377 |
| Land snap | — | L7308-7321 |
| Bounce | — | L7117-7181 |
| Anticipation disarm | L2484-2487 | L1101 (`stopAnticipation`) |
| Storm reel stop | L2493-2508 | (`stormMultiplierReel.ts`) |
| Win presentation gate | L2521+ | L4891+ |
| All-settled | — | L7355-7360 |

---

## §3. Timing primitives

### §3.1. `DEFAULT_TIMING` (the orchestrator-level sleep wall)

```text
timing.ts:8   export const DEFAULT_TIMING: SpinTiming = {
timing.ts:9     reelStartStagger: 200,  // ms (unused in current code — kept for legacy)
timing.ts:10    reelSpinBase: 1200,     // ms — main.ts:2410 awaits this before stop loop
timing.ts:11    reelSpinStep: 140,      // ms (unused)
timing.ts:12    reelStopEase: 120,      // ms (unused — comment notes "future use")
timing.ts:13  };
```

Only `reelSpinBase = 1200` is read in current code (`main.ts:2410` and
`main.ts:3406`). The other three keys are dead code retained for the legacy
type contract.

### §3.2. `SPIN_PROFILE_NORMAL`

```text
timing.ts:42-59
accelMs:              130   // snappy acceleration
steadyMs:             1350  // optimal steady spin (unused directly, descriptive)
decelMs:              300   // smooth efficient deceleration
staggerMs:            180   // per-reel stop cascade
bouncePx:             6     // soft cushion landing
minRotations:         5     // anticipation minimum
speedMul:             1.15  // overall speed multiplier
snapPx:               2     // (descriptive — actual snapThreshold is hardcoded in onTick)
easingSpeed:          0.16  // (descriptive — actual easing in onTick is 0.10 normal)
windupPx:             42    // upward pull distance
windupFrames:         7     // ~115ms windup duration
bounceDecay:          0.3   // 30% of primary amplitude on iteration 2
bounceCount:          2     // two bounces total
bounceElasticity:     1.8   // softer spring
anticipationWobble:   0     // DISABLED — caused symbol overflow outside mask
```

### §3.3. `SPIN_PROFILE_TURBO`

```text
timing.ts:61-78
accelMs:              70
steadyMs:             450
decelMs:              120
staggerMs:            45
bouncePx:             3
minRotations:         2
speedMul:             2.6
snapPx:               3
easingSpeed:          0.45
windupPx:             18
windupFrames:         4
bounceDecay:          0.2
bounceCount:          1
bounceElasticity:     2.0
anticipationWobble:   0
```

### §3.4. `SPIN_PROFILE_SLAM`

```text
timing.ts:81-98
accelMs:              0
steadyMs:             0
decelMs:              100
staggerMs:            30
bouncePx:             0     // disabled — only dust on land
minRotations:         0
speedMul:             2.0
snapPx:               4
easingSpeed:          0.5
windupPx:             0
windupFrames:         0
bounceDecay:          0
bounceCount:          0
bounceElasticity:     0
anticipationWobble:   0
```

Note: SLAM profile is DEFINED but its only path of use is the `getSpinProfile(true)`
inside `slamStopToGrid` (renderer.ts:1972) which returns TURBO, NOT SLAM. So
SPIN_PROFILE_SLAM is dead code retained for documentation. The slam stop in
practice instantly snaps state and removes the ticker without consulting the
profile's velocity / bounce fields.

### §3.5. Per-reel overrides

| Override | Per reel | Cite |
|:--|:--|:--|
| Windup start delay | `i × 2 frames` (~33 ms each) | renderer.ts:1929-1934 |
| Stop delay | `i × profile.staggerMs` (180 ms NORMAL × i) | renderer.ts:1913 |
| Anticipation extra-spin | `anticipationDuration + reelCount × PROGRESSIVE_STEP` (2000 + n×500 NORMAL, 800 + n×200 TURBO) | main.ts:2455, L2425-2426 |
| Anticipation intensity | per-reel-index lookup table | renderer.ts:960-969 |

```text
renderer.ts:960  private readonly ANTIC_INTENSITY: Record<number, { ... }> = {
renderer.ts:966    2: { glowAlpha: 0.55, borderWidth: 4, pulseSpeed: 0.6,  particleCount: 0 },
renderer.ts:967    3: { glowAlpha: 0.75, borderWidth: 6, pulseSpeed: 0.45, particleCount: 5 },
renderer.ts:968    4: { glowAlpha: 0.95, borderWidth: 8, pulseSpeed: 0.30, particleCount: 12 },
renderer.ts:969  };
```

The "last reel slower?" is YES — implicitly via the anticipation progressive
step (`PROGRESSIVE_STEP = 500 ms` per active anticipating reel). The deeper
reel index, the longer the wait.

### §3.6. FS vs BASE timing deltas

| Field | BASE | FS | Cite |
|:--|--:|--:|:--|
| `reelSpinBase` (sleep wall) | 1200 | 1200 | main.ts:2410 vs L3406 (identical) |
| `profile.staggerMs` (NORMAL) | 180 | 180 | renderer.ts:1913 + main.ts:3420 (identical) |
| Anticipation enabled | YES (scatter/bonus) | NO (`executeFSSpin` does not call `shouldAnticipate`) | main.ts:3409-3421 |
| Storm multiplier reel | YES | NO ("No storm multiplier in FS - uses progressive multiplier instead", main.ts:3401) | main.ts:3401-3423 |
| Min rotations | `minRotations` from profile = 5 | same | renderer.ts:1911 |

So FS has the SAME visual reel timing as BASE, only the orchestrator skips
anticipation + storm-reel side-channel. This is intentional — the FS bag has
no scatters or bonuses (FS_WEIGHTS in `reels.ts:131-211` have no `B` entries
and only `S` weight 2-3 per reel), so anticipation could never legitimately
arm.

### §3.7. Turbo mode interaction

```text
renderer.ts:1884  this.spinLockedTurbo = this.isTurbo;
renderer.ts:1885  this.spinLockedProfile = getSpinProfile(this.isTurbo);
renderer.ts:7075  const profile = this.spinLockedProfile;  // LOCKED for entire spin
renderer.ts:7078  const isTurbo = this.spinLockedTurbo;
```

Mid-spin turbo toggle is BLOCKED at the engine level. `setTurbo(active)`
(renderer.ts:289-292) updates `currentProfile` and `isTurbo` but `onTick`
reads `spinLockedProfile` / `spinLockedTurbo` instead, so the change only
takes effect on the NEXT `startSpin`. Comment at L1884: *"LOCK spin mode at
start - prevents mid-spin turbo changes from affecting animation"*.

Additionally, in turbo mode, `spinElapsed` is scaled by `speedMul`:

```text
renderer.ts:7106  const rawElapsed = now - this.spinStartTime;
renderer.ts:7107  let spinElapsed = rawElapsed;
renderer.ts:7108  if (isTurbo) {
renderer.ts:7109    spinElapsed = rawElapsed * (anyStopping ? turboStopMul : profile.speedMul);
renderer.ts:7110  }
```

— and the stop-elapsed check itself is scaled by `speedMul` too
(renderer.ts:7258-7259: `const stopElapsed = (now - reel.stopRequestTime) *
speedMul`). The orchestrator-level `await sleep(profile.staggerMs)` is NOT
turbo-scaled (it reads the static profile constant).

`onTick` per-mode constants (hardcoded, NOT profile-driven):

```text
renderer.ts:7082  const normalEasingSpeed = 0.10;
renderer.ts:7083  const normalSnapPx     = 0.5;
renderer.ts:7084  const normalMinStopMs  = 260;

renderer.ts:7087  const turboEasingSpeed = 0.24;
renderer.ts:7088  const turboSnapPx     = 1.5;
renderer.ts:7089  const turboMinStopMs  = 110;
renderer.ts:7090  const turboStopMul    = 1.25;  // slower mult during stop phase
```

Note the asymmetry — `profile.easingSpeed` (0.16 normal, 0.45 turbo) is defined
but ONLY the hardcoded `0.10` / `0.24` are actually read in `onTick`. The
profile constants are descriptive metadata, not runtime knobs. SGF should NOT
copy these blindly without understanding which fields are live.

---

## §4. Anticipation halo

### §4.1. ARM condition

The arm is decided in `main.ts:259-287` (`shouldAnticipate`) and called
per-reel-stop in the orchestrator at `main.ts:2443`:

```text
main.ts:215  const ANTICIPATION = {
main.ts:217    SCATTER_THRESHOLD: 2,  // arm when 2+ scatters visible (need 3 for FS)
main.ts:218    BONUS_THRESHOLD:   5,  // arm when 5+ orbs visible (need 6 for H&W)
main.ts:221    SPIN_DURATION:        2000,  // base extra-spin per anticipating reel
main.ts:222    SPIN_DURATION_TURBO:   800,
main.ts:225    PROGRESSIVE_STEP:      500,  // +500 ms per successive reel
main.ts:226    PROGRESSIVE_STEP_TURBO: 200,
main.ts:227  } as const;
```

```text
main.ts:259  function shouldAnticipate(grid: Grid, currentReel: number): {
main.ts:260    active: boolean;
main.ts:261    type: 'scatter' | 'bonus' | null
main.ts:262  } {
main.ts:264    if (currentReel < 2) return { active: false, type: null };
main.ts:269    const prevReel = currentReel - 1;
main.ts:270    const scatterCount = countSymbolsUpToReel(grid, 'S', prevReel);
main.ts:271    const bonusCount   = countSymbolsUpToReel(grid, 'B', prevReel);
main.ts:276    if (scatterCount >= ANTICIPATION.SCATTER_THRESHOLD)
main.ts:278      return { active: true, type: 'scatter' };
main.ts:281    if (bonusCount >= ANTICIPATION.BONUS_THRESHOLD)
main.ts:283      return { active: true, type: 'bonus' };
main.ts:286    return { active: false, type: null };
main.ts:287  }
```

Key design properties:
- **Reels 0 and 1 never anticipate** (L264 — `currentReel < 2` early return).
- **Progressive reveal**: counts only STOPPED reels (`prevReel = currentReel -
  1`), matching player perception. Each new reel that stops feeds the gate
  before the NEXT reel arms.
- **Scatter takes priority** over bonus (L276 checked first).
- One BELOW threshold is the gate: 2 scatters → 3 trigger (so anticipation arms
  when there's still hope for one more); 5 orbs → 6 trigger.

### §4.2. DISARM condition

Three disarm paths:

| Path | Trigger | Cite |
|:--|:--|:--|
| Natural | Spin loop completes — `if (anticipationActive) renderer.stopAnticipation()` | main.ts:2484-2487 |
| Slam stop | `stopAll()` calls `renderer.stopAnticipation()` synchronously | main.ts:1984 |
| Internal cleanup | `stopAnticipation` is idempotent: early-return if not active and no containers | renderer.ts:1102 |

The `stopAnticipation` itself (renderer.ts:1101-1128):

```text
renderer.ts:1101  stopAnticipation() {
renderer.ts:1102    if (!this.anticipationActive && this.anticipationContainers.size === 0) return;
renderer.ts:1104    this.anticipationActive = false;
renderer.ts:1105    this.anticipatingReelIndices = [];
renderer.ts:1108    this.anticipationTweens.forEach(tween => tween.kill());
renderer.ts:1109    this.anticipationTweens = [];
renderer.ts:1112    this.anticipationContainers.forEach((container, reelIdx) => {
renderer.ts:1115      if (reel?.strip) reel.strip.scale.set(1, 1);
renderer.ts:1120      if (container.parent) container.parent.removeChild(container);
renderer.ts:1123      container.destroy({ children: true });
renderer.ts:1124    });
renderer.ts:1126    this.anticipationContainers.clear();
renderer.ts:1127    devLog("[RENDERER] Anticipation stopped");
renderer.ts:1128  }
```

Note: no mismatch detection. If the player lands 2 scatters, then reel 3 lands
LP only (so 2 → 2, no progress toward 3), the anticipation STAYS armed until
the spin completes. WoO accepts this as "tension lingers, then dies on
no-trigger" UX. SGF anticipation block has similar behavior (see §8).

### §4.3. Visual contract

The halo is **NOT a DOM/SVG node** — it is a PIXI overlay built per-reel inside
`overlayLayer` (renderer.ts:1011). Components per anticipating reel:

| Layer | Object | Visual | Cite |
|:--|:--|:--|:--|
| 1 | `glow` PIXI.Graphics | 3 concentric roundRects with decreasing alpha (offsets 12, 8, 4 px) | renderer.ts:1021-1029 |
| 2 | `border` PIXI.Graphics | golden roundRect stroke (width 4 / 6 / 8 px by reel index) | renderer.ts:1043-1046 |
| 3 | `sparkles` (reel 3 + 4 only) | `setInterval(200ms)` burst via `effects.goldenParticles.burst` | renderer.ts:1064-1083 |
| (4) | Strip-breathe scale tween | **DISABLED** — comment "pushes symbols outside mask" | renderer.ts:1059-1061 |

Tweens are owned by `anticipationTweens: gsap.core.Tween[]` (renderer.ts:955)
and every tween is registered into that array for guaranteed cleanup
(renderer.ts:1032, 1049, 1082, 1087).

The halo container entrance tween is `alpha 0 → 1 in 0.3 s, power2.out`
(renderer.ts:1087-1092).

Colors: warm gold only — `border = 0xD4A84B, glow = 0xB8860B` (renderer.ts:999).
Comment "no purple/blue".

### §4.4. Arm/disarm file:line map

| Action | Cite |
|:--|:--|
| Eligibility decision | `main.ts:259-287` |
| Arm call site (per reel iteration) | `main.ts:2445-2452` |
| Arm function | `renderer.ts:975-1096` |
| Disarm (natural) call site | `main.ts:2484-2487` |
| Disarm (slam) call site | `main.ts:1984` |
| Disarm function | `renderer.ts:1101-1128` |
| Intensity lookup table | `renderer.ts:960-969` |
| Per-reel intensity selection | `renderer.ts:1006` |

---

## §5. Slam stop

### §5.1. Pre-result phase (player hits STOP before server / evaluator returned)

This is the panic path. `main.ts:1976` checks `if (this.pendingSpinResult)` —
if NULL, the result hasn't been pre-computed yet and `renderer.stopAll()`
(renderer.ts:2034-2083) executes.

Behavior:
- `anyActive` short-circuit: if NO reel is spinning/stopping → no-op
  (renderer.ts:2036-2042).
- Remove `.is-spinning` CSS class (renderer.ts:2045).
- Per reel:
  - `spinning = false; stopping = false; stopRequested = false`.
  - Snap to nearest cell boundary WITHOUT changing symbols:
    `snapY = round(round(currentY/cellStep)*cellStep)` (renderer.ts:2055-2056).
  - Clear bounce state.
  - Reset cell positions; hide buffer cells.
  - `committed = true`.
- Remove ticker (renderer.ts:2078-2079).
- Trigger `playStopAllAnimation()` — sequential per-col wave fades over 50 ms
  stagger × `col` (renderer.ts:2281-2328).

In WoO's flow, the result IS pre-computed BEFORE `await sleep(reelSpinBase)`
(main.ts:2342-2349, before L2410), so the pre-result panic path is rarely
taken. It exists for boundary cases (slam during the 0-1200 ms sleep wall, or
during HNW respin entry).

### §5.2. Post-result phase (result known, slam during stop cascade)

This is the common path — `pendingSpinResult` IS populated. `main.ts:1976-2174`
executes:

| Step | Action | Cite |
|:--|:--|:--|
| 1 | `this.spinAbortToken++` invalidates the awaiting orchestrator | main.ts:1973 |
| 2 | Destructure `pendingSpinResult` and null it | main.ts:1977-1978 |
| 3 | `renderer.slamStopToGrid(grid)` paints final symbols instantly | main.ts:1981 |
| 4 | `renderer.stopAnticipation()` kills halo immediately | main.ts:1984 |
| 5 | Storm reel stops with `instant=true` (renderer.ts:1990) | main.ts:1987-1991 |
| 6 | `RF.emit("onStopAll", {})` audio panic button | main.ts:1994 |
| 7 | Win presentation if `lastWin > 0` (via `presentWins` IIFE) | main.ts:2018-2083 |
| 8 | Feature trigger if applicable (FS / HNW IIFE) | main.ts:2084-2174 |

`slamStopToGrid` itself (renderer.ts:1970-2028):

```text
renderer.ts:1970  slamStopToGrid(grid: Grid) {
renderer.ts:1972    this.currentProfile = getSpinProfile(true);  // turbo profile
renderer.ts:1975    if (this.reelSpinTickerActive) {
renderer.ts:1976      this.reelSpinTickerActive = false;
renderer.ts:1977      this.app.ticker.remove(this.tick);  // ticker removed IMMEDIATELY
renderer.ts:1978    }
renderer.ts:1981    this.setSpinningUI(false);  // CSS class off
renderer.ts:1985    for (let col = 0; col < COLS; col++) {
renderer.ts:1986      const reel = this.reels[col];
renderer.ts:1990      reel.spinning   = false;
renderer.ts:1991      reel.stopping   = false;
renderer.ts:1992      reel.stopRequested = false;
renderer.ts:1993      reel.stopped    = true;
renderer.ts:1994      reel.committed  = true;
renderer.ts:1995      reel.offsetPx   = 0;
renderer.ts:1998      reel.strip.y = Math.round(-(this.cellH + this.gapY));
renderer.ts:1999      reel.targetY = reel.strip.y;
renderer.ts:2002      reel.__bouncing = false; /* + reset all bounce fields */
renderer.ts:2008      for (let i = 0; i < reel.cells.length; i++) {
renderer.ts:2010        reel.cells[i].container.y = Math.round(i * cellStep);
renderer.ts:2012        reel.cells[i].container.scale.set(1);  // reset any anim scale
renderer.ts:2014        reel.cells[i].container.visible = (i !== 0 && i !== lastIdx);  // hide buffer
renderer.ts:2015      }
renderer.ts:2019      for (let row = 0; row < ROWS; row++) {
renderer.ts:2020        const cellIndex = row + 1;
renderer.ts:2022        this.setCellSymbol(reel.cells[cellIndex], grid[col][row]);
renderer.ts:2023      }
renderer.ts:2025    }
renderer.ts:2027    // NOTE: Wave animation is triggered by main.ts ONLY when there's no win
renderer.ts:2028  }
```

### §5.3. Collapse animation

There is **no collapse animation** as such — the slam is an instantaneous frame
snap. The "post-slam" animation is conditional:

- If `lastWin > 0` → wins presented immediately (no land animation).
- If no win and no feature trigger → `wave` animation via `playStopAllAnimation`
  fires on `stopAll` panic path only (renderer.ts:2082).
- If post-result slam without win — `applyLandingFx` (DOM CSS classes — HP / LP
  / special pop) fires from main.ts (renderer.ts:2027 comment + main.ts call
  site reference).

### §5.4. Cleanup

| Object | Cleanup point | Cite |
|:--|:--|:--|
| PIXI ticker | `app.ticker.remove(this.tick)` | renderer.ts:1977 |
| Anticipation tweens + containers | `stopAnticipation()` kill + destroy | renderer.ts:1101-1128 |
| Highlight overlay | `clearHighlights()` (called at next `startSpin`) | renderer.ts:1882 |
| Payline overlay | `clearPaylines()` (called at next `startSpin`) | renderer.ts:1881 |
| Bounce state | reset per reel inside `slamStopToGrid` | renderer.ts:2002-2005 |
| Cell scale | `reel.cells[i].container.scale.set(1)` | renderer.ts:2012 |
| Buffer visibility | re-hidden at slam | renderer.ts:2014 |
| `pendingSpinResult` | nulled on entry to `stopAll` | main.ts:1978 |
| `activeSessionId` | nulled at tail of `stopAll` | main.ts:2190 |
| `spinAbortToken` | incremented (invalidates any awaiting orchestrator) | main.ts:1973 |

### §5.5. Slam handler file:line map

| Entry | Cite |
|:--|:--|
| `stopAll()` orchestrator | main.ts:1921-2192 |
| `slamStopToGrid(grid)` renderer | renderer.ts:1970-2028 |
| `stopAll()` panic renderer | renderer.ts:2034-2083 |
| `playStopAllAnimation()` wave | renderer.ts:2281-2328 |
| STOP button bind | main.ts:1284 (`this.renderer.onStopClick = () => this.stopAll()`) |

---

## §6. Race condition handling

### §6.1. setTimeout cancellation

WoO uses MULTIPLE cancellation strategies side-by-side. There is no central
`AbortController` for the spin loop, but there ARE `AbortController` instances
for specific scoped animations:

| Token / controller | Scope | Cite |
|:--|:--|:--|
| `spinToken: number` | Visual tick (renderer) | renderer.ts:277 |
| `tickToken: number` | Captured at start, checked in `tick` | renderer.ts:396, L440 |
| `activeSpinId: number | null` | Cross-process spin identity | renderer.ts:280; main.ts:326 |
| `spinSeq: number` | Monotonic counter | main.ts:324 |
| `spinAbortToken: number` | Orchestrator-level abort signal | main.ts:366 |
| `presentationAbortToken: number` | Win presentation abort | main.ts:369 |
| `shakeAbortController: AbortController` | Screen shake animation | renderer.ts:1159-1161 |
| `winDisplayTimeout: ReturnType<typeof setTimeout>` | Win display delay | main.ts:383 |

The pattern is: bump the counter, then any awaiting consumer checks `if
(this.spinAbortToken !== myAbortToken)` and bails. Example (main.ts:2415-2418
and L2436-2439):

```text
main.ts:2239  this.spinAbortToken++;
main.ts:2240  const myAbortToken = this.spinAbortToken;
...
main.ts:2415  if (this.spinAbortToken !== myAbortToken || !this.isSpinActive(spinId)) {
main.ts:2416    devLog("[MAIN] Aborted after sleep - stopAll was called");
main.ts:2417    return;
main.ts:2418  }
```

The check is re-issued before EVERY `await` boundary in the orchestrator
(main.ts:2415, L2436, L2521). This is the canonical WoO cancellation idiom.

### §6.2. State guards (mutex / monotonic counters)

- `this.spinning` boolean (main.ts:319) — top-level mutex. `spin()` returns
  immediately if `spinning === true` (main.ts:2195).
- `canBaseSpin()` (main.ts:357-363) — feature-mode guard.
- `featureTriggerAnimating` boolean (main.ts:389) — blocks SPIN during scatter
  highlight + intro animation.
- `activeSpinId === spinId` (main.ts:342-344) — per-spin identity check.
- `activeHnwId === hnwId && activeMode === 'hnw'` — HNW session identity.
- `presentingWins`, `presentationAbortToken` — win presentation guards.
- `reel.stopped: boolean` (renderer.ts:123) — guards against double finalize
  in `finalizeReelStop` (renderer.ts:2180-2181).
- `reel.committed: boolean` (renderer.ts:131) — guards against double commit
  in `commitStopSymbols` (renderer.ts:2090-2091).
- `reel.__bounceDone: boolean` (renderer.ts:140) — prevents duplicate bounces
  per stop (renderer.ts:7325, L7332).

### §6.3. Promise resolution order

The orchestrator is fully async — `await` boundaries at:

| Await | Cite |
|:--|:--|
| `await sleep(DEFAULT_TIMING.reelSpinBase)` (1200 ms) | main.ts:2410 |
| Per-reel `await sleep(spinTime)` if anticipating | main.ts:2458 |
| Per-reel `await sleep(profile.staggerMs)` or `await sleep(100)` | main.ts:2476 / L2479 |
| `await stopStormMultiplierSpin(value)` / `stopStormMultiplierMiss()` / `stopStormMultiplierNeutral()` | main.ts:2494, L2504, L2507 |
| `await sleep(300)` storm cooldown | main.ts:2602 |
| `await this.presentWins(result, sessionId)` | main.ts:2037, L2074 |

Slam stop preserves correctness via the token bump strategy: even if multiple
`await`s are mid-flight, the next `if (this.spinAbortToken !== myAbortToken)`
check on any of them will bail. Note: any RAF / GSAP tween started before the
slam can still complete (those have their own kill paths — anticipation tweens
are killed at L1108).

### §6.4. Stale tick guard (the canonical fix)

```text
renderer.ts:277   private spinToken = 0;
renderer.ts:396   private tickToken = 0;
renderer.ts:438   this.tick = (ticker: PIXI.Ticker) => {
renderer.ts:440     if (this.tickToken !== this.spinToken) return;  // bail on stale callback
renderer.ts:442     const cappedMs = Math.min(ticker.deltaMS, MAX_DELTA_MS);
renderer.ts:443     const cappedDelta = cappedMs / (1000 / 60);
renderer.ts:444     this.onTick(cappedDelta);
renderer.ts:445   };

renderer.ts:1877  this.spinToken++;
renderer.ts:1878  this.tickToken = this.spinToken;
```

Pattern: at every `startSpin`, bump `spinToken` AND capture into `tickToken`.
If a stale callback from a previous PIXI ticker registration fires after a
quick double-spin, the check at L440 silently drops it. The delta is also
capped to 50 ms to prevent "spiral-of-death" after Alt+Tab / debugger pause
(L437-443).

### §6.5. Atomic finalize guard

```text
renderer.ts:2178  private finalizeReelStop(reel: ReelRuntime, reelIndex: number = -1) {
renderer.ts:2180    if (reel.stopped) return;  // double-finalize bailout
renderer.ts:2181    reel.stopped = true;
```

`commitStopSymbols` has the same idempotency:

```text
renderer.ts:2089  private commitStopSymbols(reel: ReelRuntime) {
renderer.ts:2090    if (reel.committed) return;
renderer.ts:2091    reel.committed = true;
```

---

## §7. Mobile-specific behavior

### §7.1. requestAnimationFrame budgeting

WoO uses BOTH PIXI ticker AND raw `requestAnimationFrame` depending on the
animation surface:

| System | Pump | Budget cap |
|:--|:--|:--|
| Reel spin / windup / bounce | PIXI ticker (`this.app.ticker`) via `this.tick` | deltaMS capped at 50 ms (renderer.ts:437) |
| Cloud animation | raw `requestAnimationFrame` (renderer.ts:879) | no cap |
| Lightning effects | raw `requestAnimationFrame` (multiple sites: L2591, L2598, L2889, L2910) | no cap |
| Highlight pulse | raw `requestAnimationFrame` (multiple sites: L3466-3733) | no cap |
| Orb drop | `orbDropRafId = requestAnimationFrame` (renderer.ts:4836-4839) | cancelled at destroy (L1140-1141) |
| Flash screen | `flashScreenRafId = requestAnimationFrame` (renderer.ts:4393-4398) | cancelled at destroy (L1149-1151) |
| Big win presentation | `bigWinAnimationId = requestAnimationFrame` (L5764) | cancelled at exit |
| Wave landing animation (no-win) | GSAP timeline (renderer.ts:2341-2370) | GSAP-managed |

The 50 ms delta cap on the PIXI ticker is the canonical "spiral-of-death"
protection. Without it, a 5 s pause (e.g. Alt+Tab during an active spin) would
return a giant delta and immediately advance the spin to its terminal state.

### §7.2. Touch interaction during spin

| Behavior | Cite |
|:--|:--|
| Long-press on SPIN button toggles turbo (pointer + keyboard) | main.ts:401-403 (`spinBtnLongPressTimer`, `spinBtnLongPressTriggered`) |
| SPACE long-press toggles turbo | main.ts:405-407 |
| Pointer parallax on cloud layer | renderer.ts:494-503 (`setupParallax`) |
| Slam stop visual feedback (ripple) | main.ts:1931 (`triggerSlamStopFeedback`) + L1957 (`showSkipRipple`) |
| Haptic feedback on spin start | main.ts:2264 (`triggerHaptic("light")`) |
| `lastTouchPosition` cached for skip ripple | main.ts:394-395 |
| `passive: true` listener on resize | renderer.ts:479 |
| `setBetIndex` persisted to localStorage | main.ts:499 |

There is no explicit "block touch during spin" — STOP button stays interactive
(slam path); SPIN button is blocked by `if (this.spinning) return` guard
(main.ts:2195).

### §7.3. Battery / reduced-motion

| Concern | Status | Cite |
|:--|:--|:--|
| `prefers-reduced-motion` query | **NOT FOUND** in renderer.ts, main.ts, or timing.ts | (grep: no matches) |
| `navigator.connection` (data-saver) | **NOT FOUND** | — |
| `document.visibilityState` pause | **NOT FOUND** in spin path (only used in HNW skip flow indirectly via the abort-token mechanism) | — |
| DevicePixelRatio cap | `Math.min(window.devicePixelRatio, 3)` | renderer.ts:453 |
| AntiAlias `true`, preference `webgl` | renderer.ts:451-452 |

Practical implication: WoO has no reduced-motion path. SGF should NOT inherit
this gap — `prefers-reduced-motion` is a regulator-friendly accessibility
requirement (§8.3).

---

## §8. Lessons for slot-gdd-factory engines

> Cross-reference / synthesis section. Vendor-neutral framing — the
> production-validated reference game is treated as a benchmark, not promoted
> by name in any string that could leak into a regulator deliverable.

### §8.1. Bridge table — reference pattern → SGF mapping → gap

| # | Reference pattern (renderer.ts / main.ts) | Adopt in SGF | Current SGF status | Gap |
|---|:--|:--|:--|:--|
| 1 | Per-reel ReelRuntime record (renderer.ts:115-150) with explicit flag tuple (`spinning, stopping, stopRequested, stopped`) | `reelEngine.mjs` (rectangular), `hexReelEngine.mjs` | reelEngine.mjs L405-460 already mirrors `reel.spinning`, `reel.stopRequested`, `reel.stopping`, `reel.stopped`, `reel.bouncing` | **NONE — parity** |
| 2 | Two-tier token guard (`spinToken` + `tickToken`) for stale rAF callbacks (renderer.ts:277, 396, 440, 1877-1878) | `reelEngine.mjs` should adopt | reelEngine.mjs uses `spinTicker` cancel only — no token check | **MEDIUM — vulnerable to stale tick after rapid spin spam** |
| 3 | 50 ms `MAX_DELTA_MS` cap to prevent spiral-of-death (renderer.ts:437-443) | All SGF engines | reelEngine.mjs uses raw rAF with `performance.now()` deltas — no explicit cap | **LOW — partial protection via `now - spinStartTime` based scheduling** |
| 4 | `spinLockedProfile + spinLockedTurbo` mid-spin freeze (renderer.ts:283-285, 1884-1886, 7075-7078) | `reelEngine.mjs`, `spinTempo.mjs` | reelEngine.mjs reads live `window.__SLOT_TURBO_SPEED_MULT__` per tick (`_liveTurboMult` at L499) — opposite design | **DESIGN DELTA — SGF allows mid-spin turbo, WoO locks. SGF behavior may cause visible speed jumps mid-spin** |
| 5 | Progressive per-reel anticipation delay (`SPIN_DURATION + n × PROGRESSIVE_STEP`) with reels 0+1 excluded (main.ts:215-227, 264) | `anticipation.mjs`, `anticipationUniversal.mjs` | anticipation.mjs L292-294 uses similar gate (`scattersSoFar >= anticipationGate`) but with reachability check `scattersSoFar + remaining >= threshold` (BETTER than WoO) | **SGF is AHEAD here — SGF anticipation gate is mathematically tighter** |
| 6 | Per-reel-index anticipation intensity table (renderer.ts:960-969) — reel 2 mild, reel 3 medium, reel 4 strong | `anticipationUniversal.mjs` style ramp | anticipation.mjs has a single intensity per-arm (boolean) — no progressive visual ramp | **MEDIUM — SGF anticipation is visually flat; WoO ramps glow + particles per reel index** |
| 7 | Pre-compute result BEFORE await (`evaluateSpin` at main.ts:2342, pendingSpinResult at L2401) so slam stop is instant | All SGF engines | reelEngine.mjs runs result at `runOneBaseSpin` then `startSpinAll(onSettled)` — settled fires after visual; not pre-computed for slam | **HIGH — SGF has no slam-stop equivalent. If implemented later, must pre-compute result** |
| 8 | Multi-token cancellation (`spinAbortToken`, `presentationAbortToken`, `winDisplayTimeout`, `shakeAbortController`) (main.ts:366-383) | `runtime` layer | SGF runtime uses HookBus emit but no per-flow abort tokens; reel cancel via `spinTicker = null` only | **HIGH — SGF has no per-flow async cancellation. Rapid SPIN-STOP-SPIN-STOP can race** |
| 9 | Hardcoded `easingSpeed`, `snapPx`, `minStopMs` in `onTick` (renderer.ts:7082-7090) — profile fields are DOCUMENTATION not RUNTIME | All SGF engines | reelEngine.mjs L515 emits `accelMinFactor` from config — runtime-driven | **DESIGN DELTA — SGF correctly config-drives, WoO has dead-code profile fields** |
| 10 | Pixel-snap `strip.y = Math.round(...)` everywhere (renderer.ts:7282, 7310, 1998) to prevent subpixel drift | All SGF engines | reelEngine.mjs L540, L549, L571, L582 already pixel-snaps | **NONE — parity** |
| 11 | Buffer cells hidden at rest (renderer.ts:1208-1209, 2014, 7320-7321) to prevent peek-through | `reelEngine.mjs` strip builder | reelEngine.mjs `stripBufferCells: 2` config (L57) but visibility toggle status unknown without deeper read | **LOW — verify on next QA pass** |
| 12 | Pre-compute + cache `getHostRect()` (renderer.ts:171-173) — eliminate `getBoundingClientRect` in hot path | All SGF engines | reelEngine.mjs uses CSS transforms (`reel.strip.style.transform`) — no rect reads in tick | **NONE — SGF is layout-thrash-free by design** |
| 13 | Windup (upward pull before spin-down) with per-reel cascade (renderer.ts:1929-1934, 7186-7217) | `spinTempo.mjs` | spinTempo.mjs SPIN_PROFILE has `windupMs`, `accelMs`, `staggerMs` (per L444 in reelEngine.mjs emit) — IS present | **NONE — parity** |
| 14 | Multi-bounce decay with phase machine (`drop` / `return`, `bounceDecay 0.3`, `bounceCount 2`) (renderer.ts:7117-7181) | `reelEngine.mjs` | reelEngine.mjs L573-602 mirrors EXACTLY the same drop/return + decay formula | **NONE — parity (deliberate WoO mirror per code comment L46-50)** |
| 15 | `applyLandingFx` DOM CSS animation classes on `#landingFxGrid` (renderer.ts:2111-2173) | `reelEngineCSS.mjs` | reelEngineCSS.mjs exists — verify it emits landing-fx CSS | **LOW — verify on next CSS audit** |
| 16 | `prefers-reduced-motion` accessibility query | All SGF engines | **NOT FOUND** in either codebase | **MEDIUM — regulator-friendly addition both sides need** |

### §8.2. What the reference does PERFECTLY

(Listed in descending order of "should be in every SGF engine, even crash /
plinko / slingo")

1. **Pre-compute result BEFORE animation.** Math runs in the same async tick
   as the visual start. The slam path becomes a single-frame snap to a known
   grid (`renderer.ts:1970 slamStopToGrid(grid)`). No "wait for server"
   coupling. This works for crash / plinko / slingo too — the outcome curve /
   ball path / card draw should be pre-computed at spin start.
2. **Locked spin profile per spin.** Once a spin starts, profile fields stop
   responding to player input (turbo toggle, settings change). Visual
   coherence is preserved. SGF currently lets turbo speed-mul change mid-spin
   — a player can mash the turbo button and produce a visibly jerky reel.
3. **Per-reel-index anticipation intensity ramp.** The visual escalation from
   reel 3 (medium) to reel 4 (strong, with particles) is what sells the
   "tension building" moment. SGF anticipation block is binary.
4. **Multi-token async cancellation.** Every await checks
   `if (this.spinAbortToken !== myAbortToken) return`. This is the only safe
   pattern for STOP-during-async. SGF reelEngine handles tick cancel but not
   orchestrator-level await cancel.
5. **Stale-tick guard.** `if (this.tickToken !== this.spinToken) return` at
   PIXI ticker entry is the single line that makes rapid SPIN-STOP-SPIN-STOP
   safe. SGF needs this even on `requestAnimationFrame` callbacks.
6. **50 ms delta cap.** `MAX_DELTA_MS = 50` prevents spiral-of-death after
   Alt+Tab / debugger pause. Apply to ALL engines (rect / hex / wheel / crash
   / plinko / slingo).
7. **Buffer cell visibility toggling.** Show during spin, hide at rest. SGF
   should explicitly hide top/bottom buffer cells on landing (mask padding
   peek-through is otherwise possible).
8. **Idempotent `finalize` and `commit` guards.** `if (reel.stopped) return;
   reel.stopped = true;` and `if (reel.committed) return; reel.committed =
   true;`. Cheap, catches double-finalize bugs immediately.

### §8.3. Recommendations file:line per engine

| SGF block | Action | Reference cite |
|:--|:--|:--|
| `reelEngine.mjs` (rect) | Add `spinToken / tickToken` two-tier guard at tick entry | renderer.ts:277, 396, 440, 1877-1878 |
| `reelEngine.mjs` (rect) | Lock turbo multiplier at `startSpinAll` instead of reading `window.__SLOT_TURBO_SPEED_MULT__` per tick | renderer.ts:283-285, 1884-1886, 7075-7078 |
| `reelEngine.mjs` (rect) | Verify buffer cell visibility hidden at land (currently unverified) | renderer.ts:2014, 7320-7321 |
| `hexReelEngine.mjs` | Adopt same two-tier guard + locked profile pattern | renderer.ts:277, 1877-1878 |
| `wheelSpinEngine.mjs` | Adopt locked profile + delta cap (rotational engines also need MAX_DELTA_MS) | renderer.ts:437-443 |
| `crashSpinEngine.mjs` | Pre-compute crash curve at spin start (same as WoO `evaluateSpin`); slam stop snaps to terminal multiplier | main.ts:2342-2349 |
| `plinkoSpinEngine.mjs` | Pre-compute ball path at spin start; slam stop snaps to terminal slot | main.ts:2342-2349 |
| `slingoSpinEngine.mjs` | Pre-compute card draw at spin start; slam stop reveals all balls | main.ts:2342-2349 |
| `anticipation.mjs` | Add per-reel-index intensity ramp (use `ANTIC_INTENSITY` table style) | renderer.ts:960-969 |
| `anticipationUniversal.mjs` | Same — visual ramp config table per-reel | renderer.ts:960-969 |
| `spinTempo.mjs` | Add `accelMs` distinct from `windupMs` (already partially present); document which fields are DOCUMENTATION vs RUNTIME to avoid the WoO dead-code trap | timing.ts:42-78 vs renderer.ts:7082-7090 |
| `runtime/` orchestrator | Multi-token abort: `spinAbortToken`, `presentationAbortToken`, etc. Every await re-checks the captured token | main.ts:366-369, 2415-2418, 2436-2439 |
| `reelEngineCSS.mjs` | Add `prefers-reduced-motion` media query for disabling bounce / wobble / windup | (regulator gap — not in WoO either) |

### §8.4. What SGF does better than the reference

| # | Aspect | WoO | SGF | Cite |
|---|:--|:--|:--|:--|
| 1 | Anticipation gate math | `scattersSoFar >= 2` (binary threshold) | `(scattersSoFar >= gate) && (scattersSoFar + remaining >= threshold) && (scattersSoFar < topRung)` (reachability + topRung) | main.ts:276 vs `anticipation.mjs:292-294` |
| 2 | CSS transforms in tick | PIXI Container.y mutation (PIXI v8 GPU-uploaded) | `reel.strip.style.transform = "translateY(...)"` (DOM compositor) — either is fine, SGF's is more cross-engine portable | renderer.ts:7282 vs reelEngine.mjs:540 |
| 3 | LEGO block modularity | All spin logic in renderer.ts (a 7800-line god class) | One block per concern (`reelEngine.mjs`, `anticipation.mjs`, `spinTempo.mjs`, `reelEngineCSS.mjs`) | renderer.ts (whole file) vs slot-gdd-factory/src/blocks/ |
| 4 | preSpin / postSpin HookBus | Inlined in `main.ts:2229-2310` (no formal hook) | Formal HookBus `preSpin`, `onSpinResult`, `postSpin` events | main.ts:2229 vs reelEngine.mjs:480-481, anticipation.mjs:235 |

---

## §9. Evolution v11.27 → current

### §9.1. Files diff summary

| File | Status | Notes |
|:--|:--|:--|
| `timing.ts` | **IDENTICAL** | `diff -q` confirms no byte difference between current and `legacy/v11.27-2026-05-19/src/timing.ts` |
| `renderer.ts` | **IDENTICAL** | `diff -q` confirms no byte difference (legacy and current are both 7800+ LOC, byte-equal) |
| `reels.ts` | **DIFFERENT** (294 vs 442 LOC, −148 LOC) | Legacy had inline hardcoded weight arrays; current is config-driven |

### §9.2. What changed in `reels.ts`

The single significant evolution between v11.27 (sealed 2026-05-19) and current
v12.1.0 (sealed) is the **W2.3 config refactor** of the reel weight tables.

#### v11.27 (legacy) — inline weight arrays

```text
legacy/src/reels.ts:30-122  REEL_WEIGHTS (BASE) — 5 reels × ~13 weighted entries, hardcoded
legacy/src/reels.ts:130-212 FS_WEIGHTS         — 5 reels × ~12 weighted entries, hardcoded
```

Every weight is a literal in source code. Modifying weights required a code
edit + recompile.

#### v12.1.0 (current) — config-driven via `GAME_CONFIG.reels.{base,free_spins}`

```text
src/reels.ts:22-29   configReelsToWeights() helper maps GAME_CONFIG arrays to ReelWeight[][]
src/reels.ts:33      REEL_WEIGHTS = configReelsToWeights(GAME_CONFIG.reels.base)
src/reels.ts:37      FS_WEIGHTS   = configReelsToWeights(GAME_CONFIG.reels.free_spins)
src/reels.ts:42-43   SCATTER_FALLBACK = GAME_CONFIG.reels.scatter_fallback_symbol ?? "LA"
src/reels.ts:47-48   REELS = GAME_CONFIG.topology.reels
src/reels.ts:48      ROWS  = GAME_CONFIG.topology.rows
```

The weight values themselves are now in `game.config.json` (single source of
truth — see L6 in current `reels.ts`).

### §9.3. Why this change happened

Three direct reasons, each visible in current `reels.ts` comments:

| Reason | Cite |
|:--|:--|
| Single source of truth — eliminates drift between sim, RGS replay, and live game | src/reels.ts:7 ("SINGLE SOURCE OF TRUTH: `game.config.json::reels.{base,free_spins}`") |
| Validation integrity — `npm run validate:cfg` (CI gate) | src/reels.ts:15 ("Verify integrity with: npm run validate:cfg") |
| Generalization — `REELS` and `ROWS` consumed from `GAME_CONFIG.topology` (no longer hardcoded 5 × 3) | src/reels.ts:47-48 |

### §9.4. Hit rate evolution (audit trail)

| Version | Hit rate | RTP | FS trigger | H&W trigger | Cite |
|:--|--:|--:|:--|:--|:--|
| v11.27 (legacy) | 20.68 % | 96.009 % | 1 / 118 | 1 / 111 | legacy/src/reels.ts:13 |
| v12.1.0 (current) | 22.4 % | 96.009 % | ~1 / 118 | ~1 / 111 | src/reels.ts:11-13 |

The +1.72 pp hit rate without RTP change is consistent with a redistribution
toward more frequent small wins funded by reduced high-pay frequency — a
classic "smoother session feel" tune. Confirmed in legacy comment block
"Symbol distribution: ... Low Pay (5 symbols) ~38 %" (legacy:18-20) — the
current LP distribution shifted upward in `game.config.json` (not directly
inspected here — would require reading `config/loader.ts` and the JSON, which
are out of scope for this RE).

### §9.5. Other Math v11.27 → v12.1.0 changes

| Subsystem | Change | Cite |
|:--|:--|:--|
| Scatter fallback symbol | Was hardcoded `"LA"` (legacy:298); now `GAME_CONFIG.reels.scatter_fallback_symbol ?? "LA"` (config-driven with fallback) | src/reels.ts:42-43 vs legacy/src/reels.ts:298 |
| Min-scatter trigger count | Was hardcoded `3`; now `GAME_CONFIG.features.free_spins?.min_scatters ?? 3` | src/reels.ts:208 vs legacy/src/reels.ts:367 |
| H&W trigger count | Was hardcoded `6`; now `GAME_CONFIG.features.hold_and_win?.trigger_count ?? 6` | src/reels.ts:234 vs legacy/src/reels.ts:393 |
| Bonus symbol id | Was hardcoded `"B"`; now `GAME_CONFIG.features.hold_and_win?.trigger_symbol ?? "B"` | src/reels.ts:227 vs legacy/src/reels.ts:386 |
| `binom(n, k)` helper | New helper using iterative formula | src/reels.ts:248-257 (NEW); legacy used inline `factorial(n)/(factorial(k)*factorial(n-k))` at L394-395 (replaced) |
| `printReelStats()` header | Was hardcoded "WRATH OF OLYMPUS"; now reads `GAME_CONFIG.meta.name.toUpperCase()` | src/reels.ts:264 vs legacy/src/reels.ts:417 |

### §9.6. What did NOT change

| Subsystem | Status |
|:--|:--|
| `timing.ts` (DEFAULT_TIMING + SPIN_PROFILE_*) | byte-identical between v11.27 and current |
| `renderer.ts` (state machine, onTick, slam, anticipation, bounce) | byte-identical between v11.27 and current |
| `pickSymbolByWeight` algorithm (weighted Wheel-of-Fortune draw) | identical (src/reels.ts:62-77 vs legacy/src/reels.ts:224-239) |
| `gridFromStops` per-reel LCG seed (`seed * 1103515245 + 12345 & 0x7fffffff`) | identical (src/reels.ts:124-127 vs legacy/src/reels.ts:285-288) |
| Anti-stacked-scatter rule (max 1 scatter per reel) | identical (src/reels.ts:118-145 vs legacy/src/reels.ts:280-309) |

### §9.7. Implications for SGF

1. **Reel state machine and timing are STABLE.** The lack of evolution between
   v11.27 and v12.1.0 means SGF can adopt the WoO pattern as a frozen
   reference — no migration risk.
2. **Math layer churned to config-driven.** SGF parser should follow the same
   pattern: `GAME_CONFIG.reels.{base,free_spins}` with anti-stacked-scatter
   rule + configurable fallback symbol. SGF already does this — parity is
   maintained.
3. **`binom` is a small but meaningful upgrade.** Legacy used full factorials
   which overflow for `n > 170`; current iterative `binom` uses the symmetric
   reduction `kk = min(k, n-k)`. Recommend SGF audit any binomial probability
   calculator for the same overflow risk.

---

## Appendix A — Cited inventory (every file:line touched)

### A.1. `src/reels.ts` (current, 294 LOC)

| Line | Symbol |
|--:|:--|
| 18 | `type ReelWeight = { sym: SymbolId; weight: number }` |
| 22-29 | `configReelsToWeights()` |
| 33 | `REEL_WEIGHTS` (BASE) |
| 37 | `FS_WEIGHTS` |
| 42-43 | `SCATTER_FALLBACK` |
| 47-48 | `REELS`, `ROWS` topology |
| 55-57 | `getTotalWeight()` |
| 62-77 | `pickSymbolByWeight()` |
| 82-101 | `generateVirtualStrip()` |
| 106-112 | `generateStops()` |
| 118-145 | `gridFromStops()` (anti-stacked-scatter at L134-138) |
| 151-172 | `generateGrid()` |
| 177-179 | `generateFSGrid()` |
| 184-193 | `getSymbolProbability()` |
| 202-221 | `calcScatterFrequency()` |
| 226-246 | `calcBonusOrbFrequency()` |
| 248-257 | `binom(n, k)` (NEW) |
| 262-294 | `printReelStats()` |

### A.2. `src/timing.ts` (current, 103 LOC)

| Line | Symbol |
|--:|:--|
| 1-6 | `SpinTiming` type |
| 8-13 | `DEFAULT_TIMING` |
| 15-17 | `sleep(ms)` |
| 21-40 | `SpinProfile` type |
| 42-59 | `SPIN_PROFILE_NORMAL` |
| 61-78 | `SPIN_PROFILE_TURBO` |
| 81-98 | `SPIN_PROFILE_SLAM` |
| 100-102 | `getSpinProfile(turbo)` |

### A.3. `src/renderer.ts` (selected; 7800+ LOC)

| Line | Symbol |
|--:|:--|
| 115-150 | `type ReelRuntime` |
| 273-285 | profile + turbo locked state |
| 277 | `spinToken` |
| 280 | `activeSpinId` |
| 289-292 | `setTurbo(active)` |
| 304-313 | `getActiveSpinId / clearActiveSpinId` |
| 318-322 | `getEaseOut(x)` |
| 332-388 | `applySquashStretch` (dead-code) |
| 395-396 | `tick`, `tickToken` |
| 425-488 | constructor |
| 437-445 | tick wrapper with `MAX_DELTA_MS = 50` |
| 953-957 | anticipation state fields |
| 960-969 | `ANTIC_INTENSITY` per-reel intensity table |
| 975-1096 | `startAnticipation(type)` |
| 1101-1128 | `stopAnticipation()` |
| 1187-1249 | `buildReels()` (incl. mask + buffer cells) |
| 1208-1213 | buffer cells hidden + strip.y init |
| 1644-1668 | `setCellSymbol` (referenced) |
| 1777-1804 | `setCellSymbol(cell, sym)` |
| 1810-1820 | `setVisibleSymbolsForReel(reelIndex, symbols)` |
| 1825-1855 | `renderGrid(grid)` |
| 1860-1866 | `setSpinningUI(on)` |
| 1872-1944 | `startSpin(spinId)` (the core spin-enter handler) |
| 1949-1963 | `stopReel(reelIndex, reelSymbols)` |
| 1970-2028 | `slamStopToGrid(grid)` |
| 2034-2083 | `stopAll()` (panic freeze) |
| 2089-2104 | `commitStopSymbols(reel)` |
| 2111-2173 | `applyLandingFx(grid)` (DOM CSS classes) |
| 2178-2217 | `finalizeReelStop(reel, reelIndex)` |
| 2222-2225 | `playReelLandBounce(idx)` |
| 2232-2234 | `playReelLandPulse(idx)` (no-op, retained dead) |
| 2240-2257 | `emitReelLandDust(idx)` |
| 2263-2276 | `emitScatterBurstParticles` |
| 2281-2328 | `playStopAllAnimation()` |
| 2335-2371 | `playWaveLandingAnimation()` |
| 7073-7386 | `onTick(_delta)` (the entire spin physics loop) |
| 7076 | `baseSpeed = max(20, cellH * 0.25)` |
| 7082-7095 | hardcoded per-mode `easingSpeed`, `snapPx`, `minStopMs` |
| 7106-7110 | `spinElapsed` turbo scaling |
| 7117-7181 | BOUNCING branch |
| 7186-7217 | WINDUP branch |
| 7220-7232 | SPINNING accel ramp |
| 7237-7278 | per-cell rotate + stopRequested gate |
| 7282 | `reel.strip.y = round(rawY)` |
| 7297-7377 | STOPPING (decel) branch |
| 7308-7353 | LANDING snap + bounce arm |
| 7355-7360 | all-stopped → `setSpinningUI(false)` |
| 7382-7385 | ticker auto-removal when no reel active |

### A.4. `src/main.ts` (selected; 5800+ LOC)

| Line | Symbol |
|--:|:--|
| 200-205 | `HNW_TIMING` reference |
| 215-227 | `ANTICIPATION` constants |
| 233-247 | `countSymbolsUpToReel(grid, sym, upToReel)` |
| 259-287 | `shouldAnticipate(grid, currentReel)` |
| 308-490 | `GameController` class header (state + constructor) |
| 319 | `private spinning = false` |
| 324 | `private spinSeq = 0` |
| 326 | `private activeSpinId` |
| 342-344 | `isSpinActive(spinId)` |
| 357-363 | `canBaseSpin()` |
| 366 | `spinAbortToken` |
| 372-380 | `pendingSpinResult` |
| 389 | `featureTriggerAnimating` |
| 1284 | STOP button bind (`this.renderer.onStopClick = () => this.stopAll()`) |
| 1661-1720 | `setSpinningState(spinning)` |
| 1921-2192 | `stopAll()` (full slam orchestrator) |
| 1973 | `this.spinAbortToken++` |
| 1981 | `this.renderer.slamStopToGrid(grid)` |
| 1984 | `this.renderer.stopAnticipation()` |
| 2194-2710 | `spin()` (the entire base spin orchestrator) |
| 2229-2310 | preSpin inline block |
| 2239-2240 | `myAbortToken` capture |
| 2275-2276 | `spinId = ++this.spinSeq` |
| 2283 | `this.renderer.startSpin(sessionId)` |
| 2289 | `startStormMultiplierSpin()` |
| 2342-2349 | `evaluateSpin` (result pre-compute) |
| 2401-2408 | `pendingSpinResult` stash |
| 2410 | `await sleep(DEFAULT_TIMING.reelSpinBase)` |
| 2415-2418 | abort-token check after sleep |
| 2425-2426 | `anticipationDuration` + `progressiveStep` selection |
| 2434-2481 | per-reel stop loop |
| 2443 | `const anticipation = shouldAnticipate(grid, r)` |
| 2451 | `this.renderer.startAnticipation(anticipation.type)` |
| 2458 | `await sleep(spinTime)` (anticipation extra-spin) |
| 2465 | `this.renderer.stopReel(r, reelSyms)` |
| 2476 | `await sleep(profile.staggerMs)` (non-anticipating stagger) |
| 2479 | `await sleep(100)` (post-anticipation short delay) |
| 2484-2487 | natural disarm |
| 2493-2508 | storm reel stop branches |
| 3341-3460+ | `executeFSSpin()` |
| 3406 | `await sleep(DEFAULT_TIMING.reelSpinBase)` (FS) |
| 3420 | `await sleep(profile.staggerMs)` (FS stagger) |

---

## Appendix B — Open questions and "NOT FOUND" notes

| # | Concern | Status | Note |
|---|:--|:--|:--|
| 1 | `prefers-reduced-motion` media query | **NOT FOUND** in `renderer.ts`, `timing.ts`, `main.ts` | Recommended for both WoO and SGF |
| 2 | `navigator.connection` data-saver branch | **NOT FOUND** | Not used by WoO |
| 3 | `document.visibilityState` (pause on tab hidden) | **NOT FOUND** in spin path | Tab-hide pause is implicit via PIXI ticker behavior; no explicit guard |
| 4 | Battery status API | **NOT FOUND** | Not used |
| 5 | `SPIN_PROFILE_SLAM` actually consumed? | **PARTIAL** — defined at timing.ts:81 but `slamStopToGrid` calls `getSpinProfile(true)` (renderer.ts:1972) which returns TURBO not SLAM | SLAM profile is dead code |
| 6 | `profile.snapPx`, `profile.easingSpeed` actually consumed? | **NO** — hardcoded values in `onTick` (renderer.ts:7082-7090) shadow these fields | Profile fields are documentation, not runtime |
| 7 | `DEFAULT_TIMING.reelStartStagger / reelSpinStep / reelStopEase` | **NOT CONSUMED** anywhere | Dead fields; only `reelSpinBase` is live |
| 8 | `anticipationWobble` actually consumed? | **YES** at renderer.ts:7287-7295 but **VALUE IS 0** in all three profiles → branch is always taken at L7294 (else) | Wobble path is reachable but dormant |
| 9 | Multi-touch / pinch gestures during spin | **NOT HANDLED** explicitly | Pointer parallax (renderer.ts:494-503) handles single pointer only |
| 10 | RAF cleanup on page unload | **PARTIAL** — `destroy()` handles cancels (renderer.ts:1130-1185) but only fires on explicit destroy call, not `beforeunload` | Browser will clean up rAF on tab close anyway |
