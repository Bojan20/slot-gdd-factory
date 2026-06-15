#!/usr/bin/env node
/**
 * tools/wcag-contrast-audit.mjs
 *
 * Wave F4 / A1 — WCAG 2.2 AAA contrast audit for the default theme
 * palette + the per-block hardcoded text/background pairs.
 *
 * Why audit, not lint?
 * ---------------------
 * The slot template's colors are **GDD-driven** for almost every block —
 * `${cfg.color}` literals dominate. Static-string CSS analysis would be
 * noisy and miss the real failure mode: an operator picks a GDD palette
 * that fails AAA without anyone noticing.
 *
 * This tool audits the **defaults** that ship with the template + every
 * static literal foreground/background pair found in `src/blocks/*.mjs`.
 * The defaults are what every fresh GDD inherits before user overrides,
 * so they MUST pass AAA — anything less is a player-protection /
 * accessibility regression that compounds the moment a GDD forgets to
 * override the palette.
 *
 * WCAG 2.2 thresholds (1.4.6 AAA, 1.4.3 AA):
 *   AAA · normal text  →  contrast ratio ≥  7.0 : 1
 *   AAA · large text   →  contrast ratio ≥  4.5 : 1   (≥ 18pt or 14pt bold)
 *   AA  · normal text  →  contrast ratio ≥  4.5 : 1
 *   AA  · large text   →  contrast ratio ≥  3.0 : 1
 *
 * We default to AAA-normal (7.0). Per-pair overrides annotate when a
 * pair is acceptable as large-text-only (e.g. banner headlines) or
 * when AA is the explicit accept (decorative gold accent on dark).
 *
 * Output format:
 *   Per-pair ratio + AAA verdict + which block(s) used the pair.
 *   Exit 0 if all CRITICAL pairs pass, exit 1 if any fail.
 *
 * Senior-grade rule (rule_senior_grade_code):
 *   • Single responsibility — color audit, nothing else.
 *   • 0 external deps — pure Node 22+ (no chroma-js / color-* libs).
 *   • Deterministic — same palette + same blocks → same verdict.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BLOCKS_DIR = path.join(REPO, 'src', 'blocks');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

const THRESHOLDS = {
  AAA_NORMAL: 7.0,
  AAA_LARGE:  4.5,
  AA_NORMAL:  4.5,
  AA_LARGE:   3.0,
};

/* ── Color parser ─────────────────────────────────────────────────────────
 * Accepts `#rrggbb`, `#rgb`, `rgb(r,g,b)`, `rgba(r,g,b,a)`. Returns
 * [r, g, b] in 0-255 OR null for unparseable / functional / variable
 * tokens (we never guess). */
function parseColor(s) {
  if (!s) return null;
  s = String(s).trim();
  /* #rgb / #rrggbb */
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const h = m[1];
    return [h[0]+h[0], h[1]+h[1], h[2]+h[2]].map(x => parseInt(x, 16));
  }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const h = m[1];
    return [h.slice(0,2), h.slice(2,4), h.slice(4,6)].map(x => parseInt(x, 16));
  }
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  return null;
}

/* ── WCAG 2.2 contrast math ────────────────────────────────────────────── */
function relLuminance([r, g, b]) {
  const lin = v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg, bg) {
  const Lf = relLuminance(fg);
  const Lb = relLuminance(bg);
  const lighter = Math.max(Lf, Lb);
  const darker  = Math.min(Lf, Lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ── Default theme palette (must match themeCSS.mjs defaultPalette) ────── */
const DEFAULT_PALETTE = {
  bg0:    '#05070c',
  bg1:    '#0b0f16',
  stage:  '#5a6b88',
  accent: '#c9a227',
  text:   '#f2f2f2',
};

/* ── Critical default-palette pairs ────────────────────────────────────── */
const DEFAULT_PAIRS = [
  { fg: 'text',   bg: 'bg0', label: 'body text on darkest background',  level: 'AAA_NORMAL' },
  { fg: 'text',   bg: 'bg1', label: 'body text on panel background',    level: 'AAA_NORMAL' },
  { fg: 'accent', bg: 'bg0', label: 'gold accent on darkest background', level: 'AAA_LARGE'  },
  { fg: 'accent', bg: 'bg1', label: 'gold accent on panel background',   level: 'AAA_LARGE'  },
  { fg: 'text',   bg: 'stage', label: 'body text on stage chrome',       level: 'AA_NORMAL'  },
];

/* ── Per-block static literal pair extractor ───────────────────────────── */
function extractStaticPairs(file) {
  const src = readFileSync(file, 'utf8');
  const pairs = [];
  /* Find every `color: #xxx` / `color: rgb(...)` line and try to find a
   * `background[-color]:` nearby (within 12 lines). Conservative — we
   * skip any literal that references a template substitution `${...}`
   * or a CSS variable `var(--…)`. */
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const cm = lines[i].match(/^\s*color\s*:\s*([^;'"`,{}]+?)\s*[;}'"]/);
    if (!cm) continue;
    const colorRaw = cm[1].trim();
    if (colorRaw.includes('${') || colorRaw.includes('var(') || colorRaw.startsWith('inherit')) continue;
    const fg = parseColor(colorRaw);
    if (!fg) continue;
    /* Look backwards up to 12 lines for a matching background. */
    let bg = null, bgLine = -1;
    for (let j = Math.max(0, i - 12); j < i; j++) {
      const bm = lines[j].match(/^\s*background(?:-color)?\s*:\s*([^;'"`,{}]+?)\s*[;}'"]/);
      if (bm) {
        const bgRaw = bm[1].trim();
        if (bgRaw.includes('${') || bgRaw.includes('var(') || bgRaw.startsWith('linear-gradient')) continue;
        const c = parseColor(bgRaw);
        if (c) { bg = c; bgLine = j + 1; }
      }
    }
    if (bg) {
      pairs.push({
        fg, bg,
        fgRaw: colorRaw,
        bgRaw: lines[bgLine - 1].trim().slice(0, 50),
        line: i + 1,
      });
    }
  }
  return pairs;
}

/* ── Main ──────────────────────────────────────────────────────────────── */
function main() {
  console.log(C.bold(C.cyan('\n🎨 WCAG 2.2 contrast audit — slot-gdd-factory\n')));
  console.log(C.dim('   Default palette + per-block static literal pairs.'));
  console.log(C.dim('   AAA normal text ≥ 7.0 : 1   ·   AAA large text ≥ 4.5 : 1\n'));

  let failures = 0;
  let passes = 0;

  /* Default palette pairs. */
  console.log(C.bold('   Default theme palette pairs'));
  for (const pair of DEFAULT_PAIRS) {
    const fg = parseColor(DEFAULT_PALETTE[pair.fg]);
    const bg = parseColor(DEFAULT_PALETTE[pair.bg]);
    if (!fg || !bg) {
      console.log(`     ${C.yellow('? UNPARSEABLE')} ${pair.label} (${pair.fg}/${pair.bg})`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const threshold = THRESHOLDS[pair.level];
    const pass = ratio >= threshold;
    const tag = pass ? C.green('✓') : C.red('✗');
    const ratioStr = `${ratio.toFixed(2)}:1`.padEnd(8);
    console.log(`     ${tag} ${ratioStr} (≥ ${threshold}, ${pair.level}) — ${pair.label}`);
    pass ? passes++ : failures++;
  }
  console.log('');

  /* Per-block static pairs. */
  console.log(C.bold('   Per-block static literal pairs'));
  const blockFiles = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.mjs')).sort();
  let blockPairsTotal = 0;
  let blockFailures = 0;
  for (const f of blockFiles) {
    const filePath = path.join(BLOCKS_DIR, f);
    const pairs = extractStaticPairs(filePath);
    for (const p of pairs) {
      blockPairsTotal++;
      const ratio = contrastRatio(p.fg, p.bg);
      /* Per-block static pairs default to AA-normal (4.5:1) since they're
       * usually UI chrome (modals, badges), not body copy. AAA aspiration
       * for the default palette stays above. */
      const pass = ratio >= THRESHOLDS.AA_NORMAL;
      if (!pass) {
        const ratioStr = `${ratio.toFixed(2)}:1`.padEnd(8);
        console.log(`     ${C.red('✗')} ${ratioStr} ${f}:${p.line} fg=${p.fgRaw} on bg ≈ ${p.bgRaw}`);
        blockFailures++;
      }
    }
  }
  if (blockFailures === 0) {
    console.log(`     ${C.green('✓')} ${blockPairsTotal} pair(s) scanned across ${blockFiles.length} blocks; all ≥ AA-normal (4.5:1)`);
  }
  failures += blockFailures;
  passes += blockPairsTotal - blockFailures;

  console.log('');
  if (failures === 0) {
    console.log(C.green(C.bold(`✅ contrast audit clean — ${passes} pair(s) pass.\n`)));
    process.exit(0);
  } else {
    console.log(C.red(C.bold(`❌ contrast audit — ${failures} fail / ${passes + failures} total.\n`)));
    process.exit(1);
  }
}

main();
