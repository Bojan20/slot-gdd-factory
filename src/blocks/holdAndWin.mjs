/**
 * src/blocks/holdAndWin.mjs
 *
 * Wave N1 — Hold & Win / Hold & Spin block.
 *
 * Trigger: ≥N bonus/coin symbols on the grid → enter Hold round.
 * Mechanics: bonus symbols lock, you get K (default 3) respins.
 * Each new bonus symbol RESETS the respin counter to K.
 * Round ends: respins exhausted OR all cells locked (Grand jackpot).
 * Industry baseline: hold-and-spin coin-collection respin round (universal pattern).
 *
 * GDD knobs:
 *   • triggerCount: number — min bonus symbols to enter Hold (default 6)
 *   • bonusSymbolId: string — the lockable coin/bonus symbol
 *   • respinsAwarded: number — initial respin count (default 3)
 *   • resetOnNewBonus: boolean — true = each new bonus resets to respinsAwarded
 *   • haloColor: 'r,g,b'
 *   • jackpotLabels: array of label strings ("MINI","MINOR","MAJOR","GRAND")
 */

export function defaultConfig() {
  return {
    enabled: false,
    triggerCount: 6,
    bonusSymbolId: 'B',
    respinsAwarded: 3,
    resetOnNewBonus: true,
    haloColor: '255,160,40',
    jackpotLabels: ['MINI', 'MINOR', 'MAJOR', 'GRAND'],
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.holdAndWin || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.triggerCount)) cfg.triggerCount = clampInt(m.triggerCount, 3, 30);
  if (typeof m.bonusSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.bonusSymbolId)) cfg.bonusSymbolId = m.bonusSymbolId;
  if (Number.isFinite(m.respinsAwarded)) cfg.respinsAwarded = clampInt(m.respinsAwarded, 1, 12);
  if (m.resetOnNewBonus != null) cfg.resetOnNewBonus = !!m.resetOnNewBonus;
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;
  if (Array.isArray(m.jackpotLabels) && m.jackpotLabels.every(l => typeof l === 'string' && l.length <= 16)) {
    cfg.jackpotLabels = m.jackpotLabels.slice(0, 6);
  }
  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'hold_and_win')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitHoldAndWinCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── hold & win ────────────────────────────────────────────────── */
.cell.is-locked-bonus {
  box-shadow:
    0 0 0 2.5px rgba(${cfg.haloColor},.85),
    0 0 22px rgba(${cfg.haloColor},.6),
    inset 0 0 14px rgba(${cfg.haloColor},.3);
  color: rgba(${cfg.haloColor},1);
  z-index: 4;
  animation: hwLocked 1500ms ease-in-out infinite;
}
.cell.is-locked-bonus::after {
  content: '🪙';
  position: absolute;
  bottom: 3px; right: 4px;
  font-size: 0.55em;
  filter: drop-shadow(0 0 3px rgba(${cfg.haloColor},.9));
  pointer-events: none;
}
@keyframes hwLocked {
  0%, 100% { filter: brightness(1); }
  50%      { filter: brightness(1.22); }
}
.hw-hud {
  position: fixed;
  top: 60px; left: 50%;
  transform: translateX(-50%);
  z-index: 70;
  background: rgba(0,0,0,.78);
  border: 2px solid rgba(${cfg.haloColor},.7);
  border-radius: 14px;
  padding: 0.55rem 1.1rem;
  color: rgba(${cfg.haloColor},1);
  font-size: 0.9rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  display: none;
  gap: 1rem;
  text-shadow: 0 0 6px rgba(${cfg.haloColor},.7);
}
.hw-hud[data-show="true"] { display: inline-flex; }
.hw-hud .hw-box { display: flex; flex-direction: column; align-items: center; }
.hw-hud .hw-lbl { font-size: 0.7rem; opacity: 0.75; letter-spacing: 0.12em; } /* Wave UQ — ≥11px floor */
.hw-hud .hw-val { font-size: 1.05rem; }
@media (prefers-reduced-motion: reduce) {
  .cell.is-locked-bonus { animation: none; }
}
`;
}

export function emitHoldAndWinMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="hwHud" class="hw-hud" data-show="false" aria-live="polite">
  <div class="hw-box"><span class="hw-lbl">RESPINS</span><span class="hw-val" id="hwRespins">${cfg.respinsAwarded}</span></div>
  <div class="hw-box"><span class="hw-lbl">LOCKED</span><span class="hw-val" id="hwLocked">0</span></div>
</div>`;
}

export function emitHoldAndWinRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* holdAndWin: disabled */`;
  return `/* ─── hold & win runtime ──────────────────────────────────────── */
const HW_TRIGGER_COUNT  = ${cfg.triggerCount};
const HW_BONUS_SYMBOL   = ${JSON.stringify(cfg.bonusSymbolId)};
const HW_RESPINS_AWARD  = ${cfg.respinsAwarded};
const HW_RESET_ON_NEW   = ${cfg.resetOnNewBonus ? 'true' : 'false'};
const HW_JACKPOT_LABELS = ${JSON.stringify(cfg.jackpotLabels)};

const HW_STATE = {
  active: false,
  respinsLeft: 0,
  lockedCells: new Map(), /* 'r,c' → value */
};

function _hwHudShow(show) {
  const hud = document.getElementById('hwHud');
  if (!hud) return;
  hud.dataset.show = show ? 'true' : 'false';
}
function _hwHudUpdate() {
  const r = document.getElementById('hwRespins');
  const l = document.getElementById('hwLocked');
  if (r) r.textContent = String(HW_STATE.respinsLeft);
  if (l) l.textContent = String(HW_STATE.lockedCells.size);
}

function hwCountBonusOnGrid() {
  const host = document.getElementById('gridHost');
  if (!host) return 0;
  let n = 0;
  host.querySelectorAll('.cell').forEach(c => {
    if ((c.textContent || '').trim() === HW_BONUS_SYMBOL) n++;
  });
  return n;
}

function hwHarvestBonus() {
  /* Lock all current bonus cells, return how many NEW lock'd this spin */
  const host = document.getElementById('gridHost');
  if (!host) return 0;
  const REELS = window.REELS || 5;
  let added = 0;
  host.querySelectorAll('.cell').forEach((cell, idx) => {
    if ((cell.textContent || '').trim() !== HW_BONUS_SYMBOL) return;
    const r = Math.floor(idx / REELS);
    const c = idx % REELS;
    const key = r + ',' + c;
    if (!HW_STATE.lockedCells.has(key)) {
      HW_STATE.lockedCells.set(key, 'BONUS');
      added++;
    }
    cell.classList.add('is-locked-bonus');
  });
  return added;
}

function hwApplyLocks() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  const REELS = window.REELS || 5;
  const cells = host.querySelectorAll('.cell');
  HW_STATE.lockedCells.forEach((val, key) => {
    const [r, c] = key.split(',').map(n => parseInt(n, 10));
    const idx = r * REELS + c;
    const cell = cells[idx];
    if (!cell) return;
    cell.textContent = HW_BONUS_SYMBOL;
    cell.classList.add('is-locked-bonus');
  });
}

function hwMaybeEnter() {
  if (HW_STATE.active) return false;
  if (hwCountBonusOnGrid() >= HW_TRIGGER_COUNT) {
    HW_STATE.active = true;
    HW_STATE.respinsLeft = HW_RESPINS_AWARD;
    HW_STATE.lockedCells.clear();
    hwHarvestBonus();
    _hwHudShow(true);
    _hwHudUpdate();
    return true;
  }
  return false;
}

function hwAfterRespin() {
  if (!HW_STATE.active) return { ended: false, allLocked: false };
  const added = hwHarvestBonus();
  if (added > 0 && HW_RESET_ON_NEW) HW_STATE.respinsLeft = HW_RESPINS_AWARD;
  else HW_STATE.respinsLeft = Math.max(0, HW_STATE.respinsLeft - 1);
  const REELS = window.REELS || 5;
  const ROWS  = window.ROWS  || 3;
  const allLocked = HW_STATE.lockedCells.size >= REELS * ROWS;
  _hwHudUpdate();
  if (allLocked || HW_STATE.respinsLeft <= 0) {
    hwEnd();
    return { ended: true, allLocked };
  }
  return { ended: false, allLocked: false };
}

function hwEnd() {
  HW_STATE.active = false;
  HW_STATE.respinsLeft = 0;
  HW_STATE.lockedCells.clear();
  _hwHudShow(false);
  const host = document.getElementById('gridHost');
  if (host) host.querySelectorAll('.cell.is-locked-bonus').forEach(c => c.classList.remove('is-locked-bonus'));
}

if (typeof window !== 'undefined') {
  window.hwMaybeEnter    = hwMaybeEnter;
  window.hwAfterRespin   = hwAfterRespin;
  window.hwApplyLocks    = hwApplyLocks;
  window.hwHarvestBonus  = hwHarvestBonus;
  window.hwEnd           = hwEnd;
  window.HW_STATE        = HW_STATE;
}

/* HookBus wire-up — Hold & Win activates on postSpin (bonus symbol count
   meets triggerCount) and re-applies locked-cell visuals on every settled
   spin while the round is active. onFsTrigger/onFsEnd clear state so the
   board is fresh for each FS round. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('postSpin', () => {
    if (!HW_STATE.active) {
      hwMaybeEnter();
    } else {
      hwHarvestBonus();
      hwAfterRespin();
    }
  });
  HookBus.on('onSpinResult', () => {
    if (HW_STATE.active) hwApplyLocks();
  });
  HookBus.on('onFsTrigger', () => { hwEnd(); });
  HookBus.on('onFsEnd',     () => { hwEnd(); });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
