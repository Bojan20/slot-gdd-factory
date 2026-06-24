import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/sessionLevelMeter.mjs
 *
 * Wave LEGO-PROG (DEF1 · 2/3) — Visible XP / level progress meter.
 *
 * @module sessionLevelMeter
 *
 * Purpose:
 *   HUD widget (top-left, below ante-bet dock) that mirrors
 *   `window.__PLAYER_XP__`. Renders horizontal progress bar from
 *   current XP to next level threshold, with numeric label and
 *   current level chip ("LVL 3 · 240/500"). Updates on
 *   `onPlayerXpGained` events from playerXp.mjs.
 *
 * Industry-reference (vendor-neutral):
 *   Visible XP progression bars are the standard surface for
 *   session-XP systems. Industry baseline: top-left or bottom-corner
 *   HUD widget, animated fill, persistent level chip + xp/target
 *   numeric label. role=progressbar + aria-valuetext is the WCAG
 *   pattern.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitSessionLevelMeterCSS(cfg)            → CSS string (HUD widget)
 *   emitSessionLevelMeterMarkup(cfg)         → HTML string
 *   emitSessionLevelMeterRuntime(cfg)        → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onPlayerXpGained  — re-render fill + label
 *                onPlayerLevelUp   — flash + bump level chip
 *   emits:       — (passive renderer; emits visualization-only events
 *                   if upstream blocks need them via UI bus, none
 *                   surfaced today)
 *
 * a11y / perf:
 *   • role="progressbar" + aria-valuenow + aria-valuemin + aria-valuemax
 *   • aria-valuetext = "Level 3 — 240 of 500 XP"
 *   • prefers-reduced-motion: instant fill (no transition)
 *   • Tokens hoisted (0 magic numbers)
 *   • Level-up flash class for 600ms then auto-clears
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  topPad:           58,            /* clears ante-bet + ladder dock at top 14 + 24 height */
  topPadMobile:     50,
  leftPad:          14,
  leftPadMobile:    10,
  zIndex:           58,
  widgetWidth:      180,
  widgetWidthMobile:140,
  widgetPadV:       6,
  widgetPadH:       10,
  barHeight:        8,
  barRadius:        4,
  borderRadius:     12,
  fontRem:          0.74,
  fontRemMobile:    0.66,
  fillTransitionMs: 320,
  flashMs:          600,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'LVL',
    color:    '#7fffd4',
    colorDark: '#205045',
    haloRGB:  '127,255,212',
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('sessionLevelMeter', defaultConfig(), model) };
  const m = model.sessionLevelMeter || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('sessionLevelMeter', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 8) cfg.label = m.label;
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;
  if (typeof m.haloRGB === 'string' && RGB_RE.test(m.haloRGB)) cfg.haloRGB = m.haloRGB;

  /* Auto-enable when playerXp is enabled (complementary HUD). */
  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'player_xp' || f.kind === 'session_xp' ||
                               f.kind === 'session_level_meter' || f.kind === 'player_progression')) {
    const ctxOverride = applyGridProfile('sessionLevelMeter', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitSessionLevelMeterCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── session level meter HUD ───────────────────────────────────── */
.session-level-meter {
  position: fixed;
  top: max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px));
  left: max(${T.leftPad}px, env(safe-area-inset-left, ${T.leftPad}px));
  z-index: ${T.zIndex};
  width: ${T.widgetWidth}px;
  background: rgba(0,0,0,.62);
  border: 1px solid rgba(${cfg.haloRGB},.45);
  border-radius: ${T.borderRadius}px;
  padding: ${T.widgetPadV}px ${T.widgetPadH}px;
  color: #fff;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  display: flex; flex-direction: column; gap: 4px;
}
.session-level-meter .slm-row {
  display: flex; justify-content: space-between; align-items: baseline;
}
.session-level-meter .slm-label { opacity: 0.85; }
.session-level-meter .slm-level { color: ${cfg.color}; font-weight: 900; }
.session-level-meter .slm-bar {
  position: relative;
  height: ${T.barHeight}px;
  border-radius: ${T.barRadius}px;
  background: rgba(255,255,255,.08);
  overflow: hidden;
}
.session-level-meter .slm-fill {
  position: absolute; top: 0; left: 0; bottom: 0;
  width: 0%;
  background: linear-gradient(90deg, ${cfg.colorDark}, ${cfg.color});
  transition: width ${T.fillTransitionMs}ms cubic-bezier(.4, 0, .2, 1);
  border-radius: ${T.barRadius}px;
}
.session-level-meter .slm-num {
  font-size: 0.66rem;
  opacity: 0.7;
  letter-spacing: 0.04em;
}
.session-level-meter[data-flash="true"] {
  box-shadow: 0 0 0 2px ${cfg.color}, 0 0 24px rgba(${cfg.haloRGB},.7);
}
@media (max-width: 620px) {
  .session-level-meter {
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
    left: max(${T.leftPadMobile}px, env(safe-area-inset-left, ${T.leftPadMobile}px));
    width: ${T.widgetWidthMobile}px;
    font-size: ${T.fontRemMobile}rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .session-level-meter .slm-fill,
  .session-level-meter { transition: none !important; }
}
`;
}

export function emitSessionLevelMeterMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="sessionLevelMeter" class="session-level-meter"
     role="progressbar"
     aria-label="Session level meter"
     aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"
     aria-valuetext="Level 0 — 0 of 100 XP"
     data-flash="false">
  <div class="slm-row">
    <span class="slm-label">${escapeHtml(cfg.label)}</span>
    <span class="slm-level" id="sessionLevelChip">0</span>
  </div>
  <div class="slm-bar">
    <div class="slm-fill" id="sessionLevelFill"></div>
  </div>
  <div class="slm-num" id="sessionLevelNum">0/100 XP</div>
</div>`, 'sessionLevelMeter');
}

export function emitSessionLevelMeterRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* sessionLevelMeter: disabled */`;
  return `/* ─── session level meter runtime ───────────────────────────── */
(function wireSessionLevelMeter(){
  const root  = document.getElementById('sessionLevelMeter');
  const chip  = document.getElementById('sessionLevelChip');
  const fill  = document.getElementById('sessionLevelFill');
  const num   = document.getElementById('sessionLevelNum');
  if (!root || !chip || !fill || !num) return;

  function render() {
    const state = window.__PLAYER_XP__;
    if (!state) return;
    const xp    = state.xp;
    const level = state.level;
    const next  = state.nextThreshold(xp);
    chip.textContent = String(level);
    if (next > 0) {
      const prev = level > 0 ? state.thresholds[level - 1] : 0;
      const span = next - prev;
      const into = xp - prev;
      const pct = Math.max(0, Math.min(100, Math.round((into / span) * 100)));
      fill.style.width = pct + '%';
      num.textContent = xp + '/' + next + ' XP';
      root.setAttribute('aria-valuenow', String(into));
      root.setAttribute('aria-valuemin', '0');
      root.setAttribute('aria-valuemax', String(span));
      root.setAttribute('aria-valuetext', 'Level ' + level + ' — ' + xp + ' of ' + next + ' XP');
    } else {
      fill.style.width = '100%';
      num.textContent = xp + ' XP · MAX';
      root.setAttribute('aria-valuenow', '100');
      root.setAttribute('aria-valuemax', '100');
      root.setAttribute('aria-valuetext', 'Level ' + level + ' (MAX) — ' + xp + ' XP total');
    }
  }

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onPlayerXpGained', render) : void 0);
  HookBus.on('onPlayerLevelUp', function(){
    render();
    root.setAttribute('data-flash', 'true');
    setTimeout(function(){ root.setAttribute('data-flash', 'false'); }, ${TOKENS.flashMs});
  });

  /* Initial paint after runtime mounts (state may not exist yet). */
  setTimeout(render, 0);
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
