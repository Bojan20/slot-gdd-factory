# Render-all-grids QA report

**Generated**: 2026-06-04T03:22:58.244Z
**Fixtures**: 20 · **PASS**: 20 · **FAIL**: 0 · **Rate**: 100.0%

## Summary table

| # | Fixture | Expected | Actual | R×R | Cells | Cols | Sub | Conf | Parse ms | Status |
|--:|---|---|---|---|--:|--:|--:|--:|--:|:--:|
| 1 | `01_rectangular_5x3_GAME_GDD.md` | rectangular | rectangular | 5×3 | 15 | 5 | 0 | 100% | 9.5 | ✅ |
| 2 | `02_rectangular_6x4_GAME_GDD.md` | rectangular | rectangular | 6×4 | 24 | 6 | 0 | 100% | 6.5 | ✅ |
| 3 | `03_cluster_7x7_GAME_GDD.md` | cluster | cluster | 7×7 | 49 | 7 | 0 | 100% | 0.3 | ✅ |
| 4 | `04_variable_reel_GAME_GDD.md` | variable_reel | variable_reel | 6×7 | 28 | 6 | 0 | 100% | 0.4 | ✅ |
| 5 | `05_megaclusters_GAME_GDD.md` | megaclusters | megaclusters | 4×4 | 16 | 4 | 0 | 100% | 0.2 | ✅ |
| 6 | `06_hexagonal_GAME_GDD.md` | hexagonal | hexagonal | 7×7 | 37 | 7 | 0 | 100% | 0.3 | ✅ |
| 7 | `07_diamond_GAME_GDD.md` | diamond | diamond | 5×5 | 19 | 5 | 0 | 100% | 0.2 | ✅ |
| 8 | `08_pyramid_GAME_GDD.md` | pyramid | pyramid | 5×5 | 13 | 5 | 0 | 100% | 0.2 | ✅ |
| 9 | `09_cross_GAME_GDD.md` | cross | cross | 5×5 | 21 | 5 | 0 | 100% | 0.2 | ✅ |
| 10 | `10_lshape_GAME_GDD.md` | l_shape | l_shape | 5×5 | 21 | 5 | 0 | 100% | 0.2 | ✅ |
| 11 | `11_radial_GAME_GDD.md` | radial | radial | 8×1 | 8 | 1 | 0 | 100% | 0.2 | ✅ |
| 12 | `12_infinity_GAME_GDD.md` | infinity | infinity | 3×3 | 9 | 3 | 0 | 100% | 0.1 | ✅ |
| 13 | `13_expanding_GAME_GDD.md` | expanding | expanding | 5×3 | 15 | 5 | 0 | 100% | 0.1 | ✅ |
| 14 | `14_dual_colossal_GAME_GDD.md` | dual | dual | 5×4 | 20 | 5 | 1 | 100% | 0.2 | ✅ |
| 15 | `15_slingo_GAME_GDD.md` | slingo | slingo | 5×5 | 25 | 5 | 1 | 100% | 0.3 | ✅ |
| 16 | `16_plinko_GAME_GDD.md` | plinko | plinko | 17×16 | 136 | 16 | 0 | 100% | 0.2 | ✅ |
| 17 | `17_crash_GAME_GDD.md` | crash | crash | 1×1 | 1 | 1 | 0 | 100% | 0.2 | ✅ |
| 18 | `18_wheel_GAME_GDD.md` | wheel | wheel | 1×24 | 24 | 1 | 0 | 100% | 0.2 | ✅ |
| 19 | `19_lock_respin_GAME_GDD.md` | lock_respin | lock_respin | 5×4 | 20 | 5 | 0 | 100% | 0.1 | ✅ |
| 20 | `20_rectangular_stacked_scatter_GAME_GDD.md` | rectangular | rectangular | 5×4 | 20 | 5 | 0 | 100% | 0.3 | ✅ |

## Shape notes

| Fixture | shapeNote |
|---|---|
| `01_rectangular_5x3_GAME_GDD.md` | 5×3 rectangular |
| `02_rectangular_6x4_GAME_GDD.md` | 6×4 rectangular |
| `03_cluster_7x7_GAME_GDD.md` | 7×7 cluster |
| `04_variable_reel_GAME_GDD.md` | 6×[2,5,7,7,5,2] variable per-reel |
| `05_megaclusters_GAME_GDD.md` | 4×4 megaclusters (splits to 8×8) |
| `06_hexagonal_GAME_GDD.md` | hex ring=3 (37 tiles) |
| `07_diamond_GAME_GDD.md` | [3-4-5-4-3] diamond |
| `08_pyramid_GAME_GDD.md` | [1-3-5-3-1] pyramid |
| `09_cross_GAME_GDD.md` | 5×5 cross (corner blank=1) |
| `10_lshape_GAME_GDD.md` | 5×5 L-shape (corner blank=2) |
| `11_radial_GAME_GDD.md` | radial 8-spoke |
| `12_infinity_GAME_GDD.md` | 3×3 → ∞ horizontal (infinity reels) |
| `13_expanding_GAME_GDD.md` | 5×3 → 5×9 expanding |
| `14_dual_colossal_GAME_GDD.md` | Colossal dual: 5×4 + 5×12 |
| `15_slingo_GAME_GDD.md` | slingo 5×5 board + 1×5 strip |
| `16_plinko_GAME_GDD.md` | plinko 16-row triangle |
| `17_crash_GAME_GDD.md` | crash multiplier curve |
| `18_wheel_GAME_GDD.md` | wheel 24-segment |
| `19_lock_respin_GAME_GDD.md` | 5×4 lock-respin (Hold & Win) |
| `20_rectangular_stacked_scatter_GAME_GDD.md` | 5×4 rectangular |