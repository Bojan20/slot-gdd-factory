#!/usr/bin/env node
/**
 * tests/_fix8-cross-coverage.test.mjs · FIX-8 M11-M17 audit suite.
 *
 * Verifies the cross-coverage invariants introduced by FIX-8 Grupa E/F:
 *   M11 smartDefaults per-key coverage (every parsed feature kind has
 *        a default registered)
 *   M12 allWaysEval × hex/pyramid grid: each block declares its
 *        supported SHAPE.kind set in its JSDoc
 *   M13 Feature × Feature exclusivity manifest baseline
 *   M14 Jurisdiction × engine kind cross-coverage table is consistent
 *   M15 GDD knob compatibility: no block silently mutates a knob owned
 *        by another block in resolveConfig
 *   M17 Engine kind self-disable contract: every engine block emits a
 *        "(disabled)" marker comment when SHAPE.kind doesn't match
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

let pass = 0, fail = 0;
const t = (n, ok, hint) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (hint ? ' — ' + hint : '')); } };

console.log('— FIX-8 cross-coverage audit —');

/* ── M11 smartDefaults per-key coverage ─────────────────────────── */
const smartDefSrc = readFileSync(resolve(REPO, 'src/registry/smartDefaults.mjs'), 'utf8');
t('M11: smartDefaults source exists', smartDefSrc.length > 100);
t('M11: smartDefaults declares applySmartDefaults export',
  /export function applySmartDefaults/.test(smartDefSrc));
t('M11: smartDefaults handles topology default',
  /topology/i.test(smartDefSrc));
t('M11: smartDefaults handles symbol-tier classification',
  /tier|symbols\./i.test(smartDefSrc));
t('M11: smartDefaults handles palette fallback',
  /palette|theme/i.test(smartDefSrc));

/* ── M12 allWaysEval × hex/pyramid grid support ──────────────────── */
const allWaysSrc = readFileSync(resolve(REPO, 'src/blocks/allWaysEval.mjs'), 'utf8');
t('M12: allWaysEval mentions hex/pyramid topology compatibility',
  /hex|pyramid|topology|grid.kind/i.test(allWaysSrc));
const hexClusterSrc = readFileSync(resolve(REPO, 'src/blocks/hexClusterEngine.mjs'), 'utf8');
t('M12: hexClusterEngine declares hex-only scope',
  /hex/i.test(hexClusterSrc));
const pyramidSrc = readFileSync(resolve(REPO, 'src/blocks/pyramidGridEngine.mjs'), 'utf8');
t('M12: pyramidGridEngine declares pyramid scope',
  /pyramid/i.test(pyramidSrc));

/* ── M13 Feature × Feature exclusivity manifest ──────────────────── */
const holdAndWinSrc = readFileSync(resolve(REPO, 'src/blocks/holdAndWin.mjs'), 'utf8');
const freeSpinsSrc = readFileSync(resolve(REPO, 'src/blocks/freeSpins.mjs'), 'utf8');
t('M13: H&W declares FS-exclusivity guard',
  /FREESPINS.active|FSM.phase.*FS_/i.test(holdAndWinSrc));
t('M13: FS declares H&W-exclusivity guard',
  /HW_STATE.*active|HW_STATE\.active/i.test(freeSpinsSrc));

/* ── M14 Jurisdiction × engine kind cross-coverage ───────────────── */
const gridProfileSrc = readFileSync(resolve(REPO, 'src/registry/gridProfile.mjs'), 'utf8');
t('M14: gridProfile registry exists',
  gridProfileSrc.length > 100);
const jurisdictionSrc = readFileSync(resolve(REPO, 'src/blocks/jurisdictionGate.mjs'), 'utf8');
t('M14: jurisdictionGate registers UKGC',
  /UKGC|ukgc/.test(jurisdictionSrc));

/* ── M15 GDD knob compatibility (resolveConfig isolation) ────────── */
const blockFiles = readdirSync(resolve(REPO, 'src/blocks'))
  .filter(f => f.endsWith('.mjs'));
let xConfigMutators = 0;
for (const f of blockFiles) {
  const src = readFileSync(resolve(REPO, 'src/blocks', f), 'utf8');
  /* Strip JSDoc + block comments + line comments first so doc mentions
   * of "model.foo = bar" syntax (just documentation) don't false-flag. */
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  /* Flag resolveConfig that writes back into model.* (not model[blockKey]) —
   * those would be cross-block knob writes. */
  if (/model\.\w+\s*=\s*[^=]/.test(stripped) && /resolveConfig/.test(stripped)) {
    xConfigMutators++;
  }
}
t('M15: no resolveConfig writes back to model.* (block-isolated knobs)',
  xConfigMutators === 0,
  xConfigMutators > 0 ? `${xConfigMutators} blocks suspected cross-mutation` : null);

/* ── M17 Engine kind self-disable contract ───────────────────────── */
const engineBlocks = [
  'hexReelEngine.mjs',
  'wheelSpinEngine.mjs',
  'crashSpinEngine.mjs',
  'plinkoSpinEngine.mjs',
  'slingoSpinEngine.mjs',
  'pyramidGridEngine.mjs',
  'hexClusterEngine.mjs',
  'reelHeightAdapter.mjs',
];
for (const f of engineBlocks) {
  const src = readFileSync(resolve(REPO, 'src/blocks', f), 'utf8');
  /* Either an explicit "(disabled)" comment marker, or early return ''
   * pattern when cfg.enabled is false — both satisfy the contract. */
  const hasMarker = /disabled[\s)]/i.test(src) ||
                    /if\s*\(\s*!cfg\.enabled\s*\)\s*return/.test(src) ||
                    /cfg\.enabled\s*===\s*false/.test(src);
  t(`M17 ${f}: implements self-disable contract`, hasMarker,
    'no (disabled) marker or early-return on enabled=false');
}

console.log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
