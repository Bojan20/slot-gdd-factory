/**
 * Faza 13.7 — Dialect normalizers (shape-driven, vendor-agnostic).
 *
 * Each function maps an external config-shape to the canonical
 * GenericGameConfig. Three dialect shapes are supported, named by their
 * structural distinguishing feature (NOT by any vendor product):
 *
 *   - `reel_weight_map`  — per-reel `{ symbolId: weight }` records
 *   - `weighted_pairs`   — per-reel arrays of `{ symbol, weight }` pairs
 *   - `reel_strips`      — per-reel arrays of raw symbol strips
 *
 * Unknown fields pass through unchanged (the framework picks them up as
 * warnings).
 */

import type { GenericGameConfig } from './types.js';

// ─── Reel-weight-map dialect ───────────────────────────────────────────
//
// Distinguished by: `ReelSets` is an array of `{symbolId: weight}` records
// (one per reel set). Common in PascalCase field naming.
//
// Known field mappings:
//   GameId → gameId
//   GameName → gameName
//   GameVersion → gameVersion
//   NumReels → reels
//   NumRows → rows
//   PayTable → paytable (Record<string, number[]>)
//   ReelSets[0] → reelWeights (first reel set)
//   FreeSpins → hasFreeSpins
//   HasWild → hasWild
//   HasScatter → hasScatter
//   BuyFeature → hasBuyFeature
//   Gamble → hasGamble
//   Cascade → hasCascade
//   HoldAndWin → hasHoldAndWin
//   RTP → rtp
//   Paylines → paylines
//   MinBet → minBet
//   MaxBet → maxBet
//   DefaultBet → defaultBet

export function normalizeReelWeightMap(raw: Record<string, unknown>): GenericGameConfig {
  const generic: GenericGameConfig = {
    provider: 'reel_weight_map',
  };

  if (raw['GameId'] !== undefined) generic.gameId = String(raw['GameId']);
  if (raw['GameName'] !== undefined) generic.gameName = String(raw['GameName']);
  if (raw['GameVersion'] !== undefined) generic.gameVersion = String(raw['GameVersion']);
  if (raw['NumReels'] !== undefined) generic.reels = Number(raw['NumReels']);
  if (raw['NumRows'] !== undefined) generic.rows = Number(raw['NumRows']);
  if (raw['RTP'] !== undefined) generic.rtp = Number(raw['RTP']);
  if (raw['MinBet'] !== undefined) generic.minBet = Number(raw['MinBet']);
  if (raw['MaxBet'] !== undefined) generic.maxBet = Number(raw['MaxBet']);
  if (raw['DefaultBet'] !== undefined) generic.defaultBet = Number(raw['DefaultBet']);

  if (raw['PayTable'] !== undefined) {
    generic.paytable = raw['PayTable'] as Record<string, number[]>;
  }
  if (raw['Paylines'] !== undefined) {
    generic.paylines = raw['Paylines'] as number[][] | number;
  }

  // ReelSets: array of reel-weight maps; take first
  if (Array.isArray(raw['ReelSets']) && raw['ReelSets'].length > 0) {
    generic.reelWeights = raw['ReelSets'][0] as Record<string, number>[];
  }

  // Feature flags
  if (raw['FreeSpins'] !== undefined) generic.hasFreeSpins = Boolean(raw['FreeSpins']);
  if (raw['HasWild'] !== undefined) generic.hasWild = Boolean(raw['HasWild']);
  if (raw['HasScatter'] !== undefined) generic.hasScatter = Boolean(raw['HasScatter']);
  if (raw['BuyFeature'] !== undefined) generic.hasBuyFeature = Boolean(raw['BuyFeature']);
  if (raw['Gamble'] !== undefined) generic.hasGamble = Boolean(raw['Gamble']);
  if (raw['Cascade'] !== undefined) generic.hasCascade = Boolean(raw['Cascade']);
  if (raw['HoldAndWin'] !== undefined) generic.hasHoldAndWin = Boolean(raw['HoldAndWin']);

  // Pass remaining unknown fields through
  const known = new Set([
    'GameId', 'GameName', 'GameVersion', 'NumReels', 'NumRows', 'RTP',
    'MinBet', 'MaxBet', 'DefaultBet', 'PayTable', 'Paylines', 'ReelSets',
    'FreeSpins', 'HasWild', 'HasScatter', 'BuyFeature', 'Gamble', 'Cascade',
    'HoldAndWin',
  ]);
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) {
      (generic as Record<string, unknown>)[k] = v;
    }
  }

  return generic;
}

// ─── Weighted-pairs dialect ────────────────────────────────────────────
//
// Distinguished by: `WeightedReels` is an array (per reel) of
// `{symbol, weight}` pair arrays. Common with explicit Lines counter.
//
// Known field mappings:
//   GameCode → gameId
//   GameTitle → gameName
//   Version → gameVersion
//   ReelCount → reels
//   RowCount → rows
//   Lines (number) → paylines
//   WeightedReels → weightedReels
//   PayTable → paytable
//   RTP → rtp
//   Features (string[]) → hasFreeSpins / hasGamble / hasCascade / hasBuyFeature
//   MinBet → minBet
//   MaxBet → maxBet

export function normalizeWeightedPairs(raw: Record<string, unknown>): GenericGameConfig {
  const generic: GenericGameConfig = {
    provider: 'weighted_pairs',
  };

  if (raw['GameCode'] !== undefined) generic.gameId = String(raw['GameCode']);
  if (raw['GameTitle'] !== undefined) generic.gameName = String(raw['GameTitle']);
  if (raw['Version'] !== undefined) generic.gameVersion = String(raw['Version']);
  if (raw['ReelCount'] !== undefined) generic.reels = Number(raw['ReelCount']);
  if (raw['RowCount'] !== undefined) generic.rows = Number(raw['RowCount']);
  if (raw['RTP'] !== undefined) generic.rtp = Number(raw['RTP']);
  if (raw['MinBet'] !== undefined) generic.minBet = Number(raw['MinBet']);
  if (raw['MaxBet'] !== undefined) generic.maxBet = Number(raw['MaxBet']);

  if (raw['PayTable'] !== undefined) {
    generic.paytable = raw['PayTable'] as Record<string, number[]>;
  }

  // Lines: number of lines → stored as number paylines
  if (raw['Lines'] !== undefined) {
    generic.paylines = Number(raw['Lines']);
  }

  if (raw['WeightedReels'] !== undefined) {
    generic.weightedReels = raw['WeightedReels'] as Array<Array<{ symbol: string; weight: number }>>;
  }

  // Features string array
  if (Array.isArray(raw['Features'])) {
    const features = raw['Features'] as string[];
    if (features.includes('FreeSpins')) generic.hasFreeSpins = true;
    if (features.includes('Gamble')) generic.hasGamble = true;
    if (features.includes('Cascade')) generic.hasCascade = true;
    if (features.includes('BuyFeature')) generic.hasBuyFeature = true;
    if (features.includes('HoldAndWin')) generic.hasHoldAndWin = true;
  }

  // Pass remaining unknown fields through
  const known = new Set([
    'GameCode', 'GameTitle', 'Version', 'ReelCount', 'RowCount', 'RTP',
    'MinBet', 'MaxBet', 'Lines', 'WeightedReels', 'PayTable', 'Features',
  ]);
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) {
      (generic as Record<string, unknown>)[k] = v;
    }
  }

  return generic;
}

// ─── Reel-strips dialect ───────────────────────────────────────────────
//
// Distinguished by: `reelSets` is an array (per reel set) of raw symbol
// strip arrays. Common with camelCase field naming.
//
// Known field mappings:
//   id → gameId
//   name → gameName
//   version → gameVersion
//   reelCount → reels
//   rowCount → rows
//   reelSets[0] → reelStrips
//   payoutTable → paytable
//   activeLinesMax → paylines (number)
//   rtp → rtp
//   baseGameFeatures (string[]) → hasFreeSpins / hasCascade / etc.
//   minBet → minBet
//   maxBet → maxBet

export function normalizeReelStrips(raw: Record<string, unknown>): GenericGameConfig {
  const generic: GenericGameConfig = {
    provider: 'reel_strips',
  };

  if (raw['id'] !== undefined) generic.gameId = String(raw['id']);
  if (raw['name'] !== undefined) generic.gameName = String(raw['name']);
  if (raw['version'] !== undefined) generic.gameVersion = String(raw['version']);
  if (raw['reelCount'] !== undefined) generic.reels = Number(raw['reelCount']);
  if (raw['rowCount'] !== undefined) generic.rows = Number(raw['rowCount']);
  if (raw['rtp'] !== undefined) generic.rtp = Number(raw['rtp']);
  if (raw['minBet'] !== undefined) generic.minBet = Number(raw['minBet']);
  if (raw['maxBet'] !== undefined) generic.maxBet = Number(raw['maxBet']);

  if (raw['payoutTable'] !== undefined) {
    generic.paytable = raw['payoutTable'] as Record<string, number[]>;
  }

  // activeLinesMax: number of active paylines
  if (raw['activeLinesMax'] !== undefined) {
    generic.paylines = Number(raw['activeLinesMax']);
  }

  // reelSets: array of reel strips; take first
  if (Array.isArray(raw['reelSets']) && raw['reelSets'].length > 0) {
    generic.reelStrips = raw['reelSets'][0] as string[][];
  }

  // baseGameFeatures string array
  if (Array.isArray(raw['baseGameFeatures'])) {
    const features = raw['baseGameFeatures'] as string[];
    if (features.includes('freeSpins') || features.includes('freespins')) generic.hasFreeSpins = true;
    if (features.includes('avalanche') || features.includes('cascade')) generic.hasCascade = true;
    if (features.includes('gamble')) generic.hasGamble = true;
    if (features.includes('buyFeature') || features.includes('buyBonus')) generic.hasBuyFeature = true;
    if (features.includes('holdAndWin')) generic.hasHoldAndWin = true;
  }

  // Pass remaining unknown fields through
  const known = new Set([
    'id', 'name', 'version', 'reelCount', 'rowCount', 'rtp',
    'minBet', 'maxBet', 'payoutTable', 'activeLinesMax', 'reelSets',
    'baseGameFeatures',
  ]);
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) {
      (generic as Record<string, unknown>)[k] = v;
    }
  }

  return generic;
}
