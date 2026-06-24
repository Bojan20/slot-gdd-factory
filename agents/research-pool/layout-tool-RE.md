# industry standard Layout Tool: Reverse Engineering Report

**Repository:** ~/industry standard/layout_tool  
**Codebase Size:** ~3326 lines (src/ core)  
**Version:** 0.5.2  
**Framework:** Electron 9.0.5 (Node.js desktop bridge)  
**Author:** Vujadin Krtolica  
**License:** Proprietary

---

## Executive Summary

Layout Tool is a cross-platform (Electron) desktop application for authoring game UI layouts. It bridges the gap between Adobe Photoshop design files (PSD) and JSON layout descriptors consumed by playa-core's LayoutService. The tool provides visual drag-and-drop editing, sprite atlas generation, bitmap font compilation, and real-time PIXI preview rendering. All edits are tracked via undo/redo history and persisted to project .dat files.

---

## Entry Points & Bootstrap

### main.js (822 lines)

**Purpose:** Electron main process (OS window/menu management, IPC routing)  
**Key Responsibilities:**

1. **Settings & Configuration Loading** (lines 60-69):
   - Reads `settings.dat` from application root
   - Parses keyboard shortcuts → menuTemplate
   - Stores projectPaths array for recent project discovery

2. **Application Menu** (lines 70-282):
   - File menu: Save, Import String Table, Import Fonts, Export Layout
   - Edit menu: Pan/Move/Rotate/Scale modes, Undo/Redo, Copy/Paste/Clone/Delete, Reset Container Origin, Zoom
   - Add menu: Container, Label, Bitmap Font Label, Layout
   - View menu: Pixi vs DOM renderer toggle
   - Help menu: Documentation, About

3. **Window Lifecycle** (lines 628-817):
   - createWindow(): Initializes 1200×900 BrowserWindow
   - Loads file:// → index.html (not webpack; direct file protocol)
   - Handles close event with "Are you sure?" confirmation
   - Graceful shutdown: saves layout, creates project preview PNG

4. **IPC Handlers** (lines 674-753):
   - `show-main-menu`: Build menu after project load
   - `importPsd`: Trigger import window modal
   - `show-open-project`, `show-new-project`: Dialog windows
   - `final-shut-down`: Force exit with cleanup
   - `show-export-win`, `complete-export-layout`: Export modals
   - `webfont-generated`, `runExtension`, `updateExtensionsLibrary`: Extension hooks

5. **Import Window Modal** (lines 757-793):
   - Spawns child BrowserWindow (file://.../ importWindow.html)
   - Routes `importProcess` IPC messages
   - Cleanup on close

6. **CLI Arguments** (lines 796-813):
   - yargs parser supports `importPSD` command with `-i` flag:
   ```bash
   layout_tool importPSD -i /path/to/settings.json
   ```
   - Bypasses main UI, goes straight to import window

### renderer.js (113 lines)

**Purpose:** Electron renderer process (UI thread) bootstrap  
**Key Functions:**

- `editor = new Editor()`: Global singleton instantiation
- IPC listeners: `initApp`, `loadProject` → delegate to Editor methods
- Project discovery: Reads shObj.projectPaths, scans for meta_*.json files
- Startup screen: Lists recent projects with preview images
- Project selection handler: Loads chosen project via `mainWindow.webContents.send('loadProject', path)`

---

## Core Editor System (Editor.js – 2323 lines)

### Architecture Overview

Editor is a monolithic class managing all runtime state: stage hierarchy, selection, history, rendering, UI events, and persistence.

**Key Properties:**

```javascript
this.stage = null;                    // Root DisplayObject container
this.pixiStage = null;               // PIXI.Container reference
this.pixiApp = null;                 // PIXI.Application instance
this.selectedObject = null;          // Currently selected node
this.stages = {};                    // Named layouts {name: StageNode}
this.activeView = null;              // Current layout being edited

this.fontManager = new FontManager(this);
this.stringTableManager = new StringTableManager(this);
this.bitmapFontList = [];            // Font instances (TTF→bitmap)
this.fontList = [];                  // All available fonts

this.history = new HistoryManager(this);

this.signals = {
  psdLoaded, objectAdded, objectRemoved, objectSelected, objectUpdated,
  objectMoved, objectRotated, objectScaled, objectNameChanged,
  viewportMoved, layoutViewChanged, languageChanged, zoomChanged
};
```

### Signal System (Event Dispatching)

Uses signals.js library for typed event emission:
```javascript
this.signals.objectAdded.dispatch(object);
this.signals.objectSelected.dispatch(object);
```

Allows decoupled listeners (history, rendering, UI panels) to respond to changes.

### Rendering Architecture

**Dual-Renderer Support:**

1. **PIXI Renderer** (default):
   - Hardware-accelerated WebGL/Canvas
   - Uses PIXI.js v6.0.4 for stage rendering
   - Real-time performance with visual fidelity
   - Sprite atlasing via maxrects-packer

2. **DOM Renderer** (fallback):
   - CSS + HTML (slower, for debugging)
   - Full DOM tree replication of stage hierarchy

**Canvas Setup:**
- Creates main canvas element in DOM
- Initializes PIXI.Application with WebGL fallback
- Resizes to window dimensions
- Handles mouse/keyboard events for object manipulation

### Object Hierarchy & Node Types

**Supported Object Types:**
- `container` – Display group (PIXI.Container)
- `layer` – Image/texture layer (PIXI.Sprite)
- `label` – Text (PIXI.Text with system fonts)
- `bitmap-font-label` – Text with bitmap font (custom raster glyphs)
- `spine-animation` – Skeletal animation (Spine JSON)
- `mc-animation` – MovieClip/timeline animation

**Node Properties (stored in JSON):**
```javascript
{
  id: "unique-uuid-per-node",
  name: "DisplayObjectName",
  type: "container|layer|label|...",
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  scaleX: 1.0,
  scaleY: 1.0,
  rotation: 0,           // radians
  alpha: 1.0,
  visible: true,
  blendMode: "normal|screen|multiply|...",
  anchorX: 0.0,          // pivot point 0-1
  anchorY: 0.0,
  children: [...]        // recursive
}
```

### Input Handling (Actions)

**Keyboard Shortcuts (from settings.dat):**
- Pan viewport: Shift+Space (drag to move camera)
- Translate object: Q (move selected)
- Rotate object: W (spin around anchor)
- Scale object: E (resize proportional)
- Copy: Cmd+C, Paste: Cmd+V, Clone: Cmd+D, Delete: Backspace

**Mouse Interactions:**
- Click on canvas → select object (signals.objectSelected)
- Drag selected → update position (MoveObjectAction logged to history)
- Right-click → context menu (add, delete, duplicate)
- Scroll → zoom in/out

---

## History & Undo/Redo System

### HistoryManager (~/src/history/HistoryManager.js)

```javascript
this.execute(cmd, optionalName) {
  let isUpdatableCmd = lastCmd.updatable && cmd.updatable &&
                       lastCmd.object === cmd.object &&
                       lastCmd.type === cmd.type;
  
  if (isUpdatableCmd && timeDiff < 500) {
    lastCmd.update(cmd);  // batch rapid property changes
  } else {
    this.undos.push(cmd);
  }
  cmd.execute();
  this.redos = [];        // clear redo stack on new action
}

this.undo() { this.undos[--index].undo(); }
this.redo() { this.redos[index++].execute(); }
```

### Action Classes (~/src/history/actions/)

| Action | Signature | Updatable | Purpose |
|--------|-----------|-----------|---------|
| AddObjectAction | (parent, newObject) | No | Add child to container |
| RemoveObjectAction | (object) | No | Delete object from tree |
| CloneObjectAction | (original, parent) | No | Duplicate with new UUID |
| SetPropertyAction | (object, prop, newVal) | Yes | Update single field (batched) |
| SetPositionAction | (object, x, y) | Yes | Move object |
| SetRotationAction | (object, radians) | Yes | Rotate |
| SetScaleAction | (object, sx, sy) | Yes | Resize |
| MoveObjectAction | (object, x, y) | Yes | Alias for SetPosition |
| ViewportMovedAction | (x, y) | Yes | Pan camera |
| LayoutViewChangedAction | (layoutName) | No | Switch active stage |
| LanguageChangedAction | (langCode) | No | Change string table locale |

Each action implements:
```javascript
.execute()     // apply change
.undo()        // revert change
.update(cmd)   // merge with previous (if updatable)
.toJSON()      // serialize for persistence
```

**Batching Heuristic:** Consecutive SetPositionActions within 500ms are merged into single undo entry (drag drag drag → single "moved" action).

---

## PSD Import Pipeline

### psdutils.js (Partial Reference)

**Flow:**
1. User selects .psd file from disk
2. jimp (JavaScript Image Processing) loads bitmap layers
3. fonteditor-core extracts text layers + font metrics
4. Tool compares against current layout:
   - Match layers by name
   - Preserve layout positions (keep) or import new (discard)
5. Copy imported images to project/shareWith/img/

**Key Logic (psdutils.js lines 1-40):**
```javascript
PSDUtils.mergeChanges(data) {
  objList.forEach(obj => {
    if (obj.discard == null) {  // new object
      obj.keep.id = obj.keep.name + "_uuid_" + stageUuid;
      if (obj.keep.type === "layer") {
        let imgPath = normalizeFilePath(obj.keep._domObject.src);
        let newImgPath = projectPath + "/img/" + basename(imgPath);
        fs.copyFileSync(imgPath, newImgPath);
        obj.keep._domObject.src = newImgPath;
        obj.keep.texture = PIXI.Texture.from(newImgPath);
      }
      editor.signals.objectAdded.dispatch(obj.keep._domObject);
    } else {  // replaced object
      if (obj.keep._original) {
        obj.keep.visible = obj.keep._originalVisible;
      } else {
        // image comparison: compare updated vs original
        fs.copyFileSync(updatedPath, originalPath);
      }
    }
  });
}
```

**Supported Image Formats:** PNG, JPG, JPEG, SVG, MP4, WebM

---

## Layout Output & Export Schema

### JSON Layout Descriptor

**File:** `{project}/{stage}.json`

```json
{
  "name": "mainScreen",
  "width": 1920,
  "height": 1080,
  "scale": 1.0,
  "stages": [
    {
      "id": "container-uuid-xxx",
      "name": "reels",
      "type": "container",
      "x": 100,
      "y": 100,
      "width": 1200,
      "height": 400,
      "scaleX": 1.0,
      "scaleY": 1.0,
      "rotation": 0,
      "alpha": 1.0,
      "visible": true,
      "anchorX": 0.5,
      "anchorY": 0.5,
      "blendMode": "normal",
      "children": [
        {
          "id": "layer-uuid-yyy",
          "name": "reel-1",
          "type": "layer",
          "x": 0,
          "y": 0,
          "width": 100,
          "height": 300,
          "src": "img/reel-1.png",
          "scaleX": 1.0,
          "scaleY": 1.0,
          "rotation": 0,
          "alpha": 1.0,
          "visible": true
        },
        {
          "id": "label-uuid-zzz",
          "name": "winAmount",
          "type": "label",
          "x": 600,
          "y": 500,
          "width": 300,
          "height": 100,
          "text": "WIN: $1000",
          "fontSize": 48,
          "fontFamily": "Arial",
          "fontColor": "#FFFFFF",
          "align": "center",
          "alpha": 1.0,
          "visible": true
        }
      ]
    }
  ],
  "fonts": [
    {
      "name": "arial-48",
      "type": "system",
      "fontFamily": "Arial",
      "fontSize": 48
    },
    {
      "name": "bitmap-arcade",
      "type": "bitmap",
      "src": "fonts/arcade.png",
      "data": "fonts/arcade.json"
    }
  ],
  "atlases": [
    {
      "name": "main-atlas",
      "image": "atlases/main.png",
      "data": "atlases/main.json",
      "maxWidth": 2048,
      "maxHeight": 2048,
      "padding": 2
    }
  ]
}
```

### Sprite Atlas Generation (maxrects-packer)

**Tool:** maxrects-packer v2.5.0 (MaxRects bin packing algorithm)  
**Input:** Array of image Textures  
**Output:** Single atlas PNG + JSON metadata

**JSON Metadata Format:**
```json
{
  "frames": {
    "reel-1.png": {
      "frame": {"x": 0, "y": 0, "w": 100, "h": 300},
      "rotated": false,
      "trimmed": false,
      "spriteSourceSize": {"x": 0, "y": 0, "w": 100, "h": 300},
      "sourceSize": {"w": 100, "h": 300}
    }
  },
  "meta": {
    "app": "layout-tool",
    "version": "0.5.2",
    "image": "main-atlas.png",
    "format": "RGBA8888",
    "size": {"w": 2048, "h": 2048}
  }
}
```

**Usage in playa-core:**
```javascript
// LayoutService loads descriptor
let atlas = new PIXI.Spritesheet(texture, atlasData);
atlas.parse().then(() => {
  let sprite = new PIXI.Sprite(atlas.textures["reel-1.png"]);
});
```

### Bitmap Font Tables (fonteditor-core + ttf2woff2)

**Workflow:**
1. User selects TTF/OTF file
2. fonteditor-core loads font, renders glyphs to bitmap
3. free-tex-packer-core packs glyphs into sprite sheet
4. Outputs: bitmap PNG + JSON font metrics

**JSON Font Table:**
```json
{
  "info": {
    "face": "Arial",
    "size": 48,
    "bold": false,
    "italic": false,
    "charset": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789..."
  },
  "common": {
    "lineHeight": 52,
    "base": 40,
    "scaleW": 512,
    "scaleH": 512,
    "pages": 1,
    "packed": false,
    "alphaChnl": 0,
    "redChnl": 0,
    "greenChnl": 0,
    "blueChnl": 0
  },
  "chars": [
    {
      "id": 65,
      "x": 0,
      "y": 0,
      "width": 30,
      "height": 48,
      "xoffset": 2,
      "yoffset": 0,
      "xadvance": 32,
      "page": 0,
      "chnl": 15
    }
  ],
  "kernings": [
    {"first": 84, "second": 65, "amount": -2}
  ]
}
```

**Runtime (playa-core):**
```javascript
let bitmapFont = new BitmapFont("Arial48", texture, fontData);
let text = new BitmapText("HELLO", bitmapFont);
stage.addChild(text);
```

---

## Text Autofit System (TextAutoFit.js)

**Purpose:** Automatically shrink/expand text to fit container dimensions

**Algorithm:**
1. Measure text bounding box with current fontSize
2. If width > maxWidth or height > maxHeight:
   - Decrease fontSize by 1
   - Re-measure
   - Repeat until fit (or reach minFontSize)
3. If width < 0.8 * maxWidth and height < 0.8 * maxHeight:
   - Increase fontSize by 1
   - Re-measure
   - Repeat until exceed bounds

**Parameters (object properties):**
```javascript
{
  autoFitMinSize: 8,      // minimum fontSize
  autoFitMaxSize: 72,     // maximum fontSize
  autoFitPadding: 4,      // margin around text
  autoFitEnabled: true
}
```

---

## String Table & Localization (stringTableManager.js)

**Purpose:** Manage multi-language text assets

**File Structure:**
```
project/
  ├── strings/
  │   ├── en.json
  │   ├── fr.json
  │   ├── de.json
  │   └── meta_strings.json (metadata)
```

**String Table JSON:**
```json
{
  "winAmount": "WIN: ${amount}",
  "totalBet": "BET: ${bet}",
  "freeSpinsRemaining": "FREE SPINS: ${count}",
  "payline": "PAYLINE"
}
```

**Runtime Substitution:**
```javascript
// Game code
let text = stringTable.get("winAmount", {amount: 1000});
// Returns: "WIN: 1000"
```

---

## Font Manager & Glyph Rendering (fontManager.js)

**Manages:**
1. System fonts (Arial, Times, Courier, etc.)
2. Bitmap fonts (compiled glyphs)
3. Web fonts (TTF/WOFF/WOFF2)

**Key Methods:**
- `loadFont(fontPath)` – Parses TTF, extracts metrics
- `compileBitmapFont(fontName, glyphSet)` – Rasterizes glyphs to PNG
- `registerFont(name, descriptor)` – Adds to internal registry
- `getAvailable()` – Returns list of loadable fonts

---

## Project Persistence & File Format

### .dat Files

**Location:** `{projectPath}/meta_{layoutName}.json`  
**Format:** Plain JSON (not binary .dat, misleading name)

```json
{
  "name": "mainLayout",
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-06-16T10:30:00Z",
  "modifiedAt": "2025-06-16T11:45:00Z",
  "version": "0.5.2",
  "width": 1920,
  "height": 1080,
  "stages": [
    {...stage hierarchy...}
  ]
}
```

**Save Flow:**
1. User selects File → Save (or Cmd+S)
2. ipcMain.on('saveProject') handler invoked
3. Editor serializes this.stage tree to JSON
4. fs.writeFileSync(projectPath/meta_*.json, JSON)
5. Signals historyChanged dispatched

### Project Structure

```
MyGame-Layout/
├── meta_mainLayout.json       # main layout descriptor
├── meta_popupScreen.json      # popup layout
├── preview.png                # thumbnail screenshot
├── img/
│   ├── reel-1.png
│   ├── reel-2.png
│   └── ...
├── fonts/
│   ├── arcade-bitmap.png
│   ├── arcade.json
│   └── ...
├── atlases/
│   ├── main-atlas.png
│   └── main-atlas.json
└── strings/
    ├── en.json
    ├── fr.json
    └── meta_strings.json
```

---

## Utility Libraries

### nodeutils.js
- Tree traversal: `findChildById()`, `getAllChildren()`
- Node queries: `getObjectsByType()`, `getObjectsByName()`
- Hierarchy manipulation: `addChild()`, `removeChild()`, `reparent()`

### layerutils.js
- Z-order management: `moveUp()`, `moveDown()`, `moveToTop()`, `moveToBottom()`
- Visibility: `toggleVisibility()`, `hideOthers()`
- Selection: `selectAll()`, `deselectAll()`

### xmlUtils.js
- SVG parsing (for SVG layer imports)
- XML-to-object tree conversion

### utils.js (General)
- `generateUUID()` – Create unique node IDs
- `deepClone()` – Copy objects for clipboard/undo
- `removeObjectFromUpdatedPSD()` – PSD merge cleanup
- `loadImage()` – Async image loading with error handling

---

## Extension System

**Purpose:** Allow game-specific layout logic via scripts

**Location:** `extensions/` directory  
**Language:** Lua (compiled to bytecode)

**Example Extension (pseudo-code):**
```lua
-- extensions/autoLayoutForGameX.lts
function onLayoutLoaded(layout)
  -- Auto-position reels based on game width
  local reelContainer = layout:getChildByName("reels")
  local reelSpacing = layout.width / 6
  for i = 1, 5 do
    local reel = reelContainer:getChildByName("reel-" .. i)
    reel.x = i * reelSpacing
  end
end

function exportStringAndStyleTables(layout, export_dir)
  -- Custom export logic
end
```

**IPC Invocation:**
- `runExtension`: Execute extension function
- `updateExtensionsLibrary`: Reload extensions from disk

---

## Modal Dialogs (Electron Secondary Windows)

| Modal | Path | Purpose |
|-------|------|---------|
| webfontbuilder | modal/webfontbuilder.html | TTF→bitmap font compilation |
| extensioneditor | modal/extensioneditor.html | Lua script editor |
| exportlayout | modal/exportlayout/index.html | Export settings (atlas, format, path) |
| newproject | modal/newproject.html | Create new project folder |
| addlayout | modal/addlayout.html | Add new stage to project |
| about | modal/about.html | Version & attribution |
| documentation | modal/documentation.html | Embedded help (docs/index.html) |

**Communication Pattern:**
1. Main process spawns BrowserWindow
2. Modal loads HTML (file://)
3. Modal user interacts (submit form, select file)
4. Modal sends IPC to main: `ipcRenderer.send('complete-export-layout', {...})`
5. Main routes to renderer: `mainWindow.webContents.send('export-layout', data)`
6. Renderer (Editor) processes and closes modal

---

## Rendering & Viewport

### PIXI Stage Hierarchy

```
PIXI.Application.stage (root)
  │
  ├─ Stage (container with layout bounds)
  │   ├─ Layer (sprite with texture)
  │   │   └─ Scale/Rotation transforms
  │   ├─ Container (group)
  │   │   ├─ Label (text)
  │   │   ├─ Sprite (layer)
  │   │   └─ ...
  │   └─ ...
  │
  ├─ Highlighter (debug overlay)
  │   └─ Selection rect (shows selected object bounds)
  │
  └─ Debug grid (optional)
```

### Viewport Panning (movestage action)

- Keyboard shortcut: Shift+Space
- Mouse drag moves camera matrix
- Signals.viewportMoved dispatched
- Redo/undo supported

### Zoom Control

- Keyboard: Cmd+Plus/Minus
- Mouse wheel: Scroll
- Signals.zoomChanged dispatched
- Zoom level stored in history (optional)

---

## Dependencies & Build

### Dependencies (Complete)

| Package | Version | Purpose |
|---------|---------|---------|
| canvas | 2.8.0 | Node.js canvas (screenshot) |
| electron | 9.0.5 | OS window/native APIs |
| electron-debug | 2.2.0 | DevTools enhancement |
| electron-log | 4.2.2 | App logging |
| electron-unhandled | 2.2.0 | Error boundary |
| fonteditor-core | 2.1.1 | TTF parsing & glyph extraction |
| free-tex-packer-core | 0.2.9 | Texture atlas generation |
| fs-extra | 7.0.1 | Enhanced fs (mkdir -p, copy recursive) |
| jimp | 0.14.0 | Image processing (crop, resize, format conversion) |
| jquery | 3.5.1 | DOM manipulation (legacy, should remove) |
| jquery.fancytree | 2.35.0 | Tree widget (project navigator) |
| maxrects-packer | 2.5.0 | Sprite atlas packing algorithm |
| micromodal | 0.4.2 | Accessible modal dialogs |
| monaco-editor | 0.17.1 | Code editor (extensions, string tables) |
| on-change | 2.0.1 | Object property change tracking |
| opn | 6.0.0 | Open external URLs |
| pixi.js | 6.0.4 | WebGL/Canvas 2D renderer |
| pixel-diff | 1.0.1 | Visual diff (diff baseline screenshots) |
| signals.js | – | Event system (NPM not found; probably bundled) |
| string-similarity | 3.0.0 | Fuzzy matching (PSD layer merging) |
| system-font-families | 0.4.1 | Detect OS fonts |
| tippy.js | 4.3.3 | Tooltip library |
| ttf2woff2 | 3.0.0 | Font format conversion |
| xml2js | 0.4.23 | SVG parsing |
| yargs | 17.0.1 | CLI argument parsing |

### Build Script

```bash
npm start              # electron .
npm build             # electron-packager . --out=dist --overwrite
```

### Output Artifacts

- **macOS:** `.dmg` installer
- **Windows:** `.exe` portable + installer
- **Linux:** AppImage

---

## Line Count Summary

| File | LOC | Purpose |
|------|-----|---------|
| Editor.js | 2323 | Core editor runtime |
| main.js | 822 | Electron main process |
| renderer.js | 113 | Renderer bootstrap |
| utils/psdutils.js | ~300 | PSD import/merge |
| utils/fontManager.js | ~250 | Font loading & compilation |
| utils/stringTableManager.js | ~200 | Localization |
| history/HistoryManager.js | ~100 | Undo/redo |
| history/actions/*.js | ~400 | 12 action classes |
| languages.js | 59 | Language list |
| **Total** | **~3326** | Src directory |

---

## Runtime Workflow (Typical Author Session)

### 1. Startup
```
User launches Layout Tool
  → Electron loads main.js
  → main.js reads settings.dat
  → Renders index.html with startup screen
  → User selects project from list or creates new
  → mainWindow.webContents.send('loadProject', path)
```

### 2. Project Load
```
renderer.js receives 'loadProject'
  → Editor.loadProject(path)
  → Reads meta_*.json files from directory
  → Parses stage hierarchies
  → Signals.psdLoaded.dispatch()
  → Renders stages in PIXI viewport
  → User sees layout editor with tree view
```

### 3. Edit Session
```
User: Click on object
  → renderer.js: mousedown handler
  → Select object via signals.objectSelected.dispatch()
  → History manager ready for next action

User: Drag selected object
  → MoveObjectAction created & executed
  → UpdatePropertyAction batched if < 500ms since last
  → PIXI render loop updates on RAF
  → Signals.objectMoved.dispatch()

User: Right-click + "Add Label"
  → AddObjectAction created
  → New DisplayObject added to tree
  → New UUID assigned
  → Signals.objectAdded.dispatch()

User: Press Cmd+Z (undo)
  → HistoryManager.undo()
  → Last action's undo() called
  → PIXI redraws
  → Signals.objectUpdated.dispatch()
```

### 4. PSD Import
```
User: File → Import → Select .psd
  → importWindow modal spawned
  → PSD loaded with jimp/fonteditor
  → Layer list shown with merge options (keep/discard)
  → User selects which layers to import
  → psdutils.mergeChanges()
  → New images copied to img/
  → Hierarchy updated
  → signals.objectAdded for each new layer
```

### 5. Export
```
User: File → Export Layout
  → showExportLayoutDialog()
  → Modal window: select format (JSON, SVG)
  → Checkbox: generate sprite atlas
  → Input: target directory
  → Export confirmed
  → Editor.stage serialized to JSON
  → maxrects-packer generates atlas.png + atlas.json
  → fonteditor compiles bitmap fonts
  → All files written to export path
  → Editor saves copy to project (auto-backup)
```

### 6. Save & Exit
```
User: File → Save (or auto-save on timer)
  → meta_*.json written
  → preview.png screenshot generated (canvas.toDataURL)
  → signals.layoutChanged dispatched

User: Close window
  → mainWindow 'close' event
  → "Are you sure?" dialog
  → If confirmed:
    → savelayout signal sent
    → createProjectScreenshot signal sent
    → final-shut-down IPC
    → app.quit()
```

---

## Architecture Diagram (Textual)

```
┌──────────────────────────────────────────────┐
│         Electron Main Process                │
│         (main.js)                            │
│  ┌──────────────────────────────────────────┐│
│  │ Menu setup, IPC routing                  ││
│  │ File dialogs, project discovery          ││
│  │ Modal window management                  ││
│  └──────────────────────────────────────────┘│
└──────────────┬───────────────────────────────┘
               │ ipc.send / webContents.send
               ▼
┌──────────────────────────────────────────────┐
│      Electron Renderer Process               │
│         (index.html + renderer.js)           │
│  ┌──────────────────────────────────────────┐│
│  │  Editor (monolithic class)               ││
│  │  ┌────────────────────────────────────┐ ││
│  │  │ History Manager (undo/redo)        │ ││
│  │  └────────────────────────────────────┘ ││
│  │  ┌────────────────────────────────────┐ ││
│  │  │ PIXI.Application (canvas renderer) │ ││
│  │  └────────────────────────────────────┘ ││
│  │  ┌────────────────────────────────────┐ ││
│  │  │ FontManager, StringTableManager    │ ││
│  │  │ TextAutoFit, Utilities             │ ││
│  │  └────────────────────────────────────┘ ││
│  │  ┌────────────────────────────────────┐ ││
│  │  │ Signals (pub/sub event system)     │ ││
│  │  └────────────────────────────────────┘ ││
│  └──────────────────────────────────────────┘│
└──────────────┬───────────────────────────────┘
               │ file:// protocol
               │ fs-extra, jimp, fonteditor
               ▼
       ┌──────────────────┐
       │  Project Files   │
       │  ├─ meta_*.json  │
       │  ├─ img/         │
       │  ├─ fonts/       │
       │  ├─ atlases/     │
       │  └─ strings/     │
       └──────────────────┘
```

---

## Integration with Playa-Core

### JSON Layout Descriptor → LayoutService

**Flow:**
1. Editor exports layout to `layout.json`
2. Playa-core's LayoutService reads file
3. Recursively instantiates DisplayObjects:

```javascript
// playa-core/src/services/LayoutService.ts
async loadLayout(descriptorPath: string) {
  const descriptor = JSON.parse(readFileSync(descriptorPath));
  const root = this.buildDisplayTree(descriptor.stages[0]);
  stage.addChild(root);
  
  // Load textures from sprite atlas
  const atlasData = descriptor.atlases[0];
  const spritesheet = new PIXI.Spritesheet(
    PIXI.Texture.from(atlasData.image),
    JSON.parse(readFileSync(atlasData.data))
  );
  await spritesheet.parse();
  
  // Bind textures to layers
  root.getChildByName("reel-1").texture = spritesheet.textures["reel-1.png"];
}
```

### Field-by-Field Runtime Mapping

| Layout Field | Playa-core Property | Type | Example |
|--------------|-------------------|------|---------|
| id | DisplayObject.name | string | "reel-uuid-xxx" |
| name | Internal tracking | string | "reel-1" |
| type | Class instantiation | enum | "layer", "label" |
| x, y | position | number | 100, 200 |
| width, height | bounds | number | 200, 300 |
| scaleX, scaleY | scale | float | 1.0, 1.5 |
| rotation | rotation | radians | 0.785 (45°) |
| alpha | alpha | 0-1 | 0.8 |
| visible | visible | bool | true |
| anchorX, anchorY | pivot | 0-1 | 0.5, 0.5 |
| blendMode | blendMode | string | "multiply" |
| src (layer) | texture | PIXI.Texture | "img/reel-1.png" |
| text (label) | text | string | "WIN: $1000" |
| fontSize | fontSize | number | 48 |
| fontFamily | font | string or BitmapFont | "Arial" or bitmap instance |
| children | addChild | recursive | [{...}] |

---

## Known Limitations & Future Improvements

1. **No collaborative editing:** Single-user only; no conflict resolution
2. **Limited asset versioning:** PSD updates not tracked (old vs new)
3. **Manual baseline management:** Visual regression tests require manual PNG diffs
4. **jQuery legacy:** Old UI code should migrate to vanilla DOM
5. **No TypeScript:** All renderer code in plain JavaScript
6. **Performance:** Large projects (1000+ objects) may lag in tree view
7. **No grid/guides:** Precise alignment requires manual coordinates
8. **Missing layout validation:** No warnings for unsupported property combinations

---

## Mapping to Slot-GDD-Factory Features

| Feature | Layout Tool Support | Notes |
|---------|-------------------|-------|
| **Asset Authoring** | ✓ Full | PSD import, sprite packing, bitmap fonts |
| **Visual Editing** | ✓ Full | Drag-drop, transform handles, hierarchy tree |
| **Real-time Preview** | ✓ Full | PIXI renderer, DOM fallback |
| **Undo/Redo** | ✓ Full | 12 action types, batching heuristic |
| **Multi-layout Support** | ✓ Full | Named stages, string tables, locales |
| **Export Automation** | ○ Partial | JSON + atlas; no CI/CD integration |
| **Version Control** | ○ Minimal | .dat files are plaintext JSON but no git-friendly diffing |
| **Accessibility** | ○ Partial | Micromodal for dialogs; no a11y labels |
| **Extensibility** | ○ Minimal | Lua scripts supported but underdocumented |

