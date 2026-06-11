/**
 * src/registry/utilityRail.mjs
 *
 * Shared utility-rail slot offsets for the bottom-left chip rail.
 * Rail stack (bottom-up): settings → paytable → history.
 *
 * Hoisted from inline CSS magic numbers so rail spacing stays in sync
 * across blocks and edits don't drift (per 2026-06-09 audit).
 */

export const RAIL_SLOT_OFFSETS = Object.freeze({
  settings: Object.freeze({ desktop: 96,  mobile: 88  }),
  paytable: Object.freeze({ desktop: 156, mobile: 148 }),
  history:  Object.freeze({ desktop: 216, mobile: 208 }),
});

export const RAIL_Z_INDEX = 35;
