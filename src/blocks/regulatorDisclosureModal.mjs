/**
 * src/blocks/regulatorDisclosureModal.mjs
 *
 * Wave W60 — Universal regulator disclosure modal.
 *
 * The 13 regulator-gate atoms from W58 sweep + W59.H1 (UKGC autoplay
 * disclosure / AGCO RTP transparency / SE play-time / DE pace + state
 * clearing / NL Cruks + cool-off / EU AI Act / FR ANJ / IT ADM / ES
 * DGOJ) each emit a `*Required` HookBus event but leave the modal DOM
 * to the operator's integration layer. This block closes that gap with
 * ONE accessible, queue-aware modal that listens to every disclosure
 * channel and renders a single normalized surface.
 *
 * Why one block (not per-jurisdiction modal):
 *   • LEGO discipline — single composable presenter, not 13 duplicates
 *   • Audit-trail consistency — every disclosure logged via the same
 *     `onRegulatorDisclosureShown` + `onRegulatorDisclosureAcknowledged`
 *     events; cert harness reads ONE event stream
 *   • Queue + serial display — when 4 atoms fire at boot (e.g. UKGC +
 *     AGCO + SE + EU under a UKGC-licensed multi-jurisdiction operator)
 *     the player sees them one at a time, not stacked overlays
 *   • Reduced-motion + ARIA dialog + focus trap baseline
 *
 * Listened events (all `*Required` + `*Enforced` + `*Prohibited` flavors):
 *
 *   UKGC autoplay      onAutoplayDisclosureRequired (W58.J-UKGC)
 *   AGCO/UKGC RTP      onRtpDisclosureRequired      (W58.J-AGCO)
 *   SE play-time HUD   onPlayTimeDisplayRequired    (W58.J-SE)
 *   DE pace + state    onMinSpinPaceEnforced        (W58.J-DE)
 *                      onGameStateCleared           (W58.J-DE)
 *                      onIndexedDbCleared           (W58.J-DE.3b)
 *   NL Cruks + cool-off onCruksCheckRequired        (W58.J-NL)
 *                      onCoolOffEnforced            (W58.J-NL)
 *                      onCoolOffPeriodActive        (W58.J-NL.3)
 *   EU AI Act          onAiActDdaProhibited         (W58.J-EU)
 *                      onAiSystemDeclarationRequired(W58.J-EU)
 *   FR ANJ             onFrjCheckRequired           (W58.J-FR)
 *   IT ADM             onRuaCheckRequired           (W58.J-IT)
 *   Generic            onAutoplayBanned             (FR/IT/ES)
 *                      onTurboBanned                (FR/IT)
 *                      onMinSpinDurationEnforced    (FR/IT/ES)
 *                      onMandatoryRealityCheckIntervalEnforced (IT/ES)
 *
 * Emitted events (sole-owner):
 *   onRegulatorDisclosureShown        { kind, jurisdiction, rule, payload, queueDepth }
 *   onRegulatorDisclosureAcknowledged { kind, jurisdiction, ackedAt, queueDepth }
 *
 * GDD config (model.regulatorDisclosureModal):
 *   enabled         boolean (default true)
 *   queueIntervalMs number  (default 250) — delay between sequential
 *                   disclosures so the modal animations don't stutter
 *   color           'r,g,b' (default '255,170,80' amber — UKGC LCCP
 *                   "soft alert" tonality, NOT red which connotes loss)
 *   ackButtonLabel  string  (default 'I UNDERSTAND')
 *
 * Vendor-neutral. Math-blind. Reduced-motion aware. SSR-safe (no-op
 * when window/HookBus absent).
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  queueIntervalMs: 250,
  color: '255,170,80',
  ackButtonLabel: 'I UNDERSTAND',
});

/* Maps each listened event name to a kind label + jurisdiction extractor
 * + rule extractor. Single source of truth so we never branch on
 * `eventName === 'onRtpDisclosureRequired' ? ...` inline. */
const DISCLOSURE_MAP = Object.freeze({
  /* — UKGC / AGCO / SE / DE / NL / EU ----------------------------------- */
  onAutoplayDisclosureRequired:   { kind: 'autoplay-disclosure',     ruleKey: 'UKGC-LCCP-1.4.6' },
  onRtpDisclosureRequired:        { kind: 'rtp-transparency',        ruleKey: 'ON-AGCO-4.06' },
  onPlayTimeDisplayRequired:      { kind: 'play-time-hud',           ruleKey: 'SE-SIFS-2018:6-7.2' },
  onMinSpinPaceEnforced:          { kind: 'spin-pace-enforced',      ruleKey: 'DE-GluStV-§11(2)' },
  onGameStateCleared:             { kind: 'game-state-cleared',      ruleKey: 'DE-GluStV-§6e' },
  onIndexedDbCleared:             { kind: 'indexeddb-cleared',       ruleKey: 'DE-GluStV-§6e' },
  onCruksCheckRequired:           { kind: 'cruks-check',             ruleKey: 'NL-WetKSA-§31' },
  onCoolOffEnforced:              { kind: 'cool-off-enforced',       ruleKey: 'NL-WetKSA-§33' },
  onCoolOffPeriodActive:          { kind: 'cool-off-active',         ruleKey: 'NL-WetKSA-§33' },
  onAiActDdaProhibited:           { kind: 'ai-act-dda-prohibited',   ruleKey: 'EU-AIAct-2024/1689-Art.5(1)(b)' },
  onAiSystemDeclarationRequired:  { kind: 'ai-act-declaration',      ruleKey: 'EU-AIAct-2024/1689-Art.50(1)' },
  /* — FR / IT / ES ------------------------------------------------------- */
  onFrjCheckRequired:             { kind: 'frj-check',               ruleKey: 'FR-ANJ-2019-Art.21' },
  onRuaCheckRequired:             { kind: 'rua-check',               ruleKey: 'IT-ADM-Decreto-Dignita' },
  onAutoplayBanned:               { kind: 'autoplay-banned',         ruleKey: 'FR/IT/ES-Autoplay-Ban' },
  onTurboBanned:                  { kind: 'turbo-banned',            ruleKey: 'FR/IT-Turbo-Ban' },
  onMinSpinDurationEnforced:      { kind: 'min-spin-duration',       ruleKey: 'FR/IT/ES-Spin-Pace' },
  onMandatoryRealityCheckIntervalEnforced: { kind: 'mandatory-rc',   ruleKey: 'IT/ES-RC-Interval' },
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.regulatorDisclosureModal) || {};
  if (m.enabled === false) cfg.enabled = false;
  if (Number.isFinite(m.queueIntervalMs) && m.queueIntervalMs >= 0 && m.queueIntervalMs <= 5000) {
    cfg.queueIntervalMs = Math.floor(m.queueIntervalMs);
  }
  if (typeof m.color === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m.color)) {
    cfg.color = m.color.replace(/\s+/g, '');
  }
  if (typeof m.ackButtonLabel === 'string' && m.ackButtonLabel.length > 0 && m.ackButtonLabel.length <= 32) {
    cfg.ackButtonLabel = m.ackButtonLabel;
  }
  return cfg;
}

function _escape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function emitRegulatorDisclosureModalCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── Regulator disclosure modal (W60) ──────────────────────────── */
#regDisclosureModal {
  position: fixed; inset: 0; z-index: 95;
  display: none;
  align-items: center; justify-content: center;
  background: radial-gradient(circle, rgba(0,0,0,.6), rgba(0,0,0,.85));
  backdrop-filter: blur(4px);
  padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0)
           env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
}
#regDisclosureModal[data-show="true"] {
  display: flex;
  animation: rdmFade 240ms ease-out;
}
#regDisclosureModal .rdm-card {
  max-width: min(520px, 92vw);
  background: linear-gradient(180deg, rgba(${cfg.color},.12), rgba(${cfg.color},.04));
  border: 2px solid rgba(${cfg.color},.7);
  border-radius: 16px;
  padding: 1.5rem 1.4rem 1.2rem;
  color: #fff;
  box-shadow: 0 10px 40px rgba(0,0,0,.55), 0 0 50px rgba(${cfg.color},.25);
}
#regDisclosureModal .rdm-kind {
  font-size: .72rem; font-weight: 700; letter-spacing: .14em;
  color: rgba(${cfg.color},1); text-transform: uppercase;
}
#regDisclosureModal .rdm-rule {
  font-size: .68rem; font-weight: 600; letter-spacing: .08em;
  color: rgba(255,255,255,.72); margin-top: 3px;
}
#regDisclosureModal .rdm-jurisdiction {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  background: rgba(${cfg.color},.18); color: rgba(${cfg.color},1);
  font-size: .68rem; font-weight: 700; letter-spacing: .12em;
  margin-top: 8px;
}
#regDisclosureModal .rdm-body {
  margin: .9rem 0 1.1rem; font-size: .92rem; line-height: 1.45;
  color: rgba(255,255,255,.92);
}
#regDisclosureModal .rdm-payload {
  display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px;
  font-size: .78rem; color: rgba(255,255,255,.78);
  margin-top: .6rem;
}
#regDisclosureModal .rdm-payload dt {
  font-weight: 700; color: rgba(${cfg.color},.95); letter-spacing: .04em;
}
#regDisclosureModal .rdm-payload dd { margin: 0; font-variant-numeric: tabular-nums; }
#regDisclosureModal .rdm-ack {
  display: block; width: 100%;
  min-height: 44px;          /* WCAG SC 2.5.5 touch target */
  padding: .65rem 1rem;
  background: linear-gradient(180deg, rgba(${cfg.color},.95), rgba(${cfg.color},.75));
  color: #1a1408; border: none; border-radius: 10px;
  font-size: .9rem; font-weight: 900; letter-spacing: .14em;
  cursor: pointer; text-transform: uppercase;
  transition: transform .12s, box-shadow .12s;
}
#regDisclosureModal .rdm-ack:focus-visible {
  outline: 3px solid rgba(255,255,255,.9); outline-offset: 2px;
}
#regDisclosureModal .rdm-ack:hover  { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(${cfg.color},.45); }
#regDisclosureModal .rdm-ack:active { transform: translateY(0); }
#regDisclosureModal .rdm-queue {
  margin-top: .65rem; text-align: center;
  font-size: .68rem; color: rgba(255,255,255,.55); letter-spacing: .08em;
}
@keyframes rdmFade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  #regDisclosureModal[data-show="true"] { animation: none !important; }
}
@media (max-width: 620px) {
  #regDisclosureModal .rdm-card { padding: 1.1rem 1rem; }
  #regDisclosureModal .rdm-body { font-size: .84rem; }
}
`;
}

export function emitRegulatorDisclosureModalMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="regDisclosureModal" data-show="false" role="dialog"
     aria-modal="true" aria-labelledby="rdmKind" aria-describedby="rdmBody">
  <div class="rdm-card">
    <div class="rdm-kind" id="rdmKind">—</div>
    <div class="rdm-rule" id="rdmRule">—</div>
    <span class="rdm-jurisdiction" id="rdmJurisdiction" hidden></span>
    <div class="rdm-body" id="rdmBody">—</div>
    <dl class="rdm-payload" id="rdmPayload" hidden></dl>
    <button class="rdm-ack" id="rdmAck" type="button">${_escape(cfg.ackButtonLabel)}</button>
    <div class="rdm-queue" id="rdmQueue" hidden></div>
  </div>
</div>`;
}

export function emitRegulatorDisclosureModalRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* regulatorDisclosureModal: disabled */`;
  /* The DISCLOSURE_MAP is duplicated into the runtime so the client
   * doesn't import server-side modules. Single source of truth via
   * literal interpolation — drift impossible if the map adds a row. */
  return `
  /* ── Regulator disclosure modal (W60) — emitted by src/blocks/regulatorDisclosureModal.mjs ── */
  (function () {
    if (typeof window === 'undefined') return;

    var QUEUE_INTERVAL_MS = ${cfg.queueIntervalMs};
    var DISCLOSURE_MAP = ${JSON.stringify(Object.fromEntries(
      Object.entries(DISCLOSURE_MAP).map(([k, v]) => [k, { kind: v.kind, ruleKey: v.ruleKey }])
    ))};

    var queue = [];
    var processing = false;
    var currentDisclosure = null;
    var lastAck = null;
    var __cnt = { shown: 0, acked: 0 };
    window.__REGULATOR_DISCLOSURE_STATE__ = {
      queueDepth: function () { return queue.length; },
      acks: function ()       { return __cnt.acked; },
      shown: function ()      { return __cnt.shown; },
      lastAck: function ()    { return lastAck; },
    };

    function _setAckWindowFlag(kind) {
      /* Each disclosure kind sets a public ACK flag so consumers
       * (autoplay.autoplayStart guards on __AUTOPLAY_DISCLOSURE_ACK__,
       * future paytable RTP gate, etc.) can resume. */
      try {
        if (kind === 'autoplay-disclosure')     window.__AUTOPLAY_DISCLOSURE_ACK__       = true;
        if (kind === 'rtp-transparency')        window.__RTP_DISCLOSURE_ACK__            = true;
        if (kind === 'play-time-hud')           window.__PLAY_TIME_DISPLAY_ACK__         = true;
        if (kind === 'cruks-check')             window.__NL_CRUKS_CHECK_PASSED__         = true;
        if (kind === 'ai-act-declaration')      window.__EU_AI_DECLARATION_ACK__         = true;
        if (kind === 'frj-check')               window.__FR_FRJ_CHECK_PASSED__           = true;
        if (kind === 'rua-check')               window.__IT_RUA_CHECK_PASSED__           = true;
      } catch (_) {}
    }

    function _renderPayload(host, payload) {
      while (host.firstChild) host.removeChild(host.firstChild);
      if (!payload || typeof payload !== 'object') { host.hidden = true; return; }
      var entries = Object.keys(payload).filter(function (k) {
        return k !== 'rule' && k !== 'jurisdiction';
      });
      if (entries.length === 0) { host.hidden = true; return; }
      for (var i = 0; i < entries.length; i++) {
        var k = entries[i]; var v = payload[k];
        if (v === null || v === undefined) v = '—';
        if (typeof v === 'object') {
          try { v = JSON.stringify(v); } catch (_) { v = String(v); }
        }
        var dt = document.createElement('dt'); dt.textContent = k;
        var dd = document.createElement('dd'); dd.textContent = String(v);
        host.appendChild(dt); host.appendChild(dd);
      }
      host.hidden = false;
    }

    function _bodyTextFor(kind, payload) {
      switch (kind) {
        case 'autoplay-disclosure':
          return 'Autoplay must show its stop conditions before it can start. Review them below and acknowledge to continue.';
        case 'rtp-transparency':
          return 'Return-to-player (RTP) is shown for transparency. Acknowledge to begin play.';
        case 'play-time-hud':
          return 'A play-time clock is now visible to help you track your session.';
        case 'spin-pace-enforced':
          return 'A minimum delay between spins is enforced by the local regulator.';
        case 'game-state-cleared':
        case 'indexeddb-cleared':
          return 'Saved local state was cleared in line with the local regulator requirement.';
        case 'cruks-check':
          return 'A self-exclusion register check is required before play. Your operator handles the check.';
        case 'cool-off-enforced':
        case 'cool-off-active':
          return 'A cooling-off period applies. Try again after the period elapses.';
        case 'ai-act-dda-prohibited':
          return 'This game does not use dynamic-difficulty AI personalization. EU AI Act Article 5 transparency.';
        case 'ai-act-declaration':
          return 'EU AI Act transparency: any AI-generated content in this game is declared by the operator.';
        case 'frj-check':
          return 'France: a self-exclusion (FRJ) register check is required before play.';
        case 'rua-check':
          return 'Italy: a self-exclusion (RUA) register check is required before play.';
        case 'autoplay-banned':
          return 'Autoplay is not available in your jurisdiction.';
        case 'turbo-banned':
          return 'Turbo / quick-spin is not available in your jurisdiction.';
        case 'min-spin-duration':
          return 'Each spin must last at least the regulator-mandated minimum.';
        case 'mandatory-rc':
          return 'A mandatory periodic reality check is in effect for your jurisdiction.';
        default:
          return 'Regulator disclosure.';
      }
    }

    var $modal     = function () { return document.getElementById('regDisclosureModal'); };
    var $kind      = function () { return document.getElementById('rdmKind'); };
    var $rule      = function () { return document.getElementById('rdmRule'); };
    var $jur       = function () { return document.getElementById('rdmJurisdiction'); };
    var $body      = function () { return document.getElementById('rdmBody'); };
    var $payload   = function () { return document.getElementById('rdmPayload'); };
    var $ack       = function () { return document.getElementById('rdmAck'); };
    var $queueInfo = function () { return document.getElementById('rdmQueue'); };

    var prevFocus = null;
    function _trapFocus(on) {
      var ack = $ack();
      if (!ack) return;
      if (on) {
        prevFocus = document.activeElement;
        try { ack.focus(); } catch (_) {}
      } else if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (_) {}
        prevFocus = null;
      }
    }

    function _present(item) {
      var modal = $modal(); if (!modal) return;
      var meta = DISCLOSURE_MAP[item.event] || { kind: 'unknown', ruleKey: '' };
      var payload = item.payload || {};
      var ruleStr = payload.rule || meta.ruleKey || '';
      var jurStr  = payload.jurisdiction || '';
      var kindStr = meta.kind || 'unknown';

      $kind().textContent = kindStr.replace(/-/g, ' ');
      $rule().textContent = ruleStr || '—';
      if (jurStr) { $jur().textContent = jurStr; $jur().hidden = false; }
      else        { $jur().hidden = true; }
      $body().textContent = _bodyTextFor(kindStr, payload);
      _renderPayload($payload(), payload);
      if (queue.length > 0) {
        $queueInfo().textContent = '+ ' + queue.length + ' more after this';
        $queueInfo().hidden = false;
      } else {
        $queueInfo().hidden = true;
      }
      currentDisclosure = { kind: kindStr, jurisdiction: jurStr };
      modal.dataset.show = 'true';
      _trapFocus(true);
      __cnt.shown += 1;
      try {
        window.HookBus && window.HookBus.emit && window.HookBus.emit('onRegulatorDisclosureShown', {
          kind: kindStr,
          jurisdiction: jurStr,
          rule: ruleStr,
          payload: payload,
          queueDepth: queue.length,
        });
      } catch (_) {}
    }

    function _dequeue() {
      if (processing) return;
      var next = queue.shift();
      if (!next) return;
      processing = true;
      _present(next);
    }

    function _ack() {
      var modal = $modal(); if (!modal) return;
      var current = lastAck = {
        kind: $kind().textContent,
        jurisdiction: $jur().hidden ? '' : $jur().textContent,
        ackedAt: Date.now(),
      };
      _setAckWindowFlag(current.kind.replace(/\\s+/g, '-'));
      modal.dataset.show = 'false';
      currentDisclosure = null;
      _trapFocus(false);
      __cnt.acked += 1;
      try {
        window.HookBus && window.HookBus.emit && window.HookBus.emit('onRegulatorDisclosureAcknowledged', {
          kind: current.kind,
          jurisdiction: current.jurisdiction,
          ackedAt: current.ackedAt,
          queueDepth: queue.length,
        });
      } catch (_) {}
      processing = false;
      if (queue.length > 0) {
        setTimeout(_dequeue, QUEUE_INTERVAL_MS);
      }
    }

    function _enqueue(eventName, payload) {
      if (!DISCLOSURE_MAP[eventName]) return;
      /* De-dupe rule: if the same kind+jurisdiction is already in the
       * queue OR currently visible, ignore the duplicate so a re-fired
       * boot event doesn't double-show. */
      var meta = DISCLOSURE_MAP[eventName];
      var jur = (payload && payload.jurisdiction) || '';
      /* De-dupe against the currently-visible disclosure as well as the
       * pending queue. Otherwise a boot-time re-emit (e.g. SSR rehydrate
       * fires the same event twice) double-queues. */
      if (currentDisclosure &&
          currentDisclosure.kind === meta.kind &&
          currentDisclosure.jurisdiction === jur) {
        return;
      }
      var dupeIdx = -1;
      for (var i = 0; i < queue.length; i++) {
        var q = queue[i];
        var qm = DISCLOSURE_MAP[q.event] || {};
        if (qm.kind === meta.kind && ((q.payload && q.payload.jurisdiction) || '') === jur) {
          dupeIdx = i; break;
        }
      }
      if (dupeIdx !== -1) return;
      queue.push({ event: eventName, payload: payload || {} });
      _dequeue();
    }

    function _wireBus() {
      if (!window.HookBus || typeof window.HookBus.on !== 'function') return false;
      var names = Object.keys(DISCLOSURE_MAP);
      for (var i = 0; i < names.length; i++) {
        (function (n) {
          window.HookBus.on(n, function (p) { _enqueue(n, p); });
        })(names[i]);
      }
      return true;
    }

    function _wireDom() {
      var ack = $ack();
      if (ack) {
        ack.addEventListener('click', _ack);
        ack.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _ack(); }
        });
      }
    }

    function _boot() {
      _wireDom();
      if (!_wireBus()) {
        /* Late-binding: HookBus not ready at IIFE eval — retry once
         * microtask + once at DOMContentLoaded. */
        if (typeof Promise !== 'undefined') Promise.resolve().then(_wireBus);
        if (typeof document !== 'undefined' && document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', _wireBus, { once: true });
        } else if (typeof setTimeout === 'function') {
          setTimeout(_wireBus, 0);
        }
      }
    }

    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _boot, { once: true });
    } else {
      _boot();
    }
  })();
`;
}
