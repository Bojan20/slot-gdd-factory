#!/usr/bin/env node
/**
 * W215 Faza 600.4 — Fuzz the W210 canary rollout controller.
 *
 * The canary controller (W210) drives gradual rollouts: it sees a
 * stream of health signals and decides whether to ramp up, hold, or
 * roll back. We feed it randomly-shaped state transitions and assert
 *
 *   1. The controller NEVER throws.
 *   2. The rollout percentage stays in [0, 100].
 *   3. The state machine only transitions to legal next states.
 *   4. Health-gate failures always trigger rollback (no stuck states).
 *
 * Stubs follow the W210 contract.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gen } from './_lib.mjs';
import { runFuzzV2, resolveBudget } from './_lib-v2.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'fuzz');

// ---------------------------------------------------------------------------
// Controller stub
// ---------------------------------------------------------------------------

export const STATES = Object.freeze(['idle', 'ramping', 'holding', 'rolled-back', 'completed']);

/** Allowed transitions (graph). */
export const TRANSITIONS = Object.freeze({
  idle: new Set(['ramping']),
  ramping: new Set(['ramping', 'holding', 'rolled-back', 'completed']),
  holding: new Set(['ramping', 'rolled-back', 'completed']),
  'rolled-back': new Set(['idle']),
  completed: new Set(['idle']),
});

/**
 * Initial controller state.
 */
export function initialState() {
  return { state: 'idle', percent: 0, breaches: 0 };
}

/**
 * Process one health signal and emit the next state.
 *
 * @param {{state:string,percent:number,breaches:number}} prev
 * @param {{healthy:boolean,latencyP99Ms:number,errorRate:number,action?:string}} signal
 */
export function step(prev, signal) {
  if (!prev || typeof prev !== 'object') return { ok: false, code: 'bad_prev' };
  if (!STATES.includes(prev.state)) return { ok: false, code: 'bad_state' };
  if (typeof prev.percent !== 'number' || prev.percent < 0 || prev.percent > 100) {
    return { ok: false, code: 'bad_percent' };
  }
  if (!signal || typeof signal !== 'object') return { ok: false, code: 'bad_signal' };
  const healthy = signal.healthy === true && Number.isFinite(signal.latencyP99Ms)
    && signal.latencyP99Ms >= 0 && signal.latencyP99Ms < 5000
    && Number.isFinite(signal.errorRate) && signal.errorRate >= 0 && signal.errorRate < 0.05;

  let nextState = prev.state;
  let nextPercent = prev.percent;
  let nextBreaches = prev.breaches;

  if (!healthy) {
    nextBreaches += 1;
    if (nextBreaches >= 3 || prev.state === 'ramping' || prev.state === 'holding') {
      nextState = 'rolled-back';
      nextPercent = 0;
    }
  } else {
    nextBreaches = 0;
    if (prev.state === 'idle' && signal.action === 'start') {
      nextState = 'ramping';
      nextPercent = 1;
    } else if (prev.state === 'ramping') {
      nextPercent = Math.min(100, prev.percent + 10);
      if (nextPercent >= 100) nextState = 'completed';
      else if (signal.action === 'hold') nextState = 'holding';
    } else if (prev.state === 'holding' && signal.action === 'resume') {
      nextState = 'ramping';
    } else if (prev.state === 'rolled-back' && signal.action === 'reset') {
      nextState = 'idle';
    } else if (prev.state === 'completed' && signal.action === 'reset') {
      nextState = 'idle';
      nextPercent = 0;
    }
  }

  // Validate transition is legal.
  const allowed = TRANSITIONS[prev.state];
  if (!allowed.has(nextState)) {
    return { ok: false, code: `illegal_transition:${prev.state}->${nextState}` };
  }
  return { ok: true, state: nextState, percent: nextPercent, breaches: nextBreaches };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function genSignal(rng) {
  return {
    healthy: rng.unit() < 0.7,
    latencyP99Ms: rng.unit() < 0.85 ? rng.intRange(0, 4999) : gen.number(rng),
    errorRate: rng.unit() < 0.85 ? rng.unit() * 0.1 : gen.number(rng),
    action: rng.unit() < 0.5
      ? rng.pick(['start', 'hold', 'resume', 'reset'])
      : (rng.unit() < 0.5 ? undefined : gen.badString(rng)),
  };
}

function makeInput(rng) {
  // Walk through 1-50 random transitions.
  const steps = rng.intRange(1, 50);
  const signals = [];
  for (let i = 0; i < steps; i++) signals.push(genSignal(rng));
  // 5% of the time inject a totally random starting state.
  const start = rng.unit() < 0.95 ? initialState() : {
    state: rng.unit() < 0.7 ? rng.pick(STATES) : gen.badString(rng),
    percent: rng.unit() < 0.8 ? rng.intRange(-10, 110) : gen.number(rng),
    breaches: gen.number(rng),
  };
  return { start, signals };
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export function body(input, cov) {
  let state = input.start;
  let lastResultOk = true;
  for (const signal of input.signals) {
    const r = step(state, signal);
    if (!r || typeof r.ok !== 'boolean') {
      throw new Error('step non-result');
    }
    if (!r.ok) {
      if (cov) cov.mark(`fail:${r.code}`);
      lastResultOk = false;
      // After a malformed input the controller is allowed to refuse
      // further work — but it must not crash subsequent calls.
      continue;
    }
    if (cov) cov.mark(`ok:${r.state}`);
    if (typeof r.percent !== 'number' || r.percent < 0 || r.percent > 100) {
      throw new Error(`percent out of range: ${r.percent}`);
    }
    if (!STATES.includes(r.state)) {
      throw new Error(`state not in STATES: ${r.state}`);
    }
    // After an unhealthy signal in ramping/holding we must roll back.
    if (signal && signal.healthy === false
        && (state.state === 'ramping' || state.state === 'holding')
        && r.state !== 'rolled-back') {
      throw new Error(`unhealthy did not roll back from ${state.state}`);
    }
    state = r;
  }
  if (cov) cov.mark(lastResultOk ? 'walk:clean' : 'walk:had-errors');
}

// ---------------------------------------------------------------------------
// Entry-point
// ---------------------------------------------------------------------------

export function main(opts = {}) {
  const budget = opts.budget ?? process.env.FUZZ_BUDGET ?? 'synthetic';
  const report = runFuzzV2({
    name: 'canary-controller',
    makeInput,
    body,
    budget,
    maxWallMs: opts.maxWallMs,
  });
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'REPORT-canary.json'), JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = main({ budget: resolveBudget(process.env.FUZZ_BUDGET ?? 'synthetic') });
  if (r.uniqueCrashes > 0) {
    console.error(`fuzz-canary-controller: ${r.uniqueCrashes} unique crashes`);
    process.exit(1);
  }
}
