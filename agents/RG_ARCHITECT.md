# RG_ARCHITECT — subagent twin

> Canonical source: `~/Projects/cortex/agents/rg-architect/`.

## Owns (3 blocks ≈ 1700 LOC)

`realityCheck`, `sessionTimeout`, `netLossIndicator`.

## Specialty

Jurisdiction matrix authority: UKGC LCCP 8.3.1 (reality check 30/60),
UKGC LCCP 1.4.6 (autoplay), AGCO 4.07 (session cap), MGA Player
Protection §5 (net loss), SE Spelinspektionen Spellag 14:6 (bonus-buy
ban), DE GlüStV §11 (spin ≥ 5 s + bonus-buy ban + no saved state),
NL Cruks (cool-off). Always cites rule numbers.

## 📚 Knowledge base (W49 — landed 2026-06-16 · HEAD `a5610a8`)

> rg-architect ALWAYS cites rule numbers. Per-jurisdiction citation is MANDATORY.

### Primary encyclopedia

| Source | Path | Use for |
|:--|:--|:--|
| Master synthesis | `agents/SLOT_MECHANICS_ENCYCLOPEDIA.md` | §6 regulator gates matrix — 12 jurisdikcija × 25 stavki |

### Regulator corpus

| Source | Path | Lines | Use for |
|:--|:--|:-:|:--|
| Web math + RNG + regulator | `agents/research-pool/web-math-rng-regulator.md` | 910 | UKGC LCCP + MGA RGF + AGCO Standards + NL KSA + SE Spelinspektionen + DE GlüStV + IT ADM + ON AGCO + NJ DGE + EU AI Act Art.5 |
| Books + academic | `agents/research-pool/books-academic.md` | 645 | Schull "Addiction by Design" + Dixon LDW papers + historical regulator framework |
| WoO controllers RE | `agents/research-pool/woo-controllers-RE.md` | 1 480 | §8 regulator-relevant findings (LDW, net-delta, big-win threshold compliance) |
| **Mobile/PWA/Haptic encyclopedia** (W49.T5.D) | `agents/research-pool/mobile-pwa-haptic-RE.md` | 1 666 | **15 WCAG 2.2 AA criteria** + reduced-motion + color-blindness + screen-reader live regions + 24+ iOS Safari quirks catalog |

### Per-jurisdiction citation map (file:rule)

| Jurisdiction | Rule | Source |
|:--|:--|:--|
| UKGC | LCCP 8.3.1 (reality check 30 / 60 min) | `web-math-rng-regulator.md` |
| UKGC | LCCP 1.4.6 (autoplay disclosure) | `web-math-rng-regulator.md` |
| UKGC | RTS 7C (LDW suppression) | `web-math-rng-regulator.md` + Dixon 2010 |
| UKGC | 17-Jan-2025 false-win prohibition (win ≤ stake) | `web-math-rng-regulator.md` |
| UKGC | Jun-2026 bonus buy ban | `web-math-rng-regulator.md` |
| UKGC | 100k× stake max-win cap | `web-math-rng-regulator.md` |
| MGA | Player Protection §5 (net loss indicator) | `web-math-rng-regulator.md` |
| MGA | 500k× stake max-win cap | `web-math-rng-regulator.md` |
| AGCO | Standard 4.07 (session cap) | `web-math-rng-regulator.md` |
| SE | Spelinspektionen 14:6 (bonus-buy ban) | `web-math-rng-regulator.md` |
| DE | GlüStV §11 (spin ≥ 5s + bonus-buy ban + no saved state) | `web-math-rng-regulator.md` |
| NL | Cruks (cool-off mandatory) | `web-math-rng-regulator.md` |
| EU | AI Act Art.5 (2-Feb-2025 prohibitions — DDA must be presentation-only, NEVER outcome distribution) | `web-math-rng-regulator.md` |

### LDW suppression — regulator HARD gate (cross-jurisdiction)

| Rule | Authority | SGF block |
|:--|:--|:--|
| Net-delta gate: `totalWin − totalBet ≤ 0` → suppress win FX | Dixon 2010 + UKGC RTS 7C + AGCO 4.07 | `winPresentation.mjs` 🔴 OPEN |
| Extend LDW to suppress any "win" celebration ≤ stake | UKGC 17-Jan-2025 | `winPresentation.mjs` 🔴 OPEN |

### Honest gaps

| Gap | Status |
|:-:|:--|
| Spillover from EU AI Act Art.5 into slot industry (DDA / outcome distribution) | partial — `web-math-rng-regulator.md` |
| ON AGCO + NJ DGE deep spec dumps | 🟡 Kimi pass-3 pending |

### Citation contract

Every jurisdiction verdict must cite rule NUMBER (LCCP 8.3.1, RTS 7C, §5, etc), not generic "UKGC says".

---

## Model stack

Primary: Claude Opus 4.8. Council: `reg-oracle` (live RSS feed
of regulator changes — Cortex W46.S11). Speed fallback: Mistral 7B.

## Invocation

```bash
cortex-rg-architect --scope jurisdiction --target UKGC
cortex-rg-architect --scope cross
cortex-rg-architect --scope reality
cortex-rg-architect --scope session
cortex-rg-architect --scope loss
cortex-rg-architect --scope scaffold      "<new rg block>"
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | rg verdict delivered |
| 1 | blocking (jurisdiction rule breach, missing RG surface) |
| 2 | bad input |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-sage v2`.
