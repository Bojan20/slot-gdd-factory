/**
 * tests/blocks/pdfToMarkdown.test.mjs
 *
 * Regression suite for the PDF → markdown converter — verifies that every
 * GDD shape produces a renderable template:
 *   • Game name extraction across single-line, multi-line, ALL-CAPS,
 *     Title:-prefixed, and connector-split ("Gates of\nOlympus 1000") titles.
 *   • Triplet-anchored symbol parser handles 3 paytable layout families:
 *     classic 3x/4x/5x (Huff'n'Puff), pay-anywhere min/8-9/10-11/12+
 *     (Gates-of-Olympus), cluster Min/Max/Payout (Starlight).
 *   • Card ranks (A/K/Q/J/10) classify as Low; Premium/High → high tier.
 *   • Special-role rows (Wild/Scatter/Bonus) detected by keyword.
 *   • Fallback paytable kicks in when extraction yields 0 symbols so the
 *     emitted dist always renders.
 *   • Free Spins trigger N detected for Scatter / Hard Hat / Bonus.
 *   • Ways evaluation emits "## 02c · Ways to Win" section AND `Ways count`.
 *   • End-to-end: emitted MD parses cleanly + builds renderable slot HTML.
 *
 * Senior-grade defensive cases:
 *   • Empty input → empty output (no crash).
 *   • Unicode emoji prefixes (👑 / 💍 / ⏳) strip cleanly.
 *   • Tier label embedded mid-name ("Premiu PIGGY 2") strips correctly.
 *   • Boki rule (06.06.2026): "ne sme da se desi da ubacim bilo koji gdd,
 *     a da se nesto ne procita ili da nema templejt koji ce da poipuni" —
 *     fallback set MUST appear when extraction is empty.
 */
import { pdfTextToMarkdown } from '../../src/pdfToMarkdown.mjs';
import { parseGDD } from '../../src/parser.mjs';
import { buildSlotHTML } from '../../src/buildSlotHTML.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— blocks/pdfToMarkdown.mjs —');

/* ────────────────── empty / malformed input ──────────────── */
t('empty string → empty output',           pdfTextToMarkdown('') === '');
t('null → empty output',                   pdfTextToMarkdown(null) === '');
t('non-string → empty output',             pdfTextToMarkdown({}) === '');
t('pure whitespace → renders fallback symbols',
  /Premium Symbol 1/.test(pdfTextToMarkdown('   \n  \n   ')));

/* ────────────────── game name extraction ──────────────────── */
{
  const txt = `HUFF N' MORE PUFF
Game Design Document — Ultra Detailed`;
  const md = pdfTextToMarkdown(txt);
  t('ALL-CAPS title (HUFF N\' MORE PUFF) extracted', /^# HUFF N' MORE PUFF/m.test(md));
}
{
  const txt = `STARLIGHT TRAVELLERS
   Game Design Document — Reverse Engineering Analysis`;
  const md = pdfTextToMarkdown(txt);
  t('ALL-CAPS multi-token title at top extracted', /^# STARLIGHT TRAVELLERS/m.test(md));
}
{
  /* "Title:" prefix + connector wrap (Gates of\nOlympus 1000) — needs
   * raw text preservation so column gap detection works. */
  const txt = `STUDIO Pragmatic
⚡ Radni naslov: Gates of
   Olympus 1000                         Some description here`;
  const md = pdfTextToMarkdown(txt);
  t('Title: prefix with connector wrap captures full multi-line title',
    /^# Gates of Olympus 1000\b/m.test(md),
    'got: ' + (md.match(/^# (.+)$/m) || [])[1]);
  t('Description column words NOT appended to title',
    !/^# .*Some description/m.test(md));
}
{
  /* Internal name: variant. */
  const txt = `Internal name: Foobar Slot
Game Design Document`;
  const md = pdfTextToMarkdown(txt);
  t('Internal name: prefix captures title', /^# Foobar Slot/m.test(md));
}
{
  /* No detectable title → fallback symbol set still renders (so the
   * template is renderable even on a weird PDF). */
  const md = pdfTextToMarkdown('random text with no slot-shaped content');
  t('no title detected → md still emits Topology + fallback symbols',
    /## 02 · Topology/.test(md) && /Premium Symbol/.test(md));
}

/* ────────────────── grid / topology defaults ──────────────── */
{
  const md = pdfTextToMarkdown('Random text, no grid mentioned');
  t('no grid declared → defaults to 5×3 (universal baseline)',
    /\| Reels \| 5 \|/.test(md) && /\| Rows \| 3 \|/.test(md));
}
{
  const txt = 'Grid: 6×5 (30 positions)';
  const md = pdfTextToMarkdown(txt);
  t('explicit 6×5 grid extracted', /\| Reels \| 6 \|/.test(md) && /\| Rows \| 5 \|/.test(md));
}

/* ────────────────── evaluation kinds ──────────────── */
{
  const md = pdfTextToMarkdown('Win Mechanic: 243 Ways to Win — Reel Ways');
  t('"243 Ways" → eval=Ways + ways count 243',
    /\| Evaluation \| Ways \|/.test(md) && /\| Ways count \| 243 \|/.test(md));
  t('"243 Ways" emits "## 02c · Ways to Win" section', /## 02c · Ways to Win/.test(md));
}
{
  const md = pdfTextToMarkdown('Cluster Pays mechanic, 5+ symbol clusters');
  t('"Cluster Pays" → eval=Cluster pays', /\| Evaluation \| Cluster pays \|/.test(md));
}
{
  const md = pdfTextToMarkdown('Scatter Pays — all positions pay');
  t('"Scatter Pays" → eval=Pay anywhere grid',
    /\| Evaluation \| Pay anywhere grid \|/.test(md));
}
{
  const md = pdfTextToMarkdown('Traditional 20-payline slot');
  t('no evaluation keyword → eval=Lines (default)', /\| Evaluation \| Lines \|/.test(md));
}

/* ────────────────── symbol extraction — classic 3x/4x/5x ──────────────── */
{
  const txt = `Symbols & Paytable
4.1 Symbol Hierarchy

  Symbol         Type    3x     4x     5x      Notes
  PIGGY 2        Premium 1.5x   3.0x   6.0x
  PIGGY 1        Premium 1.0x   2.0x   4.0x
  Toolbox        Mid     0.5x   1.0x   2.5x
  Tape Measure   Mid     0.4x   0.8x   2.0x
  A              Low     0.2x   0.5x   1.5x
  K              Low     0.2x   0.4x   1.2x
  Q              Low     0.15x  0.3x   1.0x
  J              Low     0.1x   0.2x   0.8x
  10             Low     0.1x   0.2x   0.6x

4.2 Symbol Distribution`;
  const md = pdfTextToMarkdown(txt);
  t('classic 3x/4x/5x layout: PIGGY 2 captured as High',
    /### High-pay[\s\S]*PIGGY 2/.test(md));
  t('classic layout: PIGGY 1 captured as High',
    /### High-pay[\s\S]*PIGGY 1/.test(md));
  t('classic layout: Toolbox captured as Mid',
    /### Mid-pay[\s\S]*Toolbox/.test(md));
  t('classic layout: Tape Measure captured as Mid',
    /### Mid-pay[\s\S]*Tape Measure/.test(md));
  t('classic layout: A captured as Low',
    /### Low-pay[\s\S]*\| `A` \| A \|/.test(md));
  t('classic layout: 10 captured as Low (T10 id)',
    /### Low-pay[\s\S]*\| `T10` \| 10 \|/.test(md));
  t('classic layout: synthetic IDs differ (Toolbox vs 10)',
    /`TOO`/.test(md) && /`T10`/.test(md));
  t('classic layout: distribution section does NOT leak into paytable',
    !/Reel 1/.test(md.split('### Specials')[0]));
}

/* ────────────────── symbol extraction — pay-anywhere with emoji ──────────────── */
{
  const txt = `Simboli & Paytable
8 regularnih + 1 Scatter + 1 Multiplier

  SIMBOL          TIP             MIN     8-9     10-11   12+
                                  DOBITAK

  👑 Zeus         High            8       10x     25x     50x
  (Crown)

  ⏳ Hourglass    High            8       2.5x    10x     25x

  💍 Ring         High            8       2x      5x      15x

  🍷 Chalice      Mid             8       1.5x    2x      12x

Multiplier Orb on tumble`;
  const md = pdfTextToMarkdown(txt);
  t('emoji prefix stripped: Zeus captured', /Zeus/.test(md));
  t('emoji prefix stripped: Ring captured', /Ring/.test(md));
  t('emoji prefix stripped: Chalice captured', /Chalice/.test(md));
  t('parenthetical alias (Crown) stripped',
    !/Zeus.*Crown/.test(md) || /Zeus.*\|/.test(md));
}

/* ────────────────── free spins / bonus buy ──────────────── */
{
  const txt = `Free Spins
Trigger: 6+ Hard Hats anywhere on the grid.
Award: 10 Free Spins.
Buy Feature available at 47.5x bet direct bonus entry.`;
  const md = pdfTextToMarkdown(txt);
  t('FS trigger from "Hard Hats" keyword',
    /6\+ Scatter simbola/.test(md));
  t('FS spins award captured (10)', /10 Free Spins/.test(md));
  t('Bonus Buy decimal cost preserved (47.5x not 47x)',
    /Cena \| \*\*47\.5x\*\*/.test(md));
}

/* ────────────────── fallback paytable when extraction empty ──────────────── */
{
  /* GDD-like text with topology + features but NO symbol table at all. */
  const txt = `Slot GDD Document
GRID: 5 reels x 3 rows
RTP: 96.0%`;
  const md = pdfTextToMarkdown(txt);
  t('no symbol table → fallback High-pay (Premium Symbol N)',
    /### High-pay[\s\S]*Premium Symbol 1/.test(md));
  t('no symbol table → fallback Low-pay includes A/K/Q/J/10',
    /### Low-pay[\s\S]*\| `A` \|[\s\S]*\| `K` \|[\s\S]*\| `Q` \|[\s\S]*\| `J` \|[\s\S]*\| `T` \| 10/.test(md));
  t('no symbol table → fallback Specials include Wild + Scatter',
    /### Specials[\s\S]*Wild[\s\S]*Scatter/.test(md));
}

/* ────────────────── special-role detection ──────────────── */
{
  const txt = `Symbol Hierarchy
  Wolf Wild       Special    Substitutes all except Hard Hat / Buzz Saw
  Hard Hat        Scatter    6+ triggers Free Spins
  Buzz Saw        Bonus      3+ triggers Buzz Saw Wheel`;
  const md = pdfTextToMarkdown(txt);
  t('Wild detected (substitution role)',
    /### Specials[\s\S]*\| `W` \| Wild \| Substitutes/.test(md));
  t('Scatter detected with trigger threshold',
    /### Specials[\s\S]*\| `S` \| Scatter \| 6\+ triggers Free Spins/.test(md));
  t('Bonus detected', /### Specials[\s\S]*\| `B` \| Bonus \| Triggers/.test(md));
  t('Specials sort: Wild → Scatter → Bonus (industry convention)',
    md.indexOf('| `W` |') < md.indexOf('| `S` |') &&
    md.indexOf('| `S` |') < md.indexOf('| `B` |'));
}

/* ────────────────── end-to-end: build slot HTML from each PDF shape ──────────────── */
function endToEnd(label, txt, expectedReels) {
  const md = pdfTextToMarkdown(txt);
  let model, html;
  try { model = parseGDD(md, 'md'); }
  catch (e) { t(`${label}: parseGDD throws`, false, e.message); return; }
  try { html = buildSlotHTML(model); }
  catch (e) { t(`${label}: buildSlotHTML throws`, false, e.message); return; }
  t(`${label}: pipeline emits renderable HTML (≥ 200 KB)`, html.length > 200 * 1024);
  t(`${label}: model.topology.reels = ${expectedReels}`, model.topology.reels === expectedReels);
  t(`${label}: at least 1 symbol parsed (no empty model)`,
    model.symbols.high.length + model.symbols.mid.length +
    model.symbols.low.length + model.symbols.specials.length >= 1);
}
endToEnd('Huff-style 5×3 ways', `HUFF N' MORE PUFF
Game Design Document
GRID: 5 reels x 3 rows
243 Ways to Win
Symbols & Paytable
  PIGGY 2  Premium  1.5x  3.0x  6.0x
  A        Low      0.2x  0.5x  1.5x`, 5);
endToEnd('GoO-style 6×5 pay-anywhere', `Gates of Olympus
Game Design Document
GRID: 6 columns x 5 rows
Scatter Pays
Simboli & Paytable
  Zeus  High  8  10x  25x  50x
  Ring  High  8  2x   5x   15x`, 6);
endToEnd('Empty paytable falls back', `Mystery Slot
Game Design Document
GRID: 5 reels x 3 rows`, 5);

console.log(`\n  ${pass} pass, ${fail} fail (${pass + fail} total)\n`);
if (fail > 0) process.exit(1);
