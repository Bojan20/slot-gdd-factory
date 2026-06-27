#!/usr/bin/env node
/**
 * generate-symbol-library.mjs — CORTI 200.8 Studio Production.
 *
 * Generates 160+ stroke-only SVG icons across 8 packs:
 *   fruit/  card/  gem/  animal/  ancient/  scifi/  universal/  accent/
 *
 * Each SVG is monochrome (uses currentColor stroke), 64×64 viewBox,
 * 2px stroke. The shapes are minimalist placeholder geometry designed
 * to be themed by theme palette at runtime — production studios swap
 * the raw drawings for hand-crafted assets without changing the
 * filename grid.
 *
 * Output structure:
 *   web/studio/symbols/lib/<pack>/<name>.svg
 *   web/studio/symbols/lib/index.json   (pack manifest)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const OUT_DIR    = resolve(REPO_ROOT, 'web/studio/symbols/lib');

const DRY_RUN = process.argv.includes('--dry-run');

/* ============================================================
   Drawing primitives — all return SVG body strings (no <svg> tag)
   ============================================================ */

const W = 64;

function circle(cx, cy, r) { return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`; }
function rect(x, y, w, h, r = 0) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}"/>`; }
function path(d) { return `<path d="${d}"/>`; }
function line(x1, y1, x2, y2) { return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
function poly(points) { return `<polygon points="${points}"/>`; }
function text(x, y, t, size = 18) { return `<text x="${x}" y="${y}" font-size="${size}" font-family="serif" text-anchor="middle" fill="currentColor" stroke="none">${t}</text>`; }
function ellipse(cx, cy, rx, ry) { return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`; }

function svgWrap(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/* ============================================================
   Pack: FRUIT (20)
   ============================================================ */
const FRUIT = {
  cherry:      circle(22, 40, 12) + circle(42, 44, 12) + path('M22 28 Q 32 12 42 32'),
  lemon:       ellipse(32, 32, 16, 22) + line(20, 24, 24, 28) + line(40, 24, 44, 28),
  orange:      circle(32, 32, 20) + line(32, 12, 32, 32) + path('M 32 32 L 18 22 M 32 32 L 46 22 M 32 32 L 18 42 M 32 32 L 46 42'),
  plum:        ellipse(32, 36, 16, 20) + path('M 32 16 Q 28 12 24 14') + line(32, 16, 32, 22),
  grape:       circle(20, 30, 8) + circle(32, 30, 8) + circle(44, 30, 8) + circle(26, 42, 8) + circle(38, 42, 8) + path('M 32 14 L 32 22'),
  watermelon:  path('M 8 32 A 24 24 0 0 0 56 32 Z') + line(8, 32, 56, 32) + circle(20, 44, 1.5) + circle(32, 48, 1.5) + circle(44, 44, 1.5),
  strawberry:  path('M 16 24 L 32 56 L 48 24 Z') + line(20, 24, 44, 24) + path('M 22 20 L 32 14 L 42 20'),
  banana:      path('M 12 20 Q 32 60 56 28') + path('M 12 20 Q 22 16 18 12') + path('M 56 28 Q 50 24 56 18'),
  apple:       circle(32, 36, 20) + line(32, 16, 32, 24) + path('M 32 18 Q 40 14 44 16'),
  pineapple:   ellipse(32, 38, 16, 20) + path('M 24 18 L 32 8 L 40 18') + line(20, 32, 44, 32) + line(20, 42, 44, 42),
  kiwi:        circle(32, 32, 18) + circle(32, 32, 6) + path('M 32 14 L 32 50 M 14 32 L 50 32 M 20 20 L 44 44 M 44 20 L 20 44'),
  pear:        path('M 32 12 Q 24 24 24 36 Q 24 56 32 56 Q 40 56 40 36 Q 40 24 32 12 Z') + line(32, 8, 32, 16),
  peach:       circle(32, 34, 18) + path('M 32 18 L 32 34') + path('M 32 12 Q 36 8 40 12'),
  coconut:     circle(32, 32, 18) + path('M 24 26 Q 32 32 40 26') + circle(26, 22, 1) + circle(38, 22, 1) + circle(32, 30, 1),
  fig:         path('M 32 14 L 40 16 L 44 24 L 44 40 Q 44 56 32 56 Q 20 56 20 40 L 20 24 L 24 16 Z') + line(28, 28, 36, 36),
  mango:       ellipse(32, 36, 16, 18) + path('M 32 18 Q 40 14 36 10'),
  pomegranate: circle(32, 36, 18) + path('M 32 18 L 32 14 L 28 12 L 32 10 L 36 12 Z') + circle(28, 32, 1.5) + circle(36, 32, 1.5) + circle(32, 40, 1.5),
  blueberry:   circle(22, 32, 10) + circle(42, 32, 10) + circle(32, 44, 10) + path('M 32 18 L 32 22'),
  raspberry:   path('M 32 12 L 16 28 L 24 56 L 40 56 L 48 28 Z') + circle(24, 28, 3) + circle(32, 32, 3) + circle(40, 28, 3) + circle(28, 44, 3) + circle(36, 44, 3),
  blackberry:  circle(24, 28, 6) + circle(40, 28, 6) + circle(24, 44, 6) + circle(40, 44, 6) + circle(32, 36, 6) + path('M 32 16 L 32 22'),
};

/* ============================================================
   Pack: CARD (20) — A K Q J 10 9 × 4 suits + 4 extras (slim variants)
   ============================================================ */
function suitShape(suit) {
  switch (suit) {
    case 'hearts':   return path('M 32 48 L 14 30 Q 14 20 22 20 Q 28 20 32 28 Q 36 20 42 20 Q 50 20 50 30 Z');
    case 'diamonds': return path('M 32 16 L 48 32 L 32 48 L 16 32 Z');
    case 'clubs':    return circle(22, 30, 7) + circle(42, 30, 7) + circle(32, 22, 7) + path('M 32 32 L 28 48 L 36 48 Z');
    case 'spades':   return path('M 32 16 L 50 32 Q 50 42 42 42 Q 36 42 32 36 Q 28 42 22 42 Q 14 42 14 32 Z') + path('M 32 36 L 28 50 L 36 50 Z');
  }
  return '';
}
const CARDS = {};
for (const rank of ['A', 'K', 'Q', 'J', '10', '9']) {
  for (const suit of ['hearts', 'diamonds', 'clubs', 'spades']) {
    CARDS[`${rank.toLowerCase()}-${suit}`] = rect(8, 8, 48, 48, 6) + text(20, 22, rank, 10) + suitShape(suit);
  }
}

/* ============================================================
   Pack: GEM (20)
   ============================================================ */
const GEM = {
  ruby:       poly('32,6 50,28 38,58 26,58 14,28') + line(14, 28, 50, 28),
  sapphire:   poly('32,8 56,32 32,56 8,32') + line(8, 32, 56, 32),
  emerald:    rect(14, 14, 36, 36) + line(20, 20, 44, 20) + line(20, 44, 44, 44),
  diamond:    poly('32,8 56,28 32,58 8,28') + line(20, 28, 44, 28),
  topaz:      poly('20,8 44,8 56,28 32,58 8,28') + line(8, 28, 56, 28),
  amethyst:   poly('16,16 48,16 56,32 32,56 8,32') + line(16, 16, 32, 56) + line(48, 16, 32, 56),
  opal:       ellipse(32, 32, 22, 16) + line(10, 32, 54, 32),
  pearl:      circle(32, 32, 20) + path('M 22 22 Q 28 26 26 30'),
  jade:       rect(12, 18, 40, 28, 8) + line(12, 32, 52, 32),
  onyx:       poly('32,6 50,28 32,50 14,28') + line(14, 28, 50, 28) + line(32, 6, 32, 50),
  'gem-cut-1': poly('32,4 60,32 32,60 4,32') + line(4, 32, 60, 32),
  'gem-cut-2': poly('20,4 44,4 60,20 60,44 44,60 20,60 4,44 4,20'),
  'gem-cut-3': poly('32,4 56,16 56,48 32,60 8,48 8,16') + line(8, 16, 56, 16) + line(8, 48, 56, 48),
  'gem-cut-4': poly('32,8 50,20 50,44 32,56 14,44 14,20'),
  'gem-cut-5': poly('16,16 48,16 56,32 48,48 16,48 8,32') + line(8, 32, 56, 32),
  'gem-cut-6': poly('32,4 50,16 50,32 32,44 14,32 14,16') + line(14, 16, 50, 16),
  'gem-cut-7': rect(8, 24, 48, 16) + poly('8,24 16,16 48,16 56,24') + poly('8,40 16,48 48,48 56,40'),
  'gem-cut-8': poly('32,6 60,28 32,58 4,28') + line(4, 28, 32, 32) + line(60, 28, 32, 32),
  'gem-cut-9': circle(32, 32, 20) + poly('32,12 50,32 32,52 14,32'),
  'gem-cut-10': poly('20,8 44,8 56,32 44,56 20,56 8,32') + line(8, 32, 56, 32) + line(20, 8, 20, 56) + line(44, 8, 44, 56),
};

/* ============================================================
   Pack: ANIMAL (20) — abstract minimalist heads / silhouettes
   ============================================================ */
const ANIMAL = {
  wolf:      poly('16,20 16,44 24,52 40,52 48,44 48,20 40,8 24,8') + path('M 28 30 L 28 34 M 36 30 L 36 34') + path('M 28 42 L 32 46 L 36 42'),
  tiger:     circle(32, 32, 22) + line(20, 22, 24, 26) + line(44, 22, 40, 26) + line(20, 36, 24, 32) + line(44, 36, 40, 32) + circle(26, 30, 2) + circle(38, 30, 2),
  lion:      circle(32, 36, 16) + path('M 16 36 Q 8 24 16 16') + path('M 48 36 Q 56 24 48 16') + path('M 16 16 Q 32 4 48 16') + circle(26, 34, 1.5) + circle(38, 34, 1.5),
  eagle:     path('M 4 32 L 32 16 L 60 32') + path('M 32 16 L 32 48') + path('M 24 48 L 32 56 L 40 48'),
  dragon:    path('M 8 40 Q 16 24 28 24 L 36 16 L 44 24 Q 56 24 56 40') + path('M 20 32 L 24 36 M 40 32 L 44 36') + path('M 28 44 Q 32 52 36 44'),
  phoenix:   path('M 32 8 L 24 24 L 8 32 L 24 40 L 32 56 L 40 40 L 56 32 L 40 24 Z') + circle(32, 32, 4),
  unicorn:   circle(32, 36, 14) + path('M 32 22 L 28 8') + circle(38, 34, 1.5) + path('M 18 36 Q 12 36 14 30'),
  pegasus:   circle(32, 36, 14) + path('M 18 28 L 8 16 L 16 28') + path('M 46 28 L 56 16 L 48 28'),
  kraken:    circle(32, 24, 14) + path('M 20 32 Q 16 48 24 56') + path('M 32 32 Q 28 48 36 56') + path('M 44 32 Q 48 48 40 56'),
  dolphin:   path('M 8 32 Q 24 16 40 24 L 56 16 Q 52 32 40 36 Q 24 48 8 32 Z') + circle(20, 28, 1.5),
  leopard:   circle(32, 32, 20) + circle(22, 26, 2) + circle(28, 36, 2) + circle(40, 26, 2) + circle(42, 38, 2),
  panther:   path('M 14 24 Q 32 12 50 24 L 50 44 Q 32 56 14 44 Z') + circle(26, 30, 1.5) + circle(38, 30, 1.5),
  fox:       poly('16,40 24,12 32,28 40,12 48,40') + circle(26, 32, 1.5) + circle(38, 32, 1.5) + path('M 30 38 L 32 42 L 34 38'),
  bear:      circle(32, 36, 16) + circle(18, 22, 6) + circle(46, 22, 6) + circle(26, 34, 1.5) + circle(38, 34, 1.5),
  shark:     path('M 8 32 L 56 24 L 48 40 L 56 36 L 40 48 L 24 40 L 8 32 Z') + circle(48, 30, 1.5),
  hawk:      path('M 8 40 L 32 16 L 56 40') + path('M 24 32 L 32 24 L 40 32'),
  serpent:   path('M 8 16 Q 16 24 24 16 T 40 24 T 56 16') + path('M 8 32 Q 16 40 24 32 T 40 40 T 56 32') + path('M 8 48 Q 16 56 24 48 T 40 56 T 56 48'),
  scorpion:  path('M 16 40 L 32 48 L 48 40') + path('M 16 40 L 8 48 L 16 56') + path('M 48 40 L 56 48 L 48 56') + path('M 32 16 L 32 32') + circle(32, 12, 4),
  crab:      ellipse(32, 36, 20, 12) + circle(22, 30, 1.5) + circle(42, 30, 1.5) + path('M 12 36 L 4 44 M 52 36 L 60 44') + path('M 16 44 L 12 56 M 48 44 L 52 56'),
  butterfly: ellipse(20, 24, 12, 14) + ellipse(44, 24, 12, 14) + ellipse(20, 44, 10, 10) + ellipse(44, 44, 10, 10) + line(32, 14, 32, 54),
};

/* ============================================================
   Pack: ANCIENT (20)
   ============================================================ */
const ANCIENT = {
  scarab:    ellipse(32, 32, 18, 22) + line(32, 10, 32, 54) + line(14, 28, 50, 28) + line(14, 44, 50, 44),
  ankh:      circle(32, 18, 8) + line(32, 26, 32, 56) + line(16, 36, 48, 36),
  pyramid:   poly('32,8 56,56 8,56') + line(32, 8, 32, 56) + line(8, 56, 32, 32) + line(56, 56, 32, 32),
  sphinx:    rect(12, 36, 40, 20) + circle(32, 24, 12) + circle(28, 22, 1.5) + circle(36, 22, 1.5),
  coin:      circle(32, 32, 22) + circle(32, 32, 16) + text(32, 38, '$', 16),
  amulet:    circle(32, 36, 16) + path('M 24 22 L 32 14 L 40 22') + circle(32, 36, 6),
  mask:      ellipse(32, 32, 20, 24) + circle(26, 28, 2) + circle(38, 28, 2) + path('M 26 42 L 32 46 L 38 42'),
  glyph:     rect(8, 8, 48, 48) + path('M 16 16 L 24 24 L 16 32 L 24 40 L 16 48') + path('M 32 16 L 32 48') + path('M 40 16 L 48 24 L 40 32 L 48 40 L 40 48'),
  scroll:    rect(8, 20, 48, 24) + circle(8, 32, 4) + circle(56, 32, 4) + line(20, 32, 44, 32),
  column:    rect(20, 8, 24, 8) + rect(24, 16, 16, 40) + rect(16, 56, 32, 4) + line(28, 16, 28, 56) + line(36, 16, 36, 56),
  urn:       path('M 20 16 Q 32 8 44 16 L 44 24 Q 56 32 48 48 L 16 48 Q 8 32 20 24 Z') + line(20, 24, 44, 24),
  chalice:   path('M 16 8 L 48 8 L 44 32 Q 32 36 20 32 Z') + line(32, 32, 32, 48) + rect(20, 48, 24, 8),
  spear:     poly('32,4 36,16 32,28 28,16') + line(32, 28, 32, 60),
  shield:    path('M 32 4 L 56 12 Q 56 40 32 60 Q 8 40 8 12 Z') + path('M 32 20 L 32 44') + path('M 20 32 L 44 32'),
  sword:     path('M 32 4 L 36 8 L 36 44 L 32 48 L 28 44 L 28 8 Z') + line(20, 44, 44, 44) + line(32, 48, 32, 60),
  crown:     path('M 8 32 L 16 16 L 24 24 L 32 12 L 40 24 L 48 16 L 56 32 Z') + line(8, 32, 56, 32) + line(8, 44, 56, 44),
  throne:    rect(16, 24, 32, 32) + rect(20, 8, 24, 16) + line(16, 56, 12, 60) + line(48, 56, 52, 60),
  temple:    poly('8,32 32,8 56,32') + rect(12, 32, 40, 24) + line(20, 32, 20, 56) + line(32, 32, 32, 56) + line(44, 32, 44, 56),
  tomb:      rect(8, 40, 48, 16) + rect(16, 16, 32, 24) + path('M 16 16 Q 32 8 48 16'),
  'sun-disk': circle(32, 32, 14) + line(32, 8, 32, 14) + line(32, 50, 32, 56) + line(8, 32, 14, 32) + line(50, 32, 56, 32) + line(14, 14, 18, 18) + line(46, 46, 50, 50) + line(14, 50, 18, 46) + line(46, 18, 50, 14),
};

/* ============================================================
   Pack: SCIFI (20)
   ============================================================ */
const SCIFI = {
  rocket:     path('M 32 4 L 40 24 L 40 48 L 24 48 L 24 24 Z') + path('M 24 48 L 16 56 L 24 52') + path('M 40 48 L 48 56 L 40 52') + circle(32, 24, 4),
  planet:     circle(32, 32, 16) + ellipse(32, 32, 26, 8),
  star:       poly('32,4 39,24 60,24 43,38 49,58 32,46 15,58 21,38 4,24 25,24'),
  nebula:     path('M 8 32 Q 16 16 32 24 Q 48 16 56 32 Q 48 48 32 40 Q 16 48 8 32 Z') + circle(24, 30, 2) + circle(40, 32, 2) + circle(32, 36, 2),
  'black-hole': circle(32, 32, 8) + circle(32, 32, 16) + circle(32, 32, 24),
  spaceship:  ellipse(32, 32, 24, 8) + path('M 24 28 L 32 16 L 40 28') + circle(32, 24, 2),
  robot:      rect(20, 16, 24, 24, 2) + rect(24, 40, 16, 16) + circle(26, 24, 1.5) + circle(38, 24, 1.5) + line(20, 28, 8, 28) + line(44, 28, 56, 28),
  laser:      line(8, 32, 56, 32) + line(8, 28, 8, 36) + line(56, 28, 56, 36) + line(20, 24, 20, 40) + line(44, 24, 44, 40),
  portal:     ellipse(32, 32, 20, 24) + ellipse(32, 32, 12, 16) + ellipse(32, 32, 4, 8),
  asteroid:   poly('20,12 44,8 56,24 52,44 36,56 16,52 8,32'),
  satellite:  rect(24, 24, 16, 16) + rect(8, 28, 16, 8) + rect(40, 28, 16, 8) + line(32, 40, 32, 56) + circle(32, 32, 2),
  galaxy:     path('M 32 8 Q 56 16 56 32 Q 56 48 32 56 Q 8 48 8 32 Q 8 16 32 8') + circle(32, 32, 4) + circle(20, 24, 1) + circle(44, 40, 1),
  atom:       circle(32, 32, 4) + ellipse(32, 32, 22, 10) + ellipse(32, 32, 10, 22),
  neutron:    circle(32, 32, 10) + ellipse(32, 32, 28, 6) + ellipse(32, 32, 6, 28),
  quasar:     circle(32, 32, 6) + line(32, 4, 32, 16) + line(32, 48, 32, 60) + line(4, 32, 16, 32) + line(48, 32, 60, 32) + circle(32, 32, 18),
  wormhole:   ellipse(32, 32, 26, 10) + ellipse(32, 32, 18, 8) + ellipse(32, 32, 10, 6) + circle(32, 32, 2),
  hologram:   rect(16, 20, 32, 32) + line(20, 24, 44, 24) + line(20, 32, 44, 32) + line(20, 40, 44, 40) + line(20, 48, 44, 48) + circle(32, 12, 2),
  drone:      rect(28, 28, 8, 8) + circle(16, 16, 6) + circle(48, 16, 6) + circle(16, 48, 6) + circle(48, 48, 6) + line(22, 22, 28, 28) + line(42, 22, 36, 28) + line(22, 42, 28, 36) + line(42, 42, 36, 36),
  capsule:    ellipse(32, 32, 12, 22) + line(20, 32, 44, 32) + circle(32, 22, 2) + circle(32, 42, 2),
  orbit:      circle(32, 32, 4) + circle(32, 32, 20) + circle(52, 32, 3) + circle(12, 32, 3),
};

/* ============================================================
   Pack: UNIVERSAL (20) — wild/scatter/bonus variants
   ============================================================ */
const UNIVERSAL = {
  'wild-1':       poly('32,6 39,24 60,24 43,38 49,58 32,46 15,58 21,38 4,24 25,24') + text(32, 36, 'W', 16),
  'wild-2':       rect(8, 8, 48, 48, 8) + text(32, 40, 'W', 24),
  'wild-3':       circle(32, 32, 24) + text(32, 40, 'W', 24),
  'scatter-1':    circle(32, 32, 20) + circle(20, 22, 4) + circle(44, 22, 4) + circle(20, 42, 4) + circle(44, 42, 4) + circle(32, 32, 4),
  'scatter-2':    poly('32,8 56,32 32,56 8,32') + text(32, 40, 'S', 18),
  'scatter-3':    poly('32,4 39,24 60,24 43,38 49,58 32,46 15,58 21,38 4,24 25,24') + text(32, 40, 'S', 14),
  'bonus-1':      rect(8, 8, 48, 48, 6) + text(32, 40, 'B', 24),
  'bonus-2':      circle(32, 32, 24) + text(32, 40, 'B', 24),
  'bonus-3':      poly('32,4 56,20 56,44 32,60 8,44 8,20') + text(32, 40, 'B', 20),
  'mult-2x':      rect(8, 16, 48, 32, 6) + text(32, 40, '2x', 20),
  'mult-5x':      rect(8, 16, 48, 32, 6) + text(32, 40, '5x', 20),
  'mult-10x':     rect(8, 16, 48, 32, 6) + text(32, 40, '10x', 16),
  'retrigger':    circle(32, 32, 20) + path('M 32 14 L 32 26 L 38 22'),
  'sticky':       rect(12, 12, 40, 40, 4) + line(20, 20, 44, 44) + line(44, 20, 20, 44),
  'expanding':    rect(20, 20, 24, 24) + line(20, 20, 8, 8) + line(44, 20, 56, 8) + line(20, 44, 8, 56) + line(44, 44, 56, 56),
  'walking':      rect(16, 16, 32, 32, 4) + path('M 32 32 L 48 16 M 48 16 L 40 14 M 48 16 L 46 24'),
  'mystery':      circle(32, 32, 22) + text(32, 40, '?', 28),
  'cascade':      path('M 16 16 L 16 32 L 32 32 L 32 48 L 48 48') + path('M 12 28 L 16 32 L 20 28') + path('M 28 44 L 32 48 L 36 44'),
  'jackpot':      poly('32,4 39,24 60,24 43,38 49,58 32,46 15,58 21,38 4,24 25,24') + text(32, 36, 'J', 14),
  'progressive':  rect(8, 24, 48, 16, 4) + line(16, 32, 24, 32) + line(28, 32, 36, 32) + line(40, 32, 48, 32),
};

/* ============================================================
   Pack: ACCENT (20)
   ============================================================ */
const ACCENT = {
  banner:          path('M 8 16 L 56 16 L 48 32 L 56 48 L 8 48 Z') + line(20, 28, 44, 28) + line(20, 36, 44, 36),
  'scroll-overlay': rect(8, 16, 48, 32, 4) + path('M 8 24 Q 4 32 8 40') + path('M 56 24 Q 60 32 56 40'),
  sparkle:         line(32, 8, 32, 56) + line(8, 32, 56, 32) + line(16, 16, 48, 48) + line(48, 16, 16, 48),
  'star-burst':    line(32, 4, 32, 60) + line(4, 32, 60, 32) + line(12, 12, 52, 52) + line(52, 12, 12, 52) + circle(32, 32, 8),
  'coin-stack':    ellipse(32, 18, 18, 4) + ellipse(32, 28, 18, 4) + ellipse(32, 38, 18, 4) + ellipse(32, 48, 18, 4) + line(14, 18, 14, 48) + line(50, 18, 50, 48),
  'treasure-chest': rect(8, 28, 48, 24) + path('M 8 28 Q 32 16 56 28') + rect(28, 36, 8, 12) + circle(32, 42, 1.5),
  'lucky-charm':   path('M 32 16 L 16 32 L 32 48 L 48 32 Z') + circle(32, 32, 6) + path('M 32 48 L 32 60'),
  clover:          circle(20, 24, 8) + circle(44, 24, 8) + circle(20, 40, 8) + circle(44, 40, 8) + line(32, 32, 32, 56),
  horseshoe:       path('M 16 16 L 16 40 Q 16 56 32 56 Q 48 56 48 40 L 48 16') + circle(20, 18, 1.5) + circle(28, 14, 1.5) + circle(36, 14, 1.5) + circle(44, 18, 1.5),
  dice:            rect(8, 8, 48, 48, 6) + circle(20, 20, 2) + circle(44, 20, 2) + circle(32, 32, 2) + circle(20, 44, 2) + circle(44, 44, 2),
  'cards-suite':   path('M 32 48 L 14 30 Q 14 20 22 20 Q 28 20 32 28 Q 36 20 42 20 Q 50 20 50 30 Z'),
  roulette:        circle(32, 32, 22) + circle(32, 32, 12) + line(32, 10, 32, 22) + line(32, 42, 32, 54) + line(10, 32, 22, 32) + line(42, 32, 54, 32),
  'slot-handle':   rect(28, 16, 8, 32) + circle(32, 12, 6) + rect(20, 48, 24, 8),
  vault:           rect(8, 8, 48, 48, 4) + circle(32, 32, 14) + line(32, 32, 32, 20) + line(32, 32, 44, 40) + line(32, 32, 20, 40),
  safe:            rect(8, 12, 48, 40, 4) + circle(32, 32, 10) + line(32, 32, 32, 24) + line(32, 32, 40, 32),
  locks:           rect(20, 28, 24, 24, 2) + path('M 24 28 L 24 20 Q 24 12 32 12 Q 40 12 40 20 L 40 28'),
  keys:            circle(20, 32, 8) + line(28, 32, 56, 32) + line(48, 28, 48, 36) + line(54, 28, 54, 36),
  chains:          ellipse(20, 20, 6, 4) + ellipse(28, 28, 6, 4) + ellipse(36, 36, 6, 4) + ellipse(44, 44, 6, 4),
  chest:           rect(8, 24, 48, 28) + path('M 12 24 Q 32 12 52 24') + rect(28, 32, 8, 12),
  pouch:           path('M 16 16 L 48 16 L 56 48 L 8 48 Z') + path('M 24 16 Q 32 8 40 16'),
};

/* ============================================================
   Pack assembly
   ============================================================ */
const PACKS = [
  { id: 'fruit',     dir: 'fruit',     icons: FRUIT },
  { id: 'card',      dir: 'card',      icons: CARDS },
  { id: 'gem',       dir: 'gem',       icons: GEM },
  { id: 'animal',    dir: 'animal',    icons: ANIMAL },
  { id: 'ancient',   dir: 'ancient',   icons: ANCIENT },
  { id: 'scifi',     dir: 'scifi',     icons: SCIFI },
  { id: 'universal', dir: 'universal', icons: UNIVERSAL },
  { id: 'accent',    dir: 'accent',    icons: ACCENT },
];

function writeIfChanged(absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true });
  let prevSame = false;
  if (existsSync(absPath)) {
    try { prevSame = readFileSync(absPath, 'utf8') === content; } catch {}
  }
  if (!prevSame) writeFileSync(absPath, content);
}

function main() {
  console.log(`[symbol-lib] generator boot — DRY_RUN=${DRY_RUN}`);
  let total = 0;
  const manifest = { schema_version: '1.0.0', generated_by: 'scripts/generate-symbol-library.mjs', packs: [] };
  for (const pack of PACKS) {
    const packDir = resolve(OUT_DIR, pack.dir);
    const items = [];
    for (const [name, body] of Object.entries(pack.icons)) {
      const filename = `${name}.svg`;
      const absPath = resolve(packDir, filename);
      const svg = svgWrap(body);
      if (!DRY_RUN) writeIfChanged(absPath, svg);
      items.push({ id: name, file: `${pack.dir}/${filename}` });
      total++;
    }
    manifest.packs.push({ id: pack.id, dir: pack.dir, count: items.length, items });
  }
  // Also include the 40 base flat icons as `base` pack reference
  const baseFiles = readdirSync(OUT_DIR).filter((f) => f.endsWith('.svg'));
  manifest.packs.unshift({
    id: 'base', dir: '.', count: baseFiles.length,
    items: baseFiles.map((f) => ({ id: f.replace(/\.svg$/, ''), file: f })),
  });
  manifest.total = total + baseFiles.length;
  const idxPath = resolve(OUT_DIR, 'index.json');
  const idxJson = JSON.stringify(manifest, null, 2) + '\n';
  if (!DRY_RUN) writeIfChanged(idxPath, idxJson);
  console.log(`[symbol-lib] done — ${total} new SVGs in ${PACKS.length} packs (base+${baseFiles.length}, grand total ${total + baseFiles.length})`);
}

main();
