/* eslint-disable no-console */
/**
 * symbolStackCollapse block unit tests — Wave W47.S18 / B75.
 *
 * Coverage:
 *   • defaultConfig stability + isolation
 *   • resolveConfig: enabled toggle, triggerMode whitelist, RGB color
 *     validation, numeric bounds (low/mid/high), boolean strict typing,
 *     labelTemplate string sanity, auto-enable on cascade / tumble /
 *     feature kinds, explicit enabled:false override
 *   • CSS emit: disabled = empty; enabled = host + flash + label rules
 *     + 2 keyframes + prefers-reduced-motion guard + mobile rule
 *   • Markup emit: disabled = empty; enabled = id, role=status,
 *     aria-live, aria-hidden, 2-child tree
 *   • Runtime emit: disabled = empty; enabled = IIFE + HookBus.on +
 *     emit owners + groupByReel helper + per-mode threshold check
 *   • Trigger-mode dispatch: exactly one threshold-check fragment baked
 *     per build (dead-branch elimination)
 *   • LEGO discipline: emits exactly onStackCollapseStart +
 *     onStackCollapseEnd
 *   • Vendor-neutral: no studio / game names anywhere
 *   • Accessibility: role=status + aria-live + RM hard-kill present
 *   • Determinism: same config → byte-identical CSS + Markup + Runtime
 */
import {
  defaultConfig,
  resolveConfig,
  emitSymbolStackCollapseCSS,
  emitSymbolStackCollapseMarkup,
  emitSymbolStackCollapseRuntime,
} from '../../src/blocks/symbolStackCollapse.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/symbolStackCollapse.mjs');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/symbolStackCollapse.mjs —');

/* ─── defaultConfig ───────────────────────────────────────────────── */
t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.triggerMode, 'same_symbol');
  eq(c.minStackHeight, 3);
  eq(c.minClearCount, 6);
  eq(c.durationMs, 1200);
  eq(c.autoCloseMs, 400);
  eq(c.flashColor, '255,235,150');
  eq(c.accentColor, '255,200,80');
  eq(c.showLabel, true);
  eq(c.labelTemplate, '+{N} {S}');
  eq(c.haptic, false);
});

t('defaultConfig: returns isolated frozen copy', () => {
  /* UQ-DEEP-AM FIX-3: top-level frozen; isolation by identity. */
  const a = defaultConfig();
  const b = defaultConfig();
  eq(Object.isFrozen(a), true);
  eq(Object.isFrozen(b), true);
  eq(a !== b, true);
  eq(a.enabled, b.enabled);
  eq(a.durationMs, b.durationMs);
});

/* ─── resolveConfig: enable + triggerMode ─────────────────────────── */
t('resolveConfig: explicit enabled:true wins', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true } }).enabled, true);
});
t('resolveConfig: explicit enabled:false wins', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: false } }).enabled, false);
});

t('resolveConfig: triggerMode whitelist (3)', () => {
  for (const m of ['same_symbol', 'full_column', 'any_clear']) {
    eq(resolveConfig({ symbolStackCollapse: { enabled: true, triggerMode: m } }).triggerMode, m);
  }
});
t('resolveConfig: triggerMode INVALID falls back', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, triggerMode: 'bogus' } }).triggerMode, 'same_symbol');
});

/* ─── resolveConfig: numeric bounds ───────────────────────────────── */
t('resolveConfig: minStackHeight low/mid/high accepted', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minStackHeight: 2 } }).minStackHeight, 2);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minStackHeight: 7 } }).minStackHeight, 7);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minStackHeight: 12 } }).minStackHeight, 12);
});
t('resolveConfig: minStackHeight out-of-bounds rejected', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minStackHeight: 1 } }).minStackHeight, 3, 'low');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minStackHeight: 9999 } }).minStackHeight, 3, 'high');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minStackHeight: 'three' } }).minStackHeight, 3, 'string');
});

t('resolveConfig: minClearCount bounds', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minClearCount: 2 } }).minClearCount, 2);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minClearCount: 99 } }).minClearCount, 99);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, minClearCount: 100 } }).minClearCount, 6, 'over cap');
});

t('resolveConfig: durationMs bounds', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, durationMs: 300 } }).durationMs, 300);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, durationMs: 6000 } }).durationMs, 6000);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, durationMs: 50 } }).durationMs, 1200, 'low reject');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, durationMs: 99999 } }).durationMs, 1200, 'high reject');
});

t('resolveConfig: autoCloseMs bounds', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, autoCloseMs: 100 } }).autoCloseMs, 100);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, autoCloseMs: 4000 } }).autoCloseMs, 4000);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, autoCloseMs: 50 } }).autoCloseMs, 400, 'low reject');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, autoCloseMs: 99999 } }).autoCloseMs, 400, 'high reject');
});

/* ─── resolveConfig: colors + booleans + template ─────────────────── */
t('resolveConfig: flashColor RGB validation', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, flashColor: '12,34,56' } }).flashColor, '12,34,56');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, flashColor: 'gold' } }).flashColor, '255,235,150');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, flashColor: '256,0,0' } }).flashColor, '255,235,150', 'over-255 reject');
});

t('resolveConfig: accentColor RGB validation', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, accentColor: '10,20,30' } }).accentColor, '10,20,30');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, accentColor: 'red' } }).accentColor, '255,200,80');
});

t('resolveConfig: haptic + showLabel strict boolean', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, haptic: true } }).haptic, true);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, haptic: 'yes' } }).haptic, false, 'truthy string ignored');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, showLabel: false } }).showLabel, false);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, showLabel: 1 } }).showLabel, true, 'numeric ignored');
});

t('resolveConfig: labelTemplate accepted within length cap', () => {
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, labelTemplate: '★ {N} ★' } }).labelTemplate, '★ {N} ★');
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, labelTemplate: '' } }).labelTemplate, '+{N} {S}', 'empty rejected');
  const tooLong = 'X'.repeat(49);
  eq(resolveConfig({ symbolStackCollapse: { enabled: true, labelTemplate: tooLong } }).labelTemplate, '+{N} {S}', 'over cap rejected');
});

/* ─── resolveConfig: auto-enable ──────────────────────────────────── */
t('auto-enable: stack_collapse feature kind', () => {
  eq(resolveConfig({ features: [{ kind: 'stack_collapse' }] }).enabled, true);
});
t('auto-enable: mega_collapse feature kind', () => {
  eq(resolveConfig({ features: [{ kind: 'mega_collapse' }] }).enabled, true);
});
t('auto-enable: full_reel_burst feature kind', () => {
  eq(resolveConfig({ features: [{ kind: 'full_reel_burst' }] }).enabled, true);
});
t('auto-enable: symbol_stack feature kind', () => {
  eq(resolveConfig({ features: [{ kind: 'symbol_stack' }] }).enabled, true);
});
t('auto-enable: model.tumble.enabled', () => {
  eq(resolveConfig({ tumble: { enabled: true } }).enabled, true);
});
t('auto-enable: model.topology.cascade.enabled', () => {
  eq(resolveConfig({ topology: { cascade: { enabled: true } } }).enabled, true);
});
t('explicit enabled:false overrides auto', () => {
  const c = resolveConfig({
    features: [{ kind: 'stack_collapse' }],
    symbolStackCollapse: { enabled: false },
  });
  eq(c.enabled, false);
});
t('no feature + no cascade + no flag → stays disabled', () => {
  eq(resolveConfig({}).enabled, false);
});

/* ─── CSS emit ────────────────────────────────────────────────────── */
t('CSS disabled = empty', () => {
  eq(emitSymbolStackCollapseCSS(defaultConfig()), '');
});

t('CSS enabled = host + flash + label + keyframes + RM + mobile', () => {
  const css = emitSymbolStackCollapseCSS(resolveConfig({ symbolStackCollapse: { enabled: true } }));
  ok(css.length > 500, 'css non-empty');
  ct(css, '.stack-collapse',             'host class');
  ct(css, '.sc-flash',                   'flash');
  ct(css, '.sc-label',                   'label');
  ct(css, '@keyframes scFlash',          'flash kf');
  ct(css, '@keyframes scLabel',          'label kf');
  ct(css, 'prefers-reduced-motion',      'rm guard');
  ct(css, 'max-width: 480px',            'mobile rule');
});

t('CSS flashColor + accentColor flow into rules', () => {
  const css = emitSymbolStackCollapseCSS(resolveConfig({ symbolStackCollapse: { enabled: true, flashColor: '11,22,33', accentColor: '44,55,66' } }));
  ct(css, '11,22,33', 'flash color in');
  ct(css, '44,55,66', 'accent color in');
});

t('CSS duration honours durationMs', () => {
  const css = emitSymbolStackCollapseCSS(resolveConfig({ symbolStackCollapse: { enabled: true, durationMs: 2000 } }));
  ct(css, 'animation: scFlash 2000ms', 'scFlash duration baked');
});

/* ─── Markup emit ────────────────────────────────────────────────── */
t('markup disabled = empty', () => {
  eq(emitSymbolStackCollapseMarkup(defaultConfig()), '');
});

t('markup enabled = host + ARIA + child tree', () => {
  const m = emitSymbolStackCollapseMarkup(resolveConfig({ symbolStackCollapse: { enabled: true } }));
  ct(m, 'id="symbolStackCollapse"',     'id');
  ct(m, 'role="status"',                'role');
  ct(m, 'aria-live="polite"',           'aria-live');
  ct(m, 'aria-label="Symbol stack collapse"', 'initial aria-label');
  ct(m, 'aria-hidden="true"',           'hidden initially');
  ct(m, 'data-active="false"',          'starts inactive');
  ct(m, 'class="sc-flash"',             'flash node');
  ct(m, 'class="sc-label"',             'label node');
});

/* ─── Runtime emit ───────────────────────────────────────────────── */
t('runtime disabled = empty', () => {
  eq(emitSymbolStackCollapseRuntime(defaultConfig()), '');
});

t('runtime enabled = IIFE + HookBus.on(onTumbleStep) + emits', () => {
  const r = emitSymbolStackCollapseRuntime(resolveConfig({ symbolStackCollapse: { enabled: true } }));
  ok(r.length > 1500, 'runtime non-empty');
  ct(r, '(function _stackCollapseRuntime()',  'IIFE');
  ct(r, "HookBus.on('onTumbleStep'",           'binding');
  ct(r, "HookBus.emit('onStackCollapseStart'", 'emit start');
  ct(r, "HookBus.emit('onStackCollapseEnd'",   'emit end');
  ct(r, 'window.fireSymbolStackCollapse',      'public entry');
  ct(r, '_scGroupByReel',                      'group helper');
});

t('runtime: triggerMode=same_symbol bakes minStackHeight check', () => {
  const r = emitSymbolStackCollapseRuntime(resolveConfig({ symbolStackCollapse: { enabled: true, triggerMode: 'same_symbol', minStackHeight: 4 } }));
  ct(r,  '"triggerMode":"same_symbol"', 'mode literal');
  ct(r,  '"minStackHeight":4',          'min height baked');
  ct(r,  'perReel[i].count >= SC_CFG.minStackHeight', 'same-symbol check fragment');
  nct(r, 'cleared.length < SC_CFG.minClearCount',     'no any_clear branch');
});

t('runtime: triggerMode=full_column bakes full-column check', () => {
  const r = emitSymbolStackCollapseRuntime(resolveConfig({ symbolStackCollapse: { enabled: true, triggerMode: 'full_column' } }));
  ct(r,  'r.full === true',                            'full-column predicate');
  ct(r,  'r.count >= r.rowSpan',                       'row-span equality');
  nct(r, 'cleared.length < SC_CFG.minClearCount',      'no any_clear branch');
});

t('runtime: triggerMode=any_clear bakes total-count check', () => {
  const r = emitSymbolStackCollapseRuntime(resolveConfig({ symbolStackCollapse: { enabled: true, triggerMode: 'any_clear', minClearCount: 8 } }));
  ct(r,  '"minClearCount":8',                          'min-count baked');
  ct(r,  'cleared.length < SC_CFG.minClearCount',      'any_clear gate');
  nct(r, 'perReel[i].count >= SC_CFG.minStackHeight',  'no same_symbol gate');
});

t('runtime bakes label template + showLabel', () => {
  const r = emitSymbolStackCollapseRuntime(resolveConfig({ symbolStackCollapse: { enabled: true, labelTemplate: 'COMBO {N}', showLabel: true } }));
  ct(r, '"COMBO {N}"', 'template baked');
  ct(r, 'SC_SHOW_LABEL   = true', 'showLabel literal');
});

t('runtime: showLabel=false bakes literal false', () => {
  const r = emitSymbolStackCollapseRuntime(resolveConfig({ symbolStackCollapse: { enabled: true, showLabel: false } }));
  ct(r, 'SC_SHOW_LABEL   = false', 'showLabel false');
});

t('runtime: start emit precedes end emit in source order', () => {
  const r = emitSymbolStackCollapseRuntime(resolveConfig({ symbolStackCollapse: { enabled: true } }));
  const iStart = r.indexOf("HookBus.emit('onStackCollapseStart'");
  const iEnd   = r.indexOf("HookBus.emit('onStackCollapseEnd'");
  ok(iStart > -1 && iEnd > -1, 'both present');
  ok(iStart < iEnd, 'start before end');
});

/* ─── Determinism ────────────────────────────────────────────────── */
t('determinism: byte-identical CSS for same config', () => {
  const m = { symbolStackCollapse: { enabled: true, durationMs: 1800 } };
  eq(emitSymbolStackCollapseCSS(resolveConfig(m)), emitSymbolStackCollapseCSS(resolveConfig(m)));
});
t('determinism: byte-identical Markup', () => {
  const m = { symbolStackCollapse: { enabled: true } };
  eq(emitSymbolStackCollapseMarkup(resolveConfig(m)), emitSymbolStackCollapseMarkup(resolveConfig(m)));
});
t('determinism: byte-identical Runtime', () => {
  const m = { symbolStackCollapse: { enabled: true, triggerMode: 'full_column' } };
  eq(emitSymbolStackCollapseRuntime(resolveConfig(m)), emitSymbolStackCollapseRuntime(resolveConfig(m)));
});

/* ─── Vendor-neutral ─────────────────────────────────────────────── */
t('source: vendor-neutral', () => {
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

console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
