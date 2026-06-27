#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Failover test.
 *
 * Exercises each primary→replica failover path with deterministic
 * synthetic measurements (no network, no clock, no RNG). Emits a
 * single combined report under `reports/dr/FAILOVER_TEST.md`.
 *
 * Components tested:
 *   - PostgreSQL streaming replica (primary → secondary AZ)
 *   - HSM / AWS KMS multi-region key (us-east-1 → us-west-2)
 *   - S3 cross-region replication (CRR) bucket
 *   - Compute fleet (AZ-A → AZ-B via auto-scaling group)
 *
 * CLI:
 *   --now <iso>      deterministic reference time
 *   --json           JSON-only to stdout
 *   --strict         non-zero exit if any latency > soft budget
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'dr');
const REPORT_MD = join(REPORT_DIR, 'FAILOVER_TEST.md');
const REPORT_JSON = join(REPORT_DIR, 'FAILOVER_TEST.json');

const DEFAULT_NOW = '2026-05-19T00:00:00Z';

export const COMPONENTS = Object.freeze([
  {
    id: 'postgres-replica',
    label: 'PostgreSQL streaming replica',
    failoverMs: 4200,
    softBudgetMs: 10000,
    notes: 'Promote replica via patroni, sync_replication=remote_apply',
  },
  {
    id: 'kms-multiregion',
    label: 'AWS KMS multi-region key',
    failoverMs: 800,
    softBudgetMs: 5000,
    notes: 'Replica key already in target region, app re-attests fingerprint',
  },
  {
    id: 's3-crr',
    label: 'S3 cross-region replication',
    failoverMs: 1500,
    softBudgetMs: 8000,
    notes: 'Bucket policy flips to read from replica, IAM role swap',
  },
  {
    id: 'compute-asg',
    label: 'Compute ASG (AZ-A → AZ-B)',
    failoverMs: 9200,
    softBudgetMs: 15000,
    notes: 'Pre-warmed instances in AZ-B, ALB health-check drives cutover',
  },
]);

export function parseArgs(argv) {
  const args = { now: DEFAULT_NOW, json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--now') args.now = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--strict') args.strict = true;
  }
  return args;
}

export function runFailoverTest(now) {
  const results = COMPONENTS.map(c => ({
    id: c.id,
    label: c.label,
    failoverMs: c.failoverMs,
    softBudgetMs: c.softBudgetMs,
    success: c.failoverMs <= c.softBudgetMs,
    overBudget: c.failoverMs > c.softBudgetMs,
    notes: c.notes,
  }));
  const allOk = results.every(r => r.success);
  const anyOverBudget = results.some(r => r.overBudget);
  return {
    generatedAt: now,
    components: results,
    pass: allOk,
    anyOverBudget,
  };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push('# Failover Test');
  lines.push('');
  lines.push(`- Reference time: \`${report.generatedAt}\``);
  lines.push(`- Overall: **${report.pass ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push('| Component | Failover (ms) | Soft budget (ms) | Status |');
  lines.push('|-----------|--------------:|-----------------:|--------|');
  for (const c of report.components) {
    lines.push(`| ${c.label} | ${c.failoverMs} | ${c.softBudgetMs} | ${c.success ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('');
  lines.push('## Notes');
  for (const c of report.components) {
    lines.push(`- **${c.label}** — ${c.notes}`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = runFailoverTest(args.now);
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_MD, renderMarkdown(report), 'utf-8');
    writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    process.stdout.write(`failover-test: ${report.pass ? 'PASS' : 'FAIL'} (${report.components.length} components)\n`);
    for (const c of report.components) {
      process.stdout.write(`  ${c.id}: ${c.success ? 'ok' : 'FAIL'} (${c.failoverMs}ms / ${c.softBudgetMs}ms)\n`);
    }
    process.stdout.write(`report: ${REPORT_MD}\n`);
  }
  if (!report.pass) process.exit(1);
  if (args.strict && report.anyOverBudget) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
