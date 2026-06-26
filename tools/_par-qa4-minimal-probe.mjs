#!/usr/bin/env node
/**
 * tools/_par-qa4-minimal-probe.mjs
 *
 * PAR-QA-4 root cause isolation — minimal-config diagnostic.
 *
 * # WHY
 *
 * Real par-sheet models inflate measured RTP 71-980× over declared. Five
 * hypotheses (paytable double-scaling, symbol-id namespace, lightning
 * dispatch with chance=0, wagered double-accumulate, paytable extractor
 * crush). To eliminate per-game variance + extractor bugs, we run the
 * sister kernel with a CRAFTED minimum config where the analytical RTP
 * is fixed at exactly known value.
 *
 * # THE PROBE
 *
 * Config:
 *   - 1 symbol "x" (no wild, no scatter, no bonus)
 *   - 5 reels × 3 rows
 *   - 1 payline [0,0,0,0,0]
 *   - Reel weights: [{x: 10}, {x: 10}, ...] x 5
 *   - Paytable: {x: {pay3: 1, pay4: 1, pay5: 1}}
 *   - total_bet_mc: 1000 (1.0 credit total)
 *
 * Expected analytical RTP:
 *   - Every spin always shows 5×"x" on the single payline
 *   - 5-of-a-kind always hits → pay = 1 credit
 *   - Wagered per spin = 1, won per spin = 1
 *   - RTP = 100 % exactly
 *
 * If sister returns:
 *   - ~100 %  → kernel multiplier semantics are correct; problem is
 *               upstream in PAR-2 extractor or our paytable mapping
 *   - ~paylines × 100 % → factor is paylines (need to divide paytable
 *                          by paylines or pass total_bet_mc differently)
 *   - ~1000 × 100 % → millicredit/credit unit confusion (the pay 1 in
 *                     paytable was treated as 1000 millicredits or
 *                     similar)
 *   - ~rows × 100 % → grid-row over-multiplication
 *   - other → entirely new hypothesis surfaces
 *
 * # NEXT VARIANTS
 *
 * After the 1-sym 1-line probe lands a clean number, we vary ONE knob
 * at a time and watch what scales:
 *   - 1 sym × 20 paylines → does inflation scale with N paylines?
 *   - 2 syms (still 1 line) → does it scale with N symbols?
 *   - Real Cash Eruption topology (5×3 / 8 lines) + paytable from
 *     PAR-2 → does the inflation match the real-game observation?
 */

import {
  resolveHttpBinary,
  spawnHttpServer,
  healthCheckHttp,
  runOnceHttp,
} from './sister-rust-http-client.mjs';

const PROBES = [
  {
    name: '1sym-1line-baseline',
    description: '1 symbol, 1 payline, pay=1. Expected RTP = 100 %.',
    config: minimalConfig({ paylineCount: 1, symbolCount: 1, pay: 1 }),
    expectedRtpPct: 100,
  },
  {
    name: '1sym-8lines',
    description: '1 symbol, 8 paylines (Cash Eruption layout). Expected RTP = 100 % (all lines identical hit, sum = N hits × 1, wager scales = N).',
    config: minimalConfig({ paylineCount: 8, symbolCount: 1, pay: 1 }),
    expectedRtpPct: 100,
  },
  {
    name: '1sym-20lines',
    description: '1 symbol, 20 paylines. Expected RTP = 100 %.',
    config: minimalConfig({ paylineCount: 20, symbolCount: 1, pay: 1 }),
    expectedRtpPct: 100,
  },
  {
    name: '1sym-1line-pay10',
    description: '1 sym, 1 line, pay = 10. Expected RTP = 1000 % (always pays 10 × 1.0 credit).',
    config: minimalConfig({ paylineCount: 1, symbolCount: 1, pay: 10 }),
    expectedRtpPct: 1000,
  },
  {
    name: '1sym-1line-pay250',
    description: '1 sym, 1 line, pay = 250 (Cash Eruption Red7 pay5). Expected RTP = 25 000 %.',
    config: minimalConfig({ paylineCount: 1, symbolCount: 1, pay: 250 }),
    expectedRtpPct: 25000,
  },
  {
    name: '2sym-1line-only-first-pays',
    description: '2 syms a/b weights 5/5 each reel, paytable only "a" pays 1 for 5OAK. p(5×a) = 0.5^5 = 0.03125. Expected RTP ≈ 3.125 %.',
    config: minimalConfig({ paylineCount: 1, symbolCount: 2, pay: 1 }),
    expectedRtpPct: 3.125,
  },
];

function minimalConfig({ paylineCount, symbolCount, pay }) {
  /* Build N symbols 'a', 'b', 'c', ... (only first one pays). */
  const syms = [];
  for (let i = 0; i < symbolCount; i++) {
    syms.push({
      id: String.fromCharCode(97 + i), /* a, b, c, ... */
      name: String.fromCharCode(97 + i),
      is_wild: false,
      is_scatter: false,
      is_bonus: false,
    });
  }
  /* Equal weight on each reel for every symbol. */
  const reels = 5;
  const rows = 3;
  const weightPerSym = 5;
  const baseWeights = [];
  for (let r = 0; r < reels; r++) {
    baseWeights.push(syms.map((s) => ({ symbol: s.id, weight: weightPerSym })));
  }
  /* Paylines: all rows-0 horizontal copies (so for 8 paylines all 8
   * are [0,0,0,0,0]). Sister scoring will hit each one identically;
   * total_bet_mc is split across paylines under PAR-6 semantics
   * (mapper passes paylines × 1000 = total bet). */
  const paylines = [];
  for (let p = 0; p < paylineCount; p++) {
    paylines.push([0, 0, 0, 0, 0]);
  }
  /* Paytable: only first sym pays 'pay' for 3/4/5 OAK.
   * PAR-QA-4 fix B: divide by paylineCount so kernel-side line × pay
   * × total_bet_mc/1000 reproduces the analytical RTP per industry
   * "pay × per-line bet" convention. */
  const paytable = {};
  paytable[syms[0].id] = {
    pay3: pay / paylineCount,
    pay4: pay / paylineCount,
    pay5: pay / paylineCount,
  };

  return {
    name: `probe-${paylineCount}line-${symbolCount}sym-pay${pay}`,
    version: 'par-qa4-minimal',
    target_rtp: 1.0,
    reels,
    rows,
    paylines,
    symbols: syms,
    paytable,
    base_weights: baseWeights,
    fs_weights: baseWeights,
    free_spins: {
      awards: {},
      mult_start: 1,
      mult_increment: 0,
      mult_max: 1,
      retrigger_enabled: false,
      scatter_pays: {},
    },
    hold_and_win: {
      trigger_count: 255, /* unreachable */
      initial_respins: 0,
      respins_on_new_orb: 0,
      full_grid_bonus: 0,
      orb_values: [],
      orb_land_chance_base: 0,
      orb_land_chance_fill_bonus: 0,
    },
    lightning: { trigger_chance: 0, trigger_chance_fs: 0, multipliers: [] },
    max_win_cap: 1_000_000,
    feature_loop_cap: 1,
  };
}

async function main() {
  const sister = resolveHttpBinary();
  if (!sister.available) {
    console.error('Sister bin missing:', sister.reason);
    process.exit(1);
  }
  console.log('▸ spawning sister http_server …');
  const server = await spawnHttpServer({ sister, capSpins: 200_000 });
  console.log(`  bound to ${server.baseUrl}\n`);
  try {
    const h = await healthCheckHttp(server.baseUrl);
    if (!h?.ok) throw new Error('healthz fail');

    const N_SPINS = 100_000;
    console.log(
      `=== PAR-QA-4 minimal probe — ${N_SPINS.toLocaleString()} spinova/probe ===\n`
    );
    console.log(
      '   probe                          paylines tot_bet expRTP%  measRTP%   factor   verdict'
    );
    console.log(
      '   ────────────────────────────── ──────── ──────  ──────  ─────────  ───────  ───────'
    );

    const results = [];
    for (const p of PROBES) {
      /* PAR-QA-4: paytable already normalized by paylines, so total
       * bet is 1 credit (1000 mc) matching sister default. */
      const totalBetMc = 1_000;
      const r = await runOnceHttp(server.baseUrl, p.config, {
        spins: N_SPINS,
        seeds: 1,
        seed: 42,
        totalBetMc,
      });
      /* Sister stats.rs:1070 returns RTP already in PERCENT (won/wagered × 100). */
      const measuredPct = r.ok ? r.rtp : null;
      const factor = measuredPct !== null && p.expectedRtpPct > 0
        ? measuredPct / p.expectedRtpPct
        : null;
      const okFactor = factor !== null && Math.abs(factor - 1.0) < 0.05;
      const verdict = okFactor ? 'PASS' : 'DRIFT';
      const padName = p.name.padEnd(30);
      const padPL = String(p.config.paylines.length).padStart(8);
      const padBet = String(totalBetMc).padStart(6);
      const padExp = p.expectedRtpPct.toFixed(2).padStart(6);
      const padMeas = (measuredPct !== null ? measuredPct.toFixed(2) : 'err').padStart(9);
      const padFactor = (factor !== null ? factor.toFixed(2) + '×' : '—').padStart(7);
      console.log(`   ${padName} ${padPL} ${padBet}  ${padExp}  ${padMeas}  ${padFactor}  ${verdict}`);
      results.push({ probe: p.name, totalBetMc, expected: p.expectedRtpPct, measured: measuredPct, factor, verdict });
    }
    console.log();
    /* Aggregate observation. */
    const drift = results.filter((r) => r.verdict === 'DRIFT');
    if (drift.length === 0) {
      console.log('All probes PASS — sister kernel matches analytical expectation.');
      console.log('Inflation MUST be upstream (PAR-2 extractor / mapper).');
    } else {
      console.log(`${drift.length} probes drift. Factor pattern:`);
      const factors = drift.map((d) => d.factor).filter((f) => f !== null);
      const factorMean = factors.reduce((a, b) => a + b, 0) / factors.length;
      console.log(`  mean factor: ${factorMean.toFixed(3)}× (root cause exposure)`);
      /* Try to fit the factor to a known structural quantity. */
      const hints = [];
      const reels = 5; const rows = 3;
      for (const r of drift) {
        const cfg = PROBES.find((p) => p.name === r.probe).config;
        if (r.factor !== null) {
          const lines = cfg.paylines.length;
          if (Math.abs(r.factor - lines) < 0.5) hints.push(`${r.probe}: factor ≈ paylines (${lines})`);
          if (Math.abs(r.factor - reels) < 0.5) hints.push(`${r.probe}: factor ≈ reels (5)`);
          if (Math.abs(r.factor - rows) < 0.5) hints.push(`${r.probe}: factor ≈ rows (3)`);
          if (Math.abs(r.factor - 1000) < 50) hints.push(`${r.probe}: factor ≈ 1000 (millicredit unit)`);
        }
      }
      if (hints.length > 0) {
        console.log('  pattern hints:');
        hints.forEach((h) => console.log('    -', h));
      }
    }
  } finally {
    await server.dispose().catch(() => {});
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.stack || e);
  process.exit(99);
});
