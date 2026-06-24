import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/addedSymbolsInjector.mjs
 *
 * UQ-DEEP-AK · WAVE 1 · BLOCK D — ADDED SYMBOLS INJECTOR.
 *
 * Presentation + state block for the industry-canonical "added symbols"
 * paradigm. During a feature phase (typically free spins / bonus), one
 * or more extra symbols (usually wild or scatter) are INJECTED into the
 * stopped grid AFTER the strip stop but BEFORE win evaluation. This
 * reduces variance and lifts the in-feature hit rate.
 *
 * Parser feeds this block from model.wild.special.added_symbols (single
 * rule) or model.addedSymbolsInjector (already-shaped array form). The
 * parser shape is { symbolId, count, addedDuring, evidence } — we wrap
 * single objects into the injections[] array transparently.
 *
 * Without this block the parser detects the rule but the renderer never
 * injects — a hard ship-blocker for any GDD declaring "additional wild
 * symbols added to reel during bonus".
 *
 * Vendor-neutral: industry-pattern only, no proprietary names, no
 * licensed math, no third-party trademarks referenced.
 */

const SCHEMA_VERSION = '1';

const ADDED_DURING_WHITELIST = Object.freeze(['baseGame', 'freeSpins', 'bonus']);
const SYMBOL_ID_RE = /^[A-Z0-9_]+$/;
const RGB_RE = /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/;

const COUNT_MIN = 1;
const COUNT_MAX = 10;
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 1;
const INJECTION_MS_MIN = 80;
const INJECTION_MS_MAX = 1500;

const MAX_INJECTIONS = 16;

/** Return a fresh frozen safe-default config. Caller may rely on a
 *  brand-new top-level object each call (never aliases between consumers). */
export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    injections: Object.freeze([]),
    haloRGB: '255,214,110',
    injectionMs: 280,
    schemaVersion: SCHEMA_VERSION,
  });
}

function _clampInt(n, lo, hi, fallback) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

function _clampFloat(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

function _isValidRGB(s) {
  if (typeof s !== 'string' || !RGB_RE.test(s)) return false;
  const parts = s.split(',').map((p) => parseInt(p.trim(), 10));
  if (parts.length !== 3) return false;
  return parts.every((v) => Number.isFinite(v) && v >= 0 && v <= 255);
}

/** Validate a single injection object. Returns sanitized frozen entry,
 *  or null if irrecoverably invalid (caller drops it). */
function _validateInjection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const symbolId = String(raw.symbolId || '');
  if (!SYMBOL_ID_RE.test(symbolId)) return null;
  const addedDuring = String(raw.addedDuring || '');
  if (!ADDED_DURING_WHITELIST.includes(addedDuring)) return null;
  const count = _clampInt(raw.count, COUNT_MIN, COUNT_MAX, null);
  if (count == null) return null;
  const weight = _clampFloat(
    raw.weight != null ? raw.weight : 1.0,
    WEIGHT_MIN, WEIGHT_MAX, 1.0
  );
  return Object.freeze({ symbolId, count, addedDuring, weight });
}

/** Wrap a parser-shape single object into an array if needed. */
function _coerceList(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    // Parser single-rule shape { symbolId, count, addedDuring, evidence }
    if ('symbolId' in raw || 'addedDuring' in raw) return [raw];
  }
  return [];
}

/** Filter, validate, dedupe (by symbolId+addedDuring pair). */
function _normalizeInjections(rawList) {
  const list = _coerceList(rawList).slice(0, MAX_INJECTIONS);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const v = _validateInjection(item);
    if (!v) continue;
    const key = v.symbolId + '|' + v.addedDuring;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function resolveConfig(model = {}) {
  const def = defaultConfig();

  // Source: explicit block config wins over parser shape.
  let rawSource = null;
  if (model && typeof model === 'object') {
    if (model.addedSymbolsInjector != null) {
      // Block-shaped { enabled?, injections, haloRGB?, injectionMs? }
      rawSource = model.addedSymbolsInjector;
    } else if (model.wild && typeof model.wild === 'object'
               && model.wild.special && typeof model.wild.special === 'object'
               && model.wild.special.added_symbols != null) {
      // Parser shape — single rule.
      rawSource = { injections: model.wild.special.added_symbols };
    }
  }

  let enabled = def.enabled;
  let injectionsRaw = null;
  let haloRGB = def.haloRGB;
  let injectionMs = def.injectionMs;

  if (rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource)) {
    if (rawSource.enabled === true) enabled = true;
    if (rawSource.enabled === false) enabled = false;
    if (typeof rawSource.haloRGB === 'string' && _isValidRGB(rawSource.haloRGB)) {
      haloRGB = rawSource.haloRGB;
    }
    if (rawSource.injectionMs != null) {
      injectionMs = _clampInt(rawSource.injectionMs, INJECTION_MS_MIN, INJECTION_MS_MAX, def.injectionMs);
    }
    injectionsRaw = rawSource.injections != null ? rawSource.injections : rawSource;
  } else if (Array.isArray(rawSource)) {
    injectionsRaw = rawSource;
  }

  const injections = _normalizeInjections(injectionsRaw);

  // Auto-enable when at least one valid injection AND not explicitly disabled.
  if (injections.length > 0 && rawSource && (rawSource.enabled == null || rawSource.enabled === true)) {
    enabled = true;
  }
  // Hard lock: empty injections → disabled regardless of caller intent.
  if (injections.length === 0) enabled = false;

  return Object.freeze({
    enabled,
    injections: Object.freeze(injections),
    haloRGB,
    injectionMs,
    schemaVersion: SCHEMA_VERSION,
  });
}

/* ─── emitters (namespaced + generic aliases) ─────────────────────── */

export function emitAddedSymbolsInjectorCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const halo = String(cfg.haloRGB).replace(/[^\d,\s]/g, '');
  return `
/* ─── added symbols injector ────────────────────────────────────── */
.asi-injected-cell {
  animation: asi-pop ${cfg.injectionMs + 40}ms ease-out;
  box-shadow: 0 0 8px rgba(${halo}, 0.9);
}
@keyframes asi-pop {
  0%   { transform: scale(0.4); opacity: 0; }
  60%  { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .asi-injected-cell { animation: none; }
}
`;
}

export function emitAddedSymbolsInjectorMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="asi-stage" class="asi-stage" aria-hidden="true"></div>`, 'addedSymbolsInjector');
}

export function emitAddedSymbolsInjectorRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const injectionsJSON = JSON.stringify(cfg.injections);
  const injectionMs = JSON.stringify(cfg.injectionMs);
  const haloRGB = JSON.stringify(String(cfg.haloRGB).replace(/[^\d,\s]/g, ''));
  return `/* ─── added symbols injector runtime ──────────────────────────── */
const ASI_INJECTIONS  = ${injectionsJSON};
const ASI_INJECTION_MS = ${injectionMs};
const ASI_HALO_RGB     = ${haloRGB};
const ASI_PHASE_WHITELIST = ['baseGame','freeSpins','bonus'];

function _asiDetectPhase() {
  if (typeof window !== 'undefined' && typeof window.__SLOT_PHASE__ === 'string') {
    if (ASI_PHASE_WHITELIST.indexOf(window.__SLOT_PHASE__) >= 0) return window.__SLOT_PHASE__;
  }
  return 'baseGame';
}

function _asiPickEmptyCells(grid, count) {
  if (!Array.isArray(grid) || grid.length === 0) return [];
  const candidates = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      candidates.push({ r: r, c: c });
    }
  }
  if (candidates.length === 0) return [];
  // Deterministic-ish shuffle via engine RNG when present.
  const rng = (typeof ENGINE_RNG === 'function') ? ENGINE_RNG : Math.random;
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
  }
  return candidates.slice(0, Math.max(0, Math.min(count, candidates.length)));
}

function _asiClearMarkers() {
  if (typeof document === 'undefined') return;
  const list = document.querySelectorAll('.asi-injected-cell');
  for (let i = 0; i < list.length; i++) {
    list[i].classList.remove('asi-injected-cell');
  }
}

function _asiInjectInto(grid, phase) {
  const matches = [];
  for (const inj of ASI_INJECTIONS) {
    if (inj.addedDuring !== phase) continue;
    const rng = (typeof ENGINE_RNG === 'function') ? ENGINE_RNG : Math.random;
    if (typeof inj.weight === 'number' && rng() >= inj.weight) continue;
    matches.push(inj);
  }
  if (matches.length === 0) return { grid: grid, injected: [] };
  const injected = [];
  let working = Array.isArray(grid)
    ? grid.map(function(r){ return Array.isArray(r) ? r.slice() : r; })
    : grid;
  for (const inj of matches) {
    const cells = _asiPickEmptyCells(working, inj.count);
    for (const cell of cells) {
      if (working[cell.r] && working[cell.r][cell.c] !== undefined) {
        working[cell.r][cell.c] = inj.symbolId;
        injected.push({ r: cell.r, c: cell.c, symbolId: inj.symbolId });
      }
    }
  }
  return { grid: working, injected: injected };
}

function _asiMarkDOMCells(injected) {
  if (typeof document === 'undefined') return;
  for (const ent of injected) {
    const sel = '[data-row="' + ent.r + '"][data-col="' + ent.c + '"]';
    const el = document.querySelector(sel);
    if (el && el.setAttribute) {
      el.setAttribute('data-symbol', ent.symbolId);
      el.classList.add('asi-injected-cell');
    }
  }
}

const _asiState = {
  lastPhase: null,
  lastInjected: [],
  injectionMs: ASI_INJECTION_MS,
};

function injectNow(phase) {
  const ph = (typeof phase === 'string' && ASI_PHASE_WHITELIST.indexOf(phase) >= 0)
    ? phase : _asiDetectPhase();
  let grid = (typeof window !== 'undefined' && Array.isArray(window.GRID_2D))
    ? window.GRID_2D : null;
  if (!grid) return { injected: [] };
  const res = _asiInjectInto(grid, ph);
  if (typeof window !== 'undefined') window.GRID_2D = res.grid;
  _asiState.lastPhase = ph;
  _asiState.lastInjected = res.injected;
  _asiMarkDOMCells(res.injected);
  return { injected: res.injected };
}

if (typeof window !== 'undefined') {
  window.addedSymbolsAPI = {
    injectNow: injectNow,
    state: _asiState,
    schemaVersion: '1',
  };
}

if (typeof HookBus !== 'undefined' && typeof window !== 'undefined' && !window.__ASI_WIRED__) {
  window.__ASI_WIRED__ = true;
  HookBus.on('preSpin', function(){
    _asiClearMarkers();
    _asiState.lastInjected = [];
  });
  // priority +30 — run BEFORE evaluation hooks (which sit at default 0).
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onSpinResult', function(ctx){
    let phase = null;
    if (ctx && typeof ctx === 'object' && typeof ctx.phase === 'string') phase = ctx.phase;
    injectNow(phase);
    try { (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('onAddedSymbolsInjected', { count: _asiState.lastInjected.length, phase: _asiState.lastPhase }) : void 0); } catch (_) {}
  }, { priority: 30 }) : void 0);
}
`;
}

/* Generic aliases (preferred by the universal orchestrator). */
export const emitCSS = emitAddedSymbolsInjectorCSS;
export const emitMarkup = emitAddedSymbolsInjectorMarkup;
export const emitRuntime = emitAddedSymbolsInjectorRuntime;
