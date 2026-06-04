# Free-Spins QA audit · 2026-06-04T02:51:24.277Z

**Fixtures**: 24 · **FS-enabled**: 18 · **Failures**: 5 · ⚠️ ATTENTION

## Per-fixture results

| Slug | Kind | FS | Intro | Active | Outro | Base | Spins | Retrig | Mult | Total | Errs |
|---|---|:--:|---|---|---|---|--:|--:|--:|--:|--:|
| 01_rectangular_5x3_game_gdd | rectangular | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 84.47 | 0 |
| 02_rectangular_6x4_game_gdd | rectangular | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ❌ | ❌ | 10 | 0 | ×1 | 25.87 | 1 |
| 03_cluster_7x7_game_gdd | cluster | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 04_variable_reel_game_gdd | variable_reel | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ❌ | ❌ | 10 | 0 | ×1 | 0.44 | 1 |
| 05_megaclusters_game_gdd | megaclusters | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 06_hexagonal_game_gdd | hexagonal | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 07_diamond_game_gdd | diamond | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ❌ | ❌ | 10 | 0 | ×1 | 14.45 | 1 |
| 08_pyramid_game_gdd | pyramid | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 185.12 | 0 |
| 09_cross_game_gdd | cross | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 42.33 | 0 |
| 10_lshape_game_gdd | l_shape | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 155.08 | 0 |
| 11_radial_game_gdd | radial | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 195.78 | 0 |
| 12_infinity_game_gdd | infinity | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 13_expanding_game_gdd | expanding | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ❌ | ❌ | 35 | 3 | ×1 | 0 | 1 |
| 14_dual_colossal_game_gdd | dual | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 117.82 | 0 |
| 15_slingo_game_gdd | slingo | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 58.59 | 0 |
| 16_plinko_game_gdd | plinko | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 17_crash_game_gdd | crash | ⊝ | ✅ FS off (button disabled) | — | — | — | 0 | 0 | ×1 | 0 | 0 |
| 18_wheel_game_gdd | wheel | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 35 | 3 | ×1 | 102.77 | 0 |
| 19_lock_respin_game_gdd | lock_respin | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 10 | 0 | ×1 | 28.73 | 0 |
| 20_rectangular_stacked_scatter_game_gdd | rectangular | ✅ | ✅ 20 FS | ✅ fs-mode-purple | ✅ | ✅ | 20 | 0 | ×1 | 103.64 | 0 |
| crystal_forge_game_gdd | rectangular | ✅ | ✅ 12 FS | ✅ fs-mode-crimson | ✅ | ✅ | 22 | 2 | ×8 | 687.69 | 0 |
| gates_of_olympus_1000_game_gdd | rectangular | ✅ | ✅ 10 FS | ✅ fs-mode-purple | ✅ | ✅ | 25 | 3 | ×1 | 100.16 | 0 |
| midnight_fangs_game_gdd | cluster | ✅ | ✅ 15 FS | ✅ fs-mode-crimson | ❌ | ❌ | 30 | 3 | ×10 | 116.17 | 1 |
| wrath_of_olympus_game_gdd | rectangular | ✅ | ✅ 14 FS | ✅ fs-mode-gold | ✅ | ✅ | 19 | 1 | ×10 | 605.16 | 0 |

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
- **02_rectangular_6x4_game_gdd**: outro: {"phase":"FS_ACTIVE","overlayVisible":false,"title":"FREE SPINS","total":"10","cta":"TAP TO BEGIN","fsm":{"phase":"FS_ACTIVE","spinsTotal":10,"spinsRemaining":7,"mult":1,"totalWin":25.869999999999997,"retrigCount":0}}
- **02_rectangular_6x4_game_gdd**: base: {"phase":"FS_ACTIVE","overlayVisible":false,"hudVisible":true,"bodyMode":"fs-mode-purple","spinBtnDisabled":true,"status":"FS · 3 / 10"}
- **02_rectangular_6x4_game_gdd**: console errs: pageerror: Cannot read properties of undefined (reading 'add')
- **04_variable_reel_game_gdd**: outro: {"phase":"FS_ACTIVE","overlayVisible":false,"title":"FREE SPINS","total":"10","cta":"TAP TO BEGIN","fsm":{"phase":"FS_ACTIVE","spinsTotal":10,"spinsRemaining":9,"mult":1,"totalWin":0.44,"retrigCount":0}}
- **04_variable_reel_game_gdd**: base: {"phase":"FS_ACTIVE","overlayVisible":false,"hudVisible":true,"bodyMode":"fs-mode-purple","spinBtnDisabled":true,"status":"FS · 1 / 10"}
- **04_variable_reel_game_gdd**: console errs: pageerror: Cannot read properties of undefined (reading 'add')
- **07_diamond_game_gdd**: outro: {"phase":"FS_ACTIVE","overlayVisible":false,"title":"FREE SPINS","total":"10","cta":"TAP TO BEGIN","fsm":{"phase":"FS_ACTIVE","spinsTotal":10,"spinsRemaining":9,"mult":1,"totalWin":14.45,"retrigCount":0}}
- **07_diamond_game_gdd**: base: {"phase":"FS_ACTIVE","overlayVisible":false,"hudVisible":true,"bodyMode":"fs-mode-purple","spinBtnDisabled":true,"status":"FS · 1 / 10"}
- **07_diamond_game_gdd**: console errs: pageerror: Cannot read properties of undefined (reading 'add')
- **13_expanding_game_gdd**: outro: {"phase":"FS_ACTIVE","overlayVisible":false,"title":"FREE SPINS","total":"20","cta":"TAP TO BEGIN","fsm":{"phase":"FS_ACTIVE","spinsTotal":35,"spinsRemaining":28,"mult":1,"totalWin":0,"retrigCount":3}}
- **13_expanding_game_gdd**: base: {"phase":"FS_ACTIVE","overlayVisible":false,"hudVisible":true,"bodyMode":"fs-mode-purple","spinBtnDisabled":true,"status":"FS · 7 / 35"}
- **13_expanding_game_gdd**: console errs: pageerror: Cannot read properties of undefined (reading 'add')
- **midnight_fangs_game_gdd**: outro: {"phase":"FS_ACTIVE","overlayVisible":false,"title":"FREE SPINS","total":"15","cta":"TAP TO BEGIN","fsm":{"phase":"FS_ACTIVE","spinsTotal":30,"spinsRemaining":21,"mult":10,"totalWin":116.17,"retrigCount":3}}
- **midnight_fangs_game_gdd**: base: {"phase":"FS_ACTIVE","overlayVisible":false,"hudVisible":true,"bodyMode":"fs-mode-crimson","spinBtnDisabled":true,"status":"FS · 9 / 30"}
- **midnight_fangs_game_gdd**: console errs: pageerror: Cannot read properties of undefined (reading 'add')
