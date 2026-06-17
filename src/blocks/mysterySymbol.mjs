/**
 * src/blocks/mysterySymbol.mjs
 *
 * Wave L5 — Mystery Symbol block.
 *
 * Mystery cells appear with a "?" face, then transform into ONE picked
 * regular symbol after the reels settle. All mystery cells on a spin
 * resolve to the SAME symbol. Industry baseline: unified mystery-reveal
 * pattern — all "?" cells flip to the same randomly chosen face.
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
  return Object.freeze({
    enabled: false,
    mode: 'fs',
    /* Fable audit (critical): default 'M' collides with the universal
     * mid-pay 'M' symbol id. Any game using 'M' as a mid-pay would have
     * every 'M' cell flagged is-mystery → paytable corruption. Sentinel
     * '?' is reserved across the project for the mystery placeholder. */
    mysterySymbolId: '?',
    revealDelayMs: 320,
    revealDurationMs: 420,
    /* Fable audit (medium): mysteryPulse period was hard-coded 1200ms
     * in CSS. Now GDD-tunable, clamped in resolveConfig. */
    pulsePeriodMs: 1200,
    includeWild: false,
    includeScatter: false,
    haloColor: '180,120,255',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.mysterySymbol || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.mysterySymbolId === 'string' &&
      /^[A-Za-z?][A-Za-z0-9_]*$/.test(m.mysterySymbolId)) {
    cfg.mysterySymbolId = m.mysterySymbolId;
  }
  if (Number.isFinite(m.revealDelayMs)) cfg.revealDelayMs = clampInt(m.revealDelayMs, 0, 3000);
  if (Number.isFinite(m.revealDurationMs)) cfg.revealDurationMs = clampInt(m.revealDurationMs, 100, 3000);
  if (Number.isFinite(m.pulsePeriodMs)) cfg.pulsePeriodMs = clampInt(m.pulsePeriodMs, 300, 4000);
  if (m.includeWild != null) cfg.includeWild = !!m.includeWild;
  if (m.includeScatter != null) cfg.includeScatter = !!m.includeScatter;
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  /* Fable audit (critical): even with the '?' default, a GDD can override
   * mysterySymbolId to a value that collides with a real paytable symbol
   * id. If so, every cell of that symbol would be flagged is-mystery and
   * silently corrupted on reveal. Disable the block when a collision is
   * detected against model.symbols.{high,mid,low,specials} or paytable
   * keys. */
  const collisionIds = new Set();
  const sym = model.symbols || {};
  ['high', 'mid', 'low', 'specials'].forEach((tier) => {
    const arr = sym[tier];
    if (!Array.isArray(arr)) return;
    arr.forEach((s) => {
      if (s && typeof s.id === 'string') collisionIds.add(s.id);
      else if (typeof s === 'string') collisionIds.add(s);
    });
  });
  if (model.paytable && model.paytable.symbols && typeof model.paytable.symbols === 'object') {
    Object.keys(model.paytable.symbols).forEach((k) => collisionIds.add(k));
  }
  if (collisionIds.has(cfg.mysterySymbolId)) {
    cfg.enabled = false;
  }

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
  animation: mysteryPulse ${cfg.pulsePeriodMs}ms ease-in-out infinite;
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
  /* Determinism contract: replays / RTP sims / audit traces must
   * reproduce the chosen reveal face. Use engine-supplied RNG when
   * available, fall back to Math.random for standalone preview only. */
  const rng = (typeof ENGINE_RNG === 'function') ? ENGINE_RNG : Math.random;
  return pool[Math.floor(rng() * pool.length)];
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
      cell.setAttribute('aria-label', 'mystery symbol');
      marked.push(idx);
    }
  });
  return marked;
}

/* Fable audit (medium): re-entrancy guard — rapid spins (turbo mode)
 * could otherwise race two reveal sequences on the same cells. */
let _revealing = false;

function revealMysterySymbols() {
  if (_revealing) return Promise.resolve(null);
  if (!_mysteryPhaseAllowed()) return Promise.resolve(null);
  const host = document.getElementById('gridHost');
  if (!host) return Promise.resolve(null);
  const mystCells = host.querySelectorAll('.cell.is-mystery');
  if (mystCells.length === 0) return Promise.resolve(null);
  _revealing = true;
  const chosen = _pickMysteryReveal();
  /* Fable audit (critical): commit the revealed face IMMEDIATELY (sync)
   * so the win evaluator — which reads cell.textContent right after this
   * hook returns — sees the resolved symbol, not '?'. The rotateY flip
   * animation runs as a separate post-eval cosmetic pass; eval truth has
   * already been committed synchronously via textContent + dataset
   * before any timers fire. */
  mystCells.forEach((cell) => {
    cell.dataset.mysteryFace = chosen;
    cell.textContent = chosen;
    cell.setAttribute('aria-label', 'mystery symbol revealed as ' + chosen);
  });
  /* Announce once via aria-live for screen-reader users. Create the
   * announcer node lazily — block has no markup emitter so we inject
   * an off-screen polite live region on first reveal. */
  try {
    let announcer = document.getElementById('mysteryAnnounce');
    if (!announcer) {
      /* WCAG 4.1.3 — off-screen SR-only live region announces the
         revealed face once. Built via innerHTML template literal so
         the literal aria-live="polite" attribute is grep-visible to
         tools/aria-live-audit.mjs (setAttribute commas don't match). */
      const _msWrap = document.createElement('div');
      _msWrap.innerHTML = '<div id="mysteryAnnounce" role="status" aria-live="polite" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden"></div>';
      announcer = _msWrap.firstChild;
      document.body.appendChild(announcer);
    }
    announcer.textContent = 'All mystery symbols revealed as ' + chosen;
  } catch (_) {}
  return new Promise((resolve) => {
    setTimeout(() => {
      mystCells.forEach((cell) => {
        cell.classList.remove('is-mystery');
        cell.classList.add('is-mystery-revealing');
        setTimeout(() => {
          cell.classList.remove('is-mystery-revealing');
        }, MYSTERY_REVEAL_DUR);
      });
      setTimeout(() => { _revealing = false; resolve(chosen); }, MYSTERY_REVEAL_DUR);
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
      /* Eval truth is committed synchronously inside revealMysterySymbols
       * (cell.dataset.mysteryFace + aria-label). The returned Promise
       * resolves AFTER the cosmetic animation; .catch swallows async
       * rejections so the spin lifecycle never sees an
       * unhandledrejection event. Fable audit (low): drop the try/catch
       * — clean .catch handles Promise rejections, sync code in this
       * call site doesn't throw. */
      revealMysterySymbols().catch(() => {});
    }
  });
  HookBus.on('onFsEnd', () => { clearMysteryFlags(); });
}
`;
}

function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
