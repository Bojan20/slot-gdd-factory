/**
 * tests/blocks/colorblindPatterns.test.mjs — Wave H4 contract test.
 *
 * Covers:
 *   - defaultConfig shape + freeze
 *   - resolveConfig: bounds, whitelist, tierMap deep-merge, XSS guard
 *   - emitColorblindPatternsCSS: disabled stub, all 7 tier patterns, prefers-reduced-motion
 *   - emitColorblindPatternsMarkup: role/aria, autoActivate flip
 *   - emitColorblindPatternsRuntime: HookBus listeners, decorate logic, persistence
 *   - vendor-neutral source guard
 */
import {
  defaultConfig,
  resolveConfig,
  emitColorblindPatternsCSS,
  emitColorblindPatternsMarkup,
  emitColorblindPatternsRuntime,
} from '../../src/blocks/colorblindPatterns.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/colorblindPatterns.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('colorblindPatterns block contract');

/* ── defaultConfig ────────────────────────────────────────────────────── */
const def = defaultConfig();
t('defaultConfig is frozen',                          Object.isFrozen(def));
t('default enabled = true (accessibility default-on)', def.enabled === true);
t('default autoActivate = false (player opt-in)',     def.autoActivate === false);
t('default position = top-right',                     def.position === 'top-right');
t('default chipLabel = CB',                           def.chipLabel === 'CB');
t('default chipFontSize = 11 (Apple HIG floor)',      def.chipFontSize === 11);
t('default patternOpacity = 0.45',                    def.patternOpacity === 0.45);
t('default blendMode = overlay',                      def.blendMode === 'overlay');
t('default tierMap is frozen',                        Object.isFrozen(def.tierMap));
t('default tierMap covers H1-H5 / M1-M5 / L1-L5 / W / S / B',
  ['H1','H5','M1','M5','L1','L5','W','S','B'].every(k => k in def.tierMap));
t('default persistKey = slot.cbPatterns',             def.persistKey === 'slot.cbPatterns');
t('default zIndex within bounds',                     def.zIndex >= 10 && def.zIndex <= 99);

/* ── resolveConfig: bounds + whitelist + XSS guard ────────────────────── */
const r1 = resolveConfig({});
t('resolveConfig empty → defaults clone',             r1.enabled === true && r1.position === 'top-right');

const r2 = resolveConfig({ colorblindPatterns: { enabled: false } });
t('resolveConfig enabled=false honoured',             r2.enabled === false);

const r3 = resolveConfig({ colorblindPatterns: { chipFontSize: 1000 } });
t('chipFontSize clamped to 18 ceiling',               r3.chipFontSize === 18);

const r4 = resolveConfig({ colorblindPatterns: { chipFontSize: 1 } });
t('chipFontSize clamped to 11 floor',                 r4.chipFontSize === 11);

const r5 = resolveConfig({ colorblindPatterns: { patternOpacity: 5 } });
t('patternOpacity clamped to 1.0 ceiling',            r5.patternOpacity === 1.0);

const r6 = resolveConfig({ colorblindPatterns: { patternOpacity: 0 } });
t('patternOpacity clamped to 0.10 floor',             r6.patternOpacity === 0.10);

const r7 = resolveConfig({ colorblindPatterns: { position: 'top-middle' } });
t('invalid position rejected → default kept',         r7.position === 'top-right');

const r8 = resolveConfig({ colorblindPatterns: { position: 'bottom-left' } });
t('valid alt position accepted',                      r8.position === 'bottom-left');

const r9 = resolveConfig({ colorblindPatterns: { blendMode: 'crazy' } });
t('invalid blendMode rejected → default kept',        r9.blendMode === 'overlay');

const r10 = resolveConfig({ colorblindPatterns: { blendMode: 'multiply' } });
t('valid blendMode accepted',                         r10.blendMode === 'multiply');

const r11 = resolveConfig({ colorblindPatterns: { chipLabel: '<script>X</script>' } });
t('chipLabel XSS chars stripped',                     !r11.chipLabel.includes('<') && !r11.chipLabel.includes('>'));

const r12 = resolveConfig({ colorblindPatterns: { chipLabel: 'AAAAAAAAAAAAAAAAAAAA' } });
t('chipLabel length capped at 8',                     r12.chipLabel.length <= 8);

const r13 = resolveConfig({ colorblindPatterns: { tierMap: { Q1: 'HP', Q2: 'BOGUS' } } });
t('tierMap valid entry merged',                       r13.tierMap.Q1 === 'HP');
t('tierMap invalid tier rejected',                    !('Q2' in r13.tierMap) || r13.tierMap.Q2 !== 'BOGUS');

const r14 = resolveConfig({ colorblindPatterns: { tierMap: { '': 'HP', 'TOOLOOOOOOOOOOOOOOOONG': 'HP' } } });
t('tierMap empty key rejected',                       !('' in r14.tierMap));
t('tierMap >12-char key rejected',                    !('TOOLOOOOOOOOOOOOOOOONG' in r14.tierMap));

const r15 = resolveConfig({ colorblindPatterns: { tierMap: { H1: 'WILD' } } });
t('tierMap overrides default for shared key',         r15.tierMap.H1 === 'WILD');

const r16 = resolveConfig({ colorblindPatterns: { zIndex: 5 } });
t('zIndex clamped to 10 floor',                       r16.zIndex === 10);

const r17 = resolveConfig({ colorblindPatterns: { persistKey: '"><img/>' } });
t('persistKey XSS chars stripped',                    !r17.persistKey.includes('<') && !r17.persistKey.includes('>'));

/* ── emitColorblindPatternsCSS ────────────────────────────────────────── */
const cssDisabled = emitColorblindPatternsCSS({ ...def, enabled: false });
t('CSS disabled = empty string',                      cssDisabled === '');

const css = emitColorblindPatternsCSS(def);
t('CSS contains .cb-chip selector',                   css.includes('.cb-chip'));
t('CSS sets z-index from config',                     css.includes(`z-index: ${def.zIndex};`));
t('CSS sets patternOpacity from config',              css.includes(`opacity: ${def.patternOpacity};`));
t('CSS sets blendMode from config',                   css.includes(`mix-blend-mode: ${def.blendMode};`));
t('CSS includes HP tier pattern URI',                 css.includes('[data-cb-tier="HP"]'));
t('CSS includes MP tier pattern URI',                 css.includes('[data-cb-tier="MP"]'));
t('CSS includes LP tier pattern URI',                 css.includes('[data-cb-tier="LP"]'));
t('CSS includes WILD tier pattern URI',               css.includes('[data-cb-tier="WILD"]'));
t('CSS includes SCATTER tier pattern URI',            css.includes('[data-cb-tier="SCATTER"]'));
t('CSS includes BONUS tier pattern URI',              css.includes('[data-cb-tier="BONUS"]'));
t('CSS includes SPECIAL tier pattern URI',            css.includes('[data-cb-tier="SPECIAL"]'));
t('CSS gates overlay on body[data-cb-active="true"]', css.includes('body[data-cb-active="true"]'));
t('CSS honours prefers-reduced-motion',               css.includes('prefers-reduced-motion'));
t('CSS focus-visible outline (a11y keyboard nav)',    css.includes(':focus-visible'));
t('CSS chip min-height 44px (WCAG 2.5.5 touch)',      css.includes('min-height: 44px'));

/* ── emitColorblindPatternsMarkup ─────────────────────────────────────── */
const mDisabled = emitColorblindPatternsMarkup({ ...def, enabled: false });
t('markup disabled = empty string',                   mDisabled === '');

const m = emitColorblindPatternsMarkup(def);
t('markup includes id=cbPatternsChip',                m.includes('id="cbPatternsChip"'));
t('markup has role=switch',                           m.includes('role="switch"'));
t('markup has aria-checked attr',                     m.includes('aria-checked='));
t('markup default aria-checked=false (autoActivate)', m.includes('aria-checked="false"'));
t('markup has aria-label',                            m.includes('aria-label='));
t('markup is a button element',                       m.includes('<button'));

const mAuto = emitColorblindPatternsMarkup({ ...def, autoActivate: true });
t('autoActivate=true → aria-checked="true"',          mAuto.includes('aria-checked="true"'));

const mXss = emitColorblindPatternsMarkup({ ...def, chipLabel: '<X>' });
t('chipLabel XSS stripped in markup',                 !mXss.includes('<X>'));

/* ── emitColorblindPatternsRuntime ────────────────────────────────────── */
const rtDisabled = emitColorblindPatternsRuntime({ ...def, enabled: false });
t('runtime disabled = stub with flag=false',          rtDisabled.includes('__SLOT_CB_PATTERNS_ON__ = false'));
t('runtime disabled has no HookBus.on calls',         !rtDisabled.match(/HookBus\.on\(/));

const rt = emitColorblindPatternsRuntime(def);
t('runtime emits __SLOT_CB_PATTERNS_ON__ flag',       rt.includes('__SLOT_CB_PATTERNS_ON__'));
t('runtime listens postSpin',                         rt.includes("HookBus.on('postSpin'"));
t('runtime listens onTumbleStep',                     rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsSpinResult',                   rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime listens onCbPatternsToggle',               rt.includes("HookBus.on('onCbPatternsToggle'"));
t('runtime emits onCbPatternsToggle (literal)',       rt.includes("HookBus.emit('onCbPatternsToggle'"));
t('runtime exposes window.colorblindPatternsOn',      rt.includes('window.colorblindPatternsOn'));
t('runtime exposes window.colorblindPatternsOff',     rt.includes('window.colorblindPatternsOff'));
t('runtime exposes window.colorblindPatternsToggle',  rt.includes('window.colorblindPatternsToggle'));
t('runtime guards typeof window',                     rt.includes('typeof window'));
t('runtime guards HookBus presence',                  rt.includes('!window.HookBus'));
t('runtime reads localStorage with try/catch',        rt.includes('localStorage.getItem') && rt.includes('catch'));
t('runtime persists state via setItem',               rt.includes('localStorage.setItem'));
t('runtime uses cfg.persistKey literal',              rt.includes(JSON.stringify(def.persistKey)));
t('runtime decorate uses data-sym + data-symbol',     rt.includes("data-sym") && rt.includes('data-symbol'));
t('runtime DOM-ready guard branches',                 rt.includes('DOMContentLoaded') && rt.includes('readyState'));

/* ── sandbox behaviour ───────────────────────────────────────────────── */
function makeWindowSandbox() {
  const listeners = {};
  const emits = [];
  const storage = {};
  const dataAttrs = {};
  const body = {
    setAttribute(k, v) { dataAttrs[k] = v; },
    getAttribute(k) { return dataAttrs[k]; },
  };
  const cellSym = (sym) => ({
    nodeType: 1,
    _attrs: { 'data-sym': sym },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  });
  const cells = [cellSym('H1'), cellSym('M2'), cellSym('L1'), cellSym('W'), cellSym('S'), cellSym('B'), cellSym('Z9-UNKNOWN')];
  const chip = {
    _attrs: {},
    _handler: null,
    __bound: false,
    setAttribute(k, v) { this._attrs[k] = v; },
    addEventListener(ev, h) { if (ev === 'click') this._handler = h; },
  };
  return {
    window: {
      HookBus: {
        on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
        emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
      },
      localStorage: {
        getItem(k) { return storage[k] == null ? null : storage[k]; },
        setItem(k, v) { storage[k] = String(v); },
      },
    },
    document: {
      readyState: 'complete',
      body,
      addEventListener() {},
      querySelectorAll(sel) { return sel === '.symbol-cell' ? cells : []; },
      getElementById(id) { return id === 'cbPatternsChip' ? chip : null; },
    },
    listeners, emits, storage, cells, chip, body, dataAttrs,
  };
}

function runRuntime(cfg, sb) {
  /* eslint-disable no-new-func */
  const fn = new Function('window', 'document', emitColorblindPatternsRuntime(cfg));
  fn(sb.window, sb.document);
}

const sb1 = makeWindowSandbox();
runRuntime(def, sb1);
t('sandbox: postSpin listener registered',            !!sb1.listeners.postSpin);
t('sandbox: onTumbleStep listener registered',        !!sb1.listeners.onTumbleStep);
t('sandbox: onFsSpinResult listener registered',      !!sb1.listeners.onFsSpinResult);
t('sandbox: onCbPatternsToggle listener registered',  !!sb1.listeners.onCbPatternsToggle);
t('sandbox: window.__SLOT_CB_PATTERNS_ON__ initial=false (autoActivate=false)',
  sb1.window.__SLOT_CB_PATTERNS_ON__ === false);
t('sandbox: body data-cb-active=false initially',     sb1.body.getAttribute('data-cb-active') === 'false');

// Toggle ON via API
sb1.window.colorblindPatternsOn();
t('sandbox: colorblindPatternsOn flips state to true', sb1.window.__SLOT_CB_PATTERNS_ON__ === true);
t('sandbox: body data-cb-active=true after toggle on', sb1.body.getAttribute('data-cb-active') === 'true');
t('sandbox: localStorage persisted "1"',               sb1.storage[def.persistKey] === '1');
t('sandbox: cells decorated with HP tier',             sb1.cells[0].getAttribute('data-cb-tier') === 'HP');
t('sandbox: cells decorated with MP tier',             sb1.cells[1].getAttribute('data-cb-tier') === 'MP');
t('sandbox: cells decorated with LP tier',             sb1.cells[2].getAttribute('data-cb-tier') === 'LP');
t('sandbox: cells decorated with WILD tier',           sb1.cells[3].getAttribute('data-cb-tier') === 'WILD');
t('sandbox: cells decorated with SCATTER tier',        sb1.cells[4].getAttribute('data-cb-tier') === 'SCATTER');
t('sandbox: cells decorated with BONUS tier',          sb1.cells[5].getAttribute('data-cb-tier') === 'BONUS');
t('sandbox: unknown symbol gets empty data-cb-tier',   sb1.cells[6].getAttribute('data-cb-tier') === '');

// onCbPatternsToggle emit on API change
const emitsAfter = sb1.emits.filter(e => e.ev === 'onCbPatternsToggle');
t('sandbox: API toggle emits onCbPatternsToggle',      emitsAfter.length >= 1 && emitsAfter[0].p.enabled === true);

// postSpin re-decorate
sb1.cells[0].setAttribute('data-sym', 'L3');
sb1.listeners.postSpin[0]();
t('sandbox: postSpin re-decorates updated cell',       sb1.cells[0].getAttribute('data-cb-tier') === 'LP');

// Persisted boot state — second sandbox with localStorage["1"]
const sb2 = makeWindowSandbox();
sb2.window.localStorage.setItem(def.persistKey, '1');
runRuntime(def, sb2);
t('sandbox: boot from persisted "1" → active=true',    sb2.window.__SLOT_CB_PATTERNS_ON__ === true);

// External event sync
sb1.window.HookBus.emit('onCbPatternsToggle', { enabled: false });
t('sandbox: external event flips state without loop',  sb1.window.__SLOT_CB_PATTERNS_ON__ === false);

// Chip click
const sb3 = makeWindowSandbox();
runRuntime(def, sb3);
sb3.chip._handler && sb3.chip._handler();
t('sandbox: chip click flips state',                   sb3.window.__SLOT_CB_PATTERNS_ON__ === true);
t('sandbox: chip aria-checked synced',                 sb3.chip._attrs['aria-checked'] === 'true');

/* ── vendor-neutrality grep ──────────────────────────────────────────── */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral (no studio/game/engine names)', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
