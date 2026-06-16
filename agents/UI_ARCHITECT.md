# UI_ARCHITECT — subagent twin

> Canonical source: `~/Projects/cortex/agents/ui-architect/`.

## Owns (25 blocks ≈ 7660 LOC)

`balanceHud`, `betSelector`, `paytable`, `settingsPanel`, `historyLog`,
`stageBadge`, `turboMode`, `autoplay`, `slamStop`, `forceSkip`,
`universalForcePanel`, `genericFeatureBanner`, `symbolInfoPopover`,
`uiToast`, `anteBet`, `themeCSS`,
`fsProgressBar`, `winwaysIndicator`, `multiplierLadder`, `stickyMeter`,
`energyMeter`, `hapticFeedback`, `rtlLayout`, `pwaInstallability`, `i18n`.

### HUD / meter sub-group (W47.S7–S15)

Five side-feature HUD chips landed across W47: persistent climbing
counters, progress bars, and metered gauges that paint on the play
surface but never own engine state. Each respects the same Apple HIG
≥ 11 px floor, 44 × 44 touch target, and `prefers-reduced-motion`
gate as the rest of the UI rail.

## Specialty

WCAG 2.2 AA; 44×44 touch-target floor (2.5.5); mobile-first (dvh +
safe-area); `prefers-reduced-motion` gate; hub-vs-fixed-chip z-stack
discipline (hub z:30 vs fixed z:35); Apple HIG typography floor (11 px).

## 📚 Knowledge base (W49 — landed 2026-06-16 · HEAD `a5610a8`)

> ui-architect MUST cite source for every a11y / mobile / motion verdict.
> Citation budget: ≤ 3 `file:line` refs or WCAG SC numbers per emit.

### Primary encyclopedia

| Source | Path | Use for |
|:--|:--|:--|
| Master synthesis | `agents/SLOT_MECHANICS_ENCYCLOPEDIA.md` | §7 HookBus 53 events (UI listener catalog) · §8 vendor-neutral terminology |

### UI corpus

| Source | Path | Lines | Use for |
|:--|:--|:-:|:--|
| SGF atomic inventory | `agents/research-pool/sgf-current-state.md` | 710 | 25 UI blokova ownership + typography floor (≥ 11 px Apple HIG) + touch target (≥ 44 × 44 WCAG SC 2.5.5) |
| IGT playa-core RE | `agents/research-pool/playa-core-RE.md` | 1 651 | PIXI 7.3 + React 18 + @pixi/ui pipeline reference |
| WoO reels RE | `agents/research-pool/woo-reels-RE.md` | 1 237 | `prefers-reduced-motion` GAP in BOTH — open opportunity |
| IGT layout_tool RE | `agents/research-pool/layout-tool-RE.md` | 998 | Electron 9 + PIXI 6 layout authoring (PSD → JSON) — reference, NOT for adoption |

### A11y / mobile pattern catalog

| Pattern | SC / standard | SGF status | Source |
|:--|:--|:-:|:--|
| Touch target ≥ 44 × 44 CSS px | WCAG 2.2 AA SC 2.5.5 | ✅ enforced (Wave K5) | `sgf-current-state.md` |
| Typography ≥ 11 px (Apple HIG floor) | Apple HIG | ✅ enforced (Wave UQ) | `sgf-current-state.md` |
| `prefers-reduced-motion` media query gate | WCAG 2.2 AA SC 2.3.3 | partial — block-by-block | both gaps in WoO + SGF per `woo-reels-RE.md` §7 |
| `100dvh` instead of `100vh` (iOS URL bar) | iOS Safari 15.4+ | ✅ enforced (Wave D3) | `sgf-current-state.md` |
| `env(safe-area-inset-*)` for notch / home indicator | iOS 11+ / CSS Env-1 | ✅ enforced | `sgf-current-state.md` |
| Hub z:30 vs fixed-chip z:35 stacking | WCAG SC 2.4.11 focus-not-obscured | ✅ enforced | `sgf-current-state.md` |
| `aria-live="polite"` for win counters / banners | WCAG 2.2 AA SC 4.1.3 | ✅ partial | `sgf-current-state.md` |
| Keyboard nav (Tab + Enter + Space) for SPIN | WCAG 2.2 AA SC 2.1.1 | ✅ enforced (Wave A2) | `sgf-current-state.md` |
| RTL layout (Arabic / Hebrew jurisdictions) | CSS Logical Properties | ✅ enforced (Wave A5) | `sgf-current-state.md` |
| PWA installability (manifest + service worker) | Web App Manifest spec | ✅ enforced (Wave A8) | `sgf-current-state.md` |
| Haptic feedback (iOS Haptic API + Android Vibration) | iOS / Android API | ✅ enforced (Wave A10) | `sgf-current-state.md` |

### Honest gaps

| Gap | Status |
|:-:|:--|
| iOS Haptic API + Android VibrationEffect deep API reference | 🟡 Kimi pass-3 pending |
| WCAG 2.2 AA + dvh + safe-area deep spec dump | 🟡 Kimi pass-3 pending |

### Citation contract

Every a11y verdict must cite WCAG SC number OR `file:line` from corpus.

---

## Model stack

Primary: Claude Opus 4.8 (vision — screenshot crits direct).
Council: GPT-5 (a11y deep). Speed fallback: Qwen 2.5 Coder 32B.

## Invocation

```bash
cortex-ui-architect --scope a11y
cortex-ui-architect --scope touch
cortex-ui-architect --scope motion
cortex-ui-architect --scope z-stack
cortex-ui-architect --scope typography
cortex-ui-architect --scope mobile
cortex-ui-architect --scope force-panel
cortex-ui-architect --scope scaffold     "<new ui block>"
```

## Exit codes

| Code | Meaning |
|:-:|:--|
| 0 | ui verdict delivered |
| 1 | blocking (a11y breach, touch floor, z-stack conflict) |
| 2 | bad input |
| 3 | infra error |
| 4 | all models failed |

## Reports up to

`slot-sage v2`.
