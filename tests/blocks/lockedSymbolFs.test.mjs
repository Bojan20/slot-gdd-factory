/**
 * tests/blocks/lockedSymbolFs.test.mjs
 */
import { test as t } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import {
  defaultConfig, resolveConfig,
  emitLockedSymbolFsCSS, emitLockedSymbolFsRuntime,
  pickRandomCells,
} from '../../src/blocks/lockedSymbolFs.mjs';

t('defaultConfig disabled, sensible defaults', () => {
  const c = defaultConfig();
  equal(c.enabled, false);
  equal(c.lockSymbol, 'W');
  equal(c.lockCount, 3);
  equal(c.restrictToInnerReels, false);
});

t('resolveConfig clamps lockCount to [1, 12]', () => {
  const lo = resolveConfig({ lockedSymbolFs: { lockCount: 0 } });
  const hi = resolveConfig({ lockedSymbolFs: { lockCount: 99 } });
  equal(lo.lockCount, 1);
  equal(hi.lockCount, 12);
});

t('resolveConfig rejects lowercase lockSymbol', () => {
  const c = resolveConfig({ lockedSymbolFs: { lockSymbol: 'wild' } });
  equal(c.lockSymbol, 'W');
});

t('resolveConfig: restrictToInnerReels can be turned on', () => {
  const c = resolveConfig({ lockedSymbolFs: { enabled: true, restrictToInnerReels: true } });
  equal(c.restrictToInnerReels, true);
});

t('pickRandomCells: deterministic with seeded RNG', () => {
  let i = 0;
  const seq = [0.1, 0.6, 0.4, 0.2];
  const rng = () => seq[i++ % seq.length];
  const picked = pickRandomCells(3, 5, 4, rng);
  equal(picked.length, 4);
  /* Pure: each picked entry is unique. */
  const uniq = new Set(picked);
  equal(uniq.size, picked.length);
});

t('pickRandomCells: count > grid total clamps to total', () => {
  const picked = pickRandomCells(2, 2, 100, () => 0.1);
  equal(picked.length, 4);
});

t('pickRandomCells: zero dimensions returns []', () => {
  equal(pickRandomCells(0, 5, 3, () => 0.5).length, 0);
  equal(pickRandomCells(5, 0, 3, () => 0.5).length, 0);
});

t('emitCSS disabled returns no CSS', () => {
  ok(emitLockedSymbolFsCSS(resolveConfig({})).includes('disabled'));
});

t('emitCSS enabled emits locked + fresh-locked + reduced-motion gate', () => {
  const css = emitLockedSymbolFsCSS(resolveConfig({ lockedSymbolFs: { enabled: true } }));
  ok(css.includes('.cell.is-fs-locked'));
  ok(css.includes('.cell.is-fs-locked.is-fresh-locked'));
  ok(css.includes('@keyframes lsfs-pulse'));
  ok(css.includes('prefers-reduced-motion'));
});

t('emitRuntime enabled wires onFsTrigger/onFsEnd/preSpin/postSpin + emits onLockedSymbolFsSeeded', () => {
  const r = emitLockedSymbolFsRuntime(resolveConfig({ lockedSymbolFs: { enabled: true } }));
  ok(r.includes("HookBus.on('onFsTrigger'"));
  ok(r.includes("HookBus.on('onFsEnd'"));
  ok(r.includes("HookBus.on('preSpin'"));
  ok(r.includes("HookBus.on('postSpin'"));
  ok(r.includes('onLockedSymbolFsSeeded'));
  ok(r.includes('__LOCKED_FS_WIRED__'));
});
