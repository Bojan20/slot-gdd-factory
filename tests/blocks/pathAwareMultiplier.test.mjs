/**
 * tests/blocks/pathAwareMultiplier.test.mjs — Wave H13
 *
 * Exercises: defaultConfig integrity, resolveConfig validators (incl.
 * the hard requirement that waysEval must be enabled), CSS / markup /
 * runtime emit shape, vendor neutrality, deterministic weighted draw,
 * additive vs multiplicative aggregation, chip render, postSpin
 * award-bonus push, FS-boundary reset.
 */
import {
  defaultConfig, resolveConfig,
  emitPathAwareMultiplierCSS,
  emitPathAwareMultiplierMarkup,
  emitPathAwareMultiplierRuntime,
} from '../../src/blocks/pathAwareMultiplier.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— blocks/pathAwareMultiplier.mjs —');

/* ────────────────── defaultConfig integrity ───────────────────── */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('multiplierMap default 7-tier ladder', d.multiplierMap.length === 7);
t('first tier is ×2', d.multiplierMap[0].x === 2);
t('top tier is ×100', d.multiplierMap[d.multiplierMap.length - 1].x === 100);
t('weights descending (×2 most common, ×100 rarest)',
  d.multiplierMap[0].weight > d.multiplierMap[d.multiplierMap.length - 1].weight);
t('baseMultiplier default 1', d.baseMultiplier === 1);
t('aggregation default additive', d.aggregation === 'additive');
t('chipColor valid rgb triplet', /^\d{1,3},\d{1,3},\d{1,3}$/.test(d.chipColor));
t('showAggregateChip default true', d.showAggregateChip === true);
t('awardScaleDenom default 0 (auto)', d.awardScaleDenom === 0);

/* defaultConfig() returns FRESH copy */
defaultConfig().multiplierMap.push({ x: 999, weight: 1 });
t('defaultConfig returns independent copy each call',
  defaultConfig().multiplierMap.length === 7);

/* ────────────────── resolveConfig — happy paths ──────────────── */
const baseModel = { waysEval: { enabled: true }, features: [{ kind: 'ways' }] };

const r1 = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true } });
t('explicit enabled honored when waysEval is on', r1.enabled === true);

const r2 = resolveConfig({
  waysEval: { enabled: true },
  features: [{ kind: 'ways' }, { kind: 'path_aware_multiplier' }],
});
t('auto-enable via feature kind (snake_case)', r2.enabled === true);

const r3 = resolveConfig({
  waysEval: { enabled: true },
  features: [{ kind: 'ways' }, { kind: 'path-multiplier' }],
});
t('auto-enable via feature kind (short dash variant)', r3.enabled === true);

/* Auto-enable via ways topology (no explicit waysEval flag) */
const r3b = resolveConfig({
  topology: { evaluation: 'ways', ways_count: 1024 },
  features: [{ kind: 'path_aware_multiplier' }],
});
t('auto-enable via ways topology', r3b.enabled === true);

/* Hard requirement: must DISABLE when no ways evaluator */
const offCase = resolveConfig({ pathAwareMultiplier: { enabled: true } });   // no waysEval
t('hard requirement: force disabled when waysEval is off',
  offCase.enabled === false);

const offCase2 = resolveConfig({
  features: [{ kind: 'path_aware_multiplier' }],   // feature kind but no ways
});
t('hard requirement: feature-kind auto-enable still off when waysEval missing',
  offCase2.enabled === false);

/* multiplierMap override */
const r4 = resolveConfig({
  ...baseModel,
  pathAwareMultiplier: {
    enabled: true,
    multiplierMap: [
      { x: 2, weight: 50, label: '×2' },
      { x: 10, weight: 25, label: '×10' },
      { x: 500, weight: 1, label: 'MEGA' },
    ],
  },
});
t('override multiplierMap (3 tiers)', r4.multiplierMap.length === 3);
t('override label preserved', r4.multiplierMap[2].label === 'MEGA');
t('override weight numeric', r4.multiplierMap[0].weight === 50);

/* Invalid map rejected — fall back to default + auto-label */
const r5 = resolveConfig({
  ...baseModel,
  pathAwareMultiplier: {
    enabled: true,
    multiplierMap: [{ x: -1, weight: 1 }],   /* x < 2 invalid */
  },
});
t('invalid multiplierMap (negative x) → fallback to default ladder',
  r5.multiplierMap.length === 7);
t('fallback auto-bakes labels',
  typeof r5.multiplierMap[0].label === 'string' && r5.multiplierMap[0].label.startsWith('×'));

/* Aggregation modes */
const rA = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, aggregation: 'multiplicative' } });
t('aggregation = multiplicative honored', rA.aggregation === 'multiplicative');

const rB = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, aggregation: 'bogus' } });
t('aggregation = bogus → falls back to default additive', rB.aggregation === 'additive');

/* baseMultiplier clamp */
const rC = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, baseMultiplier: 3 } });
t('baseMultiplier 3 honored', rC.baseMultiplier === 3);

const rD = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, baseMultiplier: 0 } });
t('baseMultiplier 0 → ignored (stays 1)', rD.baseMultiplier === 1);

/* chipColor validator */
const rE = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, chipColor: '0,255,0' } });
t('valid chipColor honored', rE.chipColor === '0,255,0');

const rF = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, chipColor: 'red' } });
t('invalid chipColor rejected (stays default)', rF.chipColor === '120,180,255');

const rG = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, awardScaleDenom: 100 } });
t('awardScaleDenom override honored', rG.awardScaleDenom === 100);

const rH = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, awardScaleDenom: -50 } });
t('awardScaleDenom negative rejected (stays 0 auto)', rH.awardScaleDenom === 0);

const rI = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true, showAggregateChip: false } });
t('showAggregateChip false honored', rI.showAggregateChip === false);

/* ────────────────── emit shape ────────────────── */
const cfgOff = defaultConfig();
t('CSS empty when disabled', emitPathAwareMultiplierCSS(cfgOff) === '');
t('markup empty when disabled', emitPathAwareMultiplierMarkup(cfgOff) === '');
t('runtime defines stub even when disabled',
  emitPathAwareMultiplierRuntime(cfgOff).includes('window.PAW_STATE = { enabled: false'));

const cfgOn = resolveConfig({ ...baseModel, pathAwareMultiplier: { enabled: true } });
const css   = emitPathAwareMultiplierCSS(cfgOn);
t('CSS contains .paw-path-chip class', css.includes('.paw-path-chip'));
t('CSS contains #pawHud selector', css.includes('#pawHud'));
t('CSS contains pawChipPop animation', css.includes('@keyframes pawChipPop'));
t('CSS includes prefers-reduced-motion guard', css.includes('prefers-reduced-motion'));
t('CSS bakes chip color into background', css.includes(cfgOn.chipColor));

const markup = emitPathAwareMultiplierMarkup(cfgOn);
t('markup mounts #pawHud div', markup.includes('id="pawHud"'));
t('markup includes aria-live for SR announcement', markup.includes('aria-live="polite"'));
t('markup includes label + total spans',
  markup.includes('paw-hud-label') && markup.includes('paw-hud-total'));

const rt = emitPathAwareMultiplierRuntime(cfgOn);
t('runtime defines window.PAW_STATE', rt.includes('window.PAW_STATE'));
t('runtime defines window.pawDraw', rt.includes('window.pawDraw'));
t('runtime defines window.pawReset', rt.includes('window.pawReset'));
t('runtime monkey-patches window.detectWaysWins',
  rt.includes('window.__origDetectWaysWins') && rt.includes('window.detectWaysWins ='));
t('runtime preserves original (idempotent guard via STATE.patched)',
  rt.includes('STATE.patched'));
t('runtime subscribes to preSpin reset', rt.includes("'preSpin'"));
t('runtime subscribes to postSpin aggregate', rt.includes("'postSpin'"));
t('runtime subscribes to FS boundaries',
  rt.includes("'onFsTrigger'") && rt.includes("'onFsEnd'"));
t('runtime emits onPathMultiplierAssigned',
  rt.includes("HookBus.emit('onPathMultiplierAssigned'"));
t('runtime emits onPathMultiplierAggregate',
  rt.includes("HookBus.emit('onPathMultiplierAggregate'"));
t('runtime bakes the multiplierMap JSON', rt.includes('"weight":40'));

/* ────────────────── vendor neutrality ────────────────── */
const allText = [emitPathAwareMultiplierCSS(cfgOn),
                 emitPathAwareMultiplierMarkup(cfgOn),
                 emitPathAwareMultiplierRuntime(cfgOn)].join('\n');
const banned = ['industry standard', 'Pragmatic', 'Cleopatra', 'Buffalo', 'Megaways',
                'NetEnt', 'Microgaming', 'Wolf Run', 'Cash Eruption'];
const hits = banned.filter(b => new RegExp(b, 'i').test(allText));
t('vendor-neutral (no banned names in CSS/markup/runtime)',
  hits.length === 0,
  hits.length ? 'hit: ' + hits.join(', ') : '');

/* ────────────────── deterministic sandbox — weighted draw + aggregate ─────────── */
/* Build a minimal browser-shim sandbox, install a mock detectWaysWins,
 * eval the runtime, then call detectWaysWins and verify decoration. */
function buildSandbox() {
  const events = [];
  const handlers = new Map();
  const dom = new Map();          /* element id → mock node */
  const cellChips = [];
  function mockCell() {
    const node = {
      _children: [],
      _qs: new Map(),
      appendChild(c) {
        this._children.push(c);
        cellChips.push(c);
      },
      querySelector(sel) {
        /* Match by class for `.paw-path-chip` */
        if (sel === '.paw-path-chip') {
          for (let i = 0; i < this._children.length; i++) {
            if (this._children[i].className === 'paw-path-chip') return this._children[i];
          }
          return null;
        }
        return null;
      },
    };
    return node;
  }
  const cells = [mockCell(), mockCell(), mockCell()];
  const win = {
    HookBus: {
      emit(name, payload) { events.push({ name, payload }); },
      on(name, fn) {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(fn);
      },
    },
    detectWaysWins() {
      /* Return 2 ways events sharing the same anchor for repeatability. */
      return [
        { symbol: 'HP1', ways: 12, runLength: 4, cells: [cells[0], cells[1]] },
        { symbol: 'MP2', ways: 4,  runLength: 3, cells: [cells[2]] },
      ];
    },
    __SLOT_BET__: 1,
    WAYS_COUNT: 1024,
    console,
  };
  const doc = {
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) { return dom.get(id) || null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      return {
        className: '',
        textContent: '',
        attrs: new Map(),
        setAttribute(k, v) { this.attrs.set(k, v); },
        removeAttribute(k) { this.attrs.delete(k); },
        appendChild(c) {},
        parentNode: null,
      };
    },
  };
  return { win, doc, events, handlers, cells, cellChips };
}

/* Eval runtime inside the sandbox. We wrap it with `with` to bind
 * window/document/setTimeout. */
function runInSandbox(runtimeJs, sandbox) {
  const fn = new Function('window', 'document', 'setTimeout', 'console', runtimeJs + '\nreturn window;');
  return fn(sandbox.win, sandbox.doc,
            (cb, ms) => { /* no-op timer */ },
            console);
}

/* Force RNG to a deterministic seed by stubbing Math.random. We use a
 * lazy seed-rotator so the two draws inside detectWaysWins produce a
 * predictable {idx0, idx1} pair. */
function withSeededRandom(seedValues, fn) {
  const orig = Math.random;
  let i = 0;
  Math.random = function () {
    const v = seedValues[i % seedValues.length];
    i++;
    return v;
  };
  try { return fn(); } finally { Math.random = orig; }
}

const sandbox = buildSandbox();
runInSandbox(rt, sandbox);
t('sandbox install: PAW_STATE.enabled=true', sandbox.win.PAW_STATE.enabled === true);
t('sandbox install: detectWaysWins monkey-patched',
  typeof sandbox.win.__origDetectWaysWins === 'function');
t('sandbox install: window.pawDraw exposed', typeof sandbox.win.pawDraw === 'function');
t('sandbox install: window.pawReset exposed', typeof sandbox.win.pawReset === 'function');
t('sandbox install: HookBus listeners registered (preSpin/postSpin/onFsTrigger/onFsEnd)',
  sandbox.handlers.get('preSpin')?.length === 1 &&
  sandbox.handlers.get('postSpin')?.length === 1 &&
  sandbox.handlers.get('onFsTrigger')?.length === 1 &&
  sandbox.handlers.get('onFsEnd')?.length === 1);

/* Call patched detectWaysWins with seeded RNG that lands on tier 0 (×2)
 * for the first draw and tier 3 (×10) for the second. With weights
 * [40,24,16,10,6,3,1] cumsum [40,64,80,90,96,99,100], r1 = 0.05 → idx 0
 * (cumsum 4 > 5×100? no wait — Math.random()×100 = 5, acc 40, hit).
 * r2 = 0.85 → 85 vs cumsum 90 → idx 3 (×10).
 *
 * NOTE: total in default map = 40+24+16+10+6+3+1 = 100. */
let decoratedEvents = null;
withSeededRandom([0.05, 0.85], () => {
  decoratedEvents = sandbox.win.detectWaysWins();
});
t('decorated event count preserved (2)', decoratedEvents.length === 2);
t('event[0] gets ×2 multiplier', decoratedEvents[0].pathMultiplier === 2);
t('event[1] gets ×10 multiplier', decoratedEvents[1].pathMultiplier === 10);
t('event[0] label baked', decoratedEvents[0].pathMultiplierLabel === '×2');
t('event[1] label baked', decoratedEvents[1].pathMultiplierLabel === '×10');

/* HookBus events emitted: 2 × onPathMultiplierAssigned */
const assignedEvents = sandbox.events.filter(e => e.name === 'onPathMultiplierAssigned');
t('emitted 2 × onPathMultiplierAssigned', assignedEvents.length === 2);
t('assigned event #0 carries symbol+ways+multiplier',
  assignedEvents[0].payload.symbol === 'HP1' &&
  assignedEvents[0].payload.ways === 12 &&
  assignedEvents[0].payload.multiplier === 2);

/* Aggregate: additive 2 + 10 = 12 (base 1 doesn't add) */
t('PAW_STATE.totalMult additive = 12', sandbox.win.PAW_STATE.totalMult === 12);

/* Cell chips rendered (2 cells in ev0 + 1 in ev1 = 3 chips) */
t('cell chips rendered (3)', sandbox.cellChips.length === 3);
t('chip carries label ×2 on first cell', sandbox.cellChips[0].textContent === '×2');
t('chip[0] data-tier=norm', sandbox.cellChips[0].attrs.get('data-tier') === 'norm');
t('chip carries label ×10 on third cell', sandbox.cellChips[2].textContent === '×10');

/* PostSpin aggregate — compute bonus */
const postSpinFn = sandbox.handlers.get('postSpin')[0];
postSpinFn();
const aggEvt = sandbox.events.find(e => e.name === 'onPathMultiplierAggregate');
t('onPathMultiplierAggregate fired in postSpin', !!aggEvt);
t('aggregate totalMult = 12', aggEvt?.payload?.totalMult === 12);
/* awardBonus = (12×2 + 4×10) × bet/WAYS_COUNT = (24+40)/1024 = 0.0625 */
t('aggregate awardBonus computed via ways/WAYS_COUNT scale',
  Math.abs(aggEvt?.payload?.awardBonus - 0.0625) < 0.001);
t('__WIN_AWARD__ pushed additively', Math.abs(sandbox.win.__WIN_AWARD__ - 0.0625) < 0.001);

/* preSpin resets state */
const preSpinFn = sandbox.handlers.get('preSpin')[0];
preSpinFn();
t('preSpin clears PAW_STATE.lastEvents', sandbox.win.PAW_STATE.lastEvents.length === 0);
t('preSpin clears totalMult', sandbox.win.PAW_STATE.totalMult === 0);

/* FS boundary clears state too */
const fsTrigFn = sandbox.handlers.get('onFsTrigger')[0];
sandbox.win.PAW_STATE.totalMult = 99;
sandbox.win.PAW_STATE.lastEvents = [{ ways: 1, pathMultiplier: 99 }];
fsTrigFn();
t('onFsTrigger clears totalMult', sandbox.win.PAW_STATE.totalMult === 0);
t('onFsTrigger clears lastEvents', sandbox.win.PAW_STATE.lastEvents.length === 0);

/* ────────────────── multiplicative aggregation ────────────────── */
const cfgMul = resolveConfig({ ...baseModel, pathAwareMultiplier: {
  enabled: true, aggregation: 'multiplicative',
} });
const rtMul = emitPathAwareMultiplierRuntime(cfgMul);
const sb2 = buildSandbox();
runInSandbox(rtMul, sb2);
withSeededRandom([0.05, 0.85], () => { sb2.win.detectWaysWins(); });
/* product: 2 × 10 = 20 */
t('multiplicative totalMult = 20', sb2.win.PAW_STATE.totalMult === 20);

/* ────────────────── idempotent re-render ────────────────── */
const sb3 = buildSandbox();
runInSandbox(rt, sb3);
withSeededRandom([0.05, 0.85, 0.05, 0.85], () => {
  sb3.win.detectWaysWins();
  sb3.win.detectWaysWins();
});
/* Re-render guard: chips array gets 3 from first call only (second call
 * sees existing chip via querySelector and skips). */
t('idempotent chip render (no duplicate chips on 2nd call)',
  sb3.cellChips.length === 3);

/* ────────────────── disabled stub fidelity ────────────────── */
const rtOff = emitPathAwareMultiplierRuntime(cfgOff);
const sb4 = { events: [], handlers: new Map(), cells: [], cellChips: [], win: { console } };
sb4.win.HookBus = { emit() {}, on() {} };
runInSandbox(rtOff, sb4);
t('disabled stub: PAW_STATE present', sb4.win.PAW_STATE && sb4.win.PAW_STATE.enabled === false);
t('disabled stub: pawDraw returns × 1', sb4.win.pawDraw().x === 1);
t('disabled stub: pawReset is callable no-op',
  typeof sb4.win.pawReset === 'function' && sb4.win.pawReset() === undefined);

console.log(`\n  ${pass} pass, ${fail} fail (${pass + fail} total)\n`);
if (fail > 0) process.exit(1);
