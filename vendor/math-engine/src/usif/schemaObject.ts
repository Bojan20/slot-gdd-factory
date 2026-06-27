/**
 * Faza 13.9 — USIF v1.0 JSON Schema Object.
 *
 * The Universal Slot Interchange Format (USIF) v1.0 schema as a
 * TypeScript constant. Consumers can serialise this to JSON for external
 * validators, or use it programmatically via `validator.ts`.
 */

export const USIF_SCHEMA_OBJECT = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://usif.slotmath.io/v1/schema.json',
  title: 'Universal Slot Interchange Format (USIF) v1.0',
  description:
    'Canonical interchange format for slot game configurations across engine implementations. ' +
    'Covers topology, symbols, reels, paytable, win evaluation, features, RNG, bet, compliance and RTP allocation.',
  version: '1.0.0',
  type: 'object',
  required: ['schema_version', 'meta', 'topology', 'symbols', 'reels', 'paytable', 'win_evaluator', 'rng', 'bet'],
  additionalProperties: true,
  properties: {
    schema_version: {
      type: 'string',
      description: 'Semver string, must match /^\\d+\\.\\d+\\.\\d+$/',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
    },
    meta: { $ref: '#/definitions/Meta' },
    topology: { $ref: '#/definitions/Topology' },
    symbols: {
      type: 'array',
      items: { $ref: '#/definitions/Symbol' },
      minItems: 1,
      description: 'Non-empty list of symbol definitions.',
    },
    reels: { $ref: '#/definitions/ReelSet' },
    paytable: { $ref: '#/definitions/Paytable' },
    win_evaluator: { $ref: '#/definitions/WinEvaluator' },
    rng: { $ref: '#/definitions/Rng' },
    bet: { $ref: '#/definitions/Bet' },
    features: {
      type: 'array',
      items: { $ref: '#/definitions/Feature' },
      description: 'Optional list of game features.',
    },
    limits: { $ref: '#/definitions/Limits' },
    compliance: { $ref: '#/definitions/Compliance' },
    rtp_allocation: { $ref: '#/definitions/RtpAllocation' },
  },
  definitions: {
    Meta: {
      type: 'object',
      required: ['id', 'name', 'version', 'theme_tags'],
      additionalProperties: true,
      properties: {
        id: { type: 'string', description: 'Stable machine-readable game identifier.' },
        name: { type: 'string', description: 'Human-readable game name.' },
        version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$', description: 'Game config semver.' },
        description: { type: 'string' },
        theme_tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Thematic classification tags.',
        },
        author: { type: 'string' },
        created_at_utc: { type: 'string', format: 'date-time' },
      },
    },

    Topology: {
      type: 'object',
      required: ['kind'],
      description: 'Grid layout descriptor.',
      properties: {
        kind: {
          type: 'string',
          enum: ['rectangular', 'variable_rows', 'cluster_grid'],
        },
        reels: { type: 'integer', minimum: 1 },
        rows: { type: 'integer', minimum: 1 },
        row_range_per_reel: {
          type: 'array',
          items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
        },
        columns: { type: 'integer', minimum: 1 },
        adjacency: { type: 'string', enum: ['orthogonal', 'diagonal', 'hex'] },
        ways_cap: { type: 'integer', minimum: 1 },
      },
    },

    Symbol: {
      type: 'object',
      required: ['id', 'name', 'kind'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string', enum: ['lp', 'hp', 'wild', 'scatter', 'bonus', 'multiplier', 'sticky', 'expanding', 'mystery', 'transform', 'chain_wild'] },
        substitutes: {
          oneOf: [
            { type: 'string', enum: ['*'] },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        weight_hint: { type: 'number', minimum: 0 },
        appears_on: { type: 'array', items: { type: 'integer', minimum: 0 } },
        behaviors: {
          type: 'array',
          items: { $ref: '#/definitions/SymbolBehavior' },
        },
      },
    },

    SymbolBehavior: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: {
          type: 'string',
          enum: [
            'wild',
            'scatter',
            'sticky',
            'expanding',
            'mystery',
            'multiplier',
            'cascade_remove',
            'lock_on_win',
            'transform',
            'chain_wild',
            'collecting',
            'stacked',
            'colossal',
            'walking',
            'shifting',
            'random_substitution',
          ],
          description: 'Behavioural role this symbol plays.',
        },
        multiplier: { type: 'number', minimum: 1 },
        target: { type: 'string' },
        probability: { type: 'number', minimum: 0, maximum: 1 },
      },
    },

    ReelSet: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['weighted', 'strips'] },
        base: { type: 'array' },
        free_spins: { type: 'array' },
      },
    },

    Paytable: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        additionalProperties: { type: 'number', minimum: 0 },
      },
      description: 'symbol_id → { count_or_cluster_size → multiplier }.',
    },

    WinEvaluator: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: {
          type: 'string',
          enum: ['lines', 'ways', 'variable_ways', 'cluster', 'pay_anywhere', 'pattern'],
          description: 'Win evaluation algorithm.',
        },
        paylines: {
          type: 'array',
          items: { type: 'array', items: { type: 'integer', minimum: 0 } },
          description: 'Payline definitions for lines mode.',
        },
        direction: { type: 'string', enum: ['ltr', 'rtl', 'both'] },
        min_match: { type: 'integer', minimum: 1 },
        pay_left_to_right_only: { type: 'boolean' },
        min_cluster_size: { type: 'integer', minimum: 1 },
        cluster_pay_table: {
          type: 'object',
          additionalProperties: { type: 'number' },
        },
        min_count: { type: 'integer', minimum: 1 },
        max_ways_per_spin: { type: 'integer', minimum: 1 },
        patterns: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'positions', 'pay_multiplier'],
            properties: {
              id: { type: 'string' },
              positions: {
                oneOf: [
                  { type: 'string', enum: ['all'] },
                  { type: 'array', items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 } },
                ],
              },
              pay_multiplier: { type: 'number', minimum: 0 },
            },
          },
        },
      },
    },

    Feature: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: {
          type: 'string',
          enum: [
            'free_spins',
            'hold_and_win',
            'cascade',
            'respin',
            'pick',
            'wheel',
            'buy_feature',
            'ante_bet',
            'gamble',
            'mystery_symbol',
            'symbol_upgrade',
            'bonus_game',
            'jackpot',
            'expanding_wild',
            'sticky_wild',
            'multiplier_ladder',
          ],
          description: 'Feature type identifier.',
        },
        trigger: {
          type: 'object',
          properties: {
            by: { type: 'string', enum: ['scatter_count', 'bonus_count', 'special_count'] },
            thresholds: { type: 'object', additionalProperties: { type: 'number' } },
            min: { type: 'integer', minimum: 0 },
          },
        },
        retrigger: { type: 'object' },
        global_multiplier: { type: 'number', minimum: 1 },
        modifiers: { type: 'array', items: { type: 'string' } },
        respins_initial: { type: 'integer', minimum: 1 },
        respin_reset_on_new: { type: 'boolean' },
        cash_value_distribution: { type: 'array' },
        jackpot_tiers: { type: 'array' },
        grid_full_award: { type: 'string' },
        replacement: { type: 'string', enum: ['drop', 'refill_random', 'fixed_strip'] },
        max_chain: { type: 'integer', minimum: 1 },
        multiplier_progression: { type: 'array', items: { type: 'number' } },
        cost_x: { type: 'number', minimum: 0 },
        max_uses_per_spin: { type: 'integer', minimum: 1 },
        prize_pool: { type: 'array' },
        segments: { type: 'array' },
        offers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'cost_x', 'guaranteed'],
            properties: {
              id: { type: 'string' },
              cost_x: { type: 'number', minimum: 0 },
              guaranteed: { type: 'string' },
            },
          },
        },
        extra_multiplier: { type: 'number', minimum: 1 },
        enabled_by_default: { type: 'boolean' },
        type: { type: 'string', enum: ['red_black', 'suit'] },
        max_steps: { type: 'integer', minimum: 1 },
        tie_resolution: { type: 'string', enum: ['house', 'push'] },
        symbol_id: { type: 'string' },
        reveal_distribution: { type: 'object', additionalProperties: { type: 'number' } },
        from: { type: 'string' },
        to: { type: 'string' },
        probability: { type: 'number', minimum: 0, maximum: 1 },
      },
    },

    Rng: {
      type: 'object',
      required: ['algorithm'],
      properties: {
        algorithm: {
          type: 'string',
          enum: ['mulberry32', 'pcg64', 'xoshiro256pp', 'aes_ctr_drbg', 'mt19937'],
          description: 'RNG algorithm identifier.',
        },
        default_seed: { type: 'number' },
        jump_function: { type: 'string' },
      },
    },

    Bet: {
      type: 'object',
      required: ['currency', 'base_bet', 'denominations'],
      properties: {
        currency: { type: 'string', description: 'ISO 4217 currency code.' },
        base_bet: { type: 'number', minimum: 0 },
        denominations: { type: 'array', items: { type: 'number', minimum: 0 } },
        min_bet: { type: 'number', minimum: 0 },
        max_bet: { type: 'number', minimum: 0 },
        default_bet: { type: 'number', minimum: 0 },
        ante_bet: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            extra_multiplier: { type: 'number', minimum: 1 },
          },
        },
        buy_feature: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              cost_x: { type: 'number', minimum: 0 },
              guaranteed: { type: 'string' },
            },
          },
        },
      },
    },

    Limits: {
      type: 'object',
      properties: {
        target_rtp: { type: 'number', minimum: 0, maximum: 1 },
        rtp_tolerance: { type: 'number', minimum: 0 },
        max_win_x: { type: 'number', minimum: 1 },
        win_cap_apply: { type: 'string', enum: ['per_spin', 'per_feature_session'] },
        target_volatility: { type: 'string', enum: ['low', 'medium', 'high', 'ultra'] },
        hit_freq_target: { type: 'number', minimum: 0, maximum: 1 },
      },
    },

    Compliance: {
      type: 'object',
      properties: {
        jurisdictions: { type: 'array', items: { type: 'string' } },
        rtp_range_required: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        max_win_cap_required: { type: 'number', minimum: 0 },
        near_miss_rule: { type: 'string', enum: ['must_be_random', 'allowed_within_distribution'] },
        ldw_disclosure: { type: 'boolean' },
        session_time_display: { type: 'boolean' },
      },
    },

    RtpAllocation: {
      type: 'object',
      properties: {
        base_game: { type: 'number', minimum: 0 },
        free_spins: { type: 'number', minimum: 0 },
        hold_and_win: { type: 'number', minimum: 0 },
        jackpot: { type: 'number', minimum: 0 },
        tolerance: { type: 'number', minimum: 0 },
      },
    },
  },
} as const;
