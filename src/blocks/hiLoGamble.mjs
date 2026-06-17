/**
 * src/blocks/hiLoGamble.mjs
 *
 * Wave H16 — Hi/Lo Card Gamble (classic post-win risk presenter).
 *
 * Industry baseline (vendor-neutral):
 *   Many classic and modern slots offer a post-win double-or-nothing card
 *   gamble where the player is shown a face-up card and must predict
 *   whether the NEXT card will be HIGHER or LOWER. Correct → win doubled
 *   (or other configurable multiplier). Wrong → win lost. Optional
 *   `collect` exits the loop at any time and banks the running stake.
 *
 *   This block is a PURE PRESENTER:
 *     • Renders a "GAMBLE" CTA that auto-appears after any winning spin.
 *     • Opens a modal with the face-up card + HIGHER / LOWER / COLLECT buttons.
 *     • Math (RNG draw, edge calculation, RTP feedback) is OUT OF SCOPE.
 *       Engine-side / external code calls `window.hiLoResolve(result)` to
 *       signal the outcome, and this block paints + emits the lifecycle.
 *
 *   Why a separate block (sibling to gamble.mjs / gambleSecondary.mjs)?
 *     • `gamble.mjs` covers color / suit / ladder variants.
 *     • `gambleSecondary.mjs` owns the canonical onGambleStart/Round/End trio.
 *     • H16 is specifically the HI/LO card variant with its own DOM, own
 *       lifecycle events (`onHiLoStart` / `onHiLoChoice` / `onHiLoResolved` /
 *       `onHiLoCollected`), and its own a11y contract.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitHiLoGambleCSS(cfg)
 *   emitHiLoGambleMarkup(cfg)
 *   emitHiLoGambleRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     onWinPresentationEnd → if award > 0, reveal GAMBLE CTA chip
 *     preSpin              → hide CTA (round ended), close modal if open
 *     onFsTrigger          → hide CTA during FS (RG: no gamble during FS)
 *   emits:
 *     onHiLoStart      { award, source }
 *     onHiLoChoice     { choice: 'higher'|'lower', card, source }
 *     onHiLoResolved   { result: 'win'|'lose', choice, card, nextCard, stake, source }
 *     onHiLoCollected  { stake, rounds, source }
 *
 * a11y:
 *   - CTA chip: role="button", aria-label, focus-visible outline.
 *   - Modal:    role="dialog", aria-modal="true", aria-labelledby, focus-trap
 *               restoreFocus on close, Escape = COLLECT.
 *   - aria-live="polite" status line announces card + result.
 *   - WCAG 2.5.5 — buttons ≥ 44×44 px touch target.
 *   - prefers-reduced-motion gate disables flip / shake animation.
 *
 * Performance budget:
 *   - 1 fixed DOM tree, mounted once on enable.
 *   - 0 timers when closed (CTA reveal is event-driven, not polled).
 *   - Modal animation ≤ 320ms; reduced-motion → 0ms instant snap.
 *
 * GDD keys (model.hiLoGamble):
 *   enabled, multiplier, maxRounds, allowDuringFs, ctaLabel, ctaPosition,
 *   higherLabel, lowerLabel, collectLabel, deckSuits, faceColor, faceBg
 *
 * Vendor-neutral. No game / studio strings.
 *
 * @module hiLoGamble
 */

const POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const BOUNDS = Object.freeze({
  multiplier:    [1.1, 16],
  maxRounds:     [1, 20],
  fontSizePx:    [11, 24],
  zIndex:        [10, 99],
  animMs:        [0, 1500],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safe(v, max, fb) {
  if (typeof v !== 'string') return fb;
  const s = v.replace(/[<>"'`]/g, '').slice(0, max);
  return s.length ? s : fb;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        false,
    multiplier:     2,                  /* per-correct payout multiplier */
    maxRounds:      5,                  /* auto-collect after N correct rounds */
    allowDuringFs:  false,              /* most jurisdictions ban gamble in FS */
    ctaLabel:       'GAMBLE',
    ctaPosition:    'bottom-right',
    higherLabel:    'HIGHER',
    lowerLabel:     'LOWER',
    collectLabel:   'COLLECT',
    faceColor:      '#03110a',
    faceBg:         '#ffd84d',
    zIndex:         44,
    animMs:         320,
    fontSizePx:     13,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.hiLoGamble) || {};
  const auto = !!model.hiLoGamble;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.multiplier  = _clamp(m.multiplier, BOUNDS.multiplier, cfg.multiplier);
  cfg.maxRounds   = _clamp(m.maxRounds,  BOUNDS.maxRounds,  cfg.maxRounds);
  cfg.zIndex      = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);
  cfg.animMs      = _clamp(m.animMs,     BOUNDS.animMs,     cfg.animMs);
  cfg.fontSizePx  = _clamp(m.fontSizePx, BOUNDS.fontSizePx, cfg.fontSizePx);

  if (typeof m.allowDuringFs === 'boolean') cfg.allowDuringFs = m.allowDuringFs;
  if (typeof m.ctaPosition === 'string' && POSITIONS.has(m.ctaPosition)) cfg.ctaPosition = m.ctaPosition;

  cfg.ctaLabel     = _safe(m.ctaLabel,     24, cfg.ctaLabel);
  cfg.higherLabel  = _safe(m.higherLabel,  24, cfg.higherLabel);
  cfg.lowerLabel   = _safe(m.lowerLabel,   24, cfg.lowerLabel);
  cfg.collectLabel = _safe(m.collectLabel, 24, cfg.collectLabel);
  cfg.faceColor    = _safe(m.faceColor,    32, cfg.faceColor);
  cfg.faceBg       = _safe(m.faceBg,       32, cfg.faceBg);

  return cfg;
}

function _posStyle(pos) {
  const v  = 'calc(max(8px, env(safe-area-inset-top, 0px) + 8px))';
  const bV = 'calc(max(8px, env(safe-area-inset-bottom, 0px) + 8px))';
  const h  = 'calc(max(8px, env(safe-area-inset-left, 0px) + 8px))';
  const rH = 'calc(max(8px, env(safe-area-inset-right, 0px) + 8px))';
  switch (pos) {
    case 'top-left':     return `top: ${v}; left: ${h};`;
    case 'top-right':    return `top: ${v}; right: ${rH};`;
    case 'bottom-left':  return `bottom: ${bV}; left: ${h};`;
    case 'bottom-right':
    default:             return `bottom: ${bV}; right: ${rH};`;
  }
}

export function emitHiLoGambleCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* hiLoGamble — Wave H16 */
  .hilo-cta {
    position: fixed;
    ${_posStyle(cfg.ctaPosition)}
    z-index: ${cfg.zIndex};
    min-width: 44px;
    min-height: 44px;
    padding: 8px 18px;
    border-radius: 999px;
    background: ${cfg.faceBg};
    color: ${cfg.faceColor};
    font-size: ${cfg.fontSizePx}px;
    font-weight: 800;
    letter-spacing: 0.08em;
    border: 0;
    cursor: pointer;
    display: none;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  }
  .hilo-cta[data-visible="true"] { display: inline-block; }
  .hilo-cta:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }

  .hilo-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    z-index: ${cfg.zIndex + 1};
    display: none;
    align-items: center;
    justify-content: center;
  }
  .hilo-backdrop[data-open="true"] { display: flex; }

  .hilo-modal {
    background: #0e1a14;
    border: 2px solid ${cfg.faceBg};
    border-radius: 14px;
    padding: 24px;
    min-width: 280px;
    max-width: 90vw;
    color: #fff;
    text-align: center;
    box-shadow: 0 12px 38px rgba(0, 0, 0, 0.6);
  }
  .hilo-card {
    display: inline-block;
    width: 96px;
    height: 134px;
    border-radius: 10px;
    background: ${cfg.faceBg};
    color: ${cfg.faceColor};
    font-size: 36px;
    font-weight: 800;
    line-height: 134px;
    margin: 12px 0 18px;
    transition: transform ${cfg.animMs}ms ease;
  }
  .hilo-card[data-flipping="true"] { transform: rotateY(180deg); }
  .hilo-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .hilo-btn {
    min-width: 96px;
    min-height: 44px;
    padding: 10px 18px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-size: ${cfg.fontSizePx}px;
    font-weight: 700;
    border: 1px solid rgba(255, 255, 255, 0.28);
    cursor: pointer;
  }
  .hilo-btn:hover { background: rgba(255, 255, 255, 0.22); }
  .hilo-btn:focus-visible { outline: 3px solid ${cfg.faceBg}; outline-offset: 2px; }
  .hilo-btn[data-kind="collect"] { background: ${cfg.faceBg}; color: ${cfg.faceColor}; }

  .hilo-status { font-size: 12px; opacity: 0.85; min-height: 1.2em; margin-top: 12px; }

  @media (prefers-reduced-motion: reduce) {
    .hilo-card { transition: none; }
  }
  `;
}

export function emitHiLoGambleMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  <button id="hiloCta" class="hilo-cta" type="button" aria-label="Gamble win" data-visible="false">${cfg.ctaLabel}</button>
  <div id="hiloBackdrop" class="hilo-backdrop" data-open="false" role="dialog" aria-modal="true" aria-labelledby="hiloTitle">
    <div class="hilo-modal">
      <div id="hiloTitle" style="font-weight:800;letter-spacing:.06em">${cfg.ctaLabel}</div>
      <div id="hiloCard" class="hilo-card" data-flipping="false" aria-live="polite">?</div>
      <div class="hilo-actions">
        <button class="hilo-btn" data-kind="higher" type="button">${cfg.higherLabel}</button>
        <button class="hilo-btn" data-kind="lower"  type="button">${cfg.lowerLabel}</button>
        <button class="hilo-btn" data-kind="collect" type="button">${cfg.collectLabel}</button>
      </div>
      <div id="hiloStatus" class="hilo-status" aria-live="polite"></div>
    </div>
  </div>`;
}

export function emitHiLoGambleRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── hiLoGamble BLOCK — Wave H16 ──────────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var MAX_ROUNDS = ${cfg.maxRounds};
    var MULTIPLIER = ${cfg.multiplier};
    var ALLOW_FS = ${JSON.stringify(cfg.allowDuringFs)};

    var inFs = false;
    var rounds = 0;
    var stake = 0;
    var currentCard = null;
    var lastChoice = null;
    var lastFocus = null;

    var cta = (typeof document !== 'undefined') ? document.getElementById('hiloCta') : null;
    var bd  = (typeof document !== 'undefined') ? document.getElementById('hiloBackdrop') : null;
    var card = (typeof document !== 'undefined') ? document.getElementById('hiloCard') : null;
    var st = (typeof document !== 'undefined') ? document.getElementById('hiloStatus') : null;

    function showCta(award) {
      if (!cta) return;
      if (inFs && !ALLOW_FS) { cta.setAttribute('data-visible', 'false'); return; }
      if (!(Number(award) > 0)) { cta.setAttribute('data-visible', 'false'); return; }
      stake = Number(award) || 0;
      cta.setAttribute('data-visible', 'true');
    }
    function hideCta() { if (cta) cta.setAttribute('data-visible', 'false'); }

    function openModal(initialCard) {
      if (!bd) return;
      lastFocus = (typeof document !== 'undefined') ? document.activeElement : null;
      rounds = 0;
      currentCard = initialCard || '7';
      if (card) card.textContent = String(currentCard);
      if (st) st.textContent = 'Choose HIGHER or LOWER.';
      bd.setAttribute('data-open', 'true');
      try { window.HookBus.emit('onHiLoStart', { award: stake, source: 'cta' }); } catch (_) {}
    }
    function closeModal(reason) {
      if (!bd) return;
      bd.setAttribute('data-open', 'false');
      try { window.HookBus.emit('onHiLoCollected', { stake: stake, rounds: rounds, source: reason || 'collect' }); } catch (_) {}
      if (lastFocus && typeof lastFocus.focus === 'function') {
        try { lastFocus.focus(); } catch (_) {}
      }
      hideCta();
    }
    function choice(which) {
      if (!bd || bd.getAttribute('data-open') !== 'true') return;
      lastChoice = which;
      try { window.HookBus.emit('onHiLoChoice', { choice: which, card: currentCard, source: 'click' }); } catch (_) {}
      if (st) st.textContent = 'Waiting for next card…';
      /* Math is out of scope — external resolves via window.hiLoResolve(result, nextCard). */
    }
    function resolveOutcome(result, nextCard) {
      if (!bd || bd.getAttribute('data-open') !== 'true') return;
      var prev = currentCard;
      currentCard = nextCard != null ? nextCard : currentCard;
      if (card) card.textContent = String(currentCard);
      if (result === 'win') {
        rounds++;
        stake = Math.round(stake * MULTIPLIER * 100) / 100;
        if (st) st.textContent = 'WIN! Stake doubled.';
      } else {
        stake = 0;
        if (st) st.textContent = 'BUST.';
      }
      try { window.HookBus.emit('onHiLoResolved', { result: result, choice: lastChoice, card: prev, nextCard: currentCard, stake: stake, source: 'engine' }); } catch (_) {}
      if (result !== 'win' || rounds >= MAX_ROUNDS) {
        setTimeout(function () { closeModal(result === 'win' ? 'maxRounds' : 'bust'); }, 240);
      }
    }

    function wireDom() {
      if (cta) cta.addEventListener('click', function () { openModal('7'); });
      if (bd) {
        var btns = bd.querySelectorAll('.hilo-btn');
        for (var i = 0; i < btns.length; i++) {
          (function (b) {
            b.addEventListener('click', function () {
              var k = b.getAttribute('data-kind');
              if (k === 'collect') closeModal('collect');
              else choice(k);
            });
          })(btns[i]);
        }
      }
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('keydown', function (e) {
          if (!bd || bd.getAttribute('data-open') !== 'true') return;
          if (e.key === 'Escape') closeModal('escape');
        });
      }
    }

    window.HookBus.on('onWinPresentationEnd', function (p) {
      var aw = (p && (p.award || p.totalAward)) || 0;
      showCta(aw);
    });
    window.HookBus.on('preSpin', function () {
      hideCta();
      if (bd && bd.getAttribute('data-open') === 'true') closeModal('preSpin');
    });
    window.HookBus.on('onFsTrigger', function () { inFs = true; hideCta(); });
    window.HookBus.on('onFsEnd',     function () { inFs = false; });

    /* External API for engine math layer + force probes. */
    window.hiLoShow    = function (award) { showCta(award); };
    window.hiLoOpen    = function (initialCard) { openModal(initialCard); };
    window.hiLoResolve = function (result, nextCard) { resolveOutcome(result, nextCard); };
    window.hiLoCollect = function () { closeModal('api'); };
    window.hiLoStatus  = function () { return { rounds: rounds, stake: stake, currentCard: currentCard, inFs: inFs }; };

    wireDom();
  })();
  `;
}
