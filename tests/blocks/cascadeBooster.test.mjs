/**
 * tests/blocks/cascadeBooster.test.mjs — Wave H15 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitCascadeBoosterCSS, emitCascadeBoosterMarkup, emitCascadeBoosterRuntime,
} from '../../src/blocks/cascadeBooster.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/cascadeBooster.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('cascadeBooster block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default ladder = [1,2,3,5,10]', JSON.stringify(def.ladder) === '[1,2,3,5,10]');
t('default requireStepWin = true', def.requireStepWin === true);
t('default hideAtBase = true',     def.hideAtBase === true);

t('auto-enable on GDD declare', resolveConfig({ cascadeBooster: {} }).enabled === true);
const r1 = resolveConfig({ cascadeBooster: { ladder: [10, 5, 1] } });
t('ladder monotonic drops non-monotonic entries → only 10 kept (single) → default kept (need ≥ 2)',
  JSON.stringify(r1.ladder) === '[1,2,3,5,10]');
const r2 = resolveConfig({ cascadeBooster: { ladder: [1, 1, 2, 4, 4] } });
t('ladder same-step allowed (≥ kept)', r2.ladder.length === 5);
const r3 = resolveConfig({ cascadeBooster: { position: 'middle' } });
t('position whitelist rejects middle', r3.position === 'bottom-left');

t('CSS disabled empty', emitCascadeBoosterCSS({ ...def, enabled: false }) === '');
const css = emitCascadeBoosterCSS({ ...def, enabled: true });
t('CSS .cb-chip selector',             css.includes('.cb-chip'));
t('CSS @keyframes cb-chip-pulse',      css.includes('@keyframes cb-chip-pulse'));
t('CSS prefers-reduced-motion gate',   css.includes('prefers-reduced-motion'));

const m = emitCascadeBoosterMarkup({ ...def, enabled: true });
t('markup id=cbChip',                  m.includes('id="cbChip"'));
t('markup role=status',                m.includes('role="status"'));

t('runtime disabled empty', emitCascadeBoosterRuntime({ ...def, enabled: false }) === '');
const rt = emitCascadeBoosterRuntime({ ...def, enabled: true });
t('runtime listens preSpin',           rt.includes("HookBus.on('preSpin'"));
t('runtime listens onTumbleStep',      rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsEnd',           rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onCascadeBoosterTick',  rt.includes("HookBus.emit('onCascadeBoosterTick'"));
t('runtime emits onCascadeBoosterReset', rt.includes("HookBus.emit('onCascadeBoosterReset'"));
t('runtime exposes cascadeBoosterBump API', rt.includes('window.cascadeBoosterBump'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const chip = { _attrs: { 'data-visible': 'false', 'data-bumping': 'false', 'data-mult': '1' }, textContent: 'BOOST ×1',
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  };
  const document = { getElementById(id) { return id === 'cbChip' ? chip : null; } };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, chip };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitCascadeBoosterRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered', !!sb1.listeners.preSpin);

// Tumble with win → bump
sb1.listeners.onTumbleStep[0]({ stepWin: 50 });
t('sandbox: tumble win bumps to mult=2', sb1.chip.getAttribute('data-mult') === '2');
const ticks = sb1.emits.filter(e => e.ev === 'onCascadeBoosterTick');
t('sandbox: onCascadeBoosterTick emitted', ticks.length === 1 && ticks[0].p.depth === 1);

// Tumble without win → no bump
sb1.listeners.onTumbleStep[0]({ stepWin: 0 });
t('sandbox: requireStepWin=true blocks bump on 0-win tumble', sb1.chip.getAttribute('data-mult') === '2');

// preSpin resets
sb1.listeners.preSpin[0]();
t('sandbox: preSpin resets to mult=1', sb1.chip.getAttribute('data-mult') === '1');
const resets = sb1.emits.filter(e => e.ev === 'onCascadeBoosterReset');
t('sandbox: onCascadeBoosterReset emitted', resets.length === 1);

// requireStepWin=false bumps on any tumble
const sb2 = makeSb();
runRt({ ...def, enabled: true, requireStepWin: false }, sb2);
sb2.listeners.onTumbleStep[0]({ stepWin: 0 });
t('sandbox: requireStepWin=false bumps regardless of win', sb2.chip.getAttribute('data-mult') === '2');

// onFsEnd resets
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.cascadeBoosterBump();
sb3.listeners.onFsEnd[0]();
t('sandbox: onFsEnd resets', sb3.chip.getAttribute('data-mult') === '1');

const state = sb3.window.cascadeBoosterGet();
t('sandbox: API get → mult=1 after reset', state.mult === 1 && state.depth === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
