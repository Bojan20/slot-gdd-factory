#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Append a fuzz coverage data point into the trend
 * JSON. Called by the weekly fuzz-testing CI workflow.
 *
 * Usage:
 *   record-coverage.mjs --target fuzz_alias --corpus-dir corpus/fuzz_alias \
 *                       --out reports/fuzz/coverage-trend.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const target = arg('target', 'unknown');
const corpusDir = arg('corpus-dir', '');
const outPath = arg('out', 'reports/fuzz/coverage-trend.json');

function corpusStats(dir) {
  if (!dir || !existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    try {
      const st = statSync(`${dir}/${name}`);
      if (st.isFile()) {
        files += 1;
        bytes += st.size;
      }
    } catch { /* ignore */ }
  }
  return { files, bytes };
}

let trend = { runs: [] };
if (existsSync(outPath)) {
  try {
    trend = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch {
    trend = { runs: [] };
  }
}

trend.runs.push({
  at: new Date().toISOString(),
  target,
  corpus: corpusStats(corpusDir),
});

const dir = dirname(outPath);
if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
writeFileSync(outPath, JSON.stringify(trend, null, 2));
console.log(`recorded coverage for ${target}: ${JSON.stringify(trend.runs[trend.runs.length - 1])}`);
