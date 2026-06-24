import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/symbolModifiers.mjs
 *
 * UQ-DEEP-AJ · P1B — SYMBOL MODIFIERS SCREEN LAYER.
 *
 * Unified screen-symbol modifier engine. Applies an ordered list of
 * deterministic transforms to the rendered grid AFTER the strip stop
 * but BEFORE win evaluation. Also exposes per-reel/per-symbol odds
 * masks so a single source of truth drives both the math sim and the
 * renderer (no drift).
 *
 * Other blocks (stickyWild, mysterySymbol, etc.) still own their
 * presentation. This block is the SCREEN-LAYER hub that lets a GDD
 * declare aggregate transforms (e.g. "mystery_reveal + copy_wild")
 * without scattering knobs across many blocks.
 *
 * GDD knobs:
 *   • transforms[]   — ordered list of {kind, params, label?}
 *   • oddsMasks[]    — per-reel/per-symbol landing overrides
 *   • mysteryRevealMode  — 'collective' | 'per-position'
 *   • copyWildDirection  — 'horizontal' | 'vertical' | 'all'
 *
 * Vendor-neutral: this block describes a generic industry screen
 * layer — no proprietary names, no licensed math, no third-party
 * trademarks referenced.
 */

const ALLOWED_TRANSFORM_KINDS = Object.freeze([
  'mystery_reveal',
  'copy_wild',
  'sticky_overlay',
  'wild_expand',
  'wild_multiply',
  'extended_wild',
  'added_symbols',
]);

const ALLOWED_MASK_KINDS = Object.freeze([
  'reel_restrict',
  'min_count',
  'max_count',
]);

const ALLOWED_REVEAL_MODES = Object.freeze(['collective', 'per-position']);
const ALLOWED_COPY_DIRECTIONS = Object.freeze(['horizontal', 'vertical', 'all']);

const MAX_LABEL_LEN = 64;
const MAX_LIST_LEN  = 32;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    transforms: Object.freeze([]),
    oddsMasks: Object.freeze([]),
    mysteryRevealMode: 'collective',
    copyWildDirection: 'horizontal',
    schemaVersion: '1',
  });
}

function _stripXSS(s) {
  if (typeof s !== 'string') return '';
  // remove any angle brackets entirely; keep alnum / common safe punct
  return s.replace(/[<>]/g, '').slice(0, MAX_LABEL_LEN);
}

function _sanitizeParams(p) {
  if (!p || typeof p !== 'object') return Object.freeze({});
  const out = {};
  for (const k of Object.keys(p)) {
    // only allow alnum-ish keys
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    const v = p[k];
    if (typeof v === 'string') out[k] = _stripXSS(v);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) {
      out[k] = Object.freeze(v.slice(0, MAX_LIST_LEN).map((x) =>
        typeof x === 'string' ? _stripXSS(x)
        : (typeof x === 'number' && Number.isFinite(x)) ? x
        : (typeof x === 'boolean') ? x
        : null
      ).filter((x) => x !== null));
    }
  }
  return Object.freeze(out);
}

function _filterTransforms(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list.slice(0, MAX_LIST_LEN)) {
    if (!t || typeof t !== 'object') continue;
    if (!ALLOWED_TRANSFORM_KINDS.includes(t.kind)) continue;
    out.push(Object.freeze({
      kind: t.kind,
      label: _stripXSS(t.label || ''),
      params: _sanitizeParams(t.params),
    }));
  }
  return out;
}

function _filterOddsMasks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const m of list.slice(0, MAX_LIST_LEN)) {
    if (!m || typeof m !== 'object') continue;
    if (!ALLOWED_MASK_KINDS.includes(m.kind)) continue;
    out.push(Object.freeze({
      kind: m.kind,
      label: _stripXSS(m.label || ''),
      params: _sanitizeParams(m.params),
    }));
  }
  return out;
}

export function resolveConfig(model = {}) {
  const def = defaultConfig();
  const m = (model && model.symbolModifiers) || {};
  const enabledExplicit = m.enabled != null;

  const transforms = Object.freeze(_filterTransforms(m.transforms));
  const oddsMasks  = Object.freeze(_filterOddsMasks(m.oddsMasks));

  let enabled = def.enabled;
  if (enabledExplicit) enabled = !!m.enabled;
  // auto-enable when GDD declares non-empty transforms or oddsMasks
  if (!enabledExplicit && (transforms.length > 0 || oddsMasks.length > 0)) {
    enabled = true;
  }
  // lock disabled when nothing to do — even if user set enabled=true
  if (transforms.length === 0 && oddsMasks.length === 0) {
    enabled = false;
  }

  let mysteryRevealMode = def.mysteryRevealMode;
  if (ALLOWED_REVEAL_MODES.includes(m.mysteryRevealMode)) {
    mysteryRevealMode = m.mysteryRevealMode;
  }
  let copyWildDirection = def.copyWildDirection;
  if (ALLOWED_COPY_DIRECTIONS.includes(m.copyWildDirection)) {
    copyWildDirection = m.copyWildDirection;
  }

  return Object.freeze({
    enabled,
    transforms,
    oddsMasks,
    mysteryRevealMode,
    copyWildDirection,
    schemaVersion: '1',
  });
}

export function emitSymbolModifiersCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── symbol modifiers screen layer ─────────────────────────────── */
.sym-mod-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}
.sym-mod-reveal-flash {
  animation: sym-mod-reveal-flash 480ms cubic-bezier(.6,.05,.4,1);
}
.sym-mod-copy-arrow {
  position: absolute;
  width: 18px; height: 18px;
  border-top: 2px solid rgba(255,214,110,.85);
  border-right: 2px solid rgba(255,214,110,.85);
  transform: rotate(45deg);
  filter: drop-shadow(0 0 4px rgba(255,214,110,.6));
  opacity: 0;
  animation: sym-mod-copy-arrow 520ms ease-out forwards;
}
@keyframes sym-mod-reveal-flash {
  0%   { filter: brightness(1); }
  50%  { filter: brightness(2.2); }
  100% { filter: brightness(1); }
}
@keyframes sym-mod-copy-arrow {
  0%   { opacity: 0; transform: rotate(45deg) translate(-8px, 8px); }
  60%  { opacity: 1; transform: rotate(45deg) translate(0, 0); }
  100% { opacity: 0; transform: rotate(45deg) translate(8px, -8px); }
}
@media (prefers-reduced-motion: reduce) {
  .sym-mod-reveal-flash, .sym-mod-copy-arrow { animation: none; }
}
`;
}

export function emitSymbolModifiersMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="sym-mod-stage" class="sym-mod-overlay" aria-hidden="true"></div>`, 'symbolModifiers');
}

export function emitSymbolModifiersRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* symbolModifiers: disabled */`;
  const transformsJSON = JSON.stringify(cfg.transforms);
  const masksJSON      = JSON.stringify(cfg.oddsMasks);
  const revealMode     = JSON.stringify(cfg.mysteryRevealMode);
  const copyDir        = JSON.stringify(cfg.copyWildDirection);
  return `/* ─── symbol modifiers runtime ─────────────────────────────────── */
const SYM_MOD_TRANSFORMS = ${transformsJSON};
const SYM_MOD_ODDS_MASKS = ${masksJSON};
const SYM_MOD_REVEAL_MODE = ${revealMode};
const SYM_MOD_COPY_DIR    = ${copyDir};
const SYM_MOD_ALLOWED_KINDS = ${JSON.stringify(ALLOWED_TRANSFORM_KINDS)};
const SYM_MOD_ALLOWED_MASKS = ${JSON.stringify(ALLOWED_MASK_KINDS)};

/* Pure helper: deep clone a grid (array-of-arrays of string symbol ids). */
function _symModCloneGrid(grid) {
  if (!Array.isArray(grid)) return grid;
  return grid.map((row) => Array.isArray(row) ? row.slice() : row);
}

/* Deterministic pick — engine-supplied RNG when available; falls back to
 * Math.random for standalone preview only. */
function _symModRng() {
  if (typeof ENGINE_RNG === 'function') return ENGINE_RNG;
  return Math.random;
}

/* Apply one transform kind to a 2-D grid. Returns a NEW grid; does not
 * mutate input. Unknown kinds are no-ops (defense in depth — config has
 * already filtered the whitelist). */
function applyTransform(grid, kind, params) {
  if (!Array.isArray(grid) || grid.length === 0) return grid;
  if (!SYM_MOD_ALLOWED_KINDS.indexOf || SYM_MOD_ALLOWED_KINDS.indexOf(kind) < 0) return grid;
  const p = params || {};
  const out = _symModCloneGrid(grid);
  const rng = _symModRng();

  if (kind === 'mystery_reveal') {
    const mysteryId = String(p.mysteryId || '?');
    const pool = Array.isArray(p.pool) ? p.pool.filter((s) => typeof s === 'string') : null;
    if (!pool || pool.length === 0) return out;
    if (SYM_MOD_REVEAL_MODE === 'collective') {
      const chosen = pool[Math.floor(rng() * pool.length)];
      for (let r = 0; r < out.length; r++) {
        for (let c = 0; c < out[r].length; c++) {
          if (out[r][c] === mysteryId) out[r][c] = chosen;
        }
      }
    } else { /* per-position */
      for (let r = 0; r < out.length; r++) {
        for (let c = 0; c < out[r].length; c++) {
          if (out[r][c] === mysteryId) {
            out[r][c] = pool[Math.floor(rng() * pool.length)];
          }
        }
      }
    }
    return out;
  }

  if (kind === 'copy_wild') {
    const wildId = String(p.wildId || 'W');
    const fromReel = Number.isFinite(p.fromReel) ? p.fromReel : 0;
    const toReels = Array.isArray(p.toReels) ? p.toReels.filter(Number.isFinite) : null;
    if (out.length === 0 || !Array.isArray(out[0])) return out;
    const cols = out[0].length;
    // detect wild rows on the from-reel
    const wildRows = [];
    for (let r = 0; r < out.length; r++) {
      if (out[r][fromReel] === wildId) wildRows.push(r);
    }
    if (wildRows.length === 0) return out;
    const targetCols = toReels || (() => {
      if (SYM_MOD_COPY_DIR === 'horizontal') {
        const list = [];
        for (let c = 0; c < cols; c++) if (c !== fromReel) list.push(c);
        return list;
      }
      // vertical / all — fall back to "all other cols"
      const list = [];
      for (let c = 0; c < cols; c++) if (c !== fromReel) list.push(c);
      return list;
    })();
    for (const r of wildRows) {
      for (const c of targetCols) {
        if (c >= 0 && c < cols) out[r][c] = wildId;
      }
    }
    return out;
  }

  if (kind === 'sticky_overlay') {
    const positions = Array.isArray(p.positions) ? p.positions : [];
    const symbol = String(p.symbol || 'W');
    for (const pos of positions) {
      if (!pos || typeof pos !== 'object') continue;
      const r = pos.r, c = pos.c;
      if (Number.isFinite(r) && Number.isFinite(c) && out[r] && out[r][c] !== undefined) {
        out[r][c] = symbol;
      }
    }
    return out;
  }

  if (kind === 'wild_expand') {
    const wildId = String(p.wildId || 'W');
    const reels = Array.isArray(p.reels) ? p.reels.filter(Number.isFinite) : null;
    if (out.length === 0) return out;
    const cols = (Array.isArray(out[0]) ? out[0].length : 0);
    if (!cols) return out;
    const targets = new Set();
    if (reels) reels.forEach((c) => targets.add(c));
    else {
      // detect cols with a wild — expand those
      for (let r = 0; r < out.length; r++) {
        for (let c = 0; c < cols; c++) {
          if (out[r][c] === wildId) targets.add(c);
        }
      }
    }
    for (const c of targets) {
      for (let r = 0; r < out.length; r++) {
        if (c >= 0 && c < cols) out[r][c] = wildId;
      }
    }
    return out;
  }

  if (kind === 'wild_multiply') {
    // Multiplier is a metadata layer — does not reshape symbols in the
    // grid. Persisted on a sidecar map for the evaluator to consume.
    if (typeof window !== 'undefined') {
      window.__SYM_MOD_WILD_MULT__ = Number.isFinite(p.multiplier) ? p.multiplier : 1;
    }
    return out;
  }

  if (kind === 'extended_wild') {
    // Lifetime metadata — extends existing sticky registry by N spins.
    if (typeof window !== 'undefined') {
      window.__SYM_MOD_EXTENDED_WILD_SPINS__ =
        Number.isFinite(p.spins) ? Math.max(0, Math.floor(p.spins)) : 1;
    }
    return out;
  }

  if (kind === 'added_symbols') {
    // Insert symbols into specified positions (idempotent: only fills
    // positions whose current symbol matches placeholderId, if given).
    const inserts = Array.isArray(p.inserts) ? p.inserts : [];
    const placeholderId = p.placeholderId != null ? String(p.placeholderId) : null;
    for (const ins of inserts) {
      if (!ins || typeof ins !== 'object') continue;
      const r = ins.r, c = ins.c;
      const sym = typeof ins.symbol === 'string' ? ins.symbol : null;
      if (!sym || !Number.isFinite(r) || !Number.isFinite(c)) continue;
      if (!out[r] || out[r][c] === undefined) continue;
      if (placeholderId != null && out[r][c] !== placeholderId) continue;
      out[r][c] = sym;
    }
    return out;
  }

  return out;
}

/* Apply odds-mask list to per-reel arrays. Pure: returns NEW arrays.
 * Inputs reelArrays: Array<Array<string>> (one symbol pool per reel). */
function applyOddsMask(reelArrays, masks) {
  if (!Array.isArray(reelArrays)) return reelArrays;
  let out = reelArrays.map((r) => Array.isArray(r) ? r.slice() : r);
  const list = Array.isArray(masks) ? masks : SYM_MOD_ODDS_MASKS;
  for (const mask of list) {
    if (!mask || typeof mask !== 'object') continue;
    if (SYM_MOD_ALLOWED_MASKS.indexOf(mask.kind) < 0) continue;
    const p = mask.params || {};
    const symbol = typeof p.symbol === 'string' ? p.symbol : null;
    if (!symbol) continue;

    if (mask.kind === 'reel_restrict') {
      const allowed = Array.isArray(p.reels) ? p.reels.filter(Number.isFinite) : [];
      const allowedSet = new Set(allowed);
      out = out.map((reel, idx) => {
        if (!Array.isArray(reel)) return reel;
        if (allowedSet.has(idx)) return reel;
        return reel.filter((s) => s !== symbol);
      });
      continue;
    }

    if (mask.kind === 'min_count' || mask.kind === 'max_count') {
      // Counts are advisory metadata — surfaced for the engine to enforce
      // during draw. Persisted on a sidecar map.
      if (typeof window !== 'undefined') {
        const bucket = window.__SYM_MOD_COUNT_RULES__ || (window.__SYM_MOD_COUNT_RULES__ = {});
        bucket[symbol] = bucket[symbol] || {};
        if (mask.kind === 'min_count' && Number.isFinite(p.count)) bucket[symbol].min = p.count;
        if (mask.kind === 'max_count' && Number.isFinite(p.count)) bucket[symbol].max = p.count;
      }
      continue;
    }
  }
  return out;
}

/* Idempotent DOM setup: ensure #sym-mod-stage exists. The block's static
 * markup emitter already places it; mountStage is the runtime guarantee
 * for late-mount scenarios (engine swaps gridHost or operator hot-reload
 * removes the stage). */
let _symModMounted = false;
function mountStage() {
  if (_symModMounted) return;
  if (typeof document === 'undefined') return;
  if (!document.getElementById('sym-mod-stage')) {
    const stage = document.createElement('div');
    stage.id = 'sym-mod-stage';
    stage.className = 'sym-mod-overlay';
    stage.setAttribute('aria-hidden', 'true');
    const host = document.getElementById('gridHost') || document.body;
    if (host && host.appendChild) host.appendChild(stage);
  }
  _symModMounted = true;
}

if (typeof window !== 'undefined') {
  window.symbolModifiersAPI = {
    applyTransform: applyTransform,
    applyOddsMask: applyOddsMask,
    mountStage: mountStage,
    transforms: SYM_MOD_TRANSFORMS,
    oddsMasks: SYM_MOD_ODDS_MASKS,
    schemaVersion: '1',
  };
}

/* HookBus wire-up: mount the stage at boot, run transforms after every
 * settled spin. Pure observer — does not regenerate RNG outcomes. */
if (typeof HookBus !== 'undefined' && typeof window !== 'undefined' && !window.__SYM_MOD_WIRED__) {
  window.__SYM_MOD_WIRED__ = true;
  HookBus.on('preSpin', () => { mountStage(); });
  HookBus.on('onSpinResult', () => {
    mountStage();
    // Engines that publish window.GRID_2D can pipe transforms in-line.
    if (typeof window.GRID_2D !== 'undefined' && Array.isArray(window.GRID_2D)) {
      let g = window.GRID_2D;
      for (const t of SYM_MOD_TRANSFORMS) {
        g = applyTransform(g, t.kind, t.params);
      }
      window.GRID_2D = g;
      try { (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('onSymbolModifiersApplied', { count: SYM_MOD_TRANSFORMS.length }) : void 0); } catch (_) {}
    }
  });
}
`;
}
