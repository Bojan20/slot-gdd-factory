/**
 * tests/blocks/retriggerEscalator.test.mjs — Wave H30 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitRetriggerEscalatorCSS, emitRetriggerEscalatorMarkup, emitRetriggerEscalatorRuntime,
} from '../../src/blocks/retriggerEscalator.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/retriggerEscalator.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('retriggerEscalator block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default fsLadder = [5,8,12,20]', JSON.stringify(def.fsLadder) === '[5,8,12,20]');
t('default hideAtBase = true', def.hideAtBase === true);

t('auto-enable on GDD declare', resolveConfig({ retriggerEscalator: {} }).enabled === true);
const r1 = resolveConfig({ retriggerEscalator: { fsLadder: [5, 8, 3, 20] } });
t('fsLadder monotonic enforce drops bad entries', r1.fsLadder.length === 3 /* 5,8,20 */);
const r2 = resolveConfig({ retriggerEscalator: { fsLadder: [5] } });
t('fsLadder too short → default kept', JSON.stringify(r2.fsLadder) === '[5,8,12,20]');
const r3 = resolveConfig({ retriggerEscalator: { labelTemplate: '<X>FS' } });
t('labelTemplate XSS stripped', !r3.labelTemplate.includes('<'));

const css = emitRetriggerEscalatorCSS({ ...def, enabled: true });
t('CSS .re-badge selector', css.includes('.re-badge'));
t('CSS keyframes re-badge-pulse', css.includes('@keyframes re-badge-pulse'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const m = emitRetriggerEscalatorMarkup({ ...def, enabled: true });
t('markup id=reBadge', m.includes('id="reBadge"'));
t('markup role=status', m.includes('role="status"'));
t('markup aria-live=polite', m.includes('aria-live="polite"'));

const rt = emitRetriggerEscalatorRuntime({ ...def, enabled: true });
t('runtime listens onFsTrigger',   rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsRetrigger', rt.includes("HookBus.on('onFsRetrigger'"));
t('runtime listens onFsEnd',       rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onRetriggerEscalated',      rt.includes("HookBus.emit('onRetriggerEscalated'"));
t('runtime emits onRetriggerEscalatorReset', rt.includes("HookBus.emit('onRetriggerEscalatorReset'"));
t('runtime exposes retriggerEscalatorGet API', rt.includes('window.retriggerEscalatorGet'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const badge = { _attrs: { 'data-visible': 'false', 'data-tier': '0', 'data-escalating': 'false' }, textContent: '+0 FS',
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  };
  const document = { getElementById(id) { return id === 'reBadge' ? badge : null; } };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, badge };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitRetriggerEscalatorRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
sb1.listeners.onFsTrigger[0]();
t('sandbox: onFsTrigger resets tier=0', sb1.badge.getAttribute('data-tier') === '0');

// 1st retrigger → tier 1, +5 FS
sb1.listeners.onFsRetrigger[0]();
const esc1 = sb1.emits.filter(e => e.ev === 'onRetriggerEscalated');
t('sandbox: 1st retrigger → tier 1, +5 FS',
  esc1.length === 1 && esc1[0].p.toTier === 1 && esc1[0].p.fsAdded === 5);

// 2nd retrigger → tier 2, +8 FS
sb1.listeners.onFsRetrigger[0]();
const esc2 = sb1.emits.filter(e => e.ev === 'onRetriggerEscalated');
t('sandbox: 2nd retrigger → tier 2, +8 FS',
  esc2.length === 2 && esc2[1].p.toTier === 2 && esc2[1].p.fsAdded === 8);

// 3rd → tier 3 +12, 4th → tier 4 +20 (max), 5th → still tier 4 +20
sb1.listeners.onFsRetrigger[0]();  // tier 3
sb1.listeners.onFsRetrigger[0]();  // tier 4
sb1.listeners.onFsRetrigger[0]();  // tier 5 → clamped to 4
const allEsc = sb1.emits.filter(e => e.ev === 'onRetriggerEscalated');
t('sandbox: 5th retrigger caps at last tier ladder value',
  allEsc[4].p.fsAdded === 20);

// Get API
const state = sb1.window.retriggerEscalatorGet();
t('sandbox: API get → tier and fs',
  state.tier === 5 && state.fs === 20 && state.totalFsAdded === (5 + 8 + 12 + 20 + 20));

// FS end resets
sb1.listeners.onFsEnd[0]();
const resets = sb1.emits.filter(e => e.ev === 'onRetriggerEscalatorReset');
t('sandbox: onFsEnd emits reset', resets.length === 1);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
