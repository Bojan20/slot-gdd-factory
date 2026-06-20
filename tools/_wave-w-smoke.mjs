#!/usr/bin/env node
/**
 * tools/_wave-w-smoke.mjs
 *
 * Wave W smoke test — end-to-end.
 *   1. Load Wrath GDD text
 *   2. Run regex parser
 *   3. Apply Wave V reconcile overlay (env path)
 *   4. Load block catalog (W1)
 *   5. Map GDD → blocks (W2 + W3 + W4)
 *   6. Print activation report + W5 auto-config preview
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');

async function main() {
  process.env.WAVE_V_RECONCILE_PATH = resolve(REPO, 'tools/_eyes/wave-v/wrath_of_olympus/v6_reconcile.json');

  const { parseMarkdownGDD } = await import(resolve(REPO, 'src/parser.mjs'));
  const { mapGddToBlocks, loadCatalog } = await import(resolve(REPO, 'src/registry/blockMapper.mjs'));

  const gdd = await readFile(resolve(REPO, 'tools/_eyes/wave-v/wrath_of_olympus/gdd.txt'), 'utf8');
  const model = parseMarkdownGDD(gdd);
  const catalog = await loadCatalog(resolve(REPO, 'src/registry/blockCatalog.json'));

  const result = mapGddToBlocks(model, catalog);

  console.log('═══ Wave W smoke (Wrath of Olympus) ═══');
  console.log('  blocks scored:    ', result.scorecard.blocksScored);
  console.log('  activated:        ', result.scorecard.activated);
  console.log('  softMatches:      ', result.scorecard.softMatches);
  console.log('  off:              ', result.scorecard.off);
  console.log('  conflictLosers:   ', result.scorecard.conflictLosers);
  console.log('  avgScore:         ', result.scorecard.avgScore);
  console.log('');

  console.log('Top 25 activated blocks (sorted by score):');
  console.log('  Score   Block                                  Kinds');
  console.log('  ─────   ──────────────────────────────────────  ──────────────────────');
  for (const b of result.activated.slice(0, 25)) {
    console.log(
      '  ' + String(b.score).padEnd(7) +
      ' ' + b.id.padEnd(38) +
      ' ' + (b.kinds.join(', ').slice(0, 60) || '—'),
    );
  }
  console.log('');
  console.log('Soft matches (manual review, 0.35..0.65):');
  for (const b of result.softMatches.slice(0, 10)) {
    console.log('  ' + String(b.score).padEnd(7) + ' ' + b.id.padEnd(38) + ' ' + (b.kinds.join(', ').slice(0, 60) || '—'));
  }
  console.log('');
  console.log('Rejected (sample 10):');
  for (const r of result.rejected.slice(0, 10)) {
    console.log('  ' + r.id.padEnd(40) + ' reason=' + r.reason + (r.against ? ' against=' + r.against : ''));
  }

  /* W5 — Auto-config injection preview */
  console.log('');
  console.log('═══ W5 Auto-config injection preview ═══');
  console.log('  freeSpins config from model:', JSON.stringify(model.freeSpins?.awards || null));
  console.log('  holdAndWin config:           ', JSON.stringify(model.holdAndWin || null));
  console.log('  winCap config:               ', JSON.stringify(model.winCap || null));
  console.log('  bigWinTier config:           ', JSON.stringify(model.bigWinTier || null));

  process.exit(0);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
