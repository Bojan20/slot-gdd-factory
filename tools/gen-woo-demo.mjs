import { readFileSync, writeFileSync } from 'fs';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const text = readFileSync('./samples/WRATH_OF_OLYMPUS_GAME_GDD.md', 'utf8');
const model = parseGDD(text, 'md');
const symTotal = model.symbols.high.length + model.symbols.mid.length + model.symbols.low.length + model.symbols.specials.length;
console.log('Parsed:', model.name, model.topology.reels + 'x' + model.topology.rows, 'symbols=' + symTotal, 'features=' + model.features.length);
const html = buildSlotHTML(model);
writeFileSync('./dist/wrath-of-olympus.html', html);
console.log('Written dist/wrath-of-olympus.html', html.length, 'chars');
