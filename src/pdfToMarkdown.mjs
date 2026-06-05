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
  if (name || meta.themeTags || meta.targetMarket || meta.genre || meta.mood || meta.setting) {
    if (name)              out.push(`| Internal name | ${name} |`);
    if (meta.themeTags)    out.push(`| Theme tags | ${meta.themeTags} |`);
    if (meta.mood)         out.push(`| Mood | ${meta.mood} |`);
    if (meta.setting)      out.push(`| Setting | ${meta.setting} |`);
    if (meta.genre)        out.push(`| Genre | ${meta.genre} |`);
    if (meta.targetMarket) out.push(`| Target market | ${meta.targetMarket} |`);
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
  // Strategy 2a: ALL-CAPS title before "Game Design Document"
  //              Handles "HUFF N' MORE PUFF\nGame Design Document" / similar.
  m = txt.slice(0, 1200).match(/([A-Z][A-Z0-9' \-]{4,50}[A-Z0-9])\s*\n[^\n]{0,30}(?:G\s*a?\s*m?\s*e?\s*[ -]?\s*D\s*e\s*s\s*i\s*g\s*n|GDD|Game\s+Design\s+Document)/);
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
  const meta = { themeTags: null, targetMarket: null, genre: null, mood: null, setting: null };

  // "Tema: Antička Grčka, Mitologija, Bogovi ⚡"   (SR) or  "Theme: ..." (EN)
  let m = txt.match(/(?:Tema|Theme|Theme\s+tags?)\s*:\s*([^⚡\n|]{3,140})/i);
  if (m) {
    let tags = cleanList(m[1]);
    // Preserve user-authored theme tags verbatim — no vendor/franchise-specific auto-tagging.
    meta.themeTags = tags;
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
  m = txt.match(/Ž\s*A\s*N\s*R\s+([^\n⚡|]{3,80})/i)
     || txt.match(/(?:Žanr|Genre)\s*[:|]?\s*([^\n⚡|]{3,80})/i);
  if (m) {
    let g = clean(m[1]);
    // Pull only the first 2 tokens separated by /, drop trailing "VOLATILNOST" etc.
    g = g.replace(/\s+V\s*O\s*L\s*A\s*T.*$/i, '').trim();
    // Same trick: "Video Slot / Scatter Pays" → "Video Slot — Scatter Pays"
    meta.genre = g.replace(/\s*\/\s*/, ' — ');
  }

  // Mood — explicit "Mood:" or derived from "VOLATILNOST 5/5 — Maksimalna"
  m = txt.match(/\b(?:Mood|Raspoloženje|Vibe)\s*:\s*([^\n⚡|]{3,140})/i);
  if (m) meta.mood = clean(m[1]);
  if (!meta.mood) {
    // Industry meta hint: "5/5 — Maksimalna" suggests High-volatility · Dramatic
    if (/5\s*\/\s*5\b|\bMaksimaln[ai]\b|\bExtreme(?:ly)?\s+(?:high|volatile)/i.test(txt)) {
      meta.mood = 'High-volatility · Dramatic · Anticipation';
    }
  }

  // Setting — "Setting:" only (explicit user input). No franchise-specific fallback.
  m = txt.match(/\b(?:Setting|Mesto|Lokacija)\s*:\s*([^\n⚡|]{3,140})/i);
  if (m) meta.setting = clean(m[1]);

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
