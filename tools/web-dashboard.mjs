#!/usr/bin/env node
/**
 * tools/web-dashboard.mjs
 *
 * N3 (2026-06-23) — Single-file static web dashboard generator.
 *
 * Aggregates every existing JSON report (audit-summary, portfolio,
 * one-pagers, per-game-kernel-coverage, latest cross-game-rtp) into
 * ONE self-contained HTML file that an operator opens locally or
 * serves on the existing dev-server (5180) — no CLI required, no
 * framework, no network calls at view time.
 *
 * ## Why
 * N1 produced per-game one-pagers and N2 produced pairwise diffs, but
 * both are CLI-only. Compliance and BD teams want a clickable view of
 * the full portfolio. A static HTML keeps the deployment trivial (one
 * file, scp-able) and the audit trail honest (data is frozen at the
 * moment generation ran, embedded as inline JSON).
 *
 * ## Architecture
 *   loadDashboardData()        → pure async loader (reports/*.json)
 *   renderHtml(data)           → pure string builder (no I/O)
 *   The HTML embeds all data as a JSON script tag (`#dashboard-data`)
 *   so the in-browser JS can read/render without a fetch round-trip.
 *
 * ## Sections (in render order)
 *   1. Header: overall verdict badge + generated-at + portfolio size
 *   2. Portfolio table (5 baselines, sortable client-side)
 *   3. Per-game cards (collapsible — basics/symbols/features/kernels)
 *   4. Compare picker (two dropdowns → live diff rendered client-side,
 *      reuses same one-pager data already embedded)
 *   5. Kernel applicability matrix (games × top kernels, ✓/—)
 *
 * ## Lifecycle
 *   - Pure module — no I/O at import time.
 *   - CLI block guarded by `process.argv[1]?.endsWith('web-dashboard.mjs')`.
 *
 * ## Performance
 *   - Loader is I/O bound (5-10 small JSON reads, parallel) — < 100ms.
 *   - Render is string concat, dominated by JSON.stringify of embedded
 *     payload (~50-200KB).
 *   - Generated file size: < 500KB typical. No external requests at
 *     view time — opens offline.
 *
 * ## Accessibility
 *   - Semantic HTML (table/thead/tbody, header/main/section).
 *   - Sufficient contrast in dark theme (#0f172a bg, #e2e8f0 fg).
 *   - All interactive elements (dropdowns, expand buttons) are real
 *     <button>/<select>, not divs with click handlers.
 *   - Status colours redundantly encoded with both colour AND glyph
 *     (🟢/🟡/🔴/◌) AND text label.
 *
 * ## USAGE
 *   node tools/web-dashboard.mjs              # writes reports/dashboard/index.html
 *   node tools/web-dashboard.mjs --quiet      # suppress stdout
 *   node tools/web-dashboard.mjs --print      # also echo HTML to stdout
 *
 * ## OUTPUT
 *   reports/dashboard/index.html
 *
 * ## EXIT
 *   0 — dashboard generated
 *   2 — required reports/audit-summary.json missing (run audit first)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REPORTS    = join(REPO, 'reports');
const OUT_DIR    = join(REPORTS, 'dashboard');

const BASELINE_SLUGS = [
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
];

/* ── Data loader ──────────────────────────────────────────────────────── */

function safeRead(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function findLatestInDir(dir, prefix) {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .map(f => ({ name: f, path: join(dir, f) }))
    .sort((a, b) => b.name.localeCompare(a.name));
  return entries[0] || null;
}

/* Lazy-load the most recent corpus-wide V8 or V9 report.
 *
 * Memoized — multiple per-slug receipt lookups don't re-scan or
 * re-parse the multi-MB JSON each time. Returns
 * { bySlug: { slug → receipt }, source: filename } or null.
 *
 * Both V8 (assembly) and V9 (visual QA) corpus reports share the
 * same shape: top-level `receipts` array with one entry per slug. */
/* UQ-DEEP-A 2026-06-23 — TTL + STALENESS INVALIDATION.
 * Long-lived consumers (dev server importing this module) previously
 * memoized the first corpus report read forever; new reports on disk
 * were ignored. TTL caps cache age to 30s + remembers latest filename
 * so a newer report invalidates. */
function _loadCorpusReportFactory(prefix) {
  let cache = undefined;
  let cachedAt = 0;
  let cachedSource = null;
  const TTL_MS = 30_000;
  return function loadCorpusReport() {
    const now = Date.now();
    const latest = findLatestInDir(REPORTS, prefix);
    /* Cache invalidates when: (a) TTL expired, (b) a NEWER report
     * filename appeared since last call. */
    const stillFresh = cache !== undefined && (now - cachedAt) < TTL_MS &&
                       latest?.name === cachedSource;
    if (stillFresh) return cache;
    if (!latest) { cache = null; cachedAt = now; cachedSource = null; return null; }
    const raw = safeRead(latest.path);
    if (!raw || !Array.isArray(raw.receipts)) { cache = null; cachedAt = now; cachedSource = latest.name; return null; }
    const bySlug = {};
    for (const r of raw.receipts) {
      if (r && r.slug) bySlug[r.slug] = r;
    }
    cache = { bySlug, source: latest.name };
    cachedAt = now;
    cachedSource = latest.name;
    return cache;
  };
}
const loadV8CorpusReport = _loadCorpusReportFactory('v8-assembly-');
const loadV9CorpusReport = _loadCorpusReportFactory('v9-visual-qa-');

/* Load V8 assembly receipt for a slug.
 *
 * Three-tier search (cheapest + freshest first):
 *   1. `dist/ingest/<slug>/v8.json` — fresh ingest pipeline write
 *      (N+1 live-wire, 2026-06-23). Operators who re-run ingest see
 *      latest receipt without re-running the corpus-wide orchestrator.
 *   2. `dist/real-games/<slug>/v8.json` — per-slug corpus snapshot
 *      (future extension; currently NOT written but reserved).
 *   3. Most recent `reports/v8-assembly-*.json` receipts[slug] —
 *      corpus orchestrator run covers all 338 slugs in one go and
 *      is the default for the baseline dashboard view.
 *
 * Returns null if no tier matches — dashboard renders a placeholder. */
function loadV8Receipt(slug) {
  const candidates = [
    join(REPO, 'dist/ingest', slug, 'v8.json'),
    join(REPO, 'dist/real-games', slug, 'v8.json'),
  ];
  for (const p of candidates) {
    const r = safeRead(p);
    if (r) return { ...r, __source__: p.replace(REPO + '/', '') };
  }
  const corpus = loadV8CorpusReport();
  if (corpus && corpus.bySlug[slug]) {
    return { ...corpus.bySlug[slug], __source__: `reports/${corpus.source}` };
  }
  return null;
}

/* Symmetric loader for V9 receipts (per-game visual-QA verdict). */
function loadV9Receipt(slug) {
  const candidates = [
    join(REPO, 'dist/ingest', slug, 'v9.json'),
    join(REPO, 'dist/real-games', slug, 'v9.json'),
  ];
  for (const p of candidates) {
    const r = safeRead(p);
    if (r) return { ...r, __source__: p.replace(REPO + '/', '') };
  }
  const corpus = loadV9CorpusReport();
  if (corpus && corpus.bySlug[slug]) {
    return { ...corpus.bySlug[slug], __source__: `reports/${corpus.source}` };
  }
  return null;
}

async function loadDashboardData() {
  const auditSummary  = safeRead(join(REPORTS, 'audit-summary.json'));
  const portfolio     = safeRead(join(REPORTS, 'portfolio-report.json'));
  const crossGame     = findLatestInDir(join(REPORTS, 'cross-game-rtp'), 'cross-game-');
  const crossGameJson = crossGame ? safeRead(crossGame.path) : null;
  const onePagers     = {};
  const coverage      = {};
  const v8Receipts    = {};
  const v9Receipts    = {};
  for (const slug of BASELINE_SLUGS) {
    onePagers[slug] = safeRead(join(REPORTS, 'gdd-one-pagers', `${slug}.json`));
    coverage[slug]  = safeRead(join(REPORTS, 'per-game-kernel-coverage', `${slug}.json`));
    v8Receipts[slug] = loadV8Receipt(slug);
    v9Receipts[slug] = loadV9Receipt(slug);
  }
  return {
    generatedAt: new Date().toISOString(),
    tool: 'tools/web-dashboard.mjs',
    auditSummary,
    portfolio,
    crossGame: crossGameJson,
    crossGameSource: crossGame?.name || null,
    onePagers,
    coverage,
    v8Receipts,
    v9Receipts,
    baselines: BASELINE_SLUGS,
  };
}

/* ── HTML escape ──────────────────────────────────────────────────────── */

const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => escMap[c]);

const VERDICT_BADGE = {
  GREEN:       { glyph: '🟢', label: 'GREEN',       cls: 'badge-green' },
  AMBER:       { glyph: '🟡', label: 'AMBER',       cls: 'badge-amber' },
  RED:         { glyph: '🔴', label: 'RED',         cls: 'badge-red' },
  CONVERGED:   { glyph: '🟢', label: 'CONVERGED',   cls: 'badge-green' },
  CLOSE:       { glyph: '🟡', label: 'CLOSE',       cls: 'badge-amber' },
  DIVERGED:    { glyph: '🔴', label: 'DIVERGED',    cls: 'badge-red' },
  NON_BINDING: { glyph: '◌',  label: 'NON_BINDING', cls: 'badge-neutral' },
  /* V8 assembly receipt verdicts (N+1 live wire 2026-06-23). */
  PASS:        { glyph: '🟢', label: 'PASS',        cls: 'badge-green' },
  WARN:        { glyph: '🟡', label: 'WARN',        cls: 'badge-amber' },
  FAIL:        { glyph: '🔴', label: 'FAIL',        cls: 'badge-red' },
  UNKNOWN:     { glyph: '?',  label: 'UNKNOWN',     cls: 'badge-neutral' },
};

function badge(verdict) {
  const v = VERDICT_BADGE[verdict] || VERDICT_BADGE.UNKNOWN;
  return `<span class="badge ${v.cls}" aria-label="${esc(v.label)} verdict">${v.glyph} ${esc(v.label)}</span>`;
}

/* ── Renderers (pure) ─────────────────────────────────────────────────── */

function renderHeader(data) {
  const verdict = data.auditSummary?.overallVerdict || 'UNKNOWN';
  const count   = data.baselines.length;
  return `
<header class="hdr">
  <div class="hdr-left">
    <h1>slot-gdd-factory · operator dashboard</h1>
    <p class="muted">${count} baseline games · generated ${esc(data.generatedAt)}</p>
  </div>
  <div class="hdr-right">${badge(verdict)}</div>
</header>`;
}

function renderPortfolioTable(data) {
  const rows = data.baselines.map(slug => {
    const op  = data.onePagers[slug];
    const cov = data.coverage[slug];
    if (!op?.ok) {
      return `<tr><td><code>${esc(slug)}</code></td><td colspan="6" class="err">missing one-pager</td></tr>`;
    }
    const conv = op.convergence || {};
    return `<tr>
      <td><code>${esc(slug)}</code></td>
      <td>${esc(op.basics.topology)}</td>
      <td class="num">${esc(op.basics.declaredRTP ?? '—')}${op.basics.declaredRTP != null ? '%' : ''}</td>
      <td class="num">${op.basics.reels ?? '?'}×${op.basics.rows ?? '?'}</td>
      <td class="num">${esc(op.basics.maxWinX ?? '—')}</td>
      <td class="num">${op.kernels.ok}/${op.kernels.applicable}</td>
      <td>${badge(conv.verdict)} <small>op</small> ${badge(conv.honestVerdict)} <small>honest</small></td>
    </tr>`;
  }).join('\n');
  return `
<section class="card" id="portfolio">
  <h2>1. Portfolio</h2>
  <table>
    <thead>
      <tr>
        <th>Slug</th><th>Topology</th><th>Declared RTP</th>
        <th>Reels × Rows</th><th>Max win ×bet</th><th>Kernels ok</th><th>Verdict</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

/* Render V8 assembly receipt panel for a single game.
 *
 * Shows: verdict badge, selected engine, enabled/disabled counts,
 * conflicts (red), missing mandatory (red), top 5 enabled blocks
 * sorted by audit-trail priority. Empty state when no receipt found.
 *
 * Why a per-game panel: operator + regulator need to see WHICH blocks
 * were assembled and WHY — receipt is the assembly audit trail. Top 5
 * keeps the card compact; full enabled list is in the embedded JSON
 * (visible in v8.json download / browser DevTools).
 */
function renderV8Panel(receipt) {
  if (!receipt) {
    return `<h3>V8 Assembly</h3><p class="muted"><em>no receipt — run <code>node tools/ingest.mjs --file …</code></em></p>`;
  }
  const verdict = receipt.verdict || 'UNKNOWN';
  const enabled = receipt.assembly?.enabledBlocks || [];
  const disabled = receipt.assembly?.disabledBlocks || [];
  const conflicts = receipt.conflicts || [];
  const missing = receipt.missingMandatory || [];
  const engine = receipt.__meta__?.selectedEngine || '—';
  const topBlocks = enabled.slice(0, 5).map(b => `<code>${esc(b)}</code>`).join(' · ') || '<em>none</em>';
  const conflictBlock = conflicts.length > 0
    ? `<dt class="err">Conflicts</dt><dd class="err">${conflicts.length}: ${conflicts.slice(0, 2).map(c => `<code>${esc(c.blocks.join('+'))}</code>`).join(', ')}</dd>`
    : '';
  const missingBlock = missing.length > 0
    ? `<dt class="err">Missing mandatory</dt><dd class="err">${missing.map(m => `<code>${esc(m)}</code>`).join(', ')}</dd>`
    : '';
  return `
      <h3>V8 Assembly · ${badge(verdict)}</h3>
      <dl>
        <dt>Engine</dt><dd><code>${esc(engine)}</code></dd>
        <dt>Enabled</dt><dd>${enabled.length} <span class="muted">blocks</span></dd>
        <dt>Disabled</dt><dd>${disabled.length} <span class="muted">blocks</span></dd>
        ${conflictBlock}
        ${missingBlock}
        <dt>Top 5</dt><dd>${topBlocks}</dd>
      </dl>`;
}

/* Render V9 visual QA receipt panel for a single game.
 *
 * V9 is the deterministic structural-QA twin of V8: where V8 audits
 * which blocks the rule engine decided to MOUNT, V9 audits whether
 * the built HTML actually reflects those decisions (paytable rows,
 * hub controls, viewport, manifest, engine marker). Shows verdict
 * badge, numeric score (0..10), and any failed/warned check names so
 * the operator can drill into the specific regression. */
function renderV9Panel(receipt) {
  if (!receipt) {
    return `<h3>V9 Visual QA</h3><p class="muted"><em>no receipt — run <code>node tools/ingest.mjs --file …</code></em></p>`;
  }
  const verdict = receipt.verdict || 'UNKNOWN';
  const score = typeof receipt.score === 'number' ? receipt.score.toFixed(1) : '—';
  const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
  const pass = checks.filter(c => c.verdict === 'PASS').length;
  const warn = checks.filter(c => c.verdict === 'WARN').length;
  const fail = checks.filter(c => c.verdict === 'FAIL').length;
  const flaggedNames = checks.filter(c => c.verdict !== 'PASS').map(c => c.name).slice(0, 3);
  const flagged = flaggedNames.length > 0
    ? `<dt>Flagged</dt><dd>${flaggedNames.map(n => `<code>${esc(n)}</code>`).join(', ')}${checks.filter(c => c.verdict !== 'PASS').length > 3 ? ' …' : ''}</dd>`
    : '';
  return `
      <h3>V9 Visual QA · ${badge(verdict)}</h3>
      <dl>
        <dt>Score</dt><dd><strong>${score}</strong>/10</dd>
        <dt>Checks</dt><dd>${pass} PASS · ${warn} WARN · ${fail} FAIL</dd>
        ${flagged}
      </dl>`;
}

function renderGameCard(slug, op, v8, v9) {
  if (!op?.ok) {
    return `<details class="game-card err"><summary><code>${esc(slug)}</code> — <span class="err">missing</span></summary></details>`;
  }
  const f = op.features.map(x => `<code>${esc(x)}</code>`).join(' · ') || '<em>none</em>';
  const top = (op.kernels.top3 || []).map(
    k => `<li><code>${esc(k.name)}</code> <span class="muted">${k.rtpContribution.toFixed(4)}× bet</span></li>`,
  ).join('') || '<li><em>no scoring kernels</em></li>';
  const conv = op.convergence || {};
  const v8VerdictBadge = v8 ? ` · V8 ${badge(v8.verdict)}` : '';
  const v9VerdictBadge = v9 ? ` · V9 ${badge(v9.verdict)}` : '';
  return `
<details class="game-card">
  <summary><code>${esc(slug)}</code> · ${esc(op.basics.topology)} · RTP ${esc(op.basics.declaredRTP ?? '?')}% · ${badge(conv.verdict)}${v8VerdictBadge}${v9VerdictBadge}</summary>
  <div class="game-body">
    <div class="game-col">
      <h3>Basics</h3>
      <dl>
        <dt>Topology</dt><dd><code>${esc(op.basics.topology)}</code> (eval: ${esc(op.basics.evaluation ?? '—')})</dd>
        <dt>Reels × Rows</dt><dd>${op.basics.reels ?? '?'} × ${op.basics.rows ?? '?'}</dd>
        <dt>Paylines</dt><dd>${esc(op.basics.paylines ?? '—')}</dd>
        <dt>Declared RTP</dt><dd>${esc(op.basics.declaredRTP ?? '—')}% <small class="muted">(${esc(op.basics.declaredRTPSource ?? '—')})</small></dd>
        <dt>Max win</dt><dd>${esc(op.basics.maxWinX ?? '—')}× bet</dd>
        <dt>Volatility</dt><dd>${esc(op.basics.volatilityIdx ?? '—')}/10</dd>
      </dl>
    </div>
    <div class="game-col">
      <h3>Symbols</h3>
      <dl>
        <dt>High / Low</dt><dd>${op.symbols.highCount} / ${op.symbols.lowCount}</dd>
        <dt>Scatter / Wild</dt><dd>${op.symbols.hasScatter ? '✓' : '—'} / ${op.symbols.hasWild ? '✓' : '—'}</dd>
      </dl>
      <h3>Top kernels</h3>
      <ol>${top}</ol>
    </div>
    <div class="game-col">
      <h3>Features</h3>
      <p>${f}</p>
      <h3>Convergence</h3>
      <dl>
        <dt>Operator</dt><dd>${badge(conv.verdict)} Δ=${esc(conv.rtpDelta ?? '—')}pp</dd>
        <dt>Honest</dt><dd>${badge(conv.honestVerdict)} Δ=${esc(conv.rawRtpDelta ?? '—')}pp</dd>
        <dt>Synthetic</dt><dd>${conv.isSynthetic ? '⚠ yes' : 'no'}</dd>
      </dl>
${renderV8Panel(v8)}
${renderV9Panel(v9)}
    </div>
  </div>
</details>`;
}

function renderGamesSection(data) {
  const cards = data.baselines.map(slug => renderGameCard(slug, data.onePagers[slug], data.v8Receipts?.[slug], data.v9Receipts?.[slug])).join('\n');
  return `
<section class="card" id="games">
  <h2>2. Per-game deep-dive</h2>
  <p class="muted">Click a row to expand basics / symbols / features / convergence.</p>
  ${cards}
</section>`;
}

function renderCompareSection(data) {
  const opts = data.baselines.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  return `
<section class="card" id="compare">
  <h2>3. Side-by-side compare (live)</h2>
  <p class="muted">Pick two slugs — diff is computed in-browser from embedded one-pager data.</p>
  <div class="compare-controls">
    <label>A <select id="cmp-a">${opts}</select></label>
    <label>B <select id="cmp-b">${opts}</select></label>
    <button type="button" id="cmp-go">Compare</button>
  </div>
  <div id="cmp-out"><em class="muted">— pick two slugs and press Compare —</em></div>
</section>`;
}

function renderKernelMatrix(data) {
  /* Collect all kernel names across all one-pagers (top3 + coverage). */
  const allKernels = new Set();
  const perGameSet = {};
  for (const slug of data.baselines) {
    const cov = data.coverage[slug];
    perGameSet[slug] = new Set();
    if (cov?.kernels) {
      for (const k of cov.kernels) {
        if (k.ok) {
          allKernels.add(k.name);
          perGameSet[slug].add(k.name);
        }
      }
    }
  }
  const kernels = [...allKernels].sort();
  if (kernels.length === 0) {
    return `<section class="card" id="matrix"><h2>4. Kernel applicability matrix</h2><p><em>no kernel coverage data</em></p></section>`;
  }
  const head = `<tr><th>Kernel</th>${data.baselines.map(s => `<th><code>${esc(s.split('-')[0])}</code></th>`).join('')}<th>Σ</th></tr>`;
  const body = kernels.map(k => {
    const cells = data.baselines.map(s => perGameSet[s].has(k) ? '<td class="ok">✓</td>' : '<td class="dim">—</td>').join('');
    const sum = data.baselines.filter(s => perGameSet[s].has(k)).length;
    return `<tr><td><code>${esc(k)}</code></td>${cells}<td class="num">${sum}</td></tr>`;
  }).join('\n');
  return `
<section class="card" id="matrix">
  <h2>4. Kernel applicability matrix</h2>
  <p class="muted">${kernels.length} unique kernels across ${data.baselines.length} games.</p>
  <table class="matrix">
    <thead>${head}</thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

/* ── CSS + client JS (inline, no external deps) ───────────────────────── */

const CSS = `
:root {
  --bg: #0f172a; --bg-2: #1e293b; --fg: #e2e8f0; --muted: #94a3b8;
  --accent: #38bdf8; --border: #334155;
  --green: #16a34a; --amber: #d97706; --red: #dc2626; --neutral: #64748b;
}
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
       background: var(--bg); color: var(--fg); margin: 0; padding: 1.5rem;
       max-width: 1400px; margin-inline: auto; line-height: 1.5; }
h1, h2, h3 { color: var(--accent); margin-top: 0; }
h1 { font-size: 1.6rem; }
h2 { font-size: 1.2rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
h3 { font-size: 0.95rem; color: var(--fg); margin-bottom: 0.4rem; }
.muted { color: var(--muted); font-size: 0.9rem; }
.err { color: var(--red); }
code { background: var(--bg-2); padding: 0.1rem 0.4rem; border-radius: 3px;
       font-family: 'SF Mono', Menlo, monospace; font-size: 0.88em; }
.hdr { display: flex; justify-content: space-between; align-items: center;
       border-bottom: 2px solid var(--border); padding-bottom: 1rem; margin-bottom: 1.5rem; }
.hdr-right { font-size: 1.2rem; }
.card { background: var(--bg-2); border: 1px solid var(--border);
        border-radius: 8px; padding: 1.2rem; margin-bottom: 1.5rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
th, td { padding: 0.5rem 0.7rem; text-align: left; border-bottom: 1px solid var(--border); }
th { color: var(--accent); font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.ok { color: var(--green); text-align: center; }
td.dim { color: var(--neutral); text-align: center; }
.matrix { font-size: 0.85rem; }
.matrix td, .matrix th { padding: 0.3rem 0.5rem; }
.badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px;
         font-size: 0.78rem; font-weight: 600; border: 1px solid currentColor; }
.badge-green { color: var(--green); }
.badge-amber { color: var(--amber); }
.badge-red   { color: var(--red); }
.badge-neutral { color: var(--neutral); }
.game-card { background: var(--bg); border: 1px solid var(--border);
             border-radius: 6px; padding: 0.6rem 0.9rem; margin-bottom: 0.5rem; }
.game-card[open] { background: var(--bg-2); }
.game-card summary { cursor: pointer; padding: 0.3rem 0; }
.game-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
             gap: 1.2rem; padding-top: 0.8rem; }
.game-col dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 0.7rem; margin: 0; }
.game-col dt { color: var(--muted); font-size: 0.85rem; }
.game-col dd { margin: 0; font-size: 0.9rem; }
.game-col ol { padding-left: 1.2rem; margin: 0.2rem 0; }
.compare-controls { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;
                    margin-bottom: 1rem; }
.compare-controls label { color: var(--muted); }
select, button { background: var(--bg); color: var(--fg); border: 1px solid var(--border);
                 border-radius: 4px; padding: 0.4rem 0.7rem; font-size: 0.9rem; }
button { cursor: pointer; background: var(--accent); color: var(--bg); border-color: var(--accent);
         font-weight: 600; }
button:hover { opacity: 0.85; }
#cmp-out table { font-size: 0.88rem; }
small { color: var(--muted); }
`;

const CLIENT_JS = `
(function () {
  const dataEl = document.getElementById('dashboard-data');
  if (!dataEl) { console.error('no dashboard data'); return; }
  let data;
  try { data = JSON.parse(dataEl.textContent); }
  catch (e) { console.error('bad dashboard data', e); return; }

  const eq = (a, b) => {
    if (a === b) return true;
    if (a == null && b == null) return true;
    return false;
  };

  function setDiff(arrA, arrB) {
    const A = new Set(arrA || []);
    const B = new Set(arrB || []);
    return {
      shared: [...A].filter(x => B.has(x)).sort(),
      onlyA:  [...A].filter(x => !B.has(x)).sort(),
      onlyB:  [...B].filter(x => !A.has(x)).sort(),
    };
  }

  function buildDiff(a, b) {
    const rows = [];
    const push = (label, va, vb) => rows.push({ label, a: va, b: vb, match: eq(va, vb) });
    push('Topology',      a.basics.topology,    b.basics.topology);
    push('Reels × Rows',  a.basics.reels + '×' + a.basics.rows, b.basics.reels + '×' + b.basics.rows);
    push('Paylines',      a.basics.paylines,    b.basics.paylines);
    push('Declared RTP',  a.basics.declaredRTP, b.basics.declaredRTP);
    push('Max win',       a.basics.maxWinX,     b.basics.maxWinX);
    push('Volatility',    a.basics.volatilityIdx, b.basics.volatilityIdx);
    push('Op verdict',    a.convergence?.verdict, b.convergence?.verdict);
    push('Honest verdict',a.convergence?.honestVerdict, b.convergence?.honestVerdict);
    return { rows, features: setDiff(a.features, b.features) };
  }

  function escHtml(s) {
    return String(s == null ? '—' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function renderDiff(slugA, slugB) {
    const a = data.onePagers[slugA];
    const b = data.onePagers[slugB];
    if (!a?.ok || !b?.ok) {
      return '<p class="err">One or both slugs lack one-pager data.</p>';
    }
    const d = buildDiff(a, b);
    const rowsHtml = d.rows.map(r =>
      '<tr><td>' + escHtml(r.label) + '</td><td>' + escHtml(r.a) + '</td><td>' + escHtml(r.b) +
      '</td><td>' + (r.match ? '=' : '<strong>≠</strong>') + '</td></tr>'
    ).join('');
    const shared = d.features.shared.map(x => '<code>' + escHtml(x) + '</code>').join(' ') || '<em>none</em>';
    const onlyA  = d.features.onlyA.map(x => '<code>' + escHtml(x) + '</code>').join(' ') || '<em>none</em>';
    const onlyB  = d.features.onlyB.map(x => '<code>' + escHtml(x) + '</code>').join(' ') || '<em>none</em>';
    return [
      '<table><thead><tr><th>Field</th><th>' + escHtml(slugA) + '</th><th>' + escHtml(slugB) + '</th><th>Same</th></tr></thead>',
      '<tbody>' + rowsHtml + '</tbody></table>',
      '<h3 style="margin-top:1rem">Features</h3>',
      '<p><small class="muted">shared (' + d.features.shared.length + '):</small> ' + shared + '</p>',
      '<p><small class="muted">only A (' + d.features.onlyA.length + '):</small> ' + onlyA + '</p>',
      '<p><small class="muted">only B (' + d.features.onlyB.length + '):</small> ' + onlyB + '</p>',
    ].join('\\n');
  }

  const btn = document.getElementById('cmp-go');
  const out = document.getElementById('cmp-out');
  const selA = document.getElementById('cmp-a');
  const selB = document.getElementById('cmp-b');
  if (selA && selB && data.baselines.length > 1) selB.value = data.baselines[1];
  if (btn) btn.addEventListener('click', () => {
    out.innerHTML = renderDiff(selA.value, selB.value);
  });
})();
`;

/* ── Top-level HTML assembly ──────────────────────────────────────────── */

/* JSON embedded in <script type="application/json"> is parsed as raw
 * script data: HTML entities are NOT decoded. We therefore must NOT
 * html-escape the body. We only neutralise sequences that could close
 * the script tag early (`</...`) or open an HTML comment that some
 * parsers act on (`<!--`). This is the OWASP-recommended pattern. */
function embedJsonSafely(json) {
  return json
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--')
    .replace(/<script/gi, '<\\script');
}

function renderHtml(data) {
  const dataJson = JSON.stringify(data, null, 0);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>slot-gdd-factory · operator dashboard</title>
  <style>${CSS}</style>
</head>
<body>
${renderHeader(data)}
<main>
  ${renderPortfolioTable(data)}
  ${renderGamesSection(data)}
  ${renderCompareSection(data)}
  ${renderKernelMatrix(data)}
</main>
<footer class="muted" style="text-align:center;margin-top:2rem;font-size:0.85rem;">
  Generated by <code>tools/web-dashboard.mjs</code> · static HTML · no network calls at view time.
</footer>
<script type="application/json" id="dashboard-data">${embedJsonSafely(dataJson)}</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('web-dashboard.mjs')) {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const printOut = args.includes('--print');

  const auditPath = join(REPORTS, 'audit-summary.json');
  if (!existsSync(auditPath)) {
    console.error(`▸ ${auditPath} missing — run tools/audit-summary.mjs first`);
    process.exit(2);
  }
  const data = await loadDashboardData();
  const html = renderHtml(data);
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, 'index.html');
  writeFileSync(outPath, html);
  if (!quiet) console.log(`✓ dashboard  →  ${outPath}  (${(html.length / 1024).toFixed(1)}KB)`);
  if (printOut) console.log(html);
  process.exit(0);
}

export { loadDashboardData, renderHtml, renderHeader, renderPortfolioTable, renderGamesSection, renderCompareSection, renderKernelMatrix };
