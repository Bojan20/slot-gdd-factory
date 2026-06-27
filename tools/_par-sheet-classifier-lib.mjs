#!/usr/bin/env node
/**
 * tools/_par-sheet-classifier-lib.mjs
 *
 * PAR-14-I (Boki 2026-06-27) — Pure library extraction of the classifier
 * detection functions, shared by both the standalone CLI
 * (`_par-sheet-classifier.mjs`) and the auto-tune skeleton
 * (`_par-sheet-auto-tune.mjs`), plus the new orchestrator
 * (`par-sheet-pipeline.mjs`).
 *
 * Single-source-of-truth for:
 *
 *   - classifySpecials(model)  → per-special effective role + rationale
 *   - detectMechanics(model)   → free_spins / hold_and_win / bonus_buy
 *                                 / wild_expand / mystery_reveal
 *                                 / coin_boost / special_reel_set
 *
 * The CLI keeps wrapping these for human / JSON output. Auto-tune reads
 * `detectMechanics()` directly to know which axes apply per slug
 * (eliminating duplicated `/skeleton|fortune.?coin/i.test(slug)` regex
 * across files — drift risk).
 *
 * NO CLI EXPORTS — only pure functions. Importable from anywhere.
 */

/**
 * Classify each special symbol — promote based on name + paytable
 * membership + reel weight density.
 *
 * @param {object} model  par-sheet ingested model.json
 * @returns {Array<{
 *   id: string, label: string, declared_role: string,
 *   effective_role: 'wild'|'scatter'|'bonus'|'cash'|'anchor'|'lp',
 *   in_paytable: boolean, total_weight: number,
 *   avg_density_pct: number, rationale: string
 * }>}
 */
export function classifySpecials(model) {
  const specials = model.symbols?.specials || [];
  const paytableIds = new Set((model.paytable || []).map((r) => r.symbolId));
  const reelWeights = model.par_sheet?.reelStrips || [];
  const totalPerReel = reelWeights.map((reel) =>
    reel.reduce((s, e) => s + (e.weight || 0), 0));

  return specials.map((s) => {
    const weightPerReel = reelWeights.map((reel) => {
      const e = reel.find((x) => String(x.symbol || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) === s.id);
      return e?.weight || 0;
    });
    const totalWeight = weightPerReel.reduce((a, b) => a + b, 0);
    const avgDensity = totalPerReel.length > 0
      ? weightPerReel.map((w, i) => totalPerReel[i] > 0 ? w / totalPerReel[i] : 0)
        .reduce((a, b) => a + b, 0) / totalPerReel.length
      : 0;
    const inPaytable = paytableIds.has(s.id);
    const name = String(s.label || s.id || '').toLowerCase();

    let effective = s.role;
    const rationale = [];

    if (/wild/.test(name)) {
      effective = 'wild';
      rationale.push('name matches /wild/');
    } else if (/scatter|book/.test(name) && !inPaytable) {
      effective = 'scatter';
      rationale.push('name matches /scatter|book/ + no paytable');
    } else if (/bonus/.test(name) && !inPaytable) {
      effective = 'bonus';
      rationale.push('name matches /bonus/ + no paytable');
    } else if (!inPaytable) {
      if (avgDensity >= 0.05) {
        effective = 'cash';
        rationale.push(`no paytable + density ${(avgDensity * 100).toFixed(1)}% (frequent → HnW trigger candidate)`);
      } else {
        effective = 'anchor';
        rationale.push(`no paytable + density ${(avgDensity * 100).toFixed(1)}% (rare → pattern anchor)`);
      }
    } else {
      effective = 'lp';
      rationale.push('paytable entry present (regular paying)');
    }

    return {
      id: s.id,
      label: s.label,
      declared_role: s.role,
      effective_role: effective,
      in_paytable: inPaytable,
      total_weight: totalWeight,
      avg_density_pct: Math.round(avgDensity * 10000) / 100,
      rationale: rationale.join('; '),
    };
  });
}

/**
 * Detect feature mechanics from model + slug name patterns.
 *
 * Each mechanic carries a `detected: boolean` plus diagnostic fields
 * downstream tools use. Auto-tune reads these flags to gate which
 * scaling axes get sweeped.
 *
 * @param {object} model  par-sheet ingested model.json
 * @returns {object}      per-mechanic detection record
 */
export function detectMechanics(model) {
  const slug = (model.slug || model.id || '').toLowerCase();
  const components = model.payback?.components || {};
  const par_sheet = model.par_sheet || {};
  const specials = model.symbols?.specials || [];

  return {
    free_spins: {
      detected: Number.isFinite(components.freeSpins) && components.freeSpins >= 1.0,
      declared_rtp_pct: components.freeSpins ?? null,
      explicit_awards: !!par_sheet.freeSpinAwards,
      awards_table: par_sheet.freeSpinAwards ?? null,
      scatter_pays_extracted: !!par_sheet.freeSpinAvgPays,
    },
    hold_and_win: {
      detected: Number.isFinite(components.holdAndWin) && components.holdAndWin >= 1.0,
      declared_rtp_pct: components.holdAndWin ?? null,
      orb_table_extracted: !!par_sheet.hnwOrbValues,
      orb_tier_count: par_sheet.hnwOrbValues?.length ?? 0,
    },
    bonus_buy: {
      detected: /bonus[\s_-]?buy/i.test(slug),
      slug_match: /bonus[\s_-]?buy/i.test(slug) ? slug : null,
      declared_bonus_rtp_pct: components.bonus ?? null,
    },
    wild_expand: {
      /* Heuristic: slug contains "fortune coin" or matches "skeleton" AND
       * has Wild specials but no separate explicit Wild Expand hook. */
      detected: /skeleton|fortune.?coin/i.test(slug)
        && specials.some((s) => s.role === 'wild'),
      slug_match: slug,
    },
    mystery_reveal: {
      detected: specials.some((s) => /mystery|reveal/i.test(s.label || '')),
      symbols: specials.filter((s) => /mystery|reveal/i.test(s.label || '')).map((s) => s.id),
    },
    coin_boost: {
      detected: /coin.?boost/i.test(slug)
        && Array.isArray(par_sheet.coinBoostMultipliers)
        && par_sheet.coinBoostMultipliers.length > 0,
      slug_match: slug,
      multipliers: par_sheet.coinBoostMultipliers ?? null,
    },
    special_reel_set: {
      /* Either slug is skeleton-key (well-known) OR par_sheet has a
       * specialReelSets table extracted from the FS Reel Set block. */
      detected: /skeleton/i.test(slug)
        || (Array.isArray(par_sheet.specialReelSets)
          && par_sheet.specialReelSets.length > 0),
      slug_match: slug,
      set_count: par_sheet.specialReelSets?.length ?? 0,
    },
  };
}
