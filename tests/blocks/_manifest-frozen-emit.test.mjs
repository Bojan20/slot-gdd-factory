#!/usr/bin/env node
/**
 * tests/blocks/_manifest-frozen-emit.test.mjs
 *
 * UQ-DEEP-AN · AN-6 — Frozen flag manifest emit drift fix.
 *
 * QA-D inventory found `blocks/_manifest.json` field `frozen` = 0
 * while real `Object.freeze` coverage in src/blocks/*.mjs = 210+
 * files. Manifest generator was silently dropping the freeze posture,
 * so any audit tool reading the manifest concluded "0 frozen" — a
 * dangerous false-negative after UQ-DEEP-AM made freezing mandatory.
 *
 * This suite verifies:
 *   • Manifest exists, is well-formed JSON, has the blocks[] array
 *   • Every block entry carries a boolean `frozen` field
 *   • Frozen count ≥ 200 (preserves UQ-DEEP-AM coverage)
 *   • Generator detects via Object.isFrozen on the live defaultConfig()
 *   • Regeneration is idempotent (Pass 1 === Pass 2 modulo timestamp)
 *   • Generator emits enabledByDefault boolean per entry
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const MANIFEST = resolve(REPO, 'blocks/_manifest.json');
const GENERATOR = resolve(REPO, 'tools/gen-block-manifest.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

/* Force regenerate so we always test against the latest emit path. */
execSync(`node "${GENERATOR}"`, { cwd: REPO, stdio: 'pipe' });

const manifestText = readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(manifestText);

/* ════════════════════════════════════════════════════════════════════
 * 1. Manifest existence + shape
 * ════════════════════════════════════════════════════════════════════ */
block('1. Manifest existence and shape', () => {
  t('blocks/_manifest.json exists',
    existsSync(MANIFEST));
  t('Manifest is valid JSON object',
    manifest && typeof manifest === 'object');
  t('Manifest has blocks[] array',
    Array.isArray(manifest.blocks));
  t('Manifest blocks length >= 200',
    manifest.blocks.length >= 200,
    `got ${manifest.blocks.length}`);
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Frozen field emission
 * ════════════════════════════════════════════════════════════════════ */
block('2. Frozen field emission per entry', () => {
  const allHaveFrozen = manifest.blocks.every(b => typeof b.frozen === 'boolean');
  t('Every block entry has frozen:boolean',
    allHaveFrozen,
    allHaveFrozen ? '' : `missing on ${manifest.blocks.filter(b => typeof b.frozen !== 'boolean').length} entries`);

  const frozenCount = manifest.blocks.filter(b => b.frozen === true).length;
  t('Frozen count >= 200 (UQ-DEEP-AM preserved)',
    frozenCount >= 200,
    `got ${frozenCount}/${manifest.blocks.length}`);

  /* Spot check: a well-known block should be frozen. */
  const paytable = manifest.blocks.find(b => b.name === 'paytable');
  t('paytable block present and frozen=true',
    paytable && paytable.frozen === true,
    paytable ? `frozen=${paytable.frozen}` : 'paytable missing');
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Other required fields per entry
 * ════════════════════════════════════════════════════════════════════ */
block('3. Required entry fields', () => {
  const allHaveName = manifest.blocks.every(b => typeof b.name === 'string' && b.name.length > 0);
  t('Every entry has name:string', allHaveName);

  const allHaveEnabledByDefault = manifest.blocks.every(b => typeof b.enabledByDefault === 'boolean');
  t('Every entry has enabledByDefault:boolean',
    allHaveEnabledByDefault,
    allHaveEnabledByDefault ? '' : `missing on ${manifest.blocks.filter(b => typeof b.enabledByDefault !== 'boolean').length} entries`);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Generator detection mechanism
 * ════════════════════════════════════════════════════════════════════ */
block('4. Generator uses Object.isFrozen', () => {
  const src = readFileSync(GENERATOR, 'utf8');
  t('Generator source contains Object.isFrozen check',
    /Object\.isFrozen\s*\(/.test(src));
  t('Generator emits frozen field on entry',
    /\bfrozen\b\s*,?\s*$|frozen\s*:/m.test(src) && src.includes('frozen'));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Idempotency — Pass 1 == Pass 2 (modulo generatedAt timestamp)
 * ════════════════════════════════════════════════════════════════════ */
block('5. Idempotent regeneration', () => {
  const pass1 = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  execSync(`node "${GENERATOR}"`, { cwd: REPO, stdio: 'pipe' });
  const pass2 = JSON.parse(readFileSync(MANIFEST, 'utf8'));

  /* Drop generatedAt timestamp before comparing — it's the only non-deterministic field. */
  delete pass1.generatedAt;
  delete pass2.generatedAt;
  const same = JSON.stringify(pass1) === JSON.stringify(pass2);
  t('Pass 1 manifest === Pass 2 manifest (modulo timestamp)',
    same,
    same ? '' : 'manifest churned between passes');

  const frozen1 = pass1.blocks.filter(b => b.frozen === true).length;
  const frozen2 = pass2.blocks.filter(b => b.frozen === true).length;
  t('Frozen count stable across regenerations',
    frozen1 === frozen2,
    `pass1=${frozen1} pass2=${frozen2}`);
});

/* ════════════════════════════════════════════════════════════════════
 * Summary
 * ════════════════════════════════════════════════════════════════════ */
console.log('═'.repeat(60));
console.log(`UQ-DEEP-AN frozen-emit suite: ${pass}/${pass + fail} PASS`);
if (fail > 0) {
  console.log(`✗ ${fail} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ All assertions passed — manifest frozen flag drift resolved');
process.exit(0);
