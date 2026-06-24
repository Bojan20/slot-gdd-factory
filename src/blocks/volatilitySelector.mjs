import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/volatilitySelector.mjs
 *
 * Wave LEGO-VOLATILITY (B-6) — Pre-spin player volatility chooser.
 *
 * @module volatilitySelector
 *
 * Purpose:
 *   When GDD declares `volatility_selector`, this block paints a 3-5
 *   tier choice surface (Low / Medium / High / Ultra default) that
 *   the player can select BEFORE each spin. The selection writes to
 *   `window.VOLATILITY_TIER` so the math layer can pull the matching
 *   PAR strip — same RTP across tiers (~96.5%), different hit-rate +
 *   max-win curve. Industry-standard player-choice surface.
 *
 *   This block is UI + state only. Real PAR strip swap lands with the
 *   PAR hot-swap injector (Phase 2). Until then the selection is a
 *   "visual feel" knob — tier choice does not yet rewrite outcomes.
 *
 * Industry-reference (vendor-neutral):
 *   Player-choice volatility selectors emerged 2023-2025 as a UX
 *   convergence pattern. The chooser sits next to the BET selector
 *   in the spin cluster. Typical labels Low/Med/High and per-tier
 *   subtitle ("Frequent small wins" vs "Rare big wins"). Locked
 *   during bonus rounds so players can't game the trigger model
 *   mid-feature.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitVolatilitySelectorCSS(cfg)           → CSS string
 *   emitVolatilitySelectorMarkup(cfg)        → HTML string
 *   emitVolatilitySelectorRuntime(cfg)       → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onFsTrigger — lock chooser during bonus
 *                onFsEnd     — unlock after bonus
 *   emits:       onVolatilityChanged { tierId, tierIndex, label }
 *
 * a11y / perf:
 *   • role="radiogroup" with role="radio" buttons; Arrow/Home/End
 *     keyboard nav; aria-checked toggling.
 *   • Subtitle "Frequent wins" / "Bigger swings" announced via
 *     aria-describedby for screen readers.
 *   • prefers-reduced-motion honored.
 *   • Tokens hoisted (0 magic numbers).
 *   • Locked state visually muted + pointer-events: none.
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  topPad:           14,
  topPadMobile:     10,
  leftPad:          120,           /* offset to clear top-left ante-bet dock */
  leftPadMobile:    80,
  zIndex:           58,
  padV:             6,
  padH:             10,
  rungGap:          4,
  borderRadius:     12,
  rungRadius:       8,
  fontRem:          0.72,
  fontRemMobile:    0.64,
  subFontRem:       0.6,
  subFontMobile:    0.54,
  mobileBreak:      620,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ID_RE  = /^[a-z][a-z0-9_-]{0,15}$/i;

function _defaultTiers() {
  return Object.freeze([
    Object.freeze({ id: 'low',    label: 'LOW',    subtitle: 'Frequent small wins' }),
    Object.freeze({ id: 'medium', label: 'MED',    subtitle: 'Balanced volatility' }),
    Object.freeze({ id: 'high',   label: 'HIGH',   subtitle: 'Rare big wins' }),
  ]);
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'STYLE',
    tiers: _defaultTiers(),
    /* Index of the tier active on first paint. Almost always 'medium'
     * (the middle of 3 in the default ladder). Clamped against tier count. */
    defaultTierIndex: 1,
    color:     '#7fbfff',
    colorDark: '#205080',
  });
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function _validateTier(raw, idx) {
  const fallback = _defaultTiers()[Math.min(idx, 2)] || _defaultTiers()[0];
  return Object.freeze({
    id: ID_RE.test(String(raw && raw.id || '')) ? String(raw.id) : `tier${idx}`,
    label: (typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 16)
      ? raw.label : fallback.label,
    subtitle: (typeof raw.subtitle === 'string' && raw.subtitle.length <= 64)
      ? raw.subtitle : fallback.subtitle,
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('volatilitySelector', defaultConfig(), model) };
  cfg.tiers = cfg.tiers.slice();
  const m = model.volatilitySelector || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('volatilitySelector', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;

  if (Array.isArray(m.tiers) && m.tiers.length > 0) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < m.tiers.length && out.length < 5; i++) {
      const t = _validateTier(m.tiers[i] || {}, i);
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    if (out.length > 0) cfg.tiers = out;
  }

  /* Single-tier degeneracy — chooser is pointless with one option. */
  if (cfg.enabled && cfg.tiers.length < 2) {
    cfg.enabled = false;
    cfg.collapsedToSingleTier = true;
  }

  cfg.defaultTierIndex = _clampInt(
    Number.isFinite(m.defaultTierIndex) ? m.defaultTierIndex : cfg.defaultTierIndex,
    0, Math.max(0, cfg.tiers.length - 1), 0
  );

  /* Auto-enable from features[] */
  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'volatility_selector' || f.kind === 'volatility_chooser')) {
    const ctxOverride = applyGridProfile('volatilitySelector', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  cfg.tiers = Object.freeze(cfg.tiers);
  return cfg;
}

export function emitVolatilitySelectorCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── volatility selector ───────────────────────────────────────── */
.volatility-selector {
  position: fixed;
  top: max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px));
  left: ${T.leftPad}px;
  z-index: ${T.zIndex};
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: ${T.padV}px ${T.padH}px;
  background: rgba(0,0,0,.62);
  border: 1px solid rgba(255,255,255,.22);
  border-radius: ${T.borderRadius}px;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: ${cfg.color};
  user-select: none;
}
.volatility-selector .vs-label { opacity: 0.85; letter-spacing: 0.1em; }
.volatility-selector .vs-rail {
  display: inline-flex; gap: ${T.rungGap}px;
  padding: 2px;
  background: rgba(255,255,255,.06);
  border-radius: ${T.rungRadius}px;
}
.volatility-selector .vs-tier {
  appearance: none;
  border: none;
  background: transparent;
  color: ${cfg.color};
  /* D-6 WCAG 2.5.5: tap target ≥ 44 × 44 px on mobile. */
  min-height: 44px;
  min-width: 44px;
  padding: 12px 14px;
  border-radius: ${T.rungRadius}px;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  outline: none;
  transition: background .15s ease, color .15s ease;
}
.volatility-selector .vs-tier:focus-visible { box-shadow: 0 0 0 2px #fff; }
.volatility-selector .vs-tier[aria-checked="true"] {
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  color: #1a1a1a;
}
.volatility-selector .vs-tier:hover:not([aria-checked="true"]) {
  background: rgba(255,255,255,.1);
}
.volatility-selector .vs-subtitle {
  font-size: ${T.subFontRem}rem;
  opacity: 0.65;
  letter-spacing: 0.04em;
  margin-left: 6px;
  max-width: 180px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.volatility-selector[data-locked="true"] {
  opacity: 0.5; pointer-events: none;
}
@media (max-width: ${T.mobileBreak}px) {
  .volatility-selector {
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
    left: ${T.leftPadMobile}px;
    padding: ${T.padV}px 8px;
    font-size: ${T.fontRemMobile}rem;
  }
  .volatility-selector .vs-tier { font-size: ${T.fontRemMobile}rem; min-height: 44px; min-width: 44px; padding: 12px 12px; /* D-6 WCAG 2.5.5 */ }
  .volatility-selector .vs-subtitle {
    font-size: ${T.subFontMobile}rem;
    max-width: 120px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .volatility-selector .vs-tier { transition: none; }
}
`;
}

export function emitVolatilitySelectorMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const di = cfg.defaultTierIndex;
  const tiers = cfg.tiers.map((t, i) => `
    <button type="button" class="vs-tier" role="radio"
            data-tier-id="${escapeAttr(t.id)}"
            data-tier-index="${i}"
            aria-checked="${i === di ? 'true' : 'false'}"
            aria-describedby="vsSubtitle"
            tabindex="${i === di ? '0' : '-1'}">${escapeHtml(t.label)}</button>`).join('');
  return tagBlockMarkup(`<div id="volatilitySelector" class="volatility-selector"
     data-locked="false"
     role="group" aria-label="Volatility selector">
  <span class="vs-label">${escapeHtml(cfg.label)}</span>
  <div class="vs-rail" role="radiogroup" aria-label="Volatility level">${tiers}
  </div>
  <span class="vs-subtitle" id="vsSubtitle">${escapeHtml(cfg.tiers[di].subtitle || '')}</span>
</div>`, 'volatilitySelector');
}

export function emitVolatilitySelectorRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* volatilitySelector: disabled */`;
  const subsJSON = JSON.stringify(cfg.tiers.map(t => t.subtitle || ''));
  return `/* ─── volatility selector runtime ────────────────────────────── */
const VS_DEFAULT_INDEX = ${cfg.defaultTierIndex};
const VS_SUBTITLES     = ${subsJSON};

(function wireVolatilitySelector(){
  const host = document.getElementById('volatilitySelector');
  const sub  = document.getElementById('vsSubtitle');
  if (!host || !sub) return;
  const tiers = Array.prototype.slice.call(host.querySelectorAll('.vs-tier'));
  if (tiers.length < 2) return;

  function applyTier(idx) {
    const safe = Math.max(0, Math.min(tiers.length - 1, idx));
    tiers.forEach(function(r, i){
      const sel = (i === safe);
      r.setAttribute('aria-checked', sel ? 'true' : 'false');
      r.setAttribute('tabindex', sel ? '0' : '-1');
    });
    const cur = tiers[safe];
    const tierId = cur.getAttribute('data-tier-id');
    sub.textContent = VS_SUBTITLES[safe] || '';
    if (typeof window !== 'undefined') {
      window.VOLATILITY_TIER       = tierId;
      window.VOLATILITY_TIER_INDEX = safe;
    }
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onVolatilityChanged', {
        tierId: tierId,
        tierIndex: safe,
        label: cur.textContent.trim(),
      });
    }
  }

  tiers.forEach(function(tier, idx){
    tier.addEventListener('click', function(){
      if (host.getAttribute('data-locked') === 'true') return;
      applyTier(idx);
    });
    tier.addEventListener('keydown', function(e){
      if (host.getAttribute('data-locked') === 'true') return;
      let next = idx;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tiers.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + tiers.length) % tiers.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End')  next = tiers.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyTier(idx); return; }
      else return;
      e.preventDefault();
      applyTier(next);
      tiers[next].focus();
    });
  });

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function(){ host.setAttribute('data-locked', 'true'); }) : void 0);
  HookBus.on('onFsEnd',     function(){ host.setAttribute('data-locked', 'false'); });

  applyTier(VS_DEFAULT_INDEX);
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
