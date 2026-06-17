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

## Block Playground (Wave Z · phase 2)

A storybook-style viewer for every LEGO block in `src/blocks/`. Lists
**122 blocks** grouped by category (engine / wild / multiplier / fs /
round-control / evaluator / feature / ui / audit / compliance) with
searchable sidebar, per-block detail panel, `defaultConfig()` snapshot,
lifecycle / emit / export chips, live HookBus event log, quick actions
(Copy block JSON / Copy defaultConfig / Export GDD snippet), and an
18-preset **trigger library** so you can fire canonical HookBus
sequences (`preSpin`, `tumbleStep ×3`, `FS trigger`, `BigWin MEGA tier`,
`Reality Check shown`, etc) with one click.

**Wave Z.2 (2026-06-17)** adds per-block **live iframe demo**: clicking
a block in the sidebar mounts a minimal slot HTML with that block
force-enabled, and trigger presets fire into the iframe's HookBus so
the block runtime executes in real isolation.

```bash
# 1) regenerate the manifest after touching anything in src/blocks/*
node tools/gen-block-manifest.mjs

# 2) regenerate per-block live demos (122 demos, ~64 MB into blocks/demos/)
npm run gen:demos

# 3) serve the static playground (any http server will do)
npm run serve                # → http://localhost:5180/blocks/

# 4) (optional) headless regression — 17/17 PASS gate
node tools/cortex-eyes-playground.mjs
```

Hash-routed: deep-link any block via `#<name>` (e.g.
`http://localhost:5180/blocks/#multiplierOrb`). Filter + active block
persist across reload via `localStorage[slot.playground.v1]`.

## Audit infrastructure (4 tools)

| Tool | Coverage | Speed |
|:--|:--|:-:|
| `tools/cortex-eyes-block-audit.mjs` | 122 blocks × 12 strict checks | <2s |
| `tools/cortex-gdd-feature-integrity.mjs` | 24 baseline GDD ↔ slot mapping | <5s |
| `tools/cortex-synthetic-308-audit.mjs` | 308 PDF static (parser + build + syntax) | ~25s |
| `tools/cortex-live-308-playwright.mjs` | 308 PDF live Chromium × 4 parallel | ~51s |

Final state (HEAD `2770483`):

- **122/122** strict-compliant blocks (1464/1464 checks pass)
- **336/336** GDDs verified (24 baseline + 308 synthetic + 4 PDF reference)
- **LEGO 7/7** invariants + npm test 20/20 grid fixtures
- **0** vendor leaks, **0** page errors across live render

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
