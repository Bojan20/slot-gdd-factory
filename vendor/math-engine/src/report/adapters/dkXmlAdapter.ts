/**
 * W152 P0-6 — Denmark Spillemyndigheden (SP) XML adapter.
 *
 * SP-mandated XML schema for monthly remote-casino reporting. Validated
 * against the public XSD at `spillemyndigheden.dk` (rev 2024). Keys are
 * PascalCase; the root element is `<GameReport>` with embedded
 * `<Operator>`, `<Game>`, and `<Period>` blocks.
 *
 * SP requires:
 *   * UTF-8 encoding declared in the XML prolog.
 *   * ISO-8601 timestamps with timezone (we emit UTC `Z`).
 *   * Monetary fields to 2 decimal places (the audit body rounds halves
 *     to even — banker's rounding).
 *   * RTP as a percentage with 4 decimals.
 *
 * Unlike PGAD this is a *human-readable* format. Determinism is still
 * a hard requirement (operator-side replay must match).
 */

import {
  ReportAdapter,
  JurisdictionalReport,
  xmlEscape,
  computeRtp,
  rtpToPercentString,
  mcToCurrencyString,
} from './types.js';

/**
 * Format millicredits as a 2-decimal-place string with banker's rounding
 * on the third decimal. SP audit tools use banker's rounding for halves.
 */
function mcTo2dp(mc: number): string {
  if (!Number.isFinite(mc) || mc < 0) return '0.00';
  // Banker's rounding at the millicredit (0.001) → cent (0.01) boundary.
  const whole = Math.trunc(mc / 1000);
  const remainderMc = mc - whole * 1000; // 0 .. 999
  const cents = Math.trunc(remainderMc / 10); // 0 .. 99
  const subCent = remainderMc - cents * 10; // 0 .. 9 (the rounding digit pool)
  let centsOut = cents;
  if (subCent > 5) centsOut += 1;
  else if (subCent === 5) {
    // Bank: round half to even.
    if (centsOut % 2 === 1) centsOut += 1;
  }
  // Cents may overflow to next currency unit on banker's rounding (e.g.
  // 99 + 1 = 100 → carry into whole). Re-normalise.
  let wholeOut = whole;
  if (centsOut === 100) {
    wholeOut += 1;
    centsOut = 0;
  }
  const centsStr = String(centsOut).padStart(2, '0');
  return `${wholeOut}.${centsStr}`;
}

export const DKXmlAdapter: ReportAdapter = {
  name: 'dk-sp-xml',
  mimeType: 'application/xml; charset=utf-8',
  emit(r: JurisdictionalReport): string {
    const rtp = computeRtp(r);
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(
      '<GameReport xmlns="https://spillemyndigheden.dk/schema/game-report/v1">',
    );
    lines.push('  <Operator>');
    lines.push(`    <LicenseId>${xmlEscape(r.operatorLicenseId)}</LicenseId>`);
    lines.push('  </Operator>');
    lines.push('  <Game>');
    lines.push(`    <LicenseId>${xmlEscape(r.gameLicenseId)}</LicenseId>`);
    lines.push(`    <Name>${xmlEscape(r.gameName)}</Name>`);
    lines.push(`    <Version>${xmlEscape(r.gameVersion)}</Version>`);
    lines.push('  </Game>');
    lines.push('  <Period>');
    lines.push(`    <Start>${xmlEscape(r.periodStartUtc)}</Start>`);
    lines.push(`    <End>${xmlEscape(r.periodEndUtc)}</End>`);
    lines.push(`    <Currency>${xmlEscape(r.currency)}</Currency>`);
    lines.push('  </Period>');
    lines.push('  <Activity>');
    lines.push(`    <TotalSpins>${r.totalSpins}</TotalSpins>`);
    lines.push(`    <UniquePlayers>${r.uniquePlayers}</UniquePlayers>`);
    lines.push(`    <TotalWagered>${mcTo2dp(r.totalWageredMc)}</TotalWagered>`);
    lines.push(`    <TotalWon>${mcTo2dp(r.totalWonMc)}</TotalWon>`);
    lines.push(`    <LargestWin>${mcTo2dp(r.largestWinMc)}</LargestWin>`);
    lines.push(`    <RtpPercent>${rtpToPercentString(rtp)}</RtpPercent>`);
    lines.push('  </Activity>');
    lines.push(
      `  <Jurisdiction>${xmlEscape(r.jurisdiction.toUpperCase())}</Jurisdiction>`,
    );
    lines.push('</GameReport>');
    return lines.join('\n') + '\n';
  },
};

/** Exposed for unit tests. */
export const __dkXmlInternals = { mcTo2dp };

// Avoid unused-import warning when caller only imports the adapter.
void mcToCurrencyString;
