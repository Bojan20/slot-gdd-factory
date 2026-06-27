#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Diff a current audit snapshot against the
 * committed baseline. Surfaces NEW CVE ids and changed verdicts.
 *
 * Usage:
 *   baseline-diff.mjs --current reports/security/audit.json \
 *                     --baseline reports/security/baseline.json \
 *                     --out reports/security/baseline-diff.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function readJson(p) {
  if (!p || !existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function diff(current, baseline) {
  const out = {
    newCategoryFailures: [],
    newCves: [],
    fixedCves: [],
    changedVerdicts: [],
  };
  if (!current) return out;
  const cur = current.categories ?? [];
  const base = (baseline && baseline.categories) ?? [];
  const baseById = new Map(base.map((c) => [c.id, c]));
  for (const c of cur) {
    const b = baseById.get(c.id);
    if (!b) {
      if (c.verdict !== 'pass') out.newCategoryFailures.push({ id: c.id, verdict: c.verdict });
      continue;
    }
    if (c.verdict !== b.verdict) {
      out.changedVerdicts.push({ id: c.id, from: b.verdict, to: c.verdict });
    }
  }
  // CVE list — pulled from `dependencies` category details.
  const curCves = collectCves(current);
  const baseCves = collectCves(baseline);
  const baseSet = new Set(baseCves);
  const curSet = new Set(curCves);
  for (const id of curCves) if (!baseSet.has(id)) out.newCves.push(id);
  for (const id of baseCves) if (!curSet.has(id)) out.fixedCves.push(id);
  return out;
}

function collectCves(snap) {
  if (!snap) return [];
  const cat = (snap.categories ?? []).find((c) => c.id === 'dependencies');
  if (!cat?.details?.perManifest) return [];
  const out = [];
  for (const m of Object.values(cat.details.perManifest)) {
    for (const c of m.cves ?? []) out.push(`${c.name}@${c.severity}`);
  }
  return out.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cur = readJson(arg('current'));
  const base = readJson(arg('baseline'));
  const result = diff(cur, base);
  const out = arg('out', 'reports/security/baseline-diff.json');
  const dir = dirname(out);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`baseline-diff: ${result.newCves.length} new CVEs, ${result.changedVerdicts.length} verdict changes`);
}
