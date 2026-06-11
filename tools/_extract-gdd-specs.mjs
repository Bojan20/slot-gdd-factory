#!/usr/bin/env node
/**
 * Extract parsed spec from each GDD PDF using the existing parser.
 * Reports per-GDD: detected features, topology, symbols, FS config.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGDD } from '../src/parser.mjs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const GDD = `${process.env.HOME}/Desktop/GDD`;
const FIXTURES = [
  'Gates_of_Olympus_1000_GDD.pdf',
  'Huff_N_More_Puff_GDD.pdf',
  'Starlight_Travellers_GDD.pdf',
  'Wrath_of_Olympus_GDD.pdf',
];

async function pdfText(path) {
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  let txt = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc   = await page.getTextContent();
    txt += tc.items.map(it => it.str || '').join(' ') + '\n';
  }
  return txt;
}

for (const fx of FIXTURES) {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' ', fx);
  console.log('══════════════════════════════════════════════════');
  const raw = await pdfText(resolve(GDD, fx));
  const model = parseGDD(raw, 'pdf');
  console.log('  Name           :', model.name);
  console.log('  Theme tags     :', (model.theme?.tags || []).join(', '));
  console.log('  Topology       :', `${model.topology?.kind || 'rectangular'} ${model.topology?.reels}×${model.topology?.rows} · paylines=${model.topology?.paylines}`);
  console.log('  Evaluation     :', model.topology?.evaluation || 'lines');
  console.log('  Symbols        :', `HP=${(model.symbols?.high||[]).length} MP=${(model.symbols?.mid||[]).length} LP=${(model.symbols?.low||[]).length} SP=${(model.symbols?.specials||[]).length}`);
  console.log('  Features       :', (model.features||[]).map(f => f.kind).join(', '));
  console.log('  FS             :', model.freeSpins ? `enabled=${model.freeSpins.enabled} trig=${model.freeSpins.triggerSymbol} awards=${JSON.stringify(model.freeSpins.awards||[])}` : 'n/a');
  console.log('  Failures       :', (model.confidence?._failures||[]).length);
  if ((model.confidence?._failures||[]).length) {
    for (const f of model.confidence._failures.slice(0,3)) {
      console.log('    -', f.label, '·', f.error?.slice(0, 80));
    }
  }
  // Also dump raw keywords detected for diagnosis
  const lower = raw.toLowerCase();
  const keywords = {
    free_spins: /free\s*spins?|fs\b/.test(lower),
    bonus_buy: /bonus\s*buy|buy\s*bonus|buy\s*feature/.test(lower),
    bonus_pick: /bonus\s*pick|pick\s*and\s*click/.test(lower),
    hold_and_win: /hold\s*(and|n|&)\s*win|hold\s*win/.test(lower),
    wheel_bonus: /wheel\s*(bonus|of)|fortune\s*wheel/.test(lower),
    cascade: /cascad|tumbl|avalanche|drop/.test(lower),
    cluster_pays: /cluster\s*pay/.test(lower),
    ways: /\b\d+\s*ways\b|\bways\s*to\s*win\b|megaways/.test(lower),
    pay_anywhere: /pay\s*anywhere|anywhere\s*pay/.test(lower),
    multiplier_orb: /multiplier\s*orb|orb/.test(lower),
    multiplier: /multipli/.test(lower),
    persistent_multiplier: /persistent\s*multipl/.test(lower),
    ante_bet: /ante\s*bet|increase.*bet/.test(lower),
    scatter_pay: /scatter\s*pay/.test(lower),
    sticky_wild: /sticky\s*wild/.test(lower),
    expanding_wild: /expand(ing)?\s*wild/.test(lower),
    walking_wild: /walking\s*wild/.test(lower),
    mystery_symbol: /mystery\s*symb|reveal/.test(lower),
    super_symbol: /super\s*symb/.test(lower),
    wild_reel: /wild\s*reel/.test(lower),
    respin: /respin/.test(lower),
    lightning: /lightning/.test(lower),
    gamble: /gamble|double\s*up/.test(lower),
    jackpot: /jackpot/.test(lower),
    big_win: /big\s*win|mega\s*win|epic\s*win/.test(lower),
  };
  const detected = Object.entries(keywords).filter(([_, v]) => v).map(([k]) => k);
  console.log('  Raw kw scan    :', detected.join(', '));
}
