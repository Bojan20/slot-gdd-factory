/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitStageBadgeCSS, emitStageBadgeMarkup, emitStageBadgeRuntime,
} from '../../src/blocks/stageBadge.mjs';
import { parseGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/stageBadge.mjs —');

t('defaultConfig: fresh + correct defaults', () => {
  const c = defaultConfig();
  eq(c.enabled, true); eq(c.baseLabel, 'BASE GAME'); eq(c.fsLabel, 'FREE SPINS');
  eq(c.gold, '255,214,110'); eq(c.pulseMs, 1600); eq(c.mobileBreakpoint, 620);
});

t('resolveConfig: enabled=false honored', () => {
  eq(resolveConfig({ stageBadge: { enabled: false } }).enabled, false);
});

t('resolveConfig: labels accepted, junk rejected', () => {
  eq(resolveConfig({ stageBadge: { baseLabel: 'PLAY' } }).baseLabel, 'PLAY');
  eq(resolveConfig({ stageBadge: { fsLabel: 'BONUS' } }).fsLabel, 'BONUS');
  eq(resolveConfig({ stageBadge: { baseLabel: '<script>' } }).baseLabel, 'BASE GAME');
  eq(resolveConfig({ stageBadge: { baseLabel: '' } }).baseLabel, 'BASE GAME');
});

t('resolveConfig: gold validation', () => {
  eq(resolveConfig({ stageBadge: { gold: '100,150,200' } }).gold, '100,150,200');
  eq(resolveConfig({ stageBadge: { gold: 'gold' } }).gold, '255,214,110');
  eq(resolveConfig({ stageBadge: { gold: '999,0,0' } }).gold, '255,214,110');
});

t('resolveConfig: pulseMs / mobileBreakpoint bounds', () => {
  eq(resolveConfig({ stageBadge: { pulseMs: 2000 } }).pulseMs, 2000);
  eq(resolveConfig({ stageBadge: { pulseMs: 50 } }).pulseMs, 1600);
  eq(resolveConfig({ stageBadge: { mobileBreakpoint: 768 } }).mobileBreakpoint, 768);
  eq(resolveConfig({ stageBadge: { mobileBreakpoint: 10 } }).mobileBreakpoint, 620);
});

t('emitStageBadgeCSS: enabled emits keyframes + classes', () => {
  const css = emitStageBadgeCSS();
  ct(css, '.stage-badge'); ct(css, '@keyframes stage-badge-pulse');
  ct(css, 'rgba(255,214,110'); ct(css, 'prefers-reduced-motion');
});

t('emitStageBadgeCSS: disabled emits no rules', () => {
  const css = emitStageBadgeCSS({ enabled: false });
  ok(!css.includes('.stage-badge {'), 'no .stage-badge rule when disabled');
});

t('emitStageBadgeCSS: bakes pulseMs literal', () => {
  ct(emitStageBadgeCSS({ pulseMs: 2400 }), 'stage-badge-pulse 2400ms');
});

t('emitStageBadgeMarkup: enabled emits pill html', () => {
  const html = emitStageBadgeMarkup();
  ct(html, 'id="stageBadge"'); ct(html, 'data-stage="base"');
  ct(html, 'aria-live="polite"'); ct(html, 'BASE GAME');
});

t('emitStageBadgeMarkup: HTML-escapes custom label', () => {
  /* unsafe label is rejected by resolveConfig — falls back to default */
  const html = emitStageBadgeMarkup({ baseLabel: '<x>' });
  ok(!html.includes('<x>'), 'unsafe label must not appear raw');
});

t('emitStageBadgeMarkup: disabled emits empty', () => {
  eq(emitStageBadgeMarkup({ enabled: false }), '');
});

t('emitStageBadgeRuntime: enabled emits setStageBadge function + labels', () => {
  const js = emitStageBadgeRuntime();
  ct(js, 'function setStageBadge(stage, label)');
  ct(js, 'getElementById(\'stageBadge\')');
  ct(js, 'STAGE_BASE_LABEL = "BASE GAME"');
  ct(js, 'STAGE_FS_LABEL   = "FREE SPINS"');
});

t('emitStageBadgeRuntime: disabled emits no-op stub', () => {
  const js = emitStageBadgeRuntime({ enabled: false });
  ct(js, 'disabled by GDD');
  ct(js, 'function setStageBadge() { /* no-op */ }');
});

t('parser: GDD without section → undefined slots', () => {
  const m = parseGDD('# G\n', 'md');
  eq(m.stageBadge.enabled, undefined);
  eq(m.stageBadge.baseLabel, undefined);
});

t('parser: full section → all knobs read', () => {
  const gdd = [
    '# G', '',
    '## Stage Badge',
    '- enabled: true',
    '- base-label: PLAY MODE',
    '- fs-label: BONUS ROUND',
    '- gold: 100,200,50',
    '- pulse-ms: 2200',
    '- mobile-breakpoint: 768',
    '',
  ].join('\n');
  const m = parseGDD(gdd, 'md');
  eq(m.stageBadge.enabled, true);
  eq(m.stageBadge.baseLabel, 'PLAY MODE');
  eq(m.stageBadge.fsLabel, 'BONUS ROUND');
  eq(m.stageBadge.gold, '100,200,50');
  eq(m.stageBadge.pulseMs, 2200);
  eq(m.stageBadge.mobileBreakpoint, 768);
});

t('parser → runtime roundtrip: labels reach STAGE_*_LABEL', () => {
  const gdd = '# G\n\n## Stage Badge\n- base-label: HOME\n- fs-label: FEATURE\n';
  const m = parseGDD(gdd, 'md');
  const js = emitStageBadgeRuntime(resolveConfig(m));
  ct(js, 'STAGE_BASE_LABEL = "HOME"');
  ct(js, 'STAGE_FS_LABEL   = "FEATURE"');
});

t('parser: phase-badge heading alias', () => {
  const m = parseGDD('# G\n\n## Phase Badge\n- enabled: false\n', 'md');
  eq(m.stageBadge.enabled, false);
});

console.log('');
if (fail > 0) { console.log(`  ${fail} test(s) failed.`); process.exit(1); }
else { console.log('  All tests passed.'); }
