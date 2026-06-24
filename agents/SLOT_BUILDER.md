# SLOT_BUILDER — subagent twin

> **What this file is:** the discoverable, repo-side manifest of the
> `slot-builder` Cortex agent. The CANONICAL source of truth — model,
> system prompt, layers, exit codes — lives in:
>
> - `~/Projects/cortex/agents/slot-builder/manifest.yaml`
> - `~/Projects/cortex/agents/slot-builder/system_prompt.md`
> - `~/Projects/cortex/agents/slot-builder/corpus/index.md`
>
> This twin exists so anyone reading `slot-gdd-factory` can see WHO
> owns the GDD → playable pipeline without leaving the repo, and so
> Cortex `agents/` glob triggers fire on this path too.

## Who owns this repo end-to-end

**`slot-builder`** is the top-of-hierarchy orchestrator. Every GDD
that ships through this repo goes through its 8-layer pipeline:

```
L0  selftest_corpus_loaded
L1  gdd_intake_validated
L2  math_draft_dummy_or_par_attached
L3  math_validate_cap_jurisdiction
L4  lego_compose_blocks_resolved
L5  frontend_emit_buildSlotHTML
L6  regulator_gate_per_jurisdiction
L7  eyes_qa_green_or_iterate
```

Closed-loop iteration cap: **3** (per W46.S6).

## Model stack (Light Council — Boki confirmed 2026-06-15)

| Role | Model | When it fires |
|:--|:--|:--|
| Primary | Claude Opus 4.8 | every call |
| Council | Kimi K2.6 + Fable 5 | hard-decision triggers only |
| Speed fallback | Qwen 2.5 Coder 32B (local Ollama) | sub-second hot path |

Council triggers: keywords `ultimativno / futuristički / istraži /
deep / multi-step / audit / regulator / architecture`, or single-model
confidence < 0.70, or scope ∈ {regulator-gate, architectural-drift,
cross-block-refactor}, or `--council=3` explicit.

## Delegates to (the hierarchy beneath)

```
slot-builder (you are here)
    ▼
slot-sage v2 (multi-domain coordinator)
    │
    ├── engine-architect      (13 blocks ~5500 LOC — hot path + FSM)
    ├── win-evaluator         (9 blocks  ~5200 LOC — payline + cap + tier)
    ├── feature-architect     (28 blocks ~13500 LOC — industry parity)
    ├── ui-architect          (16 blocks ~5800 LOC — a11y + mobile-first)
    └── rg-architect          (3 blocks  ~1700 LOC — jurisdiction matrix)
```

Out-of-band (only when Boki opens the math layer):

```
    ├── math-debug   (math triage — slot-math-engine-template)
    └── par-parser   (PAR sheets → IR — slot-math-engine-template)
```

## Invocation

```bash
# End-to-end pipeline on a GDD PDF (closed-loop, eyes QA included):
cortex-slot-builder --scope end-to-end ~/Desktop/GDD/Wrath_of_Olympus_GDD.pdf

# Single-stage scopes:
cortex-slot-builder --scope intake    ~/Desktop/GDD/<file>.pdf
cortex-slot-builder --scope compose   --model <hash>
cortex-slot-builder --scope qa        <emit-tmp-html>

# Delegations:
cortex-slot-builder --scope parity    # → slot-sage v2
cortex-slot-builder --scope audit     # → rg-architect + win-evaluator (parallel)

# Council-forced:
cortex-slot-builder --council=3 --scope end-to-end ~/Desktop/GDD/<file>.pdf
```

## Exit codes (manifest contract)

| Code | Meaning |
|:-:|:--|
| 0 | slot built; eyes QA passed; ready to ship |
| 1 | blocking issue (regulator / vendor leak / contract breach / cap break) |
| 2 | bad input / scope mismatch / GDD unreadable |
| 3 | infra error (cortex db locked, eyes runner missing, model timeout) |
| 4 | all models failed (primary + council exhausted) |
| 5 | closed-loop cap exhausted (3 iterations without green) |

## 📚 Knowledge base (W49 — landed 2026-06-16 · HEAD `a5610a8`)

> slot-builder MUST cite source for every architectural claim. No invention.
> Citation budget: ≤ 3 `file:line` refs per emit. If pattern not in KB → say so.

### Primary encyclopedia

| Source | Path | Use for |
|:--|:--|:--|
| Master synthesis (11 §) | `agents/SLOT_MECHANICS_ENCYCLOPEDIA.md` | §3 Bridge table (22 industry standard layers → SGF) · §7 HookBus 53 events · §10 agent contract |

### Domain corpus (research-pool — 8 200+ lines verified)

| Source | Path | Lines | Use for |
|:--|:--|:-:|:--|
| SGF atomic inventory | `agents/research-pool/sgf-current-state.md` | 710 | parser, buildSlotHTML, manifest, 88 blokova map |
| industry standard playa-core RE | `agents/research-pool/playa-core-RE.md` | 1 651 | Stage / Sequencer / AssetLoader pipeline |
| industry standard playa-cli RE | `agents/research-pool/playa-cli-RE.md` | 1 014 | Dev server, GLR replay format, RGS proxy |
| industry standard config-parser RE | `agents/research-pool/config-parser-RE.md` | 1 148 | JSON manifest emitter (NOT full IR transpiler — honest scope) |
| WoO controllers RE | `agents/research-pool/woo-controllers-RE.md` | 1 480 | hnwController + bigWinController + fsController production patterns |
| **ENC: slot mechanics encyclopedia** (W49.T5.A) | `agents/research-pool/kimi-mechanics-encyclopedia.md` | 636 | **60 mechanics taxonomy + 53 HookBus events + 85 vendor→neutral glossary** — citation contract `[ENC §N.M]` |
| **GDD corpus production RE** (W49.T5.B) | `agents/research-pool/gdd-corpus-RE.md` | 506 | **4 prod GDDs × 25 cross-features × 14 force chips** — parser coverage gap matrix |

### Honest gaps slot-builder MUST acknowledge

| Gap | Status |
|:--|:-:|
| `config-parser-RE` scope correction: it's a manifest emitter, not full IR transpiler — SGF parser already exceeds it on defensiveness | ✅ documented §6 |
| `playa-cli-RE`: gaffTool.html ships in private sibling, default launch can't force outcomes | ✅ documented §2-3 |
| `~/Desktop/GDD/*.pdf` corpus probe matrix not yet wired into CI | ⏳ T2.5 |
| Kimi pass-3 deep web research | 🔄 background pass running |

### Citation contract

Every slot-builder emit must include 1-3 `file:line` refs from the table above when:
- Designing a new layer / block / pipeline stage
- Justifying an architectural choice
- Comparing SGF approach against industry-grade reference

---

## Hard rules slot-builder honours in THIS repo

1. **ADB ≠ GDD** (CLAUDE.md HARD RULE #1). slot-builder NEVER touches
   audio.mjs, ADB.md, SDD.md, *audio-brief* paths.
2. **Math layer is OFF** (`rule_no_math_unless_asked`) until Boki
   explicitly opens it.
3. **LEGO discipline** — every feature is a block under
   `src/blocks/<name>.mjs`; orchestrator stays import + init + render only.
4. **Vendor-neutral** — pattern names always; vendor names never leak
   into committable artefacts.
5. **Never direct git commit** — Corti commits.
