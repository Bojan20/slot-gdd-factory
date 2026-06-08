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
  ['egypt_lapis',      /egypt|pyramid|pharaoh|sphinx|nile|anubis|cleopatra|ra(\b|\W)/i],
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
       feature mix clearly implies non-rectangular topology. */
    let didKind = false;
    if (!present(t.kind) || t.kind === 'rectangular') {
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

/* ─── all-stages orchestrator ─────────────────────────────────────────── */

export function applySmartDefaults(model) {
  /* Order matters — see file header. */
  deriveThemePalette(model);
  inferTopology(model);
  classifySymbolTiers(model);
  synthesizeFeatureMix(model);
  return model;
}

/* ─── introspection helpers (used by tests + parser audit tools) ──────── */

export function listSupportedKinds() {
  return Object.keys(DIMS_BY_KIND);
}

export function listSupportedPaletteFamilies() {
  return Object.keys(PALETTE_CATALOGUE);
}
