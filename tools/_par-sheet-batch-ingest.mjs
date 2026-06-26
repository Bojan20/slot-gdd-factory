#!/usr/bin/env node
/**
 * tools/_par-sheet-batch-ingest.mjs
 *
 * PAR-4 (PAR-SHEET AUTONOMOUS INGEST) — Boki direktiva 2026-06-26.
 *
 * # PURPOSE
 *
 * Wire the par-sheet pipeline end-to-end. For every par sheet in the
 * operator inventory, run:
 *
 *   1. PAR-2 (xlsx → model.json)            — already executed if
 *                                              dist/par-sheet-real-games/<slug>/
 *                                              exists, else invoke here.
 *   2. PAR-3 (synthetic GDD MD)              — same, idempotent.
 *   3. Merge: parseGDD(synthetic MD) + PAR-2 model.par_sheet/payback
 *      → a single model object that buildSlotHTML can consume.
 *   4. buildSlotHTML(merged) → playable slot.html in
 *      `dist/par-sheet-slots/<slug>/slot.html`.
 *
 * # MERGE STRATEGY
 *
 * The synthetic GDD parses with placeholder math; the par-sheet model
 * carries the REAL math (weighted reels, declared RTP, win cap).
 * Merge order (PAR-2 wins on math, GDD parser wins on UX):
 *
 *   - topology       → PAR-2 (drives correct reel count + paylines)
 *   - symbols        → GDD parser (neutral H1/M1/L1 IDs from PAR-3)
 *   - payback.rtp    → PAR-2 (declared RTP from par sheet summary)
 *   - winCap         → PAR-2 (from par sheet or 100Spins fallback)
 *   - par_sheet      → PAR-2 (real weighted reels)
 *   - confidence     → PAR-2 (par-sheet provenance)
 *   - everything else → GDD parser output
 *
 * # OUTPUT
 *
 *   dist/par-sheet-slots/<slug>/slot.html      — playable build
 *   dist/par-sheet-slots/<slug>/merged-model.json  — debug artifact
 *   dist/par-sheet-slots/<slug>/build-receipt.json — provenance receipt
 *
 * # ANTI-VENDOR
 *
 * The emitted slot.html is verified by the anti-vendor lint at verify
 * gate — any leak into rendered DOM strings fails the build.
 *
 * # USAGE
 *
 *   node tools/_par-sheet-batch-ingest.mjs           # all 5 par sheets
 *   node tools/_par-sheet-batch-ingest.mjs --slug cash-eruption
 *   node tools/_par-sheet-batch-ingest.mjs --refresh # regen PAR-2+PAR-3 first
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAR_MODELS_DIR = join(REPO, 'dist', 'par-sheet-real-games');
const SYNTHETIC_DIR = join(REPO, 'samples', 'synthetic');
const OUT_DIR = join(REPO, 'dist', 'par-sheet-slots');

// ─── Args ────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { slug: null, refresh: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') out.slug = args[++i];
    else if (a === '--refresh') out.refresh = true;
  }
  return out;
}

// ─── Pre-flight: ensure PAR-2 + PAR-3 outputs exist ─────────────────────────

function refreshUpstream() {
  console.log('▸ refreshing PAR-2 (xlsx → model.json) …');
  execSync('node tools/_par-sheet-to-model.mjs --all', { stdio: 'inherit', cwd: REPO });
  console.log('▸ refreshing PAR-3 (synthetic GDD MD) …');
  execSync('node tools/_synthetic-gdd-from-parsheet.mjs --all', {
    stdio: 'inherit',
    cwd: REPO,
  });
}

function listSlugs() {
  if (!existsSync(PAR_MODELS_DIR)) return [];
  return readdirSync(PAR_MODELS_DIR)
    .filter((d) => {
      const p = join(PAR_MODELS_DIR, d);
      return statSync(p).isDirectory() && existsSync(join(p, 'model.json'));
    })
    .sort();
}

// ─── Merge: GDD parser output + PAR-2 par-sheet model ───────────────────────

/**
 * Deep-merge the GDD-parser output with the PAR-2 emitted model.json so
 * the playable build carries:
 *   - PAR-2 par_sheet (real weighted reels),
 *   - PAR-2 payback (declared RTP),
 *   - PAR-2 winCap (declared or 100Spins-derived),
 *   - PAR-2 topology (correct reel count),
 *   - GDD parser symbols / features / compliance (synthetic UX wrap).
 *
 * Strategy: start with the GDD model; override the math-bearing keys
 * with their PAR-2 counterparts when present. Symbols stay from GDD
 * because PAR-3 already neutralized them to H1/M1/L1 IDs.
 */
function mergeModels(gddModel, parModel) {
  const merged = { ...gddModel };

  /* Topology: PAR-2 always wins — it counts real reel columns. */
  if (parModel.topology) {
    merged.topology = { ...gddModel.topology, ...parModel.topology };
  }

  /* Math fields: PAR-2 wins. */
  if (parModel.payback) merged.payback = parModel.payback;
  if (parModel.winCap) merged.winCap = parModel.winCap;
  if (parModel.par_sheet) merged.par_sheet = parModel.par_sheet;
  /* PAR-QA-3 (Boki 2026-06-26, post-PAR-5 audit): PAR-2 paytable carries
   * real vendor symbolIds (`red7`, `wild`, etc.) that match the par-
   * sheet reel-strip symbols. PAR-3 synthetic GDD synthesizes
   * placeholder symbols (H1/M1/L1) — but the synthetic paytable
   * pays are also placeholders. Pre-fix: the merge dropped the
   * PAR-2 paytable on the floor, leaving only the H1/M1/L1
   * placeholders in merged-model.json. PAR-5 convergence solver then
   * looked up symbol IDs in the wrong namespace and silently fell
   * back to zero pays → measured RTP wildly wrong.
   *
   * Post-fix: PAR-2 paytable wins. Symbols come from PAR-2 too when
   * PAR-2 emitted them (which is always — PAR-2 always has reel-strip
   * symbol list, never empty). This way paytable.symbolId references
   * resolve against the SAME id space as the reel strips. */
  if (parModel.paytable && parModel.paytable.length > 0) {
    merged.paytable = parModel.paytable;
    if (parModel.symbols) merged.symbols = parModel.symbols;
  }

  /* Provenance receipts: keep PAR-2 confidence + meta */
  merged.confidence = {
    ...(gddModel.confidence || {}),
    ...(parModel.confidence || {}),
  };
  merged.__meta__ = {
    ...(gddModel.__meta__ || {}),
    ...(parModel.__meta__ || {}),
    pipeline: 'par-sheet-batch-ingest (PAR-4)',
    upstream: ['PAR-2', 'PAR-3'],
  };

  return merged;
}

// ─── Per-slug build ─────────────────────────────────────────────────────────

function buildOne(slug) {
  const parModelPath = join(PAR_MODELS_DIR, slug, 'model.json');
  const syntheticMdPath = join(SYNTHETIC_DIR, `${slug}_SYNTHETIC_GDD.md`);

  if (!existsSync(parModelPath)) {
    return { ok: false, slug, reason: `PAR-2 model missing: ${parModelPath}` };
  }
  if (!existsSync(syntheticMdPath)) {
    return { ok: false, slug, reason: `PAR-3 synthetic GDD missing: ${syntheticMdPath}` };
  }

  const parModel = JSON.parse(readFileSync(parModelPath, 'utf8'));
  const syntheticMd = readFileSync(syntheticMdPath, 'utf8');

  /* parseGDD never throws — partial parses come back with
   * `_failures` in confidence so we can detect them downstream. */
  const gddModel = parseGDD(syntheticMd, 'md');
  const merged = mergeModels(gddModel, parModel);

  /* buildSlotHTML emits a self-contained HTML string. We pass the merged
   * model directly — the builder doesn't care whether it came from a
   * real GDD or a synthetic one as long as the schema is valid. */
  let html;
  try {
    html = buildSlotHTML(merged);
  } catch (e) {
    return { ok: false, slug, reason: `buildSlotHTML threw: ${e.message}` };
  }
  if (typeof html !== 'string' || html.length < 1000) {
    return {
      ok: false,
      slug,
      reason: `buildSlotHTML returned ${typeof html} (length ${html?.length})`,
    };
  }

  const slugOutDir = join(OUT_DIR, slug);
  mkdirSync(slugOutDir, { recursive: true });
  writeFileSync(join(slugOutDir, 'slot.html'), html);
  writeFileSync(join(slugOutDir, 'merged-model.json'), JSON.stringify(merged, null, 2));
  writeFileSync(
    join(slugOutDir, 'build-receipt.json'),
    JSON.stringify(
      {
        slug,
        builtAt: new Date().toISOString(),
        bytes: html.length,
        topology: merged.topology,
        rtp: merged.payback?.rtp ?? null,
        winCap: merged.winCap?.maxWinX ?? null,
        symbolCounts: {
          high: merged.symbols?.high?.length ?? 0,
          mid: merged.symbols?.mid?.length ?? 0,
          low: merged.symbols?.low?.length ?? 0,
          specials: merged.symbols?.specials?.length ?? 0,
        },
        reelStripCount: merged.par_sheet?.reelStrips?.length ?? 0,
        reelStripTotals:
          merged.par_sheet?.reelStrips?.map((rw) =>
            rw.reduce((s, e) => s + (e.weight || 0), 0),
          ) ?? [],
        sourcePipeline: 'par-sheet-autonomous-ingest',
        upstream: { par2: parModel.__meta__?.generator, par3: 'tools/_synthetic-gdd-from-parsheet.mjs' },
      },
      null,
      2,
    ),
  );

  return {
    ok: true,
    slug,
    bytes: html.length,
    paths: {
      html: join(slugOutDir, 'slot.html'),
      mergedModel: join(slugOutDir, 'merged-model.json'),
      receipt: join(slugOutDir, 'build-receipt.json'),
    },
    topology: merged.topology,
    rtp: merged.payback?.rtp ?? null,
    winCap: merged.winCap?.maxWinX ?? null,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(argv.slice(2));

  if (args.refresh) refreshUpstream();

  let slugs = listSlugs();
  if (args.slug) slugs = slugs.filter((s) => s === args.slug);
  if (slugs.length === 0) {
    console.error('ERROR: no par-sheet slugs to build.');
    console.error('       Hint: run with --refresh to regenerate PAR-2 + PAR-3 outputs.');
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Batch ingest: ${slugs.length} slug${slugs.length === 1 ? '' : 's'} → ${OUT_DIR}`);
  let pass = 0;
  let fail = 0;
  for (const slug of slugs) {
    const r = buildOne(slug);
    if (r.ok) {
      pass++;
      const rtp = r.rtp != null ? r.rtp.toFixed(2) + '%' : 'absent';
      const cap = r.winCap != null ? r.winCap.toLocaleString() : 'absent';
      console.log(
        `  ✓ ${slug} → slot.html (${r.bytes.toLocaleString()} B), ` +
          `${r.topology.reels}×${r.topology.rows}/${r.topology.paylines}, rtp=${rtp}, cap=${cap}`,
      );
    } else {
      fail++;
      console.log(`  ✗ ${slug}: ${r.reason}`);
    }
  }
  console.log(`\nSummary: ${pass} ok, ${fail} fail of ${slugs.length}`);
  if (fail > 0) process.exit(1);
}

main();
