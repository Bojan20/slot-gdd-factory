/**
 * tests/cert/bundler.test.mjs — Wave C1
 *
 * Verifies the on-disk bundle layout via a temp directory: file paths,
 * file contents, idempotent re-runs, and the optional zip wrapper.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildManifest, manifestToJSON } from '../../src/cert/manifest.mjs';
import { buildEvidencePack } from '../../src/cert/evidencePack.mjs';
import { writeBundle, bundleDirName, zipBundle } from '../../src/cert/bundler.mjs';

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— cert/bundler.mjs —');

const model = {
  name: 'Bundle Test',
  topology: { reels: 5, rows: 3, paylines: 20 },
  theme: { tags: ['test'] },
  features: [
    { kind: 'reality_check', label: 'Reality Check' },
    { kind: 'session_timeout', label: 'Session Timeout' },
  ],
};

const manifest = buildManifest({
  model, jurisdiction: 'MGA', version: '1.0.0', built_at: 'fixed',
});
const evidence = buildEvidencePack({
  gddSource: { name: 'BUNDLE.md', content: '# bundle' },
});

t('bundleDirName uses game_id + version',
  bundleDirName(manifest) === 'bundle-test-1.0.0.opkg');

let threw = false;
try { bundleDirName({}); } catch (_) { threw = true; }
t('bundleDirName({}) throws', threw);

threw = false;
try { writeBundle(null); } catch (_) { threw = true; }
t('writeBundle(null) throws', threw);

threw = false;
try { writeBundle({ outRoot: '/tmp', manifest: null, evidence }); } catch (_) { threw = true; }
t('writeBundle(no manifest) throws', threw);

/* ── happy-path write ── */
const tmpRoot = mkdtempSync(join(tmpdir(), 'cert-bundler-'));
try {
  // Attach an artefact source file.
  const srcArtefactPath = join(tmpRoot, 'sample.txt');
  writeFileSync(srcArtefactPath, 'attached evidence file', 'utf8');

  const result = writeBundle({
    outRoot: tmpRoot,
    manifest,
    evidence,
    artefacts: [
      { sourcePath: srcArtefactPath, bundlePath: 'artefacts/sample.txt' },
      // ghost path — silently skipped (file missing)
      { sourcePath: join(tmpRoot, 'nope.bin'), bundlePath: 'artefacts/nope.bin' },
    ],
  });

  t('bundle dir exists', existsSync(result.dir));
  t('bundle dir name correct',
    result.dir.endsWith('bundle-test-1.0.0.opkg'));
  t('manifest.json written',
    existsSync(join(result.dir, 'manifest.json')));
  t('evidence.json written',
    existsSync(join(result.dir, 'evidence.json')));
  t('compliance.json written',
    existsSync(join(result.dir, 'compliance.json')));
  t('README.txt written',
    existsSync(join(result.dir, 'README.txt')));
  t('attached artefact copied',
    existsSync(join(result.dir, 'artefacts/sample.txt')));
  t('missing artefact silently skipped',
    !existsSync(join(result.dir, 'artefacts/nope.bin')));

  const manifestJSON = readFileSync(join(result.dir, 'manifest.json'), 'utf8');
  t('manifest.json content matches manifestToJSON output',
    manifestJSON === manifestToJSON(manifest));

  const readme = readFileSync(join(result.dir, 'README.txt'), 'utf8');
  t('README mentions PASS (MGA compliant for this model)',
    /Verdict\s+:\s+PASS/.test(readme));
  t('README mentions Regulator',
    /Regulator\s+:\s+Malta Gaming Authority/.test(readme));

  t('result.files length ≥ 5',
    result.files.length >= 5);
  for (const f of result.files) {
    t(`file is readable: ${f.replace(result.dir, '<dir>')}`, statSync(f).size > 0);
  }

  /* ── idempotency: second write overwrites cleanly ── */
  const second = writeBundle({ outRoot: tmpRoot, manifest, evidence });
  t('second write reuses same dir', second.dir === result.dir);
  t('manifest still readable after re-write',
    readFileSync(join(second.dir, 'manifest.json'), 'utf8').length > 0);

  /* ── custom readme override ── */
  const custom = writeBundle({
    outRoot: tmpRoot, manifest, evidence,
    readme: 'CUSTOM README BODY',
  });
  t('custom readme honoured',
    readFileSync(join(custom.dir, 'README.txt'), 'utf8') === 'CUSTOM README BODY');

  /* ── zip wrapper (best-effort, skipped gracefully if zip absent) ── */
  await zipBundle(result.dir).then(
    (zipPath) => {
      t('zipBundle resolves with .zip path',
        typeof zipPath === 'string' && zipPath.endsWith('.zip'));
      t('zip file exists on disk', existsSync(zipPath));
    },
    (err) => {
      // zip binary missing on minimal CI images — log but don't fail.
      console.log('  ⚠ zipBundle unavailable (treating as skip):', err.message);
    }
  );

  /* ── zip on missing dir rejects ── */
  let rejected = false;
  await zipBundle(join(tmpRoot, 'does-not-exist')).then(
    () => {},
    () => { rejected = true; }
  );
  t('zipBundle rejects on missing dir', rejected);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);
