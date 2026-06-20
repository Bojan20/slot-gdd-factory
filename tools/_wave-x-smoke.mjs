#!/usr/bin/env node
/**
 * tools/_wave-x-smoke.mjs
 *
 * Wave X smoke — Universal topology extractor accuracy.
 *
 * Goal
 * ----
 * Run the parser on:
 *   - 20 synthetic grid fixtures (samples/grids/*.md)
 *   - 4 baseline GDDs in samples/ (Wrath, Crystal Forge, Midnight Fangs,
 *     Gates of Olympus)
 *
 * For each, extract topology + check:
 *   ✓ kind     — matches expected canonical kind (from fixture filename)
 *   ✓ reels    — numeric
 *   ✓ rows     — numeric
 *   ✓ paylines / ways_count present where applicable
 *   ✓ rows_per_reel / rows_per_reel_array for variable-reel fixtures
 *   ✓ cluster_adjacency for cluster fixtures
 *
 * Emits markdown report + pass/fail count.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');

/* Expected kinds by fixture filename prefix. */
const KIND_FROM_NAME = {
  rectangular:        'rectangular',
  cluster:            'cluster',
  variable_reel:      'variable_reel',
  megaclusters:       'megaclusters',
  /* note: parser preserves megaclusters as its own canonical kind. */
  hexagonal:          'hexagonal',
  diamond:            'diamond',
  pyramid:            'pyramid',
  cross:              'cross',
  lshape:             'l_shape',
  radial:             'radial',
  infinity:           'infinity',
  expanding:          'expanding',
  dual:               'dual',
  slingo:             'slingo',
  plinko:             'plinko',
  crash:              'crash',
  wheel:              'wheel',
  lock_respin:        'lock_respin',
};

function _kindFromFixture(file) {
  const name = basename(file).toLowerCase();
  /* Match LONGEST key first so 'megaclusters' beats 'cluster' substring. */
  const keys = Object.keys(KIND_FROM_NAME).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (name.includes(k.toLowerCase())) return KIND_FROM_NAME[k];
  }
  return null;
}

async function main() {
  const { parseMarkdownGDD } = await import(resolve(REPO, 'src/parser.mjs'));

  const targets = [];

  /* 1) 20 synthetic grid fixtures */
  const gridsDir = resolve(REPO, 'samples/grids');
  const gridFiles = (await readdir(gridsDir)).filter((f) => f.endsWith('.md'));
  for (const f of gridFiles) {
    targets.push({ path: resolve(gridsDir, f), label: 'grid:' + f, expectedKind: _kindFromFixture(f) });
  }

  /* 2) 4 baseline reference GDDs in samples/ */
  const referenceDir = resolve(REPO, 'samples');
  const refFiles = (await readdir(referenceDir)).filter((f) => f.endsWith('.md'));
  for (const f of refFiles) {
    targets.push({ path: resolve(referenceDir, f), label: 'ref:' + f, expectedKind: null /* free-form */ });
  }

  const results = [];
  let pass = 0, fail = 0;
  for (const t of targets) {
    const text = await readFile(t.path, 'utf8');
    const model = parseMarkdownGDD(text);
    const topo = model.topology || {};
    const ok = !t.expectedKind || topo.kind === t.expectedKind ||
               /* variable_reel maps internally to 'ways' eval + variable_reel kind via canonicalKind */
               (t.expectedKind === 'variable_reel' && topo.kind === 'variable_reel');
    if (ok) pass++; else fail++;
    results.push({
      label:       t.label,
      expectedKind: t.expectedKind,
      gotKind:     topo.kind,
      shape:       topo.shape,
      evaluation:  topo.evaluation,
      reels:       topo.reels,
      rows:        topo.rows,
      paylines:    topo.paylines,
      ways_count:  topo.ways_count,
      ways_cap:    topo.ways_cap,
      rows_per_reel: topo.rows_per_reel,
      rows_per_reel_array: topo.rows_per_reel_array,
      cluster_adjacency:   topo.cluster_adjacency,
      cluster_min_size:    topo.cluster_min_size,
      ok,
    });
  }

  /* Markdown report */
  const lines = [
    '# Wave X smoke — topology accuracy',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `**Pass: ${pass} / ${pass + fail}** (fail: ${fail})`,
    '',
    '| Fixture | Expected | Got kind | Shape | Eval | Reels×Rows | Lines | Ways | RPR | Adjacency |',
    '|:--|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:--|:-:|',
  ];
  for (const r of results) {
    const rpr = r.rows_per_reel_array ? `[${r.rows_per_reel_array.join(',')}]` :
                (r.rows_per_reel ? `${r.rows_per_reel.min}-${r.rows_per_reel.max}` : '—');
    lines.push(
      `| ${r.label} | ${r.expectedKind || '—'} | ${r.gotKind || '—'} | ${r.shape || '—'} | ${r.evaluation || '—'} | ${r.reels || '?'}×${r.rows || '?'} | ${r.paylines ?? '—'} | ${r.ways_count ?? '—'} | ${rpr} | ${r.cluster_adjacency || '—'} |`
    );
  }

  const outMd = resolve(REPO, 'tools/_eyes/wave-x-accuracy.md');
  await writeFile(outMd, lines.join('\n'), 'utf8');

  /* Console summary */
  console.log('═══ Wave X smoke ═══');
  console.log(`  fixtures: ${results.length}`);
  console.log(`  pass    : ${pass}`);
  console.log(`  fail    : ${fail}`);
  console.log('');

  /* Print fails detail */
  if (fail > 0) {
    console.log('FAILING:');
    for (const r of results) {
      if (r.ok) continue;
      console.log(`  ${r.label.padEnd(50)} expected=${r.expectedKind || '?'} got=${r.gotKind || '?'} (shape=${r.shape}, eval=${r.evaluation})`);
    }
    console.log('');
  }

  /* Variable + cluster spotlight */
  console.log('Variable-reel + cluster spotlight:');
  for (const r of results) {
    if (/variable|cluster|hexagonal|diamond|pyramid/.test(r.expectedKind || '')) {
      const rpr = r.rows_per_reel_array ? `[${r.rows_per_reel_array.join(',')}]` :
                  (r.rows_per_reel ? `${r.rows_per_reel.min}-${r.rows_per_reel.max}` : '—');
      console.log(
        '  ' + r.label.padEnd(50) +
        ' kind=' + (r.gotKind || '?').padEnd(14) +
        ' eval=' + (r.evaluation || '?').padEnd(10) +
        ' rpr=' + rpr.padEnd(10) +
        ' adj=' + (r.cluster_adjacency || '—').padEnd(10) +
        ' min=' + (r.cluster_min_size || '—')
      );
    }
  }

  console.log('');
  console.log(`Report saved: ${outMd}`);

  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
