/**
 * Slot Game IR — runtime validation via Zod.
 *
 * One source of truth — `types.ts` carries the static types, this file
 * mirrors them as runtime schemas so loading a JSON config from disk /
 * HTTP / config builder UI fails *loudly* on malformed input instead of
 * crashing the simulator deep inside the evaluator.
 *
 * The two files MUST stay in sync. The roundtrip test in
 * `tests/ir.test.ts` proves they do — a config that passes Zod also
 * type-checks against the TS interface (and vice versa for the curated
 * fixture set).
 *
 * Why Zod over `ajv`: Zod's `infer<>` gives us free reverse-mode parity
 * checks, and the codebase already pulls it (package.json line 17).
 */
import { z } from 'zod';
export declare const MetaZ: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    theme_tags: z.ZodArray<z.ZodString>;
    author: z.ZodOptional<z.ZodString>;
    created_at_utc: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const TopologyZ: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"rectangular">;
    reels: z.ZodNumber;
    rows: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"variable_rows">;
    reels: z.ZodNumber;
    row_range_per_reel: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
    ways_cap: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"cluster_grid">;
    columns: z.ZodNumber;
    rows: z.ZodNumber;
    adjacency: z.ZodEnum<{
        orthogonal: "orthogonal";
        diagonal: "diagonal";
        hex: "hex";
    }>;
}, z.core.$strict>], "kind">;
export declare const SymbolKindZ: z.ZodEnum<{
    transform: "transform";
    lp: "lp";
    hp: "hp";
    wild: "wild";
    scatter: "scatter";
    bonus: "bonus";
    multiplier: "multiplier";
    sticky: "sticky";
    expanding: "expanding";
    mystery: "mystery";
    chain_wild: "chain_wild";
}>;
export declare const BehaviorTypeZ: z.ZodEnum<{
    sticky: "sticky";
    expanding_full_reel: "expanding_full_reel";
    walking: "walking";
    transforming: "transforming";
    collecting: "collecting";
    mystery_reveal: "mystery_reveal";
    colossal: "colossal";
}>;
export declare const SymbolBehaviorZ: z.ZodObject<{
    colossal_size: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
    behavior_type: z.ZodOptional<z.ZodEnum<{
        sticky: "sticky";
        expanding_full_reel: "expanding_full_reel";
        walking: "walking";
        transforming: "transforming";
        collecting: "collecting";
        mystery_reveal: "mystery_reveal";
        colossal: "colossal";
    }>>;
    transform_target: z.ZodOptional<z.ZodString>;
    collection_priority: z.ZodOptional<z.ZodNumber>;
    sticky_duration_spins: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const SymbolZ: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<{
        transform: "transform";
        lp: "lp";
        hp: "hp";
        wild: "wild";
        scatter: "scatter";
        bonus: "bonus";
        multiplier: "multiplier";
        sticky: "sticky";
        expanding: "expanding";
        mystery: "mystery";
        chain_wild: "chain_wild";
    }>;
    substitutes: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodLiteral<"*">]>>;
    weight_hint: z.ZodOptional<z.ZodNumber>;
    appears_on: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    behavior: z.ZodOptional<z.ZodObject<{
        colossal_size: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
        behavior_type: z.ZodOptional<z.ZodEnum<{
            sticky: "sticky";
            expanding_full_reel: "expanding_full_reel";
            walking: "walking";
            transforming: "transforming";
            collecting: "collecting";
            mystery_reveal: "mystery_reveal";
            colossal: "colossal";
        }>>;
        transform_target: z.ZodOptional<z.ZodString>;
        collection_priority: z.ZodOptional<z.ZodNumber>;
        sticky_duration_spins: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ReelSetZ: z.ZodDiscriminatedUnion<[z.ZodObject<{
    mode: z.ZodLiteral<"weighted">;
    base: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    free_spins: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>>>;
}, z.core.$strict>, z.ZodObject<{
    mode: z.ZodLiteral<"strips">;
    base: z.ZodArray<z.ZodArray<z.ZodString>>;
    free_spins: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodString>>>;
}, z.core.$strict>], "mode">;
export declare const EvaluationZ: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"lines">;
    paylines: z.ZodArray<z.ZodArray<z.ZodNumber>>;
    direction: z.ZodEnum<{
        ltr: "ltr";
        rtl: "rtl";
        both: "both";
    }>;
    min_match: z.ZodNumber;
    pay_left_to_right_only: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"ways">;
    direction: z.ZodEnum<{
        ltr: "ltr";
        rtl: "rtl";
        both: "both";
    }>;
    min_match: z.ZodNumber;
    max_ways_per_spin: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"cluster">;
    min_cluster_size: z.ZodNumber;
    cluster_pay_table: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"pay_anywhere">;
    min_count: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"pattern">;
    patterns: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        positions: z.ZodUnion<readonly [z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>, z.ZodLiteral<"all">]>;
        pay_multiplier: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>], "kind">;
export declare const PaytableZ: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodNumber>>;
export declare const FeatureZ: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"free_spins">;
    trigger: z.ZodObject<{
        by: z.ZodEnum<{
            scatter_count: "scatter_count";
            bonus_count: "bonus_count";
            special_count: "special_count";
        }>;
        thresholds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        min: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    retrigger: z.ZodOptional<z.ZodObject<{
        by: z.ZodEnum<{
            scatter_count: "scatter_count";
            bonus_count: "bonus_count";
            special_count: "special_count";
        }>;
        thresholds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        min: z.ZodOptional<z.ZodNumber>;
        max_total: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    global_multiplier: z.ZodOptional<z.ZodNumber>;
    modifiers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        sticky_wilds: "sticky_wilds";
        expanding_wilds: "expanding_wilds";
        multiplier_ladder: "multiplier_ladder";
        mystery_symbol: "mystery_symbol";
    }>>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"hold_and_win">;
    trigger: z.ZodObject<{
        by: z.ZodEnum<{
            scatter_count: "scatter_count";
            bonus_count: "bonus_count";
            special_count: "special_count";
        }>;
        thresholds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        min: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
    respins_initial: z.ZodNumber;
    respin_reset_on_new: z.ZodBoolean;
    cash_value_distribution: z.ZodArray<z.ZodObject<{
        value: z.ZodNumber;
        weight: z.ZodNumber;
    }, z.core.$strict>>;
    jackpot_tiers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        multiplier: z.ZodNumber;
    }, z.core.$strict>>;
    grid_full_award: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"cascade">;
    replacement: z.ZodEnum<{
        drop: "drop";
        refill_random: "refill_random";
        fixed_strip: "fixed_strip";
    }>;
    max_chain: z.ZodNumber;
    multiplier_progression: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"respin">;
    cost_x: z.ZodNumber;
    max_uses_per_spin: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"pick">;
    prize_pool: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        weight: z.ZodNumber;
        pay_multiplier: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"wheel">;
    segments: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        weight: z.ZodNumber;
        pay_multiplier: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"buy_feature">;
    offers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        cost_x: z.ZodNumber;
        guaranteed: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"ante_bet">;
    extra_multiplier: z.ZodNumber;
    enabled_by_default: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"gamble">;
    type: z.ZodEnum<{
        red_black: "red_black";
        suit: "suit";
    }>;
    max_steps: z.ZodNumber;
    tie_resolution: z.ZodEnum<{
        push: "push";
        house: "house";
    }>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"mystery_symbol">;
    symbol_id: z.ZodString;
    reveal_distribution: z.ZodRecord<z.ZodString, z.ZodNumber>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"symbol_upgrade">;
    from: z.ZodString;
    to: z.ZodString;
    probability: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"linear_progressive">;
    pool_id: z.ZodString;
    contribution_per_spin_x: z.ZodNumber;
    seed_x: z.ZodNumber;
    must_hit_by_x: z.ZodOptional<z.ZodNumber>;
    tier_ladder: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        multiplier: z.ZodNumber;
    }, z.core.$strict>>>;
    external_pool_ref: z.ZodOptional<z.ZodString>;
}, z.core.$strict>], "kind">;
export declare const RngZ: z.ZodObject<{
    kind: z.ZodEnum<{
        mulberry32: "mulberry32";
        pcg64: "pcg64";
        xoshiro256pp: "xoshiro256pp";
        aes_ctr_drbg: "aes_ctr_drbg";
    }>;
    default_seed: z.ZodNumber;
    jump_function: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const BetZ: z.ZodObject<{
    currency: z.ZodString;
    base_bet: z.ZodNumber;
    denominations: z.ZodArray<z.ZodNumber>;
    ante_bet: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        extra_multiplier: z.ZodNumber;
    }, z.core.$strict>>;
    buy_feature: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        cost_x: z.ZodNumber;
        guaranteed: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const LimitsZ: z.ZodObject<{
    target_rtp: z.ZodNumber;
    rtp_tolerance: z.ZodNumber;
    max_win_x: z.ZodNumber;
    win_cap_apply: z.ZodEnum<{
        per_spin: "per_spin";
        per_feature_session: "per_feature_session";
    }>;
    target_volatility: z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        ultra: "ultra";
    }>;
    hit_freq_target: z.ZodNumber;
}, z.core.$strict>;
export declare const ComplianceZ: z.ZodObject<{
    jurisdictions: z.ZodArray<z.ZodString>;
    rtp_range_required: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
    max_win_cap_required: z.ZodNumber;
    near_miss_rule: z.ZodEnum<{
        must_be_random: "must_be_random";
        allowed_within_distribution: "allowed_within_distribution";
    }>;
    ldw_disclosure: z.ZodBoolean;
    session_time_display: z.ZodBoolean;
}, z.core.$strict>;
export declare const RtpAllocationZ: z.ZodObject<{
    base_game: z.ZodNumber;
    free_spins: z.ZodNumber;
    hold_and_win: z.ZodNumber;
    jackpot: z.ZodNumber;
    tolerance: z.ZodNumber;
}, z.core.$strict>;
export declare const ProgressiveLinkZ: z.ZodObject<{
    pool_id: z.ZodOptional<z.ZodString>;
    contribution_per_spin_x: z.ZodNumber;
    seed_x: z.ZodNumber;
    must_hit_by_x: z.ZodOptional<z.ZodNumber>;
    tier_ladder: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        multiplier: z.ZodNumber;
    }, z.core.$strict>>>;
    reset_rule: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const JurisdictionOverrideZ: z.ZodObject<{
    target_rtp: z.ZodOptional<z.ZodNumber>;
    max_win_x: z.ZodOptional<z.ZodNumber>;
    min_spin_time_ms: z.ZodOptional<z.ZodNumber>;
    max_bet_x: z.ZodOptional<z.ZodNumber>;
    feature_toggles: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    compensated_mode: z.ZodOptional<z.ZodBoolean>;
    force_ldw_disclosure: z.ZodOptional<z.ZodBoolean>;
    autoplay_forbidden: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const PersistentFieldKindZ: z.ZodEnum<{
    boolean: "boolean";
    symbol: "symbol";
    multiplier: "multiplier";
    counter: "counter";
    accumulator: "accumulator";
}>;
export declare const PersistenceScopeZ: z.ZodEnum<{
    spin: "spin";
    session: "session";
    account: "account";
}>;
export declare const PersistentFieldZ: z.ZodObject<{
    name: z.ZodString;
    kind: z.ZodEnum<{
        boolean: "boolean";
        symbol: "symbol";
        multiplier: "multiplier";
        counter: "counter";
        accumulator: "accumulator";
    }>;
    default: z.ZodOptional<z.ZodNumber>;
    reset_rule: z.ZodString;
    max_value: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const StateTransitionZ: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    condition: z.ZodString;
}, z.core.$strict>;
export declare const StateMachineZ: z.ZodObject<{
    states: z.ZodArray<z.ZodString>;
    initial_state: z.ZodString;
    transitions: z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        condition: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PersistentStateZ: z.ZodObject<{
    fields: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        kind: z.ZodEnum<{
            boolean: "boolean";
            symbol: "symbol";
            multiplier: "multiplier";
            counter: "counter";
            accumulator: "accumulator";
        }>;
        default: z.ZodOptional<z.ZodNumber>;
        reset_rule: z.ZodString;
        max_value: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    state_machine: z.ZodOptional<z.ZodObject<{
        states: z.ZodArray<z.ZodString>;
        initial_state: z.ZodString;
        transitions: z.ZodArray<z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
            condition: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    scope: z.ZodEnum<{
        spin: "spin";
        session: "session";
        account: "account";
    }>;
}, z.core.$strict>;
export declare const ProvenanceZ: z.ZodObject<{
    vendor: z.ZodString;
    par_source: z.ZodString;
    swid: z.ZodOptional<z.ZodString>;
    par_sha256: z.ZodString;
    ir_sha256: z.ZodOptional<z.ZodString>;
    build_hash: z.ZodOptional<z.ZodString>;
    built_at_utc: z.ZodOptional<z.ZodString>;
    signed_by: z.ZodOptional<z.ZodString>;
    signature: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const SlotGameIRZ: z.ZodObject<{
    schema_version: z.ZodString;
    meta: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        version: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        theme_tags: z.ZodArray<z.ZodString>;
        author: z.ZodOptional<z.ZodString>;
        created_at_utc: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    topology: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"rectangular">;
        reels: z.ZodNumber;
        rows: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"variable_rows">;
        reels: z.ZodNumber;
        row_range_per_reel: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
        ways_cap: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"cluster_grid">;
        columns: z.ZodNumber;
        rows: z.ZodNumber;
        adjacency: z.ZodEnum<{
            orthogonal: "orthogonal";
            diagonal: "diagonal";
            hex: "hex";
        }>;
    }, z.core.$strict>], "kind">;
    symbols: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        kind: z.ZodEnum<{
            transform: "transform";
            lp: "lp";
            hp: "hp";
            wild: "wild";
            scatter: "scatter";
            bonus: "bonus";
            multiplier: "multiplier";
            sticky: "sticky";
            expanding: "expanding";
            mystery: "mystery";
            chain_wild: "chain_wild";
        }>;
        substitutes: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodLiteral<"*">]>>;
        weight_hint: z.ZodOptional<z.ZodNumber>;
        appears_on: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        behavior: z.ZodOptional<z.ZodObject<{
            colossal_size: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
            behavior_type: z.ZodOptional<z.ZodEnum<{
                sticky: "sticky";
                expanding_full_reel: "expanding_full_reel";
                walking: "walking";
                transforming: "transforming";
                collecting: "collecting";
                mystery_reveal: "mystery_reveal";
                colossal: "colossal";
            }>>;
            transform_target: z.ZodOptional<z.ZodString>;
            collection_priority: z.ZodOptional<z.ZodNumber>;
            sticky_duration_spins: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    reels: z.ZodDiscriminatedUnion<[z.ZodObject<{
        mode: z.ZodLiteral<"weighted">;
        base: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        free_spins: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>>>;
    }, z.core.$strict>, z.ZodObject<{
        mode: z.ZodLiteral<"strips">;
        base: z.ZodArray<z.ZodArray<z.ZodString>>;
        free_spins: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodString>>>;
    }, z.core.$strict>], "mode">;
    evaluation: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"lines">;
        paylines: z.ZodArray<z.ZodArray<z.ZodNumber>>;
        direction: z.ZodEnum<{
            ltr: "ltr";
            rtl: "rtl";
            both: "both";
        }>;
        min_match: z.ZodNumber;
        pay_left_to_right_only: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"ways">;
        direction: z.ZodEnum<{
            ltr: "ltr";
            rtl: "rtl";
            both: "both";
        }>;
        min_match: z.ZodNumber;
        max_ways_per_spin: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"cluster">;
        min_cluster_size: z.ZodNumber;
        cluster_pay_table: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"pay_anywhere">;
        min_count: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"pattern">;
        patterns: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            positions: z.ZodUnion<readonly [z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>, z.ZodLiteral<"all">]>;
            pay_multiplier: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>], "kind">;
    paytable: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodNumber>>;
    features: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"free_spins">;
        trigger: z.ZodObject<{
            by: z.ZodEnum<{
                scatter_count: "scatter_count";
                bonus_count: "bonus_count";
                special_count: "special_count";
            }>;
            thresholds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            min: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        retrigger: z.ZodOptional<z.ZodObject<{
            by: z.ZodEnum<{
                scatter_count: "scatter_count";
                bonus_count: "bonus_count";
                special_count: "special_count";
            }>;
            thresholds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            min: z.ZodOptional<z.ZodNumber>;
            max_total: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        global_multiplier: z.ZodOptional<z.ZodNumber>;
        modifiers: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            sticky_wilds: "sticky_wilds";
            expanding_wilds: "expanding_wilds";
            multiplier_ladder: "multiplier_ladder";
            mystery_symbol: "mystery_symbol";
        }>>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"hold_and_win">;
        trigger: z.ZodObject<{
            by: z.ZodEnum<{
                scatter_count: "scatter_count";
                bonus_count: "bonus_count";
                special_count: "special_count";
            }>;
            thresholds: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            min: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>;
        respins_initial: z.ZodNumber;
        respin_reset_on_new: z.ZodBoolean;
        cash_value_distribution: z.ZodArray<z.ZodObject<{
            value: z.ZodNumber;
            weight: z.ZodNumber;
        }, z.core.$strict>>;
        jackpot_tiers: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            multiplier: z.ZodNumber;
        }, z.core.$strict>>;
        grid_full_award: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"cascade">;
        replacement: z.ZodEnum<{
            drop: "drop";
            refill_random: "refill_random";
            fixed_strip: "fixed_strip";
        }>;
        max_chain: z.ZodNumber;
        multiplier_progression: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"respin">;
        cost_x: z.ZodNumber;
        max_uses_per_spin: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"pick">;
        prize_pool: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            weight: z.ZodNumber;
            pay_multiplier: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"wheel">;
        segments: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            weight: z.ZodNumber;
            pay_multiplier: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"buy_feature">;
        offers: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            cost_x: z.ZodNumber;
            guaranteed: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"ante_bet">;
        extra_multiplier: z.ZodNumber;
        enabled_by_default: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"gamble">;
        type: z.ZodEnum<{
            red_black: "red_black";
            suit: "suit";
        }>;
        max_steps: z.ZodNumber;
        tie_resolution: z.ZodEnum<{
            push: "push";
            house: "house";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"mystery_symbol">;
        symbol_id: z.ZodString;
        reveal_distribution: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"symbol_upgrade">;
        from: z.ZodString;
        to: z.ZodString;
        probability: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"linear_progressive">;
        pool_id: z.ZodString;
        contribution_per_spin_x: z.ZodNumber;
        seed_x: z.ZodNumber;
        must_hit_by_x: z.ZodOptional<z.ZodNumber>;
        tier_ladder: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            multiplier: z.ZodNumber;
        }, z.core.$strict>>>;
        external_pool_ref: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>], "kind">>;
    rng: z.ZodObject<{
        kind: z.ZodEnum<{
            mulberry32: "mulberry32";
            pcg64: "pcg64";
            xoshiro256pp: "xoshiro256pp";
            aes_ctr_drbg: "aes_ctr_drbg";
        }>;
        default_seed: z.ZodNumber;
        jump_function: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    bet: z.ZodObject<{
        currency: z.ZodString;
        base_bet: z.ZodNumber;
        denominations: z.ZodArray<z.ZodNumber>;
        ante_bet: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodBoolean;
            extra_multiplier: z.ZodNumber;
        }, z.core.$strict>>;
        buy_feature: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            cost_x: z.ZodNumber;
            guaranteed: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    limits: z.ZodObject<{
        target_rtp: z.ZodNumber;
        rtp_tolerance: z.ZodNumber;
        max_win_x: z.ZodNumber;
        win_cap_apply: z.ZodEnum<{
            per_spin: "per_spin";
            per_feature_session: "per_feature_session";
        }>;
        target_volatility: z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
            ultra: "ultra";
        }>;
        hit_freq_target: z.ZodNumber;
    }, z.core.$strict>;
    compliance: z.ZodObject<{
        jurisdictions: z.ZodArray<z.ZodString>;
        rtp_range_required: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
        max_win_cap_required: z.ZodNumber;
        near_miss_rule: z.ZodEnum<{
            must_be_random: "must_be_random";
            allowed_within_distribution: "allowed_within_distribution";
        }>;
        ldw_disclosure: z.ZodBoolean;
        session_time_display: z.ZodBoolean;
    }, z.core.$strict>;
    rtp_allocation: z.ZodObject<{
        base_game: z.ZodNumber;
        free_spins: z.ZodNumber;
        hold_and_win: z.ZodNumber;
        jackpot: z.ZodNumber;
        tolerance: z.ZodNumber;
    }, z.core.$strict>;
    progressive_link: z.ZodOptional<z.ZodObject<{
        pool_id: z.ZodOptional<z.ZodString>;
        contribution_per_spin_x: z.ZodNumber;
        seed_x: z.ZodNumber;
        must_hit_by_x: z.ZodOptional<z.ZodNumber>;
        tier_ladder: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            multiplier: z.ZodNumber;
        }, z.core.$strict>>>;
        reset_rule: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    jurisdiction_overrides: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        target_rtp: z.ZodOptional<z.ZodNumber>;
        max_win_x: z.ZodOptional<z.ZodNumber>;
        min_spin_time_ms: z.ZodOptional<z.ZodNumber>;
        max_bet_x: z.ZodOptional<z.ZodNumber>;
        feature_toggles: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
        compensated_mode: z.ZodOptional<z.ZodBoolean>;
        force_ldw_disclosure: z.ZodOptional<z.ZodBoolean>;
        autoplay_forbidden: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>>;
    persistent_state: z.ZodOptional<z.ZodObject<{
        fields: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            kind: z.ZodEnum<{
                boolean: "boolean";
                symbol: "symbol";
                multiplier: "multiplier";
                counter: "counter";
                accumulator: "accumulator";
            }>;
            default: z.ZodOptional<z.ZodNumber>;
            reset_rule: z.ZodString;
            max_value: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        state_machine: z.ZodOptional<z.ZodObject<{
            states: z.ZodArray<z.ZodString>;
            initial_state: z.ZodString;
            transitions: z.ZodArray<z.ZodObject<{
                from: z.ZodString;
                to: z.ZodString;
                condition: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        scope: z.ZodEnum<{
            spin: "spin";
            session: "session";
            account: "account";
        }>;
    }, z.core.$strict>>;
    provenance: z.ZodOptional<z.ZodObject<{
        vendor: z.ZodString;
        par_source: z.ZodString;
        swid: z.ZodOptional<z.ZodString>;
        par_sha256: z.ZodString;
        ir_sha256: z.ZodOptional<z.ZodString>;
        build_hash: z.ZodOptional<z.ZodString>;
        built_at_utc: z.ZodOptional<z.ZodString>;
        signed_by: z.ZodOptional<z.ZodString>;
        signature: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$loose>;
export type SlotGameIRZType = z.infer<typeof SlotGameIRZ>;
//# sourceMappingURL=schema.d.ts.map