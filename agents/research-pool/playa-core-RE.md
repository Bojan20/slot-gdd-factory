# Playa-Core Reverse Engineering Report

**Date**: 2026-06-16  
**Version**: 3.2.0-dev.48  
**Repository**: /Users/vanvinklstudio/industry standard/playa-core  
**Framework**: industry standard Unified Game Framework (TypeScript + PIXI.js + MobX)

---

## Executive Summary

Playa-Core is a sophisticated TypeScript framework for building interactive slot games and related gambling applications. It implements a component-based architecture with reactive state management (MobX), a command/sequence pattern for game flow orchestration, and a sophisticated asset loading pipeline. The framework is heavily integrated with industry's IXF (Interchange Framework) for server communication and supports both PIXI rendering (2D) and Three.js (3D) backends.

**Key Architectural Patterns**:
- Observer pattern (MobX reactions)
- Command pattern (Command/Sequencer)
- Factory pattern (LayoutBuilder, Loaders)
- Singleton pattern (SoundManager, SystemStore)
- Service locator pattern (SystemStore as service registry)

---

## 1. Sequencer Layer (Command Pattern & Game Flow Control)

### 1.1 File Map

```
src/ts/sequencer/
├── commands/
│   ├── Command.ts                    (158 lines)
│   ├── CommandSet.ts                 (15 lines)
│   ├── CommandsGetter.ts
│   └── ICommand.ts
├── gameflow/
│   ├── GameFlow.ts                   (44 lines)
│   ├── SequencerGameFlow.ts           (168 lines)
│   ├── AsyncGameFlow.ts
│   ├── GameFlowManager.ts
│   ├── GeneratorGameFlow.ts
│   ├── SideEffectsFlow.ts
│   ├── TransitionFlow.ts
│   └── GeneratorSideEffectsFlow.ts
├── sequences/
│   ├── SequenceDefinition.ts          (400+ lines)
│   ├── SequenceStep.ts
│   └── GeneratorSequenceStep.ts
├── GeneratorSequencer.ts
└── Sequencer.ts                      (369 lines)
```

### 1.2 Public API

**ICommand Interface** (`sequencer/commands/ICommand.ts:6`):
```typescript
interface ICommand<P = undefined, R = undefined> {
  completed: Promise<R | undefined>;
  state: CommandState;
  execute(): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}
```

**CommandState Enum** (`sequencer/commands/Command.ts:6`):
```typescript
enum CommandState {
  IDLE, STARTED, FINISHED, CANCELLED, PAUSED
}
```

**Command Base Class** (`sequencer/commands/Command.ts:21`):
```typescript
abstract class Command<P = undefined, R = undefined> 
  implements ICommand<P, R> {
  execute(): void; cancel(): void;
  pause(): void;  resume(): void;
  get state(): CommandState;
  get completed(): Promise<R | undefined>;
}
```

**CommandSet Type** (`sequencer/commands/CommandSet.ts:4`):
```typescript
type CommandSet = { [key: string]: (...args) => Command<any, any> } | null;

class BaseCommandSet<P, R = undefined> {
  [key: string]: (...pl) => Command<[P, ...any[]], R>;
  constructor(data: P) {}
}
```

**SequenceDefinition** (`sequencer/sequences/SequenceDefinition.ts:27`):
- Declarative builder for command sequences
- Supports nesting, conditional execution, parallel groups
- Configuration: `blocking` ("all"|"race"), `skippable`, `condition`
- Methods: `.do(command)`, `.start(config)`, `.end()`, `.condition(fn)`

**SequencerGameFlow** (`sequencer/gameflow/SequencerGameFlow.ts:7`):
- Extends `GameFlow`
- Defines 14+ IXF state handlers as `SequenceDefinition` returns
- States: onStartGameInitial, onBeforeShowStage, onBeforeRequest, onMakeRequest, onResolveStage, onExitStage, onEnterNextStage, etc.

### 1.3 State Machine

**Command Lifecycle**:
```
IDLE → STARTED → FINISHED
         ↘ PAUSED ↗
         ↘ CANCELLED ↗
```

**Sequence State Machine** (`sequencer/sequences/SequenceDefinition.ts:7`):
```
IDLE → STARTED → FINISHED
         ↗ PAUSED ↙
```

**IXF Game Flow States** (14 state handlers):
- `onStartGameInitial` - Game announced at start
- `onBeforeShowStage` - Presentation setup
- `onBeforeRequest` - Bet controls disabled, preparation
- `onMakeRequest` - Construct & send request to server
- `onResolveStage` - Post-response presentation (reels stop)
- `onExitStage` - Exit current stage
- `onEnterNextStage` - Enter next stage
- `onInProgressStage` - Existing game in progress
- `onJackpot` - Jackpot triggered
- `onEndGame` - Game end
- `onBeginNewGame` - Begin new game

### 1.4 Architectural Patterns

**Command Pattern**: Classic Gang of Four implementation. Each command encapsulates a request as an object, supporting cancellation, pause/resume. Implementation: `Command.ts:21-150` uses lifecycle promise pattern. Commands are created externally, executed via `.execute()`, and completion tracked via `.completed` promise.

**Composite Pattern**: `SequenceDefinition` forms composite sequences. Sequences contain `SequenceStep` wrappers and nested `SequenceDefinition`s, creating tree structures. See `SequenceDefinition.ts:97-100` `.start()` method.

**State Machine Pattern**: Both `Command` and `SequenceDefinition` implement explicit state machines with enum-based states and guard conditions on transitions (`Command.ts:61-87`).

**Builder Pattern**: `SequenceDefinition` uses fluent API—`.do()`, `.start()`, `.end()` return `this` for chaining (`SequenceDefinition.ts:88-91`).

### 1.5 Slot Relevance

**Direct applicability**: Sequences are ideal for orchestrating spin animations, win presentations, and multi-phase bonus rounds. Example: define a spin as nested sequences—spin-up, spin-main, spin-down, win-presentation—with conditional branching on outcome.

**Concretely**: `blocking: "all"` waits for parallel groups (e.g., multiple reels spinning simultaneously), `blocking: "race"` triggers on first completion (e.g., fastest animation). Skippable sequences let players skip intros.

### 1.6 Lines of Code Summary

| File | LOC |
|------|-----|
| Sequencer.ts | 369 |
| SequenceDefinition.ts | 400+ |
| Command.ts | 158 |
| SequencerGameFlow.ts | 168 |
| CommandSet.ts | 15 |
| **Subtotal** | **~1,110** |

---

## 2. Component Layer (MobX-Based Reactive Components)

### 2.1 File Map

```
src/ts/component/
├── store/
│   ├── BaseStore.ts                  (123 lines)
│   └── IBaseStore.ts
├── view/
│   ├── BaseView.ts                   (302 lines)
│   ├── IBaseView.ts
│   └── ViewData.ts
├── service/
│   ├── BaseService.ts
│   └── IBaseService.ts
├── action/
│   ├── BaseAction.ts                 (64 lines)
│   ├── IBaseAction.ts
│   └── Actions.ts
├── props/
│   ├── IBaseProps.ts
├── initialization/
│   ├── InitializationManager.ts
│   ├── InitializationState.ts
│   ├── IInitializationActor.ts
│   └── actor/
│       └── ComponentDependencyActor.ts
├── react/
│   ├── pixi/
│   │   ├── IReactPixi.ts
│   │   └── ReactPixi.ts
│   ├── dom/
│   │   ├── IReactDOM.ts
│   │   └── ReactDOM.ts
├── ParentDef.ts
├── IComponent.ts
└── ComponentTypes.ts
```

### 2.2 Public API

**BaseStore** (`component/store/BaseStore.ts:14`):
```typescript
class BaseStore<PP, PA extends BaseAction<any> | null, P, A extends Actions, D>
  implements IComponent<P>, IBaseStore<A> {
  get props(): P;
  get actions(): A;
  get initialized(): boolean;
  protected isInitializable(): boolean;
  protected async init(): Promise<void>;
}
```

**BaseView** (`component/view/BaseView.ts:38`):
```typescript
class BaseView<PP, PA extends BaseAction | null = null, P = {}, C extends CommandSet | null = null>
  implements IComponent<P>, IBaseView<C> {
  assetIds: string[];
  layoutId: string;
  optionalElement: boolean;
  get props(): P;
  get commands(): C;
}
```

**BaseAction** (`component/action/BaseAction.ts:10`):
```typescript
class BaseAction<D> implements IBaseAction<D> {
  constructor(data: D);
  protected log(called: string, params: string): void;
}
```

**BaseService** (`component/service/BaseService.ts`):
- Extends `BaseStore`
- Public API surface for system-level services
- Registered in `SystemStore` and accessible via service locator

**IComponent Interface** (`component/IComponent.ts`):
```typescript
interface IComponent<P> {
  readonly type: ComponentTypes;
  readonly props: P;
  readonly initialized: boolean;
  readonly assetIds?: string[];
  readonly layoutId?: string;
  dependencies: ComponentConstr[];
}
```

### 2.3 State Machine

**Component Initialization State Machine** (`component/initialization/InitializationState.ts`):
```
IDLE → INITIALIZING → INITIALIZED
```

Component transitions to `INITIALIZED` when:
1. All `dependencies` (other components) are initialized
2. All `assetIds` are loaded
3. `layoutId` element exists in layout tree
4. `isInitializable()` returns true (subclass hook)

### 2.4 Architectural Patterns

**Observer Pattern (MobX)**: All state is observable (`@observable`), reactions auto-trigger on mutation. `BaseStore.ts:45-52` uses `when()` to trigger initialization. Reactive computations `@computed` automatically track dependencies.

**Dependency Injection**: Constructor takes parent, props, actions, data. `ParentDef.ts` wraps parent's props and actions for child access.

**Template Method**: `BaseStore.init()` and `BaseView.init()` are template methods—subclasses override to provide initialization logic.

**Property Pattern**: All data exposed via `.props` getter (read-only from child's perspective). Modification only via `.actions`.

### 2.5 Slot Relevance

Games build custom stores (e.g., `SpinStore extends BaseStore<SystemProps, GameActions, SpinProps, SpinActions, SpinData>`) to hold spin state: current reel positions, win state, balance. BaseView descendants wrap PIXI containers for reel rendering.

Dependency system ensures reels only render after texture atlas loads: `new ReelView(..., assetIds: ["atlas@1x"], layoutId: "reelStrip")`.

### 2.6 Lines of Code Summary

| File | LOC |
|------|-----|
| BaseView.ts | 302 |
| BaseStore.ts | 123 |
| BaseAction.ts | 64 |
| **Subtotal** | **~489** |

---

## 3. Stage Layer (Canvas, Renderer, Container Hierarchy)

### 3.1 File Map

```
src/ts/stage/
├── StageComponent.ts                 (179 lines)
├── StageService.ts
├── IStage.ts
├── StageProps.ts
├── StageData.ts
├── FitDimension.ts
└── OffscreenRendererService.ts
```

### 3.2 Public API

**Stage/StageComponent** (`stage/StageComponent.ts:12`):
```typescript
class Stage implements IStage {
  readonly id: string;
  get gameContainer(): Container;
  get background(): Container;
  fit(containerWidth, containerHeight, orientation): void;
  registerReactions(): void;
}
```

**FitDimension** (`stage/FitDimension.ts`):
- Enum: `CONTAIN`, `COVER`, `WIDTH`, `HEIGHT`
- Controls canvas sizing strategy

**OffscreenRendererService** (`offscreen-renderer/OffscreenRendererService.ts`):
- Manages off-screen rendering via WebGL FrameBuffer
- Used for texture capture, effects rendering

### 3.3 State Machine

The Stage itself is not stateful; its reactive `fit()` method is triggered by `autorun()` on dimension changes:

```
Stage created → registerReactions() → autorun(fit) 
→ [whenever dimensions/orientation change] → re-render
```

### 3.4 Architectural Patterns

**Facade Pattern**: `Stage` wraps PIXI's `Application`, `Renderer`, `Ticker` into unified interface.

**Observer Pattern (MobX)**: `autorun()` in `registerReactions()` reacts to `.props.width`, `.props.height`, `.props.preOrientation` changes—automatically re-fitting stage (`stage/StageComponent.ts:74`).

**Container Pattern**: Two-tier container hierarchy:
- `backgroundContainer` - scaled separately (bleed/overscan)
- `gameContainer` - main play area

### 3.5 Slot Relevance

Stage manages canvas rendering context. Multi-orientation support (landscape/portrait swap) is critical for mobile slots—stage automatically reflows on device rotation via `Orientation` enum. Dimensions drive all child layouts.

### 3.6 Lines of Code Summary

| File | LOC |
|------|-----|
| StageComponent.ts | 179 |
| **Subtotal** | **~179** |

---

## 4. Layout Layer (Declarative UI Tree, Orientation Swap)

### 4.1 File Map

```
src/ts/layout/
├── LayoutService.ts                  (411 lines)
├── LayoutBuilder.ts                  (1,204 lines)
├── LayoutData.ts
├── LayoutProps.ts
├── ILayoutNode.ts
├── Orientation.ts
├── SkipUpdateTransforms.ts
├── layoutProps.ts
└── actions/
    ├── LayoutServiceActions.ts
    └── LayoutActions.ts
```

### 4.2 Public API

**ILayoutNode Hierarchy** (`layout/ILayoutNode.ts`):
```typescript
interface ILayoutNode {
  id: string;
  x: number; y: number;
  width: number; height: number;
  rotation: number; scaleX: number; scaleY: number;
  alpha: number; blendMode?: string;
  name: string; type: string;
}

interface IGroupNode extends ILayoutNode { children: ILayoutNode[] }
interface ILayerNode extends ILayoutNode { texture: string }
interface ISpineNode extends ILayoutNode { spineData: string; skin?: string }
interface IBitmapLabelNode extends ILayoutNode { 
  font: string; text: string; fontSize: number 
}
interface IParticlesNode extends ILayoutNode { 
  config: string; maxParticles: number 
}
```

**LayoutBuilder** (`layout/LayoutBuilder.ts:72`):
- Static factory for node instantiation
- Supports 12+ node types:
  ```typescript
  static assetTypes = {
    GROUP, STATIC_SPRITE, ANIM_SPRITE, ANIM_SPINE,
    VIDEO, PARTICLES, TEXT, BITMAP_TEXT, CURVED_TEXT,
    HIT_AREA, MASK, ALPHA_MASK
  }
  ```

**LayoutService** (`layout/LayoutService.ts:26`):
```typescript
class LayoutService extends BaseService<SystemProps, LayoutActions, LayoutProps>
  implements IInitializationActor {
  buildLayout(node: ILayoutNode, parent: Container): void;
  getElement(id: string): DisplayObject | null;
}
```

**Orientation** (`layout/Orientation.ts`):
```typescript
enum Orientation {
  LANDSCAPE = 0,
  PORTRAIT = 1
}
```

### 4.3 State Machine

**Layout Loading State**:
```
Initialize → Load fonts → Load layout JSON (landscape/portrait)
→ Load spine atlas (if any) → Build PIXI DisplayObject tree
```

Lazy loading trigger at `onBeforeShowStage` IXF state (`LayoutService.ts:73-88`).

### 4.4 Architectural Patterns

**Factory Pattern**: `LayoutBuilder.buildNode()` is static factory—dispatches on node type to create appropriate PIXI objects (Sprite, BitmapText, Spine, Particles, etc.). See `LayoutBuilder.ts:200-300` (estimated based on file size).

**Composite Pattern**: `IGroupNode` recursively contains children `ILayoutNode`s, building DOM-like tree.

**Strategy Pattern**: Orientation swap uses strategy—landscape vs. portrait layouts loaded conditionally based on device dimensions.

### 4.5 Slot Relevance

Layout system is **critical** for slot machine UI. All visual elements (reels, buttons, jackpot displays, free spin counters) are positioned via declarative JSON layout files. Orientation swap automatically handles portrait/landscape by loading separate layout configurations.

Example: A reel strip is a GROUP containing 5 LAYERs (texture IDs), positioned at (x, y) with rotation/scale. During spin, Sequencer commands rotate the group container.

### 4.6 Lines of Code Summary

| File | LOC |
|------|-----|
| LayoutBuilder.ts | 1,204 |
| LayoutService.ts | 411 |
| **Subtotal** | **~1,615** |

---

## 5. Loader Layer (Asset Pipeline, Texture Atlas, Spine, Sound)

### 5.1 File Map

```
src/ts/loader/
├── LoaderService.ts                  (391 lines)
├── LoaderData.ts
├── LoaderProps.ts
├── ResourceManager.ts
├── SubLoader.ts
├── loaders/
│   ├── IResourceLoader.ts
│   ├── IndexLoader.ts
│   ├── SpriteLoader.ts               (texture atlas)
│   ├── SpineLoader.ts                (skeletal animation)
│   ├── FontLoader.ts                 (web fonts)
│   ├── BitmapFontLoader.ts           (bitmap fonts)
│   ├── VideoLoader.ts
│   ├── VectorLoader.ts
│   ├── BlobLoader.ts
│   ├── CSSLoader.ts
│   └── GlTFLoader.ts                 (3D models)
└── actions/
    └── ResourceLoaderActions.ts
```

### 5.2 Public API

**LoaderService** (`loader/LoaderService.ts:35`):
```typescript
class LoaderService extends BaseService<SystemProps, LoaderActions, LoaderProps>
  implements IInitializationActor {
  has(assetId: string): boolean;
  get(assetId: string): Promise<any>;
  getTexture(assetId: string): Texture;
  getSpineData(assetId: string): SkeletonData;
}
```

**IResourceLoader Interface** (`loader/loaders/IResourceLoader.ts`):
```typescript
interface IResourceLoader {
  canHandle(id: string): boolean;
  load(id: string, url: string): Promise<any>;
  onComplete(resource: any): void;
}
```

**Resource Loaders**:
- **SpriteLoader**: Loads texture atlases (JSON array or Pixi bitmap sheet)
- **SpineLoader**: Loads Spine skeletal animation assets (.atlas + .json + .png)
- **FontLoader**: Web font loading via FontFaceObserver
- **BitmapFontLoader**: Bitmap fonts (.fnt + .png)
- **VideoLoader**: Video element loading
- **GlTFLoader**: Three.js glTF 3D model loading

### 5.3 State Machine

**Asset Loading Pipeline**:
```
Index loaded (manifest.json)
    ↓
[Parallel] For each asset:
  Prime phase (critical assets)
    ↓
  SubLoader trigger
    ↓
  Lazy load phase (secondary assets)
    ↓
Complete
```

`LoaderService.ts:73-76` manages `_isPrimeFilePhase` flag and `_primesComplete` flag.

### 5.4 Architectural Patterns

**Factory Pattern**: `ResourceManager.addLoader()` registers loader strategies. Dispatch via `canHandle()` checks.

**Strategy Pattern**: Each loader implements `IResourceLoader`—different strategies for textures, fonts, spine, video, etc.

**Lazy Initialization**: Secondary loaders created on-demand via `createSubLoader()` (`LoaderService.ts:98`).

**Promise-Based Async**: All loaders return `Promise<T>`, enabling `.has()` / `.get()` peek-ahead without blocking.

### 5.5 Slot Relevance

**Texture Atlas Loading**: Critical for performance. Rather than individual PNG files per symbol/button, atlases pack hundreds of textures into one file. Loader handles @ 1x/@2x/@4x variants via `INITIAL_ASSET_SUFFIX = "@1x"` (`LoaderService.ts:39`).

**Spine Skeletal Animation**: Bones-based animations for smooth reel spin, character animations, bonus sequences. Loader validates and caches `.atlas` and `.json` data.

**Lazy Loading**: First scene loads prime assets (paytable, buttons, reels). Secondary loader waits until `onBeforeShowStage` to load bonus assets, progressive loading for large games.

### 5.6 Lines of Code Summary

| File | LOC |
|------|-----|
| LoaderService.ts | 391 |
| LayoutBuilder.ts (listed above) | — |
| **Subtotal** | **~391** |

---

## 6. Rendering Layer (PIXI Views, Animations, Particles, 3D)

### 6.1 File Map

```
src/ts/rendering/
├── animation/
│   ├── IAnimation.ts                 (30 lines)
│   ├── BitmapAnimation.ts
│   ├── SpineAnimation.ts
│   └── VideoAnimation.ts
├── button/
│   ├── Button.ts                     (290 lines)
│   ├── Checkbox.ts
│   └── react/
│       └── api/
│           └── ButtonProps.ts
├── particles/
│   ├── ParticleEmitter.ts
│   ├── FastParticleEmitter.ts
│   └── react/
│       └── EmitterController.ts
├── threeDView/
│   ├── ThreeDView.ts
│   ├── api/
│   │   ├── CameraParams.ts
│   │   └── LightParameters.ts
│   └── react/
│       ├── ThreeDViewWrapper.ts
│       └── GLTFModel.ts
├── react/
│   └── SpineAnimation.tsx
├── BitmapTextOverrides.ts
└── [various style/config files]
```

### 6.2 Public API

**IAnimation Interface** (`rendering/animation/IAnimation.ts:5`):
```typescript
interface IAnimation {
  isPlaying: boolean;
  animationSpeed: number;
  play(): void;
  pause(): void;
  stop(): void;
}
```

**Animation Implementations**:
- **BitmapAnimation**: Sprite sheet frame-by-frame
- **SpineAnimation**: Skeletal animation (via pixi-spine)
- **VideoAnimation**: HTML5 video playback

**Button** (`rendering/button/Button.ts:19`):
```typescript
class Button extends Container {
  enabled: boolean;
  multiTouch: boolean;
  protected _defaultStateSprite: DisplayObject;
  protected _disabledStateSprite: DisplayObject;
  protected _pressedStateSprite: DisplayObject;
  protected _mouseOverStateSprite: DisplayObject;
}
```
Button states: `enabled`, `disabled`, `pressed`, `over`.

**ParticleEmitter** (`rendering/particles/ParticleEmitter.ts`):
- Wraps `@pixi/particle-emitter`
- Configurable via JSON config (gravity, lifetime, speed, etc.)
- Alternative: `FastParticleEmitter` (optimized for many particles)

**ThreeDView** (`rendering/threeDView/ThreeDView.ts`):
- Three.js scene wrapper
- Supports glTF model loading via `GlTFLoader`
- Camera & lighting parameters

### 6.3 State Machine

**Animation State Machine**:
```
IDLE → PLAYING → PAUSED (optional)
       ↘ STOPPED (reset to frame 0)
```

**Button State Machine**:
```
ENABLED ↔ DISABLED
  ↓
OVER → PRESSED → RELEASED
       ↘ OUT ↙
```

### 6.4 Architectural Patterns

**Adapter Pattern**: `SpineAnimation`, `BitmapAnimation` adapt pixi-spine and frame-based PIXI APIs to common `IAnimation` interface.

**State Pattern**: `Button` maintains state enum `buttonStates` and dispatches visibility based on state.

**Composite Pattern**: `ParticleEmitter` composes `@pixi/particle-emitter` internally.

### 6.5 Slot Relevance

**Button Behavior**: State-driven button UI (enabled/disabled/pressed) is standard for spin buttons, max-bet, autoplay. Multi-touch support allows simultaneous button presses (e.g., bet up/down held together).

**Animations**: Reels spin via continuous `SpineAnimation` or discrete frame `BitmapAnimation`. Win animations (coins, lights) use `ParticleEmitter` for scalability.

**3D Rendering**: High-end games use `ThreeDView` for glTF 3D models (e.g., animated slot machine cabinet, immersive environments).

### 6.6 Lines of Code Summary

| File | LOC |
|------|-----|
| Button.ts | 290 |
| IAnimation.ts | 30 |
| **Subtotal** | **~320** |

---

## 7. Sound Layer (Howler Integration, Sound Sprites)

### 7.1 File Map

```
src/ts/sound/
├── SoundManager.ts                   (144 lines)
├── SoundSprite.ts
├── ISoundPlayer.ts
├── ISoundSprite.ts
├── HowlerSoundPlayer.ts              (Howler.js wrapper)
└── actions/
    └── SoundActions.ts
```

### 7.2 Public API

**SoundManager** (`sound/SoundManager.ts:7`) - **Singleton**:
```typescript
class SoundManager {
  static getInstance(): SoundManager;
  set player(value: ISoundPlayer);
  get player(): ISoundPlayer;
  toggleAllSounds(enable: boolean): void;
  togglePause(pause: boolean): void;
  getTags(): string[];
  playSound(id: string): void;
  stopSound(id: string): void;
  setVolume(id: string, volume: number): void;
}
```

**ISoundPlayer Interface** (`sound/ISoundPlayer.ts`):
```typescript
interface ISoundPlayer {
  logger?: Logger;
  playSound(id: string, data: any): void;
  stopSound(id: string): void;
  setVolume(id: string, volume: number): void;
  getTags(hidden?: string[]): string[];
  toggleAllSounds(enable: boolean): void;
  togglePause(pause: boolean): void;
  setCustomSounds(sounds: any[]): void;
}
```

**SoundSprite** (`sound/SoundSprite.ts`):
- Howler.js Sprite object wrapper
- Maps string IDs to time offsets within audio file
- Efficient: pack 50+ sound effects in one .mp3 file

### 7.3 State Machine

SoundManager is **stateless**—delegate all behavior to pluggable `ISoundPlayer`:

```
SoundManager.getInstance()
  → set player(new HowlerSoundPlayer(...))
  → playSound(id) → player.playSound()
```

### 7.4 Architectural Patterns

**Singleton Pattern**: `SoundManager._soundManagerInstance` private static, enforced via constructor error (`sound/SoundManager.ts:24-26`).

**Adapter Pattern**: `HowlerSoundPlayer` adapts Howler.js to `ISoundPlayer` interface.

**Strategy Pattern**: Game can inject custom `ISoundPlayer` (e.g., silent player for testing, platform-specific player).

### 7.5 Slot Relevance

Sound effects are integral to slot feedback—spin sounds, reel stops, win jingles. Sound sprites reduce HTTP requests; volume control per-effect enables dynamic adjustment (mute free spins, max volume on big win).

### 7.6 Lines of Code Summary

| File | LOC |
|------|-----|
| SoundManager.ts | 144 |
| **Subtotal** | **~144** |

---

## 8. Proxy Layer (IXF Integration, Server Communication)

### 8.1 File Map

```
src/ts/proxy/
├── IXFProxyService.ts                (223 lines)
├── IXFProxyComponent.ts              (IXF interface)
├── IXFChannelManager.ts              (Postal channels)
├── IXFProxyControls.ts
├── commands/
│   └── PublishStateChangeReplyCommand.ts
└── dataModel/
    ├── IGameConfig.ts
    ├── KernelInitData.ts
    └── IDataTranslator.ts
```

### 8.2 Public API

**IXFProxyService** (`proxy/IXFProxyService.ts:33`):
```typescript
class IXFProxyService extends BaseService<SystemProps, ProxyActions, { system: SystemProps }> {
  setPaytable(paytableResponse: object): void;
  setCurrency(currencyResponse: object): void;
  setGameConfig(gameConfig: IGameConfig): void;
  setState(state: string, nextStage: string, response: object): void;
  setStateChangeEnvelope(envelope: object): void;
}
```

**IXFStates Type** (`proxy/IXFProxyService.ts:12`):
```typescript
type IXFStates = 
  | "onStartGameInitial"
  | "onBeforeShowStage"
  | "onBeforeRequest"
  | "onMakeRequest"
  | "onAbortNextStage"
  | "onResetNextStage"
  | "onResolveStage"
  | "onExitStage"
  | "onEnterNextStage"
  | "onInProgressStage"
  | "onJackpot"
  | "onEndGame"
  | "onBeginNewGame"
```

**IGameConfig** (`proxy/dataModel/IGameConfig.ts`):
- Server-sent configuration (paytable structure, RTP, volatility, etc.)
- Stored in `SystemStore` for reactive access

**IXFChannelManager** (`proxy/IXFChannelManager.ts`):
- Postal.js channel manager for IXF communication
- Routes via Postal federation (multi-iframe support)

### 8.3 State Machine

**IXF State Flow** (from server):
```
onStartGameInitial
  → onBeforeShowStage (presentation setup)
  → onBeforeRequest (disable controls)
  → onMakeRequest (send bet request)
  → [server responds with outcome]
  → onResolveStage (show win)
  → onExitStage
  → onEnterNextStage (next game ready)
  → onBeginNewGame (repeat)
```

Each IXF state maps to a `SequenceDefinition` in `SequencerGameFlow`.

### 8.4 Architectural Patterns

**Adapter Pattern**: `IXFProxyService` adapts lifecycle state machine protocol to Playa's reactive data model. Server calls → `ProxyActions` mutations → observable state changes.

**Observer Pattern**: `ProxyActions` mutations trigger reactions in game flow (via MobX).

**Message Bus Pattern**: Postal.js provides pub/sub channels for cross-iframe communication.

### 8.5 Slot Relevance

IXF is industry's standardized game-server contract. `IXFProxyService` translates server state changes (RNG outcome, balance updates) into game-visible props. Example: server sends `onResolveStage` with win amount—game's sequence reacts, plays win animation, updates balance display.

### 8.6 Lines of Code Summary

| File | LOC |
|------|-----|
| IXFProxyService.ts | 223 |
| PublishStateChangeReplyCommand.ts | 47 |
| **Subtotal** | **~270** |

---

## 9. System Layer (Root Store, Service Registry, Singleton Services)

### 9.1 File Map

```
src/ts/system/
├── SystemStore.ts                    (69 lines)
├── SystemProps.ts
├── SystemData.ts
├── actions/
│   ├── GameActions.ts
│   ├── ProxyActions.ts
│   ├── LoaderActions.ts
│   ├── LayoutActions.ts
│   ├── StageActions.ts
│   ├── StorageActions.ts
│   └── RandomActions.ts
└── dataModel/
    ├── IDataTranslator.ts
    └── [config structures]
```

### 9.2 Public API

**SystemStore** (`system/SystemStore.ts:47`):
```typescript
class SystemStore extends BaseStore<null, null, SystemProps, SystemActions, SystemData> {
  constructor();
  // Inherits from BaseStore
  get props(): SystemProps;
  get actions(): SystemActions;
}

type SystemActions = {
  gameActions: GameActions;
  proxyActions: ProxyActions;
  loaderActions: LoaderActions;
  layoutActions: LayoutActions;
  stageActions: StageActions;
  storageActions: StorageActions;
  randomActions: RandomActions;
};
```

**SystemProps** (`system/SystemProps.ts`):
- Observable properties aggregating all system state
- `response: any` - Raw server response
- `ixfState: string` - Current IXF state
- `loadStatus: { I?: ILoadStatus, Z?: ILoadStatus }` - Loading progress
- `gameConfig: IGameConfig` - Server configuration

### 9.3 Singleton Services (Exported from index.ts)

| Service | Class | Line |
|---------|-------|------|
| System Props | `SystemStore.props` | index.ts:153 |
| Game Actions | `GameActions` | index.ts:155 |
| Layout Service | `LayoutService` | index.ts:149 |
| Stage Service | `StageService` | index.ts:151 |
| Loader Service | `LoaderService` | index.ts:147 |
| Translation Service | `TranslationService` | index.ts:159 |
| Sound Manager | `SoundManager.getInstance()` | index.ts:161 |
| Currency Service | `CurrencyService` | index.ts:163 |
| Worker Service | `WorkerService` | index.ts:165 |
| Random Service | `RandomService` | index.ts:167 |
| Offscreen Renderer | `OffscreenRendererService` | index.ts:169 |
| CEC Event Service | `CECEventService` | index.ts:144 |

### 9.4 State Machine

**System Initialization**:
```
SystemStore created (props empty)
  ↓
IXF sends kernel init (paytable, currency)
  ↓
systemProps.response populated
  ↓
SystemStore.isInitializable() → true (response.length > 0)
  ↓
SystemStore.init() called
  ↓
All downstream components begin initialization
```

### 9.5 Architectural Patterns

**Singleton Pattern**: `SystemStore` instantiated once (`index.ts:139`), root of component hierarchy.

**Service Locator Pattern**: All singleton services exported from `index.ts`, accessible globally. Example: `import { stageService, loaderService } from "@igt/playa-core"`.

**Dependency Injection**: All child components receive `SystemProps` and `SystemActions` as parent, enabling reactive data flow downward.

### 9.6 Slot Relevance

`SystemStore` is the **source of truth** for game state: server response, current balance, paytable, RNG outcome. All game features (reels, buttons, win displays) subscribe to subsets of system state via `@computed` or MobX reactions.

### 9.7 Lines of Code Summary

| File | LOC |
|------|-----|
| SystemStore.ts | 69 |
| **Subtotal** | **~69** |

---

## 10. Utils Layer (Logger, GraphicsUtils, MobxUtils, QA Tools, Debug Panel)

### 10.1 File Map

```
src/ts/utils/
├── logger/
│   ├── Logger.ts
│   └── ILogger.ts
├── mobx/
│   ├── MobxUtils.ts                  (265 lines)
│   └── MobxTool.ts
├── graphics/
│   ├── GraphicsUtils.ts
│   └── [color, transform utils]
├── generic/
│   ├── GenericUtils.ts
│   └── [string, object utils]
├── animations/
│   ├── AnimUtils.ts
│   └── [GSAP helpers]
├── sound/
│   └── SoundTool.ts
├── qa-tools/
│   ├── QaTools.ts
│   └── [performance, debugging]
├── debug/
│   ├── DebugPanel.ts
│   ├── DebugUtils.ts
│   └── [inspector tools]
├── assets/
│   └── AssetPreviewUploader.ts
├── textUtil/
│   ├── TextAutoFit.ts
│   ├── PixiTextUtil.ts
│   └── TextTools.ts
├── Rounding/
│   └── IRoundingDef.ts
├── deferred/
│   └── [promise utilities]
├── ticker/
│   └── [nextTick, animation frame utilities]
└── [various other utilities]
```

### 10.2 Public API

**MobxUtils** (`utils/mobx/MobxUtils.ts:25`):
```typescript
class MobxUtils {
  static getInstance(): MobxUtils;
  addWhen(
    name: string,
    condition: () => boolean,
    callBack?: () => void,
    opts?: IWhenOptions
  ): string;
  addReaction(
    name: string,
    expression: () => T,
    effect: (value, previous, reaction) => void,
    opts?: IReactionOptions
  ): string;
  addAutorun(
    name: string,
    effect: (reaction) => void,
    opts?: IAutorunOptions
  ): string;
  disposeReaction(name: string): void;
  addMobxSpy(name: string): void;
}
```

**Logger** (`utils/logger/Logger.ts`):
```typescript
class Logger {
  constructor(name: string);
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  log(msg: string): void;
}
```

**GraphicsUtils** (`utils/graphics/GraphicsUtils.ts`):
- Color conversion (RGB ↔ Hex, HSL, etc.)
- Transform utilities (rotate, scale, translate)
- Geometry utilities (distance, intersection)

**DebugPanel** (`utils/debug/DebugPanel.ts`):
```typescript
class DebugPanel {
  addButton(label: string, callback: () => void): void;
  addSlider(label: string, min, max, value, callback): void;
  addToggle(label: string, value: boolean, callback): void;
  addMonitor(label: string, getter: () => any): void;
}
```

### 10.3 Architectural Patterns

**Singleton Pattern**: `MobxUtils.getInstance()`, `Logger` factories, `GenericUtils.getInstance()`.

**Registry Pattern**: `MobxUtils` maintains internal `reactions: Map<string, IReactionData>` to track all registered reactions for cleanup.

**Adapter Pattern**: `Logger` abstracts console logging; can be swapped for server-side logging, file logging, etc.

### 10.4 Slot Relevance

**MobxUtils.addWhen()**: Used throughout codebase to wait for observable conditions (e.g., `addWhen("spinsComplete", () => spinCount === 0, () => displayStats())`).

**GraphicsUtils**: Color adjustments for dynamic UI (grayed-out buttons), coordinate transforms for layout positioning.

**DebugPanel**: QA/DevOps tools—runtime parameter adjustment without rebuild. Example: adjust spin speed multiplier, enable/disable features for testing RTP.

### 10.5 Lines of Code Summary

| File | LOC |
|------|-----|
| MobxUtils.ts | 265 |
| Logger.ts (estimated) | ~100 |
| GraphicsUtils.ts (estimated) | ~150 |
| **Subtotal** | **~515** |

---

## 11. Translation Layer (i18n, Font Fallback)

### 11.1 File Map

```
src/ts/translation/
├── TranslationService.ts              (138 lines)
├── TranslationData.ts
├── TranslationProps.ts
├── TextTools.ts                       (string substitution)
└── actions/
    └── TranslationServiceActions.ts
```

### 11.2 Public API

**TranslationService** (`translation/TranslationService.ts:18`):
```typescript
class TranslationService extends BaseService<SystemProps, null, TranslationProps> {
  getString(stringId: string): string;
  getStringAndFill(
    stringId: string,
    fill: { [key: string]: string }
  ): string;
  getLandscapeStyle(styleId: string): any;
  getPortraitStyle(styleId: string): any;
  getFont(fontId: string): string;
}
```

**TextTools** (`translation/TextTools.ts`):
```typescript
function substitute(template: string, values: { [key: string]: string }): string;
// Example: substitute("WIN {$amount}", { amount: "1000" }) → "WIN 1000"
```

### 11.3 State Machine

**Translation Loading**:
```
Load strings.json (localized text)
  ↓
Load [orientation]Style.json (layout-specific text sizes, colors)
  ↓
Load fonts.json (font mappings)
  ↓
prepareComponents() applies translations to all views
```

### 11.4 Architectural Patterns

**Adapter Pattern**: `TranslationService` wraps loaded JSON data (strings, styles) into getter API.

**Template Method**: `prepareComponents()` is template hook for translation application.

### 11.5 Slot Relevance

Slots are multi-language; strings.json contains translations of all UI text (button labels, win messages, etc.). `getStringAndFill()` enables dynamic text: `getString("messages.win") + getStringAndFill("messages.amount", { amount: winTotal })`.

### 11.6 Lines of Code Summary

| File | LOC |
|------|-----|
| TranslationService.ts | 138 |
| **Subtotal** | **~138** |

---

## 12. Game Components Layer (Wheel, Marquee, ScrollBox)

### 12.1 File Map

```
src/ts/gameComponents/
├── wheel/
│   ├── WheelComponent.ts              (684 lines)
│   └── WheelTools.ts
├── MarqueeComponent.ts
├── ScrollBox.ts
└── particles/
    ├── EmitterController.ts
    └── react/
        └── EmitterController.tsx
```

### 12.2 Public API

**WheelComponent** (`gameComponents/wheel/WheelComponent.ts:72`):
```typescript
class WheelComponent {
  constructor(
    wheelConfig: IWheelConfig,
    wheelContainer?: Container,
    wheelFlipperContainer?: Container,
    customEaseIn?: any,
    customEaseOut?: any
  );
  spin(targetSegment: number): Promise<void>;
  getWheelState(): WHEEL_STATES;
  stop(): void;
  pause(): void;
  resume(): void;
}

interface IWheelConfig {
  name: string;
  radius: number;
  segments: number;
  spinTime: number;
  spinUpTime: number;
  spinDownTime: number;
  revolutionsPerSecond: number;
  easeIn: any;  // GSAP easing function
  easeOut: any;
  reverse: boolean;
  useFlipper: boolean;
  flipperDist: number;
}

enum WHEEL_STATES {
  SPIN_IDLE, SPIN_UP_UPDATE, SPIN_UP_COMPLETE,
  SPIN_MAIN_UPDATE, SPIN_MAIN_COMPLETE,
  SPIN_DOWN_UPDATE, SPIN_DOWN_COMPLETE
}
```

**MarqueeComponent** (`gameComponents/MarqueeComponent.ts`):
- Scrolling text display
- Configurable speed, direction, wrapping

**ScrollBox** (`gameComponents/ScrollBox.ts`):
- Scrollable content container
- Momentum scrolling

### 12.3 State Machine

**Wheel Spin State Machine** (`gameComponents/wheel/WheelComponent.ts:59`):
```
SPIN_IDLE
  → SPIN_UP_UPDATE (acceleration phase)
  → SPIN_UP_COMPLETE
  → SPIN_MAIN_UPDATE (steady spin)
  → SPIN_MAIN_COMPLETE
  → SPIN_DOWN_UPDATE (deceleration phase)
  → SPIN_DOWN_COMPLETE → SPIN_IDLE
```

### 12.4 Architectural Patterns

**Strategy Pattern**: `easeIn`, `easeOut` are GSAP easing functions—pluggable animation curves.

**State Machine**: Explicit `WHEEL_STATES` enum with multi-phase spin.

### 12.5 Slot Relevance

Wheels are bonus feature mechanic. The component handles three-phase spin: acceleration (build tension), steady rotation (multiple revolutions), deceleration (target segment alignment). GSAP easing functions control feel (elastic bounces, smooth ramps).

### 12.6 Lines of Code Summary

| File | LOC |
|------|-----|
| WheelComponent.ts | 684 |
| **Subtotal** | **~684** |

---

## 13. Interfaces (ICommand, IBaseStore, IBaseView, etc.)

### 13.1 Core Interfaces Inventory

| Interface | Location | Purpose |
|-----------|----------|---------|
| `ICommand<P, R>` | sequencer/commands/ICommand.ts:6 | Command lifecycle & state |
| `IBaseStore<A>` | component/store/IBaseStore.ts | Store contract (props, actions, initialized) |
| `IBaseView<C>` | component/view/IBaseView.ts | View contract (commands, assets, layout) |
| `IBaseService` | component/service/IBaseService.ts | Service contract (extends BaseStore) |
| `IBaseAction<D>` | component/action/IBaseAction.ts | Action contract (data mutation) |
| `IComponent<P>` | component/IComponent.ts | Universal component contract |
| `IAnimation` | rendering/animation/IAnimation.ts:5 | Animation playback (play, pause, stop) |
| `ILayoutNode` | layout/ILayoutNode.ts | Layout tree node contract (12+ subtypes) |
| `IResourceLoader` | loader/loaders/IResourceLoader.ts | Asset loader strategy |
| `ILoadStatus` | loader/ILoadStatus.ts | Load progress tracking |
| `ISoundPlayer` | sound/ISoundPlayer.ts | Sound playback strategy |
| `ISoundSprite` | sound/ISoundSprite.ts | Sound sprite definition |
| `IGameConfig` | proxy/dataModel/IGameConfig.ts | Server game config |
| `IInitializationActor` | component/initialization/IInitializationActor.ts | Actors in init process |
| `IStage` | stage/IStage.ts | Canvas/renderer contract |
| `IXFProxyControls` | proxy/IXFProxyControls.ts | IXF state machine controls |
| `IReactPixi<C>` | component/react/pixi/IReactPixi.ts | React PIXI component contract |
| `IReactDOM<C>` | component/react/dom/IReactDOM.ts | React DOM component contract |

### 13.2 Slot Relevance

These interfaces define boundaries between components, enabling loose coupling and testability. Games implement custom views/stores/services by extending base classes, then override hooks defined by interfaces.

---

## 14. Build Pipeline & Configuration

### 14.1 TypeScript Configuration

**tsconfig.json** (`configs/tsconfig.json`):
- `target: ES2020`
- `module: ES2015`
- `strict: true`
- Source maps enabled for debugging

### 14.2 Package.json Scripts

| Script | Purpose |
|--------|---------|
| `yarn build` | TypeScript compilation (tsc) |
| `yarn start` | Watch mode compilation with inline source maps |
| `yarn test` | Mocha test runner |
| `yarn lint` | ESLint with auto-fix |
| `yarn format` | Prettier auto-formatting |
| `yarn doc` | TypeDoc documentation generation |
| `yarn doc-aspx` | ASPX documentation export |

### 14.3 Dependencies

**Peer Dependencies**:
- `pixi.js@7.3.0` - 2D rendering
- `three.js@0.177.0` - 3D rendering
- `mobx@6.11.0` - Reactive state
- `mobx-react@9.1.0` - React bindings
- `react@18.2.0`, `react-dom@18.2.0` - UI library
- `howler@2.2.3` - Audio playback
- `gsap@3.11.4` - Animation library
- `postal@2.0.5`, `postal.request-response@0.3.1` - Message bus
- `@foundry/postal.federation@0.5.5`, `@foundry/postal.xframe@0.5.1` - IXF communication
- `@pixi/particle-emitter@5.0.8` - Particle effects
- `pixi-spine@4.0.4` - Skeletal animation

**Build Tools**:
- `webpack@5.84.1` - Module bundler
- `typescript@5.2` - TypeScript compiler
- `swc-loader@0.2.3` - Fast JS/TS loader

### 14.4 ESLint & Code Quality

**Rules**:
- Require JSDoc on function/class declarations
- Enforce explicit return types
- Strict null checks
- Prefer destructuring disabled (for clarity)
- No param reassignment (warnings allow props)

---

## 15. All Command Subclasses Found

| Command Subclass | Location | Purpose |
|------------------|----------|---------|
| `PublishStateChangeReplyCommand` | proxy/commands/PublishStateChangeReplyCommand.ts:10 | Reply to IXF state change after sequence completes |
| `SleepCommand` | utils/commands/index.ts:6 | Delay/sleep for specified duration (uses GSAP) |

Note: Games build custom commands extending `Command` base class (e.g., `SpinReelsCommand`, `PlayWinAnimationCommand`). These are not in core library.

---

## 16. Architecture Summary & Patterns Matrix

### 16.1 GoF Pattern Usage

| Pattern | Implementation Location | Usage |
|---------|------------------------|-------|
| **Command** | sequencer/commands/Command.ts | Game actions encapsulated as objects; execute, cancel, pause, resume |
| **Observer** (MobX) | component/store/BaseStore.ts, MobX reactions | Auto-trigger side effects on state mutations |
| **Factory** | layout/LayoutBuilder.ts, loader/ResourceManager.ts | Create DisplayObjects by type; load assets by extension |
| **Strategy** | loader/loaders/*.ts, sound/ISoundPlayer.ts | Pluggable loaders & players |
| **Composite** | sequencer/sequences/SequenceDefinition.ts, layout/ILayoutNode.ts | Nested sequences, nested layout nodes |
| **Template Method** | component/store/BaseStore.ts, BaseView.ts | `init()`, `isInitializable()` hooks |
| **Adapter** | proxy/IXFProxyService.ts, rendering/animation/BitmapAnimation.ts | Bridge IXF protocol, animation APIs |
| **Singleton** | system/SystemStore.ts, sound/SoundManager.ts, utils/MobxUtils.ts | Single instance across app |
| **Service Locator** | index.ts exports | Global service access |
| **State** | sequencer/commands/Command.ts, rendering/button/Button.ts | Explicit state enums & transitions |

### 16.2 Reactive Architecture (MobX-Based)

```
SystemStore (root, observable data)
    ↓
  [autorun/reaction watchers trigger on data change]
    ↓
Game Components (@observable props, @computed derived values)
    ↓
React/PIXI renders (@observer, auto re-render on prop change)
    ↓
User Input (dispatch Actions)
    ↓
Actions mutate observable data (back to SystemStore)
    ↓
[cycle repeats]
```

### 16.3 Initialization Dependency Graph

```
SystemStore (root)
  ├─ LayoutService (depends: fonts.json, layout JSON)
  ├─ LoaderService (depends: index/manifest)
  ├─ StageService (depends: dimensions from SystemProps)
  ├─ TranslationService (depends: strings.json)
  ├─ SoundManager (singleton, no deps)
  └─ Game Components (depends: parent + assetIds + layoutId)
```

---

## 17. Slot Machine Relevance & Applicability to Slot-GDD-Factory

### 17.1 Direct Applicability

**Sequencer/Command Pattern**: Perfect for multi-phase spin sequences (spin-up, spin-main, spin-down, reel-stop timing, win-animation). Each phase is a `Command`, composed into `SequenceDefinition`. Conditional branching (if big win, play extended animation) is built-in.

**Component Model**: Reels, buttons, meters (balance, bet, free spins count) are `BaseView` subclasses. State per reel (current symbol, spin progress) stored in store. Reactions auto-update visual as state changes.

**Layout System**: All reel positions, button placements, jackpot display locations defined in declarative `landscape.json` / `portrait.json`. Orientation swap automatic.

**Asset Pipeline**: Texture atlases pack reel symbols, button states, win animations. Lazy loading defers bonus feature assets until needed, speeding initial load.

**Sound Sprites**: Spin sound, reel stop sound, win jingle all packed in one .mp3 sprite file referenced by ID.

**IXF Integration**: Server sends outcome (reel positions, win amount) via `onResolveStage` → game displays result via sequence.

### 17.2 Concrete Examples for Slot-GDD-Factory

1. **Reel Spin Command**:
   ```typescript
   class SpinReelsCommand extends Command<ReelOutcome, void> {
     execute() {
       super.execute();
       // Dispatch actions to animate reels to payload outcome
       // When animation done, resolveCompleted()
     }
   }
   ```

2. **Spin Sequence**:
   ```typescript
   const spinSequence = new SequenceDefinition()
     .do(new SoundCommand({ soundId: "spinStart" }))
     .start({ blocking: "all" }) // parallel phase
       .do(new SpinReelCommand(reelA, outcome.reel1))
       .do(new SpinReelCommand(reelB, outcome.reel2))
       // ... 5 reels
     .end()
     .do(new SoundCommand({ soundId: "spinStop" }))
     .start({ blocking: "race", skippable: true })
       .do(new WinAnimationCommand(outcome.winAmount))
     .end();
   ```

3. **Free Spins Counter Store**:
   ```typescript
   class FreeSpinsStore extends BaseStore<GameProps, GameActions, FreeSpinsProps, FreeSpinsActions, FreeSpinsData> {
     protected isInitializable() {
       return this.dependencies.length === 0;
     }
     
     protected async init() {
       // Reaction: if freeSpinsRemaining > 0, enable free spin button
     }
   }
   ```

4. **Layout Orientation Swap**:
   - `landscape.json`: Reel strip at y=200, button at y=600
   - `portrait.json`: Reel strip at y=100, button at y=500
   - On device rotate, stage automatically re-layouts

### 17.3 Patterns Not Yet Needed (But Exist)

- **3D Rendering** (ThreeDView): For immersive cabinet-style games
- **Wheel Bonus** (WheelComponent): For fortune wheel features
- **Video Backgrounds** (VideoAnimation): For cinematic intros
- **Marquee Scrolling Text**: For promotional displays

---

## 18. Key Takeaways for Integration

| Item | Insight |
|------|---------|
| **State Flow** | One-way downward (SystemStore → Props → child components). Mutations only via Actions. |
| **Async Handling** | Promises everywhere; `SequenceDefinition.completed`, `Command.completed`, loader `.get()` all return promises. |
| **Extensibility** | Create custom Command subclasses, BaseView/BaseStore subclasses, IResourceLoader implementations—framework is highly modular. |
| **Performance** | MobX fine-grained reactivity—only affected components re-render. Texture atlases reduce draw calls. |
| **Testing** | Commands are testable (execute, await completed, check state); MobX reactions can be spied on. |
| **Localization** | String substitution API; font fallback via CSS. Multi-language slots require minimal extra code. |
| **Mobile** | Orientation swap, touch event handling, viewport fitting all built-in. |

---

## 19. Directory Tree (Abbreviated)

```
src/ts/
├── index.ts                          (177 lines, exports & singleton setup)
├── sequencer/
│   ├── commands/ (Command, CommandSet, ICommand)
│   ├── gameflow/ (GameFlow, SequencerGameFlow, AsyncGameFlow, GameFlowManager)
│   ├── sequences/ (SequenceDefinition, SequenceStep)
│   ├── Sequencer.ts (369 LOC)
│   └── GeneratorSequencer.ts
├── component/
│   ├── store/ (BaseStore, IBaseStore)
│   ├── view/ (BaseView, IBaseView, ViewData)
│   ├── service/ (BaseService, IBaseService)
│   ├── action/ (BaseAction, IBaseAction, Actions)
│   ├── props/ (IBaseProps)
│   ├── initialization/ (InitializationManager, InitializationState, IInitializationActor)
│   ├── react/ (IReactPixi, IReactDOM, ReactPixi, ReactDOM)
│   ├── ParentDef.ts
│   ├── IComponent.ts
│   └── ComponentTypes.ts
├── stage/
│   ├── StageComponent.ts (179 LOC)
│   ├── StageService.ts
│   ├── IStage.ts
│   ├── StageProps.ts
│   ├── StageData.ts
│   ├── FitDimension.ts
│   └── OffscreenRendererService.ts
├── layout/
│   ├── LayoutService.ts (411 LOC)
│   ├── LayoutBuilder.ts (1,204 LOC)
│   ├── LayoutData.ts
│   ├── LayoutProps.ts
│   ├── ILayoutNode.ts
│   ├── Orientation.ts
│   ├── SkipUpdateTransforms.ts
│   └── actions/ (LayoutServiceActions, LayoutActions)
├── loader/
│   ├── LoaderService.ts (391 LOC)
│   ├── LoaderData.ts
│   ├── LoaderProps.ts
│   ├── ResourceManager.ts
│   ├── SubLoader.ts
│   ├── loaders/ (IResourceLoader, IndexLoader, SpriteLoader, SpineLoader, FontLoader, BitmapFontLoader, VideoLoader, VectorLoader, BlobLoader, CSSLoader, GlTFLoader)
│   └── actions/ (ResourceLoaderActions)
├── rendering/
│   ├── animation/ (IAnimation, BitmapAnimation, SpineAnimation, VideoAnimation)
│   ├── button/ (Button, Checkbox)
│   ├── particles/ (ParticleEmitter, FastParticleEmitter)
│   ├── threeDView/ (ThreeDView, CameraParams, LightParameters)
│   ├── react/ (SpineAnimation wrapper, ThreeDViewWrapper)
│   └── BitmapTextOverrides.ts
├── sound/
│   ├── SoundManager.ts (144 LOC)
│   ├── SoundSprite.ts
│   ├── ISoundPlayer.ts
│   ├── ISoundSprite.ts
│   ├── HowlerSoundPlayer.ts
│   └── actions/ (SoundActions)
├── proxy/
│   ├── IXFProxyService.ts (223 LOC)
│   ├── IXFProxyComponent.ts
│   ├── IXFChannelManager.ts
│   ├── IXFProxyControls.ts
│   ├── commands/ (PublishStateChangeReplyCommand)
│   └── dataModel/ (IGameConfig, KernelInitData, IDataTranslator)
├── system/
│   ├── SystemStore.ts (69 LOC)
│   ├── SystemProps.ts
│   ├── SystemData.ts
│   └── actions/ (GameActions, ProxyActions, LoaderActions, LayoutActions, StageActions, StorageActions, RandomActions)
├── utils/
│   ├── logger/ (Logger, ILogger)
│   ├── mobx/ (MobxUtils, MobxTool)
│   ├── graphics/ (GraphicsUtils)
│   ├── generic/ (GenericUtils)
│   ├── animations/ (AnimUtils)
│   ├── sound/ (SoundTool)
│   ├── qa-tools/ (QaTools)
│   ├── debug/ (DebugPanel, DebugUtils)
│   ├── assets/ (AssetPreviewUploader)
│   ├── textUtil/ (TextAutoFit, PixiTextUtil, TextTools)
│   ├── Rounding/ (IRoundingDef)
│   ├── deferred/ (promise utils)
│   ├── ticker/ (nextTick, animation frame)
│   ├── stageInspector/
│   └── commands/ (SleepCommand)
├── translation/
│   ├── TranslationService.ts (138 LOC)
│   ├── TranslationData.ts
│   ├── TranslationProps.ts
│   ├── TextTools.ts
│   └── actions/ (TranslationServiceActions)
├── gameComponents/
│   ├── wheel/ (WheelComponent, WheelTools)
│   ├── MarqueeComponent.ts
│   ├── ScrollBox.ts
│   └── particles/ (EmitterController)
├── clientEvents/
│   └── CECEventService.ts
├── currency/
│   ├── CurrencyService.ts
│   └── dataModel/ (currency structures)
├── random/
│   └── RandomService.ts
├── storage/
│   └── (local storage service)
├── worker/
│   └── WorkerService.ts
├── webview/
│   └── WebViewManager.ts
├── react/ (React-specific components)
│   ├── containerref/
│   ├── prefab/
│   ├── label/
│   ├── orientationswap/
│   └── orientation-swap-wrapper/
└── view/ (Simple views, not BaseView-derived)
    ├── SimpleView.ts
    ├── ISimpleView.ts
    ├── popup/ (SimplePopup, ISimplePopup)
    ├── background/ (Background, CSSBackground)
    └── [...]
```

**Total TypeScript Files**: ~228  
**Estimated Total LOC**: ~15,000-20,000 (core framework, excluding tests & configs)

---

## 20. Conclusion

Playa-Core is a **battle-tested, production-grade framework** for industry standard slot games. It combines:

1. **Reactive state management** (MobX) for responsive UIs
2. **Command pattern** for orchestrating complex, multi-phase game sequences
3. **Modular components** (Store/View/Service/Action) enabling code reuse
4. **Sophisticated asset pipeline** with lazy loading and sprite packing
5. **IXF integration** for seamless server communication
6. **Multi-platform support** (landscape/portrait, 2D/3D rendering)

The architecture is suitable for **Slot-GDD-Factory** as a reference model. Key adoption points:

- Use `SequenceDefinition` for spin/win/bonus orchestration
- Extend `BaseView` for game UI elements
- Leverage `MobxUtils.addWhen()` for conditional logic
- Define game state in `BaseStore` subclasses
- Use `LayoutService` for responsive layouts
- Integrate IXF via `IXFProxyService` pattern

The framework is highly extensible—games add custom logic via subclassing, not modifying core. This separation of concerns enables rapid game development and testing.

---

**Report Generated**: 2026-06-16  
**Word Count**: ~5,200 (concise, detailed analysis)  
**Analyzer**: Claude Reverse Engineering Agent  
**Framework**: Anthropic Claude (Haiku 4.5)
