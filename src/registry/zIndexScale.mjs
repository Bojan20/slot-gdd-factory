/**
 * src/registry/zIndexScale.mjs
 *
 * UQ-DEEP-AO · AO-5 · Centralized z-index discrete scale.
 *
 * Why this exists
 * ───────────────
 *   Pre-AO-5 the codebase contained ad-hoc magic z-index values across 80+
 *   blocks, with several anti-pattern offenders:
 *
 *     • themeCSS dev-CTAs used z-index 2147483000 (close to INT32_MAX).
 *       A z-index that large is a stacking-context killer — anything in a
 *       sibling stacking context (and many compliance / interruption
 *       overlays) could never paint on top, even when semantically they
 *       MUST be on top (e.g. mandatory regulator modals).
 *
 *     • Three independent blocks (patternWin, jackpotRoomReveal,
 *       realityCheck) all coincidentally used z-index 9000 — a silent
 *       collision: whichever mounted last won the painting battle, with
 *       results that depended on DOM insertion order rather than on
 *       semantic precedence.
 *
 *     • grandInterruptionLock at 10000, hotReload at 99990, holdAndWin at
 *       1900, freeSpins at 200 — every block author picked their own
 *       "big" number with no shared contract.
 *
 *   This module defines the single source of truth for layer ordering.
 *   Each layer gets a discrete slot in a 0..1000 window (4-digit cap), with
 *   100-unit gaps so sub-layers can stack inside a window without changing
 *   the global ordering. ALL new blocks MUST import `Z` from here.
 *
 * Schema
 * ──────
 *   SCHEMA_VERSION = '1'.  Bumping the schema (e.g. inserting a new layer
 *   above MODAL_DIALOG) is a breaking change and must be co-ordinated with
 *   any block whose CSS reads Z values at runtime.
 *
 * Test contract
 * ─────────────
 *   tests/registry/zIndexScale.test.mjs enforces:
 *     • Z is frozen.
 *     • Layer ordering invariants (compliance > modal > HUD > game > bg).
 *     • All values in [0, 1000].
 *     • All values distinct (no silent collision).
 *     • No live z-index of 9000 or 2147483000 in src/blocks/*.mjs.
 *     • Migrated blocks import Z from this registry.
 *
 *   Bump SCHEMA_VERSION and update the test suite together.
 */

export const SCHEMA_VERSION = '1';

/* Industry-standard z-index discrete scale.
 * Each layer gets a 100-unit window for sub-layer ordering.
 * Total range: 0..1000 (4-digit cap). themeCSS 2.1B was anti-pattern. */
export const Z = Object.freeze({
  /* Background layer */
  BACKGROUND:           0,    /* base game background art                 */
  THEME_CSS_RESERVED:   30,   /* themeCSS reserved background gradient    */
  BACKGROUND_OVERLAY:   50,   /* atmospheric overlays (e.g. ambient wheel)*/

  /* Game layer */
  GAME_GRID:            100,  /* reel grid                                */
  GAME_CELL_OVERLAY:    150,  /* cell glow, lock badge                    */
  GAME_WIN_OVERLAY:     180,  /* win highlight                            */

  /* HUD layer */
  HUD_BACKGROUND:       200,  /* HUD chrome                               */
  HUD_CONTROLS:         250,  /* spin button, autoplay                    */
  HUD_BADGE:            280,  /* drift badge, RTP HUD                     */

  /* Bonus layer */
  BONUS_OVERLAY:        400,  /* free spins intro                         */
  BONUS_MODAL:          450,  /* bonus pick screen                        */

  /* Modal layer */
  MODAL_BACKDROP:       500,  /* dim background                           */
  MODAL_DIALOG:         550,  /* paytable, settings                       */

  /* Toast / notification layer */
  TOAST:                600,  /* user notifications                       */

  /* Reality check / compliance layer */
  COMPLIANCE_MODAL:     700,  /* mandatory regulator notices              */

  /* Jackpot / celebration */
  JACKPOT_CELEBRATION:  750,  /* big-win flash, jackpot reveal            */

  /* Pattern / accent */
  PATTERN_WIN:          780,  /* pattern-win celebration                  */

  /* Interruption / emergency */
  GRAND_INTERRUPTION:   900,  /* grand-interruption lock screen           */

  /* Dev tools */
  DEV_HOT_RELOAD:       990,  /* hot reload toast + dev force CTAs        */
});

/* Helper: get z-index for layer name; fallback to 0 (BACKGROUND). */
export function zFor(layerName) {
  return Z[layerName] !== undefined ? Z[layerName] : 0;
}
