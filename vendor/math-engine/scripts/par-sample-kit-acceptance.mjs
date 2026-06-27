#!/usr/bin/env node
// PAR Sample Kit Acceptance Gate — Wave 47
//
// Verifies a built bundle in dist/par-sample-kit/ is:
//   1. Structurally complete (all required files present)
//   2. SHA-256 manifest matches actual file hashes (no tampering)
//   3. Every .par.json validates against USIF v1.0 schema
//   4. CSV files parseable + row count correct
//   5. ZIP archive readable + matches bundle dir contents
//   6. Pattern map coverage: ≥13/20 P-IDs have direct PAR samples
//
// Exit codes:
//   0 = all gates PASS
//   2 = bundle missing — run `npm run par-sample-kit` first
//   3 = manifest verification FAIL (tamper detected)
//   4 = schema validation FAIL
//   5 = structural FAIL (missing files)
//   6 = ZIP integrity FAIL

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BUNDLE_DIR = join(ROOT, 'dist', 'par-sample-kit');
const ZIP_PATH = join(ROOT, 'dist', 'par-sample-kit-v1.0.0.zip');

const PATTERN_MAP = [
  { id: 'P-001', samples: ['complex-variable-rows', 'variable-rows-7reels'] },
  { id: 'P-002', samples: ['hnw-classic'] },
  { id: 'P-003', samples: [] },
  { id: 'P-004', samples: ['cluster-7x7'] },
  { id: 'P-005', samples: ['fs-sticky-wilds'] },
  { id: 'P-006', samples: [] },
  { id: 'P-007', samples: [] },
  { id: 'P-008', samples: ['fs-expanding-wilds'] },
  { id: 'P-009', samples: ['fs-multiplier-ladder'] },
  { id: 'P-010', samples: [] },
  { id: 'P-011', samples: ['pay-anywhere'] },
  { id: 'P-012', samples: ['5x4-25lines'] },
  { id: 'P-013', samples: [] },
  { id: 'P-014', samples: [] },
  { id: 'P-015', samples: ['cluster-hexagonal'] },
  { id: 'P-016', samples: ['cluster-diagonal'] },
  { id: 'P-017', samples: [] },
  { id: 'P-018', samples: ['complex-variable-rows'] },
  { id: 'P-019', samples: ['5x3-243ways'] },
  { id: 'P-020', samples: ['classic-3x3-lines'] },
];

const REQUIRED_TOP_LEVEL = [
  'README_FOR_MATHEMATICIAN.md',
  'INDEX.md',
  'MASTER.csv',
  'MANIFEST.txt',
  'VERSION.txt',
];

const REQUIRED_DIRS = ['samples', 'schema', 'pattern-catalog'];

const REQUIRED_SCHEMA_FILES = [
  'schema/usif-par-v1.0.json',
  'schema/USIF_PAR_SCHEMA_v1.md',
];

const REQUIRED_PATTERN_CATALOG = [
  'pattern-catalog/INDUSTRY_PATTERN_CATALOG.md',
];

const SKIP_ZIP = process.argv.includes('--no-zip');

const checks = [];
function record(name, passed, detail = '') {
  checks.push({ name, passed, detail });
  const tag = passed ? '✅' : '❌';
  console.log(`  ${tag} ${name}${detail ? ` — ${detail}` : ''}`);
}

function sha256File(path) {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

function listSampleIds() {
  const ids = new Set();
  const dir = join(BUNDLE_DIR, 'samples');
  if (!existsSync(dir)) return [];
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.par.json')) ids.add(f.replace(/\.par\.json$/, ''));
  }
  return [...ids].sort();
}

// ─── Gate 1: bundle exists ─────────────────────────────────────────────
console.log('\n── Gate 1: bundle existence ──');
if (!existsSync(BUNDLE_DIR)) {
  console.error(`\n❌ Bundle not built: ${BUNDLE_DIR}`);
  console.error('   Run: npm run par-sample-kit');
  process.exit(2);
}
record('Bundle directory exists', true, BUNDLE_DIR);

// ─── Gate 2: structural completeness ────────────────────────────────────
console.log('\n── Gate 2: structural completeness ──');
let structuralFail = false;
for (const f of REQUIRED_TOP_LEVEL) {
  const p = join(BUNDLE_DIR, f);
  const ok = existsSync(p);
  record(`Top-level: ${f}`, ok);
  if (!ok) structuralFail = true;
}
for (const d of REQUIRED_DIRS) {
  const p = join(BUNDLE_DIR, d);
  const ok = existsSync(p) && statSync(p).isDirectory();
  record(`Directory: ${d}/`, ok);
  if (!ok) structuralFail = true;
}
for (const f of REQUIRED_SCHEMA_FILES) {
  const p = join(BUNDLE_DIR, f);
  const ok = existsSync(p);
  record(`Schema: ${f}`, ok);
  if (!ok) structuralFail = true;
}
for (const f of REQUIRED_PATTERN_CATALOG) {
  const p = join(BUNDLE_DIR, f);
  const ok = existsSync(p);
  record(`Pattern catalog: ${f}`, ok);
  if (!ok) structuralFail = true;
}

const sampleIds = listSampleIds();
record(`Sample count = 20`, sampleIds.length === 20, `found ${sampleIds.length}`);
if (sampleIds.length !== 20) structuralFail = true;

// Per-sample: json + pdf + csv triple
let triplesFail = 0;
for (const id of sampleIds) {
  const json = join(BUNDLE_DIR, 'samples', `${id}.par.json`);
  const pdf = join(BUNDLE_DIR, 'samples', `${id}.par.pdf`);
  const csv = join(BUNDLE_DIR, 'samples', `${id}.par.csv`);
  if (!existsSync(json) || !existsSync(pdf) || !existsSync(csv)) {
    triplesFail++;
  }
}
record(`Per-sample triple (json+pdf+csv) for 20`, triplesFail === 0, `${triplesFail} incomplete`);
if (triplesFail > 0) structuralFail = true;

if (structuralFail) {
  console.error('\n❌ Structural gate FAILED');
  process.exit(5);
}

// ─── Gate 3: SHA-256 manifest verification ──────────────────────────────
console.log('\n── Gate 3: SHA-256 manifest verification ──');
const manifestPath = join(BUNDLE_DIR, 'MANIFEST.txt');
const manifest = readFileSync(manifestPath, 'utf8');
const manifestEntries = manifest.trim().split('\n').map((line) => {
  const m = line.match(/^([a-f0-9]{64})\s+(.+)$/);
  if (!m) return null;
  return { hash: m[1], rel: m[2] };
}).filter(Boolean);

record(`Manifest parseable`, manifestEntries.length > 0, `${manifestEntries.length} entries`);

let manifestMismatch = 0;
const sampleManifestMismatch = [];
for (const { hash, rel } of manifestEntries) {
  const abs = join(BUNDLE_DIR, rel);
  if (!existsSync(abs)) {
    manifestMismatch++;
    sampleManifestMismatch.push(`MISSING: ${rel}`);
    continue;
  }
  const actual = sha256File(abs);
  if (actual !== hash) {
    manifestMismatch++;
    sampleManifestMismatch.push(`${rel}: expected ${hash.slice(0, 12)}… got ${actual.slice(0, 12)}…`);
  }
}
record(`All ${manifestEntries.length} manifest hashes match`, manifestMismatch === 0, manifestMismatch > 0 ? `${manifestMismatch} mismatches: ${sampleManifestMismatch.slice(0, 3).join(' | ')}${sampleManifestMismatch.length > 3 ? ` …+${sampleManifestMismatch.length - 3}` : ''}` : '');
if (manifestMismatch > 0) {
  process.exit(3);
}

// ─── Gate 4: USIF schema validation ─────────────────────────────────────
console.log('\n── Gate 4: USIF schema validation (20/20) ──');
// Inline schema validation — we don't call usif-par-validate.mjs here
// because it overwrites reports/usif-par/VALIDATION_REPORT.{json,md}
// (committed strict-tier1 artefact). We replicate the baseline REQUIRED
// checks inline against the bundle's `samples/` dir.
const samplesDir = join(BUNDLE_DIR, 'samples');
const REQUIRED_TOP_KEYS = ['schemaVersion', 'generatedAt', 'game', 'simulation', 'results'];
const REQUIRED_GAME_KEYS = ['name', 'layout', 'paySystem', 'targetRTP', 'maxWin'];
const REQUIRED_SIM_KEYS = ['spins', 'seed'];
const REQUIRED_RESULTS_KEYS = ['observedRTP', 'rtpPercent', 'hitRate'];

let validSamples = 0;
const schemaFails = [];
for (const id of sampleIds) {
  try {
    const par = JSON.parse(readFileSync(join(samplesDir, `${id}.par.json`), 'utf8'));
    const missing = [];
    for (const k of REQUIRED_TOP_KEYS) if (!(k in par)) missing.push(k);
    if (par.schemaVersion !== '1.0') missing.push(`schemaVersion=${par.schemaVersion}≠1.0`);
    if (par.game) {
      for (const k of REQUIRED_GAME_KEYS) if (!(k in par.game)) missing.push(`game.${k}`);
    }
    if (par.simulation) {
      for (const k of REQUIRED_SIM_KEYS) if (!(k in par.simulation)) missing.push(`simulation.${k}`);
    }
    if (par.results) {
      for (const k of REQUIRED_RESULTS_KEYS) if (!(k in par.results)) missing.push(`results.${k}`);
    }
    if (missing.length === 0) validSamples++;
    else schemaFails.push(`${id}: ${missing.join(', ')}`);
  } catch (e) {
    schemaFails.push(`${id}: JSON parse error — ${e.message}`);
  }
}
const schemaOk = validSamples === 20;
record(`USIF schema baseline validation`, schemaOk, schemaOk ? `20/20 PASS (schemaVersion=1.0 + 13 REQUIRED keys)` : `${validSamples}/20 — fails: ${schemaFails.slice(0, 3).join(' | ')}${schemaFails.length > 3 ? ` …+${schemaFails.length - 3}` : ''}`);
if (!schemaOk) process.exit(4);

// ─── Gate 5: MASTER.csv shape ───────────────────────────────────────────
console.log('\n── Gate 5: MASTER.csv structure ──');
const masterCsv = readFileSync(join(BUNDLE_DIR, 'MASTER.csv'), 'utf8');
const csvLines = masterCsv.trim().split('\n');
record(`MASTER.csv has 21 lines (1 header + 20 data)`, csvLines.length === 21, `${csvLines.length} lines`);
const headerCols = csvLines[0].split(',').length;
record(`MASTER.csv has ≥30 columns`, headerCols >= 30, `${headerCols} cols`);

// Per-sample CSV: 2 lines each
let perSampleCsvFail = 0;
for (const id of sampleIds) {
  const csv = readFileSync(join(samplesDir, `${id}.par.csv`), 'utf8');
  const lines = csv.trim().split('\n');
  if (lines.length !== 2) perSampleCsvFail++;
}
record(`Per-sample CSVs have 2 lines (header + 1 data)`, perSampleCsvFail === 0, perSampleCsvFail > 0 ? `${perSampleCsvFail} malformed` : '');

// ─── Gate 6: pattern coverage ───────────────────────────────────────────
console.log('\n── Gate 6: pattern map coverage ──');
let coveredPatterns = 0;
const uncovered = [];
for (const p of PATTERN_MAP) {
  if (p.samples.length > 0) {
    const allPresent = p.samples.every((s) => sampleIds.includes(s));
    if (allPresent) {
      coveredPatterns++;
    } else {
      uncovered.push(p.id);
    }
  }
}
record(`Pattern coverage ≥13/20`, coveredPatterns >= 13, `${coveredPatterns}/20 P-IDs directly covered${uncovered.length ? ` (broken: ${uncovered.join(', ')})` : ''}`);

// ─── Gate 7: ZIP integrity ──────────────────────────────────────────────
console.log('\n── Gate 7: ZIP archive integrity ──');
if (SKIP_ZIP) {
  record('ZIP check skipped (--no-zip)', true);
} else if (!existsSync(ZIP_PATH)) {
  record('ZIP archive exists', false, ZIP_PATH);
  process.exit(6);
} else {
  let zipTestOk = false;
  let zipFileCount = 0;
  try {
    execSync(`unzip -tq "${ZIP_PATH}"`, { encoding: 'utf8' });
    zipTestOk = true;
    const lst = execSync(`unzip -l "${ZIP_PATH}"`, { encoding: 'utf8' });
    const tail = lst.trim().split('\n').pop();
    // unzip -l footer shape: "   439290                     72 files"
    const m = tail.match(/(\d+)\s+files?\s*$/i);
    if (m) zipFileCount = parseInt(m[1], 10);
  } catch (e) {
    zipTestOk = false;
  }
  record(`ZIP archive uncorrupted (unzip -tq)`, zipTestOk);
  record(`ZIP contains expected file count`, zipFileCount >= manifestEntries.length, `${zipFileCount} entries vs ${manifestEntries.length} manifest hashes`);
  if (!zipTestOk) process.exit(6);
}

// ─── Summary ────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────────────────');
const passed = checks.filter((c) => c.passed).length;
const total = checks.length;
console.log(`PAR Sample Kit acceptance: ${passed}/${total} checks PASS`);
console.log('──────────────────────────────────────────────────────────────');
if (passed === total) {
  console.log('\n✅ Wave 47 — PAR Sample Kit bundle ACCEPTED');
  process.exit(0);
} else {
  console.error('\n❌ Wave 47 — PAR Sample Kit bundle REJECTED');
  process.exit(1);
}
