/* eslint-disable no-console */
/**
 * rewardChest block unit tests — Wave W47.S16 / B74.
 *
 * Coverage strategy (every contract surface + every scenario):
 *   • defaultConfig stability + isolation + pool default shape
 *   • resolveConfig: enabled toggle, triggerMode whitelist, position
 *     whitelist, RGB color validation, numeric bounds (low/mid/high),
 *     special-symbol string sanity (length cap), boolean strict typing,
 *     pool normalization (drop malformed, cap weights, sanitize payload),
 *     feature auto-enable (4 kinds), explicit enabled:false override
 *   • CSS emit: disabled = empty; enabled = host + chest + lid + ring +
 *     label + 5 keyframes + prefers-reduced-motion guard + mobile rule;
 *     position-specific anchor styles
 *   • Markup emit: disabled = empty; enabled = id="rewardChest",
 *     role="status", aria-live="polite", aria-hidden, 4-node tree
 *   • Runtime emit: disabled = empty; enabled = IIFE + HookBus.on +
 *     reward picker + label formatter + 4-phase pipeline + emits
 *   • Trigger-mode dispatch: exactly one of onSpinResult / onBigWinTier /
 *     onFsEnd binding active per build (dead-branch elimination)
 *   • LEGO discipline: emits exactly onRewardChestOpen + onRewardChestClose
 *   • Vendor-neutral: no studio / game names anywhere
 *   • Accessibility: role=status + aria-live + RM hard-kill present
 *   • Determinism: same config → byte-identical CSS + Markup + Runtime
 */
import {
  defaultConfig,
  resolveConfig,
  emitRewardChestCSS,
  emitRewardChestMarkup,
  emitRewardChestRuntime,
} from '../../src/blocks/rewardChest.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/rewardChest.mjs');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const re  = (s, r, m = '') => { if (!r.test(String(s))) throw new Error(`regex miss ${r} — ${m}`); };

console.log('— blocks/rewardChest.mjs —');

/* ─── defaultConfig ───────────────────────────────────────────────── */
t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.triggerMode, 'special_symbol');
  eq(c.specialSymbol, 'CHEST');
  eq(c.minSpecials, 1);
  eq(c.bigWinMinTier, 2);
  eq(c.revealMs, 1600);
  eq(c.position, 'center');
  eq(c.chestColor, '198,140,46');
  eq(c.ringColor, '255,214,110');
  eq(c.haptic, false);
  eq(c.autoCloseMs, 1200);
  ok(Array.isArray(c.pool), 'pool array');
  eq(c.pool.length, 4, 'default pool length');
});

t('defaultConfig: returns isolated copy', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  a.enabled = true;
  a.revealMs = 9999;
  eq(b.enabled, false, 'mutation does not leak');
  eq(b.revealMs, 1600, 'mutation does not leak');
});

t('defaultConfig: default pool kinds are whitelisted', () => {
  const c = defaultConfig();
  const KINDS = new Set(['credits', 'multiplier', 'free_spins', 'mystery']);
  for (const entry of c.pool) {
    ok(KINDS.has(entry.kind), `pool kind ${entry.kind}`);
    ok(Number.isInteger(entry.weight) && entry.weight > 0, `weight ${entry.weight}`);
    ok(entry.payload && typeof entry.payload === 'object', 'payload object');
  }
});

/* ─── resolveConfig: enable + triggerMode ─────────────────────────── */
t('resolveConfig: explicit enabled:true wins', () => {
  const c = resolveConfig({ rewardChest: { enabled: true } });
  eq(c.enabled, true);
});

t('resolveConfig: explicit enabled:false wins', () => {
  const c = resolveConfig({ rewardChest: { enabled: false } });
  eq(c.enabled, false);
});

t('resolveConfig: triggerMode whitelist — accepts all 4', () => {
  for (const m of ['special_symbol', 'big_win', 'bonus_complete', 'fs_end']) {
    const c = resolveConfig({ rewardChest: { enabled: true, triggerMode: m } });
    eq(c.triggerMode, m, `accept ${m}`);
  }
});

t('resolveConfig: triggerMode INVALID falls back to default', () => {
  const c = resolveConfig({ rewardChest: { enabled: true, triggerMode: 'totally-bogus' } });
  eq(c.triggerMode, 'special_symbol');
});

t('resolveConfig: position whitelist — accepts all 3', () => {
  for (const p of ['top-center', 'center', 'bottom-center']) {
    const c = resolveConfig({ rewardChest: { enabled: true, position: p } });
    eq(c.position, p);
  }
});

t('resolveConfig: position INVALID falls back to center', () => {
  const c = resolveConfig({ rewardChest: { enabled: true, position: 'sideways' } });
  eq(c.position, 'center');
});

/* ─── resolveConfig: numeric bounds ───────────────────────────────── */
t('resolveConfig: minSpecials low/mid/high accepted', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, minSpecials: 1 } }).minSpecials, 1);
  eq(resolveConfig({ rewardChest: { enabled: true, minSpecials: 5 } }).minSpecials, 5);
  eq(resolveConfig({ rewardChest: { enabled: true, minSpecials: 50 } }).minSpecials, 50);
});

t('resolveConfig: minSpecials out-of-bounds rejected', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, minSpecials: 0 } }).minSpecials, 1, 'low');
  eq(resolveConfig({ rewardChest: { enabled: true, minSpecials: 9999 } }).minSpecials, 1, 'high');
  eq(resolveConfig({ rewardChest: { enabled: true, minSpecials: 'two' } }).minSpecials, 1, 'string');
});

t('resolveConfig: bigWinMinTier bounds', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, bigWinMinTier: 1 } }).bigWinMinTier, 1);
  eq(resolveConfig({ rewardChest: { enabled: true, bigWinMinTier: 10 } }).bigWinMinTier, 10);
  eq(resolveConfig({ rewardChest: { enabled: true, bigWinMinTier: 99 } }).bigWinMinTier, 2, 'high reject');
});

t('resolveConfig: revealMs bounds', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, revealMs: 400 } }).revealMs, 400);
  eq(resolveConfig({ rewardChest: { enabled: true, revealMs: 3000 } }).revealMs, 3000);
  eq(resolveConfig({ rewardChest: { enabled: true, revealMs: 99999 } }).revealMs, 1600, 'high reject');
  eq(resolveConfig({ rewardChest: { enabled: true, revealMs: 50 } }).revealMs, 1600, 'low reject');
});

t('resolveConfig: autoCloseMs bounds', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, autoCloseMs: 200 } }).autoCloseMs, 200);
  eq(resolveConfig({ rewardChest: { enabled: true, autoCloseMs: 10000 } }).autoCloseMs, 10000);
  eq(resolveConfig({ rewardChest: { enabled: true, autoCloseMs: 50 } }).autoCloseMs, 1200, 'low reject');
  eq(resolveConfig({ rewardChest: { enabled: true, autoCloseMs: 99999 } }).autoCloseMs, 1200, 'high reject');
});

/* ─── resolveConfig: strings + colors ─────────────────────────────── */
t('resolveConfig: specialSymbol accepted (≤32 chars)', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, specialSymbol: 'WILD' } }).specialSymbol, 'WILD');
  eq(resolveConfig({ rewardChest: { enabled: true, specialSymbol: 'BONUS_X' } }).specialSymbol, 'BONUS_X');
});

t('resolveConfig: specialSymbol empty/long/wrong-type rejected', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, specialSymbol: '' } }).specialSymbol, 'CHEST', 'empty');
  const tooLong = 'X'.repeat(33);
  eq(resolveConfig({ rewardChest: { enabled: true, specialSymbol: tooLong } }).specialSymbol, 'CHEST', 'over cap');
  eq(resolveConfig({ rewardChest: { enabled: true, specialSymbol: 42 } }).specialSymbol, 'CHEST', 'number');
});

t('resolveConfig: chestColor RGB validation', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, chestColor: '100,150,200' } }).chestColor, '100,150,200');
  eq(resolveConfig({ rewardChest: { enabled: true, chestColor: 'red' } }).chestColor, '198,140,46', 'non-rgb rejected');
  eq(resolveConfig({ rewardChest: { enabled: true, chestColor: '256,0,0' } }).chestColor, '198,140,46', 'over-255 rejected');
  eq(resolveConfig({ rewardChest: { enabled: true, chestColor: '1,2' } }).chestColor, '198,140,46', 'wrong arity rejected');
});

t('resolveConfig: ringColor RGB validation', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, ringColor: '12,34,56' } }).ringColor, '12,34,56');
  eq(resolveConfig({ rewardChest: { enabled: true, ringColor: 'gold' } }).ringColor, '255,214,110');
});

t('resolveConfig: haptic strict boolean', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, haptic: true } }).haptic, true);
  eq(resolveConfig({ rewardChest: { enabled: true, haptic: false } }).haptic, false);
  eq(resolveConfig({ rewardChest: { enabled: true, haptic: 'true' } }).haptic, false, 'string ignored');
  eq(resolveConfig({ rewardChest: { enabled: true, haptic: 1 } }).haptic, false, 'number ignored');
});

/* ─── resolveConfig: pool normalization ───────────────────────────── */
t('resolveConfig: explicit pool replaces default', () => {
  const c = resolveConfig({ rewardChest: { enabled: true, pool: [
    { kind: 'credits', weight: 80, payload: { amountX: 5 } },
    { kind: 'multiplier', weight: 20, payload: { mult: 3 } },
  ] } });
  eq(c.pool.length, 2);
  eq(c.pool[0].kind, 'credits');
  eq(c.pool[0].weight, 80);
  eq(c.pool[0].payload.amountX, 5);
});

t('resolveConfig: pool drops malformed entries', () => {
  const c = resolveConfig({ rewardChest: { enabled: true, pool: [
    { kind: 'credits', weight: 10 },              // ok
    { kind: 'unknown-kind', weight: 50 },         // dropped (kind off whitelist)
    { kind: 'multiplier', weight: 'abc' },        // dropped (non-numeric)
    { kind: 'free_spins', weight: -5 },           // dropped (≤ 0)
    null,                                         // dropped
    'string-entry',                               // dropped
  ] } });
  eq(c.pool.length, 1, 'only valid kept');
  eq(c.pool[0].kind, 'credits');
});

t('resolveConfig: pool weight clamped to [1,1000] integer', () => {
  const c = resolveConfig({ rewardChest: { enabled: true, pool: [
    { kind: 'credits', weight: 99999 },
    { kind: 'mystery', weight: 0.4 },      // floor→0 then max(1)→1 — kept
    { kind: 'free_spins', weight: -3 },    // ≤0 → dropped
    { kind: 'multiplier', weight: NaN },   // non-finite → dropped
  ] } });
  eq(c.pool.length, 2, 'two valid kept');
  eq(c.pool[0].weight, 1000, 'capped high');
  eq(c.pool[1].weight, 1,    'fractional clamped up to floor 1');
});

t('resolveConfig: pool sanitizes payload (primitives + key length)', () => {
  const c = resolveConfig({ rewardChest: { enabled: true, pool: [
    { kind: 'credits', weight: 10, payload: {
      amountX: 7,
      label: 'ok',
      bigKey_______________________________________: 'too long key',
      fn: () => {},
      obj: { nested: true },
    } },
  ] } });
  eq(c.pool[0].payload.amountX, 7);
  eq(c.pool[0].payload.label, 'ok');
  ok(c.pool[0].payload.fn === undefined, 'fn dropped');
  ok(c.pool[0].payload.obj === undefined, 'nested obj dropped');
});

t('resolveConfig: empty/malformed pool falls back to default', () => {
  eq(resolveConfig({ rewardChest: { enabled: true, pool: [] } }).pool.length, 4, 'empty falls back');
  eq(resolveConfig({ rewardChest: { enabled: true, pool: null } }).pool.length, 4, 'null falls back');
  eq(resolveConfig({ rewardChest: { enabled: true, pool: 'wat' } }).pool.length, 4, 'string falls back');
});

/* ─── resolveConfig: feature auto-enable ──────────────────────────── */
t('feature auto-enable: reward_chest', () => {
  const c = resolveConfig({ features: [{ kind: 'reward_chest' }] });
  eq(c.enabled, true);
});
t('feature auto-enable: treasure_chest', () => {
  const c = resolveConfig({ features: [{ kind: 'treasure_chest' }] });
  eq(c.enabled, true);
});
t('feature auto-enable: loot_chest', () => {
  const c = resolveConfig({ features: [{ kind: 'loot_chest' }] });
  eq(c.enabled, true);
});
t('feature auto-enable: bonus_chest', () => {
  const c = resolveConfig({ features: [{ kind: 'bonus_chest' }] });
  eq(c.enabled, true);
});
t('feature explicit enabled:false poništava auto-enable', () => {
  const c = resolveConfig({
    features: [{ kind: 'reward_chest' }],
    rewardChest: { enabled: false },
  });
  eq(c.enabled, false);
});
t('no feature, no flag → stays disabled', () => {
  const c = resolveConfig({});
  eq(c.enabled, false);
});

/* ─── CSS emit ────────────────────────────────────────────────────── */
t('CSS disabled = empty string', () => {
  eq(emitRewardChestCSS(defaultConfig()), '');
});

t('CSS enabled = full block with chest + ring + lid + label', () => {
  const css = emitRewardChestCSS(resolveConfig({ rewardChest: { enabled: true } }));
  ok(css.length > 800, 'css non-empty');
  ct(css, '.reward-chest', 'host');
  ct(css, '.rc-chest',     'chest');
  ct(css, '.rc-lid',       'lid');
  ct(css, '.rc-ring',      'ring');
  ct(css, '.rc-label',     'label');
  ct(css, '@keyframes rcEnter',  'enter kf');
  ct(css, '@keyframes rcShake',  'shake kf');
  ct(css, '@keyframes rcRing',   'ring kf');
  ct(css, '@keyframes rcLabel',  'label kf');
  ct(css, '@keyframes rcExit',   'exit kf');
  ct(css, 'prefers-reduced-motion', 'rm guard');
  ct(css, 'max-width: 480px',       'mobile rule');
});

t('CSS position variants emit distinct anchors', () => {
  const top    = emitRewardChestCSS(resolveConfig({ rewardChest: { enabled: true, position: 'top-center' } }));
  const center = emitRewardChestCSS(resolveConfig({ rewardChest: { enabled: true, position: 'center' } }));
  const bottom = emitRewardChestCSS(resolveConfig({ rewardChest: { enabled: true, position: 'bottom-center' } }));
  re(top,    /top:\s*12%/,    'top anchor');
  re(center, /top:\s*50%/,    'center anchor');
  re(bottom, /bottom:\s*16%/, 'bottom anchor');
});

t('CSS chestColor + ringColor flow into rules', () => {
  const css = emitRewardChestCSS(resolveConfig({ rewardChest: { enabled: true, chestColor: '11,22,33', ringColor: '44,55,66' } }));
  ct(css, '11,22,33', 'chest color in');
  ct(css, '44,55,66', 'ring color in');
});

t('CSS reveal animation duration honours autoCloseMs', () => {
  const css = emitRewardChestCSS(resolveConfig({ rewardChest: { enabled: true, autoCloseMs: 2000 } }));
  /* phase reveal hold = max(200, autoCloseMs - 200) → 1800ms. */
  ct(css, 'rcHold  1800ms', 'reveal duration baked');
});

/* ─── Markup emit ────────────────────────────────────────────────── */
t('markup disabled = empty', () => {
  eq(emitRewardChestMarkup(defaultConfig()), '');
});

t('markup enabled = host element with role/aria', () => {
  const m = emitRewardChestMarkup(resolveConfig({ rewardChest: { enabled: true } }));
  ct(m, 'id="rewardChest"',     'id');
  ct(m, 'role="status"',        'role');
  ct(m, 'aria-live="polite"',   'aria-live');
  ct(m, 'aria-label="Reward chest"', 'aria-label');
  ct(m, 'data-active="false"',  'starts inactive');
  ct(m, 'data-phase=""',        'no phase');
  ct(m, 'aria-hidden="true"',   'hidden initially');
  ct(m, 'class="rc-ring"',      'ring node');
  ct(m, 'class="rc-chest"',     'chest node');
  ct(m, 'class="rc-lid"',       'lid node');
  ct(m, 'class="rc-label"',     'label node');
});

/* ─── Runtime emit ───────────────────────────────────────────────── */
t('runtime disabled = empty', () => {
  eq(emitRewardChestRuntime(defaultConfig()), '');
});

t('runtime enabled = IIFE + emits + binding', () => {
  const r = emitRewardChestRuntime(resolveConfig({ rewardChest: { enabled: true } }));
  ok(r.length > 1200, 'runtime non-empty');
  ct(r, '(function _rewardChestRuntime()', 'IIFE');
  ct(r, 'getElementById(\'rewardChest\')', 'DOM lookup');
  ct(r, 'HookBus.emit(\'onRewardChestOpen\'',  'emit open');
  ct(r, 'HookBus.emit(\'onRewardChestClose\'', 'emit close');
  ct(r, 'HookBus.on(\'onSpinResult\'', 'default trigger binding');
  ct(r, 'window.fireRewardChest',      'public entry');
  ct(r, 'Math.random()',               'weighted pick');
});

t('runtime: trigger=big_win binds onBigWinTier (and ONLY that)', () => {
  const r = emitRewardChestRuntime(resolveConfig({ rewardChest: { enabled: true, triggerMode: 'big_win' } }));
  ct(r,  "HookBus.on('onBigWinTierEntered'", 'big_win binding');
  nct(r, "HookBus.on('onSpinResult'", 'no other binding');
  nct(r, "HookBus.on('onFsEnd'",      'no other binding');
});

t('runtime: trigger=fs_end binds onFsEnd (and ONLY that)', () => {
  const r = emitRewardChestRuntime(resolveConfig({ rewardChest: { enabled: true, triggerMode: 'fs_end' } }));
  ct(r,  "HookBus.on('onFsEnd'",      'fs_end binding');
  nct(r, "HookBus.on('onSpinResult'", 'no other binding');
  nct(r, "HookBus.on('onBigWinTierEntered'", 'no other binding');
});

t('runtime: trigger=bonus_complete binds onFsEnd via bonus_complete source tag', () => {
  const r = emitRewardChestRuntime(resolveConfig({ rewardChest: { enabled: true, triggerMode: 'bonus_complete' } }));
  ct(r, "HookBus.on('onFsEnd'", 'binding present');
  ct(r, "source: 'bonus_complete'", 'source tagged distinctly from fs_end');
});

t('runtime: trigger=special_symbol binds onSpinResult and checks specialSymbol map', () => {
  const r = emitRewardChestRuntime(resolveConfig({ rewardChest: { enabled: true, triggerMode: 'special_symbol', specialSymbol: 'WILD', minSpecials: 3 } }));
  ct(r, "HookBus.on('onSpinResult'", 'binding present');
  ct(r, '"specialSymbol":"WILD"',     'symbol baked');
  ct(r, '"minSpecials":3',            'min baked');
});

t('runtime bakes pool literal', () => {
  const r = emitRewardChestRuntime(resolveConfig({ rewardChest: { enabled: true, pool: [
    { kind: 'credits', weight: 70, payload: { amountX: 5 } },
    { kind: 'mystery', weight: 30, payload: { tier: 2 } },
  ] } }));
  ct(r, '"kind":"credits"',  'credits in pool');
  ct(r, '"kind":"mystery"',  'mystery in pool');
  ct(r, '"weight":70',       'weight 70');
  ct(r, '"weight":30',       'weight 30');
});

t('runtime emits open BEFORE close in source order', () => {
  const r = emitRewardChestRuntime(resolveConfig({ rewardChest: { enabled: true } }));
  const iOpen  = r.indexOf("HookBus.emit('onRewardChestOpen'");
  const iClose = r.indexOf("HookBus.emit('onRewardChestClose'");
  ok(iOpen > -1 && iClose > -1, 'both present');
  ok(iOpen < iClose, 'open before close in pipeline');
});

/* ─── Determinism ────────────────────────────────────────────────── */
t('determinism: byte-identical CSS for same config', () => {
  const m = { rewardChest: { enabled: true, position: 'bottom-center', revealMs: 1800 } };
  eq(emitRewardChestCSS(resolveConfig(m)), emitRewardChestCSS(resolveConfig(m)));
});

t('determinism: byte-identical Markup for same config', () => {
  const m = { rewardChest: { enabled: true } };
  eq(emitRewardChestMarkup(resolveConfig(m)), emitRewardChestMarkup(resolveConfig(m)));
});

t('determinism: byte-identical Runtime for same config', () => {
  const m = { rewardChest: { enabled: true, triggerMode: 'big_win', bigWinMinTier: 4 } };
  eq(emitRewardChestRuntime(resolveConfig(m)), emitRewardChestRuntime(resolveConfig(m)));
});

/* ─── Vendor-neutral source scan ─────────────────────────────────── */
t('source: vendor-neutral (no studio / game / engine names)', () => {
  const src = readFileSync(SRC_PATH, 'utf8').toLowerCase();
  const BANNED = [
    'gates of olympus', 'wrath of olympus', 'reactoonz',
    'sweet bonanza', 'sugar rush', 'megaways', 'netent',
    'microgaming', 'pragmatic', 'lightning-link', 'cleopatra',
    'buffalo', 'igt', 'cash eruption',
  ];
  for (const v of BANNED) {
    if (src.includes(v)) throw new Error(`vendor leak: ${v}`);
  }
});

/* ─── Final tally ────────────────────────────────────────────────── */
console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
