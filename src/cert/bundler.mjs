/**
 * src/cert/bundler.mjs
 *
 * Wave C1 — Bundle layout writer (zero-touch cert pipeline).
 *
 * Purpose
 *   Materialise the cert bundle on disk under a deterministic layout:
 *
 *     <outRoot>/<game_id>-<version>.opkg/
 *       ├── manifest.json
 *       ├── evidence.json
 *       ├── compliance.json
 *       ├── README.txt
 *       └── artefacts/...        (caller-attached files, optional)
 *
 *   Zip wrapping is intentionally deferred: regulators accept either the
 *   directory or the user's own `zip -r` of it. Avoiding a hard dependency
 *   on `archiver` / native zip keeps `slot-gdd-factory` zero-NPM-bloat.
 *   A simple `zip` shell wrapper is exposed for callers who want it.
 *
 * Public API
 *   bundleDirName(manifest) → string
 *   writeBundle({ outRoot, manifest, evidence, artefacts, readme }) → BundleResult
 *   zipBundle(bundleDir) → Promise<string>      — best-effort via system `zip`
 *
 * Lifecycle / perf
 *   Sync FS writes (small files). Async zip via child_process (optional).
 *   Idempotent: re-running over an existing bundle dir overwrites files
 *   in place — never partial-writes a half-baked manifest.
 *
 * Senior-grade contract
 *   • Every file written is created via `mkdir -p` first.
 *   • README is a regulator-readable manifest summary, NOT marketing.
 *   • Returns full file path list so callers can checksum / log.
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { manifestToJSON } from './manifest.mjs';
import { evidenceToJSON } from './evidencePack.mjs';

/**
 * @typedef {Object} BundleArtefactInput
 * @property {string} [sourcePath]     — Absolute path on disk to copy from.
 * @property {string} [inlineContent]  — String content to write inline (Item #3).
 *                                       Mutually exclusive with sourcePath; one must be set.
 * @property {string} bundlePath       — Path inside bundle (e.g. 'artefacts/spin-001.png').
 */

/**
 * @typedef {Object} BundleResult
 * @property {string} dir              — Absolute path to bundle directory.
 * @property {string[]} files          — Absolute paths of every file written.
 */

/**
 * Canonical directory stem for the bundle.
 * @param {{ game_id:string, version:string }} manifest
 * @returns {string}
 */
export function bundleDirName(manifest) {
  if (!manifest || typeof manifest.game_id !== 'string') {
    throw new TypeError('bundleDirName: manifest.game_id required');
  }
  const version = typeof manifest.version === 'string' && manifest.version.length
    ? manifest.version
    : '0.0.0';
  return `${manifest.game_id}-${version}.opkg`;
}

/**
 * Produce a regulator-friendly README summarising the bundle.
 * Intentionally plain-text, ASCII-only.
 *
 * @param {object} manifest
 * @returns {string}
 */
function buildReadme(manifest) {
  const c = manifest.compliance || {};
  const lines = [
    'OP-PACKAGE CERT BUNDLE',
    '======================',
    '',
    `Game id      : ${manifest.game_id}`,
    `Display name : ${manifest.display_name}`,
    `Version      : ${manifest.version}`,
    `Build        : ${manifest.build || '(unset)'}`,
    `Built at     : ${manifest.built_at}`,
    `Schema       : ${manifest.schema_version}`,
    '',
    'COMPLIANCE',
    '----------',
    `Jurisdiction : ${c.jurisdiction || '(unset)'}`,
    `Regulator    : ${c.regulator || '(unset)'}`,
    `Anchor       : ${c.anchor || '(unset)'}`,
    `Verdict      : ${c.pass ? 'PASS' : 'FAIL'}`,
    `Satisfied    : ${(c.satisfied || []).join(', ') || '(none)'}`,
    `Missing      : ${(c.missing || []).join(', ') || '(none)'}`,
    `Warnings     : ${(c.warnings || []).join(', ') || '(none)'}`,
    '',
    'CONTENTS',
    '--------',
    'manifest.json    — op-package manifest (machine readable)',
    'evidence.json    — test verdicts + artefact hashes',
    'compliance.json  — standalone compliance gate report',
    'artefacts/       — optional attached evidence files',
    '',
  ];
  return lines.join('\n');
}

/**
 * Write the full bundle layout to disk.
 *
 * @param {{
 *   outRoot: string,
 *   manifest: object,
 *   evidence: object,
 *   artefacts?: BundleArtefactInput[],
 *   readme?: string,
 * }} args
 * @returns {BundleResult}
 */
export function writeBundle(args) {
  if (!args || typeof args !== 'object') {
    throw new TypeError('writeBundle: args object required');
  }
  const { outRoot, manifest, evidence } = args;
  if (typeof outRoot !== 'string' || !outRoot) {
    throw new TypeError('writeBundle: outRoot path required');
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new TypeError('writeBundle: manifest object required');
  }
  if (!evidence || typeof evidence !== 'object') {
    throw new TypeError('writeBundle: evidence object required');
  }

  const dir = resolve(outRoot, bundleDirName(manifest));
  mkdirSync(dir, { recursive: true });

  const files = [];

  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, manifestToJSON(manifest), 'utf8');
  files.push(manifestPath);

  const evidencePath = join(dir, 'evidence.json');
  writeFileSync(evidencePath, evidenceToJSON(evidence), 'utf8');
  files.push(evidencePath);

  const compliancePath = join(dir, 'compliance.json');
  writeFileSync(
    compliancePath,
    JSON.stringify(manifest.compliance || {}, null, 2) + '\n',
    'utf8'
  );
  files.push(compliancePath);

  const readmePath = join(dir, 'README.txt');
  writeFileSync(
    readmePath,
    typeof args.readme === 'string' && args.readme.length
      ? args.readme
      : buildReadme(manifest),
    'utf8'
  );
  files.push(readmePath);

  const artefacts = Array.isArray(args.artefacts) ? args.artefacts : [];
  for (const a of artefacts) {
    if (!a || typeof a.bundlePath !== 'string') continue;
    const dest = join(dir, a.bundlePath);
    mkdirSync(dirname(dest), { recursive: true });

    if (typeof a.sourcePath === 'string') {
      if (!existsSync(a.sourcePath)) continue;
      copyFileSync(a.sourcePath, dest);
      files.push(dest);
      continue;
    }
    /* Item #3 — inline-content artefact path. Used by the PDF input
     * pathway to emit the reconstructed markdown alongside the original
     * PDF binary, so the regulator can verify what the parser saw
     * without re-running pdfjs extraction. */
    if (typeof a.inlineContent === 'string') {
      writeFileSync(dest, a.inlineContent, 'utf8');
      files.push(dest);
      continue;
    }
  }

  return { dir, files };
}

/**
 * Best-effort zip via system `zip` binary. Resolves to the zip path on
 * success, rejects with a structured Error on failure (caller decides
 * whether to fall back to the unzipped directory).
 *
 * @param {string} bundleDir — Absolute path to a bundle directory.
 * @returns {Promise<string>}
 */
export function zipBundle(bundleDir) {
  return new Promise((resolveZip, rejectZip) => {
    if (typeof bundleDir !== 'string' || !bundleDir) {
      rejectZip(new TypeError('zipBundle: bundleDir required'));
      return;
    }
    if (!existsSync(bundleDir)) {
      rejectZip(new Error(`zipBundle: directory not found: ${bundleDir}`));
      return;
    }
    const zipPath = `${bundleDir}.zip`;
    const parent = dirname(bundleDir);
    const stem = bundleDir.slice(parent.length + 1);
    const child = spawn('zip', ['-r', '-q', zipPath, stem], { cwd: parent });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => rejectZip(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolveZip(zipPath);
      } else {
        const err = new Error(`zip exited with code ${code}: ${stderr.trim()}`);
        err.code = 'ZIP_FAILED';
        rejectZip(err);
      }
    });
  });
}
