/**
 * src/blocks/persistentMultiplier.mjs
 *
 * Wave M3 — Persistent Multiplier block.
 *
 * Multiplier that does NOT reset between spins inside a round (typically
 * FS round). Grows by `growPerWin`, capped at `maxMult`. HUD chip shows
 * current value. Industry baseline: progressive FS multiplier — ×2/×4/×8/×16
 * doubling ladder or arithmetic add-per-win cap.
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • startMult: number — starting multiplier (default 1)
 *   • growPerWin: number — added per winning spin
 *   • growPerCascade: number — added per cascade step (default 0)
 *   • maxMult: number — cap (0 = uncapped)
 *   • resetOnRoundEnd: boolean
 *   • chipColor: 'r,g,b'
 */

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'fs',
    startMult: 1,
    growPerWin: 1,
    growPerCascade: 0,
    maxMult: 0,
    resetOnRoundEnd: true,
    chipColor: '255,214,110',
  });
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.persistentMultiplier || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (Number.isFinite(m.startMult)) cfg.startMult = clampInt(m.startMult, 1, 1000);
  if (Number.isFinite(m.growPerWin)) cfg.growPerWin = clampInt(m.growPerWin, 0, 100);
  if (Number.isFinite(m.growPerCascade)) cfg.growPerCascade = clampInt(m.growPerCascade, 0, 100);
  if (Number.isFinite(m.maxMult)) cfg.maxMult = clampInt(m.maxMult, 0, 100000);
  if (m.resetOnRoundEnd != null) cfg.resetOnRoundEnd = !!m.resetOnRoundEnd;
  if (typeof m.chipColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.chipColor)) cfg.chipColor = m.chipColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'persistent_multiplier')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitPersistentMultiplierCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── persistent multiplier ─────────────────────────────────────── */
.pm-chip {
  position: fixed;
  /* W47.S8 (A9 safe-area) — was bottom: 80px / right: 22px which
   * overlapped the home-bar on notched iPhones and the right-edge
   * gesture zone on Android. Wrap in max(originalPx, safe-area-inset). */
  bottom: calc(max(80px, env(safe-area-inset-bottom, 0px) + 80px));
  right: calc(max(22px, env(safe-area-inset-right, 22px)));
  z-index: 55;
  background: rgba(0,0,0,.7);
  border: 1.5px solid rgba(${cfg.chipColor},.7);
  border-radius: 12px;
  padding: 0.5rem 0.85rem;
  color: rgba(${cfg.chipColor},1);
  font-size: 0.85rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  display: none;
  align-items: center;
  gap: 0.35rem;
  user-select: none;
  text-shadow: 0 0 6px rgba(${cfg.chipColor},.6);
  box-shadow: 0 0 14px rgba(${cfg.chipColor},.35);
}
.pm-chip[data-show="true"] { display: inline-flex; }
.pm-chip .pm-val { font-size: 1.05rem; }
.pm-chip.is-grown { animation: pmGrow 600ms cubic-bezier(.4,1.4,.5,1); }
@keyframes pmGrow {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.28); filter: brightness(1.4); }
  100% { transform: scale(1); filter: brightness(1); }
}
@media (max-width: 620px) {
  .pm-chip { padding: 0.35rem 0.65rem; font-size: 0.72rem; bottom: 60px; right: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .pm-chip.is-grown { animation: none; }
}
`;
}

export function emitPersistentMultiplierMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="pmChip" class="pm-chip" data-show="false" aria-live="polite">
  <span>MULT</span>
  <span class="pm-val">×1</span>
</div>`;
}

export function emitPersistentMultiplierRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* persistentMultiplier: disabled */`;
  return `/* ─── persistent multiplier runtime ───────────────────────────── */
(() => {
const PM_MODE          = ${JSON.stringify(cfg.mode)};
const PM_START         = ${cfg.startMult};
const PM_GROW_WIN      = ${cfg.growPerWin};
const PM_GROW_CASCADE  = ${cfg.growPerCascade};
const PM_MAX           = ${cfg.maxMult};
const PM_RESET_ON_END  = ${cfg.resetOnRoundEnd ? 'true' : 'false'};
let PM_CURRENT = PM_START;

function _pmPhaseAllowed() {
  if (typeof FSM === 'undefined') return PM_MODE !== 'fs';
  const ph = FSM.phase;
  if (PM_MODE === 'fs')   return ph === 'FS_ACTIVE' || ph === 'FS_INTRO';
  if (PM_MODE === 'base') return ph === 'BASE';
  return true;
}

function _pmRenderChip(grown) {
  const chip = document.getElementById('pmChip');
  if (!chip) return;
  chip.dataset.show = _pmPhaseAllowed() ? 'true' : 'false';
  const v = chip.querySelector('.pm-val');
  if (v) v.textContent = '×' + PM_CURRENT;
  if (grown) {
    chip.classList.remove('is-grown');
    void chip.offsetWidth;
    chip.classList.add('is-grown');
  }
}

function pmReset() {
  PM_CURRENT = PM_START;
  _pmRenderChip(false);
}

function pmOnWin() {
  if (!_pmPhaseAllowed() || PM_GROW_WIN === 0) return;
  const next = PM_CURRENT + PM_GROW_WIN;
  PM_CURRENT = PM_MAX > 0 ? Math.min(PM_MAX, next) : next;
  _pmRenderChip(true);
}

function pmOnCascade() {
  if (!_pmPhaseAllowed() || PM_GROW_CASCADE === 0) return;
  const next = PM_CURRENT + PM_GROW_CASCADE;
  PM_CURRENT = PM_MAX > 0 ? Math.min(PM_MAX, next) : next;
  _pmRenderChip(true);
}

function pmOnRoundEnd() {
  if (PM_RESET_ON_END) pmReset();
}

function pmGet() { return PM_CURRENT; }

if (typeof window !== 'undefined') {
  window.pmReset       = pmReset;
  window.pmOnWin       = pmOnWin;
  window.pmOnCascade   = pmOnCascade;
  window.pmOnRoundEnd  = pmOnRoundEnd;
  window.pmGet         = pmGet;
}

/* Initial render at boot */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => _pmRenderChip(false));
} else {
  _pmRenderChip(false);
}

/* HookBus wire-up — cascade growth on each tumble step, per-spin win bump
   only when the FS spin actually paid. Multiplier value is published via
   onMultChange so the canonical mult owner (winPresentation) reconciles —
   this block never writes HookBus.setMult directly (single-owner-emit). */
if (typeof HookBus !== 'undefined') {
  HookBus.on('onFsSpinResult', ({ events, totalWin } = {}) => {
    if (PM_GROW_WIN === 0) return;
    const paid = (Array.isArray(events) && events.some(e => Number(e && e.payX) > 0))
              || Number(totalWin) > 0;
    if (!paid) return;
    pmOnWin();
    const v = pmGet();
    if (v > 1) HookBus.emit('onMultChange', { source: 'persistent', value: v });
  });
  HookBus.on('onTumbleStep', ({ events } = {}) => {
    if (Array.isArray(events) && events.some(e => Number(e && e.payX) > 0)) {
      pmOnCascade();
      const v = pmGet();
      if (v > 1) HookBus.emit('onMultChange', { source: 'persistent', value: v });
    }
  });
  HookBus.on('onFsTrigger', () => { pmReset(); });
  HookBus.on('onFsEnd',     () => { pmOnRoundEnd(); });
}
})();
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
