/**
 * Unit test for src/blocks/audio.mjs (Wave U2)
 *
 *   1. defaults: disabled, 15 categories, master 0.7, mute false, thresholds
 *   2. resolveConfig: masterVolume clamped to [0,1]
 *   3. resolveConfig: muted flag honored
 *   4. resolveConfig: urls per category accepted and stored
 *   5. resolveConfig: per-category volume clamped [0,1]
 *   6. resolveConfig: invalid URL (javascript:) rejected
 *   7. resolveConfig: invalid URL (data:) rejected
 *   8. resolveConfig: URL with spaces / quotes rejected
 *   9. resolveConfig: thresholds monotonically increasing (big < mega < epic)
 *  10. auto-enable from feature kind 'audio'
 *  11. auto-enable from feature kind 'sound' (alias)
 *  12. auto-enable when at least one URL populated
 *  13. CSS empty when disabled or showToggle=false
 *  14. CSS contains .audio-toggle + mute strike + reduced-motion gate
 *  15. markup empty when disabled
 *  16. markup contains audioToggle id + initial muted state
 *  17. runtime stub when disabled
 *  18. runtime bakes all 15 categories + URLs + volumes + thresholds
 *  19. runtime exposes audioPlay / audioPreload / audioSetMuted / etc.
 *  20. runtime registers HookBus.on for preSpin / onSpinResult / etc.
 *  21. runtime persists muted+volume in localStorage
 *  22. runtime handles missing localStorage gracefully
 *  23. runtime: audioPlay returns false when muted
 *  24. runtime: audioPlay returns false when URL unset for category
 *  25. runtime: postSpin selects correct win tier (BASE / BIG / MEGA / EPIC)
 *  26. determinism — emitter is pure
 *  27. no game-specific names in emitted output (template rule)
 *  28. XSS guard on toggle markup (no injection from cfg)
 *  29. AUDIO_CATEGORIES export matches runtime constant
 */

import { strict as assert } from 'node:assert';
import {
  defaultConfig,
  resolveConfig,
  emitAudioCSS,
  emitAudioMarkup,
  emitAudioRuntime,
  AUDIO_CATEGORIES,
} from '../../src/blocks/audio.mjs';

let fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\n— blocks/audio.mjs —');

/* ── 1: defaults ─────────────────────────────────────────────────── */
t('defaults: disabled with industry baselines', () => {
  const d = defaultConfig();
  assert.equal(d.enabled, false);
  assert.equal(d.masterVolume, 0.7);
  assert.equal(d.muted, false);
  assert.equal(d.showToggle, true);
  assert.equal(d.bigWinThresholdX, 10);
  assert.equal(d.megaWinThresholdX, 50);
  assert.equal(d.epicWinThresholdX, 250);
  assert.equal(Object.keys(d.urls).length, 15);
  assert.equal(Object.keys(d.volumes).length, 15);
  /* every category should be in the urls + volumes map */
  for (const c of AUDIO_CATEGORIES) {
    assert.equal(d.urls[c], '');
    assert.equal(d.volumes[c], 1.0);
  }
});

/* ── 2-9: resolveConfig validation ───────────────────────────────── */
t('resolveConfig: masterVolume clamped to [0, 1]', () => {
  let c = resolveConfig({ audio: { masterVolume: -0.5 } });
  assert.equal(c.masterVolume, 0);
  c = resolveConfig({ audio: { masterVolume: 1.5 } });
  assert.equal(c.masterVolume, 1);
  c = resolveConfig({ audio: { masterVolume: 0.3 } });
  assert.equal(c.masterVolume, 0.3);
});

t('resolveConfig: muted flag honored', () => {
  const c = resolveConfig({ audio: { muted: true } });
  assert.equal(c.muted, true);
});

t('resolveConfig: urls per category accepted', () => {
  const c = resolveConfig({
    audio: { urls: { SPIN_START: 'sounds/spin.mp3', FS_TRIGGER: 'sounds/fs.ogg' } },
  });
  assert.equal(c.urls.SPIN_START, 'sounds/spin.mp3');
  assert.equal(c.urls.FS_TRIGGER, 'sounds/fs.ogg');
  /* other categories unchanged */
  assert.equal(c.urls.REEL_STOP, '');
});

t('resolveConfig: per-category volume clamped [0,1]', () => {
  const c = resolveConfig({
    audio: { volumes: { SPIN_START: 0.4, REEL_STOP: 1.5, WIN_BIG: -0.2 } },
  });
  assert.equal(c.volumes.SPIN_START, 0.4);
  assert.equal(c.volumes.REEL_STOP, 1);
  assert.equal(c.volumes.WIN_BIG, 0);
});

t('resolveConfig: javascript: URL rejected', () => {
  const c = resolveConfig({
    audio: { urls: { SPIN_START: 'javascript:alert(1)' } },
  });
  assert.equal(c.urls.SPIN_START, '');
});

t('resolveConfig: data: URL rejected', () => {
  const c = resolveConfig({
    audio: { urls: { SPIN_START: 'data:audio/mp3;base64,xxx' } },
  });
  assert.equal(c.urls.SPIN_START, '');
});

t('resolveConfig: URL with spaces / quotes rejected', () => {
  const c = resolveConfig({
    audio: { urls: { SPIN_START: 'sounds/spin onfire.mp3', REEL_STOP: 'sounds/"quoted".mp3' } },
  });
  assert.equal(c.urls.SPIN_START, '');
  assert.equal(c.urls.REEL_STOP, '');
});

t('resolveConfig: thresholds enforce big < mega < epic ordering', () => {
  /* Try to set mega < big — clamp pushes it above big */
  const c = resolveConfig({
    audio: { bigWinThresholdX: 100, megaWinThresholdX: 50, epicWinThresholdX: 200 },
  });
  assert.equal(c.bigWinThresholdX, 100);
  assert.ok(c.megaWinThresholdX > c.bigWinThresholdX, 'mega > big');
  assert.ok(c.epicWinThresholdX > c.megaWinThresholdX, 'epic > mega');
});

/* ── 10-12: auto-enable ──────────────────────────────────────────── */
t("auto-enable from features[].kind === 'audio'", () => {
  const c = resolveConfig({ features: [{ kind: 'audio' }] });
  assert.equal(c.enabled, true);
});

t("auto-enable from features[].kind === 'sound' (alias)", () => {
  const c = resolveConfig({ features: [{ kind: 'sound' }] });
  assert.equal(c.enabled, true);
});

t('auto-enable when at least one URL populated', () => {
  const c = resolveConfig({
    audio: { urls: { SPIN_START: 'sounds/spin.mp3' } },
  });
  assert.equal(c.enabled, true);
});

/* ── 13-16: CSS + markup ─────────────────────────────────────────── */
t('CSS empty when disabled', () => {
  assert.equal(emitAudioCSS(defaultConfig()), '');
});

t('CSS empty when showToggle=false', () => {
  const cfg = { ...defaultConfig(), enabled: true, showToggle: false };
  assert.equal(emitAudioCSS(cfg), '');
});

t('CSS has .audio-toggle + mute strike + reduced-motion gate', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const css = emitAudioCSS(cfg);
  assert.ok(/\.audio-toggle\b/.test(css));
  assert.ok(/data-muted="true"/.test(css));
  assert.ok(/prefers-reduced-motion/.test(css));
  assert.ok(/max-width:\s*620px/.test(css));
});

t('markup empty when disabled', () => {
  assert.equal(emitAudioMarkup(defaultConfig()), '');
});

t('markup contains audioToggle id + initial state', () => {
  const cfg = { ...defaultConfig(), enabled: true, muted: true };
  const html = emitAudioMarkup(cfg);
  assert.ok(/id="audioToggle"/.test(html));
  assert.ok(/data-muted="true"/.test(html));
  assert.ok(/aria-label="Toggle audio"/.test(html));
});

/* ── 17-22: runtime contract ─────────────────────────────────────── */
t('runtime is stub when disabled', () => {
  const rt = emitAudioRuntime(defaultConfig());
  assert.ok(/audio:\s*disabled/.test(rt));
  assert.ok(!/HookBus\.on/.test(rt));
});

t('runtime bakes 15 categories + URLs + volumes + thresholds', () => {
  const cfg = {
    ...defaultConfig(), enabled: true,
    urls: { ...defaultConfig().urls, SPIN_START: 'spin.mp3' },
    bigWinThresholdX: 15, megaWinThresholdX: 75, epicWinThresholdX: 300,
  };
  const rt = emitAudioRuntime(cfg);
  assert.ok(/AUDIO_CATEGORIES\s*=\s*\["SPIN_START"/.test(rt));
  assert.ok(/"SPIN_START":"spin\.mp3"/.test(rt));
  assert.ok(/AUDIO_BIG_X\s*=\s*15/.test(rt));
  assert.ok(/AUDIO_MEGA_X\s*=\s*75/.test(rt));
  assert.ok(/AUDIO_EPIC_X\s*=\s*300/.test(rt));
});

t('runtime exposes audioPlay / audioPreload / audioSetMuted / audioToggleMuted / audioSetVolume', () => {
  const rt = emitAudioRuntime({ ...defaultConfig(), enabled: true });
  for (const fn of ['audioPlay', 'audioPreload', 'audioSetMuted', 'audioToggleMuted', 'audioSetVolume']) {
    assert.ok(new RegExp(`window\\.${fn}\\s*=\\s*${fn}`).test(rt), `missing window.${fn} export`);
  }
  assert.ok(/window\.AUDIO_STATE\s*=\s*AUDIO_STATE/.test(rt));
});

t('runtime registers HookBus.on for all lifecycle events', () => {
  const rt = emitAudioRuntime({ ...defaultConfig(), enabled: true });
  for (const ev of ['preSpin', 'onSpinResult', 'onTumbleStep', 'postSpin', 'onFsTrigger', 'onFsEnd']) {
    assert.ok(new RegExp(`HookBus\\.on\\('${ev}'`).test(rt), `missing HookBus.on('${ev}')`);
  }
});

t('runtime persists muted + volume to localStorage', () => {
  const rt = emitAudioRuntime({ ...defaultConfig(), enabled: true });
  assert.ok(/localStorage\.setItem\('slot\.audio\.muted'/.test(rt));
  assert.ok(/localStorage\.setItem\('slot\.audio\.volume'/.test(rt));
  assert.ok(/localStorage\.getItem\('slot\.audio\.muted'\)/.test(rt));
  assert.ok(/localStorage\.getItem\('slot\.audio\.volume'/.test(rt));
});

t('runtime handles missing localStorage gracefully (try/catch wraps)', () => {
  const rt = emitAudioRuntime({ ...defaultConfig(), enabled: true });
  /* Each localStorage call must be wrapped in try/catch so privacy
     mode (e.g. Safari ITP) does not throw and break the runtime. */
  const lsCalls = (rt.match(/localStorage\.(setItem|getItem)/g) || []).length;
  const tryBlocks = (rt.match(/try\s*\{/g) || []).length;
  assert.ok(tryBlocks >= 3, `expected >= 3 try blocks wrapping localStorage, got ${tryBlocks} for ${lsCalls} calls`);
});

/* ── 23-25: behavior via sandbox eval ─────────────────────────────── */
function makeEvalCtx(cfg) {
  /* Always merge over a full defaultConfig so every baked constant is
     defined — partial cfg in callers leaves volumes/thresholds undefined
     and crashes the lookup inside the emitted runtime. */
  const rt = emitAudioRuntime({ ...defaultConfig(), ...cfg, enabled: true });
  const stubBtn = { dataset: {}, textContent: '', addEventListener: () => {} };
  const stubDoc = {
    getElementById: () => stubBtn,
    addEventListener: () => {},
  };
  const stubLS = (function makeLS() {
    const store = Object.create(null);
    return {
      getItem(k) { return store[k] == null ? null : store[k]; },
      setItem(k, v) { store[k] = String(v); },
      _store: store,
    };
  })();
  const stubHookBus = {
    _handlers: {},
    _mult: 1,
    on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    emit(ev, payload) { (this._handlers[ev] || []).forEach(fn => fn(payload || {})); },
    getMult() { return this._mult; },
    setMult(v) { this._mult = v; },
  };
  /* Stub Audio that records play calls. */
  const playCalls = [];
  const StubAudio = function (url) {
    this.url = url;
    this.preload = '';
    this.volume = 1;
    this.playbackRate = 1;
    this.cloneNode = () => {
      const clone = { url, volume: 1, playbackRate: 1, play() { playCalls.push({ url: clone.url, volume: clone.volume }); return Promise.resolve(); } };
      return clone;
    };
    this.play = () => { playCalls.push({ url, volume: this.volume }); return Promise.resolve(); };
  };
  const stubWin = {};
  const ctxFn = new Function(
    'document', 'window', 'HookBus', 'localStorage', 'Audio', 'setTimeout',
    rt +
    `; return { audioPlay, audioToggleMuted, audioSetMuted, audioSetVolume, audioPreload, AUDIO_STATE, HookBus };`
  );
  const ctx = ctxFn(stubDoc, stubWin, stubHookBus, stubLS, StubAudio, (fn) => fn());
  ctx.playCalls = playCalls;
  ctx.localStorage = stubLS;
  return ctx;
}

t('runtime: audioPlay returns false when muted', () => {
  const ctx = makeEvalCtx({
    urls: { ...defaultConfig().urls, SPIN_START: 'spin.mp3' },
    muted: true,
  });
  const r = ctx.audioPlay('SPIN_START');
  assert.equal(r, false);
  assert.equal(ctx.playCalls.length, 0);
});

t('runtime: audioPlay returns false when URL unset for category', () => {
  const ctx = makeEvalCtx({ urls: defaultConfig().urls });
  const r = ctx.audioPlay('WIN_EPIC');
  assert.equal(r, false);
  assert.equal(ctx.playCalls.length, 0);
});

t('runtime: audioPlay succeeds when URL set + unmuted', () => {
  const ctx = makeEvalCtx({
    urls: { ...defaultConfig().urls, SPIN_START: 'spin.mp3' },
  });
  const r = ctx.audioPlay('SPIN_START');
  assert.equal(r, true);
  assert.equal(ctx.playCalls.length, 1);
  assert.equal(ctx.playCalls[0].url, 'spin.mp3');
});

t('runtime: postSpin selects WIN_EPIC tier when totalX >= epic', () => {
  const ctx = makeEvalCtx({
    urls: {
      ...defaultConfig().urls,
      WIN_BASE: 'base.mp3', WIN_BIG: 'big.mp3', WIN_MEGA: 'mega.mp3', WIN_EPIC: 'epic.mp3',
    },
    bigWinThresholdX: 10, megaWinThresholdX: 50, epicWinThresholdX: 250,
  });
  ctx.HookBus.emit('postSpin', { events: [{ payX: 300 }] });
  assert.equal(ctx.playCalls.length, 1);
  assert.equal(ctx.playCalls[0].url, 'epic.mp3');
});

t('runtime: postSpin selects WIN_BIG tier when totalX between big and mega', () => {
  const ctx = makeEvalCtx({
    urls: {
      ...defaultConfig().urls,
      WIN_BASE: 'base.mp3', WIN_BIG: 'big.mp3', WIN_MEGA: 'mega.mp3', WIN_EPIC: 'epic.mp3',
    },
    bigWinThresholdX: 10, megaWinThresholdX: 50, epicWinThresholdX: 250,
  });
  ctx.HookBus.emit('postSpin', { events: [{ payX: 20 }] });
  assert.equal(ctx.playCalls.length, 1);
  assert.equal(ctx.playCalls[0].url, 'big.mp3');
});

t('runtime: postSpin selects WIN_BASE tier for small win', () => {
  const ctx = makeEvalCtx({
    urls: {
      ...defaultConfig().urls,
      WIN_BASE: 'base.mp3', WIN_BIG: 'big.mp3',
    },
    bigWinThresholdX: 10, megaWinThresholdX: 50, epicWinThresholdX: 250,
  });
  ctx.HookBus.emit('postSpin', { events: [{ payX: 3 }] });
  assert.equal(ctx.playCalls.length, 1);
  assert.equal(ctx.playCalls[0].url, 'base.mp3');
});

t('runtime: postSpin plays nothing when totalX === 0', () => {
  const ctx = makeEvalCtx({
    urls: { ...defaultConfig().urls, WIN_BASE: 'base.mp3' },
  });
  ctx.HookBus.emit('postSpin', { events: [{ payX: 0 }] });
  assert.equal(ctx.playCalls.length, 0);
});

t('runtime: preSpin BASE plays SPIN_START, preSpin FS plays FS_SPIN_START', () => {
  const ctx = makeEvalCtx({
    urls: { ...defaultConfig().urls, SPIN_START: 'spin.mp3', FS_SPIN_START: 'fs.mp3' },
  });
  ctx.HookBus.emit('preSpin', { duringFs: false });
  ctx.HookBus.emit('preSpin', { duringFs: true });
  assert.equal(ctx.playCalls.length, 2);
  assert.equal(ctx.playCalls[0].url, 'spin.mp3');
  assert.equal(ctx.playCalls[1].url, 'fs.mp3');
});

t('runtime: audioToggleMuted persists to localStorage', () => {
  const ctx = makeEvalCtx({ urls: { ...defaultConfig().urls, SPIN_START: 'spin.mp3' } });
  assert.equal(ctx.AUDIO_STATE.muted, false);
  ctx.audioToggleMuted();
  assert.equal(ctx.AUDIO_STATE.muted, true);
  assert.equal(ctx.localStorage.getItem('slot.audio.muted'), 'true');
});

t('runtime: audioSetVolume clamps + persists', () => {
  const ctx = makeEvalCtx({ urls: { ...defaultConfig().urls, SPIN_START: 'spin.mp3' } });
  ctx.audioSetVolume(0.5);
  assert.equal(ctx.AUDIO_STATE.volume, 0.5);
  assert.equal(ctx.localStorage.getItem('slot.audio.volume'), '0.5');
  /* Invalid input ignored */
  ctx.audioSetVolume(2);
  assert.equal(ctx.AUDIO_STATE.volume, 0.5);
});

/* ── 26-29: hygiene ──────────────────────────────────────────────── */
t('determinism — emitter is pure (two calls byte-identical)', () => {
  const a = emitAudioRuntime({ ...defaultConfig(), enabled: true });
  const b = emitAudioRuntime({ ...defaultConfig(), enabled: true });
  assert.equal(a, b);
});

t('no game-specific names in emitted output (template rule)', () => {
  const cfg = { ...defaultConfig(), enabled: true };
  const all = emitAudioCSS(cfg) + emitAudioMarkup(cfg) + emitAudioRuntime(cfg);
  const banned = /(gates[- ]of[- ]olympus|wrath[- ]of[- ]olympus|crystal[- ]forge|midnight[- ]fangs|sweet[- ]bonanza|sugar[- ]rush|reactoonz|pragmatic|netent|microgaming|aristocrat|wazdan|howler\.js)/i;
  assert.ok(!banned.test(all), 'emitted output must be vendor-neutral');
});

t('AUDIO_CATEGORIES export matches runtime constant', () => {
  const rt = emitAudioRuntime({ ...defaultConfig(), enabled: true });
  for (const c of AUDIO_CATEGORIES) {
    assert.ok(rt.includes('"' + c + '"'), `category ${c} should appear in runtime`);
  }
  assert.equal(AUDIO_CATEGORIES.length, 15);
});

t('markup safe: cfg.toggleColor cannot inject CSS (validation in resolveConfig)', () => {
  /* Pass garbage toggleColor through resolveConfig — it should be
     rejected and CSS must contain only the default RGB triple. */
  const cfg = resolveConfig({ audio: { enabled: true, toggleColor: '255,255,255); evil:1; /*' } });
  const css = emitAudioCSS(cfg);
  assert.ok(!/evil/.test(css));
  assert.ok(/rgba\(255,255,255/.test(css));
});

if (fail > 0) {
  console.error(`\n✗ ${fail} test(s) failed in audio.test.mjs`);
  process.exit(1);
}
console.log(`\n✓ All audio tests passed`);
