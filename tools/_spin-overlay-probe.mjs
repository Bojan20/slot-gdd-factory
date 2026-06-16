import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const gddPath = join(process.cwd(), 'samples', 'WRATH_OF_OLYMPUS_GAME_GDD.md');
const gdd = readFileSync(gddPath, 'utf8');
const model = parseGDD(gdd, 'md');
const html = buildSlotHTML(model);

const checks = [
  ['HTML contains .reelCol.is-spinning::after rule', html.includes('.reelCol.is-spinning::after')],
  ['HTML contains the streak keyframe', html.includes('@keyframes reelStreakIn')],
  ['HTML contains speed-lines keyframe', html.includes('@keyframes reelSpeedLines')],
  ['HTML contains blur(0px) brightness(1) default cell rule', html.includes('filter: blur(0px) brightness(1)')],
  ['HTML emits the runtime is-spinning add on column', html.includes('reel.col.classList.add("is-spinning")')],
  ['HTML emits the runtime is-spinning remove on column', html.includes('reel.col.classList.remove("is-spinning")')],
  ['SPIN_PROFILE baked with WoO staggerMs 180', html.includes('staggerMs: 180')],
  ['SPIN_PROFILE baked with WoO steadyMs 720', html.includes('steadyMs: 720')],
  ['reelEngine minRotations baked to 5', html.includes('minRotations: 5,')],
  ['v3 dim regression NOT present (no brightness(0.55))', !html.includes('brightness(0.55)')],
];

let pass = 0, fail = 0;
for (const [name, ok] of checks) {
  console.log(ok ? '  ✓' : '  ✗', name);
  ok ? pass++ : fail++;
}
console.log('');
console.log(`  ${pass} pass · ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
