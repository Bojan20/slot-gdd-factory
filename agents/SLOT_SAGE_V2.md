# SLOT_SAGE_V2 — subagent twin

> Canonical source: `~/Projects/cortex/agents/slot-sage-v2/` (manifest +
> system prompt). This twin is the repo-local discoverable.

## Role

**Multi-domain coordinator.** Sits between `slot-builder` (orchestrator)
and the 5 domain architects. Routes, arbitrates, enforces global
LEGO + vendor-neutral invariants.

NEVER edits blocks. Coordinates.

## Domain ownership matrix (canonical — memorise)

| Architect | Blocks |
|:--|:--|
| engine-architect | hookBus, reelEngine, reelEngineCSS, hexReelEngine, wheelSpinEngine, crashSpinEngine, plinkoSpinEngine, slingoSpinEngine, spinControl, spinTempo, postSpin, hotReload, triggerCounting |
| win-evaluator | paylines, paylineOverlay, payAnywhereEval, clusterPaysEval, waysEval, winPresentation, winRollup, bigWinTier, winCap |
| feature-architect | freeSpins, progressiveFreeSpins, holdAndWin, holdAndWinCreditBucket, bonusBuy, bonusBuyDeterministic, bonusPick, wheelBonus, weightedWheelSegments, gamble, gambleSecondary, multiplierOrb, persistentMultiplier, pathAwareMultiplier, expandingWild, walkingWild, stickyWild, wildReel, mysterySymbol, superSymbol, lightning, respin, dailyJackpot, symbolUpgrade, scatterCelebration, anticipation, anticipationUniversal, tumble |
| ui-architect | balanceHud, betSelector, paytable, settingsPanel, historyLog, stageBadge, turboMode, autoplay, slamStop, forceSkip, universalForcePanel, genericFeatureBanner, symbolInfoPopover, uiToast, anteBet, themeCSS |
| rg-architect | realityCheck, sessionTimeout, netLossIndicator |

## 📚 Knowledge base (W49 — landed 2026-06-16 · HEAD `a5610a8`)

> slot-sage v2 MUST cite source for every arbitration verdict. No invention.

### Primary encyclopedia

| Source | Path | Use for |
|:--|:--|:--|
| Master synthesis | `agents/SLOT_MECHANICS_ENCYCLOPEDIA.md` | §1 5 HARD RULES (vendor ban / ADB≠GDD / LEGO / cell-never-mutated / force=real-spin) · §8 Glossary (industry → vendor-neutral) · §10 agent contract |

### Domain corpus

| Source | Path | Lines | Use for arbitration |
|:--|:--|:-:|:--|
| SGF atomic inventory | `agents/research-pool/sgf-current-state.md` | 710 | 88 blokova × ownership map · LEGO single-owner validation |
| Web mechanics universe | `agents/research-pool/web-slot-mechanics.md` | 1 623 | cross-vendor pattern arbitration |
| IGT playa-slot RE | `agents/research-pool/playa-slot-RE.md` | 1 089 | industry domain layer reference |

### Vendor-neutral glossary (HARD RULE #1 enforcement)

| Industry term | Vendor-neutral SGF term | Source |
|:--|:--|:--|
| Lightning Link / Hold-and-Spin | `holdAndWin` (state machine: TRIGGERED → COLLECTING → RESPINNING → AWARDING → EXIT) | encyclopedia §8 |
| Megaways (BTG, expired 2024) | `variable_ways` engine kind | encyclopedia §4 |
| Nice / Epic / Mega / Sensational | `tier1..tier5` | HARD RULE #1 + woo-controllers-RE §2 |
| BIG WIN / MEGA WIN | `bigWinTier` block emit | woo-controllers-RE §2 |

### Honest gaps

| Gap | Status |
|:-:|:--|
| Vendor patent corpus (BTG / Stake / Lock&Win) | 🟡 Kimi pass-3 background |

### Citation contract

Every parity-merge / invariant-sweep verdict must cite `file:line` or encyclopedia §.

---

## Invocation

```bash
cortex-slot-sage-v2 --scope arbitrate    "<conflict description>"
cortex-slot-sage-v2 --scope route        "<ambiguous request>"
cortex-slot-sage-v2 --scope invariant    # global LEGO + vendor sweep
cortex-slot-sage-v2 --scope parity-merge # merge architect parity reports
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | coordination complete |
| 1 | blocking domain conflict; Boki escalation needed |
| 2 | bad input / scope mismatch |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-builder`.
