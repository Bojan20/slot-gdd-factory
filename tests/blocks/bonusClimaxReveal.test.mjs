/**
 * tests/blocks/bonusClimaxReveal.test.mjs — Wave H6 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitBonusClimaxRevealCSS,
  emitBonusClimaxRevealMarkup,
  emitBonusClimaxRevealRuntime,
} from '../../src/blocks/bonusClimaxReveal.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/bonusClimaxReveal.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('bonusClimaxReveal block contract');

const def = defaultConfig();
t('defaultConfig frozen',                     Object.isFrozen(def));
t('default enabled = true',                   def.enabled === true);
t('default durationMs = 1400',                def.durationMs === 1400);
t('default fontSizePx = 56',                  def.fontSizePx === 56);
t('default zIndex = 24',                      def.zIndex === 24);
t('labelMap has free_spins',                  def.labelMap.free_spins === 'FREE SPINS!');
t('labelMap has wheel',                       def.labelMap.wheel === 'WHEEL!');
t('labelMap has bonus_buy',                   def.labelMap.bonus_buy === 'BONUS!');
t('labelMap has hold_and_win',                def.labelMap.hold_and_win === 'HOLD & SPIN!');
t('labelMap has jackpot',                     def.labelMap.jackpot === 'JACKPOT!');
t('labelMap has generic fallback',            def.labelMap.generic === 'BONUS!');

const r1 = resolveConfig({ bonusClimaxReveal: { durationMs: 99999 } });
t('durationMs clamped to ceiling 4000',       r1.durationMs === 4000);
const r2 = resolveConfig({ bonusClimaxReveal: { durationMs: 1 } });
t('durationMs clamped to floor 400',          r2.durationMs === 400);
const r3 = resolveConfig({ bonusClimaxReveal: { fontSizePx: 1000 } });
t('fontSizePx clamped to ceiling 96',         r3.fontSizePx === 96);
const r4 = resolveConfig({ bonusClimaxReveal: { fontSizePx: 1 } });
t('fontSizePx clamped to floor 24',           r4.fontSizePx === 24);
const r5 = resolveConfig({ bonusClimaxReveal: { enabled: false } });
t('enabled=false honoured',                   r5.enabled === false);
const r6 = resolveConfig({ bonusClimaxReveal: { labelMap: { free_spins: 'FS!' } } });
t('labelMap free_spins override merged',      r6.labelMap.free_spins === 'FS!');
const r7 = resolveConfig({ bonusClimaxReveal: { labelMap: { free_spins: '<script>X' } } });
t('labelMap XSS chars stripped',              !r7.labelMap.free_spins.includes('<'));
const r8 = resolveConfig({ bonusClimaxReveal: { labelMap: { bogus_kind: 'X' } } });
t('labelMap invalid kind rejected',           !('bogus_kind' in r8.labelMap));
const r9 = resolveConfig({ bonusClimaxReveal: { autoEmitOnFsTrigger: false } });
t('autoEmitOnFsTrigger=false honoured',       r9.autoEmitOnFsTrigger === false);

t('CSS disabled = empty',  emitBonusClimaxRevealCSS({ ...def, enabled: false }) === '');
const css = emitBonusClimaxRevealCSS(def);
t('CSS has .bonus-climax selector',           css.includes('.bonus-climax'));
t('CSS sets z-index from cfg',                css.includes(`z-index: ${def.zIndex};`));
t('CSS data-visible="true" reveal rule',      css.includes('.bonus-climax[data-visible="true"]'));
t('CSS bonus-climax-burst keyframe',          css.includes('@keyframes bonus-climax-pulse'));
t('CSS prefers-reduced-motion gate',          css.includes('prefers-reduced-motion'));

t('markup disabled = empty', emitBonusClimaxRevealMarkup({ ...def, enabled: false }) === '');
const m = emitBonusClimaxRevealMarkup(def);
t('markup has bonusClimaxOverlay id',         m.includes('id="bonusClimaxOverlay"'));
t('markup has role=alert',                    m.includes('role="alert"'));
t('markup has aria-live=assertive',           m.includes('aria-live="assertive"'));
t('markup has aria-hidden=true initially',    m.includes('aria-hidden="true"'));
t('markup has label span',                    m.includes('id="bonusClimaxLabel"'));
t('markup has sub span',                      m.includes('id="bonusClimaxSub"'));

const rtDisabled = emitBonusClimaxRevealRuntime({ ...def, enabled: false });
t('runtime disabled = empty',                 rtDisabled === '');

const rt = emitBonusClimaxRevealRuntime(def);
t('runtime guards typeof window',             rt.includes('typeof window'));
t('runtime listens onFsTrigger',              rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onWheelSegmentChosen',     rt.includes("HookBus.on('onWheelSegmentChosen'"));
t('runtime listens onBonusBuyTierSelected',   rt.includes("HookBus.on('onBonusBuyTierSelected'"));
t('runtime listens onCreditBucketRespinStart',rt.includes("HookBus.on('onCreditBucketRespinStart'"));
t('runtime listens onDailyJackpotAward',      rt.includes("HookBus.on('onDailyJackpotAward'"));
t('runtime listens onSkipRequested',          rt.includes("HookBus.on('onSkipRequested'"));
t('runtime emits onBonusClimaxStart literal', rt.includes("HookBus.emit('onBonusClimaxStart'"));
t('runtime emits onBonusClimaxEnd literal',   rt.includes("HookBus.emit('onBonusClimaxEnd'"));
t('runtime exposes bonusClimaxFire API',      rt.includes('window.bonusClimaxFire'));
t('runtime exposes bonusClimaxHide API',      rt.includes('window.bonusClimaxHide'));

/* Sandbox runtime exec — use fake-timer to test auto-hide path. */
function makeSb() {
  const listeners = {};
  const emits = [];
  const overlay = { _attrs: { 'data-visible': 'false', 'aria-hidden': 'true' },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  };
  const labelEl = { textContent: '' };
  const subEl   = { textContent: '' };
  const document = {
    getElementById(id) {
      if (id === 'bonusClimaxOverlay') return overlay;
      if (id === 'bonusClimaxLabel') return labelEl;
      if (id === 'bonusClimaxSub') return subEl;
      return null;
    },
  };
  const timers = [];
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  /* Inject fake timer harness via globals exposed to the runtime closure. */
  const setTimeoutImpl = (cb, ms) => { const id = timers.length; timers.push({ cb, ms, cancelled: false }); return id; };
  const clearTimeoutImpl = (id) => { if (timers[id]) timers[id].cancelled = true; };
  return { window, document, overlay, labelEl, subEl, listeners, emits, timers, setTimeoutImpl, clearTimeoutImpl };
}

function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', 'clearTimeout', emitBonusClimaxRevealRuntime(cfg));
  fn(sb.window, sb.document, sb.setTimeoutImpl, sb.clearTimeoutImpl);
}

const sb1 = makeSb();
runRt(def, sb1);
t('sandbox: onFsTrigger listener registered',     !!sb1.listeners.onFsTrigger);
t('sandbox: onSkipRequested listener registered', !!sb1.listeners.onSkipRequested);

// Fire FS trigger
sb1.listeners.onFsTrigger[0]();
t('sandbox: overlay visible after FS trigger',    sb1.overlay.getAttribute('data-visible') === 'true');
t('sandbox: aria-hidden=false when visible',      sb1.overlay.getAttribute('aria-hidden') === 'false');
t('sandbox: label text = FREE SPINS!',            sb1.labelEl.textContent === 'FREE SPINS!');
const startEmits = sb1.emits.filter(e => e.ev === 'onBonusClimaxStart');
t('sandbox: onBonusClimaxStart emitted once',     startEmits.length === 1);
t('sandbox: onBonusClimaxStart payload.kind',     startEmits[0].p.kind === 'free_spins');

// Player skip kills it
sb1.listeners.onSkipRequested[0]();
t('sandbox: overlay hidden after skip',           sb1.overlay.getAttribute('data-visible') === 'false');
const endEmits = sb1.emits.filter(e => e.ev === 'onBonusClimaxEnd');
t('sandbox: onBonusClimaxEnd emitted with reason=skipped',
  endEmits.length === 1 && endEmits[0].p.reason === 'skipped');

// Phase-filtered skip should NOT kill non-matching phase
const sb2 = makeSb();
runRt(def, sb2);
sb2.listeners.onWheelSegmentChosen[0]();
t('sandbox: wheel auto-fire',                     sb2.overlay.getAttribute('data-visible') === 'true');
sb2.listeners.onSkipRequested[0]({ phase: 'fsIntro' });
t('sandbox: phase=fsIntro skip ignored',          sb2.overlay.getAttribute('data-visible') === 'true');
sb2.listeners.onSkipRequested[0]({ phase: 'bonusClimax' });
t('sandbox: phase=bonusClimax skip honoured',     sb2.overlay.getAttribute('data-visible') === 'false');

// Auto-emit toggle off — should NOT register the listener
const sb3 = makeSb();
runRt(resolveConfig({ bonusClimaxReveal: { autoEmitOnFsTrigger: false } }), sb3);
t('sandbox: FS auto-emit OFF → no onFsTrigger listener', !sb3.listeners.onFsTrigger);

// Explicit API fire
const sb4 = makeSb();
runRt(def, sb4);
sb4.window.bonusClimaxFire('wheel', 'CUSTOM!');
t('sandbox: API fire wheel custom label',         sb4.labelEl.textContent === 'CUSTOM!');
sb4.window.bonusClimaxHide();
t('sandbox: API hide → visible=false',            sb4.overlay.getAttribute('data-visible') === 'false');

// Unknown kind falls back to generic
const sb5 = makeSb();
runRt(def, sb5);
sb5.window.bonusClimaxFire('totally-unknown');
t('sandbox: unknown kind → generic label',        sb5.labelEl.textContent === 'BONUS!');

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',                       !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
