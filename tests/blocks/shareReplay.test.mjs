/**
 * tests/blocks/shareReplay.test.mjs · LEGO-SOCIAL (B-5 · 2/2)
 */
import {
  defaultConfig, resolveConfig,
  emitShareReplayCSS, emitShareReplayMarkup, emitShareReplayRuntime,
} from '../../src/blocks/shareReplay.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== shareReplay (LEGO-SOCIAL B-5 · 2/2) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label SHARE WIN', d.label === 'SHARE WIN');
t('default tokenHostPrefix is https', d.tokenHostPrefix.startsWith('https://'));

const r1 = resolveConfig({ features: [{ kind: 'share_replay' }] });
t('auto-enable share_replay', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'share_win' }] });
t('auto-enable share_win alias', r1b.enabled === true);

const r2 = resolveConfig({
  shareReplay: { enabled: true, label: 'SHARE', tokenHostPrefix: 'https://example.org/r#' },
});
t('explicit enable honored', r2.enabled === true);
t('override label', r2.label === 'SHARE');
t('override tokenHostPrefix', r2.tokenHostPrefix === 'https://example.org/r#');

const rBad = resolveConfig({
  shareReplay: { enabled: true, tokenHostPrefix: 'javascript:alert(1)' },
});
t('reject non-http(s) tokenHostPrefix', rBad.tokenHostPrefix.startsWith('https://share.example'));

const cssOff = emitShareReplayCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');
const css = emitShareReplayCSS(r1);
t('CSS has button class', css.includes('.share-replay-btn'));
t('CSS has toast class', css.includes('.share-replay-toast'));
t('CSS has focus-visible', css.includes('focus-visible'));
t('CSS has reduced-motion', css.includes('prefers-reduced-motion'));

const markup = emitShareReplayMarkup(r1);
t('markup empty when disabled', emitShareReplayMarkup(defaultConfig()) === '');
t('markup has share button', markup.includes('id="shareReplayBtn"'));
t('markup has toast', markup.includes('id="shareReplayToast"'));
t('markup has role=status on toast', markup.includes('role="status"'));
t('markup has aria-live=polite', markup.includes('aria-live="polite"'));

const rt = emitShareReplayRuntime(r1);
t('runtime stub when disabled', emitShareReplayRuntime(defaultConfig()).includes('disabled'));
t('runtime has buildToken function', rt.includes('function buildToken'));
t('runtime has buildUrl function', rt.includes('function buildUrl'));
t('runtime has showToast function', rt.includes('function showToast'));
t('runtime calls navigator.share', rt.includes('navigator.share'));
t('runtime falls back to clipboard', rt.includes('navigator.clipboard'));
t('runtime emits onShareReplayInvoked', rt.includes('onShareReplayInvoked'));
t('runtime listens onBigWinTierEnter', rt.includes("HookBus.on('onBigWinTierEnter'"));
t('runtime listens onBigWinTierExit', rt.includes("HookBus.on('onBigWinTierExit'"));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime reads __SPIN_HISTORY__ for frame', rt.includes('__SPIN_HISTORY__'));
t('runtime uses base64 (btoa)', rt.includes('btoa'));
t('runtime keyboard handles Escape', rt.includes("e.key === 'Escape'"));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
