/* eslint-disable no-console */
/**
 * Wave V1 — slamStop block tests.
 *
 * Coverage matrix:
 *   • defaultConfig / resolveConfig validation (RGB regex, clamp ranges,
 *     boolean coercion, label/aria length, auto-enable from feature kind)
 *   • emitSlamStopCSS  (disabled = empty, enabled = z-index 20, pulse
 *     keyframe gated by config, reduced-motion gate, mobile media query)
 *   • emitSlamStopMarkup (XSS escape of label + aria-label, hidden attr,
 *     disabled stub when block disabled)
 *   • emitSlamStopRuntime (stub when disabled, full runtime when enabled,
 *     HookBus wiring contract preserved)
 *   • sandbox: preSpin → requireMinSpinMs timer arms → slamStopShow,
 *     onSlamComplete → slamStopHide, postSpin/onFsTrigger/onFsEnd → hide,
 *     onSpinResult flips currentPhase pre→post,
 *     turbo + autoSpin globals suppress show,
 *     slamStopRequest emits onSlamRequested with correct phase + source,
 *     reels click area arm/disarm.
 */

import {
  defaultConfig, resolveConfig,
  emitSlamStopCSS, emitSlamStopMarkup, emitSlamStopRuntime,
} from '../../src/blocks/slamStop.mjs';
import {
  emitHookBusRuntime,
} from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const pending = [];
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
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/slamStop.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: sensible industry-baseline values', () => {
  const d = defaultConfig();
  eq(d.enabled, false);
  eq(d.chipLabel, 'STOP');
  eq(d.chipColor, '255,80,80');
  eq(d.chipTextColor, '255,255,255');
  eq(d.requireMinSpinMs, 250);
  eq(d.hideOnTurbo, true);
  eq(d.hideOnAutoSpin, true);
  eq(d.reelsClickAreaEnabled, true);
  eq(d.ariaLabel, 'Stop reels');
  eq(d.pulseAnimation, true);
});

t('resolveConfig: enabled coerces truthy/falsy to boolean', () => {
  eq(resolveConfig({ slamStop: { enabled: 1 } }).enabled, true);
  eq(resolveConfig({ slamStop: { enabled: 0 } }).enabled, false);
  eq(resolveConfig({ slamStop: { enabled: 'yes' } }).enabled, true);
  eq(resolveConfig({ slamStop: { enabled: null } }).enabled, false);
});

t('resolveConfig: chipLabel length-gated (>16 rejected, empty rejected)', () => {
  eq(resolveConfig({ slamStop: { chipLabel: 'BRZO STOP' } }).chipLabel, 'BRZO STOP');
  eq(resolveConfig({ slamStop: { chipLabel: '' } }).chipLabel, 'STOP', 'empty falls back to default');
  eq(resolveConfig({ slamStop: { chipLabel: 'X'.repeat(17) } }).chipLabel, 'STOP', '>16 falls back');
});

t('resolveConfig: chipColor RGB regex enforces three int triplet', () => {
  eq(resolveConfig({ slamStop: { chipColor: '10,20,30' } }).chipColor, '10,20,30');
  eq(resolveConfig({ slamStop: { chipColor: '255, 255, 255' } }).chipColor, '255,255,255', 'spaces stripped');
  eq(resolveConfig({ slamStop: { chipColor: '#ff0000' } }).chipColor, '255,80,80', 'hex rejected → default');
  eq(resolveConfig({ slamStop: { chipColor: 'red' } }).chipColor, '255,80,80', 'named color rejected');
  eq(resolveConfig({ slamStop: { chipColor: '300,400,500' } }).chipColor, '300,400,500', 'shape-only check — clamp is CSS job');
});

t('resolveConfig: requireMinSpinMs clamped [0, 2000]', () => {
  eq(resolveConfig({ slamStop: { requireMinSpinMs: -100 } }).requireMinSpinMs, 0);
  eq(resolveConfig({ slamStop: { requireMinSpinMs: 99999 } }).requireMinSpinMs, 2000);
  eq(resolveConfig({ slamStop: { requireMinSpinMs: 500 } }).requireMinSpinMs, 500);
  eq(resolveConfig({ slamStop: { requireMinSpinMs: 'nope' } }).requireMinSpinMs, 250, 'non-finite → default');
});

t('resolveConfig: ariaLabel length cap (>64 rejected)', () => {
  eq(resolveConfig({ slamStop: { ariaLabel: 'Custom label' } }).ariaLabel, 'Custom label');
  eq(resolveConfig({ slamStop: { ariaLabel: 'X'.repeat(65) } }).ariaLabel, 'Stop reels');
});

t('resolveConfig: auto-enable from features[].kind = slam_stop (canonical + dash variants)', () => {
  for (const k of ['slam_stop', 'slam-stop', 'SLAM_STOP', 'quick_stop', 'quick-stop']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, true, k);
  }
  /* Other kinds must not flip the switch. */
  eq(resolveConfig({ features: [{ kind: 'free_spins' }] }).enabled, false);
});

/* ── CSS ── */

t('emitSlamStopCSS: returns empty string when disabled', () => {
  eq(emitSlamStopCSS({ ...defaultConfig(), enabled: false }), '');
});

t('emitSlamStopCSS: z-index 20 baked when enabled', () => {
  const css = emitSlamStopCSS({ ...defaultConfig(), enabled: true });
  ct(css, 'z-index: 20');
  ct(css, '.slam-stop-btn');
});

t('emitSlamStopCSS: pulse keyframe present iff pulseAnimation=true', () => {
  const withPulse = emitSlamStopCSS({ ...defaultConfig(), enabled: true, pulseAnimation: true });
  const noPulse   = emitSlamStopCSS({ ...defaultConfig(), enabled: true, pulseAnimation: false });
  ct(withPulse, '@keyframes slamStopPulse');
  ct(withPulse, 'prefers-reduced-motion: reduce');
  nct(noPulse, '@keyframes slamStopPulse');
});

t('emitSlamStopCSS: reels click area class present iff enabled', () => {
  const withArea = emitSlamStopCSS({ ...defaultConfig(), enabled: true, reelsClickAreaEnabled: true });
  const noArea   = emitSlamStopCSS({ ...defaultConfig(), enabled: true, reelsClickAreaEnabled: false });
  ct(withArea, '.reelsHost.slam-armed');
  nct(noArea, '.reelsHost.slam-armed');
});

t('emitSlamStopCSS: mobile media query baked', () => {
  ct(emitSlamStopCSS({ ...defaultConfig(), enabled: true }), '@media (max-width: 480px)');
});

t('emitSlamStopCSS: chipColor is interpolated into rgba()/border', () => {
  const css = emitSlamStopCSS({ ...defaultConfig(), enabled: true, chipColor: '12,34,56' });
  ct(css, 'rgba(12,34,56, 1)');
});

/* ── Markup ── */

t('emitSlamStopMarkup: empty when disabled', () => {
  eq(emitSlamStopMarkup({ ...defaultConfig(), enabled: false }), '');
});

t('emitSlamStopMarkup: id="slamStopBtn" + hidden + type="button" + aria-label', () => {
  const html = emitSlamStopMarkup({ ...defaultConfig(), enabled: true });
  ct(html, 'id="slamStopBtn"');
  ct(html, 'class="slam-stop-btn"');
  ct(html, 'type="button"');
  ct(html, 'hidden');
  ct(html, 'aria-label="Stop reels"');
});

t('emitSlamStopMarkup: XSS payload in chipLabel is HTML-escaped', () => {
  const html = emitSlamStopMarkup({ ...defaultConfig(), enabled: true, chipLabel: '<img src=x>' });
  /* Label is length-gated to ≤16 so '<img src=x>' (12 chars) passes the
   * length filter, and must come out escaped. */
  ct(html, '&lt;img');
  ct(html, '&gt;');
  nct(html, '<img src=x>');
});

t('emitSlamStopMarkup: XSS payload in ariaLabel is HTML-escaped', () => {
  const html = emitSlamStopMarkup({ ...defaultConfig(), enabled: true, ariaLabel: 'a"><script>x</script>' });
  ct(html, '&quot;');
  ct(html, '&lt;script&gt;');
  nct(html, '<script>x</script>');
});

/* ── Runtime: disabled stub ── */

t('emitSlamStopRuntime: disabled emits stub (window.slamStop* no-op)', () => {
  const src = emitSlamStopRuntime({ ...defaultConfig(), enabled: false });
  ct(src, 'window.slamStopShow    = function () {}');
  ct(src, 'window.slamStopHide    = function () {}');
  ct(src, 'window.slamStopRequest = function () {}');
  ct(src, 'enabled: false');
  nct(src, 'HookBus.on(');
});

t('emitSlamStopRuntime: enabled wires HookBus listeners + button + window API', () => {
  const src = emitSlamStopRuntime({ ...defaultConfig(), enabled: true });
  ct(src, "HookBus.on('preSpin'");
  ct(src, "HookBus.on('onSpinResult'");
  ct(src, "HookBus.on('onSlamComplete'");
  ct(src, "HookBus.on('postSpin'");
  ct(src, "HookBus.on('onFsTrigger'");
  ct(src, "HookBus.on('onFsEnd'");
  ct(src, "HookBus.emit('onSlamRequested'");
  ct(src, 'window.slamStopShow');
  ct(src, 'window.slamStopHide');
  ct(src, 'window.slamStopRequest');
  ct(src, 'window.SLAM_STOP_STATE');
});

/* ── Sandbox: live runtime behavior ── */

function buildSandbox(cfg) {
  /* Combine hookBus runtime + slamStop runtime + a minimal fake DOM so
   * we can drive lifecycle events and verify state. */
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const slamSrc = emitSlamStopRuntime(cfg);

  const events = new Map(); /* hookbus-internal */
  const emitted = []; /* outbound capture */

  /* Minimal element factory shared across getElementById calls. */
  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, hidden: id === 'slamStopBtn',
      disabled: false,
      className: '',
      _classes: new Set(),
      _listeners: new Map(),
      classList: {
        add(c) { el._classes.add(c); el.className = Array.from(el._classes).join(' '); },
        remove(c) { el._classes.delete(c); el.className = Array.from(el._classes).join(' '); },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el[k] = v; },
      getAttribute(k) { return el[k]; },
      addEventListener(name, fn) {
        if (!el._listeners.has(name)) el._listeners.set(name, []);
        el._listeners.get(name).push(fn);
      },
      removeEventListener(name, fn) {
        if (!el._listeners.has(name)) return;
        el._listeners.set(name, el._listeners.get(name).filter(f => f !== fn));
      },
      _fire(name, ev) {
        const list = el._listeners.get(name) || [];
        for (const fn of list) fn(ev || {});
      },
    };
    elements.set(id, el);
    return el;
  }
  /* Pre-create the host + button + reelsHost so getElementById returns them. */
  makeElement('slamStopBtn');
  makeElement('reelsHost');

  const fakeDocument = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    querySelector(sel) {
      if (sel === '.reelsHost') return elements.get('reelsHost') || null;
      return null;
    },
    addEventListener() {},
  };
  const fakeWindow = {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  /* eslint-disable-next-line no-new-func */
  const factory = new Function(
    'window', 'document', 'console', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    hbSrc + '\n' + slamSrc + '\nreturn { HookBus };'
  );
  const perf = { now: () => Date.now() };
  const out = factory(fakeWindow, fakeDocument, fakeConsole, perf, setTimeout, clearTimeout, setInterval, clearInterval);

  return { window: fakeWindow, document: fakeDocument, elements, HookBus: fakeWindow.HookBus, build: out };
}

t('sandbox: preSpin arms requireMinSpinMs timer → slamStopShow fires', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 20 });
  const btn = sb.elements.get('slamStopBtn');
  eq(btn.hidden, true, 'starts hidden');
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 50));
  eq(btn.hidden, false, 'after requireMinSpinMs, button shown');
  eq(sb.window.SLAM_STOP_STATE.visible, true);
});

t('sandbox: onSlamComplete hides the button', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  const btn = sb.elements.get('slamStopBtn');
  eq(btn.hidden, false);
  sb.HookBus.emit('onSlamComplete', { duration: 100 });
  eq(btn.hidden, true);
  eq(sb.window.SLAM_STOP_STATE.visible, false);
});

t('sandbox: postSpin hides the button (reels stopped on their own)', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  sb.HookBus.emit('postSpin', { duringFs: false });
  eq(sb.elements.get('slamStopBtn').hidden, true);
});

t('sandbox: turbo mode globally suppresses the show', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  sb.window.__SLOT_TURBO_ACTIVE__ = true;
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  eq(sb.elements.get('slamStopBtn').hidden, true, 'turbo blocks show');
});

t('sandbox: autoSpin globally suppresses the show', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  sb.window.__SLOT_AUTOSPIN_ACTIVE__ = true;
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  eq(sb.elements.get('slamStopBtn').hidden, true, 'autoSpin blocks show');
});

t('sandbox: slamStopRequest emits onSlamRequested with phase + source', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  const captured = [];
  sb.HookBus.on('onSlamRequested', (p) => captured.push(p));
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  sb.window.slamStopRequest('button');
  eq(captured.length, 1);
  eq(captured[0].source, 'button');
  eq(captured[0].phase, 'pre', 'before onSpinResult phase should still be pre');
});

t('sandbox: onSpinResult flips currentPhase pre → post', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  const captured = [];
  sb.HookBus.on('onSlamRequested', (p) => captured.push(p));
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  sb.HookBus.emit('onSpinResult', { duringFs: false });
  sb.window.slamStopRequest('button');
  eq(captured.length, 1);
  eq(captured[0].phase, 'post', 'after onSpinResult phase is post');
});

t('sandbox: slamStopRequest sanitizes invalid source to "button"', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  const captured = [];
  sb.HookBus.on('onSlamRequested', (p) => captured.push(p));
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  sb.window.slamStopRequest('haxxor-injection');
  eq(captured[0].source, 'button');
});

t('sandbox: slamStopRequest is no-op when button not visible (prevents double-fire)', () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true });
  const captured = [];
  sb.HookBus.on('onSlamRequested', (p) => captured.push(p));
  /* Never call preSpin → button never shown. */
  sb.window.slamStopRequest('button');
  eq(captured.length, 0, 'should NOT emit when not visible');
});

t('sandbox: reels-area click fires onSlamRequested with source=reelsArea', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  const captured = [];
  sb.HookBus.on('onSlamRequested', (p) => captured.push(p));
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  sb.elements.get('reelsHost')._fire('pointerup');
  eq(captured[0].source, 'reelsArea');
});

t('sandbox: reels-area not wired when reelsClickAreaEnabled=false', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5, reelsClickAreaEnabled: false });
  const captured = [];
  sb.HookBus.on('onSlamRequested', (p) => captured.push(p));
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  sb.elements.get('reelsHost')._fire('pointerup');
  eq(captured.length, 0, 'reels-area click should be ignored when disabled');
});

t('sandbox: button click fires onSlamRequested with source=button', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5 });
  const captured = [];
  sb.HookBus.on('onSlamRequested', (p) => captured.push(p));
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  sb.elements.get('slamStopBtn')._fire('click');
  eq(captured[0].source, 'button');
});

t('sandbox: pulse class added on show, removed on hide', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 5, pulseAnimation: true });
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 20));
  const btn = sb.elements.get('slamStopBtn');
  ok(btn.classList.contains('is-pulsing'), 'pulse class on show');
  sb.HookBus.emit('postSpin', { duringFs: false });
  ok(!btn.classList.contains('is-pulsing'), 'pulse class removed on hide');
});

t('sandbox: rapid preSpin → preSpin (no result between) clears previous timer', async () => {
  const sb = buildSandbox({ ...defaultConfig(), enabled: true, requireMinSpinMs: 30 });
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 10));
  /* Second preSpin before first timer fires — should reset, not double. */
  sb.HookBus.emit('preSpin', { duringFs: false });
  await new Promise(r => setTimeout(r, 45));
  const btn = sb.elements.get('slamStopBtn');
  eq(btn.hidden, false, 'eventually shows after second timer fires');
});

/* ── Hygiene ── */

t('determinism: two emit calls with same config produce byte-identical CSS', () => {
  const a = emitSlamStopCSS({ ...defaultConfig(), enabled: true });
  const b = emitSlamStopCSS({ ...defaultConfig(), enabled: true });
  eq(a, b);
});

t('vendor-neutral: no vendor/game-specific strings in emitted CSS or runtime', () => {
  const css = emitSlamStopCSS({ ...defaultConfig(), enabled: true });
  const rt  = emitSlamStopRuntime({ ...defaultConfig(), enabled: true });
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath','sweet bonanza']) {
    nct(css.toLowerCase(), banned, 'CSS banned: ' + banned);
    nct(rt.toLowerCase(),  banned, 'RT  banned: ' + banned);
  }
});

/* ── async finale ── */
(async () => {
  await Promise.all(pending);
  console.log('\n--- summary ---');
  console.log(`  pass: ${pass}`);
  console.log(`  fail: ${fail}`);
  if (fail > 0) process.exit(1);
})();
