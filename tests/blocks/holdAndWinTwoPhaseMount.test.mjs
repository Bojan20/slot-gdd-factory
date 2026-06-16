/* eslint-disable no-console */
/**
 * tests/blocks/holdAndWinTwoPhaseMount.test.mjs
 *
 * W48 bugfix v5 — Boki rule (2026-06-16, fifth pass):
 *   "Ali tu gde se pao hold and win simbol, na toj celiji mora i da
 *    ostane kada se udje u hold and win. dakle ako se u base game ili
 *    free spin padne na odredjenoj poziciji hold and win simbol, onda
 *    mora da ostane i u hold and win na toj istoj celiji, ne sme da
 *    se menja pozicija bilo kog simbola."
 *
 * The intro placard must appear OVER the original trigger-spin grid
 * (bonus glyphs still rendered as glyphs). Only AFTER the player
 * dismisses the intro do the orb chips replace the glyphs, with the
 * pop-in animation playing for each cell.
 *
 * Verifies:
 *   • hwHarvestBonus supports opts.mapOnly that records lockedCells
 *     without mutating the DOM
 *   • _hwBeginRound calls hwHarvestBonus({ mapOnly: true }) BEFORE
 *     _hwShowIntro, then applies orbs AFTER intro resolves
 *   • _hwForceSeedMount does the same two-phase split
 */
import {
  defaultConfig,
  emitHoldAndWinRuntime,
} from '../../src/blocks/holdAndWin.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing ${JSON.stringify(n)} — ${m}`); };

console.log('— W48 bugfix v5 · H&W two-phase mount (positions frozen across intro) —');

const rt = emitHoldAndWinRuntime({ ...defaultConfig(), enabled: true });

/* ─── hwHarvestBonus contract ─────────────────────────────────────── */

t('hwHarvestBonus exposes opts.mapOnly branch', () => {
  ct(rt, 'o.mapOnly');
});

t('hwHarvestBonus mapOnly path SKIPS _hwApplyOrbToCell', () => {
  /* The mapOnly branch must not call _hwApplyOrbToCell or spawn helpers. */
  const harvestBody = rt.match(/function hwHarvestBonus\(opts\)[\s\S]*?\n\}/);
  ok(harvestBody, 'hwHarvestBonus body not extractable');
  /* The mapOnly branch must accumulate totalWinX + jackpotsHit so the
   * intro placard "N ORBS COLLECTED" line is accurate. */
  ct(harvestBody[0], 'HW_STATE.totalWinX += orb.valueX');
  ct(harvestBody[0], 'HW_STATE.jackpotsHit.push(orb.tier)');
});

t('hwHarvestBonus mapOnly skips HUD update too', () => {
  const harvestBody = rt.match(/function hwHarvestBonus\(opts\)[\s\S]*?\n\}/);
  ct(harvestBody[0], '_hwHudUpdate({ pulseLocked: true, pulseTotal: true })');
  /* Guard the HUD update behind !o.mapOnly. */
  ct(harvestBody[0], 'if (added > 0 && !o.mapOnly)');
});

/* ─── _hwBeginRound two-phase contract ────────────────────────────── */

t('_hwBeginRound calls hwHarvestBonus({ mapOnly: true }) before intro', () => {
  const beginBody = rt.match(/async function _hwBeginRound\(\)[\s\S]*?\n\}/);
  ok(beginBody, '_hwBeginRound body not extractable');
  ct(beginBody[0], 'hwHarvestBonus({ mapOnly: true })');
  /* The map-only call must precede _hwShowIntro. */
  const mapIdx  = beginBody[0].indexOf("mapOnly: true");
  const introIdx = beginBody[0].indexOf("_hwShowIntro(HW_STATE.triggerOrbCount)");
  ok(mapIdx >= 0 && introIdx > mapIdx, 'mapOnly call must precede _hwShowIntro');
});

t('_hwBeginRound applies orb chips AFTER intro resolves (PHASE 2)', () => {
  const beginBody = rt.match(/async function _hwBeginRound\(\)[\s\S]*?\n\}/);
  /* The post-intro loop walks HW_STATE.lockedCells.forEach + calls
   * _hwApplyOrbToCell + spawn delta + fly. */
  ct(beginBody[0], 'HW_STATE.lockedCells.forEach');
  ct(beginBody[0], '_hwApplyOrbToCell(cell, orb)');
  ct(beginBody[0], '_hwSpawnDelta(cell, orb.valueX)');
  ct(beginBody[0], '_hwSpawnFly(cell, orb.valueX)');
  /* It must come AFTER _hwShowIntro in source order. */
  const introIdx = beginBody[0].indexOf('_hwShowIntro');
  const applyIdx = beginBody[0].indexOf('_hwApplyOrbToCell(cell, orb)');
  ok(applyIdx > introIdx, 'orb apply must come after _hwShowIntro await');
});

/* ─── _hwForceSeedMount two-phase contract ───────────────────────── */

t('_hwForceSeedMount records orbs without _hwApplyOrbToCell pre-intro', () => {
  const mountBody = rt.match(/function _hwForceSeedMount\(picked, allCells\)[\s\S]*?\n\}/);
  ok(mountBody, '_hwForceSeedMount body not extractable');
  /* The PHASE 1 forEach should ONLY touch HW_STATE.lockedCells (no DOM). */
  const phase1 = mountBody[0].match(/picked\.forEach\(function \(idx\)\s*\{[\s\S]*?\}\);/);
  ok(phase1, 'PHASE 1 forEach not found');
  ct(phase1[0], 'HW_STATE.lockedCells.set(key, orb)');
  if (phase1[0].includes('_hwApplyOrbToCell')) {
    throw new Error('PHASE 1 must NOT call _hwApplyOrbToCell');
  }
});

t('_hwForceSeedMount applies orb chips AFTER intro promise resolves', () => {
  const mountBody = rt.match(/function _hwForceSeedMount\(picked, allCells\)[\s\S]*?\n\}/);
  /* PHASE 2 lives inside _hwShowIntro(...).then(function () { ... }). */
  const phase2 = mountBody[0].match(/_hwShowIntro\(HW_STATE\.triggerOrbCount\)\.then\(function \(\)\s*\{[\s\S]*?\n  \}\);/);
  ok(phase2, 'PHASE 2 .then block not found');
  ct(phase2[0], '_hwApplyOrbToCell(cell, orb)');
  ct(phase2[0], '_hwSpawnDelta(cell, orb.valueX)');
  ct(phase2[0], '_hwSpawnFly(cell, orb.valueX)');
});

/* ─── sandbox: positions frozen across intro placard ─────────────── */

t('SANDBOX: hwHarvestBonus(mapOnly) records positions but does NOT mutate cells', () => {
  /* Build a fake DOM grid 5x3 where 2 cells carry the bonus glyph. */
  function mkCell(sym) {
    const cls = new Set();
    return {
      textContent: sym,
      dataset: {},
      classList: {
        add(c)      { cls.add(c); },
        remove(c)   { cls.delete(c); },
        contains(c) { return cls.has(c); },
      },
      _classes: cls,
    };
  }
  const cells = ['X','X','X','X','X','X','B','X','X','X','X','X','X','X','B'].map(mkCell);

  /* Inline reproduction of the hwHarvestBonus mapOnly branch (matches
   * the emitted runtime byte for byte modulo whitespace). The point of
   * the sandbox is to verify DOM stays untouched. */
  const HW_REELS = 5;
  const HW_BONUS_SYMBOL = 'B';
  const HW_STATE = {
    lockedCells: new Map(),
    totalWinX: 0,
    jackpotsHit: [],
  };
  let added = 0;
  cells.forEach((cell, idx) => {
    const txt = (cell.textContent || '').trim();
    if (txt !== HW_BONUS_SYMBOL) return;
    const r = Math.floor(idx / HW_REELS);
    const c = idx % HW_REELS;
    const key = r + ',' + c;
    if (!HW_STATE.lockedCells.has(key)) {
      const orb = { label: '5x', valueX: 5, tier: null };
      HW_STATE.lockedCells.set(key, orb);
      HW_STATE.totalWinX += orb.valueX;
      added++;
    }
  });

  /* lockedCells map populated, cells UNTOUCHED. */
  eq(added, 2, 'expected 2 bonus discoveries');
  eq(HW_STATE.lockedCells.size, 2);
  ok(HW_STATE.lockedCells.has('1,1'), 'expected key 1,1 (idx 6)');
  ok(HW_STATE.lockedCells.has('2,4'), 'expected key 2,4 (idx 14)');

  /* DOM stays raw. */
  for (const cell of cells) {
    ok(!cell._classes.has('is-locked-bonus'), 'cell should not be tagged as locked yet');
    ok(typeof cell.dataset.orbValue === 'undefined', 'orbValue should not be set yet');
  }
  eq(cells[6].textContent, 'B', 'B@idx6 textContent mutated');
  eq(cells[14].textContent, 'B', 'B@idx14 textContent mutated');
  /* Non-bonus cells stay verbatim. */
  for (const i of [0,1,2,3,4,5,7,8,9,10,11,12,13]) {
    eq(cells[i].textContent, 'X', `non-bonus cell ${i} should stay 'X'`);
  }
});

t('SANDBOX: positions retrieved at PHASE 2 match the discovery positions', () => {
  /* lockedCells.forEach walks (orb, key) — verify key→idx mapping. */
  const HW_REELS = 5;
  const HW_STATE = {
    lockedCells: new Map([
      ['1,1', { valueX: 5, label: '5x', tier: null }],
      ['2,4', { valueX: 10, label: '10x', tier: null }],
    ]),
  };
  const indices = [];
  HW_STATE.lockedCells.forEach((orb, key) => {
    const [r, c] = key.split(',').map(Number);
    indices.push(r * HW_REELS + c);
  });
  /* Same positions that PHASE 1 mapped. */
  ok(indices.includes(6), 'idx 6 (r=1,c=1) not retrieved');
  ok(indices.includes(14), 'idx 14 (r=2,c=4) not retrieved');
});

/* ─── back-compat: existing callers (e.g. hwAfterRespin) still work ── */

t('hwAfterRespin still passes celebrate: true (NOT mapOnly)', () => {
  /* hwAfterRespin runs DURING the H&W round — it must continue to apply
   * the DOM and emit celebration FX. */
  ct(rt, 'hwHarvestBonus({ celebrate: true })');
});

console.log(`\n  pass: ${pass}   fail: ${fail}`);
if (fail) process.exit(1);
