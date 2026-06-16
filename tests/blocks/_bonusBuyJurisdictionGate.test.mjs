#!/usr/bin/env node
/**
 * tests/blocks/_bonusBuyJurisdictionGate.test.mjs
 *
 * Wave W57.A4 — bonusBuy cross-jurisdiction ban gate.
 *
 * Validates that operator deploying under UKGC / SE / DE / NL CANNOT
 * surface bonus-buy regardless of GDD intent. Pattern mirrors
 * winCap.mjs (W51) precedence chain: regulator.profile >
 * responsibleGambling.jurisdiction > bonusBuy.jurisdiction.
 *
 * Citations:
 *   • UKGC LCCP Jun-2026 bonus-buy ban
 *   • SE Spelinspektionen Spellag 14:6 ban
 *   • DE GlüStV §11(3) ban
 *   • NL KSA Spel-1 §31 ban
 */
import {
  defaultConfig,
  resolveConfig,
  BONUS_BUY_BANNED_JURISDICTIONS,
} from '../../src/blocks/bonusBuy.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

/* ════════════════════════════════════════════════════════════════════
 * 1. Banned-jurisdictions export
 * ════════════════════════════════════════════════════════════════════ */
block('1. BONUS_BUY_BANNED_JURISDICTIONS export', () => {
  t('1.1 export is frozen',                 Object.isFrozen(BONUS_BUY_BANNED_JURISDICTIONS));
  t('1.2 contains UKGC',                    BONUS_BUY_BANNED_JURISDICTIONS.includes('UKGC'));
  t('1.3 contains SE',                      BONUS_BUY_BANNED_JURISDICTIONS.includes('SE'));
  t('1.4 contains DE',                      BONUS_BUY_BANNED_JURISDICTIONS.includes('DE'));
  t('1.5 contains NL',                      BONUS_BUY_BANNED_JURISDICTIONS.includes('NL'));
  t('1.6 exactly 4 banned',                 BONUS_BUY_BANNED_JURISDICTIONS.length === 4);
  t('1.7 does NOT ban MGA (allowed)',       !BONUS_BUY_BANNED_JURISDICTIONS.includes('MGA'));
  t('1.8 does NOT ban ON (allowed)',        !BONUS_BUY_BANNED_JURISDICTIONS.includes('ON'));
  t('1.9 does NOT ban NJ (allowed)',        !BONUS_BUY_BANNED_JURISDICTIONS.includes('NJ'));
  t('1.10 does NOT ban IT (allowed)',       !BONUS_BUY_BANNED_JURISDICTIONS.includes('IT'));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Banned jurisdictions force enabled=false
 * ════════════════════════════════════════════════════════════════════ */
block('2. Banned jurisdictions override GDD intent', () => {
  for (const j of ['UKGC', 'SE', 'DE', 'NL']) {
    const cfg = resolveConfig({
      bonusBuy: { enabled: true, jurisdiction: j },
    });
    t(`2.${j} ${j} forces enabled=false even with explicit enabled=true`,
      cfg.enabled === false);
    t(`2.${j}.bannedByJurisdiction flag set`, cfg.bannedByJurisdiction === true);
    t(`2.${j}.jurisdiction captured`,         cfg.jurisdiction === j);
  }
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Banned jurisdiction overrides feature auto-detect
 * ════════════════════════════════════════════════════════════════════ */
block('3. Banned jurisdiction overrides feature auto-enable', () => {
  const cfg = resolveConfig({
    features: [{ kind: 'bonus_buy' }],
    responsibleGambling: { jurisdiction: 'DE' },
  });
  t('3.1 DE+feature(bonus_buy) → enabled=false',
    cfg.enabled === false);
  t('3.2 jurisdiction captured as DE',
    cfg.jurisdiction === 'DE');
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Allowed jurisdictions honor GDD enabled flag
 * ════════════════════════════════════════════════════════════════════ */
block('4. Allowed jurisdictions honor GDD intent', () => {
  for (const j of ['MGA', 'ON', 'NJ', 'IT']) {
    const cfgOn = resolveConfig({
      bonusBuy: { enabled: true, jurisdiction: j },
    });
    t(`4.${j} ${j}+enabled=true stays enabled=true`,
      cfgOn.enabled === true);
    t(`4.${j}.bannedByJurisdiction=false in allowed market`,
      cfgOn.bannedByJurisdiction === false);

    const cfgOff = resolveConfig({
      bonusBuy: { enabled: false, jurisdiction: j },
    });
    t(`4.${j} ${j}+enabled=false stays enabled=false`,
      cfgOff.enabled === false);
  }
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Precedence chain — regulator > responsibleGambling > bonusBuy
 * ════════════════════════════════════════════════════════════════════ */
block('5. Precedence chain', () => {
  /* All three set; regulator.profile (highest) wins */
  const c1 = resolveConfig({
    bonusBuy: { enabled: true, jurisdiction: 'MGA' },
    responsibleGambling: { jurisdiction: 'ON' },
    regulator: { profile: 'UKGC' },
  });
  t('5.1 regulator.profile=UKGC overrides MGA/ON → ban fires',
    c1.enabled === false && c1.jurisdiction === 'UKGC');

  /* Only responsibleGambling */
  const c2 = resolveConfig({
    bonusBuy: { enabled: true, jurisdiction: 'MGA' },
    responsibleGambling: { jurisdiction: 'DE' },
  });
  t('5.2 responsibleGambling.jurisdiction=DE overrides bonusBuy.jurisdiction=MGA',
    c2.enabled === false && c2.jurisdiction === 'DE');

  /* Case-insensitive */
  const c3 = resolveConfig({
    bonusBuy: { enabled: true, jurisdiction: 'ukgc' },
  });
  t('5.3 lowercase jurisdiction normalized + ban fires',
    c3.enabled === false && c3.jurisdiction === 'UKGC');
});

/* ════════════════════════════════════════════════════════════════════
 * 6. OFF and unknown jurisdictions
 * ════════════════════════════════════════════════════════════════════ */
block('6. OFF and unknown jurisdictions', () => {
  const off = resolveConfig({
    bonusBuy: { enabled: true, jurisdiction: 'OFF' },
  });
  t('6.1 OFF jurisdiction does NOT trigger ban', off.enabled === true);

  const unknown = resolveConfig({
    bonusBuy: { enabled: true, jurisdiction: 'ATLANTIS' },
  });
  t('6.2 unknown jurisdiction does NOT trigger ban',
    unknown.enabled === true);
  t('6.3 unknown jurisdiction still captured',
    unknown.jurisdiction === 'ATLANTIS');

  const noJur = resolveConfig({ bonusBuy: { enabled: true } });
  t('6.4 no jurisdiction set → no ban, no jurisdiction field',
    noJur.enabled === true && typeof noJur.jurisdiction === 'undefined');
});

/* ════════════════════════════════════════════════════════════════════
 * 7. Default config baseline (no regression)
 * ════════════════════════════════════════════════════════════════════ */
block('7. Default config baseline (regression)', () => {
  const d = defaultConfig();
  t('7.1 defaults stay shape-compatible (enabled false by default)',
    d.enabled === false);
  t('7.2 defaults have no jurisdiction field',
    typeof d.jurisdiction === 'undefined');
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
