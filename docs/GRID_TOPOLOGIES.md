# Slot Grid Topologies — Authoritative Catalog

> Industry research deep-seek (2024–2026). Used by `src/parser.mjs` to detect
> and `src/gridShape.mjs` to render. Every GDD that lands in `samples/`
> must classify under exactly **one** of the canonical `kind` values below.

## 🔑 Canonical `topology.kind` values

| `kind` | Class | Render strategy |
|---|---|---|
| `rectangular` | Classic / Cluster / Scatter Pays / Cascade | Uniform CSS grid `repeat(reels, cell) × repeat(rows, cell)` |
| `variable_reel` | Megaways / Trueways / Diamond / Pyramid | Per-column `rows_per_reel[i]` flexbox row of columns |
| `cluster` | Cluster Pays (5×5 / 7×7 / 8×8) | Uniform grid, evaluation flag only — no paylines line |
| `megaclusters` | BTG Megaclusters | Recursive 4-quadrant split visual |
| `hexagonal` | Honeycomb (e.g. Honey Rush) | Hex-tile CSS, offset rows |
| `diamond` | MultiWay Xtra (3-4-5-4-3) | Per-column rows array, center-justified |
| `pyramid` | 1-3-5-3-1 trapezoid | Per-column rows array, top-justified |
| `cross` | Cruciform | Mask grid with 4 corners blanked |
| `l_shape` | Step grid | Mask grid with 1 corner blanked |
| `radial` | Wheel / Spoke | Polar/SVG render, segment ring |
| `infinity` | InfiniReels / Infinity Reels | Rectangular base + horizontal grow indicator |
| `expanding` | PopWins / GigaRise | Rectangular base + vertical grow indicator |
| `dual` | Colossal Reels / Dual Play | Two side-by-side grids |
| `slingo` | Slingo bingo+reel hybrid | 5×5 board + 1×5 reel strip below |
| `plinko` | Peg matrix | Triangular peg dots SVG |
| `crash` | Single-line multiplier curve | SVG curve placeholder |
| `wheel` | Bonus / Crazy-Time wheel | Polar SVG with N segments |
| `lock_respin` | Hold & Win / Money Train shape | Rectangular grid with `locked` overlay slots |

## 📐 Fixed rectangular dimensions

| Dimension | Naming | Example games | Eval |
|---|---|---|---|
| 3×1 | Single-line classic | Liberty Bell, Lucky 7s | 1 payline |
| 3×3 | Mini classic | Mega Joker, Jackpot 6000 | 1–5 paylines |
| 3×5 | Lock-respin compact | Wolf Gold base | Paylines |
| 4×4 | Square mini | Star Clusters base | Cluster |
| 4×5 | Half-tall | retro / niche | Paylines |
| **5×3** | **Industry standard** | Starburst, Book of Dead, Cleopatra | 10–25 paylines / 243 ways |
| 5×4 | Wide-tall | Bonanza base, Buffalo | 40 paylines / 1024 ways |
| 5×5 | Square | Aloha! Cluster Pays, Reactoonz | Cluster / 5+ adjacency |
| 5×6 | Tall-5 | Wolf Run Eclipse | 720 ways |
| 5×8 | Mega-tall | GigaRise (max) | Paylines + expand |
| 5×9 | Max-tall | CherryPop bonus max | Both-ways |
| 5×12 | Colossal upper | Spartacus upper grid | 100 lines across dual |
| 6×3 | Wide standard | xWays games | 243+ ways |
| 6×4 | Sweet-wide | Gigablox base, Hades | 4096 ways |
| **6×5** | **Megaways / Scatter Pay** | Sweet Bonanza, Gates of Olympus | Scatter pays |
| 6×6 | Sweet-tall | Sugar Rush, Aztec PowerNudge | Scatter/cluster |
| 6×8 | Pop-tall | HippoPop max | Both-ways |
| 7×7 | Cluster square | Jammin' Jars, Reactoonz 2 | Cluster |
| 8×8 | Big cluster | Reactoonz max-state | Cluster |
| 10×10 | Mega cluster | Star Clusters Mega max | Cluster split |
| 16×16 | Megaclusters max | Star Clusters Megaclusters | Quarter-split cluster |

## 🔀 Variable per-reel dimensions

| Shape | Naming | Vendor | Ways/eval |
|---|---|---|---|
| 6×(2–7) | Megaways classic | Big Time Gaming | up to 117 649 |
| 6×(2–8) | Megaways extended | various licensees | up to 200 704 |
| 6×(2–8) + top reel | Megaways + horizontal | various | up to 248 832 |
| 6×(2–8) | Trueways | BGaming | up to 262 144 |
| [3,4,5,4,3] | Diamond / MultiWay Xtra | IGT | 720 both-ways |
| [3,4,5,7,5,4,3] | Wider diamond | bespoke | varies |
| [1,3,5,3,1] | Pyramid / trapezoid | bespoke | 9–27 lines |

## 📈 Growing/expanding dimensions

| Shape | Naming | Vendor | Trigger |
|---|---|---|---|
| 5×3 → 5×(3..9) | PopWins expanding | AvatarUX | Pop on win |
| 5×3 → 5×8 | GigaRise expanding | Yggdrasil | Free-spin level |
| 3×3 → ∞ columns | InfiniReels | NetEnt | Same symbol on right edge |
| 3×3 / 3×4 → ∞ columns | Infinity Reels | ReelPlay | Match on rightmost |
| 6×4 with 2×2–6×6 mega | Gigablox mega-symbol | Yggdrasil | Spawned mega |

## 🟥 Multi-grid / dual

| Layout | Naming | Game |
|---|---|---|
| 5×4 + 5×12 | Colossal Reels dual | Spartacus, Forbidden Dragons |
| 5×3 + 5×3 | Dual Play side-by-side | Da Vinci Diamonds Dual Play |
| 5×3 + bonus grid | Linked-state dual | Twin Spin family |

## 🎨 Non-rectangular / hybrid

| Shape | Naming | Game |
|---|---|---|
| 5×5 bingo + 1×5 reel below | Slingo | Slingo Rainbow Riches, Slingo Starburst |
| Triangle peg matrix (~16 rows) | Plinko | Spribe Plinko, Stake Plinko |
| Curve / single-line crash | Crash | Aviator, Spaceman |
| Wheel (24–48 segments) | Wheel-based | Wheel of Fortune, Crazy Time |
| Honeycomb hex tiles | Hexagonal | Honey Rush (Play'n GO) |

## 📊 Coverage matrix

| Class | Mainstream dims (must-have) | Edge dims (nice-to-have) |
|---|---|---|
| `rectangular` | 3×3, 5×3, 5×4, 5×5, 6×4, 6×5, 6×6, 7×7, 8×8 | 3×1, 3×5, 4×4, 4×5, 5×6, 5×8, 5×9, 5×12, 6×3, 6×8, 10×10, 16×16 |
| `variable_reel` | 6×[2..7], 6×[2..8], [3,4,5,4,3] | [1,3,5,3,1], [3,4,5,7,5,4,3] |
| `expanding` | 5×3 → 5×9, 5×3 → 5×8 | — |
| `infinity` | 3×3 → ∞, 3×4 → ∞ | — |
| `dual` | 5×4 + 5×12, 5×3 + 5×3 | — |
| `cluster` | 5×5, 7×7, 8×8 | 4×4, 10×10 |
| `megaclusters` | 4×4 → 16×16 | — |
| `hexagonal` | hex grid up to 7 ring | — |
| `diamond` | [3,4,5,4,3] | wider variants |
| `pyramid` | [1,3,5,3,1] | — |
| `slingo` | 5×5 + 1×5 | — |
| `plinko` | 16-row triangle | — |
| `crash` | 1-line curve | — |
| `wheel` | 24–48 segments | — |
| `radial` | 6/8 spoke | — |
| `cross` / `l_shape` | 5×5 cruciform / step | — |
| `lock_respin` | 5×3, 5×4, 6×4 | — |

## 🔁 Mechanic flags (can stack on any `kind`)

These are independent boolean topology traits — any rectangular game can ALSO have:

| Flag | Meaning |
|---|---|
| `cascade.enabled` | Symbols fall after wins (tumble/avalanche) |
| `lock_respin` | Symbols lock in place during respin (H&W) |
| `twin_reels` | Adjacent reels mirror each other |
| `mirrored_reels` | Left half mirrors right half |
| `growable` | Grid grows on trigger (Infinity Reels) |
| `tiered_rows` | Rows grow from N → M on feature |
| `grid_count` | 1 (single), 2 (dual), 4 (quad) |

## 🚫 Math out-of-scope

Per Boki decree (2026-06-02): this parser/renderer touches **zero math**.
No RTP, no volatility, no max-win, no reel weights, no payouts. Math layer
(PAR sheet hot-swap) is Phase 2, separate concern.

The shape descriptor returns:
- Geometric layout (columns, rows, cell positions)
- Visual layout type (`kind`)
- Mechanic flags (cascade, lock, expand)

It does **NOT** return:
- Reel strips, symbol weights, paytable
- RTP, hit-frequency, variance
- Spin outcomes
