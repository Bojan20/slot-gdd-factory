import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/cumulativeMeter.mjs
 *
 * Wave LEGO-COLLECT (B-4 · 2/3) — Session-cumulative HUD meter.
 *
 * @module cumulativeMeter
 *
 * Purpose:
 *   Visible HUD widget (top-right corner default) that mirrors the
 *   `window.__COIN_COLLECT__.sessionTotal` running total from
 *   `coinCollect.mjs`. Renders a horizontal progress bar from current
 *   value toward the next configured threshold, plus a numeric label.
 *   When the meter crosses a threshold, it emits
 *   `onCumulativeMeterThresholdHit` for `collectRevealOverlay.mjs` to
 *   choreograph the award reveal.
 *
 * Industry-reference (vendor-neutral):
 *   The visible progress meter is what makes coin collection feel like
 *   "progress" instead of slot-spin chaos. Industry standard ranges:
 *   3-5 threshold tiers, ascending values (e.g. 50 / 200 / 1000), each
 *   tier paying a configured award. Position: top-right HUD widget,
 *   horizontal bar, animated fill, label format "{current}/{next}".
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitCumulativeMeterCSS(cfg)              → CSS string (HUD widget)
 *   emitCumulativeMeterMarkup(cfg)           → HTML string (HUD host)
 *   emitCumulativeMeterRuntime(cfg)          → runtime JS string for orchestrator
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onCoinCollected — re-render fill + label, threshold check
 *   emits:       onCumulativeMeterThresholdHit { threshold, awardKind, awardValue, tierIndex }
 *                onCumulativeMeterReset        { reason }
 *
 * a11y / perf:
 *   • role="progressbar" with aria-valuenow / aria-valuemin / aria-valuemax
 *     + aria-valuetext = "Coins {n} of {next}".
 *   • prefers-reduced-motion collapses fill transition to instant.
 *   • Tokens hoisted (0 magic numbers).
 *   • Widget is announced as live region — screen readers track meter
 *     progress without polling.
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  widgetTop:        14,
  widgetTopMobile:  10,
  widgetRight:      14,
  widgetRightMobile:10,
  widgetWidth:      180,
  widgetWidthMobile:140,
  widgetPadV:       6,
  widgetPadH:       10,
  barHeight:        8,
  barRadius:        4,
  zIndex:           58,
  fontRem:          0.74,
  fontRemMobile:    0.66,
  fillTransitionMs: 320,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;
const ID_RE  = /^[a-z][a-z0-9_-]{0,15}$/i;

function _defaultThresholds() {
  return Object.freeze([
    Object.freeze({ id: 'bronze', value: 50,   awardKind: 'credit',     awardValue: 25 }),
    Object.freeze({ id: 'silver', value: 200,  awardKind: 'credit',     awardValue: 150 }),
    Object.freeze({ id: 'gold',   value: 1000, awardKind: 'fs_trigger', awardValue: 10 }),
  ]);
}

const AWARD_KINDS = Object.freeze(['credit', 'multiplier', 'scatter', 'fs_trigger']);

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'COINS',
    thresholds: _defaultThresholds(),
    /* Reset behavior on threshold hit:
     *   'full'       — clear meter back to 0 (most common)
     *   'subtract'   — subtract the threshold value, keep overflow
     *   'continue'   — never reset; thresholds awarded once each */
    resetMode: 'subtract',
    color:     '#ffd34a',
    colorDark: '#a07520',
    haloRGB:   '255,211,74',
  });
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function _clampFloat(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function _validateThreshold(raw, idx) {
  const fallback = _defaultThresholds()[Math.min(idx, 2)] || _defaultThresholds()[0];
  return Object.freeze({
    id: ID_RE.test(String(raw && raw.id || '')) ? String(raw.id) : `t${idx}`,
    value: _clampInt(raw.value, 1, 1_000_000, fallback.value),
    awardKind: AWARD_KINDS.includes(String(raw.awardKind)) ? String(raw.awardKind) : fallback.awardKind,
    awardValue: _clampFloat(raw.awardValue, 0, 1_000_000, fallback.awardValue),
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('cumulativeMeter', defaultConfig(), model) };
  cfg.thresholds = cfg.thresholds.slice();
  const m = model.cumulativeMeter || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('cumulativeMeter', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (m.resetMode === 'full' || m.resetMode === 'subtract' || m.resetMode === 'continue') {
    cfg.resetMode = m.resetMode;
  }
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;
  if (typeof m.haloRGB === 'string' && RGB_RE.test(m.haloRGB)) cfg.haloRGB = m.haloRGB;

  if (Array.isArray(m.thresholds) && m.thresholds.length > 0) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < m.thresholds.length && out.length < 8; i++) {
      const v = _validateThreshold(m.thresholds[i] || {}, i);
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
    /* Always sort ascending so threshold-check logic can short-circuit. */
    out.sort((a, b) => a.value - b.value);
    if (out.length > 0) cfg.thresholds = out;
  }

  /* Auto-enable from features[] */
  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'cumulative_meter' || f.kind === 'collect_meter')) {
    const ctxOverride = applyGridProfile('cumulativeMeter', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  cfg.thresholds = Object.freeze(cfg.thresholds);
  return cfg;
}

export function emitCumulativeMeterCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── cumulative meter HUD widget ───────────────────────────────── */
.cumulative-meter {
  position: fixed;
  top: max(${T.widgetTop}px, env(safe-area-inset-top, ${T.widgetTop}px));
  right: max(${T.widgetRight}px, env(safe-area-inset-right, ${T.widgetRight}px));
  z-index: ${T.zIndex};
  width: ${T.widgetWidth}px;
  background: rgba(0,0,0,.62);
  border: 1px solid rgba(${cfg.haloRGB},.45);
  border-radius: 12px;
  padding: ${T.widgetPadV}px ${T.widgetPadH}px;
  color: #fff;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  display: flex; flex-direction: column; gap: 4px;
  box-shadow: 0 4px 18px rgba(0,0,0,.4);
}
.cumulative-meter .meter-row {
  display: flex; justify-content: space-between; align-items: baseline;
}
.cumulative-meter .meter-label { opacity: 0.85; }
.cumulative-meter .meter-value { font-weight: 900; color: ${cfg.color}; }
.cumulative-meter .meter-bar {
  position: relative;
  height: ${T.barHeight}px;
  border-radius: ${T.barRadius}px;
  background: rgba(255,255,255,.08);
  overflow: hidden;
}
.cumulative-meter .meter-fill {
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 0%;
  background: linear-gradient(90deg, ${cfg.colorDark}, ${cfg.color});
  transition: width ${T.fillTransitionMs}ms cubic-bezier(.4, 0, .2, 1);
  border-radius: ${T.barRadius}px;
}
.cumulative-meter .meter-next {
  font-size: 0.66rem;
  opacity: 0.7;
  letter-spacing: 0.04em;
}
@media (max-width: 620px) {
  .cumulative-meter {
    top: max(${T.widgetTopMobile}px, env(safe-area-inset-top, ${T.widgetTopMobile}px));
    right: max(${T.widgetRightMobile}px, env(safe-area-inset-right, ${T.widgetRightMobile}px));
    width: ${T.widgetWidthMobile}px;
    font-size: ${T.fontRemMobile}rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cumulative-meter .meter-fill { transition: none !important; }
}
`;
}

export function emitCumulativeMeterMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const firstNext = cfg.thresholds[0] ? cfg.thresholds[0].value : 0;
  return tagBlockMarkup(`<div id="cumulativeMeter" class="cumulative-meter"
     role="progressbar"
     aria-label="${escapeAttr(cfg.label)} progress meter"
     aria-valuenow="0" aria-valuemin="0" aria-valuemax="${firstNext}"
     aria-valuetext="0 of ${firstNext}">
  <div class="meter-row">
    <span class="meter-label">${escapeHtml(cfg.label)}</span>
    <span class="meter-value" id="cumulativeMeterValue">0</span>
  </div>
  <div class="meter-bar">
    <div class="meter-fill" id="cumulativeMeterFill"></div>
  </div>
  <div class="meter-next" id="cumulativeMeterNext">Next: ${firstNext}</div>
</div>`, 'cumulativeMeter');
}

export function emitCumulativeMeterRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* cumulativeMeter: disabled */`;
  const thresholdsJSON = JSON.stringify(cfg.thresholds.map(t => ({
    id: t.id, value: t.value, awardKind: t.awardKind, awardValue: t.awardValue,
  })));
  return `/* ─── cumulative meter runtime ───────────────────────────────── */
const CM_THRESHOLDS = ${thresholdsJSON};
const CM_RESET_MODE = ${JSON.stringify(cfg.resetMode)};

(function wireCumulativeMeter(){
  const root  = document.getElementById('cumulativeMeter');
  const valEl = document.getElementById('cumulativeMeterValue');
  const fillEl= document.getElementById('cumulativeMeterFill');
  const nextEl= document.getElementById('cumulativeMeterNext');
  if (!root || !valEl || !fillEl || !nextEl) return;

  let claimedIndex = -1; // index of highest threshold already claimed

  function nextThreshold(current) {
    /* In 'continue' mode each threshold pays once. Otherwise rolling. */
    for (let i = 0; i < CM_THRESHOLDS.length; i++) {
      if (CM_RESET_MODE === 'continue' && i <= claimedIndex) continue;
      if (current < CM_THRESHOLDS[i].value) return { idx: i, threshold: CM_THRESHOLDS[i] };
    }
    return null;
  }

  function render(value) {
    const next = nextThreshold(value);
    valEl.textContent = String(value);
    if (next) {
      const pct = Math.min(100, Math.round((value / next.threshold.value) * 100));
      fillEl.style.width = pct + '%';
      nextEl.textContent = 'Next: ' + next.threshold.value;
      root.setAttribute('aria-valuenow', String(value));
      root.setAttribute('aria-valuemax', String(next.threshold.value));
      root.setAttribute('aria-valuetext', value + ' of ' + next.threshold.value);
    } else {
      fillEl.style.width = '100%';
      nextEl.textContent = 'MAX';
      root.setAttribute('aria-valuenow', String(value));
      root.setAttribute('aria-valuetext', value + ' max');
    }
  }

  render(0);

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onCoinCollected', function(payload){
    const total = (payload && Number.isFinite(payload.sessionTotal)) ? payload.sessionTotal :
      (window.__COIN_COLLECT__ ? window.__COIN_COLLECT__.sessionTotal : 0);

    /* Threshold check — fire each newly crossed threshold once. */
    for (let i = 0; i < CM_THRESHOLDS.length; i++) {
      const t = CM_THRESHOLDS[i];
      if (total >= t.value && i > claimedIndex) {
        claimedIndex = i;
        if (typeof HookBus.emit === 'function') {
          HookBus.emit('onCumulativeMeterThresholdHit', {
            threshold: t.value,
            awardKind: t.awardKind,
            awardValue: t.awardValue,
            tierIndex: i,
          });
        }
        if (CM_RESET_MODE === 'full' && window.__COIN_COLLECT__) {
          window.__COIN_COLLECT__.sessionTotal = 0;
          claimedIndex = -1;
          if (typeof HookBus.emit === 'function') {
            HookBus.emit('onCumulativeMeterReset', { reason: 'full_at_' + t.id });
          }
          render(0); return;
        } else if (CM_RESET_MODE === 'subtract' && window.__COIN_COLLECT__) {
          window.__COIN_COLLECT__.sessionTotal -= t.value;
          claimedIndex = -1;
          if (typeof HookBus.emit === 'function') {
            HookBus.emit('onCumulativeMeterReset', { reason: 'subtract_at_' + t.id });
          }
          render(window.__COIN_COLLECT__.sessionTotal); return;
        }
      }
    }
    render(total);
  }) : void 0);
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
