/* eslint-disable no-console */
/**
 * tests/parser-extended-wild.test.mjs — UQ-DEEP-AJ · P1C contract test.
 *
 * Verifies `extractWildSpecial(text)` regex extractor + its integration into
 * `parseGDD` (population of `model.wild.special.*`). Covers 8 industry-
 * standard wild variants (copy_wild, extended_wild, added_symbols, in_sync,
 * walking_wild, multiplier_wild, expanding_wild, sticky_wild_per_spin) in
 * EN + SR with positive + negative cases, plus 6 integration assertions.
 *
 * Pattern follows tests/blocks/cellOverflowCounter.test.mjs (pass/fail
 * counter + non-zero exit on failure).
 */
import { extractWildSpecial, parseGDD } from '../src/parser.mjs';

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('parser-extended-wild (UQ-DEEP-AJ · P1C) contract');

/* ───────────────────────────────────────────────────────────────────────
 * 1-3 · copy_wild · EN positive / SR positive / negative
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('The Wild on reel 3 copies to reels 2 and 4 during the bonus round.');
  t('01 copy_wild EN positive detected',
    r.copy_wild && Array.isArray(r.copy_wild.sourceReels) &&
    r.copy_wild.sourceReels.includes(3) &&
    r.copy_wild.targetReels.includes(2) && r.copy_wild.targetReels.includes(4));
}
{
  const r = extractWildSpecial('Wild simbol na rolnu 3 kopira na rolne 2 i 4 tokom bonus runde.');
  t('02 copy_wild SR positive detected',
    r.copy_wild && r.copy_wild.sourceReels.includes(3));
}
{
  const r = extractWildSpecial('Wild substitutes for all paying symbols and pays left to right.');
  t('03 copy_wild negative case (no match)', r.copy_wild === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 4-6 · extended_wild · EN positive / SR positive / negative
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Each Wild remains for 3 additional spins after landing.');
  t('04 extended_wild EN positive detected',
    r.extended_wild && r.extended_wild.extraSpins === 3);
}
{
  const r = extractWildSpecial('Prosireni wild — wild ostaje 5 dodatnih okreta na rolni.');
  t('05 extended_wild SR positive detected',
    r.extended_wild != null);
}
{
  const r = extractWildSpecial('The base game uses standard Wild substitution mechanics only.');
  t('06 extended_wild negative case (no match)', r.extended_wild === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 7-9 · added_symbols · EN positive / SR positive / negative
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Additional wild symbols added to reel during bonus phase.');
  t('07 added_symbols EN positive detected',
    r.added_symbols && r.added_symbols.symbolId === 'wild');
}
{
  const r = extractWildSpecial('Dodatni wild simboli dodati u rolne tokom besplatnih okreta.');
  t('08 added_symbols SR positive detected',
    r.added_symbols != null);
}
{
  const r = extractWildSpecial('Symbols pay left-to-right starting from reel one.');
  t('09 added_symbols negative case (no match)', r.added_symbols === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 10-12 · in_sync · EN positive / SR positive / negative
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Reels 2-3 spin in sync during the free spin feature.');
  t('10 in_sync EN positive detected',
    r.in_sync && r.in_sync.reels.includes(2) && r.in_sync.reels.includes(3));
}
{
  const r = extractWildSpecial('Rolne 2 i 3 su sinhronizovane tokom besplatnih okreta.');
  t('11 in_sync SR positive detected',
    r.in_sync != null);
}
{
  const r = extractWildSpecial('Each reel independently spins with its own outcome.');
  t('12 in_sync negative case (no match)', r.in_sync === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 13-15 · walking_wild · EN positive / SR positive / negative
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Wild moves one position left each spin until it leaves the grid.');
  t('13 walking_wild EN positive detected',
    r.walking_wild && r.walking_wild.direction === 'left');
}
{
  const r = extractWildSpecial('Hodajuci wild — wild se pomera levo svaki okret.');
  t('14 walking_wild SR positive detected',
    r.walking_wild != null);
}
{
  const r = extractWildSpecial('The Wild expands but does not move between spins.');
  t('15 walking_wild negative case (no match)', r.walking_wild === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 16-18 · multiplier_wild · EN positive / SR positive / negative
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Wild with 2x, 3x or 5x multiplier applied to the winning combination.');
  t('16 multiplier_wild EN positive detected',
    r.multiplier_wild && r.multiplier_wild.multipliers.length >= 1);
}
{
  const r = extractWildSpecial('Wild nosi mnozioc 2x 3x ili 5x koji se primenjuje na dobitak.');
  t('17 multiplier_wild SR positive detected',
    r.multiplier_wild != null);
}
{
  const r = extractWildSpecial('The Wild simply substitutes without any extra prize boost.');
  t('18 multiplier_wild negative case (no match)', r.multiplier_wild === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 19-21 · expanding_wild · EN positive / SR positive / negative
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Expanding wild covers the full reel when landing.');
  t('19 expanding_wild EN positive detected',
    r.expanding_wild && r.expanding_wild.expandTo === 'reel');
}
{
  const r = extractWildSpecial('Rasiruci wild — wild popunjava rolnu kada se pojavi.');
  t('20 expanding_wild SR positive detected',
    r.expanding_wild != null);
}
{
  const r = extractWildSpecial('Standard Wild appears only on the centre reel position.');
  t('21 expanding_wild negative case (no match)', r.expanding_wild === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 22-24 · sticky_wild_per_spin · EN positive / SR positive / negative
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Wild remains sticky during free spins for the full bonus round.');
  t('22 sticky_wild_per_spin EN positive detected',
    r.sticky_wild_per_spin && r.sticky_wild_per_spin.scope === 'freeSpins');
}
{
  const r = extractWildSpecial('Lepljiv wild — wild ostaje tokom besplatni okreta do kraja bonusa.');
  t('23 sticky_wild_per_spin SR positive detected',
    r.sticky_wild_per_spin != null);
}
{
  const r = extractWildSpecial('Wild appears in the base game with no carry-over rules.');
  t('24 sticky_wild_per_spin negative case (no match)', r.sticky_wild_per_spin === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 25 · INTEGRATION — full sample text via parseGDD → 8 variants populated
 * ─────────────────────────────────────────────────────────────────────── */
{
  const sample = [
    '# Sample Slot',
    '',
    'The Wild on reel 3 copies to reels 2 and 4 during the bonus round.',
    'Each Wild remains for 3 additional spins after landing.',
    'Additional wild symbols added to reel during bonus phase.',
    'Reels 2-3 spin in sync during the free spin feature.',
    'Wild moves one position left each spin until it leaves the grid.',
    'Wild with 2x, 3x or 5x multiplier applied to the winning combination.',
    'Expanding wild covers the full reel when landing.',
    'Wild remains sticky during free spins for the full bonus round.',
  ].join('\n');
  const m = parseGDD(sample, 'md');
  const sp = m && m.wild && m.wild.special;
  const allEight = sp && sp.copy_wild && sp.extended_wild && sp.added_symbols &&
                   sp.in_sync && sp.walking_wild && sp.multiplier_wild &&
                   sp.expanding_wild && sp.sticky_wild_per_spin;
  t('25 parseGDD integration: all 8 wild variants populated', !!allEight);
}

/* ───────────────────────────────────────────────────────────────────────
 * 26 · BACK-COMPAT — sample text with NO extended wild → wild.special is
 *     present but contains no detected variants (only schemaVersion).
 * ─────────────────────────────────────────────────────────────────────── */
{
  const sample = [
    '# Plain Slot',
    '',
    'Five reels, three rows, ten paylines. Standard symbols pay left to right.',
    'A Free Spins feature awards 10 spins on 3 scatters.',
  ].join('\n');
  const m = parseGDD(sample, 'md');
  const sp = m && m.wild && m.wild.special;
  const noneDetected = sp && !sp.copy_wild && !sp.extended_wild && !sp.added_symbols &&
                       !sp.in_sync && !sp.walking_wild && !sp.multiplier_wild &&
                       !sp.expanding_wild && !sp.sticky_wild_per_spin;
  t('26 back-compat: no extended wild content → no detections', !!noneDetected);
}

/* ───────────────────────────────────────────────────────────────────────
 * 27 · evidence field present + non-empty
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Expanding wild covers the full reel when landing.');
  t('27 evidence field present + non-empty',
    r.expanding_wild && typeof r.expanding_wild.evidence === 'string' &&
    r.expanding_wild.evidence.length > 0);
}

/* ───────────────────────────────────────────────────────────────────────
 * 28 · evidence length ≤ 300 chars even with massive surrounding context
 * ─────────────────────────────────────────────────────────────────────── */
{
  const filler = 'word '.repeat(400);
  const sample = filler + 'Expanding wild covers the full reel when landing. ' + filler;
  const r = extractWildSpecial(sample);
  t('28 evidence length ≤ 300 chars',
    r.expanding_wild && r.expanding_wild.evidence.length <= 300);
}

/* ───────────────────────────────────────────────────────────────────────
 * 29 · schemaVersion === '1'
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('');
  t('29 schemaVersion === "1" on empty input', r.schemaVersion === '1');
  const r2 = extractWildSpecial('Sticky wild remains during free spins.');
  t('29b schemaVersion === "1" on positive input', r2.schemaVersion === '1');
}

/* ───────────────────────────────────────────────────────────────────────
 * 30 · Returns frozen object
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSpecial('Walking wild moves left.');
  t('30 returned object is frozen', Object.isFrozen(r));
}

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
