/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, emitHookBusRuntime, HOOK_EVENTS,
  SLAM_PHASES, SKIP_PHASES, SLAM_SOURCES, SKIP_SOURCES,
} from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const pending = [];
/* Senior-grade runner: detect Promise return and queue for top-level await.
 * Without this, async tests resolve after summary prints (false-positive). */
const t = (n, fn) => {
  try {
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      pending.push(ret.then(
        () => { console.log('  ✓', n); pass++; },
        (e) => { console.log('  ✗', n, '\n     ', e.message); fail++; },
      ));
    } else {
      console.log('  ✓', n); pass++;
    }
  } catch (e) {
    console.log('  ✗', n, '\n     ', e.message); fail++;
  }
};
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const ok = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/hookBus.mjs —');

t('HOOK_EVENTS canonical list (core + V intent + V5 win-present + U4 autoplay + U5 bet + U6 gamble + U8 balance + U11 turbo)', () => {
  const expected = [
    'preSpin', 'onSpinResult', 'onTumbleStep', 'postSpin',
    'onFsTrigger', 'onFsSpinResult', 'onFsEnd',
    /* Wave V */
    'onSlamRequested', 'onSlamComplete', 'onSkipRequested', 'onSkipComplete',
    /* Wave V5 */
    'onWinPresentationStart', 'onWinPresentationEnd',
    /* Wave U4 */
    'onAutoplayStart', 'onAutoplayStop', 'onAutoplayTick',
    /* Wave U5 */
    'onBetChanged',
    /* Wave U6 */
    'onGambleStart', 'onGambleRound', 'onGambleEnd',
    /* Wave U8 */
    'onBalanceChanged',
    /* Wave U11 */
    'onTurboToggle',
  ];
  eq(HOOK_EVENTS.length, expected.length);
  for (const e of expected) ok(HOOK_EVENTS.includes(e), `missing ${e}`);
});

t('Wave V enums: SLAM_PHASES / SKIP_PHASES / SLAM_SOURCES / SKIP_SOURCES are frozen and canonical', () => {
  eq(Object.isFrozen(SLAM_PHASES), true);
  eq(Object.isFrozen(SKIP_PHASES), true);
  eq(Object.isFrozen(SLAM_SOURCES), true);
  eq(Object.isFrozen(SKIP_SOURCES), true);
  eq(SLAM_PHASES.join(','), 'pre,post');
  eq(SKIP_PHASES.join(','), 'rollup,fsIntro,fsOutro,celebration');
  eq(SLAM_SOURCES.join(','), 'button,reelsArea,keyboard');
  eq(SKIP_SOURCES.join(','), 'button,keyboard');
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
  ct(src, 'function once(');
  ct(src, 'function emit(');
  ct(src, 'function emitAsync(');
  ct(src, 'function waitFor(');
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

/* ── Wave V: once() + waitFor() coverage ── */

t('runtime: once() auto-unsubscribes after first emit', () => {
  const HB = makeRuntime();
  let count = 0;
  HB.once('onSlamRequested', () => { count++; });
  HB.emit('onSlamRequested', { phase: 'pre' });
  HB.emit('onSlamRequested', { phase: 'post' });
  HB.emit('onSlamRequested', { phase: 'pre' });
  eq(count, 1, 'once handler should only fire once');
  eq(HB.listenerCount('onSlamRequested'), 0, 'should be cleared after first fire');
});

t('runtime: once() returns disposer that cancels before first emit', () => {
  const HB = makeRuntime();
  let count = 0;
  const dispose = HB.once('onSkipRequested', () => { count++; });
  dispose();
  HB.emit('onSkipRequested', { phase: 'rollup' });
  eq(count, 0, 'disposed once should not fire');
  eq(HB.listenerCount('onSkipRequested'), 0);
});

t('runtime: once() with multiple registrations all fire independently then unsubscribe', () => {
  const HB = makeRuntime();
  let a = 0, b = 0;
  HB.once('onSlamComplete', () => { a++; });
  HB.once('onSlamComplete', () => { b++; });
  HB.emit('onSlamComplete', { duration: 50 });
  HB.emit('onSlamComplete', { duration: 60 });
  eq(a, 1, 'first once handler should fire exactly once');
  eq(b, 1, 'second once handler should fire exactly once');
  eq(HB.listenerCount('onSlamComplete'), 0);
});

t('runtime: once() handler that throws does not corrupt off() loop', () => {
  const HB = makeRuntime();
  let downstreamRan = false;
  HB.once('onSkipComplete', () => { throw new Error('boom'); });
  HB.once('onSkipComplete', () => { downstreamRan = true; });
  HB.emit('onSkipComplete', { phase: 'rollup', duration: 10 });
  eq(downstreamRan, true, 'second handler should still execute');
  eq(HB.listenerCount('onSkipComplete'), 0, 'both should be unsubscribed');
});

t('runtime: waitFor() resolves on next emit', async () => {
  const HB = makeRuntime();
  setTimeout(() => HB.emit('onSpinResult', { duringFs: true, foo: 7 }), 5);
  const payload = await HB.waitFor('onSpinResult');
  eq(payload.duringFs, true);
  eq(payload.foo, 7);
});

t('runtime: waitFor() with timeout rejects when no emit occurs', async () => {
  const HB = makeRuntime();
  let rejected = false;
  try {
    await HB.waitFor('onFsEnd', 30);
  } catch (err) {
    rejected = true;
    ok(String(err.message).includes('waitFor timeout'), 'should mention waitFor timeout');
  }
  eq(rejected, true, 'should reject after timeout window');
});

t('runtime: waitFor() unsubscribes once-handler on timeout (no leak)', async () => {
  const HB = makeRuntime();
  try { await HB.waitFor('onFsEnd', 20); } catch (_) {}
  eq(HB.listenerCount('onFsEnd'), 0, 'no orphan listener after timeout');
});

t('runtime: Wave V intent events emit + receive payload like core events', () => {
  const HB = makeRuntime();
  const got = [];
  HB.on('onSlamRequested', (p) => got.push(['slam-req', p.phase, p.source]));
  HB.on('onSlamComplete',  (p) => got.push(['slam-done', p.duration]));
  HB.on('onSkipRequested', (p) => got.push(['skip-req', p.phase, p.source]));
  HB.on('onSkipComplete',  (p) => got.push(['skip-done', p.phase, p.duration]));
  HB.emit('onSlamRequested', { phase: 'pre',  source: 'button' });
  HB.emit('onSlamComplete',  { duration: 75 });
  HB.emit('onSkipRequested', { phase: 'rollup', source: 'keyboard' });
  HB.emit('onSkipComplete',  { phase: 'rollup', duration: 20 });
  eq(got.length, 4);
  eq(got[0].join('|'), 'slam-req|pre|button');
  eq(got[1].join('|'), 'slam-done|75');
  eq(got[2].join('|'), 'skip-req|rollup|keyboard');
  eq(got[3].join('|'), 'skip-done|rollup|20');
});

t('runtime: window.HookBus + window.__HOOKBUS_MULT__ exposed', () => {
  const src = emitHookBusRuntime();
  const fakeWindow = {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };
  new Function('window', 'console', src)(fakeWindow, fakeConsole);
  ok(fakeWindow.HookBus, 'HookBus should be exposed');
  eq(fakeWindow.__HOOKBUS_MULT__, 1);
});

/* ── Run async tests then print summary ── */
(async () => {
  await Promise.all(pending);
  console.log('\n--- summary ---');
  console.log(`  pass: ${pass}`);
  console.log(`  fail: ${fail}`);
  if (fail > 0) process.exit(1);
})();
