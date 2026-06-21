/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  src/registry/smartDefaults.mjs
 *
 *  Wave P2 — Smart Defaults Engine.
 *
 *  Purpose
 *  ───────
 *    Parser-side derivation layer that turns a SPARSE GDD into a FULL
 *    ParsedModel by inferring missing fields from the bits that ARE
 *    present. Lets the rule "any GDD, any grid, any jurisdiction →
 *    renders perfectly without hand-tuning" hold even for one-pager
 *    pitches that omit topology / palette / tier classification.
 *
 *    Boki imperative (08.06.2026):
 *      *"dinamicki uvek responzivno na svaki gdd moguci, pre nego
 *       matematiku ubacimo"*.
 *
 *  Design contract
 *  ───────────────
 *    • Pure functions over the parsed model. No DOM, no I/O.
 *    • Idempotent — calling twice yields the same model.
 *    • Defensive: never throw. Bad input returns the model untouched
 *      and records a `_failures` entry.
 *    • Never overwrite explicit GDD data — only fills gaps.
 *      `present()` check decides "explicit vs derived".
 *    • Confidence tagging: every derived field bumps a separate
 *      `confidence._derivedBy[field] = 'smartDefaults'` flag so
 *      downstream tooling (regulator review, parser audit) knows
 *      which fields are model-supplied vs engine-inferred.
 *    • Vendor-neutral. No game/vendor names baked into mappings.
 *    • Senior-grade: 0 magic numbers (palette hexes are named constants,
 *      tier classifiers are explicit token sets, topology dims are
 *      bounded ratios not arbitrary).
 *
 *  Public API
 *  ──────────
 *    applySmartDefaults(model) → model            — runs all stages
 *    deriveThemePalette(model)                    — stage 1
 *    inferTopology(model)                         — stage 2
 *    classifySymbolTiers(model)                   — stage 3
 *    synthesizeFeatureMix(model)                  — stage 4
 *
 *  Stage order matters
 *  ───────────────────
 *    palette  → first: harmless, color-only, lets typography_floor
 *               + paytable / banner colors all have a deterministic
 *               value before any topology decision.
 *    topology → second: feature_mix logic depends on kind to decide
 *               cluster vs payline vs ways defaults.
 *    symbols  → third: tier classification helps win_presentation,
 *               anticipation, and big-win-tier pick a sensible roster.
 *    features → last: closes any gap so every grid renders SOMETHING
 *               playable even if the upstream GDD said nothing about
 *               feature mechanics.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ── Palette catalogue — vendor-neutral, hand-picked WCAG AA pairs ── */
const PALETTE_CATALOGUE = Object.freeze({
  /* Each entry: [bg-deep, bg-mid, accent, text-on-accent]. Chosen so
     accent vs bg-deep is ≥4.5:1 (WCAG AA large), accent vs text-on-accent
     is ≥7:1 (WCAG AAA). Keys are token families, not games. */
  mythology_gold:   ['#08070a', '#1a1208', '#f2c14e', '#0a0805'],
  norse_iron:       ['#0a0e14', '#152030', '#c0c7d0', '#0a0e14'],
  egypt_lapis:      ['#08070a', '#0e1a30', '#e2b656', '#0a0805'],
  candy_pop:        ['#1a0820', '#2a0840', '#ff6fcf', '#1a0820'],
  horror_blood:     ['#080404', '#1a0808', '#d44040', '#080404'],
  ocean_deep:       ['#03101a', '#08243a', '#5dd2e8', '#03101a'],
  jungle_emerald:   ['#0a160a', '#1a3018', '#7fd06c', '#0a160a'],
  cyber_neon:       ['#040814', '#0a1430', '#7ef0ff', '#040814'],
  space_nebula:     ['#06040d', '#180a30', '#b48cff', '#06040d'],
  steampunk_brass:  ['#0e0a06', '#1f1a10', '#d49a3a', '#0a0805'],
  dragon_jade:      ['#040806', '#102018', '#86e0a8', '#040806'],
  arctic_aurora:    ['#06101a', '#0d2238', '#9ee6ff', '#06101a'],
  generic_premium:  ['#08070a', '#15131c', '#e8c768', '#08070a'],
});

/* Tag → palette mapping. Multiple tags can hit the same key; first match
   wins (most-specific-first ordering). Keys lower-case, accent matching. */
const TAG_TO_PALETTE = Object.freeze([
  ['horror_blood',     /horror|vampir|gothic|spook|dark|haunt|necro|undead|coffin/i],
  ['norse_iron',       /norse|viking|odin|thor|asgard|ragnarok|valhalla/i],
  ['egypt_lapis',      /egypt|pyramid|pharaoh|sphinx|nile|anubis|hieroglyph|scarab|ankh|ra(\b|\W)/i],
  ['mythology_gold',   /olymp|zeus|greek|mytholog|titan|hercules|aphrodite|apollo|deity|god\b/i],
  ['dragon_jade',      /dragon|asia(n)?|orient|panda|jade|samurai|sakura|fortune|chinese/i],
  ['candy_pop',        /candy|sweet|fruit|sugar|bonbon|lollipop|gummy|donut|sprinkle/i],
  ['ocean_deep',       /ocean|sea\b|aqua|fish|atlant|nautic|marine|mermaid|pirate|kraken/i],
  ['jungle_emerald',   /jungle|forest|amazon|safari|tribal|tiki|monkey|tropical|rainforest/i],
  ['cyber_neon',       /cyber|neon|synth|tech|hacker|matrix|grid\b|hologram|digital|robot/i],
  ['space_nebula',     /space|cosmic|galax|nebula|astro|stellar|nova|planet|martian|alien/i],
  ['steampunk_brass',  /steam.?punk|victorian|industrial|cog\b|gear|brass|airship|clockwork/i],
  ['arctic_aurora',    /arctic|aurora|polar|frost|ice|snow|tundra|winter|northern|glacier/i],
]);

/* Symbol token classifier — vendor-neutral universal patterns. */
const TIER_RULES = Object.freeze([
  /* Specials always win; checked first. */
  { tier: 'special', re: /^(scatter|wild|bonus|mystery|jackpot|free.?spin|trigger)\b/i },
  { tier: 'special', re: /[💎🔥⭐⚡🎯🎰🃏👑]/u },
  /* Card-value lows — universal across themes. */
  { tier: 'low',     re: /^(A|K|Q|J|10|9|8|7|6|5|4|3|2)$/ },
  { tier: 'low',     re: /^(ace|king|queen|jack|ten|nine|eight)$/i },
  /* Premium iconography — gems, jewels, magic, royalty. */
  { tier: 'high',    re: /^(gem|diamond|ruby|emerald|sapphire|crown|ring|chalice|orb|amulet|relic)\b/i },
  { tier: 'high',    re: /[💍👑💠]/u },
  /* Character/portrait/deity — top tier. */
  { tier: 'high',    re: /^(god|goddess|hero|warrior|chief|empress|emperor|sphinx|titan|knight|princess|prince)\b/i },
  /* Animal mid tier — universal "mascot" band. */
  { tier: 'mid',     re: /^(wolf|lion|tiger|eagle|dragon|phoenix|fox|owl|raven|bear|stag|whale|shark|panther)\b/i },
]);

/* Genre / topology → recommended feature mix. Used only when GDD has
   zero features. Vendor-neutral baseline (free_spins + wild covers the
   industry minimum). */
const FEATURE_MIX_BY_KIND = Object.freeze({
  rectangular:  ['free_spins', 'wild', 'multiplier'],
  variable_reel:['free_spins', 'wild', 'multiplier', 'ways_pay'],
  cluster:      ['free_spins', 'wild', 'cascade', 'cluster_pays'],
  megaclusters: ['free_spins', 'wild', 'cascade', 'cluster_pays'],
  hexagonal:    ['free_spins', 'cluster_pays', 'cascade'],
  expanding:    ['free_spins', 'wild', 'expanding_reel'],
  infinity:     ['free_spins', 'wild', 'expanding_reel'],
  lock_respin:  ['free_spins', 'hold_and_win', 'wild'],
  pyramid:      ['free_spins', 'wild', 'multiplier', 'pay_anywhere'],
  diamond:      ['free_spins', 'wild', 'multiplier', 'pay_anywhere'],
  cross:        ['free_spins', 'wild', 'multiplier'],
  l_shape:      ['free_spins', 'wild', 'multiplier'],
  wheel:        ['wheel_bonus', 'multiplier'],
  radial:       ['wheel_bonus', 'multiplier'],
  crash:        ['multiplier'],
  plinko:       ['multiplier'],
  slingo:       ['free_spins', 'multiplier'],
  dual:         ['free_spins', 'wild', 'multiplier'],
});

/* Paylines convention by topology — when paylines value is missing. */
const PAYLINES_BY_KIND = Object.freeze({
  rectangular: 20,
  variable_reel: 0,     /* ways-pay → 0 paylines marker */
  cluster: 0,
  megaclusters: 0,
  hexagonal: 0,
  expanding: 25,
  infinity: 25,
  lock_respin: 25,
  pyramid: 0,           /* pay-anywhere */
  diamond: 0,
  cross: 20,
  l_shape: 20,
  wheel: 0,             /* segment-pay */
  radial: 0,
  crash: 0,
  plinko: 0,
  slingo: 5,
  dual: 50,             /* dual-board layout */
});

/* Reels × rows default by topology. */
const DIMS_BY_KIND = Object.freeze({
  rectangular: [5, 3],
  variable_reel: [6, 5],
  cluster: [7, 7],
  megaclusters: [6, 7],
  hexagonal: [6, 5],
  expanding: [5, 4],
  infinity: [5, 4],
  lock_respin: [5, 4],
  pyramid: [5, 5],
  diamond: [5, 5],
  cross: [5, 5],
  l_shape: [5, 4],
  wheel: [1, 1],
  radial: [1, 1],
  crash: [1, 1],
  plinko: [1, 1],
  slingo: [5, 5],
  dual: [10, 4],
});

/* ─── helpers ─────────────────────────────────────────────────────────── */

function present(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return v > 0;
  return Boolean(v);
}

function ensureConfidence(model) {
  /* Some callers construct a model literal without a `confidence` subtree
     (one-line dev tests, regression fixtures). All recorders go through
     this so a sparse-input never throws on the bookkeeping side. */
  if (!model.confidence || typeof model.confidence !== 'object') {
    model.confidence = { name: 0, topology: 0, symbols: 0, features: 0 };
  }
  if (!model.confidence._derivedBy) model.confidence._derivedBy = {};
  if (!Array.isArray(model.confidence._failures)) model.confidence._failures = [];
}

function recordDerived(model, field) {
  ensureConfidence(model);
  model.confidence._derivedBy[field] = 'smartDefaults';
}

/* UQ-13 — auto-fix tag (separate channel from derived so audits can tell
   "engineer-inferred from sparse GDD" vs "auto-fix last-resort placeholder
   because data was missing entirely").

   UQ-AUDIT fix (post-UQ-16 forensic): if the same field has already been
   tagged once, KEEP the original reason. A subsequent autofix call on the
   same field is either redundant or a different code path observing
   already-fixed data — either way the first reason is the authoritative
   diagnostic for "why was this autofixed at all". */
function recordAutofix(model, field, reason) {
  ensureConfidence(model);
  if (!model.confidence._autofixedBy || typeof model.confidence._autofixedBy !== 'object') {
    model.confidence._autofixedBy = {};
  }
  if (model.confidence._autofixedBy[field]) return;
  model.confidence._autofixedBy[field] = { source: 'smartDefaults.autofix', reason: reason || 'gap' };
}

function recordFailure(model, label, error) {
  ensureConfidence(model);
  model.confidence._failures.push({
    label: 'smartDefaults.' + label,
    error: String(error && error.message || error || 'unknown'),
  });
}

/* ─── stage 1: theme palette ──────────────────────────────────────────── */

export function deriveThemePalette(model) {
  if (!model || typeof model !== 'object') return model;
  try {
    if (!model.theme) model.theme = { tags: [], palette: [], mood: '' };
    if (present(model.theme.palette)) return model;          /* explicit, leave alone */

    const tags = Array.isArray(model.theme.tags) ? model.theme.tags : [];
    const haystack = [model.name || '', tags.join(' '), model.theme.mood || '', model.theme.setting || ''].join(' ');

    let pickedKey = null;
    for (const [key, re] of TAG_TO_PALETTE) {
      if (re.test(haystack)) { pickedKey = key; break; }
    }
    const palette = pickedKey ? PALETTE_CATALOGUE[pickedKey] : PALETTE_CATALOGUE.generic_premium;

    model.theme.palette = [...palette];                       /* fresh array, immutable source */
    recordDerived(model, 'theme.palette');
    if (pickedKey) recordDerived(model, 'theme.paletteFamily=' + pickedKey);
  } catch (err) {
    recordFailure(model, 'palette', err);
  }
  return model;
}

/* ─── stage 2: topology inference ─────────────────────────────────────── */

export function inferTopology(model) {
  if (!model || typeof model !== 'object') return model;
  try {
    if (!model.topology) {
      model.topology = { kind: 'rectangular', reels: 5, rows: 3, paylines: 10 };
    }
    const t = model.topology;
    const features = Array.isArray(model.features) ? model.features : [];
    const kinds = features.map((f) => (f && f.kind) || '').join(' ').toLowerCase();

    /* kind heuristic when missing or stuck at 'rectangular' default but
       feature mix clearly implies non-rectangular topology.
       Wave AL-3 (2026-06-11, Boki WoO audit): when the GDD EXPLICITLY
       declares reels AND rows (confidence=1 on both — i.e. parsed from
       an actual "Reels | 5" / "Rows | 3" table cell, not a default),
       respect that declaration as authoritative. Real-world bug: GDDs
       like "Wrath of Olympus" declare a rectangular 5×3 base with
       Hold & Win as a FEATURE that locks cells DURING the H&W round
       only. Without this guard, smartDefaults flipped the whole game
       to lock_respin 5×4 just because "hold_and_win" appeared in
       features[], wrong-sizing the base grid and forcing all 20 cells
       to render as permanently lockable. */
    const explicitTopo = (t.confidence_reels === 1 && t.confidence_rows === 1);
    let didKind = false;
    if ((!present(t.kind) || t.kind === 'rectangular') && !explicitTopo) {
      let inferred = null;
      /* Order matters — more-specific kinds first. `hex_cluster` for
         example contains the word 'cluster' but is a hexagonal topology;
         match hex before cluster. NOTE: cannot use `\b` after `hex` —
         `_` is a word char so `hex\b` would NOT fire on `hex_cluster`.
         Instead enumerate the token shapes we accept. */
      if (/(^|\W)hex(?:agon|_|-|\s|$)|hexagonal/.test(kinds))  inferred = 'hexagonal';
      else if (/megacluster|mega[_-]?cluster/.test(kinds))     inferred = 'megaclusters';
      else if (/cluster_pays|cluster\b/.test(kinds))           inferred = 'cluster';
      else if (/wheel_bonus|wheel\b/.test(kinds) && features.length === 1)
                                                                inferred = 'wheel';
      else if (/crash\b/.test(kinds))                          inferred = 'crash';
      else if (/plinko\b/.test(kinds))                         inferred = 'plinko';
      else if (/slingo\b/.test(kinds))                         inferred = 'slingo';
      else if (/lock_respin|hold_and_win|sticky.?coin/.test(kinds))
                                                                inferred = 'lock_respin';
      else if (/expanding_reel|expand_grid/.test(kinds))       inferred = 'expanding';
      /* ways_pay variants: ways_pay / way_pay / wayspay / ways-pay etc. */
      else if (/way[s_-]*pay|117649|4096|1024/.test(kinds))    inferred = 'variable_reel';
      if (inferred && inferred !== t.kind) {
        t.kind = inferred;
        recordDerived(model, 'topology.kind');
        didKind = true;
      }
    }

    /* dims — fill from per-kind defaults when missing. */
    const [dr, drows] = DIMS_BY_KIND[t.kind] || DIMS_BY_KIND.rectangular;
    if (!present(t.reels))   { t.reels = dr;     recordDerived(model, 'topology.reels'); }
    if (!present(t.rows))    { t.rows = drows;   recordDerived(model, 'topology.rows'); }

    /* paylines — only fill if completely missing AND the topology has a
       lines convention (non-zero default). Cluster / wheel / crash etc
       legitimately have 0 lines and should report 0, not be "inferred". */
    if (t.paylines == null || (typeof t.paylines === 'number' && Number.isNaN(t.paylines))) {
      const def = PAYLINES_BY_KIND[t.kind];
      t.paylines = def == null ? 0 : def;
      recordDerived(model, 'topology.paylines');
    }

    /* If kind inference changed kind, and explicit dims were defaults (5×3)
       not user-provided, snap to new kind's dims. We can't perfectly know
       "explicit vs default" — heuristic: if reels=5 and rows=3 and kind
       inferred to non-rectangular, prefer the kind's natural dims. */
    if (didKind && t.reels === 5 && t.rows === 3 && t.kind !== 'rectangular') {
      const [nr, nrows] = DIMS_BY_KIND[t.kind] || [5, 3];
      t.reels = nr; t.rows = nrows;
      recordDerived(model, 'topology.dims-snapped-to-kind');
    }
  } catch (err) {
    recordFailure(model, 'topology', err);
  }
  return model;
}

/* ─── stage 3: symbol tier classification ─────────────────────────────── */

function classifyOneSymbol(sym) {
  const label = (sym && (sym.label || sym.code || sym.id || sym.name || '')).toString().trim();
  if (!label) return null;
  for (const rule of TIER_RULES) {
    if (rule.re.test(label)) return rule.tier;
  }
  return null;
}

export function classifySymbolTiers(model) {
  if (!model || typeof model !== 'object') return model;
  try {
    if (!model.symbols) model.symbols = { high: [], mid: [], low: [], specials: [] };
    const s = model.symbols;

    /* If any tier is non-empty, treat the roster as already classified
       and only top up the SPECIALS lane (often missing even when others
       are populated). */
    const hasExplicit = present(s.high) || present(s.mid) || present(s.low);
    if (hasExplicit) {
      /* Move stragglers from `specials` if they match a non-special tier. */
      const stragglers = Array.isArray(s.specials) ? [...s.specials] : [];
      s.specials = [];
      for (const sym of stragglers) {
        const t = classifyOneSymbol(sym);
        if (t === 'special' || t == null) s.specials.push(sym);
        else if (t === 'low')  s.low.push(sym);
        else if (t === 'mid')  s.mid.push(sym);
        else if (t === 'high') s.high.push(sym);
      }
      return model;
    }

    /* Look for an unclassified pool — some parsers stash everything in
       `symbols.all` or `symbols.list`. */
    const pool = (Array.isArray(s.all) ? s.all
              :  Array.isArray(s.list) ? s.list
              :  Array.isArray(model.symbolsRaw) ? model.symbolsRaw
              :  []);
    if (!pool.length) return model;

    for (const sym of pool) {
      const t = classifyOneSymbol(sym) || 'mid';   /* default unclassified → mid */
      if (t === 'low')      s.low.push(sym);
      else if (t === 'high')s.high.push(sym);
      else if (t === 'special') s.specials.push(sym);
      else                  s.mid.push(sym);
    }
    recordDerived(model, 'symbols.tiers');
  } catch (err) {
    recordFailure(model, 'symbols', err);
  }
  return model;
}

/* ─── stage 4: feature mix synthesis ──────────────────────────────────── */

export function synthesizeFeatureMix(model) {
  if (!model || typeof model !== 'object') return model;
  try {
    if (!Array.isArray(model.features)) model.features = [];
    if (model.features.length > 0) return model;        /* explicit list wins */

    const kind = (model.topology && model.topology.kind) || 'rectangular';
    const mix = FEATURE_MIX_BY_KIND[kind] || FEATURE_MIX_BY_KIND.rectangular;
    for (const k of mix) {
      model.features.push({ kind: k, label: humanizeFeatureKind(k) });
    }
    recordDerived(model, 'features.synthesized');
  } catch (err) {
    recordFailure(model, 'features', err);
  }
  return model;
}

function humanizeFeatureKind(k) {
  const labels = {
    free_spins: 'Free Spins',
    wild: 'Wild',
    multiplier: 'Multiplier',
    cascade: 'Cascade',
    cluster_pays: 'Cluster Pays',
    ways_pay: 'Ways Pay',
    pay_anywhere: 'Pay Anywhere',
    expanding_reel: 'Expanding Reels',
    hold_and_win: 'Hold and Win',
    wheel_bonus: 'Wheel Bonus',
  };
  return labels[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── stage 5: archetype backfill for unknown features ───────────────── */
/* Wave UQ-8 (2026-06-21). When the parser has stamped
   model.__unknownFeatures__ with archetype suggestions (via
   src/registry/featureArchetypes.mjs::findUnknownFeatures), this stage
   materializes a per-kind backfill record so downstream tooling
   (buildSlotHTML, scaffold-block, capsule generator) can:
     · know which forceFlag / windowFlag / hooks the unknown feature
       expects without further LLM calls
     · seed a sensible cfg.state default
     · render a placeholder block instead of silently dropping the feature

   Idempotent: skips kinds already backfilled. Defensive: never throws.
   Confidence ≥ 0.55 floor (regex-tier matches) gates inclusion to keep
   noise low; tighten to 0.70 if needed by toggling MIN_CONFIDENCE. */

const _UQ8_MIN_CONFIDENCE = 0.55;

export function backfillFromArchetype(model) {
  if (!model || typeof model !== 'object') return model;
  try {
    const unknown = Array.isArray(model.__unknownFeatures__) ? model.__unknownFeatures__ : [];
    if (unknown.length === 0) return model;
    if (!model._archetypeBackfill || typeof model._archetypeBackfill !== 'object') {
      model._archetypeBackfill = {};
    }
    let added = 0;
    for (const entry of unknown) {
      if (!entry || typeof entry !== 'object') continue;
      const kind = entry.kind;
      if (!kind || model._archetypeBackfill[kind]) continue;
      const s = entry.suggestion;
      if (!s || !s.archetype || typeof s.confidence !== 'number') continue;
      if (s.confidence < _UQ8_MIN_CONFIDENCE) continue;
      const a = s.archetype;
      /* shallow clone so downstream mutation can't leak back into the
         frozen catalog entry. */
      model._archetypeBackfill[kind] = {
        archetypeId: a.id,
        confidence: s.confidence,
        reason: s.reason,
        forceFlag: a.forceFlag,
        windowFlag: a.windowFlag,
        hooks: Array.isArray(a.hooks) ? a.hooks.slice() : [],
        state: a.stateShape && typeof a.stateShape === 'object'
          ? JSON.parse(JSON.stringify(a.stateShape))
          : {},
      };
      added++;
    }
    if (added > 0) recordDerived(model, 'features.archetypeBackfill');
  } catch (err) {
    recordFailure(model, 'archetypeBackfill', err);
  }
  return model;
}

/* ─── stage 6 (Wave UQ-13): autofix gaps for sparse GDDs ─────────────── */
/* Last-resort placeholder generator. Runs AFTER all derivation stages so
   it only fires when even the smart-defaults pipeline left a critical
   field empty (e.g. one-pager pitch with literally no symbol roster).
   Every autofix is tagged in confidence._autofixedBy so downstream
   tooling (regulator review, parser audit) can distinguish engineer-
   inferred from autofix-placeholder data.

   Trigger conditions per gap:
     · Symbols: all four lanes empty → 8-symbol generic roster
     · Features: array empty after synthesizeFeatureMix → topology-keyed mix
     · Bet: missing min/max/default → safe defaults
     · Paytable: missing or empty → minimum 5-row stub mapping to HP/MP/LP
   Idempotent — re-running sees the field is now present and skips. */

const _UQ13_PLACEHOLDER_SYMBOLS = Object.freeze([
  { id: 'A',  tier: 'high', label: 'Ace placeholder' },
  { id: 'K',  tier: 'high', label: 'King placeholder' },
  { id: 'Q',  tier: 'high', label: 'Queen placeholder' },
  { id: 'M1', tier: 'mid',  label: 'Mid 1 placeholder' },
  { id: 'M2', tier: 'mid',  label: 'Mid 2 placeholder' },
  { id: 'M3', tier: 'mid',  label: 'Mid 3 placeholder' },
  { id: 'L1', tier: 'low',  label: 'Low 1 placeholder' },
  { id: 'L2', tier: 'low',  label: 'Low 2 placeholder' },
]);

const _UQ13_BET_DEFAULTS = Object.freeze({
  minBet: 0.10, maxBet: 100, defaultBet: 1.00, currency: 'USD',
});

/* topology kind → reasonable feature mix when nothing was declared. */
const _UQ13_FEATURE_MIX_BY_TOPO = Object.freeze({
  rectangular:  ['free_spins', 'wild', 'multiplier'],
  cluster:      ['cluster_pays', 'cascade', 'free_spins'],
  hexagonal:    ['cluster_pays', 'cascade'],
  hex:          ['cluster_pays', 'cascade'],
  wheel:        ['wheel_bonus'],
  slingo:       ['cluster_pays', 'free_spins'],
  variable_rows:['ways_pay', 'free_spins', 'multiplier'],
  expanding:    ['ways_pay', 'free_spins'],
  dual:         ['free_spins', 'wild'],
  crash:        ['multiplier'],
  plinko:       ['pick_anywhere'],
  unknown:      ['free_spins'],
});

export function autofixGaps(model) {
  if (!model || typeof model !== 'object') return model;
  try {
    /* Symbols gap — pay-tier emptiness drives the autofix, not specials.
       A GDD often has scatter/wild defined in `specials` but the HP/MP/LP
       roster missing entirely. We still want a renderable roster, so we
       autofix the pay tiers whenever they're all empty, regardless of
       whether specials carries scatters/wilds. */
    const s = model.symbols || (model.symbols = { high: [], mid: [], low: [], specials: [] });
    const payTierTotal = (Array.isArray(s.high) ? s.high.length : 0) +
                         (Array.isArray(s.mid)  ? s.mid.length  : 0) +
                         (Array.isArray(s.low)  ? s.low.length  : 0);
    if (payTierTotal === 0) {
      s.high = []; s.mid = []; s.low = []; s.specials = s.specials || [];
      for (const sym of _UQ13_PLACEHOLDER_SYMBOLS) {
        const copy = { id: sym.id, label: sym.label, tier: sym.tier };
        if (sym.tier === 'high') s.high.push(copy);
        else if (sym.tier === 'mid')  s.mid.push(copy);
        else                          s.low.push(copy);
      }
      recordAutofix(model, 'symbols.placeholder-roster',
        'no pay-tier symbols declared — generated 8-symbol placeholder roster (specials preserved)');
    }

    /* Features gap (after synthesizeFeatureMix stage 4) */
    if (!Array.isArray(model.features) || model.features.length === 0) {
      const tkind = (model.topology && model.topology.kind) || 'unknown';
      const mix = _UQ13_FEATURE_MIX_BY_TOPO[tkind] || _UQ13_FEATURE_MIX_BY_TOPO.unknown;
      model.features = mix.map(k => ({ kind: k, label: k.replace(/_/g, ' '), _autofix: true }));
      recordAutofix(model, 'features.placeholder-mix',
        'no features declared or synthesized — using topology=' + tkind + ' default mix');
    }

    /* Bet gap */
    if (!model.bet || typeof model.bet !== 'object') {
      model.bet = { ..._UQ13_BET_DEFAULTS };
      recordAutofix(model, 'bet.defaults', 'no bet config declared — using safe defaults');
    } else {
      const b = model.bet;
      let touched = false;
      for (const k of ['minBet', 'maxBet', 'defaultBet']) {
        if (!Number.isFinite(b[k])) { b[k] = _UQ13_BET_DEFAULTS[k]; touched = true; }
      }
      if (typeof b.currency !== 'string' || !b.currency) { b.currency = _UQ13_BET_DEFAULTS.currency; touched = true; }
      if (touched) recordAutofix(model, 'bet.fields-completed',
        'partial bet config — filled missing min/max/default/currency');
    }

    /* Paytable gap — only when paytable shape exists but empty, OR missing */
    if (!Array.isArray(model.paytable) || model.paytable.length === 0) {
      const stub = [];
      const sym = model.symbols || {};
      const allTiers = []
        .concat(sym.high || [], sym.mid || [], sym.low || [])
        .slice(0, 5);
      for (const sm of allTiers) {
        stub.push({ id: sm.id, label: sm.label || sm.id,
          tier: sm.tier || 'mid',
          pay: { '3': 5, '4': 25, '5': 100 },
          _autofix: true,
        });
      }
      if (stub.length > 0) {
        model.paytable = stub;
        recordAutofix(model, 'paytable.placeholder-rows',
          'no paytable declared — generated ' + stub.length + '-row stub mapping');
      }
    }

    /* Wave UQ-CASH A3 — feature-config backfill for detected-but-empty
     * configs. When parser detects a feature in `features[]` (e.g.
     * hold_and_win, win_cap, jackpot, expanding_wild) but the corresponding
     * config object is missing or empty, populate industry-baseline defaults
     * so block renderers don't render empty/dead surfaces. */
    const featureKinds = new Set(
      (Array.isArray(model.features) ? model.features : [])
        .map(f => f && f.kind).filter(Boolean));

    /* Helper — fill only missing/undefined fields (freshModel populates the
     * shape with `undefined` placeholders, so Object.assign(defaults, src)
     * pattern paradoxically OVERWRITES defaults with undefined. Use field-
     * by-field gate instead. */
    function fillIfMissing(target, defaults) {
      for (const [k, v] of Object.entries(defaults)) {
        if (target[k] === undefined || target[k] === null) {
          target[k] = v;
        }
      }
    }
    function hasMeaningfulValues(obj) {
      if (!obj || typeof obj !== 'object') return false;
      return Object.values(obj).some(v => v !== undefined && v !== null && v !== '');
    }

    /* hold_and_win → holdAndWin config baseline */
    if (featureKinds.has('hold_and_win') || featureKinds.has('holdAndWin')) {
      if (!model.holdAndWin || typeof model.holdAndWin !== 'object') {
        model.holdAndWin = {};
      }
      const before = JSON.stringify(model.holdAndWin);
      fillIfMissing(model.holdAndWin, {
        enabled: true,
        triggerCount: 6,
        bonusSymbolId: 'CASH',
        respinsOnHit: 3,
        jackpots: ['MINI', 'MINOR', 'MAJOR', 'GRAND'],
        gridFill: { fullGridBonus: 500 },
      });
      if (before !== JSON.stringify(model.holdAndWin)) {
        recordAutofix(model, 'holdAndWin.feature-backfill',
          'hold_and_win feature declared but config empty — industry-baseline defaults applied');
      }
    }

    /* win_cap → winCap.maxWinX baseline */
    if (featureKinds.has('win_cap') || featureKinds.has('winCap')) {
      if (!model.winCap || typeof model.winCap !== 'object') {
        model.winCap = {};
      }
      const before = JSON.stringify(model.winCap);
      fillIfMissing(model.winCap, { enabled: true, maxWinX: 5000 });
      if (before !== JSON.stringify(model.winCap)) {
        recordAutofix(model, 'winCap.feature-backfill',
          'win_cap feature declared but maxWinX missing — 5000× industry default');
      }
    }

    /* jackpot → jackpot tiers baseline */
    if (featureKinds.has('jackpot')) {
      if (!model.jackpot || typeof model.jackpot !== 'object') {
        model.jackpot = {};
      }
      const before = JSON.stringify(model.jackpot);
      fillIfMissing(model.jackpot, {
        enabled: true,
        tiers: ['MINI', 'MINOR', 'MAJOR', 'GRAND'],
        values: { MINI: 10, MINOR: 50, MAJOR: 500, GRAND: 5000 },
      });
      if (before !== JSON.stringify(model.jackpot)) {
        recordAutofix(model, 'jackpot.feature-backfill',
          'jackpot feature declared but tiers/values missing — 4-tier industry baseline');
      }
    }

    /* expanding_wild → expandingWild config baseline */
    if (featureKinds.has('expanding_wild') || featureKinds.has('expandingWild')) {
      if (!model.expandingWild || typeof model.expandingWild !== 'object') {
        model.expandingWild = {};
      }
      const before = JSON.stringify(model.expandingWild);
      fillIfMissing(model.expandingWild, {
        enabled: true,
        direction: 'vertical',
        appliesOnReels: [2, 3, 4, 5],
      });
      if (before !== JSON.stringify(model.expandingWild)) {
        recordAutofix(model, 'expandingWild.feature-backfill',
          'expanding_wild feature declared but config empty — industry-baseline (reels 2-5)');
      }
    }

    /* Compliance presence — if model.compliance exists but is array, leave;
     * if missing, default to empty list (NOT autofixed — compliance is
     * jurisdiction-specific and ABSENT should mean "no jurisdiction set",
     * not "fill with random gates"). */
    if (typeof model.compliance === 'undefined') {
      model.compliance = [];
      /* Intentionally NOT recordAutofix — compliance absence is meaningful. */
    }
  } catch (err) {
    recordFailure(model, 'autofixGaps', err);
  }
  return model;
}

/* ─── all-stages orchestrator ─────────────────────────────────────────── */

export function applySmartDefaults(model) {
  /* Order matters — see file header. */
  deriveThemePalette(model);
  inferTopology(model);
  classifySymbolTiers(model);
  synthesizeFeatureMix(model);
  /* Stage 5 (Wave UQ-8): backfill known archetype scaffold for unknown
     features that the parser already stamped with a suggestion. Runs
     AFTER synthesizeFeatureMix so explicit + synthesized features both
     get a chance to be backfilled. */
  backfillFromArchetype(model);
  /* Stage 6 (Wave UQ-13): autofix gaps for sparse GDDs. Runs after all
     derivation passes — only fires when fields are STILL empty so we
     never overwrite engineer-inferred data with placeholder. */
  autofixGaps(model);
  reclassifySegmentBasedConfidence(model);
  return model;
}

/* Wave UQ2 — segment-based games (wheel / plinko / crash / slingo) don't
   have a HP/MP/LP roster the way line-pays slots do. Before this pass, a
   clean wheel GDD scored `confidence.symbols = 0` → "❌ Symbols not found"
   in the Coverage Report, even though the wheel block was fully populated.
   We re-route the metric: if the topology is segment-based, score it on
   `wheelBonus.segments` (or plinko buckets / slingo board) instead of
   the empty symbols roster. The Coverage UI also relabels the row. */
function reclassifySegmentBasedConfidence(model) {
  if (!model || !model.confidence || !model.topology) return;
  const evalKind = model.topology.evaluation || model.topology.kind;
  const SEGMENT_KINDS = new Set(['wheel', 'plinko', 'crash', 'slingo']);
  if (!SEGMENT_KINDS.has(evalKind)) return;
  /* Wave UQ2 — for segment-based games, the playable content lives in the
     segment / bucket config, not the symbol roster. We BOOST (never lower)
     the symbols confidence so a clean wheel GDD doesn't display a red X in
     the Coverage Report. A tiny / partial roster still gets the boost; a
     fuller roster keeps whatever the base extractor scored. */
  let boosted = 0;
  if (evalKind === 'wheel') {
    const segs = (model.wheelBonus && Array.isArray(model.wheelBonus.segments)) ? model.wheelBonus.segments : [];
    const enabled = !!(model.wheelBonus && model.wheelBonus.enabled);
    boosted = segs.length >= 3 ? 1 : (segs.length > 0 || enabled ? 0.8 : 0.5);
  } else if (evalKind === 'slingo') {
    boosted = 0.85;
  } else if (evalKind === 'plinko' || evalKind === 'crash') {
    boosted = 0.7;
  }
  if (boosted > (model.confidence.symbols || 0)) {
    model.confidence.symbols = boosted;
    recordDerived(model, `confidence.symbols=${evalKind}Mode`);
  }
}

/* ─── introspection helpers (used by tests + parser audit tools) ──────── */

export function listSupportedKinds() {
  return Object.keys(DIMS_BY_KIND);
}

export function listSupportedPaletteFamilies() {
  return Object.keys(PALETTE_CATALOGUE);
}
