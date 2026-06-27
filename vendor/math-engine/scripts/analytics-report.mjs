#!/usr/bin/env node
//
// CORTI W207-ANALYTICS — daily analytics report generator.
//
// Builds a daily summary of:
//   - total events
//   - per-category breakdown
//   - top N games by spin count
//   - rolling RTP per game (cumulative)
//   - anomaly list (when --anomaly-file supplied)
//
// Inputs:
//   --input <file.json>     JSON array of AnalyticsEvent objects (default: stdin)
//   --anomaly-file <file>   Optional list of DriftAlert objects to merge
//   --date <YYYY-MM-DD>     Report date stamp (default: today)
//   --output-dir <dir>      Output directory (default: reports/analytics)
//   --top <N>               Top-N games (default: 10)
//
// Output:
//   reports/analytics/DAILY_<date>.json
//   reports/analytics/DAILY_<date>.md
//   reports/analytics/DAILY_<date>.csv
//
// Sample run:
//   npm run analytics:report -- --input /tmp/events.json

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

function parseArgs(argv) {
  const out = { top: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a === '--anomaly-file') out.anomalyFile = argv[++i];
    else if (a === '--date') out.date = argv[++i];
    else if (a === '--output-dir') out.outputDir = argv[++i];
    else if (a === '--top') out.top = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
`Usage: analytics-report --input <events.json> [--anomaly-file <alerts.json>] [--date YYYY-MM-DD] [--top N]
`);
      process.exit(0);
    }
  }
  return out;
}

function readJsonInput(path) {
  if (!path || path === '-') {
    const chunks = [];
    return new Promise((resolveP, rejectP) => {
      process.stdin.on('data', (c) => chunks.push(c));
      process.stdin.on('end', () => {
        try { resolveP(JSON.parse(Buffer.concat(chunks).toString('utf8') || '[]')); }
        catch (e) { rejectP(e); }
      });
      process.stdin.on('error', rejectP);
    });
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function summarize(events, topN) {
  const categoryCounts = Object.create(null);
  const perGame = new Map();
  const sessions = new Set();
  let totalBet = 0;
  let totalWin = 0;
  for (const ev of events) {
    categoryCounts[ev.category] = (categoryCounts[ev.category] || 0) + 1;
    if (ev.sessionId) sessions.add(ev.sessionId);
    if (ev.gameId) {
      const g = perGame.get(ev.gameId) ?? { gameId: ev.gameId, spins: 0, bet: 0, win: 0 };
      if (ev.category === 'spin' || ev.category === 'win' || ev.category === 'loss') {
        g.spins += 1;
        g.bet += Number(ev.bet ?? 0);
        g.win += Number(ev.value ?? 0);
        totalBet += Number(ev.bet ?? 0);
        totalWin += Number(ev.value ?? 0);
      }
      perGame.set(ev.gameId, g);
    }
  }
  const games = Array.from(perGame.values()).map((g) => ({
    ...g,
    rtp: g.bet > 0 ? g.win / g.bet : 0,
  })).sort((a, b) => b.spins - a.spins);
  return {
    totalEvents: events.length,
    sessionCount: sessions.size,
    totalBet,
    totalWin,
    rtp: totalBet > 0 ? totalWin / totalBet : 0,
    categoryCounts,
    topGames: games.slice(0, topN),
    allGames: games,
  };
}

function toCsv(allGames) {
  const lines = ['gameId,spins,bet,win,rtp'];
  for (const g of allGames) {
    lines.push(`${g.gameId},${g.spins},${g.bet.toFixed(4)},${g.win.toFixed(4)},${g.rtp.toFixed(6)}`);
  }
  return lines.join('\n');
}

function toMarkdown(date, summary, anomalies) {
  let md = `# Analytics Daily Report — ${date}\n\n`;
  md += `**Total events**: ${summary.totalEvents}  \n`;
  md += `**Sessions**: ${summary.sessionCount}  \n`;
  md += `**Total bet**: ${summary.totalBet.toFixed(2)}  \n`;
  md += `**Total win**: ${summary.totalWin.toFixed(2)}  \n`;
  md += `**Net RTP**: ${(summary.rtp * 100).toFixed(2)}%  \n\n`;
  md += `## Categories\n\n| Category | Count |\n|---|---|\n`;
  for (const [k, v] of Object.entries(summary.categoryCounts).sort()) {
    md += `| ${k} | ${v} |\n`;
  }
  md += `\n## Top ${summary.topGames.length} games by spin volume\n\n`;
  md += `| Game | Spins | Bet | Win | RTP |\n|---|---|---|---|---|\n`;
  for (const g of summary.topGames) {
    md += `| ${g.gameId} | ${g.spins} | ${g.bet.toFixed(2)} | ${g.win.toFixed(2)} | ${(g.rtp * 100).toFixed(2)}% |\n`;
  }
  if (anomalies && anomalies.length > 0) {
    md += `\n## Anomalies (${anomalies.length})\n\n| Game | Severity | Trigger | Observed | Expected | Δ | z |\n|---|---|---|---|---|---|---|\n`;
    for (const a of anomalies) {
      md += `| ${a.gameId} | ${a.severity} | ${a.trigger} | ${(a.observed * 100).toFixed(2)}% | ${(a.expected * 100).toFixed(2)}% | ${(a.delta * 100).toFixed(2)}pp | ${a.zScore.toFixed(2)} |\n`;
    }
  } else {
    md += `\n## Anomalies\n\nNo anomalies detected.\n`;
  }
  return md;
}

async function main() {
  const args = parseArgs(process.argv);
  const date = args.date ?? todayIso();
  const outDir = args.outputDir ?? resolve(REPO_ROOT, 'reports', 'analytics');
  mkdirSync(outDir, { recursive: true });

  let events = [];
  if (args.input) {
    events = await readJsonInput(args.input);
  } else if (process.stdin.isTTY === false) {
    events = await readJsonInput('-');
  }
  if (!Array.isArray(events)) {
    throw new Error('Input must be a JSON array of AnalyticsEvent objects');
  }
  let anomalies = [];
  if (args.anomalyFile && existsSync(args.anomalyFile)) {
    const raw = JSON.parse(readFileSync(args.anomalyFile, 'utf8'));
    if (Array.isArray(raw)) anomalies = raw;
  }
  const summary = summarize(events, args.top);

  const jsonPath = resolve(outDir, `DAILY_${date}.json`);
  const mdPath = resolve(outDir, `DAILY_${date}.md`);
  const csvPath = resolve(outDir, `DAILY_${date}.csv`);

  writeFileSync(jsonPath, JSON.stringify({ date, summary, anomalies }, null, 2));
  writeFileSync(mdPath, toMarkdown(date, summary, anomalies));
  writeFileSync(csvPath, toCsv(summary.allGames));

  process.stdout.write(
`[analytics-report] wrote:
  ${jsonPath}
  ${mdPath}
  ${csvPath}
totalEvents=${summary.totalEvents} sessions=${summary.sessionCount} games=${summary.allGames.length} anomalies=${anomalies.length}
`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[analytics-report] failed:', err.message);
  process.exit(1);
});
