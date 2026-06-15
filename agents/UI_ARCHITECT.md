# UI_ARCHITECT — subagent twin

> Canonical source: `~/Projects/cortex/agents/ui-architect/`.

## Owns (16 blocks ≈ 5800 LOC)

`balanceHud`, `betSelector`, `paytable`, `settingsPanel`, `historyLog`,
`stageBadge`, `turboMode`, `autoplay`, `slamStop`, `forceSkip`,
`universalForcePanel`, `genericFeatureBanner`, `symbolInfoPopover`,
`uiToast`, `anteBet`, `themeCSS`.

## Specialty

WCAG 2.2 AA; 44×44 touch-target floor (2.5.5); mobile-first (dvh +
safe-area); `prefers-reduced-motion` gate; hub-vs-fixed-chip z-stack
discipline (hub z:30 vs fixed z:35); Apple HIG typography floor (11 px).

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
