#!/usr/bin/env node
/**
 * tools/_math-chain-no-ai-lint.mjs
 *
 * UQ-LV3-QA-5-B #14 (Boki 2026-06-26) — architectural backstop for
 * "AI is only the EYE" rule.
 *
 * Boki direktiva (2026-06-23): "math NIKAD AI (regulator reproducibility)
 * — AI je samo *oko* math-a (PAR auto-fill, anomaly explainer,
 * jurisdiction auto-fix)."
 *
 * Currently enforced by absence — no file in the math chain imports
 * any LLM SDK. The audit found no hits today. But a future engineer
 * could add `import { ask } from '../kimi-ask.mjs'` to
 * auto-converge-solver.mjs without breaking any test. That would
 * silently subvert regulator reproducibility.
 *
 * This linter is the structural guard. It enumerates the canonical
 * "math chain" files and greps for AI-symbol imports. Any hit fails
 * the gate.
 *
 * # USAGE
 *
 *   node tools/_math-chain-no-ai-lint.mjs            full sweep
 *   node tools/_math-chain-no-ai-lint.mjs --json     machine output
 *   node tools/_math-chain-no-ai-lint.mjs --quiet    only exit code
 *
 * # EXIT CODES
 *
 *   0  no AI-symbol imports found in any math-chain file
 *   1  at least one math-chain file imports an AI symbol
 *   2  walker setup error (file missing)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO       = resolve(dirname(__filename), '..');

/* The math chain — every file that MUST be deterministic + AI-free
   per the regulator-reproducibility rule. */
const MATH_CHAIN = [
  'tools/auto-converge-solver.mjs',
  'tools/cert-pack-export.mjs',
  'tools/math-backend.mjs',
  'tools/math-backend-spawner.mjs',
  'tools/sister-rust-server.mjs',
  'src/blocks/backendSpinEngine.mjs',
  'src/blocks/batchSimulatorPanel.mjs',
  'src/blocks/driftSentinel.mjs',
  'src/blocks/liveRtpHud.mjs',
  'src/blocks/convergenceHud.mjs',
];

/* AI-symbol patterns. Conservative — match obvious SDK imports +
   well-known LLM helper modules in this repo. */
const AI_IMPORT_PATTERNS = [
  /from\s+['"]@anthropic-ai\//i,
  /from\s+['"]openai['"]/i,
  /from\s+['"]@openai\//i,
  /from\s+['"]@google\/genai/i,
  /from\s+['"]\.\.?\/.*claude.*['"]/i,
  /from\s+['"]\.\.?\/.*opus.*['"]/i,
  /from\s+['"]\.\.?\/.*kimi.*['"]/i,
  /from\s+['"]\.\.?\/.*-llm['"]/i,
  /from\s+['"]\.\.?\/.*-ai\.mjs['"]/i,
  /import\s+.*\b(Claude|Opus|Anthropic|OpenAI|Kimi)\b/,
];

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const QUIET    = args.includes('--quiet');

function log(msg) {
  if (!JSON_OUT && !QUIET) process.stdout.write(`${msg}\n`);
}

const hits = [];
let scanned = 0;

for (const rel of MATH_CHAIN) {
  const abs = resolve(REPO, rel);
  if (!existsSync(abs)) {
    if (!JSON_OUT) {
      process.stderr.write(`warning: math-chain file missing: ${rel}\n`);
    }
    continue;
  }
  scanned++;
  const src = readFileSync(abs, 'utf8');
  /* Strip line + block comments so a documented vendor name doesn't
     trip the lint. We only care about EXECUTABLE imports. */
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')   /* block comments */
    .replace(/^\s*\/\/.*$/gm, '');        /* line comments */

  for (const [i, line] of codeOnly.split('\n').entries()) {
    for (const re of AI_IMPORT_PATTERNS) {
      if (re.test(line)) {
        hits.push({
          file: rel,
          line: i + 1,
          pattern: String(re),
          snippet: line.trim().slice(0, 160),
        });
      }
    }
  }
}

const verdict = hits.length === 0 ? 'PASS' : 'FAIL';

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    tool: 'tools/_math-chain-no-ai-lint.mjs',
    verdict,
    scanned,
    hits,
  }, null, 2) + '\n');
} else {
  log(`math-chain no-AI lint · ${scanned} file(s) scanned`);
  log('');
  if (hits.length === 0) {
    log('  ✓ clean — no AI-symbol imports in any math-chain file');
  } else {
    log(`  ✗ ${hits.length} hit(s):`);
    for (const h of hits.slice(0, 50)) {
      log(`    ${h.file}:${h.line}  ${h.snippet}`);
    }
  }
}

process.exit(verdict === 'PASS' ? 0 : 1);
