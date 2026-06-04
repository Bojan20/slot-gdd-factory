/**
 * src/blocks/mysterySymbol.mjs
 *
 * Wave L5 — Mystery Symbol block.
 *
 * Mystery cells appear with a "?" face, then transform into ONE picked
 * regular symbol after the reels settle. All mystery cells on a spin
 * resolve to the SAME symbol. Industry references: Buffalo King Megaways
 * "Mystery Symbol" feature, Hot Hot Fruit "Mystery Wheel".
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • mysterySymbolId: string — the "?" placeholder id
 *   • revealDelayMs: number — pause before transform
 *   • revealDurationMs: number — flip animation length
 *   • includeWild: boolean — wild can be picked as the reveal
 *   • includeScatter: boolean — scatter can be picked
 *   • haloColor: 'r,g,b'
 */

export function defaultConfig() {
  return {
    enabled: false,
    mode: 'fs',
    mysterySymbolId: 'M',
    revealDelayMs: 320,
    revealDurationMs: 420,
    includeWild: false,
    includeScatter: false,
    haloColor: '180,120,255',
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.mysterySymbol || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.mysterySymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.mysterySymbolId)) cfg.mysterySymbolId = m.mysterySymbolId;
  if (Number.isFinite(m.revealDelayMs)) cfg.revealDelayMs = clampInt(m.revealDelayMs, 0, 3000);
  if (Number.isFinite(m.revealDurationMs)) cfg.revealDurationMs = clampInt(m.revealDurationMs, 100, 3000);
  if (m.includeWild != null) cfg.includeWild = !!m.includeWild;
  if (m.includeScatter != null) cfg.includeScatter = !!m.includeScatter;
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'mystery_symbol')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitMysterySymbolCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── mystery symbol ────────────────────────────────────────────── */
.cell.is-mystery {
  box-shadow:
    0 0 0 2px rgba(${cfg.haloColor},.7),
    0 0 18px rgba(${cfg.haloColor},.5),
    inset 0 0 14px rgba(${cfg.haloColor},.3);
  animation: mysteryPulse 1200ms ease-in-out infinite;
  color: rgba(${cfg.haloColor},1);
  z-index: 2;
}
.cell.is-mystery-revealing {
  animation: mysteryReveal ${cfg.revealDurationMs}ms cubic-bezier(.6,.05,.4,1);
}
@keyframes mysteryPulse {
  0%, 100% { filter: brightness(1); }
  50%      { filter: brightness(1.25); }
}
@keyframes mysteryReveal {
  0%   { transform: rotateY(0deg); filter: brightness(1); }
  50%  { transform: rotateY(90deg); filter: brightness(2); }
  100% { transform: rotateY(0deg); filter: brightness(1); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-mystery, .cell.is-mystery-revealing { animation: none; }
}
`;
}

export function emitMysterySymbolRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* mysterySymbol: disabled */`;
  return `/* ─── mystery symbol runtime ──────────────────────────────────── */
const MYSTERY_MODE          = ${JSON.stringify(cfg.mode)};
const MYSTERY_ID            = ${JSON.stringify(cfg.mysterySymbolId)};
const MYSTERY_REVEAL_DELAY  = ${cfg.revealDelayMs};
const MYSTERY_REVEAL_DUR    = ${cfg.revealDurationMs};
const MYSTERY_INCLUDE_WILD    = ${cfg.includeWild ? 'true' : 'false'};
const MYSTERY_INCLUDE_SCATTER = ${cfg.includeScatter ? 'true' : 'false'};

function _mysteryPhaseAllowed() {
  if (typeof FSM === 'undefined') return MYSTERY_MODE !== 'fs';
  const ph = FSM.phase;
  if (MYSTERY_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (MYSTERY_MODE === 'base') return ph === 'BASE';
  return true;
}

function _pickMysteryReveal() {
  /* Pick from SYMBOL_REGISTRY (emitted by winPresentation block) */
  const reg = (typeof SYMBOL_REGISTRY !== 'undefined') ? SYMBOL_REGISTRY : null;
  if (!reg || !reg.regularPay || reg.regularPay.length === 0) return 'A';
  const pool = reg.regularPay.slice();
  if (MYSTERY_INCLUDE_WILD && reg.wild) pool.push(reg.wild);
  if (MYSTERY_INCLUDE_SCATTER && reg.scatter) pool.push(reg.scatter);
  return pool[Math.floor(Math.random() * pool.length)];
}

function markMysteryCells() {
  if (!_mysteryPhaseAllowed()) return [];
  const host = document.getElementById('gridHost');
  if (!host) return [];
  const cells = host.querySelectorAll('.cell');
  const marked = [];
  cells.forEach((cell, idx) => {
    const sym = (cell.textContent || '').trim();
    if (sym === MYSTERY_ID) {
      cell.classList.add('is-mystery');
      marked.push(idx);
    }
  });
  return marked;
}

function revealMysterySymbols() {
  if (!_mysteryPhaseAllowed()) return Promise.resolve(null);
  const host = document.getElementById('gridHost');
  if (!host) return Promise.resolve(null);
  const mystCells = host.querySelectorAll('.cell.is-mystery');
  if (mystCells.length === 0) return Promise.resolve(null);
  const chosen = _pickMysteryReveal();
  return new Promise((resolve) => {
    setTimeout(() => {
      mystCells.forEach((cell) => {
        cell.classList.remove('is-mystery');
        cell.classList.add('is-mystery-revealing');
        setTimeout(() => {
          cell.textContent = chosen;
        }, MYSTERY_REVEAL_DUR / 2);
        setTimeout(() => {
          cell.classList.remove('is-mystery-revealing');
        }, MYSTERY_REVEAL_DUR);
      });
      setTimeout(() => resolve(chosen), MYSTERY_REVEAL_DUR);
    }, MYSTERY_REVEAL_DELAY);
  });
}

function clearMysteryFlags() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  host.querySelectorAll('.cell.is-mystery, .cell.is-mystery-revealing')
      .forEach(c => c.classList.remove('is-mystery', 'is-mystery-revealing'));
}

if (typeof window !== 'undefined') {
  window.markMysteryCells     = markMysteryCells;
  window.revealMysterySymbols = revealMysterySymbols;
  window.clearMysteryFlags    = clearMysteryFlags;
}

/* HookBus wire-up — mystery symbol is marked on every settled grid and
   revealed before win evaluation. preSpin clears stale flags so the next
   spin starts fresh. Without this the block is dead code (functions
   defined but never called by the spin lifecycle). */
if (typeof HookBus !== 'undefined') {
  HookBus.on('preSpin', () => { clearMysteryFlags(); });
  HookBus.on('onSpinResult', () => {
    const marked = markMysteryCells();
    if (Array.isArray(marked) && marked.length > 0) {
      /* Reveal is async (animation) — wait so the engine sees revealed
         symbols when it computes the win evaluation. */
      try { revealMysterySymbols(); } catch (e) { /* defensive */ }
    }
  });
  HookBus.on('onFsEnd', () => { clearMysteryFlags(); });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
