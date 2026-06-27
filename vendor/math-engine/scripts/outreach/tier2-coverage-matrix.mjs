#!/usr/bin/env node
/**
 * W215 — Tier-2 Operator Coverage Matrix.
 *
 * Cross-references 8 Tier-2 slot operators against 12 math-mechanic families
 * from our engine. Each cell reports { covered, evidence, confidence }.
 *
 * Emits:
 *   - reports/outreach/TIER2_COVERAGE.md  (Markdown report)
 *   - reports/outreach/TIER2_COVERAGE.json (raw matrix)
 *
 * CLI:
 *   node scripts/outreach/tier2-coverage-matrix.mjs
 *   node scripts/outreach/tier2-coverage-matrix.mjs --operator aristocrat
 *   node scripts/outreach/tier2-coverage-matrix.mjs --mechanic cascade
 *   node scripts/outreach/tier2-coverage-matrix.mjs --json
 *
 * Pure ESM, no external deps, deterministic (no Date.now, no Math.random).
 */

import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const REPORTS_DIR = resolve(REPO_ROOT, 'reports', 'outreach');

export const OPERATORS = [
  'aristocrat', 'igt', 'konami', 'novomatic',
  'playtech', 'everi', 'ainsworth', 'ags',
];

export const MECHANICS = [
  'cascade', 'respin', 'hold_and_win', 'cluster',
  'ways', 'megaways', 'ante_bet', 'buy_feature',
  'pick_bonus', 'wheel_bonus', 'mystery', 'jackpot',
];

/**
 * Per-cell coverage matrix.
 * Keys = `${operator}::${mechanic}` so cell lookups are O(1).
 * Each value: { covered, evidence, confidence }.
 */
export const COVERAGE_MATRIX = buildMatrix();

function cell(covered, evidence, confidence) {
  return { covered, evidence, confidence };
}

function buildMatrix() {
  const m = {};

  // Vendor C — broad Reel-Power + Hold-and-Spin lineage
  m['aristocrat::cascade'] = cell(false, 'No cascade-native flagship; minor presence on licensed titles', 'high');
  m['aristocrat::respin'] = cell(true, 'Pattern-LL / Pattern-DL respin trigger', 'high');
  m['aristocrat::hold_and_win'] = cell(true, 'Pattern-LL / Pattern-DL / Cash Express family', 'high');
  m['aristocrat::cluster'] = cell(false, 'No cluster-pays flagship', 'high');
  m['aristocrat::ways'] = cell(true, 'Reel-Power 243/1024 ways (Buffalo, 5 Dragons)', 'high');
  m['aristocrat::megaways'] = cell(true, 'BTG-licensed titles in catalogue', 'med');
  m['aristocrat::ante_bet'] = cell(true, 'Bet-multiplier on Wonder 4 family', 'med');
  m['aristocrat::buy_feature'] = cell(false, 'Limited; land-based regulators restrict buy-feature in many AU/US jurisdictions', 'high');
  m['aristocrat::pick_bonus'] = cell(true, 'Wonder 4 pick-an-icon', 'high');
  m['aristocrat::wheel_bonus'] = cell(true, 'Wonder 4 Boost wheel', 'high');
  m['aristocrat::mystery'] = cell(true, 'Pattern-LL mystery progressive', 'high');
  m['aristocrat::jackpot'] = cell(true, 'Hyperlink shared WAP progressives', 'high');

  // Vendor A — broadest mechanic palette; Wheel of Fortune flagship + Megabucks WAP
  m['igt::cascade'] = cell(true, 'Megacascade WoF variants', 'high');
  m['igt::respin'] = cell(true, 'Cash Link, Fortune Coin', 'high');
  m['igt::hold_and_win'] = cell(true, 'Cash Link / Fortune Coin', 'high');
  m['igt::cluster'] = cell(false, 'No cluster flagship', 'high');
  m['igt::ways'] = cell(true, 'Da Vinci Diamonds ways + many licensed', 'high');
  m['igt::megaways'] = cell(true, 'Vendor A under BTG license', 'med');
  m['igt::ante_bet'] = cell(true, 'Modern Vendor A online releases', 'med');
  m['igt::buy_feature'] = cell(true, 'Online Vendor A buy-feature releases', 'med');
  m['igt::pick_bonus'] = cell(true, 'Sphinx pyramid pick + many bonus rounds', 'high');
  m['igt::wheel_bonus'] = cell(true, 'Wheel of Fortune flagship', 'high');
  m['igt::mystery'] = cell(true, 'Da Vinci Diamonds tumbling mystery', 'high');
  m['igt::jackpot'] = cell(true, 'Megabucks WAP — industry-defining', 'high');

  // Konami — narrow-deep; Action Stacked Symbols dominates
  m['konami::cascade'] = cell(false, 'Not a Konami signature', 'high');
  m['konami::respin'] = cell(true, 'All Aboard hold-and-win family', 'high');
  m['konami::hold_and_win'] = cell(true, 'All Aboard family', 'high');
  m['konami::cluster'] = cell(false, 'No cluster flagship', 'high');
  m['konami::ways'] = cell(true, '243/720 ways on Action Stacked titles', 'high');
  m['konami::megaways'] = cell(false, 'Konami does not license BTG Megaways', 'high');
  m['konami::ante_bet'] = cell(false, 'Limited', 'med');
  m['konami::buy_feature'] = cell(true, 'Newer online titles only', 'med');
  m['konami::pick_bonus'] = cell(true, 'Frogs n Flies, others', 'high');
  m['konami::wheel_bonus'] = cell(true, 'All Aboard wheel ending', 'high');
  m['konami::mystery'] = cell(true, 'Lotus Land / Solstice mystery progressives', 'high');
  m['konami::jackpot'] = cell(true, 'Linked progressives across cabinet bank', 'high');

  // Novomatic — EU-leaning; Book of Ra centerpiece
  m['novomatic::cascade'] = cell(false, 'Limited; modern Greentube releases only', 'med');
  m['novomatic::respin'] = cell(true, 'Reel King hold mini-slot, newer Mystic Fortunes', 'high');
  m['novomatic::hold_and_win'] = cell(true, 'Reel King + newer Greentube releases', 'med');
  m['novomatic::cluster'] = cell(false, 'Not a Novomatic signature', 'high');
  m['novomatic::ways'] = cell(true, '40-line + ways on Greentube modern releases', 'med');
  m['novomatic::megaways'] = cell(true, 'Greentube has BTG-licensed titles', 'med');
  m['novomatic::ante_bet'] = cell(true, 'Plenty on Twenty bet-multiplier', 'high');
  m['novomatic::buy_feature'] = cell(true, 'Greentube modern releases', 'high');
  m['novomatic::pick_bonus'] = cell(true, 'Faust + various bonus rounds', 'med');
  m['novomatic::wheel_bonus'] = cell(false, 'Not a Novomatic signature', 'med');
  m['novomatic::mystery'] = cell(true, 'Book of Ra expanding bonus symbol', 'high');
  m['novomatic::jackpot'] = cell(true, 'Novomatic Linked Progressive / Greentube Pirate Pots', 'high');

  // Vendor F — broad online + Live; Age of the Gods + Buffalo Blitz
  m['playtech::cascade'] = cell(true, 'Heart of the Frontier + many cascade titles', 'high');
  m['playtech::respin'] = cell(true, 'Newer Asian-themed Vendor F releases', 'med');
  m['playtech::hold_and_win'] = cell(true, 'Newer Asian-themed Vendor F releases', 'med');
  m['playtech::cluster'] = cell(true, 'A handful of cluster-pays titles', 'med');
  m['playtech::ways'] = cell(true, 'Buffalo Blitz 4096 ways', 'high');
  m['playtech::megaways'] = cell(true, 'Vendor F under BTG license', 'high');
  m['playtech::ante_bet'] = cell(true, 'Beach Life option-bet + others', 'high');
  m['playtech::buy_feature'] = cell(true, 'Modern Vendor F 2024+ releases', 'high');
  m['playtech::pick_bonus'] = cell(true, 'Gladiator helmet pick + many', 'high');
  m['playtech::wheel_bonus'] = cell(true, 'Various wheel features', 'high');
  m['playtech::mystery'] = cell(true, 'Cat in Vegas mystery features', 'med');
  m['playtech::jackpot'] = cell(true, 'Age of the Gods 4-tier networked', 'high');

  // Everi — mid-narrow NA; Cash Machine + class-II heritage
  m['everi::cascade'] = cell(false, 'Not Everi signature', 'high');
  m['everi::respin'] = cell(true, 'Power XStream + Cash Machine', 'high');
  m['everi::hold_and_win'] = cell(true, 'Power XStream', 'high');
  m['everi::cluster'] = cell(false, 'No cluster flagship', 'high');
  m['everi::ways'] = cell(true, '243/720 ways on legacy ports', 'med');
  m['everi::megaways'] = cell(false, 'Not Everi catalogue', 'high');
  m['everi::ante_bet'] = cell(false, 'Limited', 'med');
  m['everi::buy_feature'] = cell(false, 'Land-based regulator restrictions in NA', 'high');
  m['everi::pick_bonus'] = cell(true, 'Multiple bonus rounds use pick trees', 'high');
  m['everi::wheel_bonus'] = cell(true, 'Smokin Hot Stuff Wicked Wheel', 'high');
  m['everi::mystery'] = cell(true, 'Linked mystery across Everi cabinet bank', 'high');
  m['everi::jackpot'] = cell(true, 'Linked progressives', 'high');

  // Ainsworth — narrow concentrated; Mustang Money + Eagle Bucks
  m['ainsworth::cascade'] = cell(false, 'Not Ainsworth signature', 'high');
  m['ainsworth::respin'] = cell(true, 'Mustang Money + Eagle Bucks hold-and-win', 'high');
  m['ainsworth::hold_and_win'] = cell(true, 'Mustang Money + Eagle Bucks', 'high');
  m['ainsworth::cluster'] = cell(false, 'No cluster flagship', 'high');
  m['ainsworth::ways'] = cell(true, 'Quick Spin Reel-Power 243 ways (Vendor C lineage)', 'high');
  m['ainsworth::megaways'] = cell(false, 'Not Ainsworth catalogue', 'high');
  m['ainsworth::ante_bet'] = cell(false, 'Limited', 'med');
  m['ainsworth::buy_feature'] = cell(false, 'AU regulator restrictions', 'high');
  m['ainsworth::pick_bonus'] = cell(true, 'Big Ben pick-an-icon', 'high');
  m['ainsworth::wheel_bonus'] = cell(true, 'Roll Up Roll Up wheel ending', 'high');
  m['ainsworth::mystery'] = cell(true, 'Jackpot Strike multi-level mystery', 'high');
  m['ainsworth::jackpot'] = cell(true, 'AU linked progressives', 'high');

  // AGS — narrow + class-II + Survivor licensed IP
  m['ags::cascade'] = cell(false, 'Not AGS signature', 'high');
  m['ags::respin'] = cell(true, 'Rakin Bacon + Jade Wins hold-and-win', 'high');
  m['ags::hold_and_win'] = cell(true, 'Rakin Bacon + Jade Wins', 'high');
  m['ags::cluster'] = cell(false, 'No cluster flagship', 'high');
  m['ags::ways'] = cell(true, '243/720 ways across catalogue', 'med');
  m['ags::megaways'] = cell(false, 'Not AGS catalogue', 'high');
  m['ags::ante_bet'] = cell(false, 'Limited', 'med');
  m['ags::buy_feature'] = cell(false, 'Land + class-II regulator restrictions', 'high');
  m['ags::pick_bonus'] = cell(true, 'Survivor pick + immunity meter', 'high');
  m['ags::wheel_bonus'] = cell(true, 'Capital Plays ending wheel', 'high');
  m['ags::mystery'] = cell(true, 'Olympus Strikes mystery symbol reveal', 'high');
  m['ags::jackpot'] = cell(true, 'Longhorn Jackpots linked progressive', 'high');

  return m;
}

/** Get a single cell value. */
export function getCell(operator, mechanic) {
  const key = `${operator}::${mechanic}`;
  return COVERAGE_MATRIX[key];
}

/** Compute coverage % for a single operator. */
export function operatorCoveragePct(operator) {
  let covered = 0;
  for (const mech of MECHANICS) {
    const c = getCell(operator, mech);
    if (c && c.covered) covered++;
  }
  return covered / MECHANICS.length;
}

/** Compute coverage % for a single mechanic across all operators. */
export function mechanicCoveragePct(mechanic) {
  let covered = 0;
  for (const op of OPERATORS) {
    const c = getCell(op, mechanic);
    if (c && c.covered) covered++;
  }
  return covered / OPERATORS.length;
}

/** Build a filtered view by operator. */
export function filterByOperator(operator) {
  const view = {};
  for (const mech of MECHANICS) {
    view[mech] = getCell(operator, mech);
  }
  return view;
}

/** Build a filtered view by mechanic. */
export function filterByMechanic(mechanic) {
  const view = {};
  for (const op of OPERATORS) {
    view[op] = getCell(op, mechanic);
  }
  return view;
}

/** Render the full matrix to Markdown. */
export function renderMatrixMarkdown() {
  const lines = [];
  lines.push('# Tier-2 Operator Coverage Matrix');
  lines.push('');
  lines.push('> Auto-generated by `scripts/outreach/tier2-coverage-matrix.mjs`. Do not edit by hand.');
  lines.push('> Deterministic; no clock/RNG dependencies.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Operator | Coverage % |');
  lines.push('|---|---|');
  for (const op of OPERATORS) {
    const pct = (operatorCoveragePct(op) * 100).toFixed(1);
    lines.push(`| ${op} | ${pct}% |`);
  }
  lines.push('');
  lines.push('| Mechanic | Coverage % across operators |');
  lines.push('|---|---|');
  for (const mech of MECHANICS) {
    const pct = (mechanicCoveragePct(mech) * 100).toFixed(1);
    lines.push(`| ${mech} | ${pct}% |`);
  }
  lines.push('');
  lines.push('## Full matrix');
  lines.push('');
  const header = ['Mechanic', ...OPERATORS].join(' | ');
  const sep = ['---', ...OPERATORS.map(() => '---')].join(' | ');
  lines.push(`| ${header} |`);
  lines.push(`| ${sep} |`);
  for (const mech of MECHANICS) {
    const row = [mech];
    for (const op of OPERATORS) {
      const c = getCell(op, mech);
      const mark = c.covered ? 'Y' : 'n';
      row.push(`${mark} (${c.confidence})`);
    }
    lines.push(`| ${row.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Evidence detail');
  lines.push('');
  for (const op of OPERATORS) {
    lines.push(`### ${op}`);
    lines.push('');
    lines.push('| Mechanic | Covered | Confidence | Evidence |');
    lines.push('|---|---|---|---|');
    for (const mech of MECHANICS) {
      const c = getCell(op, mech);
      const mark = c.covered ? 'Y' : 'n';
      lines.push(`| ${mech} | ${mark} | ${c.confidence} | ${c.evidence} |`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

/** Parse CLI args. */
export function parseArgs(argv) {
  const args = { operator: null, mechanic: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--operator' && argv[i + 1]) { args.operator = argv[++i]; }
    else if (a === '--mechanic' && argv[i + 1]) { args.mechanic = argv[++i]; }
    else if (a.startsWith('--operator=')) args.operator = a.slice('--operator='.length);
    else if (a.startsWith('--mechanic=')) args.mechanic = a.slice('--mechanic='.length);
  }
  return args;
}

/** Build the JSON snapshot. */
export function buildJsonSnapshot() {
  const snap = {
    schemaVersion: '1.0.0',
    sprint: 'W215',
    operators: OPERATORS,
    mechanics: MECHANICS,
    cells: {},
    operatorCoveragePct: {},
    mechanicCoveragePct: {},
  };
  for (const op of OPERATORS) {
    snap.operatorCoveragePct[op] = operatorCoveragePct(op);
    for (const mech of MECHANICS) {
      snap.cells[`${op}::${mech}`] = getCell(op, mech);
    }
  }
  for (const mech of MECHANICS) {
    snap.mechanicCoveragePct[mech] = mechanicCoveragePct(mech);
  }
  return snap;
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);

  if (args.operator && !OPERATORS.includes(args.operator)) {
    throw new Error(`unknown operator: ${args.operator}. Known: ${OPERATORS.join(', ')}`);
  }
  if (args.mechanic && !MECHANICS.includes(args.mechanic)) {
    throw new Error(`unknown mechanic: ${args.mechanic}. Known: ${MECHANICS.join(', ')}`);
  }

  if (args.json) {
    let payload;
    if (args.operator) payload = filterByOperator(args.operator);
    else if (args.mechanic) payload = filterByMechanic(args.mechanic);
    else payload = buildJsonSnapshot();
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return payload;
  }

  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const md = renderMatrixMarkdown();
  const json = buildJsonSnapshot();
  const mdPath = resolve(REPORTS_DIR, 'TIER2_COVERAGE.md');
  const jsonPath = resolve(REPORTS_DIR, 'TIER2_COVERAGE.json');
  await fs.writeFile(mdPath, md, 'utf8');
  await fs.writeFile(jsonPath, JSON.stringify(json, null, 2) + '\n', 'utf8');

  process.stdout.write(`[tier2-coverage] markdown -> ${mdPath}\n`);
  process.stdout.write(`[tier2-coverage] json     -> ${jsonPath}\n`);
  process.stdout.write(`[tier2-coverage] operators=${OPERATORS.length} mechanics=${MECHANICS.length} cells=${OPERATORS.length * MECHANICS.length}\n`);

  if (args.operator) {
    const v = filterByOperator(args.operator);
    process.stdout.write(`\n[filter operator=${args.operator}]\n`);
    for (const [mech, c] of Object.entries(v)) {
      process.stdout.write(`  ${mech}: ${c.covered ? 'Y' : 'n'} (${c.confidence}) - ${c.evidence}\n`);
    }
  }
  if (args.mechanic) {
    const v = filterByMechanic(args.mechanic);
    process.stdout.write(`\n[filter mechanic=${args.mechanic}]\n`);
    for (const [op, c] of Object.entries(v)) {
      process.stdout.write(`  ${op}: ${c.covered ? 'Y' : 'n'} (${c.confidence}) - ${c.evidence}\n`);
    }
  }

  return { md, json };
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  main(process.argv).catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
