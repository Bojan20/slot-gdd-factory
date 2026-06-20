#!/usr/bin/env node
/**
 * tools/build-sandbox-slot.mjs · D-15 SANDBOX TESTBED
 *
 * Boki imperative (2026-06-20):
 *   "Zelim da svaki blok iststiras, na primer uzmi rectangular ili
 *    napravi novi slot gde mogu da menjam bilo koje blokove, sve koji
 *    postoje, i onda da vidim kako koji s kojim radi i ako ima bugova,
 *    da ih tu prvo resavas i onda da ih ukljucimo u svaki gdd"
 *
 * What it does:
 *   1. Loads existing WoO model.json kao bazu (5x3 rectangular).
 *   2. Force-enables SVAKI poznat blok config (multiplier, jackpot,
 *      H&W sub-multipliers, mystery, sticky, walking, ladder, etc).
 *   3. Adds top-level keys za blokove koji nisu detected by parser.
 *   4. Runs buildSlotHTML → dist/sandbox/sandbox.html.
 *   5. Injects sandbox sidebar panel sa block-toggles + per-block
 *      trigger buttons koje force-uju force flag-ove.
 *
 * Output: dist/sandbox/sandbox.html
 *
 * Use case: Boki otvori sandbox.html → vidi sve blokove enabled
 * na rectangular 5x3 → klikne toggle da disable/enable blok →
 * page reload sa cleanim state-om za testiranje interakcija.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const BASE_MODEL = resolve(REPO, 'dist/real-games/wrath-of-olympus-gdd/model.json');
const OUT_DIR = resolve(REPO, 'dist/sandbox');
const OUT_HTML = resolve(OUT_DIR, 'sandbox.html');

if (!existsSync(BASE_MODEL)) {
  console.error('Base model not found:', BASE_MODEL);
  console.error('Run `npm run test:parse:real-pdfs` first.');
  process.exit(2);
}

const base = JSON.parse(readFileSync(BASE_MODEL, 'utf-8'));

/* Force-enable every known block config. Where the parser left an
 * empty object (lightning: {}, gamble: {}, holdAndWin: {}), we
 * substitute a working default so the runtime actually wires up. */
const sandboxModel = {
  ...base,
  name: 'CORTI SANDBOX',
  topology: { rows: 3, cols: 5, kind: 'rectangular' },

  /* Core engine */
  reelEngine: { ...(base.reelEngine || {}), enabled: true },
  tumble: { ...(base.tumble || {}), enabled: true },

  /* Win modes — multiple eval kinds aktivne (cluster + ways + lines) */
  waysEval: { ...(base.waysEval || {}), enabled: true },
  clusterPaysEval: { ...(base.clusterPaysEval || {}), enabled: true },
  payAnywhereEval: { ...(base.payAnywhereEval || {}), enabled: true },

  /* Free spins + presentation */
  freeSpins: { ...(base.freeSpins || {}), enabled: true,
    awards: [{ count: 3, spins: 10 }, { count: 4, spins: 15 }, { count: 5, spins: 20 }] },
  freeSpinsPresentation: { ...(base.freeSpinsPresentation || {}), enabled: true },
  progressiveFreeSpins: { ...(base.progressiveFreeSpins || {}), enabled: true },
  fsProgressBar: { enabled: true },

  /* Multipliers — sve enable */
  multiplierOrb: { ...(base.multiplierOrb || {}), enabled: true,
    distribution: [
      { value:  2, weight: 50 }, { value:  3, weight: 30 },
      { value:  5, weight: 15 }, { value: 10, weight: 10 },
      { value: 25, weight:  5 }, { value: 50, weight:  3 },
      { value: 100, weight: 1 }, { value: 250, weight: 1 },
      { value: 500, weight: 1 },
    ]},
  persistentMultiplier: { ...(base.persistentMultiplier || {}), enabled: true,
    mode: 'fs', startMult: 1, growPerWin: 1, maxMult: 100 },
  multiplierLadder: { enabled: true, steps: [1, 2, 3, 5, 10, 25, 50] },
  randomLightningMultiplier: { enabled: true, triggerProbability: 0.15,
    distribution: [
      { value: 2, weight: 50 }, { value: 3, weight: 30 },
      { value: 5, weight: 15 }, { value: 10, weight: 5 }
    ]},
  expandingWildMultiplier: { enabled: true },
  mysterySymbolMultiplier: { enabled: true },
  perFsSpinMultiplier: { enabled: true },
  retriggerMultiplierBump: { enabled: true },
  stormMultiplierReel: { enabled: true },
  tumbleGrowingFsMultiplier: { enabled: true },
  wildCollisionMultiplier: { enabled: true },
  clusterSizeMultiplier: { enabled: true },
  pathAwareMultiplier: { enabled: true },
  totalMultiplierChip: { enabled: true },
  winMultiplierBadge: { enabled: true },
  holdAndWinFrameMultiplier: { enabled: true,
    tierLadder: [1, 2, 3, 5, 10], bumpOnReLand: true },
  holdAndWinLockedOrbMultiplier: { enabled: true,
    distribution: [
      { value: 2, weight: 50 }, { value: 5, weight: 25 },
      { value: 10, weight: 15 }, { value: 25, weight: 8 },
      { value: 100, weight: 2 }
    ], aggregation: 'additive' },
  holdAndWinRoomJackpotMultiplier: { enabled: true,
    rooms: [
      { name: 'MINI', threshold: 0, multX: 1 },
      { name: 'MINOR', threshold: 5, multX: 2 },
      { name: 'MAJOR', threshold: 10, multX: 5 },
      { name: 'GRAND', threshold: 15, multX: 20 },
    ]},

  /* Hold & Win */
  holdAndWin: { ...(base.holdAndWin || {}), enabled: true,
    triggerCount: 6, bonusSymbol: 'B' },
  holdAndWinCreditBucket: { enabled: true },
  wildTriggerHoldAndWin: { enabled: true },
  holdAndWinReelExpansion: { enabled: true },

  /* Wilds */
  expandingWild: { ...(base.expandingWild || {}), enabled: true },
  stickyWild: { ...(base.stickyWild || {}), enabled: true },
  walkingWild: { ...(base.walkingWild || {}), enabled: true },
  walkingWildStepper: { enabled: true },
  wildReel: { ...(base.wildReel || {}), enabled: true },
  megaWildCluster: { enabled: true },
  cascadingWildPersistence: { enabled: true },

  /* Symbol features */
  mysterySymbol: { ...(base.mysterySymbol || {}), enabled: true },
  superSymbol: { ...(base.superSymbol || {}), enabled: true },
  superSymbolUpgrade: { enabled: true },
  symbolUpgrade: { enabled: true },
  megaSymbol: { enabled: true },
  splitSymbol: { enabled: true },
  collectableSymbol: { enabled: true },
  mysteryWildReveal: { enabled: true },
  mysteryReveal: { enabled: true },
  symbolStackCollapse: { enabled: true },
  symbolSplitReveal: { enabled: true },

  /* Bonus + jackpot */
  bonusBuy: { ...(base.bonusBuy || {}), enabled: true },
  bonusPick: { ...(base.bonusPick || {}), enabled: true },
  wheelBonus: { ...(base.wheelBonus || {}), enabled: true,
    segments: [
      { label: 'MINI', value: 10, weight: 50 },
      { label: 'MINOR', value: 50, weight: 30 },
      { label: 'MAJOR', value: 200, weight: 15 },
      { label: 'GRAND', value: 1000, weight: 5 },
    ]},
  weightedWheelSegments: { enabled: true },
  jackpotLadderRooms: { enabled: true,
    rooms: [
      { name: 'MINI', multX: 1 }, { name: 'MINOR', multX: 5 },
      { name: 'MAJOR', multX: 25 }, { name: 'GRAND', multX: 100 },
    ]},
  jackpotPicker: { enabled: true },
  jackpotRoomReveal: { enabled: true },
  dailyJackpot: { enabled: true },
  fsPersistentJackpotPool: { enabled: true },

  /* Gamble */
  gamble: { ...(base.gamble || {}), enabled: true, maxRounds: 5 },
  gambleSecondary: { ...(base.gambleSecondary || {}), enabled: true },
  hiLoGamble: { enabled: true },

  /* Other features */
  lightning: { ...(base.lightning || {}), enabled: true },
  respin: { ...(base.respin || {}), enabled: true },
  respinCharge: { enabled: true },
  anteBet: { ...(base.anteBet || {}), enabled: true },
  anteBetLadder: { enabled: true },
  insuranceBet: { enabled: true },
  prizeBoostBet: { enabled: true },
  bigWinTier: { enabled: true },
  winRollup: { enabled: true },
  winCap: { enabled: true },
  winPresentation: { enabled: true },
  scatterCelebration: { ...(base.scatterCelebration || {}), enabled: true },
  anticipation: { ...(base.anticipation || {}), enabled: true },
  nearMissTease: { enabled: true },
  paylines: { enabled: true },
  paylineOverlay: { enabled: true },
  paylineDimmer: { enabled: true },
  winLineFlash: { enabled: true },
  cellOverflowCounter: { enabled: true },
  cellLevelUpgrade: { enabled: true },
  coinCollect: { enabled: true },
  coinShower: { enabled: true },
  collectRevealOverlay: { enabled: true },
  wildCollectionTrail: { enabled: true },
  cumulativeMeter: { enabled: true },
  energyMeter: { enabled: true },
  retriggerMeter: { enabled: true },
  retriggerEscalator: { enabled: true },
  stickyMeter: { enabled: true },
  streakBonus: { enabled: true },
  rewardChest: { enabled: true },
  playerXp: { enabled: true },
  sessionLevelMeter: { enabled: true },
  leaderboardChip: { enabled: true },
  achievementToast: { enabled: true },
  netLossIndicator: { enabled: true },
  cellLevelUpgradeFs: { enabled: true },
  fsExpansionWilds: { enabled: true },
  fsReelHeightEscalation: { enabled: true },
  fsSymbolUpgradeEscalation: { enabled: true },
  progressiveFsRetriggerLadder: { enabled: true },
  pickYourFs: { enabled: true },
  lockedSymbolFs: { enabled: true },
  tumbleOnlyFs: { enabled: true },
  infiniteFsUntilLoss: { enabled: true },
  matchThreeBonusReveal: { enabled: true },
  pickBonusReveal: { enabled: true },
  wheelBonusReveal: { enabled: true },
  bonusClimaxReveal: { enabled: true },
  bonusOverlayMutex: { enabled: true },
  pathBonusEngine: { enabled: true },
  cascadeBooster: { enabled: true },
  cascadePathDraw: { enabled: true },
  dualRoleScatter: { enabled: true },
  dynamicWaysEngine: { enabled: true },
  infinityReels: { enabled: true },
  reelLockHold: { enabled: true },
  reelHeightAdapter: { enabled: true },
  triggerCounting: { ...(base.triggerCounting || {}), enabled: true },
  winBothWaysActivation: { enabled: true },
  winwaysIndicator: { enabled: true },

  /* Universal force panel — sve chip-ove visible */
  universalForcePanel: { enabled: true, includeKinds: 'auto' },

  /* Features array — add svi mogući feature kindovi */
  features: [
    { kind: 'free_spins' }, { kind: 'big_win' }, { kind: 'hold_and_win' },
    { kind: 'bonus_pick' }, { kind: 'wheel_bonus' }, { kind: 'multiplier' },
    { kind: 'multiplier_orb' }, { kind: 'persistent_multiplier' },
    { kind: 'cascade' }, { kind: 'ways' },
    { kind: 'expanding_wild' }, { kind: 'walking_wild' }, { kind: 'sticky_wild' },
    { kind: 'mystery_symbol' }, { kind: 'lightning' },
    { kind: 'respin' }, { kind: 'wild_reel' }, { kind: 'gamble' },
    { kind: 'super_symbol' }, { kind: 'jackpot' }, { kind: 'bonus_buy' },
  ],
};

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log('Building sandbox slot with', Object.keys(sandboxModel).length, 'top-level config keys...');

let html;
try {
  html = await buildSlotHTML(sandboxModel);
} catch (e) {
  console.error('buildSlotHTML failed:', e.message);
  console.error(e.stack);
  process.exit(2);
}

/* Inject sandbox sidebar — block toggle panel + force triggers.
 * Mounted as <div id="corti-sandbox-panel"> after body. */
const SANDBOX_PANEL = `
<style>
#corti-sandbox-panel {
  position: fixed;
  top: 8px; left: 8px;
  width: 280px; max-height: calc(100vh - 16px);
  overflow-y: auto;
  background: rgba(15, 20, 30, 0.95);
  border: 1px solid rgba(201, 162, 39, 0.6);
  border-radius: 10px;
  padding: 10px;
  z-index: 9999;
  color: #f4eecf;
  font: 11px/1.4 system-ui, -apple-system, sans-serif;
  box-shadow: 0 8px 32px rgba(0,0,0,0.7);
}
#corti-sandbox-panel h2 {
  margin: 0 0 8px;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: #ffd966;
  border-bottom: 1px solid rgba(201,162,39,0.3);
  padding-bottom: 4px;
}
#corti-sandbox-panel h3 {
  margin: 10px 0 4px;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgba(255, 220, 130, 0.85);
  text-transform: uppercase;
}
#corti-sandbox-panel button {
  display: inline-block;
  margin: 2px;
  padding: 4px 8px;
  background: linear-gradient(180deg, rgba(40,46,60,.95), rgba(20,24,32,.95));
  border: 1px solid rgba(201,162,39,0.45);
  border-radius: 4px;
  color: #f4eecf;
  font: 600 10px system-ui, sans-serif;
  cursor: pointer;
}
#corti-sandbox-panel button:hover {
  background: linear-gradient(180deg, rgba(80,68,28,.95), rgba(40,32,12,.95));
}
#corti-sandbox-panel .csp-collapsed-toggle {
  position: fixed; top: 8px; left: 8px; width: 36px; height: 36px;
  border-radius: 50%; cursor: pointer; z-index: 10000;
  background: rgba(201, 162, 39, 0.85); color: #1a1408;
  font: 900 18px/36px system-ui, sans-serif; text-align: center;
  border: none;
}
#corti-sandbox-panel.is-collapsed > *:not(.csp-collapsed-toggle) { display: none; }
#corti-sandbox-panel:not(.is-collapsed) .csp-collapsed-toggle { display: none; }
.csp-row { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 4px; }
.csp-status {
  margin-top: 10px; padding: 6px; border-radius: 4px;
  background: rgba(0,0,0,0.4); font-family: ui-monospace, monospace;
  font-size: 10px; min-height: 32px;
}
</style>
<div id="corti-sandbox-panel">
  <button class="csp-collapsed-toggle" aria-label="Expand sandbox panel">≡</button>
  <h2>🧪 CORTI SANDBOX <button id="cspCollapse" style="float:right;font-size:14px;padding:0 6px">×</button></h2>
  <div style="font-size:10px;color:rgba(255,255,255,0.6);margin-bottom:6px">
    Rectangular 5×3 · sve blokove enabled · klik trigger da forsuješ
  </div>

  <h3>Force feature</h3>
  <div class="csp-row">
    <button onclick="cspForce('free_spins')">FS</button>
    <button onclick="cspForce('big_win')">BigWin</button>
    <button onclick="cspForce('hold_and_win')">H&W</button>
    <button onclick="cspForce('wheel_bonus')">Wheel</button>
    <button onclick="cspForce('bonus_pick')">Pick</button>
    <button onclick="cspForce('jackpot')">Jackpot</button>
    <button onclick="cspForce('gamble')">Gamble</button>
  </div>

  <h3>Force multiplier</h3>
  <div class="csp-row">
    <button onclick="cspForceMult(2)">×2</button>
    <button onclick="cspForceMult(3)">×3</button>
    <button onclick="cspForceMult(5)">×5</button>
    <button onclick="cspForceMult(10)">×10</button>
    <button onclick="cspForceMult(25)">×25</button>
    <button onclick="cspForceMult(50)">×50</button>
    <button onclick="cspForceMult(100)">×100</button>
    <button onclick="cspForceMult(500)">×500</button>
  </div>

  <h3>Force orb</h3>
  <div class="csp-row">
    <button onclick="cspForceOrb(2)">orb×2</button>
    <button onclick="cspForceOrb(10)">orb×10</button>
    <button onclick="cspForceOrb(50)">orb×50</button>
    <button onclick="cspForceOrb(250)">orb×250</button>
    <button onclick="cspForceOrb(500)">orb×500</button>
  </div>

  <h3>Force lightning</h3>
  <div class="csp-row">
    <button onclick="cspForceLightning(2)">⚡×2</button>
    <button onclick="cspForceLightning(3)">⚡×3</button>
    <button onclick="cspForceLightning(5)">⚡×5</button>
    <button onclick="cspForceLightning(10)">⚡×10</button>
  </div>

  <h3>Toggle event log</h3>
  <button onclick="cspToggleLog()">Show/hide event stream</button>
  <div class="csp-status" id="cspStatus">click Force → mult update</div>
  <pre class="csp-status" id="cspEventLog" style="display:none;max-height:200px;overflow-y:auto"></pre>
</div>
<script>
(function() {
  function _runSpin() {
    if (typeof window.runOneBaseSpin === 'function') { window.runOneBaseSpin(); return; }
    var btn = document.getElementById('spinBtn');
    if (btn && !btn.disabled) btn.click();
  }
  function _updateStatus() {
    var status = document.getElementById('cspStatus');
    if (!status) return;
    var mult = (window.HookBus && typeof window.HookBus.getMult === 'function')
      ? window.HookBus.getMult() : '?';
    var bal = window.BALANCE || '?';
    status.textContent =
      'mult=' + mult + ' · balance=' + bal +
      (window.FSM ? ' · FSM=' + (window.FSM.phase || window.FSM.state || '?') : '');
  }
  setInterval(_updateStatus, 500);

  window.cspForce = function(kind) {
    var el = document.querySelector('.ufp-chip[data-ufp-kind="' + kind + '"]');
    if (el) { el.click(); return; }
    /* fallback: set flag + run spin */
    if (kind === 'free_spins') { window.__SLOT_DEV_FORCE_FS__ = true; }
    if (kind === 'big_win') { window.__FORCE_BIG_WIN_TIER__ = 3; }
    if (kind === 'jackpot') {
      window.__FORCE_BIG_WIN_TIER__ = 5;
      window.__FORCE_JACKPOT__ = true;
    }
    window.__FORCE_FEATURE__ = kind;
    _runSpin();
  };
  window.cspForceMult = function(v) {
    if (window.HookBus && window.HookBus.setMult) window.HookBus.setMult(v);
    if (window.HookBus && window.HookBus.emit)
      window.HookBus.emit('onForceMultiplier', { multX: v });
    window.__FORCE_BIG_WIN_TIER__ = 1;
    _runSpin();
  };
  window.cspForceOrb = function(v) {
    window.__FORCE_ORB_VALUE__ = v;
    window.__FORCE_BIG_WIN_TIER__ = 1;
    if (window.HookBus && window.HookBus.setMult) window.HookBus.setMult(v);
    _runSpin();
  };
  window.cspForceLightning = function(v) {
    window.__FORCE_LIGHTNING_MULT__ = v;
    window.__FORCE_BIG_WIN_TIER__ = 1;
    if (window.HookBus && window.HookBus.setMultMax) window.HookBus.setMultMax(v);
    _runSpin();
  };
  window.cspToggleLog = function() {
    var log = document.getElementById('cspEventLog');
    if (!log) return;
    log.style.display = (log.style.display === 'none') ? 'block' : 'none';
  };

  /* Event stream */
  var log = [];
  function _appendLog(name) {
    var ts = (performance.now() / 1000).toFixed(2);
    log.push(ts + 's · ' + name);
    if (log.length > 40) log.shift();
    var el = document.getElementById('cspEventLog');
    if (el) el.textContent = log.join('\\n');
  }
  var installer = setInterval(function() {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    if (window.HookBus.__csp_wrapped) return;
    window.HookBus.__csp_wrapped = true;
    var orig = window.HookBus.emit.bind(window.HookBus);
    window.HookBus.emit = function(name, p) {
      _appendLog(name);
      return orig(name, p);
    };
    clearInterval(installer);
  }, 30);

  /* Collapse + expand */
  document.addEventListener('DOMContentLoaded', function() {
    var panel = document.getElementById('corti-sandbox-panel');
    var hide = document.getElementById('cspCollapse');
    var show = panel.querySelector('.csp-collapsed-toggle');
    if (hide) hide.addEventListener('click', function() { panel.classList.add('is-collapsed'); });
    if (show) show.addEventListener('click', function() { panel.classList.remove('is-collapsed'); });
  });
})();
</script>
`;

const injected = html.replace('</body>', SANDBOX_PANEL + '</body>');

writeFileSync(OUT_HTML, injected);
console.log('Sandbox slot written:', OUT_HTML);
console.log('Size:', (injected.length / 1024).toFixed(1), 'KB');
console.log('\nOpen in browser:');
console.log('  open', OUT_HTML);
