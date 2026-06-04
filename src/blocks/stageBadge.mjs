/**
 * Slot GDD Factory · stageBadge BLOCK
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
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  baseLabel: 'BASE GAME',
  fsLabel: 'FREE SPINS',
  gold: '255,214,110',
  pulseMs: 1600,
  mobileBreakpoint: 620,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function isValidRGB(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isPlainText(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 40 && !/[<>{}]/.test(s);
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.stageBadge) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (isPlainText(src.baseLabel)) cfg.baseLabel = src.baseLabel;
  if (isPlainText(src.fsLabel))   cfg.fsLabel = src.fsLabel;
  if (isValidRGB(src.gold))       cfg.gold = src.gold;
  if (typeof src.pulseMs === 'number' && src.pulseMs >= 200 && src.pulseMs <= 10000) {
    cfg.pulseMs = Math.floor(src.pulseMs);
  }
  if (typeof src.mobileBreakpoint === 'number' && src.mobileBreakpoint >= 320 && src.mobileBreakpoint <= 1200) {
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
  gap: 7px;
  padding: 3px 12px 3px 10px;
  border-radius: 999px;
  background: rgba(15, 12, 10, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 2.2px;
  text-transform: uppercase;
  color: rgba(197, 198, 199, 0.78);
  backdrop-filter: blur(4px);
  pointer-events: none;
  user-select: none;
  transition: color .35s ease, background .35s ease, border-color .35s ease;
}
.stage-badge__dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.7;
  transition: background .35s ease, box-shadow .35s ease, opacity .35s ease;
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
  0%, 100% { transform: scale(1);    box-shadow: 0 0 6px  rgba(${c.gold}, 0.55); }
  50%      { transform: scale(1.25); box-shadow: 0 0 14px rgba(${c.gold}, 1);    }
}
@media (max-width: ${c.mobileBreakpoint}px) {
  .stage-badge { font-size: 0.55rem; padding: 2px 10px 2px 8px; letter-spacing: 1.8px; gap: 6px; }
  .stage-badge__dot { width: 5px; height: 5px; }
}
@media (prefers-reduced-motion: reduce) {
  .stage-badge[data-stage="fs"] .stage-badge__dot { animation: none; }
}
`;
}

export function emitStageBadgeMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ stageBadge: cfg });
  if (!c.enabled) return '';
  return `<div class="stage-badge" id="stageBadge" data-stage="base" aria-live="polite">
      <span class="stage-badge__dot" aria-hidden="true"></span>
      <span class="stage-badge__label" id="stageBadgeLabel">${esc(c.baseLabel)}</span>
    </div>`;
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
     suspenders so a future refactor that drops them won't break the pill. */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('onFsTrigger', () => {
      setStageBadge('fs', STAGE_FS_LABEL);
    }, { priority: 10 });
    /* On FS end, the outro placard is still showing — keep the pill in 'fs'
       state until FSM_enterBase flips it back. We only ensure the label is
       in sync (in case a GDD override changed it mid-round). */
    HookBus.on('onFsEnd', () => {
      if (stageBadge && stageBadge.dataset.stage === 'fs') {
        if (stageBadgeLabel) stageBadgeLabel.textContent = STAGE_FS_LABEL;
      }
    }, { priority: 10 });
  }
`;
}
