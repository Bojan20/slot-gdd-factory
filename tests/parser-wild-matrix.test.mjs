/* eslint-disable no-console */
/**
 * tests/parser-wild-matrix.test.mjs — UQ-DEEP-AK · WAVE 2 · PARSER E
 *
 * Verifies the two IGT-canonical wild atom extractors:
 *
 *   • extractWildSubstitution(text)       — substitutesFor + excludesScatter
 *                                           + excludesBonus + excludesWild
 *                                           + excludesSymbols
 *   • extractWildReelRestriction(text)    — appearsOnReels + excludesReels
 *
 * Coverage: 18 cases (6 × extractWildSubstitution, 6 × extractWildReelRestriction,
 * 6 × parseGDD integration). Pattern follows tests/parser-extended-wild.test.mjs.
 */
import {
  extractWildSubstitution,
  extractWildReelRestriction,
  parseGDD,
} from '../src/parser.mjs';

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('parser-wild-matrix (UQ-DEEP-AK · WAVE 2 · PARSER E) contract');

/* ───────────────────────────────────────────────────────────────────────
 * 1 · extractWildSubstitution · EN positive — substitutes for all symbols
 *     except scatter AND bonus
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSubstitution(
    'Wild substitutes for all symbols except scatter and bonus.'
  );
  t('01 EN substitutesFor + excludesScatter + excludesBonus all set',
    r && r.excludesScatter === true && r.excludesBonus === true &&
    Array.isArray(r.substitutesFor) && r.substitutesFor.length > 0);
}

/* ───────────────────────────────────────────────────────────────────────
 * 2 · extractWildSubstitution · SR positive
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSubstitution(
    'Wild zamenjuje sve simbole osim scatter-a.'
  );
  t('02 SR substitution detected (excludesScatter true)',
    r && r.excludesScatter === true);
}

/* ───────────────────────────────────────────────────────────────────────
 * 3 · excludesScatter detection on a standalone rule line (no
 *     "substitutes for" anchor)
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSubstitution(
    'The wild does not substitute the scatter symbol under any circumstance.'
  );
  t('03 standalone excludesScatter sentinel fires (no primary anchor needed)',
    r && r.excludesScatter === true);
}

/* ───────────────────────────────────────────────────────────────────────
 * 4 · excludesBonus detection on a standalone rule line
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSubstitution(
    'Wild substitutes for paying symbols except bonus during free spins.'
  );
  t('04 excludesBonus sentinel detected', r && r.excludesBonus === true);
}

/* ───────────────────────────────────────────────────────────────────────
 * 5 · excludesSymbols — after "except B, S" tail
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSubstitution(
    'Wild substitutes for all symbols except B, S in the base game.'
  );
  t('05 excludesSymbols captured (B, S)',
    r && Array.isArray(r.excludesSymbols) &&
    r.excludesSymbols.includes('B') && r.excludesSymbols.includes('S'));
}

/* ───────────────────────────────────────────────────────────────────────
 * 6 · negative — no wild prose at all → null
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildSubstitution(
    'Five reels, three rows, ten paylines. Free spins triggered on three scatters.'
  );
  t('06 negative case (no wild prose) → null', r === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 7 · extractWildReelRestriction · EN positive
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildReelRestriction(
    'Wild appears only on reels 2, 3 and 4 during the base game.'
  );
  t('07 EN appearsOnReels === [2,3,4]',
    r && Array.isArray(r.appearsOnReels) &&
    r.appearsOnReels.length === 3 &&
    r.appearsOnReels.includes(2) && r.appearsOnReels.includes(3) &&
    r.appearsOnReels.includes(4));
}

/* ───────────────────────────────────────────────────────────────────────
 * 8 · extractWildReelRestriction · SR positive
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildReelRestriction(
    'Wild se pojavljuje samo na rolnama 2 i 4 tokom osnovne igre.'
  );
  t('08 SR appearsOnReels includes 2 and 4',
    r && Array.isArray(r.appearsOnReels) &&
    r.appearsOnReels.includes(2) && r.appearsOnReels.includes(4));
}

/* ───────────────────────────────────────────────────────────────────────
 * 9 · excludesReels EN — "wild does not appear on reel 1"
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildReelRestriction(
    'The wild does not appear on reel 1 to preserve the centre-reel feature.'
  );
  t('09 EN excludesReels includes 1',
    r && Array.isArray(r.excludesReels) && r.excludesReels.includes(1));
}

/* ───────────────────────────────────────────────────────────────────────
 * 10 · negative — generic prose with no reel-restriction → null
 *      (this is the "excludesReels SR negative" check from the spec)
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildReelRestriction(
    'Pet rolni, tri reda, deset linija isplate. Standardna isplata sleva nadesno.'
  );
  t('10 SR negative (no wild reel prose) → null', r === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 11 · evidence ≤ 300 chars even with huge surrounding context
 * ─────────────────────────────────────────────────────────────────────── */
{
  const filler = 'word '.repeat(400);
  const sample = filler + 'Wild appears only on reels 2, 3 and 4. ' + filler;
  const r = extractWildReelRestriction(sample);
  t('11 evidence length ≤ 300 chars',
    r && typeof r.evidence === 'string' && r.evidence.length <= 300);
}

/* ───────────────────────────────────────────────────────────────────────
 * 12 · negative — empty / no anchor → null
 * ─────────────────────────────────────────────────────────────────────── */
{
  const r = extractWildReelRestriction('');
  t('12 empty input → null', r === null);
  const r2 = extractWildReelRestriction(
    'The reels spin clockwise. Multiple paylines are evaluated on each spin.'
  );
  t('12b no anchor → null', r2 === null);
}

/* ───────────────────────────────────────────────────────────────────────
 * 13 · parseGDD integration — model.wild.substitution populated
 * ─────────────────────────────────────────────────────────────────────── */
{
  const sample = [
    '# Sample Slot',
    '',
    'Five reels, three rows, ten paylines.',
    'Wild substitutes for all symbols except scatter and bonus.',
    'Wild appears only on reels 2, 3 and 4.',
  ].join('\n');
  const m = parseGDD(sample, 'md');
  const sub = m && m.wild && m.wild.substitution;
  t('13 parseGDD → model.wild.substitution populated',
    !!sub && sub.excludesScatter === true && sub.excludesBonus === true);
}

/* ───────────────────────────────────────────────────────────────────────
 * 14 · parseGDD integration — model.wild.reelRestriction populated
 * ─────────────────────────────────────────────────────────────────────── */
{
  const sample = [
    '# Sample Slot',
    '',
    'Five reels, three rows, ten paylines.',
    'Wild substitutes for all symbols except scatter and bonus.',
    'Wild appears only on reels 2, 3 and 4.',
  ].join('\n');
  const m = parseGDD(sample, 'md');
  const rr = m && m.wild && m.wild.reelRestriction;
  t('14 parseGDD → model.wild.reelRestriction populated (reels 2,3,4)',
    !!rr && Array.isArray(rr.appearsOnReels) &&
    rr.appearsOnReels.includes(2) && rr.appearsOnReels.includes(3) &&
    rr.appearsOnReels.includes(4));
}

/* ───────────────────────────────────────────────────────────────────────
 * 15 · back-compat — parseGDD on GDD with NO wild prose → both atoms null
 * ─────────────────────────────────────────────────────────────────────── */
{
  const sample = [
    '# Plain Slot',
    '',
    'Five reels, three rows, ten paylines. Standard symbols pay left to right.',
    'A Free Spins feature awards 10 spins on 3 scatters.',
  ].join('\n');
  const m = parseGDD(sample, 'md');
  const subAbsent = !m || !m.wild ||
    (m.wild.substitution == null && m.wild.reelRestriction == null);
  t('15 back-compat: GDD with no wild prose → no substitution / reelRestriction',
    !!subAbsent);
}

/* ───────────────────────────────────────────────────────────────────────
 * 16 · schemaVersion === '1' present on both atoms (positive case)
 * ─────────────────────────────────────────────────────────────────────── */
{
  const sub = extractWildSubstitution(
    'Wild substitutes for all symbols except scatter and bonus.'
  );
  const rr = extractWildReelRestriction(
    'Wild appears only on reels 2 and 3.'
  );
  t('16 schemaVersion === "1" on both atoms',
    sub && sub.schemaVersion === '1' &&
    rr  && rr.schemaVersion === '1');
}

/* ───────────────────────────────────────────────────────────────────────
 * 17 · evidence non-empty when detected (audit trail contract)
 * ─────────────────────────────────────────────────────────────────────── */
{
  const sub = extractWildSubstitution(
    'Wild substitutes for all symbols except scatter and bonus.'
  );
  const rr = extractWildReelRestriction(
    'Wild appears only on reels 2 and 3.'
  );
  t('17 evidence non-empty on both atoms',
    sub && typeof sub.evidence === 'string' && sub.evidence.length > 0 &&
    rr  && typeof rr.evidence  === 'string' && rr.evidence.length > 0);
}

/* ───────────────────────────────────────────────────────────────────────
 * 18 · frozen object output (contract immutability)
 * ─────────────────────────────────────────────────────────────────────── */
{
  const sub = extractWildSubstitution(
    'Wild substitutes for all symbols except scatter and bonus.'
  );
  const rr = extractWildReelRestriction(
    'Wild appears only on reels 2 and 3.'
  );
  t('18 returned objects are frozen',
    Object.isFrozen(sub) && Object.isFrozen(rr));
}

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
