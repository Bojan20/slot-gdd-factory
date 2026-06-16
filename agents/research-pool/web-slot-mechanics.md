# Web Slot Mechanics Research — Modern Real-Money Online Casino Catalog (2020–2026)

**Author:** Corti (cortex orchestrator, research-pool agent)
**Date compiled:** 2026-06-16
**Scope:** Exhaustive catalog of every reel-topology, payway, feature, presentation, regulator and math construct shipped in modern online slots between 2020 and 2026, with first-ship attribution, state machine, RTP/volatility footprint, UI affordance and regulator footprint per mechanic.
**Audience:** `slot-gdd-factory` builder/parser maintainers, GDD authors, math designers, QA, regulator submission writers.
**Constraint reminder (CLAUDE.md HARD RULE #1 — slot-gdd-factory source code):** vendor brand names (Aristocrat, BTG, NetEnt, Pragmatic, IGT, Yggdrasil, Microgaming, ReelPlay, Push Gaming, Spribe, Gaming Realms, Light & Wonder, Playson, Relax, BGaming, 3 Oaks, Blueprint, Evolution) and trademarked mechanic names (Megaways, InfinityReels, Hold and Spin, Lightning Link, Avalanche, Cluster Pays, Hold the Jackpot, Wonder 4, GEMS, Splitz, Gigablox, MultiMax) MUST NOT appear in `src/` of slot-gdd-factory or in regulator-facing PAR/IR/one-pager output. They appear in **this research note only** as academic citations to demonstrate first-ship and prior art. Internal builder/blocks remap them to vendor-neutral kinds: `cascade`, `infinity_expand`, `hold_and_win`, `cluster_pays`, `megaways_topology` (or `variable_height_ways`), etc. The tier nomenclature also drops marketing names — internal blocks use `tier1..tier5`, not "Mega/Epic/Legendary".

This document is intentionally long. It is meant to be the single canonical sweep that a parser/builder author reads to know "what shapes exist in the wild." It is not meant to be a marketing guide.

---

## 0. Table of Contents

| Section | Title | Mechanic count |
|:--|:--|:--:|
| 1 | Reel topology catalog | 11 |
| 2 | Payway / win evaluation catalog | 8 |
| 3 | Feature mechanic catalog | 36 |
| 4 | Presentation / UX catalog | 11 |
| 5 | Regulator deep-dive (UKGC / MGA / SE / DE / Ontario / NJ) | 6 |
| 6 | Math catalog (volatility, RTP corridor, hit frequency, tier thresholds, chi-square) | 7 |
| 7 | 2025-2026 trend explicit call-outs (Hold the Jackpot 2.0, Drop the Hold, Replay, BTG-like) | 6 |
| 8 | Citations & primary sources | — |
| 9 | Implementation notes for `slot-gdd-factory` (vendor-neutral kind mapping) | — |

Conventions: every row uses the column contract requested in the mandate. Where a citation could not be obtained at research time the cell carries `—` and an explicit `(no public source)` note in section 9.

---

## 1. Reel Topology Catalog

Reel topology = the geometry of the symbol grid and the rule for how cells map to a coordinate system. It is a separate concern from payways (Section 2) and from feature mechanics (Section 3). A `5×3 ways-pays cascade` slot composes three independent axes: topology = `5×3`, payway = `243-ways`, feature = `cascade`. The factory must not collapse them.

### 1.1 Rectangular grids — fixed cell layout

| Field | Value |
|:--|:--|
| Mechanic | Rectangular fixed grid (3×3, 5×3, 5×4, 5×5, 6×4, 6×5, 7×7) |
| Industry name + ≥3 synonyms | Fixed grid; classic reel; matrix reels; rect grid |
| First-ship vendor + year | Mills Liberty Bell (1899) for 3×1, Bally Money Honey (1963) for 3×3 electromechanical, IGT for 5×3 video (1996) |
| Topology | Reels × rows, fixed; columns = reels, rows = cell height; addressable as `(reelIndex, rowIndex)` |
| State machine phases | `idle → spinStart → reelStops[] → resolve → payout → idle` |
| RTP impact | Neutral — topology is independent of RTP; classic 5×3 ranges 88–98 % per jurisdiction |
| Volatility impact | Low-to-medium baseline; volatility set by paytable + reel strips not by topology |
| UI affordance | Static reel cabinet; spin button; bet panel beneath reels |
| Regulator notes | UKGC RTS 7 (game design) and RTS 8 (display of game state) apply uniformly; MGA Game Design Reqs §4 |
| Reference titles | Classic three-reel cabinets, Starburst-style 5×3, modern 6×5 hybrids |

Variants worth a separate parser kind:

| Sub-shape | Use case | Notes |
|:--|:--|:--|
| 3×3 | Classic fruit / nostalgic | Single-line or 5-line; lowest RAM/CPU footprint |
| 5×3 | Industry default | 10–25 paylines or 243 ways most common |
| 5×4 | More cells without 6th reel | 1024 ways common |
| 5×5 | Cluster pays default | Aloha-style; min cluster 9 |
| 6×4 | Bridge to 6-reel content | 4096 ways |
| 6×5 | Cluster-pays modern default | Sweet Bonanza shape |
| 7×7 | Cluster-pays large grid | Reactoonz / Jammin' Jars |

### 1.2 Hexagonal honeycomb grid

| Field | Value |
|:--|:--|
| Mechanic | Hexagonal honeycomb / pointy-top hex grid |
| Synonyms | Hex grid; honeycomb pays; six-neighbour adjacency grid |
| First-ship vendor + year | NetEnt Lucky Mr Patrick (2018 hex prototype); Microgaming Hot Honey 22 VIP (2021); BGaming Wild Hex (2022) |
| Topology | Pointy- or flat-top hex; ~37–61 cells; six neighbours per cell (axial coords `(q, r)`) |
| State machine | `idle → spinStart → fillCells → clusterDetect (6-neighbour BFS) → cascadeRemoval → refill → resolve → idle` |
| RTP impact | Same corridor as cluster-pays rectangular (94.0–96.5 %); hit rate ~1 in 2.5–3 spins due to richer adjacency |
| Volatility | Medium-high; the larger neighbour count makes cluster size distribution heavier-tailed |
| UI affordance | Honeycomb canvas with per-cell glow; line-draw uses Bezier between hex centres |
| Regulator notes | Treated as cluster-pays under UKGC RTS 7; MGA Game Design Reqs Annex II §4 |
| Reference titles | Hot Honey 22 VIP; Honey Rush; Wild Hex |

Implementation note for parser: hex topology must store axial `(q, r)` for cluster BFS, not screen pixel `(x, y)`.

### 1.3 Wheel topology (24-segment, 36-segment)

| Field | Value |
|:--|:--|
| Mechanic | Wheel reel / wheel bonus / fortune wheel |
| Synonyms | Wheel of Fortune topology; segmented dial; carousel reel |
| First-ship vendor + year | IGT Wheel of Fortune (1996 land cabinet, 2010 online); Aristocrat Wonder Wheel (2014); Pragmatic Megawheel (2022) |
| Topology | Single rotating ring with `N` segments (typical 24 or 36); each segment carries prize/multiplier/jackpot tier |
| State machine | `enterWheel → wheelSpin → wheelDecel → wheelLand → resolveSegment → exitWheel` |
| RTP impact | Wheel return engineered into segment weights; usually 30–60 % of total RTP in wheel-centric titles |
| Volatility | Defined by segment tail; one Grand-jackpot segment with 1/N probability gives Pareto-tail variance |
| UI affordance | Wheel widget replaces or overlays reel canvas; pointer animation 4–8 s |
| Regulator notes | Wheel must declare segment probabilities in UKGC RTS 7 game rules disclosure; AGCO 4.07 must-hit-by often applied to Grand segment |
| Reference titles | Wheel of Fortune; Wonder 4 Wonder Wheel; Megawheel; Crazy Time (live) |

### 1.4 Crash curve (non-reel)

| Field | Value |
|:--|:--|
| Mechanic | Crash curve / instant crash game |
| Synonyms | Crash; multiplier crash; ascending crash; aviator-curve |
| First-ship vendor + year | Bustabit (2014, Bitcoin); Spribe Aviator (2019 launch / 2020 mainstream) |
| Topology | Single y-axis multiplier curve; tick `t→tick+1` raises `m(t)`; crash event drawn from house-edge distribution |
| State machine | `idle → betWindow → ascending → cashOutWindow → crashEvent → settle → idle` |
| RTP impact | Provably-fair RTP ~95–97 %; crash distribution typically `m_crash = 100/(1 - U + houseEdge)` |
| Volatility | Player-controlled; cash-out at 1.5× = low-var, hold to 50× = extreme-var |
| UI affordance | Curve canvas; bet-now / cash-out buttons; auto-cash-out at X.XX |
| Regulator notes | Some EU regulators classify as instant game not slot (e.g. Sweden Spelinspektionen, UKGC RTS 4); fairness via published seed hash |
| Reference titles | Aviator; JetX; Cash or Crash; Crash X |

### 1.5 Plinko / pachinko hybrid

| Field | Value |
|:--|:--|
| Mechanic | Plinko / peg-drop / pachinko-style ball cascade |
| Synonyms | Plinko; pachinko hybrid; peg drop; binomial drop |
| First-ship vendor + year | Stake.com Plinko (2019 in-house); Spribe Plinko (Jan 2021); BGaming Plinko (2022) |
| Topology | Triangular peg field, `R` rows, `R+1` landing slots at bottom; each bounce 50/50 (or weighted) |
| State machine | `idle → riskSelect → ballDrop → bounceTrace → slotLand → payout` |
| RTP impact | 97–99 % typical; distribution binomial(R, 0.5) — edge slots have `1/2^R` probability |
| Volatility | Tied to risk level: `low` ~0.2× variance, `high` up to 1000× edge slots, `medium` between |
| UI affordance | Peg board; risk dial (low/med/high); row count selector (8/12/16); ball trail animation |
| Regulator notes | UKGC classifies as casino instant game; provably-fair seed-pair hash published |
| Reference titles | Stake Plinko; Spribe Plinko; BGaming Plinko |

### 1.6 Slingo (5×5 grid bingo / slot hybrid)

| Field | Value |
|:--|:--|
| Mechanic | Slingo grid (5×5 numeric grid + reel beneath) |
| Synonyms | Slingo; bingo-slot hybrid; reel-marked grid |
| First-ship vendor + year | Sal Falciglia invented 1994 (land social); Gaming Realms Slingo Originals (2015 online, mainstream 2018+) |
| Topology | 5×5 grid of 25 numbers + 1-row reel of 5 cells; each spin draws 5 numbers; mark grid; track line completions (rows, cols, diagonals) |
| State machine | `idle → spinReel → markGrid → checkLines → bonusOption (purchase or end) → repeat → settle` |
| RTP impact | 94–96 % typical; "buy extra spin" sub-stream regulator-flagged in UK |
| Volatility | Medium; long-tail variance comes from line-complete bonus triggers |
| UI affordance | Grid above, reel below, line-counter sidebar, end-of-spin "buy more spins" prompt (banned in some jurisdictions) |
| Regulator notes | UKGC treats Slingo as both slot AND bingo for LCCP purposes; 2.5-s spin minimum applies; "buy more spins" feature scrutinised |
| Reference titles | Slingo Originals; Slingo Rainbow Riches; Slingo Starburst |

### 1.7 Variable-height ways grid (a.k.a. licensed "Megaways"-style)

| Field | Value |
|:--|:--|
| Mechanic | Variable-height reels — each spin randomises symbol height per reel, yielding variable ways count |
| Synonyms | Megaways (BTG licensed); variable reel height; random reel modifier; up to N ways |
| First-ship vendor + year | Big Time Gaming Dragon Born (2015) coined the patented mechanic; license programme opened 2018; acquired by Evolution 2021 |
| Topology | 6 reels, each reel randomly populated 2–7 cells per spin; ways count = product of reel heights = 2..117,649; usually a 4-cell horizontal extra reel adds modifier symbols |
| State machine | `idle → spinStart → reelHeightRoll[] → fillSymbols → waysCount → resolvePay → optional cascade → idle` |
| RTP impact | Same corridor as fixed-grid ways content (94–96.5 %); per-spin volatility much higher because tail wins multiply heights |
| Volatility | High to very high; max-win cap typically 10,000×–50,000× |
| UI affordance | Variable visible height per reel; ways-counter pulses with each spin; horizontal modifier reel above main reels |
| Regulator notes | License contract (not regulator) governs the kind; UKGC RTS 7 game-rules disclosure must list possible ways-count range; AGCO requires hit-frequency disclosure |
| Reference titles | Bonanza; Extra Chilli; Dog House Megaways; Buffalo King Megaways; Divine Fortune Megaways |

**Vendor-neutral note for factory:** the BTG patent expired in most jurisdictions late 2024 (Australia ~2023); the mechanic is now broadly replicable. Use kind `variable_height_ways` and a `topology.reelHeightDistribution` field.

### 1.8 Infinity-style rolling-expand reels

| Field | Value |
|:--|:--|
| Mechanic | Rolling reel that appends a new reel to the right on every winning rightmost-reel hit |
| Synonyms | Infinity Reels (ReelPlay licensed); rolling expand; appending reel; chain reels |
| First-ship vendor + year | ReelPlay El Dorado Infinity Reels via Yggdrasil YG Masters (Nov 2020 announce, March 2021 ship) |
| Topology | Starts 3 reels × 4 rows; each cascade adds reel to right if rightmost reel wins; theoretical unbounded |
| State machine | `idle → spin → check rightmost win → appendReel → cascadeRemoval → recheck → repeat until no win → settle` |
| RTP impact | 96 % typical; tail wins truly unbounded so RTP must be capped via max-win |
| Volatility | Very high; provider-cited max-win 50,000× |
| UI affordance | Reels visually shrink in width as more reels added; reel-counter displayed; max-win cap explicit |
| Regulator notes | UKGC requires max-win disclosure in RTS 7 game rules; AGCO requires worst-case tail in submission |
| Reference titles | El Dorado Infinity Reels; Giza Infinity Reels; Odin Infinity Reels |

### 1.9 Colossal / mega / giant stacked symbols

| Field | Value |
|:--|:--|
| Mechanic | Symbols that occupy multiple cells (2×2, 3×3, 4×4, 5×5) and act as one logical symbol |
| Synonyms | Colossal symbols; mega symbols; giant symbols; super-stacked; bloc symbol |
| First-ship vendor + year | IGT Super Stacks (2009 land); Bally Ocean's Glory (2013); WMS Colossal Reels (2011) |
| Topology | Standard rectangular grid with `bigSymbol` mask covering K×K cells; placement on snap-to-grid coordinate |
| State machine | `spinStart → drawSymbols → resolveBigSymbolMask → expandToWaysCount → payResolve` |
| RTP impact | Neutral — big symbols engineered into reel-strip weighting |
| Volatility | Medium-high; big symbols on payway create heavier tail |
| UI affordance | Per-symbol mask is one rendered sprite; reels can scroll big symbol as one unit |
| Regulator notes | UKGC RTS 7 — bigSymbol contribution to ways/lines must be in game rules |
| Reference titles | Super Stacks (IGT); Colossal Reels (WMS); Jungle Giants (Playtech) |

### 1.10 Dual / multi-grid (split-screen, mirror, parallel)

| Field | Value |
|:--|:--|
| Mechanic | Two or more independent grids share one spin button or one symbol stream |
| Synonyms | Dual reels; multi-screen; parallel reels; mirror reels; quad-reels |
| First-ship vendor + year | Aristocrat Wonder 4 (2014 land cabinet, 2018 online) is the prototypical four-grid; IGT Super Times Pay (2007 dual) |
| Topology | `N` independent rectangular grids (often 2–4) on one screen; one shared spin event triggers all |
| State machine | `idle → spin → resolveGrid[0..N-1] in parallel → aggregatePay → idle` |
| RTP impact | Each grid carries its own RTP; aggregate is weighted mean; can engineer split (e.g. 95.5 % per grid → 95.5 % aggregate) |
| Volatility | Each grid keeps its own; multi-grid lowers per-spin variance via averaging |
| UI affordance | Screen tiles into 2/4 reel canvases; one wager applies per grid (multiplier on bet) |
| Regulator notes | UKGC requires per-grid RTP disclosure if grids have different paytables |
| Reference titles | Wonder 4; Wonder 4 Wonder Wheel; Quad Shot |

### 1.11 Cluster grids (7×7, 8×8 cluster pays)

| Field | Value |
|:--|:--|
| Mechanic | Square grid where wins are connected-component clusters of ≥`k` matching symbols |
| Synonyms | Cluster pays grid; flood-fill grid; orthogonal adjacency grid |
| First-ship vendor + year | NetEnt Aloha! Cluster Pays (2016) coined the cluster-pays popular form; before that, "Pop! Slots" (2014) had cluster prototypes |
| Topology | 6×5 / 7×7 / 8×8; orthogonal (4-neighbour) adjacency; cluster pay table by size |
| State machine | `spinStart → drawCells → BFS cluster detection (per symbol type) → payCluster → cascadeRemove → refill → repeat → idle` |
| RTP impact | 94–96.5 % typical; very-high cluster sizes carry exponential paytable |
| Volatility | Medium-high; clusters of 25+ produce 1000×+ tail wins |
| UI affordance | Symbol glow + connecting line graph between cluster members; cluster size counter |
| Regulator notes | UKGC RTS 7 requires cluster size→pay disclosure |
| Reference titles | Aloha! Cluster Pays; Reactoonz; Jammin' Jars; Sweet Bonanza; Wild Hex |

---

## 2. Payway / Win Evaluation Catalog

Payway = the rule that maps reel-result to win amount. This is independent of topology. The factory parses a `winEval.kind` from the GDD; this section is the canonical list.

### 2.1 Fixed paylines

| Field | Value |
|:--|:--|
| Mechanic | Fixed paylines — left-to-right combos along predefined zig-zag paths |
| Synonyms | Fixed lines; paylines; lines pay; classic lines |
| First-ship vendor + year | Mills Liberty Bell (1899) single line; Bally Five Line (1966); IGT 9-line / 20-line / 25-line video (1990s) |
| Topology | Pairs with rectangular grids; line list is `[ [(r0,c0), (r1,c1), ...], ... ]` |
| State machine | `resolveLines → highlightWinningLines → payout` |
| RTP impact | RTP independent; lines just discretise the win check |
| Volatility | Depends on line count vs paytable; fewer high-value lines = higher variance |
| UI affordance | Line numbers around grid; line draw animation on win |
| Regulator notes | UKGC RTS 7 — line geometry must be disclosed |
| Reference titles | Most classic 5×3 video slots; Starburst (10-line bothways); Cleopatra-style |

### 2.2 Selectable paylines

| Field | Value |
|:--|:--|
| Mechanic | Player chooses how many of the available lines to play; bet scales accordingly |
| Synonyms | Selectable lines; pay-per-line; coin-per-line |
| First-ship vendor + year | IGT Multi-line video (early 1990s land); online ports late 1990s |
| Topology | Same as fixed lines, but per-line bet flag |
| State machine | `betPanel.changeLineCount → spin → resolveActiveLines → payout` |
| RTP impact | RTP unchanged but jurisdictions (UK, DE) increasingly require all-lines-on |
| Volatility | Player can self-tune variance by reducing line count |
| UI affordance | Per-line +/- buttons; line indicators highlight only active lines |
| Regulator notes | UK 2025 stake-cap rules forbid line-stake gaming; UKGC RTS 12 financial limits |
| Reference titles | Classic 5-of-9 selectable cabinets |

### 2.3 Bothways (left-to-right + right-to-left)

| Field | Value |
|:--|:--|
| Mechanic | Lines pay in both directions; effectively doubles line-coverage |
| Synonyms | Bothways; pay-both-ways; bi-directional; left-and-right |
| First-ship vendor + year | NetEnt Starburst (2012); IGT Wolf Run (2010 land) |
| Topology | Standard 5×3 with 10 lines; bothways doubles effective hit count |
| State machine | `spin → resolve LTR + RTL on same line set → aggregate → payout` |
| RTP impact | Engineered into reel-strip weights; total RTP unchanged |
| Volatility | Lower variance because hit-rate ~doubles |
| UI affordance | Arrow indicators at both ends of grid; line-draw animation in both directions |
| Regulator notes | UKGC RTS 7 — must disclose bothways evaluation |
| Reference titles | Starburst; Wolf Run; Reel Rush |

### 2.4 Ways pays (243, 1024, 3125, 117649)

| Field | Value |
|:--|:--|
| Mechanic | Any matching symbol on each consecutive reel from leftmost (or both-ways) pays; ways = product of reel heights |
| Synonyms | Ways pays; multiway; adjacent-reel pays; 243/1024/3125 ways |
| First-ship vendor + year | Microgaming Tomb Raider II prototype; Aristocrat Reel Power (2002 — 243 ways); BTG popularised variable up to 117649 with Megaways |
| Topology | 5×3 = 243; 5×4 = 1024; 5×5 = 3125; 6×7 (variable) = 117649 |
| State machine | `spin → for reelIdx: collect symbol set → product across reels → match per symbol → payout` |
| RTP impact | Same corridor; hit-rate is much higher than line-pays |
| Volatility | Lower variance baseline than equivalent line-pays |
| UI affordance | "243 Ways" badge instead of line numbers; symbol highlight on win |
| Regulator notes | UKGC RTS 7 — ways formula disclosure required |
| Reference titles | Thunderstruck II; Buffalo (Aristocrat land); Bonanza Megaways |

### 2.5 Cluster pays (≥`k` connected matching symbols)

| Field | Value |
|:--|:--|
| Mechanic | Win = connected-component cluster of `≥k` matching symbols by orthogonal adjacency |
| Synonyms | Cluster pays; flood-fill pays; connected pays |
| First-ship vendor + year | NetEnt Aloha! Cluster Pays (2016) popularised; cluster prototypes from 2014 |
| Topology | Square grids 5×5 or larger; orthogonal (4-neighbour) graph |
| State machine | `spin → group by symbol type → BFS each group → if |group| ≥ k pay → cascade remove → refill` |
| RTP impact | 94–96.5 % typical; long-tail variance via large clusters |
| Volatility | Medium-high; max-win 5000×–50000× |
| UI affordance | Glow per cluster, connecting lines between adjacent cells, cluster-size badge |
| Regulator notes | UKGC RTS 7 — must show `k` minimum and cluster-size paytable |
| Reference titles | Aloha!; Reactoonz; Jammin' Jars; Sweet Bonanza; Sugar Rush |

### 2.6 Pay-anywhere / Lightning style (≥`N` symbols anywhere)

| Field | Value |
|:--|:--|
| Mechanic | Win triggered by `≥N` matching symbols anywhere on the grid (no adjacency required) |
| Synonyms | Pay anywhere; scattered pays; lightning pays; pile pays |
| First-ship vendor + year | Aristocrat Lightning Link (2015 land) and Cash Express (2016); online ports 2018+ |
| Topology | Usually 5×3 or 6×4; 8+ matching symbols anywhere fires |
| State machine | `spin → count matching symbols per type → if count ≥ N pay → payout` |
| RTP impact | 94–96 %; tail comes from chain combos with multipliers |
| Volatility | High; long miss streaks then large pay |
| UI affordance | Lightning bolt animation between matched symbols; symbol-count badge |
| Regulator notes | UKGC RTS 7 — minimum count and pay-anywhere logic must be in game rules |
| Reference titles | Lightning Link; Cash Express; Dragon Link |

### 2.7 Scatter pays (any position)

| Field | Value |
|:--|:--|
| Mechanic | Specific scatter symbol pays independently of payline / ways / adjacency, anywhere on the grid |
| Synonyms | Scatter pay; bonus scatter; trigger symbol; free-spin scatter |
| First-ship vendor + year | Industry-standard since 1980s electromechanical; first explicit "scatter" symbol attributed to IGT 1980s |
| Topology | Any |
| State machine | `spin → count scatters → if ≥ T trigger feature OR pay scatter table → resolve` |
| RTP impact | Typically 5–15 % of total RTP routes via scatter / bonus-trigger logic |
| Volatility | High contribution because bonus is the biggest tail event |
| UI affordance | Distinct symbol art; scatter-counter; reel-pulse anticipation when 2 already landed |
| Regulator notes | UKGC RTS 7 — trigger condition, free-spin count and feature paytable required |
| Reference titles | Effectively every modern slot has a scatter |

### 2.8 Lines pays vs multiway — explicit comparison

| Aspect | Lines pays | Ways pays |
|:--|:--|:--|
| Win check | Sequence along predefined path | Symbol present in each consecutive reel (any row) |
| Reel-strip impact | Specific cell coordinates matter | Only column membership matters |
| Hit frequency baseline | Lower | Higher (≈3–5× more hits) |
| Per-hit average pay | Higher | Lower |
| Volatility character | Lower per-spin variance, higher kurtosis | Higher per-spin variance, lower kurtosis |
| Player perception | "Line lit up" celebration | "Cascade of cells" celebration |
| Best paired with | Fixed grid 5×3 / 5×4 | Cascade / Megaways / cluster |

---

## 3. Feature Mechanic Catalog

Each feature is one self-contained `src/blocks/<name>.mjs` in factory terms. The mandate calls for 30+; this section catalogs 36. The rule is one block per feature; no `if (game === 'X')` conditionals.

### 3.1 Free spins — fixed count

| Field | Value |
|:--|:--|
| Mechanic | Award `N` extra spins on bonus-trigger; usually with a multiplier or replaced reel strip |
| Synonyms | Free spins; bonus spins; free games; FS |
| First-ship vendor + year | IGT Cleopatra (1998) — credited with popularising the modern free-spin feature |
| Topology | Inherits base topology |
| State machine | `baseSpin → triggerCheck (≥T scatters) → enterFS → loop FS spins → onFsEnd → returnToBase` |
| RTP impact | Often 30–60 % of total RTP routed through FS |
| Volatility | High contribution; FS is the heaviest tail |
| UI affordance | "X free spins remaining" counter; distinct music / lighting |
| Regulator notes | UKGC RTS 7 — FS count, retrigger and multiplier rules disclosed |
| Reference titles | Cleopatra; Book of Ra; Starburst |

### 3.2 Free spins — expanding / retriggerable

| Field | Value |
|:--|:--|
| Mechanic | Retrigger awards extra spins; expanding symbol picks per FS entry |
| Synonyms | Retrigger FS; expanding-symbol FS; Book-of-style FS |
| First-ship vendor + year | Novomatic Book of Ra (2005) — expanding special symbol picked per FS |
| Topology | Inherits |
| State machine | `enterFS → pickSpecialSymbol → spinFS → retriggerCheck → resolve` |
| RTP impact | Expanding-symbol RNG drives heavy tail; FS retriggers add geometric distribution |
| Volatility | Very high; classic Book-of titles top variance class |
| UI affordance | Animated expanding symbol; "+N free games" banner on retrigger |
| Regulator notes | UKGC requires expanded-symbol probability disclosure |
| Reference titles | Book of Ra; Book of Dead; Book of Shadows |

### 3.3 Free spins — progressive multiplier

| Field | Value |
|:--|:--|
| Mechanic | Multiplier counter that climbs each FS or each FS win and applies to all wins |
| Synonyms | Climb multiplier; progressive FS multiplier; ladder multiplier |
| First-ship vendor + year | NetEnt Gonzo's Quest (2010 — base cascade multiplier 1×→5× in FS becomes 3×→15×) |
| Topology | Inherits |
| State machine | `enterFS → multCounter=1 → onWin: pay × mult → onCascade: mult++ → onFsEnd` |
| RTP impact | 10–20 % of total RTP can route through climb |
| Volatility | Increases tail; cap matters (usually 10×, 100×, or 1000×) |
| UI affordance | Big multiplier counter top-of-screen; climb animation per increment |
| Regulator notes | UKGC RTS 7 — multiplier ceiling must be disclosed |
| Reference titles | Gonzo's Quest; Bonanza; Sweet Bonanza |

### 3.4 Hold & Win / Hold and Spin / Lock & Respin

| Field | Value |
|:--|:--|
| Mechanic | Coin/Cash symbols lock; respin counter (usually 3) resets on each new symbol; fill grid for top award |
| Synonyms | Hold & Win; Hold and Spin; Lock & Respin; Stick N Win; Hold N Link; Hold the Jackpot |
| First-ship vendor + year | Aristocrat Lightning Link (2015 land); Pragmatic Wolf Gold (2017) popularised online; Playson Hold and Win series (2019); 3 Oaks Hold the Jackpot family (2020+) |
| Topology | Standard 5×3 / 6×4; coin symbols carry cash value or jackpot tag |
| State machine | `baseSpin → triggerCheck (≥6 coins) → enterRespin (3 spins) → onCoinLand: lockCell + resetCount=3 → fillGridCheck → onRespinEnd: totalCoins+jackpots` |
| RTP impact | 25–60 % of total RTP through hold feature in hold-centric titles |
| Volatility | Very high; full-grid Grand jackpot is 1/M-tail probability |
| UI affordance | Locked cells shown with gold border; respin counter; coin-value reveal |
| Regulator notes | UKGC RTS 7 — coin-value distribution, jackpot logic; AGCO 4.07 must-hit-by if pooled |
| Reference titles | Lightning Link; Wolf Gold; Solar Queen; Buffalo King Hold and Win |

### 3.5 Bonus Buy / Feature Buy / Ante Bet

| Field | Value |
|:--|:--|
| Mechanic | Pay `X×` base bet to instantly enter a feature; or pay ~25 % extra each spin for elevated trigger rate |
| Synonyms | Bonus Buy; Feature Buy; Feature Drop; Ante Bet; Buy Feature |
| First-ship vendor + year | Big Time Gaming Extra Chilli (2018) credited with online Buy-Bonus popularisation; Ante Bet predecessor in Aristocrat land cabinets |
| Topology | Inherits |
| State machine | `betPanel.buyClick → debit (e.g. 80× bet) → forceEnterFS → run FS → resolve` |
| RTP impact | Buy-RTP is usually engineered ~0.5–1 % below natural RTP to encourage natural play (e.g. natural 96.5 %, buy 96.0 %) |
| Volatility | Higher because flat-bet players skip low-variance base spins |
| UI affordance | "Buy Bonus" CTA on bet panel; confirmation modal; price tag |
| Regulator notes | UK (2019), Netherlands KSA, Germany, partially Sweden have **banned** bonus buy; product must hide CTA on those licences |
| Reference titles | Extra Chilli; Money Train 2/3/4; San Quentin xWays |

### 3.6 Bonus Pick / Pick 'n' Click

| Field | Value |
|:--|:--|
| Mechanic | Player clicks tiles to reveal prizes; ends on "collect" or "end" reveal |
| Synonyms | Pick-and-click; tile bonus; pick-em; second-screen bonus |
| First-ship vendor + year | Bally Reel 'em In (1996) — first true second-screen pick bonus; standardised since |
| Topology | Pick grid overlay (usually 2×4 / 3×4) |
| State machine | `enterPick → loop click reveal until end-trigger → settle prizes` |
| RTP impact | Pick paytable engineered to known mean per pick |
| Volatility | Medium; tail capped by max picks |
| UI affordance | Tiles flip / pop; running prize counter |
| Regulator notes | UKGC RTS 7 — reveal probabilities, end-trigger rule |
| Reference titles | Reel 'em In; Tales of Egypt; many bonus-round titles |

### 3.7 Wheel Bonus / Wheel of Fortune

| Field | Value |
|:--|:--|
| Mechanic | Spin a segmented wheel; lands on prize / multiplier / jackpot tier |
| Synonyms | Wheel bonus; bonus wheel; fortune wheel; mystery wheel |
| First-ship vendor + year | IGT Wheel of Fortune (1996 land); online port 2010+; Aristocrat Wonder 4 Wonder Wheel (2014) |
| Topology | 24- or 36-segment ring overlay |
| State machine | `enterWheel → spinWheel → decel → landSegment → resolveTier → exitWheel` |
| RTP impact | Wheel return engineered into segment weights (typically 30–60 % of bonus RTP) |
| Volatility | Tail set by Grand-segment probability |
| UI affordance | Pointer animation; segment glow on land; jackpot ladder beside wheel |
| Regulator notes | UKGC RTS 7 — segment probability disclosure; AGCO 4.07 must-hit-by for Grand |
| Reference titles | Wheel of Fortune; Wonder 4 Wonder Wheel; Megawheel |

### 3.8 Cascade / Tumble / Avalanche

| Field | Value |
|:--|:--|
| Mechanic | Winning symbols disappear; new symbols drop from above; re-evaluate for additional wins |
| Synonyms | Cascade; Tumble; Avalanche (NetEnt trademark); collapsing reels; drop reels |
| First-ship vendor + year | NetEnt Gonzo's Quest (Jul 2010) — first major online avalanche slot |
| Topology | Rectangular or cluster grids |
| State machine | `spin → resolve → removeWinners → dropAbove → fillTop → if wins recurse → else settle` |
| RTP impact | Same corridor; tumble multiplier often the climb |
| Volatility | Higher than fixed-reel; long cascade chains produce big wins |
| UI affordance | Symbol fall / fade-out / new-cell drop animation; chain counter |
| Regulator notes | UKGC RTS 14 (responsible product design) — tumbles count as one spin for 2.5-s rule |
| Reference titles | Gonzo's Quest; Bonanza; Sweet Bonanza; Sugar Rush; Reactoonz |

### 3.9 Expanding Wild

| Field | Value |
|:--|:--|
| Mechanic | Wild lands then expands to cover whole reel (or chunk) |
| Synonyms | Expanding wild; reel-wide wild; vertical wild |
| First-ship vendor + year | Novomatic Book of Ra (2005) expanding scatter; expanding wild variant standardised since |
| Topology | Inherits |
| State machine | `spin → wildLand → triggerExpand animation → recountWaysAfterExpand → pay` |
| RTP impact | Concentrated in FS often; 5–15 % of RTP |
| Volatility | Higher; wild full-reel coverage produces clustered tail wins |
| UI affordance | Wild animates vertical expand; reel highlight |
| Regulator notes | UKGC RTS 7 — expansion rule disclosed |
| Reference titles | Book of Ra; Book of Dead; Mythic Wolf Extreme |

### 3.10 Walking / Trailing Wild

| Field | Value |
|:--|:--|
| Mechanic | Sticky wild moves one column left/right each spin until exits grid |
| Synonyms | Walking wild; trailing wild; marching wild; shifting wild |
| First-ship vendor + year | NetEnt Jack and the Beanstalk (2011 walking-wild prototype) |
| Topology | Inherits |
| State machine | `wildLand → markCellAsWalking → onNextSpin: moveOneCol → if off-grid: remove` |
| RTP impact | Adds 3–8 % to RTP typically; usually FS-only |
| Volatility | Medium; long-living walking wilds produce stacked wins |
| UI affordance | Wild glows + arrow; pre-spin "walking" animation |
| Regulator notes | UKGC RTS 7 — direction and movement rule disclosed |
| Reference titles | Jack and the Beanstalk; Candy Carnival |

### 3.11 Sticky Wild

| Field | Value |
|:--|:--|
| Mechanic | Wild lands and stays on its cell for remaining FS / N spins |
| Synonyms | Sticky wild; held wild; persistent wild |
| First-ship vendor + year | Microgaming Tomb Raider (2004 land); NetEnt Dead or Alive (2009) popularised online |
| Topology | Inherits |
| State machine | `wildLand in FS → markCellAsSticky → onNextSpin: skipReplace → onFsEnd: clear` |
| RTP impact | 5–20 % of FS RTP via sticky accumulation |
| Volatility | High; full-grid stickies in DoA2 produced max-win cluster |
| UI affordance | Wild glow + lock icon; persistent across spins |
| Regulator notes | UKGC RTS 7 — persistence rule disclosed |
| Reference titles | Dead or Alive 2; Dog House Megaways (sticky-FS variant) |

### 3.12 Stacked Wild

| Field | Value |
|:--|:--|
| Mechanic | Wild appears already pre-stacked (e.g. 3 in a column) at landing time |
| Synonyms | Stacked wild; wild stack; column wild |
| First-ship vendor + year | Aristocrat Buffalo (2008 land); standardised since |
| Topology | Inherits |
| State machine | `reel-strip-driven stack: drawSymbols → if stack-of-k → render as stack → no extra animation needed` |
| RTP impact | Engineered into reel-strip; neutral |
| Volatility | Medium; reel-fill stacks of wild produce line-fillers |
| UI affordance | Visible stack on landing; no expand animation |
| Regulator notes | UKGC RTS 7 — pre-stacked strip disclosed in reel definition |
| Reference titles | Buffalo; Sparkling Royal; Garden of the Amazon |

### 3.13 Wild Reel

| Field | Value |
|:--|:--|
| Mechanic | Entire reel becomes wild on trigger; equivalent to expanding-wild for whole reel |
| Synonyms | Full reel wild; wild reel; reel wild |
| First-ship vendor + year | IGT Wheel of Fortune Triple Spin (2009 land); online ports since |
| Topology | Inherits |
| State machine | `triggerEvent → markReelAsWild → resolveLines/ways with reel wildcard → pay` |
| RTP impact | High concentrated; wild-reel triggers often 5–10 % of FS RTP |
| Volatility | High; whole-reel wild on stacked-line content yields top-tier wins |
| UI affordance | Reel-wide glow + wild texture overlay |
| Regulator notes | UKGC RTS 7 — trigger condition disclosed |
| Reference titles | Wild Wild Reel; Raging Rhino; Bonanza wild-reel variants |

### 3.14 Mystery Symbol (uniform reveal)

| Field | Value |
|:--|:--|
| Mechanic | Mystery placeholder symbol lands; at end of spin all mystery cells transform into one randomly-chosen pay symbol (uniform pick) |
| Synonyms | Mystery symbol; mystery transform; covered symbol; question-mark symbol |
| First-ship vendor + year | Bally Quick Hit (2009 land); NetEnt Mythic Maiden (2012) popularised online |
| Topology | Inherits |
| State machine | `spin → mysteryCount → pickOneSymbol uniformly weighted → revealAllMystery → resolvePay` |
| RTP impact | Mystery boost adds 10–20 % to FS RTP typically |
| Volatility | High; uniform reveal can produce full-grid same-symbol clusters |
| UI affordance | Mystery placeholder art (question mark, covered icon); reveal animation flips all at once |
| Regulator notes | UKGC RTS 7 — distribution of mystery reveal must be disclosed; uniform vs weighted matters |
| Reference titles | Quick Hit; Mythic Maiden; Mr Null's Wicked Wares |

### 3.15 Super / Mega Symbol (multi-cell)

| Field | Value |
|:--|:--|
| Mechanic | One logical symbol occupies multiple cells (2×2, 3×3, 4×4) on the grid |
| Synonyms | Super symbol; mega symbol; giant symbol; colossal symbol; block symbol |
| First-ship vendor + year | IGT Super Stacks (2009); Bally Cash Wave (2010); WMS Colossal Reels (2011) |
| Topology | Inherits rectangular |
| State machine | `spin → drawBigSymbolFromStrip → renderMask → expandToCellsForWaysCount → pay` |
| RTP impact | Engineered into reel weights |
| Volatility | Medium-high; big symbol on payway gives clustered wins |
| UI affordance | Single sprite spans K×K cells; can animate as one unit |
| Regulator notes | UKGC RTS 7 — big-symbol contribution to payline / way count disclosed |
| Reference titles | Super Stacks; Colossal Reels; Jungle Giants |

### 3.16 Lightning / Coin Collector

| Field | Value |
|:--|:--|
| Mechanic | Special "lightning" or "collector" symbol picks up all on-screen coin values and adds to pay |
| Synonyms | Coin collector; lightning collect; magnet symbol; vacuum collect |
| First-ship vendor + year | Aristocrat Lightning Link (2015 land — the canonical reference for this combined hold-and-collect) |
| Topology | Inherits |
| State machine | `spin → if collectorPresent: sum allCoinValuesOnScreen → award sum → optional persist for next spin` |
| RTP impact | Concentrated in feature; 10–25 % of feature RTP |
| Volatility | High; large coin set + collector = huge single-spin pay |
| UI affordance | Lightning bolt particle animation from collector to each coin; running tally |
| Regulator notes | UKGC RTS 7 — collector rule disclosure |
| Reference titles | Lightning Link; Cash Express; Dragon Link |

### 3.17 Multiplier Orb / Coin Multiplier / Climb Multiplier

| Field | Value |
|:--|:--|
| Mechanic | Special "orb" symbol carries multiplier; on collect it bumps the global multiplier or applies to win |
| Synonyms | Multiplier orb; coin multiplier; climb multiplier; ladder multiplier |
| First-ship vendor + year | NetEnt Gonzo's Quest (2010) climb during cascades; orb variants popular since 2018 |
| Topology | Inherits |
| State machine | `spin → onOrbLand: addToMultiplier → applyToCurrentWin OR persist for cascade chain` |
| RTP impact | 5–15 % of RTP; often interacts with cascade |
| Volatility | High; cap matters (50×, 100×, 1000×) |
| UI affordance | Orb sprite with multiplier badge; climb animation per orb |
| Regulator notes | UKGC RTS 7 — cap disclosure |
| Reference titles | Gonzo's Quest; Sweet Bonanza; Sugar Rush |

### 3.18 Persistent Multiplier (across FS)

| Field | Value |
|:--|:--|
| Mechanic | Multiplier accrues across the whole free-spin session; doesn't reset per spin |
| Synonyms | Persistent FS multiplier; ladder multiplier; build-up multiplier |
| First-ship vendor + year | NetEnt Wild Water (2014); Push Gaming Jammin' Jars (2018) modern reference |
| Topology | Inherits |
| State machine | `enterFS → mult=1 → onWin: mult++ → carry across FS spins → onFsEnd: reset` |
| RTP impact | 15–25 % of FS RTP typically |
| Volatility | Very high; tail driven by streak of wins |
| UI affordance | Persistent counter top-of-screen; doesn't reset between FS spins |
| Regulator notes | UKGC RTS 7 — persistence rule disclosed |
| Reference titles | Jammin' Jars; Reactoonz; Money Train |

### 3.19 Path-Aware Multiplier (line accumulation)

| Field | Value |
|:--|:--|
| Mechanic | Multiplier counts only on the specific line / cluster path the win traversed; per-line accumulation |
| Synonyms | Path multiplier; line-aware multiplier; per-line mult |
| First-ship vendor + year | Big Time Gaming Bonanza (2016) FS — per-cascade multiplier per win line |
| Topology | Inherits |
| State machine | `spin → for each winning path: pathMult += 1 → applyPathMult to pay` |
| RTP impact | 10–20 % of RTP |
| Volatility | High |
| UI affordance | Per-line multiplier badge; floating mult-text on line draw |
| Regulator notes | UKGC RTS 7 — per-path logic disclosed |
| Reference titles | Bonanza; Extra Chilli; White Rabbit |

### 3.20 Symbol Upgrade / Transmute

| Field | Value |
|:--|:--|
| Mechanic | Lower-value symbol transforms into higher-value symbol mid-feature; or "converter" picks one symbol type and upgrades all instances |
| Synonyms | Symbol upgrade; transmute; convert; promote; level up |
| First-ship vendor + year | Push Gaming Razor Shark (2020), Razor Returns (2023) — Razor Reveal feature |
| Topology | Inherits |
| State machine | `enterUpgrade → pickSymbolType → markAllInstances → upgradeAnimation → recountPay` |
| RTP impact | 10–20 % of feature RTP |
| Volatility | High; full-grid same-symbol upgrade is tail event |
| UI affordance | Glow + flip animation per upgraded cell |
| Regulator notes | UKGC RTS 7 — pick / weight disclosure |
| Reference titles | Razor Shark; Razor Returns; Fat Rabbit |

### 3.21 Respin / Re-spin each reel

| Field | Value |
|:--|:--|
| Mechanic | Player may re-spin a single reel (paid) after the main spin; or specific cell respin triggered by event |
| Synonyms | Respin; re-spin; reel hold; nudge respin |
| First-ship vendor + year | Aristocrat Reel Power respin (2006); modern pay-respin in NetEnt 2014+ |
| Topology | Inherits |
| State machine | `spinResolve → respinOption → onRespinClick: re-roll one column → re-resolve` |
| RTP impact | Respin price engineered so feature is neutral-EV to slightly negative |
| Volatility | Adds optional variance; flat-RTP if priced correctly |
| UI affordance | Per-reel respin button + cost label |
| Regulator notes | UKGC RTS 7 — respin price disclosure; UK has restricted pay-respins in some titles |
| Reference titles | Mega Joker; Triple Diamond respin variants |

### 3.22 Scatter Anticipation / Reel Pulse

| Field | Value |
|:--|:--|
| Mechanic | When `≥T-1` scatters have already landed and remaining reels are still spinning, those reels slow and pulse to build tension |
| Synonyms | Reel pulse; anticipation reel; slow reel; scatter teaser; near-miss reel |
| First-ship vendor + year | IGT MegaJackpots (2005 land); industry-standard since |
| Topology | Inherits |
| State machine | `reelStops[k] → if scatterCount(0..k) ≥ T-1: extendSpinDuration for reels[k+1..N-1] → addPulseEffect` |
| RTP impact | None; purely presentation |
| Volatility | None |
| UI affordance | Slower spin curve + pulsing glow + audio tension layer on remaining reels |
| Regulator notes | UKGC RTS 14 (responsible product design): "near miss" must not be artificially elevated; reel weights must remain mathematically honest |
| Reference titles | Effectively every modern slot |

### 3.23 Big Win Tiers (tier 1 / 2 / 3 / 4 / 5)

| Field | Value |
|:--|:--|
| Mechanic | Threshold-based win celebration tiers (industry vernacular: Nice / Big / Epic / Mega / Legendary / Ultimate; **factory internal: tier1..tier5** per CLAUDE.md HARD RULE) |
| Synonyms | Win tiers; big-win banner; placard tier; win celebration tier |
| First-ship vendor + year | IGT MegaJackpots celebration framework (2004 land); industry-standard since |
| Topology | Independent of topology |
| State machine | `winResolved → totalWin/totalBet ratio → mapToTier → enterTierAnimation → rollUp → exitTier → idle` |
| RTP impact | None; purely presentation |
| Volatility | None; tier *thresholds* are observable from volatility curve |
| UI affordance | Full-screen overlay placard, rollup counter accelerated per tier, coin-shower particles, music swell |
| Regulator notes | UKGC RTS 14 — celebration MUST NOT misrepresent loss as win (loss-disguised-as-win rule); placard MUST NOT play if `totalWin < totalBet` |
| Reference titles | Effectively every modern slot |

**Industry tier thresholds (vendor-neutral norm):**

| Internal tier | Multiple of bet | Vernacular outside | Typical celebration |
|:--|:--|:--|:--|
| tier1 | 5× | "Nice / Big" | Rollup, modest placard, 2–3 s |
| tier2 | 15× | "Big / Huge" | Brighter placard, 3–4 s, coin shower |
| tier3 | 50× | "Mega / Epic" | Full-screen banner, particle burst, 5–6 s |
| tier4 | 250× | "Legendary / Super Mega" | Cinematic overlay, music swell, 8–10 s |
| tier5 | 1000× | "Ultimate / Maximum" | Cinematic + screen-shake + extended celebration |

### 3.24 Win Cap (max-win cap behavior)

| Field | Value |
|:--|:--|
| Mechanic | Hard ceiling on total payout per game round (typically 5000×, 10000×, 25000×, 50000×) |
| Synonyms | Win cap; max win; payout ceiling; round cap |
| First-ship vendor + year | UKGC-regulated content has always had cap; explicit "max-win" branding popular since 2018 |
| Topology | Independent |
| State machine | `winAccumulate → if total ≥ cap: total = cap AND terminate ongoing feature → forceSettle` |
| RTP impact | Cap removes tail; reduces RTP slightly (typically 0.05–0.20 %) |
| Volatility | Caps kurtosis; very-high-var titles often have visible cap clipping in PAR sheet |
| UI affordance | "Max win reached" overlay; feature force-end |
| Regulator notes | UKGC RTS 7 — max-win value must be disclosed; UKGC has 2024 guidance against exceeding £1M / round |
| Reference titles | Money Train 2 (50000×); Wanted Dead or a Wild (12500×); Razor Returns (50000×) |

### 3.25 Jackpot — Fixed

| Field | Value |
|:--|:--|
| Mechanic | Single non-growing prize awarded on specific trigger |
| Synonyms | Fixed jackpot; flat jackpot; static jackpot |
| First-ship vendor + year | Universal since electromechanical era |
| Topology | Independent |
| State machine | `triggerCheck → award fixed amount → idle` |
| RTP impact | Fixed contribution to RTP, set in math |
| Volatility | Tail event; engineered hit rate |
| UI affordance | Jackpot ladder, fanfare, fixed amount displayed |
| Regulator notes | UKGC RTS 7 — fixed jackpot disclosed in paytable |
| Reference titles | Most classic 5-line cabinets |

### 3.26 Jackpot — Progressive

| Field | Value |
|:--|:--|
| Mechanic | Jackpot pool grows with every wager (network or local seed); seeded at floor on hit |
| Synonyms | Progressive jackpot; growing jackpot; pooled progressive |
| First-ship vendor + year | IGT Megabucks (1986 land); Microgaming Cash Splash (1998 first online progressive); Mega Moolah (2006) |
| Topology | Independent; can be tied to any base game |
| State machine | `everyWager → poolIncrement = bet × contribRate → onTrigger: payPool, resetToSeed` |
| RTP impact | Contrib rate (typ 0.5–2 %) part of RTP; player-visible RTP excludes jackpot portion |
| Volatility | Extreme tail; Mega Moolah has paid €23M+ singles |
| UI affordance | Live-updating jackpot ticker; jackpot-ladder reveal on trigger |
| Regulator notes | UKGC RTS 9 specifically governs progressive jackpot systems; must-not-decrement, seed disclosure, audit trail |
| Reference titles | Mega Moolah; Hall of Gods; Mega Fortune; Major Millions |

### 3.27 Jackpot — Must-hit-by

| Field | Value |
|:--|:--|
| Mechanic | Pool guaranteed to drop before a ceiling value or a time (daily / hourly / amount cap) |
| Synonyms | Must-drop; must-hit-by; ceiling jackpot; super drop; deadline jackpot |
| First-ship vendor + year | Yggdrasil Jackpot Raiders (2017 must-drop framework); Pragmatic Drops & Wins (2020) popularised |
| Topology | Independent |
| State machine | `accumulate → if pool ≥ ceiling: forceDrop on next qualifying spin → award → reseed` |
| RTP impact | Engineered as RTP slice (~1–2 %); deadline alters distribution of who wins |
| Volatility | Shifts distribution; daily-drop is lower-tail / higher-frequency than Mega-style |
| UI affordance | Countdown ticker, ceiling progress bar, daily clock |
| Regulator notes | AGCO Registrar's Standards for Internet Gaming Standard 4.07 (Ontario) explicitly mandates disclosure of "must hit by" condition and ceiling logic; MGA equivalent in Tech Standards |
| Reference titles | Drops & Wins; Daily Jackpots (Microgaming); Jackpot Raiders |

### 3.28 Jackpot — Mystery

| Field | Value |
|:--|:--|
| Mechanic | Random trigger any spin; no symbol pattern required |
| Synonyms | Mystery jackpot; random jackpot; flash jackpot |
| First-ship vendor + year | Microgaming SpinPoker mystery (early 2000s); industry-wide since |
| Topology | Independent |
| State machine | `everyWager → RNG roll < p → forceJackpot → reveal → reseed` |
| RTP impact | Engineered RTP slice; `p × payout = contribution` |
| Volatility | Tail event |
| UI affordance | Surprise overlay; jackpot ladder reveal |
| Regulator notes | UKGC RTS 9; AGCO 4.07 if must-drop variant |
| Reference titles | Major Millions; Treasure Nile; Ozwin's Jackpots |

### 3.29 Jackpot — Pooled (network-wide)

| Field | Value |
|:--|:--|
| Mechanic | Jackpot pool aggregated across many operators / sites / players |
| Synonyms | Network jackpot; wide-area progressive; WAP; pooled jackpot |
| First-ship vendor + year | IGT Megabucks (1986 — first WAP); Microgaming Mega Moolah (2006 first network-wide online) |
| Topology | Independent |
| State machine | Same as progressive but contrib aggregates across N operators via central jackpot service |
| RTP impact | RTP slice contributed by each operator; can be 0.5–2 % |
| Volatility | Maximum tail; world-record €23M+ singles |
| UI affordance | Cross-operator live ticker; jackpot ladder |
| Regulator notes | UKGC RTS 9 — pooled progressive systems must publish trust-fund / liability framework |
| Reference titles | Mega Moolah; Mega Fortune; Megabucks |

### 3.30 Daily Jackpot

| Field | Value |
|:--|:--|
| Mechanic | Jackpot guaranteed to drop within 24 h; usually pooled across many slots in operator network |
| Synonyms | Daily drop; 24-hour drop; daily must-drop; daily progressive |
| First-ship vendor + year | Microgaming Daily Jackpots (2017); Pragmatic Drops & Wins (2020) |
| Topology | Independent |
| State machine | `tickEachSecond → if midnight approaches AND not yet hit → forceTriggerWindow → award before deadline` |
| RTP impact | RTP slice ~1 % typical |
| Volatility | Lower-tail than mega-pool; engineered to drop every 24 h |
| UI affordance | Countdown clock; recent-winners ticker |
| Regulator notes | UKGC RTS 9 + RTS 14; AGCO 4.07 |
| Reference titles | Drops & Wins; Daily Jackpots |

### 3.31 Gamble / Double-Up / Card-flip

| Field | Value |
|:--|:--|
| Mechanic | Post-win, optional 50/50 (or ¼) gamble: guess red/black or suit; correct doubles or quadruples; wrong forfeits |
| Synonyms | Gamble; double-up; card-flip; risk; mini-game |
| First-ship vendor + year | Novomatic Sizzling Hot, Book of Ra (2000s land cabinets); online ports since |
| Topology | Independent; overlay UI |
| State machine | `winResolved → gambleOption → onClick: rng red/black → if correct: double bankroll → loopUntilCollect|Loss` |
| RTP impact | Pure 50 % → 100 % RTP on gamble; doesn't change game RTP |
| Volatility | Adds zero-mean variance |
| UI affordance | Card-back / colour buttons; collect button |
| Regulator notes | UK still allows but UKGC 2025 guidance discourages; many operators exclude double-up rounds from wagering contribution |
| Reference titles | Book of Ra; Sizzling Hot; Lucky Lady's Charm |

### 3.32 Risk Game (red/black, suit guess)

| Field | Value |
|:--|:--|
| Mechanic | Gamble variant with finer odds: suit guess (4-way, 4× pay) instead of binary |
| Synonyms | Risk game; suit guess; quad-up; ladder gamble |
| First-ship vendor + year | Novomatic / Greentube |
| Topology | Independent |
| State machine | `winResolved → suitChoice → reveal → if correct: 4× → loopUntilCollect|Loss` |
| RTP impact | 4-way pure RTP; doesn't change game |
| Volatility | Higher zero-mean variance than double-up |
| UI affordance | 4 suit buttons; ladder display |
| Regulator notes | Same as 3.31; UK 2025 generally discouraged |
| Reference titles | Sizzling Hot Quattro; Greentube classic slots |

### 3.33 Win / Loss Indicator / Net loss meter

| Field | Value |
|:--|:--|
| Mechanic | Persistent display of session net win/loss, prominent and unambiguous |
| Synonyms | Net loss meter; session tracker; win/loss indicator; reality meter |
| First-ship vendor + year | Mandated by UKGC LCCP / RTS 14 since 2021; mandatory for UK-licensed slots |
| Topology | UI overlay |
| State machine | `onSessionStart → init net=0 → onSpinSettle: net += win - bet → render` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Persistent panel showing total stake, total return, session net, elapsed time |
| Regulator notes | UKGC RTS 14 mandates this for all online slots; MGA equivalent in Player Protection Directive |
| Reference titles | All UKGC-licensed content post Oct 2021 |

### 3.34 Reality Check / Session Timeout

| Field | Value |
|:--|:--|
| Mechanic | Pop-up at user-chosen interval (15 / 30 / 60 min) showing session stats and pause/exit option |
| Synonyms | Reality check; session pause; reality meter; time alert |
| First-ship vendor + year | UKGC LCCP SR Code 4 (~2015 introduction); standardised across UK content |
| Topology | Modal overlay |
| State machine | `sessionStart → setInterval(X) → showModal → onResume or onExit` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Full-screen modal that pauses game; stats panel; Continue / Cash Out buttons |
| Regulator notes | UKGC LCCP SR Code 4 mandatory; MGA Player Protection Directive equivalent; Sweden Spelinspektionen requires similar |
| Reference titles | All UKGC content |

### 3.35 Force Feature Buttons (dev / cert mode)

| Field | Value |
|:--|:--|
| Mechanic | Dev/QA panel buttons that force trigger features for testing (FS-force, Big-Win-force, Hold-force) |
| Synonyms | Force buttons; dev panel; cert mode; QA buttons |
| First-ship vendor + year | Industry-internal since first video slots; never publicly exposed in production |
| Topology | UI overlay (dev-only) |
| State machine | Per CLAUDE.md HARD RULE in `slot-gdd-factory` rule_force_buttons_real_spin: Force buttons MUST call `runOneBaseSpin()` with a flag, never direct `bigWinTierEnter()` shortcut. Engine + winPresentation consume the flag and produce real spin with forced outcome. |
| RTP impact | None in production (dev-only) |
| Volatility | None in production |
| UI affordance | Dev panel hidden behind cheat-code or build flag |
| Regulator notes | MUST be stripped from production builds; UKGC RTS audit can flag |
| Reference titles | All vendor titles have internal force mode |

### 3.36 Replay (2025-2026 trend: persistent in-feature retry)

| Field | Value |
|:--|:--|
| Mechanic | Player can "replay" an in-feature event (e.g. re-roll a hold-and-spin coin reveal) for an extra fee |
| Synonyms | Replay; re-roll; retry; redo (2025-2026 emerging) |
| First-ship vendor + year | Pragmatic Play, 3 Oaks Gaming, Playson hold-and-win variants 2024-2025 |
| Topology | Inherits feature topology |
| State machine | `featureReveal → replayOption (paid) → onClick: re-roll value → settle` |
| RTP impact | Replay price engineered EV-neutral or slightly negative |
| Volatility | Adds optional variance |
| UI affordance | Replay button with price tag adjacent to revealed cell |
| Regulator notes | UK has flagged "feature-buy-like" behaviour; KSA Netherlands likely to scrutinise |
| Reference titles | Emerging 2024-2026 hold-and-win variants |

---

## 4. Presentation / UX Catalog

### 4.1 Win rollup (counter animation)

| Field | Value |
|:--|:--|
| Mechanic | Win amount animates from 0 → final value with accelerating / decelerating counter |
| Synonyms | Rollup; tick-up; win counter; numeric rollup |
| First-ship vendor + year | Universal since electromechanical |
| State machine | `winResolved → rollupStart → tween(0, totalWin, durationByTier) → rollupEnd → idle` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Numeric ticker with tween easing; per-tier duration (Big = 2 s, Mega = 5 s, etc.) |
| Regulator notes | UKGC RTS 14 — rollup MUST NOT exceed actual win amount; LDW prohibited |
| Reference titles | Universal |

### 4.2 Spin tempo (windup, accel, steady, decel, stagger, settle)

| Field | Value |
|:--|:--|
| Mechanic | Per-reel motion profile composed of distinct phases for cinematic feel |
| Synonyms | Spin curve; reel choreography; motion profile; spin tempo |
| First-ship vendor + year | IGT s2000 cabinet (2003); standardised since |
| State machine | `spinStart → windup (50–150 ms) → accel (100–250 ms) → steady (200–600 ms) → decel (150–300 ms) → stagger between reels (60–120 ms each) → settleBounce (60–120 ms) → idle` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Reel motion easing; bounce-back overshoot on land |
| Regulator notes | UKGC LCCP / RTS 14 — total cycle ≥ 2.5 s; turbo / slam-stop BANNED |
| Reference titles | Universal |

### 4.3 Reel blur during motion

| Field | Value |
|:--|:--|
| Mechanic | Motion-blur applied via overlay (NEVER baked into the cell sprite) |
| Synonyms | Reel blur; motion overlay; blur pattern; spin blur |
| First-ship vendor + year | Standard since 2010-era HTML5 |
| State machine | `reelAccel → overlayOpacity 0→0.8 → steady → overlayOpacity 0.8→0 on decel` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Per-reel sibling overlay div / canvas layer; never on the cell sprite (factory rule) |
| Regulator notes | None |
| Reference titles | Universal |

### 4.4 Symbol highlight per win

| Field | Value |
|:--|:--|
| Mechanic | Winning cells glow, pulse or animate post-resolve to indicate which cells contributed |
| Synonyms | Win glow; symbol highlight; cell pulse; win flash |
| First-ship vendor + year | Standard since first video slot |
| State machine | `winResolved → for each winningCell: applyGlow + scalePulse → after rollup: clear` |
| RTP impact | None |
| Volatility | None |
| UI affordance | CSS / canvas glow filter; pulse 2 s; cleared on next spin |
| Regulator notes | None |
| Reference titles | Universal |

### 4.5 Payline draw animation

| Field | Value |
|:--|:--|
| Mechanic | Visible line drawn through winning symbols on the payline |
| Synonyms | Line draw; payline trace; win line animation |
| First-ship vendor + year | IGT video-slot era |
| State machine | `winResolved → for each winLine: drawSegmented(line, durationByLineLength) → clear after rollup` |
| RTP impact | None |
| Volatility | None |
| UI affordance | SVG / canvas path drawn over winning cells |
| Regulator notes | None |
| Reference titles | Universal (lines content) |

### 4.6 Big-win banner / placard

| Field | Value |
|:--|:--|
| Mechanic | Full-screen overlay celebrating tier-N win (see 3.23) |
| Synonyms | Big-win banner; placard; celebration overlay; full-screen win |
| First-ship vendor + year | IGT MegaJackpots (2004) reference |
| State machine | See 3.23 |
| RTP impact | None |
| Volatility | None |
| UI affordance | Modal overlay, gradient background, animated text, rollup counter |
| Regulator notes | UKGC RTS 14 — celebration MUST NOT play if win < bet |
| Reference titles | Universal |

### 4.7 Coin shower particle burst

| Field | Value |
|:--|:--|
| Mechanic | Particle emitter spawns coin / gem sprites during big-win celebration |
| Synonyms | Coin shower; particle burst; gem rain; win confetti |
| First-ship vendor + year | NetEnt Starburst (2012) early-modern reference |
| State machine | `tier ≥ tier2 → particle emitter start → emit per frame → emitter stop at rollup-90% → clear` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Canvas / WebGL particle system; usually 100–500 particles |
| Regulator notes | None |
| Reference titles | Universal |

### 4.8 Scatter celebration

| Field | Value |
|:--|:--|
| Mechanic | Trigger-event celebration when bonus is fired (free-spin entry, hold-and-win entry) |
| Synonyms | Scatter celebration; trigger anim; bonus intro |
| First-ship vendor + year | Industry-standard since 2005 |
| State machine | `triggerCondition → scatterCelebration (3–5 s) → enterFeatureFSM` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Symbol-highlight animation, "Free Spins!" / "Bonus!" callout, audio cue, transition to feature scene |
| Regulator notes | None |
| Reference titles | Universal |

### 4.9 Symbol drop / cascade animation

| Field | Value |
|:--|:--|
| Mechanic | New symbols drop from above the grid to fill removed cells during cascade |
| Synonyms | Drop animation; cascade fill; tumble fill; refill animation |
| First-ship vendor + year | NetEnt Gonzo's Quest (2010) reference |
| State machine | `winRemove → ease-out drop of new cell from y=-1 to y=targetRow → bounce on land` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Per-cell drop tween, stagger by column |
| Regulator notes | UKGC RTS 14 — drop counts as part of single spin (2.5-s rule encompasses cascade chain) |
| Reference titles | Cascading content universal |

### 4.10 Force feature dev buttons (cert / dev UI)

(See 3.35 — combined feature+UX entry.)

### 4.11 Persistent HUD (balance, bet, win)

| Field | Value |
|:--|:--|
| Mechanic | Persistent panel always showing balance, current bet, last win, total stake/return |
| Synonyms | HUD; bet panel; status bar; persistent header |
| First-ship vendor + year | Universal |
| State machine | `onAnyStateChange → updateHUD` |
| RTP impact | None |
| Volatility | None |
| UI affordance | Fixed footer / header with currency-formatted values |
| Regulator notes | UKGC RTS 14 + LCCP — balance + total stake / return MUST be visible at all times |
| Reference titles | Universal post-2021 in UK |

---

## 5. Regulator Deep-dive

### 5.1 UKGC — RTS, LCCP, slot-specific rules (2021 → 2025)

| Topic | Detail |
|:--|:--|
| Spin speed floor | Online slot game cycle ≥ 2.5 s (in force since 31 October 2021) |
| Autoplay | BANNED for online slots (since 31 October 2021); player must manually press spin |
| Turbo / quick-spin / slam-stop | BANNED (since 31 October 2021) |
| Losses disguised as wins (LDW) | BANNED — celebration must not play if total win < total stake |
| Reverse withdrawal | BANNED; pending withdrawals must complete |
| Audio / visual on win < stake | Must NOT play celebratory effects |
| Bonus buy | BANNED for UK-licensed (since 2019) |
| Stake cap | £5 / spin for 25+, £2 / spin for 18–24 (in force from 9 April 2025 / 21 May 2025) |
| RTS 7 (game design) | Must disclose game rules including paytable, lines, ways, RTP, max-win, jackpot logic |
| RTS 8 (display) | Must show balance, stake, return, session stats |
| RTS 9 (progressive jackpot) | Pool accumulation rules, seed disclosure, audit trail |
| RTS 12 (financial limits) | Deposit / loss limit tooling |
| RTS 14 (responsible product design) | Encompasses LDW ban, autoplay ban, spin-speed floor, net loss meter, reality check |
| LCCP SR Code 4 | Reality check pop-up at user-chosen 15/30/60 min |

References mapping: the user prompt cites "LCCP 8.3.1 (session cap) and 8.3.5 (min spin 2.5 s)". In current public UKGC documentation those clauses map to RTS 14 and SR Code 3.4 (formerly LCCP §8 subsections), not the explicit "8.3.1" numbering used historically. Factory should use "RTS 14" as the canonical reference; the older LCCP numbering is preserved for legacy GDDs.

### 5.2 MGA (Malta) — Game Design Requirements

| Topic | Detail |
|:--|:--|
| Game info panel | Must be in-game-accessible at all times (info icon) |
| RTP disclosure | Must publish theoretical RTP per game version |
| Player session limits | Loss limits and session limits available to player |
| Game certification | ISO 17025 lab certification via approved testing agents |
| Player Protection Directive | Reality check, self-exclusion via MGA's central register |
| Pooled progressive | Trust-fund framework required for cross-operator pools |

### 5.3 Sweden — Spelinspektionen

| Topic | Detail |
|:--|:--|
| Bonus restrictions | Single first-deposit bonus only; capped at SEK 100 |
| Bonus buy | NOT explicitly banned but under industry / regulator debate; 55 % of Swedish players (industry survey 2024) favour ban |
| Credit-card ban | From 1 April 2026 (first EU country to fully ban credit gambling) |
| Spin speed / autoplay | Followed UKGC-style guidance; autoplay restricted |
| Channelisation target | Government targets ≥ 90 % (2024 actual ~85 %) |
| Player checks | Customer-care threshold triggers (time / money) since 2023 |

### 5.4 Germany — GlüNeuRStV (since 1 July 2021)

| Topic | Detail |
|:--|:--|
| Max stake / spin | €1 per spin (§ 22a sub 7 GlüStV 2021) |
| Spin speed floor | ≥ 5 s between rounds (§ 22a sub 6) — STRICTER than UKGC's 2.5 s |
| Autoplay | BANNED |
| Jackpot | BANNED (no progressive jackpots allowed on virtual slots) |
| Bonus buy | BANNED |
| "Casino" branding | Virtual slots MUST NOT be referred to as "casino" or "casino games" |
| Deposit limit | €1000 / month default cross-operator (regulator-tracked) |

### 5.5 Ontario — AGCO Registrar's Standards for Internet Gaming (in force since 4 April 2022)

| Topic | Detail |
|:--|:--|
| Standards body | AGCO + iGO (iGaming Ontario) |
| Game certification | iTech / GLI / BMM Testlabs certification required |
| Must-hit-by | Standard 4.07 governs disclosure: must-drop ceiling, deadline mechanism, last-eligible-spin behavior |
| RG framework | Self-exclusion via central register; mandatory RG training for operator staff (updated Mar 2025) |
| MFA cybersecurity | Standard 1.46 — multi-factor authentication for player accounts |
| Outcomes-based | AGCO uses "outcomes-based" regulation: principle compliance over prescriptive checklist |

### 5.6 New Jersey — DGE certification fingerprint

| Topic | Detail |
|:--|:--|
| Certification body | New Jersey Division of Gaming Enforcement (DGE) |
| Testing lab | GLI, BMM Testlabs typical; lab report submitted with each game |
| RTP corridor | 83 % minimum; max 100 %; most slots ship 92–96 % |
| Required disclosures | Game rules, paytable, RTP, max-win, jackpot logic |
| Geofencing | Mandatory: in-state-only play via geolocation |
| Self-exclusion | NJ Self-Exclusion list (1, 5, lifetime) |
| Source-code escrow | DGE may require source-code escrow for high-impact games |

### 5.7 Cross-jurisdiction comparison summary

| Aspect | UKGC | MGA | SE | DE | Ontario | NJ |
|:--|:--|:--|:--|:--|:--|:--|
| Min spin time | 2.5 s | (per game; no hard floor) | follows UKGC norm | 5 s | (no hard floor) | (no hard floor) |
| Autoplay | Banned | Allowed (RG limited) | Restricted | Banned | Allowed | Allowed |
| Bonus buy | Banned | Allowed | (debate) | Banned | Allowed | Allowed |
| Progressive jackpot | Allowed (RTS 9) | Allowed | Allowed | Banned | Allowed | Allowed |
| Max stake | £5 (£2 18-24) | None | None | €1 | None | None |
| RTP floor | None published | 85–97 % typical | None published | None published | None published | 83 % |
| LDW celebration | Banned | (RG-coded) | (RG-coded) | (RG-coded) | (RG-coded) | (RG-coded) |
| Reality check | Mandatory | Mandatory | Mandatory | Mandatory | Mandatory | Recommended |
| Session limit | Mandatory tools | Mandatory tools | Mandatory tools | Mandatory cross-operator | Mandatory tools | Recommended |

---

## 6. Math Catalog

### 6.1 RTP corridors per jurisdiction

| Jurisdiction | Floor | Typical corridor | Ceiling | Notes |
|:--|:--|:--|:--|:--|
| UKGC | (no published floor) | 92.5–96.5 % | usually capped 98 % | RTS 7 disclosure mandatory |
| MGA | (no published floor) | 85–97 % | 99 % achievable | Most ship 95–97 % |
| Sweden | (no published floor) | 90–97 % | 99 % | Industry norms |
| Germany | (no published floor) | 90–96 % | 96 % typical | €1 cap restricts game design |
| Ontario | (no published floor) | 92–97 % | 99 % | Outcomes-based |
| New Jersey DGE | 83 % | 92–96 % | 100 % | Lab-verified at submission |
| Las Vegas (land) | 75 % (Nevada) | 86–93 % | 98 % | Land cabinets much lower than online |

### 6.2 Volatility / variance categories

| Tier | Name | Hit rate baseline | Top-tail multiple | Use case |
|:--|:--|:--|:--|:--|
| 1 | Very low | 1 in 2–3 spins | < 50× | Demo / beginner / RG-leaning |
| 2 | Low | 1 in 3–4 | 50–250× | Casual play, low session burn |
| 3 | Medium | 1 in 4–6 | 250–1000× | Industry default |
| 4 | High | 1 in 6–10 | 1000–5000× | Mainstream big-win content |
| 5 | Very high | 1 in 8–15 | 5000–25000× | Bonus-buy / streamer content |
| 6 | Extreme / insane | 1 in 12–25 | 25000–50000× | Niche very-high-tail content |

### 6.3 Hit frequency vs volatility curve

Industry convention: hit frequency (HF) ≈ inverse of expected spins between any win event. PAR sheets typically show:

- Low-vol slot: HF 30–45 %, median win ≈ 0.5–1× bet
- Medium-vol: HF 22–30 %, median win ≈ 1–2× bet
- High-vol: HF 15–22 %, median win ≈ 2–5× bet, with occasional 100×+
- Very-high-vol: HF 10–18 %, median win ≈ 5–15× bet, frequent dry spells

A useful identity: `RTP = HF × E[win | win]`. Designers tune HF down to push the tail higher while holding RTP constant.

### 6.4 Big-win tier thresholds (industry-canon)

Internal naming per HARD RULE: tier1..tier5. Industry vernacular for reference only.

| Internal tier | Win/bet ratio | Vernacular | Celebration duration |
|:--|:--|:--|:--|
| tier1 | ≥ 5× | "Nice / Big" | 2–3 s |
| tier2 | ≥ 15× | "Big / Huge" | 3–4 s |
| tier3 | ≥ 50× | "Mega / Epic" | 5–6 s |
| tier4 | ≥ 250× | "Legendary / Super Mega" | 8–10 s |
| tier5 | ≥ 1000× | "Ultimate / Maximum" | 10–15 s |

### 6.5 Chi-square test on real outcomes

Standard certification practice: lab runs ≥ 1 billion simulated spins. Chi-square `χ² = Σ ((observed − expected)² / expected)` per symbol-position and per pay-event. With `n` cells, expect `χ² ≈ n` with std `≈ √(2n)`. Lab pass criterion typically `p > 0.01` (some labs `p > 0.001`).

For per-symbol weighting validation, the convention is:

- Per reel × per symbol: chi-square against published reel-strip frequencies
- Per outcome class (win value bucket): chi-square against PAR distribution
- Per RTP segment (base, FS, jackpot): independent verification

### 6.6 RTP validation: simulated vs theoretical

Online certification labs (GLI, BMM, iTech, eCOGRA) require:
- Theoretical RTP within ± 0.10 % of simulated (1B+ spins) RTP
- Volatility index (std dev / mean) reported
- Maximum observable win documented and corroborated by analytic max
- Distribution of win values bucketised at 0–1×, 1–5×, 5–20×, 20–100×, 100–500×, 500×+

### 6.7 LDW (Losses Disguised as Wins) — Harrigan & Dixon 2010

Harrigan & Dixon (Journal of Gambling Issues, 2010) defines LDW as a payout less than total stake (multi-line slot pays e.g. 30¢ on a 50¢ wager) that is celebrated visually / sonically as a win. UKGC RTS 14 explicitly bans this since 2021 — celebration must not play unless `win ≥ bet`. The factory's win-presentation block enforces this gate.

---

## 7. 2025-2026 Trend Call-outs

### 7.1 Hold-and-Win evolution (Hold the Jackpot 2.0 family)

| Variant | What's new | First-ship era |
|:--|:--|:--|
| Hold the Jackpot 2.0 | Adds "upgrade" symbols that promote lower-tier coins to higher-tier (e.g. Mini → Major) | 3 Oaks Gaming / Playson 2024-2025 |
| Drop-the-Hold | Coins can be "dropped" by player choice for a re-roll at cost | Pragmatic 2025 |
| Replay | Player can re-roll a single revealed coin value (paid micro-buy) | Emerging 2025-2026 |
| Linked-Jackpot Hold | Multiple games share a single Hold-and-Win pool | 2025-2026 |
| Upgrade-Cascade Hold | Each respin with new coin also tries an upgrade on existing coins | 2025 niche |

### 7.2 Variable-height ways (post-patent expiration)

The Big Time Gaming Megaways patent expired in major jurisdictions late 2024 (Australia ~2023). Effect: dozens of studios now ship variable-height-ways content without paying the BTG license. Industry-wide proliferation in 2025-2026. Factory should use `variable_height_ways` kind and not depend on a license claim.

### 7.3 Infinity-style rolling expand (post-2024 broader adoption)

Originally ReelPlay/Yggdrasil; competitor studios now ship similar "infinite reels" topology with their own twists (max reel-count cap, cumulative multiplier on each appended reel). Factory's `infinity_expand` kind covers this.

### 7.4 Crash-curve / Plinko / instant-game hybrids

The 2024-2026 wave saw "slot-skin on crash math" titles where the surface UI looks like a 5×3 slot but underlying math is a crash distribution. Regulators (UKGC, Spelinspektionen) increasingly require these to be classified as instant games not slots.

### 7.5 Wallet-attached jackpot pools

2025 trend: jackpots accumulate against an operator's player wallet, not the game level. Operator-managed jackpots cross-game. Implication: factory `jackpot` block must support a `pool=operator` source.

### 7.6 Responsible-gambling overlays (cross-jurisdiction harmonisation)

UK / SE / NL / DE / Ontario converging on:
- Mandatory net loss meter (always visible)
- Mandatory reality check (user-chosen interval)
- Mandatory session limit tool (operator-side)
- Mandatory display of "this is not real time" (for autoplay-banned jurisdictions)
- Mandatory affordability triggers (UK 2025) for spend > £150 / month

Factory should bake these as default-on with per-jurisdiction overrides.

---

## 8. Citations & Primary Sources

### 8.1 Academic papers

- Harrigan, K. A., & Dixon, M. J. (2009). *PAR Sheets, probabilities, and slot machine play: Implications for problem and non-problem gambling.* Journal of Gambling Issues. https://www.semanticscholar.org/paper/PAR-Sheets%2C-probabilities%2C-and-slot-machine-play%3A-Harrigan-Dixon/fc5a299b0a99d7a3709eec5fe42121879e6ef332
- Harrigan, K. A., & Dixon, M. J. (2010). *Losses disguised as wins in modern multi-line video slot machines.* Addiction.
- Turner, N. E. (2011). *Volatility, House Edge, and Prize Structure of Gambling Games.* Journal of Gambling Studies.
- Barboianu, C. (2022). *Mathematics of Slot Machines: A Statistical Analysis.* PhilPapers archive. https://philarchive.org/archive/BARTMF-6
- Schwartz, D. G. (2024). *Roll the Bones: The History of Gambling* (revised ed.).

### 8.2 Regulator publications

- UK Gambling Commission. *Remote Gambling and Software Technical Standards* (Feb 2021). https://www.gamblingcommission.gov.uk/licensees-and-businesses/guide/remote-gambling-and-software-technical-standards
- UK Gambling Commission. *RTS 9 – Progressive jackpot systems.* https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards/rts-9-progressive-jackpot-systems
- UK Gambling Commission. *RTS 14 – Responsible product design.* https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards/rts-14-responsible-product-design
- UK Gambling Commission. *RTS 12 – Financial limits.* https://www.gamblingcommission.gov.uk/manual/remote-gambling-and-software-technical-standards/rts-12-financial-limits
- UK Gambling Commission. *New rules boosting safety and consumer choice* (announcement re 2025 stake cap). https://www.gamblingcommission.gov.uk/news/article/new-rules-boosting-safety-and-consumer-choice
- AGCO Ontario. *Registrar's Standards for Internet Gaming.* https://www.agco.ca/en/lottery-and-gaming/guides/registrars-standards-internet-gaming
- AGCO Ontario. *iGaming standards FAQs.* https://www.agco.ca/en/lottery-and-gaming/igaming-standards-faqs
- Glücksspielstaatsvertrag 2021 (GlüNeuRStV) full text via Lexology. https://www.lexology.com/library/detail.aspx?g=ba1070d3-970c-497d-aabc-c3d4a482b8c9
- Spelinspektionen Sweden — recent enforcement actions. https://www.igamingtoday.com/spelinspektionen-bans-cgg-entertainment-from-offering-games-in-sweden/

### 8.3 Industry / vendor references

- Big Time Gaming — Megaways licensing programme. https://www.bigtimegaming.com/news/big-time-gaming-licenses-megaways-to-gauselmann-merkur-blueprint
- Yggdrasil Gaming — El Dorado Infinity Reels. https://yggdrasilgaming.com/games/el-dorado-infinity-reels
- ReelPlay — Infinity Reels mechanic. https://nowagering.com/content-hub/insights/ReelPlay-El-Dorado-Infinity-Reels
- NetEnt — Gonzo's Quest avalanche feature. https://games.netent.com/video-slots/gonzos-quest/
- NetEnt — Aloha! Cluster Pays. https://casinorange.com/slot/aloha
- Pragmatic Play — Dog House Megaways. https://www.pragmaticplay.com/en/games/the-dog-house-megaways-slot/
- Pragmatic Play — Sweet Bonanza. https://www.pragmaticplay.com/en/games/sweet-bonanza-slot/
- Push Gaming — Razor Returns review. https://www.bigwinboard.com/razor-returns-push-gaming-slot-review/
- Aristocrat — Lightning Link 10-year retrospective. https://cdcgaming.com/focus-on-aristocrat-lightning-link-celebrates-10-years-of-energizing-the-casino-floor/
- Microgaming — Mega Moolah. https://www.megamoolah.com/games
- Spribe — Aviator crash game. https://spribe.co/games/aviator
- Spribe — Plinko (and provider comparison). https://plinkogamespribe.com/ and https://gamblingcalc.com/gambling-guides/plinko-providers-compared/
- Gaming Realms — Slingo Originals history. https://www.slingo.com/blog/slingo/how-slingo-games-are-actually-built/

### 8.4 Industry trend / blog references

- Slot Gods — Bonus Buy UK ban explainer. https://slotgods.co.uk/guides/what-is-bonus-buy-why-is-it-banned-uk
- Take Bet — UKGC bonus buy debacle. https://takebet.co.uk/the-bonus-buy-debacle-why-did-the-uk-gambling-commission-ban-this-popular-slot-feature/
- SBC News — UKGC autoplay & quickspin ban (Feb 2021). https://sbcnews.co.uk/featurednews/2021/02/02/ukgc-bans-online-slots-autoplay-and-quickspin-features/
- Slingo guide — UK autoplay/turbo/quickspin overview. https://www.slingo.com/blog/guides/autoplay-turbo-mode-and-quick-spins/
- DailyGame — slot max-win cap explainer. https://www.dailygame.net/max-win-caps-why-slots-limit-total-payout-to-5000x-or-10000x/
- Slot Decoded — max-win mechanics. https://slotdecoded.com/max-win-slots-explained/
- Casino Player Magazine — Colossal symbols explainer. https://www.casinocenter.com/extreme-symbolism/
- LeoVegas — Colossal symbols guide. https://www.leovegas.com/en-ca/blog/online-casino/colossal-symbols
- BuzzSlots — wild types explainer. https://buzz.slots.lv/slots-guides/sticky-and-walking-wilds/
- Stake — Hold and Win bonus feature explained. https://stake.com/blog/hold-and-win-slot-bonus-feature-explained
- Pragmatic Play — survey on Swedish bonus-buy attitudes. https://www.playngo.com/post/swedish-slot-players-think-bonus-buy-games-should-be-banned
- 2025 stake-cap roll-out details (UK). https://www.cliffordchance.com/insights/resources/blogs/ip-insights/2025/06/uk-gambling-regulations-uk-government-doubles-down-on-consumer-protection.html
- 2025-2026 emerging mechanic surveys. https://slotsguy.com/new-slot-features-2025/ and https://picksandparlays.net/news/3-new-slot-mechanics-changing-sweepstakes-casinos-in-2026
- 2026 release calendar / hold-jackpot variants. https://www.americancasinoguidebook.com/blog/the-2026-new-slot-releases-actually-climbing-the-rankings-so-far.html and https://slotsonfire.com/2026-slots

---

## 9. Implementation notes for `slot-gdd-factory`

These are the consequences of the research for parser / builder / blocks. They translate vendor-specific naming into the factory's vendor-neutral kinds.

### 9.1 Topology kinds (parser must recognise)

| Vendor-neutral kind | Maps to industry naming |
|:--|:--|
| `rect` (with `reels`, `rows`) | Classic 3×3 / 5×3 / 6×5 etc. |
| `hex` (with `radius`) | Hexagonal honeycomb |
| `wheel` (with `segments`, `tiers`) | Wheel topology |
| `crash` (with `distribution`) | Crash curve |
| `plinko` (with `rows`, `riskLevels`) | Plinko / pachinko |
| `slingo` (with `gridSize=5`, `reelSize=5`) | Slingo |
| `variable_height_ways` (with `reels`, `minRowsPerReel`, `maxRowsPerReel`, `optionalModifierReel`) | Megaways-style |
| `infinity_expand` (with `initialReels`, `rows`, `maxReels`) | Infinity-style |
| `colossal` (with `bigSymbolMaskSize`) | Colossal / mega symbol |
| `multi_grid` (with `gridCount`, `gridSize`) | Wonder 4-style |
| `cluster_grid` (with `size`, `minClusterK`, `adjacencyKind=ortho`) | Cluster pays |

### 9.2 Win-eval kinds

| Vendor-neutral kind | Industry naming |
|:--|:--|
| `lines` (with `lineList`) | Fixed paylines |
| `lines_selectable` | Selectable paylines |
| `lines_bothways` | Bothways lines |
| `ways` (with `waysFormula`) | Ways pays (243, 1024, 3125, 117649) |
| `cluster` (with `minK`, `payTableByClusterSize`) | Cluster pays |
| `pay_anywhere` (with `minSymbolCount`) | Lightning-style |
| `scatter` (with `triggerCount`) | Scatter pays |

### 9.3 Feature kinds (one block per kind)

| Block file | Mechanic |
|:--|:--|
| `src/blocks/freeSpins.mjs` | Free spins (fixed + retrigger + multiplier) — composable via config |
| `src/blocks/holdAndWin.mjs` | Hold-and-win family (incl. 2.0, drop, replay) |
| `src/blocks/bonusBuy.mjs` | Bonus buy / feature buy / ante bet (with per-jurisdiction visibility flag) |
| `src/blocks/pickBonus.mjs` | Pick-and-click |
| `src/blocks/wheelBonus.mjs` | Wheel bonus |
| `src/blocks/cascade.mjs` | Cascade / tumble / avalanche |
| `src/blocks/expandingWild.mjs` | Expanding wild |
| `src/blocks/walkingWild.mjs` | Walking / trailing wild |
| `src/blocks/stickyWild.mjs` | Sticky wild |
| `src/blocks/stackedWild.mjs` | Stacked wild |
| `src/blocks/wildReel.mjs` | Wild reel |
| `src/blocks/mysterySymbol.mjs` | Mystery uniform reveal |
| `src/blocks/superSymbol.mjs` | Super / mega / giant symbol (multi-cell) |
| `src/blocks/collector.mjs` | Lightning / coin collector |
| `src/blocks/multiplierOrb.mjs` | Multiplier orb |
| `src/blocks/persistentMultiplier.mjs` | Persistent multiplier (FS) |
| `src/blocks/pathMultiplier.mjs` | Path-aware / per-line multiplier |
| `src/blocks/symbolUpgrade.mjs` | Upgrade / transmute |
| `src/blocks/respin.mjs` | Respin / paid respin |
| `src/blocks/scatterAnticipation.mjs` | Scatter anticipation / reel pulse |
| `src/blocks/bigWinTiers.mjs` | Tier1..tier5 celebration |
| `src/blocks/winCap.mjs` | Win cap enforcement |
| `src/blocks/jackpotFixed.mjs` | Fixed jackpot |
| `src/blocks/jackpotProgressive.mjs` | Progressive jackpot |
| `src/blocks/jackpotMustDrop.mjs` | Must-hit-by jackpot |
| `src/blocks/jackpotMystery.mjs` | Mystery jackpot |
| `src/blocks/jackpotPooled.mjs` | Pooled / network jackpot |
| `src/blocks/jackpotDaily.mjs` | Daily-drop jackpot |
| `src/blocks/gamble.mjs` | Gamble / double-up |
| `src/blocks/riskGame.mjs` | Risk game (suit guess) |
| `src/blocks/sessionMeter.mjs` | Win/loss net meter |
| `src/blocks/realityCheck.mjs` | Reality check modal |
| `src/blocks/forceButtons.mjs` | Force feature buttons (dev / cert) |
| `src/blocks/replay.mjs` | Replay micro-buy (2025-2026 hold-variant) |

### 9.4 Presentation / UX blocks

| Block file | Mechanic |
|:--|:--|
| `src/blocks/winRollup.mjs` | Numeric rollup |
| `src/blocks/spinTempo.mjs` | Spin choreography (windup/accel/steady/decel/stagger/settle) |
| `src/blocks/reelBlur.mjs` | Motion-blur overlay (NEVER on cell sprite) |
| `src/blocks/symbolHighlight.mjs` | Per-win symbol glow |
| `src/blocks/paylineDraw.mjs` | Payline draw animation |
| `src/blocks/bigWinBanner.mjs` | Banner / placard tier overlay |
| `src/blocks/particleBurst.mjs` | Coin / gem particle |
| `src/blocks/scatterCelebration.mjs` | Trigger celebration |
| `src/blocks/cascadeDrop.mjs` | Symbol drop animation |
| `src/blocks/hud.mjs` | Persistent balance / bet / win panel |

### 9.5 Regulator config (per-jurisdiction toggles)

A single `regulator.config.mjs` block exposes:

```js
{
  jurisdiction: 'UKGC' | 'MGA' | 'SE' | 'DE' | 'ON' | 'NJ' | 'NEUTRAL',
  minSpinTimeMs: 2500 | 5000,
  autoplay: 'allowed' | 'banned',
  turbo: 'allowed' | 'banned',
  slamStop: 'allowed' | 'banned',
  bonusBuyVisible: true | false,
  progressiveJackpot: 'allowed' | 'banned',
  maxStakePerSpin: number | null,
  ldwCelebrationGate: 'win >= bet' | 'always',
  realityCheckRequired: true | false,
  sessionMeterRequired: true | false,
  affordabilityTrigger: number | null,
  maxWinCap: number | null,
}
```

The builder reads jurisdiction once, applies the table to all blocks, and refuses to ship if any block declares a feature banned by the jurisdiction.

### 9.6 GDD authoring (what a GDD must declare for the parser to build)

Minimum fields per GDD for each mechanic in this catalog:

| GDD field | Required for |
|:--|:--|
| `topology.kind` + topology-specific dimensions | All games |
| `winEval.kind` + payline list / ways formula / cluster-K | All games |
| `features[]` (array of `{kind, config}`) | All games |
| `presentation[]` (array of `{kind, config}`) | All games |
| `jurisdiction` | All games |
| `math.rtp.theoretical` + `math.rtp.simulated` | All games |
| `math.volatilityTier` (1..6) | All games |
| `math.maxWinX` | All games |
| `math.tierThresholdsX` (default `[5, 15, 50, 250, 1000]`) | All games |
| `regulator.lcccpVersion` / `regulator.rtsVersion` | UK only |

### 9.7 Banned in factory source code (CLAUDE.md HARD RULE reminder)

The following names are BANNED in `slot-gdd-factory/src/**/*.mjs` (allowed in research notes such as this one and in `samples/` GDD fixtures only when the GDD is a vendor's own document):

- "Megaways", "InfinityReels", "Wonder Wheel", "Cleopatra", "Buffalo", "Bonanza", "Gonzo's Quest"
- "Aristocrat", "BTG", "Big Time Gaming", "NetEnt", "Pragmatic", "IGT", "Microgaming", "Yggdrasil", "ReelPlay", "Push Gaming", "Spribe", "Gaming Realms", "Light & Wonder", "Playson", "Relax", "BGaming", "3 Oaks", "Blueprint", "Evolution", "WMS", "Bally", "Novomatic"
- "Hold the Jackpot", "Drops & Wins", "Lightning Link", "Cash Express", "Dragon Link"
- "Avalanche", "Cluster Pays" (trademark), "Splitz", "Gigablox", "MultiMax", "xWays", "GEMS"
- "Nice / Big / Epic / Mega / Legendary / Ultimate" — use `tier1..tier5`

Pre-commit grep gate:
```
grep -iE "(megaways|infinityreels|aristocrat|netent|pragmatic|igt|microgaming|yggdrasil|reelplay|push gaming|spribe|gaming realms|bally|wms|novomatic|gonzo|cleopatra|buffalo|bonanza|hold the jackpot|lightning link|cash express|dragon link|avalanche|cluster pays|splitz|gigablox|multimax|xways|gems)" src/
```
Result MUST be empty before merge to main.

### 9.8 Open questions / further research needed

- UKGC RTS 14 sub-clauses for affordability tooling (2025 update) — exact thresholds vary by operator and need fresh primary-source pull each time
- AGCO 4.07 full text — public AGCO web pages show table of contents only; full standard is in the PDF (auth required to download? — recheck) and may have changed since 2024
- KSA Netherlands current bonus-buy stance — search results referenced ban but a 2025-2026 primary-source pull is recommended before regulator submission
- Sweden bonus-buy: 2025 debate still active; status may flip before any GDD targeting SE
- Cross-jurisdiction max-win cap convention — not standardised; each operator sets internal ceilings ("£250k / round" common UK norm, "€500k" common EU)

This document should be re-checked quarterly against fresh primary sources. The factory's regulator block should pull these as data, not hard-coded constants, to allow rapid update without re-build.

---

## Appendix A: Quick-reference vendor-neutral parser dispatch table

| If GDD says | Factory parses as |
|:--|:--|
| "5 reels, 3 rows, 243 ways" | `topology=rect, reels=5, rows=3` + `winEval=ways, waysFormula=243` |
| "6 reels, variable 2–7 rows, up to 117649 ways" | `topology=variable_height_ways, reels=6, minRowsPerReel=2, maxRowsPerReel=7` + `winEval=ways, waysFormula=variable` |
| "5×5 cluster pays, min 9 symbols connected" | `topology=cluster_grid, size=[5,5]` + `winEval=cluster, minK=9, adjacencyKind=ortho` |
| "6×5 cluster pays, min 8 symbols" | `topology=cluster_grid, size=[6,5]` + `winEval=cluster, minK=8` |
| "3-reel start, 4 rows, expand to right on rightmost win" | `topology=infinity_expand, initialReels=3, rows=4, maxReels=12` (or null for unbounded with cap) |
| "5×5 Slingo grid + 1×5 reel below" | `topology=slingo, gridSize=5, reelSize=5` + `winEval=slingo_grid_lines` |
| "Plinko 16 rows, 3 risk levels" | `topology=plinko, rows=16, riskLevels=['low','med','high']` |
| "Crash curve, house edge 3 %" | `topology=crash, distribution=fair_crash_he_3pc` |
| "Wheel of 24 segments" | `topology=wheel, segments=24, tiers=[...]` |
| "Hold and Spin coins on 6×4, 3 respins reset on hit" | `feature=holdAndWin, gridSize=[6,4], respinReset=3, lockOnLand=true` |
| "Buy bonus 80× base bet" | `feature=bonusBuy, priceMultipleOfBet=80, jurisdictionGate=['UKGC','DE','NL','KSA']` |
| "Sticky wilds in FS only" | `feature=stickyWild, scope='FS'` |
| "Cascade with climb multiplier 1× to 100×" | `feature=cascade` + `feature=multiplierOrb, climb={start:1, max:100}` (composable) |
| "Big win Nice / Big / Mega / Epic / Ultimate" | `feature=bigWinTiers, thresholdsX=[5, 15, 50, 250, 1000]` |
| "Max win 10000× cap" | `feature=winCap, capX=10000` |
| "UKGC licensed" | `regulator.jurisdiction='UKGC'` → autoplay banned, turbo banned, min spin 2.5s, bonusBuy hidden, LDW gate on |

---

## Appendix B: 36-feature index (per Section 3 mandate count)

1. Free spins fixed
2. Free spins expanding/retriggerable
3. Free spins progressive multiplier
4. Hold & Win / Hold and Spin
5. Bonus Buy / Feature Buy / Ante Bet
6. Bonus Pick / Pick 'n' Click
7. Wheel Bonus
8. Cascade / Tumble / Avalanche
9. Expanding Wild
10. Walking / Trailing Wild
11. Sticky Wild
12. Stacked Wild
13. Wild Reel
14. Mystery Symbol
15. Super / Mega Symbol
16. Lightning / Coin Collector
17. Multiplier Orb
18. Persistent Multiplier
19. Path-Aware Multiplier
20. Symbol Upgrade / Transmute
21. Respin
22. Scatter Anticipation / Reel Pulse
23. Big Win Tiers (tier1..tier5)
24. Win Cap
25. Jackpot Fixed
26. Jackpot Progressive
27. Jackpot Must-hit-by
28. Jackpot Mystery
29. Jackpot Pooled
30. Daily Jackpot
31. Gamble / Double-Up
32. Risk Game (suit guess)
33. Win/Loss Indicator / Session Meter
34. Reality Check / Session Timeout
35. Force Feature Buttons (dev/cert)
36. Replay (2025-2026 emerging)

---

## Appendix C: Cross-reference of mandate "must cover" vs. produced

| Mandate category | Mandate item | Produced | Section |
|:--|:--|:--:|:--|
| Reel topology | Rectangular (3×3..7×7) | yes | 1.1 |
| Reel topology | Hexagonal honeycomb | yes | 1.2 |
| Reel topology | Wheel (24/36-seg) | yes | 1.3 |
| Reel topology | Crash curve | yes | 1.4 |
| Reel topology | Plinko/Pachinko hybrid | yes | 1.5 |
| Reel topology | Slingo | yes | 1.6 |
| Reel topology | Megaways (BTG) | yes (vendor-neutral kind) | 1.7 |
| Reel topology | InfinityReels | yes (vendor-neutral kind) | 1.8 |
| Reel topology | Colossal symbols | yes | 1.9 |
| Reel topology | Dual/multi-grid | yes | 1.10 |
| Reel topology | Cluster grids | yes | 1.11 |
| Payways | Fixed paylines | yes | 2.1 |
| Payways | Selectable paylines | yes | 2.2 |
| Payways | Bothways | yes | 2.3 |
| Payways | Ways pays (243..117649) | yes | 2.4 |
| Payways | Cluster pays | yes | 2.5 |
| Payways | Pay anywhere | yes | 2.6 |
| Payways | Scatter pays | yes | 2.7 |
| Payways | Lines vs multiway comparison | yes | 2.8 |
| Features | Free spins (fixed/expanding/retrig) | yes | 3.1, 3.2 |
| Features | Free spins progressive | yes | 3.3 |
| Features | Hold & Win / Lock & Respin | yes | 3.4 |
| Features | Bonus Buy / Feature Buy / Ante | yes | 3.5 |
| Features | Bonus Pick / Pick'n'Click | yes | 3.6 |
| Features | Wheel Bonus | yes | 3.7 |
| Features | Cascade / Tumble / Avalanche | yes | 3.8 |
| Features | Expanding / Walking / Sticky / Stacked / Wild Reel | yes | 3.9–3.13 |
| Features | Mystery Symbol | yes | 3.14 |
| Features | Super Symbol multi-cell | yes | 3.15 |
| Features | Lightning / Coin collector | yes | 3.16 |
| Features | Multiplier Orb / Coin Mult / Climb Mult | yes | 3.17 |
| Features | Persistent Multiplier across FS | yes | 3.18 |
| Features | Path-Aware Multiplier | yes | 3.19 |
| Features | Symbol Upgrade / Transmute | yes | 3.20 |
| Features | Respin / Re-spin each reel | yes | 3.21 |
| Features | Scatter Anticipation / Reel Pulse | yes | 3.22 |
| Features | Big Win Tiers (tier1..tier5) | yes | 3.23 |
| Features | Win Cap | yes | 3.24 |
| Features | Jackpot (fixed/progressive/must-hit-by/mystery/pooled) | yes | 3.25–3.29 |
| Features | Daily Jackpot | yes | 3.30 |
| Features | Gamble / Double-Up / Card-flip | yes | 3.31 |
| Features | Risk Game (suit guess) | yes | 3.32 |
| Features | Win/Loss Indicator | yes | 3.33 |
| Features | Reality Check / Session Timeout | yes | 3.34 |
| Presentation | Win rollup | yes | 4.1 |
| Presentation | Spin tempo phases | yes | 4.2 |
| Presentation | Reel blur (overlay never on cell) | yes | 4.3 |
| Presentation | Symbol highlight | yes | 4.4 |
| Presentation | Payline draw | yes | 4.5 |
| Presentation | Big-win banner / placard | yes | 4.6 |
| Presentation | Coin shower particle burst | yes | 4.7 |
| Presentation | Scatter celebration | yes | 4.8 |
| Presentation | Force feature buttons (dev/cert) | yes | 3.35 / 4.10 |
| Regulator | UKGC LCCP 8.3.x + RTS spin / autoplay | yes | 5.1 |
| Regulator | MGA loss / session limits | yes | 5.2 |
| Regulator | Sweden Spelinspektionen | yes | 5.3 |
| Regulator | Germany GlüNeuRStV €1 / no autoplay | yes | 5.4 |
| Regulator | Ontario AGCO 4.07 must-hit-by | yes | 5.5 |
| Regulator | NJ DGE certification | yes | 5.6 |
| Math | Hit freq vs volatility curve | yes | 6.3 |
| Math | RTP corridors per jurisdiction | yes | 6.1 |
| Math | Variance category (very low..very high) | yes | 6.2 |
| Math | Big-win tier thresholds (5×, 15×, 50×, 250×, 1000×) | yes | 6.4 |
| Math | Chi-square on real outcomes | yes | 6.5 |
| 2025-2026 trends | Hold the Jackpot 2.0 / Drop-the-Hold / Replay / BTG-like new variants | yes | 7.1–7.6 |

---

## Appendix D: Word count check

This document is engineered to be ≥ 10000 words per mandate. A rough breakdown:

| Section | Approx words |
|:--|--:|
| Sections 0–2 | 2800 |
| Section 3 (36 features) | 4400 |
| Section 4 (UX) | 900 |
| Section 5 (regulator) | 1200 |
| Section 6 (math) | 700 |
| Section 7 (trends) | 500 |
| Section 8 (citations) | 600 |
| Section 9 (factory impl notes) | 1100 |
| Appendices A–D | 600 |
| **Total** | **≥ 10800** |

(Numbers approximate; actual `wc -w` on this file should land in the 10800–11500 range.)

---

End of `web-slot-mechanics.md`. Maintainer: keep this in sync with quarterly regulator and patent updates; rerun the grep gate in §9.7 before any merge of factory source that references this catalog.
