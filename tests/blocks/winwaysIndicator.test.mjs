/**
 * tests/blocks/winwaysIndicator.test.mjs
 *
 * Wave B66 — Win-Ways Indicator block contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitWinwaysIndicatorCSS,
  emitWinwaysIndicatorMarkup,
  emitWinwaysIndicatorRuntime,
} from '../../src/blocks/winwaysIndicator.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/winwaysIndicator.mjs');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
}

console.log('winwaysIndicator block contract');

const def = defaultConfig();
check('defaultConfig is frozen', Object.isFrozen(def));
check('defaultConfig.enabled false by default', def.enabled === false);
check('defaultConfig.waysCount = 243', def.waysCount === 243);

const resolvedExplicit = resolveConfig({ winwaysIndicator: { enabled: true, waysCount: 1024 } });
check('explicit enabled honoured', resolvedExplicit.enabled === true);
check('explicit waysCount honoured', resolvedExplicit.waysCount === 1024);

const resolvedAuto = resolveConfig({ waysEval: { waysCount: 4096 } });
check('auto-enable when waysEval declared', resolvedAuto.enabled === true);
check('waysCount derived from waysEval', resolvedAuto.waysCount === 4096);

const resolvedNoFeature = resolveConfig({});
check('stays disabled when no waysEval + no explicit', resolvedNoFeature.enabled === false);

const cfgOn = resolveConfig({ winwaysIndicator: { enabled: true, waysCount: 117649 } });
const css = emitWinwaysIndicatorCSS(cfgOn);
check('CSS non-empty when enabled', css.length > 0);
check('CSS has .winways-chip rule', /\.winways-chip\s*\{/.test(css));
check('CSS has data-flash variant', /\[data-flash="true"\]/.test(css));
check('CSS has prefers-reduced-motion guard', /prefers-reduced-motion/.test(css));

const markup = emitWinwaysIndicatorMarkup(cfgOn);
check('markup non-empty when enabled', markup.length > 0);
check('markup uses {N} template substitution', /117649 WAYS/.test(markup));
check('markup has role="status"', /role="status"/.test(markup));
check('markup has aria-live="polite"', /aria-live="polite"/.test(markup));
check('markup has aria-label', /aria-label="/.test(markup));

const runtime = emitWinwaysIndicatorRuntime(cfgOn);
check('runtime non-empty when enabled', runtime.length > 0);
check('runtime registers HookBus listener', /HookBus\.on/.test(runtime));
check('runtime listens to onSpinResult', /onSpinResult/.test(runtime));
check('runtime listens to preSpin', /preSpin/.test(runtime));
check('runtime references winwaysChip element', /winwaysChip/.test(runtime));

check('CSS empty when disabled', emitWinwaysIndicatorCSS(defaultConfig()) === '');
check('markup empty when disabled', emitWinwaysIndicatorMarkup(defaultConfig()) === '');
check('runtime empty when disabled', emitWinwaysIndicatorRuntime(defaultConfig()) === '');

const css1 = emitWinwaysIndicatorCSS(cfgOn);
const css2 = emitWinwaysIndicatorCSS(cfgOn);
check('determinism: same config → byte-identical CSS', css1 === css2);

const src = readFileSync(SRC_PATH, 'utf8').toLowerCase();
const VENDORS = ['gates of olympus', 'wrath of olympus', 'megaways', 'netent', 'microgaming', 'pragmatic'];
let vendorHit = '';
for (const v of VENDORS) { if (src.includes(v)) { vendorHit = v; break; } }
check('source: vendor-neutral', vendorHit === '');

console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
