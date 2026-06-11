/**
 * src/blocks/respin.mjs
 *
 * perf budget: O(reels*rows) DOM walk, ≤0.3ms @ 5×3
 * Accessibility: banner uses aria-live="polite" + role="status" for screen reader.
 *
 * Wave N2 — Respin block.
 *
 * Per-reel re-spin: after a base spin, optionally re-spin individual reels
 * (typically when 2 of 3 trigger symbols land, or as a paid feature).
 * Industry baseline: per-reel re-spin pattern — near-miss save respin or
 * paid feature respin.
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both' | 'paid'
 *   • triggerChance: number in [0,1] — auto-fire chance on a non-winning spin
 *   • costX: number — cost-multiplier if mode='paid' (gambleable respin)
 *   • holdRule: 'all-but-empty' | 'last-reel' | 'wild-anchor'
 *   • respinsPerTrigger: number (default 1)
 *   • haloColor: 'r,g,b'
 */

export function defaultConfig() {
  return {
    enabled: false,
    mode: 'base',
    reels: 5,
    triggerChance: 0.08,
    costX: 0,            // 0 = free (auto-trigger only)
    holdRule: 'last-reel',
    respinsPerTrigger: 1,
    haloColor: '120,210,255',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.respin || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.reels)) cfg.reels = clampInt(m.reels, 3, 10);
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both' || m.mode === 'paid') cfg.mode = m.mode;
  if (Number.isFinite(m.triggerChance)) cfg.triggerChance = clampFloat(m.triggerChance, 0, 1);
  if (Number.isFinite(m.costX)) cfg.costX = clampFloat(m.costX, 0, 1000);
  if (m.holdRule === 'all-but-empty' || m.holdRule === 'last-reel' || m.holdRule === 'wild-anchor') cfg.holdRule = m.holdRule;
  if (Number.isFinite(m.respinsPerTrigger)) cfg.respinsPerTrigger = clampInt(m.respinsPerTrigger, 1, 10);
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'respin')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitRespinCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── respin ────────────────────────────────────────────────────── */
.reelCol.is-respinning {
  box-shadow:
    inset 0 0 0 1.5px rgba(${cfg.haloColor},.7),
    0 0 18px rgba(${cfg.haloColor},.4);
  animation: respinGlow 1100ms ease-in-out infinite;
}
.cell.is-respin-hold {
  box-shadow:
    inset 0 0 0 2px rgba(${cfg.haloColor},.55);
}
@keyframes respinGlow {
  0%, 100% { filter: brightness(1); }
  50%      { filter: brightness(1.15); }
}
.respin-banner {
  position: fixed;
  top: 110px; left: 50%;
  transform: translateX(-50%);
  z-index: 65;
  background: rgba(0,0,0,.78);
  border: 1.5px solid rgba(${cfg.haloColor},.6);
  border-radius: 12px;
  padding: 0.45rem 0.95rem;
  color: rgba(${cfg.haloColor},1);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  display: none;
}
.respin-banner[data-show="true"] { display: inline-block; }
@media (prefers-reduced-motion: reduce) {
  .reelCol.is-respinning { animation: none; }
}
`;
}

export function emitRespinMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="respinBanner" class="respin-banner" role="status" aria-live="polite" data-show="false">RESPIN</div>`;
}

export function emitRespinRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* respin: disabled */`;
  return `/* ─── respin runtime ──────────────────────────────────────────── */
const RESPIN_MODE         = ${JSON.stringify(cfg.mode)};
const RESPIN_CHANCE       = ${cfg.triggerChance};
const RESPIN_COST_X       = ${cfg.costX};
const RESPIN_HOLD_RULE    = ${JSON.stringify(cfg.holdRule)};
const RESPIN_PER_TRIGGER  = ${cfg.respinsPerTrigger};
const REELS               = ${cfg.reels};
const RESPIN_STATE = { active: false, heldReels: new Set(), spinsLeft: 0 };

function _respinPhaseAllowed() {
  if (typeof FSM === 'undefined') return RESPIN_MODE !== 'fs';
  const ph = FSM.phase;
  if (RESPIN_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (RESPIN_MODE === 'base') return ph === 'BASE';
  if (RESPIN_MODE === 'paid') return ph === 'BASE'; // paid is base-only
  return true;
}

function _respinHeldReels() {
  /* Returns which reels to HOLD (others re-spin) */
  const heldSet = new Set();
  if (RESPIN_HOLD_RULE === 'all-but-empty') {
    /* Hold reels with pay symbols; re-spin empty columns */
    const host = document.getElementById('gridHost');
    if (host) {
      host.querySelectorAll('.cell').forEach((cell, idx) => {
        const symbol = (cell.textContent || '').trim();
        if (symbol) heldSet.add(idx % REELS);
      });
    }
  } else if (RESPIN_HOLD_RULE === 'last-reel') {
    /* Hold all but the rightmost reel */
    for (let c = 0; c < REELS - 1; c++) heldSet.add(c);
  } else if (RESPIN_HOLD_RULE === 'wild-anchor') {
    /* Hold reels that contain a wild */
    const host = document.getElementById('gridHost');
    const reg  = (typeof SYMBOL_REGISTRY !== 'undefined') ? SYMBOL_REGISTRY : null;
    const wild = reg && reg.wild;
    if (host && wild) {
      host.querySelectorAll('.cell').forEach((cell, idx) => {
        if ((cell.textContent || '').trim() === wild) heldSet.add(idx % REELS);
      });
    }
  }
  return heldSet;
}

function respinMaybeTrigger() {
  if (!_respinPhaseAllowed() || RESPIN_STATE.active) return false;
  /* Fable audit (critical): paid mode must NEVER auto-fire — that would
   * silently spend the player's bet on a respin they never asked for.
   * paid mode triggers ONLY via an explicit UI handler that emits
   * respinPaidCharge (currency deduction) before activating. */
  if (RESPIN_MODE === 'paid') return false;
  if (Math.random() >= RESPIN_CHANCE) return false;
  return respinStart();
}

function respinStart() {
  if (!_respinPhaseAllowed()) return false;
  RESPIN_STATE.active = true;
  RESPIN_STATE.spinsLeft = RESPIN_PER_TRIGGER;
  RESPIN_STATE.heldReels = _respinHeldReels();
  /* Flag visual: held cells get respin-hold class */
  const host = document.getElementById('gridHost');
  const REELS = window.REELS || 5;
  if (host) {
    host.querySelectorAll('.cell').forEach((cell, idx) => {
      const c = idx % REELS;
      if (RESPIN_STATE.heldReels.has(c)) cell.classList.add('is-respin-hold');
    });
    host.querySelectorAll('.reelCol').forEach((col, cIdx) => {
      if (!RESPIN_STATE.heldReels.has(cIdx)) col.classList.add('is-respinning');
    });
  }
  const ban = document.getElementById('respinBanner');
  if (ban) ban.dataset.show = 'true';
  return true;
}

function respinAfterSpin() {
  if (!RESPIN_STATE.active) return { ended: true };
  RESPIN_STATE.spinsLeft--;
  if (RESPIN_STATE.spinsLeft <= 0) {
    respinEnd();
    return { ended: true };
  }
  return { ended: false, left: RESPIN_STATE.spinsLeft };
}

function respinEnd() {
  RESPIN_STATE.active = false;
  RESPIN_STATE.heldReels.clear();
  RESPIN_STATE.spinsLeft = 0;
  const host = document.getElementById('gridHost');
  if (host) {
    host.querySelectorAll('.cell.is-respin-hold').forEach(c => c.classList.remove('is-respin-hold'));
    host.querySelectorAll('.reelCol.is-respinning').forEach(c => c.classList.remove('is-respinning'));
  }
  const ban = document.getElementById('respinBanner');
  if (ban) ban.dataset.show = 'false';
}

if (typeof window !== 'undefined') {
  window.respinMaybeTrigger = respinMaybeTrigger;
  window.respinStart        = respinStart;
  window.respinAfterSpin    = respinAfterSpin;
  window.respinEnd          = respinEnd;
  window.RESPIN_STATE       = RESPIN_STATE;
}

/* HookBus wire-up — respin maybe-triggers on postSpin (round close) when
   no respin is active, and counts down on each postSpin while active.
   Without this respin is dead code (logic defined but never called). */
if (typeof HookBus !== 'undefined') {
  HookBus.on('postSpin', () => {
    if (RESPIN_STATE.active) {
      respinAfterSpin();
    } else {
      respinMaybeTrigger();
    }
  });
  HookBus.on('onFsTrigger', () => { respinEnd(); });
  HookBus.on('onFsEnd',     () => { respinEnd(); });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function clampFloat(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
