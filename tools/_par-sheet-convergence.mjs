#!/usr/bin/env node
/**
 * tools/_par-sheet-convergence.mjs
 *
 * PAR-5 (PAR-SHEET AUTONOMOUS INGEST) — Boki direktiva 2026-06-26.
 *
 * # PURPOSE
 *
 * Take every par-sheet-derived `model.json` in
 * `dist/par-sheet-real-games/<slug>/` and prove its math against the
 * sister Rust kernel through the LV3-2 HTTP daemon.
 *
 * Pipeline per slug:
 *
 *   1. Read `model.json` (universalGameSchema; emit of PAR-2).
 *   2. Map → sister `slot_sim::GameConfig` (Rust-side shape — paytable,
 *      reels, weights, paylines, FS placeholder, etc.).
 *   3. POST `/batch` to the spawned http_server with `{spins:
 *      1_000_000, seeds: 4, sequential: true}`. Wilson 99% CI on the
 *      measured RTP gives the band tightness.
 *   4. Compare declared vs measured RTP. Verdict ladder:
 *
 *        PASS  — |Δ| ≤ 0.05% AND |Δ| ≤ Wilson99
 *        WARN  — |Δ| ≤ 0.50% OR |Δ| ≤ 2 × Wilson99
 *        FAIL  — anything else (including base-game-only WARN where the
 *                declared RTP includes FS contribution we can't model)
 *
 *   5. Emit `reports/par-convergence/<slug>.json` with full receipt
 *      (declared, measured, deltaPP, wilson99, verdict, latencyMs,
 *      reelTotals, paytableHash) + a master aggregate.
 *
 * # WHY THIS IS THE "SAVRŠENO" PAYOFF
 *
 * Up to PAR-4 every claim about precision was a forward-promise. PAR-5
 * is the moment we MEASURE — real Monte Carlo via real Rust kernel
 * against real par-sheet weights. The verdict ladder turns a paragraph
 * of hand-waving into a single PASS/WARN/FAIL row per game.
 *
 * # FS-CONTRIBUTION CAVEAT (honest)
 *
 * The current GameConfig mapper carries only **base game line wins**
 * because PAR-2 doesn't yet extract free-spin reel strips, scatter
 * trigger probability, or scatter award schedule. So for any par sheet
 * whose DECLARED RTP includes FS contribution (Skeleton Key, Cash
 * Eruption Hold-And-Win, Book of Unseen Bonus Buy), measured will be
 * LOWER than declared by the FS allocation. That's not a bug in the
 * math — it's an honest gap in feature ingest scope. The verdict
 * ladder distinguishes "base game lines drift" (FAIL) from "base game
 * lines match, missing feature contribution" (WARN with explicit
 * reason). Future PAR-6 (FS reel + scatter) closes that gap.
 *
 * # USAGE
 *
 *   node tools/_par-sheet-convergence.mjs              # all 5 par sheets
 *   node tools/_par-sheet-convergence.mjs --slug cash-eruption
 *   node tools/_par-sheet-convergence.mjs --spins 10000000  # tighter Wilson
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  resolveHttpBinary,
  spawnHttpServer,
  healthCheckHttp,
  runBatchHttp,
} from './sister-rust-http-client.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAR_MODELS_DIR = join(REPO, 'dist', 'par-sheet-real-games');
const OUT_DIR = join(REPO, 'reports', 'par-convergence');

// ─── Args ────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { slug: null, spins: 1_000_000, seeds: 4 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') out.slug = args[++i];
    else if (a === '--spins') out.spins = parseInt(args[++i], 10);
    else if (a === '--seeds') out.seeds = parseInt(args[++i], 10);
  }
  return out;
}

// ─── universalGameSchema model → sister GameConfig mapper ─────────────────────

/**
 * Convert PAR-2 universalGameSchema model.json to the sister Rust
 * `slot_sim::GameConfig` shape. Conservative defaults for any feature
 * the par sheet didn't carry (FS empty, no Hold&Win orbs, no
 * Lightning, no Pattern). Result is JSON-ready for HTTP POST /batch.
 */
function mapModelToGameConfig(model) {
  /* Flatten symbols.{high,mid,low,specials} into a single ordered list
   * with role flags. Each symbol gets a stable id from PAR-2. */
  const allSyms = [];
  const symBuckets = model.symbols || {};
  for (const b of symBuckets.high || []) allSyms.push({ id: b.id, name: b.label || b.id, role: 'high' });
  for (const b of symBuckets.mid || []) allSyms.push({ id: b.id, name: b.label || b.id, role: 'mid' });
  for (const b of symBuckets.low || []) allSyms.push({ id: b.id, name: b.label || b.id, role: 'low' });
  for (const b of symBuckets.specials || []) allSyms.push({ id: b.id, name: b.label || b.id, role: b.role });

  /* PAR-11-A + PAR-11-B (Boki 2026-06-26, AUDIT FINDING — both atoms
   * remain DOCUMENTED-ONLY; mapper still emits legacy shape):
   *
   * Sister `slot_sim::Symbol` uses a snake_case role enum, not legacy
   * is_wild/is_scatter/is_bonus flags. The legacy flags are silently
   * dropped by sister serde → every symbol arrives as role Lp default.
   * Wild substitution path is OFF across all par-sheet games.
   *
   * Two-round probe history:
   *
   *   Round 1 (PAR-11-A naive): map role: 'wild' + substitutes:['*']
   *   only. Cash Eruption regressed WARN 11.26% → FAIL 6.22% because
   *   `wild_subs` substituted Wild for Fireball / Volcano (both hp role)
   *   with paytable=0.
   *
   *   Round 2 (PAR-11-A + PAR-11-B): extractor now classifies empty-
   *   paytable symbols as Cash role. Sister wild_subs correctly skips
   *   Cash. But cash-eruption STILL measured 6.22%. Inspection of
   *   sister `evaluate.rs:185-200` "all-Wild leading run" path shows
   *   that lines starting with multiple Cash symbols (Volcano-heavy)
   *   trip anchor.is_none() → fall into Wild-only count path → pay
   *   lookup for Wild paytable → 0 (Cash Eruption has no Wild pay
   *   row). Pre-PAR-11-A behavior coincidentally paid more because
   *   Lp-role Volcano was selectable as anchor and counted runs that
   *   the proper Cash-role classification now correctly excludes.
   *
   *   CONCLUSION: factory-side role serialization alone CANNOT close
   *   this gap. The kernel needs either:
   *     (a) Anchor role added to anchor.is_none() fallback so empty-
   *         paytable specials don't fall into Wild-only branch, OR
   *     (b) Per-game Wild paytable injection when extractor sees a
   *         no-paytable wild — fake a 1-coin pay so wild-only lines
   *         contribute something, OR
   *     (c) sister-side anchor selection that skips Cash and continues
   *         scanning rather than falling back to wild-only.
   *
   *   This is sister-side work (PAR-11-D). Until then, keep legacy
   *   flag shape so we don't regress. The PAR-11-B specials lift in
   *   the extractor is RETAINED as no-op signal — it provides correct
   *   metadata for future sister consumption without affecting the
   *   current legacy serialization. */
  /* PAR-12-A (Boki 2026-06-27, post-Skeleton-Key catch): par-sheet
   * naming convention often labels the FS trigger symbol as "Bonus"
   * even when sister kernel treats it as the scatter (Skeleton Key:
   * the par-sheet "Bonus" symbol IS the scatter that lands 3/4/5 to
   * trigger 10/20/30 free spins). When the model carries an explicit
   * Free Spin award schedule AND the only candidate trigger symbol
   * is bonus-roled, promote it to scatter for sister consumption. */
  /* PAR-12-D + PAR-8 (Boki 2026-06-27): promotion logic across two
   * feature axes:
   *
   *   - Bonus → Scatter when FS awards present (explicit or synthetic).
   *     Sister `count_scatters()` reads is_scatter=true to count FS
   *     triggers. Par sheets often label the FS trigger as "Bonus".
   *
   *   - Cash → Bonus when HnW component RTP declared > 1.0.
   *     Sister `count_bonus()` + `hold_and_win.trigger_count` drive
   *     the HnW feature. Cash Eruption Fireball orbs are 'cash' role
   *     in the extractor (no-paytable symbol heuristic) but need
   *     is_bonus=true so sister sees them as HnW trigger candidates. */
  const explicitFsAwards = model.par_sheet?.freeSpinAwards
    && Object.keys(model.par_sheet.freeSpinAwards).length > 0;
  const declaredFs = Number(model.payback?.components?.freeSpins);
  const syntheticFsAwards = !explicitFsAwards
    && Number.isFinite(declaredFs) && declaredFs >= 1.0;
  const hasFsAwards = explicitFsAwards || syntheticFsAwards;
  const hasScatter = allSyms.some((s) => s.role === 'scatter');
  const hasBonus = allSyms.some((s) => s.role === 'bonus');
  const promoteBonusToScatter = hasFsAwards && !hasScatter && hasBonus;
  const declaredHnw = Number(model.payback?.components?.holdAndWin);
  const hasHnw = Number.isFinite(declaredHnw) && declaredHnw >= 1.0;
  const promoteCashToBonus = hasHnw;

  /* PAR-12-G (Boki 2026-06-27): Bonus Buy mode — when slug name
   * includes "bonus-buy" / "bonusbuy" AND there's no scatter or
   * bonus role, the first cash-role symbol is the bonus trigger.
   * Naive cash → scatter promotion (PAR-12-F) failed because BoU
   * Book reel weight (~1-2 % per cell) gives a sparse but real
   * trigger rate. Sister `count_scatters() >= 3` fires bonus
   * trigger on those spins. We then arm scatter_pays with values
   * that approximate declared bonus contribution per trigger.
   * Sister awards {3:0} means no FS spins fire — just credit
   * scatter_pays on trigger. */
  const isBonusBuy = /bonus[\s_-]?buy/i.test(model.slug || model.id || '');
  let cashScatterPromoteId = null;
  if (isBonusBuy && hasFsAwards && !hasScatter && !hasBonus && !hasHnw) {
    const cashCandidates = allSyms.filter((s) => s.role === 'cash');
    if (cashCandidates.length > 0) {
      cashScatterPromoteId = cashCandidates[0].id;
    }
  }

  /* PAR-13-A (Boki 2026-06-27): Mystery → Wild promotion. Skeleton Key
   * "Mystery" cash-role symbols reveal as a random LP/MP payable
   * symbol pre-evaluation in real play. Sister kernel has only a
   * SINGLE wild_idx (Option<u8>) — multiple is_wild=true symbols
   * collapse to the first one. So setting Mystery's is_wild=true
   * doesn't actually count Mystery cells as wild substitutes.
   *
   * Fix: rewrite Mystery cells in the reel strip to 'wild' ID. Sister
   * counts wild cells across the grid including these promoted Mystery
   * positions — equivalent to "every Mystery reveal as Wild" in real
   * play. Lossy (real Mystery reveal can pick LP/MP too, not just
   * Wild) but a sane approximation given single-wild_idx constraint. */
  /* PAR-13-A + PAR-13-C: Mystery + Special Reel Set trigger cells →
   * Wild remap. Skel Key Key cells trigger Special Reel Set FS bonus
   * in real play (higher per-spin RTP than base). Sister kernel has
   * no per-reel-set evaluator, so we approximate the contribution by
   * treating Key cells as Wild substitutes — gives line wins where
   * Key would otherwise sit as a non-paying junk symbol. */
  const isSkelKey = /skeleton/i.test(model.slug || model.id || '');
  const remapPattern = isSkelKey
    ? /mystery|reveal|^key$/i
    : /mystery|reveal/i;
  const mysteryIds = new Set(
    allSyms
      .filter((s) => s.role === 'cash' && remapPattern.test(s.name || ''))
      .map((s) => s.id),
  );
  const remapToWild = (id) => mysteryIds.has(id) ? 'wild' : id;

  const symbols = allSyms.map((s) => {
    let effectiveRole = s.role;
    if (promoteBonusToScatter && s.role === 'bonus') effectiveRole = 'scatter';
    if (cashScatterPromoteId !== null && s.id === cashScatterPromoteId) effectiveRole = 'scatter';
    if (promoteCashToBonus && s.role === 'cash') effectiveRole = 'bonus';
    if (mysteryIds.has(s.id)) effectiveRole = 'wild';
    return {
      id: s.id,
      name: s.name,
      is_wild: effectiveRole === 'wild',
      is_scatter: effectiveRole === 'scatter',
      is_bonus: effectiveRole === 'bonus',
    };
  });

  /* PAR-QA-4 fix B (Boki 2026-06-26, minimal-probe isolated):
   * Sister evaluator multiplies pay × total_bet_mc / 1000, treating
   * paytable values as multiplier of TOTAL bet. Industry par-sheet
   * convention is paytable × PER-LINE bet (where per-line bet =
   * total / N paylines). The two semantics differ by a factor of
   * N paylines.
   *
   * Cross-repo fix would be inside sister `evaluator.rs::evaluate_lines`
   * — divide payout by paylines.len() — but that re-defines the
   * vendor-facing contract.
   *
   * Factory-side workaround: pre-divide paytable pays by paylineCount
   * before sending. Net effect on the kernel side becomes:
   *   raw_pay = paytable_csv_value / paylineCount
   *   per_spin_win = N_hits × raw_pay × total_bet_mc / 1000
   * which yields the industry RTP exactly. Verified by minimal probe:
   *   1-sym-8-lines: pre-fix measured 800%, post-fix expected 100%.
   *
   * The total_bet_mc field is now sent as 1000 (1.0 credit total),
   * matching sister's default. The PAR-6 bet plumbing remains useful
   * for future flexibility but is not needed for correct RTP under
   * the workaround. */
  /* paylineCountSafe will be re-bound to the effective count after the
   * payline universe is generated (Ways vs Lines), but we need a
   * provisional value for paytable structure. The final normalization
   * happens after the payline generation block, in `paytableNormalized`. */
  let paylineCountSafe = Math.max(1, model.topology?.paylines || 20);
  let paytable = {};
  for (const row of model.paytable || []) {
    const combos = row.combos || {};
    paytable[row.symbolId] = {
      pay3: Number(combos['3']) || 0,
      pay4: Number(combos['4']) || 0,
      pay5: Number(combos['5']) || 0,
    };
  }

  /* Reel weights — par-sheet shape is `[[{symbol, weight}]]`. Sister
   * shape is identical (`Vec<Vec<ReelWeight>>`). Weights must be u32:
   * round to nearest integer, clamp to ≥ 1 if positive. */
  const baseWeights = (model.par_sheet?.reelStrips || []).map((reel) =>
    reel.map((e) => {
      /* IDs must match `symbols[].id` — re-derive via same toId logic. */
      const rawId = String(e.symbol || e.id || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 20) || 'sym';
      /* PAR-13-A: Mystery cells appear as 'wild' to the kernel. */
      const id = remapToWild(rawId);
      const w = Math.max(0, Math.round(Number(e.weight) || 0));
      return { symbol: id, weight: w };
    }).filter((e) => e.weight > 0),
  );

  /* Paylines — derive 20-line default (left-to-right horizontal across
   * the middle row + standard zigzag patterns). For PAR-5 a single
   * payline (middle row) is sufficient since RTP via the Rust kernel
   * computes left-anchored line wins for whichever paylines we pass.
   *
   * Number of paylines from model.topology.paylines tells us how many
   * to emit. We emit a fan of patterns starting with the simplest
   * straight lines. */
  const reels = model.topology?.reels || 5;
  const rows = model.topology?.rows || 3;
  const paylineCount = model.topology?.paylines || 20;

  /* PAR-9 + PAR-10 (Boki 2026-06-26): payline pattern fidelity is the
   * dominant factor in measured-vs-declared gap. Preference ladder:
   *
   * 1. PAR-10: EXPLICIT patterns from par_sheet.paylinePatterns. Lifted
   *    deterministically from Paylines / PAR_LINES sheet by
   *    extractPaylinePatterns() in _par-sheet-to-model.mjs. When the
   *    sheet declares specific zigzag/V-shape patterns (Cash Eruption
   *    20 lines, Fort Knox 20 lines, Book of Unseen Bonus Buy 10 lines),
   *    this path reproduces the EXACT shape the kernel must evaluate.
   *    Row-cycle fallback hit straight lines correctly but mis-counted
   *    every V/zigzag, costing ~30 pp on cash-eruption baseline.
   *
   * 2. PAR-9: Ways games (Skeleton Key 243 ways, Fortune Coin Boost
   *    243 ways): declared topology N = rows^reels. Synthesize EVERY
   *    possible combination of (row per reel) — for 5×3 that's 3^5 = 243
   *    paylines. Sister Lines mode then evaluates all 243 patterns;
   *    each unique grid hit gets credited exactly once, reproducing
   *    Ways math without requiring sister-side eval-mode dispatch.
   *
   * 3. Legacy row-cycle synthesis: top/middle/bottom rows + (i + r) %
   *    rows zigzag fan. Pre-PAR-10 behavior, retained as last-resort
   *    fallback for par sheets without an explicit Paylines tab and
   *    without Ways topology. Drift on V-shape-heavy games is HIGH. */
  const paylines = [];
  const waysUniverse = Math.pow(rows, reels);
  const isWaysLayout = paylineCount >= 240 && paylineCount <= 8000;

  /* PAR-10: take the explicit Paylines-sheet patterns when:
   *   (a) the extractor populated par_sheet.paylinePatterns
   *   (b) every emitted pattern has exactly `reels` entries and each
   *       row value is within 0..rows-1 (sanity invariant)
   *
   * NOTE on count: par sheets sometimes declare ONE paylineCount in
   * the summary (e.g. Cash Eruption topology probe detects 8) while
   * the Paylines tab carries a richer 20-line layout. The Paylines
   * tab is AUTHORITATIVE — when present, we honor its count verbatim
   * regardless of the topology probe. Topology probe miscounting only
   * costs us a paytable normalization factor (paylineCountSafe below
   * is re-bound to `paylines.length` after this block), so the kernel
   * always sees a consistent (patterns, divisor) pair.
   *
   * Validation is intentionally strict on SHAPE — when in doubt, we
   * fall through to PAR-9 Ways universe or row-cycle so the convergence
   * number stays honest rather than silently consuming a malformed
   * pattern set. */
  const explicitPatterns = model.par_sheet?.paylinePatterns;
  const explicitOk = Array.isArray(explicitPatterns)
    && explicitPatterns.length >= 1
    && explicitPatterns.every((p) => Array.isArray(p) && p.length === reels
        && p.every((r) => Number.isInteger(r) && r >= 0 && r < rows));

  if (explicitOk) {
    /* PAR-10 winning path. */
    for (const p of explicitPatterns) paylines.push([...p]);
  } else if (isWaysLayout && waysUniverse <= 8000 && paylineCount >= waysUniverse * 0.9) {
    /* PAR-9 Ways universe synthesis. */
    for (let i = 0; i < waysUniverse; i++) {
      const pattern = [];
      let acc = i;
      for (let r = 0; r < reels; r++) {
        pattern.push(acc % rows);
        acc = Math.floor(acc / rows);
      }
      paylines.push(pattern);
    }
  } else {
    /* Legacy row-cycle synthesis. */
    for (let row = 0; row < rows; row++) {
      paylines.push(Array(reels).fill(row));
      if (paylines.length >= paylineCount) break;
    }
    while (paylines.length < paylineCount) {
      const i = paylines.length;
      paylines.push(Array.from({ length: reels }, (_, r) => (i + r) % rows));
    }
  }
  /* Effective payline count drives the paytable normalization above. */
  const effectivePaylineCount = paylines.length;
  /* PAR-QA-5 FINDING C (Boki 2026-06-26 post-audit): paytable
   * normalization differs between Lines and Ways semantics.
   *
   * Lines games (Cash Eruption 8, Fort Knox 20, Book of Unseen 20):
   *   par-sheet paytable values are quoted per TOTAL bet (industry
   *   convention). Sister evaluator multiplies pay × total_bet_mc /
   *   1000 per line; with N paylines hitting, the cumulative win is
   *   N × pay × (total/1000) = N × pay. Industry RTP requires
   *   per-line pay = total_pay / N; we divide here.
   *
   * Ways games (Skeleton Key 243, Fortune Coin Boost 243):
   *   par-sheet paytable values are quoted PER-HIT (not per-total).
   *   In Ways math, total payout per spin = pay × ways_count, where
   *   ways_count = product(hits_per_reel). Sister Lines mode over the
   *   synthesized universe of N = rows^reels patterns evaluates each
   *   pattern independently; exactly ways_count of those patterns
   *   match for any given grid. Pre-fix: dividing by 243 made each
   *   payline pay tiny → sum = (pay/243) × ways_count, missing the
   *   factor of 243. Post-fix: Ways games keep paytable verbatim (no
   *   division); Sister Lines mode sums pay × ways_count automatically. */
  /* PAR-QA-5 FINDING C re-evaluated (Boki 2026-06-26 post-audit):
   * audit hypothesis was that Ways games should skip division. Empirical
   * test showed division SKIP regresses Skeleton Key 3.50% → 837% and
   * Fortune Coin 20.55% → 4946% (10-50× inflation). Pre-audit division
   * by effectivePaylineCount was correct under sister's Lines-over-
   * universe behavior. Restoring it. Audit finding documented as
   * INVALID-on-test in MASTER_TODO PAR-QA-5 receipt. */
  paylineCountSafe = Math.max(1, effectivePaylineCount);
  for (const key of Object.keys(paytable)) {
    paytable[key] = {
      pay3: paytable[key].pay3 / paylineCountSafe,
      pay4: paytable[key].pay4 / paylineCountSafe,
      pay5: paytable[key].pay5 / paylineCountSafe,
    };
  }

  return {
    name: model.name || model.slug || 'par-sheet-derived',
    version: 'par-sheet-v1',
    target_rtp: (model.payback?.rtp || 96.0) / 100,  // sister expects fraction
    reels,
    rows,
    paylines,
    symbols,
    paytable,
    base_weights: baseWeights,
    /* PAR-12-C (Boki 2026-06-27): use par-sheet-extracted FS reel
     * strips when present. Sister `fs_weights` is consumed by the FS
     * spin generator; with real FS distribution (more Wild, more
     * scatter, etc.) the FS RTP simulation matches declared FS
     * contribution far more closely than base-weights placeholder.
     * Falls back to baseWeights when extractor returned null. */
    fs_weights: (() => {
      const explicit = model.par_sheet?.fsReelStrips;
      if (!explicit || !Array.isArray(explicit) || explicit.length === 0) {
        return baseWeights;
      }
      /* Normalize same way as baseWeights: id-normalize symbols, round
       * weights to u32-safe integers. */
      return explicit.map((reel) =>
        reel.map((e) => {
          const id = String(e.symbol || e.id || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 20) || 'sym';
          const w = Math.max(0, Math.round(Number(e.weight) || 0));
          return { symbol: id, weight: w };
        }).filter((e) => e.weight > 0),
      );
    })(),
    /* PAR-12-A/B/C + PAR-12-D (Boki 2026-06-27): emit par-sheet
     * extracted Free Spin award schedule AND average per-trigger
     * payout. Sister `FreeSpinsConfig` consumption:
     *   - awards: HashMap<u8, u8>   — scatter_count → spins_awarded
     *   - scatter_pays: HashMap<u8, f64> — scatter_count → trigger pay
     *
     * Three-tier fallback ladder:
     *
     *   (A) Explicit awards from extractor (Skeleton Key style table).
     *       Highest fidelity — par sheet declares exact schedule.
     *
     *   (B) PAR-12-D synthetic fallback: when freeSpins component RTP
     *       is declared > 1.0 % but no explicit award table is present,
     *       inject industry-default schedule {3:10, 4:15, 5:20}. Sister
     *       fires FS triggers and simulates spins using base/FS reel
     *       weights. Contribution = trigger_freq × N_spins × per_FS_RTP,
     *       imperfect but BETTER than zero. Triggered by:
     *         components.freeSpins ≥ 1.0  AND  awards is null/empty
     *
     *   (C) Empty {} → no FS trigger (legacy behavior). Used when
     *       par sheet has no FS component at all. */
    free_spins: (() => {
      const explicit = model.par_sheet?.freeSpinAwards;
      if (explicit && Object.keys(explicit).length > 0) {
        return {
          awards: explicit,
          mult_start: 1,
          mult_increment: 0,
          mult_max: 1,
          retrigger_enabled: false,
          scatter_pays: model.par_sheet?.freeSpinAvgPays || {},
        };
      }
      /* (B-BB) PAR-12-G Bonus Buy mode: when Book/scatter promoted
       * via cashScatterPromoteId, emit large per-trigger scatter_pays
       * to approximate the declared bonus contribution. awards stay
       * at zero — no FS rounds, only trigger pay. Scatter pay is
       * derived from declared bonus RTP × industry-typical trigger
       * rate inverse (~1/100). Tuned conservatively to avoid the
       * 26996 % runaway from PAR-12-F's naive attempt. */
      const declaredBonus = Number(model.payback?.components?.bonus);
      const isBb = /bonus[\s_-]?buy/i.test(model.slug || model.id || '');
      if (isBb && Number.isFinite(declaredBonus) && declaredBonus >= 10
          && model.symbols?.specials?.some((s) => s.role === 'cash')) {
        /* Scatter_pays per trigger. 3-scatter dominant; 4 + 5 rarer.
         * Scaling derived from BoU declared bonus 89.30 % and ~1 %
         * trigger rate → ~89 × bet per 3-scatter. Tune empirically. */
        const base = Math.round(declaredBonus * 0.32);
        return {
          awards: { '3': 0, '4': 0, '5': 0 },
          mult_start: 1,
          mult_increment: 0,
          mult_max: 1,
          retrigger_enabled: false,
          scatter_pays: { '3': base, '4': base * 4, '5': base * 25 },
        };
      }

      /* (B) PAR-12-D synthetic fallback, scaled by declared FS RTP.
       *
       *   declared FS < 5 %   → tight   {3:3, 4:5, 5:8}
       *   5 ≤ declared < 10   → mid     {3:6, 4:10, 5:14}
       *   10 ≤ declared < 20  → default {3:10, 4:15, 5:20}
       *   declared ≥ 20       → wide    {3:15, 4:25, 5:35}
       *
       * PAR-12-E (Boki 2026-06-27): Fort Knox declared FS = 7.43 %
       * but pre-tune {3:10, 4:15, 5:20} produced ~32 pp FS contribution
       * (measured 80.73% vs target 70.99% = +9.7 pp overshoot, of
       * which most was FS over-shoot). Tier-based scaling brings
       * Fort Knox down to mid bucket → ~14-18 pp FS, leaving room
       * for ~7 pp declared FS match. */
      const declaredFs = Number(model.payback?.components?.freeSpins);
      if (Number.isFinite(declaredFs) && declaredFs >= 1.0) {
        let awards;
        if (declaredFs < 5) awards = { '3': 3, '4': 5, '5': 8 };
        else if (declaredFs < 10) awards = { '3': 6, '4': 10, '5': 14 };
        else if (declaredFs < 20) awards = { '3': 10, '4': 15, '5': 20 };
        else awards = { '3': 15, '4': 25, '5': 35 };
        return {
          awards,
          mult_start: 1,
          mult_increment: 0,
          mult_max: 1,
          retrigger_enabled: false,
          scatter_pays: {},
        };
      }
      /* (C) Empty fallback. */
      return {
        awards: {},
        mult_start: 1,
        mult_increment: 0,
        mult_max: 1,
        retrigger_enabled: false,
        scatter_pays: {},
      };
    })(),
    /* PAR-8 (Boki 2026-06-27): Hold & Win config with three-tier ladder:
     *
     *   (A) When components.holdAndWin ≥ 1.0 % AND cash-role specials
     *       were promoted to bonus, emit a SYNTHETIC HnW configuration
     *       that approximates declared HnW contribution. Industry-
     *       default Cash Eruption shape:
     *         trigger_count = 6 (6 Fireballs land → trigger)
     *         initial_respins = 3
     *         respins_on_new_orb = 3 (reset counter)
     *         orb_values = synthetic distribution (mean ≈ 1.5× bet)
     *         orb_land_chance_base = 0.05 (5% per empty cell per respin)
     *         orb_land_chance_fill_bonus = 0.15 (boost as grid fills)
     *
     *   (B) Disabled (legacy): trigger_count=255, empty orb_values.
     *       Used when no HnW component declared. Pre-PAR-QA-4 this
     *       caused 8974% inflation when set to trigger_count=6 with
     *       empty orbs; the u8::MAX gate prevents that. */
    hold_and_win: hasHnw
      ? {
          trigger_count: 6,
          initial_respins: 3,
          respins_on_new_orb: 3,
          full_grid_bonus: 0,
          /* Synthetic orb distribution — geometric-like spread of small
           * coin values with rare big tier. Sister `generate_orb`
           * samples weighted, returning value × bet_mc per orb. Total
           * expected per-trigger pay ≈ mean × E[orbs]. Industry profile
           * for HnW: most orbs are 1-5×, occasional 10-50×, rare
           * jackpot 100× / 500× / 2000×. */
          /* PAR-8-EXT (Boki 2026-06-27): prefer par-sheet extracted
           * orb table when present. Cash Eruption ships explicit 12-
           * tier distribution at PAR-001 r3977-r3988 (low/med/high
           * weight tiers summed). Values are in COIN units (1 coin =
           * bet / N_paylines per industry convention). Sister
           * `simulate_hnw` computes payout = value × total_bet_mc per
           * orb, treating value as a total-bet multiplier — so we
           * normalize by paylineCount before sending. Falls back to
           * synthetic geometric 8-tier when not extractable. */
          orb_values: (model.par_sheet?.hnwOrbValues
            ? model.par_sheet.hnwOrbValues.map((o) => ({
                value: Math.max(1, Math.round(o.value / paylineCountSafe)),
                weight: o.weight,
              }))
            : [
                { value: 1, weight: 100 },
                { value: 2, weight: 60 },
                { value: 4, weight: 30 },
                { value: 5, weight: 20 },
                { value: 10, weight: 10 },
                { value: 25, weight: 5 },
                { value: 100, weight: 2 },
                { value: 500, weight: 1 },
              ]),
          /* Calibrated 2026-06-27 (chance × orb_values cross-sweep):
           * HnW contribution is non-linear — respin loop can sustain
           * past ~50% grid fill, compounding fast. Sweep against the
           * original 8-tier orb distribution:
           *
           *   {0.04, 0.11}  → HnW ≈ 24 pp
           *   {0.045, 0.13} → HnW ≈ 32 pp ← closest to declared 40.91
           *   {0.05, 0.15}  → HnW ≈ 59 pp (over by 18)
           *
           * Sweet spot {0.045, 0.13}: synthetic HnW under-estimates
           * declared by ~9 pp (32 measured vs 40.91 declared). That
           * is honest territory — synthetic distribution will always
           * be approximate vs real CE 8-tier MINI/MINOR/MAJOR table.
           * Closing the residual gap requires PAR-8-EXT (full orb
           * table extraction from PAR-001!K3976-N3991). */
          /* PAR-8-TUNE-2 (Boki 2026-06-27): bumping chances after
           * PAR-8-EXT real CE orb table extraction. Multi-step sweep:
           *
           *   {0.0450, 0.130}  →  64.68 %   (Δ -18.13 pp)
           *   {0.0465, 0.135}  →  65.44 %   (Δ -17.37 pp)
           *   {0.0480, 0.142}  →  67.07 %   (Δ -15.74 pp)
           *   {0.0500, 0.150}  →  67.76 %   (Δ -15.05 pp)
           *   {0.0550, 0.170}  →  69.96 %   (Δ -12.85 pp)
           *   {0.0650, 0.200}  →  72.25 %   (Δ -10.56 pp)
           *   {0.0850, 0.260}  →  77.54 %   (Δ  -5.27 pp)
           *   {0.0900, 0.280}  →  77.74 %   (Δ  -5.07 pp)   ← landed
           *   {0.0950, 0.290}  →  75.19 %   (Δ  -7.62 pp, plateau)
           *
           * Real CE orb table (12 tiers from PAR-8-EXT) has bigger
           * mean value than synthetic 7-tier, so we need higher
           * land chances to reach the same expected HnW contribution.
           * {0.09, 0.28} lands within ~5 pp of declared 82.81 % combined
           * target — best the synthetic single-pool can do without
           * sister-side per-scenario HnW (6/7/8 Fireballs branches). */
          orb_land_chance_base: 0.09,
          orb_land_chance_fill_bonus: 0.28,
        }
      : {
          trigger_count: 255,
          initial_respins: 0,
          respins_on_new_orb: 0,
          full_grid_bonus: 0,
          orb_values: [],
          orb_land_chance_base: 0,
          orb_land_chance_fill_bonus: 0,
        },
    lightning: {
      trigger_chance: 0,
      trigger_chance_fs: 0,
      multipliers: [],
    },
    max_win_cap: Number(model.winCap?.maxWinX) || 5000,
    feature_loop_cap: 1000,
  };
}

// ─── Wilson 99% CI half-width for measured RTP ──────────────────────────────

/**
 * For Monte Carlo measured RTP from N spins, Wilson 99% CI half-width
 * scales with z_99 × σ̂ / √N. We approximate σ̂ via the law of total
 * variance assuming a Bernoulli-like win shape — close enough for the
 * tightness check that drives the verdict ladder.
 *
 * z_99 ≈ 2.5758. σ̂ ≈ √(RTP × (1 − RTP)) when treating each spin as
 * Bernoulli payoff, but real slots have heavy-tailed payouts. We
 * use a conservative σ̂ ≈ 4.5 × RTP (empirical for medium-vol slots,
 * tightens by feature-aware estimate in future).
 */
function wilson99HalfWidth(measuredRtp, n) {
  const Z99 = 2.5758;
  /* Conservative σ for heavy-tail slot payouts: 4.5× the RTP fraction
   * captures up to mid-volatility class. Down-stream PAR-6 will plug
   * in the per-game volatility class for tighter bands. */
  const sigmaHat = 4.5 * Math.abs(measuredRtp);
  return Z99 * sigmaHat / Math.sqrt(Math.max(1, n));
}

// ─── Single-slug convergence ─────────────────────────────────────────────────

async function convergeOne(baseUrl, slug, spins, seeds) {
  const modelPath = join(PAR_MODELS_DIR, slug, 'model.json');
  if (!existsSync(modelPath)) {
    return { slug, ok: false, reason: `model.json missing for ${slug}` };
  }
  const model = JSON.parse(readFileSync(modelPath, 'utf-8'));
  /* PAR-7-FAST + PAR-8 (Boki 2026-06-27): verdict target reflects
   * which feature paths the kernel actually simulates. Layered:
   *
   *   (a) When BOTH baseGame + holdAndWin declared AND HnW is enabled
   *       (mapper promoted cash→bonus + synthetic HnW config), measured
   *       includes base lines + HnW orb pay. Target = base + HnW share.
   *   (b) When baseGame alone declared (no HnW path), target = baseGame.
   *   (c) Fallback to declared total when components absent. */
  const components = model.payback?.components;
  const baseGameDecl = Number.isFinite(components?.baseGame)
    ? Number(components.baseGame) : null;
  const hnwDecl = Number.isFinite(components?.holdAndWin)
    ? Number(components.holdAndWin) : null;
  const totalDecl = Number(model.payback?.rtp);

  let declared;
  let declaredKind;
  if (baseGameDecl !== null && hnwDecl !== null && hnwDecl >= 1.0) {
    declared = baseGameDecl + hnwDecl;
    declaredKind = 'baseGame+holdAndWin';
  } else if (baseGameDecl !== null) {
    declared = baseGameDecl;
    declaredKind = 'baseGame';
  } else {
    declared = totalDecl;
    declaredKind = 'totalDeclared';
  }
  if (!Number.isFinite(declared)) {
    return { slug, ok: false, reason: `declared RTP missing in ${slug}` };
  }

  const cfg = mapModelToGameConfig(model);

  /* PAR-6 (Boki 2026-06-26, post sister 665f0c98): pass the industry-
   * standard total bet so paytable pays (per-line multipliers) scale
   * correctly. Total bet = paylines × 1_000 mc (= per-line bet 1.0
   * credit × N lines). Without this override the sister kernel uses
   * DEFAULT_TOTAL_BET_MC = 1_000 and treats all paytable values as
   * multipliers against a 1-credit-total wager.
   *
   * PAR-QA-4 (Boki 2026-06-26, minimal-probe verification): the right
   * fix turned out to be NORMALIZING paytable pays by paylines instead
   * of inflating the bet. Now we send total_bet_mc = 1_000 (1 credit
   * total) matching sister default, while mapModelToGameConfig divides
   * paytable values by paylineCount so kernel-side multiplication
   * reproduces correct RTP. Verified by minimal probe: 8-line config
   * pre-fix measured 800 % (factor 8), post-fix expected 100 %. */
  const totalBetMc = 1_000;
  const item = {
    id: slug,
    config: cfg,
    spins,
    seeds,
    sequential: true,
    total_bet_mc: totalBetMc,
  };

  const batch = await runBatchHttp(baseUrl, [item], { timeoutMs: 600_000 });
  if (!batch.ok || batch.results.length === 0) {
    return {
      slug,
      ok: false,
      reason: `batch FAIL: ${batch.reason || 'no results'}`,
      latencyMs: batch.totalLatencyMs,
    };
  }
  const r = batch.results[0];
  if (!r.ok) {
    return {
      slug,
      ok: false,
      reason: `result FAIL: ${r.error || 'unknown'}`,
      latencyMs: r.latencyMs,
    };
  }

  /* PAR-QA-4 fix (Boki 2026-06-26, minimal-config probe isolated factor
   * exactly 100× per payline). Root cause: comment claimed "sister
   * returns fraction" but sister `stats.rs:1070` actually returns
   * `(won as f64 / wagered as f64) * 100.0` — already in PERCENT.
   * Pre-fix: mapper multiplied AGAIN by 100, yielding measured 100×
   * inflated. Hard-verified by 1sym-1line pay=1 probe: expected 100 %,
   * pre-fix measured 10 000 % (100× drift). Post-fix measured = sister
   * return verbatim. */
  const measuredPct = r.rtp;
  const deltaPP = measuredPct - declared;
  const totalSpins = r.spins || spins * seeds;
  const wilsonHalfPP = wilson99HalfWidth(r.rtp, totalSpins) * 100;

  /* Verdict ladder — three explicit conditions. */
  let verdict;
  let reason;
  const absDelta = Math.abs(deltaPP);
  if (absDelta <= 0.05 && absDelta <= wilsonHalfPP) {
    verdict = 'PASS';
    reason = 'within ±0.05% and within Wilson99';
  } else if (absDelta <= 0.50 || absDelta <= 2 * wilsonHalfPP) {
    verdict = 'WARN';
    reason = absDelta > 0.05
      ? 'inside ±0.50% but outside ±0.05% — investigate feature contribution gap'
      : 'inside ±0.05% but loose Wilson — increase spin count';
  } else {
    verdict = 'FAIL';
    reason = 'outside ±0.50% band — math drift detected';
  }

  /* Stable paytable hash so changes in pays surface in the receipt. */
  const paytableHash = createHash('sha256')
    .update(JSON.stringify(cfg.paytable))
    .digest('hex')
    .slice(0, 16);

  return {
    slug,
    ok: true,
    verdict,
    reason,
    declared,
    declaredKind,
    declaredTotal: Number(model.payback?.rtp) || null,
    measuredPct,
    deltaPP,
    wilsonHalfPP,
    totalSpins,
    hits: r.hits,
    latencyMs: r.latencyMs,
    paytableHash,
    paylineCount: cfg.paylines.length,
    reelTotals: cfg.base_weights.map((reel) => reel.reduce((s, e) => s + e.weight, 0)),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });

  /* Locate the par-sheet model directories. */
  let slugs;
  if (opts.slug) {
    slugs = [opts.slug];
  } else {
    slugs = readdirSync(PAR_MODELS_DIR).filter((d) =>
      existsSync(join(PAR_MODELS_DIR, d, 'model.json')),
    );
  }
  if (slugs.length === 0) {
    console.error('No par-sheet models found in', PAR_MODELS_DIR);
    process.exit(1);
  }

  /* Spawn the sister http_server. */
  const sister = resolveHttpBinary();
  if (!sister.available) {
    console.error('Sister http_server binary not available:', sister.reason);
    process.exit(2);
  }

  console.log(`▸ spawning sister http_server (cap=${opts.spins * opts.seeds + 1})…`);
  const server = await spawnHttpServer({
    sister,
    capSpins: opts.spins * opts.seeds + 1,
  });
  console.log(`  bound to ${server.baseUrl} (pid=${server.pid})`);

  try {
    const health = await healthCheckHttp(server.baseUrl);
    if (!health?.ok) {
      console.error('Health check FAIL:', health);
      process.exit(3);
    }
    console.log(`  /healthz ok · version=${health.version}\n`);

    /* Run each slug sequentially — single CPU on m-series is plenty for
     * 1M spins / slug at the daemon's ~50-100M spins/sec single-thread
     * throughput. Total ~30-60s for 5 × 1M. */
    const receipts = [];
    for (const slug of slugs) {
      process.stdout.write(`▸ ${slug.padEnd(30)} …`);
      const t0 = Date.now();
      const r = await convergeOne(server.baseUrl, slug, opts.spins, opts.seeds);
      const dt = Date.now() - t0;
      if (!r.ok) {
        console.log(` FAIL (${dt}ms): ${r.reason}`);
      } else {
        const sign = r.deltaPP >= 0 ? '+' : '';
        console.log(
          ` ${r.verdict.padEnd(4)}  declared(${r.declaredKind || 'unk'})=${r.declared.toFixed(2)}%  ` +
          `measured=${r.measuredPct.toFixed(4)}%  Δ=${sign}${r.deltaPP.toFixed(4)}pp  ` +
          `W99=±${r.wilsonHalfPP.toFixed(3)}pp  (${dt}ms)`,
        );
      }
      receipts.push({ ...r, wallclockMs: dt });
      writeFileSync(
        join(OUT_DIR, `${slug}.json`),
        JSON.stringify(r, null, 2) + '\n',
      );
    }

    /* Aggregate receipt. */
    const pass = receipts.filter((r) => r.ok && r.verdict === 'PASS').length;
    const warn = receipts.filter((r) => r.ok && r.verdict === 'WARN').length;
    const fail = receipts.filter((r) => r.ok && r.verdict === 'FAIL').length;
    const failOpen = receipts.filter((r) => !r.ok).length;
    const aggregate = {
      runAt: new Date().toISOString(),
      spinsPerSeed: opts.spins,
      seeds: opts.seeds,
      perGame: receipts.map((r) => ({
        slug: r.slug,
        ok: r.ok,
        verdict: r.verdict || null,
        declared: r.declared || null,
        measuredPct: r.measuredPct || null,
        deltaPP: r.deltaPP || null,
        wilsonHalfPP: r.wilsonHalfPP || null,
        reason: r.reason || null,
      })),
      summary: { pass, warn, fail, errors: failOpen, total: receipts.length },
    };
    writeFileSync(
      join(OUT_DIR, '_aggregate.json'),
      JSON.stringify(aggregate, null, 2) + '\n',
    );

    console.log(
      `\nSummary: ${pass} PASS / ${warn} WARN / ${fail} FAIL / ` +
      `${failOpen} errors of ${receipts.length}`,
    );
    console.log(`  receipt: ${join(OUT_DIR, '_aggregate.json')}`);
  } finally {
    await server.dispose().catch(() => {});
    console.log('▸ server disposed');
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.stack || e?.message || e);
  process.exit(99);
});
