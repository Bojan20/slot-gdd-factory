/**
 * tests/blocks/progressiveFsRetriggerLadder.test.mjs
 *
 * Unit + emit-shape tests for `progressiveFsRetriggerLadder.mjs`.
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig,
  resolveConfig,
  emitProgressiveFsRetriggerLadderCSS,
  emitProgressiveFsRetriggerLadderMarkup,
  emitProgressiveFsRetriggerLadderRuntime,
  promoteRung,
} from '../../src/blocks/progressiveFsRetriggerLadder.mjs';

t('defaultConfig: disabled + 5-rung ladder', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  ok(Array.isArray(c.ladder));
  equal(c.ladder.length, 5);
  equal(c.ladder[0].multX, 1);
  equal(c.ladder[4].multX, 25);
  equal(c.ladderPosition, 'right');
  ok(c.fontSizePx >= 10 && c.fontSizePx <= 20);
  ok(c.pulseMs >= 200 && c.pulseMs <= 3000);
});

t('resolveConfig: enables on explicit true', () => {
  const c = resolveConfig({ progressiveFsRetriggerLadder: { enabled: true } });
  equal(c.enabled, true);
});

t('resolveConfig: clamps fontSizePx + pulseMs to bounds', () => {
  const c = resolveConfig({ progressiveFsRetriggerLadder: { fontSizePx: 999, pulseMs: 999999 } });
  ok(c.fontSizePx <= 20);
  ok(c.fontSizePx >= 10);
  ok(c.pulseMs <= 3000);
  ok(c.pulseMs >= 200);

  const c2 = resolveConfig({ progressiveFsRetriggerLadder: { fontSizePx: -50, pulseMs: -50 } });
  ok(c2.fontSizePx >= 10);
  ok(c2.pulseMs >= 200);
});

t('resolveConfig: rejects malformed ladder (non-monotone multX) → fallback to default', () => {
  const def = defaultConfig();
  const c = resolveConfig({
    progressiveFsRetriggerLadder: {
      ladder: [
        { rung: 0, multX: 10, label: 'A' },
        { rung: 1, multX:  2, label: 'B' }, /* non-monotone */
      ],
    },
  });
  equal(c.ladder.length, def.ladder.length);
  equal(c.ladder[0].multX, def.ladder[0].multX);
  equal(c.ladder[4].multX, def.ladder[4].multX);
});

t('resolveConfig: rejects empty ladder → fallback to default', () => {
  const def = defaultConfig();
  const c = resolveConfig({ progressiveFsRetriggerLadder: { ladder: [] } });
  equal(c.ladder.length, def.ladder.length);
});

t('resolveConfig: accepts valid hex activeColor + inactiveColor', () => {
  const c = resolveConfig({
    progressiveFsRetriggerLadder: {
      activeColor:   '#ff00aa',
      inactiveColor: '#222222',
    },
  });
  equal(c.activeColor,   '#ff00aa');
  equal(c.inactiveColor, '#222222');
});

t('promoteRung: 0 → 1 (normal)', () => {
  equal(promoteRung(0, 5), 1);
});

t('promoteRung: ladder length 5, currentRung 4 → 4 (cap)', () => {
  equal(promoteRung(4, 5), 4);
});

t('promoteRung: negative input → 0', () => {
  equal(promoteRung(-7, 5), 0);
});

t('emit CSS: contains .pfrl-rung class when enabled', () => {
  const css = emitProgressiveFsRetriggerLadderCSS(
    resolveConfig({ progressiveFsRetriggerLadder: { enabled: true } })
  );
  ok(css.includes('.pfrl-rung'));
  ok(css.includes('.pfrl-ladder'));
  ok(css.includes('@keyframes pfrl-promote'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emit CSS: empty when disabled', () => {
  const css = emitProgressiveFsRetriggerLadderCSS(resolveConfig({}));
  ok(css.includes('disabled'));
  ok(!css.includes('.pfrl-rung'));
});

t('emit Markup: empty when disabled', () => {
  const m = emitProgressiveFsRetriggerLadderMarkup(resolveConfig({}));
  ok(m.includes('disabled'));
  ok(!m.includes('pfrlLadder'));
});

t('emit Markup: includes ladder rung divs when enabled (+ ARIA contract)', () => {
  const m = emitProgressiveFsRetriggerLadderMarkup(
    resolveConfig({ progressiveFsRetriggerLadder: { enabled: true } })
  );
  ok(m.includes('id="pfrlLadder"'));
  ok(m.includes('role="list"'));
  ok(m.includes('role="listitem"'));
  ok(m.includes('class="pfrl-rung is-current"'));
  ok(m.includes('aria-current="true"'));
  /* 5 rungs in default ladder. */
  const rungCount = (m.match(/data-rung="\d+"/g) || []).length;
  equal(rungCount, 5);
});

t('emit Runtime: registers HookBus listeners for full lifecycle', () => {
  const r = emitProgressiveFsRetriggerLadderRuntime(
    resolveConfig({ progressiveFsRetriggerLadder: { enabled: true } })
  );
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsRetrigger'"));
  ok(r.includes("HookBus.on('onFsSpinResult'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes('onLadderRungPromoted'));
  ok(r.includes('onLadderReset'));
  ok(r.includes('__PFRL_WIRED__'));
});

t('emit Runtime: empty (no IIFE) when disabled', () => {
  const r = emitProgressiveFsRetriggerLadderRuntime(resolveConfig({}));
  ok(r.includes('disabled'));
  ok(!r.includes('__PFRL_WIRED__'));
});

t('emit Runtime: includes FS-active + HW guard', () => {
  const r = emitProgressiveFsRetriggerLadderRuntime(
    resolveConfig({ progressiveFsRetriggerLadder: { enabled: true } })
  );
  ok(r.includes('_isFsActive'));
  ok(r.includes('_isHwActive'));
  ok(r.includes('HW_STATE'));
  ok(r.includes('FREESPINS'));
});
