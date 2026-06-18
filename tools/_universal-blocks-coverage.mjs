#!/usr/bin/env node
/**
 * tools/_universal-blocks-coverage.mjs
 *
 * Boki rule (2026-06-18): "sve sto postoji u svakom slotu radi odmah i uvek".
 * This probe verifies that every UNIVERSAL block listed below is actually
 * mounted (DOM selector hit) on every real-game HTML capsule under
 * dist/real-games/<game>/slot.html.
 *
 * "Universal" = the block must be ON regardless of GDD feature list. Player
 * UX baseline + win presentation chain + regulator compliance + dev infra.
 * Feature-specific blocks (hold_and_win, expanding_wild, mystery_symbol,
 * etc.) are NOT checked here — those are GDD-driven and intentionally absent
 * when the GDD doesn't list them.
 *
 * Output: table per game · pass/fail per block · final summary.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const GAMES = [
  'huff-n-more-puff-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
  'starlight-travellers-gdd',
];

/**
 * Each entry: [block label, DOM selector or string token expected in capsule].
 * The check is presence in the HTML source (not headless render) — that
 * gives O(ms) coverage instead of O(s) Playwright spin-up × 4. Headless
 * render is covered by test:visual + test:cert:real.
 */
const UNIVERSAL_CHECKS = [
  // A · Core engine — these emit lifecycle so presence = runtime mounted
  ['A1 reelEngine',       'RECT_REELS'],
  ['A2 reelEngineCSS',    '.reelCol'],
  ['A3 hookBus',          'HookBus'],
  ['A4 postSpin',         'function handlePostSpin'],
  ['A5 paylines',         'PAYLINE_POOL'],
  ['A6 tumble',           'runTumbleChain'],
  // B · Win presentation
  ['B1 winPresentation',  'applyWinHighlight'],
  ['B2 paylineOverlay',   'paylineOverlay'],
  ['B3 winLineFlash',     'winLineFlash BLOCK'],
  ['B4 winRollup',        'winRollupHost'],
  ['B5 bigWinTier',       'bigWinTierHost'],
  ['B6 winCap',           'WIN_CAP'],
  // C · Player UX
  ['C1 spinControl',      'id="spinBtn"'],
  ['C2 balanceHud',       'balanceHud'],
  ['C3 betSelector',      'betSelector'],
  ['C4 autoplay',         'autoplay-modal'],
  ['C5 turboMode',        'turboBtn'],
  /* slamStop logic is merged into spinControl when spinControl.enabled
   * (default true) — the same #spinBtn morphs into STOP / SKIP. The
   * legacy slamStopBtn DOM only paints when spinControl is opted out. */
  ['C6 slamStop',         'slam-stop'],
  ['C7 forceSkip',        'force-skip'],
  ['C8 settingsPanel',    'settingsPanel'],
  ['C9 paytable',         'paytable'],
  ['C10 historyLog',      'historyLog'],
  ['C11 uiToast',         'uiToast'],
  ['C12 stageBadge',      'stageBadge'],
  // D · Suspense / feedback
  ['D1 anticipation',     'maybeArmAnticipation'],
  ['D3 scatterCelebration', 'scatter-celebrate'],
  ['D4 hapticFeedback',   'haptic'],
  /* motionOverlay emits pure CSS (::before speed-lines + ::after streak) on
   * .reelCol.is-spinning — no JS runtime token, just the selector. */
  ['D5 motionOverlay',    '.reelCol.is-spinning::before'],
  ['D6 spinTempo',        'spinTempo BLOCK'],
  // E · Regulator / compliance
  ['E1 jurisdictionGate', 'JURISDICTION'],
  ['E2 realityCheck',     'realityCheck'],
  ['E3 sessionTimeout',   'sessionTimeout'],
  ['E4 netLossIndicator', 'netLossIndicator'],
  ['E6 colorblindPatterns', 'colorblind'],
  // F · Infra
  ['F1 hotReload',        'hot-reload'],
  ['F2 universalForcePanel', 'universalForcePanel'],
  ['F3 i18n',             'i18n'],
  ['F4 themeCSS',         'theme'],
];

const RED = '\x1b[31m', GREEN = '\x1b[32m', RESET = '\x1b[0m', DIM = '\x1b[2m';

function checkGame(slug) {
  const path = `${REPO}/dist/real-games/${slug}/slot.html`;
  if (!existsSync(path)) {
    console.log(`${RED}✗ ${slug} — slot.html not found${RESET}`);
    return null;
  }
  const html = readFileSync(path, 'utf8');
  const rows = UNIVERSAL_CHECKS.map(([label, token]) => {
    const present = html.includes(token);
    return { label, token, present };
  });
  return { slug, rows, htmlSize: html.length };
}

const results = GAMES.map(checkGame).filter(Boolean);

console.log('\n══ UNIVERSAL BLOCK COVERAGE · per game ══════════════════════════════════════');
for (const r of results) {
  const passed = r.rows.filter(x => x.present).length;
  const total = r.rows.length;
  console.log(`\n— ${r.slug} (${(r.htmlSize / 1024).toFixed(1)} KB) · ${passed}/${total} —`);
  for (const row of r.rows) {
    const mark = row.present ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${mark} ${row.label.padEnd(28)} ${DIM}[${row.token}]${RESET}`);
  }
}

const aggregate = {};
for (const r of results) {
  for (const row of r.rows) {
    if (!aggregate[row.label]) aggregate[row.label] = { token: row.token, pass: 0, fail: [] };
    if (row.present) aggregate[row.label].pass++;
    else aggregate[row.label].fail.push(r.slug);
  }
}

const missing = Object.entries(aggregate).filter(([, v]) => v.fail.length > 0);
console.log('\n══ AGGREGATE — blocks MISSING in ANY game ══════════════════════════════════');
if (missing.length === 0) {
  console.log(`${GREEN}✓ All ${UNIVERSAL_CHECKS.length} universal blocks present in all ${results.length} games${RESET}`);
} else {
  for (const [label, v] of missing) {
    console.log(`${RED}✗${RESET} ${label.padEnd(28)} ${DIM}[${v.token}]${RESET} → missing in: ${v.fail.join(', ')}`);
  }
  process.exit(1);
}
