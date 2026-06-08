/**
 * tests/cert/cli.integration.test.mjs — Wave C1
 *
 * Drives `tools/cert-build.mjs` end-to-end against a real sample GDD
 * and a synthetic minimum-compliance GDD. Verifies exit codes, on-disk
 * artefacts, and that the bundle is regulator-readable.
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CLI = join(REPO_ROOT, 'tools', 'cert-build.mjs');

let pass = 0, fail = 0;
function t(name, ok, hint) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (hint ? '  — ' + hint : '')); }
}

console.log('\n— cert/cli.integration —');

const tmpRoot = mkdtempSync(join(tmpdir(), 'cert-cli-'));

try {
  /* ── case 1: real sample GDD against MGA (likely FAIL — RC/ST not always in markdown) ── */
  const sample = join(REPO_ROOT, 'samples', 'GATES_OF_OLYMPUS_1000_GAME_GDD.md');
  if (existsSync(sample)) {
    const out1 = join(tmpRoot, 'real-mga');
    const r1 = spawnSync('node', [
      CLI, sample,
      '--jurisdiction=MGA',
      '--version=1.0.0',
      `--out=${out1}`,
      '--quiet',
    ], { encoding: 'utf8' });

    t('real sample: CLI exit 0 or 1 (never 2 fatal)',
      r1.status === 0 || r1.status === 1,
      `exit=${r1.status} stderr=${r1.stderr}`);
    t('real sample: dist dir created', existsSync(out1));

    // Find written bundle
    const dirs = require_dirs(out1);
    t('real sample: at least one bundle dir', dirs.length >= 1);

    if (dirs.length > 0) {
      const bundleDir = join(out1, dirs[0]);
      t('real sample: manifest.json exists',
        existsSync(join(bundleDir, 'manifest.json')));
      t('real sample: evidence.json exists',
        existsSync(join(bundleDir, 'evidence.json')));
      const m = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
      t('real sample: manifest.compliance.jurisdiction = MGA',
        m.compliance.jurisdiction === 'MGA');
      t('real sample: manifest schema_version present',
        typeof m.schema_version === 'string' && m.schema_version.length > 0);
      t('real sample: evidence.blocks populated',
        (() => {
          const ev = JSON.parse(readFileSync(join(bundleDir, 'evidence.json'), 'utf8'));
          return Array.isArray(ev.blocks) && ev.blocks.length > 0;
        })());
    }
  } else {
    console.log('  ⚠ skipping real-sample test (sample file missing)');
  }

  /* ── case 2: synthetic FULL-compliance GDD against UKGC (must PASS, exit 0) ── */
  const syntheticGdd = `
# Compliance Smoke

| **Internal name** | Compliance Smoke |

This game includes a **Reality Check** popup every 10 minutes.
A **Session Timeout** enforces breaks.
The **Net Loss** indicator surfaces losses.
A **Win Cap** of 5000x bet is enforced.
`;
  const synthPath = join(tmpRoot, 'SYNTH.md');
  writeFileSync(synthPath, syntheticGdd, 'utf8');

  const out2 = join(tmpRoot, 'synth-uk');
  const r2 = spawnSync('node', [
    CLI, synthPath,
    '--jurisdiction=UKGC',
    '--version=0.1.0',
    `--out=${out2}`,
    '--quiet',
  ], { encoding: 'utf8' });

  t('synthetic UKGC: CLI exit 0 (PASS)',
    r2.status === 0,
    `exit=${r2.status} stderr=${r2.stderr}`);
  t('synthetic UKGC: dist dir created', existsSync(out2));

  const dirs2 = require_dirs(out2);
  t('synthetic UKGC: bundle dir present', dirs2.length === 1);
  if (dirs2.length === 1) {
    const bundleDir = join(out2, dirs2[0]);
    const m = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
    t('synthetic UKGC: compliance.pass = true', m.compliance.pass === true);
    t('synthetic UKGC: missing[] is empty', m.compliance.missing.length === 0);
    const readme = readFileSync(join(bundleDir, 'README.txt'), 'utf8');
    t('synthetic UKGC: README Verdict PASS', /Verdict\s+:\s+PASS/.test(readme));
  }

  /* ── case 3: unknown jurisdiction → fatal exit 2 ── */
  const r3 = spawnSync('node', [
    CLI, synthPath,
    '--jurisdiction=ZZZ',
    `--out=${join(tmpRoot, 'unk')}`,
    '--quiet',
  ], { encoding: 'utf8' });
  t('unknown jurisdiction: CLI exit 2',
    r3.status === 2,
    `exit=${r3.status} stderr=${r3.stderr}`);

  /* ── case 4: missing GDD file → fatal exit 2 ── */
  const r4 = spawnSync('node', [
    CLI, join(tmpRoot, 'does-not-exist.md'),
    '--jurisdiction=UKGC',
    `--out=${join(tmpRoot, 'ghost')}`,
    '--quiet',
  ], { encoding: 'utf8' });
  t('missing GDD: CLI exit 2',
    r4.status === 2,
    `exit=${r4.status} stderr=${r4.stderr}`);

  /* ── case 5: no args → usage + exit 2 ── */
  const r5 = spawnSync('node', [CLI, '--quiet'], { encoding: 'utf8' });
  t('no args: CLI exit 2', r5.status === 2);

  /* ── case 6: --help → exit 0 ── */
  const r6 = spawnSync('node', [CLI, '--help'], { encoding: 'utf8' });
  t('--help: CLI exit 0', r6.status === 0);
  t('--help: prints jurisdictions',
    /UKGC/.test(r6.stdout) && /MGA/.test(r6.stdout));
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('\n--- summary ---');
console.log('  pass:', pass);
console.log('  fail:', fail);
if (fail > 0) process.exit(1);

/* ── helpers ── */
function require_dirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((n) => {
    try { return statSync(join(root, n)).isDirectory(); }
    catch (_) { return false; }
  });
}
