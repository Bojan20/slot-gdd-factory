/**
 * tests/blocks/jackpotLadderRooms.test.mjs — Wave H13 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitJackpotLadderRoomsCSS, emitJackpotLadderRoomsMarkup, emitJackpotLadderRoomsRuntime,
} from '../../src/blocks/jackpotLadderRooms.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/jackpotLadderRooms.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('jackpotLadderRooms block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default labels MINI/MINOR/MAJOR/GRAND', def.labels.MINI === 'MINI' && def.labels.GRAND === 'GRAND');
t('default showAmount = true', def.showAmount === true);

t('auto-enable on GDD declare', resolveConfig({ jackpotLadderRooms: {} }).enabled === true);
const r1 = resolveConfig({ jackpotLadderRooms: { labels: { MINI: '<X>tiny', BOGUS: 'X' } } });
t('labels MINI XSS stripped',     !r1.labels.MINI.includes('<'));
t('labels invalid tier rejected', !('BOGUS' in r1.labels));
const r2 = resolveConfig({ jackpotLadderRooms: { position: 'middle' } });
t('position whitelist rejects middle', r2.position === 'top-right');

t('CSS disabled empty', emitJackpotLadderRoomsCSS({ ...def, enabled: false }) === '');
const css = emitJackpotLadderRoomsCSS({ ...def, enabled: true });
t('CSS .jp-ladder selector',           css.includes('.jp-ladder'));
t('CSS .jp-room selector',             css.includes('.jp-room'));
t('CSS @keyframes jp-room-pulse',      css.includes('@keyframes jp-room-pulse'));
t('CSS prefers-reduced-motion gate',   css.includes('prefers-reduced-motion'));

const m = emitJackpotLadderRoomsMarkup({ ...def, enabled: true });
t('markup id=jpLadder',                m.includes('id="jpLadder"'));
t('markup role=group',                 m.includes('role="group"'));
t('markup has 4 rooms (MINI/MINOR/MAJOR/GRAND)',
  m.includes('data-tier="MINI"') && m.includes('data-tier="MINOR"') &&
  m.includes('data-tier="MAJOR"') && m.includes('data-tier="GRAND"'));

t('runtime disabled empty', emitJackpotLadderRoomsRuntime({ ...def, enabled: false }) === '');
const rt = emitJackpotLadderRoomsRuntime({ ...def, enabled: true });
t('runtime listens onJackpotRoomEnter',    rt.includes("HookBus.on('onJackpotRoomEnter'"));
t('runtime listens onJackpotRoomWin',      rt.includes("HookBus.on('onJackpotRoomWin'"));
t('runtime listens preSpin',               rt.includes("HookBus.on('preSpin'"));
t('runtime emits onJackpotRoomEntered',    rt.includes("HookBus.emit('onJackpotRoomEntered'"));
t('runtime emits onJackpotRoomWon',        rt.includes("HookBus.emit('onJackpotRoomWon'"));
t('runtime emits onJackpotRoomExit',       rt.includes("HookBus.emit('onJackpotRoomExit'"));
t('runtime exposes jpRoomEnter API',       rt.includes('window.jpRoomEnter'));
t('runtime exposes jpRoomWin API',         rt.includes('window.jpRoomWin'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const roomEls = ['MINI', 'MINOR', 'MAJOR', 'GRAND'].reduce((acc, tier) => {
    acc[tier] = { _attrs: { 'data-tier': tier, 'data-active': 'false' }, textContent: tier,
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
    };
    return acc;
  }, {});
  const document = {
    querySelector(sel) {
      const m = sel.match(/data-tier="([A-Z]+)"/);
      return m ? roomEls[m[1]] : null;
    },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, roomEls };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitJackpotLadderRoomsRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered', !!sb1.listeners.onJackpotRoomEnter);

sb1.window.jpRoomEnter('GRAND');
t('sandbox: GRAND room active', sb1.roomEls.GRAND.getAttribute('data-active') === 'true');
const entered = sb1.emits.filter(e => e.ev === 'onJackpotRoomEntered');
t('sandbox: onJackpotRoomEntered emitted with tier=GRAND',
  entered.length === 1 && entered[0].p.tier === 'GRAND');

sb1.window.jpRoomWin('MINI', 100);
t('sandbox: jpRoomWin emit onJackpotRoomWon',
  sb1.emits.some(e => e.ev === 'onJackpotRoomWon' && e.p.tier === 'MINI' && e.p.amount === 100));

sb1.listeners.preSpin[0]();
t('sandbox: preSpin clears all active rooms',
  Object.values(sb1.roomEls).every(el => el.getAttribute('data-active') === 'false'));

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
