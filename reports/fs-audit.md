# Free-Spins QA audit · 2026-06-03T22:13:26.766Z

**Fixtures**: 24 · **FS-enabled**: 18 · **Failures**: 1 · ⚠️ ATTENTION

## Per-fixture results

| Slug | Kind | FS | Intro | Active | Outro | Base | Spins | Retrig | Mult | Total | Errs |
|---|---|:--:|---|---|---|---|--:|--:|--:|--:|--:|
| 01_rectangular_5x3_game_gdd | rectangular | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 109.4 | 0 |
| 02_rectangular_6x4_game_gdd | rectangular | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 44.48 | 0 |
| 03_cluster_7x7_game_gdd | cluster | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 04_variable_reel_game_gdd | variable_reel | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 39.26 | 0 |
| 05_megaclusters_game_gdd | megaclusters | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 06_hexagonal_game_gdd | hexagonal | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 07_diamond_game_gdd | diamond | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 3.17 | 0 |
| 08_pyramid_game_gdd | pyramid | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 190.62 | 0 |
| 09_cross_game_gdd | cross | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 88.71 | 0 |
| 10_lshape_game_gdd | l_shape | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 153.25 | 0 |
| 11_radial_game_gdd | radial | ✅ | ✅ 15 FS | ✅ fs-mode-purple | ✅ | ✅ | 30 | 3 | ×1 | 111.29 | 0 |
| 12_infinity_game_gdd | infinity | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 13_expanding_game_gdd | expanding | ✅ | ❌ intro state wrong | ❌ | ❌ | ✅ | 0 | 0 | ×1 | 0 | 0 |
| 14_dual_colossal_game_gdd | dual | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 187.3 | 0 |
| 15_slingo_game_gdd | slingo | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 122.22 | 0 |
| 16_plinko_game_gdd | plinko | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 17_crash_game_gdd | crash | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 18_wheel_game_gdd | wheel | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 212.36 | 0 |
| 19_lock_respin_game_gdd | lock_respin | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 32.28 | 0 |
| 20_rectangular_stacked_scatter_game_gdd | rectangular | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 20 | 0 | ×1 | 56.17 | 0 |
| crystal_forge_game_gdd | rectangular | ✅ | ✅ 15 FS | ✅ fs-mode-crimson | ✅ | ✅ | 15 | 0 | ×8 | 604.13 | 0 |
| gates_of_olympus_1000_game_gdd | rectangular | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 25 | 3 | ×1 | 217.21 | 0 |
| midnight_fangs_game_gdd | cluster | ✅ | ✅ 20 FS | ✅ fs-mode-crimson | ✅ | ✅ | 35 | 3 | ×10 | 2073.18 | 0 |
| wrath_of_olympus_game_gdd | rectangular | ✅ | ✅ 14 FS | ✅ fs-mode-gold | ✅ | ✅ | 14 | 0 | ×10 | 932.34 | 0 |

## Screenshots (FS-enabled fixtures only)

### 01_rectangular_5x3_game_gdd (rectangular)

- intro: [`qa/fs/01_rectangular_5x3_game_gdd/intro.png`](./qa/fs/01_rectangular_5x3_game_gdd/intro.png)
- active: [`qa/fs/01_rectangular_5x3_game_gdd/active.png`](./qa/fs/01_rectangular_5x3_game_gdd/active.png)
- outro: [`qa/fs/01_rectangular_5x3_game_gdd/outro.png`](./qa/fs/01_rectangular_5x3_game_gdd/outro.png)
- base:  [`qa/fs/01_rectangular_5x3_game_gdd/base.png`](./qa/fs/01_rectangular_5x3_game_gdd/base.png)

### 02_rectangular_6x4_game_gdd (rectangular)

- intro: [`qa/fs/02_rectangular_6x4_game_gdd/intro.png`](./qa/fs/02_rectangular_6x4_game_gdd/intro.png)
- active: [`qa/fs/02_rectangular_6x4_game_gdd/active.png`](./qa/fs/02_rectangular_6x4_game_gdd/active.png)
- outro: [`qa/fs/02_rectangular_6x4_game_gdd/outro.png`](./qa/fs/02_rectangular_6x4_game_gdd/outro.png)
- base:  [`qa/fs/02_rectangular_6x4_game_gdd/base.png`](./qa/fs/02_rectangular_6x4_game_gdd/base.png)

### 04_variable_reel_game_gdd (variable_reel)

- intro: [`qa/fs/04_variable_reel_game_gdd/intro.png`](./qa/fs/04_variable_reel_game_gdd/intro.png)
- active: [`qa/fs/04_variable_reel_game_gdd/active.png`](./qa/fs/04_variable_reel_game_gdd/active.png)
- outro: [`qa/fs/04_variable_reel_game_gdd/outro.png`](./qa/fs/04_variable_reel_game_gdd/outro.png)
- base:  [`qa/fs/04_variable_reel_game_gdd/base.png`](./qa/fs/04_variable_reel_game_gdd/base.png)

### 07_diamond_game_gdd (diamond)

- intro: [`qa/fs/07_diamond_game_gdd/intro.png`](./qa/fs/07_diamond_game_gdd/intro.png)
- active: [`qa/fs/07_diamond_game_gdd/active.png`](./qa/fs/07_diamond_game_gdd/active.png)
- outro: [`qa/fs/07_diamond_game_gdd/outro.png`](./qa/fs/07_diamond_game_gdd/outro.png)
- base:  [`qa/fs/07_diamond_game_gdd/base.png`](./qa/fs/07_diamond_game_gdd/base.png)

### 08_pyramid_game_gdd (pyramid)

- intro: [`qa/fs/08_pyramid_game_gdd/intro.png`](./qa/fs/08_pyramid_game_gdd/intro.png)
- active: [`qa/fs/08_pyramid_game_gdd/active.png`](./qa/fs/08_pyramid_game_gdd/active.png)
- outro: [`qa/fs/08_pyramid_game_gdd/outro.png`](./qa/fs/08_pyramid_game_gdd/outro.png)
- base:  [`qa/fs/08_pyramid_game_gdd/base.png`](./qa/fs/08_pyramid_game_gdd/base.png)

### 09_cross_game_gdd (cross)

- intro: [`qa/fs/09_cross_game_gdd/intro.png`](./qa/fs/09_cross_game_gdd/intro.png)
- active: [`qa/fs/09_cross_game_gdd/active.png`](./qa/fs/09_cross_game_gdd/active.png)
- outro: [`qa/fs/09_cross_game_gdd/outro.png`](./qa/fs/09_cross_game_gdd/outro.png)
- base:  [`qa/fs/09_cross_game_gdd/base.png`](./qa/fs/09_cross_game_gdd/base.png)

### 10_lshape_game_gdd (l_shape)

- intro: [`qa/fs/10_lshape_game_gdd/intro.png`](./qa/fs/10_lshape_game_gdd/intro.png)
- active: [`qa/fs/10_lshape_game_gdd/active.png`](./qa/fs/10_lshape_game_gdd/active.png)
- outro: [`qa/fs/10_lshape_game_gdd/outro.png`](./qa/fs/10_lshape_game_gdd/outro.png)
- base:  [`qa/fs/10_lshape_game_gdd/base.png`](./qa/fs/10_lshape_game_gdd/base.png)

### 11_radial_game_gdd (radial)

- intro: [`qa/fs/11_radial_game_gdd/intro.png`](./qa/fs/11_radial_game_gdd/intro.png)
- active: [`qa/fs/11_radial_game_gdd/active.png`](./qa/fs/11_radial_game_gdd/active.png)
- outro: [`qa/fs/11_radial_game_gdd/outro.png`](./qa/fs/11_radial_game_gdd/outro.png)
- base:  [`qa/fs/11_radial_game_gdd/base.png`](./qa/fs/11_radial_game_gdd/base.png)

### 13_expanding_game_gdd (expanding)

- intro: [`qa/fs/13_expanding_game_gdd/intro.png`](./qa/fs/13_expanding_game_gdd/intro.png)
- active: [`qa/fs/13_expanding_game_gdd/active.png`](./qa/fs/13_expanding_game_gdd/active.png)
- outro: [`qa/fs/13_expanding_game_gdd/outro.png`](./qa/fs/13_expanding_game_gdd/outro.png)
- base:  [`qa/fs/13_expanding_game_gdd/base.png`](./qa/fs/13_expanding_game_gdd/base.png)

### 14_dual_colossal_game_gdd (dual)

- intro: [`qa/fs/14_dual_colossal_game_gdd/intro.png`](./qa/fs/14_dual_colossal_game_gdd/intro.png)
- active: [`qa/fs/14_dual_colossal_game_gdd/active.png`](./qa/fs/14_dual_colossal_game_gdd/active.png)
- outro: [`qa/fs/14_dual_colossal_game_gdd/outro.png`](./qa/fs/14_dual_colossal_game_gdd/outro.png)
- base:  [`qa/fs/14_dual_colossal_game_gdd/base.png`](./qa/fs/14_dual_colossal_game_gdd/base.png)

### 15_slingo_game_gdd (slingo)

- intro: [`qa/fs/15_slingo_game_gdd/intro.png`](./qa/fs/15_slingo_game_gdd/intro.png)
- active: [`qa/fs/15_slingo_game_gdd/active.png`](./qa/fs/15_slingo_game_gdd/active.png)
- outro: [`qa/fs/15_slingo_game_gdd/outro.png`](./qa/fs/15_slingo_game_gdd/outro.png)
- base:  [`qa/fs/15_slingo_game_gdd/base.png`](./qa/fs/15_slingo_game_gdd/base.png)

### 18_wheel_game_gdd (wheel)

- intro: [`qa/fs/18_wheel_game_gdd/intro.png`](./qa/fs/18_wheel_game_gdd/intro.png)
- active: [`qa/fs/18_wheel_game_gdd/active.png`](./qa/fs/18_wheel_game_gdd/active.png)
- outro: [`qa/fs/18_wheel_game_gdd/outro.png`](./qa/fs/18_wheel_game_gdd/outro.png)
- base:  [`qa/fs/18_wheel_game_gdd/base.png`](./qa/fs/18_wheel_game_gdd/base.png)

### 19_lock_respin_game_gdd (lock_respin)

- intro: [`qa/fs/19_lock_respin_game_gdd/intro.png`](./qa/fs/19_lock_respin_game_gdd/intro.png)
- active: [`qa/fs/19_lock_respin_game_gdd/active.png`](./qa/fs/19_lock_respin_game_gdd/active.png)
- outro: [`qa/fs/19_lock_respin_game_gdd/outro.png`](./qa/fs/19_lock_respin_game_gdd/outro.png)
- base:  [`qa/fs/19_lock_respin_game_gdd/base.png`](./qa/fs/19_lock_respin_game_gdd/base.png)

### 20_rectangular_stacked_scatter_game_gdd (rectangular)

- intro: [`qa/fs/20_rectangular_stacked_scatter_game_gdd/intro.png`](./qa/fs/20_rectangular_stacked_scatter_game_gdd/intro.png)
- active: [`qa/fs/20_rectangular_stacked_scatter_game_gdd/active.png`](./qa/fs/20_rectangular_stacked_scatter_game_gdd/active.png)
- outro: [`qa/fs/20_rectangular_stacked_scatter_game_gdd/outro.png`](./qa/fs/20_rectangular_stacked_scatter_game_gdd/outro.png)
- base:  [`qa/fs/20_rectangular_stacked_scatter_game_gdd/base.png`](./qa/fs/20_rectangular_stacked_scatter_game_gdd/base.png)

### crystal_forge_game_gdd (rectangular)

- intro: [`qa/fs/crystal_forge_game_gdd/intro.png`](./qa/fs/crystal_forge_game_gdd/intro.png)
- active: [`qa/fs/crystal_forge_game_gdd/active.png`](./qa/fs/crystal_forge_game_gdd/active.png)
- outro: [`qa/fs/crystal_forge_game_gdd/outro.png`](./qa/fs/crystal_forge_game_gdd/outro.png)
- base:  [`qa/fs/crystal_forge_game_gdd/base.png`](./qa/fs/crystal_forge_game_gdd/base.png)

### gates_of_olympus_1000_game_gdd (rectangular)

- intro: [`qa/fs/gates_of_olympus_1000_game_gdd/intro.png`](./qa/fs/gates_of_olympus_1000_game_gdd/intro.png)
- active: [`qa/fs/gates_of_olympus_1000_game_gdd/active.png`](./qa/fs/gates_of_olympus_1000_game_gdd/active.png)
- outro: [`qa/fs/gates_of_olympus_1000_game_gdd/outro.png`](./qa/fs/gates_of_olympus_1000_game_gdd/outro.png)
- base:  [`qa/fs/gates_of_olympus_1000_game_gdd/base.png`](./qa/fs/gates_of_olympus_1000_game_gdd/base.png)

### midnight_fangs_game_gdd (cluster)

- intro: [`qa/fs/midnight_fangs_game_gdd/intro.png`](./qa/fs/midnight_fangs_game_gdd/intro.png)
- active: [`qa/fs/midnight_fangs_game_gdd/active.png`](./qa/fs/midnight_fangs_game_gdd/active.png)
- outro: [`qa/fs/midnight_fangs_game_gdd/outro.png`](./qa/fs/midnight_fangs_game_gdd/outro.png)
- base:  [`qa/fs/midnight_fangs_game_gdd/base.png`](./qa/fs/midnight_fangs_game_gdd/base.png)

### wrath_of_olympus_game_gdd (rectangular)

- intro: [`qa/fs/wrath_of_olympus_game_gdd/intro.png`](./qa/fs/wrath_of_olympus_game_gdd/intro.png)
- active: [`qa/fs/wrath_of_olympus_game_gdd/active.png`](./qa/fs/wrath_of_olympus_game_gdd/active.png)
- outro: [`qa/fs/wrath_of_olympus_game_gdd/outro.png`](./qa/fs/wrath_of_olympus_game_gdd/outro.png)
- base:  [`qa/fs/wrath_of_olympus_game_gdd/base.png`](./qa/fs/wrath_of_olympus_game_gdd/base.png)

## Notes
- **13_expanding_game_gdd**: intro: {"overlayVisible":false,"cta":"TAP TO BEGIN","placardSpins":"10","title":"FREE SPINS","spinBtnDisabled":false,"devBtnDisabled":false}
- **13_expanding_game_gdd**: active: {"overlayVisible":false,"hudVisible":false,"bodyMode":null,"status":"PRESS SPIN","phase":"BASE"}
- **13_expanding_game_gdd**: outro: {"phase":"BASE","overlayVisible":false,"title":"FREE SPINS","total":"10","cta":"TAP TO BEGIN","fsm":{"phase":"BASE","spinsTotal":0,"spinsRemaining":0,"mult":1,"totalWin":0,"retrigCount":0}}
