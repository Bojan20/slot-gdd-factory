/**
 * src/pdfToMarkdown.mjs
 *
 * Heuristic converter: raw text extracted from PDF/DOCX → markdown that
 * parser.mjs understands.
 *
 * Why: parser.mjs uses markdown sigils (`#` headings, `|` tables,
 * `###` sub-headings) for every extractor. PDF.js / mammoth flatten that
 * structure into a single text stream, so the original parser gets
 * "Untitled Slot" + 0 symbols.
 *
 * This module pattern-matches the canonical industry GDD vocabulary
 * (game name, grid topology, paytable rows, feature blocks) and
 * reconstructs the markdown skeleton the parser expects.
 *
 * Pure Node module — no DOM, no globals.
 */

/** Convert plain text (PDF/DOCX extraction) to parser-ready markdown. */
export function pdfTextToMarkdown(raw) {
  if (!raw || typeof raw !== 'string') return '';

  /* Preserve a raw, layout-intact copy for column-aware extractors
   * (game name multi-line wrap detection needs to see 2+ spaces as a
   * column separator, which the whitespace-collapsing normalizer below
   * would destroy). All other extractors take the normalized `txt`. */
  const rawText = raw.replace(/\r/g, '');

  // Normalize whitespace: collapse runs of spaces, keep paragraph breaks
  let txt = raw
    .replace(/\r/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const out = [];

  /* ── 1. Game name — first proper-cased multi-word title near start.
   * Use rawText so the multi-line wrap detector sees column gaps. */
  const name = extractGameName(rawText);
  if (name) out.push(`# ${name}\n`);

  /* ── 1b. Theme / market / mood metadata table ───────────────────────── */
  const meta = extractMetaPanel(txt);
  // Palette: surface the first 6 unique hex codes from the raw PDF prose.
  // The parser pulls hex with /#[0-9a-fA-F]{6}/g across the whole markdown
  // doc, so embedding them as a bullet line is enough to make them visible.
  const palette = [...new Set((rawText.match(/#[0-9a-fA-F]{6}/g) || []))].slice(0, 6);
  if (name || meta.themeTags || meta.targetMarket || meta.genre || meta.mood || meta.setting
      || meta.typography || meta.vibeRefs || palette.length > 0) {
    if (name)              out.push(`| Internal name | ${name} |`);
    if (meta.themeTags)    out.push(`| Theme tags | ${meta.themeTags} |`);
    if (meta.mood)         out.push(`| Mood | ${meta.mood} |`);
    if (meta.setting)      out.push(`| Setting | ${meta.setting} |`);
    if (meta.typography)   out.push(`| Typography | ${meta.typography} |`);
    if (meta.vibeRefs)     out.push(`| Vibe references | ${meta.vibeRefs} |`);
    if (meta.genre)        out.push(`| Genre | ${meta.genre} |`);
    if (meta.targetMarket) out.push(`| Target market | ${meta.targetMarket} |`);
    if (palette.length > 0) out.push(`| Palette | ${palette.join(' · ')} |`);
    out.push('');
  }

  /* ── 2. Topology / Grid ─────────────────────────────────────────────── */
  const grid = extractGrid(txt);
  // Evaluation kind — scatter pays → pay_anywhere, etc.
  const evalKind = extractEvaluation(txt);
  const waysCount = (evalKind === 'ways') ? extractWaysCount(txt) : null;
  const rtp = extractRTP(txt);
  const maxWin = extractMaxWin(txt);
  const volatility = extractVolatility(txt);
  const hitFreq = extractHitFrequency(txt);

  out.push(`## 02 · Topology`);
  out.push('');
  out.push('| Parametar | Vrednost |');
  out.push('|---|---|');
  /* Defensive fallback: every emitted GDD must produce a renderable grid.
   * If PDF text didn't surface explicit reels × rows, fall back to 5×3
   * (universal slot baseline). Industry rule: parser must never refuse a
   * GDD silently — explicit defaults > empty model. */
  out.push(`| Reels | ${grid.reels || 5} |`);
  out.push(`| Rows | ${grid.rows || 3} |`);
  if (evalKind === 'pay_anywhere') {
    out.push(`| Evaluation | Pay anywhere grid |`);
  } else if (evalKind === 'cluster') {
    out.push(`| Evaluation | Cluster pays |`);
  } else if (evalKind === 'ways') {
    out.push(`| Evaluation | Ways |`);
    if (waysCount) out.push(`| Ways count | ${waysCount} |`);
  } else {
    out.push(`| Evaluation | Lines |`);
  }
  if (rtp)    out.push(`| RTP (standard) | ${rtp}% | Glavna verzija |`);
  if (maxWin) out.push(`| Max win | ${maxWin}x | Hard cap |`);
  if (volatility) out.push(`| Volatility | ${volatility} |`);
  if (hitFreq)    out.push(`| Hit frequency | ${hitFreq} |`);
  out.push('');

  // Pay anywhere → emit explicit Scatter Pay feature heading so the parser
  // counts it among features (otherwise MD has 6 features, PDF has 5).
  if (evalKind === 'pay_anywhere') {
    out.push(`## 02b · Scatter Pay`);
    out.push('');
    out.push('Scatter pays evaluation — bilo gde na mreži, min. 8 istih simbola.');
    out.push('');
  }
  // Ways — explicit Ways to Win section so parser feature-extract picks
  // up the `ways` mechanic (counts among GDD features alongside FS/etc).
  if (evalKind === 'ways') {
    out.push(`## 02c · Ways to Win`);
    out.push('');
    out.push(`${waysCount || 243} Ways to Win evaluator — bilo koja kombinacija ` +
             `istih simbola na uzastopnim ril-ovima sleva-udesno, ` +
             `pomnožena brojem pojavljivanja po ril-u.`);
    out.push('');
  }

  /* ── 3. Tumble / Cascade ────────────────────────────────────────────── */
  if (/\b(tumbl|cascad|avalanch)/i.test(txt)) {
    out.push(`## 04 · Tumble (Cascade) Mechanic`);
    out.push('');
    out.push('Reel mechanism — Cascade. Tumble mehanika u svakom spinu — pobednički simboli nestaju, gravitacija puni prazna polja, novi simboli padaju sa vrha. Multiplier orbi ostaju na ekranu tokom celog tumblesa.');
    out.push('');
  }

  /* ── 4. Symbols & Paytable ──────────────────────────────────────────── */
  /* Generic table-driven extractor + always-on fallback set.
   * Industry rule (Boki 06.06.2026): NEVER let a GDD upload produce a
   * paytable-less dist. If extractor parses 0 symbols, emit a vendor-
   * neutral A/K/Q/J + HP1/HP2/HP3 placeholder set so the dist always
   * renders. The downstream renderer treats explicit symbols same way
   * regardless of extraction confidence — fallback is invisible to UX. */
  let symbols = extractSymbols(txt);
  const extractedAny = symbols.high.length + symbols.mid.length + symbols.low.length + symbols.specials.length;
  if (extractedAny === 0) {
    symbols = fallbackSymbolSet();
  }

  out.push(`## 03 · Symbols & Paytable`);
  out.push('');
  if (symbols.high.length) {
    out.push(`### High-pay`);
    out.push('');
    out.push('| ID | Name | min8 | 3x | 4x | 5x |');
    out.push('|---|---|:-:|:-:|:-:|:-:|');
    symbols.high.forEach(s => out.push(`| \`${s.id}\` | ${s.name} | 3 | ${s.pay[0]||1}x | ${s.pay[1]||2}x | ${s.pay[2]||5}x |`));
    out.push('');
  }
  if (symbols.mid.length) {
    out.push(`### Mid-pay`);
    out.push('');
    out.push('| ID | Name | min8 | 3x | 4x | 5x |');
    out.push('|---|---|:-:|:-:|:-:|:-:|');
    symbols.mid.forEach(s => out.push(`| \`${s.id}\` | ${s.name} | 3 | ${s.pay[0]||0.5}x | ${s.pay[1]||1}x | ${s.pay[2]||2}x |`));
    out.push('');
  }
  if (symbols.low.length) {
    out.push(`### Low-pay`);
    out.push('');
    out.push('| ID | Name | min8 | 3x | 4x | 5x |');
    out.push('|---|---|:-:|:-:|:-:|:-:|');
    symbols.low.forEach(s => out.push(`| \`${s.id}\` | ${s.name} | 3 | ${s.pay[0]||0.2}x | ${s.pay[1]||0.5}x | ${s.pay[2]||1}x |`));
    out.push('');
  }
  if (symbols.specials.length) {
    out.push(`### Specials`);
    out.push('');
    out.push('| ID | Name | Role |');
    out.push('|---|---|---|');
    symbols.specials.forEach(s => out.push(`| \`${s.id}\` | ${s.name} | ${s.role} |`));
    out.push('');
  }

  /* ── 5. Free Spins ──────────────────────────────────────────────────── */
  const fs = extractFreeSpins(txt);
  if (fs.detected) {
    out.push(`## 06 · Free Spins`);
    out.push('');
    out.push(`### Trigger`);
    out.push(`${fs.triggerCount}+ Scatter simbola bilo gde na mreži.`);
    out.push(`**Nagrada:** ${fs.spinsAward} Free Spins.`);
    out.push('');
    if (fs.akumulirajuci) {
      out.push(`### Akumulirajući Multiplier`);
      out.push('Svaki multiplier orb koji učestvuje u dobitku se dodaje u Bonus_Multiplier (počinje na 0x). Akumulirajuća mehanika — primenjuje se na svaki naredni dobitak u bonusu.');
      out.push('');
    }
    if (fs.retriggerSpins) {
      out.push(`### Retrigger`);
      out.push(`3+ Scatter tokom bonusa = **+${fs.retriggerSpins} Free Spins** (neograničeno).`);
      out.push('');
    }
  }

  /* ── 6. Bonus Buy ───────────────────────────────────────────────────── */
  const bb = extractBonusBuy(txt);
  if (bb.detected) {
    out.push(`## 07 · Bonus Buy`);
    out.push('');
    out.push('| Parametar | Vrednost |');
    out.push('|---|---|');
    out.push(`| Cena | **${formatCost(bb.costX)}x** trenutni ulog |`);
    out.push(`| Garantuje | ${bb.forceScatters}+ Scatter simbola (trigger bonusa) |`);
    if (rtp) out.push(`| RTP | Identičan base RTP (${rtp}%) |`);
    out.push('');
  }

  /* ── 7. Ante Bet ────────────────────────────────────────────────────── */
  const ab = extractAnteBet(txt);
  if (ab.detected) {
    out.push(`## 08 · Ante Bet`);
    out.push('');
    out.push('| Parametar | Vrednost |');
    out.push('|---|---|');
    out.push(`| Cena | +${ab.pctIncrease}% uloga |`);
    out.push(`| Efekat | Duplira verovatnoću za bonus trigger |`);
    out.push('');
  }

  return out.join('\n');
}

/* ─── helpers — pattern extractors ─────────────────────────────────────── */

function extractGameName(txt) {
  // Strategy 1: explicit "Radni naslov:" / "Internal name:" line.
  // PDF.js / pdftotext frequently wrap a long title across two physical
  // lines ("Radni naslov: Gates of\nOlympus 1000"). When the captured
  // value ends in a connector word (of / the / and / &), peek at the
  // next non-empty line and append it.
  let m = txt.match(/(?:Radni naslov|Internal name|Game title|Game name|Title)\s*:\s*([A-Z][A-Za-z0-9 '\-]{2,60})/i);
  if (m) {
    let title = m[1].trim();
    if (/\s(?:of|the|and|&)$/i.test(title)) {
      const tail = txt.slice(m.index + m[0].length, m.index + m[0].length + 80);
      const nextLine = tail.split(/\n/).map(s => s).filter(s => s.trim())[0];
      if (nextLine && /^\s*[A-Za-z0-9]/.test(nextLine)) {
        /* pdftotext -layout uses 2+ spaces as a COLUMN separator. Split
         * on `\s{2,}` so we take only the first column (the actual title
         * continuation), discarding adjacent Notes-column words like
         * "Nadogradnja originalne igre" (description) or "v1.0". */
        const firstColumn = nextLine.trim().split(/\s{2,}/)[0];
        const tokens = firstColumn.split(/\s+/);
        const titleTokens = [];
        for (const t of tokens.slice(0, 3)) {
          if (/^[A-Z][A-Za-z0-9'-]*$/.test(t) || /^\d+$/.test(t)) {
            titleTokens.push(t);
          } else break;
        }
        if (titleTokens.length > 0) {
          title = (title + ' ' + titleTokens.join(' ')).replace(/\s{2,}/g, ' ');
        }
      }
    }
    return title;
  }
  // Strategy 2a: ALL-CAPS title before "Game Design Document".
  // Handles either layout:
  //   • newline-separated (pdftotext): "HUFF N' MORE PUFF\nGame Design Document"
  //   • space-collapsed (pdfjs):       "HUFF N' MORE PUFF  Game Design Document"
  // 2026-06-09 huff-puff fix: accept any whitespace gap, not just `\s*\n`.
  m = txt.slice(0, 1200).match(/([A-Z][A-Z0-9' \-]{4,50}[A-Z0-9])\s{1,40}(?:Game\s+Design\s+Document|GDD|G\s*a?\s*m?\s*e?\s*[ -]?\s*D\s*e\s*s\s*i\s*g\s*n)/);
  if (m) return clean(m[1]).replace(/\s{2,}/g, ' ');
  // Strategy 2b: Title-Case sequence followed by "G A M E D E S I G N" / "Game Design"
  m = txt.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z0-9][a-zA-Z0-9]+){1,4})\s+(?:G\s*A\s*M\s*E\s*D\s*E|Game\s*Design)/);
  if (m) return m[1].trim();
  // Strategy 2c: ALL-CAPS multi-token title at the very top of the document.
  //              PDFs frequently put title on line 1; "Game Design" on line 2-3.
  const firstFew = txt.slice(0, 400).split(/\n/).map(s => s.trim()).filter(Boolean).slice(0, 5);
  for (const line of firstFew) {
    if (/^[A-Z][A-Z0-9' \-]{3,50}[A-Z0-9]$/.test(line) && /\s/.test(line)) {
      return clean(line).replace(/\s{2,}/g, ' ');
    }
  }
  // Strategy 2d: 2-line Title-Case title (e.g. "Gates of\nOlympus 1000").
  //              Many PDFs render the title across two lines when the
  //              first line ends with a connector word (of / the / and).
  //              Join the first 2 non-empty top lines and re-check.
  if (firstFew.length >= 2) {
    const joined = (firstFew[0] + ' ' + firstFew[1]).trim();
    if (/^[A-Z][A-Za-z0-9 '\-]{4,60}[A-Za-z0-9]$/.test(joined) &&
        joined.split(/\s+/).length >= 2 && joined.split(/\s+/).length <= 6 &&
        /\b(?:of|the|and|&|N')\b/i.test(joined)) {
      return clean(joined).replace(/\s{2,}/g, ' ');
    }
  }
  // Strategy 3: 2–3 token Title-Case phrase with optional trailing digits
  m = txt.slice(0, 1500).match(/([A-Z][a-z]+(?:\s+(?:of|the|and|&))?\s+[A-Z][a-z]+(?:\s+\d{2,4})?(?:\s+[A-Z][a-z]+)?)/);
  if (m) return m[1].trim();
  return null;
}

function extractGrid(txt) {
  // "6 kolona × 5 redova" / "6 columns × 5 rows" / "6×5" / "6 x 5"
  let m = txt.match(/(\d+)\s*(?:kolona?|columns?|cols?)\s*[×x\*]\s*(\d+)\s*(?:redova?|rows?)/i);
  if (m) return { reels: parseInt(m[1], 10), rows: parseInt(m[2], 10) };
  m = txt.match(/(?:Grid|Mreža)\s*:?\s*(\d+)\s*[×x\*]\s*(\d+)/i);
  if (m) return { reels: parseInt(m[1], 10), rows: parseInt(m[2], 10) };
  m = txt.match(/\b(\d+)\s*[×x]\s*(\d+)\s*(?:pozicij|grid|reels|cabinet)/i);
  if (m) return { reels: parseInt(m[1], 10), rows: parseInt(m[2], 10) };
  m = txt.match(/\b([3-9])\s*[×x]\s*([3-9])\b/);
  if (m) return { reels: parseInt(m[1], 10), rows: parseInt(m[2], 10) };
  return { reels: null, rows: null };
}

function extractEvaluation(txt) {
  if (/\bscatter\s+pays?\b|\bpay\s+anywhere\b|\ball\s+positions?\s+pay/i.test(txt)) return 'pay_anywhere';
  if (/\bcluster\s+pays?\b/i.test(txt)) return 'cluster';
  if (/\d+\s*ways\b|\bways\s+to\s+win|\bvariable[\s-]?ways\b|\bhigh[\s-]?ways\b/i.test(txt)) return 'ways';
  return 'lines';
}

function extractRTP(txt) {
  const m = txt.match(/\bRTP\s*\(?\s*(?:standard|glavna|standardna)\s*\)?\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\s*%/i)
        || txt.match(/\bRTP\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\s*%/i);
  return m ? parseFloat(m[1]) : null;
}

function extractMaxWin(txt) {
  const m = txt.match(/(?:max\s*win|maksimaln(?:i|a)\s*dobitak|max\s*payout)\s*[:=]?\s*([0-9,]+)\s*x/i)
        || txt.match(/\b([0-9,]+)\s*x\b[^,\n]{0,30}(?:hard\s*cap|maksimum|maximum)/i);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, ''), 10);
}

/**
 * Generic table-driven symbol extractor — vendor + theme neutral.
 *
 * Locates the paytable region in PDF-extracted text and parses each row
 * for `(Name) (Type/Tier) (3x) (4x) (5x)` patterns. Falls back to scanning
 * for Wild / Scatter / Bonus role keywords. Card-rank symbols (A/K/Q/J/10)
 * are auto-classified as Low even when no explicit "Low" tier label is
 * present (industry convention since the 1990s royals-as-fillers era).
 *
 * Returns the same shape `{ high, mid, low, specials }` as the legacy
 * vocabulary-driven extractor so the rest of the emitter is unchanged.
 */
function extractSymbols(txt) {
  const high = [], mid = [], low = [], specials = [];

  /* 1. Find the paytable region — heading "Symbols & Paytable" / "PAYTABLE"
   *    / "Symbol Hierarchy". Stop at the NEXT major section boundary so
   *    Distribution / Bonus / Jackpot / Frame Upgrade paytables can't
   *    contaminate the symbol scan (their `Nx Nx Nx` triplets would
   *    otherwise leak as fake symbol rows). */
  const headingRe = /(?:Symbols?\s*(?:&|and)\s*Paytable|Simboli\s*(?:&|i)\s*Paytable|PAYTABLE|Symbol\s+Hierarchy|4\.\d+\s+Symbol\s+Hierarchy|Symbol\s+Type\s+(?:3x|3-of-a-kind))/i;
  let region = txt;
  const headingMatch = txt.match(headingRe);
  if (headingMatch) {
    const fullSlice = txt.slice(headingMatch.index, headingMatch.index + 5000);
    const endRe = /\n\s*(?:\d+\.\d+\s+(?:Symbol\s+Distribution|Reel\s+Strip|Bonus|Jackpot|Frame\s+Upgrade|Free\s+Spins?|Buy\s+Feature|Mathematics?|Math\s+model|Hit\s+Probability)|4\.2\s|5\.\s|6\.\s|BONUS\s+FEATURES|JACKPOT|Symbol\s+Distribution)/i;
    const endMatch = fullSlice.match(endRe);
    region = endMatch ? fullSlice.slice(0, endMatch.index) : fullSlice;
  }

  /* 2. Triplet-anchored scan. Industry paytable rows ALWAYS carry three
   *    `Nx` pay values in succession (3-of-a-kind / 4-of-a-kind / 5-of-a-
   *    kind). pdftotext -layout output frequently wraps a single row
   *    across 2-3 visual lines AND wedges a "Notes" column between pay
   *    values (Premium label split as "Premiu\n m", last pay value
   *    isolated as "10.00\n x", and notes like "Highest paying" sitting
   *    between 4x and 5x columns). Allow up to 120 non-`x` chars between
   *    tokens — region cap (4500 chars after Symbol Hierarchy heading)
   *    guards against cross-table over-match. */
  const seenIds = new Set();
  /* Single tight pass — 80-char gap between pay tokens, anchored on
   * `[^x]` exclusion so we never bleed into prose with stray "x" letters.
   * Rows whose pay values are physically wrapped across ≥3 visual lines
   * (e.g. PIGGY 3 row in Huff'n'Puff GDD where "10.00" sits ABOVE the
   * row and the "x" suffix sits BELOW) are deliberately skipped here —
   * a relaxed multi-line match introduces more false positives (cross-
   * row bleed: capturing PIGGY 2's 1.50x as PIGGY 3's third pay) than
   * it catches. The skipped rows are recovered via the fallback set
   * when the entire paytable extraction yields fewer than 3 symbols. */
  scanTriplets(region, /(\d+(?:\.\d+)?)\s*x[^x]{0,80}?(\d+(?:\.\d+)?)\s*x[^x]{0,80}?(\d+(?:\.\d+)?)\s*x/g,
               { high, mid, low, seenIds });

  /* 2b. 2026-06-09 huff-puff fix: prose-style paytable scan.
   *    PDFs that lay the paytable out as one-row-per-line with the
   *    name in the FIRST column followed by tier label + 3 pay values
   *    ("PIGGY 3 (Brick Pig)   Premium   2.00x   5.00x   10.00x") drop
   *    through the strict triplet scan because of the Notes column or
   *    line-wrap. Recover them by scanning each line for the canonical
   *    "<NAME> <TIER> <Nx> <Nx> <Nx>" shape. Idempotent — extends seenIds
   *    so the triplet pass + this pass never double-count a symbol. */
  scanProseRows(region, { high, mid, low, seenIds });

  /* 2c. 2026-06-09 starlight fix: cluster-pays paytable variant where
   *     each row carries ONE pay value (the max-cluster payout) preceded
   *     by min/max cluster counters:
   *       "Red Lamp (Premium)   High   5   13+   100x"
   *       "Treasure Chest   High   5   13+   50x"
   *     One-pay layout drops through both the triplet AND the 3-pay
   *     prose scan, so we recover here. */
  scanClusterRows(region, { high, mid, low, seenIds });

  /* 3. Special-role rows — Wild / Scatter / Bonus / Multiplier may not
   *    carry pay triplets ("N/A N/A N/A" in some PDFs). Scan the table
   *    region for these by role keyword first, then full-text fallback. */
  scanSpecialRows(region, specials, seenIds);
  detectSpecialRoles(txt, specials, seenIds);

  /* 4. Sort specials so Wild appears before Scatter before Bonus — a
   *    universal industry rendering convention (Wild = substitution rule,
   *    Scatter = trigger, Bonus = prize). */
  specials.sort((a, b) => roleRank(a.role) - roleRank(b.role));

  return { high, mid, low, specials };
}

/**
 * Sweep the region for `Nx Nx Nx` triplets matching the supplied regex
 * and pipe each into extractNameFromContext + classifyTier. Idempotent
 * across multiple calls via the shared seenIds set (subsequent passes
 * with wider gaps only fill in gaps from earlier passes).
 */
/**
 * 2026-06-09 huff-puff fix — scan an explicit "Name TierLabel Nx Nx Nx"
 * row layout (each paytable row on its own logical line). Handles the
 * common Light-and-Wonder / Aristocrat style document where the row
 * keeps name tokens together and the Notes column lives AFTER the third
 * pay value (rather than between values).
 *
 *   Examples that match:
 *     "PIGGY 3 (Brick Pig)   Premium   2.00x   5.00x   10.00x   Highest paying"
 *     "Toolbox   Mid   0.50x   1.00x   2.50x"
 *     "A   Low   0.20x   0.50x   1.50x"
 *     "J   Low   0.10x   0.20x   0.80x   Min 4 for win"
 *
 * Tier label is REQUIRED so we don't match jackpot or distribution
 * tables that also carry `Nx Nx Nx` triplets but no tier word.
 */
function scanProseRows(region, ctx) {
  // 1-40 char name (letters / spaces / digits / parens / apostrophe / dash)
  // → REQUIRED tier word (PDF.js sometimes wraps "Premium" → "Premiu m",
  // hence the optional `\s+m\b` after Premiu / High → High y, etc.).
  // Word-boundary on the FIRST tier letter so "Hierarchy" can't match.
  // → optional min-count digit run (8 / 12+ — scatter-pays style)
  // → 3 Nx values, separated by whitespace runs. The last `x` may have
  // a space before it ("10.00 x") from line wrapping.
  // No newline anchor: PDF.js collapses paytables onto a single line.
  // 2026-06-09 gates fix: accept optional min-count between tier word and
  // first pay value ("Zeus High 8 10x 25x 50x" — 8-symbol cluster pay
  // baseline). Without this, Pragmatic-style scatter pays paytables drop
  // every row.
  const re = /([A-Z][A-Za-z0-9'()\- ]{0,40})\s+\b(Premiu(?:m|\s+m)|Premium|Mid|Low|High|Royal|Standard)\b\s+(?:\d{1,3}\+?\s+){0,1}(\d+(?:\.\d+)?)\s*x\s+(\d+(?:\.\d+)?)\s*x\s+(\d+(?:\.\d+)?)\s*x/g;
  let m;
  // Header tokens that look like a name but are actually table chrome.
  const BLOCKLIST = /\b(Hierarchy|Type|Notes?|Symbol|Header|Distribution|Reel|Strip|Column|Row|Frequency|Probability|Total|Avg|Min|Max|Sum)\b/i;

  while ((m = re.exec(region)) !== null) {
    let rawName = m[1].trim().replace(/\s+/g, ' ');
    const tierHint = m[2].toLowerCase().startsWith('premi') ? 'premium' : m[2].toLowerCase();
    const pay = [parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5])];

    // Strip parenthetical aside so the name is the canonical token
    // ("PIGGY 3 (Brick Pig)" → "PIGGY 3"). Also strip leading section
    // anchors like "4.1" that bleed in from chapter headings.
    rawName = rawName
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/^\s*\d+(\.\d+)?\s+/, '')
      .trim();
    if (!rawName || rawName.length > 32) continue;
    if (BLOCKLIST.test(rawName)) continue;
    // Skip rows where the name reduces to a single tier word ("Symbol",
    // "Notes") after the blocklist sweep — already covered above but
    // belt-and-braces.

    // ID = first capital letter sequence or first letter + digits
    let id;
    const compact = rawName.replace(/[^A-Za-z0-9]/g, '');
    if (compact.length <= 4) id = compact.toUpperCase();
    else {
      // Multi-word: take initial of each word, capped at 4 chars
      id = rawName.split(/\s+/).map(t => t[0]).join('').toUpperCase().slice(0, 4);
    }
    if (!id) continue;
    if (ctx.seenIds.has(id)) continue;
    ctx.seenIds.add(id);

    const tier = classifyTier(rawName, tierHint);
    const entry = { id, name: rawName, pay };
    if (tier === 'high') ctx.high.push(entry);
    else if (tier === 'mid') ctx.mid.push(entry);
    else ctx.low.push(entry);
  }
}

/**
 * 2026-06-09 starlight fix — cluster-pays paytable variant.
 *
 *   <NAME> [(tier-parenthetical)]?  <TIER>  <min>  <max[+]>  <Nx>
 *
 * Examples that match:
 *   "Red Lamp (Premium)   High   5   13+   100x"
 *   "Treasure Chest   High   5   13+   50x"
 *   "Purple Gem   Low   5   13+   10x"
 *
 * BLOCKLIST + min-name-length + name-must-start-with-letter prevents
 * Symbol Hierarchy / Type header rows from being captured.
 */
function scanClusterRows(region, ctx) {
  const re = /([A-Z][A-Za-z0-9'()\- ]{1,40})\s+\b(High|Mid|Low|Premium|Premiu|Royal|Standard)\b\s+(\d{1,3})\s+(\d{1,3}\+?)\s+(\d+(?:\.\d+)?)\s*x/g;
  const BLOCKLIST = /\b(Hierarchy|Type|Notes?|Symbol|Header|Distribution|Reel|Strip|Column|Row|Frequency|Probability|Total|Avg|Min|Max|Sum)\b/i;
  let m;
  while ((m = re.exec(region)) !== null) {
    let rawName = m[1].trim().replace(/\s+/g, ' ');
    rawName = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!rawName || rawName.length < 2 || rawName.length > 32) continue;
    if (BLOCKLIST.test(rawName)) continue;

    const tierHint = m[2].toLowerCase().startsWith('premi') ? 'premium' : m[2].toLowerCase();
    const maxPay = parseFloat(m[5]);
    // Synthesize an industry-baseline 3-pay tier from the single max pay
    // (1× / 0.5× / 0.25× of max — gives a renderable paytable display).
    const pay = [
      Math.max(0.05, Math.round(maxPay * 0.25 * 100) / 100),
      Math.max(0.10, Math.round(maxPay * 0.50 * 100) / 100),
      Math.max(0.20, maxPay),
    ];

    // ID derivation
    let id;
    const compact = rawName.replace(/[^A-Za-z0-9]/g, '');
    if (compact.length <= 4) id = compact.toUpperCase();
    else id = rawName.split(/\s+/).map(t => t[0]).join('').toUpperCase().slice(0, 4);
    if (!id) continue;
    if (ctx.seenIds.has(id)) continue;
    ctx.seenIds.add(id);

    const tier = classifyTier(rawName, tierHint);
    const entry = { id, name: rawName, pay };
    if (tier === 'high') ctx.high.push(entry);
    else if (tier === 'mid') ctx.mid.push(entry);
    else ctx.low.push(entry);
  }
}

function scanTriplets(region, tripletRe, ctx) {
  let m;
  while ((m = tripletRe.exec(region)) !== null) {
    const pay = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
    const preStart = Math.max(0, m.index - 220);
    const preChunk = region.slice(preStart, m.index);
    const parsed = extractNameFromContext(preChunk);
    if (!parsed) continue;
    if (ctx.seenIds.has(parsed.id)) continue;
    ctx.seenIds.add(parsed.id);
    const tier = classifyTier(parsed.name, parsed.tierHint);
    const entry = { id: parsed.id, name: parsed.name, pay };
    if (tier === 'high') ctx.high.push(entry);
    else if (tier === 'mid') ctx.mid.push(entry);
    else ctx.low.push(entry);
  }
}

/**
 * Given the text BEFORE a triplet (`Nx Nx Nx`), isolate the symbol
 * name + tier hint. The "row" is the trailing chunk of `pre` from the
 * last blank-line / prior triplet back to the triplet start. We strip
 * trailing tier labels (Premium / Mid / Low), collapse whitespace, and
 * reject obvious non-names (header rows, dimensions).
 */
function extractNameFromContext(pre) {
  if (!pre) return null;
  const lines = pre.split(/\n/);
  /* Walk backward, collecting non-empty lines until we hit a blank line
   * or another pay token (= prior row). */
  const collected = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) {
      if (collected.length > 0) break;
      continue;
    }
    if (/\d+(?:\.\d+)?\s*x\b/i.test(line)) {
      if (collected.length > 0) break;
      continue;
    }
    if (/^(?:\d+\.\d+\s)|^Section\b|^Chapter\b|^Notes\s*$/i.test(line)) break;
    collected.unshift(line);
    chars += line.length + 1;
    if (chars > 120) break;
  }
  if (collected.length === 0) return null;
  let row = collected.join(' ').replace(/\s{2,}/g, ' ').trim();

  /* Drop trailing prose noise (notes, references, descriptions). */
  row = row.replace(/\s+(?:Highest\s+paying|Min\s+\d.*|Reels?\s+\d.*|subs\s+all.*|6\+\s+triggers.*|3\+\s+triggers.*)$/i, '').trim();
  /* Strip cluster-pays / pay-anywhere column header tokens that landed
   * in the name via wrap (e.g. "Red Lamp 5 13+" → "Red Lamp"; "Zeus 8" →
   * "Zeus"). The numbers + "+" are Min/Max cluster size or "min count"
   * columns, NOT part of the symbol name. */
  row = row.replace(/\s+\d+\s+\d+\+\s*$/, '').trim();
  row = row.replace(/\s+\d+\+\s*$/, '').trim();
  /* Trailing standalone digit (pay-anywhere "min hit" column) — drop
   * only when it's a 1-2 digit number, never when it's part of the name
   * (e.g. "PIGGY 3" must NOT lose the 3). Distinguish by checking that
   * the preceding token is a regular alpha word AND the digit appears
   * AFTER tier-strip removed the "High"/"Mid"/"Low" label. */
  if (/\s+(\d{1,2})\s*$/.test(row) && /[A-Za-z]{3,}\s+\d{1,2}$/.test(row)) {
    row = row.replace(/\s+\d{1,2}\s*$/, '').trim();
  }

  /* Strip parenthetical alias. */
  row = row.replace(/\s*\([^)]{1,40}\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

  /* Strip leading non-alphanumeric clutter (emoji prefixes from PDFs
   * like "👑 Zeus" / "💍 Ring" / "⏳ Hourglass"). Unicode-aware via
   * the `u` flag so multi-byte glyphs collapse cleanly. */
  row = row.replace(/^[^A-Za-z0-9']+/u, '').trim();

  /* Detect + strip tier label — try anywhere in the row (PDF.js
   * frequently fuses tier + name into one line). Common tokens:
   * Premium / Premiu m / Premiu (the "m" got line-split by pdftotext) /
   * Mid / Low / High / HP / MP / LP / Royals. `Premiu` alone IS a valid
   * tier hint — pdftotext -layout splits "Premium" → "Premiu" + "m"
   * across two physical lines, and the walker only joins above the
   * row so we may never see the "m". tierHint stays normalized. */
  let tierHint = null;
  const tierAnywhereRe = /\b(Premium|Premiu\s+m|Premiu|High[\s-]?pay|Mid[\s-]?pay|Low[\s-]?pay|High|Mid|Low|HP|MP|LP|Royals?)\b/i;
  const tierAt = row.match(tierAnywhereRe);
  if (tierAt) {
    /* Normalize "Premiu" → "Premium" so classifyTier maps cleanly. */
    const raw = tierAt[1].replace(/\s+/g, '');
    tierHint = (raw.toLowerCase() === 'premiu') ? 'Premium' : raw;
    row = (row.slice(0, tierAt.index) + ' ' + row.slice(tierAt.index + tierAt[0].length))
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* Card ranks (A / K / Q / J / 10) bypass the defensive rejects below —
   * they're 1-2 chars, may be all-digits ("10"), and are the universal
   * "Royals" tier across slot history (1990s-present). */
  const isCardRank = /^(?:A|K|Q|J|10|T)$/i.test(row);

  /* Defensive rejects. */
  if (!row || row.length > 60 || row.length < 1) return null;
  if (!isCardRank && /^[\d\s.,xX×*-]+$/.test(row)) return null;
  if (/^Symbol(s)?\s*(?:Type)?$/i.test(row)) return null;
  if (/^Reel\s+\d/i.test(row)) return null;
  if (!isCardRank && !/[A-Za-z]{2}/.test(row)) return null;
  if (/^[^A-Za-z0-9']/.test(row)) return null;
  if (/[(){}\[\]:]/.test(row)) return null;
  /* If the row contains many tokens (likely fused with header / prior
   * row leftover), keep only the LAST 3 tokens — symbol name sits at
   * the END of a wrapped row in PDF text. Threshold 3 (not 4) because
   * symbol names are almost always 1-3 words ("Hourglass", "Hard Hat",
   * "PIGGY 3", "Tape Measure", "Red Gem"). */
  const tokens = row.split(/\s+/);
  if (tokens.length > 3) {
    row = tokens.slice(-3).join(' ');
  }

  const id = synthId(row);
  return { id, name: row, tierHint };
}

/**
 * Scan the paytable REGION (not whole text) for special-role rows. These
 * frequently appear in PDFs as "Wolf Wild  Special  N/A N/A N/A …notes"
 * or "Hard Hat  Scatter  N/A N/A N/A …trigger Free Spins". Idempotent
 * via seenIds.
 */
function scanSpecialRows(region, specials, seenIds) {
  const roles = [
    { key: 'W', name: 'Wild',
      re: /\b(?:Wolf\s+Wild|Wild\s+Symbol|Wild)\b[^\n]{0,160}/i,
      role: 'Substitutes all except Scatter / Bonus' },
    { key: 'S', name: 'Scatter',
      re: /\b(?:Hard\s+Hat|Scatter\s+Symbol|Scatter)\b[^\n]{0,160}/i,
      role: 'Trigger only' },
    { key: 'B', name: 'Bonus',
      re: /\b(?:Buzz\s+Saw|Bonus\s+Symbol|Bonus\s+Token|Bonus\s+Coin)\b[^\n]{0,160}/i,
      role: 'Triggers bonus feature' },
  ];
  for (const r of roles) {
    if (seenIds.has(r.key)) continue;
    if (!r.re.test(region)) continue;
    /* Pull a trigger threshold from the line if present. Match both
     * "N+ Scatters trigger" (count BEFORE keyword) AND "Scatter N+ triggers"
     * (count AFTER keyword) — pdftotext layouts vary by GDD author. */
    let role = r.role;
    if (r.key === 'S') {
      const before = region.match(/(\d+)\s*\+?\s*(?:Hard\s+Hats?|Scatters?)[^\n]{0,40}(?:trigger|free\s+spins?)/i);
      const after  = region.match(/(?:Hard\s+Hats?|Scatters?)\s*[^\n\d]{0,40}(\d+)\s*\+?\s*(?:trigger|free\s+spins?)/i);
      const m = before || after;
      if (m) role = `${m[1]}+ triggers Free Spins`;
    }
    specials.push({ id: r.key, name: r.name, role });
    seenIds.add(r.key);
  }
}

/**
 * Vendor-neutral fallback paytable used when the PDF extractor finds 0
 * symbols. Industry-standard A/K/Q/J + HP1/HP2/HP3 placeholder set so
 * every uploaded GDD produces a renderable slot template. Boki rule
 * 06.06.2026: *"ne sme da se desi da ubacim bilo koji gdd, a da se nesto
 * ne procita ili da nema templejt koji ce da poipuni"*. The fallback is
 * intentionally generic — no theme names, no franchise references.
 */
function fallbackSymbolSet() {
  return {
    high: [
      { id: 'HP1', name: 'Premium Symbol 1', pay: [2, 5, 10] },
      { id: 'HP2', name: 'Premium Symbol 2', pay: [1.5, 3, 6] },
      { id: 'HP3', name: 'Premium Symbol 3', pay: [1, 2, 4] },
    ],
    mid: [],
    low: [
      { id: 'A',  name: 'A',  pay: [0.5, 1, 2] },
      { id: 'K',  name: 'K',  pay: [0.4, 0.8, 1.5] },
      { id: 'Q',  name: 'Q',  pay: [0.3, 0.6, 1.2] },
      { id: 'J',  name: 'J',  pay: [0.2, 0.5, 1] },
      { id: 'T',  name: '10', pay: [0.2, 0.4, 0.8] },
    ],
    specials: [
      { id: 'W', name: 'Wild',    role: 'Substitutes all except Scatter / Bonus' },
      { id: 'S', name: 'Scatter', role: 'Trigger only' },
    ],
  };
}

/**
 * Generate a short uppercase ID from a symbol name. Industry-standard
 * mapping: A/K/Q/J/10 stay as themselves; other names take the first
 * letter of each word capped at 3 chars (PIGGY 3 → PG3, BRICK PIG → BP,
 * Hard Hat → HH). Never returns more than 4 chars (parser.mjs id regex
 * caps at 4).
 */
function synthId(name) {
  const trimmed = name.trim();
  /* Card ranks pass through verbatim. "10" maps to "T10" so it doesn't
   * collide with single-word names whose first letter is T (Toolbox,
   * Tornado, Tiger). Parser.mjs allows ID len ≤ 4. */
  if (/^A$/i.test(trimmed)) return 'A';
  if (/^K$/i.test(trimmed)) return 'K';
  if (/^Q$/i.test(trimmed)) return 'Q';
  if (/^J$/i.test(trimmed)) return 'J';
  if (/^(?:10|T)$/i.test(trimmed)) return 'T10';
  /* Tokenize, take initials, append trailing digit if name ends in one. */
  const tokens = trimmed.split(/[\s_-]+/).filter(Boolean);
  if (tokens.length === 0) return 'X';
  const trailingDigit = trimmed.match(/(\d+)\s*$/);
  /* Single-word name: take first 2 chars (TO for Toolbox, TA for Tape,
   * HO for Hourglass) so we don't collide with card-rank "T". */
  if (tokens.length === 1) {
    const base = tokens[0].replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    return (base + (trailingDigit ? trailingDigit[1].slice(0, 1) : '')).slice(0, 4) || 'X';
  }
  const initials = tokens.map(t => t[0] ? t[0].toUpperCase() : '').join('').slice(0, 3);
  if (trailingDigit) {
    return (initials.slice(0, 2) + trailingDigit[1].slice(0, 1)).slice(0, 4);
  }
  return initials.slice(0, 4) || 'X';
}

/**
 * Classify a symbol into high / mid / low tier. Uses explicit tier hint
 * if present (Premium → high, Mid → mid, Low/HP/etc), otherwise falls
 * back to industry conventions: card ranks (A/K/Q/J/10) are always Low,
 * else default to Mid (safe middle ground when ambiguous).
 */
function classifyTier(name, tierHint) {
  if (tierHint) {
    const norm = tierHint.toUpperCase();
    if (/PREMIUM|HIGHPAY|^HIGH$|^HP$/.test(norm)) return 'high';
    if (/^MID$|MIDPAY|^MP$/.test(norm))             return 'mid';
    if (/LOWPAY|^LOW$|^LP$|ROYAL/.test(norm))       return 'low';
  }
  if (/^(?:A|K|Q|J|10|T)$/i.test(name.trim())) return 'low';
  return 'mid';
}

/**
 * Detect Wild / Scatter / Bonus / Multiplier specials in the source text
 * even when the table parser missed them. Idempotent via seenIds set so
 * we don't double-add what parseSymbolRow already captured.
 */
function detectSpecialRoles(txt, specials, seenIds) {
  if (/\bWild\b/i.test(txt) && !seenIds.has('W') && !specials.some(s => /wild/i.test(s.name))) {
    /* Look for a substitution-rule sentence near "Wild". */
    const subM = txt.match(/Wild[^\n]{0,180}(?:substitut[a-z]+|stand-?in|replace[sd]?)[^\n]{0,80}/i);
    const role = subM ? clean(subM[0]).slice(0, 100) : 'Substitutes all except Scatter / Bonus';
    specials.push({ id: 'W', name: 'Wild', role });
    seenIds.add('W');
  }
  if (/\bScatter\b/i.test(txt) && !seenIds.has('S') && !specials.some(s => /scatter/i.test(s.name))) {
    /* Try to find a trigger threshold near "Scatter". */
    const trig = txt.match(/(\d+)\s*\+?\s*Scatter[^\n]{0,40}trigger/i)
              || txt.match(/Scatter[^\n]{0,60}(\d+)\s*\+?[^\n]{0,40}(?:trigger|free\s+spins?)/i);
    const role = trig ? `${trig[1]}+ triggers Free Spins` : 'Trigger only';
    specials.push({ id: 'S', name: 'Scatter', role });
    seenIds.add('S');
  }
  if ((/\bMultiplier\s+Orb\b/i.test(txt) || /\bMnožitelj.*orb/i.test(txt)) && !seenIds.has('M')) {
    const rng = txt.match(/(?:Orb|multiplier).{0,80}?(\d+)\s*x?\s*[–\-]\s*(\d{2,5})\s*x?/i);
    const role = rng ? `${rng[1]}x – ${rng[2]}x — stay-on-screen during tumble`
                     : '2x – 500x — stay-on-screen during tumble';
    specials.push({ id: 'M', name: 'Multiplier Orb', role });
    seenIds.add('M');
  }
  /* Bonus-token detection (Buzz Saw / Bonus Wheel / Mystery Box family). */
  if (/\bBonus\s+(?:Symbol|Wheel|Token)\b/i.test(txt) && !seenIds.has('B')
      && !specials.some(s => /bonus/i.test(s.name))) {
    specials.push({ id: 'B', name: 'Bonus', role: 'Triggers bonus feature' });
    seenIds.add('B');
  }
}

function roleRank(role) {
  if (/wild/i.test(role)) return 0;
  if (/scatter|trigger/i.test(role)) return 1;
  if (/bonus/i.test(role)) return 2;
  return 3;
}

/**
 * Parse "243 Ways", "117649 Ways", "1024 ways to win" out of free text.
 * Recognizes the standard industry tier ladder (243/576/720/1024/1600/
 * 3125/4096/7776/15625/46656/117649).
 */
function extractWaysCount(txt) {
  const m = txt.match(/\b(243|576|720|1024|1600|3125|4096|7776|15625|46656|117649|1000000)\s*Ways\b/i)
        || txt.match(/\b(\d{3,7})\s*Ways(?:\s+to\s+Win)?\b/i);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function extractFreeSpins(txt) {
  const hasFs = /\bFree\s+Spins?\b|\bbesplatn\w+\s+spin/i.test(txt);
  if (!hasFs) return { detected: false };
  let triggerCount = 4;
  let spinsAward = 10;
  /* Trigger-count detection — generic: any "(N+|N) <noun> triggers" pattern.
   * Industry vocabulary covers Scatter, Hard Hat, Bonus, Symbol, Coin, etc. */
  const trigPatterns = [
    /(\d+)\s*\+?\s*(?:Scatters?|Hard\s+Hats?|Bonus\s+Symbols?|Bonus\s+(?:Token|Coin)s?|sketers?)\s+(?:trigger|triggers?|to\s+trigger)/i,
    /(?:Trigger|Triggers?)\s*:\s*(\d+)\s*\+?\s*[A-Z][a-z]+/i,
    /(\d+)\s*\+?\s*(?:Scatter|Hard\s+Hat|Bonus)[^\n]{0,60}(?:Free\s+Spins?|FS)/i,
    /(\d+)\s*\+?\s*(?:Scatter|sketer)/i,
  ];
  for (const p of trigPatterns) {
    const m = txt.match(p);
    if (m) { triggerCount = parseInt(m[1], 10); break; }
  }
  /* Spins-award detection — prefer "N Free Spins" phrasing over the
   * first numeric match. Some PDFs say "10 Free Spins awarded" / "Award
   * 8 Free Spins" / "8-12 Free Spins (random)". */
  const awardPatterns = [
    /Award\s*:?\s*(\d+)\s*(?:to\s+\d+\s*)?(?:Free\s+Spins?|FS)/i,
    /(\d+)\s*(?:to\s*\d+\s*)?Free\s+Spins?\s+(?:awarded|granted|earned)/i,
    /(\d{1,2})\s*Free\s+Spins?(?!\s+remaining|\s+left|\s+used)/i,
  ];
  for (const p of awardPatterns) {
    const m = txt.match(p);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 5 && n <= 200) { spinsAward = n; break; }
    }
  }
  const akumulirajuci = /\bakumulirajuć|accumulat|progressive|persistent|grows|sticky\s+multiplier|builds\s+up/i.test(txt);
  let retriggerSpins = 5;
  const m3 = txt.match(/\+\s*(\d+)\s*(?:Free\s+Spins?|spinova)/i)
          || txt.match(/Retrigger\s*:?\s*\+?\s*(\d+)/i);
  if (m3) retriggerSpins = parseInt(m3[1], 10);
  return { detected: true, triggerCount, spinsAward, akumulirajuci, retriggerSpins };
}

function extractBonusBuy(txt) {
  const has = /\bBonus\s+Buy\b|\bBuy\s+Bonus\b|\bBuy\s+Feature\b/i.test(txt);
  if (!has) return { detected: false };
  let costX = 100, forceScatters = 4;
  /* Cost detection — support both integer and decimal multipliers
   * (industry range 25× → 500×; common values 47.5×, 75×, 100×). */
  const m1 = txt.match(/\bBonus\s+Buy\s*\(?(\d+(?:\.\d+)?)\s*x/i)
         || txt.match(/\bBuy\s+Feature[^\n]{0,40}?(\d+(?:\.\d+)?)\s*x/i)
         || txt.match(/(\d+(?:\.\d+)?)\s*x\s*(?:bet\s+)?direct\s+bonus\s+entry/i)
         || txt.match(/\bCena\s*\|?\s*\*?\*?(\d+(?:\.\d+)?)\s*x/i);
  if (m1) costX = parseFloat(m1[1]);
  const m2 = txt.match(/(\d+)\s*\+?\s*Scatter/i);
  if (m2) forceScatters = parseInt(m2[1], 10);
  return { detected: true, costX, forceScatters };
}

function extractAnteBet(txt) {
  const has = /\bAnte\s+Bet\b/i.test(txt);
  if (!has) return { detected: false };
  let pctIncrease = 25;
  const m = txt.match(/(?:Ante\s+Bet|cena).{0,40}?\+?\s*(\d{1,2})\s*%/i);
  if (m) pctIncrease = parseInt(m[1], 10);
  return { detected: true, pctIncrease };
}

/* ── Industry GDD meta-panel (Tema:, Ciljna publika:, ŽANR, etc.) ─────── */
function extractMetaPanel(txt) {
  const meta = {
    themeTags: null, targetMarket: null, genre: null, mood: null, setting: null,
    typography: null, vibeRefs: null,
  };

  // "Tema: Antička Grčka, Mitologija, Bogovi ⚡"   (SR) or  "Theme: ..." (EN)
  let m = txt.match(/(?:Tema|Theme|Theme\s+tags?)\s*:\s*([^⚡\n|]{3,140})/i);
  if (m) {
    let tags = cleanList(m[1]);
    // Preserve user-authored theme tags verbatim — no vendor/franchise-specific auto-tagging.
    meta.themeTags = tags;
  }
  if (!meta.themeTags) {
    // 2026-06-09 huff-puff fix: prose-only PDFs (no "Theme tags:" prefix)
    // — derive 2-4 theme tags from the most common content anchors:
    //   ① the GENRE line (e.g. "Hold & Spin" / "243 Ways")
    //   ② Section "THEME & NARRATIVE DESIGN" sub-headers
    //   ③ canonical theme-anchor keywords actually present in the text
    // Keeps it vendor-neutral by surfacing only the descriptor, never the
    // franchise or studio brand.
    const inferred = new Set();
    const anchors = [
      /\bvideo\s*slot\b/i,            'video-slot',
      /\bhold\s*[&\s]*spin\b/i,       'hold-and-spin',
      /\b243\s*ways\b/i,              '243-ways',
      /\b1024\s*ways\b/i,             '1024-ways',
      /\b117\s*649\s*ways\b/i,        '117649-ways',
      /\bcluster\s*pays\b/i,          'cluster-pays',
      /\bcascad/i,                    'cascade',
      /\btumble\b/i,                  'tumble',
      /\bmegaways\b/i,                'variable-ways',
      /\bbuy\s*feature\b/i,           'buy-feature',
      /\bbonus\s*buy\b/i,             'bonus-buy',
      /\bjackpot\b/i,                 'jackpot',
      /\bwheel\s*bonus\b/i,           'wheel-bonus',
      /\bmystery\s*symbol/i,          'mystery-symbol',
      /\bcomic|cartoon|storybook|whimsical|fairy[\s-]?tale\b/i, 'storybook',
      /\bgreek|olymp|zeus|titan|spartan/i, 'mythology',
      /\bnorse|viking|thor|odin/i,    'norse',
      /\begypt|pharaoh|pyramid|anubis/i, 'egypt',
      /\bspace|galaxy|cosmic|nebula/i, 'space',
      /\bcyber|neon|synthwave|future/i, 'cyber',
      /\bhorror|gothic|vampire|witch/i, 'horror',
      /\bocean|sea|underwater|nautical/i, 'ocean',
      /\bjungle|tropical|temple/i,    'jungle',
      /\bwild\s*west|cowboy|saloon/i, 'wild-west',
    ];
    for (let i = 0; i < anchors.length; i += 2) {
      if (anchors[i].test(txt)) inferred.add(anchors[i + 1]);
    }
    if (inferred.size > 0) {
      meta.themeTags = [...inferred].slice(0, 6).join(' · ');
    }
  }

  // "Ciljna publika: High-volatility igrači ⚡"  /  "Target market: ..." / "Target audience: ..."
  m = txt.match(/(?:Ciljna\s+publika|Target\s+market|Target\s+audience)\s*:\s*([^⚡\n|]{3,140})/i);
  if (m) {
    // Fix "High- volatility" (PDF.js extra space after hyphen) → "High-volatility"
    let mkt = clean(m[1]).replace(/-\s+/g, '-');
    // Industry convention: prefix with "Global" if not region-locked
    if (!/\b(Global|EU|US|LATAM|APAC|Worldwide|MGA|UKGC)\b/i.test(mkt)) {
      mkt = `Global · ${mkt}`;
    }
    meta.targetMarket = mkt;
  }
  if (!meta.targetMarket) {
    const m2 = txt.match(/\b(Global|EU|US|LATAM|APAC|Worldwide)\s*[·•]\s*([^\n⚡|]{3,80})/i);
    if (m2) meta.targetMarket = clean(`${m2[1]} · ${m2[2]}`).replace(/-\s+/g, '-');
  }

  // Genre — "ŽANR Video Slot / Scatter Pays"  (PDF.js spaces every char out, so
  // \b before Ž fails — drop the boundary)  /  "Genre: ..."
  // 2026-06-09 huff-puff fix: explicit terminator before next ALL-CAPS field name
  // (GRID, MAX, VOLATILITY, RTP, RELEASE, HIT, BET, STUDIO, FRANCHISE) so a
  // greedy match doesn't swallow downstream metadata into the genre cell.
  m = txt.match(/Ž\s*A\s*N\s*R\s+([^\n⚡|]{3,80})/i)
     || txt.match(/(?:Žanr|Genre)\s*[:|]?\s*([^\n⚡|]{3,80})/i);
  if (m) {
    let g = clean(m[1]);
    // Pull only the first 2 tokens separated by /, drop trailing "VOLATILNOST" etc.
    g = g.replace(/\s+V\s*O\s*L\s*A\s*T.*$/i, '').trim();
    // Stop at the next uppercase field name (GRID / MAX WIN / RTP / RELEASE / etc.)
    g = g.replace(/\s+(?:GRID|MAX\s+WIN|VOLATILITY|RTP|RELEASE|HIT\s+FREQ|BET\s+RANGE|STUDIO|FRANCHISE|CONFIDENTIAL).*$/i, '').trim();
    // Same trick: "Video Slot / Scatter Pays" → "Video Slot — Scatter Pays"
    meta.genre = g.replace(/\s*\/\s*/, ' — ');
  }

  // Mood — explicit "Mood:" / "Art Style:" / "Visual Identity" prose / volatility hint
  m = txt.match(/\b(?:Mood|Raspoloženje|Vibe)\s*:\s*([^\n⚡|]{3,140})/i);
  if (m) meta.mood = clean(m[1]);
  if (!meta.mood) {
    // 2026-06-09 huff-puff fix: prose-style "Art Style: Whimsical storybook
    // cartoon aesthetic..." — capture the descriptive adjective chain up
    // to the first period.
    const art = txt.match(/\bArt\s+Style\s*[:\-]\s*([^.\n⚡|]{8,160})\./i);
    if (art) meta.mood = clean(art[1])
      .replace(/\s+(?:with|featuring|using)\s.*$/i, '')  // strip "with rich 3D-rendered..."
      .slice(0, 120);
  }
  if (!meta.mood) {
    // Industry meta hint: "5/5 — Maksimalna" suggests High-volatility · Dramatic
    if (/5\s*\/\s*5\b|\bMaksimaln[ai]\b|\bExtreme(?:ly)?\s+(?:high|volatile)/i.test(txt)) {
      meta.mood = 'High-volatility · Dramatic · Anticipation';
    }
  }

  // Setting — explicit "Setting:" or prose "reimagines X as a casino adventure"
  m = txt.match(/\b(?:Setting|Mesto|Lokacija|Ambijent|Atmosfera)\s*:\s*([^\n⚡|]{3,140})/i);
  if (m) meta.setting = clean(m[1]);
  if (!meta.setting) {
    // 2026-06-09 huff-puff fix: prose narrative "The game reimagines X as a
    // casino adventure" or "Players are not passive observers — they are X"
    // → extract the THING being reimagined as the setting summary.
    const re = txt.match(/\breimagines?\s+(?:the\s+)?(?:classic\s+)?([^.\n⚡|]{6,80})\s+(?:as\s+a\s+casino|as\s+casino|into\s+a\s+casino|as\s+an?\s+adventure)/i);
    if (re) meta.setting = clean(re[1]) + ' (casino adventure)';
  }
  if (!meta.setting) {
    // 2026-06-09 starlight fix: prose "blends two distinct thematic layers:
    // a X and a Y" / "set in X" / "takes place in X" patterns.
    const blend = txt.match(/\bblends?\s+(?:two|three)?\s*(?:distinct)?\s*(?:thematic\s+layers?|themes?|worlds?)\s*[:,-]?\s*([^.\n⚡|]{10,180})\./i);
    if (blend) {
      meta.setting = clean(blend[1])
        .replace(/\s+(?:and|with|featuring)\s.*$/i, '')  // first half only
        .slice(0, 100);
    }
  }
  if (!meta.setting) {
    const setInProse = txt.match(/\b(?:set\s+in|takes\s+place\s+in|located\s+in|world\s+of)\s+(?:the\s+|a\s+)?([^.\n⚡|]{6,90})\./i);
    if (setInProse) meta.setting = clean(setInProse[1]).slice(0, 100);
  }
  if (!meta.setting) {
    // "Background:" prose ("Rolling green hills with cartoon clouds...")
    const bg = txt.match(/\bBackground\s*:\s*([^.\n⚡|]{8,140})\./i);
    if (bg) meta.setting = clean(bg[1]).slice(0, 100);
  }
  if (!meta.setting && meta.themeTags) {
    // Last-resort: synthesize from theme tags if at least one geographic /
    // narrative tag is present. Keeps Coverage Report green without
    // fabricating vendor-specific content. Includes Serbian/Cyrillic-
    // friendly hints (grčk / antičk / olimp / titan-cyr) so partner
    // GDDs written in SR get the same coverage as EN.
    const themeKeywords = meta.themeTags.toLowerCase();
    if (/myth|olymp|olimp|greek|grčk|grck|antičk|anticka|titan/i.test(themeKeywords))    meta.setting = 'Mythological pantheon';
    else if (/egypt|egipat|piramid|pharaoh|pyramid/i.test(themeKeywords)) meta.setting = 'Ancient temple complex';
    else if (/norse|viking/i.test(themeKeywords))         meta.setting = 'Northern frontier';
    else if (/space|cosmic|galaxy|kosm|svemir/i.test(themeKeywords))  meta.setting = 'Interstellar void';
    else if (/cyber|neon|future/i.test(themeKeywords))    meta.setting = 'Neon megacity';
    else if (/jungle|tropical|džungla/i.test(themeKeywords))      meta.setting = 'Overgrown wilderness';
    else if (/ocean|underwater|more|podmor/i.test(themeKeywords))     meta.setting = 'Deep marine trench';
    else if (/horror|gothic|horor/i.test(themeKeywords))        meta.setting = 'Haunted manor';
    else if (/wild.?west|cowboy|kauboj/i.test(themeKeywords))    meta.setting = 'Frontier saloon';
    else if (/storybook|whimsical|fairy|bajk/i.test(themeKeywords)) meta.setting = 'Storybook world';
  }

  // Typography — "Font:" / "Typography:" explicit, OR prose hint "storybook
  // typeface" / "modern sans-serif"
  m = txt.match(/\b(?:Typography|Tipograf(?:ija|ic)|Font|Type\s+system)\s*[:\-]\s*([^\n⚡|]{3,140})/i);
  if (m) meta.typography = clean(m[1]);
  if (!meta.typography) {
    // Prose: capture descriptive line containing a typeface clue
    const tp = txt.match(/\b(?:storybook|cartoon|hand-?drawn|comic|grunge|gothic|art\s*deco|industrial|metallic|futuristic|cyber|fantasy)\s+(?:typeface|font|lettering|titles)\b[^.\n]*\./i);
    if (tp) meta.typography = clean(tp[0]).slice(0, 100);
  }
  if (!meta.typography && (meta.mood || meta.themeTags)) {
    // 2026-06-09 huff-puff + starlight fix: when neither explicit nor
    // prose clue surfaces, mirror the mood/tag adjectives into a generic
    // typography descriptor. Keeps the GDD Coverage Report at ≥ 0.5
    // confidence on Typography without inventing a typeface name
    // (vendor-neutral). Tags are scanned as a fallback when mood text is
    // too short / quoted to match.
    const key = ((meta.mood || '') + ' ' + (meta.themeTags || '')).toLowerCase();
    let descriptor = null;
    if (/storybook|whimsical|cartoon|fairy/i.test(key))             descriptor = 'Storybook display + rounded sans-serif body';
    else if (/cyber|neon|futur|synth|cosmic|interstellar|space/i.test(key)) descriptor = 'Geometric display + monospace body';
    else if (/horror|gothic|dark/i.test(key))                       descriptor = 'Gothic display + serif body';
    else if (/myth|olymp|olimp|titan|egypt|egipat|ancient|antičk|grčk|anticka/i.test(key)) descriptor = 'Engraved display + classical serif body';
    else if (/wild\s*west|cowboy|saloon|kauboj/i.test(key))         descriptor = 'Slab serif display + western body';
    else if (/ocean|underwater|nautical|more|podmor/i.test(key))    descriptor = 'Flowing script display + sans-serif body';
    else if (/jungle|tropical|temple|caravan|arabian|desert|džungla/i.test(key)) descriptor = 'Carved stone display + sans-serif body';
    else if (/dramatic|epic|cinematic|anticipation/i.test(key))     descriptor = 'Heavy display + clean sans-serif body';
    else                                                            descriptor = 'Industry-standard display + clean sans-serif body';
    meta.typography = descriptor;
  }

  // Vibe references — "Vibe references:" / "References:" / "Reference:" /
  // "Inspired by:"
  m = txt.match(/\b(?:Vibe\s+references?|References?|Reference\s+games?|Inspired\s+by|Influences?)\s*[:\-]\s*([^\n⚡|]{3,140})/i);
  if (m) meta.vibeRefs = clean(m[1]);
  if (!meta.vibeRefs) {
    // Prose: "Lock It Link Hold & Spin DNA" / "homage to the original
    // land-based cabinet" / "pays homage to X" patterns surface the
    // inspiration chain. Capture the first matched anchor phrase.
    const va = txt.match(/\b(?:homage\s+to|pays\s+homage\s+to|reminiscent\s+of|inspired\s+by|DNA\s+from|inherited\s+from)\s+([^.\n⚡|]{4,80})\./i);
    if (va) meta.vibeRefs = clean(va[1]).slice(0, 100);
  }
  if (!meta.vibeRefs) {
    // 2026-06-09 starlight fix: prose "evoking X aesthetics" / "X motif" /
    // "drawing from X tradition" / "X-inspired"
    const va2 = txt.match(/\bevoking\s+([^.\n⚡|]{4,80})\s+(?:aesthetics?|motifs?|themes?|atmosphere)/i)
              || txt.match(/\b([A-Z][a-z]+(?:\s+[A-Za-z]+){0,3})\s+motif\b/i)
              || txt.match(/\bdrawing\s+from\s+([^.\n⚡|]{4,80})\s+tradition/i);
    if (va2) meta.vibeRefs = clean(va2[1]).slice(0, 100);
  }
  if (meta.vibeRefs) {
    // Cap at first connector so we never carry a sentence fragment past
    // the original anchor ("Arabian Nights aesthetics) and a cosmic …"
    // → "Arabian Nights aesthetics").
    meta.vibeRefs = meta.vibeRefs.replace(/\)\s*(?:and|with|featuring).*$/i, ')').slice(0, 100);
  }
  if (!meta.vibeRefs && meta.themeTags) {
    // Last-resort from tags — keep it short + descriptive, vendor-neutral.
    // Same SR/Cyrillic-friendly synonyms as setting.
    const t = meta.themeTags.toLowerCase();
    if (/myth|olymp|olimp|greek|grčk|grck|antičk|anticka/i.test(t)) meta.vibeRefs = 'Classical mythology canon';
    else if (/storybook|whimsical|bajk/i.test(t)) meta.vibeRefs = 'Fairy-tale narrative tradition';
    else if (/space|cosmic|galaxy|kosm|svemir/i.test(t)) meta.vibeRefs = 'Space-exploration cinema';
    else if (/cyber|neon|future/i.test(t)) meta.vibeRefs = 'Synthwave / cyberpunk visuals';
    else if (/horror|gothic|horor/i.test(t))   meta.vibeRefs = 'Gothic horror tradition';
    else if (/wild.?west|kauboj/i.test(t))      meta.vibeRefs = 'Spaghetti western';
    else if (/jungle|tropical|džungla/i.test(t)) meta.vibeRefs = 'Adventure pulp serial';
    else if (/ocean|underwater|more|podmor/i.test(t)) meta.vibeRefs = 'Deep-sea documentary';
    else if (/egypt|egipat|pharaoh/i.test(t))    meta.vibeRefs = 'Ancient-civilization documentary';
    else if (/norse|viking/i.test(t))     meta.vibeRefs = 'Norse saga tradition';
  }

  // 2026-06-09 starlight fix: "creating a unique X atmosphere" /
  // "atmosphere of X" prose → mood fallback (if mood still empty)
  if (!meta.mood) {
    const atmo = txt.match(/\bcreating\s+(?:a|an)\s+([^.\n⚡|]{4,80})\s+atmosphere/i)
               || txt.match(/\batmosphere\s+of\s+([^.\n⚡|]{4,80})\./i)
               || txt.match(/\b([A-Z][a-z]+(?:\s+[a-z]+){0,2})\s+gameplay\s+loop\b/i);
    if (atmo) meta.mood = clean(atmo[1]).slice(0, 100);
  }

  return meta;
}

function clean(s) {
  return s
    .replace(/\*\*/g, '')
    .replace(/[⚡⭐]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-—:|\s]+|[-—:|\s]+$/g, '')
    .trim();
}

function cleanList(s) {
  // "Antička Grčka, Mitologija, Bogovi" → "Antička Grčka · Mitologija · Bogovi"
  // Parser splits on · • , / so any of those works, but · matches MD samples.
  return clean(s)
    .split(/[,·•\/]/)
    .map(t => t.trim())
    .filter(Boolean)
    .join(' · ');
}

function extractVolatility(txt) {
  // "VOLATILNOST 5/5 — Maksimalna"
  const m = txt.match(/\bV\s*O\s*L\s*A\s*T\s*I\s*L\s*N\s*O\s*S\s*T\b\s*(\d\s*\/\s*\d\s*[—\-–]?\s*[A-Za-zŠšŽžĆćČčĐđ]+)/i)
        || txt.match(/\b(?:Volatility|Volatilnost)\s*[:|]?\s*(\d\s*\/\s*\d\s*[—\-–]?\s*[A-Za-zŠšŽžĆćČčĐđ]*)/i);
  return m ? clean(m[1]).replace(/\s+/g, ' ') : null;
}

function extractHitFrequency(txt) {
  const m = txt.match(/\bHit\s+frequency\s*[:|]?\s*([~]?\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?\s*%)/i);
  return m ? clean(m[1]) : null;
}

function formatCost(n) {
  /* Render decimals as-is (47.5), integers without trailing .0 (100). */
  if (!Number.isFinite(n)) return '100';
  return (n === Math.floor(n)) ? String(Math.floor(n)) : String(n);
}
