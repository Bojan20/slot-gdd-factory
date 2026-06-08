/**
 * tests/cert/evidencePack.test.mjs — Wave C1
 *
 * Verifies SHA-256 hashing, deterministic ordering, totals roll-up,
 * verdict derivation, and defensive normalisation.
 */
import {
  sha256Hex,
  buildEvidencePack,
  evidenceToJSON,
  EVIDENCE_SCHEMA_VERSION,
  HASH_ALGO,
} from '../../src/cert/evidencePack.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— cert/evidencePack.mjs —');

/* ── sha256Hex ── */
t('sha256Hex empty string is known constant',
  sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
t('sha256Hex deterministic for same input',
  sha256Hex('hello') === sha256Hex('hello'));
t('sha256Hex differs for different input',
  sha256Hex('hello') !== sha256Hex('world'));
t('sha256Hex Buffer + string parity',
  sha256Hex(Buffer.from('abc', 'utf8')) === sha256Hex('abc'));

let threw = false;
try { sha256Hex(42); } catch (_) { threw = true; }
t('sha256Hex(number) throws', threw);

/* ── buildEvidencePack happy path ── */
const ev = buildEvidencePack({
  gddSource: { name: 'TEST.md', content: 'hello world' },
  testResults: [
    { name: 'beta',  passed: 10, failed: 0, skipped: 0 },
    { name: 'alpha', passed: 5,  failed: 2, skipped: 1 },
  ],
  artefacts: [
    { path: 'z/last.png',  content_hash: 'aa', bytes: 100, kind: 'screenshot' },
    { path: 'a/first.png', content_hash: 'bb', bytes: 200, kind: 'screenshot' },
  ],
  blocks: [
    { name: 'realityCheck', lifecycle: ['preSpin', 'onAutoplayTick', 'preSpin'], test_status: 'pass' },
    { name: 'autoplay',     lifecycle: ['preSpin'], test_status: 'pass' },
  ],
});

t('schema_version exported', ev.schema_version === EVIDENCE_SCHEMA_VERSION);
t('hash_algo === sha256', ev.hash_algo === HASH_ALGO);
t('gdd hash matches sha256Hex("hello world")',
  ev.gdd_source.hash === sha256Hex('hello world'));
t('gdd byte length recorded', ev.gdd_source.bytes === Buffer.byteLength('hello world', 'utf8'));
t('tests.suites sorted by name (alpha < beta)',
  ev.tests.suites[0].name === 'alpha' && ev.tests.suites[1].name === 'beta');
t('tests.total.passed = 15', ev.tests.total.passed === 15);
t('tests.total.failed = 2', ev.tests.total.failed === 2);
t('tests.total.skipped = 1', ev.tests.total.skipped === 1);
t('alpha suite verdict = fail (failed > 0)', ev.tests.suites[0].verdict === 'fail');
t('beta suite verdict = pass', ev.tests.suites[1].verdict === 'pass');

t('artefacts sorted by path',
  ev.artefacts[0].path === 'a/first.png' && ev.artefacts[1].path === 'z/last.png');
t('artefact bytes preserved', ev.artefacts[0].bytes === 200);
t('artefact kind preserved', ev.artefacts[0].kind === 'screenshot');

t('blocks sorted by name (autoplay first)',
  ev.blocks[0].name === 'autoplay');
t('block lifecycle deduped + sorted',
  JSON.stringify(ev.blocks[1].lifecycle) === JSON.stringify(['onAutoplayTick', 'preSpin']));

/* ── evidenceToJSON ── */
const j = evidenceToJSON(ev);
t('evidenceToJSON ends with newline', j.endsWith('\n'));
t('evidenceToJSON deterministic for same input',
  evidenceToJSON(ev) === evidenceToJSON(ev));

/* ── defensive: bad input ── */
threw = false;
try { buildEvidencePack(null); } catch (_) { threw = true; }
t('buildEvidencePack(null) throws', threw);

threw = false;
try { buildEvidencePack({}); } catch (_) { threw = true; }
t('buildEvidencePack({}) throws (no gddSource)', threw);

threw = false;
try { buildEvidencePack({ gddSource: { name: 'x' } }); } catch (_) { threw = true; }
t('buildEvidencePack(gddSource without content) throws', threw);

/* ── defensive: empty optional collections ── */
const evMin = buildEvidencePack({
  gddSource: { name: 'min.md', content: '' },
});
t('minimal evidence: tests.total all zero',
  evMin.tests.total.passed === 0 && evMin.tests.total.failed === 0 && evMin.tests.total.skipped === 0);
t('minimal evidence: artefacts []', evMin.artefacts.length === 0);
t('minimal evidence: blocks []', evMin.blocks.length === 0);
t('minimal evidence: gdd hash is empty-string sha',
  evMin.gdd_source.hash === sha256Hex(''));

/* ── verdict-from-explicit-tag wins over count derivation ── */
const evVerdict = buildEvidencePack({
  gddSource: { name: 'x', content: 'x' },
  testResults: [
    { name: 's1', passed: 5, failed: 0, verdict: 'partial' },
    { name: 's2', passed: 0, failed: 0, verdict: 'pass' },
  ],
});
t('explicit verdict "partial" preserved',
  evVerdict.tests.suites[0].verdict === 'partial');
t('explicit verdict "pass" preserved on 0/0 suite',
  evVerdict.tests.suites[1].verdict === 'pass');

/* ── malformed entries dropped silently ── */
const evMalformed = buildEvidencePack({
  gddSource: { name: 'x', content: 'x' },
  testResults: [null, { passed: 1 }, { name: 'ok', passed: 2, failed: 0 }],
  artefacts: [null, { path: 'a' }, { path: 'b', content_hash: 'h' }],
  blocks: [null, { lifecycle: [] }, { name: 'kept' }],
});
t('malformed test suites filtered',
  evMalformed.tests.suites.length === 1 && evMalformed.tests.suites[0].name === 'ok');
t('malformed artefacts filtered (need path + content_hash)',
  evMalformed.artefacts.length === 1 && evMalformed.artefacts[0].path === 'b');
t('malformed blocks filtered (need name)',
  evMalformed.blocks.length === 1 && evMalformed.blocks[0].name === 'kept');

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
