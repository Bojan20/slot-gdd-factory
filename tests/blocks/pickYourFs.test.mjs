/**
 * tests/blocks/pickYourFs.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitPickYourFsCSS, emitPickYourFsMarkup, emitPickYourFsRuntime,
} from '../../src/blocks/pickYourFs.mjs';

t('defaultConfig disabled, 3 modes', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.modes.length, 3);
});

t('resolveConfig enables + accepts valid modes', () => {
  const c = resolveConfig({
    pickYourFs: {
      enabled: true,
      modes: [
        { label: 'A', spinsCount: 5, baseMultiplier: 10 },
        { label: 'B', spinsCount: 15, baseMultiplier: 2 },
      ],
    },
  });
  equal(c.enabled, true);
  equal(c.modes.length, 2);
  equal(c.modes[0].spinsCount, 5);
});

t('resolveConfig rejects modes with < 2 entries', () => {
  const def = defaultConfig();
  const c = resolveConfig({
    pickYourFs: { modes: [{ label: 'A', spinsCount: 5, baseMultiplier: 10 }] },
  });
  equal(c.modes.length, def.modes.length);
});

t('resolveConfig rejects modes with > 6 entries', () => {
  const def = defaultConfig();
  const tooMany = Array.from({ length: 7 }, (_, i) => ({
    label: 'X' + i, spinsCount: 5, baseMultiplier: 1,
  }));
  const c = resolveConfig({ pickYourFs: { modes: tooMany } });
  equal(c.modes.length, def.modes.length);
});

t('resolveConfig clamps autoPickMs to [0, 60000]', () => {
  const lo = resolveConfig({ pickYourFs: { autoPickMs: -100 } });
  const hi = resolveConfig({ pickYourFs: { autoPickMs: 999999 } });
  equal(lo.autoPickMs, 0);
  equal(hi.autoPickMs, 60000);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitPickYourFsCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits overlay + cards + reduced-motion gate', () => {
  const css = emitPickYourFsCSS(resolveConfig({ pickYourFs: { enabled: true } }));
  ok(css.includes('.pyfs-overlay'));
  ok(css.includes('.pyfs-card'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitMarkup enabled emits dialog + N cards', () => {
  const m = emitPickYourFsMarkup(resolveConfig({ pickYourFs: { enabled: true } }));
  ok(m.includes('id="pyfsOverlay"'));
  ok(m.includes('role="dialog"'));
  ok(m.includes('aria-modal="true"'));
  ok(m.includes('aria-labelledby="pyfsTitle"'));
  /* default 3 modes → 3 cards */
  const cardCount = (m.match(/data-pyfs-mode/g) || []).length;
  equal(cardCount, 3);
});

t('emitRuntime enabled wires onFsTrigger + onFsEnd, emits onFsModePicked', () => {
  const r = emitPickYourFsRuntime(resolveConfig({ pickYourFs: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes('onFsModePicked'));
  ok(r.includes('__PICK_YOUR_FS_WIRED__'));
  ok(r.includes('pickYourFsForce'));
});

t('emitRuntime disabled is empty', () => {
  ok(!emitPickYourFsRuntime(resolveConfig({})).includes('__PICK_YOUR_FS_WIRED__'));
});
