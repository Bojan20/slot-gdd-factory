#!/usr/bin/env node
/**
 * W214 Faza 600.3 — PR security delta renderer.
 *
 * Reads the PR-branch audit JSON + the base-branch audit (baseline)
 * JSON and writes a markdown table for the PR comment. Also writes a
 * machine-readable JSON sibling that the workflow uses to decide
 * whether to BLOCK the merge.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const RANK = { pass: 0, warn: 1, fail: 2 };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function readJson(p) {
  if (!p || !existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function computeDelta(pr, base) {
  const cur = pr?.categories ?? [];
  const baseCats = base?.categories ?? [];
  const baseById = new Map(baseCats.map((c) => [c.id, c]));
  const rows = [];
  let regression = false;
  for (const c of cur) {
    const b = baseById.get(c.id) ?? null;
    const before = b ? b.verdict : 'n/a';
    const after = c.verdict;
    const beforeRank = RANK[before] ?? 0;
    const afterRank = RANK[after] ?? 0;
    const worse = afterRank > beforeRank;
    if (worse) regression = true;
    rows.push({ id: c.id, before, after, worse });
  }
  return { rows, regression };
}

export function renderMarkdown(delta) {
  const lines = [
    '## Security gate · PR vs baseline',
    '',
    '| Category | Before | After |',
    '|---|---|---|',
  ];
  for (const r of delta.rows) {
    const arrow = r.worse ? ' :rotating_light:' : '';
    lines.push(`| ${r.id} | ${r.before.toUpperCase()} | **${r.after.toUpperCase()}**${arrow} |`);
  }
  lines.push('');
  if (delta.regression) {
    lines.push(':rotating_light: **Regression detected** — merge blocked until categories return to baseline.');
  } else {
    lines.push(':white_check_mark: No regression — safe to merge from a security standpoint.');
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pr = readJson(arg('pr'));
  const base = readJson(arg('baseline'));
  const delta = computeDelta(pr, base);
  const outMd = arg('out', 'reports/security/pr-delta.md');
  const dir = dirname(outMd);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outMd, renderMarkdown(delta));
  writeFileSync(outMd.replace(/\.md$/, '.json'), JSON.stringify(delta, null, 2));
  console.log(`pr-delta: rows=${delta.rows.length} regression=${delta.regression}`);
}
