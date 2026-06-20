#!/usr/bin/env node
/**
 * tools/_wave-v-multi-agent-parser.mjs
 *
 * Wave V — Multi-agent GDD parser (Boki 2026-06-20 "univerzal", "dalje3").
 *
 * Why
 * ---
 * The single-pass regex parser (`src/parser.mjs`) achieves a 6% "declared"
 * ratio on real GDDs after WAVE U keyword pattern strengthening. The rest
 * is `inferred` (smart defaults) and `default` (block-baked fallbacks).
 *
 * Wave V raises the declared ratio to ≥ 80% on baseline GDDs by spawning
 * 5 lane-specialised LLM agents that read the same GDD from different
 * angles, plus a 6th reconcile agent that merges and arbitrates.
 *
 * Architecture
 * ------------
 *   V1 Topology    →  model.topology delta + evidence
 *   V2 Symbols     →  model.symbols + scatter + wild delta
 *   V3 Feature     →  model.features[] section-anchored
 *   V4 UX          →  model.theme / hud / animation
 *   V5 Compliance  →  model.payback / compliance / cert
 *   V6 Reconcile   →  sparse model_delta + __meta__ provenance + scorecard
 *
 * Wire
 * ----
 * Each V-agent prompt lives in `agents/parser-pool/V<n>_<NAME>.md` —
 * dispatched via `~/Projects/cortex/scripts/cortex-claude-ask` (Claude
 * canonical entry point). V1..V5 fire in parallel; V6 runs after.
 *
 * Output
 * ------
 *   <out>/<gdd-slug>/v1_topology.json   (raw V1 response)
 *   <out>/<gdd-slug>/v2_symbols.json
 *   <out>/<gdd-slug>/v3_feature.json
 *   <out>/<gdd-slug>/v4_ux.json
 *   <out>/<gdd-slug>/v5_compliance.json
 *   <out>/<gdd-slug>/v6_reconcile.json  (the FINAL delta + __meta__)
 *   <out>/<gdd-slug>/scorecard.json     (declared ratio + conflicts)
 *
 * Integration
 * -----------
 * `src/parser.mjs` will read `v6_reconcile.json` and merge into the model
 * as a SECOND pass — but only when `WAVE_V_RECONCILE_PATH` env var is set
 * (opt-in, no behavior change for existing flows).
 *
 * CLI
 * ---
 *   node tools/_wave-v-multi-agent-parser.mjs \
 *        --gdd ~/Desktop/GDD/Gates_of_Olympus_1000_GDD.pdf \
 *        --out tools/_eyes/wave-v
 *
 *   node tools/_wave-v-multi-agent-parser.mjs --all  (4 baseline GDDs)
 *
 * Honest scope
 * ------------
 * This is the MVP scaffolding. It spawns the 6 agents and writes the
 * reports. Integration into the runtime build pipeline is a follow-up
 * atom — gated behind `WAVE_V_ENABLED=1`.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO      = resolve(__dirname, '..');
const POOL_DIR  = resolve(REPO, 'agents/parser-pool');
const ASK_BIN   = process.env.CORTEX_CLAUDE_ASK ||
                  resolve(process.env.HOME, 'Projects/cortex/scripts/cortex-claude-ask');

const BASELINE_GDDS = [
  resolve(process.env.HOME, 'Desktop/GDD/Cash_Eruption_Foundry_GDD.pdf'),
  resolve(process.env.HOME, 'Desktop/GDD/Gates_of_Olympus_1000_GDD.pdf'),
  resolve(process.env.HOME, 'Desktop/GDD/Huff_N_More_Puff_GDD.pdf'),
  resolve(process.env.HOME, 'Desktop/GDD/Starlight_Travellers_GDD.pdf'),
  resolve(process.env.HOME, 'Desktop/GDD/Wrath_of_Olympus_GDD.pdf'),
];

const AGENTS = [
  { id: 'V1', file: 'V1_TOPOLOGY.md',   key: 'v1_topology'   },
  { id: 'V2', file: 'V2_SYMBOLS.md',    key: 'v2_symbols'    },
  { id: 'V3', file: 'V3_FEATURE.md',    key: 'v3_feature'    },
  { id: 'V4', file: 'V4_UX.md',         key: 'v4_ux'         },
  { id: 'V5', file: 'V5_COMPLIANCE.md', key: 'v5_compliance' },
];

const RECONCILE_AGENT = { id: 'V6', file: 'V6_RECONCILE.md', key: 'v6_reconcile' };

/* ── helpers ──────────────────────────────────────────────────────────── */

function _slug(p) {
  return basename(p).replace(/_GDD\.(pdf|md|json)$/i, '').toLowerCase();
}

async function _readPrompt(file) {
  return readFile(resolve(POOL_DIR, file), 'utf8');
}

async function _gddToText(gddPath) {
  if (gddPath.endsWith('.md') || gddPath.endsWith('.txt')) {
    return readFile(gddPath, 'utf8');
  }
  /* PDF → text via pdftotext if available, else fall back to pdfToMarkdown */
  const text = await _runPdfToText(gddPath).catch(() => null);
  if (text && text.length > 200) return text;
  /* Fallback: import pdfToMarkdown */
  const { pdfToMarkdown } = await import('../src/pdfToMarkdown.mjs').catch(() => ({ pdfToMarkdown: null }));
  if (pdfToMarkdown) {
    const buf = await readFile(gddPath);
    return pdfToMarkdown(buf);
  }
  throw new Error('No PDF extractor available for ' + gddPath);
}

function _runPdfToText(pdfPath) {
  return new Promise((resolveP, rejectP) => {
    const p = spawn('pdftotext', ['-layout', pdfPath, '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => out += d.toString('utf8'));
    p.stderr.on('data', (d) => err += d.toString('utf8'));
    p.on('error', rejectP);
    p.on('close', (code) => {
      if (code === 0) resolveP(out);
      else rejectP(new Error('pdftotext exit ' + code + ': ' + err.slice(0, 200)));
    });
  });
}

async function _askClaude(prompt) {
  if (!existsSync(ASK_BIN)) {
    throw new Error('cortex-claude-ask not found at ' + ASK_BIN);
  }
  /* cortex-claude-ask uses `printf '%s' "$PROMPT_BODY"` after reading all
   * stdin into a shell variable; piping via Node's child_process stdin
   * races when the body is large. Write to a temp file and shell-redirect
   * so the wrapper receives a fully-formed stdin stream. */
  const { tmpdir } = await import('node:os');
  const { randomUUID } = await import('node:crypto');
  const tmpFile = resolve(tmpdir(), 'wave-v-prompt-' + randomUUID() + '.txt');
  await writeFile(tmpFile, prompt, 'utf8');
  try {
    return await new Promise((resolveP, rejectP) => {
      const p = spawn('bash', ['-c', `"${ASK_BIN}" < "${tmpFile}"`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = ''; let err = '';
      p.stdout.on('data', (d) => out += d.toString('utf8'));
      p.stderr.on('data', (d) => err += d.toString('utf8'));
      p.on('error', rejectP);
      p.on('close', (code) => {
        if (code !== 0) {
          rejectP(new Error('cortex-claude-ask exit ' + code + ': ' + err.slice(0, 400)));
          return;
        }
        resolveP(out.trim());
      });
    });
  } finally {
    try { await (await import('node:fs/promises')).unlink(tmpFile); } catch (_) {}
  }
}

/* Try hard to coax a JSON object out of the model's reply. Some replies
 * wrap JSON in code fences or add prose; this is best-effort cleanup. */
function _extractJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  /* Strip ``` or ```json fences */
  s = s.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```$/i, '').trim();
  /* If model starts with prose, find the first { and last } */
  const first = s.indexOf('{');
  const last  = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  const candidate = s.slice(first, last + 1);
  try { return JSON.parse(candidate); }
  catch { return null; }
}

/* ── orchestration ────────────────────────────────────────────────────── */

async function _runOneAgent(agent, gddText, regexBaseline) {
  const promptHeader = await _readPrompt(agent.file);
  const promptBody = [
    promptHeader,
    '',
    '---',
    '',
    '## GDD text (read this)',
    '',
    gddText,
    '',
    '---',
    '',
    '## Regex-parser baseline (hint, override at will)',
    '',
    JSON.stringify(regexBaseline || {}, null, 2),
    '',
    '---',
    '',
    '## Reminder',
    '',
    'Return ONLY the JSON object specified in your role above. No prose.',
  ].join('\n');
  const raw = await _askClaude(promptBody);
  const parsed = _extractJson(raw);
  return { id: agent.id, raw, parsed };
}

async function _runReconcile(reports, regexBaseline) {
  const promptHeader = await _readPrompt(RECONCILE_AGENT.file);
  const promptBody = [
    promptHeader,
    '',
    '---',
    '',
    '## Regex baseline',
    '',
    '```json',
    JSON.stringify(regexBaseline || {}, null, 2),
    '```',
    '',
    ...reports.flatMap((r) => [
      '## ' + r.id + ' report',
      '',
      '```json',
      JSON.stringify(r.parsed || { _raw: r.raw }, null, 2),
      '```',
      '',
    ]),
    '## Reminder',
    '',
    'Return ONLY the JSON object specified in V6 role. No prose.',
  ].join('\n');
  const raw = await _askClaude(promptBody);
  const parsed = _extractJson(raw);
  return { id: RECONCILE_AGENT.id, raw, parsed };
}

async function processGdd(gddPath, outRoot) {
  const slug = _slug(gddPath);
  const outDir = resolve(outRoot, slug);
  await mkdir(outDir, { recursive: true });

  console.log(`\n=== ${slug} ===`);
  console.log(`  GDD: ${gddPath}`);

  const gddText = await _gddToText(gddPath);
  console.log(`  text length: ${gddText.length} chars`);

  /* Regex baseline via existing parser */
  let baseline = {};
  try {
    const { parseGDD } = await import('../src/parser.mjs');
    baseline = parseGDD(gddText, 'md') || {};
  } catch (e) {
    console.warn(`  ! regex baseline parse failed: ${e.message}`);
  }

  /* 5 parallel agents */
  console.log(`  spawning V1..V5 in parallel...`);
  const t0 = Date.now();
  const reports = await Promise.all(
    AGENTS.map((a) => _runOneAgent(a, gddText, baseline).catch((e) => ({
      id: a.id, raw: '', parsed: null, error: e.message,
    }))),
  );
  const t1 = Date.now();
  console.log(`  V1..V5 done in ${(t1 - t0) / 1000}s`);

  /* Write per-agent JSON */
  for (const r of reports) {
    const agentMeta = AGENTS.find((a) => a.id === r.id);
    await writeFile(
      resolve(outDir, agentMeta.key + '.json'),
      JSON.stringify(r.parsed || { _raw: r.raw, _error: r.error || null }, null, 2),
      'utf8',
    );
    const status = r.parsed ? '✓' : '✗';
    console.log(`  ${status} ${r.id} → ${agentMeta.key}.json (conf=${r.parsed?.confidence ?? 'n/a'})`);
  }

  /* V6 reconcile */
  console.log(`  spawning V6 reconcile...`);
  const t2 = Date.now();
  const v6 = await _runReconcile(reports, baseline).catch((e) => ({
    id: 'V6', raw: '', parsed: null, error: e.message,
  }));
  const t3 = Date.now();
  console.log(`  V6 done in ${(t3 - t2) / 1000}s`);

  await writeFile(
    resolve(outDir, 'v6_reconcile.json'),
    JSON.stringify(v6.parsed || { _raw: v6.raw, _error: v6.error || null }, null, 2),
    'utf8',
  );

  if (v6.parsed?.scorecard) {
    const sc = v6.parsed.scorecard;
    await writeFile(
      resolve(outDir, 'scorecard.json'),
      JSON.stringify(sc, null, 2),
      'utf8',
    );
    console.log(`  scorecard: declared=${sc.declared} inferred=${sc.inferred} default=${sc.default} ratio=${sc.ratio} conflicts=${sc.conflicts}`);
  } else {
    console.log(`  ! V6 returned no scorecard`);
  }

  return { slug, scorecard: v6.parsed?.scorecard || null };
}

/* ── main ─────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const gddArg = (() => {
    const i = args.indexOf('--gdd');
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  })();
  const outArg = (() => {
    const i = args.indexOf('--out');
    return i >= 0 && args[i + 1] ? args[i + 1] : resolve(REPO, 'tools/_eyes/wave-v');
  })();

  const gdds = all ? BASELINE_GDDS : (gddArg ? [gddArg] : null);
  if (!gdds) {
    console.error('Usage: --gdd <path>  |  --all   [--out <dir>]');
    process.exit(2);
  }

  await mkdir(outArg, { recursive: true });
  const results = [];
  for (const g of gdds) {
    if (!existsSync(g)) {
      console.warn(`! GDD missing: ${g}`);
      continue;
    }
    try {
      const r = await processGdd(g, outArg);
      results.push(r);
    } catch (e) {
      console.error(`! ${_slug(g)} failed: ${e.message}`);
      results.push({ slug: _slug(g), error: e.message });
    }
  }

  await writeFile(
    resolve(outArg, 'aggregate.json'),
    JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2),
    'utf8',
  );

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('Wave V multi-agent run complete');
  console.log('══════════════════════════════════════════════════════════════════════');
  for (const r of results) {
    if (r.scorecard) {
      console.log(`  ${r.slug.padEnd(28)} declared=${String(r.scorecard.declared).padStart(3)} ratio=${(r.scorecard.ratio || 0).toFixed(2)}  conflicts=${r.scorecard.conflicts || 0}`);
    } else if (r.error) {
      console.log(`  ${r.slug.padEnd(28)} ERROR: ${r.error.slice(0, 80)}`);
    } else {
      console.log(`  ${r.slug.padEnd(28)} (no scorecard returned)`);
    }
  }
  console.log(`\nReports under: ${outArg}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
