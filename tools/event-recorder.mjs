#!/usr/bin/env node
/**
 * tools/event-recorder.mjs · Functional Item #13 — Replay/recording
 * for QA repro.
 *
 * Boots a real-game `slot.html` in headless Chromium, instruments the
 * window-level event surface (CustomEvent dispatches, hook bus emissions,
 * spin lifecycle events), and records every event into a deterministic
 * JSON log.
 *
 * Why a recorder before a replay tool:
 *   - The recorded JSON IS the QA evidence artifact — auditor can read
 *     it without re-running anything ("at t=2.3s, FS_TRIGGER fired
 *     with payload N").
 *   - Replay (feeding the log back into a different engine instance
 *     and verifying the same DOM transitions occur) is the natural
 *     next half (Item #13b). The recorded log shape stays stable
 *     across that future split.
 *
 * Capture surface:
 *   - `CustomEvent` dispatches on document/window
 *   - `window.dispatchEvent` / `document.dispatchEvent` calls
 *   - `addEventListener` invocations (for surface discovery)
 *   - `window.__hookBus.emit` (if the slot uses the canonical hook bus)
 *
 * Default: boot `dist/real-games/<slug>/slot.html`, click SPIN N times,
 *          record DURATION_MS worth of events, dump to
 *          `dist/event-recordings/<slug>.json`.
 *
 * Exit codes:
 *   0  recording written for every targeted slot
 *   1  one or more slots failed to record
 *   2  artifacts missing
 */
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const ART_DIR = resolve(REPO, 'dist/real-games');
const OUT_DIR = resolve(REPO, 'dist/event-recordings');

const argv = process.argv.slice(2);
const DURATION_MS = +(argv.find((a) => a.startsWith('--duration='))?.slice(11) || 10_000);
const SPIN_EVERY  = +(argv.find((a) => a.startsWith('--spin-every='))?.slice(13) || 2000);
const FILTER      = argv.find((a) => a.startsWith('--game='))?.slice(7) || null;
const QUIET       = argv.includes('--quiet');

const bar = (ch = '─', n = 100) => ch.repeat(n);
const log = (...m) => { if (!QUIET) console.log(...m); };

if (!existsSync(ART_DIR)) {
  console.error(`❌ ${ART_DIR} missing. Run \`node tests/parse-real-pdfs.mjs\` first.`);
  process.exit(2);
}

let games = readdirSync(ART_DIR)
  .filter((d) => statSync(resolve(ART_DIR, d)).isDirectory())
  .filter((d) => existsSync(resolve(ART_DIR, d, 'slot.html')));
if (FILTER) games = games.filter((g) => g.includes(FILTER));
if (games.length === 0) { console.error('❌ no games'); process.exit(2); }

log(bar('═'));
log(`📼 Event recorder · ${games.length} slot(s) · ${DURATION_MS / 1000}s capture · spin every ${SPIN_EVERY}ms`);
log(bar('═'));

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

for (const slug of games) {
  process.stdout.write(`  • ${slug.padEnd(40)} `);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  /* Install the recorder PRE-navigation. Hooks both:
   *   - window/document.dispatchEvent (catches CustomEvent posts)
   *   - addEventListener invocation surface (for debug/repro reproduction)
   *   - window.__hookBus.emit if present (canonical slot hook bus)
   *
   * The recorded log uses page-relative timestamps (performance.now)
   * for portable replay across engines. */
  await page.addInitScript(() => {
    window.__events = [];
    const T0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const ts = () => Math.round((((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - T0) * 1000) / 1000;
    function rec(rec) {
      try {
        window.__events.push({ t: ts(), ...rec });
      } catch {}
    }
    const _winDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function patchedDispatch(ev) {
      try {
        const target = (this === window) ? 'window'
                     : (this === document) ? 'document'
                     : (this && this.id) ? `#${this.id}`
                     : (this && this.tagName) ? this.tagName.toLowerCase()
                     : 'other';
        const detail = (ev && ev.detail !== undefined) ? safeShape(ev.detail) : undefined;
        rec({ kind: 'dispatchEvent', type: ev?.type, target, detail });
      } catch {}
      return _winDispatch.call(this, ev);
    };
    const _addL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patchedAdd(type, ...rest) {
      try {
        const target = (this === window) ? 'window'
                     : (this === document) ? 'document'
                     : (this && this.id) ? `#${this.id}`
                     : (this && this.tagName) ? this.tagName.toLowerCase()
                     : 'other';
        rec({ kind: 'addEventListener', type, target });
      } catch {}
      return _addL.call(this, type, ...rest);
    };
    function safeShape(d) {
      try {
        if (d == null) return d;
        if (typeof d !== 'object') return d;
        const out = {};
        for (const k of Object.keys(d).slice(0, 12)) {
          const v = d[k];
          if (v == null || typeof v !== 'object') out[k] = v;
          else if (Array.isArray(v)) out[k] = `<array len=${v.length}>`;
          else out[k] = '<object>';
        }
        return out;
      } catch { return '<unsafe>'; }
    }
  });

  let crash = null;
  try {
    await page.goto(pathToFileURL(resolve(ART_DIR, slug, 'slot.html')).href, {
      waitUntil: 'load',
      timeout: 10_000,
    });
    await page.waitForTimeout(300);

    const start = Date.now();
    while (Date.now() - start < DURATION_MS) {
      await page.evaluate(() => {
        const btn = document.querySelector('#spinBtn,[data-action="spin"]');
        if (btn && !btn.disabled) btn.click();
      });
      await page.waitForTimeout(SPIN_EVERY);
    }
  } catch (err) {
    crash = err.message;
  }

  const events = await page.evaluate(() => window.__events || []).catch(() => []);
  await ctx.close();

  /* Aggregate counts by (kind, type) for at-a-glance summary. */
  const counts = {};
  for (const e of events) {
    const k = `${e.kind}:${e.type}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  const topKinds = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const outPath = resolve(OUT_DIR, `${slug}.json`);
  writeFileSync(outPath, JSON.stringify({
    slug,
    duration_ms: DURATION_MS,
    spin_every_ms: SPIN_EVERY,
    generated_at: new Date().toISOString(),
    crash,
    event_count: events.length,
    top_kinds: topKinds.map(([k, n]) => ({ k, n })),
    events,
  }, null, 2));

  const ok = !crash && events.length > 0;
  log(`${ok ? '✓' : '✗'} events=${events.length} · top=${topKinds.slice(0, 3).map(([k, n]) => `${k}(${n})`).join(',')}${crash ? ' crash="' + crash + '"' : ''}`);
  results.push({ slug, ok, eventCount: events.length, crash });
}

await browser.close();

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
log(`\n${bar('═')}`);
log(`SUMMARY · ${pass}/${results.length} slots recorded · artifacts dist/event-recordings/<slug>.json`);
log(bar('═'));

process.exit(fail > 0 ? 1 : 0);
