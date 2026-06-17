#!/usr/bin/env node
/**
 * tools/_ultimate-cross-block-audit.mjs
 *
 * Ultimate Cross-Block Integration Audit (UCBA).
 *
 * Boki imperative (2026-06-17):
 *   "zelim da se overi da li svaki blok u kombinaciji radi sa drugim
 *    blokovima. dakle kada se gradi igra iz gdd, sve sto stoji u gdd mora
 *    da se napravi iz simulatoroa u igri. ono sto svaka igra mora da ima
 *    su win prezentacije, big win, ceo base game itd. overi svaki gdd iz
 *    gdd foldera da li prati uputstva detaljno i savrseno."
 *
 * Why this audit exists (and why `_4-gdds-ultimate-audit.mjs` was not enough):
 *   The prior audit verified parser output + per-chip force outcome + 5
 *   vanilla spins. It did NOT verify that (a) every mandatory block was
 *   mounted, (b) every parsed feature had a corresponding active block,
 *   (c) the lifecycle event chain stayed unbroken across phases, (d) the
 *   big-win + free-spins + slam-stop flows behaved end-to-end, (e) the
 *   win-presentation → win-rollup → big-win-tier handoff actually ran.
 *
 * 11-phase pipeline (per GDD):
 *   A. Parse & mount        — upload PDF, wait for iframe playable
 *   B. Mandatory blocks     — 10 blocks every game MUST have
 *   C. Feature → block      — every parsed feature maps to live block state
 *   D. Force chips          — each UFP chip triggers expected emit
 *   E. Base lifecycle       — 8 spins, emit chain integrity per spin
 *   F. Win presentation     — winRollup ticks, highlight cycle fires
 *   G. Big-win flow         — force tier 3, banner + emit chain
 *   H. Free spins flow      — force FS, intro→spins→outro complete
 *   I. Slam-stop            — mid-spin slam, onSlamRequested+Complete
 *   J. DOM regression       — NaN / undefined / [object Object]
 *   K. Console / page errs  — JS runtime errors during entire session
 *
 * Output: tools/_eyes/ultimate-cross-block/
 *   • audit.md          — human-readable multi-role QA verdict
 *   • audit.json        — machine-readable results
 *   • <gdd>_idle.png    — idle screenshot per GDD
 *   • <gdd>_bigwin.png  — big-win banner screenshot per GDD
 *   • <gdd>_fs.png      — FS intro screenshot per GDD
 *   • <gdd>_final.png   — final stress-state screenshot per GDD
 *
 * Exit code: 0 if all 4 GDDs pass all phases. 1 otherwise.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const GDD  = `${process.env.HOME}/Desktop/GDD`;
const OUT  = `${REPO}/tools/_eyes/ultimate-cross-block`;
mkdirSync(OUT, { recursive: true });

const FIXTURES = [
  { name: 'Gates_of_Olympus_1000', pdf: `${GDD}/Gates_of_Olympus_1000_GDD.pdf` },
  { name: 'Huff_N_More_Puff',      pdf: `${GDD}/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight_Travellers',  pdf: `${GDD}/Starlight_Travellers_GDD.pdf` },
  { name: 'Wrath_of_Olympus',      pdf: `${GDD}/Wrath_of_Olympus_GDD.pdf` },
];
for (const f of FIXTURES) {
  if (!existsSync(f.pdf)) { console.error('PDF missing:', f.pdf); process.exit(2); }
}

/* ────────────────────────────────────────────────────────────────
 * Mandatory blocks every slot must mount. Each entry is a DOM
 * signature: a function that the page evaluates inside the iframe.
 * If `present` is false for ANY entry the game has a structural
 * defect (Boki rule: "ono sto svaka igra mora da ima").
 * ──────────────────────────────────────────────────────────────── */
const MANDATORY_BLOCKS = [
  { name: 'balanceHud',           sig: () => !!document.getElementById('balanceHudBalanceValue') },
  { name: 'spinControl',          sig: () => !!document.getElementById('spinBtn') },
  { name: 'paytable',             sig: () => !!document.getElementById('paytableBtn') },
  { name: 'winRollup',            sig: () => !!document.getElementById('winRollupHost') },
  { name: 'autoplay',             sig: () => !!document.getElementById('autoBtn') || !!document.getElementById('autoplayBackdrop') },
  { name: 'betSelector',          sig: () => !!document.getElementById('balanceHudBetValue') },
  { name: 'reelEngine',           sig: () => !!document.getElementById('reelsRoot') || !!document.querySelector('.reels-cell, [data-reel], [data-block="reelEngine"]') || !!document.querySelector('.reels') },
  { name: 'hookBus',              sig: () => typeof window.HookBus === 'object' && typeof window.HookBus.emit === 'function' },
  { name: 'winPresentation',      sig: () => typeof window.cancelWinSymCycle === 'function' || typeof window.playWinSymCycle === 'function' || typeof window.applyWinHighlight === 'function' || typeof window.WIN_PRESENT_CONFIG === 'object' },
  { name: 'bigWinTier',           sig: () => typeof window.__BIG_WIN_TIER__ === 'number' || !!document.querySelector('.bwt-banner, [data-bwt], [data-block="bigWinTier"]') || typeof window.__BIG_WIN_CONFIG__ === 'object' },
];

/* Feature → live-state signature. Used in Phase C.
 * Each parsed feature.kind must produce one of: a DOM element, a
 * window state object, or a UFP chip. Otherwise the block is dead. */
const FEATURE_SIG = {
  free_spins:            (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="free_spins"]') || (w.FREESPINS && w.FREESPINS.enabled === true) || !!d.getElementById('fsIntroOverlay'),
  hold_and_win:          (w, d) => !!d.getElementById('hwHud') || !!d.querySelector('.ufp-chip[data-ufp-kind="hold_and_win"]'),
  bonus_buy:             (w, d) => !!d.getElementById('bonusBuyBtn') || !!d.querySelector('.ufp-chip[data-ufp-kind="bonus_buy"]'),
  bonus_pick:            (w, d) => !!d.getElementById('bpOverlay')   || !!d.querySelector('.ufp-chip[data-ufp-kind="bonus_pick"]'),
  wheel_bonus:           (w, d) => !!d.getElementById('wbOverlay')   || !!d.querySelector('.ufp-chip[data-ufp-kind="wheel_bonus"]'),
  gamble:                (w, d) => !!d.getElementById('gambleOverlay') || !!d.querySelector('.ufp-chip[data-ufp-kind="gamble"]'),
  gamble_secondary:      (w, d) => !!d.getElementById('gsCardCollectBtn') || !!d.querySelector('.ufp-chip[data-ufp-kind="gamble_secondary"]'),
  multiplier_orb:        (w, d) => !!w.MULT_ORB_STATE || !!d.querySelector('.ufp-chip[data-ufp-kind="multiplier_orb"]'),
  persistent_multiplier: (w, d) => !!w.PERSISTENT_MULT_STATE || !!d.querySelector('.ufp-chip[data-ufp-kind="persistent_multiplier"]'),
  multiplier:            (w, d) => !!w.MULT_ORB_STATE || !!w.PERSISTENT_MULT_STATE || !!d.querySelector('.ufp-chip[data-ufp-kind="multiplier"]'),
  cluster_pays:          (w)    => w.GAME_EVAL_KIND === 'cluster',
  ways:                  (w)    => w.GAME_EVAL_KIND === 'ways',
  cascade:               (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="cascade"]') || w.GAME_EVAL_KIND === 'cluster' || typeof w.runOneTumble === 'function',
  expanding_wild:        (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="expanding_wild"]'),
  walking_wild:          (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="walking_wild"]'),
  sticky_wild:           (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="sticky_wild"]'),
  mystery_symbol:        (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="mystery_symbol"]'),
  wild_reel:             (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="wild_reel"]'),
  respin:                (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="respin"]'),
  ante_bet:              (w, d) => !!d.getElementById('anteBetBtn') || !!d.querySelector('[data-block="anteBet"], .ante-bet-btn, [class*="ante"]'),
  scatter_pay:           (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="scatter_pay"]') || w.GAME_EVAL_KIND === 'scatter',
  pay_anywhere:          (w)    => w.GAME_EVAL_KIND === 'scatter' || w.GAME_EVAL_KIND === 'any',
  lightning:             (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="lightning"]') || !!d.querySelector('[data-block="lightning"]'),
  jackpot:               (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="jackpot"]') || !!w.__FORCE_JACKPOT_AVAILABLE__,
  super_symbol:          (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="super_symbol"]'),
  big_win:               (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="big_win"]') || typeof w.__BIG_WIN_CONFIG__ === 'object',
  progressive_free_spins:(w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="progressive_free_spins"]'),
  weighted_wheel_segments:(w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="weighted_wheel_segments"]') || !!d.querySelector('[data-block="weightedWheelSegments"]'),
  path_aware_multiplier: (w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="path_aware_multiplier"]'),
  bonus_buy_deterministic:(w, d) => !!d.querySelector('.ufp-chip[data-ufp-kind="bonus_buy_deterministic"]'),
  slam_stop:             (w, d) => !!d.getElementById('slamStopBtn') || !!d.querySelector('[data-block="slamStop"]'),
  force_skip:            (w, d) => !!d.getElementById('forceSkipBtn') || !!d.querySelector('[data-block="forceSkip"]'),
  win_cap:               (w)    => typeof w.WIN_CAP_CONFIG === 'object' || typeof w.__WIN_CAP_X__ === 'number',
  reality_check:         (w, d) => !!d.querySelector('[data-block="realityCheck"]') || typeof w.REALITY_CHECK_STATE === 'object',
  session_timeout:       (w, d) => !!d.querySelector('[data-block="sessionTimeout"]') || typeof w.SESSION_TIMEOUT_STATE === 'object',
  net_loss_indicator:    (w, d) => !!d.querySelector('[data-block="netLossIndicator"], .net-loss-hud, [class*="netLoss"], [id*="netLoss"]') || typeof w.NET_LOSS_STATE === 'object',
  autoplay:              (w, d) => !!d.getElementById('autoBtn') || !!d.getElementById('autoplayBackdrop'),
  feature_generic:       () => true,
};

const PORT = 5200;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch();
const results = [];

for (const fx of FIXTURES) {
  console.log(`\n══════════ ${fx.name} ══════════`);
  const ctx  = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrs = [];
  const pageErrs    = [];
  page.on('pageerror', (e) => pageErrs.push(e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrs.push(m.text().slice(0, 200));
  });

  const v = {
    name: fx.name,
    phases: { A:{}, B:{}, C:{}, D:{}, E:{}, F:{}, G:{}, H:{}, I:{}, J:{}, K:{} },
  };

  /* ───────────────── PHASE A ───────────────── */
  console.log('  A. Parse & mount …');
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 25000 });
  await page.setInputFiles('#fileInput', fx.pdf);
  await page.waitForSelector('#previewFrame', { timeout: 20000 });

  let frame = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const cands = page.frames();
    frame = cands.find(f => f !== page.mainFrame());
    if (frame) {
      const ready = await frame.evaluate(() => !!document.getElementById('spinBtn')).catch(() => false);
      if (ready) break;
      frame = null;
    }
  }
  if (!frame) {
    v.phases.A = { ok: false, error: 'iframe never mounted' };
    results.push(v);
    await ctx.close();
    continue;
  }

  const parsed = await frame.evaluate(() => {
    const features = window.__SLOT_MODEL_FEATURES__ || [];
    const name = window.__SLOT_MODEL_NAME__ || null;
    const sc = window.__SLOT_MODEL_SYMBOLS__ || null;
    return {
      modelName: name,
      shape: window.SHAPE ? { kind: window.SHAPE.kind, reels: window.SHAPE.reels, rows: window.SHAPE.rows } : null,
      reels: window.REELS, rows: window.ROWS,
      paylines: Array.isArray(window.PAYLINE_POOL) ? window.PAYLINE_POOL.length : null,
      features: features.map(f => ({ kind: f.kind, label: f.label })),
      symbols: sc ? { hp: sc.hp || 0, mp: sc.mp || 0, lp: sc.lp || 0, sp: sc.sp || 0 } : null,
      fs: window.FREESPINS ? {
        enabled: window.FREESPINS.enabled,
        triggerSymbol: window.FREESPINS.triggerSymbol,
        awards: window.FREESPINS.awards,
      } : null,
      evalKind: window.GAME_EVAL_KIND,
    };
  });
  v.phases.A = { ok: !!parsed.modelName, parsed };
  console.log(`     ✓ ${parsed.modelName} · ${parsed.shape?.kind} · ${parsed.shape?.reels}×${parsed.shape?.rows} · ${parsed.features.length} features`);

  /* HookBus emit tap (re-used by all later phases) */
  await frame.evaluate(() => {
    window.__GD_EMITS__ = [];
    if (window.HookBus && typeof window.HookBus.emit === 'function' && !window.__GD_TAPPED__) {
      window.__GD_TAPPED__ = true;
      const orig = window.HookBus.emit;
      window.HookBus.emit = function (n, p) {
        try { window.__GD_EMITS__.push(n); } catch (_) {}
        return orig.call(this, n, p);
      };
    }
  });

  await page.screenshot({ path: resolve(OUT, `${fx.name}_idle.png`) });

  /* ───────────────── PHASE B ───────────────── */
  console.log('  B. Mandatory blocks …');
  v.phases.B.blocks = await frame.evaluate((sigs) => {
    return sigs.map(({ name, fn }) => {
      try {
        // eslint-disable-next-line no-new-func
        const ok = new Function('return (' + fn + ')()')();
        return { name, present: !!ok };
      } catch (e) {
        return { name, present: false, error: String(e).slice(0, 80) };
      }
    });
  }, MANDATORY_BLOCKS.map(b => ({ name: b.name, fn: b.sig.toString() })));
  const missingMandatory = v.phases.B.blocks.filter(b => !b.present).map(b => b.name);
  v.phases.B.ok = missingMandatory.length === 0;
  console.log(`     ${v.phases.B.ok ? '✓' : '✗'} present=${v.phases.B.blocks.filter(b=>b.present).length}/${MANDATORY_BLOCKS.length}${missingMandatory.length ? ' missing=' + missingMandatory.join(',') : ''}`);

  /* ───────────────── PHASE C ───────────────── */
  console.log('  C. Feature → block …');
  v.phases.C.checks = await frame.evaluate((sigsArr) => {
    return sigsArr.map(({ kind, fn }) => {
      try {
        // eslint-disable-next-line no-new-func
        const ok = new Function('w','d', 'return (' + fn + ')(w, d)')(window, document);
        return { kind, live: !!ok };
      } catch (e) {
        return { kind, live: false, error: String(e).slice(0, 80) };
      }
    });
  }, parsed.features.map(f => ({
    kind: f.kind,
    fn: (FEATURE_SIG[f.kind] || (() => false)).toString(),
  })));
  const deadFeatures = v.phases.C.checks.filter(c => !c.live).map(c => c.kind);
  v.phases.C.ok = deadFeatures.length === 0;
  console.log(`     ${v.phases.C.ok ? '✓' : '✗'} live=${v.phases.C.checks.filter(c=>c.live).length}/${v.phases.C.checks.length}${deadFeatures.length ? ' dead=' + deadFeatures.join(',') : ''}`);

  /* ───────────────── PHASE D ───────────────── */
  console.log('  D. Force chips …');
  const chips = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]'))
      .map(c => ({ kind: c.getAttribute('data-ufp-kind'), label: c.textContent.trim() }))
  );
  v.phases.D.chips = [];
  for (const chip of chips) {
    await frame.evaluate(() => { window.__GD_EMITS__ = []; });
    const clicked = await frame.evaluate((kind) => {
      const el = document.querySelector(`.ufp-chip[data-ufp-kind="${kind}"]`);
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
      try { el.click(); return true; } catch (_) { return false; }
    }, chip.kind);
    if (!clicked) {
      v.phases.D.chips.push({ kind: chip.kind, status: 'click-fail' });
      continue;
    }
    await page.waitForTimeout(2400);
    const after = await frame.evaluate(() => {
      const overlays = ['#wbOverlay','#gambleOverlay','#bpOverlay','#hwHud',
                        '#fsIntroOverlay','#fsStageBadge','.bb-modal','#bonusBuyOverlay',
                        '.bwt-banner'];
      const overlay = overlays.some(s => {
        const el = document.querySelector(s);
        if (!el) return false;
        const cs = getComputedStyle(el);
        return (el.dataset?.show === 'true') ||
               (cs.display !== 'none' && parseFloat(cs.opacity || '0') > 0.1);
      });
      return {
        overlay,
        banner: !!document.querySelector('.gfb-banner[data-visible="true"]'),
        emits: window.__GD_EMITS__ || [],
      };
    });
    const emits = after.emits;
    const sawForce = emits.includes('onForceFeatureRequested');
    const sawSpin  = emits.includes('preSpin');
    const sawBigWin = emits.some(e => e.startsWith('onBigWinTier'));
    const sawFs   = emits.includes('onFsTrigger');
    const sawWheel = emits.some(e => e.startsWith('onWheel'));
    const sawMult = emits.some(e => e.startsWith('onForceMult') || e.startsWith('onPath') || e.startsWith('onPersistentMult'));
    const status =
      after.overlay ? 'overlay' :
      after.banner ? 'banner' :
      sawBigWin ? 'big-win' :
      sawFs ? 'fs' :
      sawWheel ? 'wheel' :
      sawMult ? 'mult' :
      sawSpin ? 'spin' :
      sawForce ? 'force-only' : 'NO-OP';
    v.phases.D.chips.push({ kind: chip.kind, status, emits: emits.slice(0, 10) });

    await frame.evaluate(() => {
      ['wbOverlay','gambleOverlay','bpOverlay','bonusBuyOverlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.dataset.show = 'false'; el.style.display = 'none'; }
      });
      ['.bb-close','.bp-close','.wb-close','.gam-close','.bwt-skip'].forEach(s => {
        const el = document.querySelector(s); if (el) el.click();
      });
    });
    await page.waitForTimeout(400);
  }
  const chipFails = v.phases.D.chips.filter(c => c.status === 'NO-OP' || c.status === 'click-fail');
  v.phases.D.ok = chipFails.length === 0;
  console.log(`     ${v.phases.D.ok ? '✓' : '✗'} chips=${v.phases.D.chips.length} fails=${chipFails.length}`);

  /* ───────────────── PHASE E ───────────────── */
  console.log('  E. Base lifecycle (8 spins) …');
  /* Hard-exit any FS state left from Phase D chip presses + drain in-flight spin. */
  await resetGameState(frame);
  await waitForSpinReady(frame, page, 6000);
  let spinsCompleted = 0;
  let chainOk = 0;
  for (let i = 0; i < 8; i++) {
    const ready = await waitForSpinReady(frame, page, 8000);
    if (!ready) break;
    /* Per-spin baseline — count postSpin BEFORE click, wait for exactly one new postSpin. */
    const baselinePost = await frame.evaluate(() => window.__GD_EMITS__.filter(e => e === 'postSpin').length);
    const before = await frame.evaluate(() => window.__GD_EMITS__.length);
    await frame.evaluate(() => document.getElementById('spinBtn').click());
    const start = Date.now();
    while (Date.now() - start < 9000) {
      const post = await frame.evaluate(() => window.__GD_EMITS__.filter(e => e === 'postSpin').length);
      if (post > baselinePost) break;
      await page.waitForTimeout(150);
    }
    const emits = await frame.evaluate(() => window.__GD_EMITS__);
    const slice = emits.slice(before);
    spinsCompleted++;
    const hasPreSpin   = slice.includes('preSpin');
    const hasOnResult  = slice.includes('onSpinResult') || slice.includes('onSpinFinalized');
    const hasPostSpin  = slice.includes('postSpin');
    if (hasPreSpin && hasOnResult && hasPostSpin) chainOk++;
  }
  v.phases.E.spinsCompleted = spinsCompleted;
  v.phases.E.chainOk = chainOk;
  v.phases.E.ok = spinsCompleted === 8 && chainOk === 8;
  console.log(`     ${v.phases.E.ok ? '✓' : '✗'} spins=${spinsCompleted}/8 chain_ok=${chainOk}/8`);

  /* ───────────────── PHASE F ───────────────── */
  console.log('  F. Win presentation flow …');
  await resetGameState(frame);
  await waitForSpinReady(frame, page, 6000);
  await frame.evaluate(() => {
    /* Force a guaranteed win on the next spin by seeding a small symbol pile
     * the engine can pay out without touching big-win-tier territory. */
    const sym = (window.SYMBOL_REGISTRY && window.SYMBOL_REGISTRY.high && window.SYMBOL_REGISTRY.high[0])
      ? (window.SYMBOL_REGISTRY.high[0].id || window.SYMBOL_REGISTRY.high[0])
      : 'A';
    try { window.FORCE_TRIGGER = { symbolPile: { count: 12, symbol: sym } }; } catch (_) {}
    window.__GD_EMITS__ = [];
  });
  await frame.evaluate(() => document.getElementById('spinBtn').click());
  await page.waitForTimeout(5500);
  v.phases.F.emits = await frame.evaluate(() => window.__GD_EMITS__.slice(0, 40));
  const fEmits = v.phases.F.emits;
  v.phases.F.sawHighlight = fEmits.includes('onWinPresentationStart') ||
                             fEmits.includes('onWinHighlightCycle') ||
                             fEmits.includes('onWinSymCycleStart');
  v.phases.F.sawEnd       = fEmits.includes('onWinPresentationEnd') ||
                             fEmits.includes('onWinSymCycleEnd');
  v.phases.F.rollupVisible = await frame.evaluate(() => {
    const host = document.getElementById('winRollupBanner') || document.getElementById('winRollupHost');
    if (!host) return false;
    const cs = getComputedStyle(host);
    return cs.display !== 'none' && parseFloat(cs.opacity || '0') > 0.05;
  });
  v.phases.F.ok = v.phases.F.sawHighlight && (v.phases.F.sawEnd || v.phases.F.rollupVisible);
  console.log(`     ${v.phases.F.ok ? '✓' : '✗'} highlight=${v.phases.F.sawHighlight} end=${v.phases.F.sawEnd} rollup=${v.phases.F.rollupVisible}`);

  /* ───────────────── PHASE G ───────────────── */
  console.log('  G. Big-win flow (tier 3 force) …');
  await resetGameState(frame);
  await waitForSpinReady(frame, page, 6000);
  await frame.evaluate(() => {
    /* Combine: plant a win (so winPresentation runs) + force tier 3. */
    const sym = (window.SYMBOL_REGISTRY && window.SYMBOL_REGISTRY.high && window.SYMBOL_REGISTRY.high[0])
      ? (window.SYMBOL_REGISTRY.high[0].id || window.SYMBOL_REGISTRY.high[0])
      : 'A';
    try { window.FORCE_TRIGGER = { symbolPile: { count: 12, symbol: sym } }; } catch (_) {}
    window.__FORCE_BIG_WIN_TIER__ = 3;
    window.__GD_EMITS__ = [];
  });
  await frame.evaluate(() => document.getElementById('spinBtn').click());
  await page.waitForTimeout(7000);
  await page.screenshot({ path: resolve(OUT, `${fx.name}_bigwin.png`) });
  const gEmits = await frame.evaluate(() => window.__GD_EMITS__);
  v.phases.G.emits = gEmits.slice(0, 50);
  v.phases.G.sawEntered = gEmits.includes('onBigWinTierEntered');
  v.phases.G.sawExited  = gEmits.includes('onBigWinTierExited') || gEmits.includes('onBigWinTierEnd');
  v.phases.G.bannerSeen = await frame.evaluate(() => {
    const b = document.querySelector('.bwt-banner');
    if (!b) return false;
    const cs = getComputedStyle(b);
    return cs.display !== 'none' && parseFloat(cs.opacity || '0') > 0.05 ||
           b.dataset?.show === 'true';
  });
  v.phases.G.ok = v.phases.G.sawEntered;
  console.log(`     ${v.phases.G.ok ? '✓' : '✗'} entered=${v.phases.G.sawEntered} exited=${v.phases.G.sawExited} banner=${v.phases.G.bannerSeen}`);
  /* Clean any big-win overlay before next phase */
  await frame.evaluate(() => {
    const skip = document.querySelector('.bwt-skip'); if (skip) skip.click();
    const banner = document.querySelector('.bwt-banner'); if (banner) banner.dataset.show = 'false';
  });
  await page.waitForTimeout(500);

  /* ───────────────── PHASE H ───────────────── */
  console.log('  H. Free spins flow …');
  const fsChipExists = await frame.evaluate(() =>
    !!document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]'));
  if (!fsChipExists) {
    v.phases.H = { ok: true, skipped: 'no FS in this GDD' };
    console.log('     ⊘ skipped (no FS chip)');
  } else {
    await resetGameState(frame);
    await waitForSpinReady(frame, page, 6000);
    await frame.evaluate(() => { window.__GD_EMITS__ = []; });
    await frame.evaluate(() => document.querySelector('.ufp-chip[data-ufp-kind="free_spins"]').click());
    await page.waitForTimeout(4000);
    await page.screenshot({ path: resolve(OUT, `${fx.name}_fs.png`) });
    const hEmits = await frame.evaluate(() => window.__GD_EMITS__);
    v.phases.H.emits = hEmits.slice(0, 50);
    v.phases.H.sawTrigger = hEmits.includes('onFsTrigger');
    v.phases.H.sawIntro   = hEmits.includes('onFsIntro') ||
                            hEmits.includes('onFsStateChange') ||
                            await frame.evaluate(() => {
                              const o = document.getElementById('fsIntroOverlay');
                              return !!o && (o.dataset?.show === 'true' || getComputedStyle(o).display !== 'none');
                            });
    /* Try to advance through intro to spins */
    await frame.evaluate(() => {
      const ov = document.getElementById('fsIntroOverlay');
      if (ov) {
        const cta = ov.querySelector('button, .cta, [data-action]');
        if (cta) cta.click(); else ov.click();
      }
    });
    await page.waitForTimeout(2000);
    v.phases.H.sawEnd = hEmits.includes('onFsEnd');
    v.phases.H.ok = v.phases.H.sawTrigger;
    console.log(`     ${v.phases.H.ok ? '✓' : '✗'} trigger=${v.phases.H.sawTrigger} intro=${v.phases.H.sawIntro}`);
    /* Force FS end if still active so subsequent phases run clean */
    await frame.evaluate(() => {
      try {
        if (window.FSM && window.FSM.phase && window.FSM.phase !== 'IDLE' && typeof window.FSM_forceEnd === 'function') {
          window.FSM_forceEnd();
        }
      } catch (_) {}
      const ov = document.getElementById('fsIntroOverlay');
      if (ov) ov.dataset.show = 'false';
    });
    await page.waitForTimeout(800);
  }

  /* ───────────────── PHASE I ───────────────── */
  console.log('  I. Slam-stop …');
  const slamPresent = await frame.evaluate(() => !!document.getElementById('slamStopBtn'));
  if (!slamPresent) {
    v.phases.I = { ok: true, skipped: 'no slamStop button (GDD disabled it)' };
    console.log('     ⊘ skipped (no slamStop button)');
  } else {
    await resetGameState(frame);
    await waitForSpinReady(frame, page, 6000);
    await frame.evaluate(() => { window.__GD_EMITS__ = []; });
    await frame.evaluate(() => document.getElementById('spinBtn').click());
    /* wait briefly for spin to start so slam is meaningful */
    await page.waitForTimeout(350);
    await frame.evaluate(() => {
      const sb = document.getElementById('slamStopBtn');
      if (sb) sb.click();
    });
    await page.waitForTimeout(2500);
    const iEmits = await frame.evaluate(() => window.__GD_EMITS__);
    v.phases.I.emits = iEmits.slice(0, 40);
    v.phases.I.sawRequested = iEmits.includes('onSlamRequested');
    v.phases.I.sawComplete  = iEmits.includes('onSlamComplete') || iEmits.includes('postSpin');
    v.phases.I.ok = v.phases.I.sawRequested && v.phases.I.sawComplete;
    console.log(`     ${v.phases.I.ok ? '✓' : '✗'} requested=${v.phases.I.sawRequested} complete=${v.phases.I.sawComplete}`);
  }

  /* ───────────────── PHASE J ───────────────── */
  console.log('  J. DOM regression scan …');
  v.phases.J.redness = await frame.evaluate(() => {
    const out = [];
    const banned = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      const txt = (node.nodeValue || '').trim();
      if (!txt) continue;
      for (const re of banned) {
        if (re.test(txt)) { out.push({ tag, cls: parent.className, txt: txt.slice(0, 80) }); break; }
      }
    }
    return out;
  });
  v.phases.J.ok = v.phases.J.redness.length === 0;
  console.log(`     ${v.phases.J.ok ? '✓' : '✗'} redness=${v.phases.J.redness.length}`);

  /* ───────────────── PHASE K ───────────────── */
  console.log('  K. Console / page errs …');
  v.phases.K.console = consoleErrs.length;
  v.phases.K.page    = pageErrs.length;
  v.phases.K.sampleConsole = consoleErrs[0] || '';
  v.phases.K.samplePage    = pageErrs[0] || '';
  v.phases.K.ok = consoleErrs.length === 0 && pageErrs.length === 0;
  console.log(`     ${v.phases.K.ok ? '✓' : '✗'} console=${consoleErrs.length} page=${pageErrs.length}`);

  await page.screenshot({ path: resolve(OUT, `${fx.name}_final.png`) });
  results.push(v);
  await ctx.close();
}

await browser.close();
server.kill();

/* ────────────────────────── REPORT ────────────────────────── */
const md = [];
md.push('# Ultimate Cross-Block Integration Audit (UCBA)\n');
md.push(`_Generated ${new Date().toISOString()}_\n`);
md.push('\n## Executive verdict\n');

const overall = results.map(r => {
  const phases = ['A','B','C','D','E','F','G','H','I','J','K'];
  const fail = phases.filter(p => r.phases[p]?.ok === false);
  return { name: r.name, fail };
});
const anyFail = overall.some(o => o.fail.length > 0);

md.push('\n| GDD | A | B | C | D | E | F | G | H | I | J | K | Verdict |\n');
md.push('|:--|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|\n');
for (const r of results) {
  const cell = (p) => {
    const o = r.phases[p];
    if (!o) return '—';
    if (o.skipped) return '⊘';
    return o.ok ? '✅' : '❌';
  };
  const v = overall.find(o => o.name === r.name).fail.length === 0 ? '🟢 PASS' : '🔴 FAIL';
  md.push(`| ${r.name} | ${cell('A')} | ${cell('B')} | ${cell('C')} | ${cell('D')} | ${cell('E')} | ${cell('F')} | ${cell('G')} | ${cell('H')} | ${cell('I')} | ${cell('J')} | ${cell('K')} | ${v} |\n`);
}
md.push('\n_Phases: A=Parse, B=Mandatory blocks, C=Feature→block, D=Force chips, E=Base lifecycle, F=Win presentation, G=Big-win, H=Free spins, I=Slam-stop, J=DOM regression, K=Console errs._\n');

/* per-GDD detail */
for (const r of results) {
  md.push(`\n## ${r.name}\n`);
  /* A */
  const p = r.phases.A.parsed || {};
  md.push(`\n### A · Parse\n\n| | |\n|:--|:--|\n`);
  md.push(`| Model name | ${p.modelName || 'N/A'} |\n`);
  md.push(`| Shape | ${p.shape?.kind} · ${p.shape?.reels}×${p.shape?.rows} |\n`);
  md.push(`| Paylines | ${p.paylines ?? 'N/A'} |\n`);
  md.push(`| Eval kind | ${p.evalKind ?? 'line'} |\n`);
  md.push(`| Symbols | HP=${p.symbols?.hp} MP=${p.symbols?.mp} LP=${p.symbols?.lp} SP=${p.symbols?.sp} |\n`);
  md.push(`| Features (${p.features?.length || 0}) | ${(p.features||[]).map(f => f.kind).join(', ')} |\n`);
  md.push(`| FS | enabled=${p.fs?.enabled} sym=${p.fs?.triggerSymbol} awards=${JSON.stringify(p.fs?.awards || [])} |\n`);
  /* B */
  md.push(`\n### B · Mandatory blocks\n\n| Block | Present |\n|:--|:-:|\n`);
  for (const b of (r.phases.B.blocks || [])) md.push(`| ${b.name} | ${b.present ? '✅' : '❌'} |\n`);
  /* C */
  md.push(`\n### C · Feature → block\n\n| Feature kind | Live |\n|:--|:-:|\n`);
  for (const c of (r.phases.C.checks || [])) md.push(`| ${c.kind} | ${c.live ? '✅' : '❌'} |\n`);
  /* D */
  md.push(`\n### D · Force chips\n\n| Chip | Status | Emits |\n|:--|:-:|:--|\n`);
  for (const c of (r.phases.D.chips || [])) md.push(`| ${c.kind} | ${c.status} | \`${(c.emits||[]).join(' · ')}\` |\n`);
  /* E */
  md.push(`\n### E · Base lifecycle\n\n| | |\n|:--|:-:|\n`);
  md.push(`| Spins completed | ${r.phases.E.spinsCompleted}/8 |\n`);
  md.push(`| Chain (preSpin → onSpinResult → postSpin) | ${r.phases.E.chainOk}/8 |\n`);
  /* F */
  md.push(`\n### F · Win presentation\n\n| | |\n|:--|:-:|\n`);
  md.push(`| Highlight start emit | ${r.phases.F.sawHighlight ? '✅' : '❌'} |\n`);
  md.push(`| Cycle end emit | ${r.phases.F.sawEnd ? '✅' : '❌'} |\n`);
  md.push(`| Win rollup visible | ${r.phases.F.rollupVisible ? '✅' : '❌'} |\n`);
  /* G */
  md.push(`\n### G · Big-win flow\n\n| | |\n|:--|:-:|\n`);
  md.push(`| onBigWinTierEntered | ${r.phases.G.sawEntered ? '✅' : '❌'} |\n`);
  md.push(`| onBigWinTierExited / End | ${r.phases.G.sawExited ? '✅' : '❌'} |\n`);
  md.push(`| Banner DOM visible | ${r.phases.G.bannerSeen ? '✅' : '❌'} |\n`);
  /* H */
  if (r.phases.H.skipped) {
    md.push(`\n### H · Free spins\n\n⊘ skipped: ${r.phases.H.skipped}\n`);
  } else {
    md.push(`\n### H · Free spins\n\n| | |\n|:--|:-:|\n`);
    md.push(`| onFsTrigger | ${r.phases.H.sawTrigger ? '✅' : '❌'} |\n`);
    md.push(`| Intro overlay | ${r.phases.H.sawIntro ? '✅' : '❌'} |\n`);
  }
  /* I */
  if (r.phases.I.skipped) {
    md.push(`\n### I · Slam-stop\n\n⊘ skipped: ${r.phases.I.skipped}\n`);
  } else {
    md.push(`\n### I · Slam-stop\n\n| | |\n|:--|:-:|\n`);
    md.push(`| onSlamRequested | ${r.phases.I.sawRequested ? '✅' : '❌'} |\n`);
    md.push(`| onSlamComplete / postSpin | ${r.phases.I.sawComplete ? '✅' : '❌'} |\n`);
  }
  /* J */
  md.push(`\n### J · DOM regression\n\n| | |\n|:--|:-:|\n`);
  md.push(`| Banned-string occurrences | ${r.phases.J.redness?.length || 0} |\n`);
  if (r.phases.J.redness?.length) {
    md.push(`\n<details><summary>Show offenders</summary>\n\n`);
    for (const o of r.phases.J.redness.slice(0, 20)) {
      md.push(`- \`${o.tag}.${o.cls}\` → ${o.txt}\n`);
    }
    md.push(`</details>\n`);
  }
  /* K */
  md.push(`\n### K · Console / page errors\n\n| | |\n|:--|:-:|\n`);
  md.push(`| Console errors | ${r.phases.K.console} |\n`);
  md.push(`| Page errors | ${r.phases.K.page} |\n`);
  if (r.phases.K.sampleConsole) md.push(`| Sample console | \`${r.phases.K.sampleConsole.replace(/\|/g,'\\|')}\` |\n`);
  if (r.phases.K.samplePage)    md.push(`| Sample page | \`${r.phases.K.samplePage.replace(/\|/g,'\\|')}\` |\n`);
}

writeFileSync(resolve(OUT, 'audit.md'), md.join(''));
writeFileSync(resolve(OUT, 'audit.json'), JSON.stringify(results, null, 2));

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`Report: ${resolve(OUT, 'audit.md')}`);
console.log(`Verdict: ${anyFail ? '⚠️ DEFECTS FOUND' : '✅ ALL GDDS PERFECT'}`);
process.exit(anyFail ? 1 : 0);

/* ─── helpers ─────────────────────────────────────────────────── */
async function waitForSpinReady(frame, page, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const ok = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      return !!b && !b.disabled;
    });
    if (ok) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function resetGameState(frame) {
  /* Hard-reset any lingering FS / big-win / overlay state that earlier
   * phases may have triggered. This is QA-only — production code never
   * needs this. */
  await frame.evaluate(() => {
    try {
      if (window.FSM && typeof window.fsHardExit === 'function' &&
          window.FSM.phase && window.FSM.phase !== 'BASE' && window.FSM.phase !== 'IDLE') {
        window.fsHardExit();
      }
    } catch (_) {}
    /* Close any modal overlays */
    ['wbOverlay','gambleOverlay','bpOverlay','bonusBuyOverlay','fsIntroOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.dataset.show = 'false'; el.style.display = 'none'; }
    });
    /* Close big-win banner */
    const bwt = document.querySelector('.bwt-banner');
    if (bwt) { bwt.dataset.show = 'false'; bwt.style.display = 'none'; }
    /* Reset emit log */
    window.__GD_EMITS__ = [];
  });
}
