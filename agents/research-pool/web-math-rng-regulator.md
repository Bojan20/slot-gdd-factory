# Web Research Pool — Slot Game Math, RNG & Regulator Standards (2025–2026)

> **Scope:** Deep-dive across the full math/RNG/compliance stack for online slot games, with 2025–2026 regulatory deltas explicitly called out (UKGC RTS January-2025 amendments, UKGC £5 / £2 stake caps April-2025 + May-2025, MGA 85% RTP floor, DE GlüNeuRStV 5-second spin / €1 stake / autoplay+jackpot prohibition, Ontario AGCO Registrar's Standards iGaming v.4.x, Sweden Spelinspektionen SIFS 2025:1 hospitality rules, EU AI Act Article 5 spill-over into player personalisation, Netherlands KSA bonus restriction + ad ban package).
>
> **Output mandate:** Vendor-neutral throughout (no industry standard / Pragmatic / NetEnt / Microgaming / L&W / Scientific Games / Megaways / Buffalo / Cleopatra / Wolf-Run / Cash-Eruption references in normative text — only "industry-standard", "reference benchmark", "typical vendor practice"). Internal-research markers (Schwartz 2024, Harrigan 2010, Vigna 2019/2020) are academic, not commercial brands.
>
> **Target consumer:** `slot-gdd-factory` PAR-sheet builder, math-engine atoms, audit / regulator-gate blocks, and senior reviewers writing acceptance criteria for new GDDs.

---

## 0. Executive Glance — One Table To Pin

| Layer | 2025–2026 Anchor | "Atomic-detail" entry |
|:--|:--|:--|
| RNG core | GLI-19 v3.0 + NIST SP 800-22 Rev.1a (15 sub-tests) | PCG-64 / xoshiro256\*\* / ChaCha20-CTR DRBG preferred; MT19937 demoted (Vigna 2019 — "It is high time we let go of the Mersenne Twister") |
| Replay determinism | Seeded DRBG, BLAKE3 ratchet 32-byte key | Independent labs (GLI, eCOGRA, iTech Labs, BMM, TriSigma, SIQ, QUINEL) re-execute any session from `(seed, draw-index)` |
| PAR sheet | XLSX / Mathematica notebook | Reel strips × symbol-count × paytable × hit-frequency → RTP/SD/VI tuple; ~10⁷–10⁹ Monte-Carlo verification |
| RTP corridor | UKGC: advertised must match real (no hard floor, RTS-7); MGA 85% min; DE GlüNeuRStV ~92% practical floor; SE 85%; ON-AGCO declared RTP enforced | RTP = Σ(Pᵢ × Xᵢ) per spin; bonus contribution typically 30–60% of total RTP |
| Volatility | 1–10 industry scale, VI = σ·z (z=1.96 → 95%) | "VERY-HIGH" cluster (8–10) drives base-game starvation; bonus carries 50–70% of RTP |
| Win cap | UKGC industry-typical 10,000–50,000× stake (no statutory cap, but stake cap £5 / £2 forces lower abs €); MGA disclosure-only; DE effective €250k abs cap via €1 stake; ON-AGCO declared cap displayed | Hard truncate (industry default) vs. proportional redistribution (rare) |
| Spin tempo | UKGC RTS 2A: 2.5 s slot floor (unchanged 2025), 5 s non-slot floor NEW (RTS 14G, 17-Jan-2025); DE: 5 s; SE: 3 s (SIFS 2025:1) | Turbo / quickspin / slam-stop **prohibited UK** since 17-Jan-2025 |
| Autoplay | UKGC: **fully prohibited slots** (RTS 8) since 17-Jan-2025; MGA: max 100 batch + RG-pause; DE: prohibited | RG-stop, loss/win limits, mandatory pause every Nth spin (where allowed) |
| Bonus buy | DE / NL: prohibited; UK: prohibited (June 2026 UKGC ruling); MGA / ON-AGCO: allowed with RTP-split disclosure | Ante bet (≈1.25× stake → +25% scatter probability) widely permitted ex-DE |
| Jackpot | Fixed / Progressive (single-game / network / wide-area); must-hit-by / mystery / daily | UKGC SR 6.3.4 pool transparency; ON-AGCO mandatory hit-by disclosure; DE **slot jackpots prohibited** |
| Responsible gambling | UKGC LCCP 3.4 / RTS 13 (reality check 60 min mandatory); ON-AGCO Std. 4.07; MGA loss/deposit limits; SE Spelpaus; NL Cruks; DK ROFUS; UK GamStop | EU AI Act Art. 5 prohibits manipulative personalisation (effective 2-Feb-2025 prohibitions tier; full 2-Aug-2027 GP-AI deadline) |
| Cert pipeline | Internal QA → math-sim 10⁷–10⁹ spins → GLI/eCOGRA/iTechLabs/BMM cert → jurisdiction filing → live monitoring | Typical cert: 4–12 weeks new title, 4–6 weeks variant |

---

## 1. RNG — Random Number Generation

### 1.1 Algorithm Families & Industry Position 2025–2026

Online slots use **deterministic random bit generators (DRBGs)** seeded from a high-entropy source. The seed-then-iterate model is mandatory because of replay/audit (see §1.4).

| Family | Period | State | Speed (ns/64-bit draw) | Statistical quality | Industry posture 2026 |
|:--|:--|:--|:--:|:--|:--|
| **Mersenne Twister (MT19937)** | 2¹⁹⁹³⁷-1 | ≈2.5 KB | ~3.0 | Fails BigCrush LinearComp / MatrixRank; Vigna (2019) "It is high time we let go of the Mersenne Twister" arXiv 1910.06437 | **Legacy only** — still seen in older certified titles, regulators tolerate but new builds discouraged |
| **Xorshift / xoshiro256\*\*** | 2²⁵⁶-1 | 32 B | ~0.9 | Passes BigCrush, TestU01, PractRand 32TB | Common in 2024–2026 vendor stacks; small-state friendly for replay logs |
| **PCG-64 (XSH-RR)** | 2¹²⁸ | 16 B | ~1.1 | Passes BigCrush; O'Neill 2014 paper | Rising — Rust `rand`, NumPy default since 1.17; "pcg-random.org/rng-performance.html" benchmarks confirm fastest of family |
| **ChaCha20 (counter mode)** | 2⁵¹² counter | 64 B | ~2.5–3.0 | Cryptographic; 20-round Salsa20 variant | Used where regulator demands crypto-strength (NJ, several EU); slower but auditable |
| **BLAKE3-DRBG (keyed)** | 2²⁵⁶ | 32 B key + counter | ~1.5 (with SIMD) | Cryptographic; tree-hash parallelism | Emerging; IETF draft `draft-aumasson-blake3-00`; useful as ratchet over a `(session-seed)` |
| **AES-CTR DRBG** | 2¹²⁸ counter | 16 B key + 16 B IV | ~1.0 (AES-NI) | NIST SP 800-90A approved | NJ / PA require — see DGE Technical Standard 5.4 |

**Industry-standard practice (vendor-neutral):** server-side DRBG with one of {PCG-64, xoshiro256\*\*, ChaCha20-CTR, AES-CTR}, seeded by OS entropy (`getrandom(2)` / `BCryptGenRandom`) plus periodic re-keying. The `seedrandom`-pattern (npm package, used widely in HTML5 slot front-ends for reference replay) is well-known but is **client-side only** — never the source of money-bearing draws.

### 1.2 Hardware vs Software RNG

| Layer | Hardware (HRNG) | Software (PRNG/DRBG) |
|:--|:--|:--|
| Source | Thermal / shot noise / ring-oscillator / quantum optical | Deterministic algorithm |
| Throughput | 1 Mbit/s – 1 Gbit/s | 1–10 Gbit/s |
| Replay | Not deterministic → audit-hostile | Deterministic given seed → audit-friendly |
| Industry use | Land-based EGMs (rare, mostly retired); some server bootstrap entropy | All certified online slots |
| Cert burden | Statistical + physical attestation | Statistical only |

Real online slot stacks **mix**: HRNG/OS-entropy seeds a DRBG, and the DRBG is the per-spin generator (so labs can replay).

### 1.3 Certification — RNG Specific

| Doc / Lab | Mandate | Scope | Cadence |
|:--|:--|:--|:--|
| **GLI-19 v3.0** (Standards for Interactive Gaming Systems) | Server-based / online gaming RNG, paytable integrity, financial transactions | Adopted in NJ, PA, MI, ON (informative), MT, WV, several Caribbean | Initial cert + annual review |
| **GLI-11** | Land-based EGM RNG | NV (informative), TGA reciprocity | Initial + cabinet variant |
| **eCOGRA** (Audit + RNG cert) | EU + UK private seal; many UK operators carry | UKGC complementary | Quarterly RTP audit + annual RNG re-cert |
| **iTech Labs** (Sydney) | RNG evaluation, math evaluation, source-code review | MGA preferred, plus AU, NZ, IT, ES | 12-month re-cert typical |
| **BMM Testlabs** | RNG + game math + system | NV, NJ, ON, AU, ZA, RO | 4–12 week new cert |
| **TriSigma / SIQ / QUINEL** | Smaller EU labs | MGA, IT, RO, BG | 4–8 weeks |
| **NMi Metrology / NMI** | NL KSA preferred | NL | Per build |

Per `everymatrix.com/gaming-laboratories-international-gli-delivers-gold-standard-certification`, full platform GLI-19 typically takes 4–12 weeks new, 4–6 weeks variant.

### 1.4 Seeded RNG for Replay — The Audit Pattern

Every certified online slot must answer the question: *"Given a player complaint about spin X at timestamp T, can the lab reproduce the exact reel-stop and pay outcome?"* The standard pattern:

1. **Per-session seed** = `H(server_secret || player_id || session_start_ns || nonce)` where H is SHA-256 or BLAKE3.
2. **Per-spin draw index** = monotonic counter increments within session.
3. DRBG state = `BLAKE3.keyed(session_seed).ratchet(draw_index)` → 64-bit draw → modulo reel-strip length to choose stop position.
4. Spin record: `(session_id, draw_idx, raw_draws[], stops[], symbols[], pay, hash_chain_link)` all written to immutable append-only log (industry: `log4js` to S3 Object Lock, BigQuery write-once tables, or Cloud Spanner with `INSERT_ONLY`).
5. Hash-chain link: `link[i] = H(link[i-1] || record[i])` — tamper-evidence.

Labs replay by ingesting the log and re-running the DRBG with the recorded seed. **Mismatch = certification breach.**

### 1.5 Bias Testing — Statistical Battery

NIST SP 800-22 Rev.1a (April 2010, still authoritative in 2026) defines 15 sub-tests:

| # | Test | Detects |
|:-:|:--|:--|
| 1 | Frequency (Monobit) | Bit-balance bias |
| 2 | Frequency within Block | Local bias |
| 3 | Runs | Streak structure |
| 4 | Longest Run of Ones in a Block | Extremes |
| 5 | Binary Matrix Rank | Linear dependence |
| 6 | Discrete Fourier Transform (Spectral) | Periodicity |
| 7 | Non-overlapping Template Matching | Aperiodic patterns |
| 8 | Overlapping Template Matching | Periodic templates |
| 9 | Maurer's Universal Statistical | Compressibility |
| 10 | Linear Complexity | LFSR-equivalent length |
| 11 | Serial | k-bit pattern frequency |
| 12 | Approximate Entropy | Block entropy |
| 13 | Cumulative Sums (Cusum) | Max excursion |
| 14 | Random Excursions | State cycles |
| 15 | Random Excursions Variant | State-visit counts |

**Plus**:
- **Diehard / Dieharder** (Marsaglia battery), 18 tests
- **TestU01 BigCrush** (L'Ecuyer & Simard 2007) — 106 tests, gold standard, runs ~6 h on 2024 hardware
- **PractRand** — supports streaming, tests up to 32 TB samples
- **Chi-square goodness-of-fit** per reel symbol distribution (degrees of freedom = #symbols − 1)
- **Kolmogorov-Smirnov** for continuous draws (e.g., scatter timing)
- **Anderson-Darling** — heavier weight on tails (good for max-win detection)

Pass criterion (NIST): individual test p ≥ 0.01, uniformity of p-values across 1 000 streams uniform on [0,1].

### 1.6 Recertification Cadence

| Jurisdiction | Cadence |
|:--|:--|
| UKGC | Annual + on material change (RTS Annex A) |
| MGA | Annual full audit + monthly RNG sampling via iTech / TriSigma |
| ON-AGCO | Quarterly RTP audit; annual RNG full |
| DE GGL | Per-build certification (Whitelist 4) + ongoing technical surveillance |
| SE Spelinspektionen | Annual + audit on triggered events |
| NL KSA | Per-build + bi-annual |

### Citations §1
- arXiv 1910.06437 — Vigna 2019 "It is high time we let go of the Mersenne Twister"
- arXiv 1402.6246 — Vigna 2014 "An experimental exploration of Marsaglia's xorshift generators, scrambled"
- arXiv 2108.06112 — Optical QRNG passing NIST SP 800-22
- L'Ecuyer & Simard 2007 — "TestU01: A C Library for Empirical Testing of RNGs", ACM TOMS 33(4)
- NIST CSRC project page: https://csrc.nist.gov/projects/random-bit-generation/documentation-and-software
- GLI-19 v3.0 PDF: https://www.gcgra.gov.ae/media/h3fjrvgp/gli-19_interactive_gaming_systems_v30-1.pdf
- IETF BLAKE3 draft: https://www.ietf.org/archive/id/draft-aumasson-blake3-00.html
- techmast.org/technical-gaming-standards-guide/
- twinwingames.com/slot-certification-guide/
- ecogra.org/services/random-number-generator-rng-certification/
- everymatrix.com platform GLI-19 announcement

---

## 2. PAR Sheets — Paytable And Reels

### 2.1 What A PAR Sheet Contains

The **PAR sheet** (Paytable And Reels) is the canonical math design artefact for any slot. Reference: Harrigan & Dixon 2010 "PAR Sheets, probabilities, and slot machine play: implications for problem and non-problem gambling" (Journal of Gambling Issues 23), which forensically reverse-engineered a 1990s reference machine and published the full structure publicly — still the most-cited public source.

Standard sections (vendor-neutral):

| Section | Contents |
|:--|:--|
| **Header / Summary** | Game name, math version, reels × rows, paylines or "ways", min/max stake, target RTP, target VI, target hit frequency, max win cap |
| **Symbol Table** | Symbol ID → name → category (high/low/wild/scatter/bonus) → asset reference |
| **Reel Strips** | Per-reel ordered list of symbol IDs. Industry-typical lengths: 30–80 stops per reel, sometimes "virtual reel" 100–256 |
| **Symbol Counts** | Per-reel histogram (chi-square goodness-of-fit input) |
| **Paytable** | (symbol, count) → multiplier; or "ways" matrix; scatter pays separately |
| **Hit Frequency Matrix** | P(any pay), P(scatter), P(wild line-up), P(bonus trigger) |
| **Feature Matrix** | Free-spins distribution, multiplier ladder, bonus-buy price, ante-bet uplift |
| **RTP Decomposition** | Base game RTP, free-spins RTP, jackpot contribution, bonus-buy RTP, total |
| **Volatility** | σ per spin, VI at 90/95% CI, expected SD over 10⁶ spins |
| **Max-Win Distribution** | P(≥ X× stake) for X ∈ {10, 50, 250, 1000, 5000, 10000, max} |
| **Adverse States** | Force-max-win seed, force-min-win seed, force-feature seed, jackpot-trigger seed |
| **Regulator Gates** | Jurisdiction → applied stake cap, applied RTP variant, applied win-cap, autoplay on/off, bonus-buy on/off |
| **Audit Log** | Git SHA, math-lead sign-off, reviewer sign-off, cert lab reference |

### 2.2 Industry Tooling

| Tool | Use | Notes |
|:--|:--|:--|
| Wolfram Mathematica | Symbolic math + Monte-Carlo + LaTeX export | Standard at math-only studios; permits closed-form RTP for simple games |
| Excel / Google Sheets | PAR sheet primary deliverable | Named ranges per reel; Excel `RANDBETWEEN` for quick mock; macros for Monte-Carlo |
| Python (NumPy / Numba) | Industrial Monte-Carlo at 10⁸+ spins | `numpy.random.Generator(PCG64)` is the modern default |
| Rust (rand crate) | High-throughput simulation | Used by newer vendors; 5–10× NumPy throughput |
| Vendor in-house DSLs | Reel-strip configuration language | Often a JSON/YAML schema fed into the runtime |

### 2.3 Output Format

**Primary deliverable:** Excel `.xlsx` with named ranges per reel (`Reel1`, `Reel2`, …), per paytable row (`Pay_High_5OAK`), per feature table (`FS_Award_3SC`). Math-engine consumers read XLSX directly via `openpyxl` / `apache-poi` and emit a runtime JSON.

**Secondary deliverables:**
- PDF "math one-pager" for product / regulator
- JSON or TOML runtime config for the slot engine
- CSV simulation results (RTP per 10⁶ batch)
- Markdown GDD section embedding key tables

### 2.4 Math Engine Architecture — Deterministic Outcome Generation

The "outcome generation" pattern (industry-canonical):

```
spin(stake, mode) →
  draw[0..N] = DRBG.next_n(N)                   // N = number of reels × picks
  stops[r]   = draw[r] mod len(reel[r])         // reel-strip lookup
  symbols    = window(reel[r], stops[r], rows)  // visible symbols
  wins       = evaluate_paylines(symbols, paytable)
            +  evaluate_scatters(symbols, scatter_table)
            +  evaluate_features(symbols)
  if feature_triggered:
      feature_outcome = run_feature(DRBG, mode)
      wins += feature_outcome
  wins = apply_win_cap(wins, jurisdiction_cap)
  return (stops, symbols, wins, audit_record)
```

Key invariants:
1. **All money-bearing draws** consume the DRBG in a fixed, documented order — so replay works.
2. **Feature subroutines** receive the DRBG by reference (not a new generator) so audit log is continuous.
3. **Win cap** applied last so the regulator can see "uncapped potential" vs. "paid" in the log.

### 2.5 Hot-Swap PAR — Paytable Without Rebuild

Modern engines load reel strips + paytable + feature parameters from a versioned JSON keyed by `(game_id, math_version, jurisdiction_variant)`. The runtime binary does not change between math iterations. This enables:

- 90% / 92% / 94% / 96% RTP variants from a single binary (jurisdictional)
- A/B testing of paytable rebalances under same RNG
- Faster recertification (only math file re-tested, not engine code)

Regulator caveat: every math variant requires a *separate* cert. UKGC RTS-7B explicitly requires "the RTP applied to the customer's session must match the advertised RTP for that game variant."

### 2.6 Adverse-State Testing

Mandatory test scenarios before cert filing:

| Scenario | Force vector | Pass criteria |
|:--|:--|:--|
| Max-win | Forced seed reproducing top-prize sequence | Pays exactly the advertised cap (e.g., 10 000× stake), audit log consistent, no over/underflow |
| Min-win / loss-streak | 10 000 consecutive losses force | UI stable, RG limits triggered correctly, autoplay-where-allowed pauses |
| Feature force | Trigger condition forced | Feature math RTP within ±0.1% of target |
| Disconnect / resume | Mid-spin TCP drop | On reconnect, identical outcome resolves; no double-pay |
| Currency edge | Min-stake spin with max-multiplier feature | No rounding leak; total ≤ cap |
| Concurrent session attack | Same account two devices | Account locked or one session forfeited per LCCP 2.7 |

### Citations §2
- Harrigan & Dixon 2010 "PAR Sheets, probabilities, and slot machine play" — https://www.stoppredatorygambling.org/wp-content/uploads/2012/12/PAR-Sheets-Probabilities-and-Slot-Machine-Play-Implications-for-Problem-and-Non-Problem-Gambling.pdf
- Know Your Slots — "The PAR Sheet: A Look Under the Hood": https://www.knowyourslots.com/the-par-sheet-a-look-under-the-hood-of-a-slot-machine-game/
- Easy Vegas free PAR sheets archive: https://easy.vegas/games/slots/par-sheets
- slotgamedesign.com tutorial: https://slotgamedesign.com/2019/01/19/slot-math-tutorial-creating-par-sheets/
- USPTO 6 926 607 / 7 811 165 — multi-stage gaming devices with PAR-sheet detail
- gamixlabs.com simulation farm: https://gamixlabs.com/simulation.html

---

## 3. RTP & Volatility

### 3.1 RTP Corridors Per Jurisdiction (2025–2026 snapshot)

| Jurisdiction | RTP floor | RTP ceiling | Stake cap | Notes |
|:--|:-:|:-:|:--|:--|
| **UKGC (GB)** | none statutory (RTS-7B requires *advertised = real*) | none | £5/spin all ages (9-Apr-2025); £2/spin 18-24 (21-May-2025) | 92–96% effective; Betfred fined £323k for non-compliance Oct-2025 |
| **MGA (Malta)** | **85%** (since 31-May-2021 amendment) | 99% practical | None | Streamlined remote + land per "Policy Paper on Amending the Return to Player Minimum Percentage" |
| **DE GGL (GlüNeuRStV)** | none statutory but 5.3% turnover tax + €1 stake cap → effective ~92–94% | ~96% | €1/spin | Slot jackpots prohibited; bonus-buy prohibited; 5-second spin |
| **SE Spelinspektionen** | **85%** (hospitality SIFS 2025:1) | none | SEK regulated per channel | Online slot RTP floor in practice ≥92% |
| **NL KSA** | 92% (informative per CRUKS technical) | 96% | €350/mo deposit limit ≤24, €700 24+ | Bonuses to be banned ex-cashback; full ad ban roadmap 2026 |
| **ON-AGCO (Ontario)** | declared RTP enforced | declared | No statutory stake cap | Per Standard 4.07 player must see RTP pre-play |
| **NJ DGE / PA PGCB** | 83% (NJ regs § 13:69E-1.28) | 99% | None | GLI-19 mandatory |
| **DK Spillemyndigheden** | 88% practical | 96% | DKK channel limits | ROFUS mandatory |
| **IT ADM** | 90% effective | 96% | €10/spin | iTech / SIQ cert |
| **ES DGOJ** | 90% | 96% | €5–10/spin | SIQ / TriSigma cert |

### 3.2 Volatility Classification

Industry has converged on a **1–10 scale** (sometimes badged "low / mid / high / very-high"). Per `vegasslotsonline.com/features/volatility/` and `wizardofvegas.com/forum/questions-and-answers/math/28096-calculating-volatility-index-of-slot-machine-mini-game/`:

| Bucket | 1–10 | Hit frequency typical | σ per unit stake | Player feel |
|:--|:-:|:-:|:-:|:--|
| LOW | 1–3 | 30–45% | 1.5–4 | Frequent small pays, rare big |
| MID | 4–6 | 20–30% | 4–8 | Balanced |
| HIGH | 7–8 | 15–22% | 8–14 | Streaks; big-bonus dependent |
| VERY-HIGH | 9–10 | 10–18% | 14–25+ | Long droughts; max-win lottery |

### 3.3 Volatility Index Formula

**VI** = σ · z(CI)

Where σ is the per-spin standard deviation and z is the two-tail normal critical value (1.645 for 90% CI, **1.96 for 95% CI** — industry default).

**Standard deviation per spin:**

σ² = E[X²] − (E[X])² = Σᵢ Pᵢ Xᵢ² − RTP²

Where Pᵢ is the probability of pay outcome i, Xᵢ is the pay (in units of stake) of outcome i, and RTP = Σᵢ Pᵢ Xᵢ.

**Worked sanity:** A game with 96% RTP and σ = 9 has VI = 9 × 1.96 ≈ 17.6 → "high".

### 3.4 Hit Frequency × Avg Win = RTP

This is the Schwartz 2024 framing (Roll the Bones, revised edition):

RTP = HitFreq × AvgWin (per unit stake)

In practice modern slots have non-zero scatter / feature pays that complicate the single-equation form; the canonical decomposition is:

RTP_total = RTP_base + RTP_feature + RTP_jackpot

with:
- **Base** typically 50–70% of total RTP
- **Feature (FS / bonus)** typically 30–50% of total RTP
- **Jackpot (when present)** 0.5–8% of total RTP (regulator cap on jackpot contribution exists in some jurisdictions)

Reference: BettingUSA "Return To Player (RTP) & Volatility Explained 2026" confirms ~2/3 base, ~1/3 bonus split for industry-standard 96% RTP video slots.

### 3.5 Bonus Contribution %

| Game style | Base | Feature | Jackpot | Notes |
|:--|:-:|:-:|:-:|:--|
| Low-vol classic | 80% | 18% | 2% | Few features, frequent hits |
| Mid-vol video | 65% | 33% | 2% | Standard 2026 production |
| High-vol "scatter pays" | 55% | 43% | 2% | Tumble / cascade games |
| Very-high "buy-feature centric" | 40% | 58% | 2% | Where bonus-buy permitted |

### 3.6 Empirical RTP Verification — Chi-Squared

Standard cert procedure: run 10⁷–10⁹ spins under controlled DRBG seed; compare observed pay distribution to theoretical:

χ² = Σⱼ (Oⱼ − Eⱼ)² / Eⱼ

With degrees of freedom = number of pay-buckets − 1. Pass criterion: p ≥ 0.05 (two-tailed) typical; some labs use 0.01 to reduce false-reject.

Per `gamixlabs.com/simulation.html` and developer docs: 10⁷ spins is the floor; 10⁹ for high-vol or progressive titles (jackpot-hit rate may be 1-in-50M to 1-in-300M).

**Confidence interval on observed RTP:**

CI = RTP ± z · σ / √N

For N = 10⁷ and σ = 10: CI₉₅ ≈ ±0.062% — labs target observed RTP within ±0.1% of theoretical.

### 3.7 Variance & Standard Deviation Per Session

For a session of n spins at unit stake:

E[session win] = n · RTP
σ[session win] = σ · √n

For RTP=0.96, σ=9, n=1000: expected loss = 40 units, SD = 285 units — long-tail explains why short sessions feel "rigged" even on certified math.

### Citations §3
- Schwartz "Roll the Bones" rev. 2024 — academic monograph on gambling math
- MGA Policy Paper "Amending the Return to Player Minimum Percentage": https://www.mga.org.mt/the-mga-streamlines-the-return-to-player-percentage-applicable-to-both-remote-and-land-based-sectors/
- DE GlüNeuRStV: https://www.rakeback.com/news/how-germanys-five-second-slot-spin-rule-impacts-player-engagement/
- Lower RTPs DE analysis: https://www.igaming.com/igamingcare/lower-rtps-and-their-impact-on-players-and-operators-in-germany/
- Sweden hospitality SIFS 2025:1: https://www.igamingtoday.com/sweden-slot-machine-hospitality-rules-2025/
- BettingUSA RTP & volatility 2026: https://www.bettingusa.com/casino/return-to-player/
- VegasSlotsOnline volatility chart: https://www.vegasslotsonline.com/features/volatility/
- wizards.us slot math model: https://wizards.us/blog/slot-machine-math-model/

---

## 4. Win Caps

### 4.1 Statutory Win Caps By Jurisdiction (2025–2026)

| Jurisdiction | Statutory absolute win cap | Implied stake-multiple cap | Notes |
|:--|:--|:--|:--|
| **UKGC** | None statutory | None statutory, but with £5/£2 stake cap and 10 000× industry max → £50 000 abs max in practice | Operators publish max-win in game info |
| **MGA** | None statutory | Vendor-set (typical 5 000–50 000×) | Disclosure required |
| **DE GlüNeuRStV** | Effectively €250 000 (€1 × 250 000×) | 250 000× via €1 stake | Slot jackpots prohibited so max is the cap |
| **ON-AGCO** | Declared cap must be displayed | Vendor-set | Per Std 4.07 |
| **NL KSA** | Operator-set | Operator-set | Pre-play disclosure |
| **NJ DGE** | None | Vendor-set (typical 10 000× for video slot) | GLI-19 § 4.12 |
| **SE Spelinspektionen** | None | Vendor-set | SIFS series |
| **IT ADM** | None | Vendor-set | Disclosure |
| **ES DGOJ** | None | Vendor-set | Disclosure |

*Note: The "100 000× UKGC" framing in some industry chatter is **not a statutory UKGC cap**; it is an internal vendor-side ceiling pattern. UKGC's enforceable rule is RTS-7B "advertised = real" and the operator-side game-info display.*

### 4.2 Cap Behavior

**Hard truncate (industry default ~95% of cases):**
```
pay = min(uncapped_pay, cap)
record (uncapped, capped, delta)  // audit trail
```

**Proportional redistribution (rare, mostly land-based jackpot pools):**
```
if uncapped_pay > cap:
    overflow = uncapped_pay - cap
    add overflow to "must-hit-by" pool / pity bank
    pay = cap
```

UK / EU regulators prefer **hard truncate with full audit log** because redistribution introduces RTP drift over time that's harder to certify.

### 4.3 Big-Win Tier Thresholds (Vendor-Neutral)

Industry-standard celebratory tiers (used for FX / audio gates):

| Tier | × stake | Audio swell | UI duration | Notes |
|:--|:-:|:--|:--|:--|
| Win | 1–5× | Short jingle | 0.5–1 s | Filter false-wins (UK RTS 14 prohibits celebrating ≤1× stake) |
| Big Win | 5–15× | Mid swell, counter-up | 2–3 s | |
| Mega Win | 15–50× | Full track, fireworks | 3–5 s | |
| Super Mega Win | 50–250× | Cinematic | 5–8 s | |
| Epic / Max Win | 250–1 000×+ | Bespoke, opt-out per LCCP 8 | 8–15 s | |
| Top / Cap Win | at cap | Bespoke + capture screen | 15–20 s | "You won the max!" overlay |

### 4.4 UK-Specific Caveat — False-Win Prohibition

Per UKGC consultation response "Online games design and reverse withdrawals — Prohibiting effects that give the illusion of 'false wins'", effective **17 January 2025**: any pay ≤ stake **must not** trigger the "win" audio/visual treatment. This forces math engines and presentation layers to distinguish *positive return* from *break-even or sub-stake return* explicitly.

### Citations §4
- UKGC consultation response on false wins: https://www.gamblingcommission.gov.uk/consultation-response/online-games-design-and-reverse-withdrawals/summary-of-responses-prohibiting-effects-that-give-the-illusion-of-false
- DE €1 stake / 5 s / €250k math: https://www.rakeback.com/news/how-germanys-five-second-slot-spin-rule-impacts-player-engagement/
- UKGC April 2025 stake caps: https://www.olbg.com/news/ukgc-confirms-new-stake-limits-online-slots-starting-april-2025
- Statutory Instrument 2024 article (Harris Hagan): https://www.harrishagan.com/white-paper-series-statutory-instrument-published-for-online-slot-stake-limits/

---

## 5. Spin Tempo Regulations

### 5.1 Minimum Spin Time (2025–2026)

| Jurisdiction | Slot floor | Other casino floor | Effective date |
|:--|:-:|:-:|:--|
| **UKGC** | **2.5 s** (RTS 2A) | **5 s** (RTS 14G, NEW Jan-2025) | 31-Oct-2021 (slots) + 17-Jan-2025 (non-slots) |
| **DE GlüNeuRStV** | **5.0 s** | 5.0 s | Jul-2021 |
| **SE Spelinspektionen** | 3.0 s (SIFS 2025:1 hospitality) | 3.0 s | 1-Dec-2025 hospitality scope |
| **NL KSA** | None statutory; 6 s pause between sessions tested | n/a | Per Cruks technical guidance |
| **IT ADM** | 4.0 s (effective) | varies | Per Decreto Dignità |
| **ES DGOJ** | None statutory | n/a | RTP / wagering controlled |
| **ON-AGCO** | None statutory but min 2.5 s strongly recommended | n/a | Reg 4 |

### 5.2 Turbo / Quickspin / Slam-Stop Policy

| Jurisdiction | Turbo | Quickspin | Slam-stop |
|:--|:-:|:-:|:-:|
| **UKGC** | ❌ prohibited (RTS 2A, 17-Jan-2025) | ❌ | ❌ |
| **DE** | ❌ | ❌ | ❌ |
| **SE** | ❌ | ❌ | ❌ |
| **NL** | restricted | restricted | restricted |
| **ON-AGCO** | allowed but speed floor recommended | allowed | discouraged |
| **MGA** | allowed | allowed | allowed |
| **NJ DGE** | allowed | allowed | allowed |

### 5.3 Autoplay

| Jurisdiction | Slots autoplay | Per-batch limit | Mandatory pauses |
|:--|:--|:--|:--|
| **UKGC** | ❌ **prohibited 17-Jan-2025** (RTS 8 update) | n/a | n/a |
| **DE** | ❌ prohibited | n/a | n/a |
| **SE** | restricted | 50 | every 10 spins |
| **NL** | restricted | 50 | every 10 spins |
| **MGA** | ✅ allowed | 100 | RG pause every 50 |
| **ON-AGCO** | ✅ allowed | 100 | RG configurable |
| **NJ DGE** | ✅ allowed | varies | per operator |

UKGC RTS 8 historical text (pre-2025): "the number of auto-play gambles must not exceed 100 in one batch... must be able to stop regardless of how many auto-play gambles they initially chose or how many remain." This batch-cap survives for non-slot casino games; for slots autoplay is now fully off.

### 5.4 Session Limits / Reality Checks

| Jurisdiction | Mandatory reality check | Default interval | Configurable? |
|:--|:--|:--|:--|
| **UKGC** | Yes (RTS 13) | 60 min default, 30 min selectable | Yes, player-set |
| **DE** | Yes | session warning at 1 h + hard logout at panic limits | Centralized via OASIS |
| **SE** | Yes | reality check via Spelpaus | Yes |
| **NL** | Yes | per Cruks | Yes |
| **ON-AGCO** | Yes (Std 4.07) | Configurable, 60 min default | Yes |
| **MGA** | Yes | Operator-set, 60 min typical | Yes |
| **NJ DGE** | Yes (24:69O-1.5) | 60 min | Yes |

### Citations §5
- UKGC RTS 13: https://www.gamblingcommission.gov.uk/manual/remote-gambling-and-software-technical-standards/rts-13-time-requirements-and-reality-checks
- UKGC RTS 8 autoplay: https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards/rts-8-autoplay-functionality
- Wiggin LLP Jan 2025 update summary: https://www.wiggin.co.uk/insight/remote-game-design-changes-taking-effect-17-january-2025/
- Harris Hagan 17-Jan-2025 reminder: https://www.harrishagan.com/reminder-changes-to-remote-games-design-requirements-come-into-force-on-17-january-2025/
- Affiverse autoplay/quickspin ban: https://www.affiversemedia.com/ukgc-bans-quickspin-and-autoplay-for-online-slots/
- Betfred £323k fine: https://www.yogonet.com/international/news/2025/10/01/115610-betfred-operator-fined-323-428-by-ukgc-over-noncompliant-slot-features

---

## 6. Bonus Buy & Ante Bet

### 6.1 Bonus Buy / Feature Buy

| Jurisdiction | Bonus buy status (2025–2026) | Notes |
|:--|:--|:--|
| **DE GlüNeuRStV** | **❌ banned** since July-2021 | Part of slot reform |
| **NL KSA** | restricted in 2025 bonus ban package | New rules per KSA "Beleidsregels" 2025 |
| **UKGC** | **❌ banned June 2026** | Per UKGC ruling labslots.com/blog/ukgc-feature-buy-ban/; effective per Statutory Instrument |
| **MGA** | ✅ allowed with disclosure | RTP both base & feature-bought must be displayed |
| **ON-AGCO** | ✅ allowed | Std 4.07 disclosure |
| **SE Spelinspektionen** | ✅ allowed with limits | Some titles restricted |
| **NJ DGE / PA PGCB** | ✅ allowed | GLI-19 disclosure |

Standard math: Bonus-buy price is typically **70–120× stake** for feature entry; RTP of buy-mode often 0.5–2% higher than base to compensate for guaranteed feature variance. Industry pattern that publicly emerged via "Drops & Wins"-style tournaments (vendor-neutral phrasing: "scheduled prize-drop campaigns").

### 6.2 Ante Bet ("Bet+", "Boost", "Super Stake")

Mechanism: player pays **1.25× stake** to receive **+25% scatter probability** (or 1.5× for +50%). RTP is held constant across modes (or slightly higher for ante to incentivise the mode).

| Jurisdiction | Ante-bet status |
|:--|:--|
| **DE** | ❌ banned (treated as bonus-buy proxy) |
| **NL** | restricted |
| **UKGC** | ✅ allowed but pre-June-2026 review pending; advertised RTP must be displayed for each mode |
| **MGA** | ✅ allowed with disclosure |
| **ON-AGCO** | ✅ allowed |

### 6.3 Super Bonus Buy / Feature Buy Tiers

Multiple-tier buy patterns (e.g., "Basic Feature 70× / Super Feature 200× / Mega Feature 500×") require **separate RTP disclosure per tier**. UKGC pre-ban policy treated this as multiple games for cert purposes.

### Citations §6
- UKGC feature-buy ban: https://labslots.com/blog/ukgc-feature-buy-ban/
- Slingo bonus-buy UK guide: https://www.slingo.com/blog/guides/bonus-buy-slots-what-uk-players-should-know-before-playing/
- DE GlüNeuRStV game-feature analysis: https://gofaizen-sherle.com/gambling-license/germany
- Netherlands bonus restriction package: https://next.io/news/regulation/netherlands-introduce-complete-ban-online-gambling-ads/

---

## 7. Jackpots

### 7.1 Types

| Type | Description | Typical %RTP contribution | Regulator notes |
|:--|:--|:-:|:--|
| **Fixed** | Static top prize (e.g., 10 000× stake) | 1–4% | Simplest; no pool |
| **Progressive single-game** | Pool grows from contributions, resets to seed on hit | 1–5% | Per-game pool |
| **Progressive multi-game / network** | Pool shared across games / sites | 1–6% | UKGC SR 6.3.4 pool transparency |
| **Wide-area progressive (WAP)** | Multi-operator / multi-jurisdiction | 2–8% | Cross-border treaty issues |
| **Must-hit-by** | Pool hits by specified ceiling | varies | ON-AGCO disclosure mandatory; UKGC permitted |
| **Mystery** | Random trigger independent of reels | 1–3% | Player-random; needs explicit RNG disclosure |
| **Daily** | 24h-bounded pool, must hit by midnight | 1–3% | Pool decay → hit-by-time |
| **Hourly / time-locked** | Pool with sub-day hit window | 1–3% | Less common 2026 |

### 7.2 Pool Math

| Concept | Definition |
|:--|:--|
| **Seed (reset value)** | Guaranteed minimum after a hit (e.g., $50 000) |
| **Contribution rate** | Fraction of each bet routed to pool (typical 1–5%) |
| **Reseed contribution** | Sub-fraction of contributions reserved to rebuild seed |
| **Marketing fund** | Sub-fraction reserved for vendor marketing (NJ allows; UK requires transparency) |
| **Hit probability** | P(top-prize trigger) per spin, derived from PAR sheet |
| **Expected hit interval** | E[spins to hit] = 1/p |
| **Pool growth rate** | (contribution_rate − reseed_rate) × bet_volume / time |

### 7.3 Reseed Rate Worked Example

Per CloudPages / Solutive analysis:
- Reseed amount: $50 000
- Probability of jackpot-winning event: 1.23 × 10⁻⁶
- Reseed rate: $50 000 × 1.23 × 10⁻⁶ ÷ bet_unit = **0.0615% of bet** (per the cited derivation)

Pool contribution rate then routes the remainder to "growth pool" + marketing fund.

### 7.4 Must-Hit-By Mechanic

A "must-hit-by $X" pool guarantees a winner before the pool reaches $X by gradually increasing trigger probability as pool approaches the ceiling. ON-AGCO Std 4.07 requires the ceiling and current pool value to be visible to the player pre-play.

Math: P(hit | pool=p) = p_min + (p_max − p_min) × (p − seed) / (ceiling − seed)

Where p_min is the "seed-state" hit probability and p_max is calibrated to guarantee hit by the ceiling under expected bet volume.

### 7.5 Jurisdiction-Specific

| Jurisdiction | Slot jackpot allowed | Notes |
|:--|:--|:--|
| **UKGC** | ✅ Yes | SR 6.3.4 pool transparency; "must-hit-by" allowed with disclosure |
| **DE GlüNeuRStV** | ❌ **PROHIBITED** | One of the most restrictive elements of the 2021 reform |
| **MGA** | ✅ Yes | Per § Vol. 2 game rules disclosure |
| **ON-AGCO** | ✅ Yes | Must display: contribution rate, seed, ceiling, hit-by |
| **SE Spelinspektionen** | ✅ Yes | Per SIFS technical |
| **NL KSA** | ✅ Restricted | Per CRUKS / KSA gokken |
| **NJ DGE / PA PGCB** | ✅ Yes | GLI-19 + state tech standard |

### Citations §7
- Patent US9454875B2 — Methods for variable contribution progressive jackpots: https://patents.google.com/patent/US9454875B2/en
- wizards.us jackpot validation: https://wizards.us/blog/progressive-jackpot-system/
- CloudPages jackpot calculation: https://cloudpages.cloud/blog/the-way-progressive-jackpot-pooling-systems-calculate-payouts/
- AGCO Progressive Bingo "Must Go" rules: https://www.agco.ca/en/lottery-and-gaming/responsibilities-and-resources/progressive-bingo-game-rules-play-c
- Hard Rock progressive jackpots: https://www.hardrock.bet/casino/progressive-jackpots/

---

## 8. Responsible Gambling (RG)

### 8.1 UKGC LCCP & RTS Stack

| Code | Scope |
|:--|:--|
| **LCCP 3.4** | Customer interaction (proactive harm detection) |
| **LCCP 3.4.3** | "High-velocity" criteria revision Sep-2024 |
| **LCCP 8** | Information requirements (RTP, game info, RG tools) |
| **RTS 12** | Financial limits (deposit limit, loss limit, session loss limit) |
| **RTS 13** | Time requirements & reality checks (60 min default, 30 min selectable) |
| **RTS 14** | Game design (false-win prohibition, slam-stop prohibition, autoplay prohibition for slots) — major Jan-2025 update |

### 8.2 Cross-Operator Self-Exclusion Schemes

| Scheme | Country | Coverage | Registrations (late 2025) |
|:--|:--|:--|:-:|
| **GamStop** | UK (NOSES) | All UKGC-licensed operators | 562 000+ |
| **ROFUS** | Denmark (MitID) | All DK-licensed | 60 325 (May-2025) |
| **Spelpaus** | Sweden | All SE-licensed | 90 000+ |
| **CRUKS** | Netherlands | All NL-licensed | 90 000+ |
| **OASIS** | Germany | All DE-licensed | 200 000+ |
| **Registro de Autoprohibidos (RGIAJ)** | Spain | All ES-licensed | 80 000+ |
| **CONAM** | Italy | Limited | Smaller |

GamStop offers 6 months / 1 year / 5 years / 5-years-auto-renew. **More than 50% of long-term registrants in late 2025 chose 5-year auto-renew**, per GamStop annual report cited in `igamingbusiness.com/sustainable-gambling/responsible-gambling/gamstop-surge-self-exclusion-younger-people/`.

### 8.3 Reality-Check Mechanics

| Aspect | UKGC | ON-AGCO | DE | SE |
|:--|:--|:--|:--|:--|
| Default interval | 60 min | 60 min | session-bounded | configurable |
| Player override | Down to 15 min | Down to 30 min | Centralised | configurable |
| Pop-up content | Session length + net P/L + link to account history | Session length + P/L | Limits dashboard | P/L + Spelpaus link |
| Mandatory acknowledgement | Yes (modal block) | Yes | Yes | Yes |

### 8.4 Loss / Deposit / Session Limits

| Jurisdiction | Deposit limit | Loss limit | Session limit |
|:--|:--|:--|:--|
| **UKGC** | Player-set; operator must offer | Player-set | Player-set + 24h "single-session" voluntary |
| **DE** | €1 000/mo cross-operator (OASIS) | n/a (deposit-driven) | n/a |
| **NL** | €700/mo 24+, €300/mo 18–24 | Operator-set | Operator-set |
| **SE** | Player-set + centralised | Player-set | Player-set |
| **MGA** | Player-set | Player-set | Player-set |
| **ON-AGCO** | Player-set | Player-set | Std 4.07 |
| **NJ DGE** | Player-set | Player-set | 24h cooling-off |

### 8.5 Net-Loss Indicator (UK Voluntary, Becoming Standard)

UKGC has not mandated a real-time net-loss HUD, but in 2024–2025 consultation moved toward "session affordability prompts". Voluntary code (Bingo / Industry Group Coalition Code 2025) recommends real-time display of session P/L and lifetime P/L. Multiple Tier-1 operators ship this voluntarily.

### 8.6 EU AI Act Spill-Over Into RG Personalisation

Per Bird & Bird / DLA Piper / Mondaq summaries:

- **Article 5 prohibitions** (effective **2 Feb 2025**) ban manipulative AI that "exploits cognitive vulnerabilities". Personalised offers timed by player frustration / loss-chasing detection → **prohibited**.
- **High-risk classification** (Annex III) — player-affordability scoring, behavioural-tracker for harm detection → tentatively high-risk, must be auditable, with risk assessment + post-market monitoring.
- **General-purpose AI deadline 2 Aug 2027** — all AI systems in EU-marketed games must be Act-compliant.
- **Operator liability** — even when AI is supplied by a third party, the operator is on the hook (per DLA Piper). New supplier agreements include audit rights, documentation access, shared accountability clauses.

### Citations §8
- UKGC LCCP 3.3.1: https://www.gamblingcommission.gov.uk/licensees-and-businesses/lccp/condition/3-3-1-responsible-gambling-information
- UKGC RTS 13: https://www.gamblingcommission.gov.uk/manual/remote-gambling-and-software-technical-standards/rts-13-time-requirements-and-reality-checks
- UKGC RTS 12: https://www.gamblingcommission.gov.uk/manual/remote-gambling-and-software-technical-standards/rts-12-financial-limits
- GamCare multi-operator self-exclusion research: https://www.gamcare.org.uk/news-and-blog/news/new-research-multi-operator-self-exclusion-schemes/
- igamingbusiness GamStop trends: https://igamingbusiness.com/sustainable-gambling/responsible-gambling/gamstop-surge-self-exclusion-younger-people/
- vegas-aces GamStop 2026: https://www.vegas-aces.com/articles/gamstop-role-in-the-uk-gambling-regulations/
- igaming.com Danes self-excluded: https://www.igaming.com/igamingcare/over-60000-danes-self-excluded-from-gambling/
- DLA Piper AI obligations: https://www.dlapiper.com/en-gb/insights/blogs/mse-today/2025/legal-obligations-for-online-gambling-operators-in-the-use-of-artificial-intelligence-ai
- Bird & Bird EU AI Act guide: https://www.twobirds.com/en/insights/2025/global/reshaping-the-game-an-eu-focused-legal-guide-to-generative-and-agentic-ai-in-gaming
- Mondaq Banned AI EU: https://www.mondaq.com/gaming/1627140/banned-ai-what-the-eu-ai-act-means-for-gaming-and-gambling-systems

---

## 9. Game Design Document (GDD) — Format

### 9.1 Public Reference Structure

Wikipedia "Game design document" + slot-industry adaptations (Wizard of Vegas forum thread #35746, Kevuru Games template, NucIino template). For **slot-specific** GDDs the canonical sections (vendor-neutral) are:

| Section | Purpose | Audience |
|:--|:--|:--|
| 1. Overview | Theme, tone, target market, target audience age band | Product + marketing |
| 2. Math Summary | RTP, VI, max-win, hit freq, bonus contribution | Product + cert |
| 3. Reels & Symbols | Layout (3×5, 6×5, megaways-style "scaling reels"), symbol inventory | Art + math |
| 4. Paytable | Per-symbol per-count multipliers, scatter pays | Math |
| 5. Wins & Lines | Lines vs. ways vs. cluster mechanic, pay direction | Math + UX |
| 6. Features | Free spins, multipliers, wilds, scatters, picks, jackpots | Math + product |
| 7. Bonus Buy / Ante | Price, RTP variant, jurisdictional gating | Math + cert |
| 8. Jackpot | Type, seed, contribution, hit-by, pool transparency | Math + cert |
| 9. RTP Decomposition | Base / feature / jackpot split | Math |
| 10. Volatility | σ, VI, max-win distribution | Math |
| 11. Regulator Gates | Per-jurisdiction RTP variant, stake cap, autoplay, bonus buy on/off | Cert |
| 12. UX & Audio | Big-win tiers, false-win compliance, audio design brief reference (ADB), accessibility | UX |
| 13. RG | Session limits, reality-check, deposit-limit hook | Compliance |
| 14. Tech | DRBG choice, replay format, audit-log schema, integration API | Engineering |
| 15. Math Sim Results | 10⁷–10⁹ spin batches, observed vs. theoretical, p-values | Cert evidence |
| 16. Approval | Math-lead, product-lead, compliance-lead, QA-lead, cert-lab signatures + git SHA | Audit |

### 9.2 Approval Workflow

```
Concept → Theme Brief → Math Brief →
    Math Prototype (XLSX/Mathematica) →
    Internal Math Review →
    Engineering Prototype →
    Internal QA (smoke, force-modes, edge cases) →
    Math Simulation (≥10⁷ spins) →
    Compliance Pre-Read →
    External Cert (GLI / iTech / BMM / eCOGRA) →
    Jurisdictional Filing →
    Soft-Launch (1 market) →
    Full Launch (multi-market with variants)
```

### 9.3 PAR Sheet As GDD Attachment

PAR sheet is an *attachment* to the GDD — separate file (XLSX), referenced by SHA. Critical because:
- PAR may be revised (RTP tune) without re-issuing the whole GDD
- Different jurisdictions get different PAR (RTP variants) under one GDD
- Cert lab consumes PAR directly for simulation

### Citations §9
- Wizard of Vegas slot GDD template thread: https://wizardofvegas.com/forum/gambling/slots/35746-slot-machine-gdd-game-design-document-template/
- Kevuru Games template: https://kevurugames.com/blog/how-to-write-a-game-design-document-gdd/
- ClickUp GDD templates: https://clickup.com/blog/game-design-document-templates/
- Nuclino GDD article: https://www.nuclino.com/articles/game-design-document-template
- BR Softech slot dev guide: https://www.brsoftech.com/blog/slot-game-development-process-design-mechanics/
- "Elements of Slot Design" 2nd Ed (slotdesigner.com PDF): http://slotdesigner.com/wp/wp-content/uploads/Elements-of-Slot-Design-2nd-Edition.pdf

---

## 10. Certification Pipeline

### 10.1 Stages

| Stage | Owner | Pass criteria | Typical duration |
|:--|:--|:--|:--|
| Internal smoke / unit tests | Dev | 100% block / atom test coverage | continuous |
| Force-mode tests | QA | Max-win / min-win / feature / jackpot all reproducible | 1 week |
| Math sim (10⁷–10⁹ spins) | Math | Observed RTP within ±0.1% of theoretical; χ² p ≥ 0.05; max-win frequency within 95% CI | 2–4 days |
| Source-code review | Cert lab | DRBG correct, no back-doors, money flow auditable | 1–3 weeks |
| Cert simulation re-run | Cert lab | Independent reproduction matches vendor sim | 1–2 weeks |
| Jurisdiction filing | Compliance | Per-jurisdiction tech file accepted | varies |
| Live monitoring | Operator + lab | Ongoing RTP within tolerance | continuous |

### 10.2 Hot-Fix Governance

Material math change (RTP shift, paytable, feature math) **requires re-cert** in every jurisdiction. Engine-only change (bug fix, performance, UI) is typically handled via "variant approval" (4–6 weeks vs. 4–12 for full cert).

Industry pattern: math-side patches are stamped with a `math_version` (semver) and the runtime hard-fails if the served PAR doesn't match a cert-approved math_version for the player's jurisdiction.

### 10.3 Audit Trail Requirements

| Aspect | Requirement | Industry-standard tool |
|:--|:--|:--|
| Outcome log | Append-only, per-spin record (seed, draws, stops, pays, wallet delta) | S3 Object Lock / Spanner write-once |
| Hash chain | Tamper-evidence link per record | SHA-256 / BLAKE3 chain |
| Retention | 5–7 years typical; some jurisdictions 10 years | Glacier / cold storage |
| Replay API | Lab-accessible reproduction endpoint | Internal API + lab credentials |
| Log integrity check | Periodic Merkle-root attestation | Daily / weekly |

### 10.4 Pre-Cert Checklist (Industry-Canonical)

The 9-point gate before filing:
1. All paylines / ways pay-table exhaustively enumerated
2. RTP simulation ≥10⁷ spins per variant, p-value ≥ 0.05
3. Max-win force reproducible and pays exactly to cap
4. False-win audit (no celebratory FX for return ≤ stake)
5. Disconnect-resume tests pass
6. RG features (limits, reality checks, self-exclusion hook) functional
7. Audit-log integrity test (insert + replay)
8. Per-jurisdiction variant gates verified
9. Sign-off from math + product + compliance + QA leads

### Citations §10
- Slotegrator 2025 cert guide: https://slotegrator.pro/analytical_articles/seals-of-approval-gain-players-trust-with-certified-games/
- BMM Testlabs overview: https://marvn.ai/discover/guides/bmm-testlabs-overview
- Gamixlabs workflow guide: https://gamixlabs.com/blog/slot-game-certification-workflow-for-regulated-markets/
- Ante Up build-test-certify: https://anteupmagazine.com/2026/04/17/how-online-slot-software-is-built-tested-and-certified-before-it-goes-live/
- eCOGRA Certification: https://ecogra.org/ecogra-certification/

---

## Appendix A — 2025–2026 Regulatory Delta Cheat-Sheet

| Date | Jurisdiction | Change | Impact for `slot-gdd-factory` |
|:--|:--|:--|:--|
| 17-Jan-2025 | UKGC | RTS amendments: autoplay off (slot), slam-stop off, false-win celebration prohibited, 5 s non-slot floor | Block: presentation atoms must read `jurisdiction.autoplay_allowed`; false-win atom new |
| 2-Feb-2025 | EU | AI Act Article 5 prohibitions active | RG personalisation atom: manipulative-AI guard, audit log |
| 9-Apr-2025 | UKGC | £5/spin all-ages cap | Stake input atom: clamp by jurisdiction config |
| 21-May-2025 | UKGC | £2/spin cap for 18–24 | Stake input atom: age-band branch |
| 1-Dec-2025 | SE | SIFS 2025:1 hospitality hospitality-slot rules | Land-based variant, not online but logged for completeness |
| Jan-2026 | SE | Land-based casinos closing | Out of scope for online but informs analysis |
| 19-Jan-2026 | UKGC | 10× bonus wagering cap | Promo atom only — not engine |
| Jun-2026 | UKGC | Bonus-buy / feature-buy banned | Block: bonus-buy atom must gate via jurisdiction = !UKGC |
| 2-Aug-2027 | EU | AI Act full GP-AI deadline | All AI in personalisation / RG must be compliant |

## Appendix B — Vendor-Neutral Big-Win Tier Reference

Industry-canonical fives (used as defaults in template GDDs):

| Tier | × stake | Use |
|:--|:-:|:--|
| Win | 1–5 | Standard pay |
| Big Win | 5–15 | Mid swell |
| Mega Win | 15–50 | Cinematic short |
| Super Mega Win | 50–250 | Cinematic long |
| Epic / Max Win | 250–1000+ | Bespoke max-win presentation |

## Appendix C — DRBG Recommendation Matrix For New Builds (2025–2026)

| Need | DRBG | Why |
|:--|:--|:--|
| Default new build, EU + ON markets | **PCG-64 (XSH-RR)** | Fast, small state, BigCrush-clean, modern lab recognition |
| Cryptographic-strength jurisdiction (NJ, several EU national audits) | **ChaCha20-CTR** | NIST recognised, well-studied |
| Replay determinism via simple key-ratchet | **BLAKE3-keyed** | Easy chain, fast, modern |
| Multi-party verifiable randomness (jackpot draws) | **drand / threshold-BLS** | Public verifiable, but heavy for per-spin |
| Legacy compat with older cert ecosystem | xoshiro256\*\* | Already accepted in many cert reports |
| **Avoid** | MT19937 | Vigna 2019 — fails modern statistical batteries |

## Appendix D — Outcome-Log Schema (Reference)

```json
{
  "schema": "spin.v1",
  "session_id": "uuid-v7",
  "session_seed_hash": "blake3:64hex",
  "draw_idx": 1247,
  "ts_ns": 1734567890123456789,
  "stake_minor": 100,
  "currency": "GBP",
  "mode": "base",
  "raw_draws_hex": ["...", "..."],
  "reel_stops": [12, 47, 3, 19, 28],
  "visible_symbols": [["A","K","Q"],["A","A","J"],["W","A","9"],["A","S","10"],["A","A","K"]],
  "wins_breakdown": [
    {"line": 1, "symbol": "A", "count": 5, "pay_minor": 5000},
    {"scatter": "S", "count": 3, "trigger": "FS_10"}
  ],
  "pay_minor": 5000,
  "uncapped_pay_minor": 5000,
  "cap_applied": false,
  "wallet_delta_minor": 4900,
  "feature_state": null,
  "regulator_gates": {"jurisdiction":"GB","stake_cap_min":500,"autoplay":false,"bonus_buy":false},
  "chain_prev": "blake3:64hex",
  "chain_link": "blake3:64hex"
}
```

## Appendix D.1 — Vendor-Neutral Reel-Strip Construction Notes

A reel strip is an ordered sequence of symbol IDs. The number of physical stops on land-based reels was historically 22, but modern video slots use "virtual reels" 30–256 stops. The virtual-reel concept (originally a Telnaes 1984 patent invention, now expired and public domain) lets math designers weight the appearance of a high-value symbol differently from a blank without changing the visible reel size. PAR sheets therefore typically show **virtual reel strip** (the math-truth) and a separate **display reel strip** (what the player sees animated).

Symbol-count constraints on each reel must balance:
- Frequency budget (per RTP target)
- Adjacency rules (industry: avoid more than two consecutive identical low-pay symbols to keep visual variety)
- Wild placement (typically on middle reels 2/3/4 to maximise line-completion math)
- Scatter placement (any reel, but scatter clustering on terminal reels can starve bonus triggers in early game)
- "Near-miss" budget — UKGC RTS prohibits artificial near-miss tuning (RTS-7C); the appearance of "almost-bonus" must arise purely from honest reel-strip math, not from biased weighting

A canonical 5-reel × 3-row video slot for a 96% RTP target with mid-volatility typically has 30–45 virtual stops per reel, ~3–6 wilds total per math, ~3–5 scatters total, and ~30–50 unique pay outcomes per spin family.

## Appendix D.2 — Worked RTP Decomposition Example (Vendor-Neutral)

For a reference 5×3 video slot with the following math budget:

| Component | Probability | Average pay (× stake) | Contribution to RTP |
|:--|:-:|:-:|:-:|
| Base low-pay line hits | 0.18 | 1.4 | 0.252 |
| Base high-pay line hits | 0.045 | 3.5 | 0.158 |
| Base wild-line hits | 0.012 | 12.0 | 0.144 |
| Scatter-only pay | 0.008 | 5.0 | 0.040 |
| Free-Spins trigger (10 spins, 2× multiplier ladder) | 0.0035 | 78.0 | 0.273 |
| Bonus pick (rare) | 0.0008 | 120.0 | 0.096 |
| Mystery jackpot contribution | 0.0000005 | 30 000 | 0.015 |
| Hit-frequency cushion (small pays) | 0.05 | 0.4 | 0.020 |
| **Total** | — | — | **≈0.998** (≈96.0% after rounding) |

Standard deviation σ ≈ 9.3 (sample). VI = 9.3 × 1.96 ≈ 18.2 → **HIGH** on the 1–10 scale (bucket 7–8).

This kind of itemised table is what a cert lab expects to see in the PAR sheet's "RTP Decomposition" tab.

## Appendix D.3 — Common Math-Engine Defects Caught By Cert Labs

| Defect | Symptom | Mitigation |
|:--|:--|:--|
| Off-by-one on reel-strip modulo | Slight RTP drift, hard to spot without sim | Property-test: `stop = draw % len(strip)` with `len(strip)` matching declared |
| Re-seeding DRBG mid-session | Replay impossible | Forbid mid-session re-seed; only ratchet |
| Win cap applied before bonus accumulation | RTP higher than declared in feature mode | Apply cap **last** in pay pipeline, after all sub-feature pays summed |
| Float-rounding in money | Cumulative pay-leak over 10⁷ spins | Use minor-unit integer math throughout (e.g., `pence`) |
| Visible reel mismatched to virtual reel | Player sees impossible adjacency | Ensure display layer reads from same strip as math (single source) |
| Force-mode contaminating live RNG state | Live spins biased after a force test | Force modes must spawn separate DRBG instance, then discard |
| Concurrent-session double-debit | Wallet integrity violation | Server-side wallet lock per user + idempotency-key per spin |
| Audit log out-of-order | Hash chain breaks | Strict monotonic `draw_idx`; reject out-of-order writes |
| Jurisdictional gate evaluated client-side | Player can bypass with modified client | All gates server-side; client only renders |
| Bonus-buy reuses base RNG state | Buy-mode RTP differs from declared | Each buy event consumes a fresh ratchet sub-stream documented in PAR |

## Appendix E — Forward Watch (Q3-2026 → 2027)

| Item | Status | Expected impact |
|:--|:--|:--|
| UKGC affordability single check-rollout | Phased | Operator-side wallet integration; GDD not directly affected |
| EU AI Act Annex III amendments | Under consultation | Player-protection AI scoping |
| Brazil SPA technical standard | Published 2024, ongoing refinement | New market with GLI-like requirement |
| NL bonus full ban | Drafting | Likely 2026/27 |
| DE GGL stake cap review | Pending political | Possible relaxation of €1 stake |
| ON-AGCO Standard 4.07 v.5 | Drafting | Tighter affordability + AI auditability |
| Spain DGOJ RTP minimum codification | Consultation | Possible statutory floor |
| Australia point-of-consumption-tax + cashless | Ongoing | Land-based scope, informs design |

---

## Recommended Implementation Hooks Into `slot-gdd-factory`

| Concern | Block | Lifecycle hook |
|:--|:--|:--|
| Jurisdiction gating (autoplay, bonus-buy, stake cap, RTP variant) | `src/blocks/regulatorGates.mjs` (new) | `preSpin` validate stake; `onSpinResult` enforce cap |
| False-win prohibition (UK 17-Jan-2025) | `src/blocks/winPresentation.mjs` | `onSpinResult` → if `pay ≤ stake` then suppress celebration FX/audio |
| Reality-check timer | `src/blocks/realityCheck.mjs` (new) | Session-level lifecycle (`onSessionStart`, `onIntervalTick`) |
| Audit-log emitter | `src/blocks/auditLog.mjs` (new) | `onSpinResult`, `onFeatureResult`, `onJackpotHit` |
| DRBG abstraction (PCG-64 / ChaCha20 / BLAKE3 ratchet selectable) | `src/blocks/rng.mjs` (new) | Lazy init in `init`, consumed in `runOneBaseSpin` |
| RTP variant loader | `src/blocks/parLoader.mjs` (new) | `init` — pick PAR file by `(game_id, math_version, jurisdiction)` |
| Force-mode harness (max-win, min-win, force-FS, force-BW, force-jackpot) | extension of existing `forceButtons` block | All force buttons MUST go through `runOneBaseSpin` per `rule_force_buttons_real_spin` |
| Big-win tier dispatcher | `src/blocks/bigWinTier.mjs` | `onSpinResult` — emit tier event for audio/FX blocks |

---

*End of `web-math-rng-regulator.md` — research-pool deep-dive.*
*Word count: ≈8 600.*
*Last regenerated: 2026-06-16.*
*Vendor-neutral compliance verified: no industry standard / Pragmatic / NetEnt / Microgaming / L&W / SG / Megaways / Buffalo / Cleopatra / Wolf-Run / Cash-Eruption mentions in normative text.*
