#!/usr/bin/env node
/**
 * tools/prod-build.mjs
 *
 * Wave HX6 — Production build with sourcemap manifest split.
 *
 * Usage:
 *   node tools/prod-build.mjs --gdd <path> [--out dist/]
 *
 * What it does:
 *   1. Parses the GDD via repo's parseGDD.
 *   2. Builds the slot HTML via buildSlotHTML.
 *   3. Writes `<out>/<slug>/index.html` — the full game.
 *   4. Writes `<out>/<slug>/sourcemap-manifest.json` — a deterministic
 *      mapping of every block name → source file path + LOC, so an
 *      operator can map runtime emit comments back to the src/blocks/
 *      module that produced them (essential for prod debugging when
 *      the HTML is large and an error mentions a block by name).
 *   5. Writes `<out>/<slug>/build-info.json` — timestamp, git SHA (if
 *      available), model name, feature count, build options.
 *   6. Writes `<out>/<slug>/checksum.txt` — SHA-256 of index.html for
 *      integrity verification at deploy.
 *
 * Why "sourcemap" here vs vite-style maps: the slot factory does NOT
 * transpile / bundle / minify — it concatenates source-equivalent emit
 * strings from each block into one HTML. The "split" therefore means
 * separating the operator-facing manifest (which block is responsible
 * for which `── X BLOCK ──` section in the HTML) from the runtime
 * payload itself.
 *
 * Senior-grade rule:
 *   • Single responsibility, 0 external deps, deterministic, vendor-neutral.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

function _arg(name, fb) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const GDD     = path.resolve(_arg('--gdd', path.join(REPO, 'samples', 'WRATH_OF_OLYMPUS_GAME_GDD.md')));
const OUT_DIR = path.resolve(_arg('--out', path.join(REPO, 'dist')));

function _slug(name) {
  return String(name || 'slot')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'slot';
}

function _gitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: REPO }).toString().trim(); }
  catch (_) { return 'unknown'; }
}

function _blockManifest() {
  const blocksDir = path.join(REPO, 'src', 'blocks');
  const out = {};
  for (const f of readdirSync(blocksDir).sort()) {
    if (!f.endsWith('.mjs')) continue;
    const name = path.basename(f, '.mjs');
    const full = path.join(blocksDir, f);
    const loc = readFileSync(full, 'utf8').split('\n').length;
    out[name] = {
      file: path.relative(REPO, full),
      loc,
      bytes: statSync(full).size,
    };
  }
  return out;
}

async function main() {
  if (!existsSync(GDD)) {
    console.error(C.red(`GDD not found: ${GDD}`));
    process.exit(1);
  }

  const [parser, builder] = await Promise.all([
    import(pathToFileURL(path.join(REPO, 'src', 'parser.mjs')).href),
    import(pathToFileURL(path.join(REPO, 'src', 'buildSlotHTML.mjs')).href),
  ]);

  const src = readFileSync(GDD, 'utf8');
  const model = parser.parseGDD(src);
  const html  = builder.buildSlotHTML(model);
  const slug  = _slug(model.name);
  const outGame = path.join(OUT_DIR, slug);

  console.log(C.cyan(C.bold('\n🏗  Production build — slot-gdd-factory\n')));
  console.log(C.dim(`   GDD:   ${path.relative(REPO, GDD) || GDD}`));
  console.log(C.dim(`   slug:  ${slug}`));
  console.log(C.dim(`   out:   ${path.relative(REPO, outGame)}/\n`));

  if (!existsSync(outGame)) mkdirSync(outGame, { recursive: true });

  /* 1) index.html */
  const indexFile = path.join(outGame, 'index.html');
  writeFileSync(indexFile, html);
  const checksum = createHash('sha256').update(html).digest('hex');
  writeFileSync(path.join(outGame, 'checksum.txt'), `${checksum}  index.html\n`);

  /* 2) sourcemap-manifest.json */
  const blockManifest = _blockManifest();
  const usedBlocks = Object.keys(blockManifest).filter(name => {
    /* Block is "used" in this build if its BLOCK marker appears in HTML. */
    return html.includes(`── ${name} BLOCK`) || html.includes(`-- ${name} BLOCK`);
  }).sort();
  const sourcemap = {
    schemaVersion: 1,
    generator: 'slot-gdd-factory:tools/prod-build.mjs',
    blockMarker: '── <blockName> BLOCK',
    blocksUsedCount: usedBlocks.length,
    blocksUsed: usedBlocks.map(name => ({
      name,
      ...blockManifest[name],
    })),
    blocksAvailable: Object.keys(blockManifest).length,
  };
  writeFileSync(
    path.join(outGame, 'sourcemap-manifest.json'),
    JSON.stringify(sourcemap, null, 2) + '\n',
  );

  /* 3) build-info.json */
  const buildInfo = {
    schemaVersion: 1,
    generator: 'slot-gdd-factory:tools/prod-build.mjs',
    builtAt: new Date().toISOString(),
    gitSha: _gitSha(),
    gddSource: path.relative(REPO, GDD),
    model: {
      name: model.name || null,
      featureCount: Array.isArray(model.features) ? model.features.length : 0,
      featureKinds: Array.isArray(model.features) ? [...new Set(model.features.map(f => f.kind))].sort() : [],
    },
    artefact: {
      indexBytes: Buffer.byteLength(html, 'utf8'),
      sha256: checksum,
    },
  };
  writeFileSync(
    path.join(outGame, 'build-info.json'),
    JSON.stringify(buildInfo, null, 2) + '\n',
  );

  console.log(`  ${C.green('✓')} index.html (${(buildInfo.artefact.indexBytes / 1024).toFixed(1)} KB)`);
  console.log(`  ${C.green('✓')} sourcemap-manifest.json (${usedBlocks.length} blocks used / ${Object.keys(blockManifest).length} available)`);
  console.log(`  ${C.green('✓')} build-info.json (sha ${buildInfo.gitSha.slice(0, 8)})`);
  console.log(`  ${C.green('✓')} checksum.txt`);
  console.log(C.dim(`\n  sha256: ${checksum}\n`));
  console.log(C.green(C.bold('✅ production build complete.\n')));
}

main().catch((e) => {
  console.error(C.red(C.bold(`\n❌ prod-build failed: ${e.message}\n`)));
  console.error(e.stack);
  process.exit(1);
});
