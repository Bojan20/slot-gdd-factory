/**
 * tests/blocks/achievementToast.test.mjs · LEGO-PROG (DEF1 · 3/3)
 */
import {
  defaultConfig, resolveConfig,
  emitAchievementToastCSS, emitAchievementToastMarkup, emitAchievementToastRuntime,
} from '../../src/blocks/achievementToast.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== achievementToast (LEGO-PROG DEF1 · 3/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label LEVEL UP', d.label === 'LEVEL UP');
t('default visibleMs 3500', d.visibleMs === 3500);
t('default maxQueue 3', d.maxQueue === 3);
t('default badgeEmoji set', typeof d.badgeEmoji === 'string' && d.badgeEmoji.length > 0);

const r1 = resolveConfig({ features: [{ kind: 'achievement_toast' }] });
t('auto-enable achievement_toast', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'level_up_toast' }] });
t('auto-enable level_up_toast alias', r1b.enabled === true);
const r1c = resolveConfig({ features: [{ kind: 'player_xp' }] });
t('auto-enable via player_xp complement', r1c.enabled === true);

const r2 = resolveConfig({
  achievementToast: { enabled: true, label: 'BADGE', visibleMs: 5000, maxQueue: 5 },
});
t('explicit enable honored', r2.enabled === true);
t('override label', r2.label === 'BADGE');
t('override visibleMs', r2.visibleMs === 5000);
t('override maxQueue', r2.maxQueue === 5);

const rClamp = resolveConfig({
  achievementToast: { enabled: true, visibleMs: 99999, maxQueue: 999 },
});
t('clamp visibleMs ≤ 30000', rClamp.visibleMs === 30000);
t('clamp maxQueue ≤ 10', rClamp.maxQueue === 10);

const css = emitAchievementToastCSS(r1);
t('CSS empty when disabled', emitAchievementToastCSS(defaultConfig()) === '');
t('CSS has stack class', css.includes('.achievement-toast-stack'));
t('CSS has toast class', css.includes('.achievement-toast'));
t('CSS has badge class', css.includes('.at-badge'));
t('CSS has title class', css.includes('.at-title'));
t('CSS has focus-visible', css.includes('focus-visible'));
t('CSS has reduced-motion', css.includes('prefers-reduced-motion'));
t('CSS has mobile media', css.includes('@media (max-width: 620px)'));

const markup = emitAchievementToastMarkup(r1);
t('markup empty when disabled', emitAchievementToastMarkup(defaultConfig()) === '');
t('markup has role=alert', markup.includes('role="alert"'));
t('markup has aria-live=assertive', markup.includes('aria-live="assertive"'));
t('markup has aria-atomic=true', markup.includes('aria-atomic="true"'));
t('markup has stack element', markup.includes('id="achievementToastStack"'));

const rt = emitAchievementToastRuntime(r1);
t('runtime stub disabled', emitAchievementToastRuntime(defaultConfig()).includes('disabled'));
t('runtime declares AT_VISIBLE_MS', rt.includes('AT_VISIBLE_MS'));
t('runtime declares AT_MAX_QUEUE', rt.includes('AT_MAX_QUEUE'));
t('runtime has makeToast function', rt.includes('function makeToast'));
t('runtime has show function', rt.includes('function show'));
t('runtime has dismissOldest function', rt.includes('function dismissOldest'));
t('runtime has rewardText helper', rt.includes('function rewardText'));
t('runtime listens onPlayerLevelUp', rt.includes("HookBus.on('onPlayerLevelUp'"));
t('runtime listens onAchievementUnlocked', rt.includes("HookBus.on('onAchievementUnlocked'"));
t('runtime emits onAchievementToastShown', rt.includes('onAchievementToastShown'));
t('runtime emits onAchievementToastDismissed', rt.includes('onAchievementToastDismissed'));
t('runtime keyboard handles Escape', rt.includes("e.key === 'Escape'"));
t('runtime handles 4 reward kinds',
  rt.includes("'credit'") && rt.includes("'fs_trigger'") &&
  rt.includes("'multiplier'") && rt.includes("'boost'"));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
