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

  /* ── 2. Topology / Grid ─────────────────────────────────────────────── */
  const grid = extractGrid(txt);
  // Evaluation kind — scatter pays → pay_anywhere, etc.
  const evalKind = extractEvaluation(txt);
  const rtp = extractRTP(txt);
  const maxWin = extractMaxWin(txt);

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
  out.push('');

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
  // Strategy 3: pattern like "Gates of Olympus 1000" in first 500 chars
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
  // Known GoO-family canonical symbols (extend with more as we learn)
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
