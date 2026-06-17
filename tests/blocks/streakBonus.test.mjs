/**
 * tests/blocks/streakBonus.test.mjs — Wave H25 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitStreakBonusCSS, emitStreakBonusMarkup, emitStreakBonusRuntime,
} from '../../src/blocks/streakBonus.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/streakBonus.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('streakBonus block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default threshold = 5', def.threshold === 5);
t('default rewardKind = freeSpins', def.rewardKind === 'freeSpins');

t('auto-enable on GDD declare', resolveConfig({ streakBonus: {} }).enabled === true);
const r1 = resolveConfig({ streakBonus: { rewardKind: 'bogus' } });
t('rewardKind whitelist rejects bogus', r1.rewardKind === 'freeSpins');
const r2 = resolveConfig({ streakBonus: { rewardKind: 'multBump' } });
t('rewardKind multBump accepted', r2.rewardKind === 'multBump');
const r3 = resolveConfig({ streakBonus: { threshold: 999 } });
t('threshold clamped to 99 ceiling', r3.threshold === 99);

const css = emitStreakBonusCSS({ ...def, enabled: true });
t('CSS .streak-chip selector', css.includes('.streak-chip'));
t('CSS keyframes streak-full-pulse', css.includes('@keyframes streak-full-pulse'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const m = emitStreakBonusMarkup({ ...def, enabled: true });
t('markup id=streakChip', m.includes('id="streakChip"'));
t('markup role=status', m.includes('role="status"'));

const rt = emitStreakBonusRuntime({ ...def, enabled: true });
t('runtime listens onSpinResult', rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onFsEnd',      rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onStreakBump',         rt.includes("HookBus.emit('onStreakBump'"));
t('runtime emits onStreakBonusEarned',  rt.includes("HookBus.emit('onStreakBonusEarned'"));
t('runtime emits onStreakReset',        rt.includes("HookBus.emit('onStreakReset'"));
t('runtime exposes streakBonusGet API', rt.includes('window.streakBonusGet'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const chip = { _attrs: { 'data-visible': 'false', 'data-full': 'false', 'data-value': '0' }, textContent: '',
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  };
  const document = { getElementById(id) { return id === 'streakChip' ? chip : null; } };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, chip };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitStreakBonusRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);

// 3 winning spins → bump
sb1.listeners.onSpinResult[0]({ award: 100 });
sb1.listeners.onSpinResult[0]({ award: 50 });
sb1.listeners.onSpinResult[0]({ award: 25 });
const bumps = sb1.emits.filter(e => e.ev === 'onStreakBump');
t('sandbox: 3 wins → 3 bumps', bumps.length === 3);
t('sandbox: streak counter at 3', sb1.chip.getAttribute('data-value') === '3');

// Loss resets
sb1.listeners.onSpinResult[0]({ award: 0 });
const resets = sb1.emits.filter(e => e.ev === 'onStreakReset');
t('sandbox: loss resets streak', resets.length === 1 && sb1.chip.getAttribute('data-value') === '0');

// 5 wins → bonus earned
const sb2 = makeSb();
runRt({ ...def, enabled: true, threshold: 5 }, sb2);
for (let i = 0; i < 5; i++) sb2.listeners.onSpinResult[0]({ award: 100 });
const earned = sb2.emits.filter(e => e.ev === 'onStreakBonusEarned');
t('sandbox: reaching threshold fires onStreakBonusEarned',
  earned.length === 1 && earned[0].p.threshold === 5 && earned[0].p.kind === 'freeSpins');

// API
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.streakBonusBump();
sb3.window.streakBonusBump();
const state = sb3.window.streakBonusGet();
t('sandbox: API get returns streak state', state.streak === 2 && state.kind === 'freeSpins');

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
