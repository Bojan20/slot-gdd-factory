#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Chaos scenario orchestrator.
 *
 * Runs every `scenario-*.mjs` under this directory, collects verdicts,
 * and prints a summary table. Exits 0 only when all scenarios pass.
 */

import { runScenario as walletCascade } from './scenario-wallet-cascade-failure.mjs';
import { runScenario as dbPartition } from './scenario-db-partition.mjs';
import { runScenario as noisyNeighbour } from './scenario-noisy-neighbor.mjs';
import { runScenario as certPipeline } from './scenario-cert-pipeline-corrupt.mjs';
import { runScenario as marketplaceFlood } from './scenario-marketplace-flood.mjs';

export const SCENARIOS = [
  { id: 'wallet-cascade-failure', run: walletCascade },
  { id: 'db-partition', run: dbPartition },
  { id: 'noisy-neighbor', run: noisyNeighbour },
  { id: 'cert-pipeline-corrupt', run: certPipeline },
  { id: 'marketplace-flood', run: marketplaceFlood },
];

export async function runAll() {
  const out = [];
  for (const sc of SCENARIOS) {
    const startMs = Date.now();
    try {
      const v = await sc.run();
      out.push({ ...v, ms: Date.now() - startMs });
    } catch (err) {
      out.push({
        name: sc.id,
        pass: false,
        ms: Date.now() - startMs,
        summary: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return out;
}

export function renderTable(results) {
  const lines = [];
  lines.push('Scenario                        | Status | Elapsed | Notes');
  lines.push('--------------------------------|--------|---------|----------------------------------');
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    const notes = JSON.stringify(r.summary ?? {}).slice(0, 60);
    lines.push(`${r.name.padEnd(32)}| ${status.padEnd(7)}| ${(r.ms + 'ms').padEnd(8)}| ${notes}`);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAll().then((results) => {
    console.log(renderTable(results));
    const allPass = results.every((r) => r.pass);
    process.exit(allPass ? 0 : 1);
  });
}
