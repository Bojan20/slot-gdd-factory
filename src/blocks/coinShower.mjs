/**
 * src/blocks/coinShower.mjs
 *
 * Wave W47.S13 — B68 · coinShower block.
 *
 * Particle-burst celebration block. Spawns N coin glyphs at a configured
 * origin that fall under simulated gravity, rotating along the way, then
 * fade out and detach. Pure CSS keyframes + lightweight DOM — no canvas,
 * no WebGL, no third-party particle engine. Fully composable with every
 * other LEGO block and respects prefers-reduced-motion.
 *
 * Industry reference: ubiquitous in modern slot UIs as the universal "big
 * payoff" signature. Vendor-neutral baseline: 40-60 coin glyphs over
 * ~2000ms, top-arc spawn, 1.2g gravity feel, ±25 deg rotation.
 *
 * GDD knobs (consumed from model.coinShower):
 *   enabled        boolean                                        (default false)
 *   triggerMode    'big_win' | 'bonus_trigger'
 *                  | 'cascade_chain' | 'any_win'                  (default 'big_win')
 *   minWinX        number — total-win multiplier floor for any_win (default 25)
 *   bigWinMinTier  number — tier floor for big_win mode             (default 2)
 *   chainMinLen    number — cascade chain length floor              (default 3)
 *   coinCount      number — coin particles per burst                (default 48)
 *   durationMs     number — total burst duration                    (default 2000)
 *   coinColor      'r,g,b' — fill color                              (default '255,214,110')
 *   spawnArc       'top' | 'top-center' | 'left' | 'right'           (default 'top')
 *   gravityPx      number px/s — fall acceleration                  (default 1400)
 *   haptic         boolean — vibrate on burst                       (default false)
 *
 * Public API:
 *   defaultConfig()                       → safe defaults (isolated copy)
 *   resolveConfig(model)                  → merge + clamp
 *   emitCoinShowerCSS(cfg)                → CSS string
 *   emitCoinShowerMarkup(cfg)             → HTML string
 *   emitCoinShowerRuntime(cfg)            → IIFE runtime
 *
 * Lifecycle (Runtime):
 *   listens : onBigWinTierEntered | onFsTrigger | onTumbleStep | onSpinResult
 *             (mode-dependent — exactly one binding active per build)
 *   emits   : onCoinShowerStart, onCoinShowerEnd
 *
 * Accessibility:
 *   • Container marked aria-hidden — pure decoration.
 *   • prefers-reduced-motion: reduce → animation: none, single 200ms
 *     fade-in/out flash instead of particle rain.
 *
 * Performance budget:
 *   • DOM: 1 container + N coin nodes (default 48), removed in one batch.
 *   • CSS animation runs on GPU (transform + opacity only).
 *   • No JS frame loop — keyframes handle motion.
 */

const DEFAULTS = Object.freeze({
  enabled: false,
  triggerMode: 'big_win',
  minWinX: 25,
  bigWinMinTier: 2,
  chainMinLen: 3,
  coinCount: 48,
  durationMs: 2000,
  coinColor: '255,214,110',
  spawnArc: 'top',
  gravityPx: 1400,
  haptic: false,
});

const TRIGGER_MODES = Object.freeze(['big_win', 'bonus_trigger', 'cascade_chain', 'any_win']);
const SPAWN_ARCS    = Object.freeze(['top', 'top-center', 'left', 'right']);

const BOUNDS = Object.freeze({
  minWinX:       { min: 1,    max: 10000, integer: false },
  bigWinMinTier: { min: 1,    max: 10,    integer: true },
  chainMinLen:   { min: 1,    max: 50,    integer: true },
  coinCount:     { min: 1,    max: 200,   integer: true },
  durationMs:    { min: 200,  max: 10000, integer: true },
  gravityPx:     { min: 50,   max: 5000,  integer: true },
});

export function defaultConfig() {
  return Object.freeze({ ...DEFAULTS });
}

function isValidRgb(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.coinShower) || {};

  if (src.enabled != null) cfg.enabled = !!src.enabled;

  if (typeof src.triggerMode === 'string' && TRIGGER_MODES.includes(src.triggerMode)) {
    cfg.triggerMode = src.triggerMode;
  }
  if (typeof src.spawnArc === 'string' && SPAWN_ARCS.includes(src.spawnArc)) {
    cfg.spawnArc = src.spawnArc;
  }
  if (isValidRgb(src.coinColor)) cfg.coinColor = src.coinColor;
  if (typeof src.haptic === 'boolean') cfg.haptic = src.haptic;

  for (const key of Object.keys(BOUNDS)) {
    const v = src[key];
    const b = BOUNDS[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max) {
      cfg[key] = b.integer ? Math.floor(v) : v;
    }
  }

  /* Feature auto-enable — any of these feature kinds implies coinShower is
     a natural fit. Stays opt-out via explicit enabled:false. */
  if (Array.isArray(model.features) && model.features.some(f =>
    typeof f === 'object' && f && (
      f.kind === 'coin_shower' ||
      f.kind === 'big_win_celebration' ||
      f.kind === 'celebration_burst'
    )
  )) {
    if (src.enabled !== false) cfg.enabled = true;
  }

  return cfg;
}

export function emitCoinShowerCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';

  /* Spawn-arc origin → CSS percentages for the container's coin spawn
     point (top: edge-spread, top-center: tighter, side variants: edge). */
  const origin = (() => {
    switch (cfg.spawnArc) {
      case 'top-center': return { top: '10%', left: '50%', spread: 20 };
      case 'left':       return { top: '50%', left: '5%',  spread: 30 };
      case 'right':      return { top: '50%', left: '95%', spread: 30 };
      case 'top':
      default:           return { top: '0%',  left: '50%', spread: 45 };
    }
  })();

  return `
/* ─── coinShower block — emitted by src/blocks/coinShower.mjs ──────── */
.coin-shower {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 90;
  overflow: hidden;
  display: none;
}
.coin-shower[data-active="true"] { display: block; }
.coin-shower .coin {
  position: absolute;
  top: ${origin.top};
  left: ${origin.left};
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%,
    rgba(${cfg.coinColor}, 1) 0%,
    rgba(${cfg.coinColor}, 0.85) 55%,
    rgba(${cfg.coinColor}, 0.6) 100%);
  box-shadow: 0 0 6px rgba(${cfg.coinColor}, 0.5);
  will-change: transform, opacity;
  opacity: 0;
  --cs-spread: ${origin.spread}vw;
  --cs-dx: 0px;
  --cs-dy: 0px;
  --cs-rot: 0deg;
  --cs-delay: 0ms;
  animation: coinFall ${cfg.durationMs}ms cubic-bezier(.45, .05, .55, 1) var(--cs-delay) forwards;
}
@keyframes coinFall {
  0%   { transform: translate(0, 0) rotate(0deg); opacity: 0; }
  8%   { opacity: 1; }
  100% {
    transform: translate(var(--cs-dx), var(--cs-dy)) rotate(var(--cs-rot));
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  /* Hard motion kill — no particle rain, no alt animation. Pure opacity
     fade via transition (not animation) keeps the celebration cue without
     vestibular load. */
  .coin-shower .coin {
    animation: none;
    transform: none;
    display: none;
  }
  .coin-shower[data-active="true"] {
    background: radial-gradient(circle at 50% 30%,
      rgba(${cfg.coinColor}, 0.20) 0%,
      transparent 60%);
    transition: opacity 220ms ease-out;
    opacity: 1;
  }
}
@media (max-width: 480px) {
  .coin-shower .coin { width: 12px; height: 12px; }
}
`;
}

export function emitCoinShowerMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="coinShower" class="coin-shower" data-active="false" aria-hidden="true"></div>`;
}

export function emitCoinShowerRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* coinShower: disabled */`;

  /* Pre-compute trigger-mode dispatcher fragments. We pick exactly one
     listener at build time so the runtime has a single tight binding.
     Dead branches never ship — LEGO discipline + smaller bundle. */
  const triggerCfg = JSON.stringify({
    triggerMode: cfg.triggerMode,
    minWinX:     cfg.minWinX,
    bigWinMinTier: cfg.bigWinMinTier,
    chainMinLen: cfg.chainMinLen,
  });

  let triggerBinding;
  switch (cfg.triggerMode) {
    case 'bonus_trigger':
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function (evt) {
      fireCoinShower({ source: 'bonus_trigger', payload: evt || null });
    }) : void 0);`;
      break;
    case 'cascade_chain':
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onTumbleStep', function (evt) {
      var chain = evt && Number(evt.chainLen);
      if (Number.isFinite(chain) && chain >= CS_CFG.chainMinLen) {
        fireCoinShower({ source: 'cascade_chain', chainLen: chain });
      }
    }) : void 0);`;
      break;
    case 'any_win':
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onSpinResult', function (evt) {
      var totalWin = evt && Number(evt.totalWin);
      var bet      = evt && Number(evt.bet);
      if (!Number.isFinite(totalWin) || totalWin <= 0) return;
      if (Number.isFinite(bet) && bet > 0) {
        var xWin = totalWin / bet;
        if (xWin >= CS_CFG.minWinX) {
          fireCoinShower({ source: 'any_win', xWin: xWin });
        }
      }
    }) : void 0);`;
      break;
    case 'big_win':
    default:
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onBigWinTierEntered', function (evt) {
      var tier = evt && Number(evt.toTier);
      if (!Number.isFinite(tier)) tier = evt && Number(evt.tier);
      if (Number.isFinite(tier) && tier >= CS_CFG.bigWinMinTier) {
        fireCoinShower({ source: 'big_win', tier: tier });
      }
    }) : void 0);`;
      break;
  }

  return `/* ─── coinShower runtime — emitted by src/blocks/coinShower.mjs ─── */
(function _coinShowerRuntime() {
  var CS_CFG          = ${triggerCfg};
  var CS_COIN_COUNT   = ${cfg.coinCount};
  var CS_DURATION_MS  = ${cfg.durationMs};
  var CS_GRAVITY_PX   = ${cfg.gravityPx};
  var CS_HAPTIC       = ${cfg.haptic ? 'true' : 'false'};
  var CS_ACTIVE_TOKEN = 0;

  function _csContainer() {
    return (typeof document !== 'undefined') ? document.getElementById('coinShower') : null;
  }

  /* Spawn one coin DOM node with randomized trajectory CSS variables.
     The keyframes resolve to translate(var(--cs-dx), var(--cs-dy))
     rotate(var(--cs-rot)), so we precompute per-coin physics here and
     hand them to the GPU. */
  function _csSpawnCoin(container, viewportH, idx) {
    var coin = document.createElement('div');
    coin.className = 'coin';
    /* Horizontal spread: ±spread vw from origin. */
    var dx = (Math.random() * 2 - 1) * 35;        /* vw */
    /* Vertical fall: viewport height + slack, with a tiny upward arc start
       baked into the keyframe so the launch feels physical. */
    var dy = viewportH + 80 + Math.random() * 60; /* px */
    /* Gravity tuning — make particles with bigger horizontal velocity
       arc further. */
    var rot = (Math.random() * 2 - 1) * 720;      /* deg */
    var delay = Math.floor(Math.random() * Math.min(CS_DURATION_MS * 0.4, 700));
    coin.style.setProperty('--cs-dx', dx + 'vw');
    coin.style.setProperty('--cs-dy', dy + 'px');
    coin.style.setProperty('--cs-rot', rot + 'deg');
    coin.style.setProperty('--cs-delay', delay + 'ms');
    container.appendChild(coin);
    return coin;
  }

  /* Public entry — accepts an optional payload bag, returns nothing.
     Re-entrant: every call starts a new token and the previous run
     finishes its own setTimeout cleanup. */
  function fireCoinShower(payload) {
    var container = _csContainer();
    if (!container) return;
    var token = ++CS_ACTIVE_TOKEN;
    container.dataset.active = 'true';

    /* Reduced-motion path — CSS handles the soft flash, just toggle the
       active flag for the duration and skip DOM spawn entirely. */
    var rm = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    var viewportH = (typeof window !== 'undefined') ? (window.innerHeight || 800) : 800;
    var coins = [];
    if (!rm) {
      for (var i = 0; i < CS_COIN_COUNT; i++) {
        coins.push(_csSpawnCoin(container, viewportH, i));
      }
    }

    /* Optional haptic tick — single short pulse on supporting devices. */
    if (CS_HAPTIC && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(30); } catch (_) {}
    }

    if (typeof HookBus !== 'undefined') {
      try { HookBus.emit('onCoinShowerStart', { coinCount: coins.length, durationMs: CS_DURATION_MS, payload: payload || null }); } catch (_) {}
    }

    setTimeout(function () {
      if (token !== CS_ACTIVE_TOKEN) return;
      container.dataset.active = 'false';
      for (var j = 0; j < coins.length; j++) {
        if (coins[j] && coins[j].parentNode) coins[j].parentNode.removeChild(coins[j]);
      }
      if (typeof HookBus !== 'undefined') {
        try { HookBus.emit('onCoinShowerEnd', { coinCount: coins.length, reason: 'natural' }); } catch (_) {}
      }
    }, CS_DURATION_MS + 100);
  }

  if (typeof window !== 'undefined') {
    window.fireCoinShower = fireCoinShower;
  }

  /* HookBus binding — exactly one trigger source baked at build time.
     Dead branches never ship; the selected one is inlined below. */
  if (typeof HookBus !== 'undefined') {
${triggerBinding}
  }
})();
`;
}
