#!/usr/bin/env node
/**
 * tools/kimi-ar-snapshot.mjs
 *
 * KIMI-AR (MASTER_TODO P2) — Archive snapshot of Kimi V6 reconcile cache.
 *
 * Persists a copy of `tools/_wave-v-cache/*.json` (currently Opus 4.8 since
 * UQ-OPUS switch, but historically Kimi K2) into
 * `tools/_wave-v-cache/.archive/<provider>-<ts>/` so multi-provider trainer
 * V2 has stable A/B baselines for retrospective comparison.
 *
 * USAGE
 *   node tools/kimi-ar-snapshot.mjs                 # default provider 'opus-4.8'
 *   node tools/kimi-ar-snapshot.mjs --provider kimi-k2
 *   node tools/kimi-ar-snapshot.mjs --list          # list existing snapshots
 *
 * NOTE
 *   The cache itself is in .gitignore; archives live under .archive/ which
 *   is ALSO gitignored. This is local A/B regression infrastructure only.
 */

import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const CACHE = resolve(REPO, 'tools/_wave-v-cache');
const ARCHIVE = resolve(CACHE, '.archive');
mkdirSync(ARCHIVE, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const a = args.find(x => x === flag || x.startsWith(flag + '='));
  return a ? (a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1]) : null;
};

if (args.includes('--list')) {
  if (!existsSync(ARCHIVE)) { console.log('(no snapshots yet)'); process.exit(0); }
  const entries = readdirSync(ARCHIVE).filter(d =>
    statSync(join(ARCHIVE, d)).isDirectory()
  ).sort();
  if (entries.length === 0) { console.log('(no snapshots yet)'); process.exit(0); }
  console.log(`Snapshots in ${ARCHIVE}:`);
  for (const e of entries) {
    const dir = join(ARCHIVE, e);
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    let metaTs = '—';
    const meta = join(dir, '__meta__.json');
    if (existsSync(meta)) {
      try { metaTs = JSON.parse(readFileSync(meta, 'utf-8')).ts; } catch {}
    }
    console.log(`  ${e}   files=${files.length}  ts=${metaTs}`);
  }
  process.exit(0);
}

const provider = argVal('--provider') || 'opus-4.8';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const snapDir = join(ARCHIVE, `${provider}-${ts}`);
mkdirSync(snapDir, { recursive: true });

if (!existsSync(CACHE)) {
  console.error(`▸ cache dir missing: ${CACHE}`);
  process.exit(2);
}

const jsons = readdirSync(CACHE).filter(f => f.endsWith('.json'));
if (jsons.length === 0) {
  console.error('▸ no JSON files in cache to snapshot');
  process.exit(2);
}

let copied = 0;
for (const f of jsons) {
  copyFileSync(join(CACHE, f), join(snapDir, f));
  copied++;
}

const metaPayload = {
  ts: new Date().toISOString(),
  provider,
  fileCount: copied,
  fromDir: CACHE,
  cmd: process.argv.join(' '),
};
writeFileSync(join(snapDir, '__meta__.json'), JSON.stringify(metaPayload, null, 2));

console.log(`✓ KIMI-AR snapshot — ${copied} V6 reconciles → ${snapDir}`);
console.log(`  provider tag: ${provider}`);
console.log(`  meta: __meta__.json`);
