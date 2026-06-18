/**
 * tests/blocks/jackpotRoomReveal.test.mjs — Wave LEGO-JRR contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitJackpotRoomRevealCSS,
  emitJackpotRoomRevealMarkup,
  emitJackpotRoomRevealRuntime,
  resolveRoomForCount,
  validateRoomLadder,
} from '../../src/blocks/jackpotRoomReveal.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH  = resolvePath(__dirname, '../../src/blocks/jackpotRoomReveal.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('\n=== jackpotRoomReveal block contract ===');

/* ── 1. defaultConfig ──────────────────────────────────────────── */
const d = defaultConfig();
t('defaultConfig frozen',        Object.isFrozen(d));
t('default disabled',            d.enabled === false);
t('default has 4 rooms',         Array.isArray(d.rooms) && d.rooms.length === 4);
t('default rooms monotone',      validateRoomLadder(d.rooms) === true);
t('default appliesIn = hw',      d.appliesIn === 'hw');
t('default revealAnimMs = 1500', d.revealAnimMs === 1500);
t('default autoDismissMs = 4000', d.autoDismissMs === 4000);
t('default showCTA = true',      d.showCTA === true);
t('default fontSizePx = 32',     d.fontSizePx === 32);

/* ── 2. resolveConfig ──────────────────────────────────────────── */
const r1 = resolveConfig({ jackpotRoomReveal: { enabled: true } });
t('resolveConfig: explicit enable',
  r1.enabled === true);

const r2 = resolveConfig({ jackpotRoomReveal: { enabled: true, rooms: 'not-an-array' } });
t('resolveConfig: rejects malformed rooms (string)',
  r2.rooms.length === 4 && r2.rooms[0].name === 'MINI');

const r3 = resolveConfig({ jackpotRoomReveal: { enabled: true, rooms: [{ name: 'A', threshold: 10, multX: 5 }, { name: 'B', threshold: 5, multX: 50 }] } });
t('resolveConfig: rejects non-monotone thresholds (falls back to default)',
  r3.rooms.length === 4 && r3.rooms[0].name === 'MINI');

const r4 = resolveConfig({ jackpotRoomReveal: { enabled: true, revealAnimMs: 99999, fontSizePx: 999 } });
t('resolveConfig: clamps revealAnimMs to max 3000', r4.revealAnimMs === 3000);
t('resolveConfig: clamps fontSizePx to max 64',     r4.fontSizePx   === 64);

const r4b = resolveConfig({ jackpotRoomReveal: { enabled: true, revealAnimMs: 1, fontSizePx: 1 } });
t('resolveConfig: clamps revealAnimMs to min 300',  r4b.revealAnimMs === 300);
t('resolveConfig: clamps fontSizePx to min 16',     r4b.fontSizePx   === 16);

const r5a = resolveConfig({ jackpotRoomReveal: { enabled: true, autoDismissMs: 0 } });
t('resolveConfig: autoDismissMs = 0 is allowed (off)', r5a.autoDismissMs === 0);
const r5b = resolveConfig({ jackpotRoomReveal: { enabled: true, autoDismissMs: 99999 } });
t('resolveConfig: clamps autoDismissMs to max 10000', r5b.autoDismissMs === 10000);

const r6a = resolveConfig({ jackpotRoomReveal: { enabled: true, appliesIn: 'bogus' } });
t('resolveConfig: rejects invalid appliesIn',
  r6a.appliesIn === 'hw');
const r6b = resolveConfig({ jackpotRoomReveal: { enabled: true, appliesIn: 'bonus' } });
t('resolveConfig: accepts appliesIn = bonus', r6b.appliesIn === 'bonus');
const r6c = resolveConfig({ jackpotRoomReveal: { enabled: true, appliesIn: 'both' } });
t('resolveConfig: accepts appliesIn = both',  r6c.appliesIn === 'both');

const r7 = resolveConfig({ jackpotRoomReveal: { enabled: true, placardColor: '#abcdef', ladderGlowColor: '#123' } });
t('resolveConfig: accepts valid hex placardColor',    r7.placardColor === '#abcdef');
t('resolveConfig: accepts valid hex ladderGlowColor', r7.ladderGlowColor === '#123');

const r7b = resolveConfig({ jackpotRoomReveal: { enabled: true, placardColor: 'red' } });
t('resolveConfig: rejects non-hex placardColor', r7b.placardColor === '#1a0a00');

/* ── 3. resolveRoomForCount ───────────────────────────────────── */
const ROOMS = d.rooms;
t('resolveRoomForCount: 0 → MINI',     resolveRoomForCount(ROOMS, 0).name === 'MINI');
t('resolveRoomForCount: 5 → MINOR',    resolveRoomForCount(ROOMS, 5).name === 'MINOR');
t('resolveRoomForCount: 10 → MAJOR',   resolveRoomForCount(ROOMS, 10).name === 'MAJOR');
t('resolveRoomForCount: 15 → GRAND',   resolveRoomForCount(ROOMS, 15).name === 'GRAND');
t('resolveRoomForCount: 100 → GRAND (cap)', resolveRoomForCount(ROOMS, 100).name === 'GRAND');
t('resolveRoomForCount: -5 → MINI (floor)', resolveRoomForCount(ROOMS, -5).name === 'MINI');
t('resolveRoomForCount: NaN → MINI (floor)', resolveRoomForCount(ROOMS, NaN).name === 'MINI');

/* ── 4. validateRoomLadder ────────────────────────────────────── */
t('validateRoomLadder: valid monotone → true',
  validateRoomLadder([{ name: 'A', threshold: 0, multX: 1 }, { name: 'B', threshold: 10, multX: 5 }]) === true);
t('validateRoomLadder: empty array → false',  validateRoomLadder([]) === false);
t('validateRoomLadder: non-array → false',    validateRoomLadder('nope') === false);
t('validateRoomLadder: non-monotone thresholds → false',
  validateRoomLadder([{ name: 'A', threshold: 10, multX: 1 }, { name: 'B', threshold: 5, multX: 5 }]) === false);
t('validateRoomLadder: non-monotone multX → false',
  validateRoomLadder([{ name: 'A', threshold: 0, multX: 100 }, { name: 'B', threshold: 10, multX: 5 }]) === false);
t('validateRoomLadder: missing name → false',
  validateRoomLadder([{ name: '', threshold: 0, multX: 1 }]) === false);

/* ── 5. emit CSS ──────────────────────────────────────────────── */
const cfgOn = resolveConfig({ jackpotRoomReveal: { enabled: true } });
const css   = emitJackpotRoomRevealCSS(cfgOn);
t('CSS contains .jrr-placard class', css.includes('.jrr-placard'));
t('CSS contains .jrr-ladder class',  css.includes('.jrr-ladder'));
t('CSS contains @keyframes',         css.includes('@keyframes'));
t('CSS contains prefers-reduced-motion guard', css.includes('prefers-reduced-motion'));
t('CSS empty (disabled stub) when disabled',   emitJackpotRoomRevealCSS(defaultConfig()).includes('disabled'));

/* ── 6. emit Markup ───────────────────────────────────────────── */
const mk = emitJackpotRoomRevealMarkup(cfgOn);
t('Markup contains placard wrapper id', mk.includes('id="jrrPlacard"'));
t('Markup contains ladder wrapper id',  mk.includes('id="jrrLadder"'));
t('Markup contains role="dialog"',      mk.includes('role="dialog"'));
t('Markup empty (disabled stub) when disabled', emitJackpotRoomRevealMarkup(defaultConfig()).includes('disabled'));

/* ── 7. emit Runtime ──────────────────────────────────────────── */
const rt = emitJackpotRoomRevealRuntime(cfgOn);
t('Runtime contains HookBus.on registration',  rt.includes('HookBus.on'));
t('Runtime subscribes onJackpotRoomTrigger',   rt.includes("'onJackpotRoomTrigger'"));
t('Runtime subscribes preSpin',                rt.includes("'preSpin'"));
t('Runtime subscribes onHoldAndWinEnd',        rt.includes("'onHoldAndWinEnd'"));
t('Runtime subscribes onSkipRequested',        rt.includes("'onSkipRequested'"));
t('Runtime emits onJackpotRoomRevealed',       rt.includes("'onJackpotRoomRevealed'"));
t('Runtime emits onJackpotRoomDismissed',      rt.includes("'onJackpotRoomDismissed'"));
t('Runtime contains HW guard (_isHwActive)',   rt.includes('_isHwActive'));
t('Runtime contains appliesIn branch',         rt.includes('APPLIES_IN'));
t('Runtime contains wired-once sentinel',      rt.includes('__JRR_WIRED__'));
t('Runtime exposes window.jrrDismiss',         rt.includes('window.jrrDismiss'));
t('Runtime exposes window.JRR_STATE',          rt.includes('window.JRR_STATE'));
t('Runtime empty (disabled stub) when disabled', emitJackpotRoomRevealRuntime(defaultConfig()).includes('disabled'));

/* ── 8. Determinism ───────────────────────────────────────────── */
t('determinism: same config → byte-identical CSS',
  emitJackpotRoomRevealCSS(cfgOn) === emitJackpotRoomRevealCSS(cfgOn));
t('determinism: same config → byte-identical runtime',
  emitJackpotRoomRevealRuntime(cfgOn) === emitJackpotRoomRevealRuntime(cfgOn));

/* ── 9. Vendor-neutrality ────────────────────────────────────── */
const src = readFileSync(SRC_PATH, 'utf8').toLowerCase();
const VENDORS = [
  'gates of olympus', 'wrath of olympus', 'cash eruption', 'wolf run',
  'cleopatra', 'buffalo', 'megaways', 'netent', 'microgaming',
  'pragmatic', 'igt', 'scientific games',
];
let hit = '';
for (const v of VENDORS) { if (src.includes(v)) { hit = v; break; } }
t('source: vendor-neutral', hit === '');

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
