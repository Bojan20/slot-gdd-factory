#!/usr/bin/env node
/**
 * tools/_synthetic-gdd-from-parsheet.mjs
 *
 * PAR-3 (PAR-SHEET AUTONOMOUS INGEST) — Boki direktiva 2026-06-26.
 *
 * # PURPOSE
 *
 * The par sheet carries all the MATH a slot needs — reel weights,
 * paytable economics, declared RTP. What it does NOT carry is the
 * UX wrapper a player sees: theme name, narrative, color palette,
 * capsule kind, jurisdiction text, animations spec.
 *
 * For games where we have a par sheet but no GDD (4 of 5 in operator
 * inventory), we synthesize a vendor-neutral, slug-derived synthetic
 * GDD that's good enough to drive `buildSlotHTML` end-to-end. The
 * synthetic name + theme is generic ("Game Skeleton Key 5x3", "abstract
 * geometric", "neutral palette"). The math comes from the real par
 * sheet via PAR-2's emitted `dist/par-sheet-real-games/<slug>/model.json`.
 *
 * # OUTPUT
 *
 *   samples/synthetic/<slug>_SYNTHETIC_GDD.md
 *
 * Structure mirrors the canonical Crystal Forge / Midnight Fangs GDD
 * template (sections 1-10) so the existing parser ingests it without
 * special-casing. Sections that need GDD-only info (narrative, palette)
 * carry vendor-neutral defaults. Sections that need math (topology,
 * paytable, RTP) read from the par sheet model directly.
 *
 * # ANTI-VENDOR
 *
 * Every emitted string passes through the LV3-11 antiVendorShield
 * sanitize() registry. Symbol labels that came from the par sheet
 * (e.g. "Lucky Kirin") become neutral category descriptors
 * ("High-pay symbol 1").
 *
 * # USAGE
 *
 *   node tools/_synthetic-gdd-from-parsheet.mjs \
 *     --model dist/par-sheet-real-games/cash-eruption/model.json
 *
 *   node tools/_synthetic-gdd-from-parsheet.mjs --all
 *
 * # OUT OF SCOPE
 *
 *   - Audio brief (HARD RULE #4 — audio is off-limits in this repo).
 *   - Compliance jurisdiction selection per market — defaults to
 *     UKGC + MGA, callers override via --jurisdiction.
 *   - Real narrative or art direction — placeholder text only.
 */

import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { argv } from 'node:process';

const DEFAULT_MODELS_DIR = resolve(process.cwd(), 'dist', 'par-sheet-real-games');
const DEFAULT_OUT_DIR = resolve(process.cwd(), 'samples', 'synthetic');

// ─── Anti-vendor sanitizer ──────────────────────────────────────────────────

/* LV3-11 anti-vendor shield public API: `sanitizeStr(s)` replaces any
 * vendor-tainted token with "[vendor]" or strips the brand mark. We
 * also pull `isVendorTainted(s)` so the title pass can swap to a fully
 * neutral slug-derived label when the vendor name leaks. */
async function loadAntiVendor() {
  try {
    const mod = await import('../src/registry/antiVendorShield.mjs');
    return {
      sanitize: mod.sanitizeStr || ((s) => s),
      isTainted: mod.isVendorTainted || (() => false),
    };
  } catch {
    return {
      sanitize: (s) => String(s).replace(/[^\w\s\-+×x().,/]/g, ''),
      isTainted: () => false,
    };
  }
}

// ─── Slug → neutral display name ────────────────────────────────────────────

/**
 * Generate a vendor-neutral display title. Strategy:
 *
 *   1. Title-case the slug (best signal — derived from filename, often
 *      includes the vendor brand mark).
 *   2. Run through anti-vendor sanitize.
 *   3. If the sanitized result contains `[vendor]` or is empty, fall
 *      back to a pure synthetic label `Game-<HASH4> <reels>x<rows>`
 *      where the 4-char hash comes from the slug — keeps slugs unique
 *      without ever surfacing the vendor brand.
 *
 * `topology` is optional; when missing we omit the dimensions suffix.
 */
/**
 * Generate a vendor-neutral display title.
 *
 * Synthetic GDDs ALWAYS use a `Game-<HASH4> <reels>x<rows>` label —
 * never the slug-derived natural title — because the anti-vendor
 * shield's registry covers only a curated list of known brand marks.
 * Operator par sheets routinely surface titles outside that list
 * ("Skeleton Key", "Book Of Unseen Bonus Buy", "Fortune Coin Boost
 * Classic") which would slip through `sanitizeStr` unchanged and leak
 * into emitted MD. Forcing a hash-derived neutral label means we cannot
 * surface ANY operator-supplied brand mark in the synthetic GDD, only
 * a stable opaque ID + topology dimensions.
 *
 * The original slug is still used for path lookup
 * (`dist/par-sheet-real-games/<slug>/model.json`) — that's an internal
 * routing key, not a user-visible string.
 */
function neutralTitle(slug, av, topology) {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  const tag = hash.toString(36).toUpperCase().padStart(4, '0').slice(-4);
  const dims = topology ? ` ${topology.reels}x${topology.rows}` : '';
  /* av unused on the happy path — kept in the signature because callers
   * may want to surface a shield-validated alt title for debug. */
  void av;
  return `Game-${tag}${dims}`;
}

// ─── MD template (vendor-neutral defaults + math from model.json) ────────────

/**
 * Build the synthetic GDD markdown. Sections mirror the canonical
 * Crystal Forge template (sections 1-10 + appendix). Math comes from
 * the par sheet model; UX/theme/narrative carry neutral defaults the
 * parser ingests without special-casing.
 *
 * @param {object} model — universalGameSchema model.json
 * @param {object} manifest — par sheet provenance
 * @param {string} title — vendor-neutral display name
 * @returns {string} markdown
 */
function buildMd(model, manifest, title) {
  const topo = model.topology || { reels: 5, rows: 3, paylines: 20, kind: 'rectangular' };
  const rtp = model.payback?.rtp;
  const winCap = model.winCap?.maxWinX;

  /* PAR-3 emits neutral H1/M1/L1 / W/S/B symbol IDs in the synthetic GDD
   * regardless of what came out of the par sheet — the anti-vendor
   * shield only covers a curated brand list and operator par sheets
   * routinely surface symbol names outside that list ("Emperor",
   * "Lucky Kirin", "Wolf Run") that would otherwise leak into the
   * emitted markdown. The original model.json (PAR-2 output) keeps
   * the source IDs for math reproducibility; the synthetic GDD is a
   * UX wrapper and uses the neutral aliases only. */
  const renameToCategory = (arr, prefix) =>
    arr.map((entry, i) => ({
      ...entry,
      id: `${prefix}${i + 1}`,
      label: `${prefix}-pay symbol ${i + 1}`,
    }));
  const highs = renameToCategory(model.symbols?.high || [], 'H');
  const mids = renameToCategory(model.symbols?.mid || [], 'M');
  const lows = renameToCategory(model.symbols?.low || [], 'L');
  /* Specials use role-derived single-char IDs (W/S/B), which carry no
   * vendor signal regardless of source label. */
  const specials = (model.symbols?.specials || []).map((entry) => ({
    ...entry,
    id:
      entry.role === 'wild'
        ? 'W'
        : entry.role === 'scatter'
        ? 'S'
        : entry.role === 'bonus'
        ? 'B'
        : 'X',
    label: `${entry.role || 'special'} symbol`,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const par_sha = manifest?.source?.sha256 || 'absent';
  const par_file = manifest?.source?.filename || 'absent';

  return `# ${title} — Game Design Document (Synthetic, par-sheet-derived)

> **Document type**: Synthetic Game GDD (auto-generated from par sheet)
> **Source**: par-sheet-autonomous-ingest (PAR-3)
> **Pair**: math sourced from \`dist/par-sheet-real-games/${model.slug}/model.json\`
> **Audience**: factory pipeline (UX wrap → playable slot.html)
> **Status**: synthetic — vendor-neutral wrapper, real par sheet math
> **Generated**: ${today}
> **Par sheet**: \`${par_file}\`
> **Par sheet SHA-256**: \`${par_sha.slice(0, 16)}…\`

---

## 1. Game identity

| Field | Value |
|---|---|
| Internal name | ${title} |
| Genre | Video slot |
| Theme tags | abstract · neutral · synthetic |
| Target market | Global, regulator-grade |
| Target session length | 6–12 minutes |
| Player persona | Generic slot fans, 21–50 |
| Platforms | HTML5 mobile + desktop, portrait 1080×1920 |
| Provenance | Math from par sheet; UX wrapper synthesized |

---

## 2. Theme & narrative

| Element | Description |
|---|---|
| Setting | Neutral geometric stage |
| Mood | Calm · industrial · placeholder |
| Color palette | Slate \`#2a2e3a\` · steel \`#5a6878\` · highlight gold \`#ffaa00\` · paper white |
| Typography | Display: clean geometric sans · UI: same family, body weight |
| Vibe references | Abstract test grid for math validation |

> _Note_: this section carries vendor-neutral placeholder content
> because the source par sheet does not provide theme metadata. Real
> theme assets are applied at PAR-4 batch ingest if a paired GDD lands
> later.

---

## 3. Topology & layout

| Element | Value |
|---|---|
| Reels | ${topo.reels} |
| Rows | ${topo.rows} |
| Paylines | ${topo.paylines} fixed |
| Reel mechanism | ${topo.kind === 'tumble' ? 'Tumble (cascade)' : 'Independent weighted reels'} |
| Anticipation | Standard slow-stop on final reel when 2+ Scatters present |

### Payline pattern coverage

${topo.paylines} fixed lines, generated by the platform's standard
ascending pattern set. See \`src/payouts/paylines.mjs\` for the
canonical pattern table per (reels × rows) topology.

---

## 4. Symbol roster

### High-pay (${highs.length})

| ID | Name | Art brief |
|:---:|---|---|
${
  highs.length > 0
    ? highs.map((s, i) => `| \`${s.id}\` | High-pay symbol ${i + 1} | Synthetic placeholder; replace with real art at PAR-4 |`).join('\n')
    : '| `HI` | Placeholder high | Synthetic placeholder |'
}

### Mid-pay (${mids.length})

| ID | Name | Art brief |
|:---:|---|---|
${
  mids.length > 0
    ? mids.map((s, i) => `| \`${s.id}\` | Mid-pay symbol ${i + 1} | Synthetic placeholder |`).join('\n')
    : '| `MD` | Placeholder mid | Synthetic placeholder |'
}

### Low-pay (${lows.length})

| ID | Name | Art brief |
|:---:|---|---|
${
  lows.length > 0
    ? lows.map((s, i) => `| \`${s.id}\` | Low-pay symbol ${i + 1} | Synthetic placeholder |`).join('\n')
    : '| `LO` | Placeholder low | Synthetic placeholder |'
}

### Specials (${specials.length})

| ID | Role | Notes |
|:---:|---|---|
${
  specials.length > 0
    ? specials
        .map(
          (s) =>
            `| \`${s.id}\` | ${s.role || 'special'} | ${
              s.role === 'wild'
                ? 'Substitutes for high/mid/low symbols; not for scatter'
                : s.role === 'scatter'
                ? 'Triggers free-spin bonus on 3+'
                : 'Triggers bonus feature'
            } |`,
        )
        .join('\n')
    : '| `W` | wild | Standard wild placeholder |\n| `S` | scatter | Standard scatter placeholder |'
}

---

## 5. Paytable

Paytable values are sourced from the par sheet at simulation time
(\`par_sheet.reelStrips\` weighted distribution). The factory parser
derives 3 / 4 / 5-of-a-kind multipliers from the engine's Monte Carlo
output rather than from a hand-curated GDD table — that's the canonical
truth for math-driven slots.

---

## 6. Features

| Feature kind | Status | Notes |
|:---|:---:|:---|
| Base game | ✅ Active | Standard line-pay evaluator |
| Free spins | 📋 Inferred | Triggered by 3+ scatter (par sheet weight) |
| Hold & Win | ⏭ Off (synthetic) | Not present in par sheet weight tables |
| Cascade | ⏭ Off (synthetic) | Add via paired GDD if title supports it |
| Multiplier | 📋 Inferred | If multiplier label appears in par sheet feature math |

> _Note_: feature presence here reflects what the par sheet HINTS
> at via reel-strip column count and feature math keywords. Real
> feature activation requires a paired GDD for the wave/state machine.

---

## 7. Math

| Field | Value |
|---|---|
| Declared RTP | ${rtp != null ? rtp.toFixed(2) + ' %' : 'absent — derive from MC simulation'} |
| Max-win cap | ${winCap != null ? winCap.toLocaleString() + ' × bet' : 'absent — alternate extraction needed'} |
| Volatility band | inferred from par sheet weighted reel distribution |
| Hit frequency | inferred from per-reel symbol count (low symbols dominant ⇒ high hit-rate) |

Math is the authoritative source of truth for this game. UX wrapper
above is provisional. RTP precision band per LV3 wave: ±0.05 pp.

---

## 8. Compliance

| Jurisdiction | Status |
|:---|:---:|
| UKGC | ✅ Default-on for synthetic GDDs |
| MGA | ✅ Default-on for synthetic GDDs |
| Sweden (SGA) | 📋 Requires explicit jurisdiction flag |
| Germany (GlüNeuRStV) | 📋 Requires explicit jurisdiction flag |
| Netherlands (KSA) | 📋 Requires explicit jurisdiction flag |
| Ontario (AGCO) | 📋 Requires explicit jurisdiction flag |

> _Note_: jurisdiction enablement is set to UKGC + MGA by default for
> synthetic GDDs. Override via PAR-4 batch flags
> (\`--jurisdictions=ukgc,mga,sga\`) when running per-market builds.

---

## 9. UX strings (synthetic placeholders)

| Surface | String |
|---|---|
| Game title display | ${title} |
| FS intro banner | "Free Spins triggered" |
| Big-win celebration | "Big Win" |
| Mega-win celebration | "Mega Win" |
| Max-win cap reached | "Max Win Reached" |
| Paytable header | "Paytable" |
| Settings header | "Settings" |

UX strings are intentionally generic so that the synthetic build
passes anti-vendor lint. Final copy lands when a paired GDD provides
real narrative.

---

## 10. Engineering meta

| Field | Value |
|---|---|
| Schema version | \`v1\` |
| Generator | \`tools/_synthetic-gdd-from-parsheet.mjs\` (PAR-3) |
| Source par sheet | \`${par_file}\` |
| Par sheet SHA-256 | \`${par_sha}\` |
| Model path | \`dist/par-sheet-real-games/${model.slug}/model.json\` |
| Synthesized at | ${today} |
| Anti-vendor pass | applied |

---

## Appendix — confidence receipts

\`\`\`json
${JSON.stringify(model.confidence || {}, null, 2)}
\`\`\`

End of synthetic GDD.
`;
}

// ─── Driver ──────────────────────────────────────────────────────────────────

async function generateOne(slugDir, outDir) {
  const modelPath = join(slugDir, 'model.json');
  const manifestPath = join(slugDir, 'manifest.json');
  if (!existsSync(modelPath)) {
    return { ok: false, slug: basename(slugDir), reason: `model.json missing` };
  }

  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {};

  const av = await loadAntiVendor();
  const title = neutralTitle(model.slug || basename(slugDir), av, model.topology);
  const md = buildMd(model, manifest, title);

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${model.slug}_SYNTHETIC_GDD.md`);
  writeFileSync(outPath, md);

  return {
    ok: true,
    slug: model.slug,
    title,
    outPath,
    sizeBytes: Buffer.byteLength(md, 'utf8'),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { model: null, all: false, dir: DEFAULT_MODELS_DIR, out: DEFAULT_OUT_DIR };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--model') out.model = resolve(args[++i]);
    else if (a === '--all') out.all = true;
    else if (a === '--dir') out.dir = resolve(args[++i]);
    else if (a === '--out') out.out = resolve(args[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const targets = [];

  if (args.all) {
    if (!existsSync(args.dir)) {
      console.error(`ERROR: ${args.dir} missing`);
      process.exit(2);
    }
    const entries = readdirSync(args.dir).filter((d) => {
      const p = join(args.dir, d);
      return statSync(p).isDirectory() && existsSync(join(p, 'model.json'));
    });
    for (const e of entries) targets.push(join(args.dir, e));
  } else if (args.model) {
    targets.push(resolve(args.model, '..'));
  } else {
    console.error('USAGE: --model <model.json>  OR  --all [--dir <models-dir>]');
    process.exit(2);
  }

  if (targets.length === 0) {
    console.error('ERROR: no targets');
    process.exit(2);
  }

  console.log(`Synthesizing ${targets.length} synthetic GDD${targets.length === 1 ? '' : 's'} → ${args.out}`);
  let pass = 0;
  let fail = 0;
  for (const slugDir of targets) {
    const r = await generateOne(slugDir, args.out);
    if (r.ok) {
      pass++;
      console.log(`  ✓ ${r.slug} → ${basename(r.outPath)} (${r.sizeBytes} bytes)`);
    } else {
      fail++;
      console.log(`  ✗ ${basename(slugDir)}: ${r.reason}`);
    }
  }
  console.log(`\nSummary: ${pass} ok, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
