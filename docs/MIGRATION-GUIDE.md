# Migration guide — bumping `MODEL_SCHEMA_VERSION`

> **Audience:** maintainers landing a schema change to the parsed
> model.json shape. Created by UQ-U-8 P1 after U-8-D #8 flagged
> that the inline JSDoc was excellent but undiscoverable to a fresh
> contributor.

## Semver policy (recap)

```
MAJOR  — removed field, renamed field, changed value semantics
         (e.g. topology.evaluation: null no longer means "lines").
         Forces an explicit migration in modelMigrations.mjs.

MINOR  — added field with a safe default (older models still load
         without migration; the field gets default-resolved).
         Migration optional but recommended.

PATCH  — bugfix that does NOT change the shape (e.g. coercion
         tightening, validation guard). No migration needed.
```

The current version lives in `src/registry/modelSchemaVersion.mjs`
as the constant `MODEL_SCHEMA_VERSION` (single source of truth).

## When to bump

| Trigger                                         | Bump |
|:------------------------------------------------|:----:|
| Add a new field with safe default               | MINOR |
| Rename or remove an existing field              | MAJOR |
| Change the semantics of an existing field       | MAJOR |
| Fix a coercion bug or tighten a validation      | PATCH |
| Add a new block that emits a new top-level key  | MINOR |

## How to bump (step-by-step)

1. **Pick the new version** per the policy above.

2. **Edit `src/registry/modelSchemaVersion.mjs`:**

   ```js
   export const MODEL_SCHEMA_VERSION = '1.1.0';  // was '1.0.0'
   ```

3. **Add a migration in `src/registry/modelMigrations.mjs`:**

   ```js
   register('1.0.0', '1.1.0', (model) => ({
     ...model,
     newField: defaultForNewField(),
     __schema__: { ...model.__schema__, version: '1.1.0' },
   }));
   ```

   Rules every migration MUST follow:
   - **Pure function** — `(model) => model'`. Never mutate input.
   - **Idempotent** — running twice produces the same result as once.
   - **Preserves every recognised field** — drop only what the new
     schema explicitly removes.
   - **Stamps the new `__schema__` envelope** — the runner verifies
     this and throws if `actualVer !== expectedTo`.

4. **Add a contract test in `tests/_modelSchema.test.mjs`:**

   ```js
   t('migrate(): 1.0.0 → 1.1.0 adds newField with safe default', () => {
     const m = migrate({ name: 'X', __schema__: { version: '1.0.0' } });
     assert.equal(m.__schema__.version, '1.1.0');
     assert.equal(m.newField, defaultForNewField());
   });
   ```

5. **Sweep persisted models:**

   ```sh
   # Stamps every dist/real-games/<slug>/model.json + every cache file.
   node tools/_audit-model-schema.mjs --migrate --quiet
   # Verifies.
   node tools/_audit-model-schema.mjs --strict
   ```

6. **Run the local gate:**

   ```sh
   npm run verify:quick
   ```

7. **Commit + push.** CI runs `test:model-schema` + `audit:ixf` and
   blocks the PR if anything drifts.

## Multi-step migrations

If you need to land 1.0.0 → 1.1.0 → 1.2.0, register both edges:

```js
register('1.0.0', '1.1.0', up0);
register('1.1.0', '1.2.0', up1);
```

The BFS planner in `planMigration()` (UQ-U-2 #10) automatically finds
the shortest path. For a one-shot 1.0.0 → 1.2.0 shortcut, register
that edge AND the intermediate ones; BFS picks the shortest, which is
typically the direct one.

## What NOT to do

- ❌ **Don't downgrade.** `planMigration` throws on
  `compareSemver(from, to) > 0`. There's no rollback path.
- ❌ **Don't mutate `_registry` after module load.** Tests can use
  `_resetRegistryForTests(keepBuiltins=true)` to clean up probe
  migrations, but production code must not poke at the Map.
- ❌ **Don't skip the contract test.** Even a no-op migration (just
  bumps the stamp) needs a test that exercises the migration path
  end-to-end.
- ❌ **Don't bump `MODEL_SCHEMA_VERSION` without registering the
  migration.** `migrate()` will throw "no migration path" the first
  time a 1.0.0 model lands on a 1.1.0 reader.

## See also

- `src/registry/modelSchemaVersion.mjs` — inline JSDoc with examples
- `src/registry/modelMigrations.mjs` — runner + planner contract
- `tools/migrate-model.mjs` — CLI driver (--in / --out / --to / --dry-run)
- `tools/_audit-model-schema.mjs` — bulk migration walker
- `docs/OPERATIONS.md` — debugging schema drift
