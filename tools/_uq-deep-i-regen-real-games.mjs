#!/usr/bin/env node
/**
 * UQ-DEEP-I — regen dist/real-games/<slug>/slot.html iz model.json.
 * Brzo, ne reparsiramo PDF — koristimo postojeći model.json za svaki slug.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const REAL = '/Users/vanvinklstudio/Projects/slot-gdd-factory/dist/real-games';
const slugs = readdirSync(REAL).filter(d => existsSync(resolve(REAL, d, 'model.json'))).sort();
console.log(`▸ regen ${slugs.length} slugs`);

let ok = 0, fail = 0;
for (const slug of slugs) {
  try {
    const model = JSON.parse(readFileSync(resolve(REAL, slug, 'model.json'), 'utf8'));
    const html = buildSlotHTML(model);
    writeFileSync(resolve(REAL, slug, 'slot.html'), html);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${slug}: ${e.message.slice(0, 120)}`);
    fail++;
  }
}
console.log(`✓ regenerated ${ok}/${slugs.length}, failed ${fail}`);
process.exit(fail > 0 ? 1 : 0);
