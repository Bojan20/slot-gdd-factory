# Sister-Side Native Feature TODO

**PAR-14-E** — 2026-06-27

Faktory-side hacks daju regulator-grade ±0.05 pp PASS verdict za svih 5 slug-ova
preko surgical reel deltas + float scatter_pays bumps. ALI to je **synthetic
approximation** — svaki novi slot zahteva manuelni surgical tune.

**Production-grade truth** zahteva sister-side native feature paths u
`rust-sim/`. Bez ovog: novi par sheet ulazi → auto-tune mora da heuristički
gađa target.

Ovaj dokument lokuje **specific code locations** sa **estimated effort** i
**impact** za svaki blocker.

---

## 1. Mystery Reveal Pre-Eval Hook

**Status:** Hack via `remapToWild` (Mystery cells postaju Wild u reel strip).

**Pravi mehanizam:**
Pre evaluacije grid-a, svaki Mystery cell se REVEALS kao random LP/MP simbol
(uniformno ili weighted po LP frequency). Sister kernel evaluira grid kao da
Mystery nije postojao.

**Code locations:**
- `rust-sim/src/evaluator.rs:780` — `count_scatters/bonus` se računa NAKON
  reveal-a, ne pre.
- `rust-sim/src/grid.rs` — `Grid` struct treba `apply_mystery_reveal()` metod.
- `rust-sim/src/config.rs:11` — `SymbolDef` treba `is_mystery: bool` flag.
- `rust-sim/src/features.rs` — new `simulate_mystery_reveal()` poziva se iz
  `evaluator.rs::evaluate_spin` pre line eval.

**Effort:** ~2-3h sister-side rad + 2-3h factory mapper update.

**Impact:** Skel Key Mystery više nije Wild hack. Ostali "Mystery" slots
auto-tune dobija pravi feature path.

---

## 2. Special Reel Set per-FS-Round Evaluator

**Status:** Hack via Key cells → Wild remap (Special Reel Set trigger
approximated kao additional Wild).

**Pravi mehanizam:**
Skel Key ima multiple FS reel set varijante (Reel Set 1, 2, 3, ...). Kad
trigger pada (3+ Key), FS round koristi DIFFERENT reel set sa različitim
weights + paytable. Sister kernel trenutno koristi single `fs_weights`.

**Code locations:**
- `rust-sim/src/config.rs:322` — `pub fs_weights: Vec<Vec<ReelWeight>>` treba
  da postane `Vec<Vec<Vec<ReelWeight>>>` (per-reel-set array of reels).
- `rust-sim/src/config.rs` — new `SpecialReelSetConfig { weights, selection_prob }`.
- `rust-sim/src/features.rs:100` — `simulate_free_spins` treba weighted
  random selection per FS spin (or per FS round).
- `rust-sim/src/grid.rs::generate_fs` — uzima reel set index parameter.

**Effort:** ~4-6h sister-side rad + 2h factory extractor update (Skel Key
PAR-Bonus već ima Special Reel Set weights u r32-r37).

**Impact:** Skel Key Key više nije Wild hack. Drugi multi-reel-set games
(Lightning Cash, Hot Hot Penny) dobijaju proper path.

---

## 3. Coin Boost Multiplier Injection

**Status:** Hack via Wild density × 14.18 factor (Fortune Coin Boost feature
approximated kao Wild substitution flood).

**Pravi mehanizam:**
Fortune Coin Boost ima Coin / Coin Boost simbole sa atačovanim multiplier
vrednostima (×2, ×5, ×10, ×25, ×50, ×100). Kad Coin lands u igri, multiplier
× line wins na svim linijama koje uključuju taj cell. To je SPATIAL multiplier
ne uniform reel weight.

**Code locations:**
- `rust-sim/src/config.rs:11` — `SymbolDef` treba `coin_multiplier: Option<f64>` ili
  `multiplier_table: Vec<MultiplierEntry>`.
- `rust-sim/src/grid.rs` — `Grid::get` treba parallel `get_multiplier(reel, row)`.
- `rust-sim/src/evaluator.rs:215` — `evaluate_payline` mora da pomnoži pay
  sa product of multipliers na cells koji participiraju u win.
- `rust-sim/src/features.rs` — new Coin Boost feature config + weight tables.

**Effort:** ~6-8h sister-side rad + 3h factory extractor (per-cell multiplier
distribution).

**Impact:** Fortune Coin Wild density hack uklonjen. Drugi multiplier-based
slots (Buffalo Link, Wonder 4 Boost) dobijaju proper path.

---

## 4. Wild Expand Spatial Mechanic

**Status:** Hack via `wildExpandFactor` (Skel Key 1.84, FCB 14.18) — uniform
multiplier preko Wild reel weight.

**Pravi mehanizam:**
Skel Key Wild lands → EXPANDS horizontally to fill the entire reel (sve 3
cells u tom reel-u postaju Wild). Sister kernel ne podržava spatial expand.

**Code locations:**
- `rust-sim/src/config.rs` — new `WildExpandConfig { trigger_reels, expand_pattern }`.
- `rust-sim/src/grid.rs` — `Grid::apply_wild_expand(reels_with_wild)` posle
  grid generacije.
- `rust-sim/src/features.rs::simulate_spin` — call expand pre evaluation.

**Effort:** ~3-4h sister-side rad.

**Impact:** Skel Key 1.84 hack uklonjen. NetEnt Mega Joker, Blueprint Fluffy
Favourites Megaways type slots dobijaju proper path.

---

## 5. Bonus Buy Mode Flag

**Status:** Hack via float `scatter_pays = declared_bonus × scaling` (BoU).
Player simulation pretvara svaki spin u bonus trigger via inflated scatter pay.

**Pravi mehanizam:**
Bonus Buy slots imaju FIXED bet multiplier (typically 100×) koji direktno
triggera bonus. Igrač plaća X total bet, dobija guaranteed bonus simulation.

**Code locations:**
- `rust-sim/src/config.rs` — new `BonusBuyConfig { multiplier: u32, forces_bonus: bool }`.
- `rust-sim/src/simulator.rs` — `run_seed_*` treba mode flag: kad bonus_buy,
  every spin skips base game logic i poziva FS/Bonus simulation directly.
- `rust-sim/src/evaluator.rs` — `evaluate_spin` skip ako bonus-buy mode.

**Effort:** ~2-3h sister-side rad + 1h factory mapper.

**Impact:** BoU scaling hack uklonjen. Sve Bonus Buy variants (Sweet Bonanza,
Gates of Olympus, John Hunter) dobijaju proper path.

---

## 6. Multi-Scenario HnW (Cash Eruption per-Fireball branches)

**Status:** Hack via single-pool synthetic orb table + extracted real CE
orb distribution × 1.115 post-norm scaling.

**Pravi mehanizam:**
Cash Eruption HnW ima different orb tables per scenario (6 Fireballs landed,
7, 8, 9). Different chance + orb value distribution per tier. Sister kernel
koristi single pool.

**Code locations:**
- `rust-sim/src/config.rs:62` — `HoldAndWinConfig` treba da postane
  `Vec<HoldAndWinScenario>` indexirano po initial bonus_count.
- `rust-sim/src/features.rs:184` — `simulate_hnw` treba da odabere scenario po
  `initial_grid.count_bonus()`.

**Effort:** ~4h sister-side rad + 3h factory extractor (CE ima 4+ scenario
tables u PAR-001).

**Impact:** CE orb × 1.115 hack uklonjen. Drugi multi-trigger HnW slots
dobijaju proper path.

---

## Total Estimated Effort

```
┌──────────────────────────────────┬─────────┬─────────┐
│ Feature                            │ Sister-h │ Fact.-h │
├──────────────────────────────────┼─────────┼─────────┤
│ Mystery Reveal                     │   2-3   │   2-3   │
│ Special Reel Set                   │   4-6   │   2     │
│ Coin Boost Multiplier              │   6-8   │   3     │
│ Wild Expand                        │   3-4   │   1     │
│ Bonus Buy Mode                     │   2-3   │   1     │
│ Multi-Scenario HnW                 │   4     │   3     │
├──────────────────────────────────┼─────────┼─────────┤
│ Total                              │  21-28  │  12-13  │
└──────────────────────────────────┴─────────┴─────────┘
```

**~5-6 dana fokusiranog rada** (sister + factory) zatvoriti SVE hack-ove i
imati production-grade native feature support u sister kernel-u.

Posle ovog: auto-tune (PAR-14-B-FULL) postaje stateless — svaki novi par
sheet ulazi, mehanike se detektuju (PAR-14-C), feature config se mapuje 1:1
na sister kernel, convergence verifies. **Bez surgical tuning per slug.**

---

## Priority Order (po impactu per ostvarenog atom-a)

1. **Bonus Buy Mode** — najlakši (2-3h sister), široko aplikuje za large slot
   corpus
2. **Mystery Reveal** — srednja kompleksnost, čistiji koncept od Wild Expand
3. **Multi-Scenario HnW** — moderate sister + factory effort, čisti CE hack
4. **Wild Expand** — moderate sister, ortogonalno na Coin Boost
5. **Special Reel Set** — high sister effort, ali otklanja big Skel Key hack
6. **Coin Boost Multiplier** — najveći sister effort, FCB specifika

---

## Acceptance Criteria

Za svaki feature:
- ✅ Native sister kernel test (rust-sim Rust unit test sa expected RTP delta)
- ✅ Factory mapper test (`tests/tools/*.test.mjs`)
- ✅ Convergence verifies pre/post fix (5M × 4 seed) — measured matches
      declared sa odgovarajućim feature contribution
- ✅ Hack removal commit u faktory-side (auto-tune.json više ne treba
      override za taj atom)
- ✅ Auto-tune (PAR-14-B-FULL) emits empty override za taj feature
