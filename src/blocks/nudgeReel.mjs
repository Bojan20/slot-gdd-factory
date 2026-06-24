import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/nudgeReel.mjs
 *
 * Wave H17 — Nudge Reel (classic fruit-machine near-miss rescue presenter).
 *
 * Industry baseline (vendor-neutral):
 *   On near-miss spins (e.g. scatter 2 visible + 1 just above the viewport),
 *   classic fruit-machine cabinets offered the player a one-shot "NUDGE"
 *   button that nudged a specific reel one tile up or down to convert the
 *   near-miss into a real trigger. Modern web slots reuse the pattern as a
 *   bonus feature, ante-bet perk, or "save the spin" surprise reward.
 *
 *   This block is a PURE PRESENTER:
 *     - Renders a "NUDGE" CTA chip on near-miss postSpin when external math
 *       sets window.__NUDGE_OFFER__ = { reel, direction, reason }.
 *     - On accept emits onNudgeAccepted + onNudgeResolved and clears the
 *       offer. Decline / timeout emits onNudgeDeclined + onNudgeResolved.
 *     - Math (which spins offer a nudge, success probability) is OUT OF SCOPE.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitNudgeReelCSS(cfg)
 *   emitNudgeReelMarkup(cfg)
 *   emitNudgeReelRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     postSpin     - read window.__NUDGE_OFFER__; if present, emit
 *                    onNudgeOffered and reveal CTA.
 *     preSpin      - close CTA, clear pending offer.
 *     onFsTrigger  - close CTA (no nudge offers during FS by default).
 *     onFsEnd      - clear in-FS gate.
 *   emits:
 *     onNudgeOffered  { reel, direction, reason, source }
 *     onNudgeAccepted { reel, direction, source }
 *     onNudgeDeclined { reel, direction, reason, source }
 *     onNudgeResolved { reel, direction, outcome, source }
 *
 * a11y:
 *   - CTA chip: role=button, aria-label=Nudge reel N up/down,
 *     focus-visible outline.
 *   - WCAG 2.5.5 - chip min 44x44 px touch target.
 *   - Apple HIG - 11 px font floor.
 *   - prefers-reduced-motion gate disables nudge pulse animation.
 *
 * Performance budget:
 *   - 1 fixed DOM chip, mounted once.
 *   - timer only when offer is active (auto-decline after offerMs); 0 timers
 *     when idle.
 *   - animation budget under 600 ms; reduced-motion -> instant.
 *
 * GDD keys (model.nudgeReel):
 *   enabled, offerMs, position, chipLabel, chipBg, chipColor, allowDuringFs,
 *   autoDeclineOnSpin
 *
 * Vendor-neutral. No game / studio strings.
 *
 * @module nudgeReel
 */

const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const BOUNDS = Object.freeze({
  offerMs:    [500, 30000],
  fontSizePx: [11, 24],
  zIndex:     [10, 99],
  animMs:     [0, 1500],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safe(v, max, fb) {
  if (typeof v !== 'string') return fb;
  const s = v.replace(/[<>"'`]/g, '').slice(0, max);
  return s.length ? s : fb;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:            false,
    offerMs:            6000,
    position:           'bottom-left',
    chipLabel:          'NUDGE',
    chipBg:             '#5dd1ff',
    chipColor:          '#02121a',
    allowDuringFs:      false,
    autoDeclineOnSpin:  true,
    zIndex:             45,
    animMs:             420,
    fontSizePx:         13,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.nudgeReel) || {};
  const auto = !!model.nudgeReel;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.offerMs    = _clamp(m.offerMs,    BOUNDS.offerMs,    cfg.offerMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);
  cfg.animMs     = _clamp(m.animMs,     BOUNDS.animMs,     cfg.animMs);
  cfg.fontSizePx = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  if (typeof m.allowDuringFs === 'boolean') cfg.allowDuringFs = m.allowDuringFs;
  if (typeof m.autoDeclineOnSpin === 'boolean') cfg.autoDeclineOnSpin = m.autoDeclineOnSpin;

  cfg.chipLabel = _safe(m.chipLabel, 24, cfg.chipLabel);
  cfg.chipBg    = _safe(m.chipBg,    32, cfg.chipBg);
  cfg.chipColor = _safe(m.chipColor, 32, cfg.chipColor);
  return cfg;
}

function _posStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const h  = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-left':     return `top: ${v}; left: ${h};`;
    case 'top-right':    return `top: ${v}; right: ${rH};`;
    case 'bottom-right': return `bottom: ${bV}; right: ${rH};`;
    case 'bottom-left':
    default:             return `bottom: ${bV}; left: ${h};`;
  }
}

export function emitNudgeReelCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* nudgeReel — Wave H17 */
  .nudge-chip {
    position: fixed;
    ${_posStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    min-width: 44px;
    min-height: 44px;
    padding: 8px 16px;
    border-radius: 999px;
    background: ${cfg.chipBg};
    color: ${cfg.chipColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.06em;
    border: 0;
    cursor: pointer;
    display: none;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    transition: transform ${cfg.animMs}ms ease-out;
  }
  .nudge-chip[data-visible="true"] {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    animation: nudge-pulse ${cfg.animMs}ms ease-in-out infinite alternate;
  }
  .nudge-chip:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
  .nudge-chip .nudge-dir { font-size: 14px; line-height: 1; }
  @keyframes nudge-pulse {
    0%   { transform: scale(1.0); }
    100% { transform: scale(1.08); }
  }
  @media (prefers-reduced-motion: reduce) {
    .nudge-chip[data-visible="true"] { animation: none; }
    .nudge-chip { transition: none; }
  }
  `;
}

export function emitNudgeReelMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<button id="nudgeChip" class="nudge-chip" type="button" data-visible="false" aria-label="Nudge reel" aria-live="polite"><span class="nudge-dir" aria-hidden="true">↑</span><span class="nudge-text">${cfg.chipLabel}</span></button>`, 'nudgeReel');
}

export function emitNudgeReelRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── nudgeReel BLOCK — Wave H17 ───────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var OFFER_MS = ${cfg.offerMs};
    var ALLOW_FS = ${JSON.stringify(cfg.allowDuringFs)};
    var AUTO_DECLINE = ${JSON.stringify(cfg.autoDeclineOnSpin)};

    var inFs = false;
    var activeOffer = null;
    var timer = null;
    var chip = (typeof document !== 'undefined') ? document.getElementById('nudgeChip') : null;
    var dirSpan = (chip && chip.querySelector) ? chip.querySelector('.nudge-dir') : null;

    function clearTimer() { if (timer) { try { clearTimeout(timer); } catch (_) {} timer = null; } }

    function show(offer) {
      if (!chip) return;
      if (inFs && !ALLOW_FS) return;
      if (!offer || typeof offer.reel !== 'number') return;
      var dir = (offer.direction === 'down') ? 'down' : 'up';
      activeOffer = { reel: offer.reel, direction: dir, reason: offer.reason || 'engine', source: offer.source || 'engine' };
      if (dirSpan) dirSpan.textContent = (dir === 'down' ? '↓' : '↑');
      chip.setAttribute('data-visible', 'true');
      chip.setAttribute('aria-label', 'Nudge reel ' + (offer.reel + 1) + ' ' + dir);
      try { window.HookBus.emit('onNudgeOffered', activeOffer); } catch (_) {}
      clearTimer();
      timer = setTimeout(function () { decline('timeout'); }, OFFER_MS);
    }
    function hide() {
      if (chip) chip.setAttribute('data-visible', 'false');
      clearTimer();
    }
    function accept() {
      if (!activeOffer) return;
      var snap = activeOffer;
      activeOffer = null;
      hide();
      try { window.HookBus.emit('onNudgeAccepted', { reel: snap.reel, direction: snap.direction, source: 'click' }); } catch (_) {}
      try { window.HookBus.emit('onNudgeResolved', { reel: snap.reel, direction: snap.direction, outcome: 'accepted', source: 'click' }); } catch (_) {}
      try { delete window.__NUDGE_OFFER__; } catch (_) {}
    }
    function decline(reason) {
      if (!activeOffer) return;
      var snap = activeOffer;
      activeOffer = null;
      hide();
      try { window.HookBus.emit('onNudgeDeclined', { reel: snap.reel, direction: snap.direction, reason: reason || 'manual', source: reason === 'timeout' ? 'timer' : 'engine' }); } catch (_) {}
      try { window.HookBus.emit('onNudgeResolved', { reel: snap.reel, direction: snap.direction, outcome: 'declined', source: reason || 'manual' }); } catch (_) {}
      try { delete window.__NUDGE_OFFER__; } catch (_) {}
    }

    if (chip && chip.addEventListener) {
      chip.addEventListener('click', accept);
    }

    window.HookBus.on('postSpin', function () {
      var offer = (typeof window !== 'undefined') ? window.__NUDGE_OFFER__ : null;
      if (offer && (!inFs || ALLOW_FS)) show(offer);
    });
    window.HookBus.on('preSpin', function () {
      if (AUTO_DECLINE && activeOffer) decline('preSpin');
      hide();
    });
    window.HookBus.on('onFsTrigger', function () { inFs = true; if (!ALLOW_FS) { hide(); activeOffer = null; } });
    window.HookBus.on('onFsEnd',     function () { inFs = false; });

    /* External API for engine + force probes. */
    window.nudgeOffer   = function (reel, direction, reason) { show({ reel: reel, direction: direction, reason: reason, source: 'api' }); };
    window.nudgeAccept  = function () { accept(); };
    window.nudgeDecline = function (r) { decline(r || 'api'); };
    window.nudgeStatus  = function () { return activeOffer ? { reel: activeOffer.reel, direction: activeOffer.direction } : null; };
  })();
  `;
}
