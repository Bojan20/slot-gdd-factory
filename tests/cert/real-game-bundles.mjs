#!/usr/bin/env node
/**
 * tests/cert/real-game-bundles.mjs · Functional Item #3 — Capsule export
 * pipeline → regulator/cert ZIP across all real-game PDFs × multiple
 * jurisdictions, with cross-bundle structural parity check.
 *
 * What it does:
 *   1. For every real-game PDF in `~/Desktop/GDD/*.pdf`:
 *        For every jurisdiction in JURISDICTIONS:
 *          - Drive `tools/cert-build.mjs` (now PDF-capable per Item #3)
 *          - Assert bundle directory created
 *          - Assert exit code is 0 or 1 (never 2 fatal)
 *          - Assert manifest.json + evidence.json + compliance.json +
 *            README.txt all present
 *          - Assert source/ contains BOTH the original .pdf and the
 *            reconstructed .md (PDF input pathway)
 *          - Assert artefacts/slot.html attached (auto-discovery)
 *          - Assert manifest.schema_version is consistent across all bundles
 *          - Assert evidence.artefacts[] hash list matches on-disk hashes
 *
 *   2. Cross-bundle parity: every successful bundle must share the same
 *      manifest schema_version + evidence schema (same top-level keys).
 *      Drift = LEGO violation at cert layer.
 *
 * Exit codes:
 *   0  all (game × jurisdiction) bundles structurally valid + parity OK
 *   1  one or more structural / parity failures
 *   2  no real-game PDFs found (run gate impossible)
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const HOME = process.env.HOME;
const GDD_DIR = `${HOME}/Desktop/GDD`;
const CLI = resolve(REPO, 'tools', 'cert-build.mjs');

const JURISDICTIONS = ['UKGC', 'MGA', 'DGA'];

const bar = (ch = '─', n = 100) => ch.repeat(n);

if (!existsSync(GDD_DIR)) {
  console.error(`❌ ${GDD_DIR} missing. Real-game PDF source required.`);
  process.exit(2);
}

const pdfs = readdirSync(GDD_DIR)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .filter((f) => !f.startsWith('.'))
  .map((f) => resolve(GDD_DIR, f));

if (pdfs.length === 0) {
  console.error('❌ No PDFs in GDD folder.');
  process.exit(2);
}

console.log(bar('═'));
console.log(`📦 Real-game cert bundles · ${pdfs.length} PDF × ${JURISDICTIONS.length} jurisdiction = ${pdfs.length * JURISDICTIONS.length} bundles`);
console.log(bar('═'));

/** SHA-256 hex of a file path. */
function fileSha(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

/** Find the single .opkg dir inside an out root. */
function findBundleDir(outRoot) {
  if (!existsSync(outRoot)) return null;
  const ents = readdirSync(outRoot).filter((e) => e.endsWith('.opkg'));
  if (ents.length === 0) return null;
  return resolve(outRoot, ents[0]);
}

const tmpRoot = mkdtempSync(resolve(REPO, '.cert-real-tmp-'));
const results = [];

for (const pdfPath of pdfs) {
  for (const jur of JURISDICTIONS) {
    const game = basename(pdfPath, '.pdf');
    const outDir = resolve(tmpRoot, `${game}-${jur}`);
    process.stdout.write(`  • ${game.padEnd(38)} ${jur.padEnd(5)} `);

    const r = spawnSync('node', [
      CLI,
      pdfPath,
      `--jurisdiction=${jur}`,
      '--version=1.0.0',
      `--out=${outDir}`,
      '--quiet',
    ], { encoding: 'utf8', timeout: 60_000 });

    const exit = r.status;
    const exitOk = exit === 0 || exit === 1; /* 2 = fatal */

    const bundleDir = findBundleDir(outDir);
    const checks = [];

    checks.push({ id: 'exit.code',     ok: exitOk,                         detail: `exit=${exit}` });
    checks.push({ id: 'bundle.dir',    ok: !!bundleDir,                    detail: bundleDir ? basename(bundleDir) : '<none>' });

    let manifest = null, evidence = null;
    if (bundleDir) {
      const manifestPath = resolve(bundleDir, 'manifest.json');
      const evidencePath = resolve(bundleDir, 'evidence.json');
      const compliancePath = resolve(bundleDir, 'compliance.json');
      const readmePath = resolve(bundleDir, 'README.txt');
      const srcPdfPath = resolve(bundleDir, `source/${basename(pdfPath)}`);
      const srcMdPath  = resolve(bundleDir, `source/${basename(pdfPath, '.pdf')}.md`);
      const slotPath   = resolve(bundleDir, 'artefacts/slot.html');

      checks.push({ id: 'manifest.json',   ok: existsSync(manifestPath),   detail: 'present' });
      checks.push({ id: 'evidence.json',   ok: existsSync(evidencePath),   detail: 'present' });
      checks.push({ id: 'compliance.json', ok: existsSync(compliancePath), detail: 'present' });
      checks.push({ id: 'README.txt',      ok: existsSync(readmePath),     detail: 'present' });
      checks.push({ id: 'source.pdf',      ok: existsSync(srcPdfPath),     detail: 'original PDF' });
      checks.push({ id: 'source.md',       ok: existsSync(srcMdPath),      detail: 'reconstructed MD' });
      checks.push({ id: 'artefacts.slot.html', ok: existsSync(slotPath),   detail: 'built slot.html' });

      if (existsSync(manifestPath)) {
        try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
        catch (e) { checks.push({ id: 'manifest.parse', ok: false, detail: e.message }); }
      }
      if (existsSync(evidencePath)) {
        try { evidence = JSON.parse(readFileSync(evidencePath, 'utf8')); }
        catch (e) { checks.push({ id: 'evidence.parse', ok: false, detail: e.message }); }
      }

      /* Evidence hash sanity: every artefact entry should hash-match the file on disk. */
      if (evidence?.artefacts) {
        let hashOk = true, hashFail = null;
        for (const a of evidence.artefacts) {
          const p = resolve(bundleDir, a.path);
          if (!existsSync(p)) continue;
          const actual = fileSha(p);
          if (actual !== a.content_hash) {
            hashOk = false;
            hashFail = `${a.path}: declared=${a.content_hash.slice(0,12)}… actual=${actual.slice(0,12)}…`;
            break;
          }
        }
        checks.push({ id: 'evidence.hashes', ok: hashOk, detail: hashFail || `${evidence.artefacts.length} artefacts hash-verified` });
      }
    }

    const ok = checks.every((c) => c.ok);
    console.log(ok ? '✓' : '✗ ' + checks.filter((c) => !c.ok).map((c) => c.id).join(','));
    results.push({ game, jur, bundleDir, ok, checks, manifest, evidence });
  }
}

/* ── Cross-bundle parity ──────────────────────────────────────────────── */
console.log(`\n${bar('═')}`);
console.log('CROSS-BUNDLE PARITY · schema_version + key shape');
console.log(bar('═'));

const validBundles = results.filter((r) => r.manifest && r.evidence);
const parityViolations = [];

if (validBundles.length >= 2) {
  const ref = validBundles[0];
  const refManifestKeys = Object.keys(ref.manifest).sort().join(',');
  const refEvidenceKeys = Object.keys(ref.evidence).sort().join(',');
  const refSchema = ref.manifest.schema_version;

  for (const r of validBundles.slice(1)) {
    const myManifestKeys = Object.keys(r.manifest).sort().join(',');
    const myEvidenceKeys = Object.keys(r.evidence).sort().join(',');
    if (r.manifest.schema_version !== refSchema) {
      parityViolations.push({ game: r.game, jur: r.jur, key: 'schema_version', ref: refSchema, mine: r.manifest.schema_version });
    }
    if (myManifestKeys !== refManifestKeys) {
      parityViolations.push({ game: r.game, jur: r.jur, key: 'manifest.keys', ref: refManifestKeys, mine: myManifestKeys });
    }
    if (myEvidenceKeys !== refEvidenceKeys) {
      parityViolations.push({ game: r.game, jur: r.jur, key: 'evidence.keys', ref: refEvidenceKeys, mine: myEvidenceKeys });
    }
  }
  console.log(`  reference        : ${ref.game} (${ref.jur})`);
  console.log(`  schema_version   : ${refSchema}`);
  console.log(`  manifest.keys    : ${refManifestKeys.split(',').length} keys`);
  console.log(`  evidence.keys    : ${refEvidenceKeys.split(',').length} keys`);
  console.log(`  parity drift     : ${parityViolations.length} violation(s)`);
  for (const v of parityViolations.slice(0, 5)) {
    console.log(`    ✗ ${v.game}/${v.jur}/${v.key}: ref="${v.ref}" mine="${v.mine}"`);
  }
}

/* ── Summary matrix ───────────────────────────────────────────────────── */
console.log(`\n${bar('═')}`);
console.log('SUMMARY MATRIX · game × jurisdiction');
console.log(bar('═'));

const games = [...new Set(results.map((r) => r.game))];
const CW = { game: 40, jur: 6 };
const headerCells = JURISDICTIONS.map((j) => j.padEnd(CW.jur)).join(' │ ');
console.log('┌─' + '─'.repeat(CW.game) + '─┬─' + JURISDICTIONS.map(() => '─'.repeat(CW.jur)).join('─┬─') + '─┐');
console.log('│ ' + 'Game'.padEnd(CW.game) + ' │ ' + headerCells + ' │');
console.log('├─' + '─'.repeat(CW.game) + '─┼─' + JURISDICTIONS.map(() => '─'.repeat(CW.jur)).join('─┼─') + '─┤');
for (const g of games) {
  const cells = JURISDICTIONS.map((j) => {
    const r = results.find((x) => x.game === g && x.jur === j);
    return (r?.ok ? '✓' : '✗').padEnd(CW.jur);
  }).join(' │ ');
  console.log('│ ' + g.padEnd(CW.game).slice(0, CW.game) + ' │ ' + cells + ' │');
}
console.log('└─' + '─'.repeat(CW.game) + '─┴─' + JURISDICTIONS.map(() => '─'.repeat(CW.jur)).join('─┴─') + '─┘');

const passCount = results.filter((r) => r.ok).length;
const failCount = results.length - passCount;
console.log(`\n${passCount}/${results.length} bundle PASS · ${failCount} fail · ${parityViolations.length} parity violation(s)`);

/* Clean up tmp output to keep dist/ tidy. */
rmSync(tmpRoot, { recursive: true, force: true });

process.exit(failCount > 0 || parityViolations.length > 0 ? 1 : 0);
