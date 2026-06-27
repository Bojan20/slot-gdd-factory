/**
 * G2S (Gaming to System) protocol adapter — ANSI/AGA G2S v2.0.
 *
 * Serializes engine state to G2S XML message format.
 * All XML is hand-generated via pure string templating with proper escaping.
 * No DOM library dependencies.
 */

import type { SpinEvent, MeterSnapshot, GameIdentity } from './types.js';

export class G2SAdapter {
  // ─── XML escape ──────────────────────────────────────────────────────────

  /** Escape XML special characters in attribute values and text content. */
  static escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ─── Envelope builder ────────────────────────────────────────────────────

  private static envelope(messageType: string, bodyContent: string): string {
    const dateTime = new Date().toISOString();
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<g2s:g2sBody' +
      ' xmlns:g2s="http://www.g2s.org/g2sCore"' +
      ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
      ` dateTime="${G2SAdapter.escapeXml(dateTime)}"` +
      ' g2sVersion="G2S_2.0.0"' +
      ` messageType="${G2SAdapter.escapeXml(messageType)}">\n` +
      bodyContent +
      '\n</g2s:g2sBody>'
    );
  }

  // ─── cabinetStatus ───────────────────────────────────────────────────────

  /** Build a g2s:cabinetStatus XML message describing the game identity. */
  static cabinetStatus(gameId: GameIdentity): string {
    const body =
      `  <g2s:cabinetStatus` +
      ` gameId="${G2SAdapter.escapeXml(gameId.gameId)}"` +
      ` gameName="${G2SAdapter.escapeXml(gameId.gameName)}"` +
      ` version="${G2SAdapter.escapeXml(gameId.version)}"` +
      ` targetRtp="${gameId.targetRtp}"` +
      ` jurisdiction="${G2SAdapter.escapeXml(gameId.jurisdiction)}"` +
      (gameId.certificationId
        ? ` certificationId="${G2SAdapter.escapeXml(gameId.certificationId)}"`
        : '') +
      '/>';
    return G2SAdapter.envelope('cabinetStatus', body);
  }

  // ─── spinHistory ─────────────────────────────────────────────────────────

  /** Build a g2s:spinHistory XML message from a recall journal entry. */
  static spinHistory(event: SpinEvent, gameId: GameIdentity): string {
    const featuresXml = event.features
      .map(
        (f) => `    <g2s:feature kind="${G2SAdapter.escapeXml(f)}"/>`,
      )
      .join('\n');

    const body =
      `  <g2s:spinHistory` +
      ` gameId="${G2SAdapter.escapeXml(gameId.gameId)}"` +
      ` sessionId="${G2SAdapter.escapeXml(event.sessionId)}"` +
      ` spinIndex="${event.spinIndex}"` +
      ` timestamp="${G2SAdapter.escapeXml(event.timestamp)}"` +
      ` wagered="${event.wagered}"` +
      ` won="${event.won}"` +
      `>\n` +
      (featuresXml ? featuresXml + '\n' : '') +
      `  </g2s:spinHistory>`;

    return G2SAdapter.envelope('spinHistory', body);
  }

  // ─── meterReport ─────────────────────────────────────────────────────────

  /** Build a g2s:meterReport XML from a MeterSnapshot. */
  static meterReport(meters: MeterSnapshot, gameId: GameIdentity): string {
    const body =
      `  <g2s:meterReport` +
      ` gameId="${G2SAdapter.escapeXml(gameId.gameId)}"` +
      ` gamesPlayed="${meters.gamesPlayed}"` +
      ` totalWagered="${meters.totalWagered}"` +
      ` totalWon="${meters.totalWon}"` +
      ` netRevenue="${meters.netRevenue}"` +
      ` jackpotTotal="${meters.jackpotTotal}"` +
      `/>`;
    return G2SAdapter.envelope('meterReport', body);
  }

  // ─── eventReport ─────────────────────────────────────────────────────────

  /** Build a g2s:eventReport for feature triggers. */
  static eventReport(event: SpinEvent, gameId: GameIdentity): string {
    const featuresXml = event.features
      .map(
        (f) => `    <g2s:triggeredFeature kind="${G2SAdapter.escapeXml(f)}"/>`,
      )
      .join('\n');

    const body =
      `  <g2s:eventReport` +
      ` gameId="${G2SAdapter.escapeXml(gameId.gameId)}"` +
      ` sessionId="${G2SAdapter.escapeXml(event.sessionId)}"` +
      ` spinIndex="${event.spinIndex}"` +
      ` timestamp="${G2SAdapter.escapeXml(event.timestamp)}"` +
      `>\n` +
      (featuresXml ? featuresXml + '\n' : '') +
      `  </g2s:eventReport>`;

    return G2SAdapter.envelope('eventReport', body);
  }

  // ─── parse ───────────────────────────────────────────────────────────────

  /**
   * Parse a G2S XML message (minimal — extracts messageType and attributes
   * from the g2sBody envelope).
   */
  static parse(xml: string): { messageType: string; attributes: Record<string, string> } {
    // Extract messageType from the envelope
    const messageTypeMatch = /messageType="([^"]*)"/.exec(xml);
    const messageType = messageTypeMatch ? messageTypeMatch[1] ?? '' : '';

    // Extract all attributes from the envelope element (g2s:g2sBody)
    const attributes: Record<string, string> = {};

    // Find the g2sBody opening tag
    const bodyTagMatch = /<g2s:g2sBody([^>]*)>/.exec(xml);
    if (bodyTagMatch) {
      const attribStr = bodyTagMatch[1] ?? '';
      const attrRegex = /(\w[\w:.-]*)="([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = attrRegex.exec(attribStr)) !== null) {
        const key = m[1];
        const val = m[2];
        if (key !== undefined && val !== undefined) {
          attributes[key] = val;
        }
      }
    }

    return { messageType, attributes };
  }
}
