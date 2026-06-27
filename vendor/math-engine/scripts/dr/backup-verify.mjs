#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Backup chain verifier.
 *
 * Reads a backup-chain JSON manifest (synthetic one is generated under
 * `reports/dr/backup-chain.sample.json` if absent) and validates:
 *
 *   1. Every tier has at least one snapshot.
 *   2. No RPO gap exceeds the tier's target window.
 *   3. Every checksum is a valid sha256 hex (64 lowercase chars).
 *   4. No snapshot is dated in the future relative to `--now` (or a
 *      fixed deterministic epoch when `--now` is omitted).
 *   5. Snapshot IDs are unique.
 *
 * Outputs:
 *   - reports/dr/BACKUP_VERIFY.md
 *   - reports/dr/BACKUP_VERIFY.json
 *
 * CLI:
 *   --tier <critical|high|medium|low>   only verify one tier
 *   --strict                            non-zero exit on any warning
 *   --json                              JSON-only to stdout
 *   --now <iso>                         deterministic reference time
 *   --input <path>                      override sample path
 *
 * Deterministic — no clock, no RNG, no network.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const DEFAULT_NOW = '2026-05-19T00:00:00Z';
const DEFAULT_INPUT = join(ROOT, 'reports', 'dr', 'backup-chain.sample.json');
const REPORT_DIR = join(ROOT, 'reports', 'dr');
const REPORT_MD = join(REPORT_DIR, 'BACKUP_VERIFY.md');
const REPORT_JSON = join(REPORT_DIR, 'BACKUP_VERIFY.json');

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export const TIERS = Object.freeze({
  critical: { rto_minutes: 15, rpo_minutes: 5 },
  high: { rto_minutes: 60, rpo_minutes: 30 },
  medium: { rto_minutes: 240, rpo_minutes: 240 },
  low: { rto_minutes: 1440, rpo_minutes: 1440 },
});

export function parseArgs(argv) {
  const args = { tier: null, strict: false, json: false, now: DEFAULT_NOW, input: DEFAULT_INPUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tier') args.tier = argv[++i];
    else if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = true;
    else if (a === '--now') args.now = argv[++i];
    else if (a === '--input') args.input = argv[++i];
  }
  return args;
}

/** Deterministic 64-char hex digest from a seed string (FNV1a + xorshift). */
export function syntheticChecksum(seed) {
  // FNV1a base
  let h = 0x811c9dc5n;
  const fnvPrime = 0x01000193n;
  const mask = 0xffffffffn;
  for (const ch of seed) {
    h = (h ^ BigInt(ch.charCodeAt(0))) & mask;
    h = (h * fnvPrime) & mask;
  }
  // Expand via xorshift to 64 hex chars (256 bits → 8 x uint32)
  let s = h === 0n ? 0xdeadbeefn : h;
  let out = '';
  for (let i = 0; i < 8; i++) {
    s ^= (s << 13n) & mask;
    s ^= (s >> 7n) & mask;
    s ^= (s << 17n) & mask;
    s &= mask;
    out += s.toString(16).padStart(8, '0');
  }
  return out;
}

export function syntheticChain(now) {
  const baseTs = Date.parse(now);
  if (Number.isNaN(baseTs)) throw new Error(`invalid_now: ${now}`);
  const tiers = ['critical', 'high', 'medium', 'low'];
  const snapshots = [];
  for (const tier of tiers) {
    const rpo = TIERS[tier].rpo_minutes;
    // 8 snapshots per tier, spaced 80% of RPO apart (safely below target)
    const step = Math.max(1, Math.floor(rpo * 0.8));
    for (let i = 7; i >= 0; i--) {
      const ts = new Date(baseTs - i * step * 60_000).toISOString();
      const id = `snap-${tier}-${i}`;
      snapshots.push({
        id,
        tier,
        createdAt: ts,
        sizeBytes: 1024 * 1024 * (10 + i),
        checksum: syntheticChecksum(id + ts),
        storageLocation: i % 3 === 0 ? 'archive' : (i % 2 === 0 ? 'replica' : 'primary'),
      });
    }
  }
  return { generatedAt: now, snapshots };
}

export function ensureSampleChain(path, now) {
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  const chain = syntheticChain(now);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(chain, null, 2) + '\n', 'utf-8');
  return chain;
}

export function verifyTier(snapshots, tier, now) {
  const target = TIERS[tier];
  const tierSnaps = snapshots
    .filter(s => s.tier === tier)
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const issues = [];
  const ids = new Set();
  for (const s of tierSnaps) {
    if (ids.has(s.id)) issues.push(`duplicate_id:${s.id}`);
    ids.add(s.id);
    if (!SHA256_HEX_RE.test(s.checksum)) issues.push(`bad_checksum:${s.id}`);
    if (Date.parse(s.createdAt) > Date.parse(now)) issues.push(`future_ts:${s.id}`);
    if (typeof s.sizeBytes !== 'number' || s.sizeBytes < 0) issues.push(`bad_size:${s.id}`);
  }
  let maxGap = 0;
  let gapAt = null;
  for (let i = 1; i < tierSnaps.length; i++) {
    const gap = (Date.parse(tierSnaps[i].createdAt) - Date.parse(tierSnaps[i - 1].createdAt)) / 60_000;
    if (gap > maxGap) maxGap = gap;
    if (gap > target.rpo_minutes && gapAt === null) gapAt = tierSnaps[i].createdAt;
  }
  if (tierSnaps.length > 0) {
    const tail = (Date.parse(now) - Date.parse(tierSnaps[tierSnaps.length - 1].createdAt)) / 60_000;
    if (tail > maxGap) maxGap = tail;
    if (tail > target.rpo_minutes && gapAt === null) gapAt = now;
  }
  const ok = tierSnaps.length > 0 && issues.length === 0 && maxGap <= target.rpo_minutes;
  return {
    tier,
    ok,
    snapshots: tierSnaps.length,
    maxGapMinutes: Math.round(maxGap * 100) / 100,
    rpoTargetMinutes: target.rpo_minutes,
    gapAt,
    issues,
  };
}

export function verifyChain(chain, now, onlyTier) {
  const tiers = onlyTier ? [onlyTier] : ['critical', 'high', 'medium', 'low'];
  const perTier = tiers.map(t => verifyTier(chain.snapshots, t, now));
  const allOk = perTier.every(r => r.ok);
  return {
    generatedAt: now,
    inputGeneratedAt: chain.generatedAt ?? null,
    tiers: perTier,
    pass: allOk,
  };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push('# Backup Chain Verification');
  lines.push('');
  lines.push(`- Reference time: \`${report.generatedAt}\``);
  lines.push(`- Overall: **${report.pass ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push('| Tier | Snapshots | Max gap (min) | RPO target (min) | Status |');
  lines.push('|------|-----------|---------------|------------------|--------|');
  for (const t of report.tiers) {
    lines.push(`| ${t.tier} | ${t.snapshots} | ${t.maxGapMinutes} | ${t.rpoTargetMinutes} | ${t.ok ? 'PASS' : 'FAIL'} |`);
  }
  const failures = report.tiers.filter(t => !t.ok);
  if (failures.length > 0) {
    lines.push('');
    lines.push('## Failures');
    for (const f of failures) {
      lines.push(`- **${f.tier}**: gapAt=${f.gapAt ?? 'n/a'}, issues=${f.issues.join(',') || 'none'}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const chain = ensureSampleChain(args.input, args.now);
  const report = verifyChain(chain, args.now, args.tier);
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_MD, renderMarkdown(report), 'utf-8');
    writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    process.stdout.write(`backup-verify: ${report.pass ? 'PASS' : 'FAIL'} (${report.tiers.length} tiers)\n`);
    for (const t of report.tiers) {
      process.stdout.write(`  ${t.tier}: ${t.ok ? 'ok' : 'FAIL'} (gap=${t.maxGapMinutes}min / rpo=${t.rpoTargetMinutes}min)\n`);
    }
    process.stdout.write(`report: ${REPORT_MD}\n`);
  }
  if (!report.pass) process.exit(1);
  if (args.strict && report.tiers.some(t => t.issues.length > 0)) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
