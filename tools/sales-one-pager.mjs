#!/usr/bin/env node
/**
 * tools/sales-one-pager.mjs · Functional Item #10 — Sales one-pager
 * generator (per game, vendor-neutral).
 *
 * Input  : a `model.json` (output of parser pipeline) — usually under
 *          `dist/real-games/<slug>/model.json`. Default: process every
 *          model under dist/real-games/.
 * Output : `dist/sales-one-pagers/<slug>/one-pager.md`
 *
 * The one-pager is the artifact a sales lead hands to a regulator,
 * casino procurement, or trade-show booth. It must:
 *   - Summarise the game in ≤ 1 printed page (≤ 500 words).
 *   - Be VENDOR-NEUTRAL — no industry standard / Pragmatic / NetEnt / Microgaming /
 *     L&W / Cleopatra / Buffalo / Megaways / Cash Eruption etc.
 *     mention. (rule_no_vendor_mentions.)
 *   - Surface only mechanics + theme tags + feature kinds + topology
 *     + palette. Math (RTP / volatility / max-win) is OFF-TOPIC per
 *     standing Boki rule and gets a deliberate placeholder row.
 *
 * Pre-emit guard: every output string is scanned against the banned
 * vendor list; any hit aborts emission with exit 2 (regulator-grade
 * fail-closed semantics).
 *
 * Exit codes:
 *   0  every targeted model emitted a one-pager
 *   1  one or more had warnings (sparse paytable, missing feature)
 *   2  banned vendor token detected — emission ABORTED
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const ART_DIR = resolve(REPO, 'dist/real-games');
const OUT_DIR = resolve(REPO, 'dist/sales-one-pagers');

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');

const log = (...m) => { if (!QUIET) console.log(...m); };

/**
 * Vendor-neutrality guard. ANY hit on output text → ABORT with exit 2.
 *
 * Keep this list in lockstep with rule_no_vendor_mentions. Internal
 * Boki chat may mention these for context, but sales output never can.
 */
const BANNED_TOKENS = /\b(igt|pragmatic|cash[- ]eruption|wolf[- ]run|cleopatra|buffalo|megaways|netent|microgaming|scientific\s*games|l&w|light\s*&\s*wonder|playtech|aristocrat|nyx|big\s*time\s*gaming)\b/i;

if (!existsSync(ART_DIR)) {
  console.error(`❌ ${ART_DIR} missing.`); process.exit(2);
}
const slugs = readdirSync(ART_DIR)
  .filter((d) => statSync(resolve(ART_DIR, d)).isDirectory())
  .filter((d) => existsSync(resolve(ART_DIR, d, 'model.json')));
if (slugs.length === 0) { console.error('❌ no models'); process.exit(2); }

log(`📰 Sales one-pager generator · ${slugs.length} model(s)`);

mkdirSync(OUT_DIR, { recursive: true });

const KIND_LABELS = {
  free_spins:    'Free Spins round',
  hold_and_win:  'Hold & Win respin',
  multiplier:    'Win Multiplier',
  multiplier_orb:'Orb Multiplier (persistent)',
  bonus_buy:     'Bonus Buy',
  wheel_bonus:   'Wheel Bonus',
  jackpot:       'Tiered Jackpot',
  cluster_pays:  'Cluster Pays evaluation',
  ways:          'Ways-Pay evaluation',
  pay_anywhere:  'Pay-Anywhere evaluation',
  scatter_pay:   'Scatter Pay',
  cascade:       'Cascade / Tumble mechanic',
  ante_bet:      'Ante Bet boost',
  gamble:        'Gamble round',
  expanding_wild:'Expanding Wild',
  sticky_wild:   'Sticky Wild',
  mystery_symbol:'Mystery Symbol reveal',
  feature_generic:'Additional Feature (vendor-neutral)',
};

let results = [];

for (const slug of slugs) {
  const model = JSON.parse(readFileSync(resolve(ART_DIR, slug, 'model.json'), 'utf8'));
  const name = (model.name || slug).replace(/\s+/g, ' ').trim();
  const topo = model.topology || {};
  const evalLabel = ({
    lines: 'Lines',
    ways: 'Ways',
    cluster: 'Cluster Pays',
    pay_anywhere: 'Pay Anywhere',
    scatter: 'Scatter Pays',
  })[topo.evaluation] || topo.evaluation || 'Lines';

  const themeTags = (model.theme?.tags || []).slice(0, 6).join(', ') || '—';
  const palette   = (model.theme?.palette || []).slice(0, 6).join(' · ') || '—';
  const mood      = model.theme?.mood || '—';

  const kinds = (model.features || []).map((f) => f.kind);
  const featureRows = kinds.map((k) => `- **${KIND_LABELS[k] || k.replace(/_/g, ' ')}**`).join('\n') || '- (no feature blocks declared)';

  const symTotal = (model.symbols?.high?.length || 0)
                 + (model.symbols?.mid?.length || 0)
                 + (model.symbols?.low?.length || 0)
                 + (model.symbols?.specials?.length || 0);
  const symBreakdown = `HP ${model.symbols?.high?.length || 0} · MP ${model.symbols?.mid?.length || 0} · LP ${model.symbols?.low?.length || 0} · ★ ${model.symbols?.specials?.length || 0}`;

  const md = `# ${name} — One-Pager

> Vendor-neutral game summary. Math claims (RTP / volatility / max-win)
> are intentionally omitted — those land via the certified PAR sheet,
> not this document.

## At a glance

| Field | Value |
|:--|:--|
| Display name | **${name}** |
| Grid | **${topo.reels || '—'} × ${topo.rows || '—'}** |
| Evaluation | **${evalLabel}** |
| Paylines | ${topo.paylines ?? '—'} |
| Theme tags | ${themeTags} |
| Mood | ${mood} |
| Palette | \`${palette}\` |
| Symbols (total ${symTotal}) | ${symBreakdown} |
| Feature kinds (${kinds.length}) | ${kinds.join(', ') || '—'} |

## Feature mix

${featureRows}

## Math claims

| Metric | Status |
|:--|:--|
| RTP | _per certified PAR sheet_ |
| Volatility | _per certified PAR sheet_ |
| Max win cap | _per certified PAR sheet_ |
| Hit frequency | _per certified PAR sheet_ |

## Compliance & certification

This game is shipped through the slot-gdd-factory cert pipeline. Every
build produces a regulator-friendly bundle containing:

- \`manifest.json\` — game id, version, build hash, compliance verdict
- \`evidence.json\` — SHA-256 hash chain over the source GDD + every
  attached artefact (PDF, reconstructed markdown, built slot.html)
- \`compliance.json\` — per-jurisdiction (UKGC / MGA / DGA / SGA /
  NJDGE / DGOJ) pass/fail with missing-feature itemisation
- \`README.txt\` — auditor-readable summary

## Build

| Field | Value |
|:--|:--|
| Source | \`${slug}\` |
| Generated | ${new Date().toISOString()} |
| Generator | \`tools/sales-one-pager.mjs\` |
| Vendor-neutrality guard | hard fail-closed |
`;

  /* Vendor guard — refuse to emit if banned token slips into output
   * (defensive against future paste from a leaked GDD field, etc.). */
  if (BANNED_TOKENS.test(md)) {
    console.error(`❌ ${slug}: BANNED vendor token detected in one-pager output — ABORTING.`);
    process.exit(2);
  }

  const outDir = resolve(OUT_DIR, slug);
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'one-pager.md');
  writeFileSync(outPath, md);

  /* Warnings: sparse paytable / no features */
  const warns = [];
  if (symTotal < 6) warns.push('sparse-paytable');
  if (kinds.length === 0) warns.push('no-features');
  log(`  ${warns.length ? '⚠' : '✓'} ${slug.padEnd(40)} ${kinds.length} kinds · ${symTotal} symbols${warns.length ? '  warn=[' + warns.join(',') + ']' : ''}`);
  results.push({ slug, outPath, kinds: kinds.length, symbols: symTotal, warns });
}

const warned = results.filter((r) => r.warns.length).length;
log(`\nSUMMARY · ${results.length} one-pager(s) emitted · ${warned} with warnings · vendor guard ✓`);
log(`Artifacts: ${OUT_DIR}/<slug>/one-pager.md`);

process.exit(warned > 0 ? 1 : 0);
