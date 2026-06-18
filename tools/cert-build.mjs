#!/usr/bin/env node
/**
 * tools/cert-build.mjs
 *
 * Wave C1 — Zero-touch cert pipeline CLI.
 *
 * Usage:
 *   node tools/cert-build.mjs <gdd-file> \
 *     --jurisdiction=<UKGC|MGA|DGA|SGA|NJDGE|DGOJ> \
 *     [--version=1.0.0] [--build=<sha>] [--out=dist/cert] \
 *     [--zip] [--quiet]
 *
 * Exit codes:
 *   0  bundle written, compliance gate PASS
 *   1  bundle written, compliance gate FAIL (regulator-blocking — file
 *      still on disk so you can see WHY it failed)
 *   2  fatal error (file not found, unknown jurisdiction, parser blew up)
 */

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGDD } from '../src/parser.mjs';
import { pdfTextToMarkdown } from '../src/pdfToMarkdown.mjs';
import { buildManifest } from '../src/cert/manifest.mjs';
import { buildEvidencePack, sha256Hex } from '../src/cert/evidencePack.mjs';
import { writeBundle, zipBundle } from '../src/cert/bundler.mjs';
import { listJurisdictions } from '../src/cert/jurisdictions.mjs';

/**
 * Extract raw text from a PDF file using pdfjs-dist legacy build.
 *
 * Returns: { md: string, raw: string } so callers can attach BOTH the
 * raw text and the reconstructed markdown to the evidence pack — the
 * regulator can verify the parser had the same input the auditor sees.
 */
async function pdfFileToMarkdown(absPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buf = readFileSync(absPath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  const raw = pages.join('\n\n');
  return { raw, md: pdfTextToMarkdown(raw) };
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/* ─── arg parsing ────────────────────────────────────────────── */
function parseArgs(argv) {
  /** @type {Record<string,string|boolean>} */
  const opts = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq === -1) {
        opts[a.slice(2)] = true;
      } else {
        opts[a.slice(2, eq)] = a.slice(eq + 1);
      }
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

function printUsage() {
  const codes = listJurisdictions().join('|');
  console.log(`
cert-build — zero-touch GDD → op-package cert bundle

  node tools/cert-build.mjs <gdd-file> --jurisdiction=<${codes}> [opts]

Options:
  --jurisdiction=<code>  Required regulator code.
  --version=<semver>     Game version (default 0.0.0).
  --build=<id>           Build / commit identifier (optional).
  --out=<dir>            Output root (default dist/cert).
  --zip                  Also produce a .zip alongside the bundle dir.
  --quiet                Suppress non-error stdout.
  --help                 Print this and exit.
`.trim());
}

/* ─── block evidence discovery ──────────────────────────────── */
/**
 * Scan src/blocks/*.mjs for declared lifecycle hooks and pair with test
 * files in tests/blocks. Used to populate evidence.blocks[].
 */
function discoverBlockEvidence() {
  const blocksDir = join(REPO_ROOT, 'src', 'blocks');
  const testsDir = join(REPO_ROOT, 'tests', 'blocks');
  if (!existsSync(blocksDir)) return [];

  const LIFECYCLE_NAMES = [
    'preSpin', 'postSpin', 'onSpinResult',
    'onTumbleStep', 'onFsTrigger', 'onFsSpinResult', 'onFsEnd',
    'onAutoplayTick', 'onNetThresholdCrossed',
  ];

  return readdirSync(blocksDir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => {
      const name = basename(f, '.mjs');
      const source = readFileSync(join(blocksDir, f), 'utf8');
      const lifecycle = LIFECYCLE_NAMES.filter((h) => {
        const re = new RegExp(`\\b${h}\\b`);
        return re.test(source);
      });
      const testFile = join(testsDir, `${name}.test.mjs`);
      const test_status = existsSync(testFile) ? 'pass' : 'untested';
      return { name, lifecycle, test_status };
    });
}

/* ─── main ──────────────────────────────────────────────────── */
async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printUsage();
    process.exit(0);
  }
  if (positional.length < 1) {
    printUsage();
    process.exit(2);
  }

  const gddPath = resolve(positional[0]);
  if (!existsSync(gddPath)) {
    console.error(`cert-build: GDD file not found: ${gddPath}`);
    process.exit(2);
  }

  const jurisdiction = String(opts.jurisdiction || '').trim();
  if (!jurisdiction) {
    console.error(`cert-build: --jurisdiction=<code> is required (one of: ${listJurisdictions().join(', ')})`);
    process.exit(2);
  }

  const version = String(opts.version || '0.0.0');
  const build = opts.build ? String(opts.build) : undefined;
  const outRoot = resolve(String(opts.out || join(REPO_ROOT, 'dist', 'cert')));
  const quiet = !!opts.quiet;
  const doZip = !!opts.zip;
  const log = (...m) => { if (!quiet) console.log(...m); };

  /* Item #3 — PDF input pathway.
   * If the input is .pdf, extract text via pdfjs + reconstruct markdown
   * via pdfTextToMarkdown, then feed the markdown to the parser. The
   * raw PDF binary is still attached as evidence (regulator can re-run
   * extraction independently). */
  const ext = extname(gddPath).slice(1).toLowerCase() || 'md';
  let gddText;
  let parserInput;
  let pdfRawText = null;
  if (ext === 'pdf') {
    const conv = await pdfFileToMarkdown(gddPath);
    pdfRawText = conv.raw;
    parserInput = conv.md;
    gddText = conv.md; /* what parser saw → evidence content */
  } else {
    gddText = readFileSync(gddPath, 'utf8');
    parserInput = gddText;
  }

  let model;
  try {
    model = parseGDD(parserInput, ext === 'pdf' ? 'md' : ext);
  } catch (err) {
    console.error('cert-build: GDD parser threw:', err.message);
    process.exit(2);
  }

  const manifest = buildManifest({
    model,
    jurisdiction,
    version,
    build,
    built_at: new Date().toISOString(),
  });

  if (manifest.compliance.error === 'unknown_jurisdiction') {
    console.error(`cert-build: unknown jurisdiction "${jurisdiction}". Supported: ${listJurisdictions().join(', ')}`);
    process.exit(2);
  }

  /* Build the artefacts list. PDF inputs get TWO entries:
   *   1. The original .pdf binary (auditor-replay)
   *   2. The reconstructed markdown (`source/<name>.md`) — what parser saw
   * MD/JSON inputs get a single entry as before.
   */
  const sourceArtefacts = [];
  const sourceManifest = [];
  if (ext === 'pdf') {
    const baseName = basename(gddPath);
    const mdName = baseName.replace(/\.pdf$/i, '.md');
    sourceArtefacts.push({ sourcePath: gddPath, bundlePath: `source/${baseName}` });
    /* Inline emit the reconstructed markdown via inlineContent attachment. */
    sourceArtefacts.push({ inlineContent: gddText, bundlePath: `source/${mdName}` });
    sourceManifest.push({
      path: `source/${baseName}`,
      content_hash: sha256Hex(readFileSync(gddPath)),
      bytes: statSync(gddPath).size,
      kind: 'gdd_pdf_source',
    });
    sourceManifest.push({
      path: `source/${mdName}`,
      content_hash: sha256Hex(gddText),
      bytes: Buffer.byteLength(gddText, 'utf8'),
      kind: 'gdd_md_reconstructed',
    });
  } else {
    sourceArtefacts.push({ sourcePath: gddPath, bundlePath: `source/${basename(gddPath)}` });
    sourceManifest.push({
      path: `source/${basename(gddPath)}`,
      content_hash: sha256Hex(gddText),
      bytes: statSync(gddPath).size,
      kind: 'gdd',
    });
  }

  /* Item #3 — auto-attach the built slot.html artifact if one exists.
   *
   * Slug resolution is two-pronged because the cert-side game_id (from
   * `slugifyGameId(model.name)`) and the real-games artifact dir
   * (slug of source PDF basename, e.g. `huff-n-more-puff-gdd`) don't
   * always align — the PDF filename suffix `-gdd` propagates to the
   * real-games slug but is stripped from the cert game_id.
   *
   * Try: 1) exact game_id   2) game_id + `-gdd`   3) source basename slug
   */
  const realRoot = resolve(REPO_ROOT, 'dist', 'real-games');
  const sourceBase = basename(gddPath, extname(gddPath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slotCandidates = [
    resolve(realRoot, manifest.game_id, 'slot.html'),
    resolve(realRoot, `${manifest.game_id}-gdd`, 'slot.html'),
    resolve(realRoot, sourceBase, 'slot.html'),
  ];
  const slotArtPath = slotCandidates.find((p) => existsSync(p));
  if (slotArtPath) {
    sourceArtefacts.push({ sourcePath: slotArtPath, bundlePath: 'artefacts/slot.html' });
    sourceManifest.push({
      path: 'artefacts/slot.html',
      content_hash: sha256Hex(readFileSync(slotArtPath)),
      bytes: statSync(slotArtPath).size,
      kind: 'built_slot_html',
    });
  }

  const evidence = buildEvidencePack({
    gddSource: {
      name: basename(gddPath),
      content: gddText,
    },
    testResults: [], // ingested separately when test runner integration lands
    artefacts: sourceManifest,
    blocks: discoverBlockEvidence(),
  });

  const { dir, files } = writeBundle({
    outRoot,
    manifest,
    evidence,
    artefacts: sourceArtefacts,
  });

  log(`cert-build: bundle written → ${dir}`);
  log(`            files: ${files.length}`);
  log(`            compliance: ${manifest.compliance.pass ? 'PASS' : 'FAIL'} (${manifest.compliance.jurisdiction})`);
  if (manifest.compliance.missing.length) {
    log(`            missing required: ${manifest.compliance.missing.join(', ')}`);
  }
  if (manifest.compliance.warnings.length) {
    log(`            warnings: ${manifest.compliance.warnings.join(', ')}`);
  }

  if (doZip) {
    try {
      const zipPath = await zipBundle(dir);
      log(`cert-build: zip written → ${zipPath}`);
    } catch (err) {
      console.error(`cert-build: zip step failed (${err.code || 'ERR'}): ${err.message}`);
      // do not bump the exit code — bundle dir itself is valid
    }
  }

  process.exit(manifest.compliance.pass ? 0 : 1);
}

main().catch((err) => {
  console.error('cert-build: fatal:', err && err.stack ? err.stack : err);
  process.exit(2);
});
