/**
 * tests/blocks/hiLoGamble.test.mjs — Wave H16 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitHiLoGambleCSS,
  emitHiLoGambleMarkup,
  emitHiLoGambleRuntime,
} from '../../src/blocks/hiLoGamble.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/hiLoGamble.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('hiLoGamble block contract');

/* --- defaults --- */
const def = defaultConfig();
t('defaultConfig frozen',                  Object.isFrozen(def));
t('default enabled = false (opt-in)',      def.enabled === false);
t('default multiplier = 2',                def.multiplier === 2);
t('default maxRounds = 5',                 def.maxRounds === 5);
t('default allowDuringFs = false',         def.allowDuringFs === false);
t('default ctaPosition = bottom-right',    def.ctaPosition === 'bottom-right');
t('default ctaLabel = GAMBLE',             def.ctaLabel === 'GAMBLE');
t('default higherLabel = HIGHER',          def.higherLabel === 'HIGHER');
t('default lowerLabel  = LOWER',           def.lowerLabel === 'LOWER');
t('default collectLabel = COLLECT',        def.collectLabel === 'COLLECT');
t('defaultConfig returns fresh object',    defaultConfig() !== defaultConfig());

/* --- resolveConfig --- */
t('auto-enable when GDD declares block',   resolveConfig({ hiLoGamble: {} }).enabled === true);
t('explicit false stays disabled',         resolveConfig({ hiLoGamble: { enabled: false } }).enabled === false);
t('no key → disabled',                     resolveConfig({}).enabled === false);

const r1 = resolveConfig({ hiLoGamble: { multiplier: 100 } });
t('multiplier clamped to 16 ceiling',      r1.multiplier === 16);
const r2 = resolveConfig({ hiLoGamble: { multiplier: 0.1 } });
t('multiplier clamped to 1.1 floor',       r2.multiplier === 1.1);
const r3 = resolveConfig({ hiLoGamble: { maxRounds: 500 } });
t('maxRounds clamped to 20 ceiling',       r3.maxRounds === 20);
const r4 = resolveConfig({ hiLoGamble: { ctaPosition: 'middle' } });
t('ctaPosition whitelist rejects bogus',   r4.ctaPosition === 'bottom-right');
const r5 = resolveConfig({ hiLoGamble: { ctaPosition: 'top-left' } });
t('ctaPosition top-left accepted',         r5.ctaPosition === 'top-left');
const r6 = resolveConfig({ hiLoGamble: { ctaLabel: '<script>X' } });
t('ctaLabel XSS chars stripped',           !r6.ctaLabel.includes('<') && !r6.ctaLabel.includes('>'));
const r7 = resolveConfig({ hiLoGamble: { allowDuringFs: true } });
t('allowDuringFs true accepted',           r7.allowDuringFs === true);
const r8 = resolveConfig({ hiLoGamble: { multiplier: 'NaN' } });
t('non-numeric multiplier rejected',       r8.multiplier === 2);

/* --- CSS --- */
const cssDis = emitHiLoGambleCSS({ ...def, enabled: false });
t('CSS disabled = empty',                  cssDis === '');
const css = emitHiLoGambleCSS({ ...def, enabled: true });
t('CSS .hilo-cta selector',                css.includes('.hilo-cta'));
t('CSS .hilo-modal selector',              css.includes('.hilo-modal'));
t('CSS .hilo-card selector',               css.includes('.hilo-card'));
t('CSS prefers-reduced-motion gate',       css.includes('prefers-reduced-motion'));
t('CSS WCAG 44px min touch target',        css.includes('min-width: 44px') && css.includes('min-height: 44px'));
t('CSS focus-visible outline present',     css.includes(':focus-visible'));

/* --- Markup --- */
const mDis = emitHiLoGambleMarkup({ ...def, enabled: false });
t('markup disabled = empty',               mDis === '');
const mk = emitHiLoGambleMarkup({ ...def, enabled: true });
t('markup CTA button present',             mk.includes('id="hiloCta"'));
t('markup backdrop present',               mk.includes('id="hiloBackdrop"'));
t('markup role=dialog present',            mk.includes('role="dialog"'));
t('markup aria-modal=true present',        mk.includes('aria-modal="true"'));
t('markup aria-live=polite on card',       mk.includes('aria-live="polite"'));
t('markup higher/lower/collect kinds',     mk.includes('data-kind="higher"') && mk.includes('data-kind="lower"') && mk.includes('data-kind="collect"'));

/* --- Runtime --- */
const rtDis = emitHiLoGambleRuntime({ ...def, enabled: false });
t('runtime disabled = empty',              rtDis === '');
const rt = emitHiLoGambleRuntime({ ...def, enabled: true });
t('runtime listens onWinPresentationEnd',  rt.includes("HookBus.on('onWinPresentationEnd'"));
t('runtime listens preSpin',               rt.includes("HookBus.on('preSpin'"));
t('runtime listens onFsTrigger',           rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd',               rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onHiLoStart',             rt.includes("HookBus.emit('onHiLoStart'"));
t('runtime emits onHiLoChoice',            rt.includes("HookBus.emit('onHiLoChoice'"));
t('runtime emits onHiLoResolved',          rt.includes("HookBus.emit('onHiLoResolved'"));
t('runtime emits onHiLoCollected',         rt.includes("HookBus.emit('onHiLoCollected'"));
t('runtime exposes window.hiLoResolve',    rt.includes('window.hiLoResolve'));
t('runtime exposes window.hiLoOpen',       rt.includes('window.hiLoOpen'));
t('runtime exposes window.hiLoCollect',    rt.includes('window.hiLoCollect'));
t('runtime exposes window.hiLoStatus',     rt.includes('window.hiLoStatus'));
t('runtime Escape key handler present',    rt.includes("e.key === 'Escape'"));

/* --- Sandbox --- */
function makeSb() {
  const listeners = {};
  const emits = [];
  const elements = {
    hiloCta:      makeEl('button'),
    hiloBackdrop: makeEl('div'),
    hiloCard:     makeEl('div'),
    hiloStatus:   makeEl('div'),
  };
  elements.hiloBackdrop._kids = [
    Object.assign(makeEl('button'), { _attrs: { 'data-kind': 'higher' } }),
    Object.assign(makeEl('button'), { _attrs: { 'data-kind': 'lower' } }),
    Object.assign(makeEl('button'), { _attrs: { 'data-kind': 'collect' } }),
  ];
  function makeEl(tag) {
    return {
      _attrs: {}, _handlers: {}, _kids: [], textContent: '', tagName: tag, nodeType: 1,
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
      addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
      removeEventListener() {},
      focus() {},
      querySelectorAll(sel) {
        if (sel === '.hilo-btn') return this._kids;
        return [];
      },
    };
  }
  const document = {
    activeElement: null,
    addEventListener(ev, fn) { (listeners['doc:' + ev] = listeners['doc:' + ev] || []).push(fn); },
    getElementById(id) { return elements[id] || null; },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, elements };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', emitHiLoGambleRuntime(cfg));
  fn(sb.window, sb.document);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered',          !!sb1.listeners.onWinPresentationEnd);
t('sandbox: preSpin listener registered',   !!sb1.listeners.preSpin);

/* CTA reveal on win */
sb1.listeners.onWinPresentationEnd[0]({ award: 10 });
t('sandbox: CTA visible after win',         sb1.elements.hiloCta.getAttribute('data-visible') === 'true');

/* CTA hidden on preSpin */
sb1.listeners.preSpin[0]();
t('sandbox: CTA hidden on preSpin',         sb1.elements.hiloCta.getAttribute('data-visible') === 'false');

/* CTA suppressed in FS by default */
sb1.listeners.onFsTrigger[0]();
sb1.listeners.onWinPresentationEnd[0]({ award: 25 });
t('sandbox: CTA suppressed during FS',      sb1.elements.hiloCta.getAttribute('data-visible') === 'false');
sb1.listeners.onFsEnd[0]();
sb1.listeners.onWinPresentationEnd[0]({ award: 25 });
t('sandbox: CTA reappears after FS end',    sb1.elements.hiloCta.getAttribute('data-visible') === 'true');

/* API: open + resolve win — fresh sandbox so stake starts at 10. */
const sbWin = makeSb();
runRt({ ...def, enabled: true }, sbWin);
sbWin.listeners.onWinPresentationEnd[0]({ award: 10 });
sbWin.emits.length = 0;
sbWin.window.hiLoOpen('7');
const starts = sbWin.emits.filter(e => e.ev === 'onHiLoStart');
t('sandbox: onHiLoStart emitted',           starts.length === 1);
t('sandbox: modal opened',                  sbWin.elements.hiloBackdrop.getAttribute('data-open') === 'true');

sbWin.window.hiLoResolve('win', 'K');
const resolved = sbWin.emits.filter(e => e.ev === 'onHiLoResolved');
t('sandbox: onHiLoResolved win emitted',    resolved.length === 1 && resolved[0].p.result === 'win');
t('sandbox: stake doubled (10 → 20)',       resolved[0].p.stake === 20);

/* Bust path */
const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onWinPresentationEnd[0]({ award: 10 });
sb2.window.hiLoOpen('5');
sb2.emits.length = 0;
sb2.window.hiLoResolve('lose', '2');
const lost = sb2.emits.filter(e => e.ev === 'onHiLoResolved' && e.p.result === 'lose');
t('sandbox: bust emits result=lose',        lost.length === 1);
t('sandbox: stake zero after bust',         lost[0].p.stake === 0);

/* Collect path via API */
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.listeners.onWinPresentationEnd[0]({ award: 4 });
sb3.window.hiLoOpen('J');
sb3.emits.length = 0;
sb3.window.hiLoCollect();
const collected = sb3.emits.filter(e => e.ev === 'onHiLoCollected');
t('sandbox: hiLoCollect emits onHiLoCollected', collected.length === 1);
t('sandbox: modal closed after collect',    sb3.elements.hiloBackdrop.getAttribute('data-open') === 'false');

/* Choice event */
const sb4 = makeSb();
runRt({ ...def, enabled: true }, sb4);
sb4.listeners.onWinPresentationEnd[0]({ award: 8 });
sb4.window.hiLoOpen('9');
sb4.emits.length = 0;
/* Simulate click on HIGHER button: pull handler from kids array */
const higherBtn = sb4.elements.hiloBackdrop._kids[0];
higherBtn._handlers.click[0]();
const choices = sb4.emits.filter(e => e.ev === 'onHiLoChoice');
t('sandbox: HIGHER click emits onHiLoChoice', choices.length === 1 && choices[0].p.choice === 'higher');

/* allowDuringFs=true → CTA visible in FS */
const sb5 = makeSb();
runRt({ ...def, enabled: true, allowDuringFs: true }, sb5);
sb5.listeners.onFsTrigger[0]();
sb5.listeners.onWinPresentationEnd[0]({ award: 12 });
t('sandbox: allowDuringFs=true shows CTA in FS', sb5.elements.hiloCta.getAttribute('data-visible') === 'true');

/* hiLoStatus snapshot */
const sb6 = makeSb();
runRt({ ...def, enabled: true }, sb6);
sb6.listeners.onWinPresentationEnd[0]({ award: 6 });
sb6.window.hiLoOpen('7');
const status = sb6.window.hiLoStatus();
t('sandbox: hiLoStatus returns snapshot',   typeof status === 'object' && status.stake === 6);

/* --- Vendor neutrality --- */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(\bIGT\b|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',                 !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
