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

  // Normalize whitespace: collapse runs of spaces, keep paragraph breaks
  let txt = raw
    .replace(/\r/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const out = [];

  /* ── 1. Game name — first proper-cased multi-word title near start ───── */
  const name = extractGameName(txt);
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
  const rtp = extractRTP(txt);
  const maxWin = extractMaxWin(txt);
  const volatility = extractVolatility(txt);
  const hitFreq = extractHitFrequency(txt);

  out.push(`## 02 · Topology`);
  out.push('');
  out.push('| Parametar | Vrednost |');
  out.push('|---|---|');
  if (grid.reels) out.push(`| Reels | ${grid.reels} |`);
  if (grid.rows)  out.push(`| Rows | ${grid.rows} |`);
  if (evalKind === 'pay_anywhere') {
    out.push(`| Evaluation | Pay anywhere grid |`);
  } else if (evalKind === 'cluster') {
    out.push(`| Evaluation | Cluster pays |`);
  } else if (evalKind === 'lines') {
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

  /* ── 3. Tumble / Cascade ────────────────────────────────────────────── */
  if (/\b(tumbl|cascad|avalanch)/i.test(txt)) {
    out.push(`## 04 · Tumble (Cascade) Mechanic`);
    out.push('');
    out.push('Reel mechanism — Cascade. Tumble mehanika u svakom spinu — pobednički simboli nestaju, gravitacija puni prazna polja, novi simboli padaju sa vrha. Multiplier orbi ostaju na ekranu tokom celog tumblesa.');
    out.push('');
  }

  /* ── 4. Symbols & Paytable ──────────────────────────────────────────── */
  const symbols = extractSymbols(txt);
  if (symbols.high.length || symbols.low.length || symbols.specials.length) {
    out.push(`## 03 · Symbols & Paytable`);
    out.push('');
    if (symbols.high.length) {
      out.push(`### High-pay`);
      out.push('');
      out.push('| ID | Name | min8 | 8-9 | 10-11 | 12+ |');
      out.push('|---|---|:-:|:-:|:-:|:-:|');
      symbols.high.forEach(s => out.push(`| \`${s.id}\` | ${s.name} | 8 | ${s.pay[0]||1}x | ${s.pay[1]||2}x | ${s.pay[2]||5}x |`));
      out.push('');
    }
    if (symbols.low.length) {
      out.push(`### Low-pay`);
      out.push('');
      out.push('| ID | Name | min8 | 8-9 | 10-11 | 12+ |');
      out.push('|---|---|:-:|:-:|:-:|:-:|');
      symbols.low.forEach(s => out.push(`| \`${s.id}\` | ${s.name} | 8 | ${s.pay[0]||0.5}x | ${s.pay[1]||1}x | ${s.pay[2]||2}x |`));
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
    out.push(`| Cena | **${bb.costX}x** trenutni ulog |`);
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
  // Strategy 1: explicit "Radni naslov:" / "Internal name:" line
  let m = txt.match(/(?:Radni naslov|Internal name|Game title|Game name|Title)\s*:\s*([A-Z][A-Za-z0-9 '\-]{2,60})/i);
  if (m) return m[1].trim();
  // Strategy 2: first Title-Case sequence followed by "G A M E D E S I G N" / "Game Design"
  m = txt.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z0-9][a-zA-Z0-9]+){1,4})\s+(?:G\s*A\s*M\s*E\s*D\s*E|Game\s*Design)/);
  if (m) return m[1].trim();
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
  if (/\bmegaways\b|\d+\s*ways\b|\bways\s+to\s+win/i.test(txt)) return 'ways';
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

function extractSymbols(txt) {
  const high = [], low = [], specials = [];
  // Canonical pay-anywhere mythology-themed symbol vocabulary (extend as more domains land)
  const candidates = [
    { id: 'Z',  re: /\bZeus(?:\s*\(?\s*(?:Crown|kruna))?/i, name: 'Zeus (Crown)', tier: 'high' },
    { id: 'H',  re: /\bHourglass\b|\bpeščani\s+sat/i, name: 'Hourglass', tier: 'high' },
    { id: 'R',  re: /\bRing\b|\bprsten\b/i, name: 'Ring', tier: 'high' },
    { id: 'C',  re: /\bChalice\b|\bpehar\b/i, name: 'Chalice', tier: 'high' },
    { id: 'RG', re: /\b(?:Red\s+Gem|crveni\s+dragulj)\b/i, name: 'Red Gem', tier: 'low' },
    { id: 'PG', re: /\b(?:Purple\s+Gem|ljubičasti\s+dragulj)\b/i, name: 'Purple Gem', tier: 'low' },
    { id: 'YG', re: /\b(?:Yellow\s+Gem|žuti\s+dragulj)\b/i, name: 'Yellow Gem', tier: 'low' },
    { id: 'GG', re: /\b(?:Green\s+Gem|zeleni\s+dragulj)\b/i, name: 'Green Gem', tier: 'low' },
    { id: 'BG', re: /\b(?:Blue\s+Gem|plavi\s+dragulj)\b/i, name: 'Blue Gem', tier: 'low' },
  ];
  for (const c of candidates) {
    if (c.re.test(txt)) {
      // Try to find paytable values near the symbol mention — best effort
      const pay = findPayTriplet(txt, c.re);
      const entry = { id: c.id, name: c.name, pay };
      if (c.tier === 'high') high.push(entry);
      else low.push(entry);
    }
  }
  // Scatter detection
  if (/\bScatter\b/i.test(txt) && /Zeus|trigger/i.test(txt)) {
    specials.push({ id: 'S', name: 'Scatter (Zeus)', role: 'Trigger only — ne plaća direktno' });
  } else if (/\bScatter\b/i.test(txt)) {
    specials.push({ id: 'S', name: 'Scatter', role: 'Trigger only' });
  }
  // Multiplier Orb detection
  if (/\bMultiplier\s+Orb\b/i.test(txt) || /\bMnožitelj.*orb/i.test(txt)) {
    // Look for value range
    const rng = txt.match(/(?:Orb|multiplier).{0,80}?(\d+)\s*x?\s*[–\-]\s*(\d{3,4})\s*x?/i);
    const role = rng ? `${rng[1]}x – ${rng[2]}x — stay-on-screen during tumble` : '2x – 1000x — stay-on-screen during tumble';
    specials.push({ id: 'M', name: 'Multiplier Orb', role });
  }
  return { high, low, specials };
}

function findPayTriplet(txt, symRe) {
  // Find symbol mention, look in nearby 200 chars for `Nx` patterns
  const m = txt.match(new RegExp(symRe.source + '[\\s\\S]{0,200}?(\\d+(?:\\.\\d+)?)\\s*x[\\s\\S]{0,40}?(\\d+(?:\\.\\d+)?)\\s*x[\\s\\S]{0,40}?(\\d+(?:\\.\\d+)?)\\s*x', symRe.flags));
  if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  return [1, 2, 5];
}

function extractFreeSpins(txt) {
  const hasFs = /\bFree\s+Spins?\b|\bbesplatn\w+\s+spin/i.test(txt);
  if (!hasFs) return { detected: false };
  let triggerCount = 4;
  let spinsAward = 15;
  const m1 = txt.match(/(\d+)\s*\+?\s*(?:Scatter|sketer)/i);
  if (m1) triggerCount = parseInt(m1[1], 10);
  const m2 = txt.match(/(\d+)\s*Free\s+Spins/i);
  if (m2) spinsAward = parseInt(m2[1], 10);
  const akumulirajuci = /\bakumulirajuć|accumulat|progressive|persistent|grows/i.test(txt);
  let retriggerSpins = 5;
  const m3 = txt.match(/\+\s*(\d+)\s*(?:Free\s+Spins|spinova)/i);
  if (m3) retriggerSpins = parseInt(m3[1], 10);
  return { detected: true, triggerCount, spinsAward, akumulirajuci, retriggerSpins };
}

function extractBonusBuy(txt) {
  const has = /\bBonus\s+Buy\b|\bBuy\s+Bonus\b|\bBuy\s+Feature\b/i.test(txt);
  if (!has) return { detected: false };
  let costX = 100, forceScatters = 4;
  const m1 = txt.match(/\bBonus\s+Buy\s*\(?(\d+)\s*x/i)
         || txt.match(/\bCena\s*\|?\s*\*?\*?(\d+)\s*x/i);
  if (m1) costX = parseInt(m1[1], 10);
  const m2 = txt.match(/(\d+)\s*\+?\s*Scatter\s+simbola/i);
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

  // "Tema: Antička Grčka, Zeus, Olimp ⚡"   (SR) or  "Theme: ..." (EN)
  let m = txt.match(/(?:Tema|Theme|Theme\s+tags?)\s*:\s*([^⚡\n|]{3,140})/i);
  if (m) {
    let tags = cleanList(m[1]);
    // Industry GDD convention: Olympus/Zeus/Greek themes imply "Mythology" tag
    if (/Olimp|Olympus|Zeus|Mitologij|Grčka|Greek/i.test(tags) && !/Mytholog/i.test(tags)) {
      tags = tags + ' · Mythology';
    }
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

  // Setting — "Setting:" or derived from theme tags
  m = txt.match(/\b(?:Setting|Mesto|Lokacija)\s*:\s*([^\n⚡|]{3,140})/i);
  if (m) meta.setting = clean(m[1]);
  if (!meta.setting && meta.themeTags && /Olimp|Olympus/i.test(meta.themeTags)) {
    meta.setting = 'Mount Olympus / Heavens';
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
  // "Antička Grčka, Zeus, Olimp" → "Antička Grčka · Zeus · Olimp"
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
