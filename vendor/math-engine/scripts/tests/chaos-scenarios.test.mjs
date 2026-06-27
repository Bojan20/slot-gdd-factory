/**
 * W212 Faza 600.1 — Chaos scenario runner tests.
 *
 * Smoke tests that every scenario file is runnable, returns a verdict
 * with the documented shape, and that the orchestrator's table
 * renderer is stable.
 */

import { describe, it, expect } from 'vitest';
import { MiniChaosController, TokenBucket, mulberry32 } from '../chaos/_lib.mjs';
import { runScenario as walletCascade } from '../chaos/scenario-wallet-cascade-failure.mjs';
import { runScenario as dbPartition } from '../chaos/scenario-db-partition.mjs';
import { runScenario as noisyNeighbour } from '../chaos/scenario-noisy-neighbor.mjs';
import { runScenario as certPipeline } from '../chaos/scenario-cert-pipeline-corrupt.mjs';
import { runScenario as marketplaceFlood } from '../chaos/scenario-marketplace-flood.mjs';
import { runAll, renderTable, SCENARIOS } from '../chaos/run-all-scenarios.mjs';

describe('W212 chaos · _lib', () => {
  it('MiniChaosController honours probability=0 (never fires)', () => {
    const ctrl = new MiniChaosController({ rng: () => 0 });
    ctrl.enable('cache.miss', 0);
    let any = false;
    for (let i = 0; i < 100; i++) if (ctrl.shouldInject('cache.miss')) any = true;
    expect(any).toBe(false);
  });

  it('MiniChaosController honours probability=1 (always fires)', () => {
    const ctrl = new MiniChaosController({ rng: () => 0 });
    ctrl.enable('cache.miss', 1);
    for (let i = 0; i < 5; i++) expect(ctrl.shouldInject('cache.miss')).toBe(true);
  });

  it('mulberry32 is deterministic for the same seed', () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('TokenBucket: capacity bounds initial burst', () => {
    const tb = new TokenBucket(3, 0);
    expect(tb.take()).toBe(true);
    expect(tb.take()).toBe(true);
    expect(tb.take()).toBe(true);
    expect(tb.take()).toBe(false);
  });

  it('MiniChaosController list returns sorted snapshot', () => {
    const ctrl = new MiniChaosController();
    ctrl.enable('wallet.timeout', 0.1);
    ctrl.enable('cache.miss', 0.1);
    const list = ctrl.list();
    expect(list[0].name).toBe('cache.miss');
  });
});

describe('W212 chaos · scenarios PASS individually', () => {
  it('wallet-cascade-failure passes', async () => {
    const v = await walletCascade();
    expect(v.name).toBe('wallet-cascade-failure');
    expect(v.pass).toBe(true);
  });

  it('db-partition passes', async () => {
    const v = await dbPartition();
    expect(v.name).toBe('db-partition');
    expect(v.pass).toBe(true);
  });

  it('noisy-neighbor passes', async () => {
    const v = await noisyNeighbour();
    expect(v.name).toBe('noisy-neighbor');
    expect(v.pass).toBe(true);
  }, 10_000);

  it('cert-pipeline-corrupt passes', async () => {
    const v = await certPipeline();
    expect(v.name).toBe('cert-pipeline-corrupt');
    expect(v.pass).toBe(true);
  });

  it('marketplace-flood passes', async () => {
    const v = await marketplaceFlood();
    expect(v.name).toBe('marketplace-flood');
    expect(v.pass).toBe(true);
  }, 10_000);
});

describe('W212 chaos · orchestrator', () => {
  it('SCENARIOS contains the five expected ids', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(ids).toEqual([
      'wallet-cascade-failure',
      'db-partition',
      'noisy-neighbor',
      'cert-pipeline-corrupt',
      'marketplace-flood',
    ]);
  });

  it('runAll returns one verdict per scenario', async () => {
    const out = await runAll();
    expect(out).toHaveLength(SCENARIOS.length);
    for (const r of out) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.pass).toBe('boolean');
      expect(typeof r.ms).toBe('number');
    }
  }, 30_000);

  it('renderTable returns a header + one row per scenario', () => {
    const fake = [
      { name: 'a', pass: true, ms: 10, summary: {} },
      { name: 'b', pass: false, ms: 20, summary: { x: 1 } },
    ];
    const tbl = renderTable(fake);
    expect(tbl).toMatch(/Scenario/);
    expect(tbl.split('\n')).toHaveLength(4);
    expect(tbl).toMatch(/PASS/);
    expect(tbl).toMatch(/FAIL/);
  });
});
