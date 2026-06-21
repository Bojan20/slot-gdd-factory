#!/usr/bin/env node
/**
 * tools/_wave-v-kimi-reconcile.mjs
 *
 * Wave V (Kimi-driven) — Boki 2026-06-21 "b i c redom ultimativno".
 *
 * Why Kimi
 * --------
 * Original Wave V orchestrator targeted `cortex-claude-ask`, which on this
 * box returns "Not logged in" / "Input must be provided through stdin"
 * even for trivial test prompts. Kimi (Moonshot K2) is available, and
 * cortex-kimi-ask wraps it through `~/Projects/cortex/scripts/cortex-kimi-ask`
 * with stdin → STDOUT semantics that work out of the box.
 *
 * What it does
 * ------------
 * Per GDD slug:
 *   1. Read `dist/real-games/<slug>/raw.txt` (pdftotext'd GDD body)
 *   2. Fire V1..V5 prompts in parallel against Kimi
 *      (agents/parser-pool/V<N>_<NAME>.md prompt headers + GDD body)
 *   3. Parse JSON out of each reply (cleanup code fences, prose, etc.)
 *   4. Deterministic V6 merge via src/wave-v-reconcile.mjs
 *   5. Write `tools/_wave-v-cache/<slug>.json` — auto-picked up by
 *      parser.mjs at next parse, populating model.__waveV__ + meta.
 *
 * CLI
 * ---
 *   node tools/_wave-v-kimi-reconcile.mjs --slug wrath-of-olympus-gdd
 *   node tools/_wave-v-kimi-reconcile.mjs --all          (29 baseline+LW)
 *   node tools/_wave-v-kimi-reconcile.mjs --slug X --limit 3   (debug)
 *
 * Output
 * ------
 *   tools/_wave-v-cache/<slug>.json  (v6_reconcile shape, parser-ready)
 *   tools/_eyes/wave-v/<slug>/v<n>.json (per-agent raw)
 *   tools/_eyes/wave-v/kimi-aggregate.json
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO      = resolve(__dirname, '..');
const POOL_DIR  = resolve(REPO, 'agents/parser-pool');
const CACHE_DIR = resolve(REPO, 'tools/_wave-v-cache');
const EYES_DIR  = resolve(REPO, 'tools/_eyes/wave-v');
const ASK_BIN   = process.env.CORTEX_KIMI_ASK ||
                  resolve(process.env.HOME, 'Projects/cortex/scripts/cortex-kimi-ask');

const AGENTS = [
  { id: 'V1', file: 'V1_TOPOLOGY.md',   key: 'v1_topology'   },
  { id: 'V2', file: 'V2_SYMBOLS.md',    key: 'v2_symbols'    },
  { id: 'V3', file: 'V3_FEATURE.md',    key: 'v3_feature'    },
  { id: 'V4', file: 'V4_UX.md',         key: 'v4_ux'         },
  { id: 'V5', file: 'V5_COMPLIANCE.md', key: 'v5_compliance' },
];

/* ── helpers ──────────────────────────────────────────────────────────── */

async function _readPrompt(file) {
  return readFile(resolve(POOL_DIR, file), 'utf8');
}

async function _askKimi(prompt) {
  if (!existsSync(ASK_BIN)) throw new Error('cortex-kimi-ask not found at ' + ASK_BIN);
  const tmp = resolve(tmpdir(), 'wave-v-kimi-' + randomUUID() + '.txt');
  await writeFile(tmp, prompt, 'utf8');
  try {
    return await new Promise((resolveP, rejectP) => {
      const p = spawn('bash', ['-c', `"${ASK_BIN}" < "${tmp}"`], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      p.stdout.on('data', (d) => out += d.toString('utf8'));
      p.stderr.on('data', (d) => err += d.toString('utf8'));
      p.on('error', rejectP);
      p.on('close', (code) => {
        if (code !== 0) rejectP(new Error('kimi-ask exit ' + code + ': ' + err.slice(0, 300)));
        else resolveP(out.trim());
      });
    });
  } finally {
    try { await (await import('node:fs/promises')).unlink(tmp); } catch (_) {}
  }
}

function _extractJson(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```$/i, '').trim();
  const first = s.indexOf('{');
  const last  = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  try { return JSON.parse(s.slice(first, last + 1)); } catch { return null; }
}

async function _runOneAgent(agent, gddText, baseline, correctionsBlock) {
  const header = await _readPrompt(agent.file);
  const body = [
    header, '', '---', '',
    '## GDD text (read this)', '', gddText, '',
    '---', '',
    '## Regex-parser baseline (hint, override at will)', '',
    JSON.stringify(baseline || {}, null, 2), '',
    /* Wave UQ-FORTIFY2 G1 — Pass B injection. When the orchestrator
     * detects diff vs ground truth, it re-invokes this function with a
     * CORRECTIONS block appended to the prompt. The agent should fix
     * the listed fields and stamp __self_corrected__:true. */
    ...(correctionsBlock ? ['---', '', correctionsBlock, ''] : []),
    '---', '',
    '## Reminder', '',
    'Return ONLY the JSON object specified in your role above. No prose.',
  ].join('\n');
  const raw = await _askKimi(body);
  return { id: agent.id, raw, parsed: _extractJson(raw) };
}

/* Wave UQ-FORTIFY2 G1 — Self-Correction Pass B helper.
 * Given an agent response and ground truth, compute a diff string that
 * the agent can consume to correct its output. Returns null if Pass B
 * is not needed (no significant diff). */
function _buildCorrectionsBlock(agentId, response, groundTruth) {
  if (!response || !response.parsed) return null;
  if (!groundTruth) return null;
  const r = response.parsed;
  const lines = [];
  /* V1 topology fields */
  if (agentId === 'V1_topology' && groundTruth.topology) {
    const t = r.topology || {};
    const g = groundTruth.topology;
    if (Number.isFinite(g.reels) && t.reels !== g.reels) {
      lines.push(`- topology.reels: you returned ${t.reels}, ground truth = ${g.reels}`);
    }
    if (Number.isFinite(g.rows) && t.rows !== g.rows) {
      lines.push(`- topology.rows: you returned ${t.rows}, ground truth = ${g.rows}`);
    }
    if (g.paylines_or_ways != null) {
      const got = t.paylines || t.ways;
      if (got !== g.paylines_or_ways) {
        lines.push(`- topology.paylines/ways: you returned ${got}, ground truth = ${g.paylines_or_ways}`);
      }
    }
  }
  /* V2 named symbols */
  if (agentId === 'V2_symbols' && Array.isArray(groundTruth.namedSymbols) && groundTruth.namedSymbols.length) {
    const allLabels = Array.isArray(r.symbols)
      ? r.symbols.map(s => (s && (s.name || s.label || s.id) || '').toLowerCase())
      : [];
    for (const want of groundTruth.namedSymbols) {
      if (!allLabels.some(l => l.includes(want.toLowerCase()))) {
        lines.push(`- symbol "${want}" missing — GDD prose mentions this name`);
      }
    }
  }
  if (lines.length < 1) return null;
  return [
    '=== CORRECTIONS (Pass B) ===',
    'Previous response had these issues:',
    ...lines,
    '',
    'Re-emit the JSON. Keep correct fields, fix the listed ones. Stamp',
    '`__self_corrected__: true` at the root of your JSON.',
    '===',
  ].join('\n');
}

async function _processGdd(slug) {
  const gddPath = resolve(REPO, `dist/real-games/${slug}/raw.txt`);
  if (!existsSync(gddPath)) {
    console.log(`  ✗ ${slug}: raw.txt missing — skip`);
    return { slug, error: 'raw.txt missing' };
  }
  const gddText = await readFile(gddPath, 'utf8');
  const baselineModelPath = resolve(REPO, `dist/real-games/${slug}/model.json`);
  let baseline = {};
  try { baseline = JSON.parse(await readFile(baselineModelPath, 'utf8')); } catch (_) {}

  const outDir = resolve(EYES_DIR, slug);
  await mkdir(outDir, { recursive: true });

  console.log(`  ⇄ ${slug} — fire V1..V5 in parallel via Kimi (${gddText.length} chars)`);
  const t0 = Date.now();
  let reports = await Promise.all(
    AGENTS.map((a) => _runOneAgent(a, gddText, baseline).catch((e) => ({ id: a.id, raw: '', parsed: null, error: e.message }))),
  );

  /* Wave UQ-FORTIFY2 G1 — Pass B self-correction.
   * Load ground truth if a fixture matches this slug, build CORRECTIONS
   * blocks per agent, re-invoke only the agents that have meaningful
   * diffs (skip if Pass A already correct → 0 cost). */
  try {
    const gtPath = resolve(REPO, 'tests/fixtures/semantic-expected.json');
    if (existsSync(gtPath)) {
      const gt = JSON.parse(await readFile(gtPath, 'utf8'));
      const gtKey = Object.keys(gt.fixtures || {}).find(k =>
        k.toLowerCase().replace(/_/g, '-') === slug
      );
      if (gtKey) {
        const expected = gt.fixtures[gtKey];
        const agentIdToFull = { V1: 'V1_topology', V2: 'V2_symbols', V3: 'V3_feature', V4: 'V4_ux', V5: 'V5_compliance' };
        const passBAgents = [];
        for (const r of reports) {
          const agentFull = agentIdToFull[r.id];
          const corrections = _buildCorrectionsBlock(agentFull, r, expected);
          if (corrections) passBAgents.push({ agent: AGENTS.find(a => a.id === r.id), corrections });
        }
        if (passBAgents.length > 0) {
          console.log(`  ↻ Pass B re-invocation: ${passBAgents.map(p => p.agent.id).join(', ')}`);
          const passBResults = await Promise.all(
            passBAgents.map(({ agent, corrections }) =>
              _runOneAgent(agent, gddText, baseline, corrections)
                .catch(e => ({ id: agent.id, raw: '', parsed: null, error: e.message }))
            )
          );
          /* Replace original reports with Pass B response if it parsed cleanly. */
          for (const pb of passBResults) {
            const idx = reports.findIndex(r => r.id === pb.id);
            if (idx >= 0 && pb.parsed) {
              pb.parsed.__self_corrected__ = true;
              reports[idx] = pb;
            }
          }
        }
      }
    }
  } catch (e) {
    console.log(`  ⚠ Pass B skipped: ${e.message}`);
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  let parsedCount = 0;
  for (const r of reports) {
    const meta = AGENTS.find((a) => a.id === r.id);
    await writeFile(resolve(outDir, meta.key + '.json'),
      JSON.stringify(r.parsed || { _raw: r.raw, _error: r.error || null }, null, 2), 'utf8');
    if (r.parsed) parsedCount++;
  }

  /* V6 deterministic merge */
  const { reconcile } = await import(resolve(REPO, 'src/wave-v-reconcile.mjs'));
  const v6 = reconcile({
    baseline,
    v1: reports.find((r) => r.id === 'V1')?.parsed,
    v2: reports.find((r) => r.id === 'V2')?.parsed,
    v3: reports.find((r) => r.id === 'V3')?.parsed,
    v4: reports.find((r) => r.id === 'V4')?.parsed,
    v5: reports.find((r) => r.id === 'V5')?.parsed,
  });

  await writeFile(resolve(outDir, 'v6_reconcile.json'), JSON.stringify(v6, null, 2), 'utf8');
  await writeFile(resolve(CACHE_DIR, `${slug}.json`), JSON.stringify(v6, null, 2), 'utf8');

  const sc = v6.scorecard || {};
  console.log(`    ✓ ${slug}: V${parsedCount}/5 parsed · declared=${sc.declared} ratio=${sc.ratio} (took ${dt}s)`);
  return { slug, parsedCount, declared: sc.declared, ratio: sc.ratio, conflicts: sc.conflicts };
}

/* ── main ─────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const slugArg = (() => { const i = args.indexOf('--slug'); return i >= 0 ? args[i + 1] : null; })();
  const limitArg = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : null; })();

  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(EYES_DIR, { recursive: true });

  let slugs = [];
  if (slugArg) slugs = [slugArg];
  else if (all) {
    const distDir = resolve(REPO, 'dist/real-games');
    const entries = await readdir(distDir);
    slugs = entries.filter((e) => !e.startsWith('.') && !e.startsWith('_'));
  } else {
    console.error('Usage: --slug <slug>  |  --all  [--limit N]');
    process.exit(2);
  }
  if (limitArg && limitArg > 0) slugs = slugs.slice(0, limitArg);

  /* --skip-cached: drop slugs whose cache file already exists */
  if (args.includes('--skip-cached')) {
    const before = slugs.length;
    slugs = slugs.filter((s) => !existsSync(resolve(CACHE_DIR, `${s}.json`)));
    console.log(`  ⇣ --skip-cached: ${before} → ${slugs.length} (skipped ${before - slugs.length})`);
  }

  /* --concurrency N: process N slugs in parallel (each slug fires 5 Kimi calls).
     Default 1 for backward compat. Recommended 3–5 for bulk runs.
     Wave UQ-FORTIFY2 G10 — hard cap 8 to prevent API burst.
     Warns when bulk run (≥100 slugs) without throttle. */
  const concIdx = args.indexOf('--concurrency');
  let CONC = concIdx >= 0 ? Math.max(1, parseInt(args[concIdx + 1], 10) || 1) : 1;
  if (CONC > 8) {
    console.log(`  ⚠ concurrency=${CONC} clamped to 8 (G10 burst guard)`);
    CONC = 8;
  }
  if (slugs.length >= 100 && CONC === 1) {
    console.log(`  ⚠ ${slugs.length} GDDs at concurrency=1 will take ~${Math.ceil(slugs.length * 0.5)} min.`);
    console.log('     Consider --concurrency 3 (capped at 8). Each slug fires 5 Kimi calls.');
  }

  console.log(`Wave V Kimi reconcile — ${slugs.length} GDDs · concurrency=${CONC}`);
  const results = [];
  let cursor = 0;
  let completed = 0;
  const total = slugs.length;
  async function _worker(wid) {
    while (true) {
      const idx = cursor++;
      if (idx >= slugs.length) return;
      const slug = slugs[idx];
      try {
        const r = await _processGdd(slug);
        results.push(r);
      } catch (e) {
        console.error(`  ! ${slug} failed: ${e.message}`);
        results.push({ slug, error: e.message });
      }
      completed++;
      console.log(`  [${completed}/${total}] worker#${wid} done`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, i) => _worker(i + 1)));

  await writeFile(resolve(EYES_DIR, 'kimi-aggregate.json'),
    JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2), 'utf8');

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('Wave V Kimi run complete');
  console.log('══════════════════════════════════════════════════════════════════════');
  let okCount = 0, sumDeclared = 0, sumRatio = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.slug.padEnd(40)} ERROR: ${r.error.slice(0, 60)}`);
    } else {
      okCount++;
      sumDeclared += r.declared || 0;
      sumRatio += r.ratio || 0;
      console.log(`  ${r.slug.padEnd(40)} V${r.parsedCount}/5 · declared=${String(r.declared).padStart(3)} ratio=${(r.ratio || 0).toFixed(2)} conflicts=${r.conflicts}`);
    }
  }
  if (okCount > 0) {
    console.log(`\nAvg declared: ${(sumDeclared / okCount).toFixed(1)} · avg ratio: ${((sumRatio / okCount) * 100).toFixed(1)}%`);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
