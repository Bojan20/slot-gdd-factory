# V9 — Visual QA Agent

**Status**: production · default provider Claude Opus 4.8 (vision-capable)
**Wave**: UQ-MASTERY
**Lifecycle**: post-V8 assembly, post-build, terminal

## Purpose

V9 is the **eyes** of the pipeline. After V1..V8 produce a slot.html that
SHOULD match the GDD, V9 opens it in Playwright Chromium, takes a
screenshot, and asks an Opus-vision LLM the **single most important
question**:

> *"Does this rendered slot match what the GDD describes — in topology,
> palette, feature chips, and overall presentation?"*

If V9 says NO, the build is gated. V1..V8 might pass every structural
check while still producing a visually wrong game (wrong palette,
overlapping UI, hidden FS trigger badge, missing paytable button on the
hub). V9 catches all of these.

## Inputs

```
┌─────────────────────────────────────┬────────────────────────────────────┐
│ Path                                  │ Role                                │
├─────────────────────────────────────┼────────────────────────────────────┤
│ dist/real-games/<slug>/slot.html      │ Built slot — V9 opens this in browser │
│ dist/real-games/<slug>/gdd.md         │ Parsed GDD as Markdown (V9 reads it) │
│ dist/real-games/<slug>/model.json     │ Canonical model (declared features)  │
│ tools/_eyes/visual-qa/<slug>/*.png    │ V9-captured screenshots (1 per state) │
└─────────────────────────────────────┴────────────────────────────────────┘
```

## States V9 captures (Playwright headless)

```
┌───┬─────────────────────────────┬──────────────────────────────────────┐
│ # │ Snapshot                     │ Trigger                              │
├───┼─────────────────────────────┼──────────────────────────────────────┤
│ 1 │ idle.png                     │ Page load + reels settle             │
│ 2 │ paytable.png                 │ Click `.paytable-btn`                │
│ 3 │ post-spin-win.png            │ Force a winning spin via dev hooks   │
│ 4 │ post-spin-no-win.png         │ Force a losing spin                  │
│ 5 │ fs-intro.png                 │ Force FS via force-fs hook           │
│ 6 │ fs-spin.png                  │ 3rd FS spin (mid-round)              │
│ 7 │ big-win-tier.png             │ Force big-win tier banner            │
│ 8 │ autoplay-disclosure.png      │ Open autoplay → modal                │
│ 9 │ settings-panel.png           │ Click settings cog                   │
│10 │ history-log.png              │ Open history button                  │
└───┴─────────────────────────────┴──────────────────────────────────────┘
```

(For specialty topologies — plinko/wheel/crash/slingo — adjust 3/4/5 to
that engine's spin signature. V9 reads `model.topology.kind` to pick the
correct dev-force hook.)

## Output contract

```json
{
  "wave": "UQ-MASTERY",
  "agent": "V9_VISUAL_QA",
  "verdict": "PASS" | "FAIL" | "WARN",
  "slug": "game-b-6x5-tumble",
  "checks": [
    {
      "name": "topology matches GDD",
      "expected": "6×5 tumble grid",
      "observed": "6 columns × 5 rows visible",
      "verdict": "PASS",
      "evidence": "idle.png"
    },
    {
      "name": "palette matches GDD theme",
      "expected": "Olympus gold + cloud-blue",
      "observed": "gold gradient + light blue accent",
      "verdict": "PASS",
      "evidence": "idle.png"
    },
    {
      "name": "paytable lists every declared symbol",
      "expected": "13 named symbols",
      "observed": "13 rows in modal",
      "verdict": "PASS",
      "evidence": "paytable.png"
    },
    {
      "name": "FS trigger badge visible during FS round",
      "expected": "FS counter chip in hub",
      "observed": "chip absent",
      "verdict": "FAIL",
      "evidence": "fs-spin.png",
      "suggestedFix": "verify stageBadge.mjs onFsTrigger listener"
    }
  ],
  "score": 9.0,                    // of 10
  "summary": "Visually correct in 9/10 states; FS chip regression.",
  "__meta__": { "ts": "...", "model": "claude-opus-4.8", "elapsedMs": 18000 }
}
```

`verdict`:
- **PASS** — all checks PASS, score ≥ 9.0
- **WARN** — score 7.0..8.9, no FAIL, but cosmetic drift
- **FAIL** — any check verdict=FAIL, OR score < 7.0

## LLM prompt template (vision call)

```
SYSTEM: You are a professional slot-game QA auditor. You compare a
rendered slot HTML screenshot against the game's design document (GDD).
You output STRICT JSON matching the V9 output contract — no prose.
Industry-neutral language only (no vendor names).

USER:
GDD excerpts:
  - Title: {model.title}
  - Topology: {model.topology.kind} ({model.topology.reels}×{model.topology.rows})
  - Theme: {model.theme.name} — palette: {model.theme.palette}
  - Declared symbols: {model.symbols.map(s => s.name)}
  - Declared features: {model.features.map(f => f.kind)}
  - Jurisdictions: {model.compliance.jurisdictions}

Screenshots to evaluate (10 images attached):
  1. idle.png — base state
  2. paytable.png — paytable modal open
  ... (rest)

For each of the 10 checks defined in V9_VISUAL_QA.md, produce a row.
Score the overall fidelity 0–10. Output JSON only.
```

## Failure escalation

```
┌──────────────────────────┬─────────────────────────────────────────────┐
│ V9 verdict                │ Action                                       │
├──────────────────────────┼─────────────────────────────────────────────┤
│ PASS                      │ Stamp `__v9_passed__: true` on slot meta;    │
│                           │ unblock commit gate.                          │
│ WARN                      │ Stamp `__v9_warned__: true`; allow commit    │
│                           │ but write to reports/v9-warns.json.           │
│ FAIL                      │ Block commit. Write reports/v9-fails.json.   │
│                           │ Operator sees suggestedFix per check.         │
└──────────────────────────┴─────────────────────────────────────────────┘
```

## Why a separate agent (not part of verify gate)

The verify gate is FAST (<5s). V9 takes 15-30s per game because it
launches Chromium and makes an Opus vision call. V9 is opt-in:

- **Pre-merge**: `npm run v9 -- --slug=<game>` — run for the one game
  being changed.
- **Pre-release**: `npm run v9:all` — run for all 5 main games (cost
  ~$0.25, time ~3 min).
- **Pre-commit**: NOT run by default. Operator decides per branch.

The verify gate's 22 steps STILL run on every commit, all under 50s.
V9 is the "extra mile" before merging to main.

## Cost model

```
┌─────────────────────────┬───────────────────────────────────────────┐
│ Operation                │ Cost                                       │
├─────────────────────────┼───────────────────────────────────────────┤
│ Single-game V9 run       │ ~$0.05 (1 vision call w/ 10 imgs ≤ 1080p)  │
│ 5 main games full sweep  │ ~$0.25                                     │
│ Self-correction loop ×2  │ ~$0.10 (2nd call only if FAIL with fix tx) │
└─────────────────────────┴───────────────────────────────────────────┘
```

## Self-correction loop

When V9 verdict = FAIL with a `suggestedFix`, V9 can:
1. Apply the fix programmatically (if it maps to a known patch — e.g.
   "stageBadge.mjs onFsTrigger" → add the listener).
2. Re-build the slot HTML.
3. Re-run V9 once.
4. If still FAIL → escalate to operator (no further auto-attempts).

Currently auto-fix is OFF (visual fixes need human sign-off). Activate
per-game with `--auto-fix --confirm`.

## Provenance

- Author: Corti (Claude Opus 4.8) — sole owner
- First push: 2026-06-21 — UQ-MASTERY wave
- Tool: `tools/v9-visual-qa.mjs`
- Gate: opt-in (not blocking pre-commit, blocking pre-release)
- Mastery: Boki: *"da AI savršeno pravi sve što treba, i ako treba da napravis jos neke agente"*
