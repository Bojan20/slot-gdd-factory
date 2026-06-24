#!/usr/bin/env node
/**
 * tools/_uq-deep-ao-batch-ingest-industry.mjs
 *
 * UQ-DEEP-AO · AO-2 — Batch ingest the 25 industry-reference PDFs that
 * live in ~/Desktop/GDD/ (01_HUFF_N_PUFF…pdf … 25_RAINBOW_RICHES…pdf).
 *
 * Why
 *   The cortex-eyes (UQ-DEEP-AO QA-A) probe surfaced a production gap:
 *   these 25 reference PDFs were on disk but never ingested, so
 *   `GET /preview/<slug>` returned 404 for the entire industry-reference
 *   set. This batch closes that gap.
 *
 * What it does
 *   1. For each PDF, derive a deterministic neutral slug
 *      (`01_HUFF_N_PUFF_HUFF_N_MORE_PUFF.pdf` → `industry-ref-01`).
 *      The leading two-digit index is the load-bearing identifier; the
 *      filename tail is deliberately NOT propagated into the slug —
 *      those filename tails contain vendor trademarks (HARD RULE).
 *   2. Spawn `node tools/ingest.mjs --file <pdf> --no-llm --slug <slug>`
 *      sequentially (so log streams stay readable; the wall-clock cost
 *      is dominated by `pdftotext` which is already fast).
 *   3. After each successful ingest, re-open the written
 *      `dist/ingest/<slug>/index.html`, scan the <title>…</title> for a
 *      vendor brand from the trademark list below. If a leak is found,
 *      rewrite both `model.json` (set `name`) and `index.html` (replace
 *      the title text) with a neutral fallback name — `Industry
 *      Reference NN` — so the publicly served preview is vendor-free.
 *   4. Print a per-slug result row + final tally.
 *
 * Output (transient — dist/ is gitignored, do NOT commit)
 *   dist/ingest/industry-ref-01/{index.html, model.json, raw.txt, …}
 *   …
 *   dist/ingest/industry-ref-25/{…}
 *
 * Exit
 *   0 — all 25 ingests succeeded (vendor scrubs applied as needed)
 *   1 — one or more ingests failed (see per-slug log line)
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..');
const DIST      = resolve(REPO, 'dist/ingest');
const GDD_DIR   = resolve(homedir(), 'Desktop/GDD');

/* Re-render path: when vendor scrub fires we re-import buildSlotHTML and
 * rewrite index.html from the neutralized model so the meta-tags, JS
 * `__MODEL_NAME__`, visible `<div class="title">`, etc. ALL pick up
 * the neutral name — not just the <title> tag. */
const { buildSlotHTML } = await import(
  pathToFileURL(resolve(REPO, 'src/buildSlotHTML.mjs')).href
);

/* The 25 industry-reference PDFs (operator-curated set; load order
 * matches the filename numeric prefix). */
const PDFS = [
  '01_HUFF_N_PUFF_HUFF_N_MORE_PUFF.pdf',
  '02_DANCING_DRUMS_DANCING_DRUMS_EXPLOSION_PROSPERITY.pdf',
  '03_88_FORTUNES.pdf',
  '04_LOCK_IT_LINK_Night_Life_Diamonds_Hold_Onto_Your_Hat_Eureka.pdf',
  '05_ULTIMATE_FIRE_LINK_China_Street_Olvera_Street_Route_66_Explosion.pdf',
  '06_QUICK_HIT_Platinum_Black_White_Diamond_etc.pdf',
  '07_JIN_JI_BAO_XI_ENDLESS_TREASURE_FU_DAO_LE_GONG_XI_FA_CAI.pdf',
  '08_RAINBOW_RICHES_Original_Road_to_Even_More_Riches.pdf',
  '09_JACKPOT_PARTY_SUPER_JACKPOT_PARTY.pdf',
  '10_GOLDFISH_GOLDFISH_FEEDING_TIME.pdf',
  '11_ZEUS_KRONOS_ZEUS_UNLEASHED_WMS_Legacy.pdf',
  '12_BIER_HAUS_HEIDI_HANNAHS_BIER_HAUS.pdf',
  '13_RAGING_RHINO.pdf',
  '14_INVADERS_FROM_PLANET_MOOLAH.pdf',
  '15_WILLY_WONKA_Pure_Imagination_World_of_Wonka_Dreamers_of_Dreams.pdf',
  '16_MONOPOLY_Electric_Wins_Mega_Movers_Multiple_Variants.pdf',
  '17_HUFF_N_MORE_PUFF_2022_-_1_LW_Game_on_US_Floor.pdf',
  '18_DANCING_DRUMS_EXPLOSION_PROSPERITY_20212023-24.pdf',
  '19_COIN_COMBO_Cai_Yuan_Guang_Jin_Festival_etc.pdf',
  '20_FRANKENSTEIN_2023_-_1_Eilers_Ranking.pdf',
  '21_JIN_LONG_888_5_TREASURES_2022.pdf',
  '22_GOLD_STACKS_88_Lightning_Box_LW_Online.pdf',
  '23_CASH_FALLS_SERIES.pdf',
  '24_88_FORTUNES_MEGAWAYS.pdf',
  '25_RAINBOW_RICHES_ONLINE_PORTS_Megaways_Slingo_Cluster.pdf',
];

/* Vendor brand regex — covers both provider names (IGT, L&W, …) AND the
 * specific product trademarks present in the 25 PDF tails. If any of
 * these tokens survive into the rendered <title>, we scrub the title +
 * model.name with a neutral "Industry Reference NN" fallback.
 *
 * Word-boundary on alphanumerics where possible; `\b` is unreliable
 * around apostrophes/ampersands so several entries embed optional
 * separators inline. */
const VENDOR_RX = new RegExp(
  '\\b(' + [
    'IGT', 'Pragmatic\\s*Play', 'NetEnt', 'L&W', 'Light\\s*&\\s*Wonder',
    'Scientific\\s*Games', 'WMS', 'Microgaming', 'Novomatic',
    'Aristocrat', 'Konami', 'AGS', 'Bally', 'Everi',
    'Huff\\s*[\'’]?\\s*n\\s*[\'’]?\\s*(?:More\\s*)?Puff',
    'Dancing\\s*Drums(?:\\s*Explosion)?(?:\\s*Prosperity)?',
    '88\\s*Fortunes(?:\\s*Megaways)?',
    'Lock\\s*[\'’]?\\s*It\\s*Link', 'Night\\s*Life',
    'Hold\\s*Onto\\s*Your\\s*Hat', 'Eureka',
    'Ultimate\\s*Fire\\s*Link', 'China\\s*Street', 'Olvera\\s*Street',
    'Route\\s*66\\s*Explosion',
    'Quick\\s*Hit', 'Platinum', 'Black\\s*(?:&|and)\\s*White\\s*Diamond',
    'Jin\\s*Ji\\s*Bao\\s*Xi(?:\\s*Endless\\s*Treasure)?',
    'Fu\\s*Dao\\s*Le', 'Gong\\s*Xi\\s*Fa\\s*Cai',
    'Rainbow\\s*Riches', 'Road\\s*to\\s*(?:Even\\s*)?More\\s*Riches',
    'Jackpot\\s*Party', 'Super\\s*Jackpot\\s*Party',
    'Goldfish(?:\\s*Feeding\\s*Time)?',
    'Zeus(?:\\s*Unleashed)?', 'Kronos',
    'Bier\\s*Haus', 'Heidi(?:\\s*[\'’]?s)?', 'Hannah(?:\\s*[\'’]?s)?',
    'Raging\\s*Rhino',
    'Invaders\\s*from\\s*Planet\\s*Moolah',
    'Willy\\s*Wonka', 'Pure\\s*Imagination', 'World\\s*of\\s*Wonka',
    'Dreamers\\s*of\\s*Dreams',
    'Monopoly', 'Electric\\s*Wins', 'Mega\\s*Movers',
    'Huff\\s*[\'’]?\\s*n\\s*[\'’]?\\s*More\\s*Puff',
    'Coin\\s*Combo', 'Cai\\s*Yuan\\s*Guang\\s*Jin',
    'Frankenstein', 'Eilers',
    'Jin\\s*Long\\s*888', '5\\s*Treasures',
    'Gold\\s*Stacks(?:\\s*88)?', 'Lightning\\s*Box',
    'Cash\\s*Falls(?:\\s*Series)?',
    'Slingo',
  ].join('|') + ')\\b',
  'i'
);

/* Slug derivation — keep only the leading numeric index so the rest of
 * the filename (which contains vendor trademarks) never enters the
 * filesystem path that the preview server later echoes back in URLs. */
function slugFor(pdfName) {
  const m = pdfName.match(/^(\d{1,2})_/);
  const idx = m ? m[1].padStart(2, '0') : 'xx';
  return `industry-ref-${idx}`;
}

function neutralName(slug) {
  const m = slug.match(/industry-ref-(\d+)/);
  return m ? `Industry Reference ${m[1]}` : 'Industry Reference';
}

function runIngest(pdfPath, slug) {
  return new Promise((resolve_) => {
    const p = spawn(
      'node',
      ['tools/ingest.mjs', '--file', pdfPath, '--no-llm', '--slug', slug],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO }
    );
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => resolve_({ code, out, err }));
  });
}

/**
 * If the rendered title still carries a vendor trademark, neutralize
 * `model.name` AND re-run buildSlotHTML so the entire page (meta tags,
 * visible title div, JS `__MODEL_NAME__`, manifest payload, …) picks up
 * the neutral name — not just the <title> tag. Returns true iff a
 * scrub was applied.
 *
 * Why full re-render: the original UQ-DEEP-AO V1 of this script only
 * patched the <title>…</title> with a regex. That left vendor mentions
 * in <meta apple-mobile-web-app-title>, in the `<div class="title">`
 * shown to the player, and in `const __MODEL_NAME__ = "…"` inside the
 * runtime JS — public surfaces, all of them. Re-rendering from the
 * neutralized model.json closes those leaks in one pass.
 */
function scrubVendorIfLeaked(slug) {
  const outDir = resolve(DIST, slug);
  const htmlPath  = resolve(outDir, 'index.html');
  const modelPath = resolve(outDir, 'model.json');
  if (!existsSync(htmlPath)) return { scrubbed: false, reason: 'no-html' };

  const html = readFileSync(htmlPath, 'utf8');
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const titleText = titleMatch ? titleMatch[1] : '';
  /* Trigger scrub if EITHER the <title> OR the visible title div OR
   * the meta apple-mobile-web-app-title content leaks a vendor brand. */
  const visTitleMatch = html.match(/<div class="title">([^<]+)<\/div>/);
  const visTitleText  = visTitleMatch ? visTitleMatch[1] : '';
  const metaMatch     = html.match(/<meta name="apple-mobile-web-app-title" content="([^"]+)"/);
  const metaText      = metaMatch ? metaMatch[1] : '';
  const leaked =
    (titleMatch   && VENDOR_RX.test(titleText)) ||
    (visTitleMatch && VENDOR_RX.test(visTitleText)) ||
    (metaMatch    && VENDOR_RX.test(metaText));
  if (!leaked) return { scrubbed: false, title: titleText };

  const neutral = neutralName(slug);
  if (!existsSync(modelPath)) {
    /* No model.json to re-render from — fall back to regex-replace the
     * obvious DOM surfaces in HTML directly. */
    let patched = html;
    patched = patched.replace(/<title>[^<]+<\/title>/, `<title>${neutral} · Base Game</title>`);
    patched = patched.replace(
      /<meta name="apple-mobile-web-app-title" content="[^"]+"/,
      `<meta name="apple-mobile-web-app-title" content="${neutral}"`
    );
    patched = patched.replace(
      /<div class="title">[^<]+<\/div>/,
      `<div class="title">${neutral}</div>`
    );
    writeFileSync(htmlPath, patched);
    return { scrubbed: true, before: titleText, after: `${neutral} · Base Game`, mode: 'regex-fallback' };
  }

  /* Full re-render path. */
  let model;
  try {
    model = JSON.parse(readFileSync(modelPath, 'utf8'));
  } catch {
    return { scrubbed: false, reason: 'model-parse-failed', title: titleText };
  }
  model.name = neutral;
  writeFileSync(modelPath, JSON.stringify(model, null, 2));

  let rebuilt;
  try {
    rebuilt = buildSlotHTML(model);
  } catch (e) {
    /* buildSlotHTML choked on the neutralized model — preserve the
     * original HTML but at least patch the visible surfaces. */
    let patched = html;
    patched = patched.replace(/<title>[^<]+<\/title>/, `<title>${neutral} · Base Game</title>`);
    patched = patched.replace(
      /<meta name="apple-mobile-web-app-title" content="[^"]+"/,
      `<meta name="apple-mobile-web-app-title" content="${neutral}"`
    );
    patched = patched.replace(
      /<div class="title">[^<]+<\/div>/,
      `<div class="title">${neutral}</div>`
    );
    writeFileSync(htmlPath, patched);
    return { scrubbed: true, before: titleText, after: `${neutral} · Base Game`, mode: `regex-fallback (rebuild err: ${String(e.message || e).slice(0, 80)})` };
  }
  writeFileSync(htmlPath, rebuilt);
  return { scrubbed: true, before: titleText, after: `${neutral} · Base Game`, mode: 'full-rebuild' };
}

/* ── main ────────────────────────────────────────────────────────────── */

const startedAt = Date.now();
let success = 0;
const failed = [];
const vendorLeaks = [];
const scrubbed = [];

console.log(`UQ-DEEP-AO · AO-2 batch ingest — ${PDFS.length} industry-reference PDFs`);
console.log(`source: ${GDD_DIR}`);
console.log(`target: ${DIST}/industry-ref-NN/`);
console.log('');

for (const pdf of PDFS) {
  const slug = slugFor(pdf);
  const path = resolve(GDD_DIR, pdf);
  if (!existsSync(path)) {
    console.log(`  SKIP ${slug}: source not on disk (${pdf})`);
    failed.push({ slug, pdf, reason: 'missing-source' });
    continue;
  }
  const t0 = Date.now();
  const result = await runIngest(path, slug);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (result.code === 0) {
    success++;
    const scrubRes = scrubVendorIfLeaked(slug);
    if (scrubRes.scrubbed) {
      scrubbed.push({ slug, before: scrubRes.before, after: scrubRes.after, mode: scrubRes.mode });
      vendorLeaks.push({ slug, title: scrubRes.before });
      console.log(`  OK   ${slug}  (${dt}s)  · SCRUBBED [${scrubRes.mode}]: "${scrubRes.before}" → "${scrubRes.after}"`);
    } else if (scrubRes.reason === 'no-html') {
      console.log(`  WARN ${slug}  (${dt}s)  · no index.html written (parser produced empty model?)`);
    } else {
      console.log(`  OK   ${slug}  (${dt}s)  · title="${scrubRes.title}"`);
    }
  } else {
    failed.push({ slug, pdf, code: result.code, stderr: result.err.slice(0, 200) });
    console.log(`  FAIL ${slug}  (${dt}s)  · exit=${result.code}  stderr=${result.err.slice(0, 160).replace(/\n/g, ' ')}`);
  }
}

const wallSec = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('');
console.log(`──────────────────────────────────────────────────────────────────────`);
console.log(`Ingested:        ${success}/${PDFS.length}`);
console.log(`Failed:          ${failed.length}`);
console.log(`Vendor leaks:    ${vendorLeaks.length}  (scrubbed in-place)`);
console.log(`Wall clock:      ${wallSec}s`);
console.log(`──────────────────────────────────────────────────────────────────────`);

if (failed.length) {
  console.log('');
  console.log('Failed slugs:');
  for (const f of failed) {
    console.log(`  - ${f.slug}: ${f.reason || `exit=${f.code}`}`);
  }
}
if (scrubbed.length) {
  console.log('');
  console.log('Title scrubs applied:');
  for (const s of scrubbed) {
    console.log(`  - ${s.slug}: "${s.before}" → "${s.after}"`);
  }
}

process.exit(failed.length ? 1 : 0);
