/**
 * src/blocks/plinkoSpinEngine.mjs
 *
 * Wave J3 — Plinko ball-drop animation.
 *
 * Industry-reference rationale
 * ────────────────────────────
 *   Plinko slot fronts drop a single ball through a triangular peg
 *   grid; the ball bounces left/right at each row until it lands in
 *   one of the bottom buckets. Pre-J3 the kind blink-faded with no
 *   ball motion. This block animates the ball as a CSS-transformed
 *   `<div>` traversing the peg grid one row per step.
 *
 * Performance budget: ≤ 16ms/frame during drop animation, ≤ N timers
 * queued, single repaint per row step.
 *
 * Composition contract (LEGO ownership)
 * ────────────────────────────────────
 *   • SOLE OWNER of plinko ball animation. Registers
 *     window.__SLOT_KIND_RUNSPIN__.plinko.
 *   • Reads: SHAPE.columns (per-row peg counts), HookBus.
 *   • Owns: a single `.plinko-ball` element created lazily on first
 *     spin and re-positioned via CSS transform.
 *
 * Lifecycle
 * ─────────
 *   preSpin → cancel pending drop timer + hide ball before next drop.
 *
 * Vendor neutrality
 * ─────────────────
 *   Zero vendor mentions.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitPlinkoSpinEngineCSS(cfg)
 *   emitPlinkoSpinEngineRuntime(cfg)
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  rowStepMs: 110,           /* per-row drop tempo */
  finalSettleMs: 240,       /* bucket land bounce */
  fadeFallbackMs: 200,
  ballPx: 14,               /* ball diameter in pixels */
  opacityMs: 80,            /* opacity transition duration */
  minStepMs: 20,            /* minimum step duration under turbo */
  minSettleMs: 40,          /* minimum settle duration under turbo */
  walkBias: 0.5,            /* probability bias toward target bucket */
});

export function defaultConfig() { return { ...DEFAULTS }; }

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.plinkoSpinEngine) || {};
  const intMap = [
    ['rowStepMs',       40,  500],
    ['finalSettleMs',   60,  800],
    ['fadeFallbackMs',  40,  800],
  ];
  for (const [k, lo, hi] of intMap) {
    const v = clampInt(src[k], lo, hi);
    if (v !== null) cfg[k] = v;
  }
  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;
  return cfg;
}

/* ── Emit ─────────────────────────────────────────────────────── */

export function emitPlinkoSpinEngineCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ── Plinko spin engine (Wave J3) ───────────────────────────── */
.grid-plinko { position: relative; }
.plinko-ball {
  position: absolute;
  width: ${cfg.ballPx}px;
  height: ${cfg.ballPx}px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffea84, #c9a227);
  box-shadow: 0 0 8px rgba(201, 162, 39, 0.5);
  pointer-events: none;
  will-change: transform, opacity;
  opacity: 0;
  transition: transform ${cfg.rowStepMs}ms cubic-bezier(0.5, 0, 0.6, 1), opacity ${cfg.opacityMs}ms ease;
  z-index: 10;
}
.plinko-ball.is-armed { opacity: 1; }
.plinko-ball.is-landed {
  transition: transform ${cfg.finalSettleMs}ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@media (prefers-reduced-motion: reduce) {
  .plinko-ball { transition: opacity ${cfg.fadeFallbackMs}ms ease !important; }
}
`;
}

export function emitPlinkoSpinEngineRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const STEP_MS      = cfg.rowStepMs;
  const SETTLE_MS    = cfg.finalSettleMs;
  const BALL_PX      = cfg.ballPx;
  const OPACITY_MS   = cfg.opacityMs;
  const MIN_STEP_MS  = cfg.minStepMs;
  const MIN_SETTLE_MS = cfg.minSettleMs;
  const WALK_BIAS    = cfg.walkBias;
  return `
  /* ── Plinko spin runtime (Wave J3) ─────────────────────────── */
  (function () {
    if (!SHAPE || SHAPE.kind !== 'plinko') return;
    window.__SLOT_KIND_RUNSPIN__ = window.__SLOT_KIND_RUNSPIN__ || {};

    var STATE = { dropping: false, dropTimers: [], pending: null };
    Object.defineProperty(window, '__SLOT_PLINKO_STATE__', {
      configurable: true,
      get: function () { return STATE; },
    });

    function _resolveBoard() {
      return document.querySelector('.grid-plinko');
    }

    function _ensureBall(board) {
      var ball = board.querySelector('.plinko-ball');
      if (ball) return ball;
      ball = document.createElement('div');
      ball.className = 'plinko-ball';
      board.appendChild(ball);
      return ball;
    }

    /** Pick a peg position (x, y) for row r given the board geometry. */
    function _pegCenter(board, rowIdx, colIdx) {
      var rows = board.querySelectorAll('.plinko-row');
      if (!rows[rowIdx]) return { x: 0, y: 0 };
      var pegs = rows[rowIdx].querySelectorAll('.peg');
      if (!pegs[colIdx]) return { x: 0, y: 0 };
      var rect = pegs[colIdx].getBoundingClientRect();
      var boardRect = board.getBoundingClientRect();
      return {
        x: rect.left - boardRect.left + (rect.width  / 2) - ${BALL_PX / 2},
        y: rect.top  - boardRect.top  + (rect.height / 2) - ${BALL_PX / 2},
      };
    }

    function _clearTimers() {
      for (var i = 0; i < STATE.dropTimers.length; i++) clearTimeout(STATE.dropTimers[i]);
      STATE.dropTimers.length = 0;
      STATE.pending = null;
    }

    function _spin(onSettled, ctx) {
      if (STATE.dropping) {
        if (typeof onSettled === 'function') setTimeout(onSettled, 0);
        return;
      }
      var board = _resolveBoard();
      if (!board) {
        if (typeof onSettled === 'function') setTimeout(onSettled, 0);
        return;
      }
      _clearTimers();
      var ball = _ensureBall(board);
      ball.classList.remove('is-landed');
      ball.classList.remove('is-armed');
      /* Force reflow so the next transition starts from this state. */
      void ball.offsetWidth;

      /* Walk: ball starts at row 0 center, picks left/right at each
         subsequent row using SHAPE.columns row counts as the implicit
         peg layout. */
      var targetCol = (ctx && typeof ctx.bucket === 'number') ? ctx.bucket : null;
      var pegRows = SHAPE.columns && SHAPE.columns.length ? SHAPE.columns.length : 1;
      var col = Math.floor((SHAPE.columns && SHAPE.columns[0] ? SHAPE.columns[0].rows : 1) / 2);
      var path = [{ row: 0, col: col }];
      for (var r = 1; r < pegRows; r++) {
        var moveRight;
        if (targetCol !== null) {
          if (col < targetCol) {
            moveRight = Math.random() < (${WALK_BIAS} + (1 - ${WALK_BIAS}) * 0.5);
          } else if (col > targetCol) {
            moveRight = Math.random() < (${WALK_BIAS} - ${WALK_BIAS} * 0.5);
          } else {
            moveRight = Math.random() < ${WALK_BIAS};
          }
        } else {
          moveRight = Math.random() < ${WALK_BIAS};
        }
        col += moveRight ? 1 : 0;
        var maxCol = (SHAPE.columns[r] && SHAPE.columns[r].rows) || 1;
        if (col >= maxCol) col = maxCol - 1;
        path.push({ row: r, col: col });
      }

      /* Turbo gate — CSS bakes step/settle. Override per-spin so turbo
         chip ACTUALLY compresses cadence (Boki bug). */
      var _tm = (typeof window.__SLOT_TURBO_SPEED_MULT__ === 'number' && window.__SLOT_TURBO_SPEED_MULT__ > 0)
        ? window.__SLOT_TURBO_SPEED_MULT__ : 1.0;
      var _reducedMotion = (typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var _stepMs   = _reducedMotion ? 0 : Math.max(${MIN_STEP_MS}, Math.round(${STEP_MS}   * _tm));
      var _settleMs = _reducedMotion ? 0 : Math.max(${MIN_SETTLE_MS}, Math.round(${SETTLE_MS} * _tm));
      var _opacityMs = Math.max(${MIN_STEP_MS}, Math.round(${OPACITY_MS} * _tm));

      /* Arm ball at row 0 */
      var start = _pegCenter(board, 0, path[0].col);
      ball.style.transition = 'none';
      ball.style.transform = 'translate(' + start.x + 'px, ' + start.y + 'px)';
      ball.classList.add('is-armed');
      void ball.offsetWidth;
      ball.style.transition = 'transform ' + _stepMs + 'ms cubic-bezier(0.5, 0, 0.6, 1), opacity ' + _opacityMs + 'ms ease';

      STATE.dropping = true;
      STATE.pending = onSettled || null;

      for (var i = 1; i < path.length; i++) {
        (function (step, idx) {
          var t = setTimeout(function () {
            var pos = _pegCenter(board, step.row, step.col);
            ball.style.transform = 'translate(' + pos.x + 'px, ' + pos.y + 'px)';
            if (idx === path.length - 1) {
              var settleTimer = setTimeout(function () {
                ball.classList.add('is-landed');
                STATE.dropping = false;
                var cb = STATE.pending; STATE.pending = null;
                /* WASH PASS #2 (2026-06-19) — REVERTED commit 406a63f emit.
                 * QA confirmed DOUBLE-EMIT: reelEngine wrapper _wrappedSettled
                 * (reelEngine.mjs:1041) ALREADY emits onSpinResult when it
                 * calls cb. Per CLAUDE.md "reelEngine is SOLE OWNER". */
                if (typeof cb === 'function') {
                  var cbTimer = setTimeout(cb, 0);
                  STATE.dropTimers.push(cbTimer);
                }
              }, _settleMs);
              STATE.dropTimers.push(settleTimer);
            }
          }, idx * _stepMs);
          STATE.dropTimers.push(t);
        })(path[i], i);
      }
    }

    if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
      HookBus.on('preSpin', function () {
        _clearTimers();
        STATE.dropping = false;
        var board = _resolveBoard();
        if (board) {
          var ball = board.querySelector('.plinko-ball');
          if (ball) { ball.classList.remove('is-armed'); ball.classList.remove('is-landed'); }
        }
      });
    }

    window.__SLOT_KIND_RUNSPIN__.plinko = _spin;
  })();
`;
}
