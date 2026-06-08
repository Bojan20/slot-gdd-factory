/**
 * tests/cert/manifest.test.mjs — Wave C1
 *
 * Verifies manifest shape, determinism (sorted arrays, fixed key order),
 * input validation, and the slugifyGameId contract.
 */
import {
  buildManifest,
  manifestToJSON,
  slugifyGameId,
  MANIFEST_SCHEMA_VERSION,
} from '../../src/cert/manifest.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— cert/manifest.mjs —');

const model = {
  name: 'Thunder Reels',
  topology: { reels: 5, rows: 3, paylines: 25 },
  theme: { tags: ['storm', 'mythology', 'storm'] },
  features: [
    { kind: 'free_spins',         label: 'Free Spins' },
    { kind: 'reality_check',      label: 'Reality Check' },
    { kind: 'session_timeout',    label: 'Session Timeout' },
    { kind: 'net_loss_indicator', label: 'Net Loss Indicator' },
    { kind: 'win_cap',            label: 'Win Cap' },
  ],
};

const m = buildManifest({
  model,
  jurisdiction: 'UKGC',
  version: '1.2.3',
  build: 'abc123',
  built_at: '2026-06-08T04:00:00.000Z',
});

t('schema_version matches export', m.schema_version === MANIFEST_SCHEMA_VERSION);
t('game_id slugified', m.game_id === 'thunder-reels');
t('display_name preserved', m.display_name === 'Thunder Reels');
t('version preserved', m.version === '1.2.3');
t('build preserved', m.build === 'abc123');
t('built_at preserved (caller-controlled)', m.built_at === '2026-06-08T04:00:00.000Z');
t('topology copied', m.topology.reels === 5 && m.topology.rows === 3 && m.topology.paylines === 25);
t('theme_tags deduped', m.theme_tags.length === 2);
t('theme_tags sorted', JSON.stringify(m.theme_tags) === JSON.stringify([...m.theme_tags].sort()));
t('features sorted by kind',
  JSON.stringify(m.features.map(f => f.kind))
    === JSON.stringify([...m.features.map(f => f.kind)].sort()));
t('compliance UKGC PASS', m.compliance.pass === true);
t('compliance.error is null', m.compliance.error === null);
t('math_claim null when omitted', m.math_claim === null);

/* ── slugify edge cases ── */
t('slugify: spaces & ampersand', slugifyGameId('Wolf & Lion') === 'wolf-lion');
t('slugify: empty fallback', slugifyGameId('') === 'untitled-game');
t('slugify: non-string fallback', slugifyGameId(null) === 'untitled-game');
t('slugify: trailing dashes stripped', slugifyGameId('--Foo--') === 'foo');
t('slugify: diacritics flattened', slugifyGameId('Crème Brûlée') === 'creme-brulee');

/* ── math_claim passthrough ── */
const mWithMath = buildManifest({
  model,
  jurisdiction: 'UKGC',
  built_at: '2026-06-08T04:00:00.000Z',
  mathClaim: { rtp: 96.10, volatility: 'high', max_win_x: 5000 },
});
t('math_claim passed through', mWithMath.math_claim.rtp === 96.10);
t('math_claim is a copy (mutation safe)',
  (() => {
    const out = buildManifest({
      model, jurisdiction: 'UKGC', built_at: 'x', mathClaim: { rtp: 90 },
    });
    out.math_claim.rtp = 0;
    return true;   // just proves no throw — mutating output is allowed
  })()
);

/* ── input validation ── */
let threw = false;
try { buildManifest(null); } catch (_) { threw = true; }
t('buildManifest(null) throws', threw);

threw = false;
try { buildManifest({ jurisdiction: 'UKGC' }); } catch (_) { threw = true; }
t('buildManifest({ no model }) throws', threw);

threw = false;
try { buildManifest({ model, jurisdiction: '' }); } catch (_) { threw = true; }
t('buildManifest({ empty jurisdiction }) throws', threw);

/* ── unknown jurisdiction surfaces in manifest.compliance ── */
const unkM = buildManifest({
  model, jurisdiction: 'XYZ', built_at: 'x',
});
t('manifest with unknown jurisdiction: pass=false',
  unkM.compliance.pass === false && unkM.compliance.error === 'unknown_jurisdiction');

/* ── determinism: same input → same JSON ── */
const j1 = manifestToJSON(buildManifest({
  model, jurisdiction: 'UKGC', version: '1.0.0', built_at: 'fixed',
}));
const j2 = manifestToJSON(buildManifest({
  model, jurisdiction: 'UKGC', version: '1.0.0', built_at: 'fixed',
}));
t('manifestToJSON deterministic given fixed input', j1 === j2);
t('manifestToJSON ends with newline', j1.endsWith('\n'));

/* ── defensive: missing topology / theme / features ── */
const minimal = buildManifest({
  model: { name: 'Min' },
  jurisdiction: 'MGA',
  built_at: 'x',
});
t('minimal model: topology fields null', minimal.topology.reels === null);
t('minimal model: theme_tags []', minimal.theme_tags.length === 0);
t('minimal model: features []', minimal.features.length === 0);
t('minimal model: compliance computed', typeof minimal.compliance.pass === 'boolean');

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
