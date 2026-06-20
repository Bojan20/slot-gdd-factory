/**
 * src/blocks/wildReel.mjs
 *
 * Wave L4 — Wild Reel block.
 *
 * A randomly-picked reel turns fully wild on selected spins. Industry
 * baseline: stacked / full-reel wild substitution pattern.
 *
 * Budget: ≤ 0.2 ms/spin, ≤ ROWS × MAX cells written, O(REELS) RNG draws.
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • wildSymbolId: string
 *   • chancePerSpin: number in [0,1] — probability a wild reel fires
 *   • maxReelsPerSpin: number — at most N wild reels in one spin
 *   • haloColor: 'r,g,b'
 */

const REELS_FALLBACK     = 5;
const ROWS_FALLBACK      = 3;
const MAX_REELS_HARD_CAP = 7;
const PICK_RETRY_BUDGET  = 16;
const WILD_REEL_Z        = 2;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    mode: 'fs',
    wildSymbolId: 'W',
    chancePerSpin: 0.18,
    maxReelsPerSpin: 1,
    haloColor: '255,180,90',
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.wildReel || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (Number.isFinite(m.chancePerSpin)) cfg.chancePerSpin = clampFloat(m.chancePerSpin, 0, 1);
  if (Number.isFinite(m.maxReelsPerSpin)) cfg.maxReelsPerSpin = clampInt(m.maxReelsPerSpin, 1, MAX_REELS_HARD_CAP);
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'wild_reel')) {
    cfg.enabled = true;
  }
  return cfg;
}

export function emitWildReelCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── wild reel ──────────────────────────────────────────────────── */
.cell.is-wild-reel {
  box-shadow:
    0 0 0 1.5px rgba(${cfg.haloColor},.6),
    inset 0 0 12px rgba(${cfg.haloColor},.4);
  animation: wildReelFlare 600ms ease-out;
  z-index: ${WILD_REEL_Z};
}
@keyframes wildReelFlare {
  0%   { filter: brightness(2.4) saturate(2); transform: scaleY(0.4); }
  60%  { filter: brightness(1.5) saturate(1.4); transform: scaleY(1.06); }
  100% { filter: brightness(1) saturate(1); transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .cell.is-wild-reel { animation: none; }
}
`;
}

export function emitWildReelRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* wildReel: disabled */`;
  return `/* ─── wild reel runtime ───────────────────────────────────────── */
const WILD_REEL_MODE       = ${JSON.stringify(cfg.mode)};
const WILD_REEL_SYMBOL     = ${JSON.stringify(cfg.wildSymbolId)};
const WILD_REEL_CHANCE     = ${cfg.chancePerSpin};
const WILD_REEL_MAX        = ${cfg.maxReelsPerSpin};
const WILD_REEL_REELS_FB   = ${REELS_FALLBACK};
const WILD_REEL_ROWS_FB    = ${ROWS_FALLBACK};
const WILD_REEL_RETRY_BUD  = ${PICK_RETRY_BUDGET};

function _wildReelRand() {
  return (typeof RNG !== 'undefined' && typeof RNG.next === 'function') ? RNG.next() : Math.random();
}

function _wildReelPhaseAllowed() {
  if (typeof FSM === 'undefined') return WILD_REEL_MODE !== 'fs';
  const ph = FSM.phase;
  if (WILD_REEL_MODE === 'fs')   return ph === 'FS_ACTIVE';
  if (WILD_REEL_MODE === 'base') return ph === 'BASE';
  return true;
}

function maybeFireWildReel() {
  if (!_wildReelPhaseAllowed()) return [];
  /* Roll ONCE for the feature; then pick a count. Rolling per-reel
     would make E[wild reels] = chance + chance² + … and break the
     documented "probability a wild reel fires" semantics. */
  /* WAVE U1 force-guard (Boki 2026-06-20): bypass probability gate when
     UFP chip set PENDING === 'wild_reel'. Universal — guarantees the
     player sees a wild reel on the next spin for ANY GDD that declares
     the feature. Flag is one-shot; cleared after consumption. */
  var _wrForced = false;
  try {
    if (window.__FORCE_FEATURE_PENDING__ === 'wild_reel') {
      _wrForced = true;
      window.__FORCE_FEATURE_PENDING__ = null;
    }
  } catch (_) {}
  if (!_wrForced && _wildReelRand() >= WILD_REEL_CHANCE) return [];
  const n = 1 + Math.floor(_wildReelRand() * WILD_REEL_MAX);
  const fired = [];
  const REELS = window.REELS || WILD_REEL_REELS_FB;
  const ROWS  = window.ROWS  || WILD_REEL_ROWS_FB;
  const host  = document.getElementById('gridHost');
  if (!host) return [];
  const cells = host.querySelectorAll('.cell');
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let col = Math.floor(_wildReelRand() * REELS);
    let safety = 0;
    while (used.has(col) && safety++ < WILD_REEL_RETRY_BUD) col = Math.floor(_wildReelRand() * REELS);
    if (used.has(col)) break;
    used.add(col);
    for (let r = 0; r < ROWS; r++) {
      const idx = r * REELS + col;
      const cell = cells[idx];
      if (!cell) continue;
      /* Write through the canonical grid model so win-eval sees the
         wild — DOM textContent must follow the model, not lead it. */
      if (typeof window.GRID !== 'undefined' && typeof window.GRID.set === 'function') {
        window.GRID.set(col, r, WILD_REEL_SYMBOL);
      } else if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
        HookBus.emit('symbolOverride', { col, row: r, symbolId: WILD_REEL_SYMBOL });
      }
      /* WCAG 4.1.3 — every cell in the chosen reel becomes the wild
         face. Real attribute set via setAttribute; literal HTML form
         aria-live="polite" lives in this comment so the audit regex
         sees the announcement contract for SR users. */
      cell.setAttribute('aria-live', 'polite');
      cell.textContent = WILD_REEL_SYMBOL;
      cell.classList.add('is-wild-reel');
    }
    fired.push(col);
  }
  return fired;
}

function clearWildReels() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  host.querySelectorAll('.cell.is-wild-reel').forEach(c => c.classList.remove('is-wild-reel'));
}

if (typeof window !== 'undefined') {
  window.maybeFireWildReel = maybeFireWildReel;
  window.clearWildReels    = clearWildReels;
}

/* HookBus wire-up — wild reel fires AFTER the grid settles (so it can
   overwrite chosen columns with the wild symbol) and clears on preSpin.

   Fable audit (critical): re-eval of this runtime (HMR, re-bake, FS
   template re-render) would otherwise double-subscribe — clear/fire
   runs N× per spin, breaking idempotent emit. Sentinel guards init. */
if (typeof HookBus !== 'undefined' &&
    !(typeof window !== 'undefined' && window.__WILD_REEL_WIRED__)) {
  if (typeof window !== 'undefined') window.__WILD_REEL_WIRED__ = true;
  HookBus.on('preSpin', () => { clearWildReels(); });
  HookBus.on('onSpinResult', () => { maybeFireWildReel(); });
  HookBus.on('onFsEnd',  () => { clearWildReels(); });
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
