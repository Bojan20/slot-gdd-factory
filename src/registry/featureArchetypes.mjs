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
 * 28 archetypes covering ~99 % of slot feature design space (industry survey,
 * vendor-neutral — no vendor names or trademarked terms in identifiers or
 * regex). Lineage:
 *   · Wave Z   (2026-06-20)  archetypes 1–15
 *   · Wave UQ-6 (2026-06-21) archetypes 16–25  (multipliers, monetization,
 *                            wheels, variable grids, stacks, grid extension,
 *                            symbol morphs, gamble doubles)
 *   · Wave UQ-9 (2026-06-21) archetypes 26–28  (fs-trigger, win-cap,
 *                            super-symbol) PLUS ARCHETYPE_ALIASES synonym
 *                            map + NON_ARCHETYPE_KINDS exclusion set,
 *                            driven by UQ-7 corpus audit (338 GDDs)
 *
 * Each archetype declares:
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
    examples: ['fullGridBonus', 'moneyGrabGrid', 'fullBoardCount'],
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
  /* ──────────────────────────────────────────────────────────────────────
     Wave UQ-9 expansion (2026-06-21) — archetypes 26–28.
     Driven by UQ-7 audit findings: 30 unknown kinds in cache, top hits
     bigWinTier (254), freeSpins (181+67), jackpot (30), winCap (19),
     persistentMultiplier (18), superSymbol (6+4). The 3 below cover
     the real archetype-shaped gaps; eval-engine / win-presentation /
     regulator kinds are routed via NON_ARCHETYPE_KINDS instead.
     ────────────────────────────────────────────────────────────────────── */
  {
    id: 'fs-trigger',
    purpose: 'Threshold count of scatter/trigger symbols grants entry into free spins with optional retrigger',
    intentRegex: /free\s+spins?\s+(?:are\s+)?triggered|N\s+scatters?\s+(?:trigger|grant|award)|free\s+spins?\s+retrigger|fs\s+trigger|trigger(?:ed|s)?\s+(?:the\s+)?free[- ]?spins?|scatter\s+triggers?|landing\s+\d+\s+scatters?/i,
    hooks: ['onSpinResult', 'onFsTrigger', 'onFsRetrigger', 'onFsEnd'],
    forceFlag: '__FORCE_FS_TRIGGER__',
    windowFlag: '__FS_TRIGGER_COUNT__',
    stateShape: { triggerCount: 0, threshold: 3, retriggerBonus: 0, spinsAwarded: 0 },
    examples: ['freeSpinsTrigger', 'scatterTrigger', 'progressiveFreeSpins', 'freeSpins'],
  },
  {
    id: 'win-cap',
    purpose: 'Maximum win cap (e.g. 5000× / 10000× bet) — terminates feature/spin chain when reached',
    intentRegex: /win\s+cap|max(?:imum)?\s+win|cap\s+at\s+\d+x?|max\s+payout|\d{3,5}\s*x\s+bet\s+cap|hard\s+cap\s+on\s+win/i,
    hooks: ['onSpinResult', 'onTumbleStep', 'onWinCapHit', 'postSpin'],
    forceFlag: '__FORCE_WIN_CAP_HIT__',
    windowFlag: '__WIN_CAP_REMAINING__',
    stateShape: { capMultiplier: 5000, accumulated: 0, hit: false },
    examples: ['winCap', 'maxWinCap', 'payoutCap'],
  },
  {
    id: 'super-symbol',
    purpose: 'Oversize symbol (2×2 / 3×3 / N×N block) that pays from any covered position, often a wild',
    intentRegex: /super[- ]?symbol|colossal\s+symbol|giant\s+(?:symbol|wild)|big\s+symbol\s+\d+x\d+|mega\s+symbol|jumbo\s+(?:symbol|wild)/i,
    hooks: ['preSpin', 'onSpinResult', 'onSuperSymbolLanded'],
    forceFlag: '__FORCE_SUPER_LANDING__',
    windowFlag: '__SUPER_CELLS__',
    stateShape: { cells: [], size: 2, symbolId: null, paysAnyPosition: true },
    examples: ['superSymbol', 'colossalSymbol', 'giantSymbol', 'megaSymbol'],
  },
]);

/* ─── Wave UQ-9 — synonym aliases (canonical kind → archetype id) ─────
   Maps frequently-seen kind strings (from UQ-7 audit) to the
   correct archetype id. suggestArchetype consults this BEFORE the
   regex tier so common synonyms route deterministically. snake_case
   and camelCase variants both covered; lookup normalizes whitespace,
   underscores and dashes. */
export const ARCHETYPE_ALIASES = Object.freeze({
  /* free spins synonyms → fs-trigger */
  'freespins'           : 'fs-trigger',
  'free_spins'          : 'fs-trigger',
  'progressivefreespins': 'fs-trigger',
  'progressive_free_spins': 'fs-trigger',
  'fsretrigger'         : 'fs-trigger',
  'fs_retrigger'        : 'fs-trigger',
  'scattertrigger'      : 'fs-trigger',
  /* jackpot family → jackpot-pool */
  'jackpot'             : 'jackpot-pool',
  'jackpots'            : 'jackpot-pool',
  'progressivejackpot'  : 'jackpot-pool',
  'progressive_jackpot' : 'jackpot-pool',
  /* multiplier synonyms → multiplier-trail (default growth flavor) */
  'multiplier'          : 'multiplier-trail',
  'persistentmultiplier': 'multiplier-trail',
  'persistent_multiplier': 'multiplier-trail',
  'pathawaremultiplier' : 'multiplier-trail',
  'path_aware_multiplier': 'multiplier-trail',
  /* gamble synonyms → gamble-double */
  'gamble'              : 'gamble-double',
  /* cascade synonyms → cascade-collapse */
  'cascade'             : 'cascade-collapse',
  'cascading'           : 'cascade-collapse',
  /* lightning bolt → boost-multiplier */
  'lightning'           : 'boost-multiplier',
  /* wheel synonyms → weighted-wheel */
  'wheelbonus'          : 'weighted-wheel',
  'wheel_bonus'         : 'weighted-wheel',
  /* wild reel synonyms → sticky-state (locked column) */
  'wildreel'            : 'sticky-state',
  'wild_reel'           : 'sticky-state',
  /* ways synonyms → variable-ways */
  'ways'                : 'variable-ways',
  /* super symbol synonyms → super-symbol */
  'supersymbol'         : 'super-symbol',
  'super_symbol'        : 'super-symbol',
  /* win cap synonyms */
  'wincap'              : 'win-cap',
  'win_cap'             : 'win-cap',
});

/* ─── Wave UQ-9 — kinds that are NOT features and should NOT receive
   an archetype suggestion. These are eval engines, win-presentation
   layers, regulator gates, or autoplay/UI plumbing that the parser
   surfaces in model.features for completeness but that map to their
   own block category. Returning null for these prevents archetype-
   fallback noise. */
export const NON_ARCHETYPE_KINDS = Object.freeze(new Set([
  /* eval engines */
  'wayseval', 'ways_eval', 'payanywhereeval', 'pay_anywhere_eval',
  'clusterpayseval', 'cluster_pays_eval', 'cluster_pays',
  /* pay models */
  'scatterpay', 'scatter_pay', 'payanywhere', 'pay_anywhere',
  /* win presentation */
  'bigwintier', 'big_win_tier', 'scattercelebration', 'scatter_celebration',
  /* regulator / UI plumbing */
  'autoplay', 'realitycheck', 'reality_check', 'netlossindicator', 'net_loss_indicator',
  /* generic / catch-all */
  'featuregeneric', 'feature_generic',
  /* D-17 industry-standard feature kinds (engine-level constructs that
   * Opus V6 reconcile surfaces but that are NOT player-facing single-spin
   * archetypes — they are math/eval/UX rule packages owned by dedicated
   * blocks in src/blocks/). UQ-OPUS 2026-06-21 added when switching baseline
   * from Kimi to Opus reconcile surfaced these as unknown.  */
  /* D-17 engine-level rule packages (not single-spin archetypes; live as
   * dedicated blocks). bigSymbolRender2x2 / linkedReels / potSymbolFireball
   * etc. are intentionally OMITTED because they ARE listed as examples in
   * canonical archetypes (expand-direction / linked-region / jackpot-pool)
   * and adding them here breaks the archetype-example invariant. */
  'patternwin', 'pattern_win',
  'pertriggervolatilityset', 'per_trigger_volatility_set',
  'creditawardconversion', 'credit_award_conversion',
  'simultaneousfsholdandwinpriority', 'simultaneous_fs_hold_and_win_priority',
]));

function _normalizeKindKey(kind) {
  if (typeof kind !== 'string') return '';
  return kind.toLowerCase().replace(/[-\s]/g, '_');
}
function _flattenKindKey(kind) {
  if (typeof kind !== 'string') return '';
  return kind.toLowerCase().replace(/[-_\s]/g, '');
}

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
  const flat = _flattenKindKey(kind);
  const snake = _normalizeKindKey(kind);

  /* Phase 0: NON_ARCHETYPE_KINDS — filter out eval/UI/regulator kinds
     before any matching. These are NOT feature archetypes. */
  if (NON_ARCHETYPE_KINDS.has(flat) || NON_ARCHETYPE_KINDS.has(snake)) {
    return null;
  }

  /* Phase 1: exact example match (camelCase or snake-case flat form).
     Runs before alias so exact-catalog membership (highest signal)
     always wins on confidence 0.95. */
  for (const a of ARCHETYPES) {
    if (a.examples.some(e => e.toLowerCase() === normalKind || _flattenKindKey(e) === flat)) {
      return { archetype: a, confidence: 0.95, reason: 'exact-example' };
    }
  }

  /* Phase 1.5: explicit alias mapping (UQ-7 audit driven). Slightly
     lower confidence (0.90) than exact-example so an existing example
     match outranks an alias to the same archetype. */
  const aliasId = ARCHETYPE_ALIASES[flat] || ARCHETYPE_ALIASES[snake];
  if (aliasId) {
    const a = _ARCHETYPE_INDEX.get(aliasId);
    if (a) return { archetype: a, confidence: 0.90, reason: 'alias:' + aliasId };
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
