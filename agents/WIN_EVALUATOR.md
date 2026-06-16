# WIN_EVALUATOR — subagent twin

> Canonical source: `~/Projects/cortex/agents/win-evaluator/`.

## Owns (9 blocks ≈ 5200 LOC)

`paylines`, `paylineOverlay`, `payAnywhereEval`, `clusterPaysEval`,
`waysEval`, `winPresentation`, `winRollup`, `bigWinTier`, `winCap`.

## Specialty

EV correctness + max-win cap enforcement + big-win tier math.
Integrates with `math-debug` when the math layer is opened.
Tier badge thresholds (5×/15×/50×/250×/1000×). Cap per jurisdiction
(UKGC 100k×stake, MGA 500k×stake).

## 📚 Knowledge base (W49 — landed 2026-06-16 · HEAD `a5610a8`)

> win-evaluator MUST cite source for EV / cap / tier claims.
> Math layer remains GATED until Boki opens it — corpus is read-only reference.

### Primary encyclopedia

| Source | Path | Use for |
|:--|:--|:--|
| Master synthesis | `agents/SLOT_MECHANICS_ENCYCLOPEDIA.md` | §6 regulator gates matrix (12 jurisdikcija × 25 stavki — cap rules per UKGC/MGA/AGCO/DE) |

### Evaluator corpus

| Source | Path | Lines | Use for |
|:--|:--|:-:|:--|
| IGT playa-slot RE | `agents/research-pool/playa-slot-RE.md` | 1 089 | `Paytable.ts` IR shape · `RollupComponent.ts` + `RollupState.STOP` gate · `ShowCommand.ts` tier reveal |
| Web math + RNG + regulator | `agents/research-pool/web-math-rng-regulator.md` | 910 | Bărboianu (Mathematics of Slot Machines) · Dixon (PAR sheet research + LDW) · 12 jurisdikcija cap matrix |
| Books + academic | `agents/research-pool/books-academic.md` | 645 | Kassem ch.7 (paytable math) · 21 verified BibTeX |
| WoO controllers RE | `agents/research-pool/woo-controllers-RE.md` | 1 480 | bigWinController tier thresholds (3-tier WoO production: 10×/25×/50×) |
| IGT config-parser RE | `agents/research-pool/config-parser-RE.md` | 1 148 | IR scope correction — manifest emitter, NOT full math IR |
| **GDD corpus production RE** (W49.T5.B) | `agents/research-pool/gdd-corpus-RE.md` | 506 | **4 prod GDD paytable shapes** (paylines / scatter-pays / variable-ways / cluster) — NO RTP numbers per `rule_no_math_unless_asked` |

### Tier ladder reality check

| Authority | Tier count | Thresholds | Source |
|:--|:-:|:--|:--|
| SGF current default | 5 | 10× / 25× / 50× / 200× / 1000× | `bigWinTier.mjs` |
| WoO production v11.27 | 3 | 10× / 25× / 50× | `woo-controllers-RE.md` §2 |
| Regulator floor | varies | UKGC 100k× cap · MGA 500k× cap | `web-math-rng-regulator.md` |

### LDW suppression contract (regulator HARD gate — pre Math layer)

| Rule | Source | SGF block to enforce |
|:--|:--|:--|
| Net-delta gate (`totalWin − totalBet ≤ 0` → suppress win FX) | Dixon 2010 + UKGC RTS 7C + AGCO 4.07 (`web-math-rng-regulator.md`) | `winPresentation.mjs` 🔴 OPEN |
| UKGC 17-Jan-2025 false-win prohibition (extend LDW to any "win" ≤ stake) | `web-math-rng-regulator.md` | `winPresentation.mjs` 🔴 OPEN |

### Honest gaps

| Gap | Status |
|:-:|:--|
| IGT config-parser does NOT carry math IR — looking for shape from `playa-slot 1.3.0` (not present in `~/IGT/`) | ✅ documented `config-parser-RE.md` §7 follow-up |
| Math layer (PAR / RTP / volatility / win cap) GATED per `rule_no_math_unless_asked` | ✅ |
| Kimi pass-3 deep math literature | 🔄 background |

### Citation contract

Every cap / tier / EV verdict must cite `file:line` or academic source (BibTeX). No back-of-envelope.

---

## Model stack

Primary: Claude Opus 4.8. Council: Kimi K2.6 (math paper recall).
Math escalation: `math-debug` subagent.

## Invocation

```bash
cortex-win-evaluator --scope cap            --jurisdiction UKGC
cortex-win-evaluator --scope tier
cortex-win-evaluator --scope ev             --math-state OFF
cortex-win-evaluator --scope presentation
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | win evaluator verdict delivered |
| 1 | blocking (cap breach, EV drift, tier breach) |
| 2 | bad input |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-sage v2`.
