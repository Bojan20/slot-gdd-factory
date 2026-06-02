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
