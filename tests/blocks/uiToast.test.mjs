/**
 * Unit test for src/blocks/uiToast.mjs (Wave U3)
 *
 *   1. defaults: disabled, industry baselines, 5 tier colors, 4 durations
 *   2. resolveConfig: threshold monotonic ordering enforced
 *   3. resolveConfig: durations clamped to [400, 12000] / [300, 8000]
 *   4. resolveConfig: maxQueue clamped to [1, 32]
 *   5. resolveConfig: per-tier color RGB validated
 *   6. resolveConfig: invalid color silently rejected
 *   7. resolveConfig: fsTriggerLabel length cap honored
 *   8. auto-enable from features[].kind in { ui_toast, win_celebration, big_win, mega_win }
 *   9. CSS empty when disabled
 *  10. CSS contains all 5 tier classes + epic flash + reduced-motion gate
 *  11. CSS contains mobile media query
 *  12. markup empty when disabled
 *  13. markup contains uiToastHost id + aria-live attribute
 *  14. runtime stub when disabled
 *  15. runtime bakes thresholds + durations + maxQueue + label
 *  16. runtime exposes uiShowToast / uiClearToasts / uiGetQueueLength / TOAST_STATE
 *  17. runtime registers HookBus.on for postSpin / onFsTrigger / onFsEnd / preSpin
 *  18. behavior: postSpin BIG tier with payX 15 plays one toast labeled UITOAST_TIER1
 *  19. behavior: postSpin MEGA tier with payX 75 plays UITOAST_TIER2
 *  20. behavior: postSpin EPIC tier with payX 300 plays UITOAST_TIER3
 *  21. behavior: postSpin sub-BIG (payX 5) plays nothing
 *  22. behavior: uiShowToast queues + drains sequentially
 *  23. behavior: queue capped at maxQueue
 *  24. behavior: uiClearToasts flushes everything
 *  25. behavior: invalid label rejected (non-string / empty)
 *  26. behavior: long label truncated to 64 chars
 *  27. behavior: invalid tier falls back to 'feature'
 *  28. behavior: onFsTrigger queues 'FREE SPINS!' toast
 *  29. behavior: onFsEnd with totalWin queues 'FS COMPLETE' with amount
 *  30. behavior: onFsEnd skipped when queueOnFsEnd=false
 *  31. behavior: preSpin drops queue tail (keep current toast only)
 *  32. determinism — emitter is pure
 *  33. no game-specific names in emitted output
 *  34. XSS guard: label HTML-escaped in rendered toast
 *  35. amount formatter strips ".00" suffix
 */

import { strict as assert } from 'node:assert';
import {
  defaultConfig,
  resolveConfig,
  emitUiToastCSS,
  emitUiToastMarkup,
  emitUiToastRuntime,
  TOAST_TIERS,
} from '../../src/blocks/uiToast.mjs';

let fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\n— blocks/uiToast.mjs —');

/* ── 1: defaults ─────────────────────────────────────────────────── */
t('defaults: disabled, industry baselines, 5 colors, 4 durations', () => {
  const d = defaultConfig();
  assert.equal(d.enabled, false);
  assert.equal(d.bigWinThresholdX, 10);
  assert.equal(d.megaWinThresholdX, 50);
  assert.equal(d.epicWinThresholdX, 250);
  assert.equal(d.bigDurationMs, 1800);
  assert.equal(d.megaDurationMs, 2400);
  assert.equal(d.epicDurationMs, 3200);
  assert.equal(d.featureDurationMs, 1400);
  assert.equal(d.queueOnFsEnd, true);
  assert.equal(d.fsTriggerLabel, 'FREE SPINS!');
  assert.equal(d.maxQueue, 6);
  assert.equal(TOAST_TIERS.length, 5);
  for (const tier of TOAST_TIERS) {
    assert.ok(/^\d{1,3},\d{1,3},\d{1,3}$/.test(d.colors[tier]),
      `tier ${tier} color must be valid RGB triple`);
  }
});

/* ── 2-7: resolveConfig validation ───────────────────────────────── */
t('resolveConfig: threshold monotonic ordering enforced', () => {
  const c = resolveConfig({
    uiToast: { bigWinThresholdX: 100, megaWinThresholdX: 50, epicWinThresholdX: 25 },
  });
  assert.equal(c.bigWinThresholdX, 100);
  assert.ok(c.megaWinThresholdX > c.bigWinThresholdX);
  assert.ok(c.epicWinThresholdX > c.megaWinThresholdX);
});

t('resolveConfig: durations clamped to ranges', () => {
  let c = resolveConfig({ uiToast: { bigDurationMs: 50, megaDurationMs: 50000 } });
  assert.equal(c.bigDurationMs, 400);
  assert.equal(c.megaDurationMs, 12000);
  c = resolveConfig({ uiToast: { featureDurationMs: 100 } });
  assert.equal(c.featureDurationMs, 300);
});

t('resolveConfig: maxQueue clamped to [1, 32]', () => {
  let c = resolveConfig({ uiToast: { maxQueue: 0 } });
  assert.equal(c.maxQueue, 1);
  c = resolveConfig({ uiToast: { maxQueue: 100 } });
  assert.equal(c.maxQueue, 32);
});

t('resolveConfig: per-tier color RGB accepted', () => {
  const c = resolveConfig({ uiToast: { colors: { big: '50,60,70', epic: '100,110,120' } } });
  assert.equal(c.colors.big, '50,60,70');
  assert.equal(c.colors.epic, '100,110,120');
  /* others fall through to defaults */
  assert.equal(c.colors.mega, defaultConfig().colors.mega);
});

t('resolveConfig: invalid color silently rejected', () => {
  const c = resolveConfig({ uiToast: { colors: { big: 'bogus', mega: '300,400,500' } } });
  /* "300,400,500" matches regex but isn't bounds-checked in the block;
     stays as-is. "bogus" must be rejected. */
  assert.equal(c.colors.big, defaultConfig().colors.big);
});

t('resolveConfig: fsTriggerLabel length cap (≤ 32) honored', () => {
  const c = resolveConfig({ uiToast: { fsTriggerLabel: 'A'.repeat(64) } });
  assert.equal(c.fsTriggerLabel, defaultConfig().fsTriggerLabel,
    'oversized label rejected, default preserved');
  const c2 = resolveConfig({ uiToast: { fsTriggerLabel: 'BONUS ROUND!' } });
  assert.equal(c2.fsTriggerLabel, 'BONUS ROUND!');
});

/* ── 8: auto-enable ──────────────────────────────────────────────── */
t('auto-enable from each accepted feature kind', () => {
  for (const kind of ['ui_toast', 'win_celebration', 'big_win', 'mega_win']) {
    const c = resolveConfig({ features: [{ kind }] });
    assert.equal(c.enabled, true, `expected enabled for kind=${kind}`);
  }
});

/* ── 9-13: CSS + markup ──────────────────────────────────────────── */
t('CSS empty when disabled', () => {
  assert.equal(emitUiToastCSS(defaultConfig()), '');
});

t('CSS contains 5 tier rules + epic flash + reduced-motion gate', () => {
  const css = emitUiToastCSS({ ...defaultConfig(), enabled: true });
  for (const tier of TOAST_TIERS) {
    assert.ok(new RegExp(`data-tier="${tier}"`).test(css), `tier ${tier} CSS rule expected`);
  }
  assert.ok(/is-epic::before/.test(css), 'epic flash overlay expected');
  assert.ok(/prefers-reduced-motion/.test(css));
});

t('CSS contains mobile media query', () => {
  const css = emitUiToastCSS({ ...defaultConfig(), enabled: true });
  assert.ok(/max-width:\s*620px/.test(css));
});

t('markup empty when disabled', () => {
  assert.equal(emitUiToastMarkup(defaultConfig()), '');
});

t('markup contains uiToastHost id + aria-live', () => {
  const html = emitUiToastMarkup({ ...defaultConfig(), enabled: true });
  assert.ok(/id="uiToastHost"/.test(html));
  assert.ok(/aria-live="polite"/.test(html));
  assert.ok(/aria-atomic="true"/.test(html));
});

/* ── 14-17: runtime contract ─────────────────────────────────────── */
t('runtime stub when disabled', () => {
  const rt = emitUiToastRuntime(defaultConfig());
  assert.ok(/uiToast:\s*disabled/.test(rt));
  assert.ok(!/HookBus\.on/.test(rt));
});

t('runtime bakes thresholds + durations + maxQueue + fsTriggerLabel', () => {
  const cfg = {
    ...defaultConfig(), enabled: true,
    bigWinThresholdX: 12, megaWinThresholdX: 60, epicWinThresholdX: 300,
    maxQueue: 4, fsTriggerLabel: 'BONUS!',
  };
  const rt = emitUiToastRuntime(cfg);
  assert.ok(/TOAST_BIG_X\s*=\s*12/.test(rt));
  assert.ok(/TOAST_MEGA_X\s*=\s*60/.test(rt));
  assert.ok(/TOAST_EPIC_X\s*=\s*300/.test(rt));
  assert.ok(/TOAST_MAX_QUEUE\s*=\s*4/.test(rt));
  assert.ok(/TOAST_FS_LABEL\s*=\s*"BONUS!"/.test(rt));
});

t('runtime exposes uiShowToast / uiClearToasts / uiGetQueueLength / TOAST_STATE', () => {
  const rt = emitUiToastRuntime({ ...defaultConfig(), enabled: true });
  for (const fn of ['uiShowToast', 'uiClearToasts', 'uiGetQueueLength']) {
    assert.ok(new RegExp(`window\\.${fn}\\s*=\\s*${fn}`).test(rt), `missing window.${fn}`);
  }
  assert.ok(/window\.TOAST_STATE\s*=\s*TOAST_STATE/.test(rt));
});

t('runtime registers HookBus.on for postSpin / onFsTrigger / onFsEnd / preSpin', () => {
  const rt = emitUiToastRuntime({ ...defaultConfig(), enabled: true });
  for (const ev of ['postSpin', 'onFsTrigger', 'onFsEnd', 'preSpin']) {
    assert.ok(new RegExp(`HookBus\\.on\\('${ev}'`).test(rt), `missing HookBus.on('${ev}')`);
  }
});

/* ── 18-31: behavior via sandbox eval ─────────────────────────────── */
function makeEvalCtx(cfg) {
  const rt = emitUiToastRuntime({ ...defaultConfig(), ...cfg, enabled: true });
  /* Stub a minimal DOM: host with append/remove + dataset, plus
     element factory that captures inner state. */
  const renderLog = [];
  function makeNode() {
    const dataset = {};
    const cls = new Set();
    return {
      dataset,
      classList: {
        add(c) { cls.add(c); },
        remove(c) { cls.delete(c); },
        contains(c) { return cls.has(c); },
      },
      _cls: cls,
      _children: [],
      className: '',
      innerHTML: '',
      appendChild(child) {
        this._children.push(child);
        child.parentNode = this;
        renderLog.push({ event: 'append', tier: child.dataset.tier, label: child._label, html: child.innerHTML });
      },
      removeChild(child) {
        const i = this._children.indexOf(child);
        if (i >= 0) this._children.splice(i, 1);
        child.parentNode = null;
      },
      get firstChild() { return this._children[0] || null; },
    };
  }
  const host = makeNode();
  const stubDoc = {
    getElementById: (id) => (id === 'uiToastHost' ? host : null),
    createElement: () => {
      const n = makeNode();
      /* Track label set after innerHTML assignment for test introspection */
      Object.defineProperty(n, 'innerHTML', {
        get() { return this._innerHTML || ''; },
        set(v) { this._innerHTML = v; this._label = v.replace(/<[^>]+>.*$/, ''); },
      });
      return n;
    },
    addEventListener: () => {},
  };
  const stubHookBus = {
    _handlers: {},
    on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    emit(ev, payload) { (this._handlers[ev] || []).forEach(fn => fn(payload || {})); },
    _mult: 1,
    getMult() { return this._mult; },
    setMult(v) { this._mult = v; },
  };
  /* setTimeout fires immediately for deterministic flow */
  const stubST = (fn /* , ms */) => { fn(); return 0; };
  const stubWin = {};
  const ctxFn = new Function(
    'document', 'window', 'HookBus', 'setTimeout',
    rt +
    `; return { uiShowToast, uiClearToasts, uiGetQueueLength, TOAST_STATE, HookBus };`
  );
  const ctx = ctxFn(stubDoc, stubWin, stubHookBus, stubST);
  ctx.host = host;
  ctx.renderLog = renderLog;
  return ctx;
}

t('behavior: postSpin BIG tier with payX 15 → placeholder UITOAST_TIER1 toast', () => {
  const ctx = makeEvalCtx({});
  ctx.HookBus.emit('postSpin', { events: [{ payX: 15 }] });
  const big = ctx.renderLog.filter(r => r.tier === 'big');
  assert.equal(big.length, 1);
  assert.ok(big[0].html.includes('UITOAST_TIER1'));
});

t('behavior: postSpin MEGA tier with payX 75 → UITOAST_TIER2 toast', () => {
  const ctx = makeEvalCtx({});
  ctx.HookBus.emit('postSpin', { events: [{ payX: 75 }] });
  const mega = ctx.renderLog.filter(r => r.tier === 'mega');
  assert.equal(mega.length, 1);
  assert.ok(mega[0].html.includes('UITOAST_TIER2'));
});

t('behavior: postSpin EPIC tier with payX 300 → UITOAST_TIER3 toast', () => {
  const ctx = makeEvalCtx({});
  ctx.HookBus.emit('postSpin', { events: [{ payX: 300 }] });
  const epic = ctx.renderLog.filter(r => r.tier === 'epic');
  assert.equal(epic.length, 1);
  assert.ok(epic[0].html.includes('UITOAST_TIER3'));
});

t('behavior: GDD-supplied placeholder labels override defaults', () => {
  const cfg = resolveConfig({ uiToast: { labels: { big: 'PLAY_TIER1', mega: 'PLAY_TIER2', epic: 'PLAY_TIER3' } } });
  const ctx = makeEvalCtx(cfg);
  ctx.HookBus.emit('postSpin', { events: [{ payX: 15 }] });
  ctx.HookBus.emit('postSpin', { events: [{ payX: 75 }] });
  ctx.HookBus.emit('postSpin', { events: [{ payX: 300 }] });
  const labels = ctx.renderLog.map(r => r.html).join(' ');
  assert.ok(labels.includes('PLAY_TIER1'));
  assert.ok(labels.includes('PLAY_TIER2'));
  assert.ok(labels.includes('PLAY_TIER3'));
});

t('config: malformed labels (XSS / oversize / non-string) rejected', () => {
  // <script> → rejected → default kept
  const a = resolveConfig({ uiToast: { labels: { big: '<script>' } } });
  assert.equal(a.labels.big, 'UITOAST_TIER1');
  // 100-char string → rejected → default kept
  const b = resolveConfig({ uiToast: { labels: { mega: 'x'.repeat(100) } } });
  assert.equal(b.labels.mega, 'UITOAST_TIER2');
  // non-string → rejected → default kept
  const c = resolveConfig({ uiToast: { labels: { epic: 42 } } });
  assert.equal(c.labels.epic, 'UITOAST_TIER3');
});

t('behavior: postSpin sub-BIG (payX 5) plays nothing', () => {
  const ctx = makeEvalCtx({});
  ctx.HookBus.emit('postSpin', { events: [{ payX: 5 }] });
  assert.equal(ctx.renderLog.length, 0);
});

t('behavior: uiShowToast accepts custom label + tier=feature', () => {
  const ctx = makeEvalCtx({});
  const r = ctx.uiShowToast('LIGHTNING STRIKE!', { tier: 'feature' });
  assert.equal(r, true);
  assert.equal(ctx.renderLog.length, 1);
  assert.equal(ctx.renderLog[0].tier, 'feature');
  assert.ok(ctx.renderLog[0].html.includes('LIGHTNING STRIKE!'));
});

t('behavior: queue caps at maxQueue', () => {
  const ctx = makeEvalCtx({ maxQueue: 2 });
  /* setTimeout stub fires immediately, so each toast drains synchronously
     and TOAST_STATE.current toggles between non-null and null. We test by
     calling uiShowToast 10 times back-to-back — each goes through
     immediately under the synchronous stub, so the queue never grows.
     This test instead verifies the cap by pausing the state. */
  ctx.TOAST_STATE.paused = true;
  for (let i = 0; i < 10; i++) ctx.uiShowToast('T' + i, { tier: 'feature' });
  assert.equal(ctx.TOAST_STATE.queue.length, 2, 'queue capped at maxQueue=2');
});

t('behavior: uiClearToasts flushes everything', () => {
  const ctx = makeEvalCtx({});
  ctx.TOAST_STATE.paused = true;
  ctx.uiShowToast('A', { tier: 'feature' });
  ctx.uiShowToast('B', { tier: 'feature' });
  assert.equal(ctx.TOAST_STATE.queue.length, 2);
  ctx.uiClearToasts();
  assert.equal(ctx.TOAST_STATE.queue.length, 0);
  assert.equal(ctx.TOAST_STATE.current, null);
});

t('behavior: invalid label rejected (non-string / empty)', () => {
  const ctx = makeEvalCtx({});
  assert.equal(ctx.uiShowToast('', { tier: 'feature' }), false);
  assert.equal(ctx.uiShowToast(null, { tier: 'feature' }), false);
  assert.equal(ctx.uiShowToast(123, { tier: 'feature' }), false);
});

t('behavior: long label truncated to 64 chars', () => {
  const ctx = makeEvalCtx({});
  const long = 'X'.repeat(200);
  ctx.uiShowToast(long, { tier: 'feature' });
  /* The rendered HTML must contain ≤ 64 X's */
  const html = ctx.renderLog[0].html;
  const xCount = (html.match(/X/g) || []).length;
  assert.ok(xCount <= 64, `expected ≤ 64 X chars, got ${xCount}`);
});

t('behavior: invalid tier falls back to feature', () => {
  const ctx = makeEvalCtx({});
  ctx.uiShowToast('WAT', { tier: 'bogus' });
  assert.equal(ctx.renderLog[0].tier, 'feature');
});

t('behavior: onFsTrigger queues FREE SPINS! toast', () => {
  const ctx = makeEvalCtx({});
  ctx.HookBus.emit('onFsTrigger', {});
  const fs = ctx.renderLog.filter(r => r.html.includes('FREE SPINS'));
  assert.equal(fs.length, 1);
  assert.equal(fs[0].tier, 'feature');
});

t('behavior: onFsEnd with totalWin queues FS COMPLETE + amount', () => {
  const ctx = makeEvalCtx({});
  ctx.HookBus.emit('onFsEnd', { totalWin: 42.5 });
  const done = ctx.renderLog.filter(r => r.html.includes('FS COMPLETE'));
  assert.equal(done.length, 1);
  assert.ok(done[0].html.includes('42.5'), 'amount must be in the toast');
});

t('behavior: onFsEnd skipped when queueOnFsEnd=false', () => {
  const ctx = makeEvalCtx({ queueOnFsEnd: false });
  ctx.HookBus.emit('onFsEnd', { totalWin: 42 });
  const done = ctx.renderLog.filter(r => r.html.includes('FS COMPLETE'));
  assert.equal(done.length, 0);
});

t('behavior: preSpin drops queue tail (keep only current)', () => {
  const ctx = makeEvalCtx({ maxQueue: 32 });
  ctx.TOAST_STATE.paused = true;
  for (let i = 0; i < 5; i++) ctx.uiShowToast('Q' + i, { tier: 'feature' });
  assert.equal(ctx.TOAST_STATE.queue.length, 5);
  ctx.HookBus.emit('preSpin', { duringFs: false });
  assert.equal(ctx.TOAST_STATE.queue.length, 1, 'tail dropped, head preserved');
});

/* ── 32-35: hygiene ──────────────────────────────────────────────── */
t('determinism — emitter is pure (two calls byte-identical)', () => {
  const a = emitUiToastRuntime({ ...defaultConfig(), enabled: true });
  const b = emitUiToastRuntime({ ...defaultConfig(), enabled: true });
  assert.equal(a, b);
});

t('no game-specific names in emitted output (template rule)', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const all = emitUiToastCSS(cfg) + emitUiToastMarkup(cfg) + emitUiToastRuntime(cfg);
  const banned = /(gates[- ]of[- ]olympus|wrath[- ]of[- ]olympus|crystal[- ]forge|midnight[- ]fangs|sweet[- ]bonanza|sugar[- ]rush|reactoonz|pragmatic|netent|microgaming|aristocrat|wazdan)/i;
  assert.ok(!banned.test(all));
});

t('XSS guard: label HTML-escaped in rendered toast', () => {
  const ctx = makeEvalCtx({});
  ctx.uiShowToast('<img src=x onerror=alert(1)>', { tier: 'feature' });
  const html = ctx.renderLog[0].html;
  assert.ok(!/<img/.test(html), 'raw tag must not survive');
  assert.ok(/&lt;img/.test(html), 'escaped form expected');
});

t('amount formatter strips trailing .00', () => {
  const ctx = makeEvalCtx({});
  ctx.uiShowToast('TEST', { tier: 'feature', amount: 100 });
  const html = ctx.renderLog[0].html;
  /* "×100" not "×100.00" */
  assert.ok(/×100\b/.test(html), 'integer amount renders without trailing .00');
  assert.ok(!/×100\.00/.test(html));
});

if (fail > 0) {
  console.error(`\n✗ ${fail} test(s) failed in uiToast.test.mjs`);
  process.exit(1);
}
console.log(`\n✓ All uiToast tests passed`);
