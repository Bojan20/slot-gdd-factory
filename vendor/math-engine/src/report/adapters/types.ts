/**
 * W152 P0-6 — Jurisdictional reporting adapters.
 *
 * Operators integrating the slot engine with regulator-side reporting
 * portals need format-specific emitters. The shape of the input is the
 * same across all jurisdictions (RTP, wagered, won, spins, session ids),
 * but the wire format (XML, JSON, CSV, fixed-width binary) varies per
 * regulator.
 *
 * The four adapters in this module mirror the four reporting endpoints
 * KIMI W152 §3.6 identified as required for 2025-2026 market entry:
 *
 *   * **Italy ADM AAMS** → `PGADAdapter` (fixed-width plain-text, the
 *     PGAD format used for daily aggregator transmission)
 *   * **Denmark SP** → `DKXmlAdapter` (SP-mandated XML schema)
 *   * **Malta MGA** → `MGAJsonAdapter` (operator portal JSON ingest)
 *   * **NJ DGE** → `NJCsvAdapter` (monthly Excel/CSV template)
 *
 * All adapters consume the same `JurisdictionalReport` shape and emit
 * a `string` (the regulator-side adapters on this side never write to
 * disk; the caller decides where the bytes go — SFTP / HTTPS / portal
 * paste). They never mutate the input.
 *
 * Compliance note: this module is a *format* layer. Field semantics are
 * defined here. Whether or not a specific session may be reported at all
 * (KSA Cruks integration, ADM PGAD authorisation, etc.) is handled by
 * `src/jurisdiction/` upstream — bad sessions never reach this layer.
 */

// ─── Input shape ─────────────────────────────────────────────────────────────

/**
 * One aggregated reporting period (operator-side; usually daily or
 * monthly depending on jurisdiction).
 *
 * All money fields use a single canonical unit: **millicredits** (1/1000
 * of a currency unit). This avoids float arithmetic errors when the
 * regulator wants 4-decimal-place EUR/£/USD precision (RTP = won/wagered
 * to 4 dp is a UKGC RTS 11 requirement).
 *
 * `periodStartUtc` / `periodEndUtc` are ISO-8601 UTC strings — adapters
 * convert to local format as needed (PGAD wants `YYYY-MM-DD HH:MM:SS`,
 * MGA wants ISO-8601, etc.).
 */
export interface JurisdictionalReport {
  /** Schema version of this DTO. Bump if fields change. */
  readonly schemaVersion: '1.0.0';
  /** Operator licensee id assigned by the regulator. */
  readonly operatorLicenseId: string;
  /** Per-jurisdiction game id (often differs from internal game id). */
  readonly gameLicenseId: string;
  /** Internal game name for cross-reference (not always reported on the wire). */
  readonly gameName: string;
  /** Game version (semver). */
  readonly gameVersion: string;
  /** ISO 4217 currency code: GBP, EUR, USD, … */
  readonly currency: string;
  /** Aggregation period (UTC). */
  readonly periodStartUtc: string;
  readonly periodEndUtc: string;
  /** Total spins in period. */
  readonly totalSpins: number;
  /** Total wagered, **millicredits**. */
  readonly totalWageredMc: number;
  /** Total won (paid out to players), **millicredits**. */
  readonly totalWonMc: number;
  /** Unique players who placed at least one spin. */
  readonly uniquePlayers: number;
  /** Largest single-spin win observed in period, **millicredits**. */
  readonly largestWinMc: number;
  /** Jurisdiction code (UKGC / MGA / ADM / DGE / SP / KSA / AGCO / GGL / DGOJ / ANJ). */
  readonly jurisdiction: string;
}

// ─── Adapter contract ────────────────────────────────────────────────────────

/**
 * The single method every adapter implements. Pure function: same input
 * → same output bytes (no clocks, no PRNGs). Determinism matters because
 * the regulator-side audit will re-derive the bytes from operator data.
 */
export interface ReportAdapter {
  readonly name: string;
  readonly mimeType: string;
  emit(report: JurisdictionalReport): string;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Format millicredits as decimal string with exactly 3 decimals. */
export function mcToCurrencyString(mc: number): string {
  if (!Number.isFinite(mc) || mc < 0) {
    return '0.000';
  }
  // Integer division avoids float drift up to ~Number.MAX_SAFE_INTEGER.
  const whole = Math.trunc(mc / 1000);
  const frac = mc % 1000;
  const fracStr = String(frac).padStart(3, '0');
  return `${whole}.${fracStr}`;
}

/** Compute RTP as a 0-1 ratio; returns 0 when totalWagered = 0. */
export function computeRtp(report: JurisdictionalReport): number {
  if (report.totalWageredMc <= 0) return 0;
  return report.totalWonMc / report.totalWageredMc;
}

/** Format an RTP ratio (0-1) as a percentage with 4 decimals (UKGC RTS 11). */
export function rtpToPercentString(rtp: number): string {
  return (rtp * 100).toFixed(4);
}

/** Convert ISO-8601 UTC `YYYY-MM-DDTHH:MM:SSZ` to PGAD `YYYY-MM-DD HH:MM:SS`. */
export function isoToPgadDate(iso: string): string {
  // Tolerate either `Z` or `+00:00`. PGAD ingests UTC; no local conversion
  // is performed (operator is responsible for emitting UTC in the DTO).
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (!m) {
    throw new Error(`isoToPgadDate: not an ISO-8601 timestamp: ${iso}`);
  }
  return `${m[1]} ${m[2]}`;
}

/** Escape a string for safe insertion into XML element text or attribute. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 4180 CSV field quoter — wraps in `"` and doubles internal `"`. */
export function csvQuote(s: string): string {
  if (!/[",\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}
