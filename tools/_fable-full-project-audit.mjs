#!/usr/bin/env node
/**
 * tools/_fable-full-project-audit.mjs
 *
 * Boki imperative (2026-06-11): "joces da pustis Fable za ceo slot gdd
 * project, da ga vodis kao senior dev i vlasnik koda da sve ultimativno
 * fiksuje i svaki scenario moguci zakrpi?"
 *
 * Strategy
 * --------
 * Walk every block in `src/blocks/*.mjs`, send each one to Fable for a
 * senior-grade review with the same prompt protocol used in
 * Wave AL-4 / Fable-5. Aggregate ALL findings (with severity) into a
 * single Markdown report so we can apply fixes systematically in one
 * coordinated pass, not block-by-block bouncing.
 *
 * Output
 * ------
 *   reports/fable-full-audit.md           — agregirani markdown verdict
 *   reports/fable-full-audit.json         — strukturirana po-bloku JSON
 *   reports/fable-full-audit/<block>.md   — sirov Fable izlaz po bloku
 *
 * Smart features:
 *   • Per-block timeout cap (skip if takes > 300s, log it)
 *   • Per-block max-tokens cap (8 KB output)
 *   • Resume mode: skips blocks whose individual report already exists
 *     (so we can re-run if killed mid-way without re-burning $)
 *   • Aggregate cost estimate at end
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const BLOCKS_DIR = resolve(REPO, 'src/blocks');
const PER_BLOCK_DIR = resolve(REPO, 'reports/fable-full-audit');
const SUMMARY_MD = resolve(REPO, 'reports/fable-full-audit.md');
const SUMMARY_JSON = resolve(REPO, 'reports/fable-full-audit.json');
const FABLE_WRAPPER = `${process.env.HOME}/Projects/cortex/scripts/cortex-fable-ask`;

if (!existsSync(PER_BLOCK_DIR)) mkdirSync(PER_BLOCK_DIR, { recursive: true });

const blocks = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.mjs')).sort();

const REVIEW_PROMPT_HEADER = `Senior code review of a slot-machine block. Be terse — only call out real issues. Format each issue exactly:

ISSUE: one-line description
WHY: one-sentence consequence
FIX: minimal patch / diff or function signature
SEVERITY: critical | high | medium | low

If zero issues, respond literally "NO ISSUES FOUND" — nothing else.

Senior-grade contract (rule_senior_grade_code from this repo):
- 0 magic numbers
- defensive on input (clamp ranges, never throw on missing model)
- idempotent emit (defaultConfig deterministic)
- lifecycle ownership (HookBus subscribe + emit canonical)
- 100% test coverage of public API
- performance budget stated
- accessibility default-on (prefers-reduced-motion, ARIA)
- vendor-neutral (no industry standard/Pragmatic/NetEnt/etc strings)
- byte-identical CSS / runtime determinism

LEGO discipline (rule_slot_gdd_lego_blocks):
- single-owner emit per HookBus event
- no game-specific 'if (game === X)' branches
- block must own a lifecycle hook if it draws UI

Block source (src/blocks/<NAME>):

\`\`\`js
`;

const REVIEW_PROMPT_FOOTER = `
\`\`\``;

let totalTokensIn = 0;
let totalTokensOut = 0;
let totalIssues = { critical: 0, high: 0, medium: 0, low: 0 };
const perBlock = [];

function askFable(prompt, task) {
  return new Promise((resolveCb) => {
    const start = Date.now();
    const proc = spawn(FABLE_WRAPPER,
      ['--log', '--task', task, '--timeout', '300', '--max-tokens', '8192'],
      { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      const ms = Date.now() - start;
      // Parse stderr telemetry line: "── fable :: MODEL via PATH · Nms · in=X out=Y · task=T"
      const match = stderr.match(/in=(\d+)\s+out=(\d+)/);
      const tokIn = match ? parseInt(match[1], 10) : 0;
      const tokOut = match ? parseInt(match[2], 10) : 0;
      const modelMatch = stderr.match(/fable :: ([\S]+)/);
      const model = modelMatch ? modelMatch[1] : 'unknown';
      resolveCb({ code, stdout, stderr, ms, tokIn, tokOut, model });
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function parseSeverity(text) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  if (!text) return counts;
  const ms = text.match(/SEVERITY:\s*(critical|high|medium|low)/gi) || [];
  for (const m of ms) {
    const sev = m.toLowerCase().match(/(critical|high|medium|low)/)[1];
    counts[sev]++;
  }
  return counts;
}

async function main() {
  console.log(`🔍 Fable full-project audit — ${blocks.length} blocks`);
  console.log(`   Wrapper: ${FABLE_WRAPPER}`);
  console.log(`   Per-block reports → ${PER_BLOCK_DIR}/`);
  console.log('');

  for (let i = 0; i < blocks.length; i++) {
    const file = blocks[i];
    const name = file.replace(/\.mjs$/, '');
    const reportPath = resolve(PER_BLOCK_DIR, `${name}.md`);

    if (existsSync(reportPath)) {
      const cached = readFileSync(reportPath, 'utf8');
      const counts = parseSeverity(cached);
      console.log(`  [${i+1}/${blocks.length}] ${name} — cached, ${counts.critical}c/${counts.high}h/${counts.medium}m/${counts.low}l`);
      for (const k of Object.keys(counts)) totalIssues[k] += counts[k];
      perBlock.push({ name, cached: true, counts, ms: 0, tokIn: 0, tokOut: 0 });
      continue;
    }

    const src = readFileSync(resolve(BLOCKS_DIR, file), 'utf8');
    // Keep prompt under ~12K chars to leave room for Fable's reply.
    const srcTrimmed = src.length > 8500 ? src.slice(0, 8500) + '\n\n/* ... truncated ... */' : src;
    const prompt = REVIEW_PROMPT_HEADER.replace('<NAME>', file) + srcTrimmed + REVIEW_PROMPT_FOOTER;

    process.stdout.write(`  [${i+1}/${blocks.length}] ${name} ... `);
    const t0 = Date.now();
    const { code, stdout, stderr, ms, tokIn, tokOut, model } = await askFable(prompt, `audit:${name}`);

    if (code !== 0 || !stdout.trim()) {
      console.log(`❌ skip (exit ${code}, ${ms}ms)`);
      perBlock.push({ name, failed: true, exitCode: code, ms, stderr: stderr.slice(0, 200) });
      continue;
    }

    writeFileSync(reportPath, stdout);
    const counts = parseSeverity(stdout);
    for (const k of Object.keys(counts)) totalIssues[k] += counts[k];
    totalTokensIn += tokIn;
    totalTokensOut += tokOut;
    perBlock.push({ name, counts, ms, tokIn, tokOut, model });

    const issuesSummary = stdout.includes('NO ISSUES FOUND')
      ? '✅ clean'
      : `${counts.critical}c/${counts.high}h/${counts.medium}m/${counts.low}l`;
    console.log(`${issuesSummary} (${(ms/1000).toFixed(0)}s, ${tokIn}/${tokOut} tok)`);
  }

  // Aggregate cost — Opus 4.8 pricing (Fable 5 still routes via Opus fallback)
  const costIn = totalTokensIn * 15 / 1_000_000;
  const costOut = totalTokensOut * 75 / 1_000_000;
  const totalCost = costIn + costOut;

  // Build summary MD
  const lines = [];
  lines.push(`# Fable full-project audit — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Blocks reviewed: **${blocks.length}**  ·  Total issues: **${totalIssues.critical} critical / ${totalIssues.high} high / ${totalIssues.medium} medium / ${totalIssues.low} low**  ·  Cost (Opus 4.8 rate): **$${totalCost.toFixed(2)}**`);
  lines.push('');
  lines.push('## Per-block summary');
  lines.push('');
  lines.push('| # | Block | Critical | High | Medium | Low | Verdict |');
  lines.push('|--:|:--|--:|--:|--:|--:|:--|');
  perBlock.forEach((b, idx) => {
    if (b.failed) {
      lines.push(`| ${idx+1} | ${b.name} | — | — | — | — | ❌ skip (exit ${b.exitCode}) |`);
      return;
    }
    const c = b.counts || { critical: 0, high: 0, medium: 0, low: 0 };
    const verdict = (c.critical + c.high + c.medium + c.low) === 0 ? '✅ clean' :
                    c.critical > 0 ? '🔴 critical' :
                    c.high > 0 ? '🟠 high' :
                    c.medium > 0 ? '🟡 medium' : '🔵 low';
    lines.push(`| ${idx+1} | \`${b.name}\` | ${c.critical} | ${c.high} | ${c.medium} | ${c.low} | ${verdict} |`);
  });
  lines.push('');
  lines.push('## Cost breakdown');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|:--|--:|');
  lines.push(`| Tokens in | ${totalTokensIn.toLocaleString()} |`);
  lines.push(`| Tokens out | ${totalTokensOut.toLocaleString()} |`);
  lines.push(`| Cost (input @ $15/M) | $${costIn.toFixed(4)} |`);
  lines.push(`| Cost (output @ $75/M) | $${costOut.toFixed(4)} |`);
  lines.push(`| **Total estimate** | **$${totalCost.toFixed(2)}** |`);
  lines.push('');
  lines.push('## Per-block raw reports');
  lines.push('');
  for (const b of perBlock) {
    if (b.failed) continue;
    const p = resolve(PER_BLOCK_DIR, `${b.name}.md`);
    lines.push(`- [\`${b.name}\`](fable-full-audit/${b.name}.md)`);
  }

  writeFileSync(SUMMARY_MD, lines.join('\n'));
  writeFileSync(SUMMARY_JSON, JSON.stringify({
    blocks: perBlock,
    totals: { issues: totalIssues, tokensIn: totalTokensIn, tokensOut: totalTokensOut, costUsd: totalCost },
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log('');
  console.log(`📊 Aggregate: ${totalIssues.critical}c / ${totalIssues.high}h / ${totalIssues.medium}m / ${totalIssues.low}l`);
  console.log(`💰 Estimated cost: $${totalCost.toFixed(2)} (${totalTokensIn} in / ${totalTokensOut} out)`);
  console.log(`📝 Summary → ${SUMMARY_MD}`);
  console.log(`📝 Per-block → ${PER_BLOCK_DIR}/`);

  /* Multi-channel notification — Corti can't push to chat, but the
   * notifier hits desktop banner + Notification Center + (if configured)
   * ntfy push to phone + Slack/Discord/Telegram/Pushover. Always exits 0,
   * never blocks. */
  const NOTIFY = `${process.env.HOME}/Projects/cortex/scripts/cortex-notify`;
  const isCritical = totalIssues.critical > 0;
  const msg = `Fable audit done · ${totalIssues.critical}c/${totalIssues.high}h/${totalIssues.medium}m/${totalIssues.low}l · $${totalCost.toFixed(2)}`;
  const { spawn: spawnP } = await import('node:child_process');
  spawnP(NOTIFY, [
    '--title', 'Fable full-project audit',
    ...(isCritical ? ['--critical'] : []),
    '--voice',          /* announce by voice so Boki hears it across the room */
    msg,
  ], { stdio: 'ignore', detached: true }).unref();
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
