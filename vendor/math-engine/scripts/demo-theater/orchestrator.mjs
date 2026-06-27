#!/usr/bin/env node
/**
 * W211 Faza 700.0 — Demo Theater orchestrator.
 *
 * Scripted, deterministic, time-compressed simulation of a 30-day pilot
 * deployment. The default invocation compresses 30 days into ~5 minutes
 * of wall time (300× speed-up). It emits:
 *
 *   dist/demo-theater/timeline-{ts}.json     full event log
 *   dist/demo-theater/timeline-{ts}.md       human-readable per-day
 *   dist/demo-theater/narrative-{ts}.md      persona-shaped story
 *
 * CI mode (`--synthetic`) skips the wall-clock pacing so the same output
 * is produced in <30s — required for the demo-theater vitest specs.
 *
 * CLI:
 *   node scripts/demo-theater/orchestrator.mjs
 *   node scripts/demo-theater/orchestrator.mjs --compress=300x
 *   node scripts/demo-theater/orchestrator.mjs --speed=1x --synthetic
 *   node scripts/demo-theater/orchestrator.mjs --persona=cto
 *   node scripts/demo-theater/orchestrator.mjs --seed=42 --days=30
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTimeline, canaryStage, labStage } from './events.mjs';
import { renderNarrative, narratorLine, PERSONAS } from './narrator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const OUT_DIR = resolve(REPO_ROOT, 'dist', 'demo-theater');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = true;
  }
  return out;
}

/** Convert "300x" / "1x" / "5x" → number; default 300. */
function parseSpeed(str) {
  if (!str) return 300;
  const m = String(str).match(/^(\d+(?:\.\d+)?)x?$/i);
  if (!m) return 300;
  return Math.max(0.1, parseFloat(m[1]));
}

function progressBar(done, total, width = 30) {
  const pct = total === 0 ? 0 : done / total;
  const filled = Math.round(pct * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${(pct * 100).toFixed(0)}%`;
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Build the human-readable per-day Markdown timeline.
 */
function renderTimelineMarkdown(timeline) {
  const lines = [];
  lines.push(`# Demo Theater Timeline (seed ${timeline.seed})`);
  lines.push('');
  lines.push(`30-day scripted pilot · ${timeline.totalEvents} events · deterministic`);
  lines.push('');
  for (const c of timeline.dailyCounts) {
    lines.push(`## Day ${c.day}`);
    lines.push('');
    lines.push(`- Spin volume (simulated): ${c.spinVolume.toLocaleString()}`);
    lines.push(`- Canary: stage s${c.canary.stage} (${c.canary.rolloutPercent}%)`);
    lines.push(`- Lab pipeline: ${c.lab.stage} (day ${c.lab.daysInStage})`);
    lines.push(`- Events emitted: ${c.total} — ${Object.entries(c.byType).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Main entrypoint.
 */
export async function runOrchestrator(opts = {}) {
  const args = opts.cli ?? {};
  const seed = Number(args.seed ?? 42);
  const days = Number(args.days ?? 30);
  const synthetic = !!args.synthetic;
  const speed = parseSpeed(args.speed ?? args.compress ?? '300x');
  const persona = PERSONAS.has(String(args.persona)) ? String(args.persona) : 'all';
  const quiet = !!args.quiet;
  const outDir = opts.outDir ?? OUT_DIR;

  mkdirSync(outDir, { recursive: true });

  const timeline = generateTimeline({ seed, days });
  const t0 = Date.now();

  // Per-day pacing — 5 minutes / 30 days @ default 300× = 10s/day.
  // For synthetic mode we set pacing to 0 to keep CI fast.
  const dayMs = synthetic ? 0 : (24 * 60 * 60 * 1000) / speed;

  // Bucket events by day so we can pace and emit live narrator lines.
  const buckets = new Map();
  for (const e of timeline.events) {
    if (!buckets.has(e.day)) buckets.set(e.day, []);
    buckets.get(e.day).push(e);
  }

  const consoleLines = [];

  for (let d = 0; d <= days; d++) {
    const dayEvents = buckets.get(d) ?? [];

    // Pick the most "narrative-worthy" event for the live console.
    const anomalies = dayEvents.filter((e) => e.type === 'anomaly');
    const labEvent = dayEvents.find((e) => e.type === 'lab');
    const canaryEvent = dayEvents.find((e) => e.type === 'canary');

    if (!quiet) {
      const pb = progressBar(d, days);
      process.stdout.write(`\r${pb} Day ${String(d).padStart(2, ' ')} / ${days}`);
    }
    if (anomalies.length > 0) {
      const line = narratorLine(d, 9, 'anomaly', persona, anomalies[0].payload);
      consoleLines.push(line);
      if (!quiet) process.stdout.write(`\n${line}\n`);
    } else if (canaryEvent && (d === 0 || d === 3 || d === 8 || d === 15 || d === 22 || d === 29 || d === 30)) {
      const line = narratorLine(d, 0, 'canary', persona, canaryEvent.payload);
      consoleLines.push(line);
      if (!quiet) process.stdout.write(`\n${line}\n`);
    } else if (labEvent && (d === 22 || d === 29)) {
      const line = narratorLine(d, 0, 'lab', persona, labEvent.payload);
      consoleLines.push(line);
      if (!quiet) process.stdout.write(`\n${line}\n`);
    }

    await sleep(dayMs);
  }

  if (!quiet) process.stdout.write('\n');

  const tsStamp = synthetic ? 'synthetic' : new Date(t0).toISOString().replace(/[:.]/g, '-');
  const jsonPath = resolve(outDir, `timeline-${tsStamp}.json`);
  const mdPath = resolve(outDir, `timeline-${tsStamp}.md`);
  const narrPath = resolve(outDir, `narrative-${tsStamp}.md`);

  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        seed,
        days,
        persona,
        speed,
        startedAt: new Date(t0).toISOString(),
        finishedAt: new Date().toISOString(),
        wallTimeMs: Date.now() - t0,
        totalEvents: timeline.totalEvents,
        dailyCounts: timeline.dailyCounts,
        events: timeline.events,
        consoleLines,
      },
      null,
      2
    )
  );
  writeFileSync(mdPath, renderTimelineMarkdown(timeline));
  writeFileSync(narrPath, renderNarrative(timeline, persona));

  return {
    seed,
    days,
    persona,
    totalEvents: timeline.totalEvents,
    paths: { json: jsonPath, md: mdPath, narrative: narrPath },
    wallTimeMs: Date.now() - t0,
    consoleLines,
  };
}

// Run if invoked directly.
const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const args = parseArgs(process.argv);
  runOrchestrator({ cli: args })
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(
        `\ntheater: ${r.totalEvents} events · ${r.wallTimeMs}ms · seed ${r.seed} · persona ${r.persona}\n  json: ${r.paths.json}\n  md  : ${r.paths.md}\n  narr: ${r.paths.narrative}`
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('theater orchestrator failed:', err);
      process.exit(1);
    });
}
