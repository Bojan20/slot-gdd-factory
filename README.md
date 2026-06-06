# 🎰 Slot GDD Factory

**One-button GDD → playable slot template.**

Drop any Game Design Document (Markdown / JSON / TXT) — get a working slot
machine open in a browser tab. Math is **placeholder dummy** (uniform reels,
linear paytable). Real math (PAR sheet) is injected later as a hot-swap
layer — *that part not built yet*.

## Status

- ✅ Game GDD upload (MD / TXT / JSON)
- ✅ Theme + symbol + feature extraction from prose
- ✅ Playable slot template opens in new tab (dummy math)
- ⏳ PAR / Math GDD hot-swap injector — next
- ⏳ PDF / DOCX / XLSX parsers — needs server-side bridge
- ⏳ AI feature synthesizer (L2) for unknown features — later

## Run

```bash
# zero-deps, file:// safe
open index.html
```

Then drag-drop a sample GDD from `samples/`.

## Block Playground (Wave Z)

A storybook-style viewer for every LEGO block in `src/blocks/`. Lists 57
blocks grouped by category (engine / wild / multiplier / fs /
round-control / evaluator / feature / ui / audit) with searchable
sidebar, per-block detail panel, `defaultConfig()` snapshot, lifecycle /
emit / export chips, live HookBus event log (when running inside an
active slot tab), quick actions (Copy block JSON / Copy defaultConfig /
Export GDD snippet), and an 18-preset **trigger library** so you can
fire canonical HookBus sequences (`preSpin`, `tumbleStep ×3`, `FS trigger`,
`BigWin MEGA tier`, `Reality Check shown`, etc) with one click.

```bash
# 1) regenerate the manifest after touching anything in src/blocks/*
node tools/gen-block-manifest.mjs

# 2) serve the static playground (any http server will do)
npm run serve                # → http://localhost:5180/blocks/

# 3) (optional) headless regression — 17/17 PASS gate
node tools/cortex-eyes-playground.mjs
```

Hash-routed: deep-link any block via `#<name>` (e.g.
`http://localhost:5180/blocks/#multiplierOrb`). Filter + active block
persist across reload via `localStorage[slot.playground.v1]`.

## Why a separate repo

`slot-math-engine-template` is the heavy CORTEX matični engine — Rust sim,
PAR library, 6507-line studio, certification pipeline. This repo is the
**radically simple front-end** that proves the GDD → playable slot story
in one button click. Both can live forever — they serve different audiences.

## Pipeline

```
   GDD upload  (one button)
        │
        ▼
   ┌────────────┐
   │ GDD Parser │ — regex / table extractor, no LLM
   └─────┬──────┘
         │
         ▼
   ┌────────────┐
   │ Shell Gen  │ — symbols + layout + feature list + dummy math
   └─────┬──────┘
         │
         ▼
   Browser tab opens
        with playable reels
```

## Roadmap

| Phase | What | Status |
|---|---|:--:|
| 1 | One-button GDD upload + slot shell | ✅ |
| 2 | PAR/Math hot-swap injector | ⏳ |
| 3 | PDF/DOCX/XLSX parsers via server bridge | ⏳ |
| 4 | AI feature synthesizer for unknown features | ⏳ |
| 5 | Self-improving registry (AI-generated → human-confirmed → trained) | ⏳ |
