/**
 * @slot-math-engine/sdk — kernel-author helper.
 *
 * Skeletons + utilities for third-party developers writing a new math
 * kernel. The kernel is a pure function: `(ctx, params) → result`. We
 * give them an authoring helper that wires up:
 *
 *   • parameter schema (Zod-like minimal types — no runtime dep)
 *   • RTP estimator hooks (closed-form + MC)
 *   • registration to the engine's kernel registry
 *
 * This is intentionally a minimal SDK helper — the real kernel lives
 * in `src/kernels/` of the engine itself; the SDK only provides the
 * authoring contract.
 */

export interface KernelParamSpec {
  /** Parameter key. */
  key: string;
  type: 'number' | 'integer' | 'string' | 'boolean' | 'array';
  /** Default value for testing. */
  default?: unknown;
  /** Inclusive numeric bounds. */
  min?: number;
  max?: number;
  /** Allowed string/enum values. */
  enum?: string[];
  description?: string;
}

export interface KernelContext {
  /** Pseudo-RNG seeded by the engine; returns [0, 1). */
  rng: () => number;
  /** Per-spin bet size. */
  bet: number;
  /** Symbol pool. */
  symbolPool: Record<string, number>;
}

export interface KernelResult {
  /** RTP contribution from this kernel. */
  rtp: number;
  /** Hit frequency from this kernel. */
  hitFrequency: number;
  /** Optional metric breakdown for diagnostics. */
  diagnostics?: Record<string, number>;
}

export interface KernelDefinition<P = Record<string, unknown>> {
  name: string;
  /** Semantic version of the kernel. */
  version: string;
  /** Mehanika family tag (e.g. 'cascade', 'hnw', 'wheel'). */
  family: string;
  paramSpec: KernelParamSpec[];
  /** Pure closed-form RTP solver. */
  closedForm: (ctx: KernelContext, params: P) => KernelResult;
  /** Optional MC validator — returns same shape as closedForm. */
  monteCarlo?: (ctx: KernelContext, params: P, spins: number) => KernelResult;
}

/** Validate parameters against a spec. Throws on first violation. */
export function validateParams(spec: KernelParamSpec[], params: Record<string, unknown>): void {
  for (const p of spec) {
    const v = params[p.key];
    if (v === undefined || v === null) {
      if (p.default === undefined) throw new Error(`missing param: ${p.key}`);
      continue;
    }
    if (p.type === 'integer') {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        throw new Error(`param ${p.key} must be integer, got ${typeof v}`);
      }
    } else if (p.type === 'number') {
      if (typeof v !== 'number' || Number.isNaN(v)) {
        throw new Error(`param ${p.key} must be number`);
      }
    } else if (p.type === 'string') {
      if (typeof v !== 'string') throw new Error(`param ${p.key} must be string`);
      if (p.enum && !p.enum.includes(v)) throw new Error(`param ${p.key} must be one of ${p.enum.join(',')}`);
    } else if (p.type === 'boolean') {
      if (typeof v !== 'boolean') throw new Error(`param ${p.key} must be boolean`);
    } else if (p.type === 'array') {
      if (!Array.isArray(v)) throw new Error(`param ${p.key} must be array`);
    }
    if (typeof v === 'number') {
      if (p.min !== undefined && v < p.min) throw new Error(`param ${p.key} below min ${p.min}`);
      if (p.max !== undefined && v > p.max) throw new Error(`param ${p.key} above max ${p.max}`);
    }
  }
}

/** Author a new kernel definition with sensible defaults. The returned
 *  object can be registered with `engine.registerKernel(def)` (when the
 *  engine API supports it) or simply exported from your package. */
export function defineKernel<P extends Record<string, unknown>>(
  def: Omit<KernelDefinition<P>, 'paramSpec'> & {
    paramSpec?: KernelParamSpec[];
  }
): KernelDefinition<P> {
  return {
    paramSpec: [],
    ...def,
  };
}

/** Compute a quick MC estimate when the kernel doesn't ship one. */
export function defaultMC<P extends Record<string, unknown>>(
  def: KernelDefinition<P>,
  ctx: KernelContext,
  params: P,
  spins: number
): KernelResult {
  let totalRtp = 0;
  let hits = 0;
  for (let i = 0; i < spins; i++) {
    const r = def.closedForm(ctx, params);
    totalRtp += r.rtp;
    if (r.hitFrequency > 0) hits += 1;
  }
  return {
    rtp: totalRtp / spins,
    hitFrequency: hits / spins,
  };
}
