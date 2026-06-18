/* eslint-disable no-console */
import {
  defaultConfig, resolveConfig, selectKinds,
  emitUniversalForcePanelCSS, emitUniversalForcePanelMarkup, emitUniversalForcePanelRuntime,
  KNOWN_KINDS, KIND_SHORT, KIND_FULL,
} from '../../src/blocks/universalForcePanel.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; } };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const notCt = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/universalForcePanel.mjs —');

/* ─── defaults ────────────────────────────────────────── */
t('defaultConfig is fresh + sane', () => {
  const c = defaultConfig();
  eq(c.enabled, true);
  eq(c.includeKinds, 'auto');
  ok(Array.isArray(c.alwaysIncludeKinds));
  ok(c.alwaysIncludeKinds.includes('big_win'));
  eq(c.chipHeight, 28);
  eq(c.chipFontSize, 11);
  eq(c.showLabelText, true);
});

t('defaultConfig: alwaysInclude is a fresh copy (no shared mutation)', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  a.alwaysIncludeKinds.push('free_spins');
  ok(!b.alwaysIncludeKinds.includes('free_spins'));
});

/* ─── resolveConfig ──────────────────────────────────── */
t('resolveConfig: enabled=false honored', () => {
  const c = resolveConfig({ universalForcePanel: { enabled: false } });
  eq(c.enabled, false);
});

t('resolveConfig: includeKinds explicit array accepted', () => {
  const c = resolveConfig({ universalForcePanel: { includeKinds: ['free_spins', 'multiplier'] } });
  ok(Array.isArray(c.includeKinds));
  eq(c.includeKinds.length, 2);
});

t('resolveConfig: includeKinds with unknown kind rejected → defaults to auto', () => {
  const c = resolveConfig({ universalForcePanel: { includeKinds: ['no_such_kind'] } });
  eq(c.includeKinds, 'auto');
});

t('resolveConfig: chipHeight clamps gibberish', () => {
  eq(resolveConfig({ universalForcePanel: { chipHeight: 999 } }).chipHeight, 28);
  eq(resolveConfig({ universalForcePanel: { chipHeight: -5 } }).chipHeight, 28);
  eq(resolveConfig({ universalForcePanel: { chipHeight: 22.5 } }).chipHeight, 28);
  eq(resolveConfig({ universalForcePanel: { chipHeight: 22 } }).chipHeight, 22);
});

t('resolveConfig: labelText XSS rejected', () => {
  const c = resolveConfig({ universalForcePanel: { labelText: '<script>' } });
  eq(c.labelText, 'FORCE');
});

t('resolveConfig: labelText valid accepted', () => {
  eq(resolveConfig({ universalForcePanel: { labelText: 'QA' } }).labelText, 'QA');
});

/* ─── selectKinds ────────────────────────────────────── */
t('selectKinds: empty model → only alwaysInclude (big_win)', () => {
  const c = defaultConfig();
  const k = selectKinds(c, {});
  eq(k.length, 1);
  eq(k[0], 'big_win');
});

t('selectKinds: features with bonus_buy → excluded (owned by bonusBuy block)', () => {
  const c = defaultConfig();
  const k = selectKinds(c, { features: [{ kind: 'bonus_buy', label: 'Bonus Buy' }] });
  ok(!k.includes('bonus_buy'), 'bonus_buy should be deduped');
});

t('selectKinds: features with ante_bet → excluded (owned by anteBet block)', () => {
  const c = defaultConfig();
  const k = selectKinds(c, { features: [{ kind: 'ante_bet', label: 'Ante Bet' }] });
  ok(!k.includes('ante_bet'), 'ante_bet should be deduped');
});

t('selectKinds: features with free_spins + multiplier + cluster → 2 forcible + big_win (cluster is eval-only)', () => {
  /* 2026-06-18 — Boki rule: PAYOUT_EVALUATOR_KINDS (ways / cluster_pays /
   * pay_anywhere / scatter_pay) are permanent evaluator routes, not
   * single-spin events. Force chips for them would be no-ops, so the
   * panel filters them out. free_spins + multiplier remain forcible,
   * big_win is always-include. */
  const c = defaultConfig();
  const k = selectKinds(c, {
    features: [
      { kind: 'free_spins', label: 'FS' },
      { kind: 'multiplier', label: 'Mult' },
      { kind: 'cluster_pays', label: 'Cluster' },
    ],
  });
  ok(k.includes('free_spins'));
  ok(k.includes('multiplier'));
  ok(!k.includes('cluster_pays'), 'cluster_pays is eval-only — no force chip');
  ok(k.includes('big_win'));
});

t('selectKinds: stable canonical order (free_spins always before multiplier)', () => {
  const c = defaultConfig();
  const k = selectKinds(c, {
    features: [
      { kind: 'multiplier', label: '×' },
      { kind: 'free_spins', label: 'FS' },
    ],
  });
  const iFs = k.indexOf('free_spins');
  const iMu = k.indexOf('multiplier');
  ok(iFs >= 0 && iMu >= 0);
  ok(iFs < iMu, 'free_spins must come before multiplier in canonical order');
});

t('selectKinds: excludeKinds removes a kind even if detected', () => {
  const c = resolveConfig({
    universalForcePanel: { excludeKinds: ['free_spins'] },
  });
  const k = selectKinds(c, { features: [{ kind: 'free_spins', label: 'FS' }] });
  ok(!k.includes('free_spins'));
});

t('selectKinds: disabled cfg → empty', () => {
  const k = selectKinds({ enabled: false }, { features: [{ kind: 'free_spins' }] });
  eq(k.length, 0);
});

t('selectKinds: unknown feature kinds in model → silently ignored', () => {
  const c = defaultConfig();
  const k = selectKinds(c, { features: [{ kind: 'unicorn_dance' }, { kind: 'free_spins' }] });
  ok(k.includes('free_spins'));
  ok(!k.includes('unicorn_dance'));
});

t('selectKinds: malformed model.features (not array) → no throw, only big_win', () => {
  const c = defaultConfig();
  const k = selectKinds(c, { features: 'not-an-array' });
  eq(k.length, 1);
  eq(k[0], 'big_win');
});

/* ─── CSS ────────────────────────────────────────────── */
t('emitUniversalForcePanelCSS: disabled returns disabled-marker comment', () => {
  const css = emitUniversalForcePanelCSS({ enabled: false });
  ct(css, 'disabled by GDD');
  notCt(css, '.ufp-panel');
});

t('emitUniversalForcePanelCSS: enabled emits ufp-panel + ufp-chip', () => {
  const css = emitUniversalForcePanelCSS(defaultConfig());
  ct(css, '.ufp-panel');
  ct(css, '.ufp-chip');
  ct(css, 'prefers-reduced-motion');
  ct(css, 'max-width: 620px');
});

t('emitUniversalForcePanelCSS: respects custom chipHeight', () => {
  const css = emitUniversalForcePanelCSS(resolveConfig({ universalForcePanel: { chipHeight: 36 } }));
  ct(css, 'height: 36px');
});

/* ─── Markup ─────────────────────────────────────────── */
t('emitUniversalForcePanelMarkup: disabled → no panel', () => {
  const m = emitUniversalForcePanelMarkup({ enabled: false }, {});
  notCt(m, '.ufp-panel');
});

t('emitUniversalForcePanelMarkup: no kinds detected → no panel', () => {
  const m = emitUniversalForcePanelMarkup(resolveConfig({ universalForcePanel: { alwaysIncludeKinds: [] } }), {});
  notCt(m, 'class="ufp-panel"');
});

t('emitUniversalForcePanelMarkup: free_spins detected → chip rendered', () => {
  const m = emitUniversalForcePanelMarkup(
    defaultConfig(),
    { features: [{ kind: 'free_spins', label: 'FS' }] }
  );
  ct(m, 'data-ufp-kind="free_spins"');
  ct(m, KIND_SHORT.free_spins);
  ct(m, 'aria-label="Force Free Spins"');
});

t('emitUniversalForcePanelMarkup: XSS attempt in label tolerated', () => {
  // label is hardcoded from KIND_FULL_LABELS — but escapeAttr should still
  // protect against future contamination
  const m = emitUniversalForcePanelMarkup(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  notCt(m, '<script');
});

t('emitUniversalForcePanelMarkup: toolbar role + ariaLabel', () => {
  const m = emitUniversalForcePanelMarkup(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  ct(m, 'role="toolbar"');
  ct(m, 'aria-label="Feature force panel"');
});

t('emitUniversalForcePanelMarkup: FORCE label rendered (showLabelText default)', () => {
  const m = emitUniversalForcePanelMarkup(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  ct(m, 'FORCE');
});

t('emitUniversalForcePanelMarkup: showLabelText=false drops label span', () => {
  const m = emitUniversalForcePanelMarkup(
    resolveConfig({ universalForcePanel: { showLabelText: false } }),
    { features: [{ kind: 'free_spins' }] }
  );
  notCt(m, 'ufp-label');
});

/* ─── Runtime ────────────────────────────────────────── */
t('emitUniversalForcePanelRuntime: disabled → no runtime', () => {
  const r = emitUniversalForcePanelRuntime({ enabled: false }, {});
  notCt(r, 'addEventListener');
});

t('emitUniversalForcePanelRuntime: empty kinds → no runtime', () => {
  const r = emitUniversalForcePanelRuntime(
    resolveConfig({ universalForcePanel: { alwaysIncludeKinds: [] } }),
    {}
  );
  notCt(r, 'addEventListener');
});

t('emitUniversalForcePanelRuntime: wires click + sets __FORCE_FEATURE__', () => {
  const r = emitUniversalForcePanelRuntime(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  ct(r, 'addEventListener');
  ct(r, '__FORCE_FEATURE__');
  ct(r, 'onForceFeatureRequested');
});

t('emitUniversalForcePanelRuntime: emits via HookBus.emit', () => {
  const r = emitUniversalForcePanelRuntime(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  ct(r, "HookBus.emit('onForceFeatureRequested'");
});

t('emitUniversalForcePanelRuntime: triggers real spin (runOneBaseSpin)', () => {
  const r = emitUniversalForcePanelRuntime(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  ct(r, 'runOneBaseSpin');
});

t('emitUniversalForcePanelRuntime: legacy FS flag wired for backwards compat', () => {
  const r = emitUniversalForcePanelRuntime(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  ct(r, '__SLOT_DEV_FORCE_FS__');
});

t('emitUniversalForcePanelRuntime: legacy big-win-tier flag wired', () => {
  const r = emitUniversalForcePanelRuntime(defaultConfig(), {});
  // big_win is always-include
  ct(r, '__FORCE_BIG_WIN_TIER__');
});

t('emitUniversalForcePanelRuntime: debounce window = 250ms', () => {
  const r = emitUniversalForcePanelRuntime(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  ct(r, 'DEBOUNCE_MS = 250');
});

t('emitUniversalForcePanelRuntime: aria-busy set + cleared', () => {
  const r = emitUniversalForcePanelRuntime(defaultConfig(), {
    features: [{ kind: 'free_spins' }],
  });
  ct(r, "setAttribute('aria-busy'");
  ct(r, "removeAttribute('aria-busy')");
});

/* ─── Inventory sanity ───────────────────────────────── */
t('KNOWN_KINDS covers ≥ 20 industry kinds', () => {
  ok(KNOWN_KINDS.length >= 20);
});

t('KIND_SHORT + KIND_FULL cover every KNOWN_KINDS entry', () => {
  for (const k of KNOWN_KINDS) {
    ok(KIND_SHORT[k], `KIND_SHORT missing: ${k}`);
    ok(KIND_FULL[k], `KIND_FULL missing: ${k}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
