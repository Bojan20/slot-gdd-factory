#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Dependency delta (PR branch vs base branch).
 *
 * Compares two `DEPENDENCY_REVIEW.json` snapshots and emits:
 *   - markdown table of added / removed / version-bumped deps
 *   - JSON list of `blockers` (license = non-permissive OR new CVE).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const NON_PERMISSIVE = new Set([
  'GPL-2.0', 'GPL-3.0', 'GPL-2.0-only', 'GPL-3.0-only',
  'GPL-2.0-or-later', 'GPL-3.0-or-later', 'AGPL-3.0',
  'AGPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0', 'BSL-1.0',
  'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0',
]);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function readJson(p) {
  if (!p || !existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function indexDeps(snap) {
  const map = new Map();
  if (!snap || !Array.isArray(snap.entries)) return map;
  for (const e of snap.entries) {
    const k = `${e.manifestId ?? 'root'}::${e.name}`;
    map.set(k, e);
  }
  return map;
}

export function computeDepDelta(pr, base) {
  const a = indexDeps(pr);
  const b = indexDeps(base);
  const added = [];
  const removed = [];
  const bumped = [];
  const blockers = [];
  for (const [k, v] of a) {
    const prev = b.get(k);
    if (!prev) {
      added.push(v);
      if (v.license && NON_PERMISSIVE.has(v.license)) {
        blockers.push(`new non-permissive license: ${v.name}@${v.declared} (${v.license})`);
      }
      if (v.cvesHigh && v.cvesHigh > 0) {
        blockers.push(`new dep with HIGH+ CVE: ${v.name}@${v.declared}`);
      }
    } else if (prev.declared !== v.declared) {
      bumped.push({ name: v.name, from: prev.declared, to: v.declared, manifestId: v.manifestId });
    }
  }
  for (const [k, v] of b) {
    if (!a.has(k)) removed.push(v);
  }
  return { added, removed, bumped, blockers };
}

export function renderMarkdown(d) {
  const lines = ['## Dependency delta'];
  lines.push('', '### Added', '');
  if (d.added.length === 0) lines.push('_(none)_');
  else {
    lines.push('| Manifest | Name | Version | License |');
    lines.push('|---|---|---|---|');
    for (const a of d.added) lines.push(`| ${a.manifestId ?? 'root'} | ${a.name} | ${a.declared} | ${a.license ?? 'UNKNOWN'} |`);
  }
  lines.push('', '### Removed', '');
  if (d.removed.length === 0) lines.push('_(none)_');
  else {
    for (const r of d.removed) lines.push(`- ${r.manifestId ?? 'root'}/${r.name}@${r.declared}`);
  }
  lines.push('', '### Version bumps', '');
  if (d.bumped.length === 0) lines.push('_(none)_');
  else {
    lines.push('| Manifest | Name | From | To |');
    lines.push('|---|---|---|---|');
    for (const b of d.bumped) lines.push(`| ${b.manifestId ?? 'root'} | ${b.name} | ${b.from} | ${b.to} |`);
  }
  lines.push('', '### Blockers', '');
  if (d.blockers.length === 0) lines.push(':white_check_mark: _(none)_');
  else d.blockers.forEach((b) => lines.push(`- :no_entry: ${b}`));
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pr = readJson(arg('pr'));
  const base = readJson(arg('base'));
  const delta = computeDepDelta(pr, base);
  const outMd = arg('out', 'reports/security/dep-delta.md');
  const outJson = arg('json', 'reports/security/dep-delta.json');
  for (const o of [outMd, outJson]) {
    const dir = dirname(o);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  writeFileSync(outMd, renderMarkdown(delta));
  writeFileSync(outJson, JSON.stringify(delta, null, 2));
  console.log(`dep-delta: +${delta.added.length} -${delta.removed.length} ~${delta.bumped.length} blockers=${delta.blockers.length}`);
}
