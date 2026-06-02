/**
 * Slot GDD Factory · pure parser module
 * No DOM, no globals — safe to import from Node tests and from app.js.
 *
 * Public API:
 *   parseGDD(text, ext) → ParsedModel
 *   normalizeFromJSON(obj) → ParsedModel
 *
 * ParsedModel shape:
 *   { name, theme: {tags, palette, mood}, topology: {reels, rows, paylines},
 *     symbols: {high[], mid[], low[], specials[]},
 *     features: [{kind, label}],
 *     confidence: {name, topology, symbols, features} }
 *
 * Math (RTP / volatility / max-win / paytable / reel weights) is OUT OF SCOPE
 * of this phase. Boki explicit decree — "nikakva matematika se ne radi dok ne
 * odradimo savrseno game gdd". Math layer lands in a later phase with PAR
 * hot-swap injector, not here.
 */

export function parseGDD(text, ext) {
  if (ext === 'json') {
    return normalizeFromJSON(JSON.parse(text));
  }
  // md / markdown / txt — regex / table parser
  return parseMarkdownGDD(text);
}

/* ─── markdown GDD parser ──────────────────────────────────── */
export function parseMarkdownGDD(text) {
  const model = freshModel();

  /* name — H1 heading, or "Internal name" table cell */
  const h1 = text.match(/^#\s+(.+?)(?:\s+—|\s+-|\s+:|\s+\(|$)/m);
  if (h1) {
    model.name = h1[1].trim();
    model.confidence.name += 0.5;
  }
  const internalName = text.match(/\|\s*\*?\*?Internal name\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (internalName) {
    model.name = internalName[1].replace(/\*\*/g, '').trim();
    model.confidence.name = 1.0;
  }

  /* theme tags */
  const themeTags = text.match(/\|\s*\*?\*?Theme tags\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (themeTags) {
    model.theme.tags = themeTags[1]
      .replace(/\*\*/g, '')
      .split(/[·•,\/]/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  /* mood */
  const mood = text.match(/\|\s*\*?\*?Mood\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (mood) model.theme.mood = mood[1].replace(/\*\*/g, '').trim();

  /* color palette — hex codes */
  const hexes = text.match(/#[0-9a-fA-F]{6}/g);
  if (hexes) model.theme.palette = [...new Set(hexes)].slice(0, 6);

  /* setting — physical/narrative place */
  const setting = text.match(/\|\s*\*?\*?Setting\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (setting) model.theme.setting = setting[1].replace(/\*\*/g, '').trim();

  /* typography — Display + UI font hints (game-side, no math) */
  const typo = text.match(/\|\s*\*?\*?Typography\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (typo) model.theme.typography = typo[1].replace(/\*\*/g, '').trim();

  /* vibe references — narrative anchor phrases */
  const vibe = text.match(/\|\s*\*?\*?Vibe\s+references?\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (vibe) model.theme.vibe_refs = vibe[1].replace(/\*\*/g, '').trim();

  /* genre — top-level slot subtype */
  const genre = text.match(/\|\s*\*?\*?Genre\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (genre) model.theme.genre = genre[1].replace(/\*\*/g, '').trim();

  /* target market — global / region-locked */
  const market = text.match(/\|\s*\*?\*?Target\s+market\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (market) model.theme.target_market = market[1].replace(/\*\*/g, '').trim();

  /* topology */
  const reels =
    text.match(/\|\s*\*?\*?Reels\*?\*?\s*\|\s*(\d+)(?:\s+columns?)?\s*\|/i) ||
    text.match(/\|\s*\*?\*?Reels\*?\*?\s*\|\s*[^|]*?(\d+)\s+columns?[^|]*\|/i);
  const rows =
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*(\d+)(?:\s+visible)?\s*\|/i) ||
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*[^|]*?(\d+)\s+visible[^|]*\|/i);
  const lines = text.match(/\|\s*\*?\*?Paylines\*?\*?\s*\|\s*(\d+)/i);
  if (reels) {
    model.topology.reels = parseInt(reels[1], 10);
    model.confidence.topology += 0.4;
  }
  if (rows) {
    model.topology.rows = parseInt(rows[1], 10);
    model.confidence.topology += 0.4;
  }
  if (lines) {
    model.topology.paylines = parseInt(lines[1], 10);
    model.confidence.topology += 0.2;
  }

  /* evaluation kind — cluster / ways / lines (game-flow, not math) */
  const evalCell = text.match(/\|\s*\*?\*?Evaluation\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (evalCell) {
    const v = evalCell[1].toLowerCase();
    if (/cluster/.test(v)) model.topology.evaluation = 'cluster';
    else if (/ways/.test(v)) model.topology.evaluation = 'ways';
    else if (/line/.test(v)) model.topology.evaluation = 'lines';
  }
  /* fallback — infer from prose */
  if (!model.topology.evaluation) {
    if (/\bcluster[\s_-]?pays?\b/i.test(text)) model.topology.evaluation = 'cluster';
    else if (/\b(?:243|576|1024|3125|117649)\s*ways?\b|\bways?\s+to\s+win\b/i.test(text)) model.topology.evaluation = 'ways';
    else model.topology.evaluation = 'lines';
  }
  /* cluster games don't use paylines — null it out to avoid confusion */
  if (model.topology.evaluation === 'cluster') {
    model.topology.paylines = null;
    model.confidence.topology += 0.2;
  }

  /* symbols */
  extractSymbolBlock(text, /High[\s-]?pay/i, model.symbols.high);
  extractSymbolBlock(text, /Mid[\s-]?pay/i, model.symbols.mid);
  extractSymbolBlock(text, /Low[\s-]?pay/i, model.symbols.low);
  extractSymbolBlock(text, /Specials?/i, model.symbols.specials);
  const totalSyms =
    model.symbols.high.length +
    model.symbols.mid.length +
    model.symbols.low.length +
    model.symbols.specials.length;
  if (totalSyms > 0) model.confidence.symbols = Math.min(1, totalSyms / 8);

  /* features */
  model.features = extractFeatures(text);
  if (model.features.length > 0) {
    model.confidence.features = Math.min(1, model.features.length / 3);
  }

  // math (RTP / volatility / max-win) intentionally NOT extracted in this phase.

  return model;
}

/* ─── helper: symbol table rows under a heading ────────────── */
export function extractSymbolBlock(text, headingRegex, sink) {
  const headingMatch = text.match(new RegExp(`###[^\\n]*${headingRegex.source}[^\\n]*`, 'i'));
  if (!headingMatch) return;
  const start = headingMatch.index + headingMatch[0].length;
  const rest = text.slice(start, start + 4000);
  const end = rest.search(/\n##\s|\n###\s/);
  const chunk = end >= 0 ? rest.slice(0, end) : rest;
  // accept table rows like: | `D` | Diamond | … | or | D | Diamond | … |
  const rowRe = /\|\s*`?([A-Za-z0-9_]{1,4})`?\s*\|\s*([^|]+?)\s*\|/g;
  let m;
  while ((m = rowRe.exec(chunk)) !== null) {
    const id = m[1].trim();
    const name = m[2].trim();
    if (id.toLowerCase() === 'id' || name.toLowerCase() === 'name') continue;
    if (id.length > 4) continue;
    sink.push({ id, name });
  }
}

/* ─── helper: feature kinds from prose ─────────────────────── */
export function extractFeatures(rawText) {
  // (a) strip explicit "out of scope" / "non-features" SECTIONS so a body-
  //     level "cascade" inside them doesn't fire.
  let text = rawText.replace(
    /#{2,3}\s*(?:\d+\.\s*)?(?:Out[\s-]of[\s-]scope|Explicit non-features|Not in this product)[^#]*(?=#{2,3}|\Z)/gis,
    ''
  );

  // (b) strip individual TABLE ROWS that explicitly negate a feature —
  //     e.g. "| Tumble / cascade mechanic | Not in this product — fixed-reel slot |"
  //     or  "| Cascade | N/A |" / "| Cascade | Disabled |" / "| Cascade | None |"
  text = text.replace(
    /^\|[^\n|]*?\|[^\n|]*?\b(?:not\s+in\s+this\s+product|out\s+of\s+scope|none|n\/a|disabled|excluded|—|–)\b[^\n|]*?\|.*$/gim,
    ''
  );

  // (b2) strip prose lines that explicitly negate a feature —
  //      e.g. "Crystal Forge has no Bonus Orb / Hold & Win."
  //      "This game has no cascade." / "no Free Spins in this product".
  text = text.replace(
    /^[^\n]*\b(?:has\s+no|with\s*no|without|game\s+has\s+no|no\s+(?:Bonus\s+Orb|Hold\s*&\s*Win|Free\s+Spins|Cascade|Multiplier|Wild|Scatter|Lightning|Respin))\b[^\n]*$/gim,
    ''
  );

  // (c) patterns — for features that are commonly described in passing
  //     (cascade is *also* an animation noun) require an explicit mechanic
  //     qualifier so VFX language like "coin cascade" doesn't false-positive.
  const patterns = [
    { kind: 'free_spins', re: /\bfree[\s-]?spins?\b/i, label: 'Free Spins' },
    {
      kind: 'hold_and_win',
      // GDDs spell it three ways: "Hold and Win", "Hold & Win", "H&W".
      re: /\bhold\s*(?:and|&)\s*win\b|\bH\s*&\s*W\b/i,
      label: 'Hold & Win',
    },
    {
      kind: 'cascade',
      // Must be the slot mechanic — require a slot-context qualifier so
      // "coin cascade" / "200 ms cascade" (animation language) don't fire.
      // Allow 0-2 words between the noun and qualifier so phrases like
      // "Cascade chain mechanic" pass.
      re: /\b(?:cascad(?:e|ing)|tumbl(?:e|ing)|avalanche)(?:\s+\w+){0,2}\s+(?:mechanic|feature|engine|reel|reels|round|game|win|wins|pays?|symbols?)\b|\bReel\s+mechanism\s*[—:|]\s*Cascade\b/i,
      label: 'Cascade / Tumble',
    },
    { kind: 'multiplier', re: /\bmultiplier(s)?\b/i, label: 'Multiplier' },
    { kind: 'expanding_wild', re: /\bexpanding[\s_-]?wild/i, label: 'Expanding Wild' },
    { kind: 'walking_wild', re: /\bwalking[\s_-]?wild/i, label: 'Walking Wild' },
    { kind: 'sticky_wild', re: /\bsticky[\s_-]?wild/i, label: 'Sticky Wild' },
    { kind: 'mystery_symbol', re: /\bmystery[\s_-]?symbol/i, label: 'Mystery Symbol' },
    {
      kind: 'bonus_buy',
      // "Bonus Buy" / "Buy Feature" / "Feature Buy" — direct entry purchase.
      re: /\bbonus[\s_-]?buy\b|\bbuy[\s_-]?(?:feature|bonus|fs)\b|\bfeature[\s_-]?buy\b/i,
      label: 'Bonus Buy',
    },
    { kind: 'bonus_pick', re: /\bpick[\s_-]?(bonus|me)\b(?!\s*axe)/i, label: 'Bonus Pick' },
    { kind: 'wheel_bonus', re: /\bwheel\s+bonus|bonus\s+wheel/i, label: 'Wheel Bonus' },
    { kind: 'cluster_pays', re: /\bcluster[\s_-]?pays?\b/i, label: 'Cluster Pays' },
    {
      kind: 'ways',
      re: /\b(?:243|576|1024|3125|117649)\s*ways?\b|\bways?\s+to\s+win\b/i,
      label: 'Ways',
    },
    { kind: 'scatter_pay', re: /\bscatter\s+pays?\b/i, label: 'Scatter Pay' },
    {
      kind: 'lightning',
      // Require a feature qualifier — naked "lightning" (color, sprite,
      // theme) is too generic in mythology-themed games.
      re: /\blightning[\s_-]?(?:multiplier|spark|strike|feature)\b/i,
      label: 'Lightning',
    },
    { kind: 'respin', re: /\brespin/i, label: 'Respin' },
    { kind: 'wild_reel', re: /\bwild[\s_-]?reel/i, label: 'Wild Reel' },
    { kind: 'gamble', re: /\bgamble\s+(feature|ladder|round)\b/i, label: 'Gamble' },
    { kind: 'ante_bet', re: /\bante[\s_-]?bet\b/i, label: 'Ante Bet' },
    {
      kind: 'super_symbol',
      // 2×2, 3×3, 4×4 colossal symbol — game-design vocabulary.
      re: /\b(?:super[\s_-]?symbol|colossal[\s_-]?symbol|mega[\s_-]?symbol|giant[\s_-]?symbol)\b/i,
      label: 'Super Symbol',
    },
    {
      kind: 'win_cap',
      // Regulator-mandated terminator. Phrase patterns: "Win Cap", "Max Win Cap",
      // "Cap Reached" — strictly game-flow noun, not a math value.
      re: /\bwin[\s_-]?cap\b|\bcap[\s_-]?reached\b|\bmax[\s_-]?win[\s_-]?cap\b/i,
      label: 'Win Cap',
    },
    {
      kind: 'persistent_multiplier',
      // FS multiplier that doesn't reset within the round.
      re: /\bpersistent[\s_-]?multiplier\b|\bmultiplier\s+(?:never\s+resets|grows\s+with)|\bgrows\s+with\s+each\s+cascade\b/i,
      label: 'Persistent Multiplier',
    },
  ];

  const out = [];
  const seen = new Set();
  for (const p of patterns) {
    if (p.re.test(text) && !seen.has(p.kind)) {
      out.push({ kind: p.kind, label: p.label });
      seen.add(p.kind);
    }
  }
  // respin is usually a sub-mechanic of H&W — de-dupe.
  if (seen.has('hold_and_win') && seen.has('respin')) {
    return out.filter(f => f.kind !== 'respin');
  }
  return out;
}

// extractMathSignals removed — math is out of scope this phase.

/* ─── JSON GDD passthrough (IR shape) ──────────────────────── */
export function normalizeFromJSON(obj) {
  const model = freshModel();
  model.name = obj.name || obj.gameId || obj.title || 'Untitled (JSON)';
  model.theme = obj.theme || model.theme;
  model.topology = obj.topology || obj.layout || model.topology;
  model.symbols = obj.symbols || model.symbols;
  model.features = (obj.features || []).map(f => ({
    kind: f.kind || f.type || 'unknown',
    label: f.label || f.name || f.kind || 'Feature',
  }));
  model.confidence = { name: 1, topology: 1, symbols: 1, features: 1 };
  return model;
}

/* ─── factory ──────────────────────────────────────────────── */
function freshModel() {
  return {
    name: 'Untitled Slot',
    theme: {
      tags: [],
      palette: [],
      mood: '',
      setting: '',
      typography: '',
      vibe_refs: '',
      genre: '',
      target_market: '',
    },
    topology: { reels: 5, rows: 3, paylines: 10, evaluation: null },
    symbols: { high: [], mid: [], low: [], specials: [] },
    features: [],
    confidence: { name: 0, topology: 0, symbols: 0, features: 0 },
  };
}
