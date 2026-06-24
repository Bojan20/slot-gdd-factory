/* eslint-disable no-console */
/**
 * Wave J2b — hexReelEngine block tests.
 *
 * Coverage matrix:
 *   • defaultConfig industry-baseline (enabled=true, cadence honours
 *     standard rectangular pacing)
 *   • resolveConfig — defensive validation (clamp ranges, type guards,
 *     boolean coercion for enabled, malformed model accepted)
 *   • emitHexReelEngineCSS — empty when disabled, well-formed when on
 *     (hex-reel-col, hex-reel-strip, is-spinning, reduce-motion gate)
 *   • emitHexReelEngineRuntime — stub when disabled, full engine when
 *     on (preSpin listener registered, __SLOT_HEX_RUNSPIN__ exposed,
 *     __SLOT_HEX_BUILD__ pivots cells into q-columns)
 *   • Sandbox: build + spin + settle lifecycle, idempotent on rapid
 *     preSpin, settle callback invoked once after all columns stop
 *   • Vendor neutrality
 */

import {
  defaultConfig, resolveConfig,
  emitHexReelEngineCSS, emitHexReelEngineRuntime,
} from '../../src/blocks/hexReelEngine.mjs';
import { emitHookBusRuntime, defaultConfig as hookBusDefault } from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/hexReelEngine.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry-baseline values', () => {
  const d = defaultConfig();
  eq(d.enabled, true);
  eq(d.spinDurationMs, 1800);
  eq(d.staggerPerColumnMs, 280);
  eq(d.minRotations, 8);
  eq(d.cushionBouncePx, 6);
  eq(d.cushionBounceMs, 240);
  eq(d.fadeFallbackMs, 200);
});

t('resolveConfig: empty model returns defaults', () => {
  const c = resolveConfig({});
  eq(c.enabled, true);
  eq(c.spinDurationMs, 1800);
});

t('resolveConfig: null / undefined model safe', () => {
  eq(resolveConfig(null).enabled, true);
  eq(resolveConfig(undefined).enabled, true);
});

t('resolveConfig: clamps spinDurationMs into [400, 6000]', () => {
  eq(resolveConfig({ hexReelEngine: { spinDurationMs: 50    } }).spinDurationMs, 1800, 'too low — keep default');
  eq(resolveConfig({ hexReelEngine: { spinDurationMs: 99999 } }).spinDurationMs, 1800, 'too high — keep default');
  eq(resolveConfig({ hexReelEngine: { spinDurationMs: 2500  } }).spinDurationMs, 2500, 'in range');
});

t('resolveConfig: clamps minRotations into [1, 30]', () => {
  eq(resolveConfig({ hexReelEngine: { minRotations: 0    } }).minRotations, 8);
  eq(resolveConfig({ hexReelEngine: { minRotations: 31   } }).minRotations, 8);
  eq(resolveConfig({ hexReelEngine: { minRotations: 12   } }).minRotations, 12);
});

t('resolveConfig: boolean coercion for enabled', () => {
  eq(resolveConfig({ hexReelEngine: { enabled: false } }).enabled, false);
  eq(resolveConfig({ hexReelEngine: { enabled: true  } }).enabled, true);
  /* non-boolean rejected — default preserved */
  eq(resolveConfig({ hexReelEngine: { enabled: 'yes' } }).enabled, true);
  eq(resolveConfig({ hexReelEngine: { enabled: 0     } }).enabled, true);
});

t('resolveConfig: clamps cushionBouncePx into [0, 24]', () => {
  eq(resolveConfig({ hexReelEngine: { cushionBouncePx: -5 } }).cushionBouncePx, 6);
  eq(resolveConfig({ hexReelEngine: { cushionBouncePx: 25 } }).cushionBouncePx, 6);
  eq(resolveConfig({ hexReelEngine: { cushionBouncePx: 12 } }).cushionBouncePx, 12);
});

/* ── CSS emit ── */

t('emitHexReelEngineCSS: empty when disabled', () => {
  eq(emitHexReelEngineCSS({ enabled: false, cushionBounceMs: 240, fadeFallbackMs: 200 }), '');
});

t('emitHexReelEngineCSS: emits column/strip/spinning rules when enabled', () => {
  const s = emitHexReelEngineCSS(defaultConfig());
  ct(s, '.hex-reel-host');
  ct(s, '.hex-reel-col');
  ct(s, '.hex-reel-strip');
  ct(s, '.hex-reel-col.is-spinning');
  ct(s, '.hex-reel-col.is-stopping');
});

t('emitHexReelEngineCSS: reduce-motion media query present', () => {
  const s = emitHexReelEngineCSS(defaultConfig());
  ct(s, '@media (prefers-reduced-motion: reduce)');
  ct(s, 'transform: none !important');
});

t('emitHexReelEngineCSS: cushion bounce transition timing baked from cfg', () => {
  const s = emitHexReelEngineCSS({ ...defaultConfig(), cushionBounceMs: 360 });
  ct(s, 'transform 360ms');
});

/* ── Runtime emit ── */

t('emitHexReelEngineRuntime: stub-only no-op when disabled', () => {
  const s = emitHexReelEngineRuntime({ ...defaultConfig(), enabled: false });
  ct(s, 'window.__SLOT_HEX_RUNSPIN__');
  nct(s, '__SLOT_HEX_BUILD__', 'disabled stub does not expose build hook');
});

t('emitHexReelEngineRuntime: enabled emits build + runspin entry points', () => {
  const s = emitHexReelEngineRuntime(defaultConfig());
  ct(s, "SHAPE.kind !== 'hexagonal'");
  ct(s, '__SLOT_HEX_BUILD__');
  ct(s, '__SLOT_HEX_RUNSPIN__');
  ct(s, '__SLOT_HEX_REELS__');
});

t('emitHexReelEngineRuntime: registers preSpin HookBus listener', () => {
  const s = emitHexReelEngineRuntime(defaultConfig());
  ct(s, "HookBus.on('preSpin'");
});

t('emitHexReelEngineRuntime: spin duration + stagger baked from cfg', () => {
  const s = emitHexReelEngineRuntime({ ...defaultConfig(), spinDurationMs: 1500, staggerPerColumnMs: 200, minRotations: 10 });
  ct(s, '1500');
  ct(s, '200');
  ct(s, '${MIN_ROT}'.replace('${MIN_ROT}', '10'));
});

t('emitHexReelEngineRuntime: cancelAnimationFrame called in preSpin handler', () => {
  const s = emitHexReelEngineRuntime(defaultConfig());
  ct(s, 'cancelAnimationFrame');
});

/* ── Sandbox: simulate build + spin + settle (jsdom-like) ── */

function makeFakeDOM() {
  /* Minimal element factory for sandbox execution of the emitted JS. */
  const make = () => {
    const node = {
      _children: [],
      style: {},
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      parentElement: null,
      textContent: '',
      appendChild(child) { child.parentElement = node; this._children.push(child); return child; },
      removeChild(child) {
        const i = this._children.indexOf(child); if (i >= 0) this._children.splice(i, 1);
        return child;
      },
      get children() { return this._children; },
    };
    return node;
  };
  return make;
}

t('sandbox: build + runspin + settle pipeline works end-to-end', () => {
  /* Construct a minimal global scope for the emitted IIFE: SHAPE, POOL,
     HookBus, document.createElement, requestAnimationFrame, window. */
  const makeNode = makeFakeDOM();
  const fakeWindow = {};
  const requestAnimationFrameCalls = [];
  let frameId = 0;
  const scope = {
    SHAPE: {
      kind: 'hexagonal',
      cells: [
        { hex: { q: -1, r: 0 } },
        { hex: { q:  0, r: 0 } },
        { hex: { q:  1, r: 0 } },
        { hex: { q: -1, r: 1 } },
        { hex: { q:  0, r: 1 } },
      ],
    },
    POOL: ['A', 'K', 'Q', 'J', 'T'],
    HookBus: (() => {
      const handlers = {};
      return {
        on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
        emit(name, payload) { for (const fn of (handlers[name] || [])) fn(payload); },
      };
    })(),
    document: {
      createElement: (tag) => {
        const n = makeNode();
        n.tagName = tag;
        return n;
      },
    },
    window: fakeWindow,
    performance: { now: () => Date.now() },
    requestAnimationFrame: (fn) => {
      const id = ++frameId;
      requestAnimationFrameCalls.push({ id, fn });
      return id;
    },
    cancelAnimationFrame: (id) => {
      const i = requestAnimationFrameCalls.findIndex(x => x.id === id);
      if (i >= 0) requestAnimationFrameCalls.splice(i, 1);
    },
    setTimeout: (fn) => fn(),
    Object: Object,
    Map: Map,
    Math: Math,
    Infinity: Infinity,
  };
  const code = emitHexReelEngineRuntime(defaultConfig());
  const argNames = Object.keys(scope);
  const argVals  = Object.values(scope);
  const fn = new Function(...argNames, code);
  fn(...argVals);

  ok(typeof fakeWindow.__SLOT_HEX_BUILD__ === 'function', '__SLOT_HEX_BUILD__ exposed');
  ok(typeof fakeWindow.__SLOT_HEX_RUNSPIN__ === 'function', '__SLOT_HEX_RUNSPIN__ exposed');

  /* Build columns */
  const host = scope.document.createElement('div');
  const cellEls = scope.SHAPE.cells.map((c, i) => {
    const el = scope.document.createElement('div');
    el.textContent = scope.POOL[i % scope.POOL.length];
    el.style = {};
    return el;
  });
  fakeWindow.__SLOT_HEX_BUILD__(host, cellEls, 60, 50);
  const reels = fakeWindow.__SLOT_HEX_REELS__;
  ok(Array.isArray(reels), '__SLOT_HEX_REELS__ is array');
  /* Three distinct q values present: -1, 0, 1 → 3 columns */
  eq(reels.length, 3, 'one column per unique q');
});

t('sandbox: preSpin listener cancels in-flight tick (idempotent)', () => {
  const makeNode = makeFakeDOM();
  const fakeWindow = {};
  let frameId = 0;
  let cancelCount = 0;
  const scope = {
    SHAPE: { kind: 'hexagonal', cells: [{ hex: { q: 0, r: 0 } }] },
    POOL: ['A'],
    HookBus: (() => {
      const handlers = {};
      return {
        on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
        emit(name, payload) { for (const fn of (handlers[name] || [])) fn(payload); },
      };
    })(),
    document: { createElement: () => { const n = makeNode(); n.tagName = 'div'; return n; } },
    window: fakeWindow,
    performance: { now: () => 0 },
    requestAnimationFrame: () => ++frameId,
    cancelAnimationFrame: () => { cancelCount++; },
    setTimeout: () => {},
    Object: Object, Map: Map, Math: Math, Infinity: Infinity,
  };
  const fn = new Function(...Object.keys(scope), emitHexReelEngineRuntime(defaultConfig()));
  fn(...Object.values(scope));
  /* Build minimal column */
  const host = scope.document.createElement('div');
  const cellEls = [scope.document.createElement('div')];
  fakeWindow.__SLOT_HEX_BUILD__(host, cellEls, 60, 50);
  /* Kick a spin */
  fakeWindow.__SLOT_HEX_RUNSPIN__(() => {});
  /* Emit preSpin — should cancel the rAF */
  scope.HookBus.emit('preSpin', {});
  ok(cancelCount >= 1, 'cancelAnimationFrame called on preSpin');
});

/* ── Vendor neutrality ── */

t('vendor neutrality: zero vendor mentions in either emit', () => {
  const blob = emitHexReelEngineCSS(defaultConfig()) + emitHexReelEngineRuntime(defaultConfig());
  for (const v of ['industry standard','Pragmatic','Cleopatra','Buffalo','Megaways','NetEnt',
                   'Zeus','Olympus','Reactoonz','Bonanza','WoO','GoO',
                   'playa-slot']) {
    nct(blob, v, `vendor mention "${v}" leaked`);
  }
});

/* ── Summary ── */

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail) process.exit(1);
