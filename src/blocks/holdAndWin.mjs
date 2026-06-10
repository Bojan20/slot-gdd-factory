/**
 * src/blocks/holdAndWin.mjs
 *
 * Wave N1 — Hold & Win / Hold & Spin block.
 *
 * Trigger: ≥N bonus/coin symbols on the grid → enter Hold round.
 * Mechanics: bonus symbols lock, you get K (default 3) respins.
 * Each new bonus symbol RESETS the respin counter to K.
 * Round ends: respins exhausted OR all cells locked (Grand jackpot).
 * Industry baseline: hold-and-spin coin-collection respin round (universal
 * pattern — Lightning Link / WoO Zeus' Storm / Huff & Puff Hold & Spin).
 *
 * 2026-06-10 (Boki: "mora da se zadržava i bude vidljivo u reelu gde je
 * orb koji se dobio, ne da se pomerala sa rilom") — locked cells now
 * render as full coin-orbs with their value chip ('5x', '12x', 'MINI',
 * 'MINOR', 'MAJOR', 'GRAND') printed dead-center. The orb is anchored
 * via `dataset.lockedSymbol` + `dataset.orbValue` + `dataset.orbTier`
 * and protected by a MutationObserver auto-heal so any third-party
 * block (tumble refill, mystery reveal, walking wild commit) that
 * touches `.textContent` cannot wipe the orb out. WoO Zeus' Storm
 * pattern — orbs are sacred, they live on their cell until the round
 * collects them.
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
/* 2026-06-10 (Boki H&W vidljivost) — locked cells render as full coin-
 * orbs (WoO Zeus' Storm pattern). The cell underneath stays in place
 * (reelEngine rotateStripDown skips locked cells), and the orb VALUE is
 * rendered via ::before from data-orb-value. Jackpot tiers
 * (MINI/MINOR/MAJOR/GRAND) get their own ring color + uppercase label. */
.cell.is-locked-bonus {
  position: relative;
  background:
    radial-gradient(circle at 50% 42%,
      rgba(${cfg.haloColor},1.00) 0%,
      rgba(${cfg.haloColor},0.85) 40%,
      rgba(${cfg.haloColor},0.40) 70%,
      rgba(0,0,0,0.85) 100%) !important;
  box-shadow:
    0 0 0 3px rgba(${cfg.haloColor},.95),
    0 0 28px rgba(${cfg.haloColor},.7),
    inset 0 -4px 12px rgba(0,0,0,.45),
    inset 0 2px 6px rgba(255,255,255,.35);
  color: transparent !important;     /* hide the raw symbol char */
  text-shadow: none !important;
  z-index: 4;
  animation: hwLocked 1600ms ease-in-out infinite;
  overflow: hidden;
}
/* Orb value chip ('5x', 'MINI', etc.) drawn dead-center via ::before. */
.cell.is-locked-bonus::before {
  content: attr(data-orb-value);
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 900 1.05rem/1 system-ui, -apple-system, "SF Pro Display", "Segoe UI", sans-serif;
  letter-spacing: 0.05em;
  color: #1a0a00;
  text-shadow: 0 1px 0 rgba(255,255,255,.55), 0 -1px 1px rgba(0,0,0,.35);
  pointer-events: none;
  z-index: 2;
}
/* Glossy highlight cap */
.cell.is-locked-bonus::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(ellipse at 50% 22%,
    rgba(255,255,255,.55) 0%,
    rgba(255,255,255,0) 60%);
  pointer-events: none;
  z-index: 1;
}
/* Jackpot tier rings — match WoO MINI/MINOR/MAJOR/GRAND color grammar. */
.cell.is-locked-bonus[data-orb-tier="MINI"]  {
  box-shadow: 0 0 0 3px #6cb6ff, 0 0 32px rgba(108,182,255,.85),
              inset 0 -4px 12px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.35);
}
.cell.is-locked-bonus[data-orb-tier="MINOR"] {
  box-shadow: 0 0 0 3px #7fffa7, 0 0 32px rgba(127,255,167,.85),
              inset 0 -4px 12px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.35);
}
.cell.is-locked-bonus[data-orb-tier="MAJOR"] {
  box-shadow: 0 0 0 3px #c084ff, 0 0 36px rgba(192,132,255,.9),
              inset 0 -4px 12px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.35);
}
.cell.is-locked-bonus[data-orb-tier="GRAND"] {
  box-shadow: 0 0 0 3px #ff5566, 0 0 44px rgba(255,85,102,.95),
              inset 0 -4px 12px rgba(0,0,0,.45), inset 0 2px 6px rgba(255,255,255,.35);
  animation: hwLockedGrand 900ms ease-in-out infinite alternate;
}
@keyframes hwLocked {
  0%, 100% { filter: brightness(1)    saturate(1); transform: scale(1); }
  50%      { filter: brightness(1.22) saturate(1.15); transform: scale(1.04); }
}
@keyframes hwLockedGrand {
  from { filter: brightness(1)    saturate(1)    drop-shadow(0 0 6px rgba(255,85,102,.6)); }
  to   { filter: brightness(1.35) saturate(1.25) drop-shadow(0 0 16px rgba(255,85,102,1)); }
}
/* Orb pop-in animation when a fresh orb lands */
.cell.is-locked-bonus.hw-just-landed {
  animation: hwLandPop 520ms cubic-bezier(.2,1.4,.4,1) 1, hwLocked 1600ms ease-in-out infinite 520ms;
}
@keyframes hwLandPop {
  0%   { transform: scale(0.2) rotate(-12deg); opacity: 0; }
  60%  { transform: scale(1.18) rotate(4deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
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
.hw-hud .hw-lbl { font-size: 0.7rem; opacity: 0.75; letter-spacing: 0.12em; } /* ≥11px floor */
.hw-hud .hw-val { font-size: 1.05rem; }
@media (prefers-reduced-motion: reduce) {
  .cell.is-locked-bonus,
  .cell.is-locked-bonus[data-orb-tier="GRAND"],
  .cell.is-locked-bonus.hw-just-landed {
    animation: none;
  }
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

/* Orb value table — non-jackpot orbs roll a value × bet, jackpot tier
 * orbs use the canonical Lightning-Link tier labels. Distribution
 * mirrors WoO Zeus' Storm paytable: most orbs are small numeric values
 * (1x..15x), rare orbs are 25x..50x, and ~5% are jackpot tier. */
const HW_ORB_TABLE = [
  /* {label, weight, tier} */
  { label: '1x',  weight: 26, tier: null  },
  { label: '2x',  weight: 22, tier: null  },
  { label: '3x',  weight: 16, tier: null  },
  { label: '5x',  weight: 12, tier: null  },
  { label: '8x',  weight:  9, tier: null  },
  { label: '12x', weight:  6, tier: null  },
  { label: '15x', weight:  4, tier: null  },
  { label: '25x', weight:  2, tier: null  },
  { label: 'MINI',  weight: 1.6, tier: 'MINI'  },
  { label: 'MINOR', weight: 0.9, tier: 'MINOR' },
  { label: 'MAJOR', weight: 0.4, tier: 'MAJOR' },
  { label: 'GRAND', weight: 0.1, tier: 'GRAND' },
];

const HW_STATE = {
  active: false,
  respinsLeft: 0,
  /* 'r,c' → { label, tier } */
  lockedCells: new Map(),
  /* MutationObserver instance — heals textContent overwrites by third
   * parties (tumble refill, wild commit) so the orb visual contract
   * is impossible to break. */
  observer: null,
  /* Re-entrance guard. _hwApplyOrbToCell mutates DOM → fires observer
   * → observer calls hwApplyLocks → calls _hwApplyOrbToCell again →
   * infinite loop. While this flag is true the observer skips its
   * healing pass. */
  applying: false,
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

function _hwRollOrb() {
  /* Weighted roll over HW_ORB_TABLE. Returns { label, tier }. */
  var total = 0;
  for (var i = 0; i < HW_ORB_TABLE.length; i++) total += HW_ORB_TABLE[i].weight;
  var roll = Math.random() * total;
  for (var j = 0; j < HW_ORB_TABLE.length; j++) {
    roll -= HW_ORB_TABLE[j].weight;
    if (roll <= 0) return { label: HW_ORB_TABLE[j].label, tier: HW_ORB_TABLE[j].tier };
  }
  return { label: '1x', tier: null };
}

function _hwApplyOrbToCell(cell, orb) {
  /* Stamp dataset + class. textContent is also set so reelEngine
   * commitStopSymbols sees a "stable" symbol (any non-blank works because
   * the .is-locked-bonus guard already skips overwrite).
   * Re-entrance guard: every DOM write fires MutationObserver, but the
   * applying flag tells the observer to skip its heal pass for this
   * burst — preventing the apply→observe→heal→apply infinite loop. */
  HW_STATE.applying = true;
  try {
    cell.classList.add('is-locked-bonus');
    cell.dataset.lockedSymbol = HW_BONUS_SYMBOL;
    cell.dataset.orbValue = orb.label;
    if (orb.tier) cell.dataset.orbTier = orb.tier;
    else delete cell.dataset.orbTier;
    cell.textContent = HW_BONUS_SYMBOL;
    cell.classList.add('hw-just-landed');
    setTimeout(function() { try { cell.classList.remove('hw-just-landed'); } catch (_) {} }, 540);
  } finally {
    /* Drop the flag on the next microtask so any observer batch fired
     * from this synchronous burst still sees applying=true. */
    Promise.resolve().then(function() { HW_STATE.applying = false; });
  }
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
  /* Lock every BONUS cell on the grid, generating an orb value for each
   * NEW lock. Returns count of newly-locked cells.
   *
   * 2026-06-10 (Boki H&W vidljivost) — every fresh lock now gets a
   * weighted-rolled orb value (1x..GRAND) so the player sees what they
   * won immediately, not just a generic halo. Existing locked cells are
   * re-stamped (idempotent — class + dataset re-applied even if the DOM
   * was clobbered between spins). */
  const host = document.getElementById('gridHost');
  if (!host) return 0;
  const REELS = window.REELS || 5;
  let added = 0;
  host.querySelectorAll('.cell').forEach((cell, idx) => {
    const txt = (cell.textContent || '').trim();
    const alreadyLocked = cell.classList.contains('is-locked-bonus');
    if (txt !== HW_BONUS_SYMBOL && !alreadyLocked) return;
    const r = Math.floor(idx / REELS);
    const c = idx % REELS;
    const key = r + ',' + c;
    if (!HW_STATE.lockedCells.has(key)) {
      const orb = _hwRollOrb();
      HW_STATE.lockedCells.set(key, orb);
      _hwApplyOrbToCell(cell, orb);
      added++;
    } else {
      /* Re-apply (idempotent) — keep existing orb data. */
      const orb = HW_STATE.lockedCells.get(key);
      _hwApplyOrbToCell(cell, orb);
      cell.classList.remove('hw-just-landed'); /* don't replay pop */
    }
  });
  return added;
}

function hwApplyLocks() {
  /* Belt+braces re-application of locked orbs on every settle. With the
   * reelEngine rotateStripDown / commitStopSymbols guards in place this is
   * a no-op for well-behaved spins, but it covers external paths (tumble
   * refill, mystery reveal, sticky/walking wild commit) that may still
   * touch cell.textContent during their pass. */
  const host = document.getElementById('gridHost');
  if (!host) return;
  const REELS = window.REELS || 5;
  const cells = host.querySelectorAll('.cell');
  HW_STATE.lockedCells.forEach((orb, key) => {
    const [r, c] = key.split(',').map(n => parseInt(n, 10));
    const idx = r * REELS + c;
    const cell = cells[idx];
    if (!cell) return;
    _hwApplyOrbToCell(cell, orb);
    cell.classList.remove('hw-just-landed');
  });
}

function _hwInstallObserver() {
  /* 2026-06-10 (Boki H&W "ne da se pomera s rilom") — MutationObserver
   * watches every locked cell's textContent + classList. If a sibling
   * block (tumble refill, mystery reveal) clobbers either, this restores
   * the orb on the next microtask. This is the autonomic immune system
   * for hold-and-win — third-party blocks no longer need to know about
   * lock contract. */
  if (HW_STATE.observer) return;
  if (typeof MutationObserver !== 'function') return;
  const host = document.getElementById('gridHost');
  if (!host) return;
  HW_STATE.observer = new MutationObserver(function(mutations) {
    if (!HW_STATE.active) return;
    /* Re-entrance guard — skip while we are the ones writing. */
    if (HW_STATE.applying) return;
    let needsHeal = false;
    const allCells = host.querySelectorAll('.cell');
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      const target = m.target;
      if (!(target && target.nodeType === 1)) continue;
      const cell = target.classList && target.classList.contains('cell')
        ? target
        : (target.closest ? target.closest('.cell') : null);
      if (!cell) continue;
      /* Did this cell USED to be locked? Check our state map. */
      const idx = Array.prototype.indexOf.call(allCells, cell);
      if (idx < 0) continue;
      const REELS = window.REELS || 5;
      const key = Math.floor(idx / REELS) + ',' + (idx % REELS);
      if (HW_STATE.lockedCells.has(key)) {
        /* Only heal if the orb visual contract is actually broken — text
         * cleared, class stripped, or dataset wiped. Otherwise the
         * mutation was our own setTimeout removing hw-just-landed. */
        const txt = (cell.textContent || '').trim();
        const hasClass = cell.classList.contains('is-locked-bonus');
        const hasData = !!cell.dataset.orbValue;
        if (txt !== HW_BONUS_SYMBOL || !hasClass || !hasData) needsHeal = true;
      }
    }
    if (needsHeal) hwApplyLocks();
  });
  HW_STATE.observer.observe(host, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}
function _hwTeardownObserver() {
  if (HW_STATE.observer) {
    try { HW_STATE.observer.disconnect(); } catch (_) {}
    HW_STATE.observer = null;
  }
}

function hwMaybeEnter() {
  if (HW_STATE.active) return false;
  if (hwCountBonusOnGrid() >= HW_TRIGGER_COUNT) {
    HW_STATE.active = true;
    HW_STATE.respinsLeft = HW_RESPINS_AWARD;
    HW_STATE.lockedCells.clear();
    hwHarvestBonus();
    _hwInstallObserver();
    _hwHudShow(true);
    _hwHudUpdate();
    return true;
  }
  return false;
}

/* Force-seed entry: skip the grid-count gate. Used by the UFP H&W chip
 * so the player can see the orb-locking mechanic on any GDD, even one
 * whose reel pool doesn't actually contain the bonus symbol. Drops N
 * orbs in random cells and starts the round. */
function hwForceSeed(orbCount) {
  if (HW_STATE.active) return false;
  const host = document.getElementById('gridHost');
  if (!host) return false;
  const allCells = Array.from(host.querySelectorAll('.cell'));
  if (allCells.length === 0) return false;
  const REELS = window.REELS || 5;
  /* Pick orbCount random distinct cells. */
  const N = Math.max(1, Math.min(orbCount || Math.max(3, Math.floor(HW_TRIGGER_COUNT / 2)), allCells.length));
  const picked = new Set();
  while (picked.size < N) picked.add(Math.floor(Math.random() * allCells.length));

  HW_STATE.active = true;
  HW_STATE.respinsLeft = HW_RESPINS_AWARD;
  HW_STATE.lockedCells.clear();

  picked.forEach(function(idx) {
    const cell = allCells[idx];
    const r = Math.floor(idx / REELS);
    const c = idx % REELS;
    const key = r + ',' + c;
    const orb = _hwRollOrb();
    HW_STATE.lockedCells.set(key, orb);
    _hwApplyOrbToCell(cell, orb);
  });

  _hwInstallObserver();
  _hwHudShow(true);
  _hwHudUpdate();
  return true;
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
  _hwTeardownObserver();
  _hwHudShow(false);
  const host = document.getElementById('gridHost');
  if (host) host.querySelectorAll('.cell.is-locked-bonus').forEach(c => {
    c.classList.remove('is-locked-bonus', 'hw-just-landed');
    delete c.dataset.lockedSymbol;
    delete c.dataset.orbValue;
    delete c.dataset.orbTier;
  });
}

if (typeof window !== 'undefined') {
  window.hwMaybeEnter    = hwMaybeEnter;
  window.hwAfterRespin   = hwAfterRespin;
  window.hwApplyLocks    = hwApplyLocks;
  window.hwHarvestBonus  = hwHarvestBonus;
  window.hwForceSeed     = hwForceSeed;
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

  /* 2026-06-10 (Boki force-rule + vidljivost) — UFP chip emits
   * onForceFeatureRequested with kind='hold_and_win'. Force-seed N orbs
   * (≈ triggerCount/2 by default) on random cells and start the round so
   * the player sees the lock-and-spin mechanic immediately on any GDD,
   * even one whose reel pool doesn't contain the bonus symbol. The next
   * base spins then run with the lock contract honored by reelEngine. */
  HookBus.on('onForceFeatureRequested', (payload) => {
    if (!payload || payload.kind !== 'hold_and_win') return;
    try { hwForceSeed(Math.max(3, Math.ceil(HW_TRIGGER_COUNT / 2))); }
    catch (_) { /* defensive */ }
  });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
