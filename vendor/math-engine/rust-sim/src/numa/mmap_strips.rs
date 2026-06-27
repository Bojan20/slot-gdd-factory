//! FAZA 9.9 — mmap-backed reel strip storage.
//!
//! [`MmapReelStrips`] stores reel strips either on the heap (fast fallback)
//! or memory-mapped from a temporary file (persistent-memory path).
//!
//! # Encoding format (temp file)
//!
//! ```text
//! [u64 reel_count]
//! for each reel:
//!   [u64 len]  [u32; len symbols]
//! ```
//! All values are little-endian.

use std::io::{self, Write as IoWrite};
use std::fs::OpenOptions;

use memmap2::Mmap;

// ─── Internal backing storage ────────────────────────────────────────────────

/// Holds the live `Mmap` together with the parsed strip slices that point
/// into it.  Keeping the `Mmap` alive here prevents the mapping from being
/// dropped while we hold references into it.
pub struct MmapData {
    /// Raw memory-mapped region.  Must outlive the decoded strips.
    _map: Mmap,
}

// ─── Public type ─────────────────────────────────────────────────────────────

/// Reel strips stored either on the heap or in a memory-mapped temp file.
pub struct MmapReelStrips {
    /// Owned decoded strips (either heap-allocated or decoded from mmap).
    strips: Vec<Vec<u32>>,
    /// Keeps the `Mmap` alive when using the mmap path.
    _backing: Option<MmapData>,
}

// ─── impl ────────────────────────────────────────────────────────────────────

impl MmapReelStrips {
    // ── Constructors ─────────────────────────────────────────────────────

    /// Heap-backed constructor — always succeeds, no I/O.
    pub fn from_strips(strips: &[Vec<u32>]) -> Self {
        Self {
            strips: strips.to_vec(),
            _backing: None,
        }
    }

    /// mmap-backed constructor.
    ///
    /// Creates a temporary file, serialises the strips into it, then
    /// memory-maps the file and deserialises the strips back from the
    /// mapping.  On any I/O error the function propagates the error;
    /// callers should fall back to [`Self::from_strips`] if desired.
    pub fn from_mmap(strips: &[Vec<u32>]) -> io::Result<Self> {
        // ── 1. Write strips into a temp file ─────────────────────────────
        // Use a uniquely-named file in the OS temp directory so we don't
        // need the `tempfile` crate as a regular (non-dev) dependency.
        use std::time::{SystemTime, UNIX_EPOCH};
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let pid = std::process::id();
        let path = std::env::temp_dir()
            .join(format!("slot_sim_numa_strips_{}_{}.bin", pid, ts));

        {
            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&path)?;

            // reel_count
            let reel_count = strips.len() as u64;
            file.write_all(&reel_count.to_le_bytes())?;

            for strip in strips {
                let len = strip.len() as u64;
                file.write_all(&len.to_le_bytes())?;
                for &sym in strip {
                    file.write_all(&sym.to_le_bytes())?;
                }
            }
            file.flush()?;
        } // file handle closed here — safe to mmap

        // ── 2. mmap the file ─────────────────────────────────────────────
        let file = OpenOptions::new().read(true).open(&path)?;
        // Best-effort cleanup — ignore errors (file may be in use on Windows)
        let _ = std::fs::remove_file(&path);
        let map = unsafe { Mmap::map(&file)? };

        // ── 3. Decode strips from the mapped bytes ────────────────────────
        let bytes: &[u8] = &map;
        let decoded = decode_strips(bytes)?;

        Ok(Self {
            strips: decoded,
            _backing: Some(MmapData { _map: map }),
        })
    }

    // ── Accessors ─────────────────────────────────────────────────────────

    /// Returns the symbol data for `reel`.  Returns an empty slice when
    /// `reel >= reel_count()` instead of panicking.
    pub fn get_strip(&self, reel: usize) -> &[u32] {
        self.strips.get(reel).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Number of reels stored.
    pub fn reel_count(&self) -> usize {
        self.strips.len()
    }
}

// ─── Decode helper ───────────────────────────────────────────────────────────

fn read_u64(src: &[u8], offset: &mut usize) -> io::Result<u64> {
    if src.len() < *offset + 8 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "need 8 bytes for u64"));
    }
    let val = u64::from_le_bytes(src[*offset..*offset + 8].try_into().unwrap());
    *offset += 8;
    Ok(val)
}

fn read_u32(src: &[u8], offset: &mut usize) -> io::Result<u32> {
    if src.len() < *offset + 4 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "need 4 bytes for u32"));
    }
    let val = u32::from_le_bytes(src[*offset..*offset + 4].try_into().unwrap());
    *offset += 4;
    Ok(val)
}

fn decode_strips(bytes: &[u8]) -> io::Result<Vec<Vec<u32>>> {
    let mut off = 0usize;
    let reel_count = read_u64(bytes, &mut off)? as usize;
    let mut strips = Vec::with_capacity(reel_count);
    for _ in 0..reel_count {
        let len = read_u64(bytes, &mut off)? as usize;
        let mut strip = Vec::with_capacity(len);
        for _ in 0..len {
            strip.push(read_u32(bytes, &mut off)?);
        }
        strips.push(strip);
    }
    Ok(strips)
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_strips() -> Vec<Vec<u32>> {
        vec![
            vec![1, 2, 3, 4, 5],
            vec![10, 20, 30],
            vec![7, 8, 9, 11, 13, 17],
        ]
    }

    #[test]
    fn from_strips_round_trip() {
        let orig = sample_strips();
        let s = MmapReelStrips::from_strips(&orig);
        assert_eq!(s.reel_count(), 3);
        assert_eq!(s.get_strip(0), &[1u32, 2, 3, 4, 5]);
        assert_eq!(s.get_strip(1), &[10u32, 20, 30]);
        assert_eq!(s.get_strip(2), &[7u32, 8, 9, 11, 13, 17]);
    }

    #[test]
    fn from_mmap_round_trip() {
        let orig = sample_strips();
        let s = MmapReelStrips::from_mmap(&orig).expect("mmap failed");
        assert_eq!(s.reel_count(), 3);
        assert_eq!(s.get_strip(0), &[1u32, 2, 3, 4, 5]);
        assert_eq!(s.get_strip(1), &[10u32, 20, 30]);
        assert_eq!(s.get_strip(2), &[7u32, 8, 9, 11, 13, 17]);
    }

    #[test]
    fn oob_returns_empty() {
        let orig = sample_strips();
        let s = MmapReelStrips::from_strips(&orig);
        let empty: &[u32] = &[];
        assert_eq!(s.get_strip(999), empty);
    }
}
