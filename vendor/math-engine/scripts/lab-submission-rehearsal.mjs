#!/usr/bin/env node
/**
 * CORTI W210 Faza 600.0 — lab submission rehearsal.
 *
 * Builds one sample submission per lab (GLI, BMM, eCOGRA, NMi) for the
 * "quick-hit-dragons" demo game (W209 template). Dogfoods the
 * cert-dossier-build.mjs script.
 *
 * Outputs:
 *   dist/cert/rehearsal/GLI/...
 *   dist/cert/rehearsal/BMM/...
 *   dist/cert/rehearsal/eCOGRA/...
 *   dist/cert/rehearsal/NMi/...
 *
 * Prints a summary table: lab × bundle size × file count × signature ok.
 */

import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './cert-dossier-build.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REHEARSAL_LABS = [
  { lab: 'GLI', jurisdiction: 'UKGC' },
  { lab: 'BMM', jurisdiction: 'MGA' },
  { lab: 'eCOGRA', jurisdiction: 'UKGC' },
  { lab: 'NMi', jurisdiction: 'KSA' },
];

export async function rehearseAll(opts = {}) {
  const out = [];
  for (const { lab, jurisdiction } of REHEARSAL_LABS) {
    const result = await buildDossier({
      game: opts.game ?? 'quick-hit-dragons',
      lab,
      jurisdiction,
      output: opts.output ?? `dist/cert/rehearsal/${lab}`,
      vendor: 'slot-math-engine',
      version: '1.0.0',
      root: opts.root,
    });
    out.push({
      lab,
      jurisdiction,
      bundle: basename(result.outPath),
      bytes: result.bundleBytes,
      files: result.fileCount,
      sha256: result.bundleSha256,
      sigOk: typeof result.signature?.signature === 'string'
        && result.signature.signature.length === 128,
      signature: result.signature.signature.slice(0, 16) + '…',
    });
  }
  return out;
}

function printTable(rows) {
  const cols = ['lab', 'jurisdiction', 'bundle', 'bytes', 'files', 'sigOk'];
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c]).length))
  );
  const fmt = (vals) =>
    vals.map((v, i) => String(v).padEnd(widths[i])).join('  ');
  console.log(fmt(cols));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmt(cols.map((c) => r[c])));
}

async function main() {
  console.log('Lab Submission Rehearsal — 4 labs');
  console.log('');
  const rows = await rehearseAll();
  printTable(rows);
  console.log('');
  const allOk = rows.every((r) => r.sigOk);
  if (!allOk) {
    console.error('rehearsal: some signatures invalid');
    process.exit(2);
  }
  console.log('✓ all 4 rehearsal bundles built + signed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('rehearsal failed:', err); process.exit(2); });
}
