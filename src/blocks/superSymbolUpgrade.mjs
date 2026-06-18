/**
 * src/blocks/superSymbolUpgrade.mjs
 *
 * Wave LEGO-SSU — Super Symbol Upgrade (tumble-tier promotion).
 *
 * Purpose
 * ───────
 *   Composite of two industry-standard primitives:
 *     • "super symbol" oversized cell that lands during a tumble cascade
 *     • "symbol upgrade" tier promotion that walks LP → MP → HP as the
 *       cascade advances
 *   When a super symbol (U) is present on the settled grid, the block
 *   increments a tier counter and rewrites every LP cell to its MP
 *   counterpart (and on the next cascade step, MP cells lift to HP).
 *   Tier counter resets on preSpin. Distinct from:
 *     • superSymbol         (oversized N×N tile — no tier promotion)
 *     • symbolUpgrade       (per-cell roll on refill — no super gating)
 *     • multiplierLadder    (round-level multiplier, no per-cell rewrite)
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   "Super symbol with tier upgrade" pattern — the super marker on the
 *   board is the trigger that promotes the entire low-pay class to the
 *   mid-pay class on cascade step 1, then mid to high on step 2, capped
 *   at `maxTier`. The promotion is presentation + state — never alters
 *   audit-grade win evaluation, which has already run.
 *
 * Public API (server-side, ES module)
 * ──────────────────────────────────
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitSuperSymbolUpgradeCSS(cfg)
 *   emitSuperSymbolUpgradeMarkup(cfg)
 *   emitSuperSymbolUpgradeRuntime(cfg)
 *   nextTier(currentTier, maxTier)                                    (pure helper, exported for tests)
 *   upgradeSymbol(symbol, currentTier, lpTiers, mpTiers, hpTiers)     (pure helper, exported for tests)
 *
 * Lifecycle (HookBus contract)
 * ────────────────────────────
 *   subscribes:
 *     • preSpin        (priority 30) — reset SSU_STATE + clear classes
 *     • onTumbleStep   (priority 30) — scan for super symbol + promote tier
 *     • onSpinResult   (priority 30) — no-op marker for base-game branch
 *     • onFsTrigger    (priority 30) — clear state on FS entry
 *     • onFsEnd        (priority 30) — clear state on FS exit
 *   emits:
 *     • onSuperSymbolUpgraded     { tierLevel, upgradedCount }
 *     • onSuperSymbolUpgradeReset {}
 *
 * Runtime contract
 * ────────────────
 *   window.SSU_STATE = { tierLevel: number, upgradedCount: number }
 *
 * GDD config keys (model.superSymbolUpgrade)
 * ──────────────────────────────────────────
 *   { enabled, superSymbol: string,
 *     lpTiers: string[], mpTiers: string[], hpTiers: string[],
 *     maxTier: 1..5, appliesIn: 'base'|'fs'|'both',
 *     upgradeAnimMs: 200..3000, glowColor: hex, pulseMs: 200..2000 }
 *
 * Performance budget: ≤ 0.4 ms per tumble step on a 5×4 grid; 1
 * listener per event (wired-once via window.__SSU_WIRED__).
 *
 * a11y: upgraded cells carry aria-label="Upgraded to tier N" so SR users
 * hear the promotion; prefers-reduced-motion kills the pulse keyframe
 * (cells remain tinted as a static glow without strobing).
 *
 * Vendor-neutral, senior-grade, pure presentation + state. No math
 * decisions beyond emitting the upgrade event to HookBus.
 */

const APPLIES_IN          = Object.freeze(['base', 'fs', 'both']);
const MAX_TIER_MIN        = 1;
const MAX_TIER_MAX        = 5;
const UPGRADE_ANIM_MIN_MS = 200;
const UPGRADE_ANIM_MAX_MS = 3000;
const PULSE_MIN_MS        = 200;
const PULSE_MAX_MS        = 2000;

const HEX_COLOR_RE        = /^#[0-9a-fA-F]{3,8}$/;
const SYMBOL_RE           = /^[A-Za-z][A-Za-z0-9_]*$/;

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.trunc(n)));

const DEFAULT_LP_TIERS = Object.freeze(['10', 'J', 'Q', 'K', 'A']);
const DEFAULT_MP_TIERS = Object.freeze(['M1', 'M2', 'M3']);
const DEFAULT_HP_TIERS = Object.freeze(['H1', 'H2']);

function _sanitizeSymbolList(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const sym of list) {
    if (typeof sym !== 'string') continue;
    const trimmed = sym.trim();
    if (trimmed.length === 0 || trimmed.length > 8) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 16) break;
  }
  return out.length > 0 ? out : null;
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    superSymbol: 'U',
    lpTiers: [...DEFAULT_LP_TIERS],
    mpTiers: [...DEFAULT_MP_TIERS],
    hpTiers: [...DEFAULT_HP_TIERS],
    maxTier: 2,
    appliesIn: 'fs',
    upgradeAnimMs: 700,
    glowColor: '#ff66cc',
    pulseMs: 600,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  /* defaultConfig returns frozen arrays via spread; we copy again so
     downstream mutation never trips the freeze. */
  cfg.lpTiers = [...cfg.lpTiers];
  cfg.mpTiers = [...cfg.mpTiers];
  cfg.hpTiers = [...cfg.hpTiers];

  const src = (model && model.superSymbolUpgrade) || {};

  if (src.enabled === true) cfg.enabled = true;

  if (typeof src.superSymbol === 'string' && SYMBOL_RE.test(src.superSymbol)) {
    cfg.superSymbol = src.superSymbol;
  }

  const lp = _sanitizeSymbolList(src.lpTiers);
  if (lp) cfg.lpTiers = lp;

  const mp = _sanitizeSymbolList(src.mpTiers);
  if (mp) cfg.mpTiers = mp;

  const hp = _sanitizeSymbolList(src.hpTiers);
  if (hp) cfg.hpTiers = hp;

  if (Number.isFinite(src.maxTier)) {
    cfg.maxTier = clampInt(src.maxTier, MAX_TIER_MIN, MAX_TIER_MAX);
  }

  if (typeof src.appliesIn === 'string' && APPLIES_IN.includes(src.appliesIn)) {
    cfg.appliesIn = src.appliesIn;
  }

  if (Number.isFinite(src.upgradeAnimMs)) {
    cfg.upgradeAnimMs = clampInt(src.upgradeAnimMs, UPGRADE_ANIM_MIN_MS, UPGRADE_ANIM_MAX_MS);
  }

  if (typeof src.glowColor === 'string' && HEX_COLOR_RE.test(src.glowColor)) {
    cfg.glowColor = src.glowColor;
  }

  if (Number.isFinite(src.pulseMs)) {
    cfg.pulseMs = clampInt(src.pulseMs, PULSE_MIN_MS, PULSE_MAX_MS);
  }

  return cfg;
}

/**
 * Pure helper: compute the next tier counter level, capped at `maxTier`.
 * Negative or non-finite inputs collapse to 0 so callers never propagate
 * NaN into the upgrade promotion path.
 *
 * @param {number} currentTier  current tier level (0..maxTier)
 * @param {number} maxTier      hard cap (≥ 1)
 * @returns {number}
 */
export function nextTier(currentTier, maxTier) {
  const cap = Number.isFinite(maxTier) ? Math.max(0, Math.trunc(maxTier)) : 0;
  /* Defence-in-depth: non-finite (NaN/undefined) and negative inputs both
     collapse to 0 — never propagate corrupted state into a promotion bump
     that could overshoot the cap on the next call. */
  if (!Number.isFinite(currentTier)) return 0;
  const cur = Math.trunc(currentTier);
  if (cur < 0) return 0;
  const bumped = cur + 1;
  return bumped > cap ? cap : bumped;
}

/**
 * Pure helper: promote a single symbol by `currentTier` levels along the
 * LP → MP → HP ladder. tier=0 returns the symbol unchanged; tier=1 lifts
 * LP→MP (and MP→HP); tier=2 lifts LP→HP (and HP stays HP). Unknown
 * symbols (not in any tier) return unchanged.
 *
 * Position within the source tier maps modulo into the destination tier
 * so unbalanced ladders (e.g. 5 LP vs 3 MP) wrap deterministically.
 *
 * @param {string} symbol       current symbol id
 * @param {number} currentTier  promotion level (0..)
 * @param {string[]} lpTiers
 * @param {string[]} mpTiers
 * @param {string[]} hpTiers
 * @returns {string}
 */
export function upgradeSymbol(symbol, currentTier, lpTiers, mpTiers, hpTiers) {
  if (typeof symbol !== 'string' || symbol.length === 0) return symbol;
  const tier = Number.isFinite(currentTier) ? Math.max(0, Math.trunc(currentTier)) : 0;
  if (tier <= 0) return symbol;
  const lp = Array.isArray(lpTiers) ? lpTiers : [];
  const mp = Array.isArray(mpTiers) ? mpTiers : [];
  const hp = Array.isArray(hpTiers) ? hpTiers : [];

  const lpIdx = lp.indexOf(symbol);
  if (lpIdx >= 0) {
    if (tier === 1 && mp.length > 0) return mp[lpIdx % mp.length];
    if (tier >= 2 && hp.length > 0)  return hp[lpIdx % hp.length];
    return symbol;
  }
  const mpIdx = mp.indexOf(symbol);
  if (mpIdx >= 0) {
    if (tier >= 1 && hp.length > 0) return hp[mpIdx % hp.length];
    return symbol;
  }
  /* HP and unknown symbols pass through unchanged — top of ladder. */
  return symbol;
}

export function emitSuperSymbolUpgradeCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ superSymbolUpgrade: cfg });
  if (!c.enabled) return `\n/* superSymbolUpgrade BLOCK (disabled) — no CSS */\n`;
  return `
/* ── superSymbolUpgrade BLOCK — src/blocks/superSymbolUpgrade.mjs ── */
.cell.is-upgraded-tier-1 {
  position: relative;
  box-shadow:
    0 0 0 2px ${c.glowColor}aa,
    0 0 14px ${c.glowColor}66;
  z-index: 4;
  animation: ssu-pulse-1 ${c.pulseMs}ms ease-in-out infinite alternate;
}
.cell.is-upgraded-tier-2 {
  position: relative;
  box-shadow:
    0 0 0 3px ${c.glowColor}ff,
    0 0 22px ${c.glowColor}cc;
  z-index: 5;
  animation: ssu-pulse-2 ${c.pulseMs}ms ease-in-out infinite alternate;
}
.cell.is-ssu-super {
  position: relative;
  outline: 3px solid ${c.glowColor};
  outline-offset: -3px;
  z-index: 6;
}
@keyframes ssu-pulse-1 {
  0%   { filter: brightness(1)    drop-shadow(0 0 0  ${c.glowColor}); }
  100% { filter: brightness(1.2)  drop-shadow(0 0 8  ${c.glowColor}); }
}
@keyframes ssu-pulse-2 {
  0%   { filter: brightness(1.1)  drop-shadow(0 0 4  ${c.glowColor}); }
  100% { filter: brightness(1.45) drop-shadow(0 0 14 ${c.glowColor}); }
}
@keyframes ssu-upgrade-flash {
  0%   { transform: scale(1);    opacity: 1; }
  40%  { transform: scale(0.78); opacity: 0.45; }
  60%  { transform: scale(1.18); opacity: 0.9;  }
  100% { transform: scale(1);    opacity: 1;    }
}
.cell.is-ssu-flashing > * {
  animation: ssu-upgrade-flash ${c.upgradeAnimMs}ms cubic-bezier(.4,1.4,.6,1) forwards;
  display: inline-block;
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-upgraded-tier-1,
  .cell.is-upgraded-tier-2,
  .cell.is-ssu-flashing > * { animation: none; }
}
`;
}

export function emitSuperSymbolUpgradeMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ superSymbolUpgrade: cfg });
  if (!c.enabled) return `\n<!-- superSymbolUpgrade BLOCK (disabled) -->\n`;
  /* The upgrade decorates existing .cell elements owned by the renderer;
   * no server-emitted shell is required. Empty marker keeps the builder
   * orchestrator's `insert(markup)` slot deterministic. */
  return `
<!-- superSymbolUpgrade BLOCK — runtime-mounted on grid cells (no shell) -->
`;
}

export function emitSuperSymbolUpgradeRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ superSymbolUpgrade: cfg });
  if (!c.enabled) return `\n// superSymbolUpgrade BLOCK (disabled) — no runtime\n`;

  const superSymbol   = JSON.stringify(c.superSymbol);
  const lpTiersJson   = JSON.stringify(c.lpTiers);
  const mpTiersJson   = JSON.stringify(c.mpTiers);
  const hpTiersJson   = JSON.stringify(c.hpTiers);
  const maxTier       = c.maxTier;
  const appliesIn     = JSON.stringify(c.appliesIn);
  const upgradeAnimMs = c.upgradeAnimMs;

  return `
/* ── superSymbolUpgrade BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__SSU_WIRED__) return;
  window.__SSU_WIRED__ = true;

  var SUPER_SYMBOL    = ${superSymbol};
  var LP_TIERS        = ${lpTiersJson};
  var MP_TIERS        = ${mpTiersJson};
  var HP_TIERS        = ${hpTiersJson};
  var MAX_TIER        = ${maxTier};
  var APPLIES_IN      = ${appliesIn};
  var UPGRADE_ANIM_MS = ${upgradeAnimMs};

  window.SSU_STATE = {
    tierLevel: 0,
    upgradedCount: 0,
  };

  function _isFsActive() {
    if (window.FSM && typeof window.FSM === "object") {
      var st = window.FSM.state || window.FSM.phase;
      if (st && /^FS_/.test(st)) return true;
    }
    if (window.__SLOT_FSM_STATE && /^FS_/.test(window.__SLOT_FSM_STATE)) return true;
    if (window.FREESPINS && window.FREESPINS.remaining > 0) return true;
    return false;
  }

  function _isHwActive() {
    if (window.HW_STATE && window.HW_STATE.active === true) return true;
    if (window.__SLOT_FSM_STATE && /^HW_/.test(window.__SLOT_FSM_STATE)) return true;
    return false;
  }

  function _appliesNow() {
    if (APPLIES_IN === "fs")   return _isFsActive();
    if (APPLIES_IN === "base") return !_isFsActive();
    return true; /* "both" */
  }

  function _getGridCells() {
    var host = document.getElementById("gridHost") || document.querySelector(".reels, .grid, .play");
    if (!host) return [];
    return Array.from(host.querySelectorAll(".cell"));
  }

  function _hasSuperSymbol(cells) {
    for (var i = 0; i < cells.length; i++) {
      var txt = (cells[i].textContent || "").trim();
      if (txt === SUPER_SYMBOL) return true;
    }
    return false;
  }

  function _markSuperCells(cells) {
    for (var i = 0; i < cells.length; i++) {
      var txt = (cells[i].textContent || "").trim();
      if (txt === SUPER_SYMBOL) cells[i].classList.add("is-ssu-super");
    }
  }

  function _nextTier(cur) {
    var bumped = cur + 1;
    return bumped > MAX_TIER ? MAX_TIER : bumped;
  }

  function _upgradeSymbolFor(sym, tier) {
    if (tier <= 0) return sym;
    var lpIdx = LP_TIERS.indexOf(sym);
    if (lpIdx >= 0) {
      if (tier === 1 && MP_TIERS.length > 0) return MP_TIERS[lpIdx % MP_TIERS.length];
      if (tier >= 2 && HP_TIERS.length > 0)  return HP_TIERS[lpIdx % HP_TIERS.length];
      return sym;
    }
    var mpIdx = MP_TIERS.indexOf(sym);
    if (mpIdx >= 0) {
      if (tier >= 1 && HP_TIERS.length > 0) return HP_TIERS[mpIdx % HP_TIERS.length];
      return sym;
    }
    return sym;
  }

  function _paintUpgradedCell(cellEl, tierLevel) {
    /* Wipe any prior tier class so the highest-current-tier always wins. */
    cellEl.classList.remove("is-upgraded-tier-1");
    cellEl.classList.remove("is-upgraded-tier-2");
    var cls = tierLevel >= 2 ? "is-upgraded-tier-2" : "is-upgraded-tier-1";
    cellEl.classList.add(cls);
    cellEl.classList.add("is-ssu-flashing");
    cellEl.setAttribute("aria-label", "Upgraded to tier " + tierLevel);
    setTimeout(function() {
      if (cellEl && cellEl.classList) cellEl.classList.remove("is-ssu-flashing");
    }, UPGRADE_ANIM_MS + 16);
  }

  function _clearAllUpgradeClasses() {
    if (typeof document === "undefined") return;
    var marked = document.querySelectorAll(
      ".cell.is-upgraded-tier-1, .cell.is-upgraded-tier-2, .cell.is-ssu-super, .cell.is-ssu-flashing"
    );
    for (var i = 0; i < marked.length; i++) {
      marked[i].classList.remove("is-upgraded-tier-1");
      marked[i].classList.remove("is-upgraded-tier-2");
      marked[i].classList.remove("is-ssu-super");
      marked[i].classList.remove("is-ssu-flashing");
      marked[i].removeAttribute("aria-label");
    }
  }

  function _resetState() {
    window.SSU_STATE.tierLevel = 0;
    window.SSU_STATE.upgradedCount = 0;
    _clearAllUpgradeClasses();
    if (window.HookBus && typeof window.HookBus.emit === "function") {
      try { window.HookBus.emit('onSuperSymbolUpgradeReset', {}); } catch (_) {}
    }
  }

  function _onTumbleStep() {
    if (_isHwActive()) return;
    if (!_appliesNow()) return;
    var cells = _getGridCells();
    if (cells.length === 0) return;
    if (!_hasSuperSymbol(cells)) return;
    _markSuperCells(cells);
    var newTier = _nextTier(window.SSU_STATE.tierLevel);
    window.SSU_STATE.tierLevel = newTier;
    if (newTier <= 0) return;
    var upgraded = 0;
    for (var i = 0; i < cells.length; i++) {
      var cellEl = cells[i];
      var fromSym = (cellEl.textContent || "").trim();
      if (fromSym === SUPER_SYMBOL) continue;
      var toSym = _upgradeSymbolFor(fromSym, newTier);
      if (toSym === fromSym) continue;
      cellEl.textContent = toSym;
      _paintUpgradedCell(cellEl, newTier);
      upgraded += 1;
    }
    window.SSU_STATE.upgradedCount += upgraded;
    if (window.HookBus && typeof window.HookBus.emit === "function") {
      try {
        window.HookBus.emit('onSuperSymbolUpgraded', {
          tierLevel: newTier,
          upgradedCount: upgraded,
        });
      } catch (_) {}
    }
  }

  function _onPreSpin()      { _resetState(); }
  function _onFsTrigger()    { _resetState(); }
  function _onFsEnd()        { _resetState(); }
  function _onSpinResult()   { /* base-game marker — no-op; state lives on tumble */ }

  if (window.HookBus && typeof window.HookBus.on === "function") {
    window.HookBus.on('preSpin',      _onPreSpin,      { priority: 30 });
    window.HookBus.on('onTumbleStep', _onTumbleStep,   { priority: 30 });
    window.HookBus.on('onSpinResult', _onSpinResult,   { priority: 30 });
    window.HookBus.on('onFsTrigger',  _onFsTrigger,    { priority: 30 });
    window.HookBus.on('onFsEnd',      _onFsEnd,        { priority: 30 });
  }
})();
`;
}
