/**
 * W152 P0-6 — New Jersey DGE monthly CSV adapter.
 *
 * NJ DGE distributes a quarterly Excel template that operators fill in
 * with monthly summaries. The Excel sheet is internally CSV with a
 * fixed column order — we emit that CSV directly. Operators can paste
 * into the template or upload the CSV via the DGE Internet Gaming portal.
 *
 * Column order (DGE template "Slot Activity – Monthly", rev 2024-Q4):
 *
 *   1.  Operator License Number
 *   2.  Game License Number
 *   3.  Game Name
 *   4.  Game Version
 *   5.  Reporting Period Start (YYYY-MM-DD)
 *   6.  Reporting Period End   (YYYY-MM-DD)
 *   7.  Currency (ISO 4217, expected USD)
 *   8.  Total Spins
 *   9.  Unique Players
 *  10.  Total Wagered (USD, 2 dp)
 *  11.  Total Returned (USD, 2 dp)
 *  12.  Theoretical Hold (Wager - Returned, USD 2 dp)
 *  13.  Largest Single Win (USD, 2 dp)
 *  14.  Actual RTP %                    (4 dp)
 *  15.  Jurisdiction Code               (always "NJ-DGE")
 *
 * Decimals follow DGE's "round half to even" convention to match the
 * Excel template's `BANKERSROUNDING` macro behaviour.
 */

import {
  ReportAdapter,
  JurisdictionalReport,
  csvQuote,
  computeRtp,
  rtpToPercentString,
} from './types.js';

const HEADER = [
  'Operator License Number',
  'Game License Number',
  'Game Name',
  'Game Version',
  'Reporting Period Start',
  'Reporting Period End',
  'Currency',
  'Total Spins',
  'Unique Players',
  'Total Wagered',
  'Total Returned',
  'Theoretical Hold',
  'Largest Single Win',
  'Actual RTP %',
  'Jurisdiction Code',
];

/**
 * Format millicredits as 2-decimal USD with banker's rounding at the
 * millicredit→cent boundary (matches DGE's spreadsheet macro).
 */
function mcToUsd2dp(mc: number): string {
  if (!Number.isFinite(mc) || mc < 0) return '0.00';
  const whole = Math.trunc(mc / 1000);
  const remainderMc = mc - whole * 1000;
  const cents = Math.trunc(remainderMc / 10);
  const subCent = remainderMc - cents * 10;
  let centsOut = cents;
  if (subCent > 5) centsOut += 1;
  else if (subCent === 5) {
    if (centsOut % 2 === 1) centsOut += 1;
  }
  let wholeOut = whole;
  if (centsOut === 100) {
    wholeOut += 1;
    centsOut = 0;
  }
  return `${wholeOut}.${String(centsOut).padStart(2, '0')}`;
}

/** Compute theoretical hold = wagered - returned (in millicredits). */
function holdMc(r: JurisdictionalReport): number {
  return Math.max(0, r.totalWageredMc - r.totalWonMc);
}

function isoToDateOnly(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) {
    throw new Error(`isoToDateOnly: not an ISO-8601 timestamp: ${iso}`);
  }
  return m[1];
}

export const NJCsvAdapter: ReportAdapter = {
  name: 'nj-dge-csv',
  // The portal accepts text/csv. Operators paste directly into Excel.
  mimeType: 'text/csv; charset=utf-8',
  emit(r: JurisdictionalReport): string {
    const rtp = computeRtp(r);
    const row = [
      csvQuote(r.operatorLicenseId),
      csvQuote(r.gameLicenseId),
      csvQuote(r.gameName),
      csvQuote(r.gameVersion),
      isoToDateOnly(r.periodStartUtc),
      isoToDateOnly(r.periodEndUtc),
      csvQuote(r.currency),
      String(r.totalSpins),
      String(r.uniquePlayers),
      mcToUsd2dp(r.totalWageredMc),
      mcToUsd2dp(r.totalWonMc),
      mcToUsd2dp(holdMc(r)),
      mcToUsd2dp(r.largestWinMc),
      rtpToPercentString(rtp),
      'NJ-DGE',
    ];
    // CRLF line endings — Excel on Windows is the primary consumer.
    return HEADER.join(',') + '\r\n' + row.join(',') + '\r\n';
  },
};

/** Exposed for unit tests. */
export const __njInternals = { mcToUsd2dp, holdMc, isoToDateOnly };
