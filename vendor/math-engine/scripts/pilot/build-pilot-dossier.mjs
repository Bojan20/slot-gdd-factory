#!/usr/bin/env node
/**
 * W211 Faza 700.0 — Real Vendor B Pilot Onboard — Dossier generator.
 *
 * Builds a publishable, 12-section evaluation dossier for the pilot
 * tenant. Sources:
 *   - dist/pilot/lw-pilot-tenant.json         (from pilot:seed)
 *   - dist/pilot/integration-suite-latest.json (from pilot:integration)
 *
 * Outputs:
 *   - dist/pilot/L_AND_W_PILOT_DOSSIER.md
 *   - dist/pilot/L_AND_W_PILOT_DOSSIER.html (printer-ready, vanilla CSS)
 *
 * No external deps — pure Node stdlib + repo files.
 */
import { promises as fs, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseArgs(argv) {
  const a = { out: 'dist/pilot' };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--state=')) a.state = arg.slice(8);
    else if (arg.startsWith('--suite=')) a.suite = arg.slice(8);
    else if (arg.startsWith('--out=')) a.out = arg.slice(6);
  }
  return a;
}

export const SECTION_TITLES = [
  'Executive Summary',
  'Pilot Tenant Overview',
  'Wallet Integration Verification',
  'Catalog Acceptance',
  'License Compliance',
  'Spin Determinism Proof',
  'RTP Accuracy Verification',
  'Performance Profile',
  'Canary Deployment Trace',
  'Rollback Readiness',
  'Cert Lab Submission Sample',
  'Revenue & Cost Model',
];

export async function loadSources(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const statePath = resolve(root, opts.state ?? 'dist/pilot/lw-pilot-tenant.json');
  const suitePath = resolve(root, opts.suite ?? 'dist/pilot/integration-suite-latest.json');
  if (!existsSync(statePath)) {
    throw new Error(`pilot state not found at ${statePath} — run pilot:seed first`);
  }
  if (!existsSync(suitePath)) {
    throw new Error(`integration suite results not found at ${suitePath} — run pilot:integration first`);
  }
  return {
    state: JSON.parse(await fs.readFile(statePath, 'utf8')),
    suite: JSON.parse(await fs.readFile(suitePath, 'utf8')),
  };
}

function findVerdict(suite, id) {
  return (suite.verdicts ?? []).find((v) => v.step === id) ?? null;
}

export function renderMarkdown(state, suite) {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`# Vendor B Pilot Evaluation Dossier`);
  lines.push(``);
  lines.push(`**Tenant:** ${state.tenant.name}`);
  lines.push(`**Tenant ID:** \`${state.tenant.id}\``);
  lines.push(`**Jurisdictions:** ${state.tenant.jurisdictions.join(', ')}`);
  lines.push(`**Generated:** ${today}`);
  lines.push(`**Run ID:** \`${suite.runId}\``);
  lines.push(``);

  // ── 1. Executive Summary ─────────────────────────────────────────────────
  lines.push(`## 1. ${SECTION_TITLES[0]}`);
  lines.push(``);
  lines.push(`This dossier evaluates the readiness of \`${state.tenant.name}\` to`);
  lines.push(`enter production on the slot-math-engine platform. The 10-step`);
  lines.push(`integration suite executed end-to-end across auth, wallet,`);
  lines.push(`catalog, spin engine, audit chain, cert export, canary, and`);
  lines.push(`rollback layers.`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Steps PASS / total | ${suite.passCount} / ${suite.verdicts.length} |`);
  lines.push(`| Overall verdict | **${suite.overallOk ? 'PASS' : 'FAIL'}** |`);
  lines.push(`| Total elapsed | ${suite.totalElapsedMs} ms |`);
  lines.push(`| Tenant seed hash | \`${state.initialStateHash.slice(0, 32)}…\` |`);
  lines.push(``);

  // ── 2. Pilot Tenant Overview ─────────────────────────────────────────────
  lines.push(`## 2. ${SECTION_TITLES[1]}`);
  lines.push(``);
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Operator | ${state.tenant.name} |`);
  lines.push(`| Contact | ${state.tenant.contactEmail ?? '-'} |`);
  lines.push(`| Jurisdictions | ${state.tenant.jurisdictions.join(', ')} |`);
  lines.push(`| Regulators | ${state.tenant.regulators.join(', ')} |`);
  lines.push(`| Currency | ${state.tenant.defaultCurrency} |`);
  lines.push(`| Templates installed | ${state.installedTemplates.length} |`);
  lines.push(`| Demo players | ${state.players.length} |`);
  lines.push(``);
  lines.push(`Installed templates:`);
  lines.push(``);
  for (const t of state.installedTemplates) {
    lines.push(`- \`${t.templateId}\` — ${t.displayName} (RTP target ${t.rtpTarget}%, gap ${t.lwGapTarget ?? '-'})`);
  }
  lines.push(``);

  // ── 3. Wallet Integration Verification ───────────────────────────────────
  const wallet = findVerdict(suite, 'wallet-handshake');
  lines.push(`## 3. ${SECTION_TITLES[2]}`);
  lines.push(``);
  lines.push(`Provider: **${state.wallet.provider}** at \`${state.wallet.baseUrl}\``);
  lines.push(``);
  lines.push(`Secret stored encrypted: \`${(state.wallet.apiSecretEncrypted ?? '').slice(0, 24)}…\`.`);
  lines.push(``);
  if (wallet) {
    lines.push(`| Healthcheck metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Verdict | ${wallet.ok ? 'PASS' : 'FAIL'} |`);
    lines.push(`| Latency | ${wallet.metrics?.healthcheckLatencyMs ?? '-'} ms |`);
    lines.push(`| Player balances loaded | ${wallet.metrics?.players ?? 0} |`);
    lines.push(`| Aggregate balance (minor) | ${wallet.metrics?.aggregateBalanceMinor ?? 0} |`);
  }
  lines.push(``);

  // ── 4. Catalog Acceptance ────────────────────────────────────────────────
  const catalog = findVerdict(suite, 'catalog-browse');
  lines.push(`## 4. ${SECTION_TITLES[3]}`);
  lines.push(``);
  if (catalog) {
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Verdict | ${catalog.ok ? 'PASS' : 'FAIL'} |`);
    lines.push(`| Templates installed | ${catalog.metrics?.totalInstalled ?? 0} |`);
    lines.push(`| Marketplace catalog size | ${catalog.metrics?.catalogSize ?? 0} |`);
    lines.push(`| Vendor B M5 matches | ${catalog.metrics?.m5Matches ?? 0} |`);
  }
  lines.push(``);
  lines.push(`Certification badges asserted (kernel acceptance gates passed in W202–W210).`);
  lines.push(``);

  // ── 5. License Compliance ────────────────────────────────────────────────
  const lic = findVerdict(suite, 'license-verify');
  lines.push(`## 5. ${SECTION_TITLES[4]}`);
  lines.push(``);
  if (lic) {
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Verdict | ${lic.ok ? 'PASS' : 'FAIL'} |`);
    lines.push(`| JWTs verified | ${lic.metrics?.verified ?? 0} of ${lic.metrics?.total ?? 0} |`);
    lines.push(`| Issues | ${(lic.metrics?.issues ?? []).length === 0 ? '_none_' : (lic.metrics?.issues ?? []).join(', ')} |`);
  }
  lines.push(``);
  lines.push(`All licenses are perpetual under the W209 marketplace terms`);
  lines.push(`(revenue share applies post-launch via the payout engine).`);
  lines.push(``);

  // ── 6. Spin Determinism Proof ────────────────────────────────────────────
  const single = findVerdict(suite, 'single-spin');
  const replay = findVerdict(suite, 'replay');
  lines.push(`## 6. ${SECTION_TITLES[5]}`);
  lines.push(``);
  if (single) {
    lines.push(`Single-spin audit chain advance:`);
    lines.push(``);
    lines.push(`| Field | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Player | ${single.metrics?.playerId ?? '-'} |`);
    lines.push(`| Bet (minor) | ${single.metrics?.bet ?? 0} |`);
    lines.push(`| Win (minor) | ${single.metrics?.win ?? 0} |`);
    lines.push(`| PayX | ${single.metrics?.payX ?? 0} |`);
    lines.push(`| Audit prev | \`${single.metrics?.auditPrev ?? '-'}\` |`);
    lines.push(`| Audit curr | \`${single.metrics?.auditCurr ?? '-'}\` |`);
  }
  if (replay) {
    lines.push(``);
    lines.push(`Replay determinism: **${replay.ok ? 'BIT-IDENTICAL' : 'MISMATCH'}** —`);
    lines.push(`digest A=\`${replay.metrics?.digestA ?? '-'}\`, digest B=\`${replay.metrics?.digestB ?? '-'}\`.`);
  }
  lines.push(``);

  // ── 7. RTP Accuracy ──────────────────────────────────────────────────────
  const bulk = findVerdict(suite, 'bulk-spin');
  lines.push(`## 7. ${SECTION_TITLES[6]}`);
  lines.push(``);
  if (bulk) {
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Spins simulated | ${bulk.metrics?.spins ?? 0} |`);
    lines.push(`| Target RTP | ${(((bulk.metrics?.targetRtp ?? 0) * 100)).toFixed(3)}% |`);
    lines.push(`| Measured RTP | ${(((bulk.metrics?.measuredRtp ?? 0) * 100)).toFixed(3)}% |`);
    lines.push(`| Drift (pp) | ${bulk.metrics?.driftPp ?? '-'} |`);
    lines.push(`| Within tolerance (<0.5pp) | ${bulk.metrics?.rtpOk ? 'YES' : 'NO'} |`);
  }
  lines.push(``);

  // ── 8. Performance Profile ───────────────────────────────────────────────
  lines.push(`## 8. ${SECTION_TITLES[7]}`);
  lines.push(``);
  if (bulk) {
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| p50 latency | ${bulk.metrics?.p50Ms ?? '-'} ms |`);
    lines.push(`| p95 latency | ${bulk.metrics?.p95Ms ?? '-'} ms |`);
    lines.push(`| p99 latency | ${bulk.metrics?.p99Ms ?? '-'} ms |`);
    lines.push(`| p99 SLO (<100ms) | ${bulk.metrics?.latencyOk ? 'MET' : 'BREACHED'} |`);
    lines.push(`| Throughput (spins/sec) | ${Math.round((bulk.metrics?.spins ?? 0) / Math.max(1, bulk.elapsedMs) * 1000)} |`);
  }
  lines.push(``);

  // ── 9. Canary Deployment Trace ───────────────────────────────────────────
  const canary = findVerdict(suite, 'canary');
  lines.push(`## 9. ${SECTION_TITLES[8]}`);
  lines.push(``);
  if (canary?.metrics?.transitions) {
    lines.push(`| Stage | Rollout % | RTP-drift | Errors | Latency | Replay | Verdict |`);
    lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
    for (const t of canary.metrics.transitions) {
      lines.push(
        `| ${t.stage} | ${t.rolloutPercent}% | ${t.gates.rtpDrift ? 'OK' : 'FAIL'} | ${t.gates.errorRate ? 'OK' : 'FAIL'} | ${t.gates.latency ? 'OK' : 'FAIL'} | ${t.gates.replay ? 'OK' : 'FAIL'} | ${t.ok ? 'PASS' : 'FAIL'} |`
      );
    }
  }
  lines.push(``);

  // ── 10. Rollback Readiness ───────────────────────────────────────────────
  const rb = findVerdict(suite, 'rollback');
  lines.push(`## 10. ${SECTION_TITLES[9]}`);
  lines.push(``);
  if (rb) {
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Synthetic anomaly | RTP drift ${rb.metrics?.driftPp ?? '-'} pp |`);
    lines.push(`| Trigger reason | ${rb.metrics?.triggerReason ?? '-'} |`);
    lines.push(`| Rollback verdict | ${rb.ok ? 'PASS' : 'FAIL'} |`);
    lines.push(`| RPO | ${rb.metrics?.rpoSec ?? 0} s |`);
    lines.push(`| RTO | ${rb.metrics?.rtoMs ?? '-'} ms |`);
  }
  lines.push(``);
  lines.push(`Trigger reasons enumerated: \`rtp_drift\`, \`error_rate\`, \`latency_p99\`, \`replay_nondeterministic\`.`);
  lines.push(``);

  // ── 11. Cert Lab Submission Sample ───────────────────────────────────────
  const cert = findVerdict(suite, 'cert-export');
  lines.push(`## 11. ${SECTION_TITLES[10]}`);
  lines.push(``);
  if (cert) {
    lines.push(`| Metric | Value |`);
    lines.push(`| --- | --- |`);
    lines.push(`| Verdict | ${cert.ok ? 'PASS' : 'FAIL'} |`);
    lines.push(`| Bundle filename | \`${cert.metrics?.filename ?? '-'}\` |`);
    lines.push(`| Bundle bytes | ${cert.metrics?.bytes ?? 0} |`);
    lines.push(`| Bundle sha256 | \`${cert.metrics?.sha256 ?? '-'}\` |`);
    lines.push(`| HSM-signed | ${cert.metrics?.signed ? 'YES' : 'NO'} |`);
  }
  lines.push(``);
  lines.push(`Lab adapter: GLI (jurisdiction UKGC). Equivalent bundles available`);
  lines.push(`for BMM (\`tar\`), eCOGRA (YAML manifest), and NMi via the same`);
  lines.push(`\`cert-dossier-build\` CLI.`);
  lines.push(``);

  // ── 12. Revenue & Cost Model ─────────────────────────────────────────────
  lines.push(`## 12. ${SECTION_TITLES[11]}`);
  lines.push(``);
  lines.push(`Placeholder — Agent B (W211 parallel sprint) supplies the`);
  lines.push(`detailed ROI model (per-spin cost, monthly licence fee, expected`);
  lines.push(`GGR uplift versus baseline). The integration suite's measured`);
  lines.push(`throughput of approximately ${bulk?.metrics?.spins ?? 0} spins in`);
  lines.push(`${bulk?.elapsedMs ?? 0} ms feeds the per-spin cost calculation.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`*Generated by \`scripts/pilot/build-pilot-dossier.mjs\` (W211 Faza 700.0).*`);
  lines.push(`*Source files referenced: \`dist/pilot/lw-pilot-tenant.json\`, \`dist/pilot/integration-suite-latest.json\`.*`);
  lines.push(``);
  return lines.join('\n');
}

export function markdownToHtml(md, title = 'Vendor B Pilot Evaluation Dossier') {
  // Very small md → html converter sufficient for the dossier's
  // headings/lists/tables. No external deps.
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith('# ')) {
      out.push(`<h1>${esc(ln.slice(2))}</h1>`);
      i++;
    } else if (ln.startsWith('## ')) {
      out.push(`<h2>${esc(ln.slice(3))}</h2>`);
      i++;
    } else if (ln.startsWith('### ')) {
      out.push(`<h3>${esc(ln.slice(4))}</h3>`);
      i++;
    } else if (ln.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(`<li>${inlineMd(lines[i].slice(2), esc)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
    } else if (ln.startsWith('| ')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i]);
        i++;
      }
      out.push(renderTable(rows, esc));
    } else if (ln.trim() === '---') {
      out.push('<hr/>');
      i++;
    } else if (ln.trim() === '') {
      i++;
    } else {
      // paragraph — gather until blank line
      const para = [];
      while (i < lines.length && lines[i].trim() !== '' &&
             !lines[i].startsWith('#') && !lines[i].startsWith('- ') &&
             !lines[i].startsWith('|')) {
        para.push(lines[i]);
        i++;
      }
      out.push(`<p>${inlineMd(para.join(' '), esc)}</p>`);
    }
  }
  const css = `
    body{font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:840px;margin:2em auto;padding:0 1em;color:#222;line-height:1.55}
    h1{border-bottom:2px solid #444;padding-bottom:0.25em;font-size:1.7em}
    h2{border-bottom:1px solid #aaa;padding-bottom:0.2em;margin-top:1.4em;font-size:1.25em}
    h3{margin-top:1em;font-size:1.05em}
    table{border-collapse:collapse;margin:0.6em 0;width:100%}
    th,td{border:1px solid #bbb;padding:0.35em 0.7em;text-align:left;font-size:0.95em}
    th{background:#f4f4f4}
    code{background:#f4f4f4;padding:0.05em 0.3em;border-radius:3px;font-size:0.95em}
    ul{padding-left:1.4em}
    hr{border:none;border-top:1px solid #ccc;margin:1.6em 0}
    @media print { body{margin:0;font-size:11pt} h1{page-break-before:avoid} h2{page-break-after:avoid} }
  `;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
${out.join('\n')}
</body>
</html>
`;
}

function renderTable(rows, esc) {
  // rows like '| a | b |'. Second row is divider '| --- | --- |'.
  const parsed = rows.map((r) =>
    r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  );
  if (parsed.length < 2) return '<table></table>';
  const head = parsed[0];
  const body = parsed.slice(2);
  const th = head.map((h) => `<th>${inlineMd(h, esc)}</th>`).join('');
  const trs = body.map(
    (row) => `<tr>${row.map((c) => `<td>${inlineMd(c, esc)}</td>`).join('')}</tr>`
  );
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs.join('')}</tbody></table>`;
}

function inlineMd(s, esc) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  return out;
}

export async function buildDossier(opts = {}) {
  const sources = await loadSources(opts);
  const md = renderMarkdown(sources.state, sources.suite);
  const html = markdownToHtml(md);
  const outDir = resolve(opts.root ?? REPO_ROOT, opts.out ?? 'dist/pilot');
  if (!opts.dryRun) {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(resolve(outDir, 'L_AND_W_PILOT_DOSSIER.md'), md);
    await fs.writeFile(resolve(outDir, 'L_AND_W_PILOT_DOSSIER.html'), html);
  }
  return {
    markdownPath: resolve(outDir, 'L_AND_W_PILOT_DOSSIER.md'),
    htmlPath: resolve(outDir, 'L_AND_W_PILOT_DOSSIER.html'),
    markdownBytes: Buffer.byteLength(md, 'utf8'),
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    sectionCount: SECTION_TITLES.length,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await buildDossier({
    state: args.state,
    suite: args.suite,
    out: args.out,
  });
  console.log(`✓ pilot dossier built`);
  console.log(`  markdown: ${basename(result.markdownPath)} (${result.markdownBytes} bytes)`);
  console.log(`  html:     ${basename(result.htmlPath)} (${result.htmlBytes} bytes)`);
  console.log(`  sections: ${result.sectionCount}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('build-pilot-dossier failed:', err);
    process.exit(2);
  });
}
