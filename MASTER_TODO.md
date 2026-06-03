# Master TODO — slot-gdd-factory

> Living single-source-of-truth for what's shipped, what's in progress,
> and what's queued. Updated after every wave/feature.
>
> Last updated: **2026-06-03** · HEAD: `037541f` · main

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

---

## ✅ QA matrix (HEAD `037541f`)

| Suite | Coverage | Result |
|---|---|---:|
| `tests/parse-real.mjs` | 3 synthetic GDDs → parser | **3/3 ✅** |
| `tests/scatter-count-mode.mjs` | 38 phrase variants + 4 fixtures | **38/38 ✅** |
| `tests/render-grid-all.mjs` | 20 fixtures × shape invariants | **20/20 ✅** |
| `tests/render-browser-all.mjs` | 23 grids × headless Chromium | **23/23 ✅ 0 console errors** |
| `tools/fs-qa-audit.mjs` | 23 fixtures × full FS lifecycle | **23/23 ✅ CLEAN** |
| `tools/fs-edge-cases.mjs` | 11 lifecycle/race/abuse scenarios | **11/11 ✅ CLEAN** |
| `tools/spin-engine-audit.mjs` | 24 × real reel engine drives all column grids (now incl. variable_reel) | **24/24 ✅ CLEAN** |
| **TOTAL** | | **142/142 ✅** |

---

## 🟡 In progress / next up

| Pri | Item | Why | Effort |
|:-:|---|---|---|
| 1 | **Wave J2 — Real reel engine for hex / diamond / pyramid / cross / l_shape** | irregular column shapes; need geometric "column" mapping | L |
| 2 | **Wave J3 — SVG kinds (wheel / crash / radial / slingo / plinko)** — domain-specific spin animation (wheel arrow stop, crash multiplier curve, plinko peg drops, slingo card flip, radial sweep) | each kind needs its own engine; can't reuse rectangular | L |
| 3 | **PAR / Math hot-swap injector** | README Phase 2 — placeholder math still in use | XL |
| 4 | **Stage badge per non-rectangular layout positioning** | currently same place for all shapes; radial / SVG may want different anchor | S |
| 5 | **Sound cue placeholders** (trigger sting, anticipation hum, FS placard whoosh) | currently silent; production demos want audio scaffolding | M |
| 6 | **Wired modeling for 21 detected-but-unused feature kinds** (cascade / hold_and_win / multiplier / expanding_wild / walking_wild / sticky_wild / mystery_symbol / bonus_buy / bonus_pick / wheel_bonus / cluster_pays evaluator / ways evaluator / scatter_pay / lightning / respin / wild_reel / gamble / ante_bet / super_symbol / win_cap / persistent_multiplier) | parser detects, template ignores — see full breakdown in chat | XL |

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
| 26 | `__TBD__` | docs(master-todo): refresh — scatter celebration + win-cycle + anticipation-uniform |
