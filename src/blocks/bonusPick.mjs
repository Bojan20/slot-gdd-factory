/**
 * src/blocks/bonusPick.mjs
 *
 * Wave O1 — Bonus Pick / Pick-Em mini-game block.
 *
 * Modal overlay with K hidden tiles. Player clicks tiles to reveal prizes.
 * Round ends when a "Collect/POOP" tile is hit or all picks consumed.
 * Industry baseline: classic pick-em modal — hidden tile reveal with collect terminator.
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both' | 'triggered'
 *   • tileCount: number — total tiles on the board (default 12)
 *   • maxPicks: number — picks allowed (default 5)
 *   • prizePool: array of { label, value, weight }
 *   • endTokens: array of token labels that end the round (default ["POP"])
 *   • title: string — modal title
 *   • haloColor: 'r,g,b'
 *
 * Perf budget: CSS ≤ 1.5 KB, markup ≤ 1 KB for tileCount=12, runtime ≤ 2 KB,
 *              open→first-paint ≤ 16ms.
 */

const LIMITS = {
  tileCount: [3, 36],
  maxPicks: [1, 20],
  weight: [1, 1000],
  poolMax: 20,
  labelMax: 12,
  endTokensMax: 8,
  titleMax: 40,
};

export function defaultConfig() {
  return {
    enabled: false,
    mode: 'triggered',
    tileCount: 12,
    maxPicks: 5,
    prizePool: [
      { label: '×2',  value: 2,  weight: 28 },
      { label: '×5',  value: 5,  weight: 22 },
      { label: '×10', value: 10, weight: 18 },
      { label: '×25', value: 25, weight: 12 },
      { label: '×50', value: 50, weight: 7 },
      { label: '×100', value: 100, weight: 3 },
      { label: 'POP', value: 0, weight: 10 },
    ],
    endTokens: ['POP'],
    title: 'PICK A PRIZE',
    haloColor: '255,180,60',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.bonusPick || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both' || m.mode === 'triggered') cfg.mode = m.mode;
  if (Number.isFinite(m.tileCount)) cfg.tileCount = clampInt(m.tileCount, LIMITS.tileCount[0], LIMITS.tileCount[1]);
  if (Number.isFinite(m.maxPicks)) cfg.maxPicks = clampInt(m.maxPicks, LIMITS.maxPicks[0], LIMITS.maxPicks[1]);
  if (Array.isArray(m.prizePool) && m.prizePool.every(p => p && typeof p.label === 'string' && Number.isFinite(p.weight))) {
    cfg.prizePool = m.prizePool.slice(0, LIMITS.poolMax).map(p => ({
      label: p.label.slice(0, LIMITS.labelMax),
      value: Number.isFinite(p.value) ? p.value : 0,
      weight: clampInt(p.weight, LIMITS.weight[0], LIMITS.weight[1]),
    }));
  }
  if (Array.isArray(m.endTokens) && m.endTokens.every(t => typeof t === 'string')) {
    cfg.endTokens = m.endTokens.slice(0, LIMITS.endTokensMax);
  }
  if (typeof m.title === 'string' && m.title.length > 0 && m.title.length <= LIMITS.titleMax) cfg.title = m.title;
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (m.enabled == null && Array.isArray(model.features) && model.features.some(f => f.kind === 'bonus_pick')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitBonusPickCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── bonus pick ────────────────────────────────────────────────── */
.bp-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.84);
  backdrop-filter: blur(8px);
}
.bp-overlay[data-show="true"] { display: flex; }
.bp-modal {
  background: linear-gradient(160deg, #1a1015, #0a0608);
  border: 2.5px solid rgba(${cfg.haloColor},.7);
  border-radius: 18px;
  padding: 1.5rem 1.8rem;
  color: #f3eede;
  min-width: min(440px, 92vw);
  max-width: 94vw;
  box-shadow: 0 0 60px rgba(${cfg.haloColor},.45);
}
.bp-title {
  font-size: 1.2rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  color: rgba(${cfg.haloColor},1);
  text-align: center;
  margin-bottom: 0.9rem;
  text-shadow: 0 0 10px rgba(${cfg.haloColor},.55);
}
.bp-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.55rem;
  margin-bottom: 0.9rem;
}
.bp-tile {
  aspect-ratio: 1;
  background: linear-gradient(135deg, rgba(${cfg.haloColor},.18), rgba(${cfg.haloColor},.04));
  border: 2px solid rgba(${cfg.haloColor},.55);
  border-radius: 10px;
  font-size: 1.4rem;
  font-weight: 900;
  color: transparent;
  cursor: pointer;
  transition: transform .12s, background .12s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bp-tile:hover { transform: translateY(-2px); background: rgba(${cfg.haloColor},.25); }
.bp-tile:disabled { cursor: not-allowed; opacity: 0.55; transform: none; }
.bp-tile.is-revealed {
  color: rgba(${cfg.haloColor},1);
  background: rgba(0,0,0,.6);
  border-color: rgba(${cfg.haloColor},.85);
  text-shadow: 0 0 8px rgba(${cfg.haloColor},.85);
  animation: bpFlip 420ms cubic-bezier(.4,1.4,.5,1);
}
.bp-status {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  margin-bottom: 0.65rem;
  opacity: 0.85;
}
.bp-close {
  display: block;
  width: 100%;
  background: rgba(${cfg.haloColor},.85);
  color: #1a1010;
  border: none;
  border-radius: 10px;
  padding: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  cursor: pointer;
  display: none;
}
.bp-close[data-show="true"] { display: block; }
@keyframes bpFlip {
  0%   { transform: rotateY(180deg); }
  100% { transform: rotateY(0deg); }
}
@media (prefers-reduced-motion: reduce) {
  .bp-tile.is-revealed { animation: none; }
}
`;
}

export function emitBonusPickMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const tiles = Array.from({ length: cfg.tileCount }, (_, i) =>
    `<button class="bp-tile" data-bp-idx="${i}" type="button" aria-label="Pick ${i + 1}">?</button>`
  ).join('');
  return `<div id="bpOverlay" class="bp-overlay" data-show="false" role="dialog" aria-modal="true" aria-labelledby="bpTitle">
  <div class="bp-modal">
    <div id="bpTitle" class="bp-title">${escapeHtml(cfg.title)}</div>
    <div class="bp-status"><span>PICKS LEFT: <span id="bpLeft">${cfg.maxPicks}</span></span><span>TOTAL: <span id="bpTotal">0</span></span></div>
    <div class="bp-grid">${tiles}</div>
    <button id="bpClose" class="bp-close" data-show="false" type="button">COLLECT</button>
  </div>
</div>`;
}

export function emitBonusPickRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* bonusPick: disabled */`;
  return `/* ─── bonus pick runtime ──────────────────────────────────────── */
(function () {
  if (typeof window !== 'undefined' && window.__bpInit) return;
  if (typeof window !== 'undefined') window.__bpInit = true;

  const BP_MAX_PICKS = ${cfg.maxPicks};
  const BP_POOL = ${JSON.stringify(cfg.prizePool)};
  const BP_END_TOKENS = ${JSON.stringify(cfg.endTokens)};
  const BP_STATE = { active: false, picksLeft: 0, totalValue: 0, revealedIdx: new Set() };
  let _bpReturnFocus = null;

  /* Determinism: defer to host-provided seeded PRNG (window.__rng); fall back
     to Math.random only when no seeded source is wired (dev preview). */
  function _bpRand() {
    return (typeof window !== 'undefined' && typeof window.__rng === 'function')
      ? window.__rng()
      : Math.random();
  }

  function _bpEmit(name, payload) {
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      try { HookBus.emit(name, payload); } catch (_) { /* defensive */ }
    }
  }

  function _bpDrawPrize() {
    let total = 0;
    for (const p of BP_POOL) total += p.weight;
    let roll = _bpRand() * total;
    for (const p of BP_POOL) {
      roll -= p.weight;
      if (roll <= 0) return p;
    }
    return BP_POOL[BP_POOL.length - 1];
  }

  function _bpFocusables(ov) {
    const sel = '.bp-tile:not([disabled]), .bp-close[data-show="true"]';
    return Array.from(ov.querySelectorAll(sel));
  }

  function _bpKeydown(ev) {
    if (!BP_STATE.active) return;
    if (ev.key === 'Escape') { ev.preventDefault(); bpClose(); return; }
    if (ev.key !== 'Tab') return;
    const ov = document.getElementById('bpOverlay');
    if (!ov) return;
    const f = _bpFocusables(ov);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    const cur = document.activeElement;
    if (ev.shiftKey && cur === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus(); }
  }

  function bpOpen() {
    if (BP_STATE.active) return;
    BP_STATE.active = true;
    BP_STATE.picksLeft = BP_MAX_PICKS;
    BP_STATE.totalValue = 0;
    BP_STATE.revealedIdx.clear();
    const ov = document.getElementById('bpOverlay');
    if (!ov) return;
    _bpReturnFocus = document.activeElement;
    ov.dataset.show = 'true';
    document.getElementById('bpLeft').textContent = String(BP_STATE.picksLeft);
    document.getElementById('bpTotal').textContent = '0';
    document.getElementById('bpClose').dataset.show = 'false';
    const tiles = ov.querySelectorAll('.bp-tile');
    tiles.forEach(t => {
      t.disabled = false;
      t.classList.remove('is-revealed');
      t.textContent = '?';
    });
    if (tiles[0]) { try { tiles[0].focus(); } catch (_) {} }
    _bpEmit('bonusPick:opened', { picks: BP_MAX_PICKS });
  }

  function bpClose() {
    BP_STATE.active = false;
    const ov = document.getElementById('bpOverlay');
    if (ov) ov.dataset.show = 'false';
    _bpEmit('bonusPick:completed', { totalValue: BP_STATE.totalValue });
    if (_bpReturnFocus && typeof _bpReturnFocus.focus === 'function') {
      try { _bpReturnFocus.focus(); } catch (_) {}
    }
    _bpReturnFocus = null;
  }

  function _bpHandleClick(ev) {
    const t = ev.target.closest('.bp-tile');
    if (!t || t.disabled || !BP_STATE.active) return;
    const idx = parseInt(t.dataset.bpIdx, 10);
    if (BP_STATE.revealedIdx.has(idx)) return;
    const prize = _bpDrawPrize();
    BP_STATE.revealedIdx.add(idx);
    t.classList.add('is-revealed');
    t.textContent = prize.label;
    t.disabled = true;
    BP_STATE.totalValue += prize.value;
    BP_STATE.picksLeft--;
    document.getElementById('bpLeft').textContent = String(BP_STATE.picksLeft);
    document.getElementById('bpTotal').textContent = '×' + BP_STATE.totalValue;
    _bpEmit('bonusPick:revealed', { idx, prize, picksLeft: BP_STATE.picksLeft, totalValue: BP_STATE.totalValue });
    const isEnd = BP_END_TOKENS.includes(prize.label);
    if (isEnd || BP_STATE.picksLeft <= 0) {
      document.querySelectorAll('.bp-tile').forEach(x => x.disabled = true);
      const close = document.getElementById('bpClose');
      close.dataset.show = 'true';
      try { close.focus(); } catch (_) {}
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const ov = document.getElementById('bpOverlay');
    if (ov) {
      ov.addEventListener('click', _bpHandleClick);
      ov.addEventListener('keydown', _bpKeydown);
    }
    const closeBtn = document.getElementById('bpClose');
    if (closeBtn) closeBtn.addEventListener('click', bpClose);
  });

  if (typeof window !== 'undefined') {
    window.bpOpen    = bpOpen;
    window.bpClose   = bpClose;
    window.BP_STATE  = BP_STATE;
  }

  /* HookBus wire-up — block now owns its lifecycle hook
     ('feature:bonusPick:trigger') and emits canonical bonusPick:* events
     so downstream blocks (winRollup, totalsBar, etc.) can react. */
  if (typeof HookBus !== 'undefined') {
    HookBus.on('feature:bonusPick:trigger', () => { try { bpOpen(); } catch (_) {} });
    HookBus.on('onFsTrigger', () => { if (BP_STATE.open) bpClose(); });
    HookBus.on('onFsEnd',     () => { if (BP_STATE.open) bpClose(); });
    /* 2026-06-11 (Boki rule "pritisnes force dugme odradi se spin i onda
     * se dobije ishod forsa") — chip click arms pick modal for the next
     * postSpin so player sees: chip → reels spin → settle → pick modal. */
    HookBus.on('onForceFeatureRequested', (payload) => {
      if (!payload || payload.kind !== 'bonus_pick') return;
      window.__FORCE_BONUS_PICK_OPEN__ = true;
    });
    HookBus.on('postSpin', (p) => {
      if (!window.__FORCE_BONUS_PICK_OPEN__) return;
      if (p && p.duringFs) return;
      window.__FORCE_BONUS_PICK_OPEN__ = false;
      try { bpOpen(); } catch (_) { /* defensive */ }
    }, { priority: -60 });
  }
})();
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
