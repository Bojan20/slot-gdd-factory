/**
 * tests/blocks/playerXp.test.mjs · LEGO-PROG (DEF1 · 1/3)
 */
import {
  defaultConfig, resolveConfig,
  emitPlayerXpCSS, emitPlayerXpMarkup, emitPlayerXpRuntime,
} from '../../src/blocks/playerXp.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== playerXp (LEGO-PROG DEF1 · 1/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default xpPerBetUnit 1', d.xpPerBetUnit === 1);
t('default xpPerCoin 2', d.xpPerCoin === 2);
t('default maxXpPerSpin 50', d.maxXpPerSpin === 50);
t('default pauseDuringFs false', d.pauseDuringFs === false);
t('default 5 levels', d.levels.length === 5);
t('first level threshold 100', d.levels[0].threshold === 100);
t('last level threshold 2000', d.levels[4].threshold === 2000);
t('frozen levels', Object.isFrozen(d.levels));

const r1 = resolveConfig({ features: [{ kind: 'player_xp' }] });
t('auto-enable player_xp', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'session_xp' }] });
t('auto-enable session_xp alias', r1b.enabled === true);
const r1c = resolveConfig({ features: [{ kind: 'player_progression' }] });
t('auto-enable player_progression alias', r1c.enabled === true);

const r2 = resolveConfig({
  playerXp: { enabled: true, xpPerBetUnit: 5, xpPerCoin: 10, maxXpPerSpin: 100, pauseDuringFs: true },
});
t('explicit enable honored', r2.enabled === true);
t('override xpPerBetUnit', r2.xpPerBetUnit === 5);
t('override xpPerCoin', r2.xpPerCoin === 10);
t('override maxXpPerSpin', r2.maxXpPerSpin === 100);
t('override pauseDuringFs', r2.pauseDuringFs === true);

const rClamp = resolveConfig({
  playerXp: { enabled: true, xpPerBetUnit: 9999, maxXpPerSpin: 9999999 },
});
t('clamp xpPerBetUnit ≤ 1000', rClamp.xpPerBetUnit === 1000);
t('clamp maxXpPerSpin ≤ 100000', rClamp.maxXpPerSpin === 100000);

const rLvl = resolveConfig({
  playerXp: { enabled: true, levels: [
    { id: 'b', threshold: 500, rewardKind: 'fs_trigger', rewardValue: 5 },
    { id: 'a', threshold: 100, rewardKind: 'credit', rewardValue: 10 },
    { id: 'a', threshold: 200, rewardKind: 'credit', rewardValue: 20 },
  ]},
});
t('levels sorted ascending', rLvl.levels[0].threshold === 100 && rLvl.levels[1].threshold === 500);
t('dedupes duplicate ids', rLvl.levels.length === 2);

const rBad = resolveConfig({
  playerXp: { enabled: true, levels: [
    { id: 'x', threshold: -50, rewardKind: 'invalid', rewardValue: 'oops' },
    { id: 'y', threshold: 999999999, rewardKind: 'multiplier', rewardValue: 2 },
  ]},
});
t('clamp threshold ≥ 1', rBad.levels[0].threshold === 1);
t('clamp threshold ≤ 1M', rBad.levels[1].threshold === 1000000);
t('invalid rewardKind falls back', rBad.levels[0].rewardKind === 'credit');

const css = emitPlayerXpCSS(r1);
t('CSS empty when disabled', emitPlayerXpCSS(defaultConfig()) === '');
t('CSS has live region sr-only', css.includes('.player-xp-live'));

const markup = emitPlayerXpMarkup(r1);
t('markup empty when disabled', emitPlayerXpMarkup(defaultConfig()) === '');
t('markup has live region', markup.includes('id="playerXpLive"'));
t('markup has role=status', markup.includes('role="status"'));
t('markup has aria-live=polite', markup.includes('aria-live="polite"'));

const rt = emitPlayerXpRuntime(r1);
t('runtime stub disabled', emitPlayerXpRuntime(defaultConfig()).includes('disabled'));
t('runtime declares PXP_PER_BET', rt.includes('PXP_PER_BET'));
t('runtime declares PXP_PER_COIN', rt.includes('PXP_PER_COIN'));
t('runtime declares PXP_MAX_PER_SPIN', rt.includes('PXP_MAX_PER_SPIN'));
t('runtime declares PXP_LEVELS array', rt.includes('PXP_LEVELS'));
t('runtime exposes __PLAYER_XP__', rt.includes('__PLAYER_XP__'));
t('runtime has getLevel function', rt.includes('function getLevel'));
t('runtime has nextThreshold function', rt.includes('function nextThreshold'));
t('runtime has award function', rt.includes('function award'));
t('runtime emits onPlayerXpGained', rt.includes('onPlayerXpGained'));
t('runtime emits onPlayerLevelUp', rt.includes('onPlayerLevelUp'));
t('runtime listens onSpinResult', rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onCoinCollected', rt.includes("HookBus.on('onCoinCollected'"));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime reads window.BET_UNITS', rt.includes('window.BET_UNITS'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
