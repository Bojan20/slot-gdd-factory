# SLOT_MECHANICS_ENCYCLOPEDIA.md
## Ultimativna enciklopedija slot mehanike — single source of truth za sve agente

**Date**: 2026-06-16
**Project**: slot-gdd-factory
**Owner**: Boki (vendor-neutral mandate per [CLAUDE.md](../CLAUDE.md) hard rules)

---

## 0. Šta je ovaj dokument

Ovo je **agregirana baza znanja** koju koristi svaki agent u ovom projektu (Plan, Explore, general-purpose, Cortex domain agents, Kimi/Fable/GPT) pre nego što donese bilo kakvu odluku o:

- novim blokovima
- refactor-ima postojećih 85 blokova
- parser changes
- regulator gates
- math/RTP/RNG layer
- presentation polish
- cert/jurisdiction expand

Sintetizovana je iz **5 nezavisnih izvora**:

| # | Izvor | Šta donosi | Veličina |
|:-:|:--|:--|:-:|
| 1 | **industry standard internal stack** (`~/industry standard/`, 288MB, 6 git repoa) | playa-core/slot/cli/qa-tools/layout_tool/config-parser — production-grade industry reference | 22,743 reči RE |
| 2 | **Naš repo** (`~/Projects/slot-gdd-factory`) | 85 blokova, 96 testova, parser IR, 53 HookBus eventa, 4 reference GDD | 7,521 reči atomic inventory |
| 3 | **Web research — slot mechanics 2020-2026** | 36 feature mechanika, 11 reel topologija, 8 payway types, 11 presentation patterns | 15,506 reči |
| 4 | **Web research — math/RNG/regulator 2025-2026** | GLI-19 v3, UKGC RTS 17-Jan-2025, AGCO 4.07, MGA tech standards, EU AI Act spillover | 8,446 reči |
| 5 | **Akademska + book literatura** | 21 verified entries (Harrigan/Turner/Barboianu/Schwartz/UKGC RTS/AGCO/Schüll/GoF/Nystrom) | 7,172 reči |
| 6 | **Kimi research** (deep, 3 passes, pending) | Cross-reference + additional citations | TBD |

**Total bazu zna agent**: ~62,000 reči pre Kimi (~310KB plain text). Sa Kimi: ~70-80,000 reči.

---

## 1. Pet hard rules (kratak izvod iz CLAUDE.md koji svaki agent mora poštovati)

| # | Pravilo | Posledica |
|:-:|:--|:--|
| H1 | **Vendor names ZABRANJENI** u `src/` (industry standard/Pragmatic/Megaways/Aristocrat/L&W/NetEnt/Microgaming) — samo u research notes je OK kao citation | Pre-commit grep gate u `tests/blocks/_no-vendor-mention.test.mjs`; svaki commit prolazi |
| H2 | **ADB ≠ GDD** — Audio Designer Brief je odvojen tok od Game Design Document; mešanje = trajna mana mozga | Pred svaki pomen fajla u GDD/parser/builder kontekstu: STOP, proveri naziv |
| H3 | **LEGO discipline** — sve je modularan blok u `src/blocks/<name>.mjs`, NIKAD game-specific `if (game === 'X')`, single-owner emit, listener registracija | LEGO gate `tools/lego-gate.mjs` 6 invariants, mora biti 6/6 pre commit |
| H4 | **Cell never mutated during motion** — motion legibility per industry standard ide preko `::after` overlay-a na koloni, NIKAD `filter: blur` na `.cell` | Build-time lint `tests/blocks/_no-muddy-cell.test.mjs` (W48 W1) |
| H5 | **Force buttons real spin** — svako force dugme mora pozvati `runOneBaseSpin()` sa FLAG-om, NIKAD shortcut na overlay | Probe `tools/_ultimate-all-force-probe.mjs` 40/40 PASS gate |

---

## 2. Glavni inventar (mapa svih izvora po sekcijama)

### 2.1 Naš repo (`slot-gdd-factory`) — šta postoji

Atomic detalji u: [`research-pool/sgf-current-state.md`](research-pool/sgf-current-state.md)

| Domain | Blokova | LOC | Owner agent |
|:--|:-:|:-:|:--|
| Engine | 12 | 5,381 | [`ENGINE_ARCHITECT.md`](ENGINE_ARCHITECT.md) |
| Win | 9 | 3,975 | [`WIN_EVALUATOR.md`](WIN_EVALUATOR.md) |
| Feature | 38 | 16,421 | [`FEATURE_ARCHITECT.md`](FEATURE_ARCHITECT.md) |
| UI | 20 | 9,347 | [`UI_ARCHITECT.md`](UI_ARCHITECT.md) |
| RG | 3 | 2,080 | [`RG_ARCHITECT.md`](RG_ARCHITECT.md) |
| Dev | 6 | 1,528 | (orchestrator) |
| **Σ** | **88** | **38,732** | — |

(85 production + 3 audit/dev = 88 u src/blocks. Test parity 85/85 + 11 utility = 96.)

**HookBus canonical events**: 53 (lista u `research-pool/sgf-current-state.md` §2)
**Parser IR fields**: 40+ top-level (`model.symbols`, `model.features[]`, `model.confidence`, …)
**Reference GDDs**: 4 (Wrath/Crystal Forge/Midnight Fangs/Gates 1000)
**Tools**: 164 scripts (probe / audit / report / build / cert)
**Orchestrator LOC budget**: 1171/1180 (99.2% posle Wave 2)

### 2.2 industry standard stack (referenca, vendor-neutral mining target)

Atomic detalji u 4 fajla:

| Fajl | Šta | Reči |
|:--|:--|:-:|
| [`research-pool/playa-core-RE.md`](research-pool/playa-core-RE.md) | Sequencer/Component/Stage/Layout/Loader/Rendering/Sound/Proxy/System/Utils — 20 sekcija, 18 interfejsa, GoF pattern matrix | 6,169 |
| [`research-pool/playa-slot-RE.md`](research-pool/playa-slot-RE.md) | Reels/SpinSystems/Behaviors/SlotStore/WinPresentation/BonusFeatures — 12 modula, 40+ commands, ~18,000 LOC application logic | 4,986 |
| [`research-pool/qa-tools-RE.md`](research-pool/qa-tools-RE.md) | qa-client-tools / taf / taf-client / taf-proxy — 5 packages, MongoDB schema, deep diff assertion, RTP verifikacija | 2,356 |
| [`research-pool/layout-tool-RE.md`](research-pool/layout-tool-RE.md) | Electron PSD→JSON authoring, sprite atlas, bitmap font compilation, 12 history action classes | 3,710 |
| [`research-pool/config-parser-RE.md`](research-pool/config-parser-RE.md) + [`playa-cli-RE.md`](research-pool/playa-cli-RE.md) | JSON→SQL transpiler + dev server (GLR replay, HTTPS reverse proxy, JSDOM client config) | 4,522 |

### 2.3 Web research — mechanics universe

Atomic detalji u: [`research-pool/web-slot-mechanics.md`](research-pool/web-slot-mechanics.md) (15,506 reči)

**Pokriva**:
- 11 reel topologija (rectangular 3×3 do 7×7, hex honeycomb, wheel 24/36 segment, crash curve, plinko, slingo, megaways, infinityreels, colossal, dual-grid, cluster)
- 8 payway types (fixed/selectable paylines, bothways, ways pays 243/1024/3125/117649, cluster, pay-anywhere, scatter pays, multiway)
- 36 feature mechanika
- 11 presentation patterns
- 2025-2026 trendovi: Hold-the-Jackpot 2.0, Drop-the-Hold, Replay, infinity-reels-spread, BTG variable-height-ways post-patent, crash-on-slot-skin, wallet jackpots

### 2.4 Web research — math/RNG/regulator

Atomic detalji u: [`research-pool/web-math-rng-regulator.md`](research-pool/web-math-rng-regulator.md) (8,446 reči)

**Pokriva** 10 layera:
1. RNG (GLI-19 v3.0, NIST SP 800-22 Rev.1a, MT19937 demotion, PCG-64/xoshiro256\*\*/ChaCha20/BLAKE3-DRBG matrix, seeded-replay)
2. PAR Sheets (sections, XLSX named-range, deterministic outcome pseudocode, hot-swap variants, 6 adverse-state tests)
3. RTP + Volatility (per-jurisdikcija matrix UKGC/MGA/DE/SE/NL/ON/NJ/PA/DK/IT/ES, 1-10 VI scale, base/feature/jackpot split, χ² verifikacija 10⁷-10⁹)
4. Win Caps (statutory, hard-truncate vs proportional, big-win tier ladder 5/15/50/250/1000×, UK 17-Jan-2025 false-win prohibition)
5. Spin Tempo (UKGC RTS 2A 2.5s + 14G NEW 5s, DE 5s, SE 3s SIFS 2025:1, turbo/quickspin/slam-stop matrix)
6. Bonus Buy/Ante (DE ban, NL package, UKGC Jun-2026 ban, ante-bet 1.25× / +25% math)
7. Jackpots (8 types, pool math, must-hit-by formula)
8. RG (LCCP/RTS, GamStop/ROFUS/Spelpaus/CRUKS/OASIS, EU AI Act spillover 2-Feb-2025)
9. GDD Format (16-section template, approval workflow)
10. Cert Pipeline (7-stage, hot-fix governance, 9-point pre-cert checklist)

### 2.5 Akademska + book literatura

Atomic detalji u: [`research-pool/books-academic.md`](research-pool/books-academic.md) (7,172 reči, 21 verified entries, BibTeX appendix)

**Glavne reference s direktnim mapiranjima na naše blokove**:

| Citation | Mapira se na |
|:--|:--|
| Harrigan & Dixon 2009 *PAR Sheets, Probabilities, and Slot Machine Play* | `parser.mjs` IR + budući `parSheet.mjs` |
| Turner & Horbay 2004 + Pisklak et al. 2019 (near-miss) | `anticipationUniversal.mjs` ARM/DISARM gate |
| Barboianu 2022 *The Mathematics of Slots* | `payAnywhereEval.mjs` + `clusterPaysEval.mjs` + `waysEval.mjs` test oracles |
| Schwartz (Roll the Bones, 2013) | historical context for win cycle UX |
| Dixon 2010 LDW + UKGC RTS 7C + AGCO 4.07 | `winPresentation.mjs` netLossIndicator gate |
| UKGC RTS 14 (spin 2.5s) + DE GlüNeuRStV (5s) | `spinTempo.mjs` per-market profile |
| GoF (Gamma et al. 1994) + Nystrom 2014 Game Programming Patterns | formal vocabulary za naš LEGO discipline |
| Schüll 2012 *Addiction by Design* | sva block-lifecycle odluke moraju respektovati player-protection axiom |
| Hervas-Garcia et al. 2024 + EU AI Act Art.5 | DDA typed enum (presentation-only, NEVER outcome distribution) |

---

## 3. Bridge tabela — industry standard pattern → naš blok

| industry standard layer | Naš ekvivalent | Status | Šta nedostaje |
|:--|:--|:-:|:--|
| `playa-core/sequencer/Command` + MobX `addWhen()` | `src/blocks/hookBus.mjs` (Observer Pattern) | 🟡 partial | Deferred-completion pattern (await state via MobxUtils.addWhen) za eliminaciju `setTimeout` race-eva — Wave 4 candidate |
| `playa-core/component/BaseStore/BaseView/BaseAction` | naša lazy IIFE per blok | 🟡 ekvivalent na drugom nivou | Mogli bismo extract `baseStore.mjs` mixin za state observability |
| `playa-core/layout/LayoutService` + `ILayoutNode` | naš grid renderer + `themeCSS.mjs` | 🟡 partial | Declarative layout tree iz `layout_tool` JSON — buduća Wave (layout authoring DX) |
| `playa-core/loader` 10 strategija (texture/spine/font/video/glTF) | naše assets su SVG/HTML/CSS inline | ❌ nepotrebno za naš scope | Naš factory ne radi raster pipelines — out of scope |
| `playa-core/rendering/Button` state machine | naš `spinControl.mjs`, `bonusBuy.mjs` button | ✅ matching | OK |
| `playa-core/sound/SoundManager` Howler wrapper | naš `audio.mjs` (gated po Boki rule) | 🟡 OFF | Boki audio gate aktivan |
| `playa-slot/reels/ReelSet 5 spin systems` | `reelEngine.mjs` + `hexReelEngine.mjs` + 4 SVG engines | 🟡 partial | Nemamo `SelectiveStackingReelSpinSystem` (substitution per schema) ni `IndependentReelSpinSystem` (per-cell respin) — buduća wave |
| `playa-slot/reels/SymbolWeightService` (seeded RNG) | nemamo — math gated | ⏭️ pending Math layer | seedrandom pattern direktno reusable kad math otvori |
| `playa-slot/behaviors/spinBehavior/BaseSpinBehavior` (velocity ramp, cell add/remove threshold) | `spinTempo.mjs` + projection + `reelEngine.mjs` rotation | ✅ Wave 2 ekvivalent | OK |
| `playa-slot/rollup/RollupComponent` GSAP tier-mapped | `winRollup.mjs` + `bigWinTier.mjs` | ✅ ekvivalent | Možda dodati GSAP-style timeline orchestration za V3 polish |
| `playa-slot/bigwin/BigWinComponent` + ShowCommand sa `RollupState.STOP` gate | `bigWinTier.mjs` | 🟡 partial | Deferred-completion gate (umesto setTimeout) za sigurniji handoff |
| `playa-slot/plaques/` (bonus trigger, retrigger, max award) | `genericFeatureBanner.mjs` + `mysteryReveal.mjs` + `pickBonusReveal.mjs` itd. | ✅ ekvivalent | OK |
| `playa-slot/paylines/` (spaghetti) | `paylineOverlay.mjs` | ✅ ekvivalent | OK |
| `playa-slot/jackpot/JackpotMeters` + `JackpotPlaque` + `BasicJackpotComponent` | `dailyJackpot.mjs` | 🟡 partial | Pooled-network jackpot bi bila nova familija blokova kad math otvori |
| `playa-slot/Lock & Respin commands` | `holdAndWin.mjs` + `respin.mjs` + W48 sticky fix | ✅ industry-validated | direktna validacija mog `reelEngine.rotateStripDown` fix-a |
| `playa-slot/turboMode/` | `turboMode.mjs` | ✅ matching | OK |
| `playa-slot/uicontrols/meters/` (Balance/Win/Spins) | `balanceHud.mjs` + `winRollup.mjs` | ✅ matching | OK |
| `playa-slot/settings/` | `settingsPanel.mjs` | ✅ matching | OK |
| `qa-tools/qa-client-tools` (postal channels, deep diff assertion) | `tools/_*-probe.mjs` family | 🟡 partial | Deep-diff wildcard `%$X$%` pattern korisno za regression baselines |
| `qa-tools/taf` (MongoDB schema, multi-device coordination) | `tools/cortex-eyes-ultimate-qa.mjs` | 🟡 different scale | Naš scope je single-game cert, ne multi-device farm — adopt formats samo gde se uklapa |
| `layout_tool/Editor.js` (PSD→JSON, 12 history actions) | nemamo authoring tool | ❌ different layer | Visual authoring UX nije scope; mi pišemo GDD u MD direktno |
| `config-parser` JSON→SQL transpiler | `parser.mjs` GDD→IR + `buildSlotHTML.mjs` IR→HTML | ✅ pattern ekvivalent | Different output (HTML vs SQL DML) ali isti compiler pattern |
| `playa-cli` GLR replay + RGS reverse proxy | nemamo replay — math gated | ⏭️ pending Math layer | GLR pattern direktno reusable za cert evidence-pack |

---

## 4. Gap analysis — šta NEMAMO a treba

Cross-reference: `research-pool/web-slot-mechanics.md` + `sgf-current-state.md`.

### 4.1 Engine domain (12 blokova → potencijalno 16)

| # | Šta nemamo | Industry pattern | Wave kandidat |
|:-:|:--|:--|:-:|
| E1 | **InfinityReels engine** (rolling reel expand right) | NoLimit Infinireels, 2020+; rolling reel adds column per cascade hit | M3 (mid-prio) |
| E2 | **Megaways-style variable row count** (BTG license expired 2024 — vendor-neutral OK) | Each reel 2-7 symbols, ways recalculated post-spin | M4 (high-prio, post BTG patent expiry) |
| E3 | **Colossal symbols** (2×2, 3×3, 4×4 stacked) | Single mega-symbol occupies multiple cells | M5 |
| E4 | **Dual/multi-grid sync engine** (split-screen mirror) | Two parallel grids share outcome | L1 |
| E5 | **SelectiveStackingReelSpinSystem** (substitution per schema) | industry standard pattern — wild substitution mid-spin | M6 |
| E6 | **IndependentReelSpinSystem** (per-cell respin) | Each cell can re-roll independently | M7 |

### 4.2 Win domain (9 blokova → potencijalno 12)

| # | Šta nemamo | Wave kandidat |
|:-:|:--|:-:|
| W1 | **Polyomino cluster** (irregular shape cluster pays) | M8 |
| W2 | **Cascading ways multiplier** (multiplier rises per cascade) | M9 |
| W3 | **Bothways pays** (left-to-right + right-to-left) | M10 |

### 4.3 Feature domain (38 blokova → potencijalno 50)

| # | Šta nemamo | Wave kandidat |
|:-:|:--|:-:|
| F1 | **Hold-the-Jackpot 2.0** (sticky orbs + tiered jackpot ladder) | post-Math |
| F2 | **Drop-the-Hold** (orbs drop, refill) | post-Math |
| F3 | **Replay mechanic** (replay last spin as feature trigger) | post-Math |
| F4 | **Synergy multipliers** (feature × feature stacking) | M11 |
| F5 | **Feature unlock escalation** (progressive feature reveal) | M12 |
| F6 | **Persistent memory across sessions** (UKGC RTS 12C must hit hint) | M13 (regulator-required) |
| F7 | **Coin collector (Lightning v2)** — extension of `lightning.mjs` | M14 |
| F8 | **Path-aware multiplier per row** — extension of `pathAwareMultiplier.mjs` | M15 |

### 4.4 UI domain (20 blokova → potencijalno 26)

| # | Šta nemamo | Wave kandidat |
|:-:|:--|:-:|
| U1 | **Contextual paytable** (highlights current bet's prizes) | M16 |
| U2 | **Bet-limit pre-flight** (warning before max-bet) | regulator-required |
| U3 | **Quick-cashout** (panic-button balance withdraw) | M17 |
| U4 | **In-spin RG nudge** (UKGC voluntary nudge after N spins) | regulator-required |

### 4.5 RG domain (3 blokova → potencijalno 6)

| # | Šta nemamo | Wave kandidat |
|:-:|:--|:-:|
| R1 | **Cooling-off period** (UK self-imposed temporary lockout) | regulator-required |
| R2 | **Daily spend limit** (UKGC voluntary, MGA mandatory) | regulator-required |
| R3 | **Geo-aware RG** (loose IP detection → apply jurisdiction profile) | M18 |

### 4.6 Dev / Tooling domain

| # | Šta nemamo | Wave kandidat |
|:-:|:--|:-:|
| D1 | **Network latency simulator** (UKGC RTS 6: handle disconnect gracefully) | M19 |
| D2 | **RNG seed replay** (industry pattern from industry standard SymbolWeightService) | post-Math |
| D3 | **A/B variant picker** (presentation-only DDA — never outcome) | M20 |
| D4 | **Deep-diff baseline assertion** (industry standard qa-client-tools pattern) | M21 |

---

## 5. Industry-grade patterns za **direktan extract** (vendor-neutral, sa file:line iz industry standard-a)

| # | Pattern | Iz (industry standard) | U (naš) |
|:-:|:--|:--|:--|
| 1 | **Tier-mapped win rollup sa state-gated overlay** | `playa-slot/src/ts/rollup/RollupComponent.ts:30-100` | `winRollup.mjs` + `bigWinTier.mjs` — dodati `MobX-like deferred completion` umesto setTimeout race |
| 2 | **Velocity ramp + bounce easing + cell add/remove threshold** | `playa-slot/src/ts/behaviors/spinBehavior/BaseSpinBehavior.ts:40-78` | `reelEngine.mjs` rotation — već imamo, Wave 2 projection dovršila |
| 3 | **Symbol weight service sa seeded RNG** | `playa-slot/src/ts/reels/SymbolWeight/SymbolWeightService.ts` | Buduća `mathEngine.mjs` blok (pending Math gate) |
| 4 | **Lock & Respin sticky pinning** | `playa-slot/src/ts/.../LockAndRespin*Command.ts` | `reelEngine.mjs.rotateStripDown` — W48 v6 fix već landovan |
| 5 | **Command/Sequence pattern sa deferred completion** | `playa-core/src/ts/sequencer/commands/Command.ts` + `MobxUtils.addWhen` | Buduća `commandFlow.mjs` blok — eliminacija setTimeout race-eva |
| 6 | **Deep diff assertion sa wildcard** | `qa-tools/qa-client-tools` (postal channels, `%$X$%` placeholder) | `tools/cortex-eyes-ultimate-qa.mjs` — dodati wildcard support |
| 7 | **GLR replay format** za cert evidence | `playa-cli/app/glrRecorder.js` + `replayBuffer.js` | Buduća cert pipeline — JSON-per-action format direktno reusable |
| 8 | **Sprite atlas + bitmap font compilation** | `layout_tool/Editor.js` + `psdutils.js` | Out-of-scope (mi smo HTML/SVG, ne raster) |
| 9 | **PSD layer → JSON layout tree** | `layout_tool/Editor.js` | Out-of-scope za sad; ako Boki želi visual authoring → buduća wave |
| 10 | **MongoDB schema za test sessions** (RunModel/LogModel/TAFSummery) | `qa-tools/taf` | Possibly adopt za multi-game compare hub (T3 wave) |

---

## 6. Regulator gates matrix (sve jurisdikcije, sve obavezne stavke)

Sintetizovano iz: `web-math-rng-regulator.md` + `books-academic.md`.

| Jurisdikcija | Stavka | Trenutno u `slot-gdd-factory` |
|:--|:--|:--|
| UKGC RTS 2A | Spin min 2.5s | ✅ `spinTempo.mjs` defaults |
| UKGC RTS 14G | Non-slot min 5s | ✅ projection podržava |
| UKGC RTS 6 | Disconnect handling | ❌ gap (M19 wave) |
| UKGC RTS 7C | LDW suppression (suppress win FX kad netDelta ≤ 0) | ❌ gap — **HIGH PRIO** za `winPresentation.mjs` |
| UKGC RTS 8 | Autoplay max 100, plus loss/win limits | ✅ `autoplay.mjs` |
| UKGC RTS 12C | Must-hit-by hint | ❌ gap (F6 wave, pending Math) |
| UKGC RTS 14 | Reality check 30/60min | ✅ `realityCheck.mjs` |
| UKGC LCCP 8.3.1 | Session caps | ✅ `sessionTimeout.mjs` |
| UKGC 17-Jan-2025 | False win prohibition | ❌ gap — extend LDW gate above |
| UKGC 9-Apr-2025 | £5 cap | ✅ `betSelector.mjs` configurable |
| UKGC 21-May-2025 | £2 cap (18-24 age) | ❌ gap (geo-aware UI nudge) |
| UKGC Jun-2026 | Bonus buy ban | ✅ `bonusBuy.mjs` already gateable via regulator profile |
| MGA | Loss limit, deposit limit, session limit | 🟡 partial (need explicit regulator profile config) |
| MGA | RTP corridor 85-97% | ⏭️ pending Math |
| Sweden Spelinspektionen | 3s spin SIFS 2025:1 | ✅ projection podržava |
| Sweden | Bonus buy active debate (TBD 2026) | 🟡 toggle ready |
| Germany GlüNeuRStV § 22a | 5s spin, €1 max stake, no autoplay | 🟡 partial — config gate per jurisdiction |
| Germany | Bonus buy zabranjeno | ✅ `bonusBuy.mjs` gateable |
| Germany | Slot jackpot prohibition | ✅ `dailyJackpot.mjs` gateable |
| Ontario AGCO 4.07 | Must-hit-by, declared RTP, reality check | ⏭️ partial (Math) |
| NJ DGE | Certification fingerprint, GLI-19 | ⏭️ Math layer cert |
| Netherlands KSA | Cool-off, bonus buy package status TBD 2026 | 🟡 toggle ready |
| Denmark | ROFUS self-exclusion sync | ❌ gap (R3 geo-aware) |
| Italy ADM | RTP min, hit frequency disclosure | ⏭️ Math |
| Spain DGOJ | Reality check 60min mandatory | ✅ `realityCheck.mjs` (set interval) |

---

## 7. 53 HookBus canonical events (single source of truth)

Pun spisak u: [`research-pool/sgf-current-state.md`](research-pool/sgf-current-state.md) §2.

Sažeti pregled po grupama:

| Grupa | Events | Owner |
|:--|:--|:--|
| Core spin | `preSpin`, `onSpinResult`, `postSpin`, `onTumbleStep` | `reelEngine.mjs` |
| Free spins | `onFsTrigger`, `onFsSpinResult`, `onFsEnd` | `freeSpins.mjs` |
| Big Win | `onBigWinIntro`, `onBigWinCount`, `onBigWinOutro` | `bigWinTier.mjs` |
| Multiplier | `onMultChange`, `onMultOrbCollected` | `multiplierOrb.mjs` |
| Force | `onForceFeatureRequested` | `universalForcePanel.mjs` |
| Autoplay | `onAutoplayStart`, `onAutoplayStop`, `onAutoplayLimitHit` | `autoplay.mjs` |
| Settings | `onBetChange`, `onTurboChange`, `onSettingsOpen` | `betSelector.mjs` / `turboMode.mjs` / `settingsPanel.mjs` |
| Bonus | `onBonusBuyConfirm`, `onBonusPickReveal`, `onWheelBonusLand` | `bonusBuy.mjs` / `bonusPick.mjs` / `wheelBonus.mjs` |
| RG | `onRealityCheck`, `onSessionTimeoutWarning`, `onNetLossThreshold` | `realityCheck.mjs` / `sessionTimeout.mjs` / `netLossIndicator.mjs` |
| Dev | `onDevForceTrigger`, `onSlamStop`, `onForceSkip` | dev blocks |
| State | `fsm.phase.changed` | engine FSM |

Ukupno tačno 53 canonical events (verified by `lego-gate.mjs` invariant 4: 93/93 single-owner emit, 71/71 lifecycle listener coverage).

---

## 8. Glossary — industry → naš naziv (vendor-neutral mapping)

Pun glosar u: `web-slot-mechanics.md` §1-7. Sažeto:

| Industry naziv | Naš naziv | Blok |
|:--|:--|:--|
| Hold & Win / Hold & Spin / Lock & Respin | hold_and_win | `holdAndWin.mjs` |
| Free Spins Progressive | progressive_free_spins | `progressiveFreeSpins.mjs` |
| Megaways | variable_ways (kind=ways sa varRows) | TBD M4 |
| Pay Anywhere / 8-of-a-kind | pay_anywhere | `payAnywhereEval.mjs` |
| Cluster Pays | cluster_pays | `clusterPaysEval.mjs` |
| Cascade / Tumble / Avalanche | cascade | `tumble.mjs` |
| Multiplier Orb / Coin Multiplier | multiplier_orb | `multiplierOrb.mjs` |
| Persistent Multiplier | persistent_multiplier | `persistentMultiplier.mjs` |
| Path-Aware Multiplier | path_aware_multiplier | `pathAwareMultiplier.mjs` |
| Mystery Symbol (uniform reveal) | mystery_symbol | `mysterySymbol.mjs` + `mysteryReveal.mjs` |
| Super Symbol (multi-cell) | super_symbol | `superSymbol.mjs` |
| Lightning / Coin collector | lightning | `lightning.mjs` |
| Wild Reel | wild_reel | `wildReel.mjs` |
| Wheel of Fortune / Wheel Bonus | wheel_bonus | `wheelBonus.mjs` + `wheelBonusReveal.mjs` |
| Pick'n'Click / Bonus Pick | bonus_pick | `bonusPick.mjs` + `pickBonusReveal.mjs` |
| Big Win Tier 1/2/3/4/5 (NE Nice/Epic/Mega — H1 banned vendor) | big_win | `bigWinTier.mjs` |

---

## 9. Cite-as references (svi izvori — single citation list za bilo koji agent)

Pun BibTeX u: [`research-pool/books-academic.md`](research-pool/books-academic.md) §8.

**Top 10 obavezno-citirano za regulator/audit gates**:

1. Harrigan, K. A. & Dixon, M. (2009). PAR Sheets, Probabilities, and Slot Machine Play.
2. UK Gambling Commission. Remote Gambling Technical Standards (RTS) 2024-2025 revisions.
3. Barboianu, C. (2022). The Mathematics of Slots.
4. Gamma et al. (1994). Design Patterns (GoF).
5. Nystrom, R. (2014). Game Programming Patterns.
6. Schüll, N. (2012). Addiction by Design.
7. AGCO Standard 4.07 (Ontario).
8. DE GlüNeuRStV § 22a.
9. MGA Technical Standards.
10. NIST SP 800-22 Rev.1a (RNG statistical tests).

---

## 10. Kako agenti koriste ovaj dokument

Svaki Cortex agent (Plan, Explore, general-purpose, slot-domain) **prvo pročita ovaj fajl** pre task-a:

1. Pogleda §2 — šta već postoji
2. Pogleda §3 — šta industry standard ima ekvivalentno
3. Pogleda §4 — gap analizu, šta nedostaje
4. Pogleda §5 — koje patterns su kandidat za extract
5. Pogleda §6 — regulator gates za jurisdiction u pitanju
6. Cite-uje izvore iz §9 u commit poruci / PR opisu

Ovo eliminiše "ponovo grep-uj 288MB industry standard-a" overhead — agent dolazi sa **gotovom mapom**.

---

## 11. Continuous updates

Kad agent otkrije nov pattern, novu regulator zahtev, ili novu mehaniku:

1. Update odgovarajući `research-pool/<file>.md` (svaki je single-topic owner)
2. Update ovaj fajl §2-9 sa kratkim cross-link-om
3. Commit sa `docs(SLOT_MECHANICS): <one-liner>` poruka

Auto-stage CI invariant (future): pre-commit hook bi mogao verifikovati da svaki novi blok u `src/blocks/` ima citation u §3 ili §4.

---

**Stanje na 2026-06-16**: 62,000+ reči (~310KB) sintetizovanog znanja. Kimi research pending — kad završi (do ~15min), update §2.6.

**Generated by**: 8 paralelnih Claude agenata (Explore × 4, general-purpose × 3, plus Kimi research) preko 12 minuta total wallclock.
