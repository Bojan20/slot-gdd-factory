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
 * 25 archetypes covering ~99 % of slot feature design space (industry survey,
 * vendor-neutral — no vendor names or trademarked terms in identifiers or
 * regex; Wave UQ-6 expansion 2026-06-21 added archetypes 16–25 covering
 * progressive multipliers, monetization side-bets, wheels, variable grids,
 * wild-carried multipliers, stacks, grid extension, symbol morphs and
 * gamble doubles). Each archetype declares:
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
    examples: ['bonusCollector', 'coinCollect', 'pieceCollector'],
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
    examples: ['mysterySymbol', 'mysteryWildReveal', 'mysterySymbolReveal'],
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
    examples: ['tumble', 'cascadingWildPersistence', 'tumbleChainReaction'],
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
  /* ──────────────────────────────────────────────────────────────────────
     Wave UQ-6 expansion (2026-06-21) — archetypes 16–25.
     Coverage gaps identified by LW-29 / WoO-GDD scan + parser-pool V3
     feature reports. Adding these reduces archetype-fallback rate from
     ~12 % → projected ~3 % across the 338-GDD corpus.
     ────────────────────────────────────────────────────────────────────── */
  {
    id: 'multiplier-trail',
    purpose: 'Win/tumble counter drives a persistent multiplier ladder that grows then resets',
    intentRegex: /(?:tumble|cascade|win|spin)\s+multiplier\s+(?:ladder|trail|progression)|multiplier\s+(?:ladder|trail)\b|multiplier\s+(?:rises|grows|increments|increases|climbs)|increments?\s+(?:the\s+)?multiplier|progressive\s+(?:fs\s+|free\s+spins?\s+)?multiplier|growing\s+multiplier/i,
    hooks: ['onSpinResult', 'onTumbleStep', 'postSpin', 'onFsSpinResult'],
    forceFlag: '__FORCE_TRAIL_STEP__',
    windowFlag: '__TRAIL_VALUE__',
    stateShape: { current: 1, ladder: [1, 2, 3, 5, 10], step: 0 },
    examples: ['tumbleGrowingFsMultiplier', 'fsProgressiveMultiplier', 'cascadeMultiplierLadder'],
  },
  {
    id: 'feature-purchase',
    purpose: 'Player directly purchases entry into a feature (free spins / bonus / wheel) at cost C',
    intentRegex: /(?:bonus|feature)\s+buy|buy[- ]?(?:in|the[-\s]+(?:bonus|feature|free[-\s]?spins?))|purchas(?:e|ing)\s+(?:free[-\s]?spins?|bonus|feature)|ante\s+to\s+enter/i,
    hooks: ['onPurchaseClicked', 'onPurchaseConfirmed', 'onFsTrigger'],
    forceFlag: '__FORCE_PURCHASE_OPTION__',
    windowFlag: '__PURCHASE_PENDING__',
    stateShape: { offered: [], selectedId: null, costMultiplier: 0 },
    examples: ['bonusBuy', 'bonusBuyMenu', 'bonusBuyDeterministic'],
  },
  {
    id: 'side-bet',
    purpose: 'Optional ladder/toggle bet increases trigger weight, scatter pay, or boosts a sub-feature',
    intentRegex: /ante[- ]?bet|side[- ]?bet|extra[- ]?bet|bet\s+(?:ladder|booster|topper)|boost(?:ed|s)?\s+(?:scatter|trigger|weight)/i,
    hooks: ['preSpin', 'onBetChanged', 'onSpinResult'],
    forceFlag: '__FORCE_SIDEBET_TIER__',
    windowFlag: '__SIDEBET_ACTIVE__',
    stateShape: { tier: 0, multiplier: 1, scatterWeightDelta: 0 },
    examples: ['anteBet', 'anteBetLadder', 'extraBetTrigger'],
  },
  {
    id: 'weighted-wheel',
    purpose: 'Wheel/dial spin draws an outcome from a weighted pool (prize / FS count / multiplier)',
    intentRegex: /(?:weighted|prize|fortune|bonus)\s+wheel|spin\s+the\s+wheel|wheel[- ]?(?:bonus|spin|game)|dial\s+(?:spin|stops)/i,
    hooks: ['onWheelStart', 'onWheelStop', 'onWheelResolved'],
    forceFlag: '__FORCE_WHEEL_INDEX__',
    windowFlag: '__WHEEL_RESULT__',
    stateShape: { segments: [], weights: [], result: null },
    examples: ['weightedWheelBonus', 'fortuneWheel', 'jackpotWheel'],
  },
  {
    id: 'variable-ways',
    purpose: 'Per-spin reel heights vary; pay-ways count is the product of landed row heights',
    intentRegex: /variable\s+(?:reel\s+heights?|row\s+count|symbols?\s+per\s+reel)|up\s+to\s+(?:117|65|46)[,.]?\d*\s+ways|ways\s+(?:count\s+)?(?:varies|scales|expands)|variable[- ]ways|expanding\s+rows/i,
    hooks: ['preSpin', 'onSpinResult', 'onTumbleStep'],
    forceFlag: '__FORCE_REEL_HEIGHTS__',
    windowFlag: '__WAYS_COUNT__',
    stateShape: { heights: [], waysCount: 0, mode: 'base' },
    examples: ['variableReelHeights', 'expandingWays', 'allWaysVariable'],
  },
  {
    id: 'wild-multiplier',
    purpose: 'Wild substitution carries its own multiplier that applies to all lines through it',
    intentRegex: /wild\s+(?:carries|has|with|holds|bears)\s+(?:a\s+)?multiplier|multiplier\s+wild|wild\s+multiplier\s+(?:value|x|times)|x\d+\s+wild/i,
    hooks: ['onSpinResult', 'onWildLanded', 'onLineWin'],
    forceFlag: '__FORCE_WILD_MULT_VALUE__',
    windowFlag: '__WILD_MULT_CELLS__',
    stateShape: { cells: [], values: [], combineMode: 'multiply' },
    examples: ['wildMultiplier', 'multiplierWild', 'fsWildMultiplier'],
  },
  {
    id: 'stacked-symbols',
    purpose: 'Symbols land in vertical stacks of N (2x1, 3x1, full-reel) on one or more reels',
    intentRegex: /stack(?:ed|s|ing)?\s+(?:symbols?|wild|reel|paying)|full[- ]?reel\s+(?:stack|wild|symbol)|symbol\s+stacks?\s+of\s+\d+/i,
    hooks: ['preSpin', 'onSpinResult'],
    forceFlag: '__FORCE_STACK_TARGET__',
    windowFlag: '__STACK_REELS__',
    stateShape: { reels: [], symbolIds: [], stackHeight: 0 },
    examples: ['stackedSymbols', 'fullReelStack', 'stackedWildFs'],
  },
  {
    id: 'reel-extender',
    purpose: 'Extra reels/rows are appended to the grid when a trigger condition fires (infinite reels)',
    intentRegex: /infinite\s+(?:reels|rows)|extra\s+(?:reels|rows)\s+(?:are\s+|were\s+|got\s+)?(?:added|appended|reveal)|expand(?:s|ed|ing)?\s+(?:to|the)\s+grid|grow(?:s|ing)?\s+the\s+grid|grid\s+(?:grow(?:s|ing)?|expands?)|added\s+(?:reels|rows)/i,
    hooks: ['onSpinResult', 'onGridExtended', 'postSpin'],
    forceFlag: '__FORCE_EXTEND_COUNT__',
    windowFlag: '__EXTEND_REELS__',
    stateShape: { extraReels: 0, extraRows: 0, maxExtra: 6 },
    examples: ['infiniteReels', 'reelExtender', 'gridGrowFs'],
  },
  {
    id: 'morph-progressive',
    purpose: 'Symbols upgrade through tier sequence on each successive landing/tumble (low → mid → high)',
    intentRegex: /symbol\s+(?:upgrade|level\s*up|morph|evolve)|upgrade(?:s|d|ing)?\s+(?:from|to)\s+(?:low|mid|high)|tier(?:s|ed)?\s+(?:morph|progression)|symbol\s+ladder/i,
    hooks: ['onTumbleStep', 'onSpinResult', 'onSymbolUpgraded'],
    forceFlag: '__FORCE_MORPH_TIER__',
    windowFlag: '__MORPH_CELLS__',
    stateShape: { cells: [], tier: 0, tierMap: [] },
    examples: ['symbolUpgrade', 'cellLevelUpgrade', 'tieredSymbolMorph'],
  },
  {
    id: 'gamble-double',
    purpose: 'Player risks last win on a 50/50 (color/suit/coin-flip) pick to double or lose',
    intentRegex: /gamble\s+(?:feature|round|button)|double[- ]?(?:or[- ]?nothing|up)|risk\s+(?:your|the)\s+win|red\s+or\s+black|coin\s+flip\s+(?:double|gamble)/i,
    hooks: ['onGambleOffered', 'onGambleChoice', 'onGambleResolved'],
    forceFlag: '__FORCE_GAMBLE_PICK__',
    windowFlag: '__GAMBLE_STAKE__',
    stateShape: { stake: 0, rounds: 0, maxRounds: 5, outcome: null },
    examples: ['gambleDouble', 'gambleColorSuit', 'doubleUpFeature'],
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
  /* Phase 3: regex against kind + prose (kind first, prose backup).
     When multiple archetypes regex-match, tiebreak by length of the
     matched substring — a longer match is presumed more specific.
     This prevents short generic words (e.g. "ladder") from out-ranking
     compound matches (e.g. "tumble multiplier ladder"). */
  const haystack = kind + ' ' + (typeof prose === 'string' ? prose : '');
  let best = null;
  let bestMatchLen = -1;
  for (const a of ARCHETYPES) {
    const m = haystack.match(a.intentRegex);
    if (!m) continue;
    const conf = a.intentRegex.test(kind) ? 0.70 : 0.55;
    const matchLen = m[0].length;
    if (
      !best ||
      conf > best.confidence ||
      (conf === best.confidence && matchLen > bestMatchLen)
    ) {
      best = { archetype: a, confidence: conf, reason: 'intent-regex:' + a.id };
      bestMatchLen = matchLen;
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
