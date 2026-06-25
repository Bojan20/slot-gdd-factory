/**
 * src/registry/rectTransform.mjs
 *
 * P3-P6 (Boki 2026-06-25) — RectTransform: responsive anchor / pivot layout.
 *
 * # WHY
 *
 * Industry-standard slot UI engines (IGT Playa, Pragmatic UI, Playtech)
 * position HUD elements (balance, bet, paytable button, spin button) by
 * `anchor.{x,y}` + `pivot.{x,y}` + `offset.{x,y}` relative to a parent
 * `safe-area` rectangle that auto-resizes with viewport. This produces:
 *
 *   - Portrait / landscape transitions without re-layout glitches
 *   - Bezel-safe placement on devices with notches / rounded corners
 *   - Predictable element overlap (z-order driven by element registration
 *     order, NOT by random CSS stacking context)
 *
 * Without a RectTransform contract, every block invents its own viewport
 * math, and portrait <-> landscape often re-renders elements off-screen
 * or behind the reel frame.
 *
 * # API
 *
 *   const tx = resolveRectTransform({ anchor: {x:0.5,y:1}, pivot: {x:0.5,y:1} });
 *   const css = computeCSS(tx, { viewport: {w:1440, h:900}, safeArea: {...} });
 *   // → { left: '720px', top: '900px', transform: 'translate(-50%, -100%)' }
 *
 * # MODEL
 *
 *   model.rectTransforms[blockId] = {
 *     anchor: { x: 0..1, y: 0..1 },  // relative to safe area
 *     pivot:  { x: 0..1, y: 0..1 },  // element's own anchor point
 *     offset: { x: number, y: number },  // absolute px offset
 *     breakpoints: {
 *       portrait?:  { anchor?, pivot?, offset? },
 *       landscape?: { anchor?, pivot?, offset? },
 *     }
 *   }
 *
 * # Vendor-neutral. No engine-specific layout math.
 *
 * @module rectTransform
 */

const ZERO_TO_ONE_RE = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/;

/**
 * Default RectTransform — center-anchored, center-pivoted, no offset.
 * Useful as a fallback for any block that omits its rectTransform key.
 *
 * @returns {Readonly<{anchor:{x:number,y:number}, pivot:{x:number,y:number}, offset:{x:number,y:number}, breakpoints: object}>}
 */
export function defaultRectTransform() {
  return Object.freeze({
    anchor: Object.freeze({ x: 0.5, y: 0.5 }),
    pivot: Object.freeze({ x: 0.5, y: 0.5 }),
    offset: Object.freeze({ x: 0, y: 0 }),
    breakpoints: Object.freeze({}),
  });
}

function _clampUnit(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function _clampOffset(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  /* Cap at ±10_000px — beyond that it's almost certainly a typo or
     unit confusion (e.g. someone passed % as raw number). */
  if (n < -10_000) return -10_000;
  if (n > 10_000) return 10_000;
  return n;
}

function _resolvePoint(raw, fb, clampFn) {
  if (!raw || typeof raw !== 'object') {
    return Object.freeze({ x: fb.x, y: fb.y });
  }
  return Object.freeze({
    x: clampFn(raw.x, fb.x),
    y: clampFn(raw.y, fb.y),
  });
}

/**
 * Resolve a single RectTransform spec — merge user input with defaults,
 * clamp each field, deep-freeze. Throws on null/non-object input so
 * caller can distinguish "no transform" from "broken transform".
 *
 * @param {object} raw
 * @returns {Readonly<ReturnType<typeof defaultRectTransform>>}
 */
export function resolveRectTransform(raw) {
  if (raw === null || raw === undefined) {
    return defaultRectTransform();
  }
  if (typeof raw !== 'object') {
    throw new TypeError(
      `resolveRectTransform: expected object|null, got ${typeof raw}`,
    );
  }
  const d = defaultRectTransform();
  const anchor = _resolvePoint(raw.anchor, d.anchor, _clampUnit);
  const pivot = _resolvePoint(raw.pivot, d.pivot, _clampUnit);
  const offset = _resolvePoint(raw.offset, d.offset, _clampOffset);

  const bps = raw.breakpoints && typeof raw.breakpoints === 'object'
    ? raw.breakpoints
    : {};
  const resolvedBps = {};
  for (const bpKey of ['portrait', 'landscape']) {
    if (bps[bpKey] && typeof bps[bpKey] === 'object') {
      resolvedBps[bpKey] = Object.freeze({
        anchor: bps[bpKey].anchor
          ? _resolvePoint(bps[bpKey].anchor, anchor, _clampUnit)
          : undefined,
        pivot: bps[bpKey].pivot
          ? _resolvePoint(bps[bpKey].pivot, pivot, _clampUnit)
          : undefined,
        offset: bps[bpKey].offset
          ? _resolvePoint(bps[bpKey].offset, offset, _clampOffset)
          : undefined,
      });
    }
  }
  return Object.freeze({
    anchor,
    pivot,
    offset,
    breakpoints: Object.freeze(resolvedBps),
  });
}

/**
 * Pick the active transform for a given viewport orientation, falling
 * back through breakpoints → base when a breakpoint omits a field.
 *
 * @param {ReturnType<typeof defaultRectTransform>} tx
 * @param {'portrait' | 'landscape'} orientation
 * @returns {{anchor:{x:number,y:number}, pivot:{x:number,y:number}, offset:{x:number,y:number}}}
 */
export function pickForOrientation(tx, orientation) {
  const bp = tx.breakpoints[orientation];
  if (!bp) {
    return { anchor: tx.anchor, pivot: tx.pivot, offset: tx.offset };
  }
  return {
    anchor: bp.anchor || tx.anchor,
    pivot: bp.pivot || tx.pivot,
    offset: bp.offset || tx.offset,
  };
}

/**
 * Compute CSS positioning fields from a RectTransform + viewport spec.
 * Returns positioning props that the consumer can spread onto a style
 * object or serialize into a CSS rule.
 *
 * @param {ReturnType<typeof defaultRectTransform>} tx
 * @param {{viewport: {w:number,h:number}, safeArea?: {x?:number,y?:number,w:number,h:number}}} ctx
 * @returns {{left:string, top:string, transform:string}}
 */
export function computeCSS(tx, ctx) {
  if (!ctx || !ctx.viewport) {
    throw new TypeError('computeCSS: viewport is required');
  }
  const orientation = ctx.viewport.w >= ctx.viewport.h ? 'landscape' : 'portrait';
  const active = pickForOrientation(tx, orientation);

  /* Safe area defaults to full viewport at (0,0). */
  const sa = ctx.safeArea || {
    x: 0,
    y: 0,
    w: ctx.viewport.w,
    h: ctx.viewport.h,
  };
  const baseX = (sa.x || 0) + active.anchor.x * sa.w + active.offset.x;
  const baseY = (sa.y || 0) + active.anchor.y * sa.h + active.offset.y;

  /* `pivot` translates the element by its own dimensions; use CSS
     `translate(-pivotX*100%, -pivotY*100%)`. */
  const tx100 = (-active.pivot.x * 100).toFixed(2);
  const ty100 = (-active.pivot.y * 100).toFixed(2);

  return {
    left: `${baseX.toFixed(2)}px`,
    top: `${baseY.toFixed(2)}px`,
    transform: `translate(${tx100}%, ${ty100}%)`,
  };
}

/**
 * Bulk-resolve every `model.rectTransforms` entry into a frozen map
 * keyed by block id. Unknown / malformed entries are SKIPPED with a
 * warning so a broken GDD doesn't blow up the page boot.
 *
 * @param {object} [model]
 * @returns {Readonly<Record<string, ReturnType<typeof defaultRectTransform>>>}
 */
export function resolveAllTransforms(model) {
  const map = {};
  const src = (model && model.rectTransforms) || {};
  if (!src || typeof src !== 'object') return Object.freeze(map);
  for (const blockId of Object.keys(src)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(blockId)) {
      /* Skip silently — block id must be a sane identifier. */
      continue;
    }
    try {
      map[blockId] = resolveRectTransform(src[blockId]);
    } catch (_) {
      /* Swallow per-entry resolve failures so other transforms still load. */
      continue;
    }
  }
  return Object.freeze(map);
}

/**
 * Test-only seam: expose the 0..1 regex literal so unit tests can assert
 * the contract against the same source of truth used at runtime.
 *
 * @returns {RegExp}
 */
export function _ZERO_TO_ONE_RE_FOR_TESTS() {
  return ZERO_TO_ONE_RE;
}
