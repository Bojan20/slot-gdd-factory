/**
 * tests/blocks/nudgeReel.test.mjs — Wave H17 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitNudgeReelCSS,
  emitNudgeReelMarkup,
  emitNudgeReelRuntime,
} from '../../src/blocks/nudgeReel.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/nudgeReel.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('nudgeReel block contract');

const def = defaultConfig();
t('defaultConfig frozen',                 Object.isFrozen(def));
t('default enabled = false (opt-in)',     def.enabled === false);
t('default offerMs = 6000',               def.offerMs === 6000);
t('default position = bottom-left',       def.position === 'bottom-left');
t('default chipLabel = NUDGE',            def.chipLabel === 'NUDGE');
t('default allowDuringFs = false',        def.allowDuringFs === false);
t('default autoDeclineOnSpin = true',     def.autoDeclineOnSpin === true);
t('defaultConfig returns fresh object',   defaultConfig() !== defaultConfig());

t('auto-enable when GDD declares block',  resolveConfig({ nudgeReel: {} }).enabled === true);
t('no key → disabled',                    resolveConfig({}).enabled === false);
t('explicit false stays disabled',        resolveConfig({ nudgeReel: { enabled: false } }).enabled === false);

const r1 = resolveConfig({ nudgeReel: { offerMs: 999999 } });
t('offerMs clamped to 30000 ceiling',     r1.offerMs === 30000);
const r2 = resolveConfig({ nudgeReel: { offerMs: 10 } });
t('offerMs clamped to 500 floor',         r2.offerMs === 500);
const r3 = resolveConfig({ nudgeReel: { position: 'middle' } });
t('position whitelist rejects bogus',     r3.position === 'bottom-left');
const r4 = resolveConfig({ nudgeReel: { position: 'top-right' } });
t('position top-right accepted',          r4.position === 'top-right');
const r5 = resolveConfig({ nudgeReel: { chipLabel: '<x>NUDGE' } });
t('chipLabel XSS chars stripped',         !r5.chipLabel.includes('<'));
const r6 = resolveConfig({ nudgeReel: { allowDuringFs: true } });
t('allowDuringFs true accepted',          r6.allowDuringFs === true);
const r7 = resolveConfig({ nudgeReel: { autoDeclineOnSpin: false } });
t('autoDeclineOnSpin false accepted',     r7.autoDeclineOnSpin === false);

const cssDis = emitNudgeReelCSS({ ...def, enabled: false });
t('CSS disabled = empty',                 cssDis === '');
const css = emitNudgeReelCSS({ ...def, enabled: true });
t('CSS .nudge-chip selector',             css.includes('.nudge-chip'));
t('CSS @keyframes nudge-pulse',           css.includes('@keyframes nudge-pulse'));
t('CSS prefers-reduced-motion gate',      css.includes('prefers-reduced-motion'));
t('CSS WCAG 44px touch target',           css.includes('min-width: 44px') && css.includes('min-height: 44px'));
t('CSS focus-visible outline',            css.includes(':focus-visible'));

const mDis = emitNudgeReelMarkup({ ...def, enabled: false });
t('markup disabled = empty',              mDis === '');
const mk = emitNudgeReelMarkup({ ...def, enabled: true });
t('markup #nudgeChip button present',     mk.includes('id="nudgeChip"'));
t('markup aria-label present',            mk.includes('aria-label='));
t('markup type=button (no form submit)',  mk.includes('type="button"'));

const rtDis = emitNudgeReelRuntime({ ...def, enabled: false });
t('runtime disabled = empty',             rtDis === '');
const rt = emitNudgeReelRuntime({ ...def, enabled: true });
t('runtime listens postSpin',             rt.includes("HookBus.on('postSpin'"));
t('runtime listens preSpin',              rt.includes("HookBus.on('preSpin'"));
t('runtime listens onFsTrigger',          rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd',              rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onNudgeOffered',         rt.includes("HookBus.emit('onNudgeOffered'"));
t('runtime emits onNudgeAccepted',        rt.includes("HookBus.emit('onNudgeAccepted'"));
t('runtime emits onNudgeDeclined',        rt.includes("HookBus.emit('onNudgeDeclined'"));
t('runtime emits onNudgeResolved',        rt.includes("HookBus.emit('onNudgeResolved'"));
t('runtime exposes window.nudgeOffer',    rt.includes('window.nudgeOffer'));
t('runtime exposes window.nudgeAccept',   rt.includes('window.nudgeAccept'));
t('runtime exposes window.nudgeDecline',  rt.includes('window.nudgeDecline'));
t('runtime exposes window.nudgeStatus',   rt.includes('window.nudgeStatus'));

/* --- Sandbox --- */
function makeSb() {
  const listeners = {};
  const emits = [];
  function makeEl() {
    return {
      _attrs: {}, _handlers: {}, _kids: [], textContent: '', nodeType: 1, className: '',
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
      addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
      querySelector(sel) {
        const want = sel.replace(/^\./, '');
        return this._kids.find(k => k.className === want) || null;
      },
    };
  }
  const chip = makeEl();
  const dirSpan = makeEl(); dirSpan.className = 'nudge-dir';
  chip._kids.push(dirSpan);
  const document = {
    getElementById(id) { return id === 'nudgeChip' ? chip : null; },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, chip, dirSpan };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', 'clearTimeout', emitNudgeReelRuntime(cfg));
  fn(sb.window, sb.document, () => 1, () => {});
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered',         !!sb1.listeners.postSpin);

sb1.listeners.postSpin[0]();
t('sandbox: no offer → CTA hidden',        sb1.chip.getAttribute('data-visible') !== 'true');

sb1.window.__NUDGE_OFFER__ = { reel: 2, direction: 'up', reason: 'near-miss' };
sb1.listeners.postSpin[0]();
const offered = sb1.emits.filter(e => e.ev === 'onNudgeOffered');
t('sandbox: onNudgeOffered emitted',       offered.length === 1 && offered[0].p.reel === 2);
t('sandbox: CTA visible after offer',      sb1.chip.getAttribute('data-visible') === 'true');
t('sandbox: direction arrow ↑',            sb1.dirSpan.textContent === '↑');

sb1.emits.length = 0;
sb1.window.nudgeAccept();
const accepted = sb1.emits.filter(e => e.ev === 'onNudgeAccepted');
const resolved = sb1.emits.filter(e => e.ev === 'onNudgeResolved');
t('sandbox: onNudgeAccepted emitted',      accepted.length === 1 && accepted[0].p.reel === 2);
t('sandbox: onNudgeResolved emitted',      resolved.length === 1 && resolved[0].p.outcome === 'accepted');
t('sandbox: CTA hidden after accept',      sb1.chip.getAttribute('data-visible') === 'false');

const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
sb2.window.__NUDGE_OFFER__ = { reel: 0, direction: 'down', reason: 'near-miss' };
sb2.listeners.postSpin[0]();
sb2.emits.length = 0;
sb2.window.nudgeDecline('user');
const declined = sb2.emits.filter(e => e.ev === 'onNudgeDeclined');
t('sandbox: onNudgeDeclined emitted',      declined.length === 1 && declined[0].p.reason === 'user');
t('sandbox: down arrow ↓',                 sb2.dirSpan.textContent === '↓');

const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.__NUDGE_OFFER__ = { reel: 1, direction: 'up' };
sb3.listeners.postSpin[0]();
sb3.emits.length = 0;
sb3.listeners.preSpin[0]();
const autoDec = sb3.emits.filter(e => e.ev === 'onNudgeDeclined');
t('sandbox: preSpin auto-declines',        autoDec.length === 1 && autoDec[0].p.reason === 'preSpin');

const sb4 = makeSb();
runRt({ ...def, enabled: true }, sb4);
sb4.listeners.onFsTrigger[0]();
sb4.window.__NUDGE_OFFER__ = { reel: 3, direction: 'up' };
sb4.listeners.postSpin[0]();
t('sandbox: offer suppressed during FS',   sb4.chip.getAttribute('data-visible') !== 'true');

const sb5 = makeSb();
runRt({ ...def, enabled: true, allowDuringFs: true }, sb5);
sb5.listeners.onFsTrigger[0]();
sb5.window.__NUDGE_OFFER__ = { reel: 4, direction: 'up' };
sb5.listeners.postSpin[0]();
t('sandbox: allowDuringFs=true shows CTA in FS', sb5.chip.getAttribute('data-visible') === 'true');

const sb6 = makeSb();
runRt({ ...def, enabled: true }, sb6);
sb6.window.__NUDGE_OFFER__ = { reel: 1, direction: 'down' };
sb6.listeners.postSpin[0]();
const st = sb6.window.nudgeStatus();
t('sandbox: nudgeStatus returns snapshot', st && st.reel === 1 && st.direction === 'down');
sb6.window.nudgeAccept();
t('sandbox: nudgeStatus null after accept', sb6.window.nudgeStatus() === null);

const sb7 = makeSb();
runRt({ ...def, enabled: true }, sb7);
sb7.window.nudgeOffer(2, 'up', 'manual');
const offeredApi = sb7.emits.filter(e => e.ev === 'onNudgeOffered');
t('sandbox: nudgeOffer API emits',         offeredApi.length === 1 && offeredApi[0].p.source === 'api');

const sb8 = makeSb();
runRt({ ...def, enabled: true }, sb8);
sb8.window.__NUDGE_OFFER__ = { reel: 0, direction: 'up' };
sb8.listeners.postSpin[0]();
sb8.emits.length = 0;
const handler = sb8.chip._handlers.click && sb8.chip._handlers.click[0];
t('sandbox: chip wires click listener',    typeof handler === 'function');
if (typeof handler === 'function') handler();
const clickAcc = sb8.emits.filter(e => e.ev === 'onNudgeAccepted');
t('sandbox: chip click → onNudgeAccepted', clickAcc.length === 1);

const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(\bIGT\b|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',                !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
