/**
 * tests/blocks/tumble.test.mjs
 * Wave K2 — pure Node tests for tumble (cascade) block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitTumbleCSS,
  emitTumbleRuntime,
} from '../../src/blocks/tumble.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== tumble block ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default removeMs=280', d.removeMs === 280);
t('default gravityMs=320', d.gravityMs === 320);
t('default refillMs=260', d.refillMs === 260);
t('default chainPauseMs=180', d.chainPauseMs === 180);
t('default maxChain=16', d.maxChain === 16);
t('default preserveOrbs=true', d.preserveOrbs === true);

const r1 = resolveConfig({ topology: { cascade: { enabled: true } } });
t('auto-enable from topology.cascade', r1.enabled === true);

const r2 = resolveConfig({
  topology: { cascade: { enabled: true } },
  tumble: { removeMs: 500, gravityMs: 400, refillMs: 300, chainPauseMs: 100, maxChain: 8, preserveOrbs: false },
});
t('override removeMs', r2.removeMs === 500);
t('override gravityMs', r2.gravityMs === 400);
t('override refillMs', r2.refillMs === 300);
t('override chainPauseMs', r2.chainPauseMs === 100);
t('override maxChain', r2.maxChain === 8);
t('override preserveOrbs=false', r2.preserveOrbs === false);

const r3 = resolveConfig({
  topology: { cascade: { enabled: true } },
  tumble: { removeMs: 1, gravityMs: 99999, maxChain: 100 },
});
t('clamp removeMs >=50', r3.removeMs === 50);
t('clamp gravityMs <=2000', r3.gravityMs === 2000);
t('clamp maxChain <=64', r3.maxChain === 64);

const cssOff = emitTumbleCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');

const css = emitTumbleCSS(resolveConfig({ topology: { cascade: { enabled: true } } }));
t('CSS has tumbleRemove keyframe', css.includes('@keyframes tumbleRemove'));
t('CSS has tumbleDrop keyframe', css.includes('@keyframes tumbleDrop'));
t('CSS has is-removing class', css.includes('.cell.is-removing'));
t('CSS has is-dropping class', css.includes('.cell.is-dropping'));
t('CSS has is-refilling class', css.includes('.cell.is-refilling'));
t('CSS bakes removeMs literal', css.includes('280ms ease-out'));
t('CSS reduced-motion gate', css.includes('prefers-reduced-motion'));

const stub = emitTumbleRuntime(defaultConfig());
t('runtime stub returns Promise', stub.includes('Promise.resolve'));

const rt = emitTumbleRuntime(resolveConfig({ topology: { cascade: { enabled: true } } }));
t('runtime declares runTumbleChain', rt.includes('async function runTumbleChain'));
t('runtime bakes TUMBLE_REMOVE_MS', rt.includes('TUMBLE_REMOVE_MS   = 280'));
t('runtime bakes TUMBLE_MAX_CHAIN', rt.includes('TUMBLE_MAX_CHAIN   = 16'));
t('runtime exposes on window', rt.includes('window.runTumbleChain'));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
