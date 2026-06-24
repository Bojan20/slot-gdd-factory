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
  return Object.freeze({
    enabled: false,
    mode: 'base',
    reels: 5,
    triggerChance: 0.08,
    costX: 0,            // 0 = free (auto-trigger only)
    holdRule: 'last-reel',
    respinsPerTrigger: 1,
    haloColor: '120,210,255',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
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
  /* W47.S8 (A9 safe-area) — was top: 110px which clipped under the
   * notch on iPhone landscape. Honour env(safe-area-inset-top) with
   * 110px fallback so the banner slides DOWN on notched devices. */
  top: calc(max(110px, env(safe-area-inset-top, 0px) + 110px));
  left: 50%;
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
/* W47.S1 fix (2026-06-15) — was 'const REELS = N;' which collided with
   the reelEngine block's earlier 'const REELS = SHAPE.reels;' and threw
   SyntaxError: Identifier REELS has already been declared, breaking
   bootstrap on every Respin_Wild synth fixture (24 cascading fails).
   Renamed to a block-local identifier so respin keeps its own count
   without clobbering the outer scope. Plain quotes (not backticks) so
   this comment can live inside the template literal of
   emitRespinRuntime() without prematurely closing it. */
const RESPIN_REELS        = ${cfg.reels};
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
        if (symbol) heldSet.add(idx % RESPIN_REELS);
      });
    }
  } else if (RESPIN_HOLD_RULE === 'last-reel') {
    /* Hold all but the rightmost reel */
    for (let c = 0; c < RESPIN_REELS - 1; c++) heldSet.add(c);
  } else if (RESPIN_HOLD_RULE === 'wild-anchor') {
    /* Hold reels that contain a wild */
    const host = document.getElementById('gridHost');
    const reg  = (typeof SYMBOL_REGISTRY !== 'undefined') ? SYMBOL_REGISTRY : null;
    const wild = reg && reg.wild;
    if (host && wild) {
      host.querySelectorAll('.cell').forEach((cell, idx) => {
        if ((cell.textContent || '').trim() === wild) heldSet.add(idx % RESPIN_REELS);
      });
    }
  }
  return heldSet;
}

function respinMaybeTrigger() {
  if (!_respinPhaseAllowed() || RESPIN_STATE.active) return false;
  /* WAVE U1 force-guard (Boki 2026-06-20): UFP chip can deterministically
     start a respin chain regardless of paid mode or RNG roll. Per
     rule_force_buttons_real_spin force MUST yield the feature. */
  try {
    if (window.__FORCE_FEATURE_PENDING__ === 'respin') {
      window.__FORCE_FEATURE_PENDING__ = null;
      return respinStart();
    }
  } catch (_) {}
  /* Fable audit (critical): paid mode must NEVER auto-fire — that would
   * silently spend the player's bet on a respin they never asked for.
   * paid mode triggers ONLY via an explicit UI handler that emits
   * respinPaidCharge (currency deduction) before activating. */
  if (RESPIN_MODE === 'paid') return false;
  if (Math.random() >= RESPIN_CHANCE) return false;
  return respinStart();
}

/* Bug #1 (2026-06-17, runOneBaseSpin wire) — was dead UX: respinStart
 * only flipped a flag + painted DOM classes; player saw the banner but
 * no spin ever happened, round just ended. Per slot-gdd-factory rule
 * "every force/feature trigger MUST drive a real spin via
 * runOneBaseSpin()", we now schedule the actual dispatch on a microtask
 * so the preSpin emit (from the next spin) doesn't reenter from inside
 * the current postSpin handler. Published held-reels list so a future
 * engine extension (per-reel hold) can consume; today's engine spins
 * all reels and the visual hold class communicates intent to the player. */
function _respinDispatchNextSpin() {
  if (typeof window === 'undefined' || typeof window.runOneBaseSpin !== 'function') return;
  window.__RESPIN_HOLD_REELS__ = Array.from(RESPIN_STATE.heldReels);
  setTimeout(() => {
    if (!RESPIN_STATE.active) return;       /* race: respinEnd() since schedule */
    try { window.runOneBaseSpin(); } catch (_) {}
  }, 0);
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
  _respinDispatchNextSpin();
  return true;
}

function respinAfterSpin() {
  if (!RESPIN_STATE.active) return { ended: true };
  RESPIN_STATE.spinsLeft--;
  if (RESPIN_STATE.spinsLeft <= 0) {
    respinEnd();
    return { ended: true };
  }
  /* Bug #1 (2026-06-17, chain) — countdown decremented but no follow-up
   * spin was dispatched, so spinsLeft=2 played at most 1 spin then froze
   * waiting for a postSpin that never came. Dispatch the next respin
   * spin so the chain runs end-to-end. */
  _respinDispatchNextSpin();
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
/* WASH PASS (2026-06-18) — wired-once sentinel + Hold & Win guard so
 * respin lifecycle does NOT fire during an active H&W round (would
 * mark cells .is-respin-hold and double-count respin counter against
 * the orb-sacred Hold & Win cell rendering). Guard mirrors the same
 * H&W gate pattern applied to multiplierOrb, persistent multiplier,
 * and the rest of the round-control family. */
if (typeof HookBus !== 'undefined' && typeof window !== 'undefined' && !window.__RESPIN_WIRED__) {
  window.__RESPIN_WIRED__ = true;
  HookBus.on('postSpin', () => {
    if (window.HW_STATE && window.HW_STATE.active) return;
    if (RESPIN_STATE.active) {
      respinAfterSpin();
    } else {
      respinMaybeTrigger();
    }
  });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', () => { respinEnd(); }) : void 0);
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
