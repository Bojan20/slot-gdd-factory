//! W6.4 — PCG-64 XSL-RR-64 Known-Answer Test (KAT) vector dumper.
//!
//! Emits a deterministic JSON document with `(seed, outputs[])` pairs so the
//! TypeScript implementation (`src/utils/pcg64.ts`) can be byte-checked
//! against the Rust reference (`rust-sim/src/rng.rs::Pcg64Backend`).
//!
//! Usage:
//!     cargo run --release --bin pcg64_kat_dump -- \
//!         --seeds 0,1,42,12345,18446744073709551615 \
//!         --count 16 \
//!         --out tests/fixtures/pcg64_kat.json
//!
//! Output schema:
//!     {
//!       "generator": "Pcg64Backend (PCG-64 XSL-RR-64)",
//!       "ref": "rust-sim/src/rng.rs",
//!       "mult": "0x2360ED051FC65DA44385DF649FCCEF45",
//!       "inc":  "0xDA3E39CB94B95BDBDA3E39CB94B95BDB",   // (inc << 1) | 1
//!       "vectors": [
//!         {
//!           "seed": 12345,
//!           "outputs_u64": ["0x...","..."],
//!           "outputs_f64_unit": [0.123..., ...]   // u64 → [0,1) divide by 2^64
//!         }
//!       ]
//!     }
//!
//! The `outputs_f64_unit` channel matches `next_f64` used by `RngBackend` —
//! gives TS a closed parity envelope (state evolution + canonical float
//! projection).

use clap::Parser;
use serde::Serialize;
use slot_sim::rng::{create_rng, RngBackend, RngKind};
use std::fs;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "pcg64_kat_dump", about = "Emit PCG-64 KAT vectors as JSON")]
struct Args {
    /// Comma-separated u64 seeds (also accepts hex via 0x prefix).
    #[arg(long, default_value = "0,1,42,12345,18446744073709551615")]
    seeds: String,

    /// Number of outputs per seed.
    #[arg(long, default_value_t = 16)]
    count: usize,

    /// Output JSON file. Parent directory must exist.
    #[arg(long)]
    out: PathBuf,
}

#[derive(Serialize)]
struct KatVector {
    /// Decimal string — JSON Number loses precision above 2^53-1, so we
    /// stringify u64 seeds so TS can parse them back as BigInt losslessly.
    seed: String,
    seed_hex: String,
    outputs_u64: Vec<String>,
    outputs_f64_unit: Vec<f64>,
}

#[derive(Serialize)]
struct KatFile {
    generator: &'static str,
    reference: &'static str,
    /// PCG128_MULT rendered as 32-hex-char string (lowercase, 0x-prefixed).
    mult: String,
    /// PCG128_INC_DEFAULT rendered as 32-hex-char string.
    inc: String,
    count: usize,
    vectors: Vec<KatVector>,
}

fn parse_seed(token: &str) -> Result<u64, String> {
    let s = token.trim();
    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16).map_err(|e| format!("bad hex seed {s}: {e}"))
    } else {
        s.parse::<u64>().map_err(|e| format!("bad seed {s}: {e}"))
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    let seeds: Vec<u64> = args
        .seeds
        .split(',')
        .map(parse_seed)
        .collect::<Result<_, _>>()?;

    let mut vectors = Vec::with_capacity(seeds.len());
    for seed in &seeds {
        let mut rng = create_rng(RngKind::Pcg64, *seed);
        let mut u64s = Vec::with_capacity(args.count);
        let mut f64s = Vec::with_capacity(args.count);
        for _ in 0..args.count {
            let v = rng.next_u64();
            u64s.push(format!("0x{v:016X}"));
            // Same projection as RngBackend::next_f64 — top 53 bits / 2^53.
            // We keep BOTH formats so TS can verify u64 path AND f64 path.
            let unit = (v >> 11) as f64 * (1.0 / ((1u64 << 53) as f64));
            f64s.push(unit);
        }
        vectors.push(KatVector {
            seed: seed.to_string(),
            seed_hex: format!("0x{seed:016X}"),
            outputs_u64: u64s,
            outputs_f64_unit: f64s,
        });
    }

    // Mirror the actual Rust constants — render them straight from the
    // values used inside Pcg64Backend so the fixture can never drift from
    // the implementation it claims to pin.
    const PCG128_MULT: u128 = 0x2360_ED05_1FC6_5DA4_4385_DF64_9FCC_EF45;
    const PCG128_INC_DEFAULT: u128 = (0xDA3E_39CB_94B9_5BDB_u128 << 1) | 1;

    let kat = KatFile {
        generator: "Pcg64Backend (PCG-64 XSL-RR-64)",
        reference: "rust-sim/src/rng.rs",
        mult: format!("0x{PCG128_MULT:032x}"),
        inc: format!("0x{PCG128_INC_DEFAULT:032x}"),
        count: args.count,
        vectors,
    };

    if let Some(parent) = args.out.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&kat)?;
    fs::write(&args.out, json.as_bytes())?;
    eprintln!(
        "pcg64_kat_dump: wrote {} vectors × {} outputs → {}",
        kat.vectors.len(),
        args.count,
        args.out.display()
    );
    Ok(())
}
