#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Chaos scenario: wallet provider cascade failure.
 *
 * Synthetic flow:
 *   1. Enable wallet.timeout chaos at 100% probability
 *   2. Drive 200 spin requests through a stub orchestrator
 *   3. Observe backpressure (max concurrent ≤ MAX_CONCURRENT)
 *      and that every request fails cleanly with a timeout error
 *   4. Disable chaos and verify recovery (next 200 spins succeed)
 *
 * Designed for offline use: no external services.
 */

import { MiniChaosController, mulberry32, pretty } from './_lib.mjs';

const SPIN_COUNT = 200;
const MAX_CONCURRENT = 16;

class WalletChaosTimeoutError extends Error {
  constructor(ms) {
    super(`wallet timeout @${ms}ms`);
    this.name = 'WalletChaosTimeoutError';
  }
}

class SpinQueue {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.peak = 0;
  }
  async run(fn) {
    while (this.active >= this.max) {
      await new Promise((r) => setTimeout(r, 0));
    }
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    try {
      return await fn();
    } finally {
      this.active--;
    }
  }
}

async function spinWithTimeout(controller, fn) {
  if (controller.shouldInject('wallet.timeout')) {
    throw new WalletChaosTimeoutError(5);
  }
  return await fn();
}

async function driveSpins(controller, count, label) {
  const queue = new SpinQueue(MAX_CONCURRENT);
  let ok = 0;
  let timeouts = 0;
  let other = 0;
  const tasks = [];
  for (let i = 0; i < count; i++) {
    tasks.push(
      queue.run(async () => {
        try {
          await spinWithTimeout(controller, async () => 'wallet-ok');
          ok++;
        } catch (err) {
          if (err instanceof WalletChaosTimeoutError) timeouts++;
          else other++;
        }
      })
    );
  }
  await Promise.all(tasks);
  return { label, ok, timeouts, other, peakConcurrent: queue.peak };
}

export async function runScenario(opts = {}) {
  const rng = opts.rng ?? mulberry32(0xC0FFEE);
  const controller = new MiniChaosController({ rng });

  controller.enable('wallet.timeout', 1.0);
  const failure = await driveSpins(controller, SPIN_COUNT, 'fail-window');

  controller.disable('wallet.timeout');
  const recovery = await driveSpins(controller, SPIN_COUNT, 'recovery');

  const pass =
    failure.timeouts === SPIN_COUNT &&
    failure.ok === 0 &&
    failure.peakConcurrent <= MAX_CONCURRENT &&
    recovery.timeouts === 0 &&
    recovery.ok === SPIN_COUNT;
  return {
    name: 'wallet-cascade-failure',
    pass,
    summary: { failure, recovery, max: MAX_CONCURRENT },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScenario().then((v) => {
    console.log(pretty(v));
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.pass ? 0 : 1);
  });
}
