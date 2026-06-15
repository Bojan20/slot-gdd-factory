/**
 * tests/blocks/energyMeter.test.mjs — Wave B73 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitEnergyMeterCSS,
  emitEnergyMeterMarkup,
  emitEnergyMeterRuntime,
} from '../../src/blocks/energyMeter.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/energyMeter.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('energyMeter block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default disabled', def.enabled === false);
t('default capacity = 10', def.capacity === 10);
t('default perStep = 1', def.perStep === 1);
t('default fillOn = "win"', def.fillOn === 'win');
t('default position top-left', def.position === 'top-left');

t('auto-enable on energyMeter', resolveConfig({ energyMeter: { enabled: true } }).enabled === true);
t('stays disabled without trigger', resolveConfig({}).enabled === false);

const r1 = resolveConfig({ energyMeter: { enabled: true, capacity: 25, perStep: 3, fillOn: 'tumble' } });
t('capacity honoured', r1.capacity === 25);
t('perStep honoured', r1.perStep === 3);
t('fillOn whitelist accepts tumble', r1.fillOn === 'tumble');

const rBad = resolveConfig({ energyMeter: { enabled: true, fillOn: 'invalid', capacity: 99999, perStep: -1 } });
t('fillOn invalid falls back to default', rBad.fillOn === 'win');
t('capacity clamped to upper bound', rBad.capacity === 999);
t('perStep clamped to lower bound', rBad.perStep === 1);

const r2 = resolveConfig({ energyMeter: { enabled: true, fillOn: 'scatter', scatterSymbol: 'W' } });
t('scatter strategy + custom symbol', r2.fillOn === 'scatter' && r2.scatterSymbol === 'W');

const cfgOn = resolveConfig({ energyMeter: { enabled: true } });
const css = emitEnergyMeterCSS(cfgOn);
t('CSS non-empty when enabled', css.length > 0);
t('CSS has .energy-meter rule', /\.energy-meter\s*\{/.test(css));
t('CSS has .em-fill rule', /\.em-fill\s*\{/.test(css));
t('CSS has data-visible variant', /\[data-visible="true"\]/.test(css));
t('CSS has data-full variant', /\[data-full="true"\]/.test(css));
t('CSS has prefers-reduced-motion guard', /prefers-reduced-motion/.test(css));

const markup = emitEnergyMeterMarkup(cfgOn);
t('markup non-empty when enabled', markup.length > 0);
t('markup id=energyMeter', /id="energyMeter"/.test(markup));
t('markup role="progressbar"', /role="progressbar"/.test(markup));
t('markup aria-valuemin/max/now', /aria-valuemin="0"/.test(markup) && /aria-valuemax="10"/.test(markup) && /aria-valuenow="0"/.test(markup));
t('markup aria-label present', /aria-label="/.test(markup));
t('markup starts hidden', /data-visible="false"/.test(markup));
t('markup initial label "ENERGY 0/10"', /ENERGY 0\/10/.test(markup));
t('markup has em-label and em-fill spans', /em-label/.test(markup) && /em-fill/.test(markup));

const runtime = emitEnergyMeterRuntime(cfgOn);
t('runtime non-empty when enabled', runtime.length > 0);
t('runtime registers HookBus.on', /HookBus\.on/.test(runtime));
t('runtime listens to preSpin', /preSpin/.test(runtime));
t('runtime listens to onSpinResult', /onSpinResult/.test(runtime));
t('runtime listens to onTumbleStep', /onTumbleStep/.test(runtime));
t('runtime listens to onEnergyTick', /onEnergyTick/.test(runtime));
t('runtime listens to onFsEnd', /onFsEnd/.test(runtime));
t('runtime emits onEnergyChange', /onEnergyChange/.test(runtime));
t('runtime emits onEnergyFull', /onEnergyFull/.test(runtime));
t('runtime bakes capacity into CAP constant', /CAP\s*=\s*10/.test(runtime));
t('runtime bakes perStep into PER constant', /PER\s*=\s*1/.test(runtime));

t('CSS empty when disabled', emitEnergyMeterCSS(defaultConfig()) === '');
t('markup empty when disabled', emitEnergyMeterMarkup(defaultConfig()) === '');
t('runtime empty when disabled', emitEnergyMeterRuntime(defaultConfig()) === '');

const a = emitEnergyMeterCSS(cfgOn);
const b = emitEnergyMeterCSS(cfgOn);
t('determinism: same config → byte-identical CSS', a === b);

const src = readFileSync(SRC_PATH, 'utf8').toLowerCase();
const VENDORS = ['gates of olympus', 'wrath of olympus', 'megaways', 'netent', 'microgaming', 'pragmatic', 'sweet bonanza', 'cleopatra', 'buffalo'];
let hit = '';
for (const v of VENDORS) { if (src.includes(v)) { hit = v; break; } }
t('source: vendor-neutral', hit === '');

console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
