#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Run every TS-level fuzz harness back-to-back.
 *
 * Honours `--full` (sets ITER=100000) and `--quick` (ITER=2000). The
 * default is `ITER=10_000`. Combined report written to
 * `reports/fuzz/REPORT.json` + `reports/fuzz/REPORT.md`.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'fuzz');

const argFull = process.argv.includes('--full');
const argQuick = process.argv.includes('--quick');
const iter = argFull ? 100_000 : argQuick ? 2_000 : Number(process.env.ITER || 10_000);

const harnesses = [
  { id: 'ir-evaluator', mod: './fuzz-ir-evaluator.mjs' },
  { id: 'marketplace-api', mod: './fuzz-marketplace-api.mjs' },
  { id: 'wallet-providers', mod: './fuzz-wallet-providers.mjs' },
  { id: 'cert-bundle', mod: './fuzz-cert-bundle.mjs' },
];

(async () => {
  const reports = [];
  let totalCrashes = 0;
  for (const h of harnesses) {
    const mod = await import(h.mod);
    process.stdout.write(`fuzz:${h.id} × ${iter} … `);
    const start = Date.now();
    const r = mod.main({ iterations: iter });
    reports.push({ id: h.id, ...r });
    totalCrashes += r.crashes.length;
    console.log(`${Date.now() - start} ms, ${r.crashes.length} crashes`);
  }
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'REPORT.json'), JSON.stringify({ reports, totalCrashes, ranAt: new Date().toISOString() }, null, 2));
  writeFileSync(join(REPORT_DIR, 'REPORT.md'),
    `# Fuzz report (TS) — ${new Date().toISOString()}\n\n` +
    `Total harnesses: ${reports.length}. Total crashes: **${totalCrashes}**.\n\n` +
    reports.map((r) => `- ${r.id}: ${r.iterations} iters, ${r.durationMs} ms (${r.iterPerSec}/s), ${r.crashes.length} crashes`).join('\n') +
    '\n'
  );
  if (totalCrashes > 0) {
    console.error(`fuzz: ${totalCrashes} crashes — see reports/fuzz/REPORT.md`);
    process.exit(1);
  }
})();
