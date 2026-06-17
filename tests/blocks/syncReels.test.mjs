/**
 * tests/blocks/syncReels.test.mjs — Wave H19 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitSyncReelsCSS, emitSyncReelsMarkup, emitSyncReelsRuntime,
} from '../../src/blocks/syncReels.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/syncReels.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('syncReels block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default detectMinReels = 2', def.detectMinReels === 2);
t('default autoDetect = true', def.autoDetect === true);

t('auto-enable on GDD declare', resolveConfig({ syncReels: {} }).enabled === true);
const r1 = resolveConfig({ syncReels: { detectMinReels: 99 } });
t('detectMinReels clamped to 12 ceiling', r1.detectMinReels === 12);
const r2 = resolveConfig({ syncReels: { flashColor: '<X>red' } });
t('flashColor XSS stripped', !r2.flashColor.includes('<'));

const css = emitSyncReelsCSS({ ...def, enabled: true });
t('CSS [data-synced=true] selector', css.includes('[data-synced="true"]'));
t('CSS keyframes sync-reels-pulse',  css.includes('@keyframes sync-reels-pulse'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const rt = emitSyncReelsRuntime({ ...def, enabled: true });
t('runtime listens preSpin',        rt.includes("HookBus.on('preSpin'"));
t('runtime listens onSpinResult',   rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onTumbleStep',   rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsSpinResult', rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime emits onReelsSynced',       rt.includes("HookBus.emit('onReelsSynced'"));
t('runtime emits onSyncReelsCleared',  rt.includes("HookBus.emit('onSyncReelsCleared'"));
t('runtime exposes syncReelsMark API', rt.includes('window.syncReelsMark'));
t('runtime exposes syncReelsClear API',rt.includes('window.syncReelsClear'));

/* Sandbox */
function makeSb(reelSigs) {
  const listeners = {};
  const emits = [];
  const reels = reelSigs.map(([idx, syms]) => {
    const cells = syms.map(s => ({ getAttribute(k) { return k === 'data-sym' ? s : null; } }));
    return {
      _attrs: { 'data-reel': String(idx), 'data-synced': 'false' },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      querySelectorAll() { return cells; },
    };
  });
  const document = {
    querySelectorAll(sel) {
      if (sel === '.reel-column[data-reel], .reel[data-reel]') return reels;
      return [];
    },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, reels };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', emitSyncReelsRuntime(cfg));
  fn(sb.window, sb.document);
}

// 2 reels with identical signatures
const sb1 = makeSb([[0, ['W', 'H1', 'M2']], [1, ['W', 'H1', 'M2']], [2, ['L1', 'L2', 'L3']]]);
runRt({ ...def, enabled: true }, sb1);
sb1.listeners.onSpinResult[0]();
const syncs = sb1.emits.filter(e => e.ev === 'onReelsSynced');
t('sandbox: onReelsSynced emitted for matching reels',
  syncs.length === 1 && syncs[0].p.reels.length === 2 && syncs[0].p.reels.includes(0) && syncs[0].p.reels.includes(1));
t('sandbox: reel 0 marked synced', sb1.reels[0].getAttribute('data-synced') === 'true');
t('sandbox: reel 2 NOT synced',    sb1.reels[2].getAttribute('data-synced') === 'false');

// preSpin clears
sb1.listeners.preSpin[0]();
t('sandbox: preSpin clears sync flag', sb1.reels[0].getAttribute('data-synced') === 'false');

// 3 reels matching
const sb2 = makeSb([[0, ['W', 'W']], [1, ['W', 'W']], [2, ['W', 'W']]]);
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onSpinResult[0]();
const syncs2 = sb2.emits.filter(e => e.ev === 'onReelsSynced');
t('sandbox: 3-reel match also emits',
  syncs2.length === 1 && syncs2[0].p.reels.length === 3);

// detectMinReels = 3 blocks 2-reel match
const sb3 = makeSb([[0, ['W', 'W']], [1, ['W', 'W']]]);
runRt({ ...def, enabled: true, detectMinReels: 3 }, sb3);
sb3.listeners.onSpinResult[0]();
const syncs3 = sb3.emits.filter(e => e.ev === 'onReelsSynced');
t('sandbox: detectMinReels=3 blocks 2-reel match', syncs3.length === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
