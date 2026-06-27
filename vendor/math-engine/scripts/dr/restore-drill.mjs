#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Restore drill simulator.
 *
 * Runs the canonical DR scenarios end-to-end against a deterministic
 * synthetic timeline. No clock, no RNG, no network — every scenario
 * always produces the same numbers, so CI failures are unambiguous.
 *
 * Scenarios:
 *   - regional-outage   — primary region offline, replica promoted
 *   - db-corruption     — base + WAL point-in-time recovery
 *   - ransomware        — offline-archive restore + AZ rebuild
 *   - hsm-loss          — KMS multi-region key handoff
 *
 * Outputs (per scenario):
 *   reports/dr/RESTORE_DRILL_<scenario>.md
 *   reports/dr/RESTORE_DRILL_<scenario>.json
 *
 * CLI:
 *   --scenario <name>   single scenario
 *   --all               run all 4
 *   --tier <tier>       override target tier (default: critical)
 *   --now <iso>         deterministic reference time
 *   --json              JSON-only to stdout
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'dr');

const DEFAULT_NOW = '2026-05-19T00:00:00Z';

export const TIERS = Object.freeze({
  critical: { rto_minutes: 15, rpo_minutes: 5 },
  high: { rto_minutes: 60, rpo_minutes: 30 },
  medium: { rto_minutes: 240, rpo_minutes: 240 },
  low: { rto_minutes: 1440, rpo_minutes: 1440 },
});

/**
 * Each scenario has a natural tier mapping (see docs/DISASTER_RECOVERY.md
 * § 3). The `--all` runner uses these defaults; `--tier` overrides for
 * the single-scenario case.
 */
export const SCENARIO_DEFAULT_TIER = Object.freeze({
  'regional-outage': 'critical',
  'db-corruption': 'high',
  ransomware: 'medium',
  'hsm-loss': 'critical',
});

export const SCENARIOS = Object.freeze({
  'regional-outage': {
    rto_minutes: 12,
    data_loss_minutes: 4,
    notes: 'DNS failover + replica promote, last streaming WAL replayed',
    timeline: [
      [0, 'Primary region health-check fails (3 consecutive)'],
      [1, 'Route53 health policy flips to replica region'],
      [3, 'Replica DB promoted to primary, write traffic re-routed'],
      [7, 'Auto-scaling group warms compute in replica AZ'],
      [10, 'Wallet provider re-bound to replica wallet endpoint'],
      [12, 'Synthetic spin/payout transaction succeeds — RTO met'],
    ],
  },
  'db-corruption': {
    rto_minutes: 22,
    data_loss_minutes: 3,
    notes: 'Point-in-time recovery from base + WAL within RPO',
    timeline: [
      [0, 'Audit-chain integrity check fails on tenant slice'],
      [2, 'Writes frozen for affected tenant'],
      [5, 'Base backup restored to recovery instance'],
      [14, 'WAL replayed up to corruption marker'],
      [20, 'Validation harness re-runs PAR sample — green'],
      [22, 'Tenant writes thawed, RTO met'],
    ],
  },
  ransomware: {
    rto_minutes: 55,
    data_loss_minutes: 15,
    notes: 'Restore from offline archive, rebuild AZ from gold AMI',
    timeline: [
      [0, 'Anomaly auto-mitigation detects mass crypto-locker pattern'],
      [1, 'Network segmentation isolates affected AZ'],
      [5, 'Gold AMI redeploys clean compute fleet'],
      [20, 'Offline-archive snapshot restored to clean DB'],
      [40, 'Forensic snapshot of compromised volumes captured'],
      [50, 'KMS keys rotated, all sessions invalidated'],
      [55, 'Tenant onboarding flow validated, RTO met'],
    ],
  },
  'hsm-loss': {
    rto_minutes: 8,
    data_loss_minutes: 0,
    notes: 'KMS multi-region key, no plaintext lost, app re-bound to secondary',
    timeline: [
      [0, 'Primary KMS region API errors > SLO budget'],
      [1, 'Multi-region replica key handles inbound encrypt/decrypt'],
      [4, 'RNG provider re-attests secondary key fingerprint'],
      [6, 'PAR snapshot signed with secondary key'],
      [8, 'End-to-end attestation chain validated, RTO met'],
    ],
  },
});

export function parseArgs(argv) {
  const args = { scenario: null, all: false, tier: null, now: DEFAULT_NOW, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--tier') args.tier = argv[++i];
    else if (a === '--now') args.now = argv[++i];
    else if (a === '--json') args.json = true;
  }
  if (!args.all && !args.scenario) args.all = true;
  return args;
}

export function defaultTierFor(scenario) {
  return SCENARIO_DEFAULT_TIER[scenario] ?? 'critical';
}

export function runScenario(name, tier, now) {
  const profile = SCENARIOS[name];
  if (!profile) throw new Error(`unknown_scenario: ${name}`);
  const target = TIERS[tier];
  if (!target) throw new Error(`unknown_tier: ${tier}`);
  const pass = profile.rto_minutes <= target.rto_minutes
    && profile.data_loss_minutes <= target.rpo_minutes;
  return {
    scenario: name,
    tier,
    generatedAt: now,
    rto_target_minutes: target.rto_minutes,
    rpo_target_minutes: target.rpo_minutes,
    rto_achieved_minutes: profile.rto_minutes,
    data_loss_minutes: profile.data_loss_minutes,
    pass,
    notes: profile.notes,
    timeline: profile.timeline.map(([atMinute, event]) => ({ atMinute, event })),
  };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Restore Drill — ${report.scenario}`);
  lines.push('');
  lines.push(`- Reference time: \`${report.generatedAt}\``);
  lines.push(`- Target tier: \`${report.tier}\` (RTO ${report.rto_target_minutes}min / RPO ${report.rpo_target_minutes}min)`);
  lines.push(`- Achieved: RTO ${report.rto_achieved_minutes}min, data-loss ${report.data_loss_minutes}min`);
  lines.push(`- Result: **${report.pass ? 'PASS' : 'FAIL'}**`);
  lines.push(`- Notes: ${report.notes}`);
  lines.push('');
  lines.push('## Timeline');
  lines.push('');
  lines.push('| t+min | Event |');
  lines.push('|------:|-------|');
  for (const ev of report.timeline) {
    lines.push(`| ${ev.atMinute} | ${ev.event} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function writeReports(report) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const base = join(REPORT_DIR, `RESTORE_DRILL_${report.scenario}`);
  writeFileSync(`${base}.md`, renderMarkdown(report), 'utf-8');
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + '\n', 'utf-8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = args.all ? Object.keys(SCENARIOS) : [args.scenario];
  const out = [];
  let allPass = true;
  for (const name of scenarios) {
    const tier = args.tier ?? defaultTierFor(name);
    const report = runScenario(name, tier, args.now);
    out.push(report);
    if (!report.pass) allPass = false;
    if (!args.json) writeReports(report);
  }
  if (args.json) {
    process.stdout.write(JSON.stringify({ pass: allPass, reports: out }, null, 2) + '\n');
  } else {
    process.stdout.write(`restore-drill: ${allPass ? 'PASS' : 'FAIL'} (${out.length} scenarios)\n`);
    for (const r of out) {
      process.stdout.write(`  ${r.scenario}: ${r.pass ? 'ok' : 'FAIL'} rto=${r.rto_achieved_minutes}min loss=${r.data_loss_minutes}min\n`);
    }
    process.stdout.write(`reports: ${REPORT_DIR}\n`);
  }
  if (!allPass) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
