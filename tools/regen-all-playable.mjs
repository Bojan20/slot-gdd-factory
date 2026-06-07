#!/usr/bin/env node
/**
 * Regenerate the three primary playable demos in dist/ from samples/.
 * Used by SlotGDDBuilder.command and ad-hoc by Corti after block changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  /* Three primary demos kept for back-compat (existing probes target these). */
  { src: 'samples/grids/01_rectangular_5x3_GAME_GDD.md', out: 'dist/01_rectangular_5x3_playable.html' },
  { src: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md',         out: 'dist/wrath-of-olympus.html' },
  { src: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md',    out: 'dist/gates-of-olympus-1000.html' },
  /* Wave I — multi-topology H5.x verification. 8 UNIFORM_REEL_KINDS that
   * the H5.x block stack supports but were never built as dist fixtures.
   * Each gets a per-game bigWinTier config below (PER_GAME_BIGWIN). */
  { src: 'samples/grids/05_megaclusters_GAME_GDD.md', out: 'dist/05_megaclusters_playable.html' },
  { src: 'samples/grids/07_diamond_GAME_GDD.md',      out: 'dist/07_diamond_playable.html' },
  { src: 'samples/grids/08_pyramid_GAME_GDD.md',      out: 'dist/08_pyramid_playable.html' },
  { src: 'samples/grids/09_cross_GAME_GDD.md',        out: 'dist/09_cross_playable.html' },
  { src: 'samples/grids/10_lshape_GAME_GDD.md',       out: 'dist/10_lshape_playable.html' },
  { src: 'samples/grids/12_infinity_GAME_GDD.md',     out: 'dist/12_infinity_playable.html' },
  { src: 'samples/grids/13_expanding_GAME_GDD.md',    out: 'dist/13_expanding_playable.html' },
  { src: 'samples/grids/19_lock_respin_GAME_GDD.md',  out: 'dist/19_lock_respin_playable.html' },
  /* Wave H13 — Path-Aware Multiplier needs a Ways-evaluator dist target.
   * 04_variable_reel declares 117649-ways evaluation; pathAwareMultiplier
   * auto-enables on any ways topology. Vendor-neutral demo. */
  { src: 'samples/grids/04_variable_reel_GAME_GDD.md', out: 'dist/04_variable_reel_playable.html' },
];

/* Wave H5 — per-game Big-Win Tier label overrides. Each entry mirrors the
 * matching sample GDD's §big-win section verbatim (so the dist HTML reads
 * the same tier vocabulary the design doc specifies). The block itself
 * stays vendor-neutral — these labels live only in samples + this tool
 * harness, never in src/blocks/. The lego-gate vendor scan covers
 * src/blocks/ only, so theme-flavoured labels here are kosher. */
const PER_GAME_BIGWIN = {
  /* Rectangular 5×3 — generic placeholder ladder. Boki rule 05.06.2026:
   * "bigwintier1-5 da se zna da je big win" — when a GDD doesn't author
   * its own tier vocabulary, the dist demo MUST show the identifier
   * itself ("BIGWINTIER1"..."BIGWINTIER5"), not a made-up vendor-style
   * substitute. Real per-game GDDs override with their own copy. */
  '01_rectangular_5x3_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    /* Boki rule 05.06.2026: "svaki tir traje po 4 sekunde" — uniform
     * 4 s per tier across all demos. Matches WoO §6.4 reference and
     * keeps compound walkthrough cadence consistent regardless of game. */
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  /* Wrath-of-Olympus — §6.4 BIG/MEGA/EPIC + two extrapolated climax tiers,
   * 4 s plaque per tier (Boki rule + GDD baseline). */
  'wrath-of-olympus.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIG WIN', 'MEGA WIN', 'EPIC WIN', 'ZEUS WIN', 'OLYMPUS WIN'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  /* Gates-of-Olympus 1000 — BIG / MEGA / SUPER / EPIC / MYTHIC, 4 s per
   * tier (Boki rule). */
  'gates-of-olympus-1000.html': {
    thresholds: [10, 30, 60, 200, 800],
    labels:     ['BIG WIN', 'MEGA WIN', 'SUPER WIN', 'EPIC WIN', 'MYTHIC WIN'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  /* Wave I — multi-topology H5.x fixtures. Vendor-neutral placeholder
   * labels (BIGWINTIER1..5) so the player-facing copy shows the
   * identifier and the dist HTML keeps the LEGO test surface honest.
   * Real games override with their own GDD labels. */
  '05_megaclusters_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  '07_diamond_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  '08_pyramid_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  '09_cross_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  '10_lshape_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  '12_infinity_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  '13_expanding_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  '19_lock_respin_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
  /* Wave H13 — variable-reel ways dist target. Vendor-neutral placeholder
   * tier ladder (pathAwareMultiplier auto-lights up via ways topology). */
  '04_variable_reel_playable.html': {
    thresholds: [10, 25, 50, 200, 1000],
    labels:     ['BIGWINTIER1', 'BIGWINTIER2', 'BIGWINTIER3', 'BIGWINTIER4', 'BIGWINTIER5'],
    durations:  [4000, 4000, 4000, 4000, 4000],
  },
};

for (const t of targets) {
  const md = readFileSync(resolve(REPO, t.src), 'utf8');
  const model = parseGDD(md, 'md');
  /* Wave H5 — auto-enable Big-Win Tier ladder on every dist demo and
   * attach per-game labels/thresholds/durations. Per-game `model.bigWinTier`
   * is what the player actually reads on screen. */
  if (!Array.isArray(model.features)) model.features = [];
  const alreadyDeclared = model.features.some(f =>
    f && typeof f.kind === 'string' &&
    /^(big[_-]?win[_-]?tier|win[_-]?ladder|big[_-]?win[_-]?ladder)$/i.test(f.kind),
  );
  if (!alreadyDeclared) {
    model.features.push({ kind: 'big_win_tier', label: 'Big-Win Tier Ladder' });
  }
  const outBase = t.out.split('/').pop();
  const perGame = PER_GAME_BIGWIN[outBase];
  if (perGame) {
    model.bigWinTier = Object.assign({}, model.bigWinTier || {}, { enabled: true }, perGame);
  }
  /* Wave H14 — auto-enable Hold-and-Win Credit Bucket extension on demos
   * that already declare a `hold_and_win` feature kind. Default prize map
   * + jackpot ladder are template-neutral; per-game GDDs can override via
   * `model.holdAndWinCreditBucket.*`. The extension is a no-op when the
   * base holdAndWin block is disabled. */
  const hasHnW = model.features.some(f =>
    f && typeof f.kind === 'string' && /^hold[_-]?and[_-]?win$/i.test(f.kind),
  );
  if (hasHnW) {
    const alreadyHasBucket = model.features.some(f =>
      f && typeof f.kind === 'string' &&
      /^(hold[_-]?and[_-]?win[_-]?credit[_-]?bucket|credit[_-]?bucket)$/i.test(f.kind),
    );
    if (!alreadyHasBucket) {
      model.features.push({ kind: 'hold_and_win_credit_bucket', label: 'Credit Bucket' });
    }
    /* Make sure the base holdAndWin block is on too (it auto-enables via
     * the hold_and_win feature kind already, but be explicit so the demo
     * lights up the locked-cell halo + HUD on the first respin). */
    model.holdAndWin = Object.assign({}, model.holdAndWin || {}, { enabled: true });
  }
  /* Wave H15 — demo-only: light up wheelBonus + weightedWheelSegments on
   * the baseline rectangular dist so the extension is observable end-to-end
   * (no other dist currently declares wheel_bonus). Vendor-neutral demo
   * segments with explicit weights + 4-tier jackpot map. Real GDDs that
   * declare wheel_bonus + weighted_wheel_segments features get their own
   * per-game tables via model.wheelBonus / model.weightedWheelSegments. */
  if (outBase === '01_rectangular_5x3_playable.html') {
    const alreadyWheel = model.features.some(f =>
      f && typeof f.kind === 'string' && /^wheel[_-]?bonus$/i.test(f.kind),
    );
    if (!alreadyWheel) {
      model.features.push({ kind: 'wheel_bonus', label: 'Bonus Wheel' });
    }
    const alreadyWeighted = model.features.some(f =>
      f && typeof f.kind === 'string' && /^weighted[_-]?wheel/i.test(f.kind),
    );
    if (!alreadyWeighted) {
      model.features.push({ kind: 'weighted_wheel_segments', label: 'Weighted Wheel' });
    }
    /* 8 segments with the last 2 as jackpot tiers (MAJOR + GRAND). */
    model.wheelBonus = Object.assign({}, model.wheelBonus || {}, {
      enabled: true,
      title: 'BONUS WHEEL',
      segments: [
        { label: '×2',    value: 2,    color: '#e8c270' },
        { label: '×5',    value: 5,    color: '#d28a3a' },
        { label: '×10',   value: 10,   color: '#c45050' },
        { label: '×20',   value: 20,   color: '#7050c4' },
        { label: '×50',   value: 50,   color: '#3aa0c2' },
        { label: '×100',  value: 100,  color: '#2bb56b' },
        { label: 'MAJOR', value: 0,    color: '#e84f8a', jackpotTier: 'MAJOR' },
        { label: 'GRAND', value: 0,    color: '#ffd24a', jackpotTier: 'GRAND' },
      ],
    });
    /* Steep distribution — small mults common, jackpots rare. */
    model.weightedWheelSegments = Object.assign({}, model.weightedWheelSegments || {}, {
      enabled: true,
      weights: [32, 24, 18, 12, 7, 4, 2, 1],
      jackpotMap: [
        { label: 'MINI',  x: 5 },
        { label: 'MINOR', x: 25 },
        { label: 'MAJOR', x: 100 },
        { label: 'GRAND', x: 1000 },
      ],
    });
  }
  /* Wave H13 — auto-light pathAwareMultiplier on any dist that uses
   * the ways evaluator. Vendor-neutral 6-tier additive multiplier ladder
   * (2× common → 100× rare). Per-game GDDs can override via
   * model.pathAwareMultiplier.{multiplierMap, aggregation, ...}. */
  const hasWaysFeature = model.features.some(f =>
    f && typeof f.kind === 'string' && /^ways$/i.test(f.kind),
  );
  const isWaysTopology = model.topology && (
    model.topology.evaluation === 'ways' ||
    Number.isFinite(model.topology.ways_count)
  );
  if (hasWaysFeature || isWaysTopology) {
    const alreadyPaw = model.features.some(f =>
      f && typeof f.kind === 'string' &&
      /^(path[_-]?aware[_-]?multiplier|path[_-]?multiplier)$/i.test(f.kind),
    );
    if (!alreadyPaw) {
      model.features.push({ kind: 'path_aware_multiplier', label: 'Path-Aware Multiplier' });
    }
    /* Ensure waysEval block is on so the extension has a target to wrap. */
    model.waysEval = Object.assign({}, model.waysEval || {}, { enabled: true });
    /* Demo-tier vendor-neutral additive ladder + cool-blue chip color. */
    model.pathAwareMultiplier = Object.assign({}, model.pathAwareMultiplier || {}, {
      enabled: true,
      aggregation: 'additive',
      multiplierMap: [
        { x: 2,   weight: 40, label: '×2'   },
        { x: 3,   weight: 24, label: '×3'   },
        { x: 5,   weight: 16, label: '×5'   },
        { x: 10,  weight: 10, label: '×10'  },
        { x: 25,  weight: 6,  label: '×25'  },
        { x: 50,  weight: 3,  label: '×50'  },
        { x: 100, weight: 1,  label: '×100' },
      ],
      chipColor: '120,180,255',
      showAggregateChip: true,
    });
  }  /* Wave H12 — auto-enable Net Win/Loss Indicator on every demo (it's a
   * regulator-mandated player-protection chip; defaults to 3-tier loss
   * ladder -50/-150/-500). The block is a no-op when balanceHud is off
   * (which it never is in our demos), so safe to inject unconditionally. */
  const alreadyNli = model.features.some(f =>
    f && typeof f.kind === 'string' &&
    /^(net[_-]?loss[_-]?indicator|session[_-]?net)$/i.test(f.kind),
  );
  if (!alreadyNli) {
    model.features.push({ kind: 'net_loss_indicator', label: 'Net Loss Indicator' });
  }
  model.netLossIndicator = Object.assign({}, model.netLossIndicator || {}, { enabled: true });

  /* Wave H2 — auto-enable Reality Check modal on every demo. UKGC LCCP
   * 8.3 mandates this for British market. For demo visibility, use a
   * short 60s interval + spin-trigger every 25 spins. Real production
   * GDDs override intervalMs to 30 / 60 min per market regulation. */
  const alreadyRc = model.features.some(f =>
    f && typeof f.kind === 'string' && /^reality[_-]?check$/i.test(f.kind),
  );
  if (!alreadyRc) {
    model.features.push({ kind: 'reality_check', label: 'Reality Check' });
  }
  model.realityCheck = Object.assign({}, model.realityCheck || {}, {
    enabled: true,
    intervalMs: 60000,      /* 60s demo interval — production would use 1800000 (30min) */
    spinInterval: 25,
    triggerOnLossLevel: 'alert',
  });

  /* Wave H3 — auto-enable Session Timeout (continuous-play cap + forced
   * break) on every demo. UKGC LCCP 8.3.1 + AGCO Standard 4.07 mandate
   * a continuous-play cap. Demo values are tiny so QA can witness both
   * the warning and the forced-break in seconds; real production GDDs
   * override maxMs to 30/60 min per market. */
  const alreadySt = model.features.some(f =>
    f && typeof f.kind === 'string' && /^session[_-]?(timeout|limit)$/i.test(f.kind),
  );
  if (!alreadySt) {
    model.features.push({ kind: 'session_timeout', label: 'Session Timeout' });
  }
  model.sessionTimeout = Object.assign({}, model.sessionTimeout || {}, {
    enabled: true,
    maxMs: 90 * 1000,        /* 90s demo cap — production would use 3600000 (60min) */
    warnMs: 20 * 1000,       /* 20s lead-time before forced break — production 60s */
    breakMs: 30 * 1000,      /* 30s break for demo — production 300000 (5min) */
    forceLogout: false,      /* demo uses soft model — break ends with auto-resume */
    extendable: true,
    pauseDuringReality: true,
  });

  /* Wave H11 — auto-enable Bonus Buy Deterministic Plant on demos that
   * already declare a bonus_buy feature (or have bonusBuy enabled). The
   * extension is a no-op when bonusBuy is off (resolveConfig forces
   * enabled=false in that case). Demo plants use the 3-tier industry
   * baseline ladder from the block's defaultConfig. Real GDDs override
   * via model.bonusBuyDeterministic.plants. */
  const hasBonusBuy = model.features.some(f =>
    f && typeof f.kind === 'string' && /^bonus[_-]?buy$/i.test(f.kind),
  ) || !!(model.bonusBuy && model.bonusBuy.enabled === true);
  if (hasBonusBuy) {
    const alreadyBbd = model.features.some(f =>
      f && typeof f.kind === 'string' &&
      /^(bonus[_-]?buy[_-]?deterministic|deterministic[_-]?plant)$/i.test(f.kind),
    );
    if (!alreadyBbd) {
      model.features.push({ kind: 'bonus_buy_deterministic', label: 'Deterministic Plant' });
    }
    model.bonusBuyDeterministic = Object.assign({}, model.bonusBuyDeterministic || {}, {
      enabled: true,
    });
  }
  const html = buildSlotHTML(model);
  writeFileSync(resolve(REPO, t.out), html);
  console.log(`✅ ${t.out}  (${(html.length/1024).toFixed(1)} KB)`);
}
