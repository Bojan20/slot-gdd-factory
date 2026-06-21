#!/usr/bin/env node
/**
 * tools/verify-idempotency-test.mjs · Wave UQ-FORTIFY2 G8
 *
 * Runs `npm run verify --silent -- --json` twice in a row and asserts
 * the outcome (pass/fail per step + step labels) is identical. Catches
 * non-idempotent steps that mutate fixtures or stamps so the second run
 * diverges from the first.
 *
 * Files staged-modified during verify are intentionally excluded from
 * the diff (e.g. UQ-16 may re-bake the baseline JSON the first time but
 * second run should be a no-op).
 *
 * Exit 0 = idempotent, 1 = divergence detected.
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

function runVerify() {
  const r = spawnSync('node', [resolve(REPO, 'tools/verify.mjs'), '--json'], {
    encoding: 'utf8',
    cwd: REPO,
    maxBuffer: 50_000_000,
  });
  let json = null;
  try {
    /* verify.mjs emits json to stdout when --json is set; tolerate trailing newlines. */
    json = JSON.parse(r.stdout.trim());
  } catch (e) {
    return { ok: false, exit: r.status, error: 'JSON parse failed', raw: r.stdout.slice(0, 300) };
  }
  return { ok: r.status === 0, exit: r.status, json };
}

function summarize(j) {
  if (!j || !j.results) return [];
  return j.results.map(s => ({ label: s.label, ok: s.ok, exit: s.exit }));
}

console.log('UQ-FORTIFY2 G8 — verify gate idempotency test');
console.log('═'.repeat(60));
console.log('Pass 1 …');
const r1 = runVerify();
if (!r1.ok) {
  console.log('  ⚠ Pass 1 verify itself failed:', r1.error || `exit ${r1.exit}`);
  process.exit(1);
}
const sum1 = summarize(r1.json);
console.log(`  ${sum1.filter(s => s.ok).length}/${sum1.length} gates passed`);

console.log('Pass 2 …');
const r2 = runVerify();
if (!r2.ok) {
  console.log('  ⚠ Pass 2 verify itself failed:', r2.error || `exit ${r2.exit}`);
  process.exit(1);
}
const sum2 = summarize(r2.json);
console.log(`  ${sum2.filter(s => s.ok).length}/${sum2.length} gates passed`);

console.log('');
const divergent = [];
if (sum1.length !== sum2.length) {
  divergent.push(`step-count drift: ${sum1.length} → ${sum2.length}`);
}
const len = Math.min(sum1.length, sum2.length);
for (let i = 0; i < len; i++) {
  if (sum1[i].label !== sum2[i].label) {
    divergent.push(`step ${i}: label "${sum1[i].label}" → "${sum2[i].label}"`);
  }
  if (sum1[i].ok !== sum2[i].ok) {
    divergent.push(`step "${sum1[i].label}": ok ${sum1[i].ok} → ${sum2[i].ok}`);
  }
  if (sum1[i].exit !== sum2[i].exit) {
    divergent.push(`step "${sum1[i].label}": exit ${sum1[i].exit} → ${sum2[i].exit}`);
  }
}

if (divergent.length === 0) {
  console.log('✓ IDEMPOTENT — Pass 1 and Pass 2 produced identical step outcomes');
  process.exit(0);
} else {
  console.log('✗ DIVERGENT — verify gate is not idempotent:');
  for (const d of divergent) console.log('  - ' + d);
  process.exit(1);
}
