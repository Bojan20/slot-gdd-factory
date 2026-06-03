/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig,
  emitFreeSpinsCSS,
  emitFreeSpinsHudMarkup,
  emitFreeSpinsToastMarkup,
  emitFreeSpinsOverlayMarkup,
  emitFreeSpinsRuntime,
} from '../../src/blocks/freeSpins.mjs';
import { parseGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/freeSpins.mjs —');

t('defaultConfig: standard cabinet defaults', () => {
  const c = defaultConfig();
  eq(c.enabled, true);
  eq(c.introLabel, 'FREE SPINS');
  eq(c.outroLabel, 'FREE SPINS COMPLETE');
  eq(c.totalWinLabel, 'TOTAL WIN');
  eq(c.fadeMs, 320);
  eq(c.enterActiveDelayMs, 420);
  eq(c.spinBreathMs, 250);
  eq(c.toastMs, 1800);
  eq(c.retriggerToastMs, 1600);
});

t('resolveConfig: enabled=false honored', () => {
  eq(resolveConfig({ freeSpinsPresentation: { enabled: false } }).enabled, false);
});

t('resolveConfig: labels accepted', () => {
  const c = resolveConfig({ freeSpinsPresentation: {
    introLabel: 'BONUS ROUND', outroLabel: 'BONUS COMPLETE',
    introCta: 'GO!', outroCta: 'EXIT', introSub: 'Round starts now.',
  }});
  eq(c.introLabel, 'BONUS ROUND');
  eq(c.outroLabel, 'BONUS COMPLETE');
  eq(c.introCta, 'GO!');
  eq(c.outroCta, 'EXIT');
  eq(c.introSub, 'Round starts now.');
});

t('resolveConfig: dangerous labels rejected', () => {
  const c = resolveConfig({ freeSpinsPresentation: {
    introLabel: '<script>alert(1)</script>',
  }});
  eq(c.introLabel, 'FREE SPINS');  /* fallback */
});

t('resolveConfig: ms knobs bounded', () => {
  const c = resolveConfig({ freeSpinsPresentation: {
    fadeMs: 500, enterActiveDelayMs: 1000, toastMs: 2400,
  }});
  eq(c.fadeMs, 500);
  eq(c.enterActiveDelayMs, 1000);
  eq(c.toastMs, 2400);
  /* out-of-bounds */
  eq(resolveConfig({ freeSpinsPresentation: { fadeMs: 99999 } }).fadeMs, 320);
  eq(resolveConfig({ freeSpinsPresentation: { fadeMs: 50 } }).fadeMs, 320);
});

/* ── CSS emitter ─────────────────────────────────────────────────────── */

t('emitFreeSpinsCSS: includes all 3 layers + body fs-mode-*', () => {
  const css = emitFreeSpinsCSS();
  ct(css, '.fs-hud');
  ct(css, '.fs-toast');
  ct(css, '.fs-overlay');
  ct(css, '.fs-placard');
  ct(css, 'body.fs-mode-purple');
  ct(css, 'body.fs-mode-gold');
  ct(css, 'body.fs-mode-crimson');
});

t('emitFreeSpinsCSS: bakes fadeMs literal in transition', () => {
  const css = emitFreeSpinsCSS({ fadeMs: 480 });
  ct(css, 'transition: opacity 480ms ease-out');
  ct(css, 'transition: transform 480ms');
});

t('emitFreeSpinsCSS: disabled → empty', () => {
  const css = emitFreeSpinsCSS({ enabled: false });
  ok(!css.includes('.fs-hud {'), 'no .fs-hud rule when disabled');
});

/* ── Markup emitters ─────────────────────────────────────────────────── */

t('emitFreeSpinsHudMarkup: emits HUD with all 3 stat boxes', () => {
  const html = emitFreeSpinsHudMarkup();
  ct(html, 'id="fsHud"');
  ct(html, 'id="fsHudSpins"');
  ct(html, 'id="fsHudMult"');
  ct(html, 'id="fsHudTotal"');
  ct(html, 'Spins'); ct(html, 'Mult'); ct(html, 'Total');
});

t('emitFreeSpinsToastMarkup: emits toast element', () => {
  const html = emitFreeSpinsToastMarkup();
  ct(html, 'id="fsToast"');
  ct(html, 'class="fs-toast"');
});

t('emitFreeSpinsOverlayMarkup: emits overlay placard with all IDs', () => {
  const html = emitFreeSpinsOverlayMarkup();
  ct(html, 'id="fsOverlay"');
  ct(html, 'id="fsPlacardEyebrow"');
  ct(html, 'id="fsPlacardTitle"');
  ct(html, 'id="fsPlacardSpins"');
  ct(html, 'id="fsPlacardSub"');
  ct(html, 'id="fsPlacardCta"');
  ct(html, 'FREE SPINS');         /* default introLabel */
  ct(html, 'TAP TO BEGIN');       /* default CTA */
});

t('emitFreeSpinsOverlayMarkup: HTML-escapes labels', () => {
  /* invalid label falls back to default; valid label appears verbatim */
  const html1 = emitFreeSpinsOverlayMarkup({ introLabel: 'X & Y' });
  ct(html1, 'X &amp; Y');
  const html2 = emitFreeSpinsOverlayMarkup({ introLabel: '<bad>' });
  ok(!html2.includes('<bad>'), 'unsafe label rejected');
});

t('emitFreeSpinsHudMarkup: disabled → empty', () => {
  eq(emitFreeSpinsHudMarkup({ enabled: false }), '');
  eq(emitFreeSpinsToastMarkup({ enabled: false }), '');
  eq(emitFreeSpinsOverlayMarkup({ enabled: false }), '');
});

/* ── Runtime emitter ─────────────────────────────────────────────────── */

t('emitFreeSpinsRuntime: emits FSM + all 11 helpers', () => {
  const js = emitFreeSpinsRuntime();
  ct(js, 'const FSM = {');
  for (const fn of [
    'FSM_renderHud', 'FSM_showFsMode', 'FSM_hideFsMode',
    'FSM_showOverlay', 'FSM_hideOverlay', 'FSM_showToast',
    'FSM_enterIntro', 'FSM_enterActive', 'FSM_runNextFsSpin',
    'FSM_handleRetrigger', 'FSM_enterOutro', 'FSM_enterBase',
  ]) {
    ct(js, `function ${fn}`);
  }
});

t('emitFreeSpinsRuntime: exposes FSM on window for QA harness', () => {
  const js = emitFreeSpinsRuntime();
  ct(js, 'window.FSM = FSM');
});

t('emitFreeSpinsRuntime: bakes label + timing constants', () => {
  const js = emitFreeSpinsRuntime({
    introLabel: 'BONUS', enterActiveDelayMs: 500, toastMs: 2000,
  });
  ct(js, 'FS_INTRO_LABEL       = "BONUS"');
  ct(js, 'FS_ENTER_ACTIVE_MS   = 500');
  ct(js, 'FS_TOAST_MS          = 2000');
});

t('emitFreeSpinsRuntime: disabled → stub with all FSM_ helpers as no-ops', () => {
  const js = emitFreeSpinsRuntime({ enabled: false });
  ct(js, 'disabled by GDD');
  for (const fn of [
    'FSM_renderHud', 'FSM_showFsMode', 'FSM_hideFsMode',
    'FSM_showOverlay', 'FSM_hideOverlay', 'FSM_showToast',
    'FSM_enterIntro', 'FSM_enterActive', 'FSM_runNextFsSpin',
    'FSM_handleRetrigger', 'FSM_enterOutro', 'FSM_enterBase',
  ]) {
    ct(js, `function ${fn}`);
  }
});

/* ── Parser ──────────────────────────────────────────────────────────── */

t('parser: GDD without section → undefined slots', () => {
  const m = parseGDD('# G\n', 'md');
  ok(m.freeSpinsPresentation, 'slot must exist');
  eq(m.freeSpinsPresentation.introLabel, undefined);
  eq(m.freeSpinsPresentation.fadeMs, undefined);
});

t('parser: full Free Spins Presentation section', () => {
  const gdd = [
    '# G', '',
    '## Free Spins Presentation',
    '- enabled: true',
    '- intro-label: BONUS ROUND',
    '- outro-label: BONUS COMPLETE',
    '- total-win-label: GRAND TOTAL',
    '- intro-cta: START',
    '- outro-cta: BACK',
    '- intro-sub: Get ready!',
    '- fade-ms: 500',
    '- enter-active-ms: 600',
    '- spin-breath-ms: 300',
    '- toast-ms: 2200',
    '- retrigger-toast-ms: 1800',
    '',
  ].join('\n');
  const m = parseGDD(gdd, 'md');
  const fp = m.freeSpinsPresentation;
  eq(fp.enabled, true);
  eq(fp.introLabel, 'BONUS ROUND');
  eq(fp.outroLabel, 'BONUS COMPLETE');
  eq(fp.totalWinLabel, 'GRAND TOTAL');
  eq(fp.introCta, 'START');
  eq(fp.outroCta, 'BACK');
  eq(fp.introSub, 'Get ready!');
  eq(fp.fadeMs, 500);
  eq(fp.enterActiveDelayMs, 600);
  eq(fp.spinBreathMs, 300);
  eq(fp.toastMs, 2200);
  eq(fp.retriggerToastMs, 1800);
});

t('parser: heading alias variants', () => {
  for (const h of ['Free Spins Presentation', 'FS Presentation', 'Free Spins Placard', 'Bonus Presentation', 'FS Placard']) {
    const m = parseGDD(`# G\n\n## ${h}\n- enabled: false\n`, 'md');
    eq(m.freeSpinsPresentation.enabled, false, `heading "${h}"`);
  }
});

t('parser → runtime roundtrip: labels reach FS_INTRO_LABEL etc.', () => {
  const gdd = [
    '# G', '',
    '## Free Spins Presentation',
    '- intro-label: BONUS',
    '- outro-cta: DONE',
    '- enter-active-ms: 700',
    '',
  ].join('\n');
  const m = parseGDD(gdd, 'md');
  const js = emitFreeSpinsRuntime(resolveConfig(m));
  ct(js, 'FS_INTRO_LABEL       = "BONUS"');
  ct(js, 'FS_OUTRO_CTA         = "DONE"');
  ct(js, 'FS_ENTER_ACTIVE_MS   = 700');
});

console.log('');
if (fail > 0) { console.log(`  ${fail} test(s) failed.`); process.exit(1); }
else { console.log('  All tests passed.'); }
