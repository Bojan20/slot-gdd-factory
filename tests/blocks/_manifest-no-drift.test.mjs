#!/usr/bin/env node
/**
 * tests/blocks/_manifest-no-drift.test.mjs
 *
 * UQ-DEEP-AO · AO-3 — Universal manifest drift test.
 *
 * QA-D Block Presentation Audit found 5 manifest drift issues against
 * `blocks/_manifest.json`:
 *   • 4 `_auto_*` scaffold blocks under src/blocks/_auto-scaffolded/ —
 *     not in the manifest at all
 *   • 13 blocks under src/blocks/featureSimPlugins/ — not in the manifest
 *   • patternWin: frozen, hasEmitCSS, hasEmitRuntime mismatched
 *   • payAnywhereEval: frozen, hasEmitRuntime mismatched
 *
 * This suite locks in the contract that the manifest, as emitted by
 * `tools/gen-block-manifest.mjs`, faithfully describes EVERY block under
 * src/blocks (top-level + curated sub-folders), and that every per-entry
 * `frozen` / `hasEmit*` / `enabledByDefault` flag matches the LIVE
 * module's runtime posture.
 *
 * Verifies, per manifest entry:
 *   1.  entry.file is a real .mjs file
 *   2.  entry.frozen === Object.isFrozen(defaultConfig()) (when present)
 *   3.  entry.hasEmitCSS / hasEmitMarkup / hasEmitRuntime match exports
 *   4.  entry.hasResolveConfig / hasDefaultConfig match exports
 *   5.  entry.enabledByDefault === !!(defaultConfig().enabled !== false)
 *
 * Target: 0 drift entries. Exit 0 on clean, exit 1 on any drift.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const MANIFEST_PATH = resolve(REPO, 'blocks/_manifest.json');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

if (!existsSync(MANIFEST_PATH)) {
  console.error('✗ Manifest missing — run `node tools/gen-block-manifest.mjs` first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

/* ════════════════════════════════════════════════════════════════════
 * 1. Manifest top-level shape
 * ════════════════════════════════════════════════════════════════════ */
block('1. Manifest shape sanity', () => {
  t('manifest is a JSON object',
    manifest && typeof manifest === 'object');
  t('manifest.blocks is an array',
    Array.isArray(manifest.blocks));
  t('manifest.totalBlocks === manifest.blocks.length',
    manifest.totalBlocks === manifest.blocks.length,
    `totalBlocks=${manifest.totalBlocks} length=${manifest.blocks.length}`);
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Discovery completeness — must include _auto-scaffolded + featureSimPlugins
 * ════════════════════════════════════════════════════════════════════ */
block('2. Discovery includes curated sub-folders', () => {
  const subFolderEntries = manifest.blocks.filter(b => b.file.includes('/_auto-scaffolded/'));
  t('manifest includes _auto-scaffolded blocks (>= 4)',
    subFolderEntries.length >= 4,
    `found ${subFolderEntries.length}`);

  const fsPlugins = manifest.blocks.filter(b => b.file.includes('/featureSimPlugins/'));
  t('manifest includes featureSimPlugins blocks (>= 13)',
    fsPlugins.length >= 13,
    `found ${fsPlugins.length}`);

  /* Spot-check: featureSimPlugins/patternWin should be present as its own
   * entry, NOT just the top-level patternWin. */
  const fsimPattern = manifest.blocks.find(b => b.name === 'featureSimPlugins/patternWin');
  t('featureSimPlugins/patternWin is a separate entry',
    !!fsimPattern,
    fsimPattern ? '' : 'missing path-prefixed entry');
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Per-entry drift detection (the core of AO-3)
 * ════════════════════════════════════════════════════════════════════ */
const driftReport = [];

for (const entry of manifest.blocks) {
  const driftFields = [];
  const abs = resolve(REPO, entry.file);

  if (!existsSync(abs)) {
    driftReport.push({ name: entry.name, file: entry.file, fields: ['file:missing'] });
    continue;
  }

  let mod;
  try {
    // eslint-disable-next-line no-await-in-loop
    mod = await import(pathToFileURL(abs).href);
  } catch (e) {
    driftReport.push({ name: entry.name, file: entry.file, fields: [`import-failed:${(e.message || e).toString().slice(0, 80)}`] });
    continue;
  }

  /* Truthful runtime presence flags, recomputed independently of the
   * generator so the test catches a generator regression too. */
  const exportKeys = Object.keys(mod);
  const isFn = (k) => typeof mod[k] === 'function';
  const realHasEmitCSS = exportKeys.some(
    (k) => isFn(k) && (/^emit[A-Z_].*CSS$/.test(k) || k === 'emitCSS')
  );
  const realHasEmitMarkup = exportKeys.some(
    (k) => isFn(k) && (/^emit[A-Z_].*Markup$/.test(k) || k === 'emitMarkup')
  );
  const realHasEmitRuntime = exportKeys.some(
    (k) => isFn(k) && (/^emit[A-Z_].*Runtime$/.test(k) || k === 'emitRuntime')
  );
  const realHasResolveConfig = isFn('resolveConfig');
  const realHasDefaultConfig = isFn('defaultConfig');

  let realFrozen = false;
  let realEnabledByDefault = true;
  if (realHasDefaultConfig) {
    try {
      const dc = mod.defaultConfig();
      realFrozen = dc !== null && typeof dc === 'object' && Object.isFrozen(dc);
      if (dc && typeof dc === 'object' && 'enabled' in dc) {
        realEnabledByDefault = !!dc.enabled;
      }
    } catch {
      /* defaultConfig threw — leave defaults */
    }
  }

  if (entry.frozen !== realFrozen) {
    driftFields.push(`frozen:${entry.frozen}!=${realFrozen}`);
  }
  if (entry.hasEmitCSS !== realHasEmitCSS) {
    driftFields.push(`hasEmitCSS:${entry.hasEmitCSS}!=${realHasEmitCSS}`);
  }
  if (entry.hasEmitMarkup !== realHasEmitMarkup) {
    driftFields.push(`hasEmitMarkup:${entry.hasEmitMarkup}!=${realHasEmitMarkup}`);
  }
  if (entry.hasEmitRuntime !== realHasEmitRuntime) {
    driftFields.push(`hasEmitRuntime:${entry.hasEmitRuntime}!=${realHasEmitRuntime}`);
  }
  if (entry.hasResolveConfig !== realHasResolveConfig) {
    driftFields.push(`hasResolveConfig:${entry.hasResolveConfig}!=${realHasResolveConfig}`);
  }
  if (entry.hasDefaultConfig !== realHasDefaultConfig) {
    driftFields.push(`hasDefaultConfig:${entry.hasDefaultConfig}!=${realHasDefaultConfig}`);
  }
  if (entry.enabledByDefault !== realEnabledByDefault) {
    driftFields.push(`enabledByDefault:${entry.enabledByDefault}!=${realEnabledByDefault}`);
  }

  if (driftFields.length > 0) {
    driftReport.push({ name: entry.name, file: entry.file, fields: driftFields });
  }
}

block('3. Per-entry drift detection', () => {
  t('every entry.file points to an existing .mjs file',
    !driftReport.some(d => d.fields.includes('file:missing')),
    driftReport.filter(d => d.fields.includes('file:missing')).map(d => d.name).join(', '));

  t('no module import failures',
    !driftReport.some(d => d.fields.some(f => f.startsWith('import-failed'))),
    driftReport
      .filter(d => d.fields.some(f => f.startsWith('import-failed')))
      .map(d => `${d.name}: ${d.fields.join(',')}`)
      .join(' | '));

  const driftEntries = driftReport.filter(
    d => !d.fields.includes('file:missing') && !d.fields.some(f => f.startsWith('import-failed'))
  );
  t(`0 drift entries (${manifest.blocks.length} blocks scanned)`,
    driftEntries.length === 0,
    driftEntries.length > 0
      ? '\n     ' + driftEntries.slice(0, 20).map(d => `${d.name}: ${d.fields.join(', ')}`).join('\n     ')
        + (driftEntries.length > 20 ? `\n     ... +${driftEntries.length - 20} more` : '')
      : '');
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Required runtime-truth fields are present on every entry
 * ════════════════════════════════════════════════════════════════════ */
block('4. Required runtime-truth fields per entry', () => {
  const required = [
    'frozen',
    'hasEmitCSS', 'hasEmitMarkup', 'hasEmitRuntime',
    'hasResolveConfig', 'hasDefaultConfig',
    'enabledByDefault',
  ];
  for (const field of required) {
    const missing = manifest.blocks.filter(b => typeof b[field] !== 'boolean');
    t(`every entry has ${field}:boolean`,
      missing.length === 0,
      missing.length > 0 ? `missing on ${missing.length} entries: ${missing.slice(0, 5).map(b => b.name).join(', ')}` : '');
  }
});

/* ════════════════════════════════════════════════════════════════════
 * Summary
 * ════════════════════════════════════════════════════════════════════ */
console.log('═'.repeat(60));
console.log(`UQ-DEEP-AO · AO-3 manifest-no-drift suite: ${pass}/${pass + fail} PASS`);
console.log(`Manifest entries: ${manifest.blocks.length}`);
console.log(`Drift entries:    ${driftReport.length}`);
if (fail > 0) {
  console.log(`✗ ${fail} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ All assertions passed — 0 manifest drift');
process.exit(0);
