/**
 * tests/blocks/multiplierLadder.test.mjs — Wave B67 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitMultiplierLadderCSS,
  emitMultiplierLadderMarkup,
  emitMultiplierLadderRuntime,
} from '../../src/blocks/multiplierLadder.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/multiplierLadder.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('multiplierLadder block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default disabled', def.enabled === false);
t('default steps = [1,2,3,5,10]', JSON.stringify(def.steps) === '[1,2,3,5,10]');
t('default startTier = 0', def.startTier === 0);

const r1 = resolveConfig({ persistentMultiplier: { enabled: true } });
t('auto-enable on persistentMultiplier', r1.enabled === true);

const r2 = resolveConfig({ multiplierLadder: { enabled: true, steps: [1, 3, 9, 27] } });
t('explicit enable + custom steps', r2.enabled === true && r2.steps.length === 4 && r2.steps[3] === 27);

const r3 = resolveConfig({ multiplierLadder: { enabled: true, steps: ['x', -1, 2, 0, 4] } });
t('steps cleaner drops non-numeric + negative + zero', JSON.stringify(r3.steps) === '[2,4]');

const r4 = resolveConfig({ multiplierLadder: { enabled: true, startTier: 99 } });
t('startTier clamped to max index', r4.startTier === r4.steps.length - 1);

const r5 = resolveConfig({});
t('stays disabled when no trigger', r5.enabled === false);

const cfgOn = resolveConfig({ multiplierLadder: { enabled: true } });
const css = emitMultiplierLadderCSS(cfgOn);
t('CSS non-empty when enabled', css.length > 0);
t('CSS has .mult-ladder rule', /\.mult-ladder\s*\{/.test(css));
t('CSS has data-visible variant', /\[data-visible="true"\]/.test(css));
t('CSS has data-step flash variant', /\[data-step="true"\]/.test(css));
t('CSS has prefers-reduced-motion guard', /prefers-reduced-motion/.test(css));

const markup = emitMultiplierLadderMarkup(cfgOn);
t('markup non-empty when enabled', markup.length > 0);
t('markup id=multLadder', /id="multLadder"/.test(markup));
t('markup role="status"', /role="status"/.test(markup));
t('markup aria-live="polite"', /aria-live="polite"/.test(markup));
t('markup aria-label present', /aria-label="/.test(markup));
t('markup initial label "×1"', /×1</.test(markup));
t('markup starts hidden (data-visible=false)', /data-visible="false"/.test(markup));

const runtime = emitMultiplierLadderRuntime(cfgOn);
t('runtime non-empty when enabled', runtime.length > 0);
t('runtime registers HookBus.on', /HookBus\.on/.test(runtime));
t('runtime listens to onFsTrigger', /onFsTrigger/.test(runtime));
t('runtime listens to onFsSpinResult', /onFsSpinResult/.test(runtime));
t('runtime listens to onTumbleStep', /onTumbleStep/.test(runtime));
t('runtime listens to onFsEnd', /onFsEnd/.test(runtime));
t('runtime listens to onMultChange', /onMultChange/.test(runtime));
t('runtime emits onMultLadderStep', /onMultLadderStep/.test(runtime));
t('runtime emits onMultLadderReset', /onMultLadderReset/.test(runtime));

t('CSS empty when disabled', emitMultiplierLadderCSS(defaultConfig()) === '');
t('markup empty when disabled', emitMultiplierLadderMarkup(defaultConfig()) === '');
t('runtime empty when disabled', emitMultiplierLadderRuntime(defaultConfig()) === '');

const a = emitMultiplierLadderCSS(cfgOn);
const b = emitMultiplierLadderCSS(cfgOn);
t('determinism: same config → byte-identical CSS', a === b);

const src = readFileSync(SRC_PATH, 'utf8').toLowerCase();
const VENDORS = ['gates of olympus', 'wrath of olympus', 'megaways', 'netent', 'microgaming', 'pragmatic'];
let hit = '';
for (const v of VENDORS) { if (src.includes(v)) { hit = v; break; } }
t('source: vendor-neutral', hit === '');

console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
