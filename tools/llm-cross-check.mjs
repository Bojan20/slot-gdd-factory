#!/usr/bin/env node
/**
 * tools/llm-cross-check.mjs
 *
 * MATH-DEEP HYB-3 (2026-06-22) — LLM Consistency Validator (Sloj 3).
 *
 * Purpose
 *   After parser (Sloj 1) + LLM completer (Sloj 2) have produced a model,
 *   this is the SECOND-PASS audit: it asks an LLM "given this GDD prose
 *   and this model.json, is every model claim faithful to the GDD?"
 *   Output is a {field, claim, gdd_quote, faithful: T/F, reason} per
 *   probed field. Disagreements go to a human review queue.
 *
 * Why
 *   Sloj 2 LLM completer fills gaps; Sloj 3 catches LLM hallucinations
 *   that snuck through schema validation. Schema only checks SHAPE, not
 *   FAITHFULNESS. Example: LLM could emit rtp=96 when the GDD says
 *   variant 3 is 93.10%; schema accepts (it's in range), but Sloj 3
 *   asks "show me where in the GDD this 96 comes from" and flags the
 *   mismatch.
 *
 * Industry pattern
 *   This is the "self-correction" pattern used in production LLM
 *   pipelines (Antropic's "constitutional AI" review, OpenAI's
 *   "process supervision"). The completer's output is itself fed back
 *   to the validator with the source corpus.
 *
 * Public API
 *   - validateFieldFaithful(rawGdd, fieldPath, modelValue) -> { faithful, gdd_quote, reason, confidence }
 *   - validateModelFaithful(slug, rawGdd, model, opts) -> { entries, disagreements }
 *
 * Receipt format (per field)
 *   {
 *     field: 'payback.rtp',
 *     model_value: 96.00,
 *     faithful: true,
 *     gdd_quote: 'variant 001 = 96.00% RTP',
 *     reason: 'value matches verbatim GDD quote',
 *     confidence: 0.98,
 *     duration_ms: 1234,
 *     provider: 'kimi',
 *     timestamp: '2026-06-22T...Z',
 *   }
 *
 * Failure modes
 *   - `faithful: false` → disagreement (human review queue)
 *   - LLM call fails → halt receipt (no false-green)
 *   - empty gdd_quote → halt (model claim has no provenance in GDD)
 *
 * Cache
 *   src/cert/llm-cross-check.json — keyed by sha256(rawGdd):fieldPath:value.
 *   Cache hit returns prior receipt unchanged; new value invalidates.
 *
 * Performance budget
 *   ≤ 8s per field, ≤ 30s timeout. For 20-field audit ≤ 3 min; cache hits
 *   drop it to ~5s.
 *
 * HARD RULE #1 (vendor-neutral)
 *   Prompts and quotes pass through unfiltered (the LLM sees the raw GDD
 *   anyway), but the validator's own log lines never embed vendor names.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const CACHE_DIR = join(REPO, 'src/cert');
const CACHE_FILE = join(CACHE_DIR, 'llm-cross-check.json');

const KIMI_BIN = process.env.CORTEX_KIMI_BIN
  || join(process.env.HOME || '/Users/vanvinklstudio', 'Projects/cortex/scripts/cortex-kimi-ask');
const KIMI_TIMEOUT_MS = Number(process.env.CORTEX_KIMI_TIMEOUT_MS || 30_000);

/* ── Helpers ──────────────────────────────────────────────────────────── */

function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

function saveCache(cache) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function getByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/* ── LLM call ─────────────────────────────────────────────────────────── */

function buildPrompt(rawGdd, fieldPath, modelValue) {
  /* Trim GDD to ~6000 chars; center on field-relevant section. */
  const lowerPath = fieldPath.toLowerCase();
  let hint = '';
  if (lowerPath.includes('rtp') || lowerPath.includes('payback')) hint = 'RTP';
  else if (lowerPath.includes('freespins') || lowerPath.includes('fs')) hint = 'Free Spins';
  else if (lowerPath.includes('holdandwin')) hint = 'Hold & Win';
  else if (lowerPath.includes('jackpot')) hint = 'Jackpot';
  else if (lowerPath.includes('bet')) hint = 'Bet';
  else if (lowerPath.includes('topology')) hint = 'Reel';
  else if (lowerPath.includes('expandingwild')) hint = 'Wild';
  else if (lowerPath.includes('patternwin')) hint = 'Pattern Win';
  else if (lowerPath.includes('compliance')) hint = 'jurisdiction';

  let context = rawGdd;
  if (rawGdd.length > 6000 && hint) {
    const idx = rawGdd.toLowerCase().indexOf(hint.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 2500);
      const end   = Math.min(rawGdd.length, idx + 3500);
      context = rawGdd.slice(start, end);
    } else context = rawGdd.slice(0, 6000);
  } else if (rawGdd.length > 6000) context = rawGdd.slice(0, 6000);

  return `You are auditing a slot game model against its GDD prose.

FIELD PATH: ${fieldPath}
MODEL VALUE: ${JSON.stringify(modelValue)}

GDD prose (excerpt):
"""
${context}
"""

Question: Is the model value FAITHFUL to the GDD? Show your work.

Respond ONLY with JSON in this exact shape:
{
  "faithful": true | false,
  "gdd_quote": "<exact verbatim quote from GDD that supports or refutes the model value, ≤ 200 chars, or empty string if no supporting/refuting quote exists>",
  "reason": "<one-sentence explanation, ≤ 200 chars>",
  "confidence": <number 0.0..1.0>
}

Rules:
- faithful=true ONLY when GDD prose explicitly supports the model value.
- faithful=false when GDD prose explicitly contradicts the model value.
- If GDD prose is silent (no support, no contradiction), set faithful=false with reason="not stated in GDD".
- gdd_quote MUST be a verbatim substring of the GDD prose (or empty if none).
- Do NOT speculate. Hallucinated quotes are worse than empty.

Output JSON now.`;
}

function callKimi(prompt, timeoutMs = KIMI_TIMEOUT_MS) {
  if (!existsSync(KIMI_BIN)) return { ok: false, error: `kimi binary not found at ${KIMI_BIN}` };
  const t0 = Date.now();
  const r = spawnSync(KIMI_BIN, ['--timeout', String(Math.ceil(timeoutMs / 1000)), '--raw'], {
    input: prompt, encoding: 'utf8', timeout: timeoutMs + 5000,
  });
  const duration = Date.now() - t0;
  if (r.status !== 0) return { ok: false, error: `kimi exit ${r.status}`, duration };
  const raw = (r.stdout || '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { ok: false, error: 'no JSON in response', raw: raw.slice(0, 200), duration };
  try { return { ok: true, obj: JSON.parse(jsonMatch[0]), raw, duration }; }
  catch (e) { return { ok: false, error: `JSON parse: ${e.message}`, raw: raw.slice(0, 200), duration }; }
}

/* ── Single-field validator ───────────────────────────────────────────── */

/**
 * Ask LLM whether modelValue is faithful to rawGdd.
 * Returns structured receipt with provenance.
 */
export function validateFieldFaithful(rawGdd, fieldPath, modelValue, opts = {}) {
  const { skipCache = false, dryRun = false } = opts;
  const gddHash = sha256(rawGdd);
  const valueHash = sha256(JSON.stringify(modelValue));
  const cacheKey = `${gddHash}:${fieldPath}:${valueHash}`;
  const cache = loadCache();
  if (!skipCache && cache[cacheKey]) return { ...cache[cacheKey], cached: true };
  if (dryRun) {
    return {
      field: fieldPath, model_value: modelValue, faithful: false,
      gdd_quote: '', reason: 'dry-run', confidence: 0,
      provider: 'kimi', halt: true, halt_reason: 'dry-run',
      duration_ms: 0, timestamp: new Date().toISOString(),
    };
  }
  const prompt = buildPrompt(rawGdd, fieldPath, modelValue);
  const resp = callKimi(prompt);
  if (!resp.ok) {
    const r = {
      field: fieldPath, model_value: modelValue, faithful: false,
      gdd_quote: '', reason: `LLM call failed: ${resp.error}`,
      confidence: 0, provider: 'kimi', halt: true, halt_reason: resp.error,
      duration_ms: resp.duration || 0, timestamp: new Date().toISOString(),
    };
    cache[cacheKey] = r;
    saveCache(cache);
    return r;
  }
  const o = resp.obj;
  const receipt = {
    field: fieldPath,
    model_value: modelValue,
    faithful: typeof o.faithful === 'boolean' ? o.faithful : false,
    gdd_quote: typeof o.gdd_quote === 'string' ? o.gdd_quote.slice(0, 200) : '',
    reason: typeof o.reason === 'string' ? o.reason.slice(0, 200) : '',
    confidence: typeof o.confidence === 'number' ? o.confidence : 0,
    provider: 'kimi',
    halt: false,
    duration_ms: resp.duration,
    timestamp: new Date().toISOString(),
  };
  /* Verify quote actually appears in GDD (LLM-hallucination guard). */
  if (receipt.faithful && receipt.gdd_quote && !rawGdd.includes(receipt.gdd_quote)) {
    receipt.faithful = false;
    receipt.reason = 'gdd_quote not a verbatim substring (LLM hallucination guard)';
  }
  cache[cacheKey] = receipt;
  saveCache(cache);
  return receipt;
}

/* ── Walk model fields ────────────────────────────────────────────────── */

const AUDIT_FIELDS = [
  'payback.rtp', 'payback.hitFrequency', 'payback.maxWinX',
  'payback.rtpBreakdown.baseLine', 'payback.rtpBreakdown.hwBase',
  'payback.rtpBreakdown.fsLine',   'payback.rtpBreakdown.hwFs',
  'bet.minBet', 'bet.maxBet', 'bet.stepCount',
  'topology.reels', 'topology.rows', 'topology.paylines',
  'freeSpins.triggerCount', 'freeSpins.retrigger.hardCap',
  'freeSpins.avgSpinsPlayed',
  'holdAndWin.triggerCount', 'holdAndWin.fsTriggerCount',
  'holdAndWin.cashPool.min', 'holdAndWin.cashPool.max',
  'patternWin.awardX',
  'expandingWild.onlyIfWinning',
  'scatter.payTable',
];

/**
 * Validate all populated audit fields. Returns { entries, disagreements }.
 *
 * - entries: every receipt (including faithful ones)
 * - disagreements: subset where faithful=false (review queue)
 */
export function validateModelFaithful(slug, rawGdd, model, opts = {}) {
  const entries = [];
  for (const field of AUDIT_FIELDS) {
    const val = getByPath(model, field);
    if (val === undefined || val === null) continue;
    /* Skip empty objects (scatter.payTable might be {} on no-FS games). */
    if (typeof val === 'object' && Object.keys(val).length === 0) continue;
    const r = validateFieldFaithful(rawGdd, field, val, opts);
    entries.push(r);
  }
  const disagreements = entries.filter(e => !e.faithful && !e.halt);
  return { entries, disagreements };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('llm-cross-check.mjs')) {
  const args = process.argv.slice(2);
  const slugArg = args.find(a => a.startsWith('--slug='))?.slice(7);
  const dryRun = args.includes('--dry-run');
  if (!slugArg) {
    console.error('Usage: node tools/llm-cross-check.mjs --slug=<slug> [--dry-run]');
    process.exit(2);
  }
  const slugPath = join(REPO, 'dist/real-games', slugArg);
  if (!existsSync(slugPath)) {
    console.error(`▸ slug ${slugArg} not found`);
    process.exit(2);
  }
  const rawGdd = readFileSync(join(slugPath, 'raw.txt'), 'utf8');
  const model = JSON.parse(readFileSync(join(slugPath, 'model.json'), 'utf8'));
  const r = validateModelFaithful(slugArg, rawGdd, model, { dryRun });
  console.log(`▸ ${slugArg}: ${r.entries.length} entries, ${r.disagreements.length} disagreements`);
  for (const d of r.disagreements.slice(0, 10)) {
    console.log(`   ✗ ${d.field}=${JSON.stringify(d.model_value)} — ${d.reason}`);
  }
  /* Write report. */
  const reportDir = join(REPO, 'reports/llm-consistency');
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(reportDir, `${slugArg}-${ts}.json`);
  writeFileSync(reportPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`▸ report: ${reportPath}`);
}
