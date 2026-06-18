#!/usr/bin/env node
/**
 * tests/cross-game-parity.mjs · Functional Item #2 — Cross-game parity matrix
 *
 * What it proves:
 *   For every FEATURE kind that appears in ≥2 real-game models, the
 *   corresponding block(s) must render with an IDENTICAL DOM contract
 *   across all games. This is the LEGO invariant lifted from
 *   per-block (vertical) to cross-game (horizontal).
 *
 *   Background: 122 blocks × 13 strict checks already proves every
 *   block is self-consistent. But two games consuming the same block
 *   could in theory drift if smart-defaults / theme overrides / parser
 *   inferences inject different config. This probe catches that drift.
 *
 * Method:
 *   1. Load each `dist/real-games/<slug>/model.json` + `slot.html`.
 *   2. Boot every `slot.html` in headless Chromium (single browser
 *      session, parallel page contexts).
 *   3. For every (feature kind × game) pair, compute a DOM SIGNATURE:
 *
 *        signature = {
 *          presence: { hostSelector: boolean },
 *          shape: {
 *            hostSelector: {
 *              tag, classes (sorted),
 *              role, aria-keys (sorted, values normalized),
 *              data-keys (sorted, values normalized),
 *            }
 *          }
 *        }
 *
 *   4. For each feature kind present in ≥2 games, the signatures must
 *      be deep-equal modulo theme palette / language-specific text.
 *      Any divergence is a PARITY VIOLATION.
 *
 *   5. Report:
 *      - Coverage matrix (feature × game = present?)
 *      - Parity matrix (feature × game = signature stable?)
 *      - Per-violation detail (first divergent key)
 *
 * Exit codes:
 *   0  every multi-game feature has identical DOM contract everywhere
 *   1  one or more parity violations
 *   2  no real-game artifacts found (run parse-real-pdfs.mjs first)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const ART_DIR = resolve(REPO, 'dist/real-games');
const OUT_DIR = resolve(REPO, 'dist/cross-game-parity');

const bar = (ch = '─', n = 100) => ch.repeat(n);

if (!existsSync(ART_DIR)) {
  console.error(`❌ ${ART_DIR} not found. Run \`node tests/parse-real-pdfs.mjs\` first.`);
  process.exit(2);
}

const games = readdirSync(ART_DIR)
  .filter(d => statSync(resolve(ART_DIR, d)).isDirectory())
  .filter(d => existsSync(resolve(ART_DIR, d, 'slot.html')) && existsSync(resolve(ART_DIR, d, 'model.json')))
  .map(slug => {
    const model = JSON.parse(readFileSync(resolve(ART_DIR, slug, 'model.json'), 'utf-8'));
    const kinds = (model.features || []).map(f => f.kind);
    return { slug, model, kinds };
  });

if (games.length < 2) {
  console.error(`❌ Need ≥2 real games for parity. Found ${games.length}.`);
  process.exit(2);
}

console.log(bar('═'));
console.log(`🔬 Cross-game parity matrix · ${games.length} games`);
console.log(bar('═'));

/**
 * Feature kind → DOM host selectors that MUST be present + shape-checked.
 *
 * The selectors are the canonical hosts emitted by `buildSlotHTML`. If
 * a feature kind has multiple hosts (e.g., free_spins emits HUD + toast
 * + progress), all must pass parity for the cell to be ✓.
 *
 * Only feature kinds that emit observable runtime DOM are listed.
 * Pure evaluation features (cluster_pays, ways, pay_anywhere,
 * scatter_pay) and meta features (feature_generic) are skipped — no
 * DOM contract to compare.
 */
const FEATURE_DOM_CONTRACTS = {
  free_spins: [
    { sel: '#fsHud',         required: true,  attrs: ['role', 'aria-label'] },
    { sel: '#fsToast',       required: true,  attrs: ['role', 'aria-live', 'aria-atomic'] },
    { sel: '#fsProgress',    required: true,  attrs: ['role', 'aria-valuemin'] },
    { sel: '#stageBadge',    required: true,  attrs: ['data-stage', 'aria-live'] },
  ],
  multiplier: [
    { sel: '#multLadder',    required: true,  attrs: ['role', 'aria-live', 'aria-label', 'data-visible', 'data-tier'] },
  ],
  hold_and_win: [
    { sel: '#hwFullgrid',    required: true,  attrs: ['class', 'data-show'] },
  ],
  bonus_buy: [
    /* Canonical button host is `#bonusBuyBtn` (class .bonus-buy-btn).
     * It mounts in the bet panel chrome — REQUIRED whenever the
     * feature kind is in the model (else the player can't trigger it). */
    { sel: '#bonusBuyBtn',   required: true,  attrs: ['class', 'role', 'aria-label'] },
  ],
  cascade: [
    /* Cascade has no dedicated DOM host — it's an engine-level
       mechanic that mutates the grid in-place. Skip but keep mapped
       for matrix completeness. */
  ],
  jackpot: [
    /* Jackpot tiers are rendered via shared bigWinTier infra; checked
       under big-win tier presence rather than a dedicated host. */
  ],
  ante_bet: [
    /* Ante bet toggle lives in the bet selector chrome — covered by
       the bet selector parity check, not a separate row. */
  ],
};

/**
 * Compute a deterministic DOM signature for a given selector inside
 * the page. Returns null if the node is absent (caller decides whether
 * that's a violation based on `required`).
 *
 * Signature is intentionally STRUCTURAL — text content is excluded so
 * theme/language differences don't trigger false positives. The
 * cross-game parity question is "is the contract identical", not
 * "is the label identical".
 */
async function signatureOf(page, sel, attrs) {
  return await page.evaluate(({ sel, attrs }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const sig = {
      tag: el.tagName.toLowerCase(),
      classes: Array.from(el.classList).sort().join(' '),
    };
    for (const a of attrs) {
      sig[a] = el.getAttribute(a);
    }
    return sig;
  }, { sel, attrs });
}

/* ── 1. Boot every game in Chromium and harvest signatures ─────────────── */
const browser = await chromium.launch({ headless: true });
const harvest = {}; /* game.slug → { feature → { sel → signature|null } } */

for (const g of games) {
  process.stdout.write(`  • ${g.slug.padEnd(40)} boot... `);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(resolve(ART_DIR, g.slug, 'slot.html')).href, {
    waitUntil: 'load',
    timeout: 8000,
  });
  await page.waitForTimeout(200);

  harvest[g.slug] = {};
  for (const kind of g.kinds) {
    const contract = FEATURE_DOM_CONTRACTS[kind];
    if (!contract || contract.length === 0) continue;
    harvest[g.slug][kind] = {};
    for (const { sel, attrs } of contract) {
      harvest[g.slug][kind][sel] = await signatureOf(page, sel, attrs);
    }
  }
  await ctx.close();
  console.log('✓');
}
await browser.close();

/* ── 2. Build coverage matrix (feature × game = present?) ──────────────── */
const allKinds = [...new Set(games.flatMap(g => g.kinds))].sort();
const multiGameKinds = allKinds.filter(k => games.filter(g => g.kinds.includes(k)).length >= 2);
const checkableKinds = multiGameKinds.filter(k => FEATURE_DOM_CONTRACTS[k]?.length);

console.log(`\n${bar('═')}`);
console.log('COVERAGE MATRIX · feature × game (✓ in model, · absent)');
console.log(bar('═'));

const gameNameCol = 28;
const cellW = 4;
const header = '│ ' + 'Feature kind'.padEnd(20) + ' │ ' +
  games.map(g => g.slug.slice(0, gameNameCol).padEnd(gameNameCol)).join(' │ ') + ' │';
const sepRow = '├─' + '─'.repeat(20) + '─┼─' +
  games.map(() => '─'.repeat(gameNameCol)).join('─┼─') + '─┤';

console.log('┌─' + '─'.repeat(20) + '─┬─' +
  games.map(() => '─'.repeat(gameNameCol)).join('─┬─') + '─┐');
console.log(header);
console.log(sepRow);
for (const kind of allKinds) {
  const cells = games.map(g => {
    const present = g.kinds.includes(kind);
    return (present ? '✓' : '·').padEnd(gameNameCol);
  });
  console.log('│ ' + kind.padEnd(20) + ' │ ' + cells.join(' │ ') + ' │');
}
console.log('└─' + '─'.repeat(20) + '─┴─' +
  games.map(() => '─'.repeat(gameNameCol)).join('─┴─') + '─┘');

/* ── 3. Parity check on multi-game checkable features ──────────────────── */
console.log(`\n${bar('═')}`);
console.log(`PARITY CHECK · ${checkableKinds.length} multi-game feature kind(s) with DOM contracts`);
console.log(bar('═'));

const violations = [];

for (const kind of checkableKinds) {
  const contract = FEATURE_DOM_CONTRACTS[kind];
  const carrierGames = games.filter(g => g.kinds.includes(kind));
  console.log(`\n▸ ${kind} (in ${carrierGames.length} games)`);

  for (const { sel, required } of contract) {
    /* Canonical signature = first carrier game whose signature is non-null.
     * If the first carrier in declaration order has the host missing
     * (e.g., theme-conditional render) we don't want that to silently
     * skip parity — we promote the first present signature as the
     * reference and then check ALL carriers against it. */
    const refIdx = carrierGames.findIndex(g => harvest[g.slug]?.[kind]?.[sel] != null);
    if (refIdx === -1) {
      if (required) {
        violations.push({
          kind, sel,
          severity: 'missing',
          game: '<all carriers>',
          detail: `required host ${sel} absent in every game declaring kind=${kind}`,
        });
        console.log(`  ✗ ${sel.padEnd(20)} REQUIRED but absent in every carrier`);
      } else {
        console.log(`  · ${sel.padEnd(20)} optional, absent everywhere — skip`);
      }
      continue;
    }
    const refGame = carrierGames[refIdx];
    const ref = harvest[refGame.slug][kind][sel];

    let ok = true;
    for (let i = 0; i < carrierGames.length; i++) {
      if (i === refIdx) continue;
      const other = carrierGames[i];
      const sig = harvest[other.slug]?.[kind]?.[sel];
      if (sig == null) {
        if (required) {
          violations.push({
            kind, sel,
            severity: 'missing',
            game: other.slug,
            detail: `required host ${sel} present in ${refGame.slug} but absent in ${other.slug}`,
          });
          ok = false;
        }
        continue;
      }
      const refKeys = Object.keys(ref).sort();
      const sigKeys = Object.keys(sig).sort();
      const allKeys = [...new Set([...refKeys, ...sigKeys])];
      for (const k of allKeys) {
        if (ref[k] !== sig[k]) {
          violations.push({
            kind, sel,
            severity: 'drift',
            key: k,
            refGame: refGame.slug,
            refValue: ref[k],
            otherGame: other.slug,
            otherValue: sig[k],
            detail: `${sel}.${k}: ref="${ref[k]}" vs ${other.slug}="${sig[k]}"`,
          });
          ok = false;
        }
      }
    }
    console.log(`  ${ok ? '✓' : '✗'} ${sel.padEnd(20)} ${ok ? 'parity OK across ' + carrierGames.length : 'DRIFT'}`);
  }
}

/* ── 4. Persist artifacts ──────────────────────────────────────────────── */
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  resolve(OUT_DIR, 'harvest.json'),
  JSON.stringify(harvest, null, 2),
);
writeFileSync(
  resolve(OUT_DIR, 'violations.json'),
  JSON.stringify(violations, null, 2),
);

/* ── 5. Summary ────────────────────────────────────────────────────────── */
console.log(`\n${bar('═')}`);
console.log('SUMMARY');
console.log(bar('═'));
console.log(`Games tested        : ${games.length}`);
console.log(`Feature kinds       : ${allKinds.length} total · ${multiGameKinds.length} multi-game · ${checkableKinds.length} with DOM contract`);
console.log(`Parity violations   : ${violations.length}`);
console.log(`Artifacts           : dist/cross-game-parity/{harvest,violations}.json`);

if (violations.length > 0) {
  console.log(`\nFirst 5 violations:`);
  for (const v of violations.slice(0, 5)) {
    console.log(`  ✗ [${v.severity}] ${v.kind}/${v.sel}: ${v.detail}`);
  }
}

process.exit(violations.length > 0 ? 1 : 0);
