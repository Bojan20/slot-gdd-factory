import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/jackpotLadderRooms.mjs
 *
 * Wave H13 — Jackpot Ladder Rooms (4-tier room ladder presenter).
 *
 * Industry baseline (vendor-neutral):
 *   Many partner GDDs specify a 4-tier "jackpot ladder" with named rooms
 *   (canonical neutral order: Mini → Minor → Major → Grand). The engine
 *   awards a tier; this block PRESENTS the entry, win, and exit animations
 *   on a stacked vertical chip rail.
 *
 *   Pure presenter. No prize math — only listens to a single trigger event
 *   and emits its visual lifecycle events.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitJackpotLadderRoomsCSS(cfg)
 *   emitJackpotLadderRoomsMarkup(cfg)
 *   emitJackpotLadderRoomsRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     onJackpotRoomEnter   {tier}         (engine / force chip)
 *     onJackpotRoomWin     {tier, amount} (engine settle)
 *     preSpin                              clear active visuals
 *   emits:
 *     onJackpotRoomEntered  {tier, label}
 *     onJackpotRoomWon      {tier, label, amount}
 *     onJackpotRoomExit     {tier, reason}
 *
 * a11y:
 *   - role="group" + aria-label="Jackpot ladder".
 *   - Each chip has aria-pressed / aria-label.
 *
 * Vendor-neutral.
 *
 * @module jackpotLadderRooms
 */

const TIERS = Object.freeze(['MINI', 'MINOR', 'MAJOR', 'GRAND']);
const TIER_SET = new Set(TIERS);
const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const BOUNDS = Object.freeze({
  fontSizePx:  [10, 18],
  pulseMs:     [200, 3000],
  zIndex:      [10, 99],
  chipWidthPx: [70, 220],
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
    enabled:      false,
    labels:       Object.freeze({ MINI: 'MINI', MINOR: 'MINOR', MAJOR: 'MAJOR', GRAND: 'GRAND' }),
    position:     'top-right',
    fontSizePx:   11,
    pulseMs:      1200,
    chipWidthPx:  120,
    zIndex:       34,
    bgColor:      'rgba(0,0,0,0.55)',
    fgColor:      '#f2f2f2',
    activeBg:     '#ffd84d',
    activeFg:     '#03110a',
    showAmount:   true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.jackpotLadderRooms) || {};
  const auto = !!model.jackpotLadderRooms;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  if (typeof m.position === 'string' && POSITIONS.has(m.position)) cfg.position = m.position;
  cfg.fontSizePx  = _clamp(m.fontSizePx,  BOUNDS.fontSizePx,  cfg.fontSizePx);
  cfg.pulseMs     = _clamp(m.pulseMs,     BOUNDS.pulseMs,     cfg.pulseMs);
  cfg.chipWidthPx = _clamp(m.chipWidthPx, BOUNDS.chipWidthPx, cfg.chipWidthPx);
  cfg.zIndex      = _clamp(m.zIndex,      BOUNDS.zIndex,      cfg.zIndex);

  cfg.bgColor   = _safe(m.bgColor,   64, cfg.bgColor);
  cfg.fgColor   = _safe(m.fgColor,   32, cfg.fgColor);
  cfg.activeBg  = _safe(m.activeBg,  48, cfg.activeBg);
  cfg.activeFg  = _safe(m.activeFg,  32, cfg.activeFg);

  if (m.labels && typeof m.labels === 'object') {
    var merged = { ...cfg.labels };
    for (const [k, v] of Object.entries(m.labels)) {
      if (!TIER_SET.has(k)) continue;
      const s = _safe(v, 16, null);
      if (s) merged[k] = s;
    }
    cfg.labels = Object.freeze(merged);
  }
  if (typeof m.showAmount === 'boolean') cfg.showAmount = m.showAmount;
  return cfg;
}

function _posStyle(pos) {
  const v = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const h = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-left':     return `top: ${v}; left: ${h};`;
    case 'bottom-left':  return `bottom: ${bV}; left: ${h};`;
    case 'bottom-right': return `bottom: ${bV}; right: ${rH};`;
    case 'top-right':
    default:             return `top: ${v}; right: ${rH};`;
  }
}

export function emitJackpotLadderRoomsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* jackpotLadderRooms — Wave H13 */
  .jp-ladder {
    position: fixed;
    ${_posStyle(cfg.position)}
    z-index: ${cfg.zIndex};
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
  }
  .jp-room {
    min-width: ${cfg.chipWidthPx}px;
    padding: 4px 10px;
    border-radius: 10px;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.06em;
    line-height: 1.3;
    text-align: center;
    border: 2px solid transparent;
    transition: background-color 200ms ease, border-color 200ms ease, color 200ms ease;
  }
  .jp-room[data-active="true"] {
    background: ${cfg.activeBg};
    color: ${cfg.activeFg};
    border-color: rgba(255,255,255,0.6);
    animation: jp-room-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes jp-room-pulse {
    0%   { transform: scale(1.0); }
    40%  { transform: scale(1.06); }
    100% { transform: scale(1.0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .jp-room, .jp-room[data-active="true"] { transition: none; animation: none; }
  }
  `;
}

export function emitJackpotLadderRoomsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const rooms = TIERS.map(tier => {
    const label = (cfg.labels && cfg.labels[tier]) || tier;
    /* UQ-DEEP-AX P-P1-2: inner room aria localized. tier is GDD-supplied
       (MINI/MINOR/MAJOR/GRAND), pass through fallback. */
    return tagBlockMarkup(`<div class="jp-room" role="status" aria-label="${tier} jackpot" data-tier="${tier}" data-active="false" data-i18n-aria="jackpotLadderRooms.room" data-i18n-aria-fallback="${tier} jackpot">${label}</div>`, 'jackpotLadderRooms');
  }).join('');
  return `<div id="jpLadder" class="jp-ladder" role="group" aria-label="Jackpot ladder" data-i18n-aria="jackpotLadderRooms.0" data-i18n-aria-fallback="Jackpot ladder">${rooms}</div>`;
}

export function emitJackpotLadderRoomsRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── jackpotLadderRooms BLOCK — Wave H13 ──────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var TIERS = ${JSON.stringify(TIERS)};
    var LABELS = ${JSON.stringify(cfg.labels)};
    var SHOW_AMT = ${JSON.stringify(cfg.showAmount)};
    var PULSE = ${cfg.pulseMs};
    var rooms = {};
    function loadRooms() {
      if (typeof document === 'undefined') return;
      for (var i = 0; i < TIERS.length; i++) {
        var el = document.querySelector('.jp-room[data-tier="' + TIERS[i] + '"]');
        rooms[TIERS[i]] = el || null;
      }
    }
    loadRooms();

    function clearAll(reason, source) {
      for (var i = 0; i < TIERS.length; i++) {
        var el = rooms[TIERS[i]];
        if (el) {
          var wasActive = el.getAttribute('data-active') === 'true';
          el.setAttribute('data-active', 'false');
          el.textContent = (LABELS && LABELS[TIERS[i]]) || TIERS[i];
          if (wasActive) {
            try { window.HookBus.emit('onJackpotRoomExit', { tier: TIERS[i], reason: reason || 'auto', source: source }); } catch (_) {}
          }
        }
      }
    }
    function setActive(tier, label) {
      if (!TIERS.indexOf || TIERS.indexOf(tier) < 0) return;
      clearAll('replaced', tier);
      var el = rooms[tier];
      if (el) {
        el.setAttribute('data-active', 'true');
        el.textContent = label || (LABELS && LABELS[tier]) || tier;
        setTimeout(function () {
          el.setAttribute('data-active', 'false');
        }, PULSE + 60);
      }
    }

    window.HookBus.on('onJackpotRoomEnter', function (p) {
      if (!p || typeof p.tier !== 'string') return;
      var label = (LABELS && LABELS[p.tier]) || p.tier;
      setActive(p.tier, label);
      try { window.HookBus.emit('onJackpotRoomEntered', { tier: p.tier, label: label }); } catch (_) {}
    });
    window.HookBus.on('onJackpotRoomWin', function (p) {
      if (!p || typeof p.tier !== 'string') return;
      var label = (LABELS && LABELS[p.tier]) || p.tier;
      var amt = SHOW_AMT && Number.isFinite(p.amount) ? ' (' + p.amount + ')' : '';
      setActive(p.tier, label + amt);
      try { window.HookBus.emit('onJackpotRoomWon', { tier: p.tier, label: label, amount: p.amount || 0 }); } catch (_) {}
    });
    window.HookBus.on('preSpin', function () { clearAll('preSpin', 'preSpin'); });

    /* Public API. */
    window.jpRoomEnter = function (tier) {
      try { window.HookBus.emit('onJackpotRoomEnter', { tier: tier }); } catch (_) {}
    };
    window.jpRoomWin = function (tier, amount) {
      try { window.HookBus.emit('onJackpotRoomWin', { tier: tier, amount: amount }); } catch (_) {}
    };
  })();
  `;
}
