/**
 * tests/blocks/leaderboardChip.test.mjs · LEGO-SOCIAL (B-5 · 1/2)
 */
import {
  defaultConfig, resolveConfig,
  emitLeaderboardChipCSS, emitLeaderboardChipMarkup, emitLeaderboardChipRuntime,
} from '../../src/blocks/leaderboardChip.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== leaderboardChip (LEGO-SOCIAL B-5 · 1/2) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label RANK', d.label === 'RANK');
t('default topN 10', d.topN === 10);

const r1 = resolveConfig({ features: [{ kind: 'leaderboard' }] });
t('auto-enable leaderboard', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'session_leaderboard' }] });
t('auto-enable session_leaderboard alias', r1b.enabled === true);

const r2 = resolveConfig({ leaderboardChip: { enabled: true, label: 'TOP', topN: 5 } });
t('explicit enable honored', r2.enabled === true);
t('override label', r2.label === 'TOP');
t('override topN', r2.topN === 5);

const rClamp = resolveConfig({ leaderboardChip: { enabled: true, topN: 999 } });
t('clamp topN ≤ 50', rClamp.topN === 50);

const cssOff = emitLeaderboardChipCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');
const css = emitLeaderboardChipCSS(r1);
t('CSS has chip class', css.includes('.leaderboard-chip'));
t('CSS has panel class', css.includes('.leaderboard-chip-panel'));
t('CSS has backdrop class', css.includes('.leaderboard-chip-backdrop'));
t('CSS has focus-visible', css.includes('focus-visible'));
t('CSS has mobile media', css.includes('@media (max-width: 620px)'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));

const markup = emitLeaderboardChipMarkup(r1);
t('markup empty when disabled', emitLeaderboardChipMarkup(defaultConfig()) === '');
t('markup has chip button', markup.includes('id="leaderboardChip"'));
t('markup has panel', markup.includes('id="leaderboardPanel"'));
t('markup has role=dialog', markup.includes('role="dialog"'));
t('markup has aria-modal', markup.includes('aria-modal="true"'));
t('markup has aria-haspopup=dialog', markup.includes('aria-haspopup="dialog"'));

const rt = emitLeaderboardChipRuntime(r1);
t('runtime stub when disabled', emitLeaderboardChipRuntime(defaultConfig()).includes('disabled'));
t('runtime declares LBC_TOP_N', rt.includes('LBC_TOP_N'));
t('runtime has computeSelfRank function', rt.includes('function computeSelfRank'));
t('runtime has refresh function', rt.includes('function refresh'));
t('runtime emits onLeaderboardOpened', rt.includes('onLeaderboardOpened'));
t('runtime emits onLeaderboardClosed', rt.includes('onLeaderboardClosed'));
t('runtime emits onLeaderboardRankChanged', rt.includes('onLeaderboardRankChanged'));
t('runtime listens onCoinCollected', rt.includes("HookBus.on('onCoinCollected'"));
t('runtime listens onSpinResult', rt.includes("HookBus.on('onSpinResult'"));
t('runtime keyboard handles Escape', rt.includes("e.key === 'Escape'"));
t('runtime reads window.__COIN_COLLECT__', rt.includes('__COIN_COLLECT__'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
