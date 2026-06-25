import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/rewardChest.mjs
 *
 * Wave W47.S16 — B74 · rewardChest block.
 *
 * End-of-round chest reveal presenter. When a qualifying spin completes,
 * a chest icon animates onto the play area, opens, and reveals a single
 * reward drawn from a weighted pool (credits / multiplier / free-spins /
 * mystery). The reveal is purely presentational — the actual award is
 * already settled by the math layer. This block exists to give the
 * player a clear, deterministic celebration moment for chest-style
 * features that would otherwise lack visible feedback.
 *
 * Industry baseline: hugely common UX pattern across modern slot UIs —
 * any feature that grants a discrete reward on spin completion (loot
 * boxes, mystery prizes, treasure caches). Vendor-neutral baseline:
 * 1.6s reveal cycle, 4-segment chest sprite, weighted pool with 4 reward
 * categories, top-center spawn.
 *
 * GDD knobs (consumed from model.rewardChest):
 *   enabled        boolean                                       (default false)
 *   triggerMode    'special_symbol' | 'big_win' | 'bonus_complete'
 *                  | 'fs_end'                                    (default 'special_symbol')
 *   specialSymbol  string — symbol code that triggers chest      (default 'CHEST')
 *   minSpecials    number — count floor for special_symbol mode  (default 1)
 *   bigWinMinTier  number — tier floor for big_win mode          (default 2)
 *   pool           Array<{ kind, weight, payload }> — reward set
 *                  kinds: 'credits' | 'multiplier' | 'free_spins'
 *                       | 'mystery'                              (default 4-entry set)
 *   revealMs       number — total reveal cycle                   (default 1600)
 *   position       'top-center' | 'center' | 'bottom-center'     (default 'center')
 *   chestColor     'r,g,b' — primary chest tint                  (default '198,140,46')
 *   ringColor      'r,g,b' — burst halo color                    (default '255,214,110')
 *   haptic         boolean — vibrate on reveal                   (default false)
 *   autoCloseMs    number — hold time after reveal               (default 1200)
 *
 * Public API:
 *   defaultConfig()                       → safe defaults (isolated copy)
 *   resolveConfig(model)                  → merge + clamp + pool normalize
 *   emitRewardChestCSS(cfg)               → CSS string
 *   emitRewardChestMarkup(cfg)            → HTML string
 *   emitRewardChestRuntime(cfg)           → IIFE runtime
 *
 * Lifecycle (Runtime):
 *   listens : onSpinResult | onBigWinTierEntered | onFsEnd
 *             (mode-dependent — exactly one binding active per build)
 *   emits   : onRewardChestOpen  { kind, payload, source }
 *             onRewardChestClose { kind, payload, reason }
 *
 * Accessibility:
 *   • Host element role="status" + aria-live="polite" so screen readers
 *     announce the reveal naturally.
 *   • prefers-reduced-motion: reduce → animation: none, single 220ms
 *     opacity fade instead of chest shake + lid lift + ring burst.
 *   • Apple HIG 11px font-size floor on reward label.
 *
 * Performance budget:
 *   • DOM: 1 host + 1 chest sprite + 1 ring + 1 reward label (≤4 nodes).
 *   • CSS animations on transform + opacity (GPU-friendly).
 *   • No frame loop, no canvas — pure keyframes.
 *   • Re-entrant via revealToken; concurrent triggers cancel the prior
 *     reveal cleanly.
 *
 * Vendor-neutral. No game / studio strings.
 */

const TRIGGER_MODES = Object.freeze(['special_symbol', 'big_win', 'bonus_complete', 'fs_end']);
const POSITIONS     = Object.freeze(['top-center', 'center', 'bottom-center']);
const REWARD_KINDS  = Object.freeze(['credits', 'multiplier', 'free_spins', 'mystery']);

const DEFAULT_POOL = Object.freeze([
  Object.freeze({ kind: 'credits',    weight: 50, payload: { amountX: 10 } }),
  Object.freeze({ kind: 'multiplier', weight: 25, payload: { mult: 2 } }),
  Object.freeze({ kind: 'free_spins', weight: 15, payload: { spins: 5 } }),
  Object.freeze({ kind: 'mystery',    weight: 10, payload: { tier: 1 } }),
]);

const DEFAULTS = Object.freeze({
  enabled:       false,
  triggerMode:   'special_symbol',
  specialSymbol: 'CHEST',
  minSpecials:   1,
  bigWinMinTier: 2,
  pool:          DEFAULT_POOL,
  revealMs:      1600,
  position:      'center',
  chestColor:    '198,140,46',
  ringColor:     '255,214,110',
  haptic:        false,
  autoCloseMs:   1200,
});

const BOUNDS = Object.freeze({
  minSpecials:   { min: 1,   max: 50,    integer: true  },
  bigWinMinTier: { min: 1,   max: 10,    integer: true  },
  revealMs:      { min: 400, max: 8000,  integer: true  },
  autoCloseMs:   { min: 200, max: 10000, integer: true  },
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

/**
 * Validate + normalize a user-supplied reward pool.
 * - Drops malformed entries (missing kind, non-numeric weight, etc).
 * - Caps weight to [1, 1000] integer.
 * - Forces kind onto the whitelist.
 * - Sanitizes payload — shallow object, primitives only.
 * - Returns null when nothing usable remains (caller falls back to default).
 */
function normalizePool(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    if (!REWARD_KINDS.includes(entry.kind)) continue;
    let weight = Number(entry.weight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weight = Math.min(1000, Math.max(1, Math.floor(weight)));
    let payload = {};
    if (entry.payload && typeof entry.payload === 'object') {
      for (const [k, v] of Object.entries(entry.payload)) {
        if (typeof k !== 'string' || k.length === 0 || k.length > 32) continue;
        if (typeof v === 'string' && v.length <= 64) payload[k] = v;
        else if (typeof v === 'number' && Number.isFinite(v)) payload[k] = v;
        else if (typeof v === 'boolean') payload[k] = v;
      }
    }
    out.push(Object.freeze({ kind: entry.kind, weight, payload: Object.freeze(payload) }));
  }
  return out.length > 0 ? Object.freeze(out) : null;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.rewardChest) || {};

  if (src.enabled != null) cfg.enabled = !!src.enabled;

  if (typeof src.triggerMode === 'string' && TRIGGER_MODES.includes(src.triggerMode)) {
    cfg.triggerMode = src.triggerMode;
  }
  if (typeof src.position === 'string' && POSITIONS.includes(src.position)) {
    cfg.position = src.position;
  }
  if (typeof src.specialSymbol === 'string' && src.specialSymbol.length > 0 && src.specialSymbol.length <= 32) {
    cfg.specialSymbol = src.specialSymbol;
  }
  if (isValidRgb(src.chestColor)) cfg.chestColor = src.chestColor;
  if (isValidRgb(src.ringColor))  cfg.ringColor  = src.ringColor;
  if (typeof src.haptic === 'boolean') cfg.haptic = src.haptic;

  for (const key of Object.keys(BOUNDS)) {
    const v = src[key];
    const b = BOUNDS[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= b.min && v <= b.max) {
      cfg[key] = b.integer ? Math.floor(v) : v;
    }
  }

  /* Pool normalization — replaces default only when explicit + usable. */
  const userPool = normalizePool(src.pool);
  if (userPool) cfg.pool = userPool;

  /* Feature auto-enable — any chest-like feature kind opts in unless the
     model explicitly says enabled:false. Keeps vendor-neutral while
     covering the obvious naming spread (reward / treasure / loot / chest). */
  if (Array.isArray(model.features) && model.features.some(f =>
    typeof f === 'object' && f && (
      f.kind === 'reward_chest' ||
      f.kind === 'treasure_chest' ||
      f.kind === 'loot_chest' ||
      f.kind === 'bonus_chest'
    )
  )) {
    if (src.enabled !== false) cfg.enabled = true;
  }

  return cfg;
}

export function emitRewardChestCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';

  /* Position → fixed-position style fragment. Always horizontally
     centered via transform; vertical anchor depends on cfg.position. */
  const verticalAnchor = (() => {
    switch (cfg.position) {
      case 'top-center':    return 'top: 12%;   transform: translate(-50%, 0);';
      case 'bottom-center': return 'bottom: 16%; transform: translate(-50%, 0);';
      case 'center':
      default:              return 'top: 50%;  transform: translate(-50%, -50%);';
    }
  })();

  return `
/* ─── rewardChest block — emitted by src/blocks/rewardChest.mjs ──────── */
.reward-chest {
  position: fixed;
  left: 50%;
  ${verticalAnchor}
  z-index: 92;
  width: 160px;
  height: 140px;
  pointer-events: none;
  opacity: 0;
  display: none;
}
.reward-chest[data-active="true"] { display: block; }
.reward-chest[data-phase="enter"]  { animation: rcEnter 280ms ease-out forwards; }
.reward-chest[data-phase="open"]   { animation: rcShake 240ms ease-in-out forwards; }
.reward-chest[data-phase="reveal"] { animation: rcHold  ${Math.max(200, cfg.autoCloseMs - 200)}ms ease-out forwards; }
.reward-chest[data-phase="exit"]   { animation: rcExit  220ms ease-in forwards; }
.reward-chest .rc-ring {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%,
    rgba(${cfg.ringColor}, 0.55) 0%,
    rgba(${cfg.ringColor}, 0.20) 45%,
    transparent 70%);
  opacity: 0;
  transform: scale(0.55);
  pointer-events: none;
}
.reward-chest[data-phase="reveal"] .rc-ring,
.reward-chest[data-phase="open"]   .rc-ring {
  animation: rcRing 600ms ease-out forwards;
}
.reward-chest .rc-chest {
  position: absolute;
  inset: 16px 24px 24px 24px;
  border-radius: 8px 8px 4px 4px;
  background:
    linear-gradient(180deg,
      rgba(${cfg.chestColor}, 1) 0%,
      rgba(${cfg.chestColor}, 0.78) 55%,
      rgba(${cfg.chestColor}, 0.55) 100%);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.45),
              inset 0 -3px 0 rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.reward-chest .rc-lid {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 38%;
  background: linear-gradient(180deg,
    rgba(${cfg.chestColor}, 1)   0%,
    rgba(${cfg.chestColor}, 0.7) 100%);
  border-radius: 8px 8px 0 0;
  transform-origin: 50% 100%;
  transition: transform 220ms ease-out;
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.3);
}
.reward-chest[data-phase="reveal"] .rc-lid,
.reward-chest[data-phase="open"]   .rc-lid {
  transform: rotateX(-110deg);
}
.reward-chest .rc-label {
  position: absolute;
  left: 50%;
  bottom: -22px;
  transform: translateX(-50%);
  white-space: nowrap;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  opacity: 0;
  pointer-events: none;
}
.reward-chest[data-phase="reveal"] .rc-label {
  animation: rcLabel 480ms ease-out 80ms forwards;
}
@keyframes rcEnter {
  0%   { opacity: 0; transform: translate(-50%, 12px) scale(0.85); }
  60%  { opacity: 1; transform: translate(-50%, -4px) scale(1.04); }
  100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
}
@keyframes rcShake {
  0%, 100% { transform: translate(-50%, 0) rotate(0deg); }
  25%      { transform: translate(-52%, 0) rotate(-3deg); }
  75%      { transform: translate(-48%, 0) rotate(3deg); }
}
@keyframes rcRing {
  0%   { opacity: 0;    transform: scale(0.55); }
  40%  { opacity: 0.95; transform: scale(1.05); }
  100% { opacity: 0;    transform: scale(1.4); }
}
@keyframes rcLabel {
  0%   { opacity: 0; transform: translate(-50%, 6px); }
  100% { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes rcHold {
  0%   { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 1; }
}
@keyframes rcExit {
  0%   { opacity: 1; transform: translate(-50%, 0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, 4px) scale(0.96); }
}
@media (prefers-reduced-motion: reduce) {
  /* Hard motion kill — no chest shake, no lid lift, no ring burst.
     Pure opacity fade keeps the celebration cue without vestibular load. */
  .reward-chest,
  .reward-chest[data-phase="enter"],
  .reward-chest[data-phase="open"],
  .reward-chest[data-phase="reveal"],
  .reward-chest[data-phase="exit"] {
    animation: none;
  }
  .reward-chest .rc-lid {
    transition: none;
  }
  .reward-chest[data-active="true"] {
    opacity: 1;
    transition: opacity 220ms ease-out;
  }
  .reward-chest[data-active="false"] {
    opacity: 0;
  }
  .reward-chest .rc-ring   { animation: none; opacity: 0; }
  .reward-chest .rc-label  { animation: none; opacity: 1; }
}
@media (max-width: 480px) {
  .reward-chest {
    width: 128px;
    height: 116px;
  }
  .reward-chest .rc-label {
    font-size: 12px;
    bottom: -18px;
  }
}
`;
}

export function emitRewardChestMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="rewardChest" class="reward-chest" data-active="false" data-phase="" role="status" aria-live="polite" aria-label="Reward chest" data-i18n-aria="rewardChest.0" data-i18n-aria-fallback="Reward chest" aria-hidden="true">
    <div class="rc-ring" aria-hidden="true"></div>
    <div class="rc-chest" aria-hidden="true"><div class="rc-lid"></div></div>
    <div class="rc-label">&nbsp;</div>
  </div>`, 'rewardChest');
}

export function emitRewardChestRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';

  /* Pre-compute trigger binding so dead branches never ship. */
  const triggerCfg = JSON.stringify({
    triggerMode:   cfg.triggerMode,
    specialSymbol: cfg.specialSymbol,
    minSpecials:   cfg.minSpecials,
    bigWinMinTier: cfg.bigWinMinTier,
  });

  let triggerBinding;
  switch (cfg.triggerMode) {
    case 'big_win':
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onBigWinTierEntered', function (evt) {
      var tier = evt && Number(evt.toTier);
      if (!Number.isFinite(tier)) tier = evt && Number(evt.tier);
      if (Number.isFinite(tier) && tier >= RC_CFG.bigWinMinTier) {
        _rcReveal({ source: 'big_win', tier: tier });
      }
    }) : void 0);`;
      break;
    case 'bonus_complete':
      /* Fires when bonus round finishes — onFsEnd is the closest neutral
         signal for "round completed". For non-FS bonus blocks they would
         emit onFsEnd-shaped events through the same channel by convention. */
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsEnd', function (evt) {
      _rcReveal({ source: 'bonus_complete', payload: evt || null });
    }) : void 0);`;
      break;
    case 'fs_end':
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsEnd', function (evt) {
      _rcReveal({ source: 'fs_end', payload: evt || null });
    }) : void 0);`;
      break;
    case 'special_symbol':
    default:
      triggerBinding = `    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onSpinResult', function (evt) {
      if (!evt) return;
      var symMap = evt.specialSymbolCounts || evt.scatterCounts || null;
      if (!symMap || typeof symMap !== 'object') return;
      var n = Number(symMap[RC_CFG.specialSymbol] || 0);
      if (Number.isFinite(n) && n >= RC_CFG.minSpecials) {
        _rcReveal({ source: 'special_symbol', symbol: RC_CFG.specialSymbol, count: n });
      }
    }) : void 0);`;
      break;
  }

  return `/* ─── rewardChest runtime — emitted by src/blocks/rewardChest.mjs ─── */
(function _rewardChestRuntime() {
  var RC_CFG          = ${triggerCfg};
  var RC_POOL         = ${JSON.stringify(cfg.pool)};
  var RC_REVEAL_MS    = ${cfg.revealMs};
  var RC_AUTOCLOSE_MS = ${cfg.autoCloseMs};
  var RC_HAPTIC       = ${cfg.haptic ? 'true' : 'false'};
  var RC_TOKEN        = 0;
  var RC_TIMERS       = [];

  function _rcHost() {
    return (typeof document !== 'undefined') ? document.getElementById('rewardChest') : null;
  }

  function _rcClearTimers() {
    for (var i = 0; i < RC_TIMERS.length; i++) {
      try { clearTimeout(RC_TIMERS[i]); } catch (_) {}
    }
    RC_TIMERS = [];
  }

  /* Weighted pick. Sums weights once per call; small pool so this is
     effectively O(N) with N typically ≤ 8. */
  function _rcPick() {
    if (!Array.isArray(RC_POOL) || RC_POOL.length === 0) return null;
    var total = 0;
    for (var i = 0; i < RC_POOL.length; i++) total += RC_POOL[i].weight;
    if (total <= 0) return RC_POOL[0];
    var r = Math.random() * total;
    var acc = 0;
    for (var j = 0; j < RC_POOL.length; j++) {
      acc += RC_POOL[j].weight;
      if (r <= acc) return RC_POOL[j];
    }
    return RC_POOL[RC_POOL.length - 1];
  }

  function _rcLabelFor(reward) {
    if (!reward) return '';
    var p = reward.payload || {};
    switch (reward.kind) {
      case 'credits':    return (p.amountX != null) ? ('+' + p.amountX + 'x CREDITS') : '+CREDITS';
      case 'multiplier': return (p.mult    != null) ? ('×' + p.mult + ' MULTIPLIER') : '×MULTIPLIER';
      case 'free_spins': return (p.spins   != null) ? ('+' + p.spins + ' FREE SPINS') : '+FREE SPINS';
      case 'mystery':    return 'MYSTERY';
      default:           return String(reward.kind).toUpperCase();
    }
  }

  function _rcSetPhase(host, phase) {
    if (!host) return;
    host.setAttribute('data-phase', phase);
  }

  /* Public entry — accepts a source bag, picks a reward, runs the reveal
     cycle. Re-entrant: any in-flight reveal is cancelled cleanly. */
  function _rcReveal(source) {
    var host = _rcHost();
    if (!host) return;
    var labelEl = host.querySelector('.rc-label');
    var reward = _rcPick();
    var token = ++RC_TOKEN;
    _rcClearTimers();

    host.dataset.active = 'true';
    host.setAttribute('aria-hidden', 'false');
    if (labelEl) labelEl.textContent = _rcLabelFor(reward);
    _rcSetPhase(host, 'enter');

    if (typeof HookBus !== 'undefined' && reward) {
      try { HookBus.emit('onRewardChestOpen', { kind: reward.kind, payload: reward.payload, source: source || null }); } catch (_) {}
    }
    if (RC_HAPTIC && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(40); } catch (_) {}
    }

    /* Phase pipeline — enter → open → reveal → exit. Each step guarded
       by the token check so a fresh trigger pre-empts cleanly. */
    var phaseEnter = 280;
    var phaseOpen  = 240;
    var phaseHold  = Math.max(200, RC_AUTOCLOSE_MS - 200);
    /* Total elapsed at end of reveal: 280 + 240 + hold. Exit takes 220ms. */

    RC_TIMERS.push(setTimeout(function () {
      if (token !== RC_TOKEN) return;
      _rcSetPhase(host, 'open');
    }, phaseEnter));

    RC_TIMERS.push(setTimeout(function () {
      if (token !== RC_TOKEN) return;
      _rcSetPhase(host, 'reveal');
    }, phaseEnter + phaseOpen));

    RC_TIMERS.push(setTimeout(function () {
      if (token !== RC_TOKEN) return;
      _rcSetPhase(host, 'exit');
    }, phaseEnter + phaseOpen + phaseHold));

    RC_TIMERS.push(setTimeout(function () {
      if (token !== RC_TOKEN) return;
      host.dataset.active = 'false';
      host.setAttribute('aria-hidden', 'true');
      _rcSetPhase(host, '');
      if (typeof HookBus !== 'undefined') {
        try { HookBus.emit('onRewardChestClose', { kind: reward ? reward.kind : null, payload: reward ? reward.payload : null, reason: 'auto' }); } catch (_) {}
      }
    }, phaseEnter + phaseOpen + phaseHold + 220));
  }

  if (typeof window !== 'undefined') {
    window.fireRewardChest = _rcReveal;
  }

  /* HookBus binding — exactly one trigger source baked at build time. */
  if (typeof HookBus !== 'undefined') {
${triggerBinding}
  }
})();
`;
}
