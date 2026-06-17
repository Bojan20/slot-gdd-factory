/**
 * tests/blocks/nudgeReel.test.mjs — Wave H17 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitNudgeReelCSS, emitNudgeReelMarkup, emitNudgeReelRuntime,
} from '../../src/blocks/nudgeReel.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/nudgeReel.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('nudgeReel block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default offerMs = 6000', def.offerMs === 6000);
t('default allowDuringFs = false', def.allowDuringFs === false);
t('default autoDeclineOnSpin = true', def.autoDeclineOnSpin === true);

t('auto-enable on GDD declare', resolveConfig({ nudgeReel: {} }).enabled === true);
const r1 = resolveConfig({ nudgeReel: { position: 'wonky' } });
t('position whitelist rejects wonky', r1.position === 'bottom-left');
const r2 = resolveConfig({ nudgeReel: { position: 'top-right' } });
t('position top-right accepted', r2.position === 'top-right');
const r3 = resolveConfig({ nudgeReel: { offerMs: 99999 } });
t('offerMs clamped to ceiling 30000', r3.offerMs === 30000);
const r4 = resolveConfig({ nudgeReel: { chipLabel: '<X>NUDGE' } });
t('chipLabel XSS stripped', !r4.chipLabel.includes('<'));

t('CSS disabled empty', emitNudgeReelCSS({ ...def, enabled: false }) === '');
const css = emitNudgeReelCSS({ ...def, enabled: true });
t('CSS .nudge-chip selector', css.includes('.nudge-chip'));
t('CSS keyframes nudge-pulse', css.includes('@keyframes nudge-pulse'));
t('CSS focus-visible outline', css.includes(':focus-visible'));
t('CSS WCAG 44x44 touch target', css.includes('min-width: 44px') && css.includes('min-height: 44px'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

t('markup disabled empty', emitNudgeReelMarkup({ ...def, enabled: false }) === '');
const m = emitNudgeReelMarkup({ ...def, enabled: true });
t('markup id=nudgeChip',     m.includes('id="nudgeChip"'));
t('markup type=button',      m.includes('type="button"'));
t('markup aria-label',       m.includes('aria-label='));

t('runtime disabled empty', emitNudgeReelRuntime({ ...def, enabled: false }) === '');
const rt = emitNudgeReelRuntime({ ...def, enabled: true });
t('runtime listens postSpin',   rt.includes("HookBus.on('postSpin'"));
t('runtime listens preSpin',    rt.includes("HookBus.on('preSpin'"));
t('runtime listens onFsTrigger',rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd',    rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onNudgeOffered',  rt.includes("HookBus.emit('onNudgeOffered'"));
t('runtime emits onNudgeAccepted', rt.includes("HookBus.emit('onNudgeAccepted'"));
t('runtime emits onNudgeDeclined', rt.includes("HookBus.emit('onNudgeDeclined'"));
t('runtime emits onNudgeResolved', rt.includes("HookBus.emit('onNudgeResolved'"));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const dirSpan = { textContent: '↑' };
  const txtSpan = { textContent: 'NUDGE' };
  const chip = {
    _attrs: { 'data-visible': 'false' },
    _handler: null,
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    addEventListener(ev, h) { if (ev === 'click') this._handler = h; },
    querySelector(sel) {
      if (sel === '.nudge-dir')  return dirSpan;
      if (sel === '.nudge-text') return txtSpan;
      return null;
    },
  };
  const document = { getElementById(id) { return id === 'nudgeChip' ? chip : null; } };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, chip };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', 'clearTimeout', emitNudgeReelRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0, () => {});
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered', !!sb1.listeners.postSpin);

// Engine offers nudge via window.__NUDGE_OFFER__
sb1.window.__NUDGE_OFFER__ = { reel: 0, direction: 'up', reason: 'nearMiss' };
sb1.listeners.postSpin[0]();
const offered = sb1.emits.filter(e => e.ev === 'onNudgeOffered');
t('sandbox: postSpin reads __NUDGE_OFFER__ + emits onNudgeOffered',
  offered.length === 1 && offered[0].p.reel === 0 && offered[0].p.direction === 'up');
t('sandbox: chip visible after offer', sb1.chip.getAttribute('data-visible') === 'true');

// Player clicks chip → accept
sb1.chip._handler && sb1.chip._handler();
const accepted = sb1.emits.filter(e => e.ev === 'onNudgeAccepted');
const resolved = sb1.emits.filter(e => e.ev === 'onNudgeResolved');
t('sandbox: chip click emits onNudgeAccepted', accepted.length === 1 && accepted[0].p.reel === 0);
t('sandbox: chip click emits onNudgeResolved outcome=accepted',
  resolved.length === 1 && resolved[0].p.outcome === 'accepted');
t('sandbox: chip hidden after accept', sb1.chip.getAttribute('data-visible') === 'false');

// preSpin with auto-decline clears pending offer
const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
sb2.window.__NUDGE_OFFER__ = { reel: 1, direction: 'down', reason: 'nearMiss' };
sb2.listeners.postSpin[0]();
sb2.listeners.preSpin[0]();
const declined = sb2.emits.filter(e => e.ev === 'onNudgeDeclined');
t('sandbox: preSpin (autoDeclineOnSpin=true) emits onNudgeDeclined', declined.length === 1);

// FS trigger hides chip
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.__NUDGE_OFFER__ = { reel: 0, direction: 'up', reason: 'nearMiss' };
sb3.listeners.postSpin[0]();
sb3.listeners.onFsTrigger[0]();
t('sandbox: onFsTrigger hides chip (allowDuringFs=false)', sb3.chip.getAttribute('data-visible') === 'false');

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
