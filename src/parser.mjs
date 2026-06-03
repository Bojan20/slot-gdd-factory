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

  /* win-presentation block config — extracts optional GDD knobs for the
     winPresentation lego block. No-op when the GDD has no Win Presentation
     section; downstream block falls through to safe defaults. */
  extractWinPresentation(text, model);

  /* scatter-celebration block config — extracts optional GDD knobs for the
     scatterCelebration lego block. No-op when the GDD has no Scatter
     Celebration section; downstream block falls through to safe defaults. */
  extractScatterCelebration(text, model);

  /* stage-badge block config — extracts optional GDD knobs for the
     stageBadge lego block (label text + gold color + pulse cadence). */
  extractStageBadge(text, model);

  /* anticipation block config — hold / pulse / gold knobs for the
     anticipation lego block. */
  extractAnticipation(text, model);

  /* spin-tempo block config — windup / steady / decel / stagger /
     bounce knobs for the spinTempo lego block. */
  extractSpinTempo(text, model);

  /* free-spins-presentation block config — placard labels + fade timings
     + transition delays for the freeSpins lego block. */
  extractFreeSpinsPresentation(text, model);

  /* reel-engine CSS knobs (blur strength + brightness + fade) */
  extractReelEngine(text, model);

  /* trigger-counting + post-spin orchestration knobs */
  extractTriggerCounting(text, model);
  extractPostSpin(text, model);

  /* reel-engine hot-path knobs (minRotations / settle breath / static reroll
     cadence + bounce snap thresholds) */
  extractReelEngineHot(text, model);

  /* Wave K — Pay Anywhere suite (Gates of Olympus / Sugar Rush family).
     Each detector is no-op when the GDD lacks the relevant section/feature. */
  extractPayAnywhereEval(text, model);
  extractMultiplierOrb(text, model);
  extractBonusBuy(text, model);
  extractAnteBet(text, model);
  extractTumble(text, model);

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
  // ID MUST start with a letter — guards against multi-column pay tables
  // (e.g. Gates of Olympus 6-col format) where the regex would otherwise
  // pick up pay multipliers like "10x" or count thresholds like "8" as IDs.
  const rowRe = /\|\s*`?([A-Za-z][A-Za-z0-9_]{0,3})`?\s*\|\s*([^|]+?)\s*\|/g;
  const seen = new Set();
  let m;
  while ((m = rowRe.exec(chunk)) !== null) {
    const id = m[1].trim();
    const name = m[2].trim();
    if (id.toLowerCase() === 'id' || name.toLowerCase() === 'name') continue;
    if (id.length > 4) continue;
    // Skip Name cells that look like pay multipliers ("10x", "2.5x", "1000x")
    if (/^\d+(?:\.\d+)?\s*x?$/i.test(name)) continue;
    // Skip Name cells that are bucket headers ("8-9", "10-11", "12+")
    if (/^\d+\s*[-+–]\s*\d*$/.test(name)) continue;
    // Dedupe (multi-column tables may emit the same row twice via regex backtrack)
    if (seen.has(id)) continue;
    seen.add(id);
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
    /* Win-presentation block config — consumed by src/blocks/winPresentation.mjs.
       Always emitted with `undefined` slots so the block's resolveConfig()
       falls through to safe defaults. Populated by extractWinPresentation()
       when the GDD declares overrides. */
    winPresentation: {
      /* 'per-line' | 'cluster' | 'all-at-once' — undefined → block default */
      mode: undefined,
      /* number ms | 'auto' — undefined → block default ('auto') */
      perEventMs: undefined,
      /* cap on visible events per spin */
      maxEvents: undefined,
      /* explicit payline definitions (overrides industry-standard pool) */
      paylines: undefined,
      /* boolean — false hard-disables the cycle */
      winCycle: undefined,
      /* number in [0,1] — forced "no win" chance for visual variance */
      noWinChance: undefined,
    },
    /* Stage-badge block config — consumed by src/blocks/stageBadge.mjs. */
    stageBadge: {
      enabled: undefined,
      baseLabel: undefined,
      fsLabel: undefined,
      gold: undefined,
      pulseMs: undefined,
      mobileBreakpoint: undefined,
    },
    /* Anticipation block config — consumed by src/blocks/anticipation.mjs. */
    anticipation: {
      enabled: undefined,
      holdMs: undefined,
      pulseMs: undefined,
      gold: undefined,
      skipDuringFs: undefined,
    },
    /* Reel-engine CSS knobs — consumed by src/blocks/reelEngineCSS.mjs. */
    reelEngine: {
      blurPx: undefined,
      blurDim: undefined,
      blurFadeMs: undefined,
    },
    /* Trigger-counting config — consumed by src/blocks/triggerCounting.mjs. */
    triggerCounting: {
      defaultThreshold: undefined,
    },
    /* Reel-engine hot-path knobs — consumed by src/blocks/reelEngine.mjs. */
    reelEngineHot: {
      minRotations: undefined,
      settleBreathMs: undefined,
      stripBufferCells: undefined,
      staticPreRollMs: undefined,
      staticBlurSwapMs: undefined,
      staticStaggerMs: undefined,
      staticHoldMs: undefined,
      staticSettleMs: undefined,
      staticFallbackMs: undefined,
      snapThreshold: undefined,
      minStepPx: undefined,
      accelMinFactor: undefined,
    },
    /* Post-spin orchestration knobs — consumed by src/blocks/postSpin.mjs. */
    postSpin: {
      settlePauseMs: undefined,
      forcedSettlePauseMs: undefined,
      retriggerCap: undefined,
      fsSpinBreathMs: undefined,
      fakeWinChance: undefined,
      fakeWinMaxX: undefined,
    },
    /* Free-spins-presentation block config — consumed by
       src/blocks/freeSpins.mjs. Separate from the structural FS config
       (freeSpins) which is math/feature; this is purely the visual layer. */
    freeSpinsPresentation: {
      enabled: undefined,
      introLabel: undefined,
      outroLabel: undefined,
      totalWinLabel: undefined,
      introCta: undefined,
      outroCta: undefined,
      introSub: undefined,
      fadeMs: undefined,
      enterActiveDelayMs: undefined,
      spinBreathMs: undefined,
      toastMs: undefined,
      retriggerToastMs: undefined,
    },
    /* Spin-tempo block config — consumed by src/blocks/spinTempo.mjs.
       preset is a string ("s-avp" | "fast" | "slow") that sets the base
       cadence; per-key overrides follow. */
    spinTempo: {
      preset: undefined,
      windupMs: undefined,
      windupFrames: undefined,
      windupPx: undefined,
      accelMs: undefined,
      steadyMs: undefined,
      decelMs: undefined,
      staggerMs: undefined,
      bouncePx: undefined,
      bounceDecay: undefined,
      bounceCount: undefined,
      bounceElasticity: undefined,
      decelEasingSpeed: undefined,
    },
    /* Scatter-celebration block config — consumed by
       src/blocks/scatterCelebration.mjs. Always emitted with `undefined`
       slots so the block's resolveConfig() falls through to safe defaults.
       Populated by extractScatterCelebration() when the GDD declares
       overrides. */
    scatterCelebration: {
      /* boolean — false hard-disables the celebration */
      enabled: undefined,
      /* number ms — total celebration duration */
      durationMs: undefined,
      /* number — how many brightness cycles play */
      pulseCycles: undefined,
      /* number ms — duration of ONE cycle */
      pulseCycleMs: undefined,
      /* number in [0,1] — non-scatter cells dim level */
      dimOpacity: undefined,
      /* "r,g,b" string — gold drop-shadow halo color */
      glowColor: undefined,
      /* number — brightness peak inside a cycle */
      glowPeak: undefined,
    },
    /* Wave K — Pay Anywhere suite (Gates of Olympus / Sugar Rush style).
       Each sub-block has `undefined` slots so its resolveConfig() falls
       through to safe defaults. Populated by Wave K extract functions. */
    payAnywhereEval: {
      enabled: undefined,
      minWin: undefined,
      bucketEdges: undefined,
      paytable: undefined,
      maxEvents: undefined,
    },
    tumble: {
      enabled: undefined,
      removeMs: undefined,
      gravityMs: undefined,
      refillMs: undefined,
      chainPauseMs: undefined,
      maxChain: undefined,
      preserveOrbs: undefined,
    },
    multiplierOrb: {
      enabled: undefined,
      symbolId: undefined,
      distribution: undefined,
      bonusAccumulate: undefined,
      chipColor: undefined,
      pulseMs: undefined,
    },
    bonusBuy: {
      enabled: undefined,
      costX: undefined,
      label: undefined,
      forceScatters: undefined,
      color: undefined,
      confirmMessage: undefined,
    },
    anteBet: {
      enabled: undefined,
      costMultiplier: undefined,
      triggerMultiplier: undefined,
      label: undefined,
      color: undefined,
    },
    confidence: { name: 0, topology: 0, symbols: 0, features: 0 },
  };
}

/* ── extractWinPresentation — GDD-driven win cycle config ──────────────────
   Reads optional knobs from a "## Win Presentation" / "## Win Cycle" /
   "## Win Animations" section in the GDD:

     ```
     ## Win Presentation
     - mode: per-line
     - per-event-ms: 350
     - max-events: 12
     - no-win-chance: 0.20
     - win-cycle: true
     ```

   All keys optional. Unknown keys ignored. Block's resolveConfig() does
   the actual validation — parser only forwards what it sees. */
export function extractWinPresentation(text, model) {
  if (!text || !model) return;
  /* Look for any heading that matches "win presentation" / "win cycle" /
     "win animations" / "win highlight" — case-insensitive. The H2 block
     extends to the next H1/H2 or end-of-document. */
  const headingRx = /^##\s*(?:win\s*presentation|win\s*cycle|win\s*animations?|win\s*highlight)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const wp = model.winPresentation;
  /* mode */
  const m = section.match(/\b(?:mode|presentation)\s*[:=]\s*['"]?(per-?line|cluster|all-?at-?once)['"]?/i);
  if (m) {
    const v = m[1].toLowerCase().replace(/\s+/g, '-');
    wp.mode = v === 'perline' ? 'per-line' : (v === 'allatonce' ? 'all-at-once' : v);
  }
  /* per-event-ms */
  const pe = section.match(/\bper[- ]?event[- ]?ms\s*[:=]\s*(\d+|auto)/i);
  if (pe) wp.perEventMs = pe[1].toLowerCase() === 'auto' ? 'auto' : parseInt(pe[1], 10);
  /* max-events */
  const me = section.match(/\bmax[- ]?events?\s*[:=]\s*(\d+)/i);
  if (me) wp.maxEvents = parseInt(me[1], 10);
  /* no-win-chance */
  const nw = section.match(/\bno[- ]?win[- ]?chance\s*[:=]\s*(0?\.\d+|0|1)/i);
  if (nw) wp.noWinChance = parseFloat(nw[1]);
  /* win-cycle on/off */
  const wc = section.match(/\bwin[- ]?cycle\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (wc) {
    const v = wc[1].toLowerCase();
    wp.winCycle = (v === 'true' || v === 'on' || v === 'yes');
  }
}

/* ── extractScatterCelebration — GDD-driven trigger animation config ──────
   Reads optional knobs from a "## Scatter Celebration" / "## Trigger
   Celebration" / "## Scatter Animation" / "## Trigger Animation" section
   in the GDD:

     ```
     ## Scatter Celebration
     - enabled: true
     - duration-ms: 1800
     - pulse-cycles: 4
     - pulse-cycle-ms: 450
     - dim-opacity: 0.20
     - glow-color: 255,214,110
     - glow-peak: 1.6
     ```

   All keys optional. Unknown keys ignored. Block's resolveConfig() does the
   actual validation — parser only forwards what it sees. */
export function extractScatterCelebration(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:scatter\s*celebration|trigger\s*celebration|scatter\s*animation|trigger\s*animation)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const sc = model.scatterCelebration;
  /* enabled on/off */
  const en = section.match(/\benabled\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (en) {
    const v = en[1].toLowerCase();
    sc.enabled = (v === 'true' || v === 'on' || v === 'yes');
  }
  /* duration-ms */
  const du = section.match(/\bduration[- ]?ms\s*[:=]\s*(\d+)/i);
  if (du) sc.durationMs = parseInt(du[1], 10);
  /* pulse-cycles */
  const pc = section.match(/\bpulse[- ]?cycles?\s*[:=]\s*(\d+)/i);
  if (pc) sc.pulseCycles = parseInt(pc[1], 10);
  /* pulse-cycle-ms */
  const pcm = section.match(/\bpulse[- ]?cycle[- ]?ms\s*[:=]\s*(\d+)/i);
  if (pcm) sc.pulseCycleMs = parseInt(pcm[1], 10);
  /* dim-opacity */
  const dm = section.match(/\bdim[- ]?opacity\s*[:=]\s*(0?\.\d+|0|1)/i);
  if (dm) sc.dimOpacity = parseFloat(dm[1]);
  /* glow-color "r,g,b" */
  const gc = section.match(/\bglow[- ]?color\s*[:=]\s*(\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})/i);
  if (gc) sc.glowColor = gc[1].replace(/\s+/g, '');
  /* glow-peak */
  const gp = section.match(/\bglow[- ]?peak\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (gp) sc.glowPeak = parseFloat(gp[1]);
}

/* ── extractStageBadge — GDD-driven stage badge config ───────────────────
   Reads optional knobs from a "## Stage Badge" / "## Phase Badge" /
   "## Live Indicator" section in the GDD. All keys optional. */
export function extractStageBadge(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:stage\s*badge|phase\s*badge|live\s*indicator)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const sb = model.stageBadge;
  const en = section.match(/\benabled\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (en) {
    const v = en[1].toLowerCase();
    sb.enabled = (v === 'true' || v === 'on' || v === 'yes');
  }
  const bl = section.match(/\bbase[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im);
  if (bl) sb.baseLabel = bl[1].trim();
  const fl = section.match(/\bfs[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im);
  if (fl) sb.fsLabel = fl[1].trim();
  const gd = section.match(/\bgold\s*[:=]\s*(\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})/i);
  if (gd) sb.gold = gd[1].replace(/\s+/g, '');
  const ms = section.match(/\bpulse[- ]?ms\s*[:=]\s*(\d+)/i);
  if (ms) sb.pulseMs = parseInt(ms[1], 10);
  const mb = section.match(/\bmobile[- ]?breakpoint\s*[:=]\s*(\d+)/i);
  if (mb) sb.mobileBreakpoint = parseInt(mb[1], 10);
}

/* ── extractAnticipation — GDD-driven anticipation glow config ───────────
   Reads optional knobs from a "## Anticipation" / "## Reel Anticipation"
   section. All keys optional. */
export function extractAnticipation(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:anticipation|reel\s*anticipation)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const a = model.anticipation;
  const en = section.match(/\benabled\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (en) {
    const v = en[1].toLowerCase();
    a.enabled = (v === 'true' || v === 'on' || v === 'yes');
  }
  const hm = section.match(/\bhold[- ]?ms\s*[:=]\s*(\d+)/i);
  if (hm) a.holdMs = parseInt(hm[1], 10);
  const pm = section.match(/\bpulse[- ]?ms\s*[:=]\s*(\d+)/i);
  if (pm) a.pulseMs = parseInt(pm[1], 10);
  const gd = section.match(/\bgold\s*[:=]\s*(\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})/i);
  if (gd) a.gold = gd[1].replace(/\s+/g, '');
  const sd = section.match(/\bskip[- ]?during[- ]?fs\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (sd) {
    const v = sd[1].toLowerCase();
    a.skipDuringFs = (v === 'true' || v === 'on' || v === 'yes');
  }
}

/* ── extractSpinTempo — GDD-driven reel spin cadence config ──────────────
   Reads optional knobs from a "## Spin Tempo" / "## Reel Tempo" /
   "## Spin Cadence" section. Supports presets + per-key overrides. */
export function extractSpinTempo(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:spin\s*tempo|reel\s*tempo|spin\s*cadence|spin\s*timing)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const st = model.spinTempo;
  const pr = section.match(/\bpreset\s*[:=]\s*['"]?(s[- ]?avp|fast|slow)['"]?/i);
  if (pr) st.preset = pr[1].toLowerCase().replace(/\s+/g, '-');

  const intMap = [
    ['windupMs',     /\bwindup[- ]?ms\s*[:=]\s*(\d+)/i],
    ['windupFrames', /\bwindup[- ]?frames\s*[:=]\s*(\d+)/i],
    ['windupPx',     /\bwindup[- ]?px\s*[:=]\s*(\d+)/i],
    ['accelMs',      /\baccel[- ]?ms\s*[:=]\s*(\d+)/i],
    ['steadyMs',     /\bsteady[- ]?ms\s*[:=]\s*(\d+)/i],
    ['decelMs',      /\bdecel[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staggerMs',    /\bstagger[- ]?ms\s*[:=]\s*(\d+)/i],
    ['bouncePx',     /\bbounce[- ]?px\s*[:=]\s*(\d+)/i],
    ['bounceCount',  /\bbounce[- ]?count\s*[:=]\s*(\d+)/i],
  ];
  for (const [key, rx] of intMap) {
    const m = section.match(rx);
    if (m) st[key] = parseInt(m[1], 10);
  }

  const floatMap = [
    ['bounceDecay',      /\bbounce[- ]?decay\s*[:=]\s*(\d+(?:\.\d+)?)/i],
    ['bounceElasticity', /\bbounce[- ]?elasticity\s*[:=]\s*(\d+(?:\.\d+)?)/i],
    ['decelEasingSpeed', /\bdecel[- ]?easing[- ]?speed\s*[:=]\s*(\d+(?:\.\d+)?)/i],
  ];
  for (const [key, rx] of floatMap) {
    const m = section.match(rx);
    if (m) st[key] = parseFloat(m[1]);
  }
}

/* ── extractFreeSpinsPresentation — GDD-driven placard / HUD / toast config
   Reads optional knobs from a "## Free Spins Presentation" /
   "## FS Presentation" / "## Free Spins Placard" / "## Bonus Presentation"
   section. All keys optional. */
export function extractFreeSpinsPresentation(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:free\s*spins\s*presentation|fs\s*presentation|free\s*spins\s*placard|bonus\s*presentation|fs\s*placard)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const fp = model.freeSpinsPresentation;
  const en = section.match(/\benabled\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (en) {
    const v = en[1].toLowerCase();
    fp.enabled = (v === 'true' || v === 'on' || v === 'yes');
  }

  const labels = [
    ['introLabel',    /\bintro[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['outroLabel',    /\boutro[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['totalWinLabel', /\btotal[- ]?win[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['introCta',      /\bintro[- ]?cta\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['outroCta',      /\boutro[- ]?cta\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['introSub',      /\bintro[- ]?sub\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
  ];
  for (const [k, rx] of labels) {
    const m = section.match(rx);
    if (m) fp[k] = m[1].trim();
  }

  const ints = [
    ['fadeMs',             /\bfade[- ]?ms\s*[:=]\s*(\d+)/i],
    ['enterActiveDelayMs', /\benter[- ]?active[- ]?(?:delay[- ]?)?ms\s*[:=]\s*(\d+)/i],
    ['spinBreathMs',       /\bspin[- ]?breath[- ]?ms\s*[:=]\s*(\d+)/i],
    ['toastMs',            /\btoast[- ]?ms\s*[:=]\s*(\d+)/i],
    ['retriggerToastMs',   /\bretrigger[- ]?toast[- ]?ms\s*[:=]\s*(\d+)/i],
  ];
  for (const [k, rx] of ints) {
    const m = section.match(rx);
    if (m) fp[k] = parseInt(m[1], 10);
  }
}

/* ── extractReelEngine — GDD-driven reel engine CSS knobs ────────────────
   "## Reel Engine" / "## Spin Blur" section. All keys optional. */
export function extractReelEngine(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:reel\s*engine|spin\s*blur)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;
  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const re = model.reelEngine;
  const bp = section.match(/\bblur[- ]?px\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (bp) re.blurPx = parseFloat(bp[1]);
  const bd = section.match(/\bblur[- ]?dim\s*[:=]\s*(0?\.\d+|0|1)/i);
  if (bd) re.blurDim = parseFloat(bd[1]);
  const bf = section.match(/\bblur[- ]?fade[- ]?ms\s*[:=]\s*(\d+)/i);
  if (bf) re.blurFadeMs = parseInt(bf[1], 10);
}

/* ── extractTriggerCounting — GDD-driven trigger counting knobs ──────────
   "## Trigger Counting" / "## Scatter Counting" section. All keys optional. */
export function extractTriggerCounting(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:trigger\s*counting|scatter\s*counting)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;
  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const tc = model.triggerCounting;
  const dt = section.match(/\bdefault[- ]?threshold\s*[:=]\s*(\d+)/i);
  if (dt) tc.defaultThreshold = parseInt(dt[1], 10);
}

/* ── extractPostSpin — GDD-driven post-spin orchestration knobs ──────────
   "## Post Spin" / "## Post-Spin Orchestration" section. All keys optional. */
export function extractPostSpin(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:post[- ]?spin|post[- ]?spin\s*orchestration)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;
  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const ps = model.postSpin;
  const intMap = [
    ['settlePauseMs',       /\bsettle[- ]?pause[- ]?ms\s*[:=]\s*(\d+)/i],
    ['forcedSettlePauseMs', /\bforced[- ]?settle[- ]?pause[- ]?ms\s*[:=]\s*(\d+)/i],
    ['retriggerCap',        /\bretrigger[- ]?cap\s*[:=]\s*(\d+)/i],
    ['fsSpinBreathMs',      /\bfs[- ]?spin[- ]?breath[- ]?ms\s*[:=]\s*(\d+)/i],
    ['fakeWinMaxX',         /\bfake[- ]?win[- ]?max[- ]?x\s*[:=]\s*(\d+)/i],
  ];
  for (const [k, rx] of intMap) {
    const m = section.match(rx);
    if (m) ps[k] = parseInt(m[1], 10);
  }
  const fwc = section.match(/\bfake[- ]?win[- ]?chance\s*[:=]\s*(0?\.\d+|0|1)/i);
  if (fwc) ps.fakeWinChance = parseFloat(fwc[1]);
}

/* ── extractReelEngineHot — GDD-driven reel engine hot-path knobs ────────
   "## Reel Engine Hot" / "## Spin Physics" / "## Reel Hot-Path" section. */
export function extractReelEngineHot(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:reel\s*engine\s*hot|spin\s*physics|reel\s*hot[- ]?path)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;
  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const rh = model.reelEngineHot;
  const intMap = [
    ['minRotations',      /\bmin[- ]?rotations\s*[:=]\s*(\d+)/i],
    ['settleBreathMs',    /\bsettle[- ]?breath[- ]?ms\s*[:=]\s*(\d+)/i],
    ['stripBufferCells',  /\bstrip[- ]?buffer[- ]?cells\s*[:=]\s*(\d+)/i],
    ['staticPreRollMs',   /\bstatic[- ]?pre[- ]?roll[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticBlurSwapMs',  /\bstatic[- ]?blur[- ]?swap[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticStaggerMs',   /\bstatic[- ]?stagger[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticHoldMs',      /\bstatic[- ]?hold[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticSettleMs',    /\bstatic[- ]?settle[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticFallbackMs',  /\bstatic[- ]?fallback[- ]?ms\s*[:=]\s*(\d+)/i],
  ];
  for (const [k, rx] of intMap) {
    const m = section.match(rx);
    if (m) rh[k] = parseInt(m[1], 10);
  }
  const floatMap = [
    ['snapThreshold',  /\bsnap[- ]?threshold\s*[:=]\s*(\d+(?:\.\d+)?)/i],
    ['minStepPx',      /\bmin[- ]?step[- ]?px\s*[:=]\s*(\d+(?:\.\d+)?)/i],
    ['accelMinFactor', /\baccel[- ]?min[- ]?factor\s*[:=]\s*(\d+(?:\.\d+)?)/i],
  ];
  for (const [k, rx] of floatMap) {
    const m = section.match(rx);
    if (m) rh[k] = parseFloat(m[1]);
  }
}

/* ─── Wave K — extractors for Pay-Anywhere suite ──────────────────────────── */

/* ── extractPayAnywhereEval — bucket-paytable from emoji symbol tables ───
   Reads paytables under "### High-pay" / "### Mid-pay" / "### Low-pay"
   shaped like:

     | ID | Name | min8 | 8-9 | 10-11 | 12+ |
     |---|---|:-:|:-:|:-:|:-:|
     | `Z` | Zeus (Crown) | 8 | 10x | 25x | 50x |

   Buckets are inferred from header columns matching `\d+[-+]\d*`. Output:
     model.payAnywhereEval.paytable = { Z: [10, 25, 50], H: [2.5, 10, 25] }
     model.payAnywhereEval.bucketEdges = [10, 12]
     model.payAnywhereEval.minWin = 8

   No-op when topology.evaluation !== 'pay_anywhere' (line-pays games
   keep their per-line paytables — bucket rule would corrupt them). */
export function extractPayAnywhereEval(text, model) {
  if (!text || !model) return;
  if (!model.topology || model.topology.evaluation !== 'pay_anywhere') return;
  const pae = model.payAnywhereEval;
  pae.enabled = true;

  // Section headers we should scan
  const headers = ['High[\\s-]?pay', 'Mid[\\s-]?pay', 'Low[\\s-]?pay'];
  const paytable = {};
  let bucketEdges = null;
  let minWin = null;

  for (const h of headers) {
    const headingRx = new RegExp(`###[^\\n]*\\b${h}\\b[^\\n]*\\n`, 'i');
    const hm = text.match(headingRx);
    if (!hm) continue;
    const start = hm.index + hm[0].length;
    const rest = text.slice(start, start + 4000);
    const end = rest.search(/\n##\s|\n###\s/);
    const chunk = end >= 0 ? rest.slice(0, end) : rest;

    // Parse header row (first | … | with bucket columns like "8-9", "10-11", "12+")
    const headerLineMatch = chunk.match(/^\s*\|([^\n]+)\|\s*$/m);
    if (!headerLineMatch) continue;
    const cols = headerLineMatch[1].split('|').map(s => s.trim());
    // Locate columns labeled like "8-9", "10-11", "12+" (bucket ranges)
    const bucketColIdx = [];
    const edges = [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const range = c.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      const open  = c.match(/^(\d+)\s*\+$/);
      if (range) { bucketColIdx.push(i); edges.push(parseInt(range[1], 10)); }
      else if (open) { bucketColIdx.push(i); edges.push(parseInt(open[1], 10)); }
    }
    if (bucketColIdx.length < 2) continue;

    // Use the first edge as minWin if not yet set
    if (minWin == null) minWin = edges[0];
    // bucketEdges = the SUBSEQUENT bucket start values (drop first)
    if (!bucketEdges) bucketEdges = edges.slice(1);

    // Parse data rows
    const dataRowRe = /^\s*\|([^\n]+)\|\s*$/gm;
    let m;
    while ((m = dataRowRe.exec(chunk)) !== null) {
      const rowCols = m[1].split('|').map(s => s.trim());
      // Skip the header itself and divider rows
      if (rowCols.every(c => /^[:-\s]+$/.test(c))) continue;
      const idCol = rowCols[0] ? rowCols[0].replace(/[`*]/g, '').trim() : '';
      if (!idCol || idCol.toLowerCase() === 'id') continue;
      const id = idCol.match(/^([A-Za-z0-9_]{1,4})$/);
      if (!id) continue;
      const symId = id[1].toUpperCase();
      const payouts = bucketColIdx.map(ci => {
        const v = rowCols[ci] || '';
        const num = v.match(/(\d+(?:\.\d+)?)\s*x?/i);
        return num ? parseFloat(num[1]) : 0;
      });
      if (payouts.some(p => p > 0)) paytable[symId] = payouts;
    }
  }

  if (Object.keys(paytable).length > 0) {
    pae.paytable = paytable;
    if (bucketEdges && bucketEdges.length > 0) pae.bucketEdges = bucketEdges;
    if (minWin != null) pae.minWin = minWin;
  }
}

/* ── extractMultiplierOrb — detect orb symbol + value distribution ──── */
export function extractMultiplierOrb(text, model) {
  if (!text || !model) return;
  const orb = model.multiplierOrb;

  // Look in Specials block for a row mentioning "Multiplier Orb" / "Orb".
  // CRITICAL: JS regex does NOT support `\Z` (Perl/Ruby anchor for end of
  // input). Using `\Z` made the engine treat it as a literal `Z` character,
  // truncating any Specials block where a row contained the word "Zeus".
  // `$(?![\s\S])` is the portable "true end of input" pattern.
  const specialsBlock = text.match(/###[^\n]*\bSpecials?\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n###\s|$(?![\s\S]))/i);
  if (specialsBlock) {
    const rows = specialsBlock[1].split(/\n/);
    for (const row of rows) {
      // Split on `|` and take all non-empty cells (handles 3/4/5/6-col tables uniformly)
      const cells = row.split('|').map(s => s.trim()).filter(s => s.length > 0);
      if (cells.length < 2) continue;
      const idRaw = cells[0].replace(/[`*]/g, '').trim();
      const name = cells[1] || '';
      // Concatenate all REMAINING cells as the "role/description" — that's
      // where the value range lives in multi-column variants.
      const role = cells.slice(2).join(' ');
      if (!/^[A-Za-z][A-Za-z0-9_]{0,3}$/.test(idRaw)) continue;
      const id = idRaw;
      if (/orb|multiplier/i.test(name) && id.length <= 4) {
        orb.enabled = true;
        orb.symbolId = id.toUpperCase();
        // Try to read range from role: "2x – 1000x"
        const range = role.match(/(\d+)\s*x?\s*[–\-]\s*(\d+)\s*x?/);
        if (range) {
          const lo = parseInt(range[1], 10);
          const hi = parseInt(range[2], 10);
          if (lo > 0 && hi > lo) {
            // Build a graduated distribution between lo and hi (log-decaying)
            const dist = [];
            const baseVals = [2,3,4,5,6,8,10,12,15,20,25,50,100,250,500,1000].filter(v => v >= lo && v <= hi);
            for (const v of baseVals) {
              // Weight: higher value = much lower weight (log decay)
              const w = Math.max(0.5, 500 / Math.pow(v, 1.3));
              dist.push({ value: v, weight: parseFloat(w.toFixed(2)) });
            }
            if (dist.length > 0) orb.distribution = dist;
          }
        }
        break;
      }
    }
  }

  // bonusAccumulate auto-enable when FS block mentions accumulating / progressive multiplier
  if (orb.enabled && /\b(akumulira|accumulat|progresiv|persistent|bonus[\s_]?multiplier|grows)\b/i.test(text)) {
    orb.bonusAccumulate = true;
  }
}

/* ── extractBonusBuy — detect cost + force-scatter count ─────────────── */
export function extractBonusBuy(text, model) {
  if (!text || !model) return;
  const has = /\bbonus[\s_-]?buy\b|\bbuy[\s_-]?(?:feature|bonus|fs)\b|\bfeature[\s_-]?buy\b/i.test(text);
  if (!has) return;
  const bb = model.bonusBuy;
  bb.enabled = true;

  // Section: "## Bonus Buy" or "## 07 · Bonus Buy" — read Cena (Cost) cell.
  // Allow numbered heading prefix (`07 · ` / `07. ` / `7) `) before the title.
  // `$(?![\s\S])` is the portable JS-safe "true end of input" (JS lacks `\Z`).
  const sec = text.match(/^##\s*(?:\d+[\s.·)\-]+)?Bonus\s*Buy[^\n]*\n([\s\S]*?)(?=\n##\s|$(?![\s\S]))/im);
  if (sec) {
    const body = sec[1];
    const cost = body.match(/\|\s*(?:Cena|Cost|Price)\s*\|\s*\*?\*?(\d+)\s*x?\s*\*?\*?/i);
    if (cost) bb.costX = parseInt(cost[1], 10);
    const guar = body.match(/\|\s*(?:Garantuje|Guarantee[s]?)\s*\|[^|\n]*?(\d+)\s*\+?\s*Scatter/i);
    if (guar) bb.forceScatters = parseInt(guar[1], 10);
  } else {
    // Fallback prose: "Bonus Buy: 100x", "Buy Feature 75x"
    const cost = text.match(/\bbonus[\s_-]?buy[^\n.]{0,40}?(\d+)\s*x\b|\bbuy[\s_-]?(?:feature|bonus)[^\n.]{0,40}?(\d+)\s*x\b/i);
    if (cost) bb.costX = parseInt(cost[1] || cost[2], 10);
  }
}

/* ── extractAnteBet — detect cost multiplier + trigger boost ─────────── */
export function extractAnteBet(text, model) {
  if (!text || !model) return;
  const has = /\bante[\s_-]?bet\b/i.test(text);
  if (!has) return;
  const ab = model.anteBet;
  ab.enabled = true;

  const sec = text.match(/^##\s*(?:\d+[\s.·)\-]+)?Ante\s*Bet[^\n]*\n([\s\S]*?)(?=\n##\s|$(?![\s\S]))/im);
  if (sec) {
    const body = sec[1];
    // Cena: "+25% uloga" / "+20% bet"
    const pct = body.match(/\|\s*(?:Cena|Cost|Price)\s*\|[^|\n]*?\+(\d+)\s*%/i);
    if (pct) ab.costMultiplier = 1 + (parseInt(pct[1], 10) / 100);
    // Trigger doubled
    if (/\b(duplira|double[sd]?|2x)\b/i.test(body)) ab.triggerMultiplier = 2;
    else {
      const m = body.match(/\b(?:×|x)\s*(\d+(?:\.\d+)?)\s+(?:trigger|verovatno[čć])/i);
      if (m) ab.triggerMultiplier = parseFloat(m[1]);
    }
  } else {
    // Fallback prose
    const pct = text.match(/\bante[\s_-]?bet[^\n.]{0,40}?\+(\d+)\s*%/i);
    if (pct) ab.costMultiplier = 1 + (parseInt(pct[1], 10) / 100);
  }
}

/* ── extractTumble — read tumble block knobs ─────────────────────────── */
export function extractTumble(text, model) {
  if (!text || !model) return;
  const tu = model.tumble;
  // If topology already detected cascade, mirror enable
  if (model.topology && model.topology.cascade && model.topology.cascade.enabled) {
    tu.enabled = true;
  }
  const headingRx = /^##\s*(?:\d+[\s.·)\-]+)?(?:tumble|cascade|avalanche)[^\n]*\n/im;
  const hm = text.match(headingRx);
  if (!hm) return;
  const start = hm.index + hm[0].length;
  const tail = text.slice(start);
  const nextH = tail.match(/^#{1,2}\s/m);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const intMap = [
    ['removeMs',     /\bremove[- ]?ms\s*[:=]\s*(\d+)/i],
    ['gravityMs',    /\bgravity[- ]?ms\s*[:=]\s*(\d+)/i],
    ['refillMs',     /\brefill[- ]?ms\s*[:=]\s*(\d+)/i],
    ['chainPauseMs', /\bchain[- ]?pause[- ]?ms\s*[:=]\s*(\d+)/i],
    ['maxChain',     /\bmax[- ]?chain\s*[:=]\s*(\d+)/i],
  ];
  for (const [k, rx] of intMap) {
    const m = section.match(rx);
    if (m) tu[k] = parseInt(m[1], 10);
  }
  if (/\bpreserve[- ]?orbs?\s*[:=]\s*(true|yes|on)/i.test(section)) tu.preserveOrbs = true;
  if (/\bpreserve[- ]?orbs?\s*[:=]\s*(false|no|off)/i.test(section)) tu.preserveOrbs = false;
}
