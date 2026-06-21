# Synth Pool · Archetype Agent Registry

Wave Z2 — knowledge base za scaffolder. Svaki archetype iz
`src/registry/featureArchetypes.mjs` mapira ovde na agent
specification koji `tools/_wave-z-scaffold-block.mjs` čita
da bi sintetisao block scaffold.

Struktura per archetype:

- **identity** — id, agent owner (math/ux/compliance/audio/engine)
- **mental model** — kako tipa thing radi (1-2 paragrafa)
- **lifecycle contract** — koje HookBus event-e subscribe-uje + emit-uje
- **state machine** — minimalan state shape + transitions
- **force-chip contract** — flag ime, payload, one-shot semantics
- **window flags** — runtime `window.__X__` flags koje block postavi
- **pitfalls** — top 3 greške koje scaffolder mora izbeći
- **canonical references** — postojeći block-ovi u repo-u koji već implementiraju archetype

Scaffolder čita ovaj fajl + odgovarajuće `_DOMAIN_*.md` ekspertize +
combinuje ih u JSDoc kontrakt header + lifecycle skeleton + test skeleton.

---

## sticky-state · agent owner: UX_ARCHITECT

**Mental model:** When a marked cell lands, it persists across N spins
(or until cleared by retrigger / FS end / explicit reset). The block
owns a list of `[reel, row]` coordinates plus a counter `remainingSpins`.

**Lifecycle:**

- `preSpin` → mark sticky cells in `window.__STICKY_CELLS__` so engine
  skips overwriting them this spin
- `onSpinResult` → if new sticky symbol lands, append to coord list
- `postSpin` → decrement `remainingSpins`; if zero, clear all cells

**State shape:** `{ cells: [], remainingSpins: 0 }`

**Force chip:** `__FORCE_STICKY_PLANT__ = [reel, row]` — one-shot,
consumed at next `preSpin`.

**Window flags:** `window.__STICKY_CELLS__`, `window.__STICKY_REMAINING_SPINS__`

**Pitfalls:**
1. NIKAD ne overwrite-uj postojeću sticky ćeliju ako se isti coord ponovo pojavi
2. NIKAD ne emit-uj `onStickyExpired` pre `postSpin` — engine bi mogao da render-uje pražnu ćeliju u istom frame-u
3. ⚠️ FS lifecycle override — ako je sticky kreiran u BASE a FS triggered, MORA se reset na `onFsTrigger` (osim ako GDD eksplicitno deklariše `carryToFs: true`)

**Canonical references:**
- `src/blocks/stickyWild.mjs` (W21)
- `src/blocks/stickyMeter.mjs` (W56)
- `src/blocks/persistentMultiplier.mjs` (W12) — variant gde state nije coord nego scalar

---

## accumulator · agent owner: MATH_ARCHITECT

**Mental model:** Per-spin contributions add to running tally. When tally
crosses threshold N, trigger payload (FS, BW, bonus reveal). Reset on
trigger consumption.

**Lifecycle:**

- `onSpinResult` → if winning symbols match accumulator-target kind, add to `current`
- `postSpin` → if `current >= threshold`, emit `onAccumulatorFull` and consume payload
- `onTumbleStep` → for cascade engines, accumulate per-tumble step too

**State shape:** `{ current: 0, threshold: 0, payload: null }`

**Force chip:** `__FORCE_COLLECTOR_FILL__ = 'partial' | 'full' | 'overflow'`

**Window flags:** `window.__COLLECTOR_TALLY__`, `window.__COLLECTOR_THRESHOLD__`

**Pitfalls:**
1. NIKAD ne reset-uj tally na `postSpin` PRE `onAccumulatorFull` emit-a — gubi se threshold-cross signal
2. NIKAD ne dupliraj contribution u istom spinu kada cascade-collapse koincidira (tumble engine emit-uje `onTumbleStep` × N PLUS `onSpinResult` × 1)
3. ⚠️ Overflow handling: ako contribution > (threshold - current), kako tretiraš višak? GDD mora reći (drop / next-cycle / convert-to-mult)

**Canonical references:**
- `src/blocks/coinCollect.mjs` (D-17.5 → potSymbolFireball variant)
- `src/blocks/energyMeter.mjs` (W56)
- `src/blocks/multiplierLadder.mjs` (W56) — variant gde tally povećava current rung

---

## ladder · agent owner: MATH_ARCHITECT

**Mental model:** Discrete tier list — climbing from rung N to N+1 grants
fixed multiplier or fixed prize. Top rung is jackpot.

**Lifecycle:**

- `onSpinResult` → check climb conditions (trigger symbol count, win threshold)
- `onLadderClimb` → animate ascent, update `currentRung`
- `postSpin` → if rung reached top, emit `onLadderTop` + grant prize

**State shape:** `{ rungs: [{label, value}], currentRung: 0 }`

**Force chip:** `__FORCE_LADDER_TIER__ = 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND'`

**Window flags:** `window.__LADDER_RUNG__`, `window.__LADDER_RUNGS__`

**Pitfalls:**
1. NIKAD ne grant-uj top rung prize bez ECCS handpay trigger ako prize > handpay_threshold (compliance)
2. NIKAD ne reset-uj ladder na `onFsTrigger` — neki GDD-ovi imaju ladder persist-through-FS pattern
3. ⚠️ Rung values su MATEMATIČKI determinisani — NE smeš ih ad-hoc generisati, MATH_ARCHITECT mora ih navesti iz PAR sheet-a

**Canonical references:**
- `src/blocks/jackpotLadderRooms.mjs` (D-17.5)
- `src/blocks/multiplierLadder.mjs` (W56)
- `src/blocks/progressiveFsRetriggerLadder.mjs` (W56)

---

## reveal · agent owner: UX_ARCHITECT

**Mental model:** Modal pojavi grid od N cells. Player tap-ne K. Each
tap reveals deterministic prize. Pool je shuffled per-session.

**Lifecycle:**

- `onPickStart` → emit modal-open + draw N cells from pool
- `onPickReveal` → per-tap reveal prize, decrement remaining
- `onPickComplete` → emit modal-close + grant cumulative reward

**State shape:** `{ revealed: [], pool: [], remaining: 0 }`

**Force chip:** `__FORCE_PICK_PATH__ = [0, 2, 4]` — deterministic indices

**Window flags:** `window.__PICK_POOL__`, `window.__PICK_REMAINING__`

**Pitfalls:**
1. NIKAD ne reveal-uj prize ako modal nije aria-modal=true (accessibility)
2. NIKAD ne shuffle-uj pool izmedju picks — player percepcija predvidlivosti je narušena
3. ⚠️ Force chip se TROŠI per-tap, ne all-at-once — ako force_path = [0,2,4] i pop-uje 0 na prvi tap, ostaje [2,4] za sledeći tap

**Canonical references:**
- `src/blocks/bonusPick.mjs` (W56)
- `src/blocks/pickYourFs.mjs` (W56)
- `src/blocks/jackpotPicker.mjs` (W56)

---

## spawn · agent owner: ENGINE_ARCHITECT

**Mental model:** Posle spin result-a, neke ćelije se transformišu u
drugi simbol (mystery reveal, transformation kaskade). Block ne diktira
KOJI simbol — engine ga isporučuje.

**Lifecycle:**

- `onSpinResult` → identifikuj target ćelije (mystery symbol ID match)
- `onSpawnComplete` → emit transformacija završena (engine re-evaluates win)

**State shape:** `{ cells: [], targetSymbolId: null }`

**Force chip:** `__FORCE_SPAWN_KIND__ = symbolId`

**Window flags:** `window.__SPAWN_CELLS__`, `window.__SPAWN_REVEAL_KIND__`

**Pitfalls:**
1. NIKAD ne re-evaluate-uj win unutar `onSpanwComplete` — to je engine job, block samo emit-uje da je spawn završen
2. NIKAD ne render-uj reveal pre `onSpinResult` — payment se računa od pre-spawn grid-a
3. ⚠️ Mystery + tumble interaction — ako spawn dodaje wild, taj wild učestvuje u sledećoj tumble iteraciji ALI ne računa za current tumble step

**Canonical references:**
- `src/blocks/mysterySymbol.mjs` (W12)
- `src/blocks/mysteryWildReveal.mjs` (W56)
- `src/blocks/symbolUpgrade.mjs` (W56)

---

## expand-direction · agent owner: ENGINE_ARCHITECT

**Mental model:** Cell ili simbol raste duž vektora — full reel, 2×2, 3×3,
cluster footprint. Block ne menja paytable — re-shapes grid topology.

**Lifecycle:**

- `onSpinResult` → identifikuj seed cells koje treba da se ekspandiraju
- `onExpandComplete` → emit re-shaped grid, engine re-evaluates win

**State shape:** `{ seedCells: [], direction: 'vertical' | 'horizontal' | '2x2' | '3x3' }`

**Force chip:** `__FORCE_EXPAND_KIND__ = 'vertical' | '2x2'`

**Window flags:** `window.__EXPAND_TARGETS__`, `window.__EXPAND_DIRECTION__`

**Pitfalls:**
1. NIKAD ne overlap-uj expansion preko fixed-size simbola (jackpot symbol ne sme da bude prekriven)
2. NIKAD ne expand-uj posle tumble step-a — expand je base-spin-only
3. ⚠️ 2×2 / 3×3 footprint re-shape mora konzistentno tretirati column-boundary kolizije

**Canonical references:**
- `src/blocks/expandingWild.mjs` (W21)
- `src/blocks/bigSymbolRender2x2.mjs` (D-17.2)
- `src/blocks/megaWildCluster.mjs` (W56)

---

## movement · agent owner: ENGINE_ARCHITECT

**Mental model:** Cell ili simbol se kreće duž grida svaki spin —
walking wild ide jedan reel levo, drift se vraća. Nakon spin-a engine
emit-uje new coord, block render-uje animaciju.

**Lifecycle:**

- `preSpin` → snapshot current cells; emit `onWalkPrepare`
- `onSpinResult` → engine emit-uje new coords; block update-uje state
- `postSpin` → render animaciju, emit `onWalkComplete`

**State shape:** `{ cells: [], direction: 'left' | 'right' | 'down' | 'up' }`

**Force chip:** `__FORCE_WALK_DIR__ = 'left' | 'right'`

**Window flags:** `window.__WALK_CELLS__`, `window.__WALK_DIRECTION__`

**Pitfalls:**
1. NIKAD ne pomeraj cell van grid-a — direction reverse mora biti deklarisan
2. NIKAD ne kombinuj walking + sticky bez explicit GDD reči — collision policy je suštinski različita
3. ⚠️ Walking wild kao trigger za FS — ako wild "izađe" sa grid-a, da li to triggers FS exit? GDD MORA reći

**Canonical references:**
- `src/blocks/walkingWild.mjs` (W21)
- `src/blocks/walkingWildStepper.mjs` (W56)

---

## linked-region · agent owner: ENGINE_ARCHITECT

**Mental model:** Dva ili više reels/cells dele isti landed strip —
mirrored, synced, linked. Block ne menja RNG — replicira lande post-spin.

**Lifecycle:**

- `preSpin` → engine commits da je link grupa armed
- `onSpinResult` → block detektuje source reel landing → kopira u target reels
- `postSpin` → emit `onLinkedComplete`

**State shape:** `{ groups: [{source, targets[]}] }`

**Force chip:** `__FORCE_LINK_PATTERN__ = 'mirror' | 'sync' | 'reel2-to-reel4'`

**Window flags:** `window.__LINKED_REELS__`, `window.__LINKED_SOURCE_LANDING__`

**Pitfalls:**
1. NIKAD ne mutate-uj source landed strip — to je RNG output, immutable
2. NIKAD ne emit-uj `onLinkedComplete` pre nego što sva linked reels render-uju
3. ⚠️ Win evaluation se računa NAD linked grid-om — ne nad originalom

**Canonical references:**
- `src/blocks/linkedReels.mjs` (D-17.3)

---

## meter-charging · agent owner: UX_ARCHITECT

**Mental model:** Meter se puni svaki spin — full meter triggers super-spin
ili power-up mode. Slično accumulator-u ali rate-based (per-spin tick),
ne contribution-based.

**Lifecycle:**

- `onSpinResult` → increment `current` po fixed rate
- `postSpin` → check `current >= capacity`; emit `onMeterFull`
- `onPowerUpStart` → enter power-up mode (može mutate-ovati reel weights, FS multiplier, itd.)

**State shape:** `{ current: 0, capacity: 100, mode: 'normal' | 'powered' }`

**Force chip:** `__FORCE_METER_FILL__ = 'partial' | 'full' | 'overflow'`

**Window flags:** `window.__METER_VALUE__`, `window.__METER_CAPACITY__`, `window.__METER_MODE__`

**Pitfalls:**
1. NIKAD ne reset-uj meter na FS unless `resetOnFs: true` (mnogi GDD-ovi imaju "carry through FS" patern)
2. NIKAD ne emit-uj `onMeterFull` više puta u istom spinu — ako overflow → next-cycle attribution
3. ⚠️ Powered mode duration MORA biti deklarisan — fixed N spins ili until-condition (next loss)

**Canonical references:**
- `src/blocks/energyMeter.mjs` (W56)
- `src/blocks/stickyMeter.mjs` (W56)
- `src/blocks/rewardChest.mjs` (W56)

---

## aux-reel · agent owner: ENGINE_ARCHITECT + MATH_ARCHITECT

**Mental model:** Side strip reel sa weighted bucket lands per-spin
multiplier/segment. Aux ne menja main RNG — paralelno spinuje sa main
reels.

**Lifecycle:**

- `preSpin` → start aux spin animation
- `onSpinResult` → engine emit-uje aux landing value; block stores
- `postSpin` → emit `onAuxLanded(value)`; apply mult to winning lines

**State shape:** `{ value: null, weighted: [{value, weight}] }`

**Force chip:** `__FORCE_AUX_VALUE__ = number | 'MISS'`

**Window flags:** `window.__AUX_LANDING__`, `window.__AUX_WEIGHTS__`

**Pitfalls:**
1. NIKAD ne apply-uj aux mult nakon WIN_PRESENTATION_START — mult mora biti baked u rollup amount
2. NIKAD ne sync-uj aux spin sa specific main reel — to bi pravo random pažnjom narušilo
3. ⚠️ Weighted bucket MORA biti u GDD math sheet-u — block ne sme nagađati weights

**Canonical references:**
- `src/blocks/stormMultiplierReel.mjs` (W56)
- `src/blocks/lightning.mjs` (W12 partial)

---

## trigger-then-respin · agent owner: ENGINE_ARCHITECT (najkompleksniji)

**Mental model:** N trigger symbols (default 6) land u BASE → enter HW
mode. Triggers persist na svakoj sledećoj spin. Reset 3 respins on
NEW trigger symbol. Resolve: full grid → top jackpot ELSE end-of-respins
→ sum cell values.

**Lifecycle:**

- `onSpinResult` → count trigger symbols; if N+ → enter HW
- `preRespin` → freeze trigger cells; spin non-trigger cells only
- `onRespinResult` → if new trigger landed, reset counter to 3, append
  to persisted
- `postRespin` → if respins == 0, resolve

**State shape:** `{ persistedCells: [], respinsRemaining: 0, jackpots: ['MINI','MINOR','MAJOR','GRAND'] }`

**Force chip:** `__FORCE_HW_TRIGGER__ = 'enter' | 'fullboard' | 'partial'`

**Window flags:** `window.__HW_PERSISTED__`, `window.__HW_RESPINS_REMAINING__`, `window.__HW_JACKPOTS__`

**Pitfalls (top 5 — ovo je najteža mehanika):**
1. NIKAD ne respin trigger cells — one moraju biti frozen
2. NIKAD ne reset counter ako landed cell nije TRIGGER kind (može biti coin / blank — ne resetuje)
3. NIKAD ne emit-uj `postRespin` pre celebrate animation završava
4. NIKAD ne aktiviraj base game spin tokom HW respin lifecycle
5. ⚠️ Full-board pre-resolve: ako svi cells postanu trigger, MORA resolve u top jackpot (industry standard pattern)
6. ⚠️ Carry: ako GDD kaže "carry through FS", HW state persist-uje na `onFsTrigger`

**Canonical references:**
- `src/blocks/holdAndWin.mjs` (W12)
- `src/blocks/respin.mjs` (W12)
- `src/blocks/wildTriggerHoldAndWin.mjs` (W56)
- `src/blocks/holdAndWinFrameMultiplier.mjs` (D-14.1)
- `src/blocks/holdAndWinReelExpansion.mjs` (W56)

---

## cascade-collapse · agent owner: ENGINE_ARCHITECT

**Mental model:** Winning simboli nestaju, cells iznad padaju dole,
novi simboli ulaze odozgo, win re-evaluate, repeat dok nema win.

**Lifecycle:**

- `onSpinResult` → identifikuj win cells; emit `onTumbleStep` × N
- `onTumbleStep` → collapse + refill; re-evaluate
- `postSpin` → emit `onTumbleEnd` kad nema više win-ova

**State shape:** `{ streak: 0, multiplier: 1 }`

**Force chip:** `__FORCE_TUMBLE_PATTERN__ = 'short' | 'long' | 'mega'`

**Window flags:** `window.__TUMBLE_STREAK__`, `window.__TUMBLE_MULT__`

**Pitfalls:**
1. NIKAD ne reset multiplier mid-tumble unless GDD eksplicitno kaže
2. NIKAD ne emit-uj `postSpin` pre `onTumbleEnd` — payout je accumulator preko svih steps
3. ⚠️ Tumble + FS interaction — base game streak NE prelazi u FS unless `carryToFs: true`

**Canonical references:**
- `src/blocks/tumble.mjs` (W21)
- `src/blocks/cascadingWildPersistence.mjs` (W56)
- `src/blocks/tumbleGrowingFsMultiplier.mjs` (W56)
- `src/blocks/symbolStackCollapse.mjs` (W56)

---

## count-to-trigger · agent owner: MATH_ARCHITECT

**Mental model:** Tačno N scatter/trigger simbola u jednom spinu →
specific outcome (FS award, BW tier, jackpot path).

**Lifecycle:**

- `onSpinResult` → broj trigger simbola
- if count == threshold → emit `onCountHit`
- consume → FS award / BW enter / etc.

**State shape:** `{ count: 0, threshold: 0 }`

**Force chip:** `__FORCE_COUNT_HIT__ = number` — synthesises count

**Window flags:** `window.__COUNT_PROGRESS__`, `window.__COUNT_THRESHOLD__`

**Pitfalls:**
1. NIKAD ne kumuliraj count preko spinova — to je accumulator archetype, ne count-to-trigger
2. NIKAD ne emit `onCountHit` ako count < threshold (i obrnuto)
3. ⚠️ count > threshold kondicija (npr. "5 scatters → 25 FS" vs "3 scatters → 10 FS") MORA biti ladder mapping iz GDD-a

**Canonical references:**
- `src/blocks/freeSpins.mjs` (W12)
- `src/blocks/triggerCounting.mjs` (W12)
- `src/blocks/moneyGrabGrid.mjs` (W56)

---

## boost-multiplier · agent owner: MATH_ARCHITECT

**Mental model:** Per-spin random ili triggered multiplier se primeni na
winning lines/cells/total. Vrednost je weighted draw iz fixed bucket.

**Lifecycle:**

- `onSpinResult` → draw multiplier value (weighted)
- `postSpin` → apply mult to rollup
- `onMultApplied` → emit value + targets (UI updates winRollup)

**State shape:** `{ value: 1, targets: [] }`

**Force chip:** `__FORCE_BOOST_VALUE__ = number` — synthesises mult

**Window flags:** `window.__BOOST_VALUE__`, `window.__BOOST_BUCKET__`

**Pitfalls:**
1. NIKAD ne apply boost mult pre WIN_PRESENTATION_START — mult mora biti baked u rollup amount
2. NIKAD ne stack-uj multiple boost simulta neously bez explicit GDD reči (additive vs multiplicative pravila)
3. ⚠️ Weighted bucket NE sme biti hardcoded — math agent populates iz PAR

**Canonical references:**
- `src/blocks/randomLightningMultiplier.mjs` (W56)
- `src/blocks/multiplierOrb.mjs` (W12)
- `src/blocks/expandingWildMultiplier.mjs` (W56)

---

## jackpot-pool · agent owner: MATH_ARCHITECT + COMPLIANCE_ARCHITECT

**Mental model:** Fixed 4-tier ladder (MINI/MINOR/MAJOR/GRAND) sa
cumulative or fixed prize. Top tier triggers handpay if > threshold.

**Lifecycle:**

- `onJackpotTriggered` → emit tier + amount
- `onJackpotResolved` → handpay if > threshold, else credit to balance
- `postSpin` → ensure HW frame doesn't double-spawn jackpot

**State shape:** `{ tiers: ['MINI','MINOR','MAJOR','GRAND'], values: [number,number,number,number] }`

**Force chip:** `__FORCE_JP_TIER__ = 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND'`

**Window flags:** `window.__JP_POOL__`, `window.__JP_HANDPAY_THRESHOLD__`

**Pitfalls:**
1. NIKAD ne grant GRAND bez handpay flow ako amount > jurisdiction threshold (US: $1200, UK: £25k, etc.)
2. NIKAD ne reset tiers između sessions — progressive accumulira preko vremena
3. ⚠️ Tier-to-prize mapping je MATH layer — block samo orchestrira, ne računa

**Canonical references:**
- `src/blocks/jackpotRoomReveal.mjs` (W56)
- `src/blocks/potSymbolFireball.mjs` (D-17.5)
- `src/blocks/grandInterruptionLock.mjs` (D-17.6)
- `src/blocks/holdAndWinRoomJackpotMultiplier.mjs` (D-14.1)
