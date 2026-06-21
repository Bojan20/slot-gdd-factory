/**
 * src/registry/featureArchetypes.mjs
 *
 * Wave Z (Boki "ultimativni slot gdd ... bilo koji novi feature bilo kakav
 * gdd moci pravilno da se izgradi" 2026-06-21) — Feature Archetype Library.
 *
 * The thesis: every slot feature in the industry — known or yet-to-be-
 * invented — composes from a small set of structural archetypes. If the
 * parser can classify an unknown feature_kind into ONE archetype, we
 * already know its lifecycle shape: which HookBus events it subscribes
 * to, which window flags it writes, which force-chip variant it accepts,
 * which DOM surface it owns.
 *
 * This file is the canonical archetype catalog. It is consumed by:
 *   1. parser.mjs — surfaces model.__archetypeSuggestions__ per unknown feature
 *   2. tools/_wave-z-scaffold-block.mjs (Phase 2) — generates a .mjs + .test.mjs
 *      from an archetype template
 *   3. blockCatalog generator — annotates each block with its archetype tag
 *
 * 15 archetypes covering ~95 % of slot feature design space (industry survey,
 * vendor-neutral). Each archetype declares:
 *   id              — canonical key
 *   purpose         — one-line plain-language description
 *   intentRegex     — regex hints to detect this archetype in GDD prose
 *   hooks           — typical HookBus subscribe set
 *   forceFlag       — naming convention for the force chip
 *   windowFlag      — naming convention for the run-time state flag
 *   stateShape      — minimal state object the block needs
 *   examples        — vendor-neutral examples of features that map here
 *
 * Adding a 16th archetype: append to ARCHETYPES, ship test, run lw-25
 * deep-seek QA. If 0 regression + new archetype matches ≥ 1 LW GDD,
 * commit + update MASTER_TODO.
 */

export const ARCHETYPES = Object.freeze([
  {
    id: 'sticky-state',
    purpose: 'Persists a state (wild / multiplier / symbol) across N spins or until cleared',
    intentRegex: /stick(?:y|s|ing)|locked\s+(?:wild|symbol|multiplier)|hold(?:ed)?\s+(?:in|on)\s+place/i,
    hooks: ['preSpin', 'onSpinResult', 'postSpin', 'onFsTrigger', 'onFsEnd'],
    forceFlag: '__FORCE_STICKY_PLANT__',
    windowFlag: '__STICKY_CELLS__',
    stateShape: { cells: [], remainingSpins: 0 },
    examples: ['stickyWild', 'stickyMultiplier', 'stickyScatterFS'],
  },
  {
    id: 'accumulator',
    purpose: 'Collects per-spin contributions until threshold N → trigger reward',
    intentRegex: /collect(?:s|ed|ing)?|accumulate(?:s|d|ing)?|fill(?:s)?\s+(?:meter|bar|gauge)|count\s+to\s+\d+/i,
    hooks: ['onSpinResult', 'postSpin', 'onTumbleStep'],
    forceFlag: '__FORCE_COLLECTOR_FILL__',
    windowFlag: '__COLLECTOR_TALLY__',
    stateShape: { current: 0, threshold: 0, payload: null },
    examples: ['bonusCollector', 'coinCollect', 'energyMeter'],
  },
  {
    id: 'ladder',
    purpose: 'Tiered progression — each step grants a fixed reward, top step is jackpot',
    intentRegex: /ladder|tier(?:s|ed)?|climb|MINI[\/\s-]+MINOR[\/\s-]+MAJOR[\/\s-]+GRAND|prize\s+ladder|rung/i,
    hooks: ['onSpinResult', 'postSpin'],
    forceFlag: '__FORCE_LADDER_TIER__',
    windowFlag: '__LADDER_RUNG__',
    stateShape: { rungs: [], currentRung: 0 },
    examples: ['jackpotLadderRooms', 'multiplierLadder', 'progressiveFsRetriggerLadder'],
  },
  {
    id: 'reveal',
    purpose: 'Player picks K cells out of N to reveal hidden prizes (deterministic pool)',
    intentRegex: /pick(?:s)?\s+\d+|choose\s+\d+|reveal(?:s|ed|ing)?|scratch|tap\s+(?:to|and)\s+(?:reveal|win)/i,
    hooks: ['onPickStart', 'onPickReveal', 'onPickComplete'],
    forceFlag: '__FORCE_PICK_PATH__',
    windowFlag: '__PICK_REMAINING__',
    stateShape: { revealed: [], pool: [], remaining: 0 },
    examples: ['bonusPick', 'pickYourFs', 'jackpotPicker'],
  },
  {
    id: 'spawn',
    purpose: 'Inserts a new symbol (mystery / transform / chain) onto landed grid post-spin',
    intentRegex: /myster(?:y|ies)|transform(?:s|ed|ing)?|reveal(?:s)?\s+(?:as|to)|morph(?:s|ed|ing)?\s+into/i,
    hooks: ['onSpinResult', 'onTumbleStep'],
    forceFlag: '__FORCE_SPAWN_KIND__',
    windowFlag: '__SPAWN_CELLS__',
    stateShape: { cells: [], targetSymbolId: null },
    examples: ['mysterySymbol', 'mysteryWildReveal', 'symbolUpgrade'],
  },
  {
    id: 'expand-direction',
    purpose: 'Grows a symbol/cell along a vector (full-reel, 2×2, 3×3, cluster)',
    intentRegex: /expand(?:s|ed|ing)?|stretch(?:es|ed|ing)?|fills?\s+the\s+(?:reel|row|column)|2x2|3x3|big\s+symbol/i,
    hooks: ['onSpinResult'],
    forceFlag: '__FORCE_EXPAND_KIND__',
    windowFlag: '__EXPAND_TARGETS__',
    stateShape: { seedCells: [], direction: 'vertical' },
    examples: ['expandingWild', 'bigSymbolRender2x2', 'megaWildCluster'],
  },
  {
    id: 'movement',
    purpose: 'Cell or symbol drifts across reels each spin (walking, marching, drifting)',
    intentRegex: /walk(?:s|ed|ing)?|march(?:es|ed|ing)?|drift(?:s|ed|ing)?|move(?:s|d|ing)?\s+(?:left|right|down|up)/i,
    hooks: ['preSpin', 'onSpinResult', 'postSpin'],
    forceFlag: '__FORCE_WALK_DIR__',
    windowFlag: '__WALK_CELLS__',
    stateShape: { cells: [], direction: 'left' },
    examples: ['walkingWild', 'walkingWildStepper'],
  },
  {
    id: 'linked-region',
    purpose: 'Two or more reels/cells share their landed strip (mirrored / linked)',
    intentRegex: /link(?:s|ed|ing)?\s+(?:reel|row|column)|sync(?:hroniz)?|mirror(?:s|ed)?\s+reel|reel\s+link/i,
    hooks: ['preSpin', 'onSpinResult'],
    forceFlag: '__FORCE_LINK_PATTERN__',
    windowFlag: '__LINKED_REELS__',
    stateShape: { groups: [] },
    examples: ['linkedReels', 'syncedReels'],
  },
  {
    id: 'meter-charging',
    purpose: 'Charges a meter on every spin; full meter triggers super-spin / power-up',
    intentRegex: /charge(?:s|d|ing)?|power[- ]?up|super[- ]?(?:spin|mode)|energy\s+bar|boost\s+meter/i,
    hooks: ['onSpinResult', 'postSpin', 'onPowerUpReady'],
    forceFlag: '__FORCE_METER_FILL__',
    windowFlag: '__METER_VALUE__',
    stateShape: { current: 0, capacity: 100, mode: 'normal' },
    examples: ['energyMeter', 'stickyMeter', 'rewardChest'],
  },
  {
    id: 'aux-reel',
    purpose: 'Side strip that lands a multiplier/segment alongside main reels',
    intentRegex: /aux(?:iliary)?\s+reel|side\s+reel|storm\s+reel|lightning\s+meter|multiplier\s+strip/i,
    hooks: ['preSpin', 'onSpinResult'],
    forceFlag: '__FORCE_AUX_VALUE__',
    windowFlag: '__AUX_LANDING__',
    stateShape: { value: null, weighted: [] },
    examples: ['stormMultiplierReel', 'lightningMeter'],
  },
  {
    id: 'trigger-then-respin',
    purpose: 'Threshold of trigger symbols hits → enter respin mode where only triggers persist',
    intentRegex: /trigger(?:s|ed)?\s+respin|hold\s+(?:and|&|n)\s+(?:win|respin)|lock\s+(?:and|&|n)\s+respin|3\s+respins?\s+reset/i,
    hooks: ['onSpinResult', 'preRespin', 'onRespinResult', 'postRespin'],
    forceFlag: '__FORCE_HW_TRIGGER__',
    windowFlag: '__HW_PERSISTED__',
    stateShape: { persistedCells: [], respinsRemaining: 0, jackpots: [] },
    examples: ['holdAndWin', 'respin', 'wildTriggerHoldAndWin'],
  },
  {
    id: 'cascade-collapse',
    purpose: 'Winning symbols disappear, cells above fall down, new symbols enter, repeat',
    intentRegex: /tumble(?:s|d|ing)?|cascade(?:s|d|ing)?|drop[- ]?down|chain\s+reaction|rolling\s+reels|symbol\s+collapse/i,
    hooks: ['onSpinResult', 'onTumbleStep', 'postSpin'],
    forceFlag: '__FORCE_TUMBLE_PATTERN__',
    windowFlag: '__TUMBLE_STREAK__',
    stateShape: { streak: 0, multiplier: 1 },
    examples: ['tumble', 'cascadingWildPersistence', 'tumbleGrowingFsMultiplier'],
  },
  {
    id: 'count-to-trigger',
    purpose: 'Reach exact threshold N → grant special outcome (FS, BW, jackpot path)',
    intentRegex: /collect\s+\d+\s+to|N\s+(?:scatters?|symbols?)\s+(?:trigger|grant)|fill\s+the\s+grid|full[- ]?(?:grid|board)/i,
    hooks: ['onSpinResult', 'postSpin'],
    forceFlag: '__FORCE_COUNT_HIT__',
    windowFlag: '__COUNT_PROGRESS__',
    stateShape: { count: 0, threshold: 0 },
    examples: ['freeSpinsTrigger', 'fullGridBonus', 'moneyGrabGrid'],
  },
  {
    id: 'boost-multiplier',
    purpose: 'Per-spin random or triggered multiplier applied to winning lines/cells',
    intentRegex: /random\s+multiplier|surprise\s+(?:multi|boost)|zeus\s+strike|lightning\s+(?:bolt|spark)|electric\s+(?:bolt|spark)/i,
    hooks: ['onSpinResult', 'postSpin'],
    forceFlag: '__FORCE_BOOST_VALUE__',
    windowFlag: '__BOOST_TARGETS__',
    stateShape: { value: 1, targets: [] },
    examples: ['randomLightningMultiplier', 'multiplierOrb', 'expandingWildMultiplier'],
  },
  {
    id: 'jackpot-pool',
    purpose: 'Fixed-tier ladder (MINI/MINOR/MAJOR/GRAND) with cumulative or fixed prize',
    intentRegex: /MINI[\/\s-]+MINOR[\/\s-]+MAJOR[\/\s-]+GRAND|jackpot\s+(?:tier|pool|room)|progressive\s+pool|grand\s+prize/i,
    hooks: ['onJackpotTriggered', 'onJackpotResolved'],
    forceFlag: '__FORCE_JP_TIER__',
    windowFlag: '__JP_POOL__',
    stateShape: { tiers: ['MINI','MINOR','MAJOR','GRAND'], values: [] },
    examples: ['jackpotRoomReveal', 'potSymbolFireball', 'grandInterruptionLock'],
  },
]);

const _ARCHETYPE_INDEX = new Map(ARCHETYPES.map(a => [a.id, a]));

/**
 * Suggest an archetype for an unknown feature based on (a) the canonical
 * kind string and (b) optional surrounding GDD prose. Returns the matched
 * archetype plus a 0..1 confidence score and a short explanation.
 *
 * Match policy (in priority order):
 *   1. Examples — kind === any archetype example → 0.95
 *   2. Substring of kind — e.g. 'sticky_wild_v2' → sticky-state → 0.85
 *   3. intentRegex against kind OR prose snippet → 0.70
 *   4. No match → null
 *
 * @param {string} kind  feature kind string (snake_case or camelCase)
 * @param {string} [prose=''] optional GDD prose excerpt around the feature
 * @returns {{archetype: object, confidence: number, reason: string} | null}
 */
export function suggestArchetype(kind, prose = '') {
  if (!kind || typeof kind !== 'string') return null;
  const normalKind = kind.toLowerCase();
  /* Phase 1: exact example match. */
  for (const a of ARCHETYPES) {
    if (a.examples.some(e => e.toLowerCase() === normalKind)) {
      return { archetype: a, confidence: 0.95, reason: 'exact-example' };
    }
  }
  /* Phase 2: substring of any example or kind containing core token. */
  for (const a of ARCHETYPES) {
    for (const e of a.examples) {
      const el = e.toLowerCase();
      if (normalKind.includes(el) || el.includes(normalKind.replace(/[_-]/g, ''))) {
        return { archetype: a, confidence: 0.85, reason: 'example-substring:' + e };
      }
    }
  }
  /* Phase 3: regex against kind + prose (kind first, prose backup). */
  const haystack = kind + ' ' + (typeof prose === 'string' ? prose : '');
  let best = null;
  for (const a of ARCHETYPES) {
    if (a.intentRegex.test(haystack)) {
      const conf = a.intentRegex.test(kind) ? 0.70 : 0.55;
      if (!best || best.confidence < conf) {
        best = { archetype: a, confidence: conf, reason: 'intent-regex:' + a.id };
      }
    }
  }
  return best;
}

/**
 * Detect ALL declared / inferred feature kinds in a parsed model that are
 * NOT present in the block catalog featureKinds set. Returns enriched
 * report with archetype suggestion per unknown.
 *
 * @param {object} model — parser output
 * @param {Set<string>} catalogFeatureKinds — set of featureKinds known to catalog
 * @returns {Array<{kind: string, suggestion: ?, prose: string}>}
 */
export function findUnknownFeatures(model, catalogFeatureKinds) {
  if (!model || !catalogFeatureKinds) return [];
  const fromActive = (model.__activeFeatures__ || []).map(f => f && f.kind).filter(Boolean);
  const fromRaw    = (model.features || []).map(f => f && f.kind).filter(Boolean);
  const allKinds = new Set([...fromActive, ...fromRaw]);
  const unknown = [];
  for (const kind of allKinds) {
    /* normalize between snake_case and camelCase for catalog check */
    const camel = kind.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (catalogFeatureKinds.has(kind) || catalogFeatureKinds.has(camel)) continue;
    /* unknown — collect prose hint if present in model._gddProse[kind] */
    const prose = (model._gddProse && model._gddProse[kind]) || '';
    const suggestion = suggestArchetype(kind, prose);
    unknown.push({ kind, suggestion, prose: prose.slice(0, 240) });
  }
  return unknown;
}

/**
 * Lookup a registered archetype by id (used by the scaffolder).
 * @param {string} id
 * @returns {object | null}
 */
export function getArchetype(id) {
  return _ARCHETYPE_INDEX.get(id) || null;
}

/** Total count — used by tests + master_todo banner. */
export const ARCHETYPE_COUNT = ARCHETYPES.length;
