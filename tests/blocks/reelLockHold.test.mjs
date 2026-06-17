/**
 * tests/blocks/reelLockHold.test.mjs — Wave H23 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitReelLockHoldCSS, emitReelLockHoldMarkup, emitReelLockHoldRuntime,
} from '../../src/blocks/reelLockHold.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/reelLockHold.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('reelLockHold block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default rounds = 3', def.rounds === 3);
t('default autoExtendOnFs = true', def.autoExtendOnFs === true);

t('auto-enable on GDD declare', resolveConfig({ reelLockHold: {} }).enabled === true);
const r1 = resolveConfig({ reelLockHold: { rounds: 99 } });
t('rounds clamped to 12 ceiling', r1.rounds === 12);
const r2 = resolveConfig({ reelLockHold: { badgeLabel: '<X>LOCKED' } });
t('badgeLabel XSS stripped', !r2.badgeLabel.includes('<'));

const css = emitReelLockHoldCSS({ ...def, enabled: true });
t('CSS [data-locked-hold=true] selector', css.includes('[data-locked-hold="true"]'));
t('CSS keyframes reel-lock-pulse', css.includes('@keyframes reel-lock-pulse'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const rt = emitReelLockHoldRuntime({ ...def, enabled: true });
t('runtime listens postSpin',     rt.includes("HookBus.on('postSpin'"));
t('runtime listens onFsTrigger',  rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd',      rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onReelLockStart', rt.includes("HookBus.emit('onReelLockStart'"));
t('runtime emits onReelLockEnd',   rt.includes("HookBus.emit('onReelLockEnd'"));
t('runtime emits onReelLockTick',  rt.includes("HookBus.emit('onReelLockTick'"));
t('runtime emits onReelLockCleared', rt.includes("HookBus.emit('onReelLockCleared'"));
t('runtime exposes reelLockHold API', rt.includes('window.reelLockHold'));
t('runtime exposes reelLockHoldClear', rt.includes('window.reelLockHoldClear'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const reels = [0, 1, 2].map(idx => ({ _attrs: { 'data-reel': String(idx), 'data-locked-hold': 'false', 'data-lock-label': '' },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  }));
  const document = {
    querySelector(sel) {
      const m = sel.match(/data-reel="(\d+)"/);
      return m ? reels.find(r => r.getAttribute('data-reel') === m[1]) || null : null;
    },
    querySelectorAll(sel) {
      if (sel.includes('locked-hold="true"')) return reels.filter(r => r.getAttribute('data-locked-hold') === 'true');
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
  const fn = new Function('window', 'document', emitReelLockHoldRuntime(cfg));
  fn(sb.window, sb.document);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
sb1.window.reelLockHold(0, 3);
t('sandbox: reel locked', sb1.reels[0].getAttribute('data-locked-hold') === 'true');
const starts = sb1.emits.filter(e => e.ev === 'onReelLockStart');
t('sandbox: onReelLockStart emitted', starts.length === 1 && starts[0].p.rounds === 3);

// 3 postSpin tickovi → lock isteka
sb1.listeners.postSpin[0]();
sb1.listeners.postSpin[0]();
sb1.listeners.postSpin[0]();
const ends = sb1.emits.filter(e => e.ev === 'onReelLockEnd');
t('sandbox: lock ends after 3 rounds', ends.length === 1 && ends[0].p.reel === 0);
t('sandbox: reel unlocked after end', sb1.reels[0].getAttribute('data-locked-hold') === 'false');

// Status API
const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
sb2.window.reelLockHold(1, 5);
const status = sb2.window.reelLockHoldStatus();
t('sandbox: status API returns active locks', status[1] === 5);

// Clear API
sb2.window.reelLockHoldClear();
const cleared = sb2.emits.filter(e => e.ev === 'onReelLockCleared');
t('sandbox: clear API emits cleared', cleared.length === 1);

// FS extend
const sb3 = makeSb();
runRt({ ...def, enabled: true, autoExtendOnFs: true, rounds: 3 }, sb3);
sb3.window.reelLockHold(2, 2);
sb3.listeners.onFsTrigger[0]();
const statusFs = sb3.window.reelLockHoldStatus();
t('sandbox: autoExtendOnFs bumps to ROUNDS', statusFs[2] === 3);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
