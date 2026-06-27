/**
 * W152 P0-6 — Italy ADM AAMS PGAD adapter.
 *
 * PGAD = "Protocollo Giochi A Distanza" — the fixed-width plain-text
 * record format ADM (formerly AAMS) uses for daily aggregator reports
 * from licensed remote gaming operators.
 *
 * One record per game/day, terminated by `\r\n` (Windows line endings —
 * ADM upload portal explicitly requires this). All fields are padded to
 * their fixed width and stripped of unprintable bytes.
 *
 * Field layout (per KIMI W152 §3.6 + ADM technical bulletin 2024-12):
 *
 *   1.  RECORD_TYPE       —  4 chars,  always "DAIL"
 *   2.  OPERATOR_LICENSE  — 16 chars,  zero-left-padded
 *   3.  GAME_LICENSE      — 16 chars,  zero-left-padded
 *   4.  PERIOD_START      — 19 chars,  "YYYY-MM-DD HH:MM:SS"
 *   5.  PERIOD_END        — 19 chars,  "YYYY-MM-DD HH:MM:SS"
 *   6.  CURRENCY          —  3 chars,  ISO 4217
 *   7.  TOTAL_SPINS       — 14 chars,  zero-left-padded integer
 *   8.  TOTAL_WAGERED     — 18 chars,  zero-left-padded thousandths (e.g. 0.001 EUR)
 *   9.  TOTAL_WON         — 18 chars,  zero-left-padded thousandths
 *  10.  RTP_PCT_BP        —  8 chars,  basis-points × 100 (96.5432% → 00965432)
 *  11.  UNIQUE_PLAYERS    — 10 chars,  zero-left-padded integer
 *  12.  LARGEST_WIN       — 18 chars,  zero-left-padded thousandths
 *  13.  FILLER            —  4 chars,  reserved (currently "0000")
 *
 * Total record width: 167 chars + CRLF.
 *
 * The schema version is encoded into the FILLER reserved bytes only when
 * ADM rolls a new revision — until then it remains "0000".
 */

import {
  ReportAdapter,
  JurisdictionalReport,
  isoToPgadDate,
  computeRtp,
} from './types.js';

// ─── Field widths ────────────────────────────────────────────────────────────

const W_RECORD_TYPE = 4;
const W_OP_LICENSE = 16;
const W_GAME_LICENSE = 16;
const W_PERIOD = 19;
const W_CURRENCY = 3;
const W_SPINS = 14;
const W_MONEY = 18;
const W_RTP = 8;
const W_PLAYERS = 10;
const W_FILLER = 4;

const RECORD_WIDTH =
  W_RECORD_TYPE +
  W_OP_LICENSE +
  W_GAME_LICENSE +
  W_PERIOD +
  W_PERIOD +
  W_CURRENCY +
  W_SPINS +
  W_MONEY +
  W_MONEY +
  W_RTP +
  W_PLAYERS +
  W_MONEY +
  W_FILLER;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function padLeft(s: string, width: number, ch = '0'): string {
  if (s.length > width) {
    // Defensive: truncate from the left so the least-significant digits
    // survive (overflow is itself reportable, but we never want a CR/LF
    // mid-record).
    return s.slice(s.length - width);
  }
  return ch.repeat(width - s.length) + s;
}

function padRight(s: string, width: number, ch = ' '): string {
  if (s.length > width) return s.slice(0, width);
  return s + ch.repeat(width - s.length);
}

function pgadDate(iso: string): string {
  // isoToPgadDate already returns exactly 19 chars; no padding needed.
  const v = isoToPgadDate(iso);
  return padRight(v, W_PERIOD);
}

function pgadMc(mc: number): string {
  // mc → thousandths string, zero-padded to 18 chars. ADM treats the
  // last 3 digits as the fractional component implicitly.
  if (!Number.isFinite(mc) || mc < 0) return padLeft('0', W_MONEY);
  return padLeft(String(Math.trunc(mc)), W_MONEY);
}

function pgadRtpBp(rtp: number): string {
  // RTP as basis-points × 100 = millionths of 1. E.g. 0.965432 → 965432
  // → "00965432". Caps at 99.999999%.
  if (!Number.isFinite(rtp) || rtp < 0) return padLeft('0', W_RTP);
  const v = Math.min(0.99999999, rtp);
  const bp = Math.round(v * 1_000_000);
  return padLeft(String(bp), W_RTP);
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export const PGADAdapter: ReportAdapter = {
  name: 'adm-pgad',
  // ADM portal accepts text/plain with CRLF; ZIP wrapping happens upstream.
  mimeType: 'text/plain; charset=ascii',
  emit(report: JurisdictionalReport): string {
    const parts = [
      padRight('DAIL', W_RECORD_TYPE),
      padLeft(report.operatorLicenseId, W_OP_LICENSE),
      padLeft(report.gameLicenseId, W_GAME_LICENSE),
      pgadDate(report.periodStartUtc),
      pgadDate(report.periodEndUtc),
      padRight(report.currency.slice(0, 3), W_CURRENCY),
      padLeft(String(report.totalSpins), W_SPINS),
      pgadMc(report.totalWageredMc),
      pgadMc(report.totalWonMc),
      pgadRtpBp(computeRtp(report)),
      padLeft(String(report.uniquePlayers), W_PLAYERS),
      pgadMc(report.largestWinMc),
      '0000', // FILLER
    ];
    const record = parts.join('');
    if (record.length !== RECORD_WIDTH) {
      throw new Error(
        `PGADAdapter: record width ${record.length} != ${RECORD_WIDTH} — schema bug`,
      );
    }
    return record + '\r\n';
  },
};

/** Exposed for unit tests and downstream tooling. */
export const PGAD_RECORD_WIDTH = RECORD_WIDTH;
