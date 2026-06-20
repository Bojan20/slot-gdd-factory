/**
 * src/registry/blockMapper.mjs
 *
 * Wave W2 + W3 + W4 — AI block selector / orchestrator.
 *
 * Why
 * ---
 * 193 LEGO blocks live in `src/blocks/`. Today `buildSlotHTML.mjs` hand-picks
 * which blocks to include via a static canonical list — every block that
 * matters is mounted unconditionally. Wave W flips this: given a parsed
 * model (regex baseline OR Wave V reconcile output), the mapper decides
 * which blocks to ACTUALLY activate, with a confidence score and conflict
 * resolution.
 *
 * What
 * ----
 * - W2: `mapGddToBlocks(model, catalog)` → { activated, rejected }
 * - W3: `scoreBlock(block, model)` → 0..1 confidence
 * - W4: `resolveConflicts(activated, catalog)` → activated minus losers
 *
 * Scoring formula
 *   score =
 *     0.50 · gddDeclared       (model.__declared has this featureKind)
 *   + 0.25 · keywordHit        (block.intentStrings appear in GDD model)
 *   + 0.15 · structuralFit     (topology.kind ↔ block's natural topology)
 *   + 0.10 · subscribeReadiness (lifecycle hooks the block needs are wired)
 *
 * Thresholds
 *   ≥ 0.65          → auto-on
 *   0.35 .. 0.65    → warn + manual review (returned in `softMatches`)
 *   < 0.35          → off
 *
 * Conflict resolution
 *   Pairs/families that share a canonical domain (e.g. expandingWild vs
 *   walkingWild vs stickyWild) compete. Winner = highest score; loser
 *   moves to rejected[] with reason 'conflict_lost'.
 *
 * @module blockMapper
 *
 * Public API
 *   loadCatalog(catalogJsonPath) → Catalog
 *   mapGddToBlocks(model, catalog?) → MapResult
 *   scoreBlock(blockEntry, model) → number
 *   resolveConflicts(blockIds[], catalog) → { winners, rejected }
 */

const CONF_AUTO_ON = 0.65;
const CONF_WARN    = 0.35;

const TOPOLOGY_BLOCK_FIT = Object.freeze({
  rectangular:    ['paylines', 'paytable', 'reelEngine', 'tumble', 'cascadeBooster'],
  cluster:        ['clusterPaysEval', 'tumble', 'clusterSizeMultiplier'],
  variable_rows:  ['waysEval', 'dynamicWaysEngine'],
  hex:            ['hexReelEngine', 'hexClusterEngine'],
  pyramid:        ['pyramidGridEngine'],
  diamond:        ['pyramidGridEngine'],
  cross:          ['paylines'],
  lshape:         ['paylines'],
  radial:         ['wheelSpinEngine', 'wheelBonus', 'weightedWheelSegments'],
  infinity:       ['infinityReels', 'infinityReelsEngine'],
  expanding:      ['expandingWild', 'reelHeightAdapter'],
  dual:           ['dualRoleScatter'],
  slingo:         ['slingoSpinEngine'],
  plinko:         ['plinkoSpinEngine'],
  crash:          ['crashSpinEngine'],
  wheel:          ['wheelSpinEngine', 'wheelBonus', 'weightedWheelSegments'],
  lock_respin:    ['holdAndWin', 'reelLockHold'],
});

const ALWAYS_ON = Object.freeze([
  /* Infra blocks that mount on every slot regardless of GDD */
  'hookBus', 'themeCSS', 'paytable', 'spinControl', 'reelEngine',
  'reelEngineCSS', 'spinTempo', 'winPresentation', 'winRollup',
  'postSpin', 'autoplay', 'balanceHud', 'betSelector', 'historyLog',
  'paylines', 'paylineOverlay', 'uiToast', 'forceSkip', 'slamStop',
  'gddRealityCheck', 'universalForcePanel',
]);

/* ── helpers ─────────────────────────────────────────────────────────── */

function _declaredKindsFromModel(model) {
  /* Wave V reconcile output puts model.__activeFeatures__ + model.__declared
   * + model.features[]. We harvest all three so the mapper works against
   * regex-only baselines too. */
  const set = new Set();
  if (Array.isArray(model?.__activeFeatures__)) {
    for (const f of model.__activeFeatures__) {
      if (typeof f === 'string') set.add(f);
      else if (f && f.kind) set.add(f.kind);
    }
  }
  if (model?.__declared && typeof model.__declared === 'object') {
    for (const k of Object.keys(model.__declared)) set.add(k);
  }
  if (Array.isArray(model?.features)) {
    for (const f of model.features) if (f && f.kind) set.add(f.kind);
  }
  return set;
}

function _topologyKind(model) {
  const t = model?.topology || {};
  return t.kind || t.shape || null;
}

function _gddTextBlob(model) {
  /* Stitched discovery blob for keyword hit. Lower-cased + joined. */
  const parts = [];
  if (model?.name) parts.push(model.name);
  if (model?.theme) {
    const th = model.theme;
    if (th.mood) parts.push(th.mood);
    if (th.setting) parts.push(th.setting);
    if (Array.isArray(th.tags)) parts.push(th.tags.join(' '));
    if (Array.isArray(th.vibeRefs)) parts.push(th.vibeRefs.join(' '));
  }
  if (Array.isArray(model?.features)) {
    for (const f of model.features) {
      if (f?.label) parts.push(f.label);
      if (f?.kind) parts.push(f.kind);
    }
  }
  return parts.join(' ').toLowerCase();
}

/* ── scoring ─────────────────────────────────────────────────────────── */

export function scoreBlock(blockEntry, model) {
  if (!blockEntry || !model) return 0;

  /* Always-on blocks bypass scoring — they're permanent infra. */
  if (ALWAYS_ON.includes(blockEntry.id)) return 1.0;

  const declared = _declaredKindsFromModel(model);
  const topoKind = _topologyKind(model);
  const blob     = _gddTextBlob(model);

  /* 1. gddDeclared — block's featureKinds intersect declared set */
  const ownKinds = Array.isArray(blockEntry.featureKinds) ? blockEntry.featureKinds : [];
  const declaredHit = ownKinds.some((k) => declared.has(k));
  const gddDeclared = declaredHit ? 1 : 0;

  /* 2. keywordHit — block's intent strings present in GDD blob */
  const intents = Array.isArray(blockEntry.intentStrings) ? blockEntry.intentStrings : [];
  const intentHits = intents.filter((s) => blob.includes(s)).length;
  const keywordHit = intents.length === 0 ? 0 : Math.min(1, intentHits / Math.max(1, Math.min(3, intents.length)));

  /* 3. structuralFit — topology natural fit */
  const topoFit = topoKind && TOPOLOGY_BLOCK_FIT[topoKind] || [];
  const structuralFit = topoFit.includes(blockEntry.id) ? 1 : 0;

  /* 4. subscribeReadiness — block needs lifecycle hooks; we presume the
   * canonical HookBus mounts them all, so this is mainly a "has hooks at
   * all" check. Blocks with zero lifecycle integration are not driven
   * by the spin engine and tend to be pure UI/CSS — score 0.5 baseline. */
  const hookCount = Array.isArray(blockEntry.lifecycleHooks) ? blockEntry.lifecycleHooks.length : 0;
  const subscribeReadiness = hookCount === 0 ? 0.5 : 1;

  const score =
      0.50 * gddDeclared
    + 0.25 * keywordHit
    + 0.15 * structuralFit
    + 0.10 * subscribeReadiness;

  return Math.max(0, Math.min(1, +score.toFixed(3)));
}

/* ── conflict resolution ─────────────────────────────────────────────── */

export function resolveConflicts(activatedScored, catalog) {
  /* activatedScored: [{ id, score, ... }]. Walk catalog conflictsWith
   * pairs and demote the lower-scored peer. */
  const scoreById = new Map(activatedScored.map((b) => [b.id, b.score]));
  const winners = new Set(activatedScored.map((b) => b.id));
  const rejected = [];
  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  for (const blk of activatedScored) {
    if (!winners.has(blk.id)) continue;
    const meta = catalogById.get(blk.id);
    if (!meta || !Array.isArray(meta.conflictsWith)) continue;
    for (const peerId of meta.conflictsWith) {
      if (!winners.has(peerId)) continue;
      const peerScore = scoreById.get(peerId) || 0;
      if (peerScore < blk.score) {
        winners.delete(peerId);
        rejected.push({ id: peerId, reason: 'conflict_lost', against: blk.id, score: peerScore });
      } else if (peerScore > blk.score) {
        winners.delete(blk.id);
        rejected.push({ id: blk.id, reason: 'conflict_lost', against: peerId, score: blk.score });
        break;
      }
      /* Ties keep both — they're not mutually exclusive in practice. */
    }
  }

  return {
    winners:  activatedScored.filter((b) => winners.has(b.id)),
    rejected,
  };
}

/* ── main mapping ─────────────────────────────────────────────────────── */

/**
 * Given a parsed model and a block catalog, decide which blocks to activate.
 *
 * @param {object} model — parser/Wave V model
 * @param {object} catalog — { catalog: [...] } from blockCatalog.json
 * @returns {{ activated, softMatches, rejected, scorecard }}
 */
export function mapGddToBlocks(model, catalog) {
  const blocks = Array.isArray(catalog?.catalog) ? catalog.catalog : (Array.isArray(catalog) ? catalog : []);
  if (!blocks.length) {
    return { activated: [], softMatches: [], rejected: [], scorecard: { error: 'empty catalog' } };
  }

  /* 1. Score every block */
  const scored = blocks.map((b) => ({
    id:         b.id,
    score:      scoreBlock(b, model),
    kinds:      b.featureKinds || [],
    purpose:    b.purpose || '',
  }));

  /* 2. Classify by threshold */
  const auto    = scored.filter((b) => b.score >= CONF_AUTO_ON);
  const soft    = scored.filter((b) => b.score >= CONF_WARN && b.score < CONF_AUTO_ON);
  const off     = scored.filter((b) => b.score < CONF_WARN);

  /* 3. Conflict resolution on auto-on set */
  const { winners, rejected: conflictLosers } = resolveConflicts(auto, blocks);

  /* 4. Scorecard */
  const scorecard = {
    blocksScored:    scored.length,
    activated:       winners.length,
    softMatches:     soft.length,
    off:             off.length,
    conflictLosers:  conflictLosers.length,
    avgScore:        +(scored.reduce((s, b) => s + b.score, 0) / scored.length).toFixed(3),
  };

  return {
    activated:   winners.sort((a, b) => b.score - a.score),
    softMatches: soft.sort((a, b) => b.score - a.score),
    rejected:    [
      ...off.map((b) => ({ id: b.id, reason: 'low_score', score: b.score })),
      ...conflictLosers,
    ],
    scorecard,
  };
}

/* ── catalog loader (Node-only, opt-in) ──────────────────────────────── */

export async function loadCatalog(jsonPath) {
  const fs = await import('node:fs/promises');
  const raw = await fs.readFile(jsonPath, 'utf8');
  return JSON.parse(raw);
}
