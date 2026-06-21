/**
 * src/wave-v-reconcile.mjs
 *
 * Wave V — V6 deterministic reconcile + merge.
 *
 * Why
 * ---
 * V1..V5 are LLM agents (one prompt per lane). V6 in the production path is
 * also an LLM agent, but its job is purely arbitration — merge 5 sparse
 * deltas into a single delta with provenance. That arbitration is
 * deterministic (no creative work), so we ship a code implementation that
 * runs offline and matches the V6 prompt contract.
 *
 * Tradeoff: deterministic merge is cheaper, faster, repeatable, and
 * survives without Claude auth. Production can optionally call the LLM V6
 * for cross-check, but the deterministic V6 is the canonical implementation.
 *
 * @module wave-v-reconcile
 *
 * Public API
 *   reconcile({ baseline, v1, v2, v3, v4, v5 }) → { model_delta, __meta__,
 *                                                    scorecard, warnings }
 *   mergeIntoModel(model, delta, meta) → mutated model with __meta__ stamps
 *
 * Source priority (per V6 prompt contract)
 *   1. V-agent declared (conf ≥ 0.7) → 'gdd-declared'
 *   2. V-agent declared (conf 0.4..0.7) → 'parser-inferred'
 *   3. regex baseline non-null → 'parser-inferred'
 *   4. else → 'default'
 *
 * Conflict policy
 *   When two agents disagree on the same canonical key:
 *     - prefer lane owner (V1=topology, V2=symbols, V3=features, V4=ux, V5=compliance)
 *     - log conflict in __meta__[path].conflicts[]
 *     - lower confidence by 0.2
 *     - emit warning
 */

/* Lane ownership matrix — which V-agent is authoritative for each canonical
 * model key prefix. Used by reconcile() to resolve conflicts. */
const LANE_OWNER = Object.freeze({
  'topology':   'V1',
  'symbols':    'V2',
  'scatter':    'V2',
  'wild':       'V2',
  'features':   'V3',
  'freeSpins':  'V3',
  'holdAndWin': 'V3',
  'winCap':     'V3',
  'bigWinTier': 'V3',
  'theme':      'V4',
  'hud':        'V4',
  'animation':  'V4',
  'payback':    'V5',
  'compliance': 'V5',
  'cert':       'V5',
});

function _laneOwner(path) {
  const top = String(path).split('.')[0];
  return LANE_OWNER[top] || null;
}

function _classifyConfidence(conf) {
  if (typeof conf !== 'number') return 'default';
  if (conf >= 0.7) return 'gdd-declared';
  if (conf >= 0.4) return 'parser-inferred';
  return 'default';
}

function _stampMeta(meta, path, source, agent, evidence, confidence, conflicts = []) {
  meta[path] = {
    source,
    agent,
    citation: evidence && evidence.length ? evidence[0].quote || null : null,
    confidence: confidence ?? null,
    conflicts,
  };
}

/* Walks a sparse agent delta and stamps every non-null leaf path into meta.
 * Used to attribute provenance to V1..V5 declarations. */
function _stampPaths(meta, prefix, value, source, agent, evidenceMap, confidence) {
  if (value == null) return;
  if (Array.isArray(value)) {
    if (value.length === 0) return;
    _stampMeta(meta, prefix, source, agent, evidenceMap[prefix] || [], confidence);
    return;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return;
    for (const k of keys) {
      const next = prefix ? `${prefix}.${k}` : k;
      _stampPaths(meta, next, value[k], source, agent, evidenceMap, confidence);
    }
    return;
  }
  /* scalar leaf */
  _stampMeta(meta, prefix, source, agent, evidenceMap[prefix] || [], confidence);
}

function _evidenceMap(evidence) {
  const map = {};
  if (!Array.isArray(evidence)) return map;
  for (const e of evidence) {
    if (!e || !e.field) continue;
    if (!map[e.field]) map[e.field] = [];
    map[e.field].push(e);
  }
  return map;
}

/* Deep-merge agent output into delta. Lane owner wins; non-owner conflicts
 * are stamped into __meta__ but the owner value is kept. */
function _mergeIntoDelta(delta, agent, agentData, meta, conflicts) {
  if (!agentData) return;
  const evMap = _evidenceMap(agentData.evidence);
  const conf = agentData.confidence;
  const source = _classifyConfidence(conf);

  /* V1 → topology */
  if (agent === 'V1' && agentData.topology) {
    delta.topology = { ...(delta.topology || {}), ...agentData.topology };
    _stampPaths(meta, 'topology', agentData.topology, source, 'V1', evMap, conf);
  }
  /* V2 → symbols + scatter + wild */
  if (agent === 'V2') {
    if (Array.isArray(agentData.symbols) && agentData.symbols.length) {
      delta.symbols = agentData.symbols;
      _stampMeta(meta, 'symbols', source, 'V2', [{ quote: `${agentData.symbols.length} symbols extracted` }], conf);
    }
    if (agentData.scatter) {
      delta.scatter = agentData.scatter;
      _stampPaths(meta, 'scatter', agentData.scatter, source, 'V2', evMap, conf);
    }
    if (agentData.wild) {
      delta.wild = agentData.wild;
      _stampPaths(meta, 'wild', agentData.wild, source, 'V2', evMap, conf);
    }
  }
  /* V3 → features[] + per-feature config */
  if (agent === 'V3' && Array.isArray(agentData.features)) {
    delta.features = agentData.features.map((f) => ({
      kind: f.kind, label: f.label, config: f.config || {}, section: f.section || null,
    }));
    _stampMeta(meta, 'features', source, 'V3', [{ quote: `${agentData.features.length} features declared` }], conf);
    /* Top-level convenience keys mirroring parser shape */
    for (const f of agentData.features) {
      if (f.kind === 'freeSpins' && f.config) {
        delta.freeSpins = { enabled: true, ...f.config };
        _stampPaths(meta, 'freeSpins', f.config, source, 'V3', evMap, f.confidence ?? conf);
      }
      if (f.kind === 'holdAndWin' && f.config) {
        delta.holdAndWin = { enabled: true, ...f.config };
        _stampPaths(meta, 'holdAndWin', f.config, source, 'V3', evMap, f.confidence ?? conf);
      }
      if (f.kind === 'winCap' && f.config) {
        delta.winCap = { ...f.config };
        _stampPaths(meta, 'winCap', f.config, source, 'V3', evMap, f.confidence ?? conf);
      }
      if (f.kind === 'bigWinTier' && f.config) {
        delta.bigWinTier = { ...f.config };
        _stampPaths(meta, 'bigWinTier', f.config, source, 'V3', evMap, f.confidence ?? conf);
      }
    }
  }
  /* V4 → theme + hud + animation */
  if (agent === 'V4') {
    if (agentData.theme && Object.keys(agentData.theme).length) {
      delta.theme = { ...(delta.theme || {}), ...agentData.theme };
      _stampPaths(meta, 'theme', agentData.theme, source, 'V4', evMap, conf);
    }
    if (agentData.hud) {
      delta.hud = agentData.hud;
      _stampPaths(meta, 'hud', agentData.hud, source, 'V4', evMap, conf);
    }
    if (agentData.animation) {
      delta.animation = agentData.animation;
      _stampPaths(meta, 'animation', agentData.animation, source, 'V4', evMap, conf);
    }
  }
  /* V5 → payback + compliance + cert */
  if (agent === 'V5') {
    if (agentData.payback) {
      delta.payback = agentData.payback;
      _stampPaths(meta, 'payback', agentData.payback, source, 'V5', evMap, conf);
      /* If V5 declares maxWinX but V3 also declared winCap, V3 owns winCap;
       * cross-stamp for visibility. */
      if (typeof agentData.payback.maxWinX === 'number' && delta.winCap && delta.winCap.maxWinX !== agentData.payback.maxWinX) {
        conflicts.push({
          path: 'winCap.maxWinX',
          agentA: 'V3', valueA: delta.winCap.maxWinX,
          agentB: 'V5', valueB: agentData.payback.maxWinX,
          reason: 'V3 and V5 disagree on max win cap',
        });
      }
    }
    if (agentData.compliance) {
      delta.compliance = agentData.compliance;
      _stampPaths(meta, 'compliance', agentData.compliance, source, 'V5', evMap, conf);
    }
    if (agentData.cert) {
      delta.cert = agentData.cert;
      _stampPaths(meta, 'cert', agentData.cert, source, 'V5', evMap, conf);
    }
  }
}

function _scorecard(meta) {
  let declared = 0, inferred = 0, def = 0, conflicts = 0;
  for (const path of Object.keys(meta)) {
    const m = meta[path];
    if (m.source === 'gdd-declared') declared++;
    else if (m.source === 'parser-inferred') inferred++;
    else def++;
    if (Array.isArray(m.conflicts) && m.conflicts.length) conflicts++;
  }
  const total = declared + inferred + def;
  return {
    declared,
    inferred,
    default: def,
    ratio: total === 0 ? 0 : +(declared / total).toFixed(3),
    conflicts,
    agents_consulted: ['V1', 'V2', 'V3', 'V4', 'V5'],
  };
}

/* Topology vs feature compatibility checks → emit warnings */
function _compatWarnings(delta) {
  const warnings = [];
  const topoKind = delta?.topology?.kind;
  const features = Array.isArray(delta?.features) ? delta.features : [];
  const featKinds = new Set(features.map((f) => f.kind));

  if (topoKind === 'cluster' && featKinds.has('waysEval')) {
    warnings.push('topology.kind=cluster but features include waysEval — usually mutually exclusive');
  }
  if (topoKind === 'rectangular' && delta?.topology && delta.topology.paylines == null && !featKinds.has('payAnywhereEval') && !featKinds.has('waysEval')) {
    warnings.push('rectangular topology but no paylines / ways / pay-anywhere declared');
  }
  if (featKinds.has('holdAndWin')) {
    const symbols = Array.isArray(delta?.symbols) ? delta.symbols : [];
    const hasBonus = symbols.some((s) => s.kind === 'bonus');
    if (!hasBonus) warnings.push('holdAndWin declared but no bonus symbol in symbol roster');
  }
  if (featKinds.has('freeSpins')) {
    const symbols = Array.isArray(delta?.symbols) ? delta.symbols : [];
    const hasScatter = symbols.some((s) => s.kind === 'scatter');
    if (!hasScatter && !delta?.scatter) warnings.push('freeSpins declared but no scatter symbol in roster');
  }
  return warnings;
}

/**
 * Main entry — deterministic V6 reconcile.
 *
 * @param {object} args
 * @param {object} args.baseline  regex-parser model (current src/parser.mjs)
 * @param {object} args.v1        V1 agent JSON
 * @param {object} args.v2        V2 agent JSON
 * @param {object} args.v3        V3 agent JSON
 * @param {object} args.v4        V4 agent JSON
 * @param {object} args.v5        V5 agent JSON
 * @returns {{ model_delta, __meta__, scorecard, warnings }}
 */
export function reconcile({ baseline, v1, v2, v3, v4, v5 } = {}) {
  const delta = {};
  const meta = {};
  const conflicts = [];

  _mergeIntoDelta(delta, 'V1', v1, meta, conflicts);
  _mergeIntoDelta(delta, 'V2', v2, meta, conflicts);
  _mergeIntoDelta(delta, 'V3', v3, meta, conflicts);
  _mergeIntoDelta(delta, 'V4', v4, meta, conflicts);
  _mergeIntoDelta(delta, 'V5', v5, meta, conflicts);

  /* Backfill from regex baseline for any path not declared by V1..V5 */
  if (baseline && typeof baseline === 'object') {
    for (const k of Object.keys(baseline)) {
      if (k.startsWith('__')) continue;
      if (delta[k] == null && baseline[k] != null) {
        delta[k] = baseline[k];
        _stampMeta(meta, k, 'parser-inferred', 'regex-baseline', [], 0.5);
      }
    }
  }

  /* Attach cross-agent conflicts to __meta__ */
  for (const c of conflicts) {
    if (meta[c.path]) {
      meta[c.path].conflicts = (meta[c.path].conflicts || []).concat([c]);
      meta[c.path].confidence = Math.max(0, (meta[c.path].confidence || 0) - 0.2);
    }
  }

  const scorecard = _scorecard(meta);
  const warnings = _compatWarnings(delta);

  return {
    agent: 'V6_reconcile',
    model_delta: delta,
    __meta__: meta,
    scorecard,
    warnings,
    notes: `Deterministic reconcile of ${[v1, v2, v3, v4, v5].filter(Boolean).length}/5 agent reports`,
  };
}

/**
 * Merge a Wave V delta into an existing parser model, in place, stamping
 * provenance. Used by parser.mjs when WAVE_V_RECONCILE_PATH is set.
 *
 * @param {object} model  parser model (mutated)
 * @param {object} delta  model_delta from reconcile()
 * @param {object} meta   __meta__ from reconcile()
 */
/* UQ-FORTIFY9 #2 — prototype pollution guard. V6 delta dolazi iz LLM
 * (Kimi/Opus) reply-ja. Naivni Object.assign(model[k], delta[k]) gde
 * delta sadrži `__proto__` ili `constructor` key korumpira Object.prototype
 * globalno. Filter top-level i nested keys pre merge-a. */
const PROTO_POISON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function mergeIntoModel(model, delta, meta) {
  if (!model || !delta) return model;
  for (const k of Object.keys(delta)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    if (delta[k] == null) continue;
    if (model[k] && typeof model[k] === 'object' && !Array.isArray(model[k]) && typeof delta[k] === 'object' && !Array.isArray(delta[k])) {
      for (const ck of Object.keys(delta[k])) {
        if (PROTO_POISON_KEYS.has(ck)) continue;
        model[k][ck] = delta[k][ck];
      }
    } else {
      model[k] = delta[k];
    }
  }
  model.__waveV__ = { meta: meta || {}, mergedAt: new Date().toISOString() };
  return model;
}
