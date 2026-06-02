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
 *     rtp: number|null, volatility: 'low'|'medium'|'high'|'ultra'|null,
 *     maxWin: number|null,
 *     confidence: {name, topology, symbols, features, math} }
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

  /* math signals — RTP, volatility, max-win — present in many GDDs and
     in companion *_MATH_GDD.md files. Hits boost the math confidence. */
  extractMathSignals(text, model);

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
  // strip "out of scope" / "non-features" sections so negated mentions
  // (e.g. "cascade — Not in this product") don't false-positive.
  let text = rawText.replace(
    /#{2,3}\s*(?:\d+\.\s*)?(?:Out[\s-]of[\s-]scope|Explicit non-features|Not in this product)[^#]*(?=#{2,3}|\Z)/gis,
    ''
  );

  const patterns = [
    { kind: 'free_spins', re: /\bfree[\s-]?spins?\b/i, label: 'Free Spins' },
    { kind: 'hold_and_win', re: /\bhold[\s_-]?and[\s_-]?win\b|\bH&W\b/i, label: 'Hold & Win' },
    { kind: 'cascade', re: /\bcascad(e|ing)\b|\btumbl(e|ing)\b/i, label: 'Cascade / Tumble' },
    { kind: 'multiplier', re: /\bmultiplier(s)?\b/i, label: 'Multiplier' },
    { kind: 'expanding_wild', re: /\bexpanding[\s_-]?wild/i, label: 'Expanding Wild' },
    { kind: 'walking_wild', re: /\bwalking[\s_-]?wild/i, label: 'Walking Wild' },
    { kind: 'sticky_wild', re: /\bsticky[\s_-]?wild/i, label: 'Sticky Wild' },
    { kind: 'mystery_symbol', re: /\bmystery[\s_-]?symbol/i, label: 'Mystery Symbol' },
    { kind: 'buy_feature', re: /\bbuy[\s_-]?(feature|bonus)\b/i, label: 'Buy Feature' },
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
      re: /\blightning[\s_-]?(multiplier|spark|strike)?/i,
      label: 'Lightning',
    },
    { kind: 'respin', re: /\brespin/i, label: 'Respin' },
    { kind: 'wild_reel', re: /\bwild[\s_-]?reel/i, label: 'Wild Reel' },
    { kind: 'gamble', re: /\bgamble\s+(feature|ladder|round)\b/i, label: 'Gamble' },
    { kind: 'ante_bet', re: /\bante[\s_-]?bet\b/i, label: 'Ante Bet' },
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

/* ─── helper: RTP / volatility / max-win ───────────────────── */
export function extractMathSignals(text, model) {
  // RTP — prefer "Target RTP" cell (authoritative), fall back to any "RTP"
  // cell, finally to prose. Closed-form / MC RTPs are observation values,
  // not the spec, so we prefer the explicit target.
  const targetRtpCell = text.match(/\|\s*\*?\*?Target\s+RTP\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  const rtpCell = text.match(/\|\s*\*?\*?RTP\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  const rtpRe = /(?:target\s+)?RTP\b[^\d]{0,30}(\d{2,3}(?:[.,]\d{1,4})?)\s*%/i;
  const pickRtp = (cell) => {
    const num = cell[1].match(/(\d{2,3}(?:[.,]\d{1,4})?)/);
    return num ? parseFloat(num[1].replace(',', '.')) : null;
  };
  let rtpVal = null;
  if (targetRtpCell) rtpVal = pickRtp(targetRtpCell);
  if (rtpVal == null && rtpCell) rtpVal = pickRtp(rtpCell);
  if (rtpVal == null) {
    const m = text.match(rtpRe);
    if (m) rtpVal = parseFloat(m[1].replace(',', '.'));
  }
  if (rtpVal != null) {
    model.rtp = rtpVal;
    model.confidence.math += 0.4;
  }

  // volatility band — accepts "Volatility", "Volatility category", "Volatility target"
  const volCell = text.match(/\|\s*\*?\*?Volatility(?:\s+\w+)?\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  const volRe = /\bvolatility\b[^\n|]{0,80}?\b(low|mid|medium|high|ultra)\b/i;
  let volWord = null;
  if (volCell) {
    const m = volCell[1].toLowerCase().match(/\b(low|mid|medium|high|ultra)\b/);
    if (m) volWord = m[1];
  }
  if (!volWord) {
    // theme tags often carry "mid-volatility" / "high-volatility" hyphenated
    const tagHit = text.match(/\b(low|mid|medium|high|ultra)[\s_-]?volatility\b/i);
    if (tagHit) volWord = tagHit[1].toLowerCase();
  }
  if (!volWord) {
    const m = text.match(volRe);
    if (m) volWord = m[1].toLowerCase();
  }
  if (volWord) {
    model.volatility = volWord === 'mid' ? 'medium' : volWord;
    model.confidence.math += 0.3;
  }

  // max win — "max win 5000x", "Max win cap 5000× total bet", or "| Max win | 5000x |"
  // (math GDDs commonly write "Max win cap" rather than "Max win")
  const maxWinCell = text.match(/\|\s*\*?\*?Max\s+win(?:\s+cap)?\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  const maxWinRe =
    /\bmax(?:imum)?\s+win(?:\s+cap)?\b[^\d]{0,30}(\d{2,6}(?:[.,]\d{1,2})?)\s*[x×]/i;
  let maxWinVal = null;
  if (maxWinCell) {
    const num = maxWinCell[1].match(/(\d{2,6}(?:[.,]\d{1,2})?)\s*[x×]?/);
    if (num) maxWinVal = parseFloat(num[1].replace(',', '.'));
  }
  if (maxWinVal == null) {
    const m = text.match(maxWinRe);
    if (m) maxWinVal = parseFloat(m[1].replace(',', '.'));
  }
  if (maxWinVal != null) {
    model.maxWin = maxWinVal;
    model.confidence.math += 0.3;
  }

  model.confidence.math = Math.min(1, model.confidence.math);
}

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
  model.rtp = obj.rtp ?? obj.target_rtp ?? null;
  model.volatility = obj.volatility ?? null;
  model.maxWin = obj.maxWin ?? obj.max_win_x ?? null;
  model.confidence = { name: 1, topology: 1, symbols: 1, features: 1, math: 1 };
  return model;
}

/* ─── factory ──────────────────────────────────────────────── */
function freshModel() {
  return {
    name: 'Untitled Slot',
    theme: { tags: [], palette: [], mood: '' },
    topology: { reels: 5, rows: 3, paylines: 10 },
    symbols: { high: [], mid: [], low: [], specials: [] },
    features: [],
    rtp: null,
    volatility: null,
    maxWin: null,
    confidence: { name: 0, topology: 0, symbols: 0, features: 0, math: 0 },
  };
}
