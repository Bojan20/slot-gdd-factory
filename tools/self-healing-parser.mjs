#!/usr/bin/env node
/**
 * tools/self-healing-parser.mjs
 *
 * N+2 E (2026-06-23) — GDD-level self-healing parser.
 *
 * Purpose
 *   When the deterministic parser produces a model with catastrophic
 *   gaps (missing topology / missing paytable / confidence collapse),
 *   this orchestrator generates a structured fix prompt, calls an LLM
 *   to repair the model, validates the patch, and merges it back. The
 *   operator never sees a hard pipeline failure — the receipt carries
 *   `__healing__` provenance so audit trails know which fields were
 *   LLM-supplied versus parser-derived.
 *
 * Difference vs HYB-2 (llm-field-completer)
 *   - HYB-2: field-by-field completion AFTER parser. Targets known
 *     missing leaf fields (e.g. `freeSpins.retrigger.hardCap`).
 *   - E atom: GDD-level healing. Triggers BEFORE the operator gives
 *     up. Targets architectural gaps (missing topology kind, missing
 *     paytable rows entirely, confidence < 0.5 on the FOUR pillar
 *     fields). Generates structured prompt asking the LLM to read raw
 *     GDD text and emit canonical fields the parser couldn't.
 *
 * Architecture
 *   diagnoseModel(model)
 *     → { severity, criticalGaps, missingTopology, missingPaytable,
 *         missingSymbols, missingFeatures, pillarConfidence,
 *         actionable }
 *
 *   buildFixPrompt(rawText, model, diagnosis)
 *     → structured prompt string (raw GDD slice + missing field list +
 *       schema hints, schema-grounded JSON output target)
 *
 *   applyPatch(model, llmPatch)
 *     → mutated model copy + receipt of which fields were patched
 *
 *   healModel(rawText, model, opts)
 *     → max-attempt loop. Returns { ok, model, receipt }
 *
 * Cost gate
 *   maxAttempts: 3 (default). Each call budgets ~$0.03–0.05 → $0.15
 *   ceiling per ingest. Operator can override via opts.maxAttempts.
 *
 * Provider strategy
 *   Default: cortex-kimi-ask wrapper (fastest, $0.001–0.005/call).
 *   Fallback: cortex-fable-ask (Anthropic Opus via Fable, $0.05/call).
 *   Tertiary: no-op skip (returns ok:false with reason).
 *   Override via opts.healerFn for tests + alternate providers.
 *
 * Anti-runaway
 *   Linear loop, NOT recursive. Each attempt has a fixed 30s timeout.
 *   Total budget: 3 × 30s = 90s wall-clock max. Pipeline can break
 *   early if severity already dropped below CRITICAL.
 *
 * HARD RULE #1 (vendor-neutral)
 *   Prompts NEVER include vendor product names. Raw GDD slice is
 *   passed verbatim (operator already validated path), but LLM is
 *   instructed: "this is a slot GDD; emit canonical fields only".
 *
 * Public API (named exports, ES modules)
 *   - diagnoseModel(model) -> Diagnosis
 *   - buildFixPrompt(rawText, model, diagnosis) -> string
 *   - applyPatch(model, llmPatch) -> { model, applied }
 *   - healModel(rawText, model, opts) -> Promise<HealResult>
 *
 * Diagnosis = {
 *   severity:        'CLEAN' | 'WARN' | 'CRITICAL' | 'CATASTROPHIC'
 *   criticalGaps:    string[]           // human-readable field gaps
 *   missingTopology: boolean
 *   missingPaytable: boolean
 *   missingSymbols:  boolean
 *   missingFeatures: boolean
 *   pillarConfidence: { name, topology, symbols, features }
 *   actionable:      boolean             // healer should try
 * }
 *
 * HealResult = {
 *   ok:              boolean
 *   skipped?:        boolean             // healer unavailable / disabled
 *   reason?:         string
 *   attempts:        number
 *   model:           object               // post-healing model
 *   receipt:         {
 *     attempts: [{ attempt, severityBefore, severityAfter,
 *                  patchKeys, error?, durationMs, provider }],
 *     totalDurationMs: number,
 *     fieldsRepaired:  string[],
 *     llmProvider:     string,
 *     costEstimateUsd: number,
 *     finalSeverity:   string,
 *   }
 * }
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = resolve(__filename, '..');
const REPO       = resolve(__dirname, '..');

/* ── thresholds ──────────────────────────────────────────────────────── */

/* Pillar fields the parser MUST extract for a slot model to be playable. */
const PILLAR_FIELDS = ['name', 'topology', 'symbols', 'features'];

/* Per-pillar confidence floor; below this we consider the field unreliable. */
const CONFIDENCE_FLOOR = 0.5;

/* Healing trigger thresholds. */
const SEVERITY_LEVELS = ['CLEAN', 'WARN', 'CRITICAL', 'CATASTROPHIC'];

/* Max attempts default (cost gate). */
const DEFAULT_MAX_ATTEMPTS = 3;

/* Per-call timeout (ms). */
const DEFAULT_HEALER_TIMEOUT_MS = 30_000;

/* Estimated $ per healer call (Kimi default). Adjusted per provider. */
const COST_ESTIMATES_USD = {
  'cortex-kimi-ask':  0.003,
  'cortex-fable-ask': 0.05,
  'mock':             0,
  'unknown':          0.01,
};

/* H-3 audit fix: hard cost ceiling per healModel invocation. Sprečava
 * runaway kad operator postavi maxAttempts=10 i provider je skup. Default
 * = $0.15 (3 × $0.05 fable cap). Override via opts.costCeilingUsd. */
const DEFAULT_COST_CEILING_USD = 0.15;

/* ── diagnose ────────────────────────────────────────────────────────── */

/**
 * Inspect a parser model and emit a structured diagnosis.
 * Pure function — never throws (even on null model).
 *
 * @param {object} model
 * @returns {Diagnosis}
 */
export function diagnoseModel(model) {
  const empty = {
    severity: 'CATASTROPHIC',
    criticalGaps: ['model is null/undefined'],
    missingTopology: true,
    missingPaytable: true,
    missingSymbols: true,
    missingFeatures: true,
    pillarConfidence: { name: 0, topology: 0, symbols: 0, features: 0 },
    actionable: true,
  };
  if (!model || typeof model !== 'object') return empty;

  const conf = (model.confidence && typeof model.confidence === 'object')
    ? model.confidence : {};
  /* M-1 audit fix: Number.isFinite guard collapses Infinity (and NaN) → 0.
   * Without this, adversarial GDD with confidence.topology = Infinity
   * passes the floor check (Infinity < 0.5 = false) and masks real gaps. */
  const safeConf = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const pillarConfidence = {
    name:     safeConf(conf.name),
    topology: safeConf(conf.topology),
    symbols:  safeConf(conf.symbols),
    features: safeConf(conf.features),
  };

  /* Structural gap detection — independent of confidence scores. */
  const missingTopology =
    !model.topology ||
    typeof model.topology !== 'object' ||
    !model.topology.kind ||
    !model.topology.reels ||
    !model.topology.rows;
  const symCount =
    ((model.symbols && model.symbols.high)     || []).length +
    ((model.symbols && model.symbols.mid)      || []).length +
    ((model.symbols && model.symbols.low)      || []).length +
    ((model.symbols && model.symbols.specials) || []).length;
  const missingSymbols = symCount < 3;
  const missingFeatures = !Array.isArray(model.features) || model.features.length === 0;
  /* Paytable check: either symbol.pay OR top-level paytable. */
  const hasSymbolPay = symCount > 0 && !!(
    (model.symbols && model.symbols.high && model.symbols.high.some(s => s.pay)) ||
    (model.symbols && model.symbols.mid  && model.symbols.mid.some(s => s.pay))
  );
  const hasPaytableRows = Array.isArray(model.paytable) && model.paytable.length > 0;
  const missingPaytable = !hasSymbolPay && !hasPaytableRows;

  const criticalGaps = [];
  if (missingTopology) criticalGaps.push('topology (kind / reels / rows)');
  if (missingPaytable) criticalGaps.push('paytable (no symbol.pay and no top-level paytable rows)');
  if (missingSymbols)  criticalGaps.push(`symbols (only ${symCount} found, need ≥ 3)`);
  if (missingFeatures) criticalGaps.push('features (empty list)');
  for (const p of PILLAR_FIELDS) {
    if (pillarConfidence[p] < CONFIDENCE_FLOOR) {
      criticalGaps.push(`pillar confidence ${p} = ${pillarConfidence[p].toFixed(2)} < ${CONFIDENCE_FLOOR}`);
    }
  }

  /* Severity ladder. */
  let severity = 'CLEAN';
  const hardGaps = [missingTopology, missingPaytable, missingSymbols].filter(Boolean).length;
  const confFloorBreaches = PILLAR_FIELDS.filter(p => pillarConfidence[p] < CONFIDENCE_FLOOR).length;
  if (hardGaps >= 2 || (hardGaps >= 1 && confFloorBreaches >= 3)) {
    severity = 'CATASTROPHIC';
  } else if (hardGaps >= 1 || confFloorBreaches >= 2) {
    severity = 'CRITICAL';
  } else if (confFloorBreaches >= 1 || missingFeatures) {
    severity = 'WARN';
  }

  const actionable = severity === 'CRITICAL' || severity === 'CATASTROPHIC';

  return {
    severity,
    criticalGaps,
    missingTopology,
    missingPaytable,
    missingSymbols,
    missingFeatures,
    pillarConfidence,
    actionable,
  };
}

/* ── fix prompt builder ──────────────────────────────────────────────── */

/**
 * Build a structured fix prompt the LLM healer can consume.
 *
 * Prompt template (vendor-neutral):
 *
 *   "You are a slot GDD parser. The deterministic parser produced this
 *   partial model:\n\n  <model JSON>\n\nGaps identified:\n  - <gap1>\n
 *    ...\n\nRaw GDD source (slot of up to 8000 chars):\n  <raw slice>\n\n
 *   Emit JSON with ONLY the missing fields filled. Use canonical schema:
 *     topology: { kind, reels, rows, paylines }
 *     symbols:  { high, mid, low, specials }
 *     features: [ { kind, params? } ]
 *     paytable: [ { symbolId, combos: { '3': pay, '4': pay, '5': pay } } ]
 *   Do not include any vendor product names. Output JSON only."
 *
 * @param {string} rawText
 * @param {object} model
 * @param {Diagnosis} diagnosis
 * @returns {string}
 */
export function buildFixPrompt(rawText, model, diagnosis) {
  const rawSlice = String(rawText || '').slice(0, 8000);
  const modelSnippet = JSON.stringify({
    name: model?.name,
    topology: model?.topology,
    symbolCounts: {
      high:     ((model?.symbols?.high)     || []).length,
      mid:      ((model?.symbols?.mid)      || []).length,
      low:      ((model?.symbols?.low)      || []).length,
      specials: ((model?.symbols?.specials) || []).length,
    },
    featureCount: ((model?.features) || []).length,
    paytableRows: ((model?.paytable) || []).length,
    pillarConfidence: diagnosis.pillarConfidence,
  }, null, 2);

  const gapList = diagnosis.criticalGaps.map(g => `  - ${g}`).join('\n');

  return [
    'You are a slot GDD parser. The deterministic parser produced this partial model:',
    '',
    modelSnippet,
    '',
    `Severity: ${diagnosis.severity}`,
    'Gaps identified:',
    gapList,
    '',
    'Raw GDD source (first 8000 chars):',
    '```',
    rawSlice,
    '```',
    '',
    'Emit JSON with ONLY the missing fields filled. Use the canonical schema:',
    '  topology: { kind: "rectangular"|"cluster"|"tumble"|"megaways", reels: int, rows: int, paylines: int }',
    '  symbols:  { high: [{id,label,pay:{"3":n,"4":n,"5":n}}], mid: [...], low: [...], specials: [{id,label,kind}] }',
    '  features: [ { kind: "free_spins"|"wild"|"scatter"|..., params?: {...} } ]',
    '  paytable: [ { symbolId, combos: { "3": n, "4": n, "5": n } } ]',
    '',
    'Hard constraints:',
    '  - DO NOT include any vendor product names (no Eldritch, Wrath, Crystal Forge ADB, etc.)',
    '  - Emit ONE JSON object, no prose, no markdown fences',
    '  - Use the EXACT field names from the schema above',
    '  - If a field cannot be inferred from the raw text, omit it (do not invent)',
  ].join('\n');
}

/* ── patch application ───────────────────────────────────────────────── */

const PATCHABLE_TOP_FIELDS = new Set([
  'name', 'topology', 'symbols', 'features', 'paytable',
  'rtp', 'volatility', 'maxWin', 'compliance', 'math',
]);

/**
 * Merge an LLM patch into the model. Only ACCEPTED whitelist of top-level
 * fields can be patched; everything else is discarded with a warning.
 *
 * Pure: clones the model first.
 *
 * @param {object} model
 * @param {object} llmPatch
 * @returns {{ model: object, applied: { patchedKeys: string[], rejectedKeys: string[], warnings: string[] } }}
 */
export function applyPatch(model, llmPatch) {
  if (!model || typeof model !== 'object') {
    throw new Error('applyPatch: model required');
  }
  if (!llmPatch || typeof llmPatch !== 'object' || Array.isArray(llmPatch)) {
    return {
      model: structuredClone(model),
      applied: { patchedKeys: [], rejectedKeys: [], warnings: ['llmPatch is null/array/non-object'] },
    };
  }

  const next = structuredClone(model);
  const patchedKeys = [];
  const rejectedKeys = [];
  const warnings = [];

  for (const [k, v] of Object.entries(llmPatch)) {
    /* Block prototype pollution + non-whitelisted keys. */
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      rejectedKeys.push(k);
      warnings.push(`refused proto-pollution key: ${k}`);
      continue;
    }
    if (!PATCHABLE_TOP_FIELDS.has(k)) {
      rejectedKeys.push(k);
      continue;
    }
    /* Conservative: only fill EMPTY parser fields; never overwrite
     * what parser already extracted. Healing is additive, not
     * destructive. */
    const cur = next[k];
    const isEmpty =
      cur === undefined ||
      cur === null ||
      (typeof cur === 'object' && !Array.isArray(cur) && Object.keys(cur).length === 0) ||
      (Array.isArray(cur) && cur.length === 0);
    if (!isEmpty) {
      warnings.push(`skipped ${k}: parser already extracted (not overwriting)`);
      continue;
    }
    next[k] = v;
    patchedKeys.push(k);
  }

  /* Stamp healing provenance + bump pillar confidence for patched fields.
   *
   * Without the confidence bump, diagnoseModel would still see
   * pillarConfidence.<field> = 0 (parser-original) even after the
   * structural gap is filled, leaving severity stuck at CRITICAL
   * forever. Healed fields land at 0.7 (clear of CONFIDENCE_FLOOR=0.5
   * but lower than parser's typical 0.9 to flag LLM provenance).
   *
   * H-1 audit fix: DETERMINISTIC provenance stamp. Previously used
   * `new Date().toISOString()` which made two ingests of identical
   * input produce different `model.json` bytes — same anti-pattern
   * UQ-DEEP-A killed in v8.__meta__.ts. Now we use a content-derived
   * stamp (sha-1 of patch keys + content) so idempotent re-runs match. */
  if (patchedKeys.length > 0) {
    next.confidence = next.confidence || {};
    next.confidence._healedBy = next.confidence._healedBy || {};
    /* Deterministic stamp: sha-1 of sorted patch keys + JSON content. */
    const provenanceStamp = (() => {
      const payload = JSON.stringify({
        keys: [...patchedKeys].sort(),
        content: llmPatch,
      });
      let h = 0;
      for (let i = 0; i < payload.length; i++) {
        h = ((h << 5) - h) + payload.charCodeAt(i);
        h |= 0; /* int32 */
      }
      return ('00000000' + (h >>> 0).toString(16)).slice(-8);
    })();
    for (const k of patchedKeys) {
      next.confidence._healedBy[k] = {
        source: 'self-healing-parser',
        contentStamp: provenanceStamp,
      };
      /* Pillar confidence bump for the 4 PILLAR_FIELDS. */
      if (k === 'name' || k === 'topology' || k === 'symbols' || k === 'features') {
        const cur = Number(next.confidence[k]) || 0;
        if (cur < 0.7) next.confidence[k] = 0.7;
      }
    }
  }

  return { model: next, applied: { patchedKeys, rejectedKeys, warnings } };
}

/* ── default healer (Kimi via cortex-kimi-ask) ───────────────────────── */

/**
 * Default healer: call cortex-kimi-ask binary with the fix prompt.
 * Returns { ok, patch, error, durationMs, provider }.
 *
 * NEVER throws — error paths return { ok: false, error }.
 *
 * @param {string} prompt
 * @param {object} opts
 * @returns {Promise<{ok:boolean, patch?:object, error?:string, durationMs:number, provider:string}>}
 */
async function defaultHealer(prompt, opts = {}) {
  const provider = 'cortex-kimi-ask';
  const bin = resolve(process.env.HOME || '/tmp', 'Projects/cortex/scripts/cortex-kimi-ask');
  const t0 = Date.now();
  if (!existsSync(bin)) {
    return { ok: false, error: 'cortex-kimi-ask binary not found', durationMs: 0, provider };
  }
  const timeoutMs = opts.timeoutMs || DEFAULT_HEALER_TIMEOUT_MS;
  let r;
  try {
    r = spawnSync(bin, ['--max-tokens', '2000', '--quiet'], {
      input: prompt,
      encoding: 'utf8',
      timeout: timeoutMs,
    });
  } catch (e) {
    return { ok: false, error: `spawn threw: ${e.message}`, durationMs: Date.now() - t0, provider };
  }
  const durationMs = Date.now() - t0;
  if (r.status !== 0) {
    return { ok: false, error: `exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`, durationMs, provider };
  }
  /* Extract first JSON object from stdout. */
  const out = String(r.stdout || '').trim();
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) {
    return { ok: false, error: 'no JSON object in healer output', durationMs, provider };
  }
  let patch;
  try { patch = JSON.parse(m[0]); }
  catch (e) {
    return { ok: false, error: `patch JSON parse: ${e.message}`, durationMs, provider };
  }
  return { ok: true, patch, durationMs, provider };
}

/* ── heal orchestrator ───────────────────────────────────────────────── */

function severityIndex(sev) {
  const idx = SEVERITY_LEVELS.indexOf(sev);
  /* L-5 audit fix: unknown severity → return WORST INDEX (not 0).
   * Previously returned 0 (CLEAN) so a future diagnose returning
   * 'UNKNOWN' would silently break the loop with success status. */
  return idx === -1 ? SEVERITY_LEVELS.length : idx;
}

/**
 * Heal a parser model by iterating an LLM fix loop.
 * Linear loop, max-attempt cap, cost-gated.
 *
 * @param {string} rawText           raw GDD text
 * @param {object} model             parser output
 * @param {object} [opts]
 *   - maxAttempts:  default 3
 *   - timeoutMs:    per-call default 30_000
 *   - healerFn:     async (prompt, opts) -> { ok, patch, error, durationMs, provider }
 *   - confidenceTarget: severity index target (default CLEAN/WARN — index ≤ 1)
 * @returns {Promise<HealResult>}
 */
export async function healModel(rawText, model, opts = {}) {
  const maxAttempts = Math.max(1, Math.min(10, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const healerFn = typeof opts.healerFn === 'function' ? opts.healerFn : defaultHealer;
  const confidenceTarget = opts.confidenceTarget ?? 1; /* WARN or below */
  /* H-3 audit fix: hard cost ceiling per invocation. */
  const costCeilingUsd = Number.isFinite(opts.costCeilingUsd) && opts.costCeilingUsd > 0
    ? opts.costCeilingUsd : DEFAULT_COST_CEILING_USD;
  const totalT0 = Date.now();

  let currentModel = structuredClone(model);
  const attemptsLog = [];
  let lastProvider = 'unknown';
  let totalCostUsd = 0;

  /* Initial diagnosis — if not actionable, skip without calling LLM. */
  const initial = diagnoseModel(currentModel);
  if (!initial.actionable) {
    return {
      ok: true,
      skipped: true,
      reason: `severity=${initial.severity} not actionable (no healing needed)`,
      attempts: 0,
      model: currentModel,
      receipt: {
        attempts: [],
        totalDurationMs: 0,
        fieldsRepaired: [],
        llmProvider: 'none',
        costEstimateUsd: 0,
        finalSeverity: initial.severity,
        initialSeverity: initial.severity,
      },
    };
  }

  const fieldsRepairedAll = new Set();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const diag = diagnoseModel(currentModel);
    const severityBefore = diag.severity;

    /* Early exit if already at target. */
    if (severityIndex(diag.severity) <= confidenceTarget) {
      break;
    }

    const prompt = buildFixPrompt(rawText, currentModel, diag);
    let healerResp;
    try {
      healerResp = await healerFn(prompt, { timeoutMs: opts.timeoutMs });
    } catch (e) {
      healerResp = { ok: false, error: `healer threw: ${e.message}`, durationMs: 0, provider: 'unknown' };
    }
    lastProvider = healerResp.provider || 'unknown';
    totalCostUsd += COST_ESTIMATES_USD[lastProvider] || COST_ESTIMATES_USD.unknown;
    /* H-3 enforcement: break if cost ceiling crossed. Last attempt is
     * counted (we already paid for it) but no further attempts allowed. */
    const ceilingBreached = totalCostUsd >= costCeilingUsd;

    if (!healerResp.ok) {
      attemptsLog.push({
        attempt,
        severityBefore,
        severityAfter: severityBefore,
        patchKeys: [],
        error: healerResp.error,
        durationMs: healerResp.durationMs || 0,
        provider: lastProvider,
      });
      /* Provider unavailable on first attempt → skip rest (no retries
       * help when binary missing). */
      if (attempt === 1 && /not found|spawn threw/i.test(healerResp.error || '')) {
        return {
          ok: false,
          skipped: true,
          reason: healerResp.error,
          attempts: attempt,
          model: currentModel,
          receipt: {
            attempts: attemptsLog,
            totalDurationMs: Date.now() - totalT0,
            fieldsRepaired: [],
            llmProvider: lastProvider,
            costEstimateUsd: 0,
            finalSeverity: severityBefore,
            initialSeverity: initial.severity,
          },
        };
      }
      /* H-3: ceiling check also when healer fails (we still paid). */
      if (ceilingBreached) {
        attemptsLog.push({
          attempt: attempt + 1,
          severityBefore,
          severityAfter: severityBefore,
          patchKeys: [],
          error: `cost ceiling reached ($${totalCostUsd.toFixed(4)} ≥ $${costCeilingUsd.toFixed(4)})`,
          durationMs: 0,
          provider: lastProvider,
        });
        break;
      }
      continue;
    }

    /* Apply patch. */
    let patchResult;
    try {
      patchResult = applyPatch(currentModel, healerResp.patch);
    } catch (e) {
      attemptsLog.push({
        attempt, severityBefore, severityAfter: severityBefore,
        patchKeys: [], error: `applyPatch threw: ${e.message}`,
        durationMs: healerResp.durationMs, provider: lastProvider,
      });
      continue;
    }
    currentModel = patchResult.model;
    for (const k of patchResult.applied.patchedKeys) fieldsRepairedAll.add(k);

    const diagAfter = diagnoseModel(currentModel);
    attemptsLog.push({
      attempt,
      severityBefore,
      severityAfter: diagAfter.severity,
      patchKeys: patchResult.applied.patchedKeys,
      durationMs: healerResp.durationMs,
      provider: lastProvider,
    });

    if (severityIndex(diagAfter.severity) <= confidenceTarget) {
      break;
    }
    /* H-3: stop after applying patch when ceiling crossed. */
    if (ceilingBreached) {
      attemptsLog.push({
        attempt: attempt + 1,
        severityBefore: diagAfter.severity,
        severityAfter: diagAfter.severity,
        patchKeys: [],
        error: `cost ceiling reached ($${totalCostUsd.toFixed(4)} ≥ $${costCeilingUsd.toFixed(4)})`,
        durationMs: 0,
        provider: lastProvider,
      });
      break;
    }
  }

  const finalDiag = diagnoseModel(currentModel);
  return {
    ok: severityIndex(finalDiag.severity) <= confidenceTarget,
    attempts: attemptsLog.length,
    model: currentModel,
    receipt: {
      attempts: attemptsLog,
      totalDurationMs: Date.now() - totalT0,
      fieldsRepaired: Array.from(fieldsRepairedAll),
      llmProvider: lastProvider,
      costEstimateUsd: totalCostUsd,
      finalSeverity: finalDiag.severity,
      initialSeverity: initial.severity,
    },
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('self-healing-parser.mjs')) {
  const { readFileSync } = await import('node:fs');
  const args = process.argv.slice(2);
  const modelPath = args.find(a => a.startsWith('--model='))?.slice(8);
  const rawPath   = args.find(a => a.startsWith('--raw='))?.slice(6);
  const diagOnly  = args.includes('--diagnose-only');
  if (!modelPath) {
    console.error('Usage: node tools/self-healing-parser.mjs --model=PATH [--raw=PATH] [--diagnose-only]');
    process.exit(2);
  }
  if (!existsSync(modelPath)) { console.error(`model missing: ${modelPath}`); process.exit(1); }
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  if (diagOnly) {
    console.log(JSON.stringify(diagnoseModel(model), null, 2));
    process.exit(0);
  }
  const raw = rawPath && existsSync(rawPath) ? readFileSync(rawPath, 'utf8') : '';
  const r = await healModel(raw, model, {});
  console.log(JSON.stringify(r.receipt, null, 2));
  process.exit(r.ok ? 0 : (r.skipped ? 0 : 1));
}
