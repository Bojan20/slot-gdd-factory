#!/usr/bin/env node
/**
 * tests/tools/math-6-par-sheet.test.mjs
 *
 * MATH-6 — PAR sheet generator self-test.
 *
 * Asertuje:
 *   1. Generator produces JSON + TXT outputs
 *   2. JSON has all required sections (identification, declared, reelStrips,
 *      measured, volatility, audit)
 *   3. Cash Eruption declared values match MATH-1 extracted (rtp 96, variants 3,
 *      maxWinX 50000, hf 19.03, wf 8.94, volIdx 8)
 *   4. JSON $schema marker present
 *   5. ASCII tabela has box-drawing borders + section headers
 *   6. Determinism: same input → identical $hash output
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const GEN = join(REPO, 'tools/par-sheet-generator.mjs');
const PROBE = join(REPO, 'tools/math-rtp-probe.mjs');
const VOL = join(REPO, 'tools/math-volatility-calc.mjs');
const JSON_OUT = join(REPO, 'reports/par-sheets/cash-eruption-foundry-gdd.json');
const TXT_OUT  = join(REPO, 'reports/par-sheets/cash-eruption-foundry-gdd.txt');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* Ensure dependencies present */
  spawnSync('node', [PROBE, '--runs', '10000', '--seed', '42'], { cwd: REPO });
  spawnSync('node', [VOL], { cwd: REPO });

  const r = spawnSync('node', [GEN], { cwd: REPO, encoding: 'utf8' });
  assert(r.status === 0, `generator exit ${r.status}: ${r.stderr}`);

  /* (1) Outputs */
  assert(existsSync(JSON_OUT), `JSON output missing at ${JSON_OUT}`);
  assert(existsSync(TXT_OUT),  `TXT output missing at ${TXT_OUT}`);

  /* (2) JSON sections */
  const p = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  for (const sec of ['identification', 'declared', 'reelStrips', 'measured', 'volatility', 'audit']) {
    assert(p[sec], `missing section: ${sec}`);
  }
  assert(p.$schema === 'par-sheet/v1', `$schema expected 'par-sheet/v1', got ${p.$schema}`);
  assert(/GLI-19/.test(p.$standard), `$standard should reference GLI-19, got ${p.$standard}`);
  /* Boki direktiva 2026-06-22: PAR sheet acceptance band must reference ±0.05% precision. */
  assert(/0\.05/.test(p.audit.rtpAcceptanceBand),
    `rtpAcceptanceBand should reference 0.05% precision (Boki direktiva), got '${p.audit.rtpAcceptanceBand}'`);

  /* (3) Cash Eruption declared values match MATH-1 (regression guard) */
  assert(p.declared.rtp === 96, `declared.rtp expected 96, got ${p.declared.rtp}`);
  assert(p.declared.rtpVariants?.length === 3,
    `declared.rtpVariants expected 3, got ${p.declared.rtpVariants?.length}`);
  assert(p.declared.maxWinX === 50000, `declared.maxWinX expected 50000, got ${p.declared.maxWinX}`);
  assert(p.declared.hitFrequency === 19.03, `declared.hitFrequency expected 19.03, got ${p.declared.hitFrequency}`);
  assert(p.declared.winFrequency === 8.94, `declared.winFrequency expected 8.94, got ${p.declared.winFrequency}`);
  assert(p.declared.volatilityIdx === 8, `declared.volatilityIdx expected 8, got ${p.declared.volatilityIdx}`);

  /* (4) Reel strips (MATH-2) */
  assert(p.reelStrips.baseSetCount === 36, `reelStrips.baseSetCount expected 36`);
  assert(p.reelStrips.fsSetCount === 16,   `reelStrips.fsSetCount expected 16`);

  /* (5) ASCII tabela borders */
  const txt = readFileSync(TXT_OUT, 'utf8');
  assert(/╔.*╗/.test(txt), 'ASCII tabela missing top border (╔ ╗)');
  assert(/╚.*╝/.test(txt), 'ASCII tabela missing bottom border (╚ ╝)');
  assert(/║.*DECLARED.*║/.test(txt), 'ASCII tabela missing DECLARED section header');
  assert(/║.*REEL STRIPS.*║/.test(txt), 'ASCII tabela missing REEL STRIPS section');
  assert(/║.*MEASURED.*║/.test(txt), 'ASCII tabela missing MEASURED section');
  assert(/║.*VOLATILITY.*║/.test(txt), 'ASCII tabela missing VOLATILITY section');
  assert(/║.*AUDIT.*║/.test(txt), 'ASCII tabela missing AUDIT section');

  /* (6) Determinism: hash sans timestamp = stable */
  function stripTs(obj) {
    const c = JSON.parse(JSON.stringify(obj));
    delete c.generatedAt;
    return JSON.stringify(c);
  }
  spawnSync('node', [GEN], { cwd: REPO });
  const p2 = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  const h1 = createHash('sha256').update(stripTs(p)).digest('hex').slice(0, 16);
  const h2 = createHash('sha256').update(stripTs(p2)).digest('hex').slice(0, 16);
  assert(h1 === h2, `non-deterministic PAR sheet: ${h1} ≠ ${h2}`);

  console.log(`✓ math-6-par-sheet.test.mjs — Cash Eruption PAR sheet generated (rtp ${p.declared.rtp}%, 3 variants, maxWinX ${p.declared.maxWinX}, deterministic hash ${h1})`);
} catch (e) {
  console.error('✗ math-6-par-sheet.test.mjs:', e.message);
  process.exit(1);
}
