/**
 * Faza 13.9 — USIF v1.0 Structural Validator.
 *
 * Validates unknown payloads against the USIF v1.0 shape without an
 * external JSON Schema library (no runtime dependency required).
 * Also accepts internal IR field aliases (evaluation / rng.kind) so
 * the engine's SlotGameIR passes `isUSIFCompatible` out of the box.
 */

import { USIF_SCHEMA_OBJECT } from './schemaObject.js';

export interface USIFValidationError {
  path: string;
  message: string;
  value?: unknown;
}

export interface USIFValidationResult {
  valid: boolean;
  errors: USIFValidationError[];
  schemaVersion: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const VALID_WIN_EVALUATOR_MODES = ['lines', 'ways', 'variable_ways', 'cluster', 'pay_anywhere', 'pattern'] as const;

function err(path: string, message: string, value?: unknown): USIFValidationError {
  return { path, message, value };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ─── validateUSIF ──────────────────────────────────────────────────────

/**
 * Validate a raw unknown value against the USIF v1.0 schema.
 * Also accepts internal IR field aliases:
 *   - `evaluation` (IR) instead of `win_evaluator` (USIF)
 *   - `rng.kind` (IR) instead of `rng.algorithm` (USIF)
 * Never throws — returns a structured result.
 */
export function validateUSIF(config: unknown): USIFValidationResult {
  const errors: USIFValidationError[] = [];

  // Must be a non-null object
  if (!isObject(config)) {
    return {
      valid: false,
      errors: [err('$', 'must be a non-null object', config)],
      schemaVersion: 'unknown',
    };
  }

  // Normalise IR aliases
  const normalised: Record<string, unknown> = { ...config };
  if (!('win_evaluator' in normalised) && 'evaluation' in normalised) {
    const evaluation = normalised['evaluation'];
    if (isObject(evaluation)) {
      const mode = evaluation['kind'] !== undefined ? evaluation['kind'] : evaluation['mode'];
      normalised['win_evaluator'] = { mode, ...evaluation };
    } else {
      normalised['win_evaluator'] = evaluation;
    }
  }
  if ('rng' in normalised && isObject(normalised['rng'])) {
    const rng = normalised['rng'] as Record<string, unknown>;
    if (!('algorithm' in rng) && 'kind' in rng) {
      normalised['rng'] = { ...rng, algorithm: rng['kind'] };
    }
  }

  // Required top-level fields
  const required = USIF_SCHEMA_OBJECT.required as readonly string[];
  for (const field of required) {
    if (!(field in normalised)) {
      errors.push(err(`$.${field}`, `required field '${field}' is missing`));
    }
  }

  // schema_version: semver
  const sv = normalised['schema_version'];
  let detectedVersion = 'unknown';
  if (sv !== undefined) {
    if (typeof sv !== 'string' || !SEMVER_RE.test(sv)) {
      errors.push(err('$.schema_version', `must be a semver string (e.g. "1.0.0"), got ${JSON.stringify(sv)}`, sv));
    } else {
      detectedVersion = sv;
    }
  }

  // meta
  if ('meta' in normalised) {
    const metaErrors = validateMeta(normalised['meta']);
    errors.push(...metaErrors);
  }

  // symbols: non-empty array
  if ('symbols' in normalised) {
    const syms = normalised['symbols'];
    if (!Array.isArray(syms)) {
      errors.push(err('$.symbols', 'must be an array', syms));
    } else if (syms.length === 0) {
      errors.push(err('$.symbols', 'must be a non-empty array'));
    }
  }

  // win_evaluator (already normalised from evaluation if needed)
  if ('win_evaluator' in normalised) {
    const weErrors = validateWinEvaluator(normalised['win_evaluator']);
    errors.push(...weErrors);
  }

  // rng: basic object check (already normalised)
  if ('rng' in normalised) {
    const rng = normalised['rng'];
    if (!isObject(rng)) {
      errors.push(err('$.rng', 'must be an object', rng));
    }
  }

  // bet: non-negative number fields
  if ('bet' in normalised) {
    const betErrors = validateBet(normalised['bet']);
    errors.push(...betErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
    schemaVersion: detectedVersion,
  };
}

function validateMeta(meta: unknown): USIFValidationError[] {
  const errors: USIFValidationError[] = [];
  if (!isObject(meta)) {
    errors.push(err('$.meta', 'must be an object', meta));
    return errors;
  }
  const metaRequired = ['id', 'name', 'version', 'theme_tags'] as const;
  for (const field of metaRequired) {
    if (!(field in meta)) {
      errors.push(err(`$.meta.${field}`, `required field 'meta.${field}' is missing`));
    }
  }
  if ('version' in meta) {
    const v = meta['version'];
    if (typeof v !== 'string' || !SEMVER_RE.test(v)) {
      errors.push(err('$.meta.version', `must be a semver string, got ${JSON.stringify(v)}`, v));
    }
  }
  if ('theme_tags' in meta) {
    if (!Array.isArray(meta['theme_tags'])) {
      errors.push(err('$.meta.theme_tags', 'must be an array', meta['theme_tags']));
    }
  }
  return errors;
}

function validateWinEvaluator(we: unknown): USIFValidationError[] {
  const errors: USIFValidationError[] = [];
  if (!isObject(we)) {
    errors.push(err('$.win_evaluator', 'must be an object', we));
    return errors;
  }
  if ('mode' in we) {
    const mode = we['mode'];
    if (!VALID_WIN_EVALUATOR_MODES.includes(mode as (typeof VALID_WIN_EVALUATOR_MODES)[number])) {
      errors.push(
        err(
          '$.win_evaluator.mode',
          `must be one of ${VALID_WIN_EVALUATOR_MODES.join(', ')}, got ${JSON.stringify(mode)}`,
          mode,
        ),
      );
    }
  } else {
    errors.push(err('$.win_evaluator.mode', "required field 'win_evaluator.mode' is missing"));
  }
  return errors;
}

function validateBet(bet: unknown): USIFValidationError[] {
  const errors: USIFValidationError[] = [];
  if (!isObject(bet)) {
    errors.push(err('$.bet', 'must be an object', bet));
    return errors;
  }
  const numericFields = ['base_bet', 'min_bet', 'max_bet', 'default_bet'] as const;
  for (const field of numericFields) {
    if (field in bet) {
      const val = bet[field];
      if (typeof val !== 'number' || val < 0) {
        errors.push(err(`$.bet.${field}`, `must be a non-negative number, got ${JSON.stringify(val)}`, val));
      }
    }
  }
  if ('denominations' in bet) {
    const dens = bet['denominations'];
    if (!Array.isArray(dens)) {
      errors.push(err('$.bet.denominations', 'must be an array', dens));
    } else {
      dens.forEach((d, i) => {
        if (typeof d !== 'number' || d < 0) {
          errors.push(err(`$.bet.denominations[${i}]`, `must be a non-negative number, got ${JSON.stringify(d)}`, d));
        }
      });
    }
  }
  return errors;
}

// ─── getUSIFSchema ─────────────────────────────────────────────────────

/** Return the USIF v1.0 JSON Schema object. */
export function getUSIFSchema(): typeof USIF_SCHEMA_OBJECT {
  return USIF_SCHEMA_OBJECT;
}

// ─── isUSIFCompatible ─────────────────────────────────────────────────

/**
 * Broader compatibility check.
 * Accepts internal IR field aliases:
 *   - `evaluation` instead of `win_evaluator`
 *   - `rng.kind` instead of `rng.algorithm`
 */
export function isUSIFCompatible(ir: unknown): boolean {
  if (!isObject(ir)) return false;

  // Normalise IR aliases into USIF shape for validation
  const normalised: Record<string, unknown> = { ...ir };

  // Map internal `evaluation` to `win_evaluator`
  if (!('win_evaluator' in normalised) && 'evaluation' in normalised) {
    const evaluation = normalised['evaluation'];
    if (isObject(evaluation)) {
      // IR uses `kind`, USIF uses `mode`
      const mode = evaluation['kind'] !== undefined ? evaluation['kind'] : (evaluation as Record<string, unknown>)['mode'];
      normalised['win_evaluator'] = { mode, ...evaluation };
    } else {
      normalised['win_evaluator'] = evaluation;
    }
  }

  // Map internal `rng.kind` to `rng.algorithm`
  if ('rng' in normalised && isObject(normalised['rng'])) {
    const rng = normalised['rng'] as Record<string, unknown>;
    if (!('algorithm' in rng) && 'kind' in rng) {
      normalised['rng'] = { ...rng, algorithm: rng['kind'] };
    }
  }

  const result = validateUSIF(normalised);
  return result.valid;
}
