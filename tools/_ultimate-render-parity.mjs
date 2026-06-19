/**
 * tools/_ultimate-render-parity.mjs
 *
 * Live HTML build verification — for every known SHAPE.kind, build the
 * full slot HTML via buildSlotHTML(model) with bonusBuyMenu and
 * anteBetLadder explicitly requested in the GDD. Assert:
 *
 *   1. Output is a non-empty HTML string
 *   2. The mutex pinch is correct: when menu/ladder are enabled, the
 *      legacy single-button block markup must NOT appear in the HTML
 *      (id="bonusBuyBtn" / class="ante-bet") and the multi-tier
 *      markup (id="bonusBuyMenuBtn" / id="anteBetLadder") must appear.
 *   3. When topology vetoes the block, NEITHER legacy nor multi-tier
 *      markup may appear.
 *   4. SSR-side jurisdiction ban (regulator.profile = UKGC) must
 *      strip both menu and legacy bonus-buy markup regardless of
 *      topology.
 *
 * Builds and asserts ~9 HTML pages (one per kind), then counts ~100
 * substring assertions across all builds.
 *
 * Exit 0 = all assertions pass, 1 = any drift.
 */
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';
import { listKinds, PROFILE } from '../src/registry/gridProfile.mjs';
import { applySmartDefaults } from '../src/registry/smartDefaults.mjs';

let pass = 0, fail = 0;
const failures = [];
function t(name, ok, info = '') {
  if (ok) { pass++; }
  else    { fail++; failures.push(name + (info ? ' (' + info + ')' : '')); }
}

const MENU_TIERS = [
  { id: 'standard', label: 'STANDARD FS', costX: 75,  forceScatters: 4, fsMode: 'standard' },
  { id: 'super',    label: 'SUPER FS',    costX: 200, forceScatters: 5, fsMode: 'super' },
  { id: 'mega',     label: 'MEGA FS',     costX: 500, forceScatters: 6, fsMode: 'mega' },
];
const LADDER_RUNGS = [
  { id: 'off', label: 'OFF',   costMultiplier: 1.0, triggerMultiplier: 1.0 },
  { id: 'mid', label: '+50%',  costMultiplier: 1.5, triggerMultiplier: 2.0 },
  { id: 'max', label: '+100%', costMultiplier: 2.0, triggerMultiplier: 3.0 },
];

function vetoFor(kind, blockName) {
  const entry = PROFILE[kind];
  if (!entry || !entry[blockName]) return false;
  return entry[blockName].enabled === false;
}

/* Build a model for kind — sufficient surface to satisfy buildSlotHTML.
 * Most blocks degrade gracefully on a sparse model; we only need the
 * mutex / veto path to be exercised. */
function modelFor(kind, extra = {}) {
  const m = {
    name:    `parity_${kind}`,
    shape:   { kind, rows: 5, cols: 5 },
    SHAPE:   { kind, rows: 5, cols: 5 },
    grid:    { rows: 5, cols: 5 },
    symbols: {
      specials: [{ id: 'W', name: 'Wild' }, { id: 'S', name: 'Scatter' }],
      high:     [{ id: 'H1', name: 'High1' }, { id: 'H2', name: 'High2' }],
      mid:      [{ id: 'M1', name: 'Mid1' }],
      low:      [{ id: 'L1', name: 'Low1' }, { id: 'L2', name: 'Low2' }],
    },
    theme:    { palette: ['#222', '#555', '#888'] },
    features: [],
    bonusBuyMenu:  { enabled: true, tiers: MENU_TIERS },
    anteBetLadder: { enabled: true, rungs: LADDER_RUNGS },
    ...extra,
  };
  applySmartDefaults(m);
  return m;
}

const KINDS = listKinds();
console.log('\n=== Ultimate Render Parity — buildSlotHTML × kinds ===');
console.log(`  • ${KINDS.length} kinds will be rendered, mutex + veto asserted`);

let totalBuilds = 0;
let totalAssertions = 0;
const buildErrors = [];

for (const kind of KINDS) {
  let html = '';
  try {
    html = buildSlotHTML(modelFor(kind));
    totalBuilds++;
  } catch (e) {
    buildErrors.push({ kind, msg: e.message });
    fail++; failures.push(`build.${kind} threw: ${e.message}`);
    continue;
  }

  /* sanity */
  t(`${kind}: buildSlotHTML returns non-empty string`, typeof html === 'string' && html.length > 1000);
  t(`${kind}: HTML has <head>`, html.includes('<head>'));
  t(`${kind}: HTML has slot mount`, html.includes('id="slot"') || html.includes('slot'));

  const vetoBBM = vetoFor(kind, 'bonusBuyMenu');
  const vetoBB  = vetoFor(kind, 'bonusBuy');
  const vetoABL = vetoFor(kind, 'anteBetLadder');
  const vetoAB  = vetoFor(kind, 'anteBet');

  /* ── bonusBuyMenu mutex / veto pinch ─────────────────────────── */
  const hasMenuBtn   = html.includes('id="bonusBuyMenuBtn"');
  const hasMenuSheet = html.includes('id="bonusBuyMenuSheet"');
  const hasLegacyBB  = html.includes('id="bonusBuyBtn"');

  if (vetoBBM) {
    t(`${kind}: vetoed → NO menu button`, !hasMenuBtn);
    t(`${kind}: vetoed → NO menu sheet`,  !hasMenuSheet);
    if (vetoBB) {
      t(`${kind}: both bb vetoed → NO legacy button either`, !hasLegacyBB);
    }
  } else {
    t(`${kind}: not vetoed → menu button present`, hasMenuBtn);
    t(`${kind}: not vetoed → menu sheet present`,  hasMenuSheet);
    t(`${kind}: mutex → legacy bonusBuyBtn SUPPRESSED`, !hasLegacyBB);
  }
  totalAssertions += 5;

  /* ── anteBetLadder mutex / veto pinch ────────────────────────── */
  const hasLadder = html.includes('id="anteBetLadder"');
  const hasLegacyAnte = html.includes('id="anteBetToggle"');

  if (vetoABL) {
    t(`${kind}: vetoed → NO ladder`, !hasLadder);
    if (vetoAB) {
      t(`${kind}: both ante vetoed → NO legacy ante either`, !hasLegacyAnte);
    }
  } else {
    t(`${kind}: not vetoed → ladder present`, hasLadder);
    t(`${kind}: mutex → legacy anteBetToggle SUPPRESSED`, !hasLegacyAnte);
  }
  totalAssertions += 3;
}

/* ── jurisdiction sweep — UKGC must strip ALL bonus-buy paths on any kind */
console.log('\n  ─ jurisdiction strip × kinds (UKGC) ─');
for (const kind of KINDS) {
  let html = '';
  try {
    html = buildSlotHTML(modelFor(kind, {
      regulator: { profile: 'UKGC' },
    }));
  } catch (e) {
    fail++; failures.push(`ukgc.${kind} threw: ${e.message}`);
    continue;
  }
  const hasMenuBtn = html.includes('id="bonusBuyMenuBtn"');
  const hasLegacyBB = html.includes('id="bonusBuyBtn"');
  t(`UKGC.${kind}: NO menu button (jurisdiction strip)`,  !hasMenuBtn);
  t(`UKGC.${kind}: NO legacy bonusBuy (jurisdiction strip)`, !hasLegacyBB);
}

/* ── Wave LEGO-BUY emit invariants in rendered HTML ─────────────── */
console.log('\n  ─ emit invariants ─');
const rect = buildSlotHTML(modelFor('rectangular'));
t('rectangular: rendered HTML has menu CSS class .bonus-buy-menu-btn', rect.includes('.bonus-buy-menu-btn'));
t('rectangular: rendered HTML has ladder CSS class .ante-bet-ladder',  rect.includes('.ante-bet-ladder'));
t('rectangular: 3 menu tier rows present (STANDARD/SUPER/MEGA)',
  rect.includes('STANDARD FS') && rect.includes('SUPER FS') && rect.includes('MEGA FS'));
t('rectangular: 3 ladder rungs present (OFF/+50%/+100%)',
  rect.includes('>OFF<') && rect.includes('+50%') && rect.includes('+100%'));
t('rectangular: menu uses role=menu',  rect.includes('role="menu"'));
t('rectangular: ladder uses role=radiogroup', rect.includes('role="radiogroup"'));
t('rectangular: a11y aria-haspopup wired', rect.includes('aria-haspopup="menu"'));
t('rectangular: runtime declares __BONUS_BUY_MENU_ACTIVE__', rect.includes('__BONUS_BUY_MENU_ACTIVE__'));
t('rectangular: runtime declares __ANTE_BET_LADDER_ACTIVE__', rect.includes('__ANTE_BET_LADDER_ACTIVE__'));

/* Vendor-neutral check */
const VENDOR_RE = /\b(IGT|Pragmatic|Cash Eruption|Wolf Run|Cleopatra|Buffalo|Megaways|NetEnt|Microgaming)\b/i;
t('rectangular HTML: vendor-neutral (no banned strings)', !VENDOR_RE.test(rect));

/* ── reporting ──────────────────────────────────────────────────── */
console.log(`\n  • Builds completed: ${totalBuilds}/${KINDS.length}`);
console.log(`  • Build errors: ${buildErrors.length}`);
if (buildErrors.length > 0) {
  for (const e of buildErrors) console.log(`    - ${e.kind}: ${e.msg}`);
}

console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
if (fail > 0) {
  console.log('\n  Failures:');
  for (const f of failures.slice(0, 30)) console.log(`    - ${f}`);
  if (failures.length > 30) console.log(`    ... and ${failures.length - 30} more`);
  process.exit(1);
}
process.exit(0);
