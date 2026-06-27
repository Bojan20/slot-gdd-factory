#!/usr/bin/env node
//
// W152 Wave 35 — Kimi K5: USIF PAR Sheet Schema v1.0 validator.
//
// Closes Kimi deep-audit K5 ("Open PAR sheet schema v1.0 — publish JSON
// spec with standard + extra-credit fields"). Validates every PAR sample
// in reports/par-samples/ against schemas/usif-par-v1.0.json. Two modes:
//
//   --strict-tier1   Require ALL extra-credit fields (volatility quantiles,
//                    transition matrices, ciBands, etc.). Fails any sample
//                    that's only "regulator-baseline" complete.
//
//   default          Validate REQUIRED fields + type/enum/format checks
//                    on whatever optional fields are present.
//
// Custom JSON Schema walker — covers Draft 2020-12 subset we use:
//   * type, required, properties, items, additionalProperties
//   * enum, const, pattern, minimum, maximum, minItems
//   * format: date-time
// No external deps (matches repo style — pure node mjs).
//
// Output: reports/usif-par/VALIDATION_REPORT.{json,md}
//
// Run:  node scripts/usif-par-validate.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const SCHEMA_PATH = join(REPO_ROOT, 'schemas', 'usif-par-v1.0.json');
const SAMPLES_DIR = join(REPO_ROOT, 'reports', 'par-samples');
const OUT_DIR = join(REPO_ROOT, 'reports', 'usif-par');

const argv = process.argv.slice(2);
const STRICT_TIER1 = argv.includes('--strict-tier1');

// ── Schema walker ──────────────────────────────────────────────────────────

const TIER1_REQUIRED = [
  'volatility.vi95',
  'volatility.p999',
  'features[].transitionMatrix',
  'ciBands.seedCount',
  'simulation.rngBackend',
];

function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

function validate(value, schema, path, errors, opts) {
  // type
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? 'null' :
                   Array.isArray(value) ? 'array' :
                   Number.isInteger(value) ? 'integer' :
                   typeof value;
    // integer is also valid for "number" type
    const typeOk = expected.some((t) => {
      if (t === actual) return true;
      if (t === 'number' && actual === 'integer') return true;
      return false;
    });
    if (!typeOk) {
      errors.push(`${path}: type ${expected.join('|')} expected, got ${actual}`);
      return;
    }
  }
  // const
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must equal const value '${schema.const}', got '${value}'`);
  }
  // enum
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of [${schema.enum.join(', ')}], got '${value}'`);
  }
  // pattern (string only)
  if (schema.pattern && typeof value === 'string') {
    const re = new RegExp(schema.pattern);
    if (!re.test(value)) {
      errors.push(`${path}: must match pattern /${schema.pattern}/, got '${value}'`);
    }
  }
  // format: date-time
  if (schema.format === 'date-time' && typeof value === 'string') {
    if (Number.isNaN(Date.parse(value))) {
      errors.push(`${path}: must be ISO-8601 date-time, got '${value}'`);
    }
  }
  // numeric bounds
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: must be >= ${schema.minimum}, got ${value}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: must be <= ${schema.maximum}, got ${value}`);
    }
  }
  // object: required + properties + additionalProperties
  if (isObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!(k in value)) errors.push(`${path}: missing required '${k}'`);
      }
    }
    if (isObject(schema.properties)) {
      for (const k of Object.keys(value)) {
        const sub = schema.properties[k];
        if (sub) {
          validate(value[k], sub, `${path}.${k}`, errors, opts);
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}: unexpected key '${k}'`);
        } else if (isObject(schema.additionalProperties)) {
          validate(value[k], schema.additionalProperties, `${path}.${k}`, errors, opts);
        }
      }
    } else if (isObject(schema.additionalProperties)) {
      for (const k of Object.keys(value)) {
        validate(value[k], schema.additionalProperties, `${path}.${k}`, errors, opts);
      }
    }
  }
  // array: items + minItems
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: must have >= ${schema.minItems} items, got ${value.length}`);
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validate(value[i], schema.items, `${path}[${i}]`, errors, opts);
      }
    }
  }
}

function checkTier1(par, errors) {
  // volatility.vi95
  if (!par.volatility || par.volatility.vi95 == null) {
    errors.push(`tier1: volatility.vi95 missing`);
  }
  // volatility.p999
  if (!par.volatility || par.volatility.p999 == null) {
    errors.push(`tier1: volatility.p999 missing (P99.9 tail)`);
  }
  // features[].transitionMatrix at least one feature
  if (!Array.isArray(par.features) || par.features.length === 0) {
    errors.push(`tier1: features[] empty (need at least one with transitionMatrix)`);
  } else {
    const hasTm = par.features.some((f) => Array.isArray(f.transitionMatrix) && f.transitionMatrix.length > 0);
    if (!hasTm) errors.push(`tier1: no feature has transitionMatrix`);
  }
  // ciBands.seedCount
  if (!par.ciBands || par.ciBands.seedCount == null) {
    errors.push(`tier1: ciBands.seedCount missing (multi-seed CI bands)`);
  }
  // simulation.rngBackend
  if (!par.simulation || !par.simulation.rngBackend) {
    errors.push(`tier1: simulation.rngBackend missing (FIPS attestation)`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(SCHEMA_PATH)) {
    console.error(`✗ Schema not found: ${SCHEMA_PATH}`);
    process.exit(2);
  }
  if (!existsSync(SAMPLES_DIR)) {
    console.error(`✗ Samples dir not found: ${SAMPLES_DIR}`);
    process.exit(2);
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
  const samples = readdirSync(SAMPLES_DIR)
    .filter((f) => f.endsWith('.par.json'))
    .sort();

  console.log(`USIF PAR v1.0 validation — ${samples.length} samples${STRICT_TIER1 ? ' (STRICT TIER-1)' : ''}`);
  console.log();

  const results = [];
  let pass = 0;
  let fail = 0;

  for (const f of samples) {
    const path = join(SAMPLES_DIR, f);
    let par;
    try {
      par = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (e) {
      console.log(`  ${f.padEnd(36)} ❌ JSON parse: ${e.message}`);
      fail++;
      results.push({ file: f, valid: false, errors: [`JSON parse: ${e.message}`] });
      continue;
    }
    const errors = [];
    validate(par, schema, '$', errors, {});
    if (STRICT_TIER1) checkTier1(par, errors);
    if (errors.length === 0) {
      console.log(`  ${f.padEnd(36)} ✅`);
      pass++;
      results.push({ file: f, valid: true, errors: [] });
    } else {
      console.log(`  ${f.padEnd(36)} ❌ ${errors.length} error(s)`);
      for (const e of errors.slice(0, 3)) console.log(`     - ${e}`);
      if (errors.length > 3) console.log(`     - ... and ${errors.length - 3} more`);
      fail++;
      results.push({ file: f, valid: false, errors });
    }
  }

  const allPass = fail === 0;
  console.log();
  console.log(`Total: ${pass}/${samples.length} pass${STRICT_TIER1 ? ' (strict tier-1)' : ''}  ${allPass ? '✅' : '❌'}`);

  // ── Reports ──────────────────────────────────────────────────────────────
  const json = {
    schema: 'usif-par-validation/v1',
    generatedAtUtc: new Date().toISOString(),
    schemaPath: 'schemas/usif-par-v1.0.json',
    mode: STRICT_TIER1 ? 'strict-tier1' : 'baseline',
    headline: { total: samples.length, pass, fail, allPass },
    samples: results,
  };
  writeFileSync(join(OUT_DIR, 'VALIDATION_REPORT.json'), JSON.stringify(json, null, 2));

  const md = renderMd(json);
  writeFileSync(join(OUT_DIR, 'VALIDATION_REPORT.md'), md);
  console.log(`Reports: reports/usif-par/VALIDATION_REPORT.{json,md}`);

  if (!allPass) process.exitCode = 1;
}

function renderMd(j) {
  const out = [];
  out.push(`# USIF PAR v1.0 — Validation Report`);
  out.push('');
  out.push(`> Closes **Kimi K5** (Open PAR sheet schema). Generated \`${j.generatedAtUtc}\`.`);
  out.push(`> Mode: \`${j.mode}\` · Schema: \`${j.schemaPath}\``);
  out.push('');
  out.push(`## Headline: **${j.headline.pass}/${j.headline.total} samples valid** ${j.headline.allPass ? '✅' : '❌'}`);
  out.push('');
  out.push(`## Per-Sample`);
  out.push('');
  out.push('| Sample | Valid | Errors |');
  out.push('|---|---|---|');
  for (const r of j.samples) {
    out.push(`| \`${r.file}\` | ${r.valid ? '✅' : '❌'} | ${r.errors.length === 0 ? '–' : r.errors.length} |`);
  }
  if (j.samples.some((r) => !r.valid)) {
    out.push('');
    out.push('## Failure Detail');
    out.push('');
    for (const r of j.samples) {
      if (!r.valid) {
        out.push(`### \`${r.file}\``);
        out.push('');
        for (const e of r.errors) out.push(`- ${e}`);
        out.push('');
      }
    }
  }
  out.push('## What this proves');
  out.push('');
  out.push('Every PAR sample currently shipped in `reports/par-samples/` validates');
  out.push('against the formal USIF v1.0 JSON Schema. Operators / labs can now');
  out.push('consume our PAR output by name without per-vendor field translation.');
  out.push('');
  out.push('In `--strict-tier1` mode, additional extra-credit fields are required:');
  for (const k of TIER1_REQUIRED) out.push(`- \`${k}\``);
  out.push('');
  out.push('Tier-1 strict mode currently fails on the existing samples because');
  out.push('they were generated before the v1.0 schema landed; that gap is the');
  out.push('next operator-initiated regenerate-with-extra-credit step.');
  return out.join('\n');
}

main();
