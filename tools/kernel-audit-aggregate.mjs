#!/usr/bin/env node
/**
 * tools/kernel-audit-aggregate.mjs
 *
 * N4 (2026-06-23) — Rolling kernel-call audit aggregator.
 *
 * Reads every reports/kernel-audit/audit-*.jsonl file and rolls up:
 *   - totalCalls
 *   - per-kernel { count, okCount, errCount, errRatePct,
 *                  paramShapesDistinct, p50ms, p95ms, lastTs }
 *   - top callers (most-invoked kernels)
 *   - error breakdown (top error reasons by occurrence)
 *   - engineMode distribution
 *
 * ## Why
 * The logger keeps a flat append-only log. Operators need a
 * single-pane summary: which kernels run most often, which are
 * failing, and how diverse the input space is. That is this tool.
 *
 * ## USAGE
 *   node tools/kernel-audit-aggregate.mjs               # rolls up + prints
 *   node tools/kernel-audit-aggregate.mjs --json        # JSON only
 *   node tools/kernel-audit-aggregate.mjs --prune 7     # also delete > 7d old
 *
 * ## OUTPUT
 *   reports/kernel-audit/summary.json
 *   stdout: ASCII summary table (box-drawing per HARD RULE #3)
 *
 * ## EXIT
 *   0 — always (empty audit dir → empty summary, still ok)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAuditDir, pruneOldAuditFiles } from './kernel-audit-logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');

/* ── Math helpers (deterministic) ─────────────────────────────────────── */

function percentile(sortedNums, p) {
  if (sortedNums.length === 0) return null;
  const idx = Math.min(sortedNums.length - 1, Math.floor((p / 100) * sortedNums.length));
  return +sortedNums[idx].toFixed(2);
}

/* ── Loader ───────────────────────────────────────────────────────────── */

export function loadAllEvents(dir = getAuditDir()) {
  const events = [];
  if (!existsSync(dir)) return events;
  const files = readdirSync(dir)
    .filter(f => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort();
  for (const f of files) {
    const path = join(dir, f);
    let raw;
    try { raw = readFileSync(path, 'utf8'); }
    catch { continue; }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed);
        if (ev && typeof ev === 'object') events.push(ev);
      } catch {
        /* skip malformed line */
      }
    }
  }
  return events;
}

/* ── Aggregation (pure) ───────────────────────────────────────────────── */

export function aggregate(events) {
  const perKernel = {};
  const errorReasons = {};
  const engineModes = {};

  for (const ev of events) {
    const k = ev.kernel || 'unknown';
    if (!perKernel[k]) {
      perKernel[k] = {
        count: 0, okCount: 0, errCount: 0,
        latencies: [], paramShapes: new Set(),
        lastTs: null, lastOk: null,
      };
    }
    const bucket = perKernel[k];
    bucket.count++;
    if (ev.ok) bucket.okCount++; else bucket.errCount++;
    if (Number.isFinite(ev.latencyMs)) bucket.latencies.push(ev.latencyMs);
    if (ev.paramsHash) bucket.paramShapes.add(ev.paramsHash);
    if (!bucket.lastTs || (ev.ts && ev.ts > bucket.lastTs)) {
      bucket.lastTs = ev.ts;
      bucket.lastOk = !!ev.ok;
    }
    if (!ev.ok && ev.errorReason) {
      errorReasons[ev.errorReason] = (errorReasons[ev.errorReason] || 0) + 1;
    }
    const mode = ev.engineMode || 'unknown';
    engineModes[mode] = (engineModes[mode] || 0) + 1;
  }

  /* Reduce per-kernel to plain serialisable shape. */
  const perKernelOut = {};
  for (const [name, b] of Object.entries(perKernel)) {
    const sorted = [...b.latencies].sort((a, b) => a - b);
    perKernelOut[name] = {
      count: b.count,
      okCount: b.okCount,
      errCount: b.errCount,
      errRatePct: b.count === 0 ? 0 : +((b.errCount / b.count) * 100).toFixed(2),
      paramShapesDistinct: b.paramShapes.size,
      p50ms: percentile(sorted, 50),
      p95ms: percentile(sorted, 95),
      maxMs: sorted.length === 0 ? null : +sorted[sorted.length - 1].toFixed(2),
      lastTs: b.lastTs,
      lastOk: b.lastOk,
    };
  }

  const topCallers = Object.entries(perKernelOut)
    .map(([name, v]) => ({ kernel: name, count: v.count, errRatePct: v.errRatePct }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topErrors = Object.entries(errorReasons)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalCalls = events.length;
  const totalErr   = events.filter(e => !e.ok).length;

  return {
    generatedAt: new Date().toISOString(),
    tool: 'tools/kernel-audit-aggregate.mjs',
    totalCalls,
    totalErr,
    errRatePct: totalCalls === 0 ? 0 : +((totalErr / totalCalls) * 100).toFixed(2),
    kernelsExercised: Object.keys(perKernelOut).length,
    engineModes,
    perKernel: perKernelOut,
    topCallers,
    topErrors,
  };
}

/* ── ASCII summary (box-drawing per HARD RULE #3) ─────────────────────── */

function pad(s, w) {
  const str = String(s ?? '');
  if (str.length >= w) return str.slice(0, w);
  return str + ' '.repeat(w - str.length);
}

export function renderSummary(summary) {
  const out = [];
  out.push('kernel-audit · rolling summary');
  out.push(`generated: ${summary.generatedAt}`);
  out.push('');
  out.push(`Total calls: ${summary.totalCalls} · errors: ${summary.totalErr} (${summary.errRatePct}%) · kernels exercised: ${summary.kernelsExercised}`);
  out.push('');

  if (summary.totalCalls === 0) {
    out.push('(no audit events — enable with KERNEL_AUDIT_LOG=1 and call kernels)');
    return out.join('\n');
  }

  /* Top callers table. */
  out.push('▌ Top callers');
  out.push('┌──────────────────────────────┬──────────┬───────────┐');
  out.push('│ Kernel                       │ Calls    │ Err %     │');
  out.push('├──────────────────────────────┼──────────┼───────────┤');
  for (const r of summary.topCallers) {
    out.push('│ ' + pad(r.kernel, 28) + ' │ ' + pad(r.count, 8) + ' │ ' + pad(r.errRatePct.toFixed(2), 9) + ' │');
  }
  out.push('└──────────────────────────────┴──────────┴───────────┘');
  out.push('');

  /* Per-kernel detail. */
  out.push('▌ Per-kernel detail');
  out.push('┌──────────────────────────────┬─────┬─────┬─────┬────────┬────────┬─────────┐');
  out.push('│ Kernel                       │ N   │ OK  │ Err │ p50 ms │ p95 ms │ shapes  │');
  out.push('├──────────────────────────────┼─────┼─────┼─────┼────────┼────────┼─────────┤');
  const sortedKernels = Object.entries(summary.perKernel)
    .sort(([, a], [, b]) => b.count - a.count);
  for (const [name, v] of sortedKernels) {
    out.push('│ ' + pad(name, 28) + ' │ ' + pad(v.count, 3) + ' │ ' +
      pad(v.okCount, 3) + ' │ ' + pad(v.errCount, 3) + ' │ ' +
      pad(v.p50ms ?? '—', 6) + ' │ ' + pad(v.p95ms ?? '—', 6) + ' │ ' +
      pad(v.paramShapesDistinct, 7) + ' │');
  }
  out.push('└──────────────────────────────┴─────┴─────┴─────┴────────┴────────┴─────────┘');
  out.push('');

  /* Error reasons (if any). */
  if (summary.topErrors.length > 0) {
    out.push('▌ Top error reasons');
    for (const e of summary.topErrors) {
      out.push(`  ${pad(e.count, 4)} × ${e.reason}`);
    }
    out.push('');
  }

  /* Engine mode distribution. */
  out.push('▌ Engine mode distribution');
  for (const [mode, count] of Object.entries(summary.engineModes).sort(([, a], [, b]) => b - a)) {
    out.push(`  ${pad(mode, 18)} ${count}`);
  }
  out.push('');

  return out.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('kernel-audit-aggregate.mjs')) {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const pruneIdx = args.indexOf('--prune');
  const pruneDays = pruneIdx >= 0 ? parseInt(args[pruneIdx + 1] || '14', 10) : null;

  if (pruneDays != null) {
    const removed = await pruneOldAuditFiles(pruneDays);
    if (removed.length > 0 && !jsonOnly) {
      console.log(`▸ pruned ${removed.length} old files: ${removed.join(', ')}`);
    }
  }

  const events = loadAllEvents();
  const summary = aggregate(events);

  /* Persist summary JSON. */
  const dir = getAuditDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));

  if (jsonOnly) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(renderSummary(summary));
    console.log(`✓ summary  →  ${join(dir, 'summary.json')}`);
  }
  process.exit(0);
}

export default { loadAllEvents, aggregate, renderSummary };
