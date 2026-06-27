#!/usr/bin/env node
/**
 * generate-production-data.mjs — CORTI 200.8 mock production stats.
 *
 * Emits a deterministic JSON blob of 50+ "live" production games with
 * hourly fluctuations, jurisdiction breakdowns, error rates. Used by
 * web/production/index.html and the production-stats vitest spec.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const OUT_PATH   = resolve(REPO_ROOT, 'web/production/data.json');

const JURISDICTIONS = ['UKGC', 'MGA', 'ADM', 'NJDGE', 'PAGCB', 'OLG', 'ABP', 'NV', 'CAEAFE'];
const CABINETS = ['bally-pro-series', 'igt-crystal-curve', 'konami-synkros', 'aristocrat-helix'];
const TEMPLATES = [
  'lw-m1', 'lw-m2', 'lw-m3', 'lw-m4', 'lw-m5', 'lw-m6', 'lw-m7', 'lw-m8',
  'classic-5x3-20lines', 'megaways-bonanza', 'cluster-7x7-v2', 'cascade-avalanche',
  'hw-lock-it-link', 'fs-retrigger-v2', 'jackpot-4tier-wap',
];

function mulberry32(seed) {
  return () => {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const rng = mulberry32(424242);
  const games = [];
  for (let i = 0; i < 55; i++) {
    const tpl = TEMPLATES[i % TEMPLATES.length];
    const jur = JURISDICTIONS[Math.floor(rng() * JURISDICTIONS.length)];
    const cab = CABINETS[Math.floor(rng() * CABINETS.length)];
    // Daily revenue: $1K – $50K range with log-uniform-ish distribution
    const rev = Math.round(1000 + Math.pow(rng(), 0.7) * 49000);
    const rtp = 0.92 + rng() * 0.06;
    const hit = 0.22 + rng() * 0.18;
    const err = rng() * 0.005; // 0–0.5%
    const hourly = Array.from({ length: 24 }, () => Math.round(rev / 24 * (0.6 + rng() * 0.8)));
    games.push({
      id: `${tpl}-prod-${String(i + 1).padStart(3, '0')}`,
      template: tpl,
      jurisdiction: jur,
      cabinet: cab,
      daily_revenue_usd: rev,
      rtp: +rtp.toFixed(4),
      hit_freq: +hit.toFixed(4),
      error_rate: +err.toFixed(5),
      hourly_revenue_usd: hourly,
      deployed_at: '2026-04-01T00:00:00Z',
      status: rng() < 0.96 ? 'live' : 'maintenance',
    });
  }
  const blob = {
    schema_version: '1.0.0',
    generated_by: 'scripts/generate-production-data.mjs',
    snapshot_at: '2026-05-18T12:00:00Z',
    total_games: games.length,
    jurisdictions: JURISDICTIONS,
    cabinets: CABINETS,
    games,
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(blob, null, 2) + '\n';
  let prevSame = false;
  if (existsSync(OUT_PATH)) {
    try { prevSame = readFileSync(OUT_PATH, 'utf8') === json; } catch {}
  }
  if (!prevSame) writeFileSync(OUT_PATH, json);
  console.log(`[production-data] done — ${games.length} games`);
}

main();
