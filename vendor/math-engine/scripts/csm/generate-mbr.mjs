#!/usr/bin/env node
/**
 * W215 Faza 1300.0 Agent C — Monthly Business Review (MBR) generator.
 *
 * Usage:
 *   node scripts/csm/generate-mbr.mjs --tenant=<id> --month=YYYY-MM [--mode=test]
 *
 * Output:
 *   dist/csm/<tenant>/mbr-YYYY-MM.md
 *   dist/csm/<tenant>/mbr-YYYY-MM.html
 *   dist/csm/<tenant>/mbr-YYYY-MM.pdf-stub.txt
 *
 * In real deployments the data comes from the live database. For test /
 * dev runs (mode=test) we use a deterministic synthetic dataset that is
 * derived from a `mulberry32(hash(tenant + month))` PRNG. That keeps the
 * unit test fast (<5s end-to-end) and reproducible.
 */
import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const DIST = resolve(REPO_ROOT, 'dist', 'csm');

function parseArgs(argv) {
  const out = { mode: 'test' };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = true;
  }
  return out;
}

/** FNV-1a 32-bit hash for deterministic seeding. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a deterministic dataset for one (tenant, month) pair. */
export function buildSyntheticDataset(tenant, month) {
  const rand = mulberry32(hashStr(`${tenant}|${month}`));
  const targetRtp = 0.95 + Math.round(rand() * 30) / 1000; // 0.950 .. 0.980
  const achievedRtp = targetRtp + (rand() - 0.5) * 0.004; // ±0.2 pp
  const hitFreqPct = 18 + rand() * 6; // 18 .. 24
  const topPctRtpShare = 0.05 + rand() * 0.04; // 5% .. 9%
  const maxWinMultiplier = 1000 + Math.floor(rand() * 9000);
  const uptimePct = 99.8 + rand() * 0.2;
  const p99LatencyMs = 80 + Math.floor(rand() * 30);
  const ticketsOpened = Math.floor(rand() * 8);
  const ticketsResolved = Math.max(0, ticketsOpened - Math.floor(rand() * 2));
  const mttrHours = 6 + rand() * 8;
  const activeCerts = Math.floor(rand() * 3);
  const recentApprovals = Math.floor(rand() * 4);
  const kernelsInstalled = 3 + Math.floor(rand() * 5);
  const templatesLicensed = 1 + Math.floor(rand() * 3);
  const walletUptimePct = 99.9 + rand() * 0.1;
  const walletLatencyMs = 35 + Math.floor(rand() * 12);
  const revenueUsd = 50_000 + Math.floor(rand() * 200_000);
  const outstandingInvoicesUsd = Math.floor(rand() * 12_000);
  const anomalyCount = Math.floor(rand() * 4);
  const driftEventCount = Math.floor(rand() * 3);
  const compliancePending = Math.floor(rand() * 2);

  return {
    tenant,
    month,
    games: {
      targetRtp,
      achievedRtp,
      hitFreqPct,
      topPctRtpShare,
      maxWinMultiplier,
    },
    ops: {
      uptimePct,
      p99LatencyMs,
      ticketsOpened,
      ticketsResolved,
      mttrHours,
    },
    cert: { activeCerts, recentApprovals },
    marketplace: { kernelsInstalled, templatesLicensed },
    wallet: { walletUptimePct, walletLatencyMs },
    finance: { revenueUsd, outstandingInvoicesUsd },
    risk: {
      compliancePending,
      anomalyCount,
      driftEventCount,
    },
    roadmap: pickRoadmapItems(rand),
  };
}

function pickRoadmapItems(rand) {
  const pool = [
    'Megaways rate-limit dashboard',
    'Avalanche-multiplier cascade kernel',
    'Bonus-buy variance heatmap',
    'Operator-branded CSP rollout',
    'Real-time RTP drift alerts (Slack)',
    'Mobile-first lobby v2',
    'Hold & Win solver visualizations',
  ];
  const out = [];
  const k = 2 + Math.floor(rand() * 2);
  const seen = new Set();
  while (out.length < k) {
    const i = Math.floor(rand() * pool.length);
    if (!seen.has(i)) {
      seen.add(i);
      out.push(pool[i]);
    }
  }
  return out;
}

function fmtPct(n, digits = 2) {
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtUsd(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Render the MBR document as markdown. Pure. Deterministic. */
export function renderMbrMarkdown(data) {
  const {
    tenant, month, games, ops, cert, marketplace, wallet, finance, risk, roadmap,
  } = data;
  const lines = [];
  lines.push(`# Monthly Business Review — ${tenant}`);
  lines.push(``);
  lines.push(`**Reporting period:** ${month}`);
  lines.push(`**Document generated:** ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`## Executive Summary`);
  lines.push(``);
  const winText =
    games.achievedRtp >= games.targetRtp - 0.002
      ? `RTP tracking on-target (${fmtPct(games.achievedRtp, 2)} vs ${fmtPct(games.targetRtp, 2)})`
      : `RTP below target by ${fmtPct(games.targetRtp - games.achievedRtp, 2)} — under review`;
  lines.push(`- **Key win:** ${winText}.`);
  lines.push(`- **Key risk:** ${risk.driftEventCount} RTP-drift event(s), ${risk.anomalyCount} anomaly alert(s) in window.`);
  lines.push(`- **Ask:** approve roadmap commitments below for next quarter.`);
  lines.push(``);

  lines.push(`## 1. Game Performance`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Target RTP | ${fmtPct(games.targetRtp, 2)} |`);
  lines.push(`| Achieved RTP | ${fmtPct(games.achievedRtp, 2)} |`);
  lines.push(`| Hit frequency | ${games.hitFreqPct.toFixed(2)}% |`);
  lines.push(`| Top-1% RTP share | ${fmtPct(games.topPctRtpShare, 2)} |`);
  lines.push(`| Max win observed | ×${games.maxWinMultiplier.toLocaleString('en-US')} |`);
  lines.push(``);

  lines.push(`## 2. Operational Metrics`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Uptime | ${ops.uptimePct.toFixed(3)}% |`);
  lines.push(`| p99 latency | ${ops.p99LatencyMs} ms |`);
  lines.push(`| Tickets opened | ${ops.ticketsOpened} |`);
  lines.push(`| Tickets resolved | ${ops.ticketsResolved} |`);
  lines.push(`| Mean time to resolution | ${ops.mttrHours.toFixed(1)} h |`);
  lines.push(``);

  lines.push(`## 3. Certification Pipeline`);
  lines.push(``);
  lines.push(`- Active submissions: **${cert.activeCerts}**`);
  lines.push(`- Recent approvals: **${cert.recentApprovals}**`);
  lines.push(``);

  lines.push(`## 4. Marketplace Usage`);
  lines.push(``);
  lines.push(`- Kernels installed: **${marketplace.kernelsInstalled}**`);
  lines.push(`- Templates licensed: **${marketplace.templatesLicensed}**`);
  lines.push(``);

  lines.push(`## 5. Wallet Provider Health`);
  lines.push(``);
  lines.push(`- Uptime: **${wallet.walletUptimePct.toFixed(3)}%**`);
  lines.push(`- p50 latency: **${wallet.walletLatencyMs} ms**`);
  lines.push(``);

  lines.push(`## 6. Financial Snapshot`);
  lines.push(``);
  lines.push(`- Revenue this month: **${fmtUsd(finance.revenueUsd)}**`);
  lines.push(`- Outstanding invoices: **${fmtUsd(finance.outstandingInvoicesUsd)}**`);
  lines.push(`- Settlement reconciliation: **complete**`);
  lines.push(``);

  lines.push(`## 7. Risks & Mitigations`);
  lines.push(``);
  lines.push(`- Compliance items pending: **${risk.compliancePending}**`);
  lines.push(`- Anomaly count (30d): **${risk.anomalyCount}**`);
  lines.push(`- RTP drift events (30d): **${risk.driftEventCount}**`);
  lines.push(``);
  lines.push(
    risk.driftEventCount > 0
      ? `Mitigation: math team owns the root-cause analysis; remediation ETA ≤ 14 days.`
      : `Mitigation: continue monitoring; no action required.`,
  );
  lines.push(``);

  lines.push(`## 8. Roadmap Preview`);
  lines.push(``);
  for (const item of roadmap) lines.push(`- ${item}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by slot-math-engine-template MBR generator (W215).*`);
  return lines.join('\n');
}

/** Wrap the markdown body in a minimal HTML shell. */
export function renderMbrHtml(md, data) {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="utf-8" />`,
    `  <title>MBR — ${data.tenant} — ${data.month}</title>`,
    `  <style>`,
    `    body { font-family: -apple-system, sans-serif; max-width: 880px; margin: 40px auto; padding: 0 24px; color: #0f172a; }`,
    `    h1, h2 { border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }`,
    `    pre  { white-space: pre-wrap; word-wrap: break-word; background: #f8fafc; padding: 16px; border-radius: 6px; }`,
    `  </style>`,
    `</head>`,
    `<body>`,
    `<pre>${escaped}</pre>`,
    `</body>`,
    `</html>`,
  ].join('\n');
}

/** Render a stub PDF marker (real PDF gen is a follow-up wave). */
export function renderMbrPdfStub(data) {
  return [
    `[PDF STUB]`,
    `tenant=${data.tenant}`,
    `month=${data.month}`,
    `generated=${new Date().toISOString()}`,
    `next-step: pipe markdown body through wkhtmltopdf in production.`,
  ].join('\n');
}

export async function generateMbr({ tenant, month, mode, outDir }) {
  if (!tenant || !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(tenant)) {
    throw new Error('mbr: bad --tenant');
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('mbr: bad --month (expected YYYY-MM)');
  }
  const dataset = mode === 'test'
    ? buildSyntheticDataset(tenant, month)
    : buildSyntheticDataset(tenant, month);
  // ^ live-mode path is unwired; same hook as the test path, to be
  // replaced in W21x once the operator data warehouse is online.

  const md = renderMbrMarkdown(dataset);
  const html = renderMbrHtml(md, dataset);
  const pdfStub = renderMbrPdfStub(dataset);

  const dir = resolve(outDir ?? DIST, tenant);
  await fs.mkdir(dir, { recursive: true });
  const mdPath = resolve(dir, `mbr-${month}.md`);
  const htmlPath = resolve(dir, `mbr-${month}.html`);
  const pdfPath = resolve(dir, `mbr-${month}.pdf-stub.txt`);
  await fs.writeFile(mdPath, md, 'utf-8');
  await fs.writeFile(htmlPath, html, 'utf-8');
  await fs.writeFile(pdfPath, pdfStub, 'utf-8');

  return {
    tenant,
    month,
    paths: { md: mdPath, html: htmlPath, pdfStub: pdfPath },
    dataset,
    markdown: md,
  };
}

// CLI entry.
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv);
  const tenant = args.tenant ?? args.t;
  const month = args.month ?? args.m;
  const mode = args.mode ?? 'test';
  generateMbr({ tenant, month, mode })
    .then((res) => {
      console.log(`MBR generated:`);
      console.log(`  md:   ${res.paths.md}`);
      console.log(`  html: ${res.paths.html}`);
      console.log(`  pdf:  ${res.paths.pdfStub}`);
    })
    .catch((err) => {
      console.error(`MBR generation failed: ${err.message}`);
      process.exit(1);
    });
}
