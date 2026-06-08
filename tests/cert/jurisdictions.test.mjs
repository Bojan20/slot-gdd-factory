/**
 * tests/cert/jurisdictions.test.mjs — Wave C1
 *
 * Exercises the jurisdiction registry: lookup case-insensitivity,
 * required vs recommended kind separation, defensive copies, and the
 * "unknown code" null contract.
 */
import {
  listJurisdictions,
  getJurisdiction,
  getRequiredKinds,
  getRecommendedKinds,
} from '../../src/cert/jurisdictions.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— cert/jurisdictions.mjs —');

const codes = listJurisdictions();
t('listJurisdictions returns ≥ 5 codes', codes.length >= 5);
t('listJurisdictions is sorted ascending',
  JSON.stringify(codes) === JSON.stringify([...codes].sort()));
t('UKGC present', codes.includes('UKGC'));
t('MGA present',  codes.includes('MGA'));
t('DGA present',  codes.includes('DGA'));
t('SGA present',  codes.includes('SGA'));

const uk = getJurisdiction('UKGC');
t('UKGC spec has all required kinds',
  Array.isArray(uk.required) && uk.required.length >= 4);
t('UKGC requires reality_check', uk.required.includes('reality_check'));
t('UKGC requires session_timeout', uk.required.includes('session_timeout'));
t('UKGC requires net_loss_indicator', uk.required.includes('net_loss_indicator'));
t('UKGC requires win_cap', uk.required.includes('win_cap'));
t('UKGC region is GB', uk.region === 'GB');
t('UKGC anchor mentions LCCP', /LCCP/i.test(uk.anchor));

t('getJurisdiction is case-insensitive', getJurisdiction('ukgc').code === 'UKGC');
t('getJurisdiction(null) → null', getJurisdiction(null) === null);
t('getJurisdiction("") → null', getJurisdiction('') === null);
t('getJurisdiction("XYZ") → null', getJurisdiction('XYZ') === null);
t('getRequiredKinds(unknown) → []',
  Array.isArray(getRequiredKinds('XYZ')) && getRequiredKinds('XYZ').length === 0);
t('getRecommendedKinds(unknown) → []',
  Array.isArray(getRecommendedKinds('XYZ')) && getRecommendedKinds('XYZ').length === 0);

// Defensive-copy contract: caller mutation must not leak into registry.
const r1 = getRequiredKinds('UKGC');
r1.push('mutate_me');
const r2 = getRequiredKinds('UKGC');
t('getRequiredKinds returns defensive copy',
  !r2.includes('mutate_me'));

// Frozen spec contract.
let froze = false;
try { uk.code = 'HACK'; } catch (_) { froze = true; }
t('jurisdiction spec is frozen (strict-mode TypeError or silent no-op)',
  froze || uk.code === 'UKGC');

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
