#!/usr/bin/env node
/**
 * generate-pilot-svgs.mjs — CORTI W205-PILOTS SVG asset emitter.
 *
 * Emits 14-15 multi-color SVGs + matching stroke-only mono fallbacks
 * for each of the 3 W205 pilots (Huff N' Puff, Spartacus, Rainbow Riches
 * Megaways). Pure Node, no external deps. Idempotent — re-running
 * regenerates the entire pack.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const PILOTS_ROOT = resolve(REPO_ROOT, 'web/studio/pilots');

// ── Helpers ──────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeSvg(path, content) {
  writeFileSync(path, content);
}

function colorSvg(gradStops, body, accents = '') {
  // gradStops is array of [offsetPct, color] tuples → linear gradient #g1
  const stopsXml = gradStops.map(([o, c]) => `<stop offset="${o}%" stop-color="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="g1" x1="0" x2="0" y1="1" y2="0">${stopsXml}</linearGradient>
    <radialGradient id="g2" cx="50%" cy="40%" r="60%">${stopsXml}</radialGradient>
  </defs>
  ${body}
  ${accents}
</svg>
`;
}

function monoSvg(stroke, path) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><path d="${path}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
`;
}

// ── Symbol path library — geometric icons per theme ──────────────────

const PATHS = {
  // Wolf head silhouette
  wolf:        'M16 28 L20 14 L28 22 L36 22 L44 14 L48 28 L46 44 L34 52 L30 52 L18 44 Z M22 28 L26 32 M38 28 L42 32 M30 38 L34 38',
  // Pig snout face
  pig:         'M32 14 C 18 14, 12 28, 18 40 C 14 46, 22 54, 32 52 C 42 54, 50 46, 46 40 C 52 28, 46 14, 32 14 Z M 24 30 L 24 32 M 40 30 L 40 32 M 26 40 L 32 42 L 38 40',
  // Barn building
  barn:        'M8 56 L8 30 L32 14 L56 30 L56 56 Z M24 56 L24 38 L40 38 L40 56 M24 38 L40 38',
  // Lightning bolt
  lightning:   'M28 6 L 18 32 L 28 32 L 22 58 L 44 26 L 34 26 L 40 6 Z',
  // Hay bale (cylinder)
  hay:         'M10 22 H 54 V 50 H 10 Z M 14 26 V 46 M 24 26 V 46 M 34 26 V 46 M 44 26 V 46',
  // Pitchfork
  pitchfork:   'M16 6 L 32 6 L 32 30 M 24 6 L 24 30 M 16 6 L 16 30 M 32 30 L 50 58',
  // Bell
  bell:        'M32 8 C 20 8, 18 22, 18 38 L 14 46 L 50 46 L 46 38 C 46 22, 44 8, 32 8 Z M 30 50 L 34 50 L 34 56 L 30 56 Z',
  // Star
  star:        'M32 6 L 38 26 L 58 26 L 42 38 L 48 58 L 32 46 L 16 58 L 22 38 L 6 26 L 26 26 Z',
  // Number cards
  num9:        'M22 16 L 42 16 L 42 32 L 30 32 L 30 36 L 42 36 L 42 50 L 22 50',
  num10:       'M14 16 L 18 16 L 18 50 L 14 50 M 28 24 C 22 24, 22 50, 28 50 C 34 50, 34 24, 28 24 Z M 44 24 C 38 24, 38 50, 44 50 C 50 50, 50 24, 44 24 Z',
  numJ:        'M28 16 L 44 16 L 44 42 C 44 50, 36 52, 32 52 C 26 52, 22 46, 22 42',
  numQ:        'M22 16 L 42 16 C 50 16, 50 50, 42 50 L 22 50 C 14 50, 14 16, 22 16 Z M 38 44 L 50 58',
  // Wild tornado / lion / shamrock / etc
  tornado:     'M10 12 H 54 L 46 24 H 18 L 38 32 H 24 L 42 40 H 28 L 32 58',
  lion:        'M32 12 C 22 12, 16 22, 18 32 C 12 32, 12 44, 22 46 C 24 54, 32 54, 32 54 C 32 54, 40 54, 42 46 C 52 44, 52 32, 46 32 C 48 22, 42 12, 32 12 Z M 26 30 L 28 32 M 36 30 L 38 32 M 28 40 L 32 42 L 36 40',
  shamrock:    'M32 12 C 26 12, 24 22, 30 26 C 22 22, 14 30, 22 36 C 14 38, 18 48, 26 46 C 28 54, 36 54, 38 46 C 46 48, 50 38, 42 36 C 50 30, 42 22, 34 26 C 40 22, 38 12, 32 12 Z M 30 46 L 32 60 L 34 46',
  // Scatter / bonus
  scatter:     'M32 6 L 36 22 L 52 18 L 42 32 L 56 40 L 40 42 L 44 58 L 32 48 L 20 58 L 24 42 L 8 40 L 22 32 L 12 18 L 28 22 Z',
  // Storm scatter
  cloud:       'M16 36 C 8 36, 8 26, 18 26 C 18 18, 32 16, 36 24 C 46 22, 52 32, 46 38 L 18 38 Z M 20 42 L 24 50 M 30 42 L 34 50 M 40 42 L 44 50',
  // Coliseum / amphitheater
  coliseum:    'M8 22 H 56 V 50 H 8 Z M 12 22 V 50 M 20 22 V 50 M 28 22 V 50 M 36 22 V 50 M 44 22 V 50 M 52 22 V 50 M 8 32 H 56 M 8 42 H 56 M 16 12 H 48 L 56 22 H 8 Z',
  // Empire bonus crown
  crown:       'M10 20 L 18 36 L 26 22 L 32 38 L 38 22 L 46 36 L 54 20 L 50 48 L 14 48 Z M 14 48 L 50 48',
  trident:     'M16 14 L 16 26 M 32 8 L 32 26 M 48 14 L 48 26 M 12 26 H 52 M 32 26 L 32 58 M 24 54 L 32 58 L 40 54',
  helmet:      'M16 24 C 16 14, 48 14, 48 24 L 48 36 L 52 40 L 50 50 L 14 50 L 12 40 L 16 36 Z M 28 24 L 28 32 M 36 24 L 36 32 M 24 34 L 40 34',
  shield:      'M32 8 L 12 16 L 14 38 C 14 48, 22 54, 32 58 C 42 54, 50 48, 50 38 L 52 16 Z M 32 18 L 32 48 M 18 28 H 46',
  sword:       'M32 6 L 36 32 L 36 42 L 40 46 L 32 58 L 24 46 L 28 42 L 28 32 Z M 22 38 H 42',
  wine:        'M22 8 H 42 L 36 28 C 36 36, 28 36, 28 28 Z M 32 36 L 32 50 M 22 50 H 42 M 20 14 H 44',
  // Rainbow / pot of gold / harp / leprechaun
  rainbow:     'M8 50 C 8 24, 56 24, 56 50 M 14 50 C 14 28, 50 28, 50 50 M 20 50 C 20 32, 44 32, 44 50',
  potOfGold:   'M14 32 H 50 L 46 56 H 18 Z M 18 28 H 46 L 50 32 H 14 Z M 22 22 C 24 18, 28 18, 28 24 M 32 18 C 36 16, 38 22, 34 24 M 40 22 C 42 18, 46 18, 46 24',
  harp:        'M14 8 L 14 52 L 50 52 C 50 30, 30 14, 14 8 Z M 18 18 V 50 M 24 24 V 50 M 30 28 V 50 M 36 32 V 50 M 42 38 V 50',
  leprechaun:  'M32 12 C 22 12, 22 22, 32 22 C 42 22, 42 12, 32 12 Z M 22 22 H 42 L 46 26 H 18 Z M 26 28 C 24 36, 26 44, 32 44 C 38 44, 40 36, 38 28 Z M 26 46 L 26 56 M 38 46 L 38 56',
  coin:        'M32 12 C 18 12, 14 32, 18 44 C 22 56, 42 56, 46 44 C 50 32, 46 12, 32 12 Z M 24 28 L 40 28 M 24 32 L 40 32 M 24 36 L 40 36',
  pipe:        'M14 36 H 36 C 40 36, 44 32, 44 28 V 18 H 50 V 28 C 50 38, 42 42, 36 42 H 14 Z',
  horseshoe:   'M16 12 V 32 C 16 48, 30 56, 32 56 C 34 56, 48 48, 48 32 V 12 M 16 12 H 24 M 40 12 H 48 M 24 18 V 30 C 24 38, 28 42, 32 42 C 36 42, 40 38, 40 30 V 18',
  clover:      'M32 28 C 22 28, 22 16, 32 16 C 42 16, 42 28, 32 28 Z M 32 28 C 32 18, 20 18, 20 28 C 20 38, 32 38, 32 28 Z M 32 28 C 32 38, 44 38, 44 28 C 44 18, 32 18, 32 28 Z M 32 28 L 32 56',
  bank:        'M8 24 L 32 12 L 56 24 L 56 28 H 8 Z M 12 30 V 50 M 22 30 V 50 M 32 30 V 50 M 42 30 V 50 M 52 30 V 50 M 8 50 H 56 M 8 56 H 56',
  laurel:      'M16 32 C 12 22, 12 18, 18 14 C 22 18, 24 22, 22 26 M 48 32 C 52 22, 52 18, 46 14 C 42 18, 40 22, 42 26 M 16 38 C 12 44, 14 50, 22 50 C 22 44, 20 40, 18 38 M 48 38 C 52 44, 50 50, 42 50 C 42 44, 44 40, 46 38 M 32 14 V 56',
  frameUpgrade:'M8 8 H 56 V 56 H 8 Z M 16 16 H 48 V 48 H 16 Z M 24 24 H 40 V 40 H 24 Z M 24 24 L 40 40 M 40 24 L 24 40',
};

// ── Per-pilot SVG specs ──────────────────────────────────────────────

const PILOT_SPECS = {
  'huff-n-puff-storm-cellar': {
    palette: {
      flame: ['#9CA3AF', '#FEF08A', '#1F2937'],
      barn: ['#92400E', '#FBBF24', '#365314'],
      mono: '#1F2937',
    },
    symbols: [
      { id: 'HP1-wolf',           grad: [[0,'#1F2937'], [50,'#6B7280'], [100,'#F9FAFB']], path: PATHS.wolf },
      { id: 'HP2-pig',            grad: [[0,'#FB7185'], [50,'#FECDD3'], [100,'#FDF2F8']], path: PATHS.pig },
      { id: 'HP3-barn',           grad: [[0,'#7C2D12'], [50,'#C2410C'], [100,'#FDBA74']], path: PATHS.barn },
      { id: 'HP4-lightning',      grad: [[0,'#9333EA'], [50,'#FACC15'], [100,'#FEF9C3']], path: PATHS.lightning },
      { id: 'MP1-hay',            grad: [[0,'#854D0E'], [50,'#EAB308'], [100,'#FEF3C7']], path: PATHS.hay },
      { id: 'MP2-pitchfork',      grad: [[0,'#525252'], [50,'#A3A3A3'], [100,'#F5F5F5']], path: PATHS.pitchfork },
      { id: 'MP3-bell',           grad: [[0,'#A16207'], [50,'#FBBF24'], [100,'#FEF08A']], path: PATHS.bell },
      { id: 'MP4-star',           grad: [[0,'#1E40AF'], [50,'#FCD34D'], [100,'#FEFCE8']], path: PATHS.star },
      { id: 'LP1-nine',           grad: [[0,'#374151'], [50,'#9CA3AF'], [100,'#F3F4F6']], path: PATHS.num9 },
      { id: 'LP2-ten',            grad: [[0,'#374151'], [50,'#9CA3AF'], [100,'#F3F4F6']], path: PATHS.num10 },
      { id: 'LP3-jack',           grad: [[0,'#374151'], [50,'#9CA3AF'], [100,'#F3F4F6']], path: PATHS.numJ },
      { id: 'WLD-wild-tornado',   grad: [[0,'#374151'], [50,'#9CA3AF'], [100,'#FACC15']], path: PATHS.tornado },
      { id: 'SCT-storm-scatter',  grad: [[0,'#1E3A8A'], [50,'#60A5FA'], [100,'#DBEAFE']], path: PATHS.cloud },
      { id: 'MLT-frame-upgrade',  grad: [[0,'#7F1D1D'], [50,'#F87171'], [100,'#FEE2E2']], path: PATHS.frameUpgrade },
    ],
  },
  'spartacus-colossal-conquest': {
    palette: {
      mono: '#7C1D6F',
    },
    symbols: [
      { id: 'HP1-spartacus',      grad: [[0,'#7C1D6F'], [50,'#F59E0B'], [100,'#FEF3C7']], path: PATHS.helmet },
      { id: 'HP2-crixus',         grad: [[0,'#581C87'], [50,'#A78BFA'], [100,'#EDE9FE']], path: PATHS.helmet },
      { id: 'HP3-trident',        grad: [[0,'#1E40AF'], [50,'#FACC15'], [100,'#FEFCE8']], path: PATHS.trident },
      { id: 'HP4-helmet',         grad: [[0,'#92400E'], [50,'#FBBF24'], [100,'#FEF3C7']], path: PATHS.helmet },
      { id: 'MP1-shield',         grad: [[0,'#7C2D12'], [50,'#FB923C'], [100,'#FFEDD5']], path: PATHS.shield },
      { id: 'MP2-sword',          grad: [[0,'#525252'], [50,'#A3A3A3'], [100,'#F5F5F5']], path: PATHS.sword },
      { id: 'MP3-wine',           grad: [[0,'#7F1D1D'], [50,'#DC2626'], [100,'#FCA5A5']], path: PATHS.wine },
      { id: 'MP4-crown',          grad: [[0,'#854D0E'], [50,'#EAB308'], [100,'#FEF08A']], path: PATHS.crown },
      { id: 'LP1-ten',            grad: [[0,'#581C87'], [50,'#A78BFA'], [100,'#EDE9FE']], path: PATHS.num10 },
      { id: 'LP2-jack',           grad: [[0,'#581C87'], [50,'#A78BFA'], [100,'#EDE9FE']], path: PATHS.numJ },
      { id: 'LP3-queen',          grad: [[0,'#581C87'], [50,'#A78BFA'], [100,'#EDE9FE']], path: PATHS.numQ },
      { id: 'WLD-lion-wild',      grad: [[0,'#7C2D12'], [50,'#F59E0B'], [100,'#FEF3C7']], path: PATHS.lion },
      { id: 'SCT-coliseum',       grad: [[0,'#92400E'], [50,'#D6D3D1'], [100,'#FAFAF9']], path: PATHS.coliseum },
      { id: 'BON-empire-bonus',   grad: [[0,'#7C1D6F'], [50,'#F472B6'], [100,'#FDF2F8']], path: PATHS.crown },
      { id: 'MLT-laurel-mult',    grad: [[0,'#365314'], [50,'#84CC16'], [100,'#ECFCCB']], path: PATHS.laurel },
    ],
  },
  'rainbow-riches-megaways-vault': {
    palette: {
      mono: '#15803D',
    },
    symbols: [
      { id: 'HP1-leprechaun',     grad: [[0,'#14532D'], [50,'#22C55E'], [100,'#D1FAE5']], path: PATHS.leprechaun },
      { id: 'HP2-pot-of-gold',    grad: [[0,'#78350F'], [50,'#F59E0B'], [100,'#FEF3C7']], path: PATHS.potOfGold },
      { id: 'HP3-rainbow',        grad: [[0,'#7C3AED'], [50,'#FBBF24'], [100,'#10B981']], path: PATHS.rainbow },
      { id: 'HP4-harp',           grad: [[0,'#854D0E'], [50,'#FCD34D'], [100,'#FEF9C3']], path: PATHS.harp },
      { id: 'MP1-clover',         grad: [[0,'#14532D'], [50,'#22C55E'], [100,'#BBF7D0']], path: PATHS.clover },
      { id: 'MP2-gold-coin',      grad: [[0,'#854D0E'], [50,'#FBBF24'], [100,'#FEF3C7']], path: PATHS.coin },
      { id: 'MP3-pipe',           grad: [[0,'#451A03'], [50,'#92400E'], [100,'#D6D3D1']], path: PATHS.pipe },
      { id: 'MP4-horseshoe',      grad: [[0,'#525252'], [50,'#A3A3A3'], [100,'#F5F5F5']], path: PATHS.horseshoe },
      { id: 'LP1-nine',           grad: [[0,'#14532D'], [50,'#16A34A'], [100,'#DCFCE7']], path: PATHS.num9 },
      { id: 'LP2-ten',            grad: [[0,'#14532D'], [50,'#16A34A'], [100,'#DCFCE7']], path: PATHS.num10 },
      { id: 'LP3-jack',           grad: [[0,'#14532D'], [50,'#16A34A'], [100,'#DCFCE7']], path: PATHS.numJ },
      { id: 'WLD-wild-shamrock',  grad: [[0,'#14532D'], [50,'#22C55E'], [100,'#FACC15']], path: PATHS.shamrock },
      { id: 'SCT-lucky-scatter',  grad: [[0,'#7C3AED'], [50,'#FBBF24'], [100,'#FEFCE8']], path: PATHS.scatter },
      { id: 'BNK-bonus-bank-vault', grad: [[0,'#854D0E'], [50,'#F59E0B'], [100,'#FEF3C7']], path: PATHS.bank },
    ],
  },
};

function bodyFromPath(path, useRadial = true) {
  const fill = useRadial ? 'url(#g2)' : 'url(#g1)';
  return `<path d="${path}" fill="${fill}" stroke="#0F172A" stroke-width="1.2" stroke-linejoin="round"/>`;
}

function main() {
  let totalColor = 0;
  let totalMono = 0;
  for (const [pilotId, spec] of Object.entries(PILOT_SPECS)) {
    const colorDir = resolve(PILOTS_ROOT, pilotId, 'symbols/color');
    const monoDir  = resolve(PILOTS_ROOT, pilotId, 'symbols/mono');
    ensureDir(colorDir);
    ensureDir(monoDir);

    for (const sym of spec.symbols) {
      const c = colorSvg(sym.grad, bodyFromPath(sym.path, true));
      const m = monoSvg(spec.palette.mono, sym.path);
      writeSvg(resolve(colorDir, `${sym.id}.svg`), c);
      writeSvg(resolve(monoDir, `${sym.id}.svg`), m);
      totalColor++; totalMono++;
    }
    console.log(`✓ ${pilotId}: ${spec.symbols.length} color + ${spec.symbols.length} mono SVGs`);
  }
  console.log(`\nTotal: ${totalColor} color + ${totalMono} mono SVGs written.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { PILOT_SPECS, main };
