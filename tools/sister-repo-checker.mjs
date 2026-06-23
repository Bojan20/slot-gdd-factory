#!/usr/bin/env node
/**
 * tools/sister-repo-checker.mjs
 *
 * N7 (2026-06-23) — Maintenance health check za sister repo bridge.
 *
 * Listuje Python kernels koji žive u sister repo
 * (~/Projects/slot-math-engine-template/packages/slot-math-kernels/) i
 * poredi sa KNOWN_KERNELS const-om u math-kernel-bridge.mjs. Reportuje:
 *   - newKernels: u sister-u, NIJE u bridge-u (treba dodati)
 *   - staleKernels: u bridge-u, NIJE u sister-u (treba ukloniti)
 *   - inSync: ako su skupovi identični
 *
 * Detekcija je leksička (file basename bez .py), bez izvršavanja Python
 * koda. Eksluzuje `_*` (private modules: `_cli`, `_base`, itd).
 *
 * ## Why
 * Sister repo se razvija nezavisno. Bridge KNOWN_KERNELS lista može da
 * zaostane bez upozorenja → kernels postoje u sister-u, ali bridge ne
 * zna za njih → operator dobija "unknown kernel" error. Ovaj checker
 * je rani signal.
 *
 * ## USAGE
 *   node tools/sister-repo-checker.mjs        # human ASCII report
 *   node tools/sister-repo-checker.mjs --json
 *
 * ## EXIT
 *   0 — in sync
 *   1 — drift detected (newKernels OR staleKernels > 0)
 *   2 — sister repo / KNOWN_KERNELS missing
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const SISTER     = resolve(homedir(), 'Projects', 'slot-math-engine-template');
const KERNELS_DIR = join(SISTER, 'packages', 'slot-math-kernels', 'src', 'slot_math_kernels');
const BRIDGE     = join(REPO, 'tools', 'math-kernel-bridge.mjs');

/* ── Pure detection ───────────────────────────────────────────────────── */

export function listSisterKernels(dir = KERNELS_DIR) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter(f => f.endsWith('.py') && !f.startsWith('_'))
    .map(f => f.slice(0, -3))   /* strip .py */
    .sort();
}

export function listBridgeKnownKernels(path = BRIDGE) {
  if (!existsSync(path)) return null;
  const src = readFileSync(path, 'utf8');
  const m = src.match(/const KNOWN_KERNELS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
  if (!m) return null;
  return (m[1].match(/'([a-z0-9_]+)'/g) || [])
    .map(s => s.slice(1, -1))
    .sort();
}

export function diffSets(sister, bridge) {
  const S = new Set(sister);
  const B = new Set(bridge);
  return {
    newKernels:   [...S].filter(k => !B.has(k)).sort(),
    staleKernels: [...B].filter(k => !S.has(k)).sort(),
    shared:       [...S].filter(k =>  B.has(k)).sort(),
    inSync:       [...S].filter(k => !B.has(k)).length === 0
              && [...B].filter(k => !S.has(k)).length === 0,
  };
}

export function buildReport() {
  const sister = listSisterKernels();
  const bridge = listBridgeKnownKernels();
  if (sister == null) {
    return { ok: false, error: `sister kernels dir missing: ${KERNELS_DIR}` };
  }
  if (bridge == null) {
    return { ok: false, error: `KNOWN_KERNELS not parseable from ${BRIDGE}` };
  }
  const d = diffSets(sister, bridge);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    tool: 'tools/sister-repo-checker.mjs',
    sister: { dir: KERNELS_DIR, count: sister.length, kernels: sister },
    bridge: { path: BRIDGE,     count: bridge.length, kernels: bridge },
    diff: d,
  };
}

/* ── ASCII renderer (box-drawing per HARD RULE #3) ────────────────────── */

export function renderReport(report) {
  if (!report.ok) return `sister-repo-checker — ERROR\n  ${report.error}\n`;
  const out = [];
  out.push('sister-repo-checker · bridge maintenance health');
  out.push(`generated: ${report.generatedAt}`);
  out.push('');
  out.push(`Sister kernels: ${report.sister.count}  ·  Bridge KNOWN_KERNELS: ${report.bridge.count}  ·  In sync: ${report.diff.inSync ? '✓ yes' : '✗ NO'}`);
  out.push('');
  out.push('┌──────────────────────────────────────┬───────┐');
  out.push('│ Category                              │ Count │');
  out.push('├──────────────────────────────────────┼───────┤');
  out.push('│ Shared (both)                         │ ' + String(report.diff.shared.length).padEnd(5) + ' │');
  out.push('│ NEW in sister (add to bridge)         │ ' + String(report.diff.newKernels.length).padEnd(5) + ' │');
  out.push('│ STALE in bridge (remove or verify)    │ ' + String(report.diff.staleKernels.length).padEnd(5) + ' │');
  out.push('└──────────────────────────────────────┴───────┘');
  out.push('');
  if (report.diff.newKernels.length > 0) {
    out.push('▌ NEW (add these to KNOWN_KERNELS):');
    for (const k of report.diff.newKernels) out.push(`  + ${k}`);
    out.push('');
  }
  if (report.diff.staleKernels.length > 0) {
    out.push('▌ STALE (consider removing from KNOWN_KERNELS):');
    for (const k of report.diff.staleKernels) out.push(`  - ${k}`);
    out.push('');
  }
  return out.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('sister-repo-checker.mjs')) {
  const jsonOnly = process.argv.includes('--json');
  const report = buildReport();
  if (jsonOnly) console.log(JSON.stringify(report, null, 2));
  else console.log(renderReport(report));
  if (!report.ok) process.exit(2);
  process.exit(report.diff.inSync ? 0 : 1);
}

export default { listSisterKernels, listBridgeKnownKernels, diffSets, buildReport, renderReport };
