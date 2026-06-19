/**
 * tests/cert/_jurisdictionsExpansion.test.mjs · C-6 LEGO-CERT2
 *
 * Validates 5 new EU jurisdictions added: ADM (Italy), ANJ (France),
 * KSA (Netherlands), GGL (Germany), ESBK (Switzerland).
 */
import {
  listJurisdictions,
  getJurisdiction,
  getRequiredKinds,
  getRecommendedKinds,
} from '../../src/cert/jurisdictions.mjs';

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== Cert jurisdictions expansion (C-6 LEGO-CERT2) ===');

const all = listJurisdictions();
t('total jurisdictions ≥ 12 after C-6 expansion', all.length >= 12, `got ${all.length}`);

const NEW = ['ADM', 'ANJ', 'KSA', 'GGL', 'ESBK'];
for (const code of NEW) {
  const spec = getJurisdiction(code);
  t(`${code} present in registry`, !!spec);
  if (spec) {
    t(`${code} has code field`, spec.code === code);
    t(`${code} has name field`, typeof spec.name === 'string' && spec.name.length > 0);
    t(`${code} has region`, typeof spec.region === 'string' && spec.region.length === 2);
    t(`${code} has required kinds (≥ 3)`, spec.required.length >= 3);
    t(`${code} has recommended kinds (≥ 1)`, spec.recommended.length >= 1);
    t(`${code} has anchor`, typeof spec.anchor === 'string' && spec.anchor.length > 10);
    t(`${code} required includes reality_check`, spec.required.includes('reality_check'));
    t(`${code} required includes session_timeout`, spec.required.includes('session_timeout'));
  }
}

/* Region mapping */
const expectedRegions = { ADM: 'IT', ANJ: 'FR', KSA: 'NL', GGL: 'DE', ESBK: 'CH' };
for (const [code, region] of Object.entries(expectedRegions)) {
  const spec = getJurisdiction(code);
  if (spec) t(`${code} mapped to region ${region}`, spec.region === region);
}

/* Specific tightness */
const anj = getJurisdiction('ANJ');
if (anj) t('ANJ (France) required includes autoplay (hard-ban gated)', anj.required.includes('autoplay'));

const ksa = getJurisdiction('KSA');
if (ksa) t('KSA (Netherlands) required includes win_cap', ksa.required.includes('win_cap'));

const ggl = getJurisdiction('GGL');
if (ggl) t('GGL (Germany) required includes win_cap', ggl.required.includes('win_cap'));

/* Case-insensitive lookup */
t('case-insensitive lookup (adm → ADM)', getJurisdiction('adm') !== null);
t('case-insensitive lookup (anj → ANJ)', getJurisdiction('anj') !== null);

/* Frozen entry */
const admSpec = getJurisdiction('ADM');
if (admSpec) {
  let threw = false;
  try { admSpec.code = 'mutated'; } catch (_) { threw = true; }
  t('ADM spec is frozen', threw || admSpec.code === 'ADM');
}

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
