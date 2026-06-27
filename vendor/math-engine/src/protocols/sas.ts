/**
 * SAS (Slot Accounting System) v6.02 protocol adapter — industry-standard
 * casino floor accounting protocol.
 *
 * Encodes/decodes binary SAS messages for meter reporting.
 *
 * Packet format: [address(1)] [command(1)] [data(4-8 BCD)] [CRC(2)]
 * BCD encoding: each decimal digit in 4 bits. 1234 → 0x12 0x34.
 *
 * CRC-16-CCITT specification:
 *   Initial value: 0x0000
 *   Polynomial:    0x1021
 *   Input/output reflected: No
 *   Final XOR:     0x0000
 */

import type { MeterSnapshot } from './types.js';

/** SAS command byte constants (SAS v6.02). */
export const SAS_CMD = {
  GAMES_PLAYED:  0x1b, // 27 — Send games played since power up
  COIN_IN:       0x1f, // 31 — Send coin in (wagered) meter
  COIN_OUT:      0x20, // 32 — Send coin out (won) meter
  JACKPOT:       0x2a, // 42 — Send jackpot information
  GAME_METERS:   0x57, // 87 — Send game meters (combined)
} as const;

export class SASAdapter {
  // ─── CRC-16-CCITT ────────────────────────────────────────────────────────

  /**
   * Compute CRC-16-CCITT (polynomial 0x1021, init 0x0000, no reflection).
   * Used for SAS packet integrity.
   */
  static crc16(data: Uint8Array): number {
    let crc = 0x0000;
    for (let i = 0; i < data.length; i++) {
      crc ^= (data[i]! << 8);
      for (let bit = 0; bit < 8; bit++) {
        if (crc & 0x8000) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }
    return crc;
  }

  // ─── BCD helpers ─────────────────────────────────────────────────────────

  /**
   * Encode a non-negative integer to BCD in `byteLen` bytes (big-endian).
   * Each decimal digit occupies 4 bits. Max value = 10^(byteLen*2) - 1.
   */
  static encodeBcd(value: number, byteLen: number): Uint8Array {
    // Clamp to non-negative integer
    const v = Math.max(0, Math.floor(value));
    const out = new Uint8Array(byteLen);
    let str = v.toString(10).padStart(byteLen * 2, '0');
    // Truncate if too long (overflow)
    if (str.length > byteLen * 2) {
      str = str.slice(str.length - byteLen * 2);
    }
    for (let i = 0; i < byteLen; i++) {
      const hi = parseInt(str[i * 2]!, 10);
      const lo = parseInt(str[i * 2 + 1]!, 10);
      out[i] = ((hi & 0xf) << 4) | (lo & 0xf);
    }
    return out;
  }

  /**
   * Decode BCD bytes to a bigint (big-endian, each nibble is one decimal digit).
   */
  static decodeBcd(bytes: Uint8Array): bigint {
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      result += ((b >> 4) & 0xf).toString(10) + (b & 0xf).toString(10);
    }
    // Remove leading zeros but keep at least one digit
    result = result.replace(/^0+/, '') || '0';
    return BigInt(result);
  }

  // ─── Packet builder ──────────────────────────────────────────────────────

  /**
   * Build a SAS packet: [address] [command] [bcd_data...] [crc_hi] [crc_lo]
   * `dataLen` = number of BCD data bytes (4 for standard meters, 8 for jackpot).
   */
  private static buildPacket(
    address: number,
    command: number,
    value: number,
    dataLen: number,
  ): Uint8Array {
    const bcd = SASAdapter.encodeBcd(value, dataLen);
    const header = new Uint8Array([address & 0xff, command & 0xff]);
    // Combine header + bcd for CRC computation
    const forCrc = new Uint8Array(header.length + bcd.length);
    forCrc.set(header, 0);
    forCrc.set(bcd, header.length);

    const crc = SASAdapter.crc16(forCrc);
    const out = new Uint8Array(forCrc.length + 2);
    out.set(forCrc, 0);
    out[forCrc.length] = (crc >> 8) & 0xff;
    out[forCrc.length + 1] = crc & 0xff;
    return out;
  }

  // ─── Encode methods ──────────────────────────────────────────────────────

  /** Encode games-played meter (command 0x1B). */
  static encodeGamesPlayed(count: number, address: number): Uint8Array {
    return SASAdapter.buildPacket(address, SAS_CMD.GAMES_PLAYED, count, 4);
  }

  /** Encode coin-in (wagered) meter (command 0x1F). */
  static encodeCoinIn(wagered: number, address: number): Uint8Array {
    return SASAdapter.buildPacket(address, SAS_CMD.COIN_IN, wagered, 4);
  }

  /** Encode coin-out (won) meter (command 0x20). */
  static encodeCoinOut(won: number, address: number): Uint8Array {
    return SASAdapter.buildPacket(address, SAS_CMD.COIN_OUT, won, 4);
  }

  /** Encode jackpot information (command 0x2A). */
  static encodeJackpot(amount: number, address: number): Uint8Array {
    return SASAdapter.buildPacket(address, SAS_CMD.JACKPOT, amount, 8);
  }

  /**
   * Encode combined game meters (command 0x57).
   * Packet contains gamesPlayed + totalWagered + totalWon in BCD.
   */
  static encodeGameMeters(meters: MeterSnapshot, address: number): Uint8Array {
    const addr = address & 0xff;
    const cmd = SAS_CMD.GAME_METERS;

    const bcdPlayed  = SASAdapter.encodeBcd(meters.gamesPlayed, 4);
    const bcdWagered = SASAdapter.encodeBcd(meters.totalWagered, 4);
    const bcdWon     = SASAdapter.encodeBcd(meters.totalWon, 4);

    const headerLen = 2; // address + command
    const dataLen = bcdPlayed.length + bcdWagered.length + bcdWon.length;
    const forCrc = new Uint8Array(headerLen + dataLen);
    forCrc[0] = addr;
    forCrc[1] = cmd;
    forCrc.set(bcdPlayed,  2);
    forCrc.set(bcdWagered, 2 + bcdPlayed.length);
    forCrc.set(bcdWon,     2 + bcdPlayed.length + bcdWagered.length);

    const crc = SASAdapter.crc16(forCrc);
    const out = new Uint8Array(forCrc.length + 2);
    out.set(forCrc, 0);
    out[forCrc.length]     = (crc >> 8) & 0xff;
    out[forCrc.length + 1] = crc & 0xff;
    return out;
  }

  // ─── Decode ──────────────────────────────────────────────────────────────

  /**
   * Decode a raw SAS response packet.
   * Format: [address(1)] [command(1)] [bcd_data(N)] [crc(2)]
   * Returns the parsed meter value as bigint.
   */
  static decode(data: Uint8Array): { command: number; value: bigint; address: number } {
    if (data.length < 4) {
      throw new Error(`SAS packet too short: ${data.length} bytes`);
    }
    const address = data[0]!;
    const command = data[1]!;
    // BCD data is everything between command byte and the 2-byte CRC
    const bcdData = data.slice(2, data.length - 2);
    const value = bcdData.length > 0 ? SASAdapter.decodeBcd(bcdData) : 0n;
    return { command, value, address };
  }
}
