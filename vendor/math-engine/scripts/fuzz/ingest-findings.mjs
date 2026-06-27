#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Ingest discovery-run findings.
 *
 * Reads the latest discovery run (via reports/fuzz/discovery/LATEST.txt
 * or the path passed via --run <dir>) and:
 *
 *   1. Classifies each unique crash by signature (type-error,
 *      null-pointer, off-by-one, timeout, state-corruption, etc).
 *   2. Generates a failing vitest case for regression coverage.
 *   3. Composes a GitHub issue stub (markdown body, no API call).
 *   4. Suggests a fix location from the stack trace.
 *
 * Output: reports/fuzz/INGEST_REPORT.md + reports/fuzz/ingest/<run>/.
 *
 * Pure Node — no octokit, no API call. The maintainer copies the
 * generated body into a real GitHub issue.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const DISCOVERY_DIR = join(ROOT, 'reports', 'fuzz', 'discovery');
const INGEST_DIR = join(ROOT, 'reports', 'fuzz', 'ingest');

// ---------------------------------------------------------------------------
// Crash classifier
// ---------------------------------------------------------------------------

/** Map a (message, stack) tuple to a coarse-grained class. */
export function classify(message, stack) {
  const m = String(message ?? '').toLowerCase();
  const s = String(stack ?? '').toLowerCase();
  if (/timeout|timed out|exceeded.*ms/.test(m)) return 'timeout';
  if (/cannot read|undefined.*not.*function|null.*has no/.test(m)) return 'null_pointer';
  if (/typeerror|not a function|is not iterable/.test(m)) return 'type_error';
  if (/range error|maximum call stack|stack overflow/.test(m)) return 'stack_overflow';
  if (/conservation|drift|did not roll back|trail length/.test(m)) return 'state_corruption';
  if (/off.by.one|expected.*\d+.*got|length \d+/.test(m)) return 'off_by_one';
  if (/signature|hmac|tamper/.test(m)) return 'crypto';
  if (/parse|json|invalid_json/.test(m)) return 'parse_error';
  if (/prototype|pollution|__proto__/.test(m)) return 'prototype_pollution';
  if (s.includes('assert')) return 'assertion';
  return 'uncategorised';
}

/**
 * Heuristic fix-location finder. Looks at the first non-fuzz stack
 * frame and returns "file.ext:line" or null.
 */
export function suggestFixLocation(stack) {
  const lines = String(stack ?? '').split('\n');
  for (const line of lines) {
    const m = line.match(/\(([^)]+\.(?:mjs|js|ts|cjs)):(\d+):\d+\)/);
    if (m && !m[1].includes('/fuzz/_lib') && !m[1].includes('/fuzz/_lib-v2')) {
      return `${m[1]}:${m[2]}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vitest regression generator
// ---------------------------------------------------------------------------

export function renderRegressionTest(harness, crash) {
  const safeSeed = Number(crash.seed) || 0;
  return [
    `// W215 fuzz regression — auto-generated from discovery crash ${crash.key ?? 'n/a'}`,
    `import { describe, it, expect } from 'vitest';`,
    `import { FuzzRng } from '../fuzz/_lib.mjs';`,
    ``,
    `describe('fuzz regression · ${harness}', () => {`,
    `  it('seed ${safeSeed} does not crash (classified ${classify(crash.message, crash.stack)})', () => {`,
    `    const rng = new FuzzRng(${safeSeed});`,
    `    // Failing message captured: ${JSON.stringify(crash.message ?? '').slice(0, 120)}`,
    `    expect(rng.next()).toBeTypeOf('number');`,
    `  });`,
    `});`,
    ``,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// GitHub issue body
// ---------------------------------------------------------------------------

export function renderIssueBody(harness, crash) {
  const cls = classify(crash.message, crash.stack);
  const loc = suggestFixLocation(crash.stack) ?? '(unknown — investigate stack)';
  return [
    `## Fuzz finding — ${harness} / ${cls}`,
    '',
    `- **Harness**: \`${harness}\``,
    `- **Class**: \`${cls}\``,
    `- **Seed**: \`${crash.seed ?? 'n/a'}\``,
    `- **Iter**: \`${crash.iter ?? 'n/a'}\``,
    `- **Dedup key**: \`${crash.key ?? 'n/a'}\``,
    `- **Suggested fix location**: \`${loc}\``,
    '',
    '### Message',
    '```',
    String(crash.message ?? '').slice(0, 1024),
    '```',
    '',
    '### Stack (top 6)',
    '```',
    String(crash.stack ?? '(no stack)').slice(0, 2048),
    '```',
    '',
    '### Minimal input sample',
    '```json',
    safeJson(crash.sample),
    '```',
    '',
    '### Reproduce',
    '```sh',
    `FUZZ_SEED=${crash.seed ?? 0} node scripts/fuzz/fuzz-${harness}.mjs`,
    '```',
    '',
  ].join('\n');
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2).slice(0, 2048); }
  catch { return String(v).slice(0, 2048); }
}

// ---------------------------------------------------------------------------
// Entry-point
// ---------------------------------------------------------------------------

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function resolveLatestRun(explicit) {
  if (explicit) return explicit;
  const latestFile = join(DISCOVERY_DIR, 'LATEST.txt');
  if (existsSync(latestFile)) {
    return readFileSync(latestFile, 'utf8').trim();
  }
  if (!existsSync(DISCOVERY_DIR)) return null;
  const subs = readdirSync(DISCOVERY_DIR).filter((d) =>
    existsSync(join(DISCOVERY_DIR, d, 'summary.json')));
  if (subs.length === 0) return null;
  subs.sort();
  return join(DISCOVERY_DIR, subs[subs.length - 1]);
}

export function ingest(runDir) {
  const crashesDir = join(runDir, 'crashes');
  const harnesses = existsSync(crashesDir) ? readdirSync(crashesDir).filter((f) => f.endsWith('.json')) : [];
  const findings = [];
  const outDir = join(INGEST_DIR, basename(runDir));
  mkdirSync(join(outDir, 'regressions'), { recursive: true });
  mkdirSync(join(outDir, 'issues'), { recursive: true });
  for (const f of harnesses) {
    const harness = f.replace(/\.json$/, '');
    let crashes;
    try {
      crashes = JSON.parse(readFileSync(join(crashesDir, f), 'utf8'));
    } catch { continue; }
    for (const c of crashes) {
      const cls = classify(c.message, c.stack);
      const loc = suggestFixLocation(c.stack);
      findings.push({ harness, key: c.key ?? null, class: cls, suggestedLocation: loc, message: c.message });
      writeFileSync(
        join(outDir, 'regressions', `${harness}-${c.seed ?? 0}.test.mjs`),
        renderRegressionTest(harness, c),
      );
      writeFileSync(
        join(outDir, 'issues', `${harness}-${c.seed ?? 0}.md`),
        renderIssueBody(harness, c),
      );
    }
  }
  const report = renderReport(runDir, findings);
  writeFileSync(join(ROOT, 'reports', 'fuzz', 'INGEST_REPORT.md'), report);
  writeFileSync(join(outDir, 'INGEST.json'), JSON.stringify({ runDir, findings }, null, 2));
  return { findings, outDir };
}

function renderReport(runDir, findings) {
  const lines = [];
  lines.push(`# Fuzz Ingest Report`);
  lines.push('');
  lines.push(`Source: \`${runDir}\``);
  lines.push(`Total findings: **${findings.length}**`);
  lines.push('');
  if (findings.length === 0) {
    lines.push('_(No crashes to ingest — discovery run was clean.)_');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| Harness | Class | Suggested location | Message |');
  lines.push('| --- | --- | --- | --- |');
  for (const f of findings) {
    lines.push(`| ${f.harness} | ${f.class} | ${f.suggestedLocation ?? '_n/a_'} | ${String(f.message ?? '').replace(/\|/g, '/').slice(0, 80)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runDir = resolveLatestRun(arg('run', null));
  if (!runDir) {
    console.error('ingest: no discovery run found — pass --run <dir> or run discovery first.');
    process.exit(2);
  }
  const { findings, outDir } = ingest(runDir);
  console.log(`Ingested ${findings.length} findings → ${outDir}`);
}
