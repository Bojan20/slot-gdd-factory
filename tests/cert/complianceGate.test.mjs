/**
 * tests/cert/complianceGate.test.mjs — Wave C1
 *
 * Verifies the gate verdict logic, deterministic ordering, defensive
 * tolerance for malformed models, and the multi-jurisdiction helper.
 */
import {
  checkCompliance,
  checkComplianceMulti,
} from '../../src/cert/complianceGate.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— cert/complianceGate.mjs —');

const fullModel = {
  name: 'Test Game',
  features: [
    { kind: 'reality_check', label: 'Reality Check' },
    { kind: 'session_timeout', label: 'Session Timeout' },
    { kind: 'net_loss_indicator', label: 'Net Loss Indicator' },
    { kind: 'win_cap', label: 'Win Cap' },
    { kind: 'free_spins', label: 'Free Spins' },
  ],
};

const bareModel = {
  name: 'Bare Game',
  features: [
    { kind: 'free_spins', label: 'Free Spins' },
  ],
};

const partialModel = {
  name: 'Partial Game',
  features: [
    { kind: 'reality_check', label: 'Reality Check' },
    { kind: 'session_timeout', label: 'Session Timeout' },
  ],
};

/* ── full UKGC PASS ── */
const ukFull = checkCompliance(fullModel, 'UKGC');
t('full model: UKGC PASS', ukFull.pass === true);
t('full model: missing[] empty', ukFull.missing.length === 0);
t('full model: satisfied has 4 kinds', ukFull.satisfied.length === 4);
t('full model: jurisdiction echoed UKGC', ukFull.jurisdiction === 'UKGC');
t('full model: error is null', ukFull.error === null);
t('full model: anchor populated', typeof ukFull.anchor === 'string' && ukFull.anchor.length > 0);

/* ── bare UKGC FAIL ── */
const ukBare = checkCompliance(bareModel, 'UKGC');
t('bare model: UKGC FAIL', ukBare.pass === false);
t('bare model: missing has 4 kinds', ukBare.missing.length === 4);
t('bare model: missing sorted alpha',
  JSON.stringify(ukBare.missing) === JSON.stringify([...ukBare.missing].sort()));

/* ── partial UKGC FAIL but satisfied non-empty ── */
const ukPartial = checkCompliance(partialModel, 'UKGC');
t('partial model: UKGC FAIL (still missing 2)', ukPartial.pass === false);
t('partial model: satisfied has 2', ukPartial.satisfied.length === 2);
t('partial model: missing has 2', ukPartial.missing.length === 2);
t('partial model: missing includes net_loss_indicator',
  ukPartial.missing.includes('net_loss_indicator'));
t('partial model: missing includes win_cap',
  ukPartial.missing.includes('win_cap'));

/* ── partial MGA PASS (only needs reality_check + session_timeout) ── */
const mgaPartial = checkCompliance(partialModel, 'MGA');
t('partial model: MGA PASS', mgaPartial.pass === true);
t('partial model: MGA warnings include net_loss_indicator',
  mgaPartial.warnings.includes('net_loss_indicator'));

/* ── unknown jurisdiction ── */
const unk = checkCompliance(fullModel, 'XYZ');
t('unknown jurisdiction: pass=false', unk.pass === false);
t('unknown jurisdiction: error code set',
  unk.error === 'unknown_jurisdiction');
t('unknown jurisdiction: echoes upper-case input',
  unk.jurisdiction === 'XYZ');

/* ── case-insensitive lookup ── */
const lower = checkCompliance(fullModel, 'ukgc');
t('lower-case "ukgc" → UKGC verdict',
  lower.jurisdiction === 'UKGC' && lower.pass === true);

/* ── defensive tolerance ── */
const emptyVerdict = checkCompliance({}, 'UKGC');
t('empty model: gate runs without throwing',
  emptyVerdict && typeof emptyVerdict.pass === 'boolean');
t('empty model: FAIL with all 4 missing',
  emptyVerdict.pass === false && emptyVerdict.missing.length === 4);

const nullModelVerdict = checkCompliance(null, 'UKGC');
t('null model: gate runs without throwing',
  nullModelVerdict && nullModelVerdict.pass === false);

const malformedFeatures = checkCompliance(
  { features: [null, { kind: 42 }, { label: 'no kind' }, { kind: 'reality_check' }] },
  'MGA'
);
t('malformed features: only valid kind counted',
  malformedFeatures.satisfied.includes('reality_check'));

/* ── multi-jurisdiction ── */
const multi = checkComplianceMulti(fullModel, ['UKGC', 'MGA', 'XYZ']);
t('multi: 3 entries', Object.keys(multi).length === 3);
t('multi: UKGC PASS', multi.UKGC.pass === true);
t('multi: MGA PASS', multi.MGA.pass === true);
t('multi: XYZ error', multi.XYZ.error === 'unknown_jurisdiction');
t('multi(null codes) returns {}',
  Object.keys(checkComplianceMulti(fullModel, null)).length === 0);

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
