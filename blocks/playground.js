/* eslint-disable no-console */
/**
 * blocks/playground.js — Wave Z.1 + Z.5 + Z.6
 *
 * Block Playground client. Loads the auto-generated manifest, builds
 * the sidebar (grouped by category, alphabetical inside each group),
 * and renders a per-block detail pane on selection.
 *
 * Z.5 (this version): live HookBus inspector — when this page runs in
 *   a window where `window.HookBus.on(...)` exists (e.g. an embedded
 *   slot or QA harness injecting the playground), the live-demo card
 *   streams every canonical event from the manifest with timestamp +
 *   JSON-serialised payload.
 *
 * Z.6 (this version): localStorage-backed persistence for filter
 *   string + last-selected block + log filter — survives reload.
 *   Plus "Copy JSON" + "Copy defaultConfig" + "Export GDD snippet"
 *   buttons for fast config round-trip into a GDD.
 *
 * Routing — `#<blockName>` URL hash drives state; browser back/forward
 * + deep-link from PR / chat work for free. Defaults to a category-
 * stats welcome screen when no block is selected.
 *
 * Public surface (window.BlockPlayground, used by QA harness):
 *   selectBlock(name)      — programmatically activate a block
 *   getActiveBlock()       — name of active block or null
 *   getManifest()          — raw manifest object
 *   reattachHookBus()      — re-register listeners (idempotent)
 *
 * Vendor-neutral. No external deps. Defensive against malformed
 * manifest entries (missing arrays, null defaultConfig, etc).
 */

(function () {
  'use strict';

  /* ── DOM helpers ──────────────────────────────────────────── */
  const $  = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };

  /* ── State ────────────────────────────────────────────────── */
  const state = {
    manifest: null,
    selected: null,
    filter:   '',
    /* Z.5 — HookBus inspector state */
    busAttached: false,
    eventRows:   [],   /* { ts, name, payload } — capped at 200 */
  };

  /* ── Z.6 — localStorage persistence (defensive on private mode) ── */
  const STORAGE_KEY = 'slot.playground.v1';
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (_) { return {}; }
  }
  function savePrefs(patch) {
    try {
      const prev = loadPrefs();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch (_) { /* private mode / quota — silently ignore */ }
  }

  /* ── Clipboard helper ───────────────────────────────────────── */
  async function copyText(text, btnEl) {
    try {
      await navigator.clipboard.writeText(text);
      if (btnEl) {
        const orig = btnEl.textContent;
        btnEl.textContent = 'Copied ✓';
        setTimeout(() => { btnEl.textContent = orig; }, 1300);
      }
    } catch (e) {
      console.warn('[playground] clipboard write failed:', e);
    }
  }

  /* ── GDD-snippet exporter ────────────────────────────────────
     Given a block + its defaultConfig, emits a small Markdown
     fragment a user can paste into a GDD to opt the block in with
     the current snapshot. Keeps the round-trip ergonomic.        */
  function gddSnippet(block) {
    if (!block || !block.defaultConfig || block.defaultConfig.__error) {
      return `## ${block ? block.name : '(unknown)'}\n\n_(no defaultConfig available)_\n`;
    }
    const safe = JSON.parse(JSON.stringify(block.defaultConfig));
    const yaml = (val, indent = 0) => {
      const pad = '  '.repeat(indent);
      if (val === null || val === undefined) return 'null';
      if (typeof val === 'string')  return JSON.stringify(val);
      if (typeof val === 'number' || typeof val === 'boolean') return String(val);
      if (Array.isArray(val)) {
        if (!val.length) return '[]';
        return val.map(v => `${pad}- ${yaml(v, indent + 1).replace(/^\n/, '')}`).join('\n');
      }
      if (typeof val === 'object') {
        const lines = Object.entries(val).map(([k, v]) => {
          const rendered = yaml(v, indent + 1);
          if (rendered.includes('\n')) return `${pad}${k}:\n${rendered}`;
          return `${pad}${k}: ${rendered}`;
        });
        return lines.join('\n');
      }
      return JSON.stringify(val);
    };
    return [
      `## ${block.name}`,
      '',
      `<!-- ${block.description.replace(/-->/g, '--&gt;')} -->`,
      '',
      '```yaml',
      yaml(safe),
      '```',
      '',
    ].join('\n');
  }

  /* ── Category meta (label + swatch hue) ───────────────────── */
  const CATEGORY_META = {
    engine:          { label: 'Engine',           color: 'var(--cat-engine)'        },
    wild:            { label: 'Wilds',            color: 'var(--cat-wild)'          },
    multiplier:      { label: 'Multipliers',      color: 'var(--cat-multiplier)'    },
    fs:              { label: 'Free Spins',       color: 'var(--cat-fs)'            },
    'round-control': { label: 'Round Control',    color: 'var(--cat-round-control)' },
    evaluator:       { label: 'Evaluators',       color: 'var(--cat-evaluator)'     },
    feature:         { label: 'Features',         color: 'var(--cat-feature)'       },
    ui:              { label: 'UI Surfaces',      color: 'var(--cat-ui)'            },
    audit:           { label: 'Player Protection',color: 'var(--cat-audit)'         },
    uncategorised:   { label: 'Uncategorised',    color: 'var(--cat-uncategorised)' },
  };
  const catMeta = (cat) => CATEGORY_META[cat] || CATEGORY_META.uncategorised;

  /* ── HTML escape (used by JSON viewer + every user-facing string) ── */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Pretty JSON renderer (small, no dep) ─────────────────── */
  function renderJson(v, indent = 0) {
    const pad = '  '.repeat(indent);
    if (v === null) return `<span class="x">null</span>`;
    if (typeof v === 'string')  return `<span class="s">"${esc(v)}"</span>`;
    if (typeof v === 'number')  return `<span class="n">${v}</span>`;
    if (typeof v === 'boolean') return `<span class="b">${v}</span>`;
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const items = v.map((x) => pad + '  ' + renderJson(x, indent + 1));
      return '[\n' + items.join(',\n') + '\n' + pad + ']';
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 0) return '{}';
      const items = keys.map((k) =>
        pad + '  ' + `<span class="k">"${esc(k)}"</span>: ` + renderJson(v[k], indent + 1)
      );
      return '{\n' + items.join(',\n') + '\n' + pad + '}';
    }
    return `<span class="x">${esc(String(v))}</span>`;
  }

  /* ── Sidebar render ───────────────────────────────────────── */
  function renderSidebar() {
    const nav = $('#nav');
    nav.innerHTML = '';
    if (!state.manifest) return;

    const filter = state.filter.trim().toLowerCase();
    const groups = {};
    for (const b of state.manifest.blocks) {
      if (filter && !b.name.toLowerCase().includes(filter)) continue;
      const c = b.category || 'uncategorised';
      (groups[c] = groups[c] || []).push(b);
    }

    const catOrder = Object.keys(CATEGORY_META).concat(
      Object.keys(groups).filter((c) => !CATEGORY_META[c])
    );

    let renderedAny = false;
    for (const cat of catOrder) {
      const items = groups[cat];
      if (!items || items.length === 0) continue;
      renderedAny = true;
      const meta = catMeta(cat);
      const heading = el('div', { class: 'play-side-group', style: `color: ${meta.color}` }, [
        el('span', { class: 'play-side-swatch', 'aria-hidden': 'true' }),
        meta.label,
        ' (' + items.length + ')',
      ]);
      nav.appendChild(heading);

      items.sort((a, b) => a.name.localeCompare(b.name));
      for (const b of items) {
        const emitCount = (b.emittedEvents && b.emittedEvents.length) || 0;
        const item = el('a', {
          class: 'play-side-item' + (state.selected === b.name ? ' active' : ''),
          href:  '#' + encodeURIComponent(b.name),
          'data-block': b.name,
          'aria-current': state.selected === b.name ? 'page' : null,
        }, [
          b.name,
          emitCount > 0 ? el('span', { class: 'play-side-item-emit', title: emitCount + ' emit(s)' }, '↑' + emitCount) : null,
        ]);
        nav.appendChild(item);
      }
    }

    if (!renderedAny) {
      nav.appendChild(el('div', { class: 'play-side-empty', text: filter ? `No blocks match "${filter}"` : 'No blocks indexed.' }));
    }
  }

  /* ── Welcome render ───────────────────────────────────────── */
  function renderWelcome() {
    const main = $('#main');
    main.innerHTML = '';
    const m = state.manifest;
    if (!m) return;

    const grid = el('div', { class: 'play-welcome-grid' });
    const groups = {};
    for (const b of m.blocks) (groups[b.category || 'uncategorised'] = groups[b.category || 'uncategorised'] || 0, groups[b.category || 'uncategorised']++);

    const catOrder = Object.keys(CATEGORY_META).concat(
      Object.keys(groups).filter((c) => !CATEGORY_META[c])
    );

    for (const cat of catOrder) {
      const n = groups[cat];
      if (!n) continue;
      const meta = catMeta(cat);
      grid.appendChild(
        el('div', { class: 'play-welcome-card', style: `color: ${meta.color}` }, [
          el('h3', { text: meta.label }),
          el('div', { class: 'play-welcome-count', text: String(n) }),
          el('p', { text: n === 1 ? '1 block in this group' : `${n} blocks in this group` }),
        ])
      );
    }

    const welcome = el('section', { class: 'play-welcome' }, [
      el('h1', { text: 'Block Playground' }),
      el('p', { class: 'play-lead' }, [
        'Every LEGO block in the template, one click away. Sidebar lists all ',
        el('strong', { text: String(m.totalBlocks) }),
        ' blocks grouped by category. Click a name to inspect its public API, lifecycle contract, and default configuration.',
      ]),
      grid,
      el('footer', { class: 'play-welcome-foot' }, [
        el('span', {}, ['Manifest auto-generated by ', el('code', { text: 'tools/gen-block-manifest.mjs' }), '.']),
        el('span', {}, ['Run ', el('code', { text: 'node tools/gen-block-manifest.mjs --print' }), ' to inspect raw JSON.']),
      ]),
    ]);
    main.appendChild(welcome);
  }

  /* ── Detail render ────────────────────────────────────────── */
  function renderDetail(block) {
    const main = $('#main');
    main.innerHTML = '';
    const meta = catMeta(block.category);

    const head = el('div', { class: 'play-detail-head' }, [
      el('h1', { class: 'play-detail-name', text: block.name }),
      el('span', { class: 'play-detail-cat', style: `color: ${meta.color}`, text: meta.label }),
      el('span', { class: 'play-detail-loc', text: block.loc + ' LOC' }),
    ]);

    const desc = el('p', { class: 'play-detail-desc', text: block.description || '(no description)' });

    /* Public API */
    const exportsTokens = (block.exports || []).map((x) =>
      el('span', { class: 'play-token', text: x })
    );
    const exportsCard = el('section', { class: 'play-card' }, [
      el('h3', { text: 'Public API' }),
      exportsTokens.length
        ? el('div', { class: 'play-tokens' }, exportsTokens)
        : el('div', { class: 'play-card-empty', text: 'No public exports.' }),
    ]);

    /* Lifecycle listeners */
    const listenTokens = (block.lifecycleHooks || []).map((x) =>
      el('span', { class: 'play-token play-token-listen', text: 'on:' + x })
    );
    const listensCard = el('section', { class: 'play-card' }, [
      el('h3', { text: 'Lifecycle Listeners' }),
      listenTokens.length
        ? el('div', { class: 'play-tokens' }, listenTokens)
        : el('div', { class: 'play-card-empty', text: 'No HookBus listeners registered.' }),
    ]);

    /* Emits */
    const emitTokens = (block.emittedEvents || []).map((x) =>
      el('span', { class: 'play-token play-token-emit', text: 'emit:' + x })
    );
    const emitsCard = el('section', { class: 'play-card' }, [
      el('h3', { text: 'Emits' }),
      emitTokens.length
        ? el('div', { class: 'play-tokens' }, emitTokens)
        : el('div', { class: 'play-card-empty', text: 'Read-only — emits no HookBus events.' }),
    ]);

    /* Files */
    const fileRows = [];
    fileRows.push(
      el('a', { href: '../' + block.file, target: '_blank', rel: 'noopener' }, [
        el('span', { class: 'lbl', text: 'src' }),
        block.file,
      ])
    );
    if (block.testFile) {
      fileRows.push(
        el('a', { href: '../' + block.testFile, target: '_blank', rel: 'noopener' }, [
          el('span', { class: 'lbl', text: 'test' }),
          block.testFile,
        ])
      );
    } else {
      fileRows.push(el('div', { class: 'x', text: 'No test file paired.' }));
    }
    const filesCard = el('section', { class: 'play-card' }, [
      el('h3', { text: 'Files' }),
      el('div', { class: 'play-files' }, fileRows),
    ]);

    /* defaultConfig */
    let configBody;
    if (block.defaultConfig && block.defaultConfig.__error) {
      configBody = el('div', { class: 'play-card-empty', text: 'defaultConfig load failed: ' + block.defaultConfig.__error });
    } else if (block.defaultConfig == null) {
      configBody = el('div', { class: 'play-card-empty', text: 'Block exposes no defaultConfig() — wiring-only or stateless.' });
    } else {
      const pre = el('pre', { class: 'play-config' });
      pre.innerHTML = renderJson(block.defaultConfig);
      configBody = pre;
    }
    const configCard = el('section', { class: 'play-card' }, [
      el('h3', { text: 'defaultConfig() Snapshot' }),
      configBody,
    ]);

    /* Z.6 — quick-action buttons (copy block JSON / config / GDD snippet) */
    const actionsCard = el('section', { class: 'play-card' }, [
      el('h3', { text: 'Quick Actions' }),
      el('div', { class: 'play-button-row', style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [
        el('button', {
          class: 'play-btn',
          type:  'button',
          onclick: function () { copyText(JSON.stringify(block, null, 2), this); },
        }, 'Copy block JSON'),
        el('button', {
          class: 'play-btn',
          type:  'button',
          onclick: function () { copyText(JSON.stringify(block.defaultConfig, null, 2), this); },
        }, 'Copy defaultConfig'),
        el('button', {
          class: 'play-btn',
          type:  'button',
          onclick: function () { copyText(gddSnippet(block), this); },
          title: 'Markdown + YAML fragment ready to paste into a GDD',
        }, 'Export GDD snippet'),
      ]),
    ]);

    /* Z.4 — trigger preset library
     *
     * Curated, vendor-neutral list of HookBus event sequences a tester
     * can fire from the playground with one click. Each preset is a
     * sequence (e.g. preSpin → onSpinResult → postSpin) so it can model
     * real round transitions. Pure UI — when no bus is present the
     * presets render but are disabled with a tooltip explaining why.
     *
     * Per-block adaptive presets: if the active block listens on a
     * canonical event NOT covered by the global list, a row is appended
     * so each block always has at least its own event-firing preset.
     */
    const blockSpecific = (block.lifecycleHooks || []).filter(
      (ev) => !TRIGGER_PRESETS.some((p) => p.events.some((e) => e.name === ev))
    ).map((ev) => ({
      id:    'adaptive:' + ev,
      label: ev + ' (adaptive)',
      group: 'Block-specific',
      events: [{ name: ev, payload: {} }],
    }));
    const presetButtons = TRIGGER_PRESETS.concat(blockSpecific).map((preset) =>
      el('button', {
        class: 'play-btn play-btn-preset',
        type:  'button',
        title: preset.events.map((e) => `${e.name}  ${JSON.stringify(e.payload)}`).join('\n'),
        'data-preset-id': preset.id,
        onclick: function () { runPreset(preset, this); },
      }, preset.label)
    );

    /* Z.5 — live HookBus inspector card */
    const liveCard = el('section', { class: 'play-card', style: 'grid-column: 1 / -1;' }, [
      el('h3', {}, [
        'Live HookBus log',
        el('small', { style: 'color: var(--p-fg-3, #8a96aa); font-weight: normal; margin-left: 8px;' },
          ' streams when a HookBus is present on this window'),
      ]),
      el('div', { class: 'play-event-log', id: 'eventLog' }, [
        el('div', { class: 'play-event-empty' }, [
          'No ', el('code', { text: 'window.HookBus' }), ' detected on this page. ',
          'Embed this playground inside a built slot tab (or inject the bus) to stream events.',
        ]),
      ]),
      el('div', { class: 'play-button-row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;' }, [
        el('button', { class: 'play-btn', type: 'button', onclick: () => attachHookBus() }, 'Re-attach HookBus'),
        el('button', { class: 'play-btn', type: 'button', onclick: () => {
          state.eventRows = [];
          const log = $('#eventLog');
          if (log) log.innerHTML = '<div class="play-event-empty">Log cleared.</div>';
        } }, 'Clear log'),
        el('button', { class: 'play-btn', type: 'button', onclick: function () {
          copyText(state.eventRows.map(r => `${r.ts}  ${r.name}  ${r.payload}`).join('\n'), this);
        } }, 'Copy log'),
      ]),
      el('h3', { style: 'margin-top:18px;' }, 'Trigger presets'),
      el('p', { style: 'margin: 0 0 8px; color: var(--p-fg-3, #8a96aa); font-size: 11.5px;' },
        'Fire canonical HookBus sequences. Buttons are no-ops without a bus; embed playground inside a slot tab to dispatch live.'),
      el('div', { class: 'play-presets', id: 'presetRow' }, presetButtons),
    ]);

    const grid = el('div', { class: 'play-detail-grid' }, [
      exportsCard, listensCard, emitsCard, filesCard, configCard, actionsCard, liveCard,
    ]);

    main.appendChild(head);
    main.appendChild(desc);
    main.appendChild(grid);
    document.title = block.name + ' · Block Playground';

    /* Z.5 — best-effort attach + replay existing log rows */
    attachHookBus();
    if (state.eventRows.length) replayLog();
  }

  /* ── Z.4 — Trigger preset library ──────────────────────────────
   *
   * Curated, vendor-neutral list of HookBus event sequences. Each
   * preset is a SHORT script (1-3 events) that simulates a real round
   * transition or a specific player intent (slam, skip, bet change,
   * net-loss threshold crossing). Hand-picked from the canonical
   * HOOK_EVENTS set so every preset corresponds to a real lifecycle
   * point.
   *
   * Payload shapes match the JSDoc contracts in `src/blocks/hookBus.mjs`.
   * Adding a new preset = append an entry; the per-block detail panel
   * re-renders the button row each time you select a block.
   *
   * When the active block listens on a canonical event NOT covered
   * here, an "adaptive" row is appended automatically so every block
   * always has at least its own event-firing preset. */
  const TRIGGER_PRESETS = Object.freeze([
    { id: 'preSpinBase',    label: '▶ preSpin (base)',     events: [{ name: 'preSpin', payload: { duringFs: false } }] },
    { id: 'preSpinFs',      label: '▶ preSpin (FS)',       events: [{ name: 'preSpin', payload: { duringFs: true  } }] },
    { id: 'onSpinResult',   label: '⊙ onSpinResult',       events: [{ name: 'onSpinResult', payload: { duringFs: false } }] },
    { id: 'tumbleChain3',   label: '↻ tumbleStep ×3',      events: [
      { name: 'onTumbleStep', payload: { duringFs: false, chainIndex: 0, events: [{ symbol: 'A', ways: 5 }] } },
      { name: 'onTumbleStep', payload: { duringFs: false, chainIndex: 1, events: [{ symbol: 'B', ways: 4 }] } },
      { name: 'onTumbleStep', payload: { duringFs: false, chainIndex: 2, events: [{ symbol: 'C', ways: 3 }] } },
    ]},
    { id: 'postSpinNoWin',  label: '■ postSpin (no win)',  events: [{ name: 'postSpin', payload: { duringFs: false } }] },
    { id: 'fsTrigger10',    label: '✦ onFsTrigger (10 spins)', events: [{ name: 'onFsTrigger', payload: { award: 10, scatters: 4 } }] },
    { id: 'fsEnd',          label: '✦ onFsEnd (€500)',     events: [{ name: 'onFsEnd', payload: { totalWin: 500 } }] },
    { id: 'slamRequest',    label: '⏹ onSlamRequested',    events: [{ name: 'onSlamRequested', payload: { phase: 'rotating', source: 'button' } }] },
    { id: 'skipRequest',    label: '⏭ onSkipRequested',    events: [{ name: 'onSkipRequested', payload: { phase: 'rollup', source: 'button' } }] },
    { id: 'winPresent',     label: '★ winPresentation cycle', events: [
      { name: 'onWinPresentationStart', payload: { award: 25, eventCount: 3 } },
      { name: 'onWinPresentationEnd',   payload: { award: 25 } },
    ]},
    { id: 'bigWinMega',     label: '🏆 BigWin MEGA tier',   events: [
      { name: 'onBigWinTierEntered', payload: { tier: 4, x: 250, label: 'MEGA WIN', durationMs: 3000, soundBus: 'mega' } },
      { name: 'onBigWinTierExited',  payload: { tier: 4, reason: 'natural' } },
      { name: 'onBigWinTierEnd',     payload: { tier: 4, x: 250, reason: 'natural' } },
    ]},
    { id: 'betChange',      label: '€ onBetChanged (5.00)', events: [{ name: 'onBetChanged', payload: { newBet: 5.00 } }] },
    { id: 'balanceCredit',  label: '💰 onBalanceChanged (+€10)', events: [{ name: 'onBalanceChanged', payload: { balance: 1010, delta: 10, reason: 'win' } }] },
    { id: 'autoplayStart',  label: '⟳ onAutoplayStart (25)', events: [{ name: 'onAutoplayStart', payload: { remaining: 25, step: 25 } }] },
    { id: 'autoplayTick',   label: '⟳ onAutoplayTick',     events: [{ name: 'onAutoplayTick', payload: { remaining: 24, win: 0 } }] },
    { id: 'netLossAlert',   label: '⚠ onNetThresholdCrossed (alert)', events: [{ name: 'onNetThresholdCrossed', payload: { to: 'alert', direction: 'losing', net: -150 } }] },
    { id: 'realityShown',   label: '🛑 onRealityCheckShown', events: [{ name: 'onRealityCheckShown', payload: { reason: 'timer', netSinceStart: -50 } }] },
    { id: 'turboToggle',    label: '⚡ onTurboToggle (on)',  events: [{ name: 'onTurboToggle', payload: { active: true, source: 'api' } }] },
  ]);

  /* Runs every event in a preset through window.HookBus.emit. When
   * the bus is missing, flashes the button to red briefly and writes
   * a hint to the log. When the bus IS present, each emit lands in
   * the live log automatically via the attached listener. */
  function runPreset(preset, btnEl) {
    const bus = (typeof window !== 'undefined') ? window.HookBus : null;
    if (!bus || typeof bus.emit !== 'function') {
      if (btnEl) {
        const orig = btnEl.textContent;
        btnEl.classList.add('play-btn-warn');
        btnEl.textContent = '⚠ no HookBus';
        setTimeout(() => {
          btnEl.classList.remove('play-btn-warn');
          btnEl.textContent = orig;
        }, 1500);
      }
      return false;
    }
    for (const ev of preset.events) {
      try {
        bus.emit(ev.name, ev.payload);
      } catch (e) {
        console.warn(`[playground] preset "${preset.id}" emit ${ev.name} failed:`, e);
      }
    }
    if (btnEl) {
      const orig = btnEl.textContent;
      btnEl.classList.add('play-btn-ok');
      btnEl.textContent = '✓ Fired (' + preset.events.length + ')';
      setTimeout(() => {
        btnEl.classList.remove('play-btn-ok');
        btnEl.textContent = orig;
      }, 1100);
    }
    return true;
  }

  /* ── Z.5 — HookBus inspector ─────────────────────────────────
     Subscribes to every canonical event in the manifest. When the
     bus is missing (most pages — this is a static viewer), we leave
     the empty-state placeholder visible. When the bus IS present
     (slot tab embedding the playground), every event lands in the
     log card with timestamp + serialised payload. */
  function attachHookBus() {
    const bus = (typeof window !== 'undefined') ? window.HookBus : null;
    if (!bus || typeof bus.on !== 'function') return false;
    if (bus.__playgroundAttached) { state.busAttached = true; return true; }
    bus.__playgroundAttached = true;
    state.busAttached = true;

    if (!state.manifest) return false;
    const events = new Set();
    for (const b of state.manifest.blocks) {
      (b.lifecycleHooks || []).forEach((e) => events.add(e));
      (b.emittedEvents || []).forEach((e) => events.add(e));
    }
    for (const ev of events) {
      try {
        bus.on(ev, (payload) => appendLogRow(ev, payload));
      } catch (e) {
        console.warn(`[playground] HookBus.on(${ev}) failed:`, e);
      }
    }
    return true;
  }

  function appendLogRow(name, payload) {
    let payloadStr;
    try {
      payloadStr = payload === undefined ? '' : JSON.stringify(payload);
    } catch (_) {
      payloadStr = '[unserialisable]';
    }
    const ts = new Date().toISOString().slice(11, 23);
    state.eventRows.push({ ts, name, payload: payloadStr });
    /* cap to last 200 rows — long sessions shouldn't OOM */
    while (state.eventRows.length > 200) state.eventRows.shift();
    /* live DOM append (only if log card is mounted) */
    const log = $('#eventLog');
    if (!log) return;
    const empty = log.querySelector('.play-event-empty');
    if (empty) empty.remove();
    const row = el('div', { class: 'play-event-row' }, [
      el('span', { class: 'ts', text: ts }),
      el('span', {}, [
        el('span', { class: 'name', text: name }),
        el('span', { class: 'payload', text: ' ' + (payloadStr || '') }),
      ]),
    ]);
    log.appendChild(row);
    /* cap visible rows too */
    while (log.children.length > 200) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function replayLog() {
    const log = $('#eventLog');
    if (!log) return;
    log.innerHTML = '';
    for (const r of state.eventRows) {
      const row = el('div', { class: 'play-event-row' }, [
        el('span', { class: 'ts', text: r.ts }),
        el('span', {}, [
          el('span', { class: 'name', text: r.name }),
          el('span', { class: 'payload', text: ' ' + (r.payload || '') }),
        ]),
      ]);
      log.appendChild(row);
    }
    log.scrollTop = log.scrollHeight;
  }

  /* ── Routing ──────────────────────────────────────────────── */
  function applyRoute() {
    const raw  = (location.hash || '').replace(/^#/, '');
    const name = raw ? decodeURIComponent(raw) : '';
    state.selected = name || null;
    renderSidebar();
    if (!state.selected) {
      document.title = 'Block Playground · Slot GDD Factory';
      renderWelcome();
      return;
    }
    const block = state.manifest.blocks.find((b) => b.name === state.selected);
    if (!block) {
      const main = $('#main');
      main.innerHTML = '';
      main.appendChild(el('section', { class: 'play-welcome' }, [
        el('h1', { text: 'Block not found' }),
        el('p', { class: 'play-lead', text: `No block named "${state.selected}" in the manifest.` }),
      ]));
      return;
    }
    renderDetail(block);
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  async function boot() {
    let manifest;
    try {
      const res = await fetch('./_manifest.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      manifest = await res.json();
    } catch (e) {
      $('#main').innerHTML = '';
      $('#main').appendChild(el('section', { class: 'play-welcome' }, [
        el('h1', { text: 'Manifest unavailable' }),
        el('p', { class: 'play-lead' }, [
          'Could not load ',
          el('code', { text: 'blocks/_manifest.json' }),
          '. Run ',
          el('code', { text: 'node tools/gen-block-manifest.mjs' }),
          ' to generate it.',
        ]),
        el('p', { class: 'play-lead', text: 'Error: ' + (e && e.message || e) }),
      ]));
      return;
    }

    state.manifest = manifest;
    $('#meta-count').textContent  = manifest.totalBlocks + ' blocks';
    /* Universe size — distinct event names across all blocks. */
    const allEvents = new Set();
    for (const b of manifest.blocks) {
      (b.lifecycleHooks || []).forEach((e) => allEvents.add(e));
      (b.emittedEvents || []).forEach((e) => allEvents.add(e));
    }
    $('#meta-events').textContent = allEvents.size + ' events';
    const ts = manifest.generatedAt ? new Date(manifest.generatedAt) : null;
    $('#meta-time').textContent   = ts
      ? 'generated ' + ts.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      : 'generated (unknown)';
    const wc = document.getElementById('welcome-count');
    if (wc) wc.textContent = String(manifest.totalBlocks);

    /* Z.6 — restore filter + last block from localStorage */
    const prefs = loadPrefs();
    if (typeof prefs.filter === 'string') state.filter = prefs.filter;

    /* Filter input wiring (with persistence) */
    const input = $('#filter');
    if (state.filter) input.value = state.filter;
    input.addEventListener('input', (ev) => {
      state.filter = ev.target.value || '';
      savePrefs({ filter: state.filter });
      renderSidebar();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        input.value = '';
        state.filter = '';
        savePrefs({ filter: '' });
        renderSidebar();
      }
    });
    $('#clear').addEventListener('click', () => {
      input.value = '';
      state.filter = '';
      savePrefs({ filter: '' });
      input.focus();
      renderSidebar();
    });

    /* Z.6 — if URL hash is empty but we have a remembered block, restore it */
    if (!location.hash && prefs.active && manifest.blocks.some((b) => b.name === prefs.active)) {
      location.hash = '#' + encodeURIComponent(prefs.active);
    }

    window.addEventListener('hashchange', () => {
      applyRoute();
      /* persist the new selection */
      savePrefs({ active: state.selected || null });
    });
    applyRoute();
    /* attach bus best-effort at boot too (in case page is embedded in slot) */
    attachHookBus();
  }

  /* ── Public surface (window.BlockPlayground) ───────────────── */
  window.BlockPlayground = {
    selectBlock: (name) => {
      if (!name) return;
      location.hash = '#' + encodeURIComponent(name);
    },
    getActiveBlock: () => state.selected,
    getManifest:    () => state.manifest,
    reattachHookBus: () => attachHookBus(),
    /* Z.4 — preset access for QA harness + scripted demos */
    listPresets:    () => TRIGGER_PRESETS.map((p) => ({ id: p.id, label: p.label, events: p.events.length })),
    runPreset:      (id) => {
      const p = TRIGGER_PRESETS.find((x) => x.id === id);
      if (!p) return false;
      return runPreset(p, null);
    },
    /* Z.5 — log access for snapshot diffing in tests */
    getEventLog:    () => state.eventRows.slice(),
    clearEventLog:  () => { state.eventRows = []; const log = $('#eventLog'); if (log) log.innerHTML = '<div class="play-event-empty">Log cleared.</div>'; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
