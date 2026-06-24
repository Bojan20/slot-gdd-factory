# FEATURE_ARCHITECT — subagent twin

> Canonical source: `~/Projects/cortex/agents/feature-architect/`.

## Owns (34 blocks ≈ 15 200 LOC)

`freeSpins`, `progressiveFreeSpins`, `holdAndWin`,
`holdAndWinCreditBucket`, `bonusBuy`, `bonusBuyDeterministic`,
`bonusPick`, `wheelBonus`, `weightedWheelSegments`, `gamble`,
`gambleSecondary`, `multiplierOrb`, `persistentMultiplier`,
`pathAwareMultiplier`, `expandingWild`, `walkingWild`, `stickyWild`,
`wildReel`, `mysterySymbol`, `superSymbol`, `lightning`, `respin`,
`dailyJackpot`, `symbolUpgrade`, `scatterCelebration`, `anticipation`,
`anticipationUniversal`, `tumble`,
`coinShower`, `mysteryReveal`, `pickBonusReveal`, `rewardChest`,
`symbolStackCollapse`, `wheelBonusReveal`.

### Event-presenter sub-group (W47.S13–S19)

Six post-spin / post-pick / post-tumble reveal blocks landed across
W47. Each listens to a feature-side emit (`onMysteryReveal`,
`onPickResolved`, `onChestOpened`, `onStackCollapse`,
`onWheelLanded`, `onWinCelebrate`) and paints a celebratory placard
without owning game state — strictly presentation siblings of the
core feature blocks they shadow.

## Specialty

Industry parity per pattern (vendor-neutral); regulator gate per
feature (DE bonus-buy ban, UKGC max-win cap, NL persistent state ban);
LEGO discipline (single-owner emit, dedupe); universal force panel
parity (21+ industry kinds).

## 📚 Knowledge base (W49 — landed 2026-06-16 · HEAD `a5610a8`)

> feature-architect MUST cite source for every parity / pattern claim.
> Citation budget: ≤ 3 `file:line` refs per feature recommendation.

### Primary encyclopedia

| Source | Path | Use for |
|:--|:--|:--|
| Master synthesis | `agents/SLOT_MECHANICS_ENCYCLOPEDIA.md` | §4 gap analysis 30+ blokova (wave kandidati) · §5 10 industry patterns · §8 vendor-neutral glossary |

### Feature corpus

| Source | Path | Lines | Use for |
|:--|:--|:-:|:--|
| WoO controllers RE | `agents/research-pool/woo-controllers-RE.md` | 1 480 | Production hnw + bigWin + fs controllers · sticky-pin · tier ladder · cancellation tokens |
| Web mechanics universe | `agents/research-pool/web-slot-mechanics.md` | 1 623 | Cross-vendor feature catalog (industry parity reference) |
| industry standard playa-slot RE | `agents/research-pool/playa-slot-RE.md` | 1 089 | LockAndRespin / WheelBonus / Jackpot / Tumbling industry patterns |
| **ENC: slot mechanics encyclopedia** (W49.T5.A) | `agents/research-pool/kimi-mechanics-encyclopedia.md` | 636 | **60 mechanics + 53 HookBus events + 8 vendor RE case studies** (BTG/Pragmatic/NetEnt/Yggdrasil/Relax/Wazdan/Stake/Evolution) |
| **GDD corpus production RE** (W49.T5.B) | `agents/research-pool/gdd-corpus-RE.md` | 506 | **25 cross-features atlas** — parser coverage gap matrix · `aux_reel_multiplier` (`stormMultiplierReel.mjs`) block proposal |
| **Vendor patents corpus** (W49.T5.C) | `agents/research-pool/vendor-patents-RE.md` | 1 548 | **6 verified patents + 65 honest unverified markers** — BTG NZ 716804 EXPIRED June 2024 (variable-ways open) |

### Feature pattern catalog (file:line bound)

| Pattern | Source | SGF block | Status |
|:--|:--|:--|:-:|
| Sticky-pin Hold&Win (state: IDLE → TRIGGERED → COLLECTING → RESPINNING → AWARDING → EXIT) | `woo-controllers-RE.md` §1 | `holdAndWin.mjs` | ✅ landed, compare contract |
| Big Win 3-tier ladder (10×/25×/50×, NOT 5-tier) — WoO production reality | `woo-controllers-RE.md` §2 | `bigWinTier.mjs` (5-tier default) | ⚠️ schema mismatch — verify which is canonical |
| Atomic credit at finalize (triggerWin escrow + sessionWin commit in single `creditBalance`) | `woo-controllers-RE.md` §1, §3 | `holdAndWinCreditBucket.mjs` | check parity |
| HnW + FS mutually exclusive (HnW grid no scatter, FS reels exclude HnW symbol) | `woo-controllers-RE.md` §4 | invariant check in `slot-sage-v2` | ✅ documented |
| Controller-owned `sessionId` monotonic token (12+ checkpoints) | `woo-controllers-RE.md` §1 race handling | all bonus controllers | refactor candidate |
| LDW (Losses Disguised as Wins) suppression — Dixon 2010 + UKGC RTS 7C | `woo-controllers-RE.md` §8 + `web-math-rng-regulator.md` | `winPresentation.mjs` | 🔴 OPEN gap |

### Honest gaps + anti-patterns flagged

| Issue | Source | Action |
|:--|:--|:--|
| `setForceJackpot` in WoO BYPASSES orb-table generator — violates "force buttons must take real spin" rule | `woo-controllers-RE.md` §1 anti-pattern | ❌ DO NOT copy — SGF must use `runOneBaseSpin()` flag-driven force |
| `ORB_LAND_CHANCE = 0.01` const drift vs sim formula (`0.0352 + fillRatio × 0.015`) | `woo-controllers-RE.md` §1 W1 QA defect | documented for math layer |
| Vendor patent corpus (BTG / Stake / Lock&Win) | 🟡 | Kimi pass-3 background |
| Tier nomenclature: ALWAYS `tier1..tier5` in SGF, NEVER Nice/Epic/Mega/Sensational/BIG WIN/MEGA WIN | HARD RULE #1 | enforce in `winPresentation.mjs` |

### Citation contract

Every feature verdict must cite `file:line` from corpus. No "industry-standard" without specific source.

---

## Model stack

Primary: Claude Opus 4.8. Council: Kimi K2.6 (research depth).
Speed fallback: Qwen 2.5 Coder 32B.

## Invocation

```bash
cortex-feature-architect --scope parity
cortex-feature-architect --scope scaffold     "<new feature pattern>"
cortex-feature-architect --scope regulate     --feature bonusBuy
cortex-feature-architect --scope force
cortex-feature-architect --scope dedupe
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | feature verdict delivered |
| 1 | blocking (regulator gate breach, vendor leak, dupe owner) |
| 2 | bad input |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-sage v2`.
