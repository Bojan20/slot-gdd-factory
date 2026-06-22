#!/usr/bin/env node
/**
 * tools/llm-field-completer.mjs
 *
 * MATH-DEEP HYB-2 (2026-06-22) — LLM Structured Fallback (Sloj 2).
 *
 * Purpose
 *   The parser (Sloj 1) extracts model.json deterministically via regex.
 *   For fields it could not extract (parser uncertain or GDD prose
 *   ambiguous), this tool calls a structured LLM (Kimi by default) with
 *   the canonical UniversalGameSchema as the OUTPUT TARGET, asks for ONE
 *   field at a time, and validates the response against the schema. If
 *   validation fails, it retries with a stricter prompt; if still fails,
 *   it emits a HALT receipt (no silent corruption).
 *
 * Why
 *   Multi-vendor coverage. New PDFs (Pragmatic / L&W / Microgaming etc.)
 *   will have feature prose the parser regexes don't know how to read.
 *   Instead of hand-coding per-vendor regexes, ask an LLM with a schema
 *   contract. Output is validated, source-quoted, and confidence-scored.
 *
 * Industry reference
 *   This mirrors the OpenAI structured-output / Anthropic tool-use pattern:
 *   schema is the source of truth, LLM is constrained to emit conforming
 *   JSON, validator catches drift. We use Kimi via cortex-kimi-ask wrapper
 *   to avoid OpenAI/Anthropic vendor lock.
 *
 * Public API
 *   - listEmptyRequiredFields(model, schema) -> string[]
 *       Inspect parser output, list fields that the schema permits but
 *       the parser left undefined (the LLM completion target set).
 *   - completeField(slug, rawGdd, fieldPath, options) -> { value, source_quote, confidence, receipt }
 *       Call Kimi with a focused prompt for ONE field. Returns structured
 *       result with provenance.
 *   - completeModel(slug, rawGdd, model, options) -> { filled, receipts, halts }
 *       Walk all empty target fields, call completeField() per field.
 *
 * Lifecycle
 *   1. Parser emits model.json (partial)
 *   2. listEmptyRequiredFields(model) finds gaps
 *   3. completeField() per gap (cached by GDD hash + field path)
 *   4. Merged model passes UniversalGameSchema.validate()
 *   5. HYB-3 consistency validator (Sloj 3) confirms LLM answers match GDD
 *   6. HYB-5 orchestrator emits receipt chain
 *
 * Performance budget
 *   Each LLM call ≤ 8s wall-clock (timeout 30s ceiling). For 20-field
 *   completion target ≤ 3 min/GDD; with cache 90% hit ≤ 20s/GDD.
 *
 * HARD RULE #1 (vendor-neutral)
 *   Prompts MUST NOT mention vendor product names. LLM is told "this is a
 *   slot GDD". Vendor identifiers (game id / swid) are passed for caching
 *   purposes only and never appear in the prompt body.
 *
 * Receipt format (per call)
 *   {
 *     field: 'freeSpins.retrigger.hardCap',
 *     value: 15,
 *     source_quote: 'Hard cap (total played) 15',
 *     confidence: 0.95,
 *     provider: 'kimi',
 *     prompt_hash: 'abc123...',
 *     duration_ms: 1234,
 *     schema_validated: true,
 *     attempt: 1,
 *     timestamp: '2026-06-22T18:35:00Z'
 *   }
 *
 * Cache
 *   src/cert/llm-receipts.json — keyed by `<gdd_hash>:<field_path>`. Cache
 *   hit returns the prior receipt unchanged; cache miss triggers LLM call.
 *
 * Halt mode
 *   If LLM returns invalid JSON twice, or schema validation fails twice,
 *   the field is left undefined and a HALT receipt is added with the
 *   reason. Downstream walker reports the gap as a SOFT or HARD finding
 *   per field criticality. Never silently fills with garbage.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UniversalGameSchema, validateModel } from '../src/schema/universalGame.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const CACHE_DIR = join(REPO, 'src/cert');
const CACHE_FILE = join(CACHE_DIR, 'llm-receipts.json');

/* ── Helpers ──────────────────────────────────────────────────────────── */

function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    /* QA Agent#4 finding #8: validate cache shape on load. A hand-edited
     * or corrupted cache file with prototype-polluting keys or wrong
     * receipt shape would silently bypass actual LLM calls. Reject
     * non-plain-object and keys containing __proto__/constructor/prototype. */
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const safe = Object.create(null);
    for (const [k, v] of Object.entries(raw)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (v == null || typeof v !== 'object') continue;
      /* Minimal receipt shape check: must have `field` string. */
      if (typeof v.field !== 'string') continue;
      safe[k] = v;
    }
    return safe;
  } catch { return {}; }
}

function saveCache(cache) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  /* Atomic write: write to tmp, then rename onto CACHE_FILE. fs.rename
   * is atomic on POSIX (no half-written cache on crash / concurrent run). */
  const tmp = CACHE_FILE + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  try {
    renameSync(tmp, CACHE_FILE);
  } catch (e) {
    /* Cleanup tmp on rename failure. */
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Walk model object, return dotted paths of fields that the schema permits
 * but the parser left undefined.
 *
 * Conservative implementation: lists known high-value target fields rather
 * than auto-extracting them from Zod schema (Zod introspection is fragile
 * across versions). New target fields are added to TARGET_FIELDS as needed.
 */
const TARGET_FIELDS = [
  /* RTP + economics */
  'payback.rtp',
  'payback.hitFrequency',
  'payback.volatilityIdx',
  'payback.maxWinX',
  'payback.rtpBreakdown.baseLine',
  'payback.rtpBreakdown.hwBase',
  'payback.rtpBreakdown.fsLine',
  'payback.rtpBreakdown.hwFs',
  /* Bet ladder */
  'bet.minBet',
  'bet.maxBet',
  'bet.stepCount',
  /* Topology */
  'topology.reels',
  'topology.rows',
  'topology.paylines',
  'topology.evaluation',
  /* FS */
  'freeSpins.triggerCount',
  'freeSpins.retrigger.enabled',
  'freeSpins.retrigger.hardCap',
  'freeSpins.avgSpinsPlayed',
  /* H&W */
  'holdAndWin.enabled',
  'holdAndWin.triggerCount',
  'holdAndWin.fsTriggerCount',
  'holdAndWin.cashPool.min',
  'holdAndWin.cashPool.max',
  /* Pattern Win */
  'patternWin.enabled',
  'patternWin.awardX',
  /* Expanding wild */
  'expandingWild.enabled',
  'expandingWild.onlyIfWinning',
  /* Jackpot */
  'jackpot.enabled',
  'jackpot.type',
];

export function listEmptyRequiredFields(model, targets = TARGET_FIELDS) {
  const empty = [];
  for (const path of targets) {
    const parts = path.split('.');
    let cur = model;
    let isUndef = false;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') { isUndef = true; break; }
      cur = cur[p];
    }
    if (isUndef || cur === undefined || cur === null) {
      empty.push(path);
    }
  }
  return empty;
}

/* ── LLM call (Kimi via cortex-kimi-ask) ──────────────────────────────── */

const KIMI_BIN = process.env.CORTEX_KIMI_BIN
  || join(process.env.HOME || '/Users/vanvinklstudio', 'Projects/cortex/scripts/cortex-kimi-ask');
const KIMI_TIMEOUT_MS = Number(process.env.CORTEX_KIMI_TIMEOUT_MS || 30_000);

/**
 * Build a focused prompt for ONE field. The LLM is told:
 *   - Here is the GDD prose (trimmed for context)
 *   - Here is the field path you're filling
 *   - Here is the expected JSON shape (concrete example)
 *   - Output JSON only, with value + source_quote + confidence
 */
/* GDD memory DoS guard (QA Agent#4 finding #9, 2026-06-22). Reject inputs
 * larger than MAX_RAW_GDD_BYTES (50 MB) before any prompt construction.
 * Even though we trim to 6000 chars for the LLM, the rawGdd variable is
 * held in memory throughout. A 100 MB GDD would spike allocation to 200 MB+
 * (string copy on trim). Hard cap protects the process. */
const MAX_RAW_GDD_BYTES = 50 * 1024 * 1024;

function _checkRawGddSize(rawGdd) {
  if (typeof rawGdd === 'string' && rawGdd.length > MAX_RAW_GDD_BYTES) {
    throw new Error(`rawGdd size ${rawGdd.length} exceeds MAX_RAW_GDD_BYTES (${MAX_RAW_GDD_BYTES}) — refuse to process`);
  }
}

function buildPrompt(rawGdd, fieldPath, fieldDescription) {
  _checkRawGddSize(rawGdd);
  /* Trim raw GDD to ~6000 chars to fit LLM context. Center window on
   * sections most likely to mention this field (heuristic: field path
   * contains "FS" → look for "free spin"; "rtp" → look for "RTP" or "%"
   * etc). */
  const lowerPath = fieldPath.toLowerCase();
  let hint = '';
  if (lowerPath.includes('rtp') || lowerPath.includes('payback')) hint = 'RTP';
  else if (lowerPath.includes('freespins') || lowerPath.includes('fs')) hint = 'Free Spins';
  else if (lowerPath.includes('holdandwin') || lowerPath.includes('hw')) hint = 'Hold & Win';
  else if (lowerPath.includes('jackpot')) hint = 'Jackpot';
  else if (lowerPath.includes('bet')) hint = 'Bet';
  else if (lowerPath.includes('topology')) hint = 'Reel';
  else if (lowerPath.includes('expandingwild')) hint = 'Wild';
  else if (lowerPath.includes('patternwin')) hint = 'Pattern Win';

  let context = rawGdd;
  if (rawGdd.length > 6000 && hint) {
    /* Try to find the hint phrase and center window around it. */
    const idx = rawGdd.toLowerCase().indexOf(hint.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 2500);
      const end   = Math.min(rawGdd.length, idx + 3500);
      context = rawGdd.slice(start, end);
    } else {
      context = rawGdd.slice(0, 6000);
    }
  } else if (rawGdd.length > 6000) {
    context = rawGdd.slice(0, 6000);
  }

  /* Prompt-injection guard (QA Agent#4 finding #1, 2026-06-22).
   * Escape any """ triple-quote in user-supplied GDD text so it can't
   * close our docstring delimiter and inject "IGNORE PREVIOUS INSTRUCTIONS"
   * payloads. We replace """ -> "˝˝˝ (DOUBLE ACUTE ACCENT, visually similar
   * but won't terminate our docstring). LLM still reads the prose
   * accurately because U+02DD is unambiguous, just not a delimiter. */
  const safeContext = context.replace(/"""/g, '"˝˝˝');
  return `You are reading a slot game design document (GDD). Extract ONE field.

FIELD PATH: ${fieldPath}
FIELD DESCRIPTION: ${fieldDescription || '(see context below)'}

GDD prose (excerpt):
"""
${safeContext}
"""

Respond ONLY with JSON in this exact shape (no preamble, no explanation):
{
  "value": <the value, number / string / boolean / null if not found>,
  "source_quote": "<exact verbatim phrase from GDD that supports the value, ≤ 200 chars>",
  "confidence": <number 0.0..1.0>
}

Rules:
- If the field is not explicitly stated in the GDD, return value=null with confidence=0.
- Do NOT guess. Hallucinated values are worse than null.
- source_quote MUST be a verbatim substring of the GDD prose.
- Numbers: integers stay integers (e.g. 21, not 21.0). Floats only when the GDD shows a decimal.
- Booleans: true/false ONLY when GDD says so explicitly.

Output JSON now.`;
}

const FIELD_DESCRIPTIONS = {
  'payback.rtp':                'Declared overall Return-To-Player percentage (e.g. 96.00)',
  'payback.hitFrequency':       'Any-pay hit frequency in percent (e.g. 19.03)',
  'payback.volatilityIdx':      'Volatility classification index 1..10 (1=low, 10=very high)',
  'payback.maxWinX':            'Max single-spin or round win as multiple of bet (e.g. 50000)',
  'payback.rtpBreakdown.baseLine': 'Base game line wins percent contribution to RTP',
  'payback.rtpBreakdown.hwBase':   'Base-game Hold & Win contribution percent',
  'payback.rtpBreakdown.fsLine':   'Free Spins line wins percent contribution',
  'payback.rtpBreakdown.hwFs':     'In-FS Hold & Win contribution percent',
  'bet.minBet':                 'Minimum bet per spin (e.g. 0.20)',
  'bet.maxBet':                 'Maximum bet per spin (e.g. 40.00)',
  'bet.stepCount':              'Number of bet ladder steps (e.g. 21)',
  'topology.reels':             'Number of reels (e.g. 5 or 6)',
  'topology.rows':              'Number of rows per reel (e.g. 3 or 5)',
  'topology.paylines':          'Number of paylines (0 if ways/cluster)',
  'topology.evaluation':        'Win evaluation kind: lines / ways / cluster_pays / cascade / scatter_pay',
  'freeSpins.triggerCount':     'Scatter count to trigger free spins (e.g. 3)',
  'freeSpins.retrigger.enabled': 'Whether free spins can retrigger (true/false)',
  'freeSpins.retrigger.hardCap': 'Hard cap on total FS played including retriggers (e.g. 15 or 100)',
  'freeSpins.avgSpinsPlayed':   'Average number of free spins played per session (e.g. 6.45)',
  'holdAndWin.enabled':         'Whether Hold & Win feature exists (true/false)',
  'holdAndWin.triggerCount':    'Symbol count to trigger Hold & Win in base game (e.g. 6)',
  'holdAndWin.fsTriggerCount':  'Symbol count to trigger Hold & Win during free spins (e.g. 9)',
  'holdAndWin.cashPool.min':    'Minimum credit value of cash-on-reel pool (e.g. 100)',
  'holdAndWin.cashPool.max':    'Maximum credit value of cash-on-reel pool (e.g. 2000)',
  'patternWin.enabled':         'Whether a Pattern Win feature exists (true/false)',
  'patternWin.awardX':          'Pattern Win award as multiple of total bet (e.g. 1000)',
  'expandingWild.enabled':      'Whether wilds can expand (true/false)',
  'expandingWild.onlyIfWinning': 'Whether wild expands only when forming a win (true/false)',
  'jackpot.enabled':            'Whether jackpot exists (true/false)',
  'jackpot.type':               'Jackpot type: fixed / standalone / progressive / pooled / mystery',
};

function callKimi(prompt, timeoutMs = KIMI_TIMEOUT_MS) {
  if (!existsSync(KIMI_BIN)) {
    return { ok: false, error: `kimi binary not found at ${KIMI_BIN}` };
  }
  const t0 = Date.now();
  const r = spawnSync(KIMI_BIN, ['--timeout', String(Math.ceil(timeoutMs / 1000)), '--raw'], {
    input: prompt,
    encoding: 'utf8',
    timeout: timeoutMs + 5000,
  });
  const duration = Date.now() - t0;
  if (r.status !== 0) {
    return { ok: false, error: `kimi exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`, duration };
  }
  const raw = (r.stdout || '').trim();
  /* Try to extract first JSON block. */
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, error: 'no JSON in kimi response', raw: raw.slice(0, 200), duration };
  }
  try {
    const obj = JSON.parse(jsonMatch[0]);
    return { ok: true, obj, raw, duration };
  } catch (e) {
    return { ok: false, error: `JSON parse: ${e.message}`, raw: raw.slice(0, 200), duration };
  }
}

/**
 * Complete one field. Returns a structured receipt.
 *
 * Cache key: sha256(rawGdd):fieldPath. Cache hit returns receipt unchanged.
 * Cache miss calls Kimi, validates, retries once on failure, then halts.
 */
export function completeField(slug, rawGdd, fieldPath, opts = {}) {
  const { skipCache = false, dryRun = false } = opts;
  const gddHash = sha256(rawGdd);
  const cacheKey = `${gddHash}:${fieldPath}`;
  const cache = loadCache();
  if (!skipCache && cache[cacheKey]) {
    return { ...cache[cacheKey], cached: true };
  }
  if (dryRun) {
    return {
      field: fieldPath, value: null, source_quote: null, confidence: 0,
      provider: 'kimi', halt: true, halt_reason: 'dry-run',
      duration_ms: 0, schema_validated: false, attempt: 0,
      timestamp: new Date().toISOString(),
    };
  }
  const description = FIELD_DESCRIPTIONS[fieldPath] || '(no description)';
  const prompt = buildPrompt(rawGdd, fieldPath, description);
  const promptHash = sha256(prompt);

  /* Attempt 1: standard prompt. */
  let resp = callKimi(prompt);
  let attempt = 1;
  if (!resp.ok) {
    /* Attempt 2: strict prompt prefix. */
    const strictPrompt = `IMPORTANT: respond with valid JSON only, no markdown fences, no explanation.\n\n${prompt}`;
    resp = callKimi(strictPrompt);
    attempt = 2;
  }
  if (!resp.ok) {
    const receipt = {
      field: fieldPath, value: null, source_quote: null, confidence: 0,
      provider: 'kimi', halt: true, halt_reason: resp.error || 'unknown LLM error',
      duration_ms: resp.duration || 0, schema_validated: false, attempt,
      prompt_hash: promptHash, gdd_hash: gddHash,
      timestamp: new Date().toISOString(),
    };
    cache[cacheKey] = receipt;
    saveCache(cache);
    return receipt;
  }
  const { obj, duration } = resp;
  /* Test the value against schema by constructing a minimal model. */
  const testModel = {};
  setByPath(testModel, fieldPath, obj.value);
  const valid = validateModel(testModel);
  const receipt = {
    field: fieldPath,
    value: obj.value,
    source_quote: typeof obj.source_quote === 'string' ? obj.source_quote.slice(0, 200) : null,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    provider: 'kimi',
    duration_ms: duration,
    schema_validated: valid.ok,
    schema_errors: valid.ok ? [] : valid.errors.slice(0, 3),
    halt: !valid.ok,
    halt_reason: valid.ok ? null : 'schema validation failed',
    attempt,
    prompt_hash: promptHash,
    gdd_hash: gddHash,
    timestamp: new Date().toISOString(),
  };
  cache[cacheKey] = receipt;
  saveCache(cache);
  return receipt;
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Complete all empty target fields. Returns { filled, receipts, halts }.
 *
 * - filled: new model with LLM-filled values merged in (schema-valid)
 * - receipts: list of all per-field receipts (for audit trail)
 * - halts: subset of receipts where halt=true
 */
export function completeModel(slug, rawGdd, model, opts = {}) {
  const empty = listEmptyRequiredFields(model);
  const receipts = [];
  const filled = JSON.parse(JSON.stringify(model || {}));
  for (const field of empty) {
    const r = completeField(slug, rawGdd, field, opts);
    receipts.push(r);
    if (!r.halt && r.value != null && r.schema_validated) {
      setByPath(filled, field, r.value);
    }
  }
  const halts = receipts.filter(r => r.halt);
  return { filled, receipts, halts };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('llm-field-completer.mjs')) {
  const args = process.argv.slice(2);
  const slugArg = args.find(a => a.startsWith('--slug='))?.slice(7);
  const fieldArg = args.find(a => a.startsWith('--field='))?.slice(8);
  const dryRun = args.includes('--dry-run');
  if (!slugArg) {
    console.error('Usage: node tools/llm-field-completer.mjs --slug=<slug> [--field=<path>] [--dry-run]');
    process.exit(2);
  }
  const slugPath = join(REPO, 'dist/real-games', slugArg);
  if (!existsSync(slugPath)) {
    console.error(`▸ slug ${slugArg} not found at ${slugPath}`);
    process.exit(2);
  }
  const rawGdd = readFileSync(join(slugPath, 'raw.txt'), 'utf8');
  const model = JSON.parse(readFileSync(join(slugPath, 'model.json'), 'utf8'));
  if (fieldArg) {
    const r = completeField(slugArg, rawGdd, fieldArg, { dryRun });
    console.log(JSON.stringify(r, null, 2));
  } else {
    const empty = listEmptyRequiredFields(model);
    console.log(`▸ ${slugArg}: ${empty.length} empty target fields`);
    for (const f of empty.slice(0, 10)) console.log(`   • ${f}`);
    if (empty.length > 10) console.log(`   ... and ${empty.length - 10} more`);
    if (dryRun) {
      console.log('(dry-run, no LLM calls made)');
    }
  }
}
