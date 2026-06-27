#!/usr/bin/env node
/**
 * tools/_emit-launcher-index.mjs
 *
 * BLOCK-6 (Boki 2026-06-27 hitno) — "pa ne otvara šta treba da otvori".
 *
 * Scan svih `dist/&#42;&#42;/slot.html` putanja i emit-uje `dist/_built-games.json`
 * koji index.html dashboard fetch-uje na load. Cilj: launcher otvori
 * dashboard, dashboard prikaže LISTU svih buildovanih igara sa direct
 * klikom na svaku.
 *
 * USAGE
 *   node tools/_emit-launcher-index.mjs
 *
 * OUTPUT
 *   dist/_built-games.json
 *     {
 *       generatedAt: ISO,
 *       totalSlots: N,
 *       buckets: {
 *         "ultimate-single-game": [{ slug, path, mtime, bytes }, …],
 *         "build-gated":          [...],
 *         "par-sheet-slots":      [...],
 *         "real-games":           [...]
 *       },
 *       latest: { slug, path, bucket, mtime }
 *     }
 */

import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const DIST_DIR   = join(REPO_ROOT, 'dist');

/* Buckets prioritized — ultimate najsvežiji wave, real-games najveći corpus. */
const BUCKETS = [
  'ultimate-single-game',
  'build-gated',
  'par-sheet-slots',
  'real-games',
  'ingest',
  'sandbox',
];

function listSlotsInBucket(bucketName) {
  const bucketDir = join(DIST_DIR, bucketName);
  if (!existsSync(bucketDir)) return [];
  const out = [];
  for (const entry of readdirSync(bucketDir)) {
    const slug = entry;
    const slotPath = join(bucketDir, slug, 'slot.html');
    if (!existsSync(slotPath)) continue;
    try {
      const st = statSync(slotPath);
      out.push({
        slug,
        path: '/' + relative(REPO_ROOT, slotPath).split('/').join('/'),
        bucket: bucketName,
        mtime: st.mtimeMs,
        mtimeISO: new Date(st.mtimeMs).toISOString(),
        bytes: st.size,
      });
    } catch {}
  }
  return out;
}

function loadModelMeta(bucket, slug) {
  /* Pokušaj da nađe model.json za RTP/topology display. */
  const candidates = [
    join(DIST_DIR, 'par-sheet-real-games', slug, 'model.json'),
    join(DIST_DIR, bucket, slug, 'model.json'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const m = JSON.parse(readFileSync(p, 'utf-8'));
      return {
        rtpDeclared: m?.payback?.expected ?? m?.payback?.target ?? null,
        topology: m?.topology?.kind ?? null,
        reels: m?.topology?.reels ?? null,
        rows: m?.topology?.rows ?? null,
      };
    } catch {}
  }
  return null;
}

function loadConvergenceVerdict(slug) {
  const p = join(REPO_ROOT, 'reports', 'par-block-until-perfect', `${slug}.json`);
  if (!existsSync(p)) return null;
  try {
    const r = JSON.parse(readFileSync(p, 'utf-8'));
    return {
      verdict: r.verdict ?? null,
      finalTier: r.finalTier ?? null,
      finalDeltaPP: r.finalDeltaPP != null ? Number(r.finalDeltaPP.toFixed(4)) : null,
      buildAllowed: r.buildAllowed ?? null,
    };
  } catch {}
  return null;
}

function main() {
  const buckets = {};
  let allSlots = [];

  for (const b of BUCKETS) {
    const items = listSlotsInBucket(b);
    /* Enrich sa model meta + convergence verdict (samo za prvih 5 bucket-a
     * radi performance — real-games ima 308 slotova). */
    if (b !== 'real-games') {
      for (const it of items) {
        const meta = loadModelMeta(b, it.slug);
        const conv = loadConvergenceVerdict(it.slug);
        if (meta) Object.assign(it, meta);
        if (conv) it.convergence = conv;
      }
    }
    buckets[b] = items;
    allSlots = allSlots.concat(items);
  }

  /* Najsvežiji slot — koristi se za auto-open u launcher-u. */
  const latest = allSlots.length > 0
    ? allSlots.reduce((a, b) => (a.mtime > b.mtime ? a : b))
    : null;

  const out = {
    generatedAt: new Date().toISOString(),
    totalSlots: allSlots.length,
    bucketCounts: Object.fromEntries(BUCKETS.map((b) => [b, buckets[b].length])),
    buckets,
    latest,
  };

  mkdirSync(DIST_DIR, { recursive: true });
  const outPath = join(DIST_DIR, '_built-games.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✓ emitted ${outPath}`);
  console.log(`  totalSlots=${allSlots.length}  latest=${latest ? latest.slug + ' (' + latest.bucket + ')' : '—'}`);
}

main();
