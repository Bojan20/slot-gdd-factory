#!/usr/bin/env node
/**
 * UQ-DEEP-I — mass headless probe nad reprezentativnim subsetom slot.html
 * iz dist/real-games/. Boki direktiva: BILO KOJI uploaded GDD mora da radi.
 * Probe sample skuplja jedinstvene pageerror + unknown-event warnings tako
 * da fix-evi pokrivaju klase, ne pojedinačne slug-ove.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const REAL = '/Users/vanvinklstudio/Projects/slot-gdd-factory/dist/real-games';
const PORT = 5276;
const SAMPLE_SIZE = Number(process.argv[2]) || 30;

/* Collect ~30 representative slugs (every Nth from sorted full list). */
const all = readdirSync(REAL).filter(d => {
  const p = resolve(REAL, d, 'slot.html');
  return existsSync(p);
}).sort();
const stride = Math.max(1, Math.floor(all.length / SAMPLE_SIZE));
const sample = [];
for (let i = 0; i < all.length && sample.length < SAMPLE_SIZE; i += stride) {
  sample.push(all[i]);
}

console.log(`▸ probing ${sample.length}/${all.length} slots over port ${PORT}`);

const srv = spawn('python3', ['-m', 'http.server', String(PORT)],
  { cwd: '/Users/vanvinklstudio/Projects/slot-gdd-factory', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch({ headless: true });
const aggregate = { pageerror: new Map(), unknownEvent: new Map(), consoleError: new Map() };

function bucket(map, key, slug) {
  const k = key.slice(0, 200);
  const e = map.get(k) || { count: 0, slugs: [] };
  e.count++;
  if (e.slugs.length < 5) e.slugs.push(slug);
  map.set(k, e);
}

for (let i = 0; i < sample.length; i++) {
  const slug = sample[i];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => bucket(aggregate.pageerror, e.message, slug));
  page.on('console', m => {
    if (m.type() === 'error') bucket(aggregate.consoleError, m.text(), slug);
    if (m.type() === 'warning') {
      const t = m.text();
      const match = t.match(/\[HookBus\] unknown event:?\s*([\w.:_-]+)/);
      if (match) bucket(aggregate.unknownEvent, match[1], slug);
    }
  });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/dist/real-games/${slug}/slot.html`,
      { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);  /* let blocks init + emit */
  } catch (e) {
    bucket(aggregate.pageerror, `[probe-goto-fail] ${e.message}`, slug);
  }
  await ctx.close();
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${sample.length} probed`);
}

await browser.close();
srv.kill();

function dump(label, map) {
  console.log(`\n── ${label} (${map.size} unique) ──`);
  const entries = [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [key, { count, slugs }] of entries.slice(0, 25)) {
    console.log(`  ${count}× | ${key}`);
    console.log(`    slugs: ${slugs.slice(0, 3).join(', ')}${slugs.length > 3 ? ` (+${slugs.length - 3})` : ''}`);
  }
}

dump('pageerror', aggregate.pageerror);
dump('unknown HookBus events', aggregate.unknownEvent);
dump('console.error', aggregate.consoleError);

const totalIssues = aggregate.pageerror.size + aggregate.unknownEvent.size + aggregate.consoleError.size;
console.log(`\n▸ Total unique issue classes: ${totalIssues}`);
process.exit(totalIssues > 0 ? 1 : 0);
