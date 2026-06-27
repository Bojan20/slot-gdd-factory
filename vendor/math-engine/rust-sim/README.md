# Rust Slot Simulator

High-performance Monte Carlo simulator for slot games written in Rust.

## Performance

| Metric | TypeScript | Rust |
|--------|------------|------|
| Speed | 622k spins/sec | **21M spins/sec** |
| 1B spins | ~27 minutes | **48 seconds** |
| Speedup | 1x | **~33x** |

## Quick Start

```bash
# Build (release mode with LTO)
cargo build --release

# Quick test (4M spins)
./target/release/slot_sim --config configs/template.json --quick

# Full simulation (1B spins)
./target/release/slot_sim --config configs/template.json --full

# Custom simulation
./target/release/slot_sim --config configs/your_game.json --spins 25000000 --seeds 40
```

## CLI Options

```
USAGE:
    slot_sim [OPTIONS]

OPTIONS:
    -c, --config <PATH>    Path to game configuration JSON
    -s, --spins <NUM>      Spins per seed [default: 25000000]
    -n, --seeds <NUM>      Number of seeds [default: 40]
        --seed <NUM>       Base seed for RNG [default: 1]
        --quick            Quick mode (1M × 4 seeds = 4M)
        --full             Full mode (25M × 40 seeds = 1B)
    -v, --verbose          Verbose output with seed analysis
        --json             Output results as JSON
    -h, --help             Print help
    -V, --version          Print version
```

## Configuration Format

Games are configured via JSON files. See `configs/template.json` for a complete example.

### Required Fields

```json
{
  "name": "Game Name",
  "version": "1.0",
  "target_rtp": 96.0,
  "reels": 5,
  "rows": 3,
  "paylines": [[1,1,1,1,1], ...],
  "symbols": [...],
  "paytable": {...},
  "base_weights": [...],
  "fs_weights": [...],
  "free_spins": {...},
  "hold_and_win": {...},
  "lightning": {...},
  "max_win_cap": 5000.0,
  "feature_loop_cap": 100
}
```

## Architecture

```
src/
├── main.rs         # CLI entry point
├── config.rs       # JSON config loading
├── rng.rs          # XorShift128+ PRNG
├── grid.rs         # Grid generation
├── evaluator.rs    # Win evaluation
├── features.rs     # FS & H&W logic
├── simulator.rs    # Parallel simulation (Rayon)
└── stats.rs        # Atomic statistics
```

## Key Features

- **Parallel Simulation**: Uses Rayon for multi-threaded execution
- **Atomic Statistics**: Thread-safe stat accumulation
- **Multi-Seed Averaging**: Reduces variance for accurate RTP
- **JSON Configuration**: Easy game customization
- **95% Confidence Intervals**: Statistical validation

## Output Example

```
════════════════════════════════════════════════════════════
  Example Game v1.0
  Target RTP: 96.00%
════════════════════════════════════════════════════════════

Simulation: 25.00M spins × 40 seeds = 1.00B total

════════════════════════════════════════════════════════════
  RESULTS
════════════════════════════════════════════════════════════

RTP:          96.002% (+0.002%) ✓ PASS
95% CI:       [95.968%, 96.036%]
Std Error:    ±0.0170%

RTP Breakdown:
  Base Game:  47.05%
  Free Spins: 27.15%
  Hold & Win: 21.80%
  Lightning:  9.29%

Hit Rate:     25.82%
FS Frequency: 1/90.1
H&W Frequency: 1/83.0
Max Win:      1054.8x

════════════════════════════════════════════════════════════
  PERFORMANCE
════════════════════════════════════════════════════════════

Duration:     47.79s
Speed:        20.92M spins/sec
```

## Building

```bash
# Development
cargo build

# Release (optimized)
cargo build --release

# Run tests
cargo test
```

## License

MIT
