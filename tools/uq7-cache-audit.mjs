#!/usr/bin/env node
/**
 * tools/uq7-cache-audit.mjs
 *
 * Wave UQ-7 (2026-06-21) — Post-Kimi cache audit.
 *
 * Reads every file in tools/_wave-v-cache/, aggregates the V6 scorecard
 * + model_delta surface across the 338-GDD corpus, and writes a single
 * human-readable Markdown report + a machine-readable JSON summary
 * into tools/_eyes/uq7-report/.
 *
 * Output
 *   tools/_eyes/uq7-report/uq7-summary.json
 *   tools/_eyes/uq7-report/uq7-report.md
 *
 * Sections in the Markdown report:
 *   1. Coverage — how many GDDs have a cache entry, how many V-agents
 *      parsed per cache entry (V1..V5 hit rate)
 *   2. Confidence histogram — buckets of declared/inferred ratio
 *   3. Conflicts — top GDDs with the most V1..V5 disagreements
 *   4. Topology spread — kind distribution across the corpus
 *   5. Feature distribution — top-30 feature kinds
 *   6. Unknown feature kinds — features present in cache but not in
 *      featureArchetypes catalog (candidates for new archetypes or
 *      backfill-only handling)
 *
 * CLI
 *   node tools/uq7-cache-audit.mjs                    full corpus
 *   node tools/uq7-cache-audit.mjs --limit 50         dry partial
 *   node tools/uq7-cache-audit.mjs --json             stdout JSON only
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES } from '../src/registry/featureArchetypes.mjs';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO      = resolve(__dirname, '..');
const CACHE_DIR = resolve(REPO, 'tools/_wave-v-cache');
const OUT_DIR   = resolve(REPO, 'tools/_eyes/uq7-report');

/* Canonical feature kinds known to the archetype catalog (any examples). */
const KNOWN_KINDS = new Set();
for (const a of ARCHETYPES) {
  for (const e of a.examples) {
    KNOWN_KINDS.add(e);
    /* Also snake-case form, for parser-emitted kinds */
    KNOWN_KINDS.add(e.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''));
  }
}

function bucket(ratio) {
  if (ratio < 0.10) return '0-10%';
  if (ratio < 0.20) return '10-20%';
  if (ratio < 0.30) return '20-30%';
  if (ratio < 0.40) return '30-40%';
  if (ratio < 0.50) return '40-50%';
  if (ratio < 0.60) return '50-60%';
  if (ratio < 0.70) return '60-70%';
  if (ratio < 0.80) return '70-80%';
  if (ratio < 0.90) return '80-90%';
  return '90-100%';
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i+1],10) : null; })();
  const jsonOnly = args.includes('--json');

  await mkdir(OUT_DIR, { recursive: true });

  let entries = (await readdir(CACHE_DIR)).filter(f => f.endsWith('.json')).sort();
  if (limitArg && limitArg > 0) entries = entries.slice(0, limitArg);

  const summary = {
    runAt: new Date().toISOString(),
    cacheCount: entries.length,
    agentsParsedHisto: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    confidenceHisto: {},
    topologyKinds: {},
    featureKinds: {},
    unknownFeatureKinds: {},
    topConflicts: [],
    totals: { declared: 0, inferred: 0, defaults: 0, conflicts: 0 },
  };
  const conflictList = [];

  for (const file of entries) {
    let j;
    try { j = JSON.parse(await readFile(resolve(CACHE_DIR, file), 'utf8')); }
    catch (e) { continue; }
    const slug = file.replace(/\.json$/, '');
    const sc   = j.scorecard || {};
    const md   = j.model_delta || {};

    /* Agents parsed — assume agents_consulted length is the V hit count */
    const ap = Array.isArray(sc.agents_consulted) ? sc.agents_consulted.length : 0;
    summary.agentsParsedHisto[ap] = (summary.agentsParsedHisto[ap] || 0) + 1;

    /* Confidence ratio histogram */
    const r = typeof sc.ratio === 'number' ? sc.ratio : 0;
    const b = bucket(r);
    summary.confidenceHisto[b] = (summary.confidenceHisto[b] || 0) + 1;

    /* Topology kind tally */
    const tk = (md.topology && md.topology.kind) || 'unknown';
    summary.topologyKinds[tk] = (summary.topologyKinds[tk] || 0) + 1;

    /* Feature kind tally + unknown bucket */
    if (Array.isArray(md.features)) {
      for (const f of md.features) {
        if (!f || !f.kind) continue;
        const k = f.kind;
        summary.featureKinds[k] = (summary.featureKinds[k] || 0) + 1;
        if (!KNOWN_KINDS.has(k)) {
          summary.unknownFeatureKinds[k] = (summary.unknownFeatureKinds[k] || 0) + 1;
        }
      }
    }

    /* Totals */
    summary.totals.declared  += sc.declared  || 0;
    summary.totals.inferred  += sc.inferred  || 0;
    summary.totals.defaults  += sc.default   || 0;
    summary.totals.conflicts += sc.conflicts || 0;

    /* Conflicts for top list */
    if ((sc.conflicts || 0) > 0) {
      conflictList.push({ slug, conflicts: sc.conflicts, ratio: r });
    }
  }
  conflictList.sort((a, b) => b.conflicts - a.conflicts);
  summary.topConflicts = conflictList.slice(0, 20);

  /* JSON summary always written */
  const jsonPath = resolve(OUT_DIR, 'uq7-summary.json');
  await writeFile(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  if (jsonOnly) {
    process.stdout.write(JSON.stringify(summary, null, 2));
    return;
  }

  /* Markdown report */
  const md = _renderMarkdown(summary);
  const mdPath = resolve(OUT_DIR, 'uq7-report.md');
  await writeFile(mdPath, md, 'utf8');

  console.log(`✓ UQ-7 audit complete`);
  console.log(`  ${entries.length} cache entries audited`);
  console.log(`  ${Object.keys(summary.featureKinds).length} unique feature kinds`);
  console.log(`  ${Object.keys(summary.unknownFeatureKinds).length} unknown (no archetype)`);
  console.log(`  ${conflictList.length} cache entries with V1..V5 conflicts`);
  console.log(`  → ${jsonPath}`);
  console.log(`  → ${mdPath}`);
}

function _renderMarkdown(s) {
  const lines = [];
  lines.push('# UQ-7 — Post-Kimi Cache Audit');
  lines.push('');
  lines.push(`Generated: ${s.runAt}`);
  lines.push(`Cache entries: **${s.cacheCount}**`);
  lines.push('');
  lines.push(`Total declared: ${s.totals.declared} · inferred: ${s.totals.inferred} · defaults: ${s.totals.defaults} · conflicts: ${s.totals.conflicts}`);
  lines.push('');

  lines.push('## 1. Agent parse coverage');
  lines.push('| V agents parsed | GDD count |');
  lines.push('|:-:|:-:|');
  for (let i = 0; i <= 5; i++) {
    lines.push(`| ${i}/5 | ${s.agentsParsedHisto[i] || 0} |`);
  }
  lines.push('');

  lines.push('## 2. Confidence ratio histogram (declared / declared+inferred+default)');
  lines.push('| Bucket | GDD count |');
  lines.push('|:--|:-:|');
  const buckets = ['0-10%','10-20%','20-30%','30-40%','40-50%','50-60%','60-70%','70-80%','80-90%','90-100%'];
  for (const b of buckets) {
    lines.push(`| ${b} | ${s.confidenceHisto[b] || 0} |`);
  }
  lines.push('');

  lines.push('## 3. Top 20 GDDs by V1..V5 conflicts');
  lines.push('| Slug | Conflicts | Ratio |');
  lines.push('|:--|:-:|:-:|');
  for (const c of s.topConflicts) {
    lines.push(`| ${c.slug} | ${c.conflicts} | ${(c.ratio*100).toFixed(1)}% |`);
  }
  if (s.topConflicts.length === 0) lines.push('| (no conflicts) | — | — |');
  lines.push('');

  lines.push('## 4. Topology kind distribution');
  lines.push('| Kind | Count |');
  lines.push('|:--|:-:|');
  for (const [k, v] of Object.entries(s.topologyKinds).sort((a,b)=>b[1]-a[1])) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push('');

  lines.push('## 5. Top-30 feature kinds');
  lines.push('| Feature kind | Count | In catalog? |');
  lines.push('|:--|:-:|:-:|');
  const allFeats = Object.entries(s.featureKinds).sort((a,b)=>b[1]-a[1]).slice(0, 30);
  for (const [k, v] of allFeats) {
    const inCat = s.unknownFeatureKinds[k] ? '❌' : '✅';
    lines.push(`| ${k} | ${v} | ${inCat} |`);
  }
  lines.push('');

  lines.push('## 6. Unknown feature kinds (candidates for new archetype or backfill-only)');
  lines.push('| Kind | Count |');
  lines.push('|:--|:-:|');
  const unk = Object.entries(s.unknownFeatureKinds).sort((a,b)=>b[1]-a[1]);
  for (const [k, v] of unk) {
    lines.push(`| ${k} | ${v} |`);
  }
  if (unk.length === 0) lines.push('| (none — full coverage) | — |');
  lines.push('');

  return lines.join('\n');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
