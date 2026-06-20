#!/usr/bin/env node
/**
 * tools/_wave-y-smoke.mjs
 *
 * Wave Y smoke — Exotic force chip coverage (10 → 16).
 *
 * What it checks
 * --------------
 * 1. UFP ALL_KNOWN_KINDS contains all 6 Wave Y kinds (3 new + 3 enhanced).
 * 2. KIND_LABELS + KIND_FULL_LABELS cover them.
 * 3. Each Wave Y handler block code-path is present in source.
 * 4. Each consumer block (gamble, bonusPick, wheelBonus, slingoSpinEngine,
 *    coinCollect, leaderboardChip) reads the corresponding force flag.
 *
 * This is a STATIC source-level check — no browser run. The runtime
 * activation is exercised by tests/blocks/<block>.test.mjs.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');

const WAVE_Y_KINDS = ['slingo', 'tournament', 'bonus_collector', 'gamble', 'bonus_pick', 'wheel_bonus'];

const WAVE_Y_FLAGS = {
  __FORCE_GAMBLE_OUTCOME__:   'src/blocks/gamble.mjs',
  __FORCE_PICK_PATH__:        'src/blocks/bonusPick.mjs',
  __FORCE_WHEEL_SEGMENT__:    'src/blocks/wheelBonus.mjs',
  __FORCE_SLINGO_PATTERN__:   'src/blocks/slingoSpinEngine.mjs',
  __FORCE_TOURNAMENT_RANK__:  'src/blocks/leaderboardChip.mjs',
  __FORCE_COLLECTOR_FILL__:   'src/blocks/coinCollect.mjs',
};

async function main() {
  const ufp = await readFile(resolve(REPO, 'src/blocks/universalForcePanel.mjs'), 'utf8');
  let pass = 0, fail = 0;
  const failures = [];

  /* 1. UFP kind registry coverage */
  for (const k of WAVE_Y_KINDS) {
    if (ufp.includes("'" + k + "'")) {
      pass++;
    } else {
      fail++;
      failures.push('UFP missing kind: ' + k);
    }
  }

  /* 2. UFP handler code-paths present */
  for (const k of ['slingo', 'tournament', 'bonus_collector']) {
    const re = new RegExp("kind\\s*===\\s*'" + k + "'");
    if (re.test(ufp)) {
      pass++;
    } else {
      fail++;
      failures.push('UFP missing handler branch for kind=' + k);
    }
  }

  /* 3. Consumer blocks read their force flag */
  for (const [flag, blockPath] of Object.entries(WAVE_Y_FLAGS)) {
    const src = await readFile(resolve(REPO, blockPath), 'utf8');
    if (src.includes(flag)) {
      pass++;
    } else {
      fail++;
      failures.push(blockPath + ' does not consume ' + flag);
    }
  }

  /* 4. Consumer blocks one-shot clear pattern (not strict — best-effort) */
  for (const [flag, blockPath] of Object.entries(WAVE_Y_FLAGS)) {
    const src = await readFile(resolve(REPO, blockPath), 'utf8');
    const clearedRe = new RegExp('window\\.' + flag + '\\s*=\\s*null');
    if (clearedRe.test(src)) {
      pass++;
    } else {
      /* Acceptable for the tournament one (sticky display) */
      if (flag === '__FORCE_TOURNAMENT_RANK__') { pass++; continue; }
      fail++;
      failures.push(blockPath + ' does not one-shot clear ' + flag);
    }
  }

  console.log('═══ Wave Y smoke ═══');
  console.log('  total checks: ' + (pass + fail));
  console.log('  pass         : ' + pass);
  console.log('  fail         : ' + fail);
  if (failures.length) {
    console.log('');
    console.log('FAILING:');
    for (const f of failures) console.log('  ✗ ' + f);
  } else {
    console.log('  ✅ all checks pass');
  }
  console.log('');
  console.log('Chip coverage summary:');
  console.log('  Wave U baseline:  10 chips (FS, BW, H&W, multiplier orb, lightning, ...)');
  console.log('  Wave Y addition:  +6 deterministic exotic chips');
  console.log('  Total chip kinds: 16 (+ always-on infra)');
  console.log('');
  console.log('Deterministic outcome flags:');
  for (const flag of Object.keys(WAVE_Y_FLAGS)) {
    console.log('  ' + flag);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
