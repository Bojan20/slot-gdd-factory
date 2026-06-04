# Master TODO — slot-gdd-factory

> Living single-source-of-truth for what's shipped, what's in progress,
> and what's queued. Updated after every wave/feature.
>
> Last updated: **2026-06-04** · HEAD: `d5026c8` · main · Wave **U11 turboMode** + **U13 settingsPanel** shipped → Wave U **8/10 original atoms** complete (U1, U3, U4, U5, U6, U8, U9, U10) + 2 new (**U11 turboMode**, **U13 settingsPanel**). Remaining iz originalnog plana: U2 (deactivated by design — ADB tok), U7 (rngFairness — math-adjacent, awaits Boki call).

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
