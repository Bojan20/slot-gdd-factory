import { applySmartDefaults } from './registry/smartDefaults.mjs';
/* Optional Node-only handle for Wave V overlay. Top-level dynamic import
 * happens once at module load. The import is wrapped so a browser bundle
 * that strips `node:*` still loads the parser. */
const _waveVFs = await (async () => {
  try {
    const mod = await import('node:fs');
    return mod && (mod.default || mod);
  } catch (_) { return null; }
})();

/**
 * Slot GDD Factory · pure parser module
 * No DOM, no globals — safe to import from Node tests and from app.js.
 *
 * Public API:
 *   parseGDD(text, ext) → ParsedModel
 *   normalizeFromJSON(obj) → ParsedModel
 *
 * ParsedModel shape:
 *   { name, theme: {tags, palette, mood}, topology: {reels, rows, paylines},
 *     symbols: {high[], mid[], low[], specials[]},
 *     features: [{kind, label}],
 *     confidence: {name, topology, symbols, features} }
 *
 * Math (RTP / volatility / max-win / paytable / reel weights) is OUT OF SCOPE
 * of this phase. Boki explicit decree — "nikakva matematika se ne radi dok ne
 * odradimo savrseno game gdd". Math layer lands in a later phase with PAR
 * hot-swap injector, not here.
 */

export function parseGDD(text, ext) {
  /* Wave P1 — defensive entry guard.
     A completely unreadable input (null / undefined / non-string / corrupt
     JSON) must NEVER throw out of the parser. We return a freshModel() with
     a synthetic `_failures` entry so downstream code (`buildSlotHTML`, UI
     badges, regulator probes) can detect the partial-parse condition. */
  if (text == null) {
    const m = freshModel();
    m.confidence._failures.push({ label: 'input', error: 'null/undefined input' });
    return m;
  }
  if (typeof text !== 'string') {
    try {
      text = String(text);
    } catch {
      const m = freshModel();
      m.confidence._failures.push({ label: 'input', error: 'non-stringifiable input' });
      return m;
    }
  }
  /* Wave W47.S22 Edge-Case A — strip UTF-8 BOM (﻿) if present.
   * MS-authored / Notion-exported markdown frequently leads with a BOM
   * which collides with the `^#\s+` heading regex → name extraction
   * silently fell back to "Untitled Slot". One char strip, no allocation
   * unless BOM actually present. */
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  if (ext === 'json') {
    try {
      return normalizeFromJSON(JSON.parse(text));
    } catch (err) {
      /* JSON GDD malformed → fall through to markdown parser. Most "json"
         uploads that fail JSON.parse are actually JS-flavored configs with
         comments / trailing commas; the markdown extractor will still pull
         what it can from the raw text. */
      const m = parseMarkdownGDD(text);
      m.confidence._failures.unshift({ label: 'json.parse', error: String(err && err.message || err) });
      return m;
    }
  }
  // md / markdown / txt — regex / table parser
  return parseMarkdownGDD(text);
}

/* ── _safeExtract — Wave P1 isolation harness ───────────────────────────────
 *
 * Every top-level `extractXxx(text, model)` call in `parseMarkdownGDD()` is
 * routed through this wrapper. If the extractor throws (corrupt regex group,
 * bad table layout, unicode confusion, etc.) the failure is recorded on
 * `model.confidence._failures[]` and parsing continues with the next section.
 *
 * Why a wrapper instead of inline try/catch per extractor:
 *   - one place enforces the failure schema (label + error message)
 *   - extractors stay readable (single body, no try/catch boilerplate)
 *   - tests can assert on `_failures.length` to detect regressions
 *
 * Senior-grade contract:
 *   - never throws (catches Error and non-Error throws)
 *   - never mutates the model on failure (extractor is expected to mutate;
 *     wrapper only adds the failure record)
 *   - O(1) overhead on the happy path (one try/catch, no allocation)
 */
function _safeExtract(label, fn, model) {
  try {
    return fn();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    model.confidence._failures.push({ label, error: message });
    return undefined;
  }
}

/* ─── markdown GDD parser ──────────────────────────────────── */
export function parseMarkdownGDD(text) {
  const model = freshModel();
  /* Wave P1 — outer guard against unreadable input. parseGDD() already
     coerces null/undefined; this is a belt-and-braces check for callers
     that invoke parseMarkdownGDD() directly (tests, dev tooling). */
  if (typeof text !== 'string' || text.length === 0) {
    model.confidence._failures.push({ label: 'parseMarkdownGDD.input', error: 'empty or non-string input' });
    return model;
  }

  /* Wave P1 — every section below is wrapped by `_safeExtract`. A single
     malformed regex group / corrupt table / unicode confusion can never
     abort the whole parse; the offending section is recorded in
     `model.confidence._failures[]` and the next section runs as normal. */

  /* name — H1 heading, or "Internal name" table cell */
  _safeExtract('header.name', () => {
    const h1 = text.match(/^#\s+(.+?)(?:\s+—|\s+-|\s+:|\s+\(|$)/m);
    if (h1) {
      model.name = h1[1].trim();
      model.confidence.name += 0.5;
    }
    const internalName = text.match(/\|\s*\*?\*?Internal name\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
    if (internalName) {
      model.name = internalName[1].replace(/\*\*/g, '').trim();
      model.confidence.name = 1.0;
    }
  }, model);

  /* theme block — tags / mood / palette / setting / typography / vibe / genre / market */
  _safeExtract('theme.tags', () => {
    const themeTags = text.match(/\|\s*\*?\*?Theme tags\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
    if (themeTags) {
      model.theme.tags = themeTags[1]
        .replace(/\*\*/g, '')
        .split(/[·•,\/]/)
        .map(s => s.trim())
        .filter(Boolean);
    }
  }, model);

  _safeExtract('theme.mood', () => {
    const mood = text.match(/\|\s*\*?\*?Mood\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
    if (mood) model.theme.mood = mood[1].replace(/\*\*/g, '').trim();
  }, model);

  _safeExtract('theme.palette', () => {
    const hexes = text.match(/#[0-9a-fA-F]{6}/g);
    if (hexes) model.theme.palette = [...new Set(hexes)].slice(0, 6);
  }, model);

  _safeExtract('theme.setting', () => {
    const setting = text.match(/\|\s*\*?\*?Setting\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
    if (setting) model.theme.setting = setting[1].replace(/\*\*/g, '').trim();
  }, model);

  _safeExtract('theme.typography', () => {
    const typo = text.match(/\|\s*\*?\*?Typography\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
    if (typo) model.theme.typography = typo[1].replace(/\*\*/g, '').trim();
  }, model);

  _safeExtract('theme.vibe_refs', () => {
    const vibe = text.match(/\|\s*\*?\*?Vibe\s+references?\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
    if (vibe) model.theme.vibe_refs = vibe[1].replace(/\*\*/g, '').trim();
  }, model);

  _safeExtract('theme.genre', () => {
    const genre = text.match(/\|\s*\*?\*?Genre\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
    if (genre) model.theme.genre = genre[1].replace(/\*\*/g, '').trim();
  }, model);

  _safeExtract('theme.target_market', () => {
    const market = text.match(/\|\s*\*?\*?Target\s+market\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
    if (market) model.theme.target_market = market[1].replace(/\*\*/g, '').trim();
  }, model);

  /* topology — full coverage of industry shapes (Phase-G grid expansion) */
  _safeExtract('extractTopology', () => extractTopology(text, model), model);

  /* symbols */
  _safeExtract('extractSymbolBlock.high', () => extractSymbolBlock(text, /High[\s-]?pay/i, model.symbols.high), model);
  _safeExtract('extractSymbolBlock.mid', () => extractSymbolBlock(text, /Mid[\s-]?pay/i, model.symbols.mid), model);
  _safeExtract('extractSymbolBlock.low', () => extractSymbolBlock(text, /Low[\s-]?pay/i, model.symbols.low), model);
  _safeExtract('extractSymbolBlock.specials', () => extractSymbolBlock(text, /Specials?/i, model.symbols.specials), model);
  /* Wave UQ (Boki 2026-06-21 "kreni ultimativno") — PROSE-MODE symbol
   * extractor. Vendor-portfolio PDFs are written as flowing prose without
   * structured paytable tables — the MD-table extractor above silently
   * returns 0. Without this fallback every prose GDD lands the synthetic
   * fallback (model.__symbolFallback__) and never carries real symbol
   * intent. Universal — never reads vendor names, only pattern shapes. */
  _safeExtract('extractSymbolsProseMode', () => extractSymbolsProseMode(text, model), model);
  const totalSyms =
    model.symbols.high.length +
    model.symbols.mid.length +
    model.symbols.low.length +
    model.symbols.specials.length;
  if (totalSyms > 0) model.confidence.symbols = Math.min(1, totalSyms / 8);

  /* features */
  _safeExtract('extractFeatures', () => {
    const raw = extractFeatures(text);
    /* Wave W47.S22 Edge-Case C — dedupe features by kind. GDDs that
     * mention the same feature in multiple sections (intro paragraph,
     * features list, free-spins detail block) used to land in the
     * model as duplicates. Dedupe by kind preserving FIRST occurrence
     * so the label closest to the section title wins. Generic kinds
     * (`feature_generic`) are NOT deduped — they exist precisely to
     * carry un-classified prose snippets, each of which may legitimately
     * mention a distinct feature the parser didn't pick up. */
    const seen = new Set();
    model.features = raw.filter(f => {
      if (!f || typeof f.kind !== 'string') return false;
      if (f.kind === 'feature_generic') return true;
      if (seen.has(f.kind)) return false;
      seen.add(f.kind);
      return true;
    });
    if (model.features.length > 0) {
      model.confidence.features = Math.min(1, model.features.length / 3);
    }
  }, model);

  /* free-spins config — full structured extraction from GDD prose */
  _safeExtract('extractFreeSpinsConfig', () => {
    model.freeSpins = extractFreeSpinsConfig(text, model);
  }, model);

  /* All remaining extractors share the same contract: read from `text`,
     write to `model.<slot>`, no-op when the relevant section is absent. */
  _safeExtract('extractWinPresentation', () => extractWinPresentation(text, model), model);
  _safeExtract('extractScatterCelebration', () => extractScatterCelebration(text, model), model);
  _safeExtract('extractStageBadge', () => extractStageBadge(text, model), model);
  _safeExtract('extractAnticipation', () => extractAnticipation(text, model), model);
  _safeExtract('extractSpinTempo', () => extractSpinTempo(text, model), model);
  _safeExtract('extractFreeSpinsPresentation', () => extractFreeSpinsPresentation(text, model), model);
  _safeExtract('extractReelEngine', () => extractReelEngine(text, model), model);
  _safeExtract('extractTriggerCounting', () => extractTriggerCounting(text, model), model);
  _safeExtract('extractPostSpin', () => extractPostSpin(text, model), model);
  _safeExtract('extractReelEngineHot', () => extractReelEngineHot(text, model), model);

  /* Wave K — Pay Anywhere suite (scatter-pays + tumble-cascade family). */
  _safeExtract('extractPayAnywhereEval', () => extractPayAnywhereEval(text, model), model);
  _safeExtract('extractMultiplierOrb', () => extractMultiplierOrb(text, model), model);
  _safeExtract('extractBonusBuy', () => extractBonusBuy(text, model), model);
  _safeExtract('extractAnteBet', () => extractAnteBet(text, model), model);
  _safeExtract('extractTumble', () => extractTumble(text, model), model);

  /* Wave L–P — 16 detected-but-unused feature kinds wired into blocks. */
  _safeExtract('extractStickyWild', () => extractStickyWild(text, model), model);
  _safeExtract('extractExpandingWild', () => extractExpandingWild(text, model), model);
  _safeExtract('extractWalkingWild', () => extractWalkingWild(text, model), model);
  _safeExtract('extractWildReel', () => extractWildReel(text, model), model);
  _safeExtract('extractMysterySymbol', () => extractMysterySymbol(text, model), model);
  _safeExtract('extractClusterPaysEval', () => extractClusterPaysEval(text, model), model);
  _safeExtract('extractWaysEval', () => extractWaysEval(text, model), model);
  _safeExtract('extractPersistentMultiplier', () => extractPersistentMultiplier(text, model), model);
  _safeExtract('extractProgressiveFreeSpins', () => extractProgressiveFreeSpins(text, model), model);
  _safeExtract('extractAudio', () => extractAudio(text, model), model);
  _safeExtract('extractUiToast', () => extractUiToast(text, model), model);
  _safeExtract('extractSlamStop', () => extractSlamStop(text, model), model);
  _safeExtract('extractForceSkip', () => extractForceSkip(text, model), model);
  _safeExtract('extractAutoplay', () => extractAutoplay(text, model), model);
  _safeExtract('extractBetSelector', () => extractBetSelector(text, model), model);
  _safeExtract('extractGambleSecondary', () => extractGambleSecondary(text, model), model);
  _safeExtract('extractPaytable', () => extractPaytable(text, model), model);
  _safeExtract('extractBalanceHud', () => extractBalanceHud(text, model), model);
  _safeExtract('extractHistoryLog', () => extractHistoryLog(text, model), model);
  _safeExtract('extractTurboMode', () => extractTurboMode(text, model), model);
  _safeExtract('extractSettingsPanel', () => extractSettingsPanel(text, model), model);
  _safeExtract('extractHoldAndWin', () => extractHoldAndWin(text, model), model);
  _safeExtract('extractRespin', () => extractRespin(text, model), model);
  _safeExtract('extractWinCap', () => extractWinCap(text, model), model);
  _safeExtract('extractBonusPick', () => extractBonusPick(text, model), model);
  _safeExtract('extractWheelBonus', () => extractWheelBonus(text, model), model);
  _safeExtract('extractLightning', () => extractLightning(text, model), model);
  _safeExtract('extractGamble', () => extractGamble(text, model), model);
  _safeExtract('extractSuperSymbol', () => extractSuperSymbol(text, model), model);

  // math (RTP / volatility / max-win) intentionally NOT extracted in this phase.

  /* D-18 (Boki 2026-06-20) STEP A: snapshot pre-defaults state so the
     declared-flag post-processor can distinguish "GDD-declared" from
     "smart-defaults-filled". applySmartDefaults populates every key
     uniformly, after which all keys look declared — so we MUST capture
     content presence before defaults run. */
  const preDefaultsSnapshot = _snapshotKeyContentSizes(model);

  /* Wave P2 — Smart Defaults Engine. Backfill anything the parser
     could not extract from explicit GDD text — palette from tags,
     topology kind/dims from feature mix, symbol tier classification,
     and a recommended feature mix when the upstream GDD lists none.
     Each derived field is tagged in `model.confidence._derivedBy`
     so callers can distinguish "from spec" vs "inferred". */
  applySmartDefaults(model);

  /* D-18 (Boki 2026-06-20) STEP B: GDD-truth post-process. Mark every
     feature block in model as `declared` (GDD spec) vs `inferred`
     (parser pattern match) vs `default` (smart-defaults backfill).
     Produces model.__activeFeatures__ canonical list which downstream
     blocks (universalForcePanel, buildSlotHTML, gddRealityCheck)
     consume as the single source of truth — preventing phantom force
     chips for features GDD never declared. */
  applyDeclaredFlags(model, text, preDefaultsSnapshot);

  /* Wave V (Boki 2026-06-20 "dalje3") STEP C: multi-agent overlay.
   * Strategy (post deep-seek QA 2026-06-21):
   *   1. Explicit env var WAVE_V_RECONCILE_PATH wins (dev override).
   *   2. Else: auto-discover canonical cache location
   *        tools/_wave-v-cache/<game-slug>.json
   *      Resolved via __dirname-equivalent so this works from any caller.
   *   3. If neither exists: baseline parse stands, no error stamped.
   * This closes the "Wave V is dead in runtime" QA finding by making the
   * overlay opt-out instead of opt-in — when an operator runs the multi-
   * agent parser tool, its output is automatically picked up. */
  try {
    let overlayPath = null;
    if (typeof globalThis !== 'undefined' && globalThis.process &&
        globalThis.process.env && globalThis.process.env.WAVE_V_RECONCILE_PATH) {
      overlayPath = globalThis.process.env.WAVE_V_RECONCILE_PATH;
    } else if (_waveVFs && model && model.name) {
      const slug = String(model.name).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const candidate = _resolveWaveVCachePath(slug);
      if (candidate && _waveVFs.existsSync(candidate)) {
        overlayPath = candidate;
      }
    }
    if (overlayPath) {
      _waveVOverlay(model, overlayPath);
    }
  } catch (e) {
    /* Stash error for diagnosis instead of swallowing — overlay must not
     * silently fail. Baseline parse still stands; downstream callers can
     * read model.__waveV__.error. */
    model.__waveV__ = { error: 'overlay threw: ' + (e && e.message ? e.message : String(e)) };
  }

  /* Wave W (Boki 2026-06-21 "ultimativni qa") STEP D: block mapper signal.
   * Emit a soft list of which blocks the AI selector would auto-activate
   * for this model. Downstream buildSlotHTML can read this and downgrade
   * unused blocks to no-op at runtime (Phase 2). For now it is a SIGNAL
   * that surfaces declared-vs-mapped drift in gddRealityCheck. */
  try {
    if (_waveVFs && typeof model === 'object') {
      _attachBlockMapperSignal(model);
    }
  } catch (e) {
    model.__blockMapper__ = { error: 'mapper threw: ' + (e && e.message ? e.message : String(e)) };
  }

  /* Wave QA-2026-06-21 STEP E: symbol fallback for malformed PDFs.
   * If GDD declares a wild-dependent feature (expandingWild, walkingWild,
   * stickyWild, wildReel, mysterySymbol, megaWildCluster, etc.) but symbol
   * extractor produced 0 specials, inject a synthetic wild + scatter so
   * downstream blocks have a symbol to operate on. Stamped as default-
   * provenance, never as declared. */
  try {
    _ensureMinimumSymbolRoster(model);
  } catch (e) {
    /* Non-fatal — baseline parse still stands. */
  }

  return model;
}

/* Wave V cache resolver. Walks up from parser.mjs location to find repo
 * root, then drills into tools/_wave-v-cache/<slug>.json. Returns null
 * if any path component fails. */
function _resolveWaveVCachePath(slug) {
  try {
    if (!_waveVFs) return null;
    /* Module URL lives at <repo>/src/parser.mjs — strip filename to get
     * src/, then up one to repo root. */
    const u = new URL('./', import.meta.url);
    const srcDir = u.pathname;
    /* Strip trailing slash + src/ to get repo root */
    const repoRoot = srcDir.replace(/\/src\/?$/, '/');
    const candidate = repoRoot + 'tools/_wave-v-cache/' + slug + '.json';
    return candidate;
  } catch { return null; }
}

/* Wave W soft-mapper signal — attempts dynamic import of blockMapper.
 * Failure modes are non-fatal: the mapper depends on blockCatalog.json
 * which may not exist in stripped browser bundles. */
function _attachBlockMapperSignal(model) {
  /* Lazy require via dynamic import — keeps parser browser-safe. */
  if (typeof model.__blockMapper__ !== 'undefined') return;
  const u = new URL('./', import.meta.url);
  const catalogPath = u.pathname.replace(/\/src\/?$/, '/') + 'src/registry/blockCatalog.json';
  if (!_waveVFs || !_waveVFs.existsSync(catalogPath)) return;
  try {
    const catalog = JSON.parse(_waveVFs.readFileSync(catalogPath, 'utf8'));
    /* Inline lite-mapper: declared features + topology kind → activated blocks.
     * Full scorer lives in blockMapper.mjs; we surface a fast soft signal here.
     * Catalog shape is { catalog: [...blocks] } (NOT { blocks: [...] }); accept
     * both for resilience. */
    const blocks = Array.isArray(catalog) ? catalog : (catalog.catalog || catalog.blocks || []);
    const declared = (model.__activeFeatures__ || []).map(f => f.kind);
    const declaredSet = new Set(declared);
    const activated = [];
    const declaredButNoBlock = [];
    for (const b of blocks) {
      const fks = b.featureKinds || [];
      if (fks.some(k => declaredSet.has(k))) activated.push(b.id);
    }
    /* Detect declared features that map to ZERO blocks — surface for QA. */
    for (const kind of declared) {
      const covered = blocks.some(b => (b.featureKinds || []).includes(kind));
      if (!covered) declaredButNoBlock.push(kind);
    }
    model.__blockMapper__ = {
      activatedCount: activated.length,
      activated,
      declaredFeatureCount: declared.length,
      declaredButNoBlock,
      source: 'parser-inline-soft-mapper',
    };
  } catch (_) { /* non-fatal */ }
}

/* Symbol roster guard — Wave QA 2026-06-21 fix #3.
 * If GDD declares a wild/scatter feature but parser produced 0 specials,
 * inject synthetic placeholders so downstream blocks have something to
 * operate on. Marked as `default` provenance via model.confidence._derivedBy. */
/* Both camelCase (post-canonicalization) and snake_case (raw extractor) listed
 * so the guard catches whichever flavor reached this stage. */
const _WILD_DEPENDENT_KINDS = new Set([
  /* camelCase (canonical) */
  'expandingWild', 'walkingWild', 'stickyWild', 'wildReel', 'mysterySymbol',
  'mysteryWildReveal', 'megaWildCluster', 'cascadingWildPersistence',
  'wildTriggerHoldAndWin', 'walkingWildStepper', 'expandingWildMultiplier',
  'patternWin', 'bigSymbolRender2x2',
  /* snake_case (raw feature[].kind) */
  'expanding_wild', 'walking_wild', 'sticky_wild', 'wild_reel', 'mystery_symbol',
  'mystery_wild', 'mega_wild', 'wild_collision',
]);
const _SCATTER_DEPENDENT_KINDS = new Set([
  /* camelCase */
  'freeSpins', 'progressiveFreeSpins', 'scatterCelebration', 'progressiveFsRetrigger',
  'progressiveFsRetriggerLadder', 'fsExpansionWilds', 'tumbleGrowingFsMultiplier',
  'simultaneousFsHoldAndWinPriority', 'pickYourFs', 'lockedSymbolFs',
  'tumbleOnlyFs', 'infiniteFsUntilLoss',
  /* snake_case */
  'free_spins', 'progressive_free_spins', 'fs_retrigger', 'scatter_celebration',
  'tumble_growing_fs', 'pick_your_fs',
]);
function _ensureMinimumSymbolRoster(model) {
  if (!model || typeof model !== 'object') return;
  /* Use __activeFeatures__ (canonical camelCase, post-D-18) when available;
   * fall back to features[] (raw snake_case from extractor) so the guard
   * works regardless of upstream pipeline state. */
  const activeKinds = Array.isArray(model.__activeFeatures__)
    ? model.__activeFeatures__.map(f => f && f.kind).filter(Boolean)
    : [];
  const rawKinds = Array.isArray(model.features)
    ? model.features.map(f => f && f.kind).filter(Boolean)
    : [];
  const declaredKinds = new Set([...activeKinds, ...rawKinds]);
  if (!model.symbols) model.symbols = { high: [], mid: [], low: [], specials: [] };
  if (!Array.isArray(model.symbols.specials)) model.symbols.specials = [];
  const haveWild = model.symbols.specials.some(s =>
    s && typeof s === 'object' && /wild/i.test(s.kind || s.id || s.label || ''));
  const haveScatter = model.symbols.specials.some(s =>
    s && typeof s === 'object' && /scatter/i.test(s.kind || s.id || s.label || ''));
  let injected = [];
  const needsWild = !haveWild && [...declaredKinds].some(k => _WILD_DEPENDENT_KINDS.has(k));
  const needsScatter = !haveScatter && [...declaredKinds].some(k => _SCATTER_DEPENDENT_KINDS.has(k));
  if (needsWild) {
    model.symbols.specials.push({ id: 'S_WILD', label: 'Wild', kind: 'wild', _synthetic: true });
    injected.push('S_WILD');
  }
  if (needsScatter) {
    model.symbols.specials.push({ id: 'S_SCATTER', label: 'Scatter', kind: 'scatter', _synthetic: true });
    injected.push('S_SCATTER');
  }
  if (injected.length) {
    if (!model.confidence) model.confidence = { _derivedBy: {} };
    if (!model.confidence._derivedBy) model.confidence._derivedBy = {};
    model.confidence._derivedBy.symbols = 'qa-fallback-synthetic';
    model.__symbolFallback__ = { injected, reason: 'feature-declares-but-roster-empty' };
  }
}

/* Wave V overlay — synchronously read a v6_reconcile.json + merge.
 * Imported lazily so the parser stays usable in browser-only contexts
 * (where fs is unavailable). Failure modes: silent log to __waveV__.error. */
function _waveVOverlay(model, reconcilePath) {
  /* _waveVFs is bound at top-level module load via dynamic import('node:fs').
   * In a browser bundle the dynamic import resolves to null and the overlay
   * cleanly no-ops. */
  const fs = _waveVFs;
  if (!fs || typeof fs.existsSync !== 'function') {
    /* No fs available → cannot read overlay; baseline parse stands. */
    return;
  }
  if (!fs.existsSync(reconcilePath)) {
    model.__waveV__ = { error: 'reconcile path not found', path: reconcilePath };
    return;
  }
  const raw = fs.readFileSync(reconcilePath, 'utf8');
  let reconciled;
  try { reconciled = JSON.parse(raw); } catch (e) {
    model.__waveV__ = { error: 'invalid JSON: ' + e.message };
    return;
  }
  const delta = reconciled.model_delta || {};
  const meta  = reconciled.__meta__   || {};
  /* Inline shallow-merge — keeps overlay path synchronous and identical
   * to wave-v-reconcile.mjs::mergeIntoModel. */
  for (const k of Object.keys(delta)) {
    if (delta[k] == null) continue;
    if (model[k] && typeof model[k] === 'object' && !Array.isArray(model[k]) &&
        typeof delta[k] === 'object' && !Array.isArray(delta[k])) {
      Object.assign(model[k], delta[k]);
    } else {
      model[k] = delta[k];
    }
  }
  model.__waveV__ = { meta, mergedAt: new Date().toISOString() };
}

/* ─── D-18 · GDD-truth declared-flag post-processor ───────────────────────
 *
 * Goal: every feature key in `model` ends up with a clear provenance
 * stamp so downstream consumers can distinguish "GDD said so" from
 * "parser guessed" from "smart-defaults filled".
 *
 * Output additions to `model`:
 *   model.__declared = { [featureKey]: 'declared' | 'inferred' | 'default' }
 *   model.__activeFeatures__ = [ { kind, source, hasContent }, ... ]
 *   model.__parserDiagnostics__ = {
 *     totalKeys, declaredCount, inferredCount, defaultCount, emptyCount,
 *     declaredKeys, emptyKeys, inferredKeys
 *   }
 *
 * Decision tree per top-level key (in priority order):
 *   1. Key is in confidence._derivedBy → 'default'
 *   2. Value is an empty {} object → 'inferred'
 *   3. Value is dict with enabled=true OR has ≥ 3 keys → 'declared'
 *   4. Value is dict with enabled=false (explicit) → 'declared' (explicit no)
 *   5. Otherwise → 'inferred'
 *
 * Cross-check: GDD raw text scan for the feature label/keyword to
 * upgrade 'inferred' → 'declared' when there's a clear textual mention
 * (≥ 2 occurrences of the feature name + a section heading).
 */
const FEATURE_KEYWORD_MAP = Object.freeze({
  freeSpins:                  /free\s*spins?/i,
  holdAndWin:                 /hold[\s&-]+win|hold[\s&-]+spin|money[\s-]+collect|fireball/i,
  lightning:                  /lightning|electric[\s-]+mult/i,
  wheelBonus:                 /wheel\s*bonus|wheel\s*spin|fortune\s*wheel/i,
  bonusBuy:                   /bonus\s*buy|buy\s*feature|feature\s*buy/i,
  bonusPick:                  /pick\s*bonus|pick\s*a\s*prize|reveal\s*bonus/i,
  /* WAVE U3 (Boki 2026-06-20 — "univerzal"): pojačani synonym sets za
     11 brittle patterns. Audit nalaz: single-phrase patterns su silently
     promašivali GDD-ove sa standardnim industrijskim formulacijama. */
  gamble:                     /\bgamble\b|double[\s-]+up|\bdouble[\s-]+or[\s-]+nothing\b|risk[\s-]+(?:feature|round|game)|red[\s-]+\/?\s*black|\bhilo\b|\bhi[\s-]?lo\b|guess\s+the\s+card|after[\s-]?win\s+gamble/i,
  jackpot:                    /jackpot|mini.*minor.*major.*grand|grand\s+prize|progressive\s+(?:prize|pool|jackpot)|jackpot\s+pool|jackpot\s+(?:ladder|room|tier)/i,
  scatterCelebration:         /scatter\s*celebration|scatter\s*pay|trigger\s*animation|trigger\s*reveal|trigger\s*sequence|trigger\s*intro|scatter\s+intro/i,
  multiplierOrb:              /multiplier\s*orb|orb\s*multiplier|persistent\s*orb|gold\s*orb|coin\s+(?:multiplier|value)\s+orb|mult\s+orb/i,
  persistentMultiplier:       /persistent\s*multiplier|sticky\s*multiplier|carry[\s-]?over\s+multiplier|increasing\s+multiplier|cumulative\s+multiplier|growing\s+multiplier/i,
  randomLightningMultiplier:  /random\s*lightning|random\s*mult|random\s+multiplier|lightning\s+(?:strike|bolt|mult)|zeus\s+strike|electric\s+(?:bolt|spark)/i,
  stickyWild:                 /sticky\s*wild|stays?\s+sticky|sticky\s+(?:reel|symbol)|wild\s+stays\s+(?:on|in\s+place)|locked\s+wild/i,
  expandingWild:              /expanding\s*wild|big\s*wild|expand(?:s|ed)?\s+to\s+(?:fill\s+)?(?:the\s+)?(?:reel|column)|stretch\s+wild|grow\s+to\s+full\s+reel/i,
  walkingWild:                /walking\s*wild|moving\s*wild|shifting\s*wild|wandering\s+wild|march\s+(?:left|right|down)|walker\s+wild/i,
  wildReel:                   /wild\s*reel|full\s*wild\s*reel|entire\s+reel\s+wild|reel\s+turns?\s+wild|nudged?\s+wild\s+reel/i,
  mysterySymbol:              /mystery\s*symbol|surprise\s*symbol|hidden\s+symbol|reveal\s+symbol|mystery\s+(?:tile|prize|reveal)/i,
  superSymbol:                /super\s*symbol|colossal|giant\s+symbol|mega\s+symbol|oversized\s+symbol|3\s*[x×]\s*3\s+symbol|2\s*[x×]\s*2\s+symbol/i,
  clusterPaysEval:            /cluster\s*pays?|cluster\s*win|cluster\s+mechanic|clusters?\s+of\s+\d+\s+or\s+more|adjacent\s+cluster|connected\s+cluster/i,
  waysEval:                   /\d+\s*ways|all\s*ways|ways\s*to\s*win|megaways|pay\s+ways|adjacency\s+pays|left[\s-]?to[\s-]?right\s+ways|both[\s-]?ways/i,
  payAnywhereEval:            /pay\s*anywhere|scatter\s*pay|pay\s+everywhere|symbols?\s+pay\s+(?:anywhere|on\s+any\s+position)|8[\s-]?of[\s-]?a[\s-]?kind\s+anywhere/i,
  tumble:                     /tumble|cascade|cascading|avalanche|drop\s+down|rolling\s+reels?|chain\s+reaction|symbol\s+collapse|collapsing\s+reels?/i,
  anteBet:                    /ante\s*bet|ante\s+mode|ante[\s-]?up|bet[\s-]?boost|enhanced\s+bet|125\s*%\s+bet|1\.25\s*x\s+bet/i,
  respin:                     /respin|re-spin|free[\s-]?respin|paid[\s-]?respin|hold[\s-]?and[\s-]?respin|lock[\s-]?and[\s-]?respin/i,
  autoplay:                   /autoplay|auto\s*play/i,
  bigWinTier:                 /big\s*win|mega\s*win|epic\s*win/i,
  winCap:                     /win\s*cap|max\s*win|maximum\s*win/i,
  /* D-17 industry-standard feature keywords (Foundry-family + similar) */
  patternWin:                 /pattern\s*win|stacked.*reel.*1.*wild|full[\s-]?screen\s*(hit|pattern|win)/i,
  bigSymbolRender2x2:         /big\s*(?:fireball|symbol|wild|volcano)|2\s*[x×]\s*2\s*(?:big|oversized)|3[\s-]?high\s*(?:wild|symbol)|oversized\s*symbol/i,
  linkedReels:                /linked\s*(?:center\s*)?reels?|center\s*reels?\s*link|reel\s*link\s*(?:block|set)/i,
  perTriggerVolatilitySet:    /volatility\s*(?:set|class|pool)|per[\s-]?trigger\s*volatility|low\s*\/?\s*med\s*\/?\s*high\s*(?:pool|weight)/i,
  potSymbolFireball:          /(?:mini|minor|major|grand)\s*(?:pot|fireball|jackpot)|pot\s*symbols?|tiered?\s*pot\s*ladder/i,
  grandInterruptionLock:      /grand\s*(?:celebration|jackpot|win|interruption)|handpay|attendant|full[\s-]?board\s*fill|1,?000,?000[\s-]?credit/i,
  simultaneousFsHoldAndWinPriority: /simultaneous.*(?:fs|free\s*spins?).*hold|simultaneous.*hold.*free|cross[\s-]?feature\s*(?:trigger|priority|arbiter)/i,
  creditAwardConversion:      /credit[\s-]?based\s*math|coin[\s_]?value\s*=\s*total[\s_]?bet|x\s*total\s*bet|absolute\s*credit/i,
});

/* D-18 helper: snapshot pre-defaults state.
 *
 * freshModel() pre-populates almost every top-level key with default
 * stubs (winPresentation: {mode: undefined, perEventMs: undefined, …},
 * freeSpins: {enabled: false}, …) so a raw Object.keys().length count
 * is useless: every block looks "populated" even when the parser never
 * touched it.
 *
 * The real signal: HOW MANY of the stub's fields have CONCRETE values
 * (not undefined). When the parser extracts data it writes concrete
 * values; when it leaves a stub alone, every field stays undefined.
 *
 * Returns: { [key]: concreteFieldCount } where concrete = !== undefined.
 */
function _snapshotKeyContentSizes(model) {
  if (!model || typeof model !== 'object') return {};
  const snap = {};
  for (const key of Object.keys(model)) {
    const v = model[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      let concrete = 0;
      for (const subKey of Object.keys(v)) {
        if (v[subKey] !== undefined) concrete++;
      }
      snap[key] = concrete;
    } else {
      snap[key] = (v === undefined || v === null) ? -1 : -2;
    }
  }
  return snap;
}

function applyDeclaredFlags(model, rawText, preDefaultsSnapshot) {
  if (!model || typeof model !== 'object') return;
  const text = typeof rawText === 'string' ? rawText : '';
  const preSnap = preDefaultsSnapshot || {};
  const declared = {};
  const activeFeatures = [];
  const declaredKeys = [];
  const inferredKeys = [];
  const emptyKeys = [];
  const derivedBy = (model.confidence && model.confidence._derivedBy) || {};

  /* Helper: detect whether a key's GDD textual evidence is strong. */
  function gddMentions(key) {
    if (!text) return false;
    const pat = FEATURE_KEYWORD_MAP[key];
    if (!pat) return false;
    const matches = text.match(new RegExp(pat.source, 'gi'));
    return Array.isArray(matches) && matches.length >= 2;
  }

  for (const key of Object.keys(model)) {
    /* skip internal/meta keys */
    if (key.startsWith('_') || key.startsWith('$') || key.startsWith('__')) continue;
    /* skip non-feature primitive metadata (name, theme, topology, symbols) */
    if (key === 'name' || key === 'theme' || key === 'topology' ||
        key === 'symbols' || key === 'features' || key === 'paytable' ||
        key === 'confidence' || key === 'palette' || key === 'meta' ||
        key === 'regulator' || key === 'responsibleGambling') continue;

    const v = model[key];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'object') continue;

    /* Decision tree. preSnap[key] = concrete (non-undefined) field
     * count captured BEFORE smart-defaults ran. If preSnap is 0 the
     * value we see now is either pure freshModel stub or came from
     * smart-defaults backfill — NOT from GDD extraction. */
    let source;
    let hasContent = false;
    const valueKeys = Object.keys(v);
    const isEmpty = valueKeys.length === 0;
    const preConcrete = (key in preSnap) ? preSnap[key] : 0;

    /* Concrete-now count: how many fields currently have a non-undefined
     * value. Distinguishes "smart-defaults populated" from "still stub". */
    let concreteNow = 0;
    for (const subKey of valueKeys) {
      if (v[subKey] !== undefined) concreteNow++;
    }
    const isStillStubOnly = concreteNow === 0;
    const parserTouchedIt = preConcrete > 0;

    if (derivedBy[key]) {
      source = 'default';
    } else if (parserTouchedIt) {
      /* Parser wrote concrete values DURING extraction phase → declared. */
      source = 'declared';
      hasContent = !isStillStubOnly;
    } else if (isEmpty || isStillStubOnly) {
      /* freshModel stub never touched by extractor, smart-defaults
       * didn't fill, or extractor only set everything to undefined. */
      source = 'inferred';
      emptyKeys.push(key);
    } else if (typeof v.enabled === 'boolean') {
      /* smart-defaults wrote enabled flag — treat as default (didn't
       * come from GDD text). */
      source = 'default';
    } else {
      source = 'default';
    }

    /* Cross-check upgrade: parser found weak evidence but raw text has
     * strong textual presence → upgrade to declared. Only fires for
     * keys in FEATURE_KEYWORD_MAP and only when NOT already classified
     * as default (default beats text mention — defaults are smart-fill
     * placeholders, not real GDD declarations). */
    if (source === 'inferred' && gddMentions(key)) {
      source = 'declared';
      hasContent = !isEmpty;
    }

    declared[key] = source;
    if (source === 'declared') declaredKeys.push(key);
    if (source === 'inferred') inferredKeys.push(key);

    /* Active features list — only declared with content (or explicitly
     * enabled:true with no content). Phantom { } empty objects WITHOUT
     * GDD evidence are excluded. */
    if (source === 'declared' && (hasContent || v.enabled === true)) {
      activeFeatures.push({
        kind: key,
        source: source,
        hasContent: hasContent,
        keyCount: valueKeys.length,
      });
    }
  }

  /* Also walk the canonical features[] array — every entry there is
   * by definition declared (the GDD listed it). */
  if (Array.isArray(model.features)) {
    for (const f of model.features) {
      if (!f || typeof f !== 'object') continue;
      const kind = f.kind;
      if (typeof kind !== 'string') continue;
      if (kind === 'feature_generic') continue; /* discovery placeholder */
      /* Map features[].kind labels onto top-level model keys when
       * naming differs. */
      const topKey = ({
        free_spins:            'freeSpins',
        hold_and_win:          'holdAndWin',
        wheel_bonus:           'wheelBonus',
        bonus_buy:             'bonusBuy',
        bonus_pick:            'bonusPick',
        ante_bet:              'anteBet',
        mystery_symbol:        'mysterySymbol',
        super_symbol:          'superSymbol',
        sticky_wild:           'stickyWild',
        expanding_wild:        'expandingWild',
        walking_wild:          'walkingWild',
        wild_reel:             'wildReel',
        cluster_pays:          'clusterPaysEval',
        ways:                  'waysEval',
        pay_anywhere:          'payAnywhereEval',
        big_win:               'bigWinTier',
      })[kind] || kind;
      if (declared[topKey] !== 'declared') {
        declared[topKey] = 'declared';
        if (!declaredKeys.includes(topKey)) declaredKeys.push(topKey);
        /* remove from inferred/empty if it was there */
        const ie = inferredKeys.indexOf(topKey);
        if (ie >= 0) inferredKeys.splice(ie, 1);
        const ee = emptyKeys.indexOf(topKey);
        if (ee >= 0) emptyKeys.splice(ee, 1);
      }
      if (!activeFeatures.find(a => a.kind === topKey)) {
        activeFeatures.push({
          kind: topKey,
          source: 'declared',
          hasContent: false, /* features[] entry alone doesn't carry content */
          keyCount: 0,
        });
      }
    }
  }

  /* D-18 STEP C: scan raw text for D-17 industry-standard features that
   * may not have a top-level model key (e.g. patternWin, linkedReels,
   * potSymbolFireball). If the GDD text strongly mentions them, add as
   * declared even without a model.<key> stub. This is what makes a GDD
   * that describes a "1000x pattern win" actually surface patternWin as
   * a declared feature, even though the parser never created a
   * model.patternWin object. */
  const SCAN_ONLY_FEATURES = [
    'patternWin', 'bigSymbolRender2x2', 'linkedReels',
    'perTriggerVolatilitySet', 'potSymbolFireball', 'grandInterruptionLock',
    'simultaneousFsHoldAndWinPriority', 'creditAwardConversion',
  ];
  for (const key of SCAN_ONLY_FEATURES) {
    if (declared[key]) continue; /* already classified */
    if (gddMentions(key)) {
      declared[key] = 'declared';
      declaredKeys.push(key);
      activeFeatures.push({
        kind: key,
        source: 'declared',
        hasContent: false,
        keyCount: 0,
        textOnly: true, /* marker: came from raw-text scan, no model stub */
      });
    }
  }

  model.__declared = declared;
  model.__activeFeatures__ = activeFeatures;
  model.__parserDiagnostics__ = {
    totalKeys: Object.keys(declared).length,
    declaredCount: declaredKeys.length,
    inferredCount: inferredKeys.length,
    emptyCount: emptyKeys.length,
    declaredKeys: declaredKeys.slice(),
    emptyKeys: emptyKeys.slice(),
    inferredKeys: inferredKeys.slice(),
    failuresCount: (model.confidence && Array.isArray(model.confidence._failures))
      ? model.confidence._failures.length : 0,
  };
}

/* ─── helper: extract Free Spins config (trigger / awards / retrigger / mult) ──
 *
 * Pulls a fully-structured FS block out of any GDD that mentions Free Spins.
 * Falls back to industry defaults when individual fields are missing, so the
 * playable template ALWAYS has something sensible to render.
 *
 * Output shape:
 *   { enabled: bool,
 *     triggerSymbol: 'S',           // scatter / bonus symbol id
 *     triggerCounts: [3, 4, 5],     // count → spins mapping (sorted asc)
 *     awards: [{count:3, spins:14}, {count:4, spins:16}, {count:5, spins:18}],
 *     retrigger: { enabled: bool, count: 3, spins: 5 },
 *     multiplier: { type: 'static' | 'progressive', start: 1, step: 1, cap: 10 },
 *     bgMode: 'purple' | 'gold' | 'crimson',
 *     introLabel, outroLabel }
 */
export function extractFreeSpinsConfig(text, model) {
  const has = /\bfree[\s-]?spins?\b/i.test(text);
  if (!has) {
    return { enabled: false };
  }

  /* Default: industry-standard 3/4/5 scatter ladder, 10/15/20 spins,
     static ×1 multiplier, retrigger 3S=+5 spins, purple stage.

     `countMode` — how scatters are counted toward the trigger threshold
     and anticipation gate:
       'perReel' — each reel contributes at most 1 toward the count
                   (industry-default; ladder rungs read as "N reels with
                   a scatter", not "N scatter cells"). DEFAULT.
       'any'     — every scatter cell counts (a single reel may carry 2-3
                   scatters that all add to the total). Used by titles
                   that explicitly call out "stacked scatters" / "scatters
                   may stack" or use multi-row scatter symbols. */
  const fs = {
    enabled: true,
    triggerSymbol: 'S',
    triggerCounts: [3, 4, 5],
    countMode: 'perReel',   /* see detection block below */
    awards: [
      { count: 3, spins: 10 },
      { count: 4, spins: 15 },
      { count: 5, spins: 20 },
    ],
    retrigger: { enabled: true, count: 3, spins: 5 },
    multiplier: { type: 'static', start: 1, step: 0, cap: 1 },
    bgMode: 'purple',
    introLabel: 'FREE SPINS',
    outroLabel: 'FREE SPINS COMPLETE',
  };

  /* Use the parsed Specials list to pick a real trigger-symbol id when present.
     "Scatter / Triggers Free Spins" is the canonical pattern; fall back to
     first symbol whose name contains "scatter" or "bonus". */
  if (model && model.symbols && model.symbols.specials) {
    const scatter = model.symbols.specials.find(s =>
      /scatter|bonus|trigger/i.test(s.name || '')
    );
    if (scatter) fs.triggerSymbol = scatter.id;
  }

  /* Awards table — three input flavors must all yield the same parsed
     award ladder:
       (a) MD pipe table:
             | 3 Scattera | 14 spins |
             | 4 Scattera | 16 spins |
             | 5 Scattera | 18 spins |
       (b) MD pipe table compact: `| 3 | 14 |`
       (c) PDF-extracted text (pdfjs strips newlines): the whole
           document arrives as one giant line, so `^...$/gm` row regexes
           never match. We need a pattern that ignores line structure and
           keys off the SCATTER + N + spins co-occurrence within a small
           window of characters. Examples from the WoO PDF:
             "3 Scattera ~1/1,000 14 spins 2× bet"
             "4 Scattera ~1/12,500 16 spins 3× bet"
             "5 Scattera ~1/200,000 18 spins 10× bet"
  */
  const rows = [];
  /* Pattern (a)+(b): MD pipe rows. Two-cell `| 3 | 14 |` AND three-cell
     `| 3 Scatters | something | 14 spins |` both yield the same award.
     `m` flag plus `^...$` so we don't collide with the PDF flow text
     pattern below. Greedy `[\s\S]*?` between cells handles a long label
     column ("3 | 1/1,000 | 14 | 2× bet") without missing the trailing
     spins count. We extract the FIRST 1-digit token after `|` (the
     count) and look ahead to the LAST cell beginning with 1-3 digits
     (the spins). The pattern only matches when both numbers are inside
     the same MD row (no newline allowed inside cells). */
  const mdRow = /^\|\s*(\d+)\s*(?:scatters?\w*)?\s*(?:\|[^|\n]*?)*?\|\s*(\d+)\s*(?:spins?\w*)?\s*\|/gim;
  let m1;
  while ((m1 = mdRow.exec(text)) !== null) {
    const count = parseInt(m1[1], 10);
    const spins = parseInt(m1[2], 10);
    if (count >= 2 && count <= 9 && spins >= 1 && spins <= 200) {
      rows.push({ count, spins });
    }
  }
  /* Pattern (c): PDF flow — `N Scattera ... M spins` within 80 chars,
     where N is a trigger count and M is a spin award. We scan all matches
     across the document (NOT scoped to a Free Spins heading because PDF
     extraction destroys heading structure). */
  if (rows.length === 0) {
    const pdfRow = /(\d)\s*(?:Scatter[a-z]*|Scattera|Sketer[a-z]*|Skater[a-z]*)\s+[\s\S]{0,80}?\s(\d{1,3})\s*spins?\b/gi;
    let m2;
    const seenCounts = new Set();
    while ((m2 = pdfRow.exec(text)) !== null) {
      const count = parseInt(m2[1], 10);
      const spins = parseInt(m2[2], 10);
      if (count >= 2 && count <= 9 && spins >= 1 && spins <= 200 && !seenCounts.has(count)) {
        rows.push({ count, spins });
        seenCounts.add(count);
      }
    }
  }
  /* Pattern (d): PDF flow with MD-rendered compact table — when the GDD
     uses `| Scatters | Spins awarded |` header followed by `| 3 | 14 |`
     rows (no "Scattera" word in each row), neither (a) [needs `^`] nor
     (c) [needs "Scattera"] fires. Wave AL-3 (Boki WoO PDF audit): detect
     the header context once, then extract consecutive `| N | M |` pairs
     within the next 400 chars. Bounds 2 ≤ count ≤ 9 and 1 ≤ spins ≤ 200
     filter out unrelated numeric tables. */
  if (rows.length === 0) {
    const hdr = text.match(/\bscatters?\s*\|\s*spins?\s+awarded\b/i);
    if (hdr) {
      const scan = text.slice(hdr.index, hdr.index + 600);
      const cellRow = /\|\s*(\d{1,2})\s*\|\s*(\d{1,3})\s*\|/g;
      let m3;
      const seenCounts = new Set();
      while ((m3 = cellRow.exec(scan)) !== null) {
        const count = parseInt(m3[1], 10);
        const spins = parseInt(m3[2], 10);
        if (count >= 2 && count <= 9 && spins >= 1 && spins <= 200 && !seenCounts.has(count)) {
          rows.push({ count, spins });
          seenCounts.add(count);
        }
      }
    }
  }
  if (rows.length > 0) {
    /* Dedupe by count (keep first occurrence) + sort ascending. */
    const byCount = new Map();
    for (const r of rows) if (!byCount.has(r.count)) byCount.set(r.count, r);
    fs.awards = Array.from(byCount.values()).sort((a, b) => a.count - b.count);
    fs.triggerCounts = fs.awards.map(r => r.count);
  }

  /* Trigger threshold — "N+ Scatters" / "N or more". If the text says "3+",
     align triggerCounts to start at 3. */
  const thresh = text.match(/\b(\d)\s*\+?\s*(?:scatters?|bonus|S\s+symbols?)\s+(?:anywhere|trigger|on\s+(?:screen|reels))/i);
  if (thresh) {
    const n = parseInt(thresh[1], 10);
    if (n >= 2 && n <= 6 && !fs.triggerCounts.includes(n)) {
      fs.triggerCounts.unshift(n);
    }
  }

  /* Multiplier — "progressive", "starts at ×N", "increments by ×N", "caps at ×N"
   *
   * 2026-06-18 — Boki HNP audit: srpski "Akumulirajuća mehanika — multiplier
   * raste tokom bonusa i primenjuje se na naredne dobitke" nije bio uhvaćen
   * pre-fix-a (parser je fallbackovao na static start=1). Dodajemo srpske
   * sinonime (akumulirajuć[ai], kumulativ, rast[ai]) + "ladder" pattern. */
  const isProgressive = /\bprogressive\s+multiplier|\bmultiplier\s+(?:starts?|increments?|grows?)\b|\bincrements?\s+by\s+[×x]?\d+|\bakumulira(?:juć[ai]|jući|na|jucа|n)?\s+(?:multiplier|mehanika)|\bmultiplier\s+(?:raste|akumulira|kumulira|gradi)|\bkumulativ(?:ni|an|na|no)\s+multiplier|\brastuć[ai]\s+multiplier|\bmultiplier\s+ladder\b/i.test(text);
  if (isProgressive) {
    const startMatch = text.match(/starts?\s+at\s+[×x]?\s*(\d+)/i);
    const stepMatch  = text.match(/increments?\s+by\s+[×x]?\s*(\d+)/i);
    const capMatch   = text.match(/caps?\s+at\s+[×x]?\s*(\d+)/i);
    fs.multiplier = {
      type: 'progressive',
      start: startMatch ? parseInt(startMatch[1], 10) : 1,
      step:  stepMatch  ? parseInt(stepMatch[1], 10)  : 1,
      cap:   capMatch   ? parseInt(capMatch[1], 10)   : 10,
    };
  } else {
    const flatMult = text.match(/\b(\d+)[×x]\s+(?:fs|free[\s-]?spins?|multiplier\s+(?:in|during))\b/i);
    if (flatMult) {
      const v = parseInt(flatMult[1], 10);
      fs.multiplier = { type: 'static', start: v, step: 0, cap: v };
    }
  }

  /* Retrigger detection — "retrigger possible" / "extra spins added" / "+N FS" */
  const noRetrig = /\bno\s+retrigger\b|\bretrigger\s+(?:disabled|not\s+supported|not\s+in)/i.test(text);
  const hasRetrig = /\bretrigger(?:s|ing)?\b|\bextra\s+spins?\s+added|\b\+\s*\d+\s+(?:free[\s-]?spins?|fs)\b/i.test(text);
  if (noRetrig) {
    fs.retrigger = { enabled: false, count: 0, spins: 0 };
  } else if (hasRetrig) {
    /* try to pull explicit values "+5 FS" or "3 scatters add 5 spins" */
    const explicit = text.match(/(\d)\s*\+?\s*(?:scatters?|bonus)\s+(?:add[s]?|grants?|gives?)\s+(\d+)\s+(?:free[\s-]?spins?|fs|spins?)/i)
                  || text.match(/\+\s*(\d+)\s+(?:free[\s-]?spins?|fs|spins?)\s+(?:on\s+)?retrigger/i);
    if (explicit) {
      if (explicit.length === 3) {
        fs.retrigger = { enabled: true, count: parseInt(explicit[1], 10), spins: parseInt(explicit[2], 10) };
      } else {
        fs.retrigger = { enabled: true, count: 3, spins: parseInt(explicit[1], 10) };
      }
    }
    /* else keep default { enabled:true, count:3, spins:5 } */
  }

  /* Scatter count-mode detection — EN + SR phrases.

     Order matters: explicit "may stack" phrases for `any` mode are checked
     FIRST so an ambiguous fixture that mentions both wins the explicit
     intent. If neither pattern matches, `countMode` stays at the default
     'perReel' (already set above).

     PHRASE BANK
       any (multi-per-reel):
         - "scatters may stack"
         - "scatters can stack"
         - "stacked scatters"
         - "scatter stacks"
         - "multiple scatters per reel"
         - "scatters can land on the same reel"
         - "more than one scatter per reel"
         - "2x scatter" / "3x scatter" / "stacked S"
         - "vise sketera po rilu" / "više skatera po rilu"
         - "stack-ovani sketeri" / "stakovani sketeri"
         - "moze vise sketera po rilu" / "može više skatera po rilu"
       perReel (one-per-reel, default):
         - "one scatter per reel"
         - "1 scatter per reel"
         - "max one scatter per reel"
         - "only one scatter per reel"
         - "single scatter per reel"
         - "scatter on different reels"
         - "scatters on different reels"
         - "scatters on distinct reels"
         - "unique reels"
         - "per-reel scatter"
         - "po jedan sketer po rilu" / "po jedan skater po rilu"
         - "jedan sketer po rilu"
         - "po rilu jedan sketer"
         - "samo jedan sketer po rilu" / "samo po jedan sketer"
         - "jedinstveni rilovi" / "razliciti rilovi"
  */
  /* Phonetic-tolerant SR scatter token: handles English transliterations
     (sketer, skater, sćeter, scater, scatter, sceter) so a writer's
     spelling doesn't break trigger-mode detection. */
  const SR_SCATTER = '(?:sketer|skater|sceter|scater|scatter|s[ćč]eter)[a-z]*';

  /* 2026-06-09 — Boki bug fix: WoO PDF was parsed as countMode='any' even
     though the source GDD explicitly says "Max 1 Scatter po rilu po
     spinu" → perReel. Two false positives lived in anyModeRe:

       (1) `\b[2-9]\s*[x×]\s+scatter` matched "FS triggered sa **3× Scatter**"
           (where 3× is a SCATTER COUNT, not a stack) and "**5× Scatter**
           koji bi bio previše čest" (a hypothetical, also a count). Removed
           — this shorthand is too ambiguous across docs.

       (2) `stacked S` alone matched too eagerly. Removed.

     Also added explicit negation/prevention guard: when "stacking
     prevention" / "max 1 scatter" / "scatter stacking prevention" appears,
     this is a HARD perReel signal and beats every any-mode phrase in the
     same document (industry convention — vendors call this out exactly
     because the default-on-paper is anywhere-count without the guard).
  */
  const anyModeRe = new RegExp(
    '(?:scatters?\\s+(?:may|can)\\s+stack)' +
    '|(?:stacked\\s+scatters?)' +
    '|(?:scatter\\s+stacks?)' +
    '|(?:multiple\\s+scatters?\\s+per\\s+reel)' +
    '|(?:scatters?\\s+can\\s+land\\s+on\\s+(?:the\\s+)?same\\s+reel)' +
    '|(?:more\\s+than\\s+one\\s+scatter\\s+per\\s+reel)' +
    '|(?:v(?:i|í|i)[sš]e\\s+' + SR_SCATTER + '\\s+po\\s+rilu)' +
    '|(?:stack[\\-\\s]?ovani\\s+' + SR_SCATTER + ')' +
    '|(?:stakovani\\s+' + SR_SCATTER + ')' +
    '|(?:mo[zž]e\\s+v(?:i|í)[sš]e\\s+' + SR_SCATTER + '\\s+po\\s+rilu)',
    'i'
  );

  const perReelModeRe = new RegExp(
    '(?:(?:one|1|single|only\\s+one|max(?:imum)?\\s+(?:of\\s+)?one)\\s+scatters?\\s+per\\s+reel)' +
    '|(?:scatters?\\s+on\\s+(?:different|distinct|separate|unique)\\s+reels?)' +
    '|(?:unique\\s+reels?\\s+(?:only|required))' +
    '|(?:per[\\-\\s]reel\\s+scatters?)' +
    '|(?:scatters?\\s+(?:must|need)\\s+(?:to\\s+)?(?:land\\s+)?on\\s+(?:different|distinct)\\s+reels?)' +
    '|(?:scatter[s\\-\\s]?stacking\\s+prevention)' +
    '|(?:no\\s+stacked\\s+scatters?)' +
    '|(?:stacked\\s+scatters?\\s+(?:are\\s+)?(?:not\\s+allowed|prevented|disabled))' +
    '|(?:max(?:imum)?\\s+(?:of\\s+)?(?:one|1)\\s+scatter[/\\s]+reel)' +
    '|(?:(?:po\\s+jedan|jedan)\\s+' + SR_SCATTER + '\\s+po\\s+rilu)' +
    '|(?:po\\s+rilu\\s+jedan\\s+' + SR_SCATTER + ')' +
    '|(?:samo\\s+(?:po\\s+)?jedan\\s+' + SR_SCATTER + ')' +
    '|(?:max(?:imum)?\\s*1\\s+' + SR_SCATTER + '\\s+po\\s+rilu)' +
    '|(?:jedinstveni\\s+rilovi)' +
    '|(?:razli[cč]iti\\s+rilovi)',
    'i'
  );

  /* Precedence: explicit perReel signals (especially the "stacking
     prevention" / "Max 1 Scatter po rilu" guards) ALWAYS win over any-mode
     phrases that may appear elsewhere in the same document. This matches
     real-world GDD convention — a designer who calls out the prevention
     mechanism is unambiguously stating per-reel intent even if they also
     describe stack behavior somewhere else (e.g. as a comparison). */
  if (perReelModeRe.test(text)) {
    fs.countMode = 'perReel';
  } else if (anyModeRe.test(text)) {
    fs.countMode = 'any';
  }
  /* else: keep default 'perReel' — Boki's rule: GDD silent → one-per-reel. */

  /* Visual mode — heuristic from theme palette. If palette has purple/violet
     hex, use purple. If gold-heavy, use gold. If red/crimson, use crimson. */
  const pal = (model && model.theme && model.theme.palette) || [];
  if (pal.some(h => /^#(?:[a-f0-9]{2}){3}$/i.test(h) && isRedish(h))) fs.bgMode = 'crimson';
  else if (pal.some(h => /^#(?:[a-f0-9]{2}){3}$/i.test(h) && isGoldish(h))) fs.bgMode = 'gold';
  else fs.bgMode = 'purple';

  /* Intro / outro placard wording — pull explicit GDD copy when present. */
  const introCopy = text.match(/(?:placard|placeholder|overlay|splash)[^\n]*?[""''""]([^""""''""\n]{3,30})[""''""]/i)
                 || text.match(/[""""''""]([A-Z][A-Z\s]{2,30})[""""''""][^\n]*?(?:placard|placeholder|overlay|splash|rises|intro)/i);
  if (introCopy) {
    const c = introCopy[1].trim();
    if (/free|spins|bonus/i.test(c) && c.length < 32) fs.introLabel = c.toUpperCase();
  }
  const outroCopy = text.match(/[""""''""]([A-Z][A-Z\s]{2,30})[""""''""][^\n]*?(?:outro|return|exit|totals?)/i);
  if (outroCopy) {
    const c = outroCopy[1].trim();
    if (c.length < 32) fs.outroLabel = c.toUpperCase();
  }

  return fs;
}

function isRedish(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r > 150 && r > g + 40 && r > b + 40;
}
function isGoldish(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r > 180 && g > 120 && g < 220 && b < 100;
}

/* ─── helper: extract complete topology (all 85+ shape kinds) ─ */
export function extractTopology(rawText, model) {
  const t = model.topology;

  /* Apply SAME negation strips as feature detection so "variable-ways · Out of scope"
     or "no cluster pays" lines don't falsely flip the evaluation kind. */
  let text = rawText.replace(
    /#{2,3}\s*(?:\d+\.\s*)?(?:Out[\s-]of[\s-]scope|Explicit non-features|Not in this product)[^#]*(?=#{2,3}|\Z)/gis,
    ''
  );
  text = text.replace(
    /^\|[^\n|]*?\|[^\n|]*?\b(?:not\s+in\s+this\s+product|out\s+of\s+scope|none|n\/a|disabled|excluded|—|–)\b[^\n|]*?\|.*$/gim,
    ''
  );
  text = text.replace(
    /^[^\n]*\b(?:has\s+no|with\s*no|without|no\s+(?:cluster|ways|hexagonal|infinity))\b[^\n]*$/gim,
    ''
  );

  /* 1. Reels — accept "6 columns", "6", "6 reels", "5-6 (variable)", "4 (base)" */
  const reelsCell =
    text.match(/\|\s*\*?\*?Reels\*?\*?\s*\|\s*(\d+)(?:\s+columns?)?\s*\|/i) ||
    text.match(/\|\s*\*?\*?Reels\*?\*?\s*\|\s*[^|]*?(\d+)\s+columns?[^|]*\|/i) ||
    text.match(/\|\s*\*?\*?Reels\*?\*?\s*\|\s*(\d+)\s*\([^|]*\|/i) ||
    text.match(/\|\s*\*?\*?(?:Primary\s+)?Reels?\*?\*?\s*\|\s*(\d+)\b/i) ||
    text.match(/\|\s*\*?\*?Columns?\*?\*?\s*\|\s*(\d+)/i);
  if (reelsCell) {
    t.reels = parseInt(reelsCell[1], 10);
    t.confidence_reels = 1;
    model.confidence.topology += 0.3;
  }

  /* 2. Rows — accept "5 visible per column", "5", per-reel variable, or "4 (base)" */
  const rowsCell =
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*(\d+)(?:\s+visible)?\s*\|/i) ||
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*[^|]*?(\d+)\s+visible[^|]*\|/i) ||
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*(\d+)\s*\([^|]*\|/i) ||
    text.match(/\|\s*\*?\*?(?:Primary\s+)?Rows?\*?\*?\s*\|\s*(\d+)\b/i);
  if (rowsCell) {
    t.rows = parseInt(rowsCell[1], 10);
    t.confidence_rows = 1;
    model.confidence.topology += 0.3;
  }

  /* 3. Variable rows-per-reel (high-volume ways family) — "2-7 rows per reel" or per-reel list */
  const varRows =
    text.match(/\b(\d+)\s*[-–]\s*(\d+)\s+rows?\s+per\s+reel\b/i) ||
    text.match(/\brows?\s+per\s+reel\s*:?\s*(\d+)\s*[-–]\s*(\d+)/i) ||
    text.match(/\bvariable\s+rows?\s*\(?(\d+)\s*[-–]\s*(\d+)\)?/i) ||
    text.match(/\b(\d+)\s+visible\s+\(variable\s+(\d+)\s*[-–]\s*(\d+)\s+rows?\s+per\s+reel\)/i);
  if (varRows) {
    /* Last alt-pattern carries 3 groups (max, min, max-restated). Normalise. */
    let min, max;
    if (varRows[3]) {
      min = parseInt(varRows[2], 10);
      max = parseInt(varRows[3], 10);
    } else {
      min = parseInt(varRows[1], 10);
      max = parseInt(varRows[2], 10);
    }
    t.rows_per_reel = { min, max, variable: true };
    /* set rows to the max for grid sizing */
    if (!t.confidence_rows) t.rows = max;
  }

  /* WAVE X3 — explicit per-reel rows array, e.g. "[2,4,6,7,5,3]" or
   * "rows per reel: 2-4-6-7-5-3". Higher fidelity than {min,max} when GDD
   * gives the exact distribution. */
  const explicitArr =
    text.match(/\brows?\s+per\s+reel\s*[:=]?\s*\[\s*((?:\d+\s*,\s*){2,}\d+)\s*\]/i) ||
    text.match(/\bper[\s-]?reel\s+rows?\s*[:=]?\s*((?:\d+\s*[-–]\s*){2,}\d+)/i);
  if (explicitArr) {
    const arr = explicitArr[1].split(/[,\-–]/).map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
    if (arr.length >= 3) {
      t.rows_per_reel_array = arr;
      if (!t.rows_per_reel) {
        t.rows_per_reel = { min: Math.min(...arr), max: Math.max(...arr), variable: true };
      }
      if (!t.confidence_rows) t.rows = Math.max(...arr);
    }
  }

  /* 4. Paylines count */
  const lines = text.match(/\|\s*\*?\*?Paylines\*?\*?\s*\|\s*(\d+)/i);
  if (lines) {
    t.paylines = parseInt(lines[1], 10);
    model.confidence.topology += 0.15;
  } else {
    /* Wave W47.S22 Edge-Case B — inline / prose "N paylines" fallback.
     * Reference GDDs that don't use the table syntax still mention
     * paylines in a sentence ("with 20 paylines" / "243 ways and
     * 25 pay-lines" / "twenty-five paylines"). Without this fallback
     * the parser silently returned the freshModel default (10).
     *
     * Numeric form: \b(\d+)\s*pay[ -]?lines?\b   — anchored on word
     * boundary so we don't pick up "25" out of "25%".
     *
     * Word form: a tiny lookup for the English numerals most often
     * used in marketing copy (5, 10, 15, 20, 25, 30, 40, 50, 75, 100,
     * 243, 1024). Anything outside the table stays at default 10. */
    const inline = text.match(/\b(\d+)\s*pay[\s-]?lines?\b/i);
    if (inline) {
      t.paylines = parseInt(inline[1], 10);
      model.confidence.topology += 0.10;   /* lower confidence than table cell */
    } else {
      const WORD_NUMS = {
        five: 5, ten: 10, fifteen: 15, twenty: 20, 'twenty-five': 25,
        thirty: 30, forty: 40, fifty: 50, seventy: 70, 'seventy-five': 75,
        hundred: 100, 'one hundred': 100,
      };
      const wordMatch = text.match(/\b(twenty-five|seventy-five|one hundred|five|ten|fifteen|twenty|thirty|forty|fifty|seventy|hundred)\s+pay[\s-]?lines?\b/i);
      if (wordMatch) {
        const n = WORD_NUMS[wordMatch[1].toLowerCase()];
        if (n) {
          t.paylines = n;
          model.confidence.topology += 0.08;
        }
      }
    }
  }

  /* 5. Ways count — 117649 / 46656 / 7776 / 4096 / 3125 / 1024 / 576 / 243 */
  const waysCell = text.match(/\b(243|576|720|1024|1600|3125|4096|7776|15625|46656|117649|1000000)\s*ways?\b/i);
  if (waysCell) {
    t.ways_count = parseInt(waysCell[1], 10);
  }

  /* WAVE X3 — explicit ways_cap for Megaways-style variable_reel games.
   * GDD often gives "up to 117,649 ways" or "ways cap: 4096"; the cap is
   * the upper limit when ALL reels hit max rows. Distinct from ways_count
   * which is what the game can typically achieve. */
  const waysCap =
    text.match(/\bways\s+cap\s*[:=]?\s*([\d,]+)/i) ||
    text.match(/\bup\s+to\s+([\d,]+)\s*ways?\b/i) ||
    text.match(/\bmax(?:imum)?\s+(?:of\s+)?([\d,]+)\s*ways?\b/i);
  if (waysCap) {
    const n = parseInt(waysCap[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) t.ways_cap = n;
  } else if (t.ways_count) {
    /* Backfill ways_cap = ways_count when GDD gave one number only — most
     * fixed-ways games are capped at their declared count. */
    t.ways_cap = t.ways_count;
  }

  /* 6. Evaluation kind — explicit cell first */
  const evalCell = text.match(/\|\s*\*?\*?Evaluation\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  let kind = null;
  if (evalCell) {
    const v = evalCell[1].toLowerCase();
    if (/cluster/.test(v)) kind = 'cluster';
    else if (/ways/.test(v) || /\d+\s*ways/.test(v)) kind = 'ways';
    else if (/pay[\s-]?anywhere|scatter\s+pays?/.test(v)) kind = 'pay_anywhere';
    else if (/hex/.test(v)) kind = 'hexagonal';
    else if (/infinity/.test(v)) kind = 'infinity';
    else if (/crash/.test(v)) kind = 'crash';
    /* Wave UQ2 — explicit Evaluation: wheel/plinko/slingo/radial cells were
       falling through to /line/ default → "lines" topology over a wheel GDD
       (304 bare grid case). Add explicit segment-evaluation matches. */
    else if (/wheel|radial/.test(v)) kind = 'wheel';
    else if (/plinko|peg/.test(v)) kind = 'plinko';
    else if (/slingo/.test(v)) kind = 'slingo';
    else if (/line/.test(v)) kind = 'lines';
  }
  /* 6b. Fallback — infer from prose. Order matters: pay_anywhere is STRICT
     (must be grid-level, not "scatter pays anywhere" feature line). */
  if (!kind) {
    if (/\bcluster[\s_-]?pays?\b/i.test(text)) kind = 'cluster';
    else if (/\b(?:243|576|720|1024|1600|3125|4096|7776|15625|46656|117649|1000000)\s*ways?\b|\bways?\s+to\s+win\b|\bvariable[\s-]?ways\b|\bhigh[\s-]?ways\b/i.test(text)) kind = 'ways';
    else if (/\bhexagonal\b|\bhoneycomb\b/i.test(text)) kind = 'hexagonal';
    else if (/\binfinity\s+reels?\b|\binfini[\s-]?reels?\b|\bgrowing\s+(?:columns?|reels?)\b/i.test(text)) kind = 'infinity';
    else if (/\bcrash\s+(?:game|multiplier)\b|\baviator[\s-]?shape\b/i.test(text)) kind = 'crash';
    else if (/\bslingo\b/i.test(text)) kind = 'slingo';
    else if (/\bplinko\b|\bpeg\s+matrix\b/i.test(text)) kind = 'plinko';
    else if (/\bwheel\s+(?:bonus|game|of\s+\w+)\b|\bcrazy\s+time\b|\bsegmented\s+wheel\b/i.test(text)) kind = 'wheel';
    /* pay_anywhere — STRICT match: must say "pay anywhere grid/slot/evaluation"
       or "all positions pay". A bare "scatter pays anywhere" is a SCATTER
       mechanic for a regular-grid game, not the pay_anywhere topology. */
    else if (/\bpay[\s-]?anywhere\s+(?:grid|slot|evaluation|mechanic|pays?)\b|\ball\s+positions?\s+pays?\b/i.test(text)) kind = 'pay_anywhere';
    else kind = 'lines';
  }
  t.evaluation = kind;

  /* 7. Direction — left-to-right / right-to-left / both-ways */
  const dirCell = text.match(/\|\s*\*?\*?Direction\*?\*?\s*\|\s*([^|]+?)\s*\|/i);
  if (dirCell) {
    const v = dirCell[1].toLowerCase();
    if (/both/.test(v) || /two[\s-]?way/.test(v) || /bi[\s-]?direction/.test(v)) t.direction = 'both';
    else if (/right/.test(v)) t.direction = 'rtl';
    else t.direction = 'ltr';
  } else if (/\bboth[\s-]?ways?\s+pay\b|\bpay[s]?\s+both\s+ways?\b|\bbi[\s-]?directional\b/i.test(text)) {
    t.direction = 'both';
  } else {
    t.direction = 'ltr';
  }

  /* 8. Shape — rectangular by default, but detect non-rectangular variants.
     CRITICAL: shape detection must match a GRID CONTEXT, not a symbol name.
     We strip the symbol tables before pattern matching so e.g. a low-pay
     "Diamond" symbol can't flip the grid to diamond shape. */
  const shapeText = stripSymbolTables(text);
  const diamondArr = shapeText.match(/\b(?:diamond|multi[\s-]?way\s+xtra|both[\s-]?ways?\s+diamond)\b[^\n]*?(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)(?:\s*[-–]\s*(\d+)\s*[-–]\s*(\d+))?/i);
  const pyramidArr = shapeText.match(/\b(?:pyramid|trapezoidal?)\s+(?:grid|layout|shape|reels?)\b[^\n]*?(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)(?:\s*[-–]\s*(\d+)\s*[-–]\s*(\d+))?/i);
  if (/\bhexagonal\b|\bhoneycomb\b/i.test(shapeText)) {
    t.shape = 'hexagonal';
    const hr = shapeText.match(/\bhex(?:agonal)?\s+ring\s*=?\s*(\d+)/i);
    if (hr) t.hex_ring = parseInt(hr[1], 10);
  } else if (pyramidArr) {
    t.shape = 'pyramid';
    t.rows_per_reel_array = pyramidArr.slice(1).filter(Boolean).map(n => parseInt(n, 10));
  } else if (diamondArr) {
    t.shape = 'diamond';
    t.rows_per_reel_array = diamondArr.slice(1).filter(Boolean).map(n => parseInt(n, 10));
  } else if (/\b(?:pyramid|trapezoidal?)\s+(?:grid|layout|shape|reels?)\b/i.test(shapeText)) {
    t.shape = 'pyramid';
  } else if (/\b(?:diamond|rhombus)\s+(?:grid|layout|shape|reels?)\b|\bmulti[\s-]?way\s+xtra\b|\bdiamond\s+(?:multi[\s-]?way|both[\s-]?ways?)\b/i.test(shapeText)) {
    t.shape = 'diamond';
  } else if (/\bcross\s+shape\b|\bplus\s+shape\b|\bcruciform\b/i.test(shapeText)) {
    t.shape = 'cross';
  } else if (
    /\bl[\s-]?shape\s+(?:grid|layout|step|tetromino|arrangement|tetra)\b/i.test(shapeText) ||
    /\bstep\s+grid\b/i.test(shapeText) ||
    /\|\s*\*?\*?Shape\*?\*?\s*\|\s*L[\s-]?shape\b/i.test(shapeText) ||
    /\bL[\s-]?shape\b[^.\n]{0,40}\b(?:corner|blanked|step|arrangement)\b/i.test(shapeText)
  ) {
    t.shape = 'l_shape';
  } else if (/\bradial\s+reels?\b|\bcircular\s+(?:reels?|grid)\b/i.test(shapeText)) {
    t.shape = 'radial';
  } else {
    t.shape = 'rectangular';
  }

  /* WAVE X4 — cluster adjacency parser. Three canonical adjacency models
   * (orthogonal = 4-neighbour, diagonal = 8-neighbour, hex = 6-neighbour).
   * Only meaningful when evaluation is cluster/megaclusters/hexagonal —
   * otherwise leave null. Default to orthogonal when GDD declares cluster
   * but is silent on adjacency (industry baseline). */
  if (kind === 'cluster' || kind === 'hexagonal' || /\bmega[\s-]?clusters?\b/i.test(text)) {
    if (/\b(?:8[\s-]?neighbo(?:u)?r|diagonal\s+adjacenc|orthogonal\s+\+\s+diagonal|king[\s-]?move)\b/i.test(text)) {
      t.cluster_adjacency = 'diagonal';
    } else if (/\bhex(?:agonal)?\s+(?:adjacenc|neighbo(?:u)?r)|6[\s-]?neighbo(?:u)?r/i.test(text)) {
      t.cluster_adjacency = 'hex';
    } else if (/\b(?:4[\s-]?neighbo(?:u)?r|orthogonal\s+adjacenc|rook[\s-]?move|connected\s+(?:horizontally|vertically))\b/i.test(text)) {
      t.cluster_adjacency = 'orthogonal';
    } else {
      /* Industry default when cluster declared without adjacency text. */
      t.cluster_adjacency = kind === 'hexagonal' ? 'hex' : 'orthogonal';
    }
    /* Minimum cluster size — typical 5..8 for cluster pays games. */
    const minMatch =
      text.match(/\bclusters?\s+of\s+(\d+)\s*(?:or\s+more|\+)?\s+(?:adjacent|symbols?|connected)/i) ||
      text.match(/\bmin(?:imum)?\s+cluster\s*(?:size)?\s*[:=]?\s*(\d+)/i) ||
      text.match(/\b(\d+)\s+or\s+more\s+(?:adjacent|connected)\s+symbols?/i);
    if (minMatch) {
      const n = parseInt(minMatch[1], 10);
      if (Number.isFinite(n) && n >= 3 && n <= 12) t.cluster_min_size = n;
    } else if (kind === 'cluster' && !t.cluster_min_size) {
      t.cluster_min_size = 5;   /* industry default for cluster pays */
    }
  }

  /* 9. Cascade / tumble / avalanche flag (game-flow trait, not math) */
  /* Re-uses the same negation-aware logic as feature detection. */
  const noCascade = /^\|[^\n|]*?(?:cascade|tumble|avalanche)[^\n|]*?\|[^\n|]*?\b(?:not\s+in\s+this\s+product|n\/a|disabled|none)\b/im.test(text);
  if (!noCascade && /\b(?:cascad(?:e|ing)|tumbl(?:e|ing)|avalanche)(?:\s+\w+){0,2}\s+(?:mechanic|feature|engine|reel|reels|round|game|win|wins|pays?|symbols?)\b|\bReel\s+mechanism\s*[—:|]\s*Cascade\b/i.test(text)) {
    t.cascade = { enabled: true, direction: 'down' };
  } else {
    t.cascade = { enabled: false };
  }

  /* 10. Growable / Infinity Reels */
  if (kind === 'infinity' || /\binfinity\s+reels?\b|\bgrowing\s+(?:columns?|reels?)\b/i.test(text)) {
    t.growable = true;
    t.evaluation = 'infinity';
  }

  /* 11. Tiered/expanding grid (rows or reels grow on feature trigger).
     Requires an EXPLICIT expansion keyword — never trigger on plain
     "2-7 rows per reel" (which is variable_reel, not expanding). */
  const expCell =
    text.match(/\bexpanding\s+(?:grid|rows?)\b[^\n.]*?(\d+)\s*[→\-–>]+\s*(\d+)/i) ||
    text.match(/\|\s*\*?\*?Rows\*?\*?\s*\|\s*(\d+)\s*base\s*[→\-–>]+\s*(\d+)\s*max/i) ||
    text.match(/\|\s*\*?\*?Tiered\s+rows?\*?\*?\s*\|\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/i) ||
    text.match(/\|\s*\*?\*?Tiered\s+rows?\*?\*?\s*\|\s*(\d+)[^|]*?[→\-–>]+[^|]*?(\d+)/i) ||
    text.match(/(\d+)\s+base\s*[→\-–>]+\s*(\d+)\s+max/i);
  if (expCell) {
    t.tiered_rows = [parseInt(expCell[1], 10), parseInt(expCell[2], 10)];
    t.evaluation = t.evaluation || 'lines';
  }
  /* Prose: explicit "pop wins" / "gigarise" / "expanding grid" */
  if (/\bpop[\s-]?(?:wins?|grid|burst)\b|\bgigarise\b|\bexpanding\s+(?:grid|rows?)\b/i.test(text)) {
    if (!t.tiered_rows) t.tiered_rows = [t.rows || 3, (t.rows || 3) * 3]; // best-effort
  }

  /* 12. Lock-and-respin (Hold & Spin / lock-collect respin shape) */
  if (/\block[\s-]?and[\s-]?respin\b|\bhold[\s-]?and[\s-]?spin\b|\brespin\s+until\s+empty\b|\bsymbols\s+lock\s+in\s+place\b/i.test(text)) {
    t.lock_respin = true;
  }

  /* 13. Twin / mirrored reels */
  if (/\btwin\s+reels?\b/i.test(text)) t.twin_reels = true;
  if (/\bmirrored\s+reels?\b/i.test(text)) t.mirrored_reels = true;

  /* 14. Multi-grid (dual / quad) */
  const multiGrid = text.match(/\b(\d+)\s*[×x*]\s*(\d+x\d+)\s+grids?\b|\bdual[\s-]?grid\b|\bquad[\s-]?grid\b|\bcolossal\s+dual\b/i);
  if (multiGrid) {
    if (/dual|colossal/i.test(multiGrid[0])) t.grid_count = 2;
    else if (/quad/i.test(multiGrid[0])) t.grid_count = 4;
    else t.grid_count = parseInt(multiGrid[1], 10);
  }
  if (/\bcolossal\s+(?:reels?|dual|grid|layout)\b|\bcolossal\s+\d+\s*x\s*\d+\s*\+\s*\d+\s*x\s*\d+\b/i.test(text)) {
    t.is_colossal = true;
    t.grid_count = Math.max(t.grid_count || 1, 2);
  }

  /* Cluster eval games don't use paylines */
  if (t.evaluation === 'cluster' || t.evaluation === 'pay_anywhere' || t.evaluation === 'hexagonal') {
    t.paylines = null;
  }

  /* 15. Slingo / Plinko / Crash / Wheel flags — derived from evaluation + prose */
  if (t.evaluation === 'slingo' || /\bslingo\b/i.test(text)) t.is_slingo = true;
  if (t.evaluation === 'plinko' || /\bplinko\b|\bpeg\s+matrix\b/i.test(text)) t.is_plinko = true;
  if (/\bplinko\s+rows?\s*=?\s*(\d+)/i.test(text)) {
    const m = text.match(/\bplinko\s+rows?\s*=?\s*(\d+)/i);
    if (m) t.plinko_rows = parseInt(m[1], 10);
  }
  if (/\bsegmented\s+wheel\b|\bwheel\s+segments?\s*[=|]\s*(\d+)/i.test(text)) {
    const m = text.match(/\bwheel\s+segments?\s*[=|]?\s*\*?\*?\s*\|?\s*(\d+)/i) ||
              text.match(/\|\s*\*?\*?\s*Wheel\s+segments?\s*\*?\*?\s*\|\s*(\d+)/i);
    if (m) t.wheel_segments = parseInt(m[1], 10);
  }

  /* 16. Split-cluster variant — quarter-split cluster topology (per-symbol quad subdivision) */
  if (/\bmega[\s-]?clusters?\b|\bsplit[\s-]?clusters?\b|\bquarter[\s-]?split\s+cluster\b/i.test(text)) {
    t.is_megaclusters = true;
  }

  /* 17. CANONICAL `kind` — final classification used by gridShape.mjs */
  t.kind = canonicalKind(t);

  /* Final confidence — if we've identified eval + shape + reels + rows, we're max */
  if (t.evaluation && t.shape && t.confidence_reels && t.confidence_rows) {
    model.confidence.topology = 1.0;
  } else if (t.evaluation) {
    model.confidence.topology = Math.max(model.confidence.topology, 0.7);
  }
}

/* ─── canonical kind classifier — single source of truth ─── */
export function canonicalKind(t) {
  if (t.is_slingo)        return 'slingo';
  if (t.is_plinko)        return 'plinko';
  if (t.evaluation === 'crash') return 'crash';
  if (t.evaluation === 'wheel' || t.wheel_segments) return 'wheel';
  if (t.is_megaclusters)  return 'megaclusters';
  if ((t.grid_count || 1) >= 2) return 'dual';
  if (t.shape === 'hexagonal') return 'hexagonal';
  if (t.shape === 'pyramid')   return 'pyramid';
  if (t.shape === 'diamond')   return 'diamond';
  if (t.shape === 'cross')     return 'cross';
  if (t.shape === 'l_shape')   return 'l_shape';
  if (t.shape === 'radial')    return 'radial';
  if (t.evaluation === 'cluster')  return 'cluster';
  if (t.growable || t.evaluation === 'infinity') return 'infinity';
  if (t.tiered_rows && t.tiered_rows.length === 2) return 'expanding';
  if (t.rows_per_reel && t.rows_per_reel.variable) return 'variable_reel';
  if (t.lock_respin) return 'lock_respin';
  return 'rectangular';
}

/* ─── helper: strip the four symbol tables so shape/eval regex can't
       false-positive on a symbol named "Diamond" / "Wheel" / "Cluster". */
export function stripSymbolTables(text) {
  return text.replace(
    /^###[^\n]*\b(?:High|Mid|Low)[\s-]?pay\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n###\s|\Z)/gim,
    ''
  ).replace(
    /^###[^\n]*\bSpecials?\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n###\s|\Z)/gim,
    ''
  );
}

/* ─── helper: symbol table rows under a heading ────────────── */
export function extractSymbolBlock(text, headingRegex, sink) {
  /* Wave AL-3 (2026-06-11, Boki WoO PDF audit): two-step heading scope
   * fix so this extractor works on BOTH MD input (each heading on its
   * own line) AND PDF flow text (pdfjs strips newlines → one giant
   * line).
   *
   * Step 1 — heading match: disallow `#` (would span past the next
   * heading) and `|` (would consume the section's own table content)
   * between the opening `###` and the tier keyword. The match ends at
   * the tier keyword itself so the chunk starts at the FIRST byte of
   * actual section content.
   *
   * Step 2 — chunk end: search for next `## ` / `### ` heading in PDF
   * flow text where headings sit inline (no `\n` separators), or the
   * traditional `\n## ` / `\n### ` markers for MD input. We start the
   * search from position 1 of rest so we can't zero-length the chunk
   * when the first byte of rest happens to be whitespace immediately
   * before a heading. */
  const headingMatch = text.match(new RegExp(`###[^#|\\n]*?${headingRegex.source}\\b`, 'i'));
  if (!headingMatch) return;
  const start = headingMatch.index + headingMatch[0].length;
  const rest = text.slice(start, start + 4000);
  const endRel = rest.slice(1).search(/[\n\s]#{2,3}\s+\S/);
  const end = endRel >= 0 ? endRel + 1 : -1;
  const chunk = end >= 0 ? rest.slice(0, end) : rest;
  // accept table rows like: | `D` | Diamond | … | or | D | Diamond | … |
  // ID MUST start with a letter — guards against multi-column pay tables
  // (e.g. 6-col bucket paytable format) where the regex would otherwise
  // pick up pay multipliers like "10x" or count thresholds like "8" as IDs.
  const rowRe = /\|\s*`?([A-Za-z][A-Za-z0-9_]{0,3})`?\s*\|\s*([^|]+?)\s*\|/g;
  const seen = new Set();
  let m;
  while ((m = rowRe.exec(chunk)) !== null) {
    const id = m[1].trim();
    const name = m[2].trim();
    if (id.toLowerCase() === 'id' || name.toLowerCase() === 'name') continue;
    if (id.length > 4) continue;
    // Skip Name cells that look like pay multipliers ("10x", "2.5x", "1000x")
    if (/^\d+(?:\.\d+)?\s*x?$/i.test(name)) continue;
    // Skip Name cells that are bucket headers ("8-9", "10-11", "12+")
    if (/^\d+\s*[-+–]\s*\d*$/.test(name)) continue;
    // Dedupe (multi-column tables may emit the same row twice via regex backtrack)
    if (seen.has(id)) continue;
    seen.add(id);
    sink.push({ id, name });
  }
}

/* ─── Wave UQ — prose-mode symbol extractor ─────────────────────────
 * Boki 2026-06-21 "kreni ultimativno" — many real-world vendor-portfolio
 * GDDs are PDFs without paytable tables (each game written as one prose
 * paragraph). The traditional `extractSymbolBlock` finds 0 symbols and
 * synthetic fallback fires for every fixture (29/29 in deep-seek QA).
 *
 * This extractor walks the raw text looking for canonical SYMBOL ROLE
 * phrases — "<NAME> WILD", "<NAME> SCATTER", "<NAME> BONUS", named
 * tier groups ("Premium symbols", "Low-pay symbols"), and explicit
 * standalone wild/scatter mentions. Vendor-neutral: never reads brand
 * names; only the role keyword + the preceding noun phrase.
 */
export function extractSymbolsProseMode(rawText, model) {
  if (!rawText || !model || !model.symbols) return;
  const specials = model.symbols.specials;
  const seen = new Set(specials.map((s) => (s.id || '').toUpperCase()));
  /* Track also lowercased name to prevent "Wild" being added twice as W & W1. */
  const seenNames = new Set(specials.map((s) => (s.name || s.label || '').toLowerCase()));

  function _push(id, name, kind, extra = {}) {
    const idUC = (id || '').toUpperCase();
    const nameLC = (name || '').toLowerCase();
    if (idUC && seen.has(idUC)) return;
    if (nameLC && seenNames.has(nameLC)) return;
    seen.add(idUC);
    seenNames.add(nameLC);
    specials.push({ id: idUC, name, label: name, kind, _source: 'prose-mode', ...extra });
  }

  /* Pattern A — "<NAME>" + role keyword. NAME is up to 4 capitalised words
   * (e.g. "WOLF WILD", "HARD HAT SCATTERS", "BUZZ SAW BONUS WHEEL",
   * "MULTIPLIER ORB SYMBOL"). Role keyword ∈ {WILD, SCATTER, BONUS, MULTIPLIER}
   * — and case-insensitive after the leading capital(s) so prose-cased
   * "Wolf Wild" / "Hard Hat scatter" all match. */
  /* Match up to 3 ALL-CAPS or Title-Case words immediately before the role
   * keyword. Capture is greedy on words but bounded by a sentence-start
   * delimiter — `.`, `:`, newline, or `>` (Markdown blockquote) — so
   * upstream headings don't leak into the name. */
  const ROLE_PATTERN = /(?:^|[.:>\n])\s*([A-Z][A-Za-z'’]{1,15}(?:\s+[A-Z][A-Za-z'’]{1,15}){0,2})\s+(WILD|SCATTER|SCATTERS|BONUS|MULTIPLIER|JACKPOT)S?\b/g;
  let m;
  while ((m = ROLE_PATTERN.exec(rawText)) !== null) {
    let namePhrase = m[1].trim();
    const roleRaw = m[2].toUpperCase();
    /* Filter false positives: skip common section-header noise + standalone
     * adjectives that happen to precede the role word. */
    if (/^(?:The|All|Each|Every|Some|Most|Any|This|That|Of|Free|Game|Bonus|Slot|Hold|Lock|Symbol|Symbols|Reels?|Spins?|Mode|System|Round|Feature|Picks?|Core|Mechanic|Mechanics|Section|Page|Notes?)$/i.test(namePhrase)) continue;
    if (namePhrase.length > 30) continue;
    /* If namePhrase starts with a generic section word followed by a real
     * subject (e.g. "Core Mechanics HARD HAT"), strip the leading generic
     * prefix and keep just the trailing subject. */
    namePhrase = namePhrase.replace(/^(?:Core\s+Mechanics?|Bonus\s+Features?|Game\s+Overview|Section\s+\d+|Page\s+\d+|Notes?)\s+/i, '').trim();
    if (!namePhrase) continue;
    /* Filter known feature-name false positives — these are mechanics
     * (free spins, hold and win, lock it link series, etc.), not symbols
     * carrying a role suffix. Vendor-neutral: never matches a SPECIFIC
     * game-name, only the canonical mechanic phrasings. */
    if (/^(?:FREE\s+SPINS?|FS|HOLD(?:\s*(?:AND|&)?\s*(?:WIN|SPIN))?|LOCK(?:\s*IT)?(?:\s*LINK)?|MEGA\s*WAYS?|CASH\s*FALLS?|LIGHTNING|RESPIN|FREE\s+GAMES?|RE-?SPIN)$/i.test(namePhrase)) continue;

    let kind;
    if (roleRaw.startsWith('WILD')) kind = 'wild';
    else if (roleRaw.startsWith('SCATTER')) kind = 'scatter';
    else if (roleRaw === 'BONUS') kind = 'bonus';
    else if (roleRaw === 'MULTIPLIER') kind = 'multiplier';
    else if (roleRaw === 'JACKPOT') kind = 'jackpot';
    else continue;

    /* Build ID from first letters: "WOLF WILD" → 'W', "HARD HAT" → 'HH'.
     * Single letter when one word; first letters of each word otherwise. */
    const words = namePhrase.split(/\s+/);
    let id = words.map((w) => w[0]).join('').toUpperCase().slice(0, 4);
    if (!id) continue;
    if (seen.has(id)) {
      /* Disambiguate when two symbols share the same initial letter. */
      let i = 2;
      while (seen.has(id + i) && i < 10) i++;
      id = id + i;
    }
    _push(id, namePhrase, kind);
  }

  /* Pattern B — standalone "Wild" / "Scatter" mention with NO preceding
   * noun phrase. Adds canonical W / S symbol when GDD only mentions the
   * role in passing (e.g. "Wild substitutes for all paying symbols"). */
  if (!specials.some((s) => s.kind === 'wild')) {
    if (/\bWild\s+(?:substitutes?|symbol|replaces?|appears?\s+on|stays?\s+(?:on|sticky))/i.test(rawText)) {
      _push('W', 'Wild', 'wild');
    }
  }
  if (!specials.some((s) => s.kind === 'scatter')) {
    if (/\bScatter\s+(?:symbol|pays?|triggers?|on\s+(?:any|reels?)|anywhere)/i.test(rawText)) {
      _push('S', 'Scatter', 'scatter');
    }
  }
  if (!specials.some((s) => s.kind === 'bonus')) {
    if (/\bBonus\s+(?:symbol|orb|coin|triggers?\s+free|trigger)/i.test(rawText)) {
      _push('B', 'Bonus', 'bonus');
    }
  }

  /* Pattern C — "Hold(\s|-)?&?\s?Win" / "Hold and Spin" implies bonus-orb
   * trigger family. If features include holdAndWin but no bonus symbol
   * in roster yet, add a canonical orb. */
  if (Array.isArray(model.features) &&
      model.features.some((f) => f && (f.kind === 'holdAndWin' || f.kind === 'hold_and_win')) &&
      !specials.some((s) => s.kind === 'bonus')) {
    _push('B', 'Bonus Orb', 'bonus');
  }

  /* Pattern D — capture progressive jackpot tier names if mentioned. */
  if (/\b(?:MINI|MINOR|MAJOR|GRAND)\b/.test(rawText) && !specials.some((s) => s.kind === 'jackpot')) {
    _push('JP', 'Jackpot', 'jackpot');
  }
}

/* ─── helper: feature kinds from prose ─────────────────────── */
export function extractFeatures(rawText) {
  // (a) strip explicit "out of scope" / "non-features" SECTIONS so a body-
  //     level "cascade" inside them doesn't fire.
  let text = rawText.replace(
    /#{2,3}\s*(?:\d+\.\s*)?(?:Out[\s-]of[\s-]scope|Explicit non-features|Not in this product)[^#]*(?=#{2,3}|\Z)/gis,
    ''
  );

  // (b) strip individual TABLE ROWS that explicitly negate a feature —
  //     e.g. "| Tumble / cascade mechanic | Not in this product — fixed-reel slot |"
  //     or  "| Cascade | N/A |" / "| Cascade | Disabled |" / "| Cascade | None |"
  text = text.replace(
    /^\|[^\n|]*?\|[^\n|]*?\b(?:not\s+in\s+this\s+product|out\s+of\s+scope|none|n\/a|disabled|excluded|—|–)\b[^\n|]*?\|.*$/gim,
    ''
  );

  // (b2) strip prose lines that explicitly negate a feature —
  //      e.g. "This game has no Bonus Orb / Hold & Win."
  //      "This product has no cascade." / "no Free Spins in this product".
  text = text.replace(
    /^[^\n]*\b(?:has\s+no|with\s*no|without|game\s+has\s+no|no\s+(?:Bonus\s+Orb|Hold\s*&\s*Win|Free\s+Spins|Cascade|Multiplier|Wild|Scatter|Lightning|Respin))\b[^\n]*$/gim,
    ''
  );

  // (c) patterns — for features that are commonly described in passing
  //     (cascade is *also* an animation noun) require an explicit mechanic
  //     qualifier so VFX language like "coin cascade" doesn't false-positive.
  const patterns = [
    { kind: 'free_spins', re: /\bfree[\s-]?spins?\b/i, label: 'Free Spins' },
    {
      kind: 'hold_and_win',
      // GDDs spell it many ways: "Hold and Win", "Hold & Win", "H&W",
      // "Hold and Spin", "Hold & Spin" (Lightning Link family),
      // "Lock It Link" (Scientific Games franchise marker).
      re: /\bhold\s*(?:and|&)\s*(?:win|spin)\b|\bH\s*&\s*(?:W|S)\b|\block\s+it\s+link\b/i,
      label: 'Hold & Win',
    },
    {
      kind: 'cascade',
      // Must be the slot mechanic — require a slot-context qualifier so
      // "coin cascade" / "200 ms cascade" (animation language) don't fire.
      // Allow 0-2 words between the noun and qualifier so phrases like
      // "Cascade chain mechanic" pass.
      // 2026-06-10 — added Serbian qualifiers (mehanika, kaskada) and `+`
      // separator so Pragmatic-style "Tumble + scatter pays" + Gates PDF's
      // section heading "Tumble (Cascade) Mehanika" both trigger.
      re: /\b(?:cascad(?:e|ing)|tumbl(?:e|ing)|avalanche)(?:[\s+()]+\w+){0,3}\s*(?:[\s+()]*)\s*(?:mechanic|mehanika|feature|engine|reel|reels|round|game|win|wins|pays?|symbols?|chain|lanac|cascade)\b|\bReel\s+mechanism\s*[—:|]\s*Cascade\b|##\s*\d*\.?\d*\s*Tumble\b|\bprocessTumble\b/i,
      label: 'Cascade / Tumble',
    },
    { kind: 'multiplier', re: /\bmultiplier(s)?\b/i, label: 'Multiplier' },
    {
      // 2026-06-10 — relaxed: matches "Expanding Wild", "Expanding King"
      // (Starlight pattern), "Expanding Symbol", etc. The "wild substitute"
      // qualifier covers vendor-specific names where the expanding entity
      // isn't literally called "wild" (e.g. Starlight's Three Kings system).
      kind: 'expanding_wild',
      re: /\bexpanding[\s_-]?(?:wild|king|symbol|reel|stack|frame)\b|\bexpands?\s+to\s+(?:cover|fill)\s+(?:entire|full)?\s*reel\b/i,
      label: 'Expanding Wild',
    },
    { kind: 'walking_wild', re: /\bwalking[\s_-]?wild/i, label: 'Walking Wild' },
    { kind: 'sticky_wild', re: /\bsticky[\s_-]?wild/i, label: 'Sticky Wild' },
    { kind: 'mystery_symbol', re: /\bmystery[\s_-]?symbol/i, label: 'Mystery Symbol' },
    {
      kind: 'bonus_buy',
      // "Bonus Buy" / "Buy Feature" / "Feature Buy" — direct entry purchase.
      re: /\bbonus[\s_-]?buy\b|\bbuy[\s_-]?(?:feature|bonus|fs)\b|\bfeature[\s_-]?buy\b/i,
      label: 'Bonus Buy',
    },
    {
      // 2026-06-10 — bonus_pick captures the universal "pick & reveal"
      // mini-game pattern: "Pick Bonus", "Pick Me", "pick-and-reveal",
      // "Mystery Pick", "Treasure Pick", "Selection Bonus", "pick 3 of N".
      // Vendor variants: Starlight Mystery Upgrade Selection, Pragmatic
      // Cash Pick, NetEnt Treasure Hunt.
      kind: 'bonus_pick',
      re: /\bpick[\s_-]?(bonus|me)\b(?!\s*axe)|\bpick[\s_-]?and[\s_-]?reveal\b|\bpick[\s_-]?to[\s_-]?reveal\b|\bmystery\s+(?:upgrade|pick|selection|reveal)\b|\bselect(?:\s+\w+){0,2}\s+orbs?\b|\bselection\s+bonus\b|\btreasure\s+pick\b/i,
      label: 'Bonus Pick',
    },
    { kind: 'wheel_bonus', re: /\bwheel\s+bonus|bonus\s+wheel/i, label: 'Wheel Bonus' },
    {
      /* 2026-06-10 — synthetic fixtures declare these explicit kinds. */
      kind: 'weighted_wheel_segments',
      re: /\bweighted\s+wheel\s+segments?\b|\bweighted[\s_-]?wheel\b/i,
      label: 'Weighted Wheel Segments',
    },
    {
      kind: 'jackpot',
      re: /\bjackpot(?:s|\s+(?:ladder|tier|map|ladder|system))?\b/i,
      label: 'Jackpot',
    },
    { kind: 'progressive_free_spins', re: /\bprogressive\s+free[\s-]?spins?\b/i, label: 'Progressive FS' },
    { kind: 'persistent_multiplier', re: /\bpersistent\s+multiplier\b/i, label: 'Persistent Multiplier' },
    { kind: 'multiplier_orb', re: /\bmultiplier\s+orbs?\b/i, label: 'Multiplier Orb' },
    { kind: 'gamble_secondary', re: /\bgamble\s+ladder\b|\bladder\s+gamble\b/i, label: 'Gamble Ladder' },
    { kind: 'bonus_buy_deterministic', re: /\bbonus\s+buy\s+tier\b|\bdeterministic\s+(?:bonus|buy|plant)\b/i, label: 'Bonus Buy Deterministic' },
    { kind: 'path_aware_multiplier', re: /\bpath[\s_-]?aware\s+multiplier\b|\bpath\s+multiplier\b/i, label: 'Path-Aware Multiplier' },
    { kind: 'cluster_pays', re: /\bcluster[\s_-]?pays?\b/i, label: 'Cluster Pays' },
    {
      kind: 'ways',
      re: /\b(?:243|576|1024|3125|117649)\s*ways?\b|\bways?\s+to\s+win\b/i,
      label: 'Ways',
    },
    { kind: 'scatter_pay', re: /\bscatter\s+pays?\b/i, label: 'Scatter Pay' },
    {
      kind: 'lightning',
      // Require a feature qualifier — naked "lightning" (color, sprite,
      // theme) is too generic in mythology-themed games.
      re: /\blightning[\s_-]?(?:multiplier|spark|strike|feature)\b/i,
      label: 'Lightning',
    },
    { kind: 'respin', re: /\brespin/i, label: 'Respin' },
    { kind: 'wild_reel', re: /\bwild[\s_-]?reel/i, label: 'Wild Reel' },
    { kind: 'gamble', re: /\bgamble\s+(feature|ladder|round)\b/i, label: 'Gamble' },
    { kind: 'ante_bet', re: /\bante[\s_-]?bet\b/i, label: 'Ante Bet' },
    {
      kind: 'super_symbol',
      // 2×2, 3×3, 4×4 colossal symbol — game-design vocabulary.
      re: /\b(?:super[\s_-]?symbol|colossal[\s_-]?symbol|mega[\s_-]?symbol|giant[\s_-]?symbol)\b/i,
      label: 'Super Symbol',
    },
    {
      kind: 'win_cap',
      // Regulator-mandated terminator. Phrase patterns: "Win Cap", "Max Win Cap",
      // "Cap Reached" — strictly game-flow noun, not a math value.
      re: /\bwin[\s_-]?cap\b|\bcap[\s_-]?reached\b|\bmax[\s_-]?win[\s_-]?cap\b/i,
      label: 'Win Cap',
    },
    {
      // Wave C1 — UKGC LCCP 8.3 / MGA RGF mandated periodic player summary.
      kind: 'reality_check',
      re: /\breality[\s_-]?check\b|\bperiodic[\s_-]?summary\b|\bsession[\s_-]?check[\s_-]?popup\b/i,
      label: 'Reality Check',
    },
    {
      // Wave C1 — SGA / DGA mandated continuous-play cap with forced break.
      kind: 'session_timeout',
      re: /\bsession[\s_-]?timeout\b|\bcontinuous[\s_-]?play[\s_-]?cap\b|\bforced[\s_-]?break\b|\bsession[\s_-]?limit\b/i,
      label: 'Session Timeout',
    },
    {
      // Wave C1 — DGA / Spelinspektionen mandated cumulative net-loss surface.
      kind: 'net_loss_indicator',
      re: /\bnet[\s_-]?loss[\s_-]?indicator\b|\bcumulative[\s_-]?loss[\s_-]?display\b|\bnet[\s_-]?loss\b(?:\s+(?:indicator|display|surface|threshold))?/i,
      label: 'Net Loss Indicator',
    },
    {
      kind: 'persistent_multiplier',
      // FS multiplier that doesn't reset within the round.
      re: /\bpersistent[\s_-]?multiplier\b|\bmultiplier\s+(?:never\s+resets|grows\s+with)|\bgrows\s+with\s+each\s+cascade\b/i,
      label: 'Persistent Multiplier',
    },
    {
      // Wave U1 — FS multiplier escalator (every FS spin advances regardless of win)
      kind: 'progressive_free_spins',
      re: /\bprogressive[\s_-]?(?:free[\s_-]?spins?|fs)\b|\bfs[\s_-]?multiplier[\s_-]?(?:ladder|escalator|climbs?|grows?)\b|\bmultiplier\s+grows\s+(?:every|each)\s+spin\b|\beach\s+(?:free[\s_-]?)?spin\s+(?:adds|grants|raises)\s+\+?\d+\s*x?\s*(?:to\s+the\s+)?(?:fs[\s_-]?)?multiplier/i,
      label: 'Progressive Free Spins',
    },
    /* 2026-06-10 (Boki rule "audio van scope-a; UI infra ne ide u features list"):
     * `audio` i `ui_toast` patterns su uklonjeni iz extractFeatures. Audio je
     * eksplicitna Boki zabrana — ne sme se pominjati u simulator scope-u.
     * `ui_toast` je infrastrukturni blok (uvek default-on kao win-celebration
     * placard), ne game-design feature kojeg igrač bira/koji se forsuje. Ostaje
     * dostupan kao runtime blok, samo ne curi u model.features array i u UFP. */
    {
      // Wave V1 — Slam-stop button (industry-reference SlamStopCommand)
      kind: 'slam_stop',
      re: /\b(?:slam[\s_-]?stop|quick[\s_-]?stop|reels?\s+slam)\b|\b##\s+(?:Slam[\s_-]?Stop|Quick[\s_-]?Stop)\b/i,
      label: 'Slam Stop',
    },
    {
      // Wave V2 — Force-skip button (industry-reference ForceSkipCommand)
      kind: 'force_skip',
      re: /\b(?:force[\s_-]?skip|skip[\s_-]?animation|skip[\s_-]?button)\b|\b##\s+(?:Force[\s_-]?Skip|Skip[\s_-]?Animation)\b/i,
      label: 'Force Skip',
    },
    {
      // Wave U4 — Autoplay (industry-reference AutoSpinSettingsPanel)
      kind: 'autoplay',
      re: /\b(?:autoplay|auto[\s_-]?spin|auto[\s_-]?play)\b|\b##\s+(?:Autoplay|Auto[\s_-]?Spin|Auto[\s_-]?Play)\b/i,
      label: 'Autoplay',
    },
  ];

  const out = [];
  const seen = new Set();
  for (const p of patterns) {
    if (p.re.test(text) && !seen.has(p.kind)) {
      out.push({ kind: p.kind, label: p.label });
      seen.add(p.kind);
    }
  }
  // respin is usually a sub-mechanic of H&W — de-dupe.
  if (seen.has('hold_and_win') && seen.has('respin')) {
    const filtered = out.filter(f => f.kind !== 'respin');
    /* Wave P6 — generic feature discovery pass (see helper below). */
    return appendGenericFeatures(text, filtered, seen);
  }
  /* Wave P6 — generic feature discovery pass.
     Any feature name mentioned in the GDD that none of the ~50
     patterns above caught is registered as `feature_generic` with
     the verbatim label so the renderer NEVER drops it silently.
     Idempotent: dedupes by lowercase label, skips known kinds. */
  return appendGenericFeatures(text, out, seen);
}

/* ─── Wave P6 — generic feature discovery ────────────────────
 *
 * Catches feature names the parser's pattern bank does NOT recognise.
 * Rule: "nikad crveno ni za izmišljeni feature" (master TODO P6).
 *
 * Discovery surfaces, in order of preference:
 *   1. Markdown headings ending in "Feature" / "Mechanic" / "Bonus"
 *      (case-insensitive). E.g. `## PsyOps Rain Feature`.
 *   2. Bold tags `**X Feature**` / `**X Mechanic**` inside body text.
 *   3. Bullet rows under a "Features" / "Mechanics" section.
 *
 * Dedupe rules:
 *   - Skip if label (lowercased, stripped) matches an already-emitted
 *     feature label.
 *   - Skip generic noise tokens (free spins, wild, multiplier, etc.)
 *     since those are already covered by the explicit patterns above.
 *   - Cap at 12 discovered generics per GDD (sane upper bound — beyond
 *     that the GDD is likely listing UI strings, not real features).
 *
 * Output shape: `{ kind: 'feature_generic', label, _discovered: true }`.
 * Downstream `buildSlotHTML` already renders unknown kinds via the
 * `featureList` UI block without throwing, so the only thing P6 needs
 * is the surface that lets discovery results through.
 */
const _GENERIC_FEATURE_BLOCKLIST = new Set([
  'free spins', 'wild', 'multiplier', 'cascade', 'cluster pays', 'ways',
  'scatter pay', 'lightning', 'respin', 'gamble', 'ante bet', 'autoplay',
  'reality check', 'session timeout', 'net loss indicator', 'feature',
  'mechanic', 'bonus', 'feature mechanic', 'feature feature', 'mechanic feature',
  'mechanic mechanic', 'bonus feature', 'feature bonus', 'super symbol',
  'force skip', 'slam stop', 'turbo mode', 'settings panel', 'bonus pick',
  'bonus buy', 'sticky wild', 'expanding wild', 'walking wild', 'wild reel',
  'mystery symbol', 'persistent multiplier', 'progressive free spins',
  'hold and win', 'hold & win', 'wheel bonus', 'win cap', 'ui toast',
  'paytable', 'balance hud', 'history log', 'audio', 'pay anywhere',
  'free spins feature', 'bonus mechanic', 'bonus feature mechanic',
  'main feature', 'core mechanic', 'core feature', 'key feature',
  'special feature', 'special mechanic', 'this feature', 'that feature',
  'the feature', 'a feature', 'an feature',
]);

const _GENERIC_MAX = 12;

export function extractGenericFeatures(rawText, knownLabels = new Set()) {
  if (typeof rawText !== 'string' || rawText.length === 0) return [];

  /* Same "out of scope" / "non-features" cleanup as extractFeatures so
     we don't lift labels from explicit-negation sections. */
  let text = rawText.replace(
    /#{2,3}\s*(?:\d+\.\s*)?(?:Out[\s-]of[\s-]scope|Explicit non-features|Not in this product)[^#]*(?=#{2,3}|\Z)/gis,
    ''
  );

  const found = new Map(); // lowercased label -> verbatim label
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();

  /* Strip standard suffixes so "Wild Feature" → "wild" matches the
     extractFeatures `wild` label during dedupe. */
  const stripSuffix = (s) =>
    s.replace(/\s+(feature|mechanic|bonus|ability|power)s?\s*$/i, '').trim();

  const tryAdd = (rawLabel) => {
    const label = norm(rawLabel)
      .replace(/^[\d.]+\s*/, '')          // strip "1. " / "2.1 "
      .replace(/^[·•⋅]\s*/, '')            // strip leading bullet from "## 10 · Title" style headings
      .replace(/[*_#`]/g, '')              // strip markdown decoration
      .replace(/[:\-–—|]+$/, '')           // strip trailing punctuation
      .replace(/^[:\-–—|]+/, '')
      .trim();
    if (label.length < 3 || label.length > 60) return;
    const lo = lower(label);
    if (_GENERIC_FEATURE_BLOCKLIST.has(lo)) return;
    const stripped = lower(stripSuffix(label));
    if (_GENERIC_FEATURE_BLOCKLIST.has(stripped)) return;
    /* Pure-number / pure-symbol labels are noise, not features. */
    if (!/[a-z]/i.test(label)) return;
    /* Skip if a *known* feature label collides (case-insensitive),
       both with and without "Feature/Mechanic/Bonus" suffix. */
    for (const k of knownLabels) {
      const kl = lower(k);
      const ks = lower(stripSuffix(k));
      if (kl === lo || kl === stripped || ks === lo || ks === stripped) return;
    }
    /* Skip if a previously-extracted generic has the same (stripped) label. */
    if (found.has(lo) || found.has(stripped)) return;
    found.set(lo, label);
  };

  /* 1. Markdown headings ending in Feature / Mechanic / Bonus. */
  const headingRe = /^#{1,4}\s*(?:\d+\.\s*)?(.+?)\s*(?:feature|mechanic|bonus|ability|power)\s*$/gim;
  let m;
  while ((m = headingRe.exec(text)) !== null && found.size < _GENERIC_MAX) {
    tryAdd(`${m[1]} ${m[0].match(/(feature|mechanic|bonus|ability|power)/i)[0]}`);
  }

  /* 2. Bold tags. */
  const boldRe = /\*\*([^*\n]{3,40}?(?:feature|mechanic|bonus|ability|power))\*\*/gi;
  while ((m = boldRe.exec(text)) !== null && found.size < _GENERIC_MAX) {
    tryAdd(m[1]);
  }

  /* 3. Bullet rows under a "Features" / "Mechanics" / "Bonus" section.
        JS RegExp has no `\Z`, so split-on-heading-boundary is simpler
        and equally deterministic. Walk every line; when we hit a
        candidate section heading flip an `inSection` flag; on next
        heading flip off. */
  /* Any heading whose text ends in features/mechanics/bonuses is a
     section we should harvest. Allows arbitrary prefix words ("Real
     Features", "Custom Mechanics", "All Bonuses") while still gating
     out unrelated headings ("Free Spins" / "Wild" — those are picked
     up by extractFeatures patterns above, not the discovery pass). */
  const sectionHeadingRe = /^#{1,4}\s+(?:\d+\.\s*)?[\w\s-]*\b(?:features?|mechanics?|bonuses?)\b/i;
  const anyHeadingRe = /^#{1,4}\s+/;
  const bulletRe = /^\s*[-*•]\s+([^\n:]{3,60})/;
  let inSection = false;
  for (const line of text.split('\n')) {
    if (found.size >= _GENERIC_MAX) break;
    if (anyHeadingRe.test(line)) {
      inSection = sectionHeadingRe.test(line);
      continue;
    }
    if (!inSection) continue;
    const bm = line.match(bulletRe);
    if (bm) tryAdd(bm[1]);
  }

  /* Return in insertion order for deterministic test fixtures. */
  return Array.from(found.values()).map((label) => ({
    kind: 'feature_generic',
    label,
    _discovered: true,
  }));
}

function appendGenericFeatures(text, existing, knownKindSet) {
  const knownLabels = new Set(existing.map((f) => f.label));
  const generics = extractGenericFeatures(text, knownLabels);
  return generics.length === 0 ? existing : existing.concat(generics);
}

// extractMathSignals removed — math is out of scope this phase.

/* ─── Wave P7 — GDD round-trip stabilnost ──────────────────────
 *
 * Regulator submission preduslov: parsiranjem GDD-a + ponovnom
 * normalizacijom modela kao JSON mora se dobiti **identičan
 * fingerprint**. Bez ovoga, dva uzastopna build-a istog GDD-a
 * mogu da emit-uju različite renderable modele — što je tihi
 * regression detector.
 *
 * Funkcije:
 *
 *   serializeToCanonicalJSON(model) → object
 *     Drops volatile metadata (confidence._failures, _derivedBy)
 *     i sortira nizove deterministički. Direktno feed-uje
 *     normalizeFromJSON.
 *
 *   stableFingerprint(model) → object
 *     Minimum-stable subset modela koji round-trip mora očuvati.
 *     Strožiji od full canonical (uključuje samo render-affecting
 *     polja), korišćen u testu da assert ne pukne na pomeranju
 *     debug metadata.
 *
 *   roundTrip(text) → { initial, restored, fingerprintMatch }
 *     End-to-end helper za testove + dev tooling: parse(text) →
 *     serialize → normalizeFromJSON → fingerprint compare.
 *
 * Acceptance (sve mora da prođe):
 *   - fingerprint(parse(text)) === fingerprint(roundTrip(text).restored)
 *   - 4× sample GDD prolazi (WRATH_OF_OLYMPUS / CRYSTAL_FORGE /
 *     GATES / MIDNIGHT_FANGS)
 *   - Idempotency: roundTrip(roundTrip(text).restored serialized) ===
 *     roundTrip(text).restored
 *   - Bulletproof: parser.mjs P1 harness already guards malformed input;
 *     round-trip nikad ne baca, čak i na null/empty.
 */

const _VOLATILE_KEYS = new Set([
  '_failures', '_derivedBy', '_discovered',
]);

function _sortFeaturesDeterministic(features) {
  if (!Array.isArray(features)) return [];
  /* Sort by kind, then by label. Stable + deterministic across runs.
     Doesn't lose data — only re-orders. */
  return features
    .filter((f) => f && typeof f === 'object')
    .slice()
    .sort((a, b) => {
      const ak = String(a.kind || '');
      const bk = String(b.kind || '');
      if (ak !== bk) return ak < bk ? -1 : 1;
      const al = String(a.label || '');
      const bl = String(b.label || '');
      return al < bl ? -1 : al > bl ? 1 : 0;
    });
}

function _stripVolatile(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(_stripVolatile);
  const out = {};
  for (const k of Object.keys(obj).sort()) {
    if (_VOLATILE_KEYS.has(k)) continue;
    out[k] = _stripVolatile(obj[k]);
  }
  return out;
}

export function serializeToCanonicalJSON(model) {
  if (!model || typeof model !== 'object') return {};
  const cloned = {
    name: model.name || '',
    theme: model.theme || {},
    topology: model.topology || {},
    symbols: model.symbols || { high: [], mid: [], low: [], specials: [] },
    features: _sortFeaturesDeterministic(model.features),
    freeSpins: model.freeSpins || { enabled: false },
  };
  return _stripVolatile(cloned);
}

export function stableFingerprint(model) {
  if (!model || typeof model !== 'object') return null;
  return {
    name: String(model.name || ''),
    topology: {
      kind: String((model.topology || {}).kind || ''),
      reels: Number((model.topology || {}).reels || 0),
      rows: Number((model.topology || {}).rows || 0),
      paylines: Number((model.topology || {}).paylines || 0),
      shape: String((model.topology || {}).shape || ''),
      evaluation: (model.topology || {}).evaluation || null,
    },
    /* Feature kinds only (labels can wobble per palette/locale; kinds
       are the contract). Sort + dedupe so order doesn't matter. */
    featureKinds: Array.from(
      new Set(
        (model.features || [])
          .filter((f) => f && f.kind)
          .map((f) => String(f.kind))
      )
    ).sort(),
    /* Theme palette family (computed by P4 / smartDefaults), not the
       raw hex colours — hexes can shift if the palette source updates,
       but the family token stays. */
    themeTagsCount: Array.isArray((model.theme || {}).tags)
      ? model.theme.tags.length
      : 0,
    paletteSize: Array.isArray((model.theme || {}).palette)
      ? model.theme.palette.length
      : 0,
    /* Free-spins on/off is the gate-level contract. Detailed config
       (multiplier ladder, retrigger) intentionally not included —
       wave-by-wave parser refinement re-derives those. */
    freeSpinsEnabled: !!((model.freeSpins || {}).enabled),
    /* Symbol tier counts — exact tier *contents* may re-classify (P3
       smartDefaults), but the *count per tier* is the stable contract. */
    symbolTierCounts: {
      high: Array.isArray((model.symbols || {}).high) ? model.symbols.high.length : 0,
      mid: Array.isArray((model.symbols || {}).mid) ? model.symbols.mid.length : 0,
      low: Array.isArray((model.symbols || {}).low) ? model.symbols.low.length : 0,
      specials: Array.isArray((model.symbols || {}).specials) ? model.symbols.specials.length : 0,
    },
  };
}

export function roundTrip(text) {
  /* Soft-fail on any bad input — P1 outer guard semantic. */
  let initial = null;
  let restored = null;
  let fingerprintInitial = null;
  let fingerprintRestored = null;
  try {
    initial = parseGDD(text);
    const canonical = serializeToCanonicalJSON(initial);
    restored = normalizeFromJSON(canonical);
    fingerprintInitial = stableFingerprint(initial);
    fingerprintRestored = stableFingerprint(restored);
  } catch (err) {
    return {
      initial,
      restored,
      fingerprintMatch: false,
      error: err && err.message ? err.message : String(err),
    };
  }
  const aJson = JSON.stringify(fingerprintInitial);
  const bJson = JSON.stringify(fingerprintRestored);
  return {
    initial,
    restored,
    fingerprintInitial,
    fingerprintRestored,
    fingerprintMatch: aJson === bJson,
  };
}

/* ─── JSON GDD passthrough (IR shape) ──────────────────────── */
export function normalizeFromJSON(obj) {
  const model = freshModel();
  model.name = obj.name || obj.gameId || obj.title || 'Untitled (JSON)';
  model.theme = obj.theme || model.theme;
  model.topology = obj.topology || obj.layout || model.topology;
  model.symbols = obj.symbols || model.symbols;
  model.features = (obj.features || []).map(f => ({
    kind: f.kind || f.type || 'unknown',
    label: f.label || f.name || f.kind || 'Feature',
  }));
  /* FS config — JSON IR may carry an explicit { freeSpins: {...} } block; if
     not, fall back to industry defaults whenever a `free_spins` feature is
     declared. Mirrors the markdown-path behaviour. */
  if (obj.freeSpins && typeof obj.freeSpins === 'object') {
    model.freeSpins = { enabled: true, ...obj.freeSpins };
  } else if (model.features.some(f => f.kind === 'free_spins')) {
    model.freeSpins = extractFreeSpinsConfig('free spins', model);
  } else {
    model.freeSpins = { enabled: false };
  }
  model.confidence = { name: 1, topology: 1, symbols: 1, features: 1, _failures: [], _derivedBy: {} };
  /* Wave P2 — JSON path also routes through smart defaults so that
     pitch-deck JSON with only `name` + `theme.tags` produces a fully
     renderable model identical to the markdown happy path. */
  applySmartDefaults(model);
  return model;
}

/* ─── factory ──────────────────────────────────────────────── */
function freshModel() {
  return {
    name: 'Untitled Slot',
    theme: {
      tags: [],
      palette: [],
      mood: '',
      setting: '',
      typography: '',
      vibe_refs: '',
      genre: '',
      target_market: '',
    },
    topology: {
      /* canonical kind — one of 18 classes; set by canonicalKind() after extraction */
      kind: 'rectangular',
      /* sizing */
      reels: 5,
      rows: 3,
      paylines: 10,
      /* shape — rectangular default; can be hexagonal/pyramid/diamond/cross/l_shape/radial */
      shape: 'rectangular',
      /* evaluation — lines / ways / cluster / pay_anywhere / hexagonal / infinity / crash / slingo / plinko / wheel */
      evaluation: null,
      /* direction — ltr (default) / rtl / both */
      direction: 'ltr',
      /* explicit ways count if known (243/1024/4096/7776/46656/117649/etc) */
      ways_count: null,
      /* WAVE X3 — ways_cap = upper limit when all reels at max rows */
      ways_cap: null,
      /* variable rows-per-reel (high-volume ways family, e.g. 2-7 per reel) */
      rows_per_reel: null,
      /* explicit per-reel rows array (diamond/pyramid: [3,4,5,4,3]) */
      rows_per_reel_array: null,
      /* WAVE X4 — cluster adjacency: 'orthogonal' | 'diagonal' | 'hex' | null */
      cluster_adjacency: null,
      /* WAVE X4 — minimum cluster size to pay (typically 5..8) */
      cluster_min_size: null,
      /* cascade/tumble/avalanche */
      cascade: { enabled: false },
      /* growable (Infinity Reels) */
      growable: false,
      /* tiered/expanding grid (rows or reels grow on trigger) */
      tiered_rows: null,
      /* lock-and-respin grid (Hold & Spin / lock-collect respin shape) */
      lock_respin: false,
      /* twin / mirrored reels */
      twin_reels: false,
      mirrored_reels: false,
      /* multi-grid (dual/quad simultaneous grids) */
      grid_count: 1,
      /* split-cluster (quarter-split cluster variant) */
      is_megaclusters: false,
      /* slingo (5×5 + 1×5 hybrid) */
      is_slingo: false,
      /* plinko (peg matrix) */
      is_plinko: false,
      /* plinko peg rows (default 16) */
      plinko_rows: null,
      /* wheel segment count (24/36/48 typical) */
      wheel_segments: null,
      /* hexagonal ring radius */
      hex_ring: null,
    },
    symbols: { high: [], mid: [], low: [], specials: [] },
    features: [],
    /* Structured Free-Spins config — populated by extractFreeSpinsConfig().
       Always emitted (even when FS is not in the GDD) so downstream code can
       branch on `freeSpins.enabled` instead of probing undefined. */
    freeSpins: { enabled: false },
    /* Win-presentation block config — consumed by src/blocks/winPresentation.mjs.
       Always emitted with `undefined` slots so the block's resolveConfig()
       falls through to safe defaults. Populated by extractWinPresentation()
       when the GDD declares overrides. */
    winPresentation: {
      /* 'per-line' | 'cluster' | 'all-at-once' — undefined → block default */
      mode: undefined,
      /* number ms | 'auto' — undefined → block default ('auto') */
      perEventMs: undefined,
      /* cap on visible events per spin */
      maxEvents: undefined,
      /* explicit payline definitions (overrides industry-standard pool) */
      paylines: undefined,
      /* boolean — false hard-disables the cycle */
      winCycle: undefined,
      /* number in [0,1] — forced "no win" chance for visual variance */
      noWinChance: undefined,
    },
    /* Stage-badge block config — consumed by src/blocks/stageBadge.mjs. */
    stageBadge: {
      enabled: undefined,
      baseLabel: undefined,
      fsLabel: undefined,
      gold: undefined,
      pulseMs: undefined,
      mobileBreakpoint: undefined,
    },
    /* Anticipation block config — consumed by src/blocks/anticipation.mjs. */
    anticipation: {
      enabled: undefined,
      holdMs: undefined,
      pulseMs: undefined,
      gold: undefined,
      skipDuringFs: undefined,
    },
    /* Reel-engine CSS knobs — consumed by src/blocks/reelEngineCSS.mjs. */
    reelEngine: {
      blurPx: undefined,
      blurDim: undefined,
      blurFadeMs: undefined,
    },
    /* Trigger-counting config — consumed by src/blocks/triggerCounting.mjs. */
    triggerCounting: {
      defaultThreshold: undefined,
    },
    /* Reel-engine hot-path knobs — consumed by src/blocks/reelEngine.mjs. */
    reelEngineHot: {
      minRotations: undefined,
      settleBreathMs: undefined,
      stripBufferCells: undefined,
      staticPreRollMs: undefined,
      staticBlurSwapMs: undefined,
      staticStaggerMs: undefined,
      staticHoldMs: undefined,
      staticSettleMs: undefined,
      staticFallbackMs: undefined,
      snapThreshold: undefined,
      minStepPx: undefined,
      accelMinFactor: undefined,
    },
    /* Post-spin orchestration knobs — consumed by src/blocks/postSpin.mjs. */
    postSpin: {
      settlePauseMs: undefined,
      forcedSettlePauseMs: undefined,
      retriggerCap: undefined,
      fsSpinBreathMs: undefined,
      fakeWinChance: undefined,
      fakeWinMaxX: undefined,
    },
    /* Free-spins-presentation block config — consumed by
       src/blocks/freeSpins.mjs. Separate from the structural FS config
       (freeSpins) which is math/feature; this is purely the visual layer. */
    freeSpinsPresentation: {
      enabled: undefined,
      introLabel: undefined,
      outroLabel: undefined,
      totalWinLabel: undefined,
      introCta: undefined,
      outroCta: undefined,
      introSub: undefined,
      fadeMs: undefined,
      enterActiveDelayMs: undefined,
      spinBreathMs: undefined,
      toastMs: undefined,
      retriggerToastMs: undefined,
    },
    /* Spin-tempo block config — consumed by src/blocks/spinTempo.mjs.
       preset is a string ("s-avp" | "fast" | "slow") that sets the base
       cadence; per-key overrides follow. */
    spinTempo: {
      preset: undefined,
      windupMs: undefined,
      windupFrames: undefined,
      windupPx: undefined,
      accelMs: undefined,
      steadyMs: undefined,
      decelMs: undefined,
      staggerMs: undefined,
      bouncePx: undefined,
      bounceDecay: undefined,
      bounceCount: undefined,
      bounceElasticity: undefined,
      decelEasingSpeed: undefined,
    },
    /* Scatter-celebration block config — consumed by
       src/blocks/scatterCelebration.mjs. Always emitted with `undefined`
       slots so the block's resolveConfig() falls through to safe defaults.
       Populated by extractScatterCelebration() when the GDD declares
       overrides. */
    scatterCelebration: {
      /* boolean — false hard-disables the celebration */
      enabled: undefined,
      /* number ms — total celebration duration */
      durationMs: undefined,
      /* number — how many brightness cycles play */
      pulseCycles: undefined,
      /* number ms — duration of ONE cycle */
      pulseCycleMs: undefined,
      /* number in [0,1] — non-scatter cells dim level */
      dimOpacity: undefined,
      /* "r,g,b" string — gold drop-shadow halo color */
      glowColor: undefined,
      /* number — brightness peak inside a cycle */
      glowPeak: undefined,
    },
    /* Wave K — Pay Anywhere suite (scatter-pays / tumble-cascade style).
       Each sub-block has `undefined` slots so its resolveConfig() falls
       through to safe defaults. Populated by Wave K extract functions. */
    payAnywhereEval: {
      enabled: undefined,
      minWin: undefined,
      bucketEdges: undefined,
      paytable: undefined,
      maxEvents: undefined,
    },
    tumble: {
      enabled: undefined,
      removeMs: undefined,
      gravityMs: undefined,
      refillMs: undefined,
      chainPauseMs: undefined,
      maxChain: undefined,
      preserveOrbs: undefined,
    },
    multiplierOrb: {
      enabled: undefined,
      symbolId: undefined,
      distribution: undefined,
      bonusAccumulate: undefined,
      chipColor: undefined,
      pulseMs: undefined,
    },
    bonusBuy: {
      enabled: undefined,
      costX: undefined,
      label: undefined,
      forceScatters: undefined,
      color: undefined,
      confirmMessage: undefined,
    },
    anteBet: {
      enabled: undefined,
      costMultiplier: undefined,
      triggerMultiplier: undefined,
      label: undefined,
      color: undefined,
    },
    /* Wave L–P — 16 detected-but-unused feature kinds, now wired.
       Each block's resolveConfig() falls through to safe defaults. */
    stickyWild: {
      enabled: undefined, mode: undefined, durationSpins: undefined,
      wildSymbolId: undefined, haloColor: undefined, pulseMs: undefined,
    },
    expandingWild: {
      enabled: undefined, mode: undefined, wildSymbolId: undefined,
      expandDurationMs: undefined, haloColor: undefined,
    },
    walkingWild: {
      enabled: undefined, mode: undefined, wildSymbolId: undefined,
      direction: undefined, triggerRespin: undefined, haloColor: undefined,
    },
    wildReel: {
      enabled: undefined, mode: undefined, wildSymbolId: undefined,
      chancePerSpin: undefined, maxReelsPerSpin: undefined, haloColor: undefined,
    },
    mysterySymbol: {
      enabled: undefined, mode: undefined, mysterySymbolId: undefined,
      revealDelayMs: undefined, revealDurationMs: undefined,
      includeWild: undefined, includeScatter: undefined, haloColor: undefined,
    },
    clusterPaysEval: {
      enabled: undefined, minCluster: undefined, bucketEdges: undefined,
      paytable: undefined, maxEvents: undefined, diagonal: undefined,
    },
    waysEval: {
      enabled: undefined, waysCount: undefined, minRun: undefined,
      direction: undefined, maxEvents: undefined,
    },
    persistentMultiplier: {
      enabled: undefined, mode: undefined, startMult: undefined,
      growPerWin: undefined, growPerCascade: undefined, maxMult: undefined,
      resetOnRoundEnd: undefined, chipColor: undefined,
    },
    /* Wave U1 — Progressive FS multiplier escalator (every spin). */
    progressiveFreeSpins: {
      enabled: undefined, strategy: undefined, startMult: undefined,
      step: undefined, ladderValues: undefined, maxMult: undefined,
      resetOnRoundEnd: undefined, chipColor: undefined, chipLabel: undefined,
    },
    /* Wave U2 — Audio scaffolding (15 lifecycle categories + mute/volume). */
    audio: {
      enabled: undefined, masterVolume: undefined, muted: undefined,
      urls: undefined, volumes: undefined,
      showToggle: undefined, toggleColor: undefined,
      bigWinThresholdX: undefined, megaWinThresholdX: undefined, epicWinThresholdX: undefined,
    },
    /* Wave U3 — Unified UI toast (BIG / MEGA / EPIC + feature). */
    uiToast: {
      enabled: undefined,
      bigWinThresholdX: undefined, megaWinThresholdX: undefined, epicWinThresholdX: undefined,
      bigDurationMs: undefined, megaDurationMs: undefined, epicDurationMs: undefined,
      featureDurationMs: undefined,
      queueOnFsEnd: undefined, fsTriggerLabel: undefined,
      colors: undefined, maxQueue: undefined,
    },
    /* Wave V1 — Slam-stop button (industry-reference SlamStopCommand). */
    slamStop: {
      enabled: undefined,
      chipLabel: undefined, chipColor: undefined, chipTextColor: undefined,
      requireMinSpinMs: undefined,
      hideOnTurbo: undefined, hideOnAutoSpin: undefined,
      reelsClickAreaEnabled: undefined,
      ariaLabel: undefined, pulseAnimation: undefined,
    },
    /* Wave V2 — Force-skip button (industry-reference ForceSkipCommand). */
    forceSkip: {
      enabled: undefined,
      chipLabel: undefined, chipColor: undefined, chipTextColor: undefined,
      disabledPressed: undefined, hidePressed: undefined,
      showDuringRollup: undefined, showDuringFsIntro: undefined,
      showDuringFsOutro: undefined, showDuringCelebration: undefined,
      minRollupMsForShow: undefined, ariaLabel: undefined,
    },
    /* Wave U4 — Autoplay (industry-reference AutoSpinSettingsPanel). */
    autoplay: {
      enabled: undefined,
      stepValues: undefined, defaultStep: undefined,
      betUnitFallback: undefined,
      stopOnAnyFeatureTrigger: undefined,
      stopOnSingleWinX: undefined, stopOnBalanceBelow: undefined,
      stopOnLossAbove: undefined, stopOnWinAbove: undefined,
      interSpinDelayMs: undefined, showCounter: undefined,
      chipColor: undefined, chipTextColor: undefined, ariaLabel: undefined,
    },
    /* Wave U5 — Bet Selector (coin × multiplier model). */
    betSelector: {
      enabled: undefined,
      coinValues: undefined, multipliers: undefined,
      defaultCoin: undefined, defaultMultiplier: undefined,
      currency: undefined, currencyPosition: undefined,
      showCoinPicker: undefined, showMultiplierPicker: undefined,
      showStepButtons: undefined, maxBetButton: undefined,
      panelOnDemand: undefined,
      chipColor: undefined, chipTextColor: undefined, ariaLabel: undefined,
    },
    /* Wave U6 — Secondary Gamble (Card + Ladder branches). */
    gambleSecondary: {
      enabled: undefined,
      modes: undefined,
      cardMode: undefined, cardMultiplier: undefined, cardMaxRounds: undefined,
      ladderRungs: undefined, ladderRungMultiplier: undefined, ladderMaxRounds: undefined,
      minWinForPromptX: undefined, maxBankX: undefined, promptTimeoutMs: undefined,
      showInFs: undefined, showInAutoplay: undefined,
      currency: undefined, chipColor: undefined, chipTextColor: undefined,
    },
    /* Wave U13 — Settings panel (industry-standard preferences modal). */
    settingsPanel: {
      enabled: undefined,
      chipLabel: undefined, chipColor: undefined, chipTextColor: undefined,
      modalBgColor: undefined, modalAccentColor: undefined,
      showTurboToggle: undefined, showSoundToggle: undefined,
      showReducedMotionToggle: undefined, showQuickSpinToggle: undefined,
      showAutoHideWinToggle: undefined, showLanguageSelector: undefined,
      availableLocales: undefined,
      persistInLocalStorage: undefined,
      closeOnBackdrop: undefined, closeOnEscape: undefined, autoHideOnSpin: undefined,
      ariaLabel: undefined,
    },
    /* Wave U11 — Turbo mode toggle (industry-standard cadence override). */
    turboMode: {
      enabled: undefined,
      initialActive: undefined, persistInLocalStorage: undefined,
      turboSpeedMult: undefined,
      chipLabel: undefined, chipColor: undefined, chipTextColor: undefined,
      position: undefined, ariaLabel: undefined,
    },
    /* Wave U9 — Session history log (regulator-mandated audit). */
    historyLog: {
      enabled: undefined,
      capacity: undefined, allowCsvExport: undefined,
      showTime: undefined, timeFormat: undefined,
      chipLabel: undefined, chipColor: undefined, chipTextColor: undefined,
      panelBgColor: undefined, panelAccentColor: undefined,
      closeOnBackdrop: undefined, closeOnEscape: undefined, autoHideOnSpin: undefined,
      ariaLabel: undefined,
    },
    /* Wave U8 — Balance HUD (industry-standard regulator-mandated). */
    balanceHud: {
      enabled: undefined,
      startingBalance: undefined, fallbackBet: undefined,
      currency: undefined, currencyPosition: undefined,
      showWinColumn: undefined, showTotalWinDuringFs: undefined,
      pulseOnChange: undefined,
      accentColor: undefined, debitColor: undefined, creditColor: undefined,
      ariaLabel: undefined,
    },
    /* Wave U10 — Paytable modal (industry-standard regulator-mandated UI). */
    paytable: {
      enabled: undefined,
      chipLabel: undefined, chipColor: undefined, chipTextColor: undefined,
      modalBgColor: undefined, modalAccentColor: undefined,
      showFeaturesList: undefined, showWildRules: undefined, showLineMap: undefined,
      closeOnBackdrop: undefined, closeOnEscape: undefined, autoHideOnSpin: undefined,
      ariaLabel: undefined,
      /* `symbols` slot reserved for explicit per-symbol payout overrides
       * provided by the GDD (e.g. `paytable.symbols.H1 = { 3:10, 4:50, 5:200 }`).
       * Math is OUT OF SCOPE here — paytable.mjs only DISPLAYS what's set;
       * the math layer (Phase 2) will populate this from real PAR sheets. */
      symbols: undefined,
    },
    holdAndWin: {
      enabled: undefined, triggerCount: undefined, bonusSymbolId: undefined,
      respinsAwarded: undefined, resetOnNewBonus: undefined,
      haloColor: undefined, jackpotLabels: undefined,
    },
    respin: {
      enabled: undefined, mode: undefined, triggerChance: undefined,
      costX: undefined, holdRule: undefined, respinsPerTrigger: undefined,
      haloColor: undefined,
    },
    winCap: {
      enabled: undefined, maxWinX: undefined, mode: undefined,
      overlayLabel: undefined, overlayMs: undefined, color: undefined,
      forceRoundEnd: undefined,
    },
    bonusPick: {
      enabled: undefined, mode: undefined, tileCount: undefined,
      maxPicks: undefined, prizePool: undefined, endTokens: undefined,
      title: undefined, haloColor: undefined,
    },
    wheelBonus: {
      enabled: undefined, segments: undefined, spinDurationMs: undefined,
      haloColor: undefined, autoSpin: undefined, title: undefined,
    },
    lightning: {
      enabled: undefined, mode: undefined, triggerChance: undefined,
      minStrikes: undefined, maxStrikes: undefined, multipliers: undefined,
      haloColor: undefined, strikeDurationMs: undefined,
    },
    gamble: {
      enabled: undefined, mode: undefined, maxRounds: undefined,
      multiplier: undefined, collectThresholdX: undefined, haloColor: undefined,
    },
    superSymbol: {
      enabled: undefined, mode: undefined, blockSize: undefined,
      triggerChance: undefined, symbolPool: undefined, haloColor: undefined,
    },
    confidence: {
      name: 0,
      topology: 0,
      symbols: 0,
      features: 0,
      /* Wave P1 — Malformed GDD recovery. Every extractor runs through
         `_safeExtract()`; throw → label appended here, parsing continues.
         Empty array == zero structural failures. Downstream UI / probes can
         surface a "partial parse" badge by checking `confidence._failures.length`. */
      _failures: [],
    },
  };
}

/* ── extractWinPresentation — GDD-driven win cycle config ──────────────────
   Reads optional knobs from a "## Win Presentation" / "## Win Cycle" /
   "## Win Animations" section in the GDD:

     ```
     ## Win Presentation
     - mode: per-line
     - per-event-ms: 350
     - max-events: 12
     - no-win-chance: 0.20
     - win-cycle: true
     ```

   All keys optional. Unknown keys ignored. Block's resolveConfig() does
   the actual validation — parser only forwards what it sees. */
export function extractWinPresentation(text, model) {
  if (!text || !model) return;
  /* Look for any heading that matches "win presentation" / "win cycle" /
     "win animations" / "win highlight" — case-insensitive. The H2 block
     extends to the next H1/H2 or end-of-document. */
  const headingRx = /^##\s*(?:win\s*presentation|win\s*cycle|win\s*animations?|win\s*highlight)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const wp = model.winPresentation;
  /* mode — F6 fix (Boki audit): add 'per-symbol' alias for scatter-pays
     games (Gates of Olympus GDD uses this literal). Maps to 'all-at-once'
     semantically since scatter-pays highlights all winning symbols at once. */
  const m = section.match(/\b(?:mode|presentation)\s*[:=]\s*['"]?(per-?line|per-?symbol|cluster|all-?at-?once|ways|ways-?aware)['"]?/i);
  if (m) {
    const v = m[1].toLowerCase().replace(/\s+/g, '-');
    if (v === 'perline') wp.mode = 'per-line';
    else if (v === 'persymbol' || v === 'per-symbol') wp.mode = 'all-at-once';
    else if (v === 'allatonce' || v === 'all-at-once') wp.mode = 'all-at-once';
    else if (v === 'ways' || v === 'ways-aware' || v === 'waysaware') wp.mode = 'all-at-once';
    else wp.mode = v;
  }
  /* per-event-ms */
  const pe = section.match(/\bper[- ]?event[- ]?ms\s*[:=]\s*(\d+|auto)/i);
  if (pe) wp.perEventMs = pe[1].toLowerCase() === 'auto' ? 'auto' : parseInt(pe[1], 10);
  /* max-events */
  const me = section.match(/\bmax[- ]?events?\s*[:=]\s*(\d+)/i);
  if (me) wp.maxEvents = parseInt(me[1], 10);
  /* no-win-chance */
  const nw = section.match(/\bno[- ]?win[- ]?chance\s*[:=]\s*(0?\.\d+|0|1)/i);
  if (nw) wp.noWinChance = parseFloat(nw[1]);
  /* win-cycle on/off */
  const wc = section.match(/\bwin[- ]?cycle\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (wc) {
    const v = wc[1].toLowerCase();
    wp.winCycle = (v === 'true' || v === 'on' || v === 'yes');
  }
}

/* ── extractScatterCelebration — GDD-driven trigger animation config ──────
   Reads optional knobs from a "## Scatter Celebration" / "## Trigger
   Celebration" / "## Scatter Animation" / "## Trigger Animation" section
   in the GDD:

     ```
     ## Scatter Celebration
     - enabled: true
     - duration-ms: 1800
     - pulse-cycles: 4
     - pulse-cycle-ms: 450
     - dim-opacity: 0.20
     - glow-color: 255,214,110
     - glow-peak: 1.6
     ```

   All keys optional. Unknown keys ignored. Block's resolveConfig() does the
   actual validation — parser only forwards what it sees. */
export function extractScatterCelebration(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:scatter\s*celebration|trigger\s*celebration|scatter\s*animation|trigger\s*animation)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const sc = model.scatterCelebration;
  /* enabled on/off */
  const en = section.match(/\benabled\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (en) {
    const v = en[1].toLowerCase();
    sc.enabled = (v === 'true' || v === 'on' || v === 'yes');
  }
  /* duration-ms */
  const du = section.match(/\bduration[- ]?ms\s*[:=]\s*(\d+)/i);
  if (du) sc.durationMs = parseInt(du[1], 10);
  /* pulse-cycles */
  const pc = section.match(/\bpulse[- ]?cycles?\s*[:=]\s*(\d+)/i);
  if (pc) sc.pulseCycles = parseInt(pc[1], 10);
  /* pulse-cycle-ms */
  const pcm = section.match(/\bpulse[- ]?cycle[- ]?ms\s*[:=]\s*(\d+)/i);
  if (pcm) sc.pulseCycleMs = parseInt(pcm[1], 10);
  /* dim-opacity */
  const dm = section.match(/\bdim[- ]?opacity\s*[:=]\s*(0?\.\d+|0|1)/i);
  if (dm) sc.dimOpacity = parseFloat(dm[1]);
  /* glow-color "r,g,b" */
  const gc = section.match(/\bglow[- ]?color\s*[:=]\s*(\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})/i);
  if (gc) sc.glowColor = gc[1].replace(/\s+/g, '');
  /* glow-peak */
  const gp = section.match(/\bglow[- ]?peak\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (gp) sc.glowPeak = parseFloat(gp[1]);
}

/* ── extractStageBadge — GDD-driven stage badge config ───────────────────
   Reads optional knobs from a "## Stage Badge" / "## Phase Badge" /
   "## Live Indicator" section in the GDD. All keys optional. */
export function extractStageBadge(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:stage\s*badge|phase\s*badge|live\s*indicator)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const sb = model.stageBadge;
  const en = section.match(/\benabled\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (en) {
    const v = en[1].toLowerCase();
    sb.enabled = (v === 'true' || v === 'on' || v === 'yes');
  }
  const bl = section.match(/\bbase[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im);
  if (bl) sb.baseLabel = bl[1].trim();
  const fl = section.match(/\bfs[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im);
  if (fl) sb.fsLabel = fl[1].trim();
  const gd = section.match(/\bgold\s*[:=]\s*(\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})/i);
  if (gd) sb.gold = gd[1].replace(/\s+/g, '');
  const ms = section.match(/\bpulse[- ]?ms\s*[:=]\s*(\d+)/i);
  if (ms) sb.pulseMs = parseInt(ms[1], 10);
  const mb = section.match(/\bmobile[- ]?breakpoint\s*[:=]\s*(\d+)/i);
  if (mb) sb.mobileBreakpoint = parseInt(mb[1], 10);
}

/* ── extractAnticipation — GDD-driven anticipation glow config ───────────
   Reads optional knobs from a "## Anticipation" / "## Reel Anticipation"
   section. All keys optional. */
export function extractAnticipation(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:anticipation|reel\s*anticipation)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const a = model.anticipation;
  const en = section.match(/\benabled\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (en) {
    const v = en[1].toLowerCase();
    a.enabled = (v === 'true' || v === 'on' || v === 'yes');
  }
  const hm = section.match(/\bhold[- ]?ms\s*[:=]\s*(\d+)/i);
  if (hm) a.holdMs = parseInt(hm[1], 10);
  const pm = section.match(/\bpulse[- ]?ms\s*[:=]\s*(\d+)/i);
  if (pm) a.pulseMs = parseInt(pm[1], 10);
  const gd = section.match(/\bgold\s*[:=]\s*(\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3})/i);
  if (gd) a.gold = gd[1].replace(/\s+/g, '');
  const sd = section.match(/\bskip[- ]?during[- ]?fs\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (sd) {
    const v = sd[1].toLowerCase();
    a.skipDuringFs = (v === 'true' || v === 'on' || v === 'yes');
  }
}

/* ── extractSpinTempo — GDD-driven reel spin cadence config ──────────────
   Reads optional knobs from a "## Spin Tempo" / "## Reel Tempo" /
   "## Spin Cadence" section. Supports presets + per-key overrides. */
export function extractSpinTempo(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:spin\s*tempo|reel\s*tempo|spin\s*cadence|spin\s*timing)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const st = model.spinTempo;
  const pr = section.match(/\bpreset\s*[:=]\s*['"]?(s[- ]?avp|fast|slow)['"]?/i);
  if (pr) st.preset = pr[1].toLowerCase().replace(/\s+/g, '-');

  const intMap = [
    ['windupMs',     /\bwindup[- ]?ms\s*[:=]\s*(\d+)/i],
    ['windupFrames', /\bwindup[- ]?frames\s*[:=]\s*(\d+)/i],
    ['windupPx',     /\bwindup[- ]?px\s*[:=]\s*(\d+)/i],
    ['accelMs',      /\baccel[- ]?ms\s*[:=]\s*(\d+)/i],
    ['steadyMs',     /\bsteady[- ]?ms\s*[:=]\s*(\d+)/i],
    ['decelMs',      /\bdecel[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staggerMs',    /\bstagger[- ]?ms\s*[:=]\s*(\d+)/i],
    ['bouncePx',     /\bbounce[- ]?px\s*[:=]\s*(\d+)/i],
    ['bounceCount',  /\bbounce[- ]?count\s*[:=]\s*(\d+)/i],
  ];
  for (const [key, rx] of intMap) {
    const m = section.match(rx);
    if (m) st[key] = parseInt(m[1], 10);
  }

  const floatMap = [
    ['bounceDecay',      /\bbounce[- ]?decay\s*[:=]\s*(\d+(?:\.\d+)?)/i],
    ['bounceElasticity', /\bbounce[- ]?elasticity\s*[:=]\s*(\d+(?:\.\d+)?)/i],
    ['decelEasingSpeed', /\bdecel[- ]?easing[- ]?speed\s*[:=]\s*(\d+(?:\.\d+)?)/i],
  ];
  for (const [key, rx] of floatMap) {
    const m = section.match(rx);
    if (m) st[key] = parseFloat(m[1]);
  }
}

/* ── extractFreeSpinsPresentation — GDD-driven placard / HUD / toast config
   Reads optional knobs from a "## Free Spins Presentation" /
   "## FS Presentation" / "## Free Spins Placard" / "## Bonus Presentation"
   section. All keys optional. */
export function extractFreeSpinsPresentation(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:free\s*spins\s*presentation|fs\s*presentation|free\s*spins\s*placard|bonus\s*presentation|fs\s*placard)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;

  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const fp = model.freeSpinsPresentation;
  const en = section.match(/\benabled\s*[:=]\s*(true|false|on|off|yes|no)/i);
  if (en) {
    const v = en[1].toLowerCase();
    fp.enabled = (v === 'true' || v === 'on' || v === 'yes');
  }

  const labels = [
    ['introLabel',    /\bintro[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['outroLabel',    /\boutro[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['totalWinLabel', /\btotal[- ]?win[- ]?label\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['introCta',      /\bintro[- ]?cta\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['outroCta',      /\boutro[- ]?cta\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
    ['introSub',      /\bintro[- ]?sub\s*[:=]\s*['"]?([^'"\n]+?)['"]?\s*$/im],
  ];
  for (const [k, rx] of labels) {
    const m = section.match(rx);
    if (m) fp[k] = m[1].trim();
  }

  const ints = [
    ['fadeMs',             /\bfade[- ]?ms\s*[:=]\s*(\d+)/i],
    ['enterActiveDelayMs', /\benter[- ]?active[- ]?(?:delay[- ]?)?ms\s*[:=]\s*(\d+)/i],
    ['spinBreathMs',       /\bspin[- ]?breath[- ]?ms\s*[:=]\s*(\d+)/i],
    ['toastMs',            /\btoast[- ]?ms\s*[:=]\s*(\d+)/i],
    ['retriggerToastMs',   /\bretrigger[- ]?toast[- ]?ms\s*[:=]\s*(\d+)/i],
  ];
  for (const [k, rx] of ints) {
    const m = section.match(rx);
    if (m) fp[k] = parseInt(m[1], 10);
  }
}

/* ── extractReelEngine — GDD-driven reel engine CSS knobs ────────────────
   "## Reel Engine" / "## Spin Blur" section. All keys optional. */
export function extractReelEngine(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:reel\s*engine|spin\s*blur)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;
  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const re = model.reelEngine;
  const bp = section.match(/\bblur[- ]?px\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (bp) re.blurPx = parseFloat(bp[1]);
  const bd = section.match(/\bblur[- ]?dim\s*[:=]\s*(0?\.\d+|0|1)/i);
  if (bd) re.blurDim = parseFloat(bd[1]);
  const bf = section.match(/\bblur[- ]?fade[- ]?ms\s*[:=]\s*(\d+)/i);
  if (bf) re.blurFadeMs = parseInt(bf[1], 10);
}

/* ── extractTriggerCounting — GDD-driven trigger counting knobs ──────────
   "## Trigger Counting" / "## Scatter Counting" section. All keys optional. */
export function extractTriggerCounting(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:trigger\s*counting|scatter\s*counting)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;
  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const tc = model.triggerCounting;
  const dt = section.match(/\bdefault[- ]?threshold\s*[:=]\s*(\d+)/i);
  if (dt) tc.defaultThreshold = parseInt(dt[1], 10);
}

/* ── extractPostSpin — GDD-driven post-spin orchestration knobs ──────────
   "## Post Spin" / "## Post-Spin Orchestration" section. All keys optional. */
export function extractPostSpin(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:post[- ]?spin|post[- ]?spin\s*orchestration)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;
  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const ps = model.postSpin;
  const intMap = [
    ['settlePauseMs',       /\bsettle[- ]?pause[- ]?ms\s*[:=]\s*(\d+)/i],
    ['forcedSettlePauseMs', /\bforced[- ]?settle[- ]?pause[- ]?ms\s*[:=]\s*(\d+)/i],
    ['retriggerCap',        /\bretrigger[- ]?cap\s*[:=]\s*(\d+)/i],
    ['fsSpinBreathMs',      /\bfs[- ]?spin[- ]?breath[- ]?ms\s*[:=]\s*(\d+)/i],
    ['fakeWinMaxX',         /\bfake[- ]?win[- ]?max[- ]?x\s*[:=]\s*(\d+)/i],
  ];
  for (const [k, rx] of intMap) {
    const m = section.match(rx);
    if (m) ps[k] = parseInt(m[1], 10);
  }
  const fwc = section.match(/\bfake[- ]?win[- ]?chance\s*[:=]\s*(0?\.\d+|0|1)/i);
  if (fwc) ps.fakeWinChance = parseFloat(fwc[1]);
}

/* ── extractReelEngineHot — GDD-driven reel engine hot-path knobs ────────
   "## Reel Engine Hot" / "## Spin Physics" / "## Reel Hot-Path" section. */
export function extractReelEngineHot(text, model) {
  if (!text || !model) return;
  const headingRx = /^##\s*(?:reel\s*engine\s*hot|spin\s*physics|reel\s*hot[- ]?path)\s*$/im;
  const startMatch = text.match(headingRx);
  if (!startMatch) return;
  const start = startMatch.index + startMatch[0].length;
  const restRx = /^#{1,2}\s/m;
  const tail = text.slice(start);
  const nextH = tail.match(restRx);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const rh = model.reelEngineHot;
  const intMap = [
    ['minRotations',      /\bmin[- ]?rotations\s*[:=]\s*(\d+)/i],
    ['settleBreathMs',    /\bsettle[- ]?breath[- ]?ms\s*[:=]\s*(\d+)/i],
    ['stripBufferCells',  /\bstrip[- ]?buffer[- ]?cells\s*[:=]\s*(\d+)/i],
    ['staticPreRollMs',   /\bstatic[- ]?pre[- ]?roll[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticBlurSwapMs',  /\bstatic[- ]?blur[- ]?swap[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticStaggerMs',   /\bstatic[- ]?stagger[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticHoldMs',      /\bstatic[- ]?hold[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticSettleMs',    /\bstatic[- ]?settle[- ]?ms\s*[:=]\s*(\d+)/i],
    ['staticFallbackMs',  /\bstatic[- ]?fallback[- ]?ms\s*[:=]\s*(\d+)/i],
  ];
  for (const [k, rx] of intMap) {
    const m = section.match(rx);
    if (m) rh[k] = parseInt(m[1], 10);
  }
  const floatMap = [
    ['snapThreshold',  /\bsnap[- ]?threshold\s*[:=]\s*(\d+(?:\.\d+)?)/i],
    ['minStepPx',      /\bmin[- ]?step[- ]?px\s*[:=]\s*(\d+(?:\.\d+)?)/i],
    ['accelMinFactor', /\baccel[- ]?min[- ]?factor\s*[:=]\s*(\d+(?:\.\d+)?)/i],
  ];
  for (const [k, rx] of floatMap) {
    const m = section.match(rx);
    if (m) rh[k] = parseFloat(m[1]);
  }
}

/* ─── Wave K — extractors for Pay-Anywhere suite ──────────────────────────── */

/* ── extractPayAnywhereEval — bucket-paytable from emoji symbol tables ───
   Reads paytables under "### High-pay" / "### Mid-pay" / "### Low-pay"
   shaped like:

     | ID | Name | min8 | 8-9 | 10-11 | 12+ |
     |---|---|:-:|:-:|:-:|:-:|
     | `H` | High Symbol A | 8 | 10x | 25x | 50x |

   Buckets are inferred from header columns matching `\d+[-+]\d*`. Output:
     model.payAnywhereEval.paytable = { H: [10, 25, 50], M: [2.5, 10, 25] }
     model.payAnywhereEval.bucketEdges = [10, 12]
     model.payAnywhereEval.minWin = 8

   No-op when topology.evaluation !== 'pay_anywhere' (line-pays games
   keep their per-line paytables — bucket rule would corrupt them). */
export function extractPayAnywhereEval(text, model) {
  if (!text || !model) return;
  if (!model.topology || model.topology.evaluation !== 'pay_anywhere') return;
  const pae = model.payAnywhereEval;
  pae.enabled = true;

  // Section headers we should scan
  const headers = ['High[\\s-]?pay', 'Mid[\\s-]?pay', 'Low[\\s-]?pay'];
  const paytable = {};
  let bucketEdges = null;
  let minWin = null;

  for (const h of headers) {
    const headingRx = new RegExp(`###[^\\n]*\\b${h}\\b[^\\n]*\\n`, 'i');
    const hm = text.match(headingRx);
    if (!hm) continue;
    const start = hm.index + hm[0].length;
    const rest = text.slice(start, start + 4000);
    const end = rest.search(/\n##\s|\n###\s/);
    const chunk = end >= 0 ? rest.slice(0, end) : rest;

    // Parse header row (first | … | with bucket columns like "8-9", "10-11", "12+")
    const headerLineMatch = chunk.match(/^\s*\|([^\n]+)\|\s*$/m);
    if (!headerLineMatch) continue;
    const cols = headerLineMatch[1].split('|').map(s => s.trim());
    // Locate columns labeled like "8-9", "10-11", "12+" (bucket ranges)
    const bucketColIdx = [];
    const edges = [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const range = c.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      const open  = c.match(/^(\d+)\s*\+$/);
      if (range) { bucketColIdx.push(i); edges.push(parseInt(range[1], 10)); }
      else if (open) { bucketColIdx.push(i); edges.push(parseInt(open[1], 10)); }
    }
    if (bucketColIdx.length < 2) continue;

    // Use the first edge as minWin if not yet set
    if (minWin == null) minWin = edges[0];
    // bucketEdges = the SUBSEQUENT bucket start values (drop first)
    if (!bucketEdges) bucketEdges = edges.slice(1);

    // Parse data rows
    const dataRowRe = /^\s*\|([^\n]+)\|\s*$/gm;
    let m;
    while ((m = dataRowRe.exec(chunk)) !== null) {
      const rowCols = m[1].split('|').map(s => s.trim());
      // Skip the header itself and divider rows
      if (rowCols.every(c => /^[:-\s]+$/.test(c))) continue;
      const idCol = rowCols[0] ? rowCols[0].replace(/[`*]/g, '').trim() : '';
      if (!idCol || idCol.toLowerCase() === 'id') continue;
      const id = idCol.match(/^([A-Za-z0-9_]{1,4})$/);
      if (!id) continue;
      const symId = id[1].toUpperCase();
      const payouts = bucketColIdx.map(ci => {
        const v = rowCols[ci] || '';
        const num = v.match(/(\d+(?:\.\d+)?)\s*x?/i);
        return num ? parseFloat(num[1]) : 0;
      });
      if (payouts.some(p => p > 0)) paytable[symId] = payouts;
    }
  }

  if (Object.keys(paytable).length > 0) {
    pae.paytable = paytable;
    if (bucketEdges && bucketEdges.length > 0) pae.bucketEdges = bucketEdges;
    if (minWin != null) pae.minWin = minWin;
  }
}

/* ── extractMultiplierOrb — detect orb symbol + value distribution ──── */
export function extractMultiplierOrb(text, model) {
  if (!text || !model) return;
  const orb = model.multiplierOrb;

  // Look in Specials block for a row mentioning "Multiplier Orb" / "Orb".
  // CRITICAL: JS regex does NOT support `\Z` (Perl/Ruby anchor for end of
  // input). Using `\Z` made the engine treat it as a literal `Z` character,
  // truncating any Specials block where a row contained the letter "Z".
  // `$(?![\s\S])` is the portable "true end of input" pattern.
  const specialsBlock = text.match(/###[^\n]*\bSpecials?\b[^\n]*\n([\s\S]*?)(?=\n##\s|\n###\s|$(?![\s\S]))/i);
  if (specialsBlock) {
    const rows = specialsBlock[1].split(/\n/);
    for (const row of rows) {
      // Split on `|` and take all non-empty cells (handles 3/4/5/6-col tables uniformly)
      const cells = row.split('|').map(s => s.trim()).filter(s => s.length > 0);
      if (cells.length < 2) continue;
      const idRaw = cells[0].replace(/[`*]/g, '').trim();
      const name = cells[1] || '';
      // Concatenate all REMAINING cells as the "role/description" — that's
      // where the value range lives in multi-column variants.
      const role = cells.slice(2).join(' ');
      if (!/^[A-Za-z][A-Za-z0-9_]{0,3}$/.test(idRaw)) continue;
      const id = idRaw;
      if (/orb|multiplier/i.test(name) && id.length <= 4) {
        orb.enabled = true;
        orb.symbolId = id.toUpperCase();
        // Try to read range from role: "2x – 1000x"
        const range = role.match(/(\d+)\s*x?\s*[–\-]\s*(\d+)\s*x?/);
        if (range) {
          const lo = parseInt(range[1], 10);
          const hi = parseInt(range[2], 10);
          if (lo > 0 && hi > lo) {
            // Build a graduated distribution between lo and hi (log-decaying)
            const dist = [];
            const baseVals = [2,3,4,5,6,8,10,12,15,20,25,50,100,250,500,1000].filter(v => v >= lo && v <= hi);
            for (const v of baseVals) {
              // Weight: higher value = much lower weight (log decay)
              const w = Math.max(0.5, 500 / Math.pow(v, 1.3));
              dist.push({ value: v, weight: parseFloat(w.toFixed(2)) });
            }
            if (dist.length > 0) orb.distribution = dist;
          }
        }
        break;
      }
    }
  }

  // bonusAccumulate auto-enable when FS block mentions accumulating / progressive multiplier
  if (orb.enabled && /\b(akumulira|accumulat|progresiv|persistent|bonus[\s_]?multiplier|grows)\b/i.test(text)) {
    orb.bonusAccumulate = true;
  }
}

/* ── extractBonusBuy — detect cost + force-scatter count ─────────────── */
export function extractBonusBuy(text, model) {
  if (!text || !model) return;
  const has = /\bbonus[\s_-]?buy\b|\bbuy[\s_-]?(?:feature|bonus|fs)\b|\bfeature[\s_-]?buy\b/i.test(text);
  if (!has) return;
  const bb = model.bonusBuy;
  bb.enabled = true;

  // Section: "## Bonus Buy" or "## 07 · Bonus Buy" — read Cena (Cost) cell.
  // Allow numbered heading prefix (`07 · ` / `07. ` / `7) `) before the title.
  // `$(?![\s\S])` is the portable JS-safe "true end of input" (JS lacks `\Z`).
  const sec = text.match(/^##\s*(?:\d+[\s.·)\-]+)?Bonus\s*Buy[^\n]*\n([\s\S]*?)(?=\n##\s|$(?![\s\S]))/im);
  if (sec) {
    const body = sec[1];
    const cost = body.match(/\|\s*(?:Cena|Cost|Price)\s*\|\s*\*?\*?(\d+)\s*x?\s*\*?\*?/i);
    if (cost) bb.costX = parseInt(cost[1], 10);
    const guar = body.match(/\|\s*(?:Garantuje|Guarantee[s]?)\s*\|[^|\n]*?(\d+)\s*\+?\s*Scatter/i);
    if (guar) bb.forceScatters = parseInt(guar[1], 10);
  } else {
    // Fallback prose: "Bonus Buy: 100x", "Buy Feature 75x"
    const cost = text.match(/\bbonus[\s_-]?buy[^\n.]{0,40}?(\d+)\s*x\b|\bbuy[\s_-]?(?:feature|bonus)[^\n.]{0,40}?(\d+)\s*x\b/i);
    if (cost) bb.costX = parseInt(cost[1] || cost[2], 10);
  }
}

/* ── extractAnteBet — detect cost multiplier + trigger boost ─────────── */
export function extractAnteBet(text, model) {
  if (!text || !model) return;
  const has = /\bante[\s_-]?bet\b/i.test(text);
  if (!has) return;
  const ab = model.anteBet;
  ab.enabled = true;

  const sec = text.match(/^##\s*(?:\d+[\s.·)\-]+)?Ante\s*Bet[^\n]*\n([\s\S]*?)(?=\n##\s|$(?![\s\S]))/im);
  if (sec) {
    const body = sec[1];
    // Cena: "+25% uloga" / "+20% bet"
    const pct = body.match(/\|\s*(?:Cena|Cost|Price)\s*\|[^|\n]*?\+(\d+)\s*%/i);
    if (pct) ab.costMultiplier = 1 + (parseInt(pct[1], 10) / 100);
    // Trigger doubled
    if (/\b(duplira|double[sd]?|2x)\b/i.test(body)) ab.triggerMultiplier = 2;
    else {
      const m = body.match(/\b(?:×|x)\s*(\d+(?:\.\d+)?)\s+(?:trigger|verovatno[čć])/i);
      if (m) ab.triggerMultiplier = parseFloat(m[1]);
    }
  } else {
    // Fallback prose
    const pct = text.match(/\bante[\s_-]?bet[^\n.]{0,40}?\+(\d+)\s*%/i);
    if (pct) ab.costMultiplier = 1 + (parseInt(pct[1], 10) / 100);
  }
}

/* ── extractTumble — read tumble block knobs ─────────────────────────── */
export function extractTumble(text, model) {
  if (!text || !model) return;
  const tu = model.tumble;
  // If topology already detected cascade, mirror enable
  if (model.topology && model.topology.cascade && model.topology.cascade.enabled) {
    tu.enabled = true;
  }
  const headingRx = /^##\s*(?:\d+[\s.·)\-]+)?(?:tumble|cascade|avalanche)[^\n]*\n/im;
  const hm = text.match(headingRx);
  if (!hm) return;
  const start = hm.index + hm[0].length;
  const tail = text.slice(start);
  const nextH = tail.match(/^#{1,2}\s/m);
  const section = nextH ? tail.slice(0, nextH.index) : tail;

  const intMap = [
    ['removeMs',     /\bremove[- ]?ms\s*[:=]\s*(\d+)/i],
    ['gravityMs',    /\bgravity[- ]?ms\s*[:=]\s*(\d+)/i],
    ['refillMs',     /\brefill[- ]?ms\s*[:=]\s*(\d+)/i],
    ['chainPauseMs', /\bchain[- ]?pause[- ]?ms\s*[:=]\s*(\d+)/i],
    ['maxChain',     /\bmax[- ]?chain\s*[:=]\s*(\d+)/i],
  ];
  for (const [k, rx] of intMap) {
    const m = section.match(rx);
    if (m) tu[k] = parseInt(m[1], 10);
  }
  if (/\bpreserve[- ]?orbs?\s*[:=]\s*(true|yes|on)/i.test(section)) tu.preserveOrbs = true;
  if (/\bpreserve[- ]?orbs?\s*[:=]\s*(false|no|off)/i.test(section)) tu.preserveOrbs = false;
}


/* ─── Wave L–P extractors ─────────────────────────────────────────────
 *
 * Each extractor finds an optional `## <Feature Name>` (or alias) heading
 * and parses `key: value` lines or `key = value` lines inside it. All
 * keys are OPTIONAL — block resolveConfig() falls through to safe
 * defaults. Auto-enable comes from the features list (see block .mjs).
 */

function _findSection(text, headingRe) {
  if (!text) return null;
  const hm = text.match(headingRe);
  if (!hm) return null;
  const start = hm.index + hm[0].length;
  const tail = text.slice(start);
  const nextH = tail.match(/^#{1,2}\s/m);
  return nextH ? tail.slice(0, nextH.index) : tail;
}
function _readInt(section, key) {
  const re = new RegExp('\\b' + key + '\\b\\s*[:=]\\s*(-?\\d+)', 'i');
  const m = section.match(re);
  return m ? parseInt(m[1], 10) : undefined;
}
function _readFloat(section, key) {
  const re = new RegExp('\\b' + key + '\\b\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)', 'i');
  const m = section.match(re);
  return m ? parseFloat(m[1]) : undefined;
}
function _readBool(section, key) {
  if (new RegExp('\\b' + key + '\\b\\s*[:=]\\s*(true|yes|on|enabled)\\b', 'i').test(section)) return true;
  if (new RegExp('\\b' + key + '\\b\\s*[:=]\\s*(false|no|off|disabled)\\b', 'i').test(section)) return false;
  return undefined;
}
function _readStr(section, key) {
  const re = new RegExp('\\b' + key + '\\b\\s*[:=]\\s*([^\\n]+)', 'i');
  const m = section.match(re);
  if (!m) return undefined;
  return m[1].trim().replace(/[`'"]+$/g, '').replace(/^[`'"]+/g, '').trim();
}

export function extractStickyWild(text, model) {
  const s = _findSection(text, /^##\s+(?:Sticky\s+Wild|StickyWild)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.stickyWild;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const dur = _readInt(s, 'duration[- ]?spins'); if (dur !== undefined) tgt.durationSpins = dur;
  const wsid = _readStr(s, 'wild[- ]?symbol[- ]?id'); if (wsid) tgt.wildSymbolId = wsid;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
  const pulse = _readInt(s, 'pulse[- ]?ms'); if (pulse !== undefined) tgt.pulseMs = pulse;
}

export function extractExpandingWild(text, model) {
  const s = _findSection(text, /^##\s+(?:Expanding\s+Wild|ExpandingWild)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.expandingWild;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const wsid = _readStr(s, 'wild[- ]?symbol[- ]?id'); if (wsid) tgt.wildSymbolId = wsid;
  const dur = _readInt(s, 'expand[- ]?duration[- ]?ms'); if (dur !== undefined) tgt.expandDurationMs = dur;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}

export function extractWalkingWild(text, model) {
  const s = _findSection(text, /^##\s+(?:Walking\s+Wild|WalkingWild)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.walkingWild;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const wsid = _readStr(s, 'wild[- ]?symbol[- ]?id'); if (wsid) tgt.wildSymbolId = wsid;
  const dir = _readStr(s, 'direction'); if (dir) tgt.direction = dir.toLowerCase();
  const respin = _readBool(s, 'trigger[- ]?respin'); if (respin !== undefined) tgt.triggerRespin = respin;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}

export function extractWildReel(text, model) {
  const s = _findSection(text, /^##\s+(?:Wild\s+Reel|WildReel)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.wildReel;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const wsid = _readStr(s, 'wild[- ]?symbol[- ]?id'); if (wsid) tgt.wildSymbolId = wsid;
  const ch = _readFloat(s, 'chance[- ]?per[- ]?spin'); if (ch !== undefined) tgt.chancePerSpin = ch;
  const mx = _readInt(s, 'max[- ]?reels[- ]?per[- ]?spin'); if (mx !== undefined) tgt.maxReelsPerSpin = mx;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}

export function extractMysterySymbol(text, model) {
  const s = _findSection(text, /^##\s+(?:Mystery\s+Symbol|MysterySymbol)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.mysterySymbol;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const id = _readStr(s, 'mystery[- ]?symbol[- ]?id'); if (id) tgt.mysterySymbolId = id;
  const rd = _readInt(s, 'reveal[- ]?delay[- ]?ms'); if (rd !== undefined) tgt.revealDelayMs = rd;
  const rdr = _readInt(s, 'reveal[- ]?duration[- ]?ms'); if (rdr !== undefined) tgt.revealDurationMs = rdr;
  const iw = _readBool(s, 'include[- ]?wild'); if (iw !== undefined) tgt.includeWild = iw;
  const is = _readBool(s, 'include[- ]?scatter'); if (is !== undefined) tgt.includeScatter = is;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}

export function extractClusterPaysEval(text, model) {
  const s = _findSection(text, /^##\s+(?:Cluster\s+Pays(?:\s+Eval)?|ClusterPays)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.clusterPaysEval;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mc = _readInt(s, 'min[- ]?cluster'); if (mc !== undefined) tgt.minCluster = mc;
  const me = _readInt(s, 'max[- ]?events'); if (me !== undefined) tgt.maxEvents = me;
  const dg = _readBool(s, 'diagonal'); if (dg !== undefined) tgt.diagonal = dg;
  const bes = _readStr(s, 'bucket[- ]?edges');
  if (bes) {
    const nums = bes.split(/[,\s]+/).map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
    if (nums.length >= 2) tgt.bucketEdges = nums;
  }
}

export function extractWaysEval(text, model) {
  const s = _findSection(text, /^##\s+(?:Ways(?:\s+Eval)?|WaysToWin)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.waysEval;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const wc = _readInt(s, 'ways[- ]?count'); if (wc !== undefined) tgt.waysCount = wc;
  const mr = _readInt(s, 'min[- ]?run'); if (mr !== undefined) tgt.minRun = mr;
  const dir = _readStr(s, 'direction'); if (dir) tgt.direction = dir.toLowerCase();
  const me = _readInt(s, 'max[- ]?events'); if (me !== undefined) tgt.maxEvents = me;
}

export function extractPersistentMultiplier(text, model) {
  const s = _findSection(text, /^##\s+(?:Persistent\s+Multiplier|PersistentMultiplier)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.persistentMultiplier;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const sm = _readInt(s, 'start[- ]?mult'); if (sm !== undefined) tgt.startMult = sm;
  const gw = _readInt(s, 'grow[- ]?per[- ]?win'); if (gw !== undefined) tgt.growPerWin = gw;
  const gc = _readInt(s, 'grow[- ]?per[- ]?cascade'); if (gc !== undefined) tgt.growPerCascade = gc;
  const mx = _readInt(s, 'max[- ]?mult'); if (mx !== undefined) tgt.maxMult = mx;
  const rs = _readBool(s, 'reset[- ]?on[- ]?round[- ]?end'); if (rs !== undefined) tgt.resetOnRoundEnd = rs;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
}

/* Wave U1 — Progressive FS multiplier escalator extractor. */
export function extractProgressiveFreeSpins(text, model) {
  const s = _findSection(text,
    /^##\s+(?:Progressive\s+(?:Free\s+Spins?|FS)|ProgressiveFreeSpins|FS\s+Multiplier\s+(?:Ladder|Escalator))[^\n]*\n/im);
  if (!s) return;
  const tgt = model.progressiveFreeSpins;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const strat = _readStr(s, 'strategy');
  if (strat) {
    const norm = strat.toLowerCase().trim();
    if (['linear', 'doubling', 'fibonacci', 'ladder'].includes(norm)) tgt.strategy = norm;
  }
  const sm = _readInt(s, 'start[- ]?mult'); if (sm !== undefined) tgt.startMult = sm;
  const stp = _readInt(s, '\\bstep\\b'); if (stp !== undefined) tgt.step = stp;
  const mx = _readInt(s, 'max[- ]?mult'); if (mx !== undefined) tgt.maxMult = mx;
  const rs = _readBool(s, 'reset[- ]?on[- ]?round[- ]?end'); if (rs !== undefined) tgt.resetOnRoundEnd = rs;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const cl = _readStr(s, 'chip[- ]?label'); if (cl) tgt.chipLabel = cl;
  /* Ladder values: "ladder-values: 1,2,5,10,25" inline list */
  const ladderRaw = _readStr(s, 'ladder[- ]?values');
  if (ladderRaw) {
    const vals = ladderRaw.split(/[,\s]+/).map(v => parseInt(v, 10)).filter(n => Number.isFinite(n) && n >= 1);
    if (vals.length >= 2) tgt.ladderValues = vals;
  }
}

/* Wave U3 — UI Toast extractor. */
export function extractUiToast(text, model) {
  const s = _findSection(text, /^##\s+(?:UI\s+Toast|Win\s+Celebration|Win\s+Tier\s+Toast)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.uiToast;
  const en  = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const big = _readInt(s, 'big[- ]?win[- ]?threshold[- ]?x'); if (big !== undefined) tgt.bigWinThresholdX = big;
  const meg = _readInt(s, 'mega[- ]?win[- ]?threshold[- ]?x'); if (meg !== undefined) tgt.megaWinThresholdX = meg;
  const epi = _readInt(s, 'epic[- ]?win[- ]?threshold[- ]?x'); if (epi !== undefined) tgt.epicWinThresholdX = epi;
  const bdur = _readInt(s, 'big[- ]?duration[- ]?ms'); if (bdur !== undefined) tgt.bigDurationMs = bdur;
  const mdur = _readInt(s, 'mega[- ]?duration[- ]?ms'); if (mdur !== undefined) tgt.megaDurationMs = mdur;
  const edur = _readInt(s, 'epic[- ]?duration[- ]?ms'); if (edur !== undefined) tgt.epicDurationMs = edur;
  const fdur = _readInt(s, 'feature[- ]?duration[- ]?ms'); if (fdur !== undefined) tgt.featureDurationMs = fdur;
  const qfe = _readBool(s, 'queue[- ]?on[- ]?fs[- ]?end'); if (qfe !== undefined) tgt.queueOnFsEnd = qfe;
  const lbl = _readStr(s, 'fs[- ]?trigger[- ]?label'); if (lbl) tgt.fsTriggerLabel = lbl;
  const mq = _readInt(s, 'max[- ]?queue'); if (mq !== undefined) tgt.maxQueue = mq;
  /* Tier colors — "big: 255,210,90" style rows. */
  const colors = {};
  for (const tier of ['big', 'mega', 'epic', 'feature', 'neutral']) {
    const v = _readStr(s, '(?:' + tier + ')[- ]?color');
    if (v && /^\d{1,3},\d{1,3},\d{1,3}$/.test(v.trim())) colors[tier] = v.trim();
  }
  if (Object.keys(colors).length > 0) tgt.colors = colors;
}

/* Wave V1 — Slam-Stop button extractor.
 * Reads `## Slam Stop` / `## SlamStop` / `## Quick Stop` GDD section. */
export function extractSlamStop(text, model) {
  const s = _findSection(text, /^##\s+(?:Slam[- ]?Stop|SlamStop|Quick[- ]?Stop)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.slamStop;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const cl = _readStr(s, 'chip[- ]?label'); if (cl) tgt.chipLabel = cl;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
  const rms = _readInt(s, 'require[- ]?min[- ]?spin[- ]?ms'); if (rms !== undefined) tgt.requireMinSpinMs = rms;
  const hot = _readBool(s, 'hide[- ]?on[- ]?turbo'); if (hot !== undefined) tgt.hideOnTurbo = hot;
  const hoa = _readBool(s, 'hide[- ]?on[- ]?auto[- ]?spin'); if (hoa !== undefined) tgt.hideOnAutoSpin = hoa;
  const rca = _readBool(s, 'reels[- ]?click[- ]?area(?:[- ]?enabled)?'); if (rca !== undefined) tgt.reelsClickAreaEnabled = rca;
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
  const pa = _readBool(s, 'pulse[- ]?animation'); if (pa !== undefined) tgt.pulseAnimation = pa;
}

/* Wave U4 — Autoplay extractor.
 * Reads `## Autoplay` / `## Auto Spin` / `## Auto-Play` GDD section. */
export function extractAutoplay(text, model) {
  const s = _findSection(text, /^##\s+(?:Autoplay|Auto[- ]?Spin|Auto[- ]?Play)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.autoplay;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  /* stepValues — accept "10, 25, 50, 100, 250" comma list. */
  const sv = _readStr(s, 'step[- ]?values?');
  if (sv) {
    const arr = sv.split(/[,;]\s*/).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0);
    if (arr.length > 0) tgt.stepValues = arr;
  }
  const ds = _readInt(s, 'default[- ]?step'); if (ds !== undefined) tgt.defaultStep = ds;
  const bf = _readFloat(s, 'bet[- ]?unit[- ]?fallback'); if (bf !== undefined) tgt.betUnitFallback = bf;
  const sf = _readBool(s, 'stop[- ]?on[- ]?(?:any[- ]?)?feature(?:[- ]?trigger)?'); if (sf !== undefined) tgt.stopOnAnyFeatureTrigger = sf;
  const ssx = _readFloat(s, 'stop[- ]?on[- ]?single[- ]?win[- ]?x'); if (ssx !== undefined) tgt.stopOnSingleWinX = ssx;
  const sbl = _readFloat(s, 'stop[- ]?on[- ]?balance[- ]?below'); if (sbl !== undefined) tgt.stopOnBalanceBelow = sbl;
  const sla = _readFloat(s, 'stop[- ]?on[- ]?loss[- ]?above'); if (sla !== undefined) tgt.stopOnLossAbove = sla;
  const swa = _readFloat(s, 'stop[- ]?on[- ]?win[- ]?above'); if (swa !== undefined) tgt.stopOnWinAbove = swa;
  const isd = _readInt(s, 'inter[- ]?spin[- ]?delay[- ]?ms'); if (isd !== undefined) tgt.interSpinDelayMs = isd;
  const sc = _readBool(s, 'show[- ]?counter'); if (sc !== undefined) tgt.showCounter = sc;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
}

/* Wave U5 — Bet Selector extractor.
 * Reads `## Bet Selector` / `## Bet Model` / `## Wager Configuration` GDD
 * section. Recognizes comma-separated `coinValues` / `multipliers` lists
 * plus `defaultCoin`, `defaultMultiplier`, `currency` ("EUR"/"€"/"USD"),
 * `currencyPosition`, and the four UI boolean flags. */
export function extractBetSelector(text, model) {
  const s = _findSection(text, /^##\s+(?:Bet[- ]?Selector|Bet[- ]?Model|Wager(?:[- ]?Configuration)?)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.betSelector;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  /* coinValues — comma list, accepts decimals like "0.01, 0.02, ...". */
  const cv = _readStr(s, 'coin[- ]?values?');
  if (cv) {
    const arr = cv.split(/[,;]\s*/).map(x => parseFloat(x)).filter(Number.isFinite);
    if (arr.length > 0) tgt.coinValues = arr;
  }
  const mv = _readStr(s, 'multipliers?|bet[- ]?levels?');
  if (mv) {
    const arr = mv.split(/[,;]\s*/).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0);
    if (arr.length > 0) tgt.multipliers = arr;
  }
  const dc = _readFloat(s, 'default[- ]?coin'); if (dc !== undefined) tgt.defaultCoin = dc;
  const dm = _readInt(s, 'default[- ]?multiplier'); if (dm !== undefined) tgt.defaultMultiplier = dm;

  /* Currency — accept EUR/USD/GBP/JPY or actual glyph (€, $, £, ¥). */
  const cur = _readStr(s, 'currency');
  if (cur) {
    const map = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CHF: 'CHF', PLN: 'PLN' };
    const code = cur.toUpperCase();
    tgt.currency = map[code] || cur;
  }
  const cp = _readStr(s, 'currency[- ]?position');
  if (cp) tgt.currencyPosition = /suffix/i.test(cp) ? 'suffix' : 'prefix';

  const scp = _readBool(s, 'show[- ]?coin[- ]?picker'); if (scp !== undefined) tgt.showCoinPicker = scp;
  const smp = _readBool(s, 'show[- ]?multiplier[- ]?picker'); if (smp !== undefined) tgt.showMultiplierPicker = smp;
  const ssb = _readBool(s, 'show[- ]?step[- ]?buttons?'); if (ssb !== undefined) tgt.showStepButtons = ssb;
  const mbb = _readBool(s, 'max[- ]?bet[- ]?button'); if (mbb !== undefined) tgt.maxBetButton = mbb;
  const pod = _readBool(s, 'panel[- ]?on[- ]?demand'); if (pod !== undefined) tgt.panelOnDemand = pod;

  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
}

/* Wave U13 — Settings panel extractor.
 * Reads `## Settings` / `## Settings Panel` / `## Preferences` section. */
export function extractSettingsPanel(text, model) {
  const s = _findSection(text, /^##\s+(?:Settings(?:[- ]?Panel)?|Preferences)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.settingsPanel;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const cl = _readStr(s, 'chip[- ]?label'); if (cl) tgt.chipLabel = cl;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
  for (const [reKey, modelKey] of [
    ['show[- ]?turbo[- ]?toggle',          'showTurboToggle'],
    ['show[- ]?sound[- ]?toggle',          'showSoundToggle'],
    ['show[- ]?reduced[- ]?motion[- ]?toggle', 'showReducedMotionToggle'],
    ['show[- ]?quick[- ]?spin[- ]?toggle',  'showQuickSpinToggle'],
    ['show[- ]?auto[- ]?hide[- ]?win[- ]?toggle', 'showAutoHideWinToggle'],
    ['show[- ]?language[- ]?selector',     'showLanguageSelector'],
    ['close[- ]?on[- ]?backdrop',          'closeOnBackdrop'],
    ['close[- ]?on[- ]?escape',            'closeOnEscape'],
    ['auto[- ]?hide[- ]?on[- ]?spin',      'autoHideOnSpin'],
    ['persist[- ]?in[- ]?local[- ]?storage','persistInLocalStorage'],
  ]) {
    const v = _readBool(s, reKey);
    if (v !== undefined) tgt[modelKey] = v;
  }
  const al = _readStr(s, 'available[- ]?locales');
  if (al) {
    const arr = al.split(/[,;]\s*/).map(x => x.trim()).filter(x => x.length > 0);
    if (arr.length > 0) tgt.availableLocales = arr;
  }
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
}

/* Wave U11 — Turbo mode extractor.
 * Reads `## Turbo Mode` / `## Turbo Spin` / `## Quick Mode` section. */
export function extractTurboMode(text, model) {
  const s = _findSection(text, /^##\s+(?:Turbo[- ]?Mode|Turbo[- ]?Spin|Quick[- ]?Mode)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.turboMode;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const ia = _readBool(s, 'initial[- ]?active'); if (ia !== undefined) tgt.initialActive = ia;
  const pls = _readBool(s, 'persist[- ]?in[- ]?local[- ]?storage'); if (pls !== undefined) tgt.persistInLocalStorage = pls;
  const tsm = _readFloat(s, 'turbo[- ]?speed[- ]?mult(?:iplier)?'); if (tsm !== undefined) tgt.turboSpeedMult = tsm;
  const cl = _readStr(s, 'chip[- ]?label'); if (cl) tgt.chipLabel = cl;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
}

/* Wave U9 — Session History Log extractor.
 * Reads `## History Log` / `## Session History` / `## Spin History`. */
export function extractHistoryLog(text, model) {
  const s = _findSection(text, /^##\s+(?:History[- ]?Log|Session[- ]?History|Spin[- ]?History)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.historyLog;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const cap = _readInt(s, 'capacity'); if (cap !== undefined) tgt.capacity = cap;
  const csv = _readBool(s, 'allow[- ]?csv[- ]?export'); if (csv !== undefined) tgt.allowCsvExport = csv;
  const st = _readBool(s, 'show[- ]?time'); if (st !== undefined) tgt.showTime = st;
  const tf = _readStr(s, 'time[- ]?format');
  if (tf) {
    const v = tf.toLowerCase();
    if (v === 'hms' || v === 'rel' || v === 'iso') tgt.timeFormat = v;
  }
  const cl = _readStr(s, 'chip[- ]?label'); if (cl) tgt.chipLabel = cl;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
  const pbg = _readStr(s, 'panel[- ]?bg[- ]?color'); if (pbg) tgt.panelBgColor = pbg;
  const pac = _readStr(s, 'panel[- ]?accent[- ]?color'); if (pac) tgt.panelAccentColor = pac;
  const cob = _readBool(s, 'close[- ]?on[- ]?backdrop'); if (cob !== undefined) tgt.closeOnBackdrop = cob;
  const coe = _readBool(s, 'close[- ]?on[- ]?escape'); if (coe !== undefined) tgt.closeOnEscape = coe;
  const ahs = _readBool(s, 'auto[- ]?hide[- ]?on[- ]?spin'); if (ahs !== undefined) tgt.autoHideOnSpin = ahs;
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
}

/* Wave U8 — Balance HUD extractor.
 * Reads `## Balance HUD` / `## Balance Hud` / `## Wallet HUD` section. */
export function extractBalanceHud(text, model) {
  const s = _findSection(text, /^##\s+(?:Balance[- ]?HUD|Balance[- ]?Hud|Wallet[- ]?HUD)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.balanceHud;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const sb = _readFloat(s, 'starting[- ]?balance'); if (sb !== undefined) tgt.startingBalance = sb;
  const fb = _readFloat(s, 'fallback[- ]?bet'); if (fb !== undefined) tgt.fallbackBet = fb;
  const cur = _readStr(s, 'currency');
  if (cur) {
    const map = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CHF: 'CHF', PLN: 'PLN' };
    tgt.currency = map[cur.toUpperCase()] || cur;
  }
  const cp = _readStr(s, 'currency[- ]?position');
  if (cp) tgt.currencyPosition = /suffix/i.test(cp) ? 'suffix' : 'prefix';
  const swc = _readBool(s, 'show[- ]?win[- ]?column'); if (swc !== undefined) tgt.showWinColumn = swc;
  const stwfs = _readBool(s, 'show[- ]?total[- ]?win[- ]?during[- ]?fs'); if (stwfs !== undefined) tgt.showTotalWinDuringFs = stwfs;
  const poc = _readBool(s, 'pulse[- ]?on[- ]?change'); if (poc !== undefined) tgt.pulseOnChange = poc;
  const ac = _readStr(s, 'accent[- ]?color'); if (ac) tgt.accentColor = ac;
  const dc = _readStr(s, 'debit[- ]?color'); if (dc) tgt.debitColor = dc;
  const crc = _readStr(s, 'credit[- ]?color'); if (crc) tgt.creditColor = crc;
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
}

/* Wave U10 — Paytable modal extractor.
 * Reads `## Paytable` / `## Pay Table` / `## Paytable Modal` GDD section. */
export function extractPaytable(text, model) {
  const s = _findSection(text, /^##\s+(?:Paytable|Pay[- ]?Table|Paytable[- ]?Modal)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.paytable;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const cl = _readStr(s, 'chip[- ]?label'); if (cl) tgt.chipLabel = cl;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
  const mbg = _readStr(s, 'modal[- ]?bg[- ]?color'); if (mbg) tgt.modalBgColor = mbg;
  const mac = _readStr(s, 'modal[- ]?accent[- ]?color'); if (mac) tgt.modalAccentColor = mac;
  const sfl = _readBool(s, 'show[- ]?features[- ]?list'); if (sfl !== undefined) tgt.showFeaturesList = sfl;
  const swr = _readBool(s, 'show[- ]?wild[- ]?rules'); if (swr !== undefined) tgt.showWildRules = swr;
  const slm = _readBool(s, 'show[- ]?line[- ]?map'); if (slm !== undefined) tgt.showLineMap = slm;
  const cob = _readBool(s, 'close[- ]?on[- ]?backdrop'); if (cob !== undefined) tgt.closeOnBackdrop = cob;
  const coe = _readBool(s, 'close[- ]?on[- ]?escape'); if (coe !== undefined) tgt.closeOnEscape = coe;
  const ahs = _readBool(s, 'auto[- ]?hide[- ]?on[- ]?spin'); if (ahs !== undefined) tgt.autoHideOnSpin = ahs;
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
}

/* Wave U6 — Secondary Gamble extractor.
 * Reads `## Gamble Secondary` / `## Card and Ladder Gamble` /
 * `## Risk Ladder` section. */
export function extractGambleSecondary(text, model) {
  const s = _findSection(text, /^##\s+(?:Gamble[- ]?Secondary|Card[- ]?and[- ]?Ladder(?:[- ]?Gamble)?|Risk[- ]?Ladder)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.gambleSecondary;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const md = _readStr(s, 'modes?');
  if (md) {
    const arr = md.split(/[,;]\s*/).map(x => x.trim().toLowerCase()).filter(x => x === 'card' || x === 'ladder');
    if (arr.length > 0) tgt.modes = arr;
  }
  const cm = _readStr(s, 'card[- ]?mode');
  if (cm && /^(color|suit)$/i.test(cm)) tgt.cardMode = cm.toLowerCase();
  const cmx = _readFloat(s, 'card[- ]?multiplier'); if (cmx !== undefined) tgt.cardMultiplier = cmx;
  const cmr = _readInt(s, 'card[- ]?max[- ]?rounds'); if (cmr !== undefined) tgt.cardMaxRounds = cmr;
  const lr = _readInt(s, 'ladder[- ]?rungs?'); if (lr !== undefined) tgt.ladderRungs = lr;
  const lrm = _readFloat(s, 'ladder[- ]?rung[- ]?multiplier'); if (lrm !== undefined) tgt.ladderRungMultiplier = lrm;
  const lmr = _readInt(s, 'ladder[- ]?max[- ]?rounds'); if (lmr !== undefined) tgt.ladderMaxRounds = lmr;
  const mwp = _readFloat(s, 'min[- ]?win(?:[- ]?for[- ]?prompt)?(?:[- ]?x)?'); if (mwp !== undefined) tgt.minWinForPromptX = mwp;
  const mbx = _readFloat(s, 'max[- ]?bank(?:[- ]?x)?'); if (mbx !== undefined) tgt.maxBankX = mbx;
  const pt = _readInt(s, 'prompt[- ]?timeout[- ]?ms'); if (pt !== undefined) tgt.promptTimeoutMs = pt;
  const sif = _readBool(s, 'show[- ]?in[- ]?fs'); if (sif !== undefined) tgt.showInFs = sif;
  const sia = _readBool(s, 'show[- ]?in[- ]?autoplay'); if (sia !== undefined) tgt.showInAutoplay = sia;
  const cur = _readStr(s, 'currency');
  if (cur) {
    const map = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CHF: 'CHF', PLN: 'PLN' };
    tgt.currency = map[cur.toUpperCase()] || cur;
  }
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
}

/* Wave V2 — Force-Skip button extractor.
 * Reads `## Force Skip` / `## ForceSkip` / `## Skip Animation` section. */
export function extractForceSkip(text, model) {
  const s = _findSection(text, /^##\s+(?:Force[- ]?Skip|ForceSkip|Skip[- ]?Animation)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.forceSkip;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const cl = _readStr(s, 'chip[- ]?label'); if (cl) tgt.chipLabel = cl;
  const cc = _readStr(s, 'chip[- ]?color'); if (cc) tgt.chipColor = cc;
  const ctc = _readStr(s, 'chip[- ]?text[- ]?color'); if (ctc) tgt.chipTextColor = ctc;
  const dp = _readBool(s, 'disabled[- ]?pressed'); if (dp !== undefined) tgt.disabledPressed = dp;
  const hp = _readBool(s, 'hide[- ]?pressed'); if (hp !== undefined) tgt.hidePressed = hp;
  const sdr = _readBool(s, 'show[- ]?during[- ]?rollup'); if (sdr !== undefined) tgt.showDuringRollup = sdr;
  const sdfi = _readBool(s, 'show[- ]?during[- ]?fs[- ]?intro'); if (sdfi !== undefined) tgt.showDuringFsIntro = sdfi;
  const sdfo = _readBool(s, 'show[- ]?during[- ]?fs[- ]?outro'); if (sdfo !== undefined) tgt.showDuringFsOutro = sdfo;
  const sdc = _readBool(s, 'show[- ]?during[- ]?celebration'); if (sdc !== undefined) tgt.showDuringCelebration = sdc;
  const mrm = _readInt(s, 'min[- ]?rollup[- ]?ms(?:[- ]?for[- ]?show)?'); if (mrm !== undefined) tgt.minRollupMsForShow = mrm;
  const ar = _readStr(s, 'aria[- ]?label'); if (ar) tgt.ariaLabel = ar;
}

/* Wave U2 — Audio scaffolding extractor. */
export function extractAudio(text, model) {
  const s = _findSection(text, /^##\s+(?:Audio|Sound)\b[^\n]*\n/im);
  if (!s) return;
  const tgt = model.audio;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mv = _readFloat(s, 'master[- ]?volume'); if (mv !== undefined) tgt.masterVolume = mv;
  const mu = _readBool(s, '\\bmuted'); if (mu !== undefined) tgt.muted = mu;
  const st = _readBool(s, 'show[- ]?toggle'); if (st !== undefined) tgt.showToggle = st;
  const tc = _readStr(s, 'toggle[- ]?color'); if (tc) tgt.toggleColor = tc;
  const big = _readInt(s, 'big[- ]?win[- ]?threshold[- ]?x'); if (big !== undefined) tgt.bigWinThresholdX = big;
  const mega = _readInt(s, 'mega[- ]?win[- ]?threshold[- ]?x'); if (mega !== undefined) tgt.megaWinThresholdX = mega;
  const epic = _readInt(s, 'epic[- ]?win[- ]?threshold[- ]?x'); if (epic !== undefined) tgt.epicWinThresholdX = epic;
  /* URL rows of form "- SPIN_START: sounds/spin.mp3" or "| SPIN_START | sounds/spin.mp3 |" */
  const urls = {};
  const urlRe = /(?:^|\n)[\s\-|*]*([A-Z][A-Z_]+)[\s:|]+([\w./\-]+\.(?:mp3|ogg|wav|m4a|aac|webm))/g;
  let m;
  while ((m = urlRe.exec(s)) !== null) {
    urls[m[1]] = m[2];
  }
  if (Object.keys(urls).length > 0) tgt.urls = urls;
}

export function extractHoldAndWin(text, model) {
  const s = _findSection(text, /^##\s+(?:Hold\s*(?:&|and)\s*Win|Hold\s*(?:&|and)\s*Spin|HoldAndWin)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.holdAndWin;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const tc = _readInt(s, 'trigger[- ]?count'); if (tc !== undefined) tgt.triggerCount = tc;
  const bid = _readStr(s, 'bonus[- ]?symbol[- ]?id'); if (bid) tgt.bonusSymbolId = bid;
  const ra = _readInt(s, 'respins[- ]?awarded'); if (ra !== undefined) tgt.respinsAwarded = ra;
  const rn = _readBool(s, 'reset[- ]?on[- ]?new[- ]?bonus'); if (rn !== undefined) tgt.resetOnNewBonus = rn;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}

export function extractRespin(text, model) {
  const s = _findSection(text, /^##\s+Respin[^\n]*\n/im);
  if (!s) return;
  const tgt = model.respin;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const tc = _readFloat(s, 'trigger[- ]?chance'); if (tc !== undefined) tgt.triggerChance = tc;
  const cx = _readFloat(s, 'cost[- ]?x'); if (cx !== undefined) tgt.costX = cx;
  const hr = _readStr(s, 'hold[- ]?rule'); if (hr) tgt.holdRule = hr.toLowerCase();
  const rp = _readInt(s, 'respins[- ]?per[- ]?trigger'); if (rp !== undefined) tgt.respinsPerTrigger = rp;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}

export function extractWinCap(text, model) {
  const s = _findSection(text, /^##\s+(?:Win\s*Cap|WinCap|Max\s*Win\s*Cap)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.winCap;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mx = _readInt(s, 'max[- ]?win[- ]?x'); if (mx !== undefined) tgt.maxWinX = mx;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const lbl = _readStr(s, 'overlay[- ]?label'); if (lbl) tgt.overlayLabel = lbl;
  const ms = _readInt(s, 'overlay[- ]?ms'); if (ms !== undefined) tgt.overlayMs = ms;
  const c = _readStr(s, '\\bcolor'); if (c) tgt.color = c;
  const fr = _readBool(s, 'force[- ]?round[- ]?end'); if (fr !== undefined) tgt.forceRoundEnd = fr;
}

export function extractBonusPick(text, model) {
  const s = _findSection(text, /^##\s+(?:Bonus\s+Pick|BonusPick|Pick[- ]?Em)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.bonusPick;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const tc = _readInt(s, 'tile[- ]?count'); if (tc !== undefined) tgt.tileCount = tc;
  const mp = _readInt(s, 'max[- ]?picks'); if (mp !== undefined) tgt.maxPicks = mp;
  const title = _readStr(s, 'title'); if (title) tgt.title = title.slice(0, 40);
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}

export function extractWheelBonus(text, model) {
  const s = _findSection(text, /^##\s+(?:Wheel\s+Bonus|Bonus\s+Wheel|WheelBonus)[^\n]*\n/im);
  const tgt = model.wheelBonus;
  if (s) {
    const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
    const sd = _readInt(s, 'spin[- ]?duration[- ]?ms'); if (sd !== undefined) tgt.spinDurationMs = sd;
    const auto = _readBool(s, 'auto[- ]?spin'); if (auto !== undefined) tgt.autoSpin = auto;
    const title = _readStr(s, 'title'); if (title) tgt.title = title.slice(0, 40);
    const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
    /* Wave UQ2 — segmentCount: N — generate N evenly-spaced default segments
       so the wheel renders with the GDD-declared size even when no explicit
       segments table is provided. The Weighted Wheel Segments block (below)
       can later override label/value/weight per index. */
    const sc = _readInt(s, 'segment[- ]?count');
    if (sc !== undefined && sc >= 3 && sc <= 48) {
      tgt.segments = _synthDefaultSegments(sc);
    }
  }
  /* Wave UQ2 — parse the standalone "## Weighted Wheel Segments" table.
     Format (pipe-separated, header + body rows):
       | Segment   | Value   | Weight |
       |-----------|---------|--------|
       | 2× bet    | 2       | 30     |
       | MINI      | jackpot | 5      |
     "jackpot" value → recorded as jackpotTier=<Segment label upper-cased>,
     numeric value → multiplier x bet. Weights bubble up to the
     weightedWheelSegments block via model.weightedWheelSegments.weights[]. */
  const wTable = _findSection(text, /^##\s+(?:Weighted\s+Wheel\s+Segments?|Wheel\s+Segments?)[^\n]*\n/im);
  if (wTable) {
    const parsed = _parseWheelSegmentsTable(wTable);
    if (parsed && parsed.length >= 3) {
      tgt.segments = parsed.map(p => {
        const out = { label: p.label, value: p.value, color: _wheelSegmentColor(p) };
        if (p.jackpotTier) out.jackpotTier = p.jackpotTier;
        return out;
      });
      if (!model.weightedWheelSegments) model.weightedWheelSegments = {};
      model.weightedWheelSegments.weights = parsed.map(p => p.weight);
    }
  }
  /* Wave UQ2 — implicit enable when the topology is wheel-evaluation OR
     when the features list mentions a wheel bonus. Avoids the previous
     "029 renders nothing" failure where the GDD declared wheel topology
     but `Wheel Bonus` section was minimal so `enabled` stayed undefined. */
  const isWheelTopology = model.topology && (model.topology.evaluation === 'wheel' || model.topology.kind === 'wheel');
  const featuresMentionWheel = Array.isArray(model.features) && model.features.some(f =>
    f && (f.kind === 'wheel_bonus' || /wheel/i.test(f.label || ''))
  );
  if ((isWheelTopology || featuresMentionWheel) && tgt.enabled === undefined) {
    tgt.enabled = true;
  }
}

/* Wave UQ2 — N evenly-spaced default segments (industry baseline:
   alternating multiplier tiers — low/mid/high/jackpot — so the wheel
   visually reads correctly even with no explicit GDD table). */
function _synthDefaultSegments(n) {
  const TIERS = [
    { label: '×2',   value: 2,   color: '#3aa0c2' },
    { label: '×5',   value: 5,   color: '#2bb56b' },
    { label: '×10',  value: 10,  color: '#e8c270' },
    { label: '×25',  value: 25,  color: '#d28a3a' },
    { label: '×50',  value: 50,  color: '#c45050' },
    { label: '×100', value: 100, color: '#7050c4' },
  ];
  const out = [];
  for (let i = 0; i < n; i++) out.push(TIERS[i % TIERS.length]);
  return out;
}

/* Wave UQ2 — strict pipe-table parser. Returns null if no body row found. */
function _parseWheelSegmentsTable(section) {
  const lines = section.split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    /* Skip header divider rows like "|---|---|---|" or "|:--|--:|--:|" */
    if (/^\|[\s:|-]+\|$/.test(line)) continue;
    const cells = line.split('|').map(c => c.trim()).filter((c, i, arr) => !(c === '' && (i === 0 || i === arr.length - 1)));
    /* Drop the literal header row */
    if (/^segment$/i.test(cells[0])) continue;
    if (cells.length < 2) continue;
    const labelRaw = cells[0];
    const valueRaw = cells[1];
    const weightRaw = cells[2];
    /* Detect "jackpot" sentinel value */
    const jackpot = /jackpot|^(mini|minor|major|mega|grand)$/i.test(valueRaw) || /^(mini|minor|major|mega|grand)$/i.test(labelRaw);
    let value = 0;
    if (!jackpot) {
      /* "2× bet" / "×5" / "5x" / "100" → numeric */
      const numMatch = String(valueRaw).match(/-?\d+(?:\.\d+)?/);
      if (numMatch) value = parseFloat(numMatch[0]);
      else {
        const labelNumMatch = String(labelRaw).match(/(\d+(?:\.\d+)?)\s*[x×]/i);
        if (labelNumMatch) value = parseFloat(labelNumMatch[1]);
      }
    }
    const weight = (() => {
      const wm = String(weightRaw || '').match(/-?\d+(?:\.\d+)?/);
      return wm ? parseFloat(wm[0]) : 1;
    })();
    let label = labelRaw.replace(/\s*bet\s*$/i, '').replace(/\s+/g, ' ').slice(0, 10);
    if (jackpot && !/^(MINI|MINOR|MAJOR|MEGA|GRAND)$/i.test(label)) {
      const tierMatch = labelRaw.match(/\b(MINI|MINOR|MAJOR|MEGA|GRAND)\b/i);
      if (tierMatch) label = tierMatch[1].toUpperCase();
    }
    const out = { label, value, weight };
    if (jackpot) {
      const tierMatch = (labelRaw.match(/\b(MINI|MINOR|MAJOR|MEGA|GRAND)\b/i) || [])[1]
                    || (valueRaw.match(/\b(MINI|MINOR|MAJOR|MEGA|GRAND)\b/i) || [])[1]
                    || 'MAJOR';
      out.jackpotTier = tierMatch.toUpperCase();
    }
    rows.push(out);
  }
  return rows.length ? rows : null;
}

function _wheelSegmentColor(p) {
  if (p.jackpotTier) {
    const M = { MINI: '#3aa0c2', MINOR: '#2bb56b', MAJOR: '#e8c270', MEGA: '#c45050', GRAND: '#7050c4' };
    return M[p.jackpotTier] || '#e8c270';
  }
  const v = p.value || 0;
  if (v >= 500) return '#7050c4';
  if (v >= 100) return '#c45050';
  if (v >= 25)  return '#d28a3a';
  if (v >= 10)  return '#e8c270';
  if (v >= 5)   return '#2bb56b';
  return '#3aa0c2';
}

export function extractLightning(text, model) {
  const s = _findSection(text, /^##\s+(?:Lightning(?:\s+Multiplier|\s+Strike)?)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.lightning;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const tc = _readFloat(s, 'trigger[- ]?chance'); if (tc !== undefined) tgt.triggerChance = tc;
  const mn = _readInt(s, 'min[- ]?strikes'); if (mn !== undefined) tgt.minStrikes = mn;
  const mx = _readInt(s, 'max[- ]?strikes'); if (mx !== undefined) tgt.maxStrikes = mx;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
  const sd = _readInt(s, 'strike[- ]?duration[- ]?ms'); if (sd !== undefined) tgt.strikeDurationMs = sd;
}

export function extractGamble(text, model) {
  const s = _findSection(text, /^##\s+Gamble[^\n]*\n/im);
  if (!s) return;
  const tgt = model.gamble;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const mr = _readInt(s, 'max[- ]?rounds'); if (mr !== undefined) tgt.maxRounds = mr;
  const mu = _readFloat(s, 'multiplier'); if (mu !== undefined) tgt.multiplier = mu;
  const ct = _readInt(s, 'collect[- ]?threshold[- ]?x'); if (ct !== undefined) tgt.collectThresholdX = ct;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}

export function extractSuperSymbol(text, model) {
  const s = _findSection(text, /^##\s+(?:Super\s+Symbol|Colossal\s+Symbol|Mega\s+Symbol|SuperSymbol)[^\n]*\n/im);
  if (!s) return;
  const tgt = model.superSymbol;
  const en = _readBool(s, 'enabled'); if (en !== undefined) tgt.enabled = en;
  const mode = _readStr(s, 'mode'); if (mode) tgt.mode = mode.toLowerCase();
  const bs = _readInt(s, 'block[- ]?size'); if (bs !== undefined) tgt.blockSize = bs;
  const tc = _readFloat(s, 'trigger[- ]?chance'); if (tc !== undefined) tgt.triggerChance = tc;
  const halo = _readStr(s, 'halo[- ]?color'); if (halo) tgt.haloColor = halo;
}
