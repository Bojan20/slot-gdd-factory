# Vendored binaries — slot-gdd-factory

BLOCK-8 (Boki 2026-06-27): *"sve mora da ide u slot gdd projekat. jedan projekat
jedno sve."*

## mc_runtime_real

Monte Carlo runtime Rust binary used by `tools/math-backend.mjs` for the
`/batch`, `/converge`, and `/spin` endpoints.

| Field | Value |
|---|---|
| Architecture | Mach-O 64-bit arm64 |
| Size | ~400 KB |
| Throughput | ~150-300M spins/sec single-thread |
| Source | `slot-math-engine-template` Rust kernel (vendored snapshot) |

### Rebuild

If you need to refresh this binary after upstream changes:

```bash
cd ~/Projects/slot-math-engine-template
cargo build --release --bin mc_runtime_real
cp target/release/mc_runtime_real /path/to/slot-gdd-factory/vendor/bin/
chmod +x /path/to/slot-gdd-factory/vendor/bin/mc_runtime_real
```

### Why vendored

The factory must run as a self-contained project — `npm run dev`,
`SlotGDDBuilder.command`, and the convergence pipeline must NOT depend on
a sibling repository. Vendoring lets the factory boot up cleanly on a
fresh clone.

The `math-backend.mjs` binary resolution prefers this vendored copy and
falls back to `~/Projects/slot-math-engine-template/target/release/` only
for legacy compatibility (will be removed in a future wave).
