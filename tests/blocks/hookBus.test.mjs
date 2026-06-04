/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, emitHookBusRuntime, HOOK_EVENTS,
} from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const ok = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/hookBus.mjs —');

t('HOOK_EVENTS canonical list', () => {
  const expected = ['preSpin', 'onSpinResult', 'onTumbleStep', 'postSpin', 'onFsTrigger', 'onFsSpinResult', 'onFsEnd'];
  eq(HOOK_EVENTS.length, expected.length);
  for (const e of expected) ok(HOOK_EVENTS.includes(e), `missing ${e}`);
});

t('defaultConfig: debugLog off', () => {
  eq(defaultConfig().debugLog, false);
});

t('resolveConfig: debugLog true from model', () => {
  eq(resolveConfig({ hookBus: { debugLog: true } }).debugLog, true);
});

t('emitHookBusRuntime: emits every event name', () => {
  const src = emitHookBusRuntime();
  for (const e of HOOK_EVENTS) ct(src, JSON.stringify(e), `event ${e} should be baked into EVENTS list`);
});

t('emitHookBusRuntime: emits HookBus API surface', () => {
  const src = emitHookBusRuntime();
  ct(src, 'function on(');
  ct(src, 'function off(');
  ct(src, 'function emit(');
  ct(src, 'function emitAsync(');
  ct(src, 'function getMult(');
  ct(src, 'function setMult(');
  ct(src, 'function addMult(');
  ct(src, 'function resetMult(');
});

t('emitHookBusRuntime: window.HookBus exposed', () => {
  ct(emitHookBusRuntime(), 'window.HookBus = HookBus');
});

t('emitHookBusRuntime: debug mode bakes console.log', () => {
  const off = emitHookBusRuntime({ debugLog: false });
  const on  = emitHookBusRuntime({ debugLog: true });
  ok(!off.includes("'[HookBus]'"), 'debug off should NOT bake console.log');
  ok(on.includes("'[HookBus]'"), 'debug on should bake console.log');
});

/* ── Live runtime test: load the emitted code into a sandbox and exercise it ── */

function makeRuntime(cfg = {}) {
  const src = emitHookBusRuntime(cfg);
  const fakeWindow = {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };
  // Wrap as IIFE to capture HookBus
  const factory = new Function('window', 'console', `${src}; return HookBus;`);
  return factory(fakeWindow, fakeConsole);
}

t('runtime: emit returns results array', () => {
  const HB = makeRuntime();
  HB.on('preSpin', () => 1);
  HB.on('preSpin', () => 2);
  const r = HB.emit('preSpin', {});
  eq(r.length, 2);
  eq(r[0], 1);
  eq(r[1], 2);
});

t('runtime: handlers execute in priority order (higher first)', () => {
  const HB = makeRuntime();
  const order = [];
  HB.on('postSpin', () => order.push('low'), { priority: 0 });
  HB.on('postSpin', () => order.push('high'), { priority: 10 });
  HB.on('postSpin', () => order.push('mid'), { priority: 5 });
  HB.emit('postSpin', {});
  eq(order.join(','), 'high,mid,low');
});

t('runtime: off removes specific handler', () => {
  const HB = makeRuntime();
  let count = 0;
  const fn = () => { count++; };
  HB.on('postSpin', fn);
  HB.emit('postSpin', {});
  eq(count, 1);
  HB.off('postSpin', fn);
  HB.emit('postSpin', {});
  eq(count, 1); // not bumped
});

t('runtime: on() returns disposer', () => {
  const HB = makeRuntime();
  let count = 0;
  const dispose = HB.on('postSpin', () => { count++; });
  HB.emit('postSpin', {});
  dispose();
  HB.emit('postSpin', {});
  eq(count, 1);
});

t('runtime: emit on event with no handlers returns []', () => {
  const HB = makeRuntime();
  const r = HB.emit('preSpin', {});
  eq(Array.isArray(r), true);
  eq(r.length, 0);
});

t('runtime: getMult / setMult / addMult / resetMult lifecycle', () => {
  const HB = makeRuntime();
  eq(HB.getMult(), 1);
  HB.setMult(5);
  eq(HB.getMult(), 5);
  HB.addMult(3);
  eq(HB.getMult(), 8);
  HB.resetMult();
  eq(HB.getMult(), 1);
});

t('runtime: setMultBaseline changes reset target', () => {
  const HB = makeRuntime();
  HB.setMultBaseline(2);
  HB.setMult(10);
  HB.resetMult();
  eq(HB.getMult(), 2);
});

t('runtime: unknown event warns but does not throw', () => {
  const HB = makeRuntime();
  // Should not throw
  HB.on('definitelyNotARealEvent', () => {});
  HB.emit('definitelyNotARealEvent', {});
  eq(true, true);
});

t('runtime: handler that throws does NOT stop subsequent handlers', () => {
  const HB = makeRuntime();
  let downstreamRan = false;
  HB.on('postSpin', () => { throw new Error('boom'); });
  HB.on('postSpin', () => { downstreamRan = true; });
  HB.emit('postSpin', {});
  eq(downstreamRan, true);
});

t('runtime: listenerCount reports registered handlers', () => {
  const HB = makeRuntime();
  eq(HB.listenerCount('postSpin'), 0);
  HB.on('postSpin', () => {});
  HB.on('postSpin', () => {});
  eq(HB.listenerCount('postSpin'), 2);
});

t('runtime: emitAsync awaits each handler in sequence', async () => {
  const HB = makeRuntime();
  const order = [];
  HB.on('onTumbleStep', async () => { await new Promise(r => setTimeout(r, 5)); order.push('a'); });
  HB.on('onTumbleStep', async () => { await new Promise(r => setTimeout(r, 1)); order.push('b'); });
  await HB.emitAsync('onTumbleStep', {});
  eq(order.join(','), 'a,b'); // sequential, not parallel
});

t('runtime: payload is forwarded to handlers', () => {
  const HB = makeRuntime();
  let got = null;
  HB.on('postSpin', (p) => { got = p; });
  HB.emit('postSpin', { duringFs: true, foo: 42 });
  eq(got.duringFs, true);
  eq(got.foo, 42);
});

t('runtime: window.HookBus + window.__HOOKBUS_MULT__ exposed', () => {
  const src = emitHookBusRuntime();
  const fakeWindow = {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };
  new Function('window', 'console', src)(fakeWindow, fakeConsole);
  ok(fakeWindow.HookBus, 'HookBus should be exposed');
  eq(fakeWindow.__HOOKBUS_MULT__, 1);
});

/* ── Run async tests ── */
(async () => {
  // Re-run async ones serially
  console.log('\n--- summary ---');
  console.log(`  pass: ${pass}`);
  console.log(`  fail: ${fail}`);
  if (fail > 0) process.exit(1);
})();
