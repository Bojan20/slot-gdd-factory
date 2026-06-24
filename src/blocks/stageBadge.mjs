import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * Slot GDD Factory · stageBadge BLOCK
 *
 * Performance budget: ≤1 active animation; backdrop-filter limited to header
 * pill; runtime <0.5KB minified.
 *
 * Live indicator pill in the header showing the current game phase. Sits
 * between `.title` (brand) and `.sub` (layout descriptor) so the visual
 * hierarchy reads: brand → live state → structure. Pointer-events off,
 * purely informational, `aria-live="polite"` for screen readers.
 *
 * Visual states (driven by `data-stage` attribute):
 *   base   → muted gray-cyan pill, dot static
 *   fs     → gold gradient pill, dot pulsing 1.6s ease (reduced-motion gated)
 *   (extensible — drop in another `data-stage="..."` block and pass a new
 *    pair to `setStageBadge(stage, label)` for buy-feature / hold&win etc)
 *
 * GDD-driven configuration (consumed from `model.stageBadge`):
 *   enabled          boolean                                  (default true)
 *   baseLabel        string — label for BASE phase            (default "BASE GAME")
 *   fsLabel          string — label for FS phase              (default "FREE SPINS")
 *   gold             "r,g,b" string — FS pill accent color    (default "255,214,110")
 *   pulseMs          number — FS dot pulse duration           (default 1600)
 *   mobileBreakpoint number px — small viewport breakpoint    (default 620)
 *
 * Public API (server-side, ES module):
 *   defaultConfig()                    → safe defaults
 *   resolveConfig(model)               → merge defaults with GDD override
 *   emitStageBadgeCSS(config)          → CSS string (pill + keyframes)
 *   emitStageBadgeMarkup(config)       → HTML fragment for the header slot
 *   emitStageBadgeRuntime(config)      → runtime JS (setStageBadge helper)
 *
 * Runtime contract:
 *   setStageBadge(stage, label)        → updates the pill phase + text
 *
 * Runtime dependencies: a DOM with `#stageBadge` + `#stageBadgeLabel`
 * (provided by emitStageBadgeMarkup output).
 *
 * Wave Legacy · industry baseline (vendor-neutral). Original block predates the
 * formal Wave Hxx naming + JSDoc kontrakt header pattern (auto-tagged by
 * tools/cortex-block-mega-fix.mjs).
 */

const PULSE_MIN_MS = 200;
const PULSE_MAX_MS = 10000;
const BREAKPOINT_MIN = 320;
const BREAKPOINT_MAX = 1200;
const LABEL_MAX_LEN = 40;
const HOOK_PRIORITY = 10;

const DEFAULTS = Object.freeze({
  enabled: true,
  baseLabel: 'BASE GAME',
  fsLabel: 'FREE SPINS',
  gold: '255,214,110',
  pulseMs: 1600,
  mobileBreakpoint: 620,
  pillGap: 7,
  pillPaddingTop: 3,
  pillPaddingRight: 12,
  pillPaddingBottom: 3,
  pillPaddingLeft: 10,
  /* WCAG AAA (F4 A1) — was alpha 0.78 + bg 0.45 = 2.3:1 (FAIL).
   * Lifted to FG alpha 1.0 + bg 0.85 = 7.4:1 (AAA pass) for muted state pill. */
  mutedColor: '220,220,220',
  mutedColorAlpha: 1.0,
  mutedBgColor: '15,12,10',
  mutedBgAlpha: 0.85,
  mutedBorderAlpha: 0.08,
  blurAmount: 4,
  dotSize: 6,
  dotSizeMobile: 5,
  pulseScale: 1.25,
  shadowMinRadius: 6,
  shadowMaxRadius: 14,
  letterSpacing: 2.2,
  letterSpacingMobile: 1.8,
  mobileGap: 6,
  mobilePaddingTop: 2,
  mobilePaddingRight: 10,
  mobilePaddingLeft: 8,
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function isValidRGB(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isPlainText(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= LABEL_MAX_LEN && !/[<>{}]/.test(s);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.stageBadge) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (isPlainText(src.baseLabel)) cfg.baseLabel = src.baseLabel;
  if (isPlainText(src.fsLabel))   cfg.fsLabel = src.fsLabel;
  if (isValidRGB(src.gold))       cfg.gold = src.gold;
  if (typeof src.pulseMs === 'number' && src.pulseMs >= PULSE_MIN_MS && src.pulseMs <= PULSE_MAX_MS) {
    cfg.pulseMs = Math.floor(src.pulseMs);
  }
  if (typeof src.mobileBreakpoint === 'number' && src.mobileBreakpoint >= BREAKPOINT_MIN && src.mobileBreakpoint <= BREAKPOINT_MAX) {
    cfg.mobileBreakpoint = Math.floor(src.mobileBreakpoint);
  }
  return cfg;
}

/* HTML escape — defends fsLabel/baseLabel against injection if a GDD author
   sneaks unusual punctuation past isPlainText. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[ch]));
}

export function emitStageBadgeCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ stageBadge: cfg });
  if (!c.enabled) return `\n/* stageBadge BLOCK (disabled by GDD) — no CSS emitted */\n`;
  return `
/* ── stageBadge BLOCK — emitted by src/blocks/stageBadge.mjs ──────────────
   GDD knobs (baked at build time):
     baseLabel        = ${JSON.stringify(c.baseLabel)}
     fsLabel          = ${JSON.stringify(c.fsLabel)}
     gold             = ${c.gold}
     pulseMs          = ${c.pulseMs}
     mobileBreakpoint = ${c.mobileBreakpoint}
   Live indicator pill — purely informational, pointer-events off, aria-live
   polite. data-stage attribute drives palette + pulse animation. */
.stage-badge {
  display: inline-flex;
  align-items: center;
  gap: ${c.pillGap}px;
  padding: ${c.pillPaddingTop}px ${c.pillPaddingRight}px ${c.pillPaddingBottom}px ${c.pillPaddingLeft}px;
  border-radius: 999px;
  background: rgba(${c.mutedBgColor}, ${c.mutedBgAlpha});
  border: 1px solid rgba(255, 255, 255, ${c.mutedBorderAlpha});
  /* Wave UQ — typography floor 11px (Apple HIG min readable). */
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: ${c.letterSpacing}px;
  text-transform: uppercase;
  color: rgba(${c.mutedColor}, ${c.mutedColorAlpha});
  backdrop-filter: blur(${c.blurAmount}px);
  pointer-events: none;
  user-select: none;
  transition: color .35s ease, background .35s ease, border-color .35s ease;
}
.stage-badge__dot {
  width: ${c.dotSize}px; height: ${c.dotSize}px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.7;
  transition: background .35s ease, box-shadow .35s ease, opacity .35s ease;
}
.stage-badge__label {
  display: inline-block;
}
.stage-badge[data-stage="fs"] {
  color: rgba(${c.gold}, 1);
  background: rgba(40, 30, 16, 0.65);
  border-color: rgba(${c.gold}, 0.5);
}
.stage-badge[data-stage="fs"] .stage-badge__dot {
  background: rgba(${c.gold}, 1);
  opacity: 1;
  box-shadow: 0 0 8px rgba(${c.gold}, 0.85);
  animation: stage-badge-pulse ${c.pulseMs}ms ease-in-out infinite;
}
@keyframes stage-badge-pulse {
  0%, 100% { transform: scale(1);         box-shadow: 0 0 ${c.shadowMinRadius}px  rgba(${c.gold}, 0.55); }
  50%      { transform: scale(${c.pulseScale}); box-shadow: 0 0 ${c.shadowMaxRadius}px rgba(${c.gold}, 1);    }
}
@media (max-width: ${c.mobileBreakpoint}px) {
  /* Wave UQ — mobile floor 11px (matches desktop, no shrink below readable). */
  .stage-badge { font-size: 0.7rem; padding: ${c.mobilePaddingTop}px ${c.mobilePaddingRight}px ${c.mobilePaddingTop}px ${c.mobilePaddingLeft}px; letter-spacing: ${c.letterSpacingMobile}px; gap: ${c.mobileGap}px; }
  .stage-badge__dot { width: ${c.dotSizeMobile}px; height: ${c.dotSizeMobile}px; }
}
@media (prefers-reduced-motion: reduce) {
  .stage-badge[data-stage="fs"] .stage-badge__dot { animation: none; }
}
`;
}

export function emitStageBadgeMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ stageBadge: cfg });
  if (!c.enabled) return '';
  return tagBlockMarkup(`<div class="stage-badge" id="stageBadge" data-stage="base" aria-live="polite">
      <span class="stage-badge__dot" aria-hidden="true"></span>
      <span class="stage-badge__label" id="stageBadgeLabel">${esc(c.baseLabel)}</span>
    </div>`, 'stageBadge');
}

export function emitStageBadgeRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ stageBadge: cfg });
  /* When disabled: emit no-op stub so callers that invoke setStageBadge()
     don't crash. */
  if (!c.enabled) {
    return `
  /* ── stageBadge BLOCK (disabled by GDD) ─────────────────────────────── */
  const stageBadge = null;
  const stageBadgeLabel = null;
  function setStageBadge() { /* no-op */ }
  /* Labels still exposed for callers that need them. */
  const STAGE_BASE_LABEL = ${JSON.stringify(c.baseLabel)};
  const STAGE_FS_LABEL   = ${JSON.stringify(c.fsLabel)};
`;
  }
  return `
  /* ── stageBadge BLOCK — emitted by src/blocks/stageBadge.mjs ──────────
     Driver for the live phase indicator pill.
       BASE                                → ${JSON.stringify(c.baseLabel)}    (muted)
       FS_INTRO / FS_ACTIVE / FS_OUTRO     → ${JSON.stringify(c.fsLabel)}    (gold pulse)
     Extensibility: add another data-stage="..." block in CSS and pass a
     new (stage, label) pair here when new game phases are introduced. */
  const stageBadge      = document.getElementById('stageBadge');
  const stageBadgeLabel = document.getElementById('stageBadgeLabel');
  const STAGE_BASE_LABEL = ${JSON.stringify(c.baseLabel)};
  const STAGE_FS_LABEL   = ${JSON.stringify(c.fsLabel)};
  function setStageBadge(stage, label) {
    if (!stageBadge) return;
    stageBadge.dataset.stage = stage;
    if (label && stageBadgeLabel) stageBadgeLabel.textContent = label;
  }

  /* Wave S LEGO conformance — stageBadge registers FS lifecycle listeners
     so the phase pill self-updates without freeSpins.mjs having to call
     setStageBadge directly. The freeSpins call sites remain as belt-and-
     suspenders so a future refactor that drops them won't break the pill.

     W47.S1 fix (2026-06-15) — wrapped the listener registration in a
     self-invoked function so the early-out "return" for the idempotency
     guard (__sbHooked) has a function scope to return from. Pre-fix the
     bare "return" was emitted at the top level of the inline script
     tag and threw "SyntaxError: Illegal return statement", which
     cascaded into HookBus not mounting + tap-preSpin firing 0 events.
     Detected via Playwright CDP "Runtime.exceptionThrown" at line 12748
     col 31 of the emitted HTML.

     NOTE: this comment uses plain quotes (not backticks) because the
     whole runtime body lives inside a template literal in
     emitStageBadgeRuntime() — a stray backtick here would close the
     template literal mid-stream and re-introduce the same syntax
     error class we just fixed. */
  (function _stageBadgeBindFsListeners() {
    if (typeof HookBus === 'undefined') return;
    if (stageBadge.__sbHooked) return;
    stageBadge.__sbHooked = true;
    HookBus.on('onFsTrigger', () => {
      setStageBadge('fs', STAGE_FS_LABEL);
    }, { priority: ${HOOK_PRIORITY} });
    HookBus.on('onBaseEnter', () => {
      setStageBadge('base', STAGE_BASE_LABEL);
    }, { priority: ${HOOK_PRIORITY} });
  })();
`;
}
