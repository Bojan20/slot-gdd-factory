#!/usr/bin/env node
/** Regenerate ALL 20 grid playables from samples/grids/ with the latest code. */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = resolve(REPO, 'samples/grids');
const DIST = resolve(REPO, 'dist');
if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });

const files = readdirSync(SAMPLES).filter(f => /\.md$/i.test(f)).sort();
const summary = [];
for (const f of files) {
  const text = readFileSync(resolve(SAMPLES, f), 'utf8');
  let kind = 'unknown', name = '', err = null;
  try {
    const model = parseGDD(text, 'md');
    kind = model.shape?.kind || 'unknown';
    name = model.name || '';
    const html = buildSlotHTML(model);
    const out = f.replace(/_GAME_GDD\.md$/i, '_playable.html');
    writeFileSync(resolve(DIST, out), html);
    summary.push({ file: f, out, kind, name, chars: html.length, err: null });
  } catch (e) {
    summary.push({ file: f, out: '-', kind, name, chars: 0, err: e.message });
  }
}
console.table(summary.map(s => ({ file: s.file.slice(0,40), kind: s.kind, name: s.name.slice(0,28), chars: s.chars, err: s.err ? s.err.slice(0,40) : '' })));
const errors = summary.filter(s => s.err);
console.log(`\n${summary.length - errors.length}/${summary.length} regenerated  (${errors.length} errors)`);
process.exit(errors.length ? 1 : 0);
