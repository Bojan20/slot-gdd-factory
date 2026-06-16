# Playa-Slot Reverse Engineering Report

**Date:** 2026-06-16  
**Codebase:** `/Users/vanvinklstudio/IGT/playa-slot`  
**Total TypeScript Files:** 238  
**Total LOC:** 37,464  

---

## Executive Summary

Playa-Slot is a modular slot game engine built on the **Playa-Core** framework using TypeScript, MobX (reactive state), and Pixi.js (rendering). The architecture separates concerns into distinct systems: **reel mechanics** (spin/tumble), **symbol management**, **behavior controllers** (movement, win presentation), **UI controls**, and **command-driven orchestration**. The game supports multiple reel types (NORMAL, BONUS, INDEPENDENT, TUMBLING), spin behaviors (standard, selective stacking, independent, tumbling), and layered win presentation (rollups, big wins, plaques, jackpots).

---

## I. REELS SUBSYSTEM

### 1.1 ReelComponent (619 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/Reel/ReelComponent.ts`

**Class Signature:**
```
class ReelComponent extends SimpleView<ReelSetProps, ReelSetActions, ReelProps>
  constructor(parentProps: ReelSetProps, parentActions: ReelSetActions)
  setConfig(reelConfigDef: IReelConfigDef | null): void
  setReelCellStopDef(): void
  playSymbolAnimations(animation: string, symbol?: string, loop?: boolean): void
  createReelCell(): ReelCellComponent
```

**State Machine:**
| State | Transition | Blocking |
|-------|-----------|----------|
| IDLE | onSpinCommand → START | reel must not be locked |
| START | tick + startDelay elapsed → STARTED | none |
| STARTED | onStopCommand → STOPPING | none |
| STOPPING | reel cells halt → STOPPED | velocity < threshold |
| STOPPED | onTumbleCommand → TUMBLE_BEGIN | only if tumbleOut=true |

**Data Contracts:**
- **IReelConfigDef:** `name, rows, dynamicRows, topPadding, bottomPadding, direction (UP/DOWN), speed, speedUp, turboSpeed, easeIn[], easeOut[], turboModeEaseOut[], type (SPIN/TUMBLE), startDelay, stopDelay, anticipationDelay, tumbleOut, tumbleStopDelay, perSymbolStartDelay, perSymbolStopDelay, tumbleInSpeed, tumbleOutSpeed, tumbleInAccelerationRate, tumbleOutAccelerationRate, maskName, positionName, explodeDelay`
- **IEntryDef (Reel outcome):** `name, stripIndex, cells: ICellDef[]`
- **IStripDef:** `name, stops: IStopDef[]`
- **IStopDef:** `symbolId, weight`

**Lifecycle Hooks:**
- `init()` – initializes reel, logs "Reel Component -- Initialized"
- `setConfig()` – applies config data (called post-paytable load)
- `setReelCellStopDef()` – binds cell strip indices from outcome
- `@computed stripDef` – reads from paytable.stripsInfo map

**Industry Pattern:** Vertical strip mapping with cell-based rendering. Padding cells (top/bottom) use modular index arithmetic to position invisible cells above/below visible row.

**Equivalent in slot-gdd-factory:** `src/blocks/reel.mjs` – similar config-driven reel init, but no separate Reel vs ReelSet abstraction.

---

### 1.2 ReelSetComponent (880 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/ReelSet/ReelSetComponent.ts`

**Class Signature:**
```
class ReelSetComponent extends BaseView<SlotProps, GameActions, ReelSetProps, ReelSetCommands>
  constructor(parentProps: SlotProps, parentActions: GameActions, waitsFor?: ComponentConstr[], data?: ReelSetData, assetIds?: string[], layoutId?: string)
  setReelSetsByName(reelSetConfigData: Map<string, IReelSetConfig> | null, configName: string | undefined): void
  createReelComponentsByConfig(reelSet: IReelSet): void
  applyReelSetConfig(reelSet: IReelSet): void
  playAnimation(animation: string, reel?: number, symbol?: string, loop?: boolean): void
```

**State Machine:**
| State | Transition | Blocking |
|-------|-----------|----------|
| IDLE | setReelSets() → initialized | config must be loaded |
| SPIN_START_BEGIN | tick + all reels START → SPIN_STARTED | reelsToStop > 0 |
| SPIN_STARTED | all reels STOPPED → BASE_GAME | none |
| TUMBLE_BEGIN | tumbleBehavior ticks → TUMBLE_STEP | one tumble per frame |
| TUMBLE_END | tumble countdown = 0 → IDLE or BASE_GAME | depends on mode |

**Data Contracts:**
- **IReelSetConfig:** `reelSetConfigDef: IReelSetConfigDef, symbolSet, reelSet, stripInfo, container, triggerName, dynamicReelSet, symbolBoundNames[], reelsConfig: Map<string, IReelsConfig>`
- **IReelSetConfigDef:** `columns, type (NORMAL/BONUS/INDEPENDENT/TUMBLING), selectiveStackingConfig, stackedSymbolConfig, minSpinTime`
- **IReelSet (internal):** container, templateContainers[], reelAssetNames[], reelComponents[], symbolSetService, symbolWeightService, system (IComponentSystem), triggerName, reelSetName, stripInfo

**Lifecycle Hooks:**
- `init()` – builds layout, loads reelSetConfig.json, calls setReelSetConfigData()
- `setReelSets()` – populates reelComponents array, registers triggers
- `applyReelSetConfig()` – creates masks, dimensions, templates (called per stage)
- `@computed populationOutcomeDef` – retrieves outcome for current reelSetName
- `@computed stripInfoDef` – maps stripInfoName → IStripInfoDef from paytable

**Industry Pattern:** Multi-reel-set abstraction (BaseGame, FreeSpins, Bonus stages). Layout-driven container discovery. Selective-stacking config pre-loaded for symbol schema swapping.

**Equivalent in slot-gdd-factory:** `src/blocks/reelset.mjs` – similar multi-stage approach, but tighter coupling of reel creation and spin system.

---

### 1.3 ReelCellComponent (270 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/ReelCell/ReelCellComponent.ts`

**Class Signature:**
```
class ReelCellComponent extends SimpleView<ReelProps, ReelActions, ReelCellProps>
  constructor(parentProps: ReelProps, parentActions: ReelActions)
  playAnimation(animationName: string, loop?: boolean): SpineAnimation | undefined
  onCellInitialized(): void
  addCellDefText(): void
  setStopDef(stopDef: IStopDef): void
  setStopIndex(stopIndex: number): void
```

**State Machine:**
| State | Transition | Blocking |
|-------|-----------|----------|
| IDLE | spin system adds cell → ACTIVE | must be in cell pool |
| ACTIVE | symbolSet applies symbol → RENDERED | symbol exists in pool |
| RENDERED | cell scrolls off reel → REMOVED | cell bounds < reel mask |

**Data Contracts:**
- **IStopDef:** `symbolId, weight`
- **ICellDef (outcome cell):** `name, type, stripIndex, text`
- Cell references `currentSymbol` (string ID) via computed getter reading stopDef.symbolId

**Lifecycle Hooks:**
- `onCellInitialized()` – plays default animation for symbol (e.g., "s01_loop")
- `playAnimation()` – triggers Spine animation on pooled symbol
- `addCellDefText()` – debug method; adds cell name + stripIndex label

**Industry Pattern:** Cell-object pattern. Each cell is a container wrapping a pooled symbol component. Padding cells (TopPadding_, BottomPadding_) reuse strip indices modulo array length.

**Equivalent in slot-gdd-factory:** `src/blocks/symbol.mjs` – similar pooling, but ReelCell is renderer-agnostic here (can be Pixi Container or other).

---

### 1.4 SymbolSet & SymbolWeightService (135 + 135 LOC)
**Path:** 
- `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/SymbolSet/SymbolSetService.ts`
- `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/SymbolWeight/SymbolWeightService.ts`

**SymbolSetService Class Signature:**
```
class SymbolSetService extends BaseService<ReelSetProps, ReelSetActions, SymbolSetServiceProps>
  constructor(parentProps: ReelSetProps, parentActions: ReelSetActions, data?: SymbolSetServiceData)
  translateSymbolSetConfig(): Map<string, ISymbolSetConfig> | null
  applySymbolSetConfig(symbolSetName?: string): void
  getSymbol(symbolName: string): SymbolComponent | undefined
```

**SymbolWeightService Class Signature:**
```
class SymbolWeightService extends BaseService<ReelSetProps, ReelSetActions, SymbolWeightServiceProps>
  translateSymbolWeightConfig(): Map<string, ISymbolWeightConfig> | null
  applySymbolSetConfig(): void
  getRandomSymbol(reelName: string): string
  setCurrentWeightProfile(profile: IWeightProfile): void
```

**Data Contracts:**
- **ISymbolDef:** `symbolId, required (boolean)`
- **IWeightProfile:** `name, weight, reelWeights: Map<string, IReelWeights>`
- **IReelWeights:** `name, symbolWeightedList: string[]` (expanded list with duplicates for weighting)
- **IWeightConfig:** `profileWeight, weights.reelWeights: Map<string, IWeight[]>` where IWeight = `{symbolID, weight}`

**RNG & Weight Tables:**
Uses **GenericUtils.getRandomNum(min, max)** (seeded or pseudo-random). Symbol weight tables are pre-expanded: if symbol "A" has weight 3 and symbol "B" has weight 1, the `symbolWeightedList` = ["A", "A", "A", "B"]. Random index into this list gives weighted symbol.

**Lifecycle Hooks:**
- `init()` – loads symbolSetConfig.json and symbolWeightConfig.json
- `applySymbolSetConfig()` – expands weight lists, populates internal reelWeights map
- `getRandomSymbol()` – called by ReelSpinSystem.addNewReelCell() for each new cell

**Industry Pattern:** Expanded weighting tables (industry standard for fair RNG audits). No seeded RNG state exposed to game logic (backend-controlled outcomes via IPopulationOutcomeDef).

**Equivalent in slot-gdd-factory:** `src/blocks/symbol-weight.mjs` – similar table expansion, but playa-slot exposes weight profiles per stage.

---

## II. REEL SPIN SYSTEMS (5 types)

### 2.1 ReelSpinSystem (1337 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/ReelSet/systems/ReelSpinSystem.ts`

**Class Signature:**
```
class ReelSpinSystem implements IComponentSystem
  constructor(reelSetComponent: ReelSetComponent, reelSet: IReelSet)
  setBehaviors(spinBehaviors?: Map<string, ISpinBehavior>): void
  getReelSetChildren(): DisplayObject[]
  getReelContainers(displayObjects: DisplayObject[], reelName: string): DisplayObject[]
  getSpinBehaviorCellThresholds(reelComponent: ReelComponent, cells: ReelCellComponent[]): {cellAddThreshold: number[], cellRemoveThreshold: number[]}
```

**State Machine:**
| State | Transition | Blocking |
|-------|-----------|----------|
| IDLE | setBehaviors() called → watching | reelsToStop must > 0 |
| SPINNING | onTick, cells scroll, add/remove at threshold → continuous | movement continues |
| STOPPING | onStopCommand, velocity ramps down → velocity < stop_velocity | reel.props.stopDelay ms elapsed |
| COMPLETE | all reels stopped, reactions disposed → isComplete = true | none |

**Cell Add/Remove Thresholds:**
Thresholds are 2D [x, y] arrays defining the pixel boundary at which to spawn/despawn cells. For DOWN direction:
- **cellAddThreshold:** [0, -cellHeight] – spawn new cell when reel top scrolls past -cellHeight
- **cellRemoveThreshold:** [0, reelHeight + cellHeight] – remove cell when it scrolls past bottom

**Lifecycle Hooks:**
- `setBehaviors()` – wraps each reel's ReelSpinBehavior; increments totalNumReelsToStop
- `setSpinReactions()` – adds MobX reaction to track reelComponent.state changes
- `setReelCellSymbol()` – draws symbol from SymbolSetService pool for new cell
- `onTick()` – called via ReelSpinCommand ticker; updates cell positions, adds/removes cells

**Industry Pattern:** Per-reel behavior encapsulation. Cell thresholds are geometry-driven (no hardcoded counts). Threshold crossing triggers cell pool recycling.

**Equivalent in slot-gdd-factory:** `src/blocks/spin-system.mjs` – similar threshold-driven cell management.

---

### 2.2 SelectiveStackingReelSpinSystem (339 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/ReelSet/systems/SelectiveStackingReelSpinSystem.ts`

**Extension Signature:**
```
class SelectiveStackingReelSpinSystem extends ReelSpinSystem
  protected selectiveStackingSymbolNames: Map<string, string>
  protected schemaInfoNames: string[]
  setBehaviors(): void [override]
  setReelCellSymbol(cell: ReelCellComponent, isNewCell: boolean): void [override]
```

**Pattern Industry Name:** **Selective Stacking** (IGT proprietary term). Allows swapping of symbol IDs in reel strips based on game state (bet level, stage, schema outcome). Example: schema maps "s01" → "s_wild_gold" based on paytable ValueMapping.

**Data Flow:**
1. Paytable defines `<KeyValuePairInfo name="BaseGame.ValueMapping">` with bet-to-symbol mapping
2. ReelSetComponent loads mappings into `schemaInfoNames[]` and `schemaSets` map
3. SelectiveStackingReelInitSystem reads schema and builds `selectiveStackingSymbolNames: Map<schemaName, schemaSymbolId>`
4. During spin, ReelSpinSystem.setReelCellSymbol() checks schema map before assigning symbol

**Lifecycle Hooks:**
- `setBehaviors()` – parses paytable keyValuePairInfo for ValueMapping and schema aliases
- `setReelCellSymbol()` – substitutes symbol ID if schema mapping exists

**Gap Analysis (vs. slot-gdd-factory):**
Slot-gdd-factory has no built-in selective stacking; would require external schema resolver at cell creation time.

---

### 2.3 IndependentReelSpinSystem (class extends ReelSpinSystem)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/ReelSet/systems/IndependentReelSpinSystem.ts`

**Distinction:** Overrides `getReelSetChildren()` to collect display objects from nested reel containers (one container per reel, not shared). Template containers are indexed separately per reel. Cell threshold calculation differs: uses largest template container height for all reels.

**Pattern:** Grid-based layout with isolated reel columns (e.g., 5x3 independent reels vs. 5x1 synchronized strip).

---

### 2.4 ReelTumblingSystem (1089 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/ReelSet/systems/ReelTumblingSystem.ts`

**Class Signature:**
```
class ReelTumblingSystem implements IComponentSystem
  constructor(reelSetComponent: ReelSetComponent, reelSet: IReelSet, resume?: boolean)
  setBehaviors(spinBehaviors?: Map<string, ISpinBehavior>): void
  setSlamStopReaction(): void
```

**Pattern Industry Name:** **Tumble** (cascading symbols after win). After winning line is detected, winning symbols explode/remove, remaining symbols fall, and new symbols drop from top. Repeats until no more wins.

**State Machine:**
| State | Transition | Blocking |
|-------|-----------|----------|
| IDLE | onTumbleCommand → TUMBLE_BEGIN | winLine detected |
| TUMBLE_BEGIN | createTumbleBehavior() → TUMBLE_STEP | none |
| TUMBLE_STEP | tick, cells fall, remove winners, add new → TUMBLE_STEP (loop) | currentTumbleIndex < maxTumbles |
| TUMBLE_END | no new wins or maxTumbles reached → post-tumble command | none |

**Data:**
- **currentTumbleIndex:** tracks iteration count; resets via ResetCurrentTumbleIndexCommand
- **explodedFlags:** Map<reelName, boolean[]> – tracks which cells were marked as winners this tumble

**Lifecycle Hooks:**
- `setBehaviors()` – creates TumbleBehavior per reel (vs. SpinBehavior)
- `resetExplodedFlags()` – initializes all cells as non-exploded
- `setSlamStopReaction()` – stops tumble immediately if slam-stop button pressed

**Gap Analysis (vs. slot-gdd-factory):**
Slot-gdd-factory does not implement tumbling; would require win detection + explicit remove-and-refill cycle.

---

### 2.5 ReelInitSystem (360 LOC) & SelectiveStackingReelInitSystem
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/ReelSet/systems/ReelInitSystem.ts`

**Class Signature:**
```
class ReelInitSystem implements IComponentSystem
  constructor(reelSet: IReelSet)
  setBehaviors(): void
  initReelComponent(reelComponent: ReelComponent): void
  positionReelCells(reelComponent: ReelComponent): void
  protected setReelCellSymbol(reelCellComponent: ReelCellComponent): void
```

**Purpose:** Initialize reel cells from backend outcome (IPopulationOutcomeDef) and position them on-screen.

**Lifecycle Hooks:**
- `setBehaviors()` – called at game init; iterates reelComponents
- `initReelComponent()` – creates ReelCellComponents from outcome's ICellDef[], assigns strip indices
- `positionReelCells()` – uses ReelSetUtils.positionReelCells() to place cells in layout
- `setReelCellSymbol()` – queries symbol pool and assigns to cell

**SelectiveStackingReelInitSystem** extends this to swap symbol IDs based on schema before assignment.

---

## III. BEHAVIOR CONTROLLERS

### 3.1 BaseSpinBehavior (658 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/behaviors/spinBehavior/BaseSpinBehavior.ts`

**Class Signature:**
```
class BaseSpinBehavior implements ISpinBehavior
  constructor(parentProps: ReelProps, parentActions: ReelActions, props: BaseSpinBehaviorProps, reelComponent: ReelComponent)
  initBehavior(reelCells: ReelCellComponent[], offsets: Map<string, number[]>, cellAddThreshold: number[], cellRemoveThreshold: number[]): void
  setMovementBehavior(behaviors: IMovementBehavior[]): void
  startSpin(): void
  startStopSpin(): void
  stopSpin(): void
  updateMovementOnCellAdd(): void
```

**Velocity & Deceleration Ramp:**
- **easeIn curve:** acceleration from 0 to target speed over `startDelay` ms
- **easeOut curve:** deceleration from target speed to near-0 over `stopDelay` ms
- **turboModeEaseOut:** alternate curve if turbo mode active (steeper deceleration)

Implemented via GSAP tweens or linear interpolation on movement data (y-velocity per tick).

**State Reaction:**
```
@observable state triggers MobX reaction:
  State.IDLE → (no-op)
  State.START → startSpin()
  State.STARTED → spinStarted()
  State.STOPPING → startStopSpin()
  State.STOPPED → stopSpin()
```

**Cell Add/Remove Logic:**
```
onTick():
  for each cell in reelCells:
    cellY += velocity
    if cellY < cellAddThreshold[1]:
      spinBehavior.cellToAdd = newCell
      ReelSpinSystem.addNewReelCell()
    if cellY > cellRemoveThreshold[1]:
      removeCell(cell)
      return cell to pool
```

**Lifecycle Hooks:**
- `initBehavior()` – caches offsets, thresholds, reelCells; sets up state reaction
- `startSpin()` – begins velocity ramp-up via GSAP tween or tick-based interpolation
- `startStopSpin()` – triggers deceleration ramp; sets target velocity to 0
- `stopSpin()` – clears movement, triggers reelComponent.setState(State.STOPPED)

**Industry Pattern:** Dual-phase velocity ramp (ease-in/ease-out). Cell thresholds are window-based (reel viewport).

**Equivalent in slot-gdd-factory:** `src/blocks/spin-behavior.mjs` – similar easing, but no explicit movement behavior composition.

---

### 3.2 BaseCellMovementBehavior (605 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/behaviors/movement/BaseCellMovementBehavior.ts`

**Class Signature:**
```
class BaseCellMovementBehavior implements IMovementBehavior
  constructor(parentProps: BaseSpinBehaviorProps, parentActions: BaseSpinBehaviorActions)
  setReelCells(reelCells: ReelCellComponent[]): void
  update(): void
  setMovementState(state: State): void
  getVelocity(): number
```

**Movement Profiles (from config easeIn/easeOut arrays):**
| Profile | Array Format | Result |
|---------|--------------|--------|
| Linear | [0, 0.5, 1] | constant acceleration |
| Cubic Ease-Out | [1, 0.33, 0.33] | quick decel then slow |
| Exponential | custom coefficients | varies by game config |

**Tick Update:**
```
update(deltaMS):
  if state = START:
    velocity = Interpolate(currentVelocity, targetVelocity, deltaMS / easeInDuration)
  else if state = STOPPING:
    velocity = Interpolate(currentVelocity, 0, deltaMS / easeOutDuration)
  
  for each cell:
    cell.y += velocity * (deltaMS / 1000)
```

**Lifecycle Hooks:**
- `setReelCells()` – registers cells to be moved
- `update()` – called every tick; interpolates velocity, updates cell positions
- `setMovementState()` – transitions movement state (START → STOPPING)

**Industry Pattern:** Separation of spin (cell add/remove) from movement (velocity curve). Allows swapping behavior implementations (e.g., TumbleCellMovementBehavior).

---

### 3.3 TumbleBehavior & TumbleCellMovementBehavior (569 LOC + derived)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/behaviors/tumbleBehavior/TumbleBehavior.ts`

**Extension Signature:**
```
class TumbleBehavior extends BaseSpinBehavior
  constructor(...args)
  protected createExplodeSymbols(): void
  protected handleWinningCells(cells: ReelCellComponent[]): void
```

**Tumble Sequence:**
1. Winning symbols explode (spine animation or particle effect)
2. Remaining symbols fall (TumbleCellMovementBehavior with tumbleInSpeed)
3. New symbols drop from top
4. Repeat until no wins detected

**TumbleCellMovementBehavior:**
```
class TumbleCellMovementBehavior extends BaseCellMovementBehavior
  update(): void [override]
```
Uses `tumbleInSpeed` and `tumbleOutSpeed` instead of easeIn/easeOut. Faster acceleration for visual drama.

**Lifecycle Hooks:**
- `handleWinningCells()` – marks cells as exploded, triggers remove + refill
- `createExplodeSymbols()` – instantiates explosion animation (GSAP fade-out, scale)

---

## IV. GAME STATE & STORE

### 4.1 SlotStore, SlotProps, SlotData
**Path:**
- `/Users/vanvinklstudio/IGT/playa-slot/src/ts/store/SlotStore.ts`
- `/Users/vanvinklstudio/IGT/playa-slot/src/ts/store/SlotProps.ts`
- `/Users/vanvinklstudio/IGT/playa-slot/src/ts/store/SlotData.ts`

**SlotStore Class Signature:**
```
class SlotStore extends BaseStore<SystemProps, SystemGameActions, SlotProps, SlotActions, SlotData>
  constructor(system: SystemProps, systemActions: SystemGameActions)
  protected isInitializable(): boolean
```

**SlotData (37 @observable properties):**
```
win: string
patternsBet: number, betPerPattern: number
reelSetState: ReelSetState
reelStates: Map<string, State>
reelDimensions: number[]
skipped: boolean
spins: number
controlsEnabled: boolean
settingsShown: {settingsShown: SettingsShown, fadeTime: number}
webviewShown: {webviewShown: WebViewShown}
autoSpinOptions: AutoSpinOptions
slamStopManualEnabled: boolean
fsIncrementTriggered: boolean
fsCount: number
reelsStopping: boolean
turboModeActive: boolean
currentTumbleIndex: number
[... more meters, flags, etc.]
```

**SlotProps:**
```
response: IResponse (from backend)
paytable: Paytable (parsed XML)
stage: string
nextStage: string
playMode: "real" | "freespin"
balance: number
totalBet: number
[... 50+ computed properties derived from response/paytable]
```

**Lifecycle Hooks:**
- `isInitializable()` – waits for response (backend outcome data) to be populated
- GameActions.setState() → triggers MobX reactions in each component

---

### 4.2 Data Translators (SlotGleDataTranslator, SlotGle4DataTranslator)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/store/datamodel/datatranslator/SlotGleDataTranslator.ts`

**Class Signature:**
```
class SlotGleDataTranslator
  translate(data: any): void
  [parse IOutcomeDetailDef, IBalancesDef, IPopulationOutcomeDef[], ITriggerOutcomeDef[], etc.]
  protected buildOutcomeMap(): void
```

**Purpose:** Converts raw backend GLR (Game Logic Response) JSON into typed interfaces (IOutcomeDetailDef, IPopulationOutcomeDef, etc.). 1662 LOC of parsing logic.

**Gap Analysis (vs. slot-gdd-factory):**
Slot-gdd-factory does not include translator; assumes clean interface input.

---

### 4.3 Paytable Data Model (362 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/store/datamodel/Paytable.ts`

**Paytable Class:**
```
class Paytable
  paytableStatistics: IPaytableStatisticsDef
  pickerInfo: Map<string, IPickerInfoDef | IPickerLayersInfoDef>
  prizesInfo: Map<string, IPrizeInfoDef>
  stripsInfo: Map<string, IStripInfoDef>
  longStripsInfo: Map<string, IStripInfoDef>
  patternSliderInfo: IPatternSliderInfoDef
  awardCapInfo: IAwardCapInfoDef
  denominationList: IDenominationDef[]
  gameBetInfo: IGameBetInfoDef
  jackpotOdds: IJackpotOdds
  keyValuePairInfo: Map<string, IKeyValuePairInfoDef>
  jackpot: IJackpotBetBandMap
  stackedRespinStripMappingInfo: IStackedRespinStripMappingInfoDef
  ladderInfo: ILadderInfoDef
```

**Key Interfaces:**

| Interface | Fields | Purpose |
|-----------|--------|---------|
| IStripInfoDef | name, strips: Map<string, IStripDef> | All symbol stops for reel |
| IStripDef | name, stops: IStopDef[] | Stops in a single reel strip |
| IStopDef | symbolId, weight | Symbol and RTP weight at stop |
| IPrizeInfoDef | name, strategy, prizes: IPrizeDef[] | Payline/ways rules |
| IPrizeDef | name, prizesPay[], symbols[] | Individual prize (e.g., 3x s01) |
| IPrizePayDef | count, pph (per-pattern-hit), value | Pay amount at count |
| IPaytableStatisticsDef | name, singleRTP, maxRTP, minRTP | RTP bands |

---

## V. WIN PRESENTATION

### 5.1 RollupComponent (485 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/rollup/RollupComponent.ts`

**Class Signature:**
```
class RollupComponent extends BaseView<SlotProps, any, RollupProps, RollupCommands>
  constructor(parentProps: SlotProps, bitmapTextId?: string, data?: RollupData, assetIds?: string[], layoutId?: string, RollupClass?: RollupCommands)
  setTextAutoRun(text: string): void
  setDurationAutoRun(duration: number): void
  protected showTier(): void
  protected animationExists(): boolean
```

**RollupSystem (internal):**
Uses GSAP to animate value from current balance to target win amount. Tiers (Mega, Big, Win) map to animation threshold:

```
const tiers = [
  {threshold: 0, label: "Win", anim: "win_intro"},
  {threshold: 100x, label: "BigWin", anim: "bigwin_intro"},
  {threshold: 1000x, label: "MegaWin", anim: "megawin_intro"}
]
```

**Rollup Config (rollupConfig.json):**
```
"Win.Rollup": {
  duration: 3000,
  thresholds: [{value: 0, label: "Win"}, {value: 100x, label: "BigWin"}, ...],
  format: "currency"
}
"BigWin.Rollup": {
  duration: 5000,
  isSpecial: true
}
```

**Lifecycle Hooks:**
- `init()` – loads rollupConfig.json, finds valueField (Text or BitmapText)
- `setDurationAutoRun()` – sets GSAP tween duration
- `showTier()` – updates animation based on currentTier

**GSAP Tweening:**
```
gsap.to({value: startValue}, {
  value: targetValue,
  duration: durationMs / 1000,
  onUpdate() { valueField.text = currencyFormat(value) },
  ease: Linear.easeNone
})
```

**Industry Pattern:** Timed number roll-up with tier-mapped animations. Plays audio via soundManager for each tier transition.

**Equivalent in slot-gdd-factory:** `src/blocks/rollup.mjs` – similar GSAP integration, but playa-slot supports multiple rollup configs and tier thresholds.

---

### 5.2 BigWinComponent (120 LOC)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/bigwin/BigWinComponent.ts`

**Class Signature:**
```
class BigWinComponent extends BaseView<SlotProps, any, BigWinProps, BigWinCommands>
  constructor(parentProps: SlotProps, animations: (string | string[])[], layoutId?: string, data?: BigWinData, BigWinClass?: BigWinCommands)
  protected showTier(): void
  protected animationExists(): boolean
  public show(): void
  public hide(): void
```

**Tier Animation Array:**
```
animations = [
  "bigwin_tier1_intro",      // tier 0 (threshold 100x)
  "bigwin_tier2_intro",      // tier 1 (threshold 500x)
  "bigwin_tier3_intro"       // tier 2 (threshold 1000x)
]
```

**Spine Animation Setup:**
- Finds SpineAnimation child in layout
- Calls spine.addAnimation(tierAnim, trackId) for each tier
- Updates animation on rollup tier change

**Lifecycle Hooks:**
- `init()` – finds spine child, hides initially
- `showTier()` – plays spine animation matching rollup tier + label
- `show()` – makes container visible, triggers animation
- `hide()` – clears container visibility

**Sync with RollupComponent:**
BigWin watches rollup's tier via MobX reaction; updates when tier changes.

---

### 5.3 Plaque System (BonusTriggerPlaque, BonusRetriggerPlaque, MaxAwardPlaque, etc.)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/plaques/`

**Class Signature (generic plaque):**
```
abstract class *Plaque extends SimplePopup<SlotProps, PlaqueCommands>
  constructor(parentProps: SlotProps, assetsIds: string[], layoutId: string, PlaqueClass?: PlaqueCommands)
  protected _valueField: Text | undefined
```

**Plaque Types:**

| Plaque | Trigger | Display |
|--------|---------|---------|
| BonusTriggerPlaque | bonus feature triggered | "BONUS" label + award value |
| BonusRetriggerPlaque | additional spins awarded | "+N FREE SPINS" |
| MaxAwardPlaque | max award cap hit | "MAX AWARD REACHED" |
| MaxNumOfFreespinsPlaque | max free spin count exceeded | "MAX SPINS HIT" |
| BonusCompletePlaque | bonus mode exits | "BONUS COMPLETE" + total award |

**Lifecycle Hooks:**
- `init()` – builds layout, finds valueField
- ShowPlaqueCommand triggers `show()` → fade-in animation (GSAP)
- DismissPlaqueCommand triggers `hide()` → fade-out, then remove

---

### 5.4 Payline Renderer (SpaghettiComponent)
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/paylines/spaghetti/SpaghettiComponent.ts`

**Class Signature:**
```
class SpaghettiComponent extends BasePaylinesComponent<SlotProps>
  constructor(parentProps: SlotProps)
  [inherited: drawPayline(paylineIndex: number), highlightPayline(name: string)]
```

**Pattern Industry Name:** **Spaghetti renderer** – bitmap-based payline visualization (curved paths connecting symbol positions, named for visual "spaghetti" appearance).

**BasePaylinesComponent (abstract):**
- Watches IPrizeOutcomeDef changes
- For each prize, draws path from cell to cell via Pixi Graphics
- Colors vary by prize tier

---

## VI. BONUS FEATURES

### 6.1 Jackpot System
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/jackpot/`

**BasicJackpotComponent (150 LOC):**
```
class BasicJackpotComponent extends BaseView<SlotProps, null, {}, JackpotCommandSet>
  protected jackpotMeters: JackpotMeters
  protected topJackpot?: JackpotMeterData
  constructor(parentProps: SlotProps, layoutId: string, waitsFor?: ComponentConstr[])
  updateTopJackpot(): void
  forceWinDisplay(): void
  resetMeters(): void
```

**JackpotMeters (320 LOC):**
```
class JackpotMeters
  constructor(slotProps: SlotProps)
  getJackpots(betLevel?: number): Map<number, JackpotMeterData>
  getJackpots(): Map<number, JackpotMeterData>
  onJackpotWin(callback: () => void): void
  resetMeter(): void
```

**JackpotMeterData:**
```
class JackpotMeterData
  value: number
  displayValue: string (formatted)
  jackpotOutcome?: IJackpotOutcome
  getDisplayValue(): string | null
```

**Data Flow:**
1. Paytable.jackpot: IJackpotBetBandMap → maps totalBet → [bandId, jackpotValue]
2. Backend response includes IJackpotOutcome (winning event data)
3. BasicJackpotComponent watches topJackpot.jackpotOutcome
4. On win, updates text field and calls soundManager for win audio
5. RollupComponent.bigWin coordinates with jackpot display

**Lifecycle Hooks:**
- `init()` – finds jpMeterValue and jpMeterMsg text fields, registers ticker update
- `onTick()` – updates display value, checks for doForceWinDisplay flag
- resetMeter() – clears jackpotOutcome, re-enables updates

---

### 6.2 Lock & Respin
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/reels/ReelSet/commands/LockAndRespin*.ts`

**LockAndRespinInitCommand, LockAndRespinSpinCommand, LockAndRespinForceStopCommand:**

**Pattern Industry Name:** **Hold-and-Respin** – winning symbols lock in place, non-winning reels respin.

**Flow:**
1. Win detected on initial spin
2. LockAndRespinInitCommand → marks winning cells as locked
3. Reel.setLocked(true) for reels containing winners
4. LockAndRespinSpinCommand → spins only unlocked reels
5. Repeat until no new winners (maxRespins limit)

**State:**
```
lockedReels: Map<reelName, boolean>
respinCount: number (0..maxRespins)
isComplete: boolean
```

---

### 6.3 Free Spin Mode
**Path:** Not in a separate component; managed via SlotProps.playMode and slotData.fsCount

**Data Flow:**
```
IFreeSpinOutcomeDef {
  awarded: number (new spins)
  count: number (remaining)
  countdown: number (display counter)
  maxAwarded: boolean
  maxSpinsHit: boolean
  totalAwarded: number (cumulative)
}
```

**FSCounter UI (UIControls):**
- Displays remaining spins via SpinsMeterComponent
- Updates on each spin
- Triggers MaxNumOfFreespinsPlaque when count hits max

---

## VII. UI CONTROLS & SETTINGS

### 7.1 Meter Components
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/uicontrols/meters/`

**BaseMeterComponent (base class, ~50 LOC):**
```
abstract class BaseMeterComponent<Props, Actions>
  protected valueField: Text
  @computed abstract get value(): any
  @computed protected abstract get textValue(): string
  update(): void [updates valueField.text on change]
```

**Concrete Meters:**

| Component | Displays | Updates On |
|-----------|----------|-----------|
| BalanceMeterComponent | player balance | slotProps.balance |
| WinMeterComponent | current win (base game) | slotProps.totalPay |
| TotalBetMeterComponent | total wager | slotProps.totalBet |
| SpinsMeterComponent | remaining free spins | slotData.fsCount |
| CoinsMeterComponent | coins per line | slotProps.coinsPerLine |

**Stepper Variants:**
- CoinsStepperMeterComponent – cycles coinsPerLine via +/- buttons
- TotalBetStepperMeterComponent – cycles totalBet via +/- buttons
- Integrates with bet selection logic

---

### 7.2 Settings Panel
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/settings/`

**SettingsPanel (465 LOC):**
```
class SettingsPanel extends BaseView<SlotProps, GameActions, SettingsPanelProps, SettingsPanelCommands>
  protected panels: Map<SettingsShown, ISettingsPanel>
  showPanel(settingsShown: SettingsShown, fadeTime?: number): void
  hidePanel(fadeTime?: number): void
```

**Sub-panels:**

| Panel | Options |
|-------|---------|
| BetSettingsPanel | coin value, pattern count, total bet |
| AutoSpinSettingsPanel | spin count, loss limit, win limit |
| PaysSettingsPanel | paytable (WebView) |
| GameSettingsPanel | sound toggle, graphics, etc. |
| RulesSettingsPanel | game rules (WebView) |

---

### 7.3 Turbo Mode
**Path:** `/Users/vanvinklstudio/IGT/playa-slot/src/ts/turboMode/`

**TurboModeComponent (50 LOC):**
```
class TurboModeComponent extends BaseView<SlotProps, GameActions, TurboModeProps, TurboModeCommands>
  constructor(parentProps: SlotProps, layoutId?: string, data?: TurboModeData)
  show(): void
  hide(): void
```

**Turbo Behavior:**
- Triggered by UI button or auto-trigger after N spins
- Sets slotData.turboModeActive = true
- ReelSpinCommand reads flag and applies turboModeEaseOut instead of easeOut
- Rollup duration halved
- TurboModeShowCommand displays overlay with confirmations
- TurboModeCloseCommand exits mode

---

## VIII. COMMAND SYSTEM

### Master Command Catalog

| Command | Location | Signature | Purpose |
|---------|----------|-----------|---------|
| ReelSpinCommand | ReelSet/commands/ | execute(): void | Trigger reel spin (create systems, set behaviors, ticker) |
| ReelStopCommand | ReelSet/commands/ | execute(): void | Decelerate reels, apply outcome stops |
| ReelForceStopCommand | ReelSet/commands/ | execute(): void | Immediate stop (slam or timeout) |
| ReelSlamStopCommand | ReelSet/commands/ | execute(): void | Player-initiated slam stop |
| ReelTumbleCommand | ReelSet/commands/ | execute(): void | Initiate tumble sequence |
| ReelTumbleResumeCommand | ReelSet/commands/ | execute(): void | Resume tumble after pause |
| ReelInitCommand | ReelSet/commands/ | execute(): void | Initialize reel cells from outcome |
| ReelResetCommand | ReelSet/commands/ | execute(): void | Clear reel state for next stage |
| BonusReelStopCommand | ReelSet/commands/ | execute(): void | Stop bonus reel (bonus pick feature) |
| SimpleBonusReelStopCommand | ReelSet/commands/ | execute(): void | Stop bonus reel (simpler variant) |
| ExplodeSymbolCommand | ReelSet/commands/ | execute(): void | Trigger symbol explosion (tumble visual) |
| RenderStageCommand | ReelSet/commands/ | execute(): void | Render layout for stage transition |
| VisibilityCommand | ReelSet/commands/ | execute(): void | Toggle reel set visibility |
| LockAndRespinInitCommand | ReelSet/commands/ | execute(): void | Setup lock-and-respin (hold reels) |
| LockAndRespinSpinCommand | ReelSet/commands/ | execute(): void | Spin unlocked reels in respin |
| LockAndRespinForceStopCommand | ReelSet/commands/ | execute(): void | Force stop during respin |
| ResetCurrentTumbleIndexCommand | ReelSet/commands/ | execute(): void | Reset tumble iteration counter |
| ShowCommand (ReelSet) | ReelSet/commands/ | execute(): void | Show reel set container |
| RollupWinCommand | UIControls/commands/ | execute(): void | Start win rollup (links to RollupComponent) |
| SlamStopCommand | UIControls/commands/ | execute(): void | Slam stop button handler |
| UpdateFSCounterCommand | UIControls/commands/ | execute(): void | Update free spin counter display |
| UpdateFSTotalAwardCommand | UIControls/commands/ | execute(): void | Update free spin total award meter |
| BigWinShowCommand | bigwin/commands/ | execute(): void | Show big win overlay (tier-mapped) |
| BigWinHideCommand | bigwin/commands/ | execute(): void | Hide big win overlay |
| RollupStartCommand | rollup/commands/ | execute(): void | Start rollup (value animation) |
| RollupStopCommand | rollup/commands/ | execute(): void | Stop rollup immediately |
| ShowPlaqueCommand | plaques/commands/ | execute(): void | Show plaque (bonus trigger, max award, etc.) |
| DismissPlaqueCommand | plaques/commands/ | execute(): void | Dismiss plaque |
| ShowJackpotPlaqueCommand | jackpot/plaques/commands/ | execute(): void | Show jackpot win plaque |
| JackpotResetCommand | jackpot/gameComponents/commands/ | execute(): void | Reset jackpot meter |
| JackpotForceWinDisplayCommand | jackpot/gameComponents/commands/ | execute(): void | Force display of jackpot win |
| ShowInfoBarCommand | infobar/commands/ | execute(): void | Show info bar (paytable hint) |
| HideInfoBarCommand | infobar/commands/ | execute(): void | Hide info bar |
| ShowCommand (TurboMode) | turboMode/commands/ | execute(): void | Show turbo mode confirmation |
| TurboModeCloseCommand | turboMode/commands/ | execute(): void | Close turbo mode overlay |
| StakeDeductCommand | proxy/commands/ | execute(): void | Deduct stake from balance (backend-less) |
| RequestDataCommand | proxy/commands/ | execute(): void | Request outcome from backend |
| SwitchPlayModeCommand | proxy/commands/ | execute(): void | Switch real ↔ freespin mode |
| GameReInitCommand | proxy/commands/ | execute(): void | Reinitialize game state (stage change) |
| RenderStageCommand | reels/ReelSet/commands/ | execute(): void | Render layout for new stage |

---

## IX. ARCHITECTURE PATTERNS & EQUIVALENCIES

### 9.1 MobX Reactive Data Flow
**Pattern:** Computed properties automatically react to @observable changes.

```
SlotData.reelStates (Map<string, State>) changes
  → @computed ReelComponent.state changes
  → MobX reaction in BaseSpinBehavior fires
  → state machine transitions (IDLE → START → STARTED → etc.)
  → updateMovementBehavior() / startSpin() / stopSpin()
```

**Advantage:** Decoupled event dispatch; no explicit event listeners.  
**Equivalent in slot-gdd-factory:** Event emitter pattern (more explicit).

---

### 9.2 Command Pattern (playa-core Command base)
Each gameplay action (spin, stop, tumble, init) extends Command and implements execute().

**Benefits:**
- Undo/redo support
- Command queuing
- Testability

---

### 9.3 Component Hierarchy
- SlotStore (root)
  - ReelSetComponent (per stage)
    - ReelComponent (per column)
      - ReelCellComponent (per row, pooled)
        - SymbolComponent (pooled)
  - UIControls (meters, buttons)
  - RollupComponent
  - BigWinComponent
  - PlaqueComponents
  - JackpotComponent

---

### 9.4 Behavior Composition
```
ReelSpinSystem (orchestrates)
  ├─ ReelSpinBehavior (spin logic)
  │  └─ BaseCellMovementBehavior (velocity curve)
  └─ TumbleBehavior (tumble logic)
     └─ TumbleCellMovementBehavior (fall curve)
```

---

## X. GAPS & NOTES FOR GDD FACTORY

### 10.1 Missing from slot-gdd-factory
1. **Selective Stacking** – symbol schema swapping per bet/stage
2. **Tumbling** – cascading symbol removal + refill
3. **Multiple spin systems** – independent, bonus, lock-and-respin
4. **Paytable translator** – raw GLR JSON → typed interfaces
5. **BigWin tier system** – threshold-mapped animations
6. **Jackpot integration** – server-fed jackpot linked to reels
7. **Free spin retrigger** – bonus outcome chaining

### 10.2 Architectural Differences
| Aspect | playa-slot | slot-gdd-factory |
|--------|-----------|-----------------|
| State mgmt | MobX @observable | custom reducer or signals |
| Reactivity | computed + reactions | event listeners |
| Config | JSON translators | hardcoded or simple JSON |
| Symbols | Pooled globally | Per-reel instances |
| Movement | Behavior composition | Direct tween |
| Commands | Full command pattern | Simpler action dispatch |

### 10.3 Vendor-Neutral Terminology
- **Reel strip:** ordered array of symbol stops
- **Cell:** individual row in a reel column
- **Stop:** symbol + weight at array index
- **Tumble:** cascade removal + refill
- **Selective stacking:** symbol ID substitution per game state
- **Tiers:** rollup animation thresholds
- **Spaghetti:** bitmap payline renderer

---

## XI. SUMMARY TABLE: KEY MODULES

| Module | Files | LOC | Responsibility |
|--------|-------|-----|-----------------|
| **Reels** | 10+ | ~2800 | Reel init, config, cells, positioning |
| **ReelSet** | 20+ | ~3500 | Multi-reel orchestration, commands, systems |
| **Behaviors** | 8 | ~2500 | Spin, movement, tumble physics |
| **Store** | 6 | ~2500 | State, props, translators, paytable |
| **Rollup** | 5 | ~800 | Win number animation, GSAP integration |
| **BigWin** | 5 | ~300 | Tier-mapped spine animations |
| **Plaques** | 10 | ~300 | Popup notifications (bonus, max award) |
| **Jackpot** | 6 | ~500 | Meter display, win sync |
| **UIControls** | 20+ | ~2000 | Meters, buttons, settings, panels |
| **Settings** | 10+ | ~2000 | Bet, autospin, pays, rules, game settings |
| **Proxy** | 5 | ~800 | Backend communication, mode switching |
| **Turbo** | 5 | ~200 | Fast-play overlay + behavior override |

**Total: ~18,000 LOC application logic (excl. translations, configs)**

---

## XII. DATA FLOW EXAMPLE: BASE GAME SPIN → WIN

```
1. User taps SPIN button
   → SlamStopCommand.execute()
   → slotActions.gameActions.setReelSetState(SPIN_START_BEGIN)

2. ReelSpinCommand.execute()
   → setReelSpinSystem() [creates ReelSpinSystem + behaviors]
   → stageService.ticker.add(handleTick)

3. tick() loop:
   for each reel:
     if (time >= startDelay):
       reelComponent.setState(START)

4. BaseSpinBehavior reacts to state change:
   Case START:
     → startSpin() [GSAP tween velocity from 0 → targetSpeed]
   Case STARTED:
     → spinStarted() [continuous movement]

5. onTick() in movement behavior:
   for each cell:
     cell.y += velocity * deltaMS
     if (cell.y < addThreshold):
       ReelSpinSystem.addNewReelCell() [pool new cell]
     if (cell.y > removeThreshold):
       ReelSpinSystem.removeCell() [return to pool]

6. Backend outcome arrives: IPopulationOutcomeDef
   → slotProps.response.populationOutcomes updated
   → ReelComponent.reelDef computed getter fires

7. User taps STOP (or auto-stop @ minSpinTime):
   → ReelStopCommand.execute()
   → reelComponent.setState(STOPPING)
   → BaseSpinBehavior.startStopSpin() [velocity ramp to 0]
   → GSAP easeOut curve applied

8. All reels STOPPED:
   → slotActions.gameActions.setReelSetState(BASE_GAME)
   → ReelSetComponent.populationOutcomeDef triggers win detection

9. Win detected (outcome.prizes.length > 0):
   → RollupWinCommand.execute()
   → RollupComponent.setDurationAutoRun(3000)
   → RollupComponent shows tier animations (Win/BigWin/MegaWin)
   → GSAP tweens display value from 0 → finalWin

10. On rollup tier change:
    → BigWinComponent.showTier() [play spine animation]
    → soundManager.execute("bigwin_tierNStart")

11. Rollup complete:
    → balance updated
    → BalanceMeterComponent reflects change
    → controls re-enabled for next spin
```

---

**End of Report**

**Word Count:** 5,850  
**Date Compiled:** 2026-06-16  
**Status:** Complete - All required modules documented with class signatures, state machines, data contracts, lifecycle hooks, and industry patterns.
