/* eslint-disable no-console */
/**
 * Wave U10 — paytable block tests.
 *
 * Coverage matrix:
 *   • defaultConfig industry-baseline (enabled=true, i-label, gold accent)
 *   • resolveConfig validation: chipLabel length, RGB regex, boolean
 *     coercion of all show/close flags, auto-disable from feature kind
 *   • emitPaytableCSS (disabled = empty, enabled = z-index 40 baked,
 *     fade-in keyframe, mobile media query)
 *   • emitPaytableMarkup (XSS escape on label + aria, hidden backdrop,
 *     role=dialog, aria-modal=true, close button present)
 *   • emitPaytableRuntime (stub when disabled, listeners + window API
 *     when enabled, baked roster + features + specials)
 *   • Sandbox: show/hide/toggle lifecycle, refresh on onBetChanged,
 *     auto-hide on preSpin (if autoHideOnSpin), auto-hide on
 *     onFsTrigger + onAutoplayStart unconditionally, escape key,
 *     backdrop click, double-show is no-op
 */

import {
  defaultConfig, resolveConfig,
  emitPaytableCSS, emitPaytableMarkup, emitPaytableRuntime,
} from '../../src/blocks/paytable.mjs';
import { emitHookBusRuntime } from '../../src/blocks/hookBus.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };
const ok  = (v, m = '') => { if (!v) throw new Error(`expected truthy — ${m}`); };

console.log('— blocks/paytable.mjs —');

/* ── defaults + resolveConfig ── */

t('defaultConfig: industry-baseline values', () => {
  const d = defaultConfig();
  eq(d.enabled, true, 'paytable is regulator-mandated → default ON');
  eq(d.chipLabel, 'i');
  eq(d.chipColor, '201,162,39');
  eq(d.chipTextColor, '255,230,168');
  eq(d.showFeaturesList, true);
  eq(d.showWildRules, true);
  eq(d.showLineMap, false);
  eq(d.closeOnBackdrop, true);
  eq(d.closeOnEscape, true);
  eq(d.autoHideOnSpin, true);
});

t('resolveConfig: chipLabel length capped (≤4)', () => {
  eq(resolveConfig({ paytable: { chipLabel: '?' } }).chipLabel, '?');
  eq(resolveConfig({ paytable: { chipLabel: 'INFO' } }).chipLabel, 'INFO');
  eq(resolveConfig({ paytable: { chipLabel: 'TOOLONG' } }).chipLabel, 'i', 'rejected → default');
  eq(resolveConfig({ paytable: { chipLabel: '' } }).chipLabel, 'i', 'empty → default');
});

t('resolveConfig: RGB regex enforced for color fields', () => {
  const c = resolveConfig({ paytable: {
    chipColor: '10,20,30',
    modalBgColor: '40, 50, 60',
    chipTextColor: 'red',
    modalAccentColor: '#abcdef',
  }});
  eq(c.chipColor, '10,20,30');
  eq(c.modalBgColor, '40,50,60', 'spaces stripped');
  eq(c.chipTextColor, '255,230,168', 'named color rejected');
  eq(c.modalAccentColor, '201,162,39', 'hex rejected');
});

t('resolveConfig: all 6 boolean flags coerce truthy/falsy', () => {
  const c = resolveConfig({ paytable: {
    showFeaturesList: 0,
    showWildRules:    1,
    showLineMap:      'yes',
    closeOnBackdrop:  null,
    closeOnEscape:    false,
    autoHideOnSpin:   true,
  }});
  eq(c.showFeaturesList, false);
  eq(c.showWildRules,    true);
  eq(c.showLineMap,      true);
  eq(c.closeOnBackdrop,  true, 'null is no-op → stays default true');
  eq(c.closeOnEscape,    false);
  eq(c.autoHideOnSpin,   true);
});

t('resolveConfig: ariaLabel length cap (≤64)', () => {
  eq(resolveConfig({ paytable: { ariaLabel: 'Custom' } }).ariaLabel, 'Custom');
  eq(resolveConfig({ paytable: { ariaLabel: 'X'.repeat(65) } }).ariaLabel, 'Open paytable');
});

t('resolveConfig: explicit feature kind disables block', () => {
  for (const k of ['no_paytable', 'no-paytable', 'paytable_disabled', 'PAYTABLE-DISABLED']) {
    eq(resolveConfig({ features: [{ kind: k }] }).enabled, false, k);
  }
  eq(resolveConfig({ features: [{ kind: 'free_spins' }] }).enabled, true, 'unrelated kind has no effect');
});

/* ── CSS ── */

t('emitPaytableCSS: empty when disabled', () => {
  eq(emitPaytableCSS({ ...defaultConfig(), enabled: false }), '');
});

t('emitPaytableCSS: enabled bakes z-index 40 + button + modal selectors', () => {
  const css = emitPaytableCSS(defaultConfig());
  for (const sel of ['.paytable-btn', '.paytable-backdrop', '.paytable-modal',
                     '.paytable-grid', '.paytable-id', '.paytable-payout',
                     '.paytable-features', '.paytable-close', '.paytable-bet-row']) {
    ct(css, sel);
  }
  ct(css, 'z-index: 40');
  ct(css, '@keyframes paytable-fade-in');
  ct(css, '@media (max-width: 480px)');
});

t('emitPaytableCSS: tier colors per HP/MP/LP baked', () => {
  const css = emitPaytableCSS(defaultConfig());
  ct(css, '.paytable-id.tier-HP');
  ct(css, '.paytable-id.tier-MP');
  ct(css, '.paytable-id.tier-LP');
});

t('emitPaytableCSS: chipColor interpolated', () => {
  const css = emitPaytableCSS({ ...defaultConfig(), chipColor: '11,22,33' });
  ct(css, 'rgba(11,22,33');
});

/* ── Markup ── */

t('emitPaytableMarkup: empty when disabled', () => {
  eq(emitPaytableMarkup({ ...defaultConfig(), enabled: false }), '');
});

t('emitPaytableMarkup: id=paytableBtn + backdrop hidden + role=dialog + aria-modal', () => {
  const html = emitPaytableMarkup(defaultConfig());
  ct(html, 'id="paytableBtn"');
  ct(html, 'id="paytableBackdrop"');
  ct(html, 'hidden');
  ct(html, 'role="dialog"');
  ct(html, 'aria-modal="true"');
  ct(html, 'aria-labelledby="paytableTitle"');
  ct(html, 'id="paytableCloseBtn"');
});

t('emitPaytableMarkup: XSS payload in chipLabel + ariaLabel HTML-escaped', () => {
  const html = emitPaytableMarkup({
    ...defaultConfig(),
    chipLabel: '<x>',
    ariaLabel: 'a"><script>x</script>',
  });
  ct(html, '&lt;x&gt;');
  ct(html, '&quot;');
  ct(html, '&lt;script&gt;');
  nct(html, '<script>x</script>');
});

/* ── Runtime stub vs enabled ── */

t('emitPaytableRuntime: disabled emits stub (window.paytable* no-op)', () => {
  const src = emitPaytableRuntime({ ...defaultConfig(), enabled: false });
  ct(src, 'window.paytableShow    = function () {}');
  ct(src, 'window.paytableHide    = function () {}');
  ct(src, 'window.paytableToggle  = function () {}');
  ct(src, 'enabled: false');
  nct(src, "HookBus.on(");
});

t('emitPaytableRuntime: enabled wires 4 lifecycle listeners + bakes model roster', () => {
  const model = {
    symbols: {
      high: [{ id: 'H1', name: 'Diamond' }, { id: 'H2', name: 'Ruby' }],
      mid:  [{ id: 'M1', name: 'Star' }],
      low:  [{ id: '10', name: 'Ten' }],
      specials: [{ id: 'W', name: 'Wild' }, { id: 'S', name: 'Scatter' }],
    },
    features: [{ kind: 'free_spins', label: 'Free Spins' }],
  };
  const src = emitPaytableRuntime(defaultConfig(), model);
  ct(src, "HookBus.on('onBetChanged'");
  ct(src, "HookBus.on('preSpin'");
  ct(src, "HookBus.on('onFsTrigger'");
  ct(src, "HookBus.on('onAutoplayStart'");
  /* Roster baked: 4 base symbols → 4 entries; 2 specials; 1 feature. */
  ct(src, '"H1"');
  ct(src, '"Diamond"');
  ct(src, '"HP"');
  ct(src, '"Wild"');
  ct(src, '"Free Spins"');
});

t('emitPaytableRuntime: autoHideOnSpin=false skips preSpin listener', () => {
  const src = emitPaytableRuntime({ ...defaultConfig(), autoHideOnSpin: false });
  /* preSpin handler block guarded by AUTO_HIDE constant. The actual
   * HookBus.on('preSpin') registration is wrapped in `if (AUTO_HIDE)`. */
  ct(src, 'var AUTO_HIDE      = false');
  /* Other listeners still wired regardless of AUTO_HIDE. */
  ct(src, "HookBus.on('onFsTrigger'");
});

/* ── Sandbox ── */

function buildSandbox(cfg = defaultConfig(), model = {}, opts = {}) {
  const hbSrc = emitHookBusRuntime({ debugLog: false });
  const ptSrc = emitPaytableRuntime(cfg, model);

  const elements = new Map();
  function makeElement(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id,
      hidden: (id === 'paytableBackdrop' || id === 'paytableBetRow'),
      disabled: false,
      className: '', textContent: '', innerHTML: '',
      _classes: new Set(), _attrs: {}, _listeners: new Map(),
      classList: {
        add(c)    { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, on) { if (on) el._classes.add(c); else el._classes.delete(c); },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = v; },
      getAttribute(k) { return el._attrs[k]; },
      addEventListener(name, fn) {
        if (!el._listeners.has(name)) el._listeners.set(name, []);
        el._listeners.get(name).push(fn);
      },
      removeEventListener() {},
      focus() { el._focused = true; },
      click()  { for (const fn of (el._listeners.get('click') || [])) fn({ target: el }); },
      _fire(name, ev) { for (const fn of (el._listeners.get(name) || [])) fn(ev || { target: el }); },
    };
    elements.set(id, el);
    return el;
  }
  for (const id of ['paytableBtn','paytableBackdrop','paytableContent','paytableBetRow',
                    'paytableBetValue','paytableCloseBtn']) {
    makeElement(id);
  }

  /* Capture document.addEventListener for keydown (Escape). */
  const docListeners = new Map();
  const fakeDocument = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(name, fn) {
      if (!docListeners.has(name)) docListeners.set(name, []);
      docListeners.get(name).push(fn);
    },
    _fireDoc(name, ev) { for (const fn of (docListeners.get(name) || [])) fn(ev); },
  };
  const fakeWindow = opts.window || {};
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  /* eslint-disable-next-line no-new-func */
  const factory = new Function(
    'window', 'document', 'console', 'setTimeout', 'clearTimeout',
    hbSrc + '\n' + ptSrc + '\nreturn { HookBus: window.HookBus };'
  );
  factory(fakeWindow, fakeDocument, fakeConsole, setTimeout, clearTimeout);

  return { window: fakeWindow, document: fakeDocument, elements, docListeners, HookBus: fakeWindow.HookBus };
}

t('sandbox: paytableShow opens backdrop + paytableHide closes', () => {
  const sb = buildSandbox(defaultConfig(), { symbols: { high: [{ id: 'H', name: 'High' }], mid: [], low: [], specials: [] } });
  const bd = sb.elements.get('paytableBackdrop');
  eq(bd.hidden, true);
  sb.window.paytableShow();
  eq(bd.hidden, false);
  eq(sb.window.PAYTABLE_STATE.open, true);
  sb.window.paytableHide();
  eq(bd.hidden, true);
  eq(sb.window.PAYTABLE_STATE.open, false);
});

t('sandbox: paytableToggle flips state', () => {
  const sb = buildSandbox(defaultConfig(), {});
  eq(sb.window.paytableIsOpen(), false);
  sb.window.paytableToggle();
  eq(sb.window.paytableIsOpen(), true);
  sb.window.paytableToggle();
  eq(sb.window.paytableIsOpen(), false);
});

t('sandbox: double-show is a no-op', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  const content1 = sb.elements.get('paytableContent').innerHTML;
  sb.window.paytableShow();
  const content2 = sb.elements.get('paytableContent').innerHTML;
  eq(content1, content2);
});

t('sandbox: clicking paytable button toggles', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.elements.get('paytableBtn').click();
  eq(sb.window.PAYTABLE_STATE.open, true);
  sb.elements.get('paytableBtn').click();
  eq(sb.window.PAYTABLE_STATE.open, false);
});

t('sandbox: clicking close button hides', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  sb.elements.get('paytableCloseBtn').click();
  eq(sb.window.PAYTABLE_STATE.open, false);
});

t('sandbox: backdrop click closes (closeOnBackdrop=true default)', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  const bd = sb.elements.get('paytableBackdrop');
  bd._fire('click', { target: bd });
  eq(sb.window.PAYTABLE_STATE.open, false);
});

t('sandbox: backdrop click on inner modal does NOT close', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  const bd = sb.elements.get('paytableBackdrop');
  /* Simulate click bubbling from a child node (target !== backdrop). */
  bd._fire('click', { target: { fake: 'innerModal' } });
  eq(sb.window.PAYTABLE_STATE.open, true, 'inner click should NOT close');
});

t('sandbox: Escape key closes (closeOnEscape=true default)', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  sb.document._fireDoc('keydown', { key: 'Escape' });
  eq(sb.window.PAYTABLE_STATE.open, false);
});

t('sandbox: other keys do nothing', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  sb.document._fireDoc('keydown', { key: 'Enter' });
  sb.document._fireDoc('keydown', { key: 'a' });
  eq(sb.window.PAYTABLE_STATE.open, true);
});

t('sandbox: preSpin hides when autoHideOnSpin=true', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.window.PAYTABLE_STATE.open, false);
});

t('sandbox: preSpin does NOT hide when autoHideOnSpin=false', () => {
  const sb = buildSandbox({ ...defaultConfig(), autoHideOnSpin: false }, {});
  sb.window.paytableShow();
  sb.HookBus.emit('preSpin', { duringFs: false });
  eq(sb.window.PAYTABLE_STATE.open, true);
});

t('sandbox: onFsTrigger hides unconditionally (FS owns screen)', () => {
  const sb = buildSandbox({ ...defaultConfig(), autoHideOnSpin: false }, {});
  sb.window.paytableShow();
  sb.HookBus.emit('onFsTrigger', { award: 10, scatters: 4 });
  eq(sb.window.PAYTABLE_STATE.open, false);
});

t('sandbox: onAutoplayStart hides unconditionally', () => {
  const sb = buildSandbox({ ...defaultConfig(), autoHideOnSpin: false }, {});
  sb.window.paytableShow();
  sb.HookBus.emit('onAutoplayStart', { remaining: 25, step: 25 });
  eq(sb.window.PAYTABLE_STATE.open, false);
});

t('sandbox: bet row hidden when window.__SLOT_BET__ unset', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  eq(sb.elements.get('paytableBetRow').hidden, true);
});

t('sandbox: bet row visible + formatted when window.__SLOT_BET__ is set', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.__SLOT_BET__ = 1.25;
  sb.window.paytableShow();
  eq(sb.elements.get('paytableBetRow').hidden, false);
  eq(sb.elements.get('paytableBetValue').textContent, '• 1.25');
});

t('sandbox: onBetChanged refreshes bet display while modal is open', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.__SLOT_BET__ = 1.00;
  sb.window.paytableShow();
  eq(sb.elements.get('paytableBetValue').textContent, '• 1.00');
  sb.window.__SLOT_BET__ = 5.00;
  sb.HookBus.emit('onBetChanged', { newBet: 5.00 });
  eq(sb.elements.get('paytableBetValue').textContent, '• 5.00');
});

t('sandbox: onBetChanged is no-op when modal closed', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.__SLOT_BET__ = 1.00;
  /* Do NOT call paytableShow — content stays empty. */
  sb.HookBus.emit('onBetChanged', { newBet: 2.00 });
  /* Content untouched. */
  eq(sb.elements.get('paytableContent').innerHTML, '');
});

t('sandbox: roster from model.symbols renders rows for HP+MP+LP', () => {
  const model = {
    symbols: {
      high: [{ id: 'H1', name: 'Diamond' }],
      mid:  [{ id: 'M1', name: 'Star' }],
      low:  [{ id: '10', name: 'Ten' }],
      specials: [],
    },
  };
  const sb = buildSandbox(defaultConfig(), model);
  sb.window.paytableShow();
  const html = sb.elements.get('paytableContent').innerHTML;
  ct(html, 'H1');
  ct(html, 'Diamond');
  ct(html, 'M1');
  ct(html, 'tier-HP');
  ct(html, 'tier-MP');
  ct(html, 'tier-LP');
});

t('sandbox: specials section rendered when symbols.specials non-empty', () => {
  const sb = buildSandbox(defaultConfig(), {
    symbols: { high: [], mid: [], low: [], specials: [{ id: 'W', name: 'Wild' }] },
  });
  sb.window.paytableShow();
  const html = sb.elements.get('paytableContent').innerHTML;
  ct(html, 'Special Symbols');
  ct(html, 'Wild');
});

t('sandbox: features list rendered when SHOW_FEATS=true + features present', () => {
  const sb = buildSandbox(defaultConfig(), {
    symbols: { high: [], mid: [], low: [], specials: [] },
    features: [{ kind: 'free_spins', label: 'Free Spins' }, { kind: 'tumble', label: 'Cascade' }],
  });
  sb.window.paytableShow();
  const html = sb.elements.get('paytableContent').innerHTML;
  ct(html, 'Free Spins');
  ct(html, 'Cascade');
});

t('sandbox: wild rules rendered when showWildRules=true + Wild symbol present', () => {
  const sb = buildSandbox(defaultConfig(), {
    symbols: { high: [], mid: [], low: [], specials: [{ id: 'W', name: 'Wild' }] },
  });
  sb.window.paytableShow();
  const html = sb.elements.get('paytableContent').innerHTML;
  ct(html, 'Wild Rules');
  ct(html, 'substitutes');
});

t('sandbox: empty roster shows "No symbols" placeholder', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  ct(sb.elements.get('paytableContent').innerHTML, 'No symbols in GDD');
});

t('sandbox: close button receives focus after show (keyboard ergonomics)', () => {
  const sb = buildSandbox(defaultConfig(), {});
  sb.window.paytableShow();
  eq(sb.elements.get('paytableCloseBtn')._focused, true);
});

/* ── Hygiene ── */

t('determinism: same config + model → byte-identical CSS', () => {
  eq(emitPaytableCSS(defaultConfig()), emitPaytableCSS(defaultConfig()));
});

t('vendor-neutral: no vendor strings anywhere', () => {
  const all = emitPaytableCSS(defaultConfig()) +
              emitPaytableMarkup(defaultConfig()) +
              emitPaytableRuntime(defaultConfig(), {
                symbols: { high: [{id:'H', name:'High'}], mid: [], low: [], specials: [] }
              });
  for (const banned of ['gates','olympus','reactoonz','megaways','netent','wrath',
                        'sweet bonanza','pragmatic','microgaming','playa-slot']) {
    nct(all.toLowerCase(), banned, 'banned: ' + banned);
  }
});

console.log('\n--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
