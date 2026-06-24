/**
 * tests/blocks/_universal-data-block-name.test.mjs
 *
 * UQ-DEEP-AO · AO-1 — Universal data-block-name attribute coverage test.
 *
 * For every block in src/blocks/*.mjs that exports at least one
 * emit*Markup function, this test:
 *   1. Imports the block module.
 *   2. Builds a permissive model that maximises the chance the block
 *      considers itself enabled (top-level enabled=true, per-namespace
 *      enabled=true, archetype feature kinds, and engine signature
 *      derived from blockName).
 *   3. Calls resolveConfig(model) if available, otherwise defaultConfig().
 *   4. Invokes every emit*Markup function in turn and checks the returned
 *      string carries data-block-name="<blockName>".
 *
 * Target: 95% PASS rate across all non-empty markup returns.
 * Some blocks intentionally return '' for conditional / scaffolded /
 * variant-gated paths even with permissive input — those are accepted.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const BLOCKS_DIR = path.join(ROOT, 'src', 'blocks');

let pass = 0;
let fail = 0;
let skipped = 0;
const failures = [];

function passOf(name) {
  pass++;
  /* keep log compact — only report failures verbosely */
}
function failOf(name, info = '') {
  fail++;
  failures.push(name + (info ? ` :: ${info}` : ''));
}

function buildPermissiveModel(blockName) {
  /* The model surface is intentionally generous. We don't know every
     block's GDD-namespace key, so we set the most common ones plus
     blockName itself (camel), blockName-style flags, and the
     features[] archetype hints. */
  const common = {
    enabled: true,
    grid: { reels: 5, rows: 3, layout: 'rectangular' },
    paylines: 25,
    paytable: { K: 50, Q: 40, J: 30, A: 60, '10': 25 },
    symbols: { wild: { id: 'W' }, scatter: { id: 'S' } },
    rtp: { target: 0.96 },
    jurisdictions: ['MGA', 'UKGC'],
    features: [
      { kind: 'free_spins' },
      { kind: 'bonus_buy' },
      { kind: 'hold_and_win' },
      { kind: 'tumble' },
      { kind: 'cluster_pays' },
      { kind: 'all_ways' },
      { kind: 'wild' },
      { kind: 'scatter' },
      { kind: 'multiplier' },
      { kind: 'achievement_toast' },
      { kind: 'level_up_toast' },
      { kind: 'player_xp' },
      { kind: 'player_progression' },
    ],
    [blockName]: { enabled: true },
  };
  return common;
}

async function main() {
  console.log('\n=== UQ-DEEP-AO · AO-1 universal data-block-name ===\n');

  const entries = await fs.readdir(BLOCKS_DIR, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile() && e.name.endsWith('.mjs'))
    .map(e => e.name)
    .sort();

  for (const fname of files) {
    const blockName = path.basename(fname, '.mjs');
    const fpath = path.join(BLOCKS_DIR, fname);
    const src = await fs.readFile(fpath, 'utf8');

    /* Pre-screen: does the file export any emit*Markup? */
    const matchRe = /export\s+function\s+(emit\w*Markup)\s*\(/g;
    const exportNames = [];
    let m;
    while ((m = matchRe.exec(src)) !== null) exportNames.push(m[1]);
    if (exportNames.length === 0) {
      skipped++;
      continue;
    }

    let mod;
    try {
      mod = await import(pathToFileURL(fpath).href);
    } catch (e) {
      failOf(blockName + ' [import]', e.message.slice(0, 120));
      continue;
    }

    const model = buildPermissiveModel(blockName);
    let cfg;
    try {
      if (typeof mod.resolveConfig === 'function') {
        cfg = mod.resolveConfig(model);
      } else if (typeof mod.defaultConfig === 'function') {
        cfg = { ...mod.defaultConfig(), enabled: true };
      } else {
        cfg = { enabled: true };
      }
    } catch (e) {
      failOf(blockName + ' [resolveConfig]', e.message.slice(0, 120));
      continue;
    }

    for (const exName of exportNames) {
      const fn = mod[exName];
      if (typeof fn !== 'function') {
        failOf(blockName + '::' + exName, 'not exported as function');
        continue;
      }
      let out;
      try {
        out = fn(cfg, model);
      } catch (e) {
        /* Some markup fns take only (cfg) — that's fine, they ignore. */
        try { out = fn(cfg); }
        catch (e2) {
          failOf(blockName + '::' + exName, e2.message.slice(0, 120));
          continue;
        }
      }

      if (typeof out !== 'string') {
        failOf(blockName + '::' + exName, `non-string return (${typeof out})`);
        continue;
      }
      if (out.length === 0) {
        /* Block intentionally produced no markup with our permissive
           model — accepted, just don't count as PASS (skipped). */
        skipped++;
        continue;
      }
      /* Strip HTML comments to determine whether there's an actual tag
         to attribute. Some decorator blocks emit only `<!-- ... -->`
         placeholders because their real DOM is runtime-mounted onto
         pre-existing grid cells. Such markup has no root element to
         tag and is intentionally skipped. */
      const stripped = out.replace(/<!--[\s\S]*?-->/g, '').trim();
      if (stripped.length === 0) {
        skipped++;
        continue;
      }
      if (out.includes('data-block-name="' + blockName + '"')) {
        passOf(blockName + '::' + exName);
      } else if (/data-block-name="/.test(out)) {
        /* Some other block name? Should still be a tagged root — accept
           but report. */
        failOf(blockName + '::' + exName, 'data-block-name present but wrong name');
      } else {
        failOf(blockName + '::' + exName, 'missing data-block-name');
      }
    }
  }

  console.log('');
  console.log(`PASS:    ${pass}`);
  console.log(`FAIL:    ${fail}`);
  console.log(`SKIPPED: ${skipped}  (empty-string returns / no emit*Markup)`);
  const total = pass + fail;
  const rate = total === 0 ? 0 : (pass / total) * 100;
  console.log(`PASS rate: ${rate.toFixed(2)}%  (target ≥ 95%)`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures.slice(0, 30)) console.log('  - ' + f);
    if (failures.length > 30) console.log(`  ... and ${failures.length - 30} more`);
  }

  if (rate < 95) {
    console.error('\nFAIL: PASS rate below 95% target.');
    process.exit(1);
  }
  console.log('\nOK: universal data-block-name coverage ≥ 95%.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
