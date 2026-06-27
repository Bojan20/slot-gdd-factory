//! SAS (Slot Accounting System) v6.02 protocol adapter —
//! industry-standard casino floor accounting protocol.
//!
//! Encodes/decodes binary SAS messages for meter reporting.
//!
//! Packet format: [address(1)] [command(1)] [data(4-8 BCD)] [CRC(2)]
//! BCD encoding: each decimal digit in 4 bits. 1234 → 0x12 0x34.
//!
//! CRC-16-CCITT:
//!   Initial value: 0x0000
//!   Polynomial:    0x1021
//!   No input/output reflection
//!   Final XOR:     0x0000

use super::types::MeterSnapshot;

/// SAS command bytes (SAS v6.02).
pub mod cmd {
    pub const GAMES_PLAYED: u8 = 0x1b; // 27
    pub const COIN_IN: u8 = 0x1f;      // 31
    pub const COIN_OUT: u8 = 0x20;     // 32
    pub const JACKPOT: u8 = 0x2a;      // 42
    pub const GAME_METERS: u8 = 0x57;  // 87
}

pub struct SASAdapter;

impl SASAdapter {
    // ─── CRC-16-CCITT ────────────────────────────────────────────────────────

    /// Compute CRC-16-CCITT (polynomial 0x1021, init 0x0000, no reflection).
    pub fn crc16(data: &[u8]) -> u16 {
        let mut crc: u16 = 0x0000;
        for &byte in data {
            crc ^= (byte as u16) << 8;
            for _ in 0..8 {
                if crc & 0x8000 != 0 {
                    crc = crc.wrapping_shl(1) ^ 0x1021;
                } else {
                    crc = crc.wrapping_shl(1);
                }
            }
        }
        crc
    }

    // ─── BCD helpers ─────────────────────────────────────────────────────────

    /// Encode a u64 to BCD in `byte_len` bytes (big-endian).
    /// Panics if byte_len * 2 digits cannot represent value (silently truncates).
    pub fn encode_bcd(value: u64, byte_len: usize) -> Vec<u8> {
        let s = format!("{:0>width$}", value, width = byte_len * 2);
        // Truncate to last byte_len*2 chars if overflow
        let s = if s.len() > byte_len * 2 {
            &s[s.len() - byte_len * 2..]
        } else {
            &s[..]
        };
        let mut out = vec![0u8; byte_len];
        for i in 0..byte_len {
            let hi = s[i * 2..i * 2 + 1].parse::<u8>().unwrap_or(0);
            let lo = s[i * 2 + 1..i * 2 + 2].parse::<u8>().unwrap_or(0);
            out[i] = (hi << 4) | (lo & 0xf);
        }
        out
    }

    /// Decode BCD bytes to a u64.
    pub fn decode_bcd(bytes: &[u8]) -> u64 {
        let mut result: u64 = 0;
        for &b in bytes {
            let hi = ((b >> 4) & 0xf) as u64;
            let lo = (b & 0xf) as u64;
            result = result * 100 + hi * 10 + lo;
        }
        result
    }

    // ─── Packet builder ──────────────────────────────────────────────────────

    fn build_packet(address: u8, command: u8, value: u64, data_len: usize) -> Vec<u8> {
        let bcd = Self::encode_bcd(value, data_len);
        let mut for_crc = Vec::with_capacity(2 + bcd.len());
        for_crc.push(address);
        for_crc.push(command);
        for_crc.extend_from_slice(&bcd);

        let crc = Self::crc16(&for_crc);
        let mut out = for_crc;
        out.push((crc >> 8) as u8);
        out.push((crc & 0xff) as u8);
        out
    }

    // ─── Encode methods ──────────────────────────────────────────────────────

    /// Encode games-played meter (command 0x1B).
    pub fn encode_games_played(count: u64, address: u8) -> Vec<u8> {
        Self::build_packet(address, cmd::GAMES_PLAYED, count, 4)
    }

    /// Encode coin-in (wagered) meter (command 0x1F).
    pub fn encode_coin_in(wagered: u64, address: u8) -> Vec<u8> {
        Self::build_packet(address, cmd::COIN_IN, wagered, 4)
    }

    /// Encode coin-out (won) meter (command 0x20).
    pub fn encode_coin_out(won: u64, address: u8) -> Vec<u8> {
        Self::build_packet(address, cmd::COIN_OUT, won, 4)
    }

    /// Encode jackpot information (command 0x2A).
    pub fn encode_jackpot(amount: u64, address: u8) -> Vec<u8> {
        Self::build_packet(address, cmd::JACKPOT, amount, 8)
    }

    /// Encode combined game meters (command 0x57).
    pub fn encode_game_meters(meters: &MeterSnapshot, address: u8) -> Vec<u8> {
        let bcd_played = Self::encode_bcd(meters.games_played, 4);
        let bcd_wagered = Self::encode_bcd(meters.total_wagered as u64, 4);
        let bcd_won = Self::encode_bcd(meters.total_won as u64, 4);

        let mut for_crc = Vec::with_capacity(2 + 12);
        for_crc.push(address);
        for_crc.push(cmd::GAME_METERS);
        for_crc.extend_from_slice(&bcd_played);
        for_crc.extend_from_slice(&bcd_wagered);
        for_crc.extend_from_slice(&bcd_won);

        let crc = Self::crc16(&for_crc);
        let mut out = for_crc;
        out.push((crc >> 8) as u8);
        out.push((crc & 0xff) as u8);
        out
    }

    // ─── Decode ──────────────────────────────────────────────────────────────

    /// Decode a raw SAS response packet.
    /// Returns (command, value, address).
    pub fn decode(data: &[u8]) -> Result<(u8, u64, u8), String> {
        if data.len() < 4 {
            return Err(format!("SAS packet too short: {} bytes", data.len()));
        }
        let address = data[0];
        let command = data[1];
        let bcd_data = &data[2..data.len() - 2];
        let value = if bcd_data.is_empty() {
            0u64
        } else {
            Self::decode_bcd(bcd_data)
        };
        Ok((command, value, address))
    }
}
