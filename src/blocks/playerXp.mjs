/**
 * src/blocks/playerXp.mjs
 *
 * Wave LEGO-PROG (DEF1 · 1/3) — XP accumulator + session levels.
 *
 * @module playerXp
 *
 * Purpose:
 *   Awards XP per spin (proportional to bet units) and per coin
 *   collected (from coinCollect.mjs). Tracks current level via
 *   configurable threshold curve. Exposes shared state on
 *   `window.__PLAYER_XP__` so sibling visualization blocks
 *   (sessionLevelMeter.mjs) and reward blocks (achievementToast.mjs)
 *   can subscribe / render without duplicating tally logic.
 *
 *   When math layer (Phase 2) lands, the XP-per-bet ratio becomes a
 *   real PAR-tuned knob — for now it's a placeholder linear curve.
 *
 * Industry-reference (vendor-neutral):
 *   Session-XP + level system is a 2024-2026 industry-standard
 *   retention mechanic. Default level curve uses ascending thresholds
 *   (e.g. 100 / 250 / 500 / 1000) and per-level rewards (free spins,
 *   bet boosters, exclusive sessions). PAR layer balances reward
 *   value vs trigger frequency to keep RTP target intact.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitPlayerXpCSS(cfg)                     → CSS string (sr-only live region)
 *   emitPlayerXpMarkup(cfg)                  → HTML string (live region host)
 *   emitPlayerXpRuntime(cfg)                 → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onSpinResult     — base XP per spin
 *                onCoinCollected  — bonus XP per coin
 *                onFsTrigger      — flag suspend (configurable)
 *                onFsEnd          — flag resume
 *   emits:       onPlayerXpGained   { delta, total, source }
 *                onPlayerLevelUp    { newLevel, prevLevel, reward }
 *
 * Shared state contract:
 *   window.__PLAYER_XP__ = {
 *     xp: number,                  // total XP earned this session
 *     level: number,               // current level (1-based)
 *     thresholds: number[],        // resolved level thresholds
 *     getLevel(xp): number,        // pure: compute level from XP
 *     nextThreshold(xp): number    // returns 0 when at max
 *   }
 *
 * a11y / perf:
 *   • sr-only aria-live="polite" live region announces level-ups
 *   • No DOM thrash — pure state + emit; visualization is sibling
 *   • Suspend during FS is opt-in (default false)
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  liveSrPx: 1,
});

const ID_RE  = /^[a-z][a-z0-9_-]{0,15}$/i;
const REWARD_KINDS = Object.freeze(['credit', 'fs_trigger', 'multiplier', 'boost', 'none']);

function _defaultLevels() {
  return Object.freeze([
    Object.freeze({ id: 'l1', threshold: 100,   rewardKind: 'credit',     rewardValue: 10 }),
    Object.freeze({ id: 'l2', threshold: 250,   rewardKind: 'credit',     rewardValue: 25 }),
    Object.freeze({ id: 'l3', threshold: 500,   rewardKind: 'fs_trigger', rewardValue: 5 }),
    Object.freeze({ id: 'l4', threshold: 1000,  rewardKind: 'multiplier', rewardValue: 2 }),
    Object.freeze({ id: 'l5', threshold: 2000,  rewardKind: 'boost',      rewardValue: 1 }),
  ]);
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* XP per bet unit on a spin (placeholder — PAR Phase 2 retunes). */
    xpPerBetUnit: 1,
    /* XP per coin collected via coinCollect.mjs. */
    xpPerCoin: 2,
    /* Maximum XP gained per single spin (anti-cheese guard). */
    maxXpPerSpin: 50,
    /* Suspend XP accumulation during FS rounds? */
    pauseDuringFs: false,
    levels: _defaultLevels(),
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

function _validateLevel(raw, idx) {
  const fallback = _defaultLevels()[Math.min(idx, 4)] || _defaultLevels()[0];
  return Object.freeze({
    id: ID_RE.test(String(raw && raw.id || '')) ? String(raw.id) : `l${idx + 1}`,
    threshold: _clampInt(raw.threshold, 1, 1_000_000, fallback.threshold),
    rewardKind: REWARD_KINDS.includes(String(raw.rewardKind)) ? String(raw.rewardKind) : fallback.rewardKind,
    rewardValue: _clampFloat(raw.rewardValue, 0, 1_000_000, fallback.rewardValue),
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('playerXp', defaultConfig(), model) };
  cfg.levels = cfg.levels.slice();
  const m = model.playerXp || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('playerXp', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (Number.isFinite(m.xpPerBetUnit))  cfg.xpPerBetUnit  = _clampFloat(m.xpPerBetUnit, 0, 1000, cfg.xpPerBetUnit);
  if (Number.isFinite(m.xpPerCoin))     cfg.xpPerCoin     = _clampFloat(m.xpPerCoin, 0, 1000, cfg.xpPerCoin);
  if (Number.isFinite(m.maxXpPerSpin))  cfg.maxXpPerSpin  = _clampInt(m.maxXpPerSpin, 1, 100000, cfg.maxXpPerSpin);
  if (typeof m.pauseDuringFs === 'boolean') cfg.pauseDuringFs = m.pauseDuringFs;

  if (Array.isArray(m.levels) && m.levels.length > 0) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < m.levels.length && out.length < 20; i++) {
      const v = _validateLevel(m.levels[i] || {}, i);
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
    out.sort((a, b) => a.threshold - b.threshold);
    if (out.length > 0) cfg.levels = out;
  }

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'player_xp' || f.kind === 'session_xp' || f.kind === 'player_progression')) {
    const ctxOverride = applyGridProfile('playerXp', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  cfg.levels = Object.freeze(cfg.levels);
  return cfg;
}

export function emitPlayerXpCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── player XP sr-only live region ──────────────────────────────── */
.player-xp-live {
  position: absolute; left: -9999px; top: 0;
  width: 1px; height: 1px; overflow: hidden;
  font-size: ${T.liveSrPx}px;
}
`;
}

export function emitPlayerXpMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="playerXpLive" class="player-xp-live"
     role="status" aria-live="polite" aria-atomic="true"></div>`;
}

export function emitPlayerXpRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* playerXp: disabled */`;
  const levelsJSON = JSON.stringify(cfg.levels.map(l => ({
    id: l.id, threshold: l.threshold, rewardKind: l.rewardKind, rewardValue: l.rewardValue,
  })));
  return `/* ─── player XP runtime ─────────────────────────────────────── */
const PXP_PER_BET     = ${cfg.xpPerBetUnit};
const PXP_PER_COIN    = ${cfg.xpPerCoin};
const PXP_MAX_PER_SPIN= ${cfg.maxXpPerSpin};
const PXP_PAUSE_FS    = ${cfg.pauseDuringFs};
const PXP_LEVELS      = ${levelsJSON};

(function wirePlayerXp(){
  const live = document.getElementById('playerXpLive');
  const thresholds = PXP_LEVELS.map(function(l){ return l.threshold; });

  function getLevel(xp) {
    let lvl = 0;
    for (let i = 0; i < thresholds.length; i++) {
      if (xp >= thresholds[i]) lvl = i + 1; else break;
    }
    return lvl;
  }
  function nextThreshold(xp) {
    for (let i = 0; i < thresholds.length; i++) {
      if (xp < thresholds[i]) return thresholds[i];
    }
    return 0; /* max */
  }

  if (typeof window !== 'undefined' && !window.__PLAYER_XP__) {
    window.__PLAYER_XP__ = {
      xp: 0, level: 0, thresholds: thresholds,
      getLevel: getLevel, nextThreshold: nextThreshold,
    };
  }
  const state = window.__PLAYER_XP__;
  let suspended = false;

  function award(delta, source) {
    if (suspended) return;
    if (!Number.isFinite(delta) || delta <= 0) return;
    const capped = Math.min(delta, PXP_MAX_PER_SPIN);
    const prevLevel = state.level;
    state.xp += capped;
    const newLevel = getLevel(state.xp);
    state.level = newLevel;

    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onPlayerXpGained', {
        delta: capped, total: state.xp, source: source || 'spin',
      });
    }
    if (newLevel > prevLevel) {
      const idx = newLevel - 1;
      const reward = PXP_LEVELS[idx] ? {
        kind: PXP_LEVELS[idx].rewardKind,
        value: PXP_LEVELS[idx].rewardValue,
      } : null;
      if (live) live.textContent = 'Level ' + newLevel + ' reached!';
      if (typeof HookBus.emit === 'function') {
        HookBus.emit('onPlayerLevelUp', {
          newLevel: newLevel, prevLevel: prevLevel, reward: reward,
        });
      }
    }
  }

  HookBus.on('onSpinResult', function(){
    const bet = (typeof window !== 'undefined' && Number.isFinite(window.BET_UNITS)) ? window.BET_UNITS : 1;
    award(PXP_PER_BET * bet, 'spin');
  });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onCoinCollected', function(payload){
    if (!payload || !Array.isArray(payload.cellIds)) return;
    award(PXP_PER_COIN * payload.cellIds.length, 'coin');
  }) : void 0);
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function(){ if (PXP_PAUSE_FS) suspended = true; }) : void 0);
  HookBus.on('onFsEnd',     function(){ suspended = false; });
})();
`;
}
