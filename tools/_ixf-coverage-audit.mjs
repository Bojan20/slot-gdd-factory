#!/usr/bin/env node
/**
 * tools/_ixf-coverage-audit.mjs
 *
 * P3-P2 (Boki 2026-06-25) — IXF 15-stage coverage walker.
 *
 * Parses `docs/IXF-15-STAGES.md` and verifies every stage row
 * (S01..S15) is covered by at least one event that EXISTS in
 * `HOOK_EVENTS`. Drift between the doc and the runtime registry is
 * surfaced loudly:
 *
 *   - A row whose hook list contains a typo / removed event → P0
 *     (regulator integrator gets a broken contract).
 *   - A stage with ZERO hooks → P0 (industry lifecycle has a gap).
 *   - An orphan hook (in HOOK_EVENTS but mentioned in no row) →
 *     INFORMATIONAL (block emits but isn't regulator-aligned yet).
 *
 * # USAGE
 *
 *   node tools/_ixf-coverage-audit.mjs            full walk
 *   node tools/_ixf-coverage-audit.mjs --quiet    suppress per-stage
 *   node tools/_ixf-coverage-audit.mjs --json     machine output
 *
 * # EXIT CODES
 *
 *   0  every stage has ≥ 1 hook that exists in HOOK_EVENTS
 *   1  ≥ 1 stage missing coverage OR ≥ 1 hook in doc not registered
 *   2  doc / source file missing
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOOK_EVENTS } from '../src/blocks/hookBus.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO      = resolve(__dirname, '..');
const DOC_PATH  = resolve(REPO, 'docs', 'IXF-15-STAGES.md');

const args = process.argv.slice(2);
const QUIET   = args.includes('--quiet');
const JSONOUT = args.includes('--json');

function log(msg) {
  if (!QUIET && !JSONOUT) process.stdout.write(`${msg}\n`);
}

if (!existsSync(DOC_PATH)) {
  process.stderr.write(`error: ${DOC_PATH} not found\n`);
  process.exit(2);
}

const doc = readFileSync(DOC_PATH, 'utf8');

/* Parse the stage table. The mapping table opens with a row that
   starts with `│ S01 │` (box-drawing) — we anchor on that. Each row
   may span multiple lines (continuation rows start with `│     │`).
   The hook column is anchor[2]. Hook tokens are comma-separated
   identifiers — we extract every camelCase identifier from the
   column to be tolerant of whitespace + line-wrap. */
const ROW_RE = /^│\s*(S\d{2})\s*│([^│]+)│([^│]+)│/;
const CONT_RE = /^│\s+│([^│]+)│([^│]+)│/;

const stages = new Map();   // 'S01' → { name, hooks: Set<string> }
let currentStage = null;
const lines = doc.split('\n');
for (const line of lines) {
  const m = ROW_RE.exec(line);
  if (m) {
    currentStage = m[1].trim();
    stages.set(currentStage, {
      name: m[2].trim(),
      hooks: extractHooks(m[3]),
    });
    continue;
  }
  const c = CONT_RE.exec(line);
  if (c && currentStage) {
    const more = extractHooks(c[2]);
    const ent = stages.get(currentStage);
    for (const h of more) ent.hooks.add(h);
  }
}

function extractHooks(rawCell) {
  /* Identifiers we care about start with lowercase (`onSpinResult`,
     `preSpin`, `postSpin`). Strip ASCII art / parens. */
  const found = new Set();
  const re = /\b(pre[A-Z]\w+|post[A-Z]\w+|on[A-Z]\w+)\b/g;
  let m;
  while ((m = re.exec(rawCell)) !== null) {
    found.add(m[1]);
  }
  return found;
}

const registered = new Set(HOOK_EVENTS);

let stagesCovered = 0;
let stagesMissing = 0;
let totalDocHooks = 0;
const missing = [];           // { stage, missingHooks: string[] }
const uncoveredStages = [];   // 'S01', ...
const drift = [];             // hooks in doc but NOT in HOOK_EVENTS

for (const [stage, ent] of stages) {
  let covered = 0;
  for (const h of ent.hooks) {
    totalDocHooks++;
    if (registered.has(h)) covered++;
    else drift.push({ stage, hook: h });
  }
  if (ent.hooks.size === 0) {
    uncoveredStages.push(stage);
    stagesMissing++;
  } else if (covered === 0) {
    /* All listed hooks are drifted — stage is effectively uncovered. */
    uncoveredStages.push(stage);
    stagesMissing++;
  } else {
    stagesCovered++;
  }
}

/* Orphan hooks: in registry but not mentioned anywhere in the doc. */
const mentioned = new Set();
for (const ent of stages.values()) {
  for (const h of ent.hooks) mentioned.add(h);
}
const orphans = [];
for (const h of HOOK_EVENTS) {
  if (!mentioned.has(h)) orphans.push(h);
}

if (JSONOUT) {
  process.stdout.write(JSON.stringify({
    totalStages: stages.size,
    stagesCovered,
    stagesMissing,
    uncoveredStages,
    totalDocHooks,
    drift,
    orphanHookCount: orphans.length,
    orphanHooksSample: orphans.slice(0, 20),
  }, null, 2) + '\n');
} else {
  log(`IXF coverage audit · ${stages.size} stages parsed from docs/IXF-15-STAGES.md`);
  log('');
  log(`  stages covered : ${stagesCovered}/${stages.size}`);
  log(`  stages missing : ${stagesMissing}`);
  if (uncoveredStages.length) {
    log(`  uncovered      : ${uncoveredStages.join(', ')}`);
  }
  log(`  hooks in doc   : ${totalDocHooks}`);
  log(`  hooks in code  : ${HOOK_EVENTS.length}`);
  log(`  drift (doc ⇸)  : ${drift.length}`);
  if (drift.length) {
    log('');
    log('  Hooks in doc but NOT registered in HOOK_EVENTS:');
    for (const d of drift.slice(0, 20)) {
      log(`    ${d.stage} → ${d.hook}`);
    }
    if (drift.length > 20) log(`    ... (${drift.length - 20} more)`);
  }
  log(`  orphans (info) : ${orphans.length} hooks in registry, no stage mapped`);
}

process.exit(stagesMissing > 0 || drift.length > 0 ? 1 : 0);
