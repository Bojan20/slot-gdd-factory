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

  /* topology — full coverage of industry shapes (Phase-G grid expansion) */
  extractTopology(text, model);

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

  /* free-spins config — full structured extraction from GDD prose */
  model.freeSpins = extractFreeSpinsConfig(text, model);

  // math (RTP / volatility / max-win) intentionally NOT extracted in this phase.

  return model;
}

/* ─── helper: extract Free Spins config (trigger / awards / retrigger / mult) ──
 *
 * Pulls a fully-structured FS block out of any GDD that mentions Free Spins.
 * Falls back to industry defaults when individual fields are missing, so the
 * playable template ALWAYS has something sensible to render.
 *
 * Output shape:
 *   { enabled: bool,
 *     triggerSymbol: 'S',           // scatter / bonus symbol id
 *     triggerCounts: [3, 4, 5],     // count → spins mapping (sorted asc)
 *     awards: [{count:3, spins:14}, {count:4, spins:16}, {count:5, spins:18}],
 *     retrigger: { enabled: bool, count: 3, spins: 5 },
 *     multiplier: { type: 'static' | 'progressive', start: 1, step: 1, cap: 10 },
 *     bgMode: 'purple' | 'gold' | 'crimson',
 *     introLabel, outroLabel }
 */
export function extractFreeSpinsConfig(text, model) {
  const has = /\bfree[\s-]?spins?\b/i.test(text);
  if (!has) {
    return { enabled: false };
  }

  /* Default: industry-standard 3/4/5 scatter ladder, 10/15/20 spins,
     static ×1 multiplier, retrigger 3S=+5 spins, purple stage.

     `countMode` — how scatters are counted toward the trigger threshold
     and anticipation gate:
       'perReel' — each reel contributes at most 1 toward the count
                   (industry-default; ladder rungs read as "N reels with
                   a scatter", not "N scatter cells"). DEFAULT.
       'any'     — every scatter cell counts (a single reel may carry 2-3
                   scatters that all add to the total). Used by titles
                   that explicitly call out "stacked scatters" / "scatters
                   may stack" or use multi-row scatter symbols. */
  const fs = {
    enabled: true,
    triggerSymbol: 'S',
    triggerCounts: [3, 4, 5],
    countMode: 'perReel',   /* see detection block below */
    awards: [
      { count: 3, spins: 10 },
      { count: 4, spins: 15 },
      { count: 5, spins: 20 },
    ],
    retrigger: { enabled: true, count: 3, spins: 5 },
    multiplier: { type: 'static', start: 1, step: 0, cap: 1 },
    bgMode: 'purple',
    introLabel: 'FREE SPINS',
    outroLabel: 'FREE SPINS COMPLETE',
  };

  /* Use the parsed Specials list to pick a real trigger-symbol id when present.
     "Scatter / Triggers Free Spins" is the canonical pattern; fall back to
     first symbol whose name contains "scatter" or "bonus". */
  if (model && model.symbols && model.symbols.specials) {
    const scatter = model.symbols.specials.find(s =>
      /scatter|bonus|trigger/i.test(s.name || '')
    );
    if (scatter) fs.triggerSymbol = scatter.id;
  }

  /* Awards table — "3 | 14" / "4 | 16" / "5 | 18" rows under a Free Spins
     heading. Accepts a few common header variants. */
  const awardSection = text.match(
    /(?:###?\s*[^\n]*Free[\s-]?Spins?[^\n]*\n)([\s\S]+?)(?=\n###?\s|$)/i
  );
  if (awardSection) {
    const block = awardSection[1];
    const rowRe = /\|\s*:?-?-?:?\s*\|[\s\S]*?\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g;
    /* Simpler: any "| N | M |" row inside the FS block where N ∈ {2..8} and M ∈ {1..200} */
    const rows = [];
    const simpleRow = /^\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*$/gm;
    let m;
    while ((m = simpleRow.exec(block)) !== null) {
      const count = parseInt(m[1], 10);
      const spins = parseInt(m[2], 10);
      if (count >= 2 && count <= 9 && spins >= 1 && spins <= 200) {
        rows.push({ count, spins });
      }
    }
    if (rows.length > 0) {
      fs.awards = rows.sort((a, b) => a.count - b.count);
      fs.triggerCounts = fs.awards.map(r => r.count);
    }
  }

  /* Trigger threshold — "N+ Scatters" / "N or more". If the text says "3+",
     align triggerCounts to start at 3. */
  const thresh = text.match(/\b(\d)\s*\+?\s*(?:scatters?|bonus|S\s+symbols?)\s+(?:anywhere|trigger|on\s+(?:screen|reels))/i);
  if (thresh) {
    const n = parseInt(thresh[1], 10);
    if (n >= 2 && n <= 6 && !fs.triggerCounts.includes(n)) {
      fs.triggerCounts.unshift(n);
    }
  }

  /* Multiplier — "progressive", "starts at ×N", "increments by ×N", "caps at ×N" */
  const isProgressive = /\bprogressive\s+multiplier|\bmultiplier\s+(?:starts?|increments?|grows?)\b|\bincrements?\s+by\s+[×x]?\d+/i.test(text);
  if (isProgressive) {
    const startMatch = text.match(/starts?\s+at\s+[×x]?\s*(\d+)/i);
    const stepMatch  = text.match(/increments?\s+by\s+[×x]?\s*(\d+)/i);
    const capMatch   = text.match(/caps?\s+at\s+[×x]?\s*(\d+)/i);
    fs.multiplier = {
      type: 'progressive',
      start: startMatch ? parseInt(startMatch[1], 10) : 1,
      step:  stepMatch  ? parseInt(stepMatch[1], 10)  : 1,
      cap:   capMatch   ? parseInt(capMatch[1], 10)   : 10,
    };
  } else {
    const flatMult = text.match(/\b(\d+)[×x]\s+(?:fs|free[\s-]?spins?|multiplier\s+(?:in|during))\b/i);
    if (flatMult) {
      const v = parseInt(flatMult[1], 10);
      fs.multiplier = { type: 'static', start: v, step: 0, cap: v };
    }
  }

  /* Retrigger detection — "retrigger possible" / "extra spins added" / "+N FS" */
  const noRetrig = /\bno\s+retrigger\b|\bretrigger\s+(?:disabled|not\s+supported|not\s+in)/i.test(text);
  const hasRetrig = /\bretrigger(?:s|ing)?\b|\bextra\s+spins?\s+added|\b\+\s*\d+\s+(?:free[\s-]?spins?|fs)\b/i.test(text);
  if (noRetrig) {
    fs.retrigger = { enabled: false, count: 0, spins: 0 };
  } else if (hasRetrig) {
    /* try to pull explicit values "+5 FS" or "3 scatters add 5 spins" */
    const explicit = text.match(/(\d)\s*\+?\s*(?:scatters?|bonus)\s+(?:add[s]?|grants?|gives?)\s+(\d+)\s+(?:free[\s-]?spins?|fs|spins?)/i)
                  || text.match(/\+\s*(\d+)\s+(?:free[\s-]?spins?|fs|spins?)\s+(?:on\s+)?retrigger/i);
    if (explicit) {
      if (explicit.length === 3) {
        fs.retrigger = { enabled: true, count: parseInt(explicit[1], 10), spins: parseInt(explicit[2], 10) };
      } else {
        fs.retrigger = { enabled: true, count: 3, spins: parseInt(explicit[1], 10) };
      }
    }
    /* else keep default { enabled:true, count:3, spins:5 } */
  }

  /* Scatter count-mode detection — EN + SR phrases.

     Order matters: explicit "may stack" phrases for `any` mode are checked
     FIRST so an ambiguous fixture that mentions both wins the explicit
     intent. If neither pattern matches, `countMode` stays at the default
     'perReel' (already set above).

     PHRASE BANK
       any (multi-per-reel):
         - "scatters may stack"
         - "scatters can stack"
         - "stacked scatters"
         - "scatter stacks"
         - "multiple scatters per reel"
         - "scatters can land on the same reel"
         - "more than one scatter per reel"
         - "2x scatter" / "3x scatter" / "stacked S"
         - "vise sketera po rilu" / "više skatera po rilu"
         - "stack-ovani sketeri" / "stakovani sketeri"
         - "moze vise sketera po rilu" / "može više skatera po rilu"
       perReel (one-per-reel, default):
         - "one scatter per reel"
         - "1 scatter per reel"
         - "max one scatter per reel"
         - "only one scatter per reel"
         - "single scatter per reel"
         - "scatter on different reels"
         - "scatters on different reels"
         - "scatters on distinct reels"
         - "unique reels"
         - "per-reel scatter"
         - "po jedan sketer po rilu" / "po jedan skater po rilu"
         - "jedan sketer po rilu"
         - "po rilu jedan sketer"
         - "samo jedan sketer po rilu" / "samo po jedan sketer"
         - "jedinstveni rilovi" / "razliciti rilovi"
  */
  /* Phonetic-tolerant SR scatter token: handles English transliterations
     (sketer, skater, sćeter, scater, scatter, sceter) so a writer's
     spelling doesn't break trigger-mode detection. */
  const SR_SCATTER = '(?:sketer|skater|sceter|scater|scatter|s[ćč]eter)[a-z]*';

  const anyModeRe = new RegExp(
    '(?:scatters?\\s+(?:may|can)\\s+stack)' +
    '|(?:stacked\\s+scatters?)' +
    '|(?:scatter\\s+stacks?)' +
    '|(?:multiple\\s+scatters?\\s+per\\s+reel)' +
    '|(?:scatters?\\s+can\\s+land\\s+on\\s+(?:the\\s+)?same\\s+reel)' +
    '|(?:more\\s+than\\s+one\\s+scatter\\s+per\\s+reel)' +
    '|(?:\\b[2-9]\\s*[x×]\\s+scatter)' +
    '|(?:stacked\\s+S\\b)' +
    '|(?:v(?:i|í|i)[sš]e\\s+' + SR_SCATTER + '\\s+po\\s+rilu)' +
    '|(?:stack[\\-\\s]?ovani\\s+' + SR_SCATTER + ')' +
    '|(?:stakovani\\s+' + SR_SCATTER + ')' +
    '|(?:mo[zž]e\\s+v(?:i|í)[sš]e\\s+' + SR_SCATTER + '\\s+po\\s+rilu)',
    'i'
  );

  const perReelModeRe = new RegExp(
    '(?:(?:one|1|single|only\\s+one|max(?:imum)?\\s+(?:of\\s+)?one)\\s+scatters?\\s+per\\s+reel)' +
    '|(?:scatters?\\s+on\\s+(?:different|distinct|separate|unique)\\s+reels?)' +
    '|(?:unique\\s+reels?\\s+(?:only|required))' +
    '|(?:per[\\-\\s]reel\\s+scatters?)' +
    '|(?:scatters?\\s+(?:must|need)\\s+(?:to\\s+)?(?:land\\s+)?on\\s+(?:different|distinct)\\s+reels?)' +
    '|(?:(?:po\\s+jedan|jedan)\\s+' + SR_SCATTER + '\\s+po\\s+rilu)' +
    '|(?:po\\s+rilu\\s+jedan\\s+' + SR_SCATTER + ')' +
    '|(?:samo\\s+(?:po\\s+)?jedan\\s+' + SR_SCATTER + ')' +
    '|(?:jedinstveni\\s+rilovi)' +
    '|(?:razli[cč]iti\\s+rilovi)',
    'i'
  );

  if (anyModeRe.test(text)) {
    fs.countMode = 'any';
  } else if (perReelModeRe.test(text)) {
    fs.countMode = 'perReel';
  }
  /* else: keep default 'perReel' — Boki's rule: GDD silent → one-per-reel. */

  /* Visual mode — heuristic from theme palette. If palette has purple/violet
     hex, use purple. If gold-heavy, use gold. If red/crimson, use crimson. */
  const pal = (model && model.theme && model.theme.palette) || [];
  if (pal.some(h => /^#(?:[a-f0-9]{2}){3}$/i.test(h) && isRedish(h))) fs.bgMode = 'crimson';
  else if (pal.some(h => /^#(?:[a-f0-9]{2}){3}$/i.test(h) && isGoldish(h))) fs.bgMode = 'gold';
  else fs.bgMode = 'purple';

  /* Intro / outro placard wording — pull explicit GDD copy when present. */
  const introCopy = text.match(/(?:placard|placeholder|overlay|splash)[^\n]*?[""''""]([^""""''""\n]{3,30})[""''""]/i)
                 || text.match(/[""""''""]([A-Z][A-Z\s]{2,30})[""""''""][^\n]*?(?:placard|placeholder|overlay|splash|rises|intro)/i);
  if (introCopy) {
    const c = introCopy[1].trim();
    if (/free|spins|bonus/i.test(c) && c.length < 32) fs.introLabel = c.toUpperCase();
  }
  const outroCopy = text.match(/[""""''""]([A-Z][A-Z\s]{2,30})[""""''""][^\n]*?(?:outro|return|exit|totals?)/i);
  if (outroCopy) {
    const c = outroCopy[1].trim();
    if (c.length < 32) fs.outroLabel = c.toUpperCase();
  }

  return fs;
}

function isRedish(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r > 150 && r > g + 40 && r > b + 40;
}
function isGoldish(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r > 180 && g > 120 && g < 220 && b < 100;
}

/* ─── helper: extract complete topology (all 85+ shape kinds) ─ */
export function extractTopology(rawText, model) {
  const t = model.topology;

  /* Apply SAME negation strips as feature detection so "Megaways · Out of scope"
     or "no cluster pays" lines don't falsely flip the evaluation kind. */
  let text = rawText.replace(
    /#{2,3}\s*(?:\d+\.\s*)?(?:Out[\s-]of[\s-]scope|Explicit non-features|Not in this product)[^#]*(?=#{2,3}|\Z)/gis,
    ''
  );
  text = text.replace(
    /^\|[^\n|]*?\|[^\n|]*?\b(?:not\s+in\s+this\s+product|out\s+of\s+scope|none|n\/a|disabled|excluded|—|–)\b[^\n|]*?\|.*$/gim,
    ''
  );
  text = text.replace(
    /^[^\n]*\b(?:has\s+no|with\s*no|without|no\s+(?:cluster|megaways|ways|hexagonal|infinity))\b[^\n]*$/gim,
    ''
  );

  /* 1. Reels — accept "6 columns", "6", "6 reels", "5-6 (variable)", "4 (base)" */
  const reelsCell =
    text.match(/\|\s*\*?\*?Reels\*?\*?\s*\|\s*(\d+)(?:\s+columns?)?\s*\|/i) ||
    text.match(/\|\s*\*?\*?Reels\*?\*?\s*\|\s*[^|]*?(\d+)\s+columns?[^|]*\|/i) ||
    text.match(/\|\s*\*?\*?Reels\*?\*?\s*\|\s*(\d+)\s*\([^|]*\|/i) ||
    text.match(/\|\s*\*?\*?(?:Primary\s+)?Reels?\*?\*?\s*\|\s*(\d+)\b/i) ||
    text.match(/\|\s*\*?\*?Columns?\*?\*?\s*\|\s*(\d+)/i);
  if (reelsCell) {
    t.reels = parseInt(reelsCell[1], 10);
    t.confidence_reels = 1;
    model.confidence.topology += 0.3;
  }

  /* 2. Rows — accept "5 visible per column", "5", per-reel variable, or "4 (base)" */
  const rowsCell =
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*(\d+)(?:\s+visible)?\s*\|/i) ||
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*[^|]*?(\d+)\s+visible[^|]*\|/i) ||
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*(\d+)\s*\([^|]*\|/i) ||
    text.match(/\|\s*\*?\*?(?:Primary\s+)?Rows?\*?\*?\s*\|\s*(\d+)\b/i);
  if (rowsCell) {
    t.rows = parseInt(rowsCell[1], 10);
    t.confidence_rows = 1;
    model.confidence.topology += 0.3;
  }

  /* 3. Variable rows-per-reel (Megaways) — "2-7 rows per reel" or per-reel list */
  const varRows =
    text.match(/\b(\d+)\s*[-–]\s*(\d+)\s+rows?\s+per\s+reel\b/i) ||
    text.match(/\brows?\s+per\s+reel\s*:?\s*(\d+)\s*[-–]\s*(\d+)/i) ||
    text.match(/\bvariable\s+rows?\s*\(?(\d+)\s*[-–]\s*(\d+)\)?/i);
  if (varRows) {
    const min = parseInt(varRows[1], 10);
    const max = parseInt(varRows[2], 10);
    t.rows_per_reel = { min, max, variable: true };
    /* set rows to the max for grid sizing */
    if (!t.confidence_rows) t.rows = max;
  }

  /* 4. Paylines count */
  const lines = text.match(/\|\s*\*?\*?Paylines\*?\*?\s*\|\s*(\d+)/i);
  if (lines) {
    t.paylines = parseInt(lines[1], 10);
    model.confidence.topology += 0.15;
  }

  /* 5. Ways count — 117649 / 46656 / 7776 / 4096 / 3125 / 1024 / 576 / 243 */
  const waysCell = text.match(/\b(243|576|720|1024|1600|3125|4096|7776|15625|46656|117649|1000000)\s*ways?\b/i);
  if (waysCell) {
    t.ways_count = parseInt(waysCell[1], 10);
  }

  /* 6. Evaluation kind — explicit cell first */
  const evalCell = text.match(/\|\s*\*?\*?Evaluation\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  let kind = null;
  if (evalCell) {
    const v = evalCell[1].toLowerCase();
    if (/cluster/.test(v)) kind = 'cluster';
    else if (/ways/.test(v) || /\d+\s*ways/.test(v)) kind = 'ways';
    else if (/pay[\s-]?anywhere|scatter\s+pays?/.test(v)) kind = 'pay_anywhere';
    else if (/hex/.test(v)) kind = 'hexagonal';
    else if (/infinity/.test(v)) kind = 'infinity';
    else if (/crash/.test(v)) kind = 'crash';
    else if (/line/.test(v)) kind = 'lines';
  }
  /* 6b. Fallback — infer from prose. Order matters: pay_anywhere is STRICT
     (must be grid-level, not "scatter pays anywhere" feature line). */
  if (!kind) {
    if (/\bcluster[\s_-]?pays?\b/i.test(text)) kind = 'cluster';
    else if (/\b(?:243|576|720|1024|1600|3125|4096|7776|15625|46656|117649|1000000)\s*ways?\b|\bways?\s+to\s+win\b|\bmegaways\b|\btrueways\b/i.test(text)) kind = 'ways';
    else if (/\bhexagonal\b|\bhoneycomb\b/i.test(text)) kind = 'hexagonal';
    else if (/\binfinity\s+reels?\b|\binfini[\s-]?reels?\b|\bgrowing\s+(?:columns?|reels?)\b/i.test(text)) kind = 'infinity';
    else if (/\bcrash\s+(?:game|multiplier)\b|\baviator[\s-]?shape\b/i.test(text)) kind = 'crash';
    else if (/\bslingo\b/i.test(text)) kind = 'slingo';
    else if (/\bplinko\b|\bpeg\s+matrix\b/i.test(text)) kind = 'plinko';
    else if (/\bwheel\s+(?:bonus|game|of\s+\w+)\b|\bcrazy\s+time\b|\bsegmented\s+wheel\b/i.test(text)) kind = 'wheel';
    /* pay_anywhere — STRICT match: must say "pay anywhere grid/slot/evaluation"
       or "all positions pay". A bare "scatter pays anywhere" is a SCATTER
       mechanic for a regular-grid game, not the pay_anywhere topology. */
    else if (/\bpay[\s-]?anywhere\s+(?:grid|slot|evaluation|mechanic|pays?)\b|\ball\s+positions?\s+pays?\b/i.test(text)) kind = 'pay_anywhere';
    else kind = 'lines';
  }
  t.evaluation = kind;

  /* 7. Direction — left-to-right / right-to-left / both-ways */
  const dirCell = text.match(/\|\s*\*?\*?Direction\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (dirCell) {
    const v = dirCell[1].toLowerCase();
    if (/both/.test(v) || /two[\s-]?way/.test(v) || /bi[\s-]?direction/.test(v)) t.direction = 'both';
    else if (/right/.test(v)) t.direction = 'rtl';
    else t.direction = 'ltr';
  } else if (/\bboth[\s-]?ways?\s+pay\b|\bpay[s]?\s+both\s+ways?\b|\bbi[\s-]?directional\b/i.test(text)) {
    t.direction = 'both';
  } else {
    t.direction = 'ltr';
  }

  /* 8. Shape — rectangular by default, but detect non-rectangular variants.
     CRITICAL: shape detection must match a GRID CONTEXT, not a symbol name.
     We strip the symbol tables before pattern matching so e.g. a low-pay
     "Diamond" symbol can't flip the grid to diamond shape. */
  const shapeText = stripSymbolTables(text);
  const diamondArr = shapeText.match(/\b(?:diamond|multi[\s-]?way\s+xtra|both[\s-]?ways?\s+diamond)\b[^\n]*?(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)(?:\s*[-–]\s*(\d+)\s*[-–]\s*(\d+))?/i);
  const pyramidArr = shapeText.match(/\b(?:pyramid|trapezoidal?)\s+(?:grid|layout|shape|reels?)\b[^\n]*?(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)(?:\s*[-–]\s*(\d+)\s*[-–]\s*(\d+))?/i);
  if (/\bhexagonal\b|\bhoneycomb\b/i.test(shapeText)) {
    t.shape = 'hexagonal';
    const hr = shapeText.match(/\bhex(?:agonal)?\s+ring\s*=?\s*(\d+)/i);
    if (hr) t.hex_ring = parseInt(hr[1], 10);
  } else if (pyramidArr) {
    t.shape = 'pyramid';
    t.rows_per_reel_array = pyramidArr.slice(1).filter(Boolean).map(n => parseInt(n, 10));
  } else if (diamondArr) {
    t.shape = 'diamond';
    t.rows_per_reel_array = diamondArr.slice(1).filter(Boolean).map(n => parseInt(n, 10));
  } else if (/\b(?:pyramid|trapezoidal?)\s+(?:grid|layout|shape|reels?)\b/i.test(shapeText)) {
    t.shape = 'pyramid';
  } else if (/\b(?:diamond|rhombus)\s+(?:grid|layout|shape|reels?)\b|\bmulti[\s-]?way\s+xtra\b|\bdiamond\s+(?:multi[\s-]?way|both[\s-]?ways?)\b/i.test(shapeText)) {
    t.shape = 'diamond';
  } else if (/\bcross\s+shape\b|\bplus\s+shape\b|\bcruciform\b/i.test(shapeText)) {
    t.shape = 'cross';
  } else if (
    /\bl[\s-]?shape\s+(?:grid|layout|step|tetromino|arrangement|tetra)\b/i.test(shapeText) ||
    /\bstep\s+grid\b/i.test(shapeText) ||
    /\|\s*\*?\*?Shape\*?\*?\s*\|\s*L[\s-]?shape\b/i.test(shapeText) ||
    /\bL[\s-]?shape\b[^.\n]{0,40}\b(?:corner|blanked|step|arrangement)\b/i.test(shapeText)
  ) {
    t.shape = 'l_shape';
  } else if (/\bradial\s+reels?\b|\bcircular\s+(?:reels?|grid)\b/i.test(shapeText)) {
    t.shape = 'radial';
  } else {
    t.shape = 'rectangular';
  }

  /* 9. Cascade / tumble / avalanche flag (game-flow trait, not math) */
  /* Re-uses the same negation-aware logic as feature detection. */
  const noCascade = /^\|[^\n|]*?(?:cascade|tumble|avalanche)[^\n|]*?\|[^\n|]*?\b(?:not\s+in\s+this\s+product|n\/a|disabled|none)\b/im.test(text);
  if (!noCascade && /\b(?:cascad(?:e|ing)|tumbl(?:e|ing)|avalanche)(?:\s+\w+){0,2}\s+(?:mechanic|feature|engine|reel|reels|round|game|win|wins|pays?|symbols?)\b|\bReel\s+mechanism\s*[—:|]\s*Cascade\b/i.test(text)) {
    t.cascade = { enabled: true, direction: 'down' };
  } else {
    t.cascade = { enabled: false };
  }

  /* 10. Growable / Infinity Reels */
  if (kind === 'infinity' || /\binfinity\s+reels?\b|\bgrowing\s+(?:columns?|reels?)\b/i.test(text)) {
    t.growable = true;
    t.evaluation = 'infinity';
  }

  /* 11. Tiered/expanding grid (rows or reels grow on feature trigger).
     Requires an EXPLICIT expansion keyword — never trigger on plain
     "2-7 rows per reel" (which is variable_reel, not expanding). */
  const expCell =
    text.match(/\bexpanding\s+(?:grid|rows?)\b[^\n.]*?(\d+)\s*[→\-–>]+\s*(\d+)/i) ||
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*(\d+)\s*base\s*[→\-–>]+\s*(\d+)\s*max/i) ||
    text.match(/\|\s*\*?\*?Tiered\s+rows?\*?\*?\s*\|\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/i) ||
    text.match(/\|\s*\*?\*?Tiered\s+rows?\*?\*?\s*\|\s*(\d+)[^|]*?[→\-–>]+[^|]*?(\d+)/i) ||
    text.match(/(\d+)\s+base\s*[→\-–>]+\s*(\d+)\s+max/i);
  if (expCell) {
    t.tiered_rows = [parseInt(expCell[1], 10), parseInt(expCell[2], 10)];
    t.evaluation = t.evaluation || 'lines';
  }
  /* Prose: explicit "pop wins" / "gigarise" / "expanding grid" */
  if (/\bpop[\s-]?(?:wins?|grid|burst)\b|\bgigarise\b|\bexpanding\s+(?:grid|rows?)\b/i.test(text)) {
    if (!t.tiered_rows) t.tiered_rows = [t.rows || 3, (t.rows || 3) * 3]; // best-effort
  }

  /* 12. Lock-and-respin (Hold & Spin / Money-Train shape) */
  if (/\block[\s-]?and[\s-]?respin\b|\bhold[\s-]?and[\s-]?spin\b|\brespin\s+until\s+empty\b|\bsymbols\s+lock\s+in\s+place\b/i.test(text)) {
    t.lock_respin = true;
  }

  /* 13. Twin / mirrored reels */
  if (/\btwin\s+reels?\b/i.test(text)) t.twin_reels = true;
  if (/\bmirrored\s+reels?\b/i.test(text)) t.mirrored_reels = true;

  /* 14. Multi-grid (dual / quad) */
  const multiGrid = text.match(/\b(\d+)\s*[×x*]\s*(\d+x\d+)\s+grids?\b|\bdual[\s-]?grid\b|\bquad[\s-]?grid\b|\bcolossal\s+dual\b/i);
  if (multiGrid) {
    if (/dual|colossal/i.test(multiGrid[0])) t.grid_count = 2;
    else if (/quad/i.test(multiGrid[0])) t.grid_count = 4;
    else t.grid_count = parseInt(multiGrid[1], 10);
  }
  if (/\bcolossal\s+(?:reels?|dual|grid|layout)\b|\bcolossal\s+\d+\s*x\s*\d+\s*\+\s*\d+\s*x\s*\d+\b/i.test(text)) {
    t.is_colossal = true;
    t.grid_count = Math.max(t.grid_count || 1, 2);
  }

  /* Cluster eval games don't use paylines */
  if (t.evaluation === 'cluster' || t.evaluation === 'pay_anywhere' || t.evaluation === 'hexagonal') {
    t.paylines = null;
  }

  /* 15. Slingo / Plinko / Crash / Wheel flags — derived from evaluation + prose */
  if (t.evaluation === 'slingo' || /\bslingo\b/i.test(text)) t.is_slingo = true;
  if (t.evaluation === 'plinko' || /\bplinko\b|\bpeg\s+matrix\b/i.test(text)) t.is_plinko = true;
  if (/\bplinko\s+rows?\s*=?\s*(\d+)/i.test(text)) {
    const m = text.match(/\bplinko\s+rows?\s*=?\s*(\d+)/i);
    if (m) t.plinko_rows = parseInt(m[1], 10);
  }
  if (/\bsegmented\s+wheel\b|\bwheel\s+segments?\s*[=|]\s*(\d+)/i.test(text)) {
    const m = text.match(/\bwheel\s+segments?\s*[=|]?\s*\*?\*?\s*\|?\s*(\d+)/i) ||
              text.match(/\|\s*\*?\*?\s*Wheel\s+segments?\s*\*?\*?\s*\|\s*(\d+)/i);
    if (m) t.wheel_segments = parseInt(m[1], 10);
  }

  /* 16. Megaclusters — BTG quarter-split variant */
  if (/\bmegaclusters?\b|\bmega[\s-]?clusters?\b|\bquarter[\s-]?split\s+cluster\b/i.test(text)) {
    t.is_megaclusters = true;
  }

  /* 17. CANONICAL `kind` — final classification used by gridShape.mjs */
  t.kind = canonicalKind(t);

  /* Final confidence — if we've identified eval + shape + reels + rows, we're max */
  if (t.evaluation && t.shape && t.confidence_reels && t.confidence_rows) {
    model.confidence.topology = 1.0;
  } else if (t.evaluation) {
    model.confidence.topology = Math.max(model.confidence.topology, 0.7);
  }
}

/* ─── canonical kind classifier — single source of truth ─── */
export function canonicalKind(t) {
  if (t.is_slingo)        return 'slingo';
  if (t.is_plinko)        return 'plinko';
  if (t.evaluation === 'crash') return 'crash';
  if (t.evaluation === 'wheel' || t.wheel_segments) return 'wheel';
  if (t.is_megaclusters)  return 'megaclusters';
  if ((t.grid_count || 1) >= 2) return 'dual';
  if (t.shape === 'hexagonal') return 'hexagonal';
  if (t.shape === 'pyramid')   return 'pyramid';
  if (t.shape === 'diamond')   return 'diamond';
  if (t.shape === 'cross')     return 'cross';
  if (t.shape === 'l_shape')   return 'l_shape';
  if (t.shape === 'radial')    return 'radial';
  if (t.evaluation === 'cluster')  return 'cluster';
  if (t.growable || t.evaluation === 'infinity') return 'infinity';
  if (t.tiered_rows && t.tiered_rows.length === 2) return 'expanding';
  if (t.rows_per_reel && t.rows_per_reel.variable) return 'variable_reel';
  if (t.lock_respin) return 'lock_respin';
  return 'rectangular';
}

/* ─── helper: strip the four symbol tables so shape/eval regex can't
       false-positive on a symbol named "Diamond" / "Wheel" / "Cluster". */
export function stripSymbolTables(text) {
  return text.replace(
    /^###[^\n]*\b(?:High|Mid|Low)[\s-]?pay\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n###\s|\Z)/gim,
    ''
  ).replace(
    /^###[^\n]*\bSpecials?\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n###\s|\Z)/gim,
    ''
  );
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
  /* FS config — JSON IR may carry an explicit { freeSpins: {...} } block; if
     not, fall back to industry defaults whenever a `free_spins` feature is
     declared. Mirrors the markdown-path behaviour. */
  if (obj.freeSpins && typeof obj.freeSpins === 'object') {
    model.freeSpins = { enabled: true, ...obj.freeSpins };
  } else if (model.features.some(f => f.kind === 'free_spins')) {
    model.freeSpins = extractFreeSpinsConfig('free spins', model);
  } else {
    model.freeSpins = { enabled: false };
  }
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
    topology: {
      /* canonical kind — one of 18 classes; set by canonicalKind() after extraction */
      kind: 'rectangular',
      /* sizing */
      reels: 5,
      rows: 3,
      paylines: 10,
      /* shape — rectangular default; can be hexagonal/pyramid/diamond/cross/l_shape/radial */
      shape: 'rectangular',
      /* evaluation — lines / ways / cluster / pay_anywhere / hexagonal / infinity / crash / slingo / plinko / wheel */
      evaluation: null,
      /* direction — ltr (default) / rtl / both */
      direction: 'ltr',
      /* explicit ways count if known (243/1024/4096/7776/46656/117649/etc) */
      ways_count: null,
      /* variable rows-per-reel (Megaways: 2-7 per reel) */
      rows_per_reel: null,
      /* explicit per-reel rows array (diamond/pyramid: [3,4,5,4,3]) */
      rows_per_reel_array: null,
      /* cascade/tumble/avalanche */
      cascade: { enabled: false },
      /* growable (Infinity Reels) */
      growable: false,
      /* tiered/expanding grid (rows or reels grow on trigger) */
      tiered_rows: null,
      /* lock-and-respin grid (Hold & Spin / Money-Train shape) */
      lock_respin: false,
      /* twin / mirrored reels */
      twin_reels: false,
      mirrored_reels: false,
      /* multi-grid (dual/quad simultaneous grids) */
      grid_count: 1,
      /* megaclusters (BTG quarter-split) */
      is_megaclusters: false,
      /* slingo (5×5 + 1×5 hybrid) */
      is_slingo: false,
      /* plinko (peg matrix) */
      is_plinko: false,
      /* plinko peg rows (default 16) */
      plinko_rows: null,
      /* wheel segment count (24/36/48 typical) */
      wheel_segments: null,
      /* hexagonal ring radius */
      hex_ring: null,
    },
    symbols: { high: [], mid: [], low: [], specials: [] },
    features: [],
    /* Structured Free-Spins config — populated by extractFreeSpinsConfig().
       Always emitted (even when FS is not in the GDD) so downstream code can
       branch on `freeSpins.enabled` instead of probing undefined. */
    freeSpins: { enabled: false },
    confidence: { name: 0, topology: 0, symbols: 0, features: 0 },
  };
}
