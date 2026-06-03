# Master TODO — slot-gdd-factory

> Living single-source-of-truth for what's shipped, what's in progress,
> and what's queued. Updated after every wave/feature.
>
> Last updated: **2026-06-03** · HEAD: `__TBD__` · main

---

## 🟢 Shipped (in-tree on `origin/main`)

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

### Wave B5-css — reelEngineCSS LEGO blok (commit `__TBD__`)

| ID | Feature | Status |
|---|---|---|
| B5c.1 | `src/blocks/reelEngineCSS.mjs` — `.reelCol` + `.reelStrip` + `.cell.is-blurring` u CSS emitter | ✅ |
| B5c.2 | GDD knobs: `blur-px` / `blur-dim` / `blur-fade-ms` — sve numeric sa bounds | ✅ |
| B5c.3 | Parser: `extractReelEngine()` — heading varijante (Reel Engine / Spin Blur) | ✅ |
| B5c.4 | Unit testovi: `tests/blocks/reelEngineCSS.test.mjs` — **8/8 ✅** | ✅ |

### Wave B8a — triggerCounting LEGO blok (commit `__TBD__`)

| ID | Feature | Status |
|---|---|---|
| B8a.1 | `src/blocks/triggerCounting.mjs` — `countTriggerSymbols()` + `spinsForCount()` izvučeni iz buildera | ✅ |
| B8a.2 | Cover sve grid kinds — rectangular / variable_reel (RECT_REELS path), cluster/megaclusters/lock_respin/expanding/infinity (column-collapse path), SVG kinds (generic .cell + text scan) | ✅ |
| B8a.3 | `perReel` + `any` count mode honored u svim path-ovima | ✅ |
| B8a.4 | Parser: `extractTriggerCounting()` — heading varijante (Trigger Counting / Scatter Counting) | ✅ |
| B8a.5 | Unit testovi: `tests/blocks/triggerCounting.test.mjs` — **7/7 ✅** | ✅ |

### Wave B8b — postSpin LEGO blok (commit `__TBD__`)

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

## ✅ QA matrix (HEAD `__TBD__`)

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
| **TOTAL** | | **309/309 ✅** |

---

## 🟡 In progress / next up

| Pri | Item | Why | Effort |
|:-:|---|---|---|
| 1 | **Wave B5-engine-hot — hot-path reel engine (`buildReelColumns`, `onTickAll`, `startSpinAll`, `runOneBaseSpin`, `runStaticReroll`, `commitStopSymbols`, `rotateStripDown`, `randomSym`)** → `src/blocks/reelEngine.mjs` | preostali najveći inline ostatak (~450 LOC); odložen zbog hot-path rizika sa stateful međusobnim zavisnostima (`RECT_REELS` / `spinTicker` / `FORCE_TRIGGER` / `allReelsActive`) | L |
| 2 | **Wave B8c — devFsBtn handler + spin CTA listener → `src/blocks/devTrigger.mjs`** | preostali manji inline ostaci u builder-u | S |
| 3 | **Wave J2 — Real reel engine for hex / diamond / pyramid / cross / l_shape** | irregular column shapes; need geometric "column" mapping | L |
| 4 | **Wave J3 — SVG kinds (wheel / crash / radial / slingo / plinko)** — domain-specific spin animation | each kind needs its own engine; can't reuse rectangular | L |
| 5 | **PAR / Math hot-swap injector** | README Phase 2 — placeholder math still in use | XL |
| 6 | **Sound cue placeholders** (trigger sting, anticipation hum, FS placard whoosh) | currently silent; production demos want audio scaffolding | M |
| 7 | **Wired modeling for 21 detected-but-unused feature kinds** (cascade / hold_and_win / multiplier / expanding_wild / walking_wild / sticky_wild / mystery_symbol / bonus_buy / bonus_pick / wheel_bonus / cluster_pays evaluator / ways evaluator / scatter_pay / lightning / respin / wild_reel / gamble / ante_bet / super_symbol / win_cap / persistent_multiplier) | parser detects, template ignores | XL |

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
