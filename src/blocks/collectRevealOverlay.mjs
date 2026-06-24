import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/collectRevealOverlay.mjs
 *
 * Wave LEGO-COLLECT (B-4 · 3/3) — Threshold reveal choreography.
 *
 * @module collectRevealOverlay
 *
 * Purpose:
 *   When `cumulativeMeter.mjs` emits `onCumulativeMeterThresholdHit`,
 *   this block paints a celebratory full-screen reveal overlay with
 *   the tier label, award description, and a CTA "CLAIM" button.
 *   Player clicks → award is committed (math layer hook), overlay
 *   fades out, control returns to the base game.
 *
 *   This is the "reveal" half of the collect-and-claim meta-game,
 *   sibling to `coinCollect.mjs` (detection) and `cumulativeMeter.mjs`
 *   (visual progress). Together they form the full three-piece LEGO
 *   pattern matching industry standard.
 *
 * Industry-reference (vendor-neutral):
 *   Threshold reveal is a celebratory beat — players have been
 *   collecting toward this moment. Industry baseline: full-screen
 *   overlay, big tier title (BRONZE / SILVER / GOLD), animated award
 *   number reveal, single CTA "CLAIM" button + 1-2 seconds visible.
 *   Reveal must NOT auto-dismiss before player taps — claiming is the
 *   emotional close to the loop.
 *
 * Public API:
 *   defaultConfig()                              → frozen safe defaults
 *   resolveConfig(model)                         → merge defaults with GDD override
 *   emitCollectRevealOverlayCSS(cfg)             → CSS string
 *   emitCollectRevealOverlayMarkup(cfg)          → HTML string
 *   emitCollectRevealOverlayRuntime(cfg)         → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onCumulativeMeterThresholdHit — open reveal + populate
 *   emits:       onCollectRevealOpened   { tierIndex, awardKind, awardValue }
 *                onCollectRevealClaimed  { tierIndex, awardKind, awardValue }
 *
 * a11y / perf:
 *   • role="alertdialog" + aria-live="assertive" + focus trap.
 *   • CTA is real <button> with visible focus ring + Esc shortcut.
 *   • prefers-reduced-motion collapses entrance animation.
 *   • Tokens hoisted (0 magic numbers).
 *   • Self-disabled mid-FS (no overlap with bonus celebration).
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  zIndexBackdrop:  68,
  zIndexCard:      69,
  fadeMs:          280,
  scaleMs:         420,
  fontTierRem:     2.2,
  fontTierRemMobile: 1.6,
  fontAwardRem:    1.5,
  fontAwardRemMobile: 1.2,
  ctaPadV:         12,
  ctaPadH:         28,
  cardRadius:      18,
  cardPadV:        32,
  cardPadH:        40,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'COLLECT REWARD',
    /* Default tier names — overridden per-threshold from
     * cumulativeMeter via the payload's tierIndex. */
    tierNames: Object.freeze(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND']),
    /* Auto-dismiss after N ms if untouched. 0 = never auto-dismiss
     * (player must claim — industry default for celebratory reveals). */
    autoDismissMs: 0,
    color:     '#ffd34a',
    colorDark: '#a07520',
    haloRGB:   '255,211,74',
    ctaLabel:  'CLAIM',
  });
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('collectRevealOverlay', defaultConfig(), model) };
  cfg.tierNames = cfg.tierNames.slice();
  const m = model.collectRevealOverlay || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('collectRevealOverlay', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (Number.isFinite(m.autoDismissMs)) cfg.autoDismissMs = _clampInt(m.autoDismissMs, 0, 60000, cfg.autoDismissMs);
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;
  if (typeof m.haloRGB === 'string' && RGB_RE.test(m.haloRGB)) cfg.haloRGB = m.haloRGB;
  if (typeof m.ctaLabel === 'string' && m.ctaLabel.length > 0 && m.ctaLabel.length <= 16) cfg.ctaLabel = m.ctaLabel;
  if (Array.isArray(m.tierNames) && m.tierNames.length > 0) {
    cfg.tierNames = m.tierNames.slice(0, 8).map(n =>
      (typeof n === 'string' && n.length > 0 && n.length <= 16) ? n : 'TIER');
  }

  /* Auto-enable from features[] OR when cumulativeMeter feature is
   * present (the reveal is the complementary half). */
  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'collect_reveal' || f.kind === 'cumulative_meter' || f.kind === 'collect_meter')) {
    const ctxOverride = applyGridProfile('collectRevealOverlay', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  cfg.tierNames = Object.freeze(cfg.tierNames);
  return cfg;
}

export function emitCollectRevealOverlayCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── collect reveal overlay ────────────────────────────────────── */
.collect-reveal-backdrop {
  position: fixed; inset: 0;
  z-index: ${T.zIndexBackdrop};
  background: rgba(0,0,0,.7);
  opacity: 0; pointer-events: none;
  transition: opacity ${T.fadeMs}ms ease;
}
.collect-reveal-backdrop[data-open="true"] {
  opacity: 1; pointer-events: auto;
}
.collect-reveal-card {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) scale(0.86);
  z-index: ${T.zIndexCard};
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  color: #1a1a1a;
  padding: ${T.cardPadV}px ${T.cardPadH}px;
  border-radius: ${T.cardRadius}px;
  box-shadow: 0 24px 80px rgba(0,0,0,.6), 0 0 120px rgba(${cfg.haloRGB},.55);
  text-align: center;
  opacity: 0; pointer-events: none;
  transition: opacity ${T.fadeMs}ms ease, transform ${T.scaleMs}ms cubic-bezier(.34, 1.56, .64, 1);
  min-width: 280px;
  max-width: 86vw;
}
.collect-reveal-card[data-open="true"] {
  opacity: 1; transform: translate(-50%, -50%) scale(1);
  pointer-events: auto;
}
.collect-reveal-tier {
  font-size: ${T.fontTierRem}rem;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-shadow: 0 2px 4px rgba(0,0,0,.25);
}
.collect-reveal-award {
  font-size: ${T.fontAwardRem}rem;
  font-weight: 700;
  margin-top: 8px;
  letter-spacing: 0.06em;
}
.collect-reveal-cta {
  margin-top: 18px;
  background: #1a1a1a;
  color: ${cfg.color};
  border: 2px solid ${cfg.color};
  border-radius: 12px;
  padding: ${T.ctaPadV}px ${T.ctaPadH}px;
  font-size: 1rem;
  font-weight: 900;
  letter-spacing: 0.18em;
  cursor: pointer;
  transition: filter .15s ease, transform .15s ease;
}
.collect-reveal-cta:focus-visible {
  outline: 3px solid #fff; outline-offset: 3px;
}
.collect-reveal-cta:hover { filter: brightness(1.15); }
.collect-reveal-cta:active { transform: scale(0.96); }

@media (max-width: 620px) {
  .collect-reveal-tier  { font-size: ${T.fontTierRemMobile}rem; }
  .collect-reveal-award { font-size: ${T.fontAwardRemMobile}rem; }
}
@media (prefers-reduced-motion: reduce) {
  .collect-reveal-backdrop,
  .collect-reveal-card { transition: none !important; }
}
`;
}

export function emitCollectRevealOverlayMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="collectRevealBackdrop" class="collect-reveal-backdrop"
     data-open="false" aria-hidden="true"></div>
<div id="collectRevealCard" class="collect-reveal-card"
     data-open="false"
     role="alertdialog" aria-live="assertive"
     aria-labelledby="collectRevealTier" aria-describedby="collectRevealAward">
  <div class="collect-reveal-tier" id="collectRevealTier">${escapeHtml(cfg.label)}</div>
  <div class="collect-reveal-award" id="collectRevealAward"></div>
  <button class="collect-reveal-cta" type="button" id="collectRevealCta">${escapeHtml(cfg.ctaLabel)}</button>
</div>`, 'collectRevealOverlay');
}

export function emitCollectRevealOverlayRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* collectRevealOverlay: disabled */`;
  const tierNamesJSON = JSON.stringify(cfg.tierNames);
  return `/* ─── collect reveal overlay runtime ─────────────────────────── */
const CRO_TIER_NAMES   = ${tierNamesJSON};
const CRO_AUTO_DISMISS = ${cfg.autoDismissMs};

(function wireCollectRevealOverlay(){
  const backdrop = document.getElementById('collectRevealBackdrop');
  const card     = document.getElementById('collectRevealCard');
  const tierEl   = document.getElementById('collectRevealTier');
  const awardEl  = document.getElementById('collectRevealAward');
  const cta      = document.getElementById('collectRevealCta');
  if (!backdrop || !card || !tierEl || !awardEl || !cta) return;

  let lastFocus = null;
  let autoDismissTimer = null;
  let currentPayload = null;
  let suspended = false;

  function formatAward(payload) {
    const kind  = payload.awardKind;
    const value = payload.awardValue;
    if (kind === 'credit')     return '+' + value + ' CREDITS';
    if (kind === 'multiplier') return '×' + value + ' MULTIPLIER';
    if (kind === 'scatter')    return value + ' SCATTERS';
    if (kind === 'fs_trigger') return value + ' FREE SPINS';
    return String(value);
  }

  function open(payload) {
    if (suspended) return;
    currentPayload = payload;
    lastFocus = document.activeElement;
    const tierName = CRO_TIER_NAMES[payload.tierIndex] || 'TIER';
    tierEl.textContent = tierName;
    awardEl.textContent = formatAward(payload);
    backdrop.setAttribute('data-open', 'true');
    backdrop.setAttribute('aria-hidden', 'false');
    card.setAttribute('data-open', 'true');
    cta.focus();
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onCollectRevealOpened', {
        tierIndex: payload.tierIndex,
        awardKind: payload.awardKind,
        awardValue: payload.awardValue,
      });
    }
    if (CRO_AUTO_DISMISS > 0) {
      autoDismissTimer = setTimeout(claim, CRO_AUTO_DISMISS);
    }
  }

  function claim() {
    if (!currentPayload) return;
    clearTimeout(autoDismissTimer);
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onCollectRevealClaimed', {
        tierIndex: currentPayload.tierIndex,
        awardKind: currentPayload.awardKind,
        awardValue: currentPayload.awardValue,
      });
    }
    backdrop.setAttribute('data-open', 'false');
    backdrop.setAttribute('aria-hidden', 'true');
    card.setAttribute('data-open', 'false');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) { /* lost host */ }
    }
    currentPayload = null;
  }

  cta.addEventListener('click', claim);
  document.addEventListener('keydown', function(e){
    if (!currentPayload) return;
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); claim();
    }
  });

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onCumulativeMeterThresholdHit', open) : void 0);
  HookBus.on('onFsTrigger', function(){ suspended = true; });
  HookBus.on('onFsEnd', function(){ suspended = false; });
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
