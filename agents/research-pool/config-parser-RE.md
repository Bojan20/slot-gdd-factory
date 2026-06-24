# `industry standard/config-parser` — Deep Reverse-Engineering Report

> **Scope**: full RE of the repo at `~/industry standard/config-parser` (~ 660 KB on disk, ~ 200 LOC of
> hand-written TypeScript in `src/`, the rest is `yarn.lock` + test fixtures + compiled `bin/`).
>
> **Document version**: 1.0 · 2026-06-16
> **Repo version under analysis**: `1.0.2` (per `package.json:3`, last CHANGELOG entry `2021-10-21`).
> **Audience**: `slot-gdd-factory` parser team — concrete patterns to lift, IR shape to match,
> pitfalls to avoid.
>
> **Critical framing up-front** (so §6/§7/§8 land correctly): this repo is **NOT** a slot-math
> transpiler. The original task prompt described it as "JSON → SQL transpiler that takes paytable
> + reels + features JSON config and emits `load_gc_<swid>_data.sql` for industry standard casino database
> loaders". After reading every file, this is **only half-correct**. The repo is a **client
> manifest transpiler**: it converts a per-game `config.json` (channel × presentation × technology
> × screen-dimensions matrix) plus the host repo's `package.json` (game family id, software id
> list, version, name) into a Postgres `DO $$ … END; $$` block that calls three stored
> procedures on the RGS (Remote Game Server) game-catalog schema. There is **NO paytable, NO
> reel-strip, NO RTP target, NO max-win cap, NO scatter pay** inside the config.json schema.
> Sections §2 and §3 of the original prompt are therefore reframed as "what IS in the IR" plus
> an explicit NOT-FOUND inventory for the slot-math fields the prompt expected.
>
> This finding is itself the single most important deliverable for SGF — see §6 and §8.

---

## §1. Repo skeleton + build

### §1.1 Directory tree (top 3 levels)

```
~/industry standard/config-parser/
├── .git/
├── .gitignore
├── .vscode/
│   └── launch.json
├── CHANGELOG.md
├── Jenkinsfile
├── README.md
├── bin/                            ← compiled output (committed for npm publish convenience)
│   ├── src/
│   │   ├── constants.{js,d.ts,js.map}
│   │   ├── generate.{js,d.ts,js.map}
│   │   ├── index.{js,d.ts,js.map}
│   │   └── write.{js,d.ts,js.map}
│   └── tests/
│       ├── defaultValueTest.{js,d.ts,js.map}
│       ├── errorTest.{js,d.ts,js.map}
│       ├── multipleSoftwareIDsTest.{js,d.ts,js.map}
│       ├── withEnableReplayTest.{js,d.ts,js.map}
│       └── withoutEnableReplayTest.{js,d.ts,js.map}
├── package.json
├── src/                            ← hand-written source (≈ 200 LOC total)
│   ├── constants.ts                 (37 lines)
│   ├── generate.ts                  (142 lines, the actual transpiler)
│   ├── index.ts                     (31 lines, CLI entry point)
│   └── write.ts                     (13 lines, fs sink)
├── tests/
│   ├── defaultValueTest.ts
│   ├── errorTest.ts
│   ├── multipleSoftwareIDsTest.ts
│   ├── withEnableReplayTest.ts
│   ├── withoutEnableReplayTest.ts
│   └── resources/
│       ├── defaultValues/{empty,nonExistentGameFolder}/{config.json,package.json,expected.sql}
│       ├── errors/{invalidGameID,missingClientCode}/{config.json,package.json}
│       ├── multipleSoftwareIDs/{oneSoftwareIDWithoutReplay,twoSoftwareIDsWithReplay,
│       │   threeSoftwareIDsWithoutReplay}/{config.json,package.json,expected*.sql}
│       └── replay/{withEnableReplay,withoutEnableReplay}/{config*.json,package.json,
│           expected*.sql}
├── tsconfig.json
├── tslint.json
└── yarn.lock                       (≈ 68 KB — dominates the 660 KB repo size)
```

**Observations**:

- The repo is ~ 660 KB only because `yarn.lock` is checked in (`yarn.lock:1-* ≈ 68681 bytes`,
  `~/industry standard/config-parser/yarn.lock`). Total **hand-written TypeScript = 223 lines** spread across
  4 files in `src/`. This is a tiny utility, not a heavyweight transpiler.
- `bin/` is committed — `package.json:21-23` ships only `bin/` to npm and `package.json:5` points
  `main` at `bin/src/index.js`. No bundler (no webpack, no rollup) — plain `tsc` output.
- No `lib/`, no `dist/`, no `src/parsers/`, no `src/sql/` subfolders. The four source files are
  the entire program.

### §1.2 `package.json` scripts and build pipeline

`package.json:1-45`:

| Field                  | Value                                                                                 | Notes |
|:-----------------------|:--------------------------------------------------------------------------------------|:------|
| `name`                 | `config-parser`                                                                       | `package.json:2` |
| `version`              | `1.0.2`                                                                               | `package.json:3` |
| `description`          | `Parses json file with configuration into a sql file, load_gc_${software id}_data.sql`| `package.json:4` |
| `main`                 | `bin/src/index.js`                                                                    | `package.json:5` |
| `typings`              | `bin/src/index.d.ts`                                                                  | `package.json:6` |
| `bin.parseconfig`      | `bin/src/index.js`                                                                    | `package.json:14` — installs CLI as `parseconfig` |
| `scripts.compile`      | `rimraf bin/ && tsc`                                                                  | `package.json:8` |
| `scripts.test`         | `mocha -r ts-node/register tests/**/*Test.ts`                                         | `package.json:9` |
| `scripts.coverage`     | `nyc -r html -e .ts -x "*.test.ts" yarn run test`                                     | `package.json:10` |
| `scripts.start`        | `bin/src/index.js`                                                                    | `package.json:11` |
| `files` (npm publish)  | `["bin"]`                                                                             | `package.json:21-23` — only `bin/` ships |
| `repository.url`       | `git+https://github.com/igtinteractive/config-parser`                                  | `package.json:24-27` |

**Runtime dependencies** (`package.json:41-44`): only two —
- `colors ^1.4.0` (terminal color, **imported but never used** — see §5.3 below)
- `commander ^7.0.0` (CLI arg parsing — `index.ts:8`)

**Dev dependencies** (`package.json:29-39`): `@types/chai`, `@types/mocha`, `@types/node@14.14.31`,
`chai ^4.3.4`, `mocha ^8.3.2`, `nyc ^15.1.0`, `rimraf ^3.0.2`, `ts-node ^9.1.1`, `typescript
^4.2.3`. Pinned `colors` and `commander` are repeated under `devDependencies` (likely vestigial).

### §1.3 `tsconfig.json` analysis

`tsconfig.json:1-25`:

- `target: es5` — generates ES5 JS, so the published `bin/` runs on any modern Node.
- `module: commonjs`, `moduleResolution: node` — standard CJS.
- `experimentalDecorators: true` — **unused** in source (no decorators present).
- `noImplicitAny: false` — explains the `function parseChannelPresentation(gameClient)` style
  with no parameter types (`generate.ts:4`).
- `removeComments: true`, `preserveConstEnums: true`, `sourceMap: true`, `declaration: true`.
- `outDir: bin` — matches `bin/src/*.js` layout.
- `types: ["node", "mocha", "chai"]` (`tsconfig.json:15-18`).
- `exclude: ["test", "**/*.d.ts", "bin", "node_modules"]` — note `test` not `tests`; likely a
  legacy entry that no longer applies but is harmless.
- `env: "node"` at the top level (`tsconfig.json:2`) — **non-standard tsconfig key**, ignored by
  `tsc`. Probably copied from an older boilerplate.

### §1.4 `tslint.json` analysis

`tslint.json:1-125`. Extends `tslint:latest`. Notable rules:
- `quotemark: single` (`tslint.json:84-87`) — matches single-quote style used everywhere.
- `triple-equals: allow-null-check` (`tslint.json:89-91`) — allows `== null` shortcut.
- `max-line-length: 140` (`tslint.json:27-30`).
- `member-ordering`: static-field → instance-field → constructor → protected → private
  (`tslint.json:32-43`) — not exercised because there are zero classes in `src/`.
- `import-blacklist: ["rxjs"]` (`tslint.json:17-20`) — RGS-team policy.
- TSLint is deprecated upstream; this repo predates the TSLint→ESLint migration.

### §1.5 `Jenkinsfile` (CI/CD pipeline)

`Jenkinsfile:1-59`:

1. Agent: `jenkins-slave-nodejs` (`Jenkinsfile:2`).
2. **prepare** stage (`Jenkinsfile:8-14`): `yarn install` with `NEXUS_READ` credential injected
   via `withNPM` block — repo pulls from industry standard internal Nexus mirror.
3. **compile** stage (`Jenkinsfile:16-22`): `yarn compile` → `rimraf bin/ && tsc`.
4. **test and coverage** stage (`Jenkinsfile:24-30`): `yarn coverage` (nyc + mocha).
5. **publish** stage (`Jenkinsfile:32-45`): only when `BRANCH_NAME == 'master'`, runs `yarn
   publish --non-interactive` against `NEXUS_PUSH` credential.
6. **post.always** (`Jenkinsfile:47-58`): publishes the nyc HTML coverage report as a Jenkins
   artifact.

So this is a private-Nexus-published artifact, not on public npm.

### §1.6 Entry points (CLI, library exports)

**CLI** (`package.json:14`):
- Binary name `parseconfig`, points at `bin/src/index.js`.
- Implementation: `src/index.ts:1-31` (compiled to `bin/src/index.js`).
- Shebang `#!/usr/bin/env node` (`index.ts:1`).

**Library export surface** (per `package.json:5-6`, `main = bin/src/index.js`):
- `bin/src/index.js` has no `module.exports` — it is **side-effect-only** (reads `argv`, calls
  generate, writes files, exits). Therefore the published npm package is callable **only as a
  CLI**. There is no first-class `require('config-parser')` API.
- However, the per-file modules ARE importable from inside the same monorepo (used by tests):
  `tests/defaultValueTest.ts:2` does `import * as generate from '../src/generate'`, and
  `errorTest.ts:2`, `multipleSoftwareIDsTest.ts:2`, `withEnableReplayTest.ts:2`,
  `withoutEnableReplayTest.ts:3` follow the same pattern.

### §1.7 Test layout

`tests/*.ts` are mocha + chai. The test runner script (`package.json:9`) is
`mocha -r ts-node/register tests/**/*Test.ts`. Five test files, covering:

| Test file                          | What it asserts                                                                            |
|:-----------------------------------|:-------------------------------------------------------------------------------------------|
| `defaultValueTest.ts`              | empty `config.json` → fallback values (`0`, `NULL`, derived gameName).                    |
| `errorTest.ts`                     | throws on invalid game id format and missing `code` on a gameClient entry.                 |
| `multipleSoftwareIDsTest.ts`       | one / two / three software-id IDs in `package.json.id` → one SQL file per id.              |
| `withEnableReplayTest.ts`          | `enableReplay: "Y"` and `"N"` get reflected in the second stored-proc call.                |
| `withoutEnableReplayTest.ts`       | absent `enableReplay` field → defaults to `N` (post-1.0.1 behaviour).                      |

All tests use file-system fixtures under `tests/resources/`. There is NO unit test of helpers
in `generate.ts` (`parseChannelPresentation`, `generateString`, `constructSQL`); coverage is
end-to-end through `generate.content()`.

---

## §2. JSON input schema (the "IR")

> The original task prompt expected paytable / reel-strips / features fields. **They do not
> exist in this repo.** The "IR" of config-parser is a per-channel client manifest, not a slot
> model. Every field is documented below, then §2.8 lists what is NOT in the schema.

### §2.1 Top-level shape of `config.json`

From `tests/resources/defaultValues/empty/config.json:1-28` and all other fixtures, the canonical
shape is:

```jsonc
{
  "enableReplay": "Y" | "N",            // optional, default "N" (see §2.3)
  "gameClient": [                       // required, ≥ 1 entry
    {
      "code":           "<string>",     // required, see §2.4
      "channel":        "<string>",     // required, see §2.5
      "presentation":   "<string>",     // required, see §2.5
      "technology":     "<string>",     // required, see §2.6
      "height":         "<numstring>",  // optional, default "0"
      "width":          "<numstring>",  // optional, default "0"
      "meterheight":    "<numstring>",  // optional, default "0"
      "meterwidth":     "<numstring>",  // optional, default "0"
      "gameFolder":     "<string>",     // optional, default derived from package.json.name
      "enableFreeSpin": "Y" | "N" | ""  // optional, default NULL (see §2.7)
    }
  ]
}
```

That is the **entire input schema**. No nesting beyond `gameClient[]`, no math, no reels.

### §2.2 Top-level fields

| Field          | Type                  | Required | Source citation                                                                 |
|:---------------|:----------------------|:--------:|:--------------------------------------------------------------------------------|
| `enableReplay` | `"Y"` \| `"N"` (str)  | optional | `generate.ts:129` reads `configJson.enableReplay`; fixture: `replay/withEnableReplay/configYes.json:2` |
| `gameClient`   | `Array<ClientEntry>`  | required | `generate.ts:132` calls `parseChannelPresentation(configJson.gameClient)`; iterated again at `generate.ts:133` |

**No other top-level keys are read.** `grep -nE "configJson\\." src/generate.ts` shows only two
hits (line 129 for `enableReplay`, line 132 for `gameClient`). Any extra keys in `config.json`
are silently ignored — there is no schema validator.

### §2.3 `enableReplay` semantics

- Per `generate.ts:129`: `const replay = configJson.enableReplay ? configJson.enableReplay : "NULL";`
- Per `generate.ts:87-91` (inside `constructSQL`): `if (replay != "NULL") { script += ... + replay + ... } else { script += ... + 'N' ... }`.
- Net effect: absent → emits `'N'`; present "Y" → emits `'Y'`; present "N" → emits `'N'`.
- Defaulting to `'N'` was **changed in 1.0.1** (`CHANGELOG.md:14-16`): "Replay insert is generated
  regardless if replay flag exist or not in config.json. If non-existent it will set to N."
- The 0.1.0 release added the field originally (`CHANGELOG.md:24-26`).
- **Boolean encoded as Y/N strings**, never as JSON `true`/`false`.

### §2.4 `gameClient[].code` — channel/presentation key

- **Required**. Per `generate.ts:8-9`: `if (!Boolean(client.code)) { throw new Error('Client code attribute is missing'); }`. Throws on empty string or missing key (because `Boolean("") === false`).
- Acts as a **map key** for the channel-presentation map (`generate.ts:5-13`). The SQL output
  doesn't actually use `code` for the chnlpres tuple — it uses `channel` and `presentation` —
  but `code` is emitted again in `clientConfigString[2]` as the third `lookup_typ(...)` argument
  (`generate.ts:56`).
- Observed values across all fixtures (`tests/resources/**/config.json`): `mobile`, `tablet`,
  `desktop`, `tabletmini`, `desktopmini`. So in practice it is a device/form-factor token.

### §2.5 `gameClient[].channel` and `.presentation` — RGS catalog tuple

- Both are **required** by data contract (not by code — no validator throws if either is missing).
  If absent they emit `undefined` into the SQL string via plain JS concatenation.
- Combined into the channel-presentation `Map<code, string>` at `generate.ts:11`:
  ```js
  channelPresentationMap.set(
    client.code,
    '\'' + client.channel + '\', \'' + client.presentation + '\','
  );
  ```
- Observed channel values: `MOB` (mobile), `TAB` (tablet), `INT` (interactive / desktop).
- Observed presentation values: `STD` (standard), `MIN` (mini / scaled).
- The pair `(channel, presentation)` is the RGS-side catalog key for "what dimensions of the
  game client are we describing".

### §2.6 `gameClient[].technology` — render tech

- Used at `generate.ts:55`: `clientConfigString[1] += '\'' + client.technology + '\'' + ',';`.
- Emitted as the first `lookup_typ(...)` block (`generate.ts:21`, `constants.ts:22`).
- Observed values across **all** fixtures: only `HTML`. Originally the repo predates the
  channel-presentation rollup — per `CHANGELOG.md:30-32` ("Assumes channel presentation has been
  rolled into game client", 2021-02-08). Earlier versions had a separate `channelPresentation`
  config; now it lives inline on every gameClient entry.

### §2.7 Dimensional + behavioural fields on `gameClient[]`

| Field            | Coercion path                                                                  | Default | Notes |
|:-----------------|:-------------------------------------------------------------------------------|:-------:|:------|
| `height`         | `client.height === "" ? "0" : client.height` (`generate.ts:33`)                | `"0"`   | Emitted as bare numeric literal in SQL (e.g. `768`) — not quoted, see §3.4. |
| `width`          | `client.width === "" ? "0" : client.width` (`generate.ts:34`)                  | `"0"`   | Same. |
| `meterheight`    | `client.meterheight === "" ? "0" : client.meterheight` (`generate.ts:35`)      | `"0"`   | Meter UI height in pixels. |
| `meterwidth`     | `client.meterwidth === "" ? "0" : client.meterwidth` (`generate.ts:36`)        | `"0"`   | Meter UI width in pixels. |
| `gameFolder`     | `Boolean(client.gameFolder) ? '\'' + client.gameFolder + '\'' : gameName` (`generate.ts:37-40`) | derived | Empty string OR missing → derived (see §2.9). 1.0.2 made the attribute optional (`CHANGELOG.md:8`). |
| `enableFreeSpin` | `client.enableFreeSpin === "" ? "NULL" : '\'' + client.enableFreeSpin + '\''` (`generate.ts:42`) | `NULL` (SQL keyword) | `Y` / `N` / `""`. **Important**: empty string `""` collapses to SQL `NULL`, NOT to `'N'`. |

**Defaults discovery**: all four `… === "" ? "0" : …` checks treat empty string as falsy, but
**not** `undefined`. So a `config.json` that omits a key entirely will inject `undefined` into
the SQL string (`'' + undefined === "undefined"`). The empty-string convention is what fixtures
use (`defaultValues/empty/config.json:8-13`), so this path is exercised; the missing-key path
is **not exercised** by any test.

### §2.8 `package.json` (sibling input) — second IR file

`generate.ts:111-141` reads two files: `jsonPath` (the `config.json`) **and** `packageDir +
'/package.json'` (the host game's package.json). The package.json provides:

| Field        | Used at                            | Semantics                                                                       |
|:-------------|:-----------------------------------|:--------------------------------------------------------------------------------|
| `name`       | `generate.ts:30`                   | Game name. PascalCase'd, hyphens stripped, single-quoted → fallback `gameFolder`. |
| `id`         | `generate.ts:119-127`              | Software-id list, comma-separated `FAM-GAME-SWID` tuples (see §2.10).            |
| `version`    | `generate.ts:130`                  | Game client version string. Falsy → `"NULL"` SQL keyword.                       |

Anything else in `package.json` (dependencies, scripts, etc.) is ignored.

### §2.9 Derived `gameName` (PascalCase transformer)

`generate.ts:24-30`:

```ts
let gameName = (function (gameName) {
  return '\'' + gameName.replace(
    /\w*/g,
    function(txt) {
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    }).replace(/-/g, "") + '\'';
}) (packageJson.name);
```

- Title-cases every `\w*` run (so `playa-slot-template` → `Playa-Slot-Template`).
- Then strips ALL `-` characters → `PlayaSlotTemplate`.
- Wraps in single quotes for SQL literal.
- Verified by `defaultValues/empty/expected.sql:7` showing `'PlayaSlotTemplate'` as the
  gameFolder fallback when the mobile gameClient entry has `"gameFolder": ""`.

### §2.10 Software-id parsing — `package.json.id`

`generate.ts:119-128`:

```ts
let gameIDs = packageJson.id;
let gameIDArray = gameIDs.split(",");
for (var index in gameIDArray) {
  let gameIdParts = gameIDArray[index].split('-');
  if (gameIdParts.length != 3) {
    throw new Error('invalid game id');
  }
  let familyId = gameIdParts[1];
  let gameNumber = gameIdParts[2];
  ...
}
```

- Format per id: `<segment0>-<familyId>-<gameNumber>`. Segment 0 is **discarded** (see fixture:
  `package.json:5` has `"id": "200-1389-0"` — `200` is unused, `1389` is the family, `0` is the
  software id). Any segment count != 3 → throws `"invalid game id"`.
- Multiple ids: comma-separated. Fixture
  `multipleSoftwareIDs/threeSoftwareIDsWithoutReplay/package.json:5`:
  `"id": "200-1389-2,200-1389-3,200-1389-9"`. The transpiler then emits **three SQL files**
  (one per id) — verified by `expected_2.sql`, `expected_3.sql`, `expected_9.sql` in that dir.
- **Multi-id capability was added in 1.0.0** (`CHANGELOG.md:18-21`).
- Per-id `familyId` and `gameNumber` are the only segments that survive into SQL output —
  family becomes the first stored-proc arg, gameNumber the second.

### §2.11 NOT FOUND in the IR (the slot-math fields the prompt expected)

> Original task prompt requested coverage of: "reel set definitions (strips, weights, stop
> tables); paytable structure (symbol IDs, pay rules, line definitions, way definitions); feature
> configuration (free spins, bonus, hold-and-respin, mystery, scatter pay); math metadata (RTP
> target, volatility class, max win cap); localization / jurisdictional flags."
>
> **None of these are present in the config-parser repo.** This is an unambiguous, code-verified
> finding, not "I didn't look hard enough".

Candidate locations checked (Grep + Read):

| Concept                | Searched for                                              | Result      |
|:-----------------------|:----------------------------------------------------------|:-----------:|
| Reel strips            | `reel`, `strip`, `stop` keys in any `.json` under `tests/resources/` | NOT FOUND |
| Paytable               | `pay`, `payline`, `payway`, `paytable` keys in `.json` fixtures | NOT FOUND |
| Symbol IDs             | `symbol`, `sym` in `.json` fixtures                       | NOT FOUND   |
| Free-spin trigger      | `trigger`, `freeSpin`, `freespin`, `scatter` in source/fixtures (only `enableFreeSpin` boolean flag exists, `generate.ts:42`) | NOT FOUND beyond the boolean |
| Bonus / hold-and-respin| `bonus`, `respin`, `holdAndSpin` anywhere                 | NOT FOUND   |
| RTP                    | `rtp` in any file                                         | NOT FOUND   |
| Volatility             | `volatility`, `variance` in any file                      | NOT FOUND   |
| Max win cap            | `cap`, `maxWin`, `winCap` in any file                     | NOT FOUND   |
| Jurisdictional flags   | `jurisdiction`, `licence`, `license`, `regulator`, `region` keys | NOT FOUND |
| Localization           | `locale`, `i18n`, `currency` keys                         | NOT FOUND   |

**Implication for SGF**: the SGF parser (`src/parser.mjs`) does in fact already cover most of
this surface (topology, paytable, features, RTP confidence). The config-parser repo is **not a
math model carrier** — it is a deployment manifest. The IR shape we should look at for math is
elsewhere (likely a separate industry standard internal repo for the math engine; see §6 and §8 for what to
do about this finding).

### §2.12 Fixture-derived IR enumerations (observed value space)

| Field              | Observed values (across all fixtures)                                  |
|:-------------------|:-----------------------------------------------------------------------|
| `code`             | `mobile`, `tablet`, `desktop`, `tabletmini`, `desktopmini`             |
| `channel`          | `MOB`, `TAB`, `INT`                                                    |
| `presentation`     | `STD`, `MIN`                                                           |
| `technology`       | `HTML` (only)                                                          |
| `enableFreeSpin`   | `Y`, `""` (empty)                                                      |
| `enableReplay`     | `Y`, `N`, absent                                                       |
| `height`/`width`   | `"768"`/`"1024"` (STD), `"320"`/`"480"` (MIN), `""` (empty)            |
| `meterheight`      | `"0"`, `""`                                                            |
| `meterwidth`       | `"10"`, `""`                                                           |
| `gameFolder`       | `"PlayaSlotTemplate"`, `"TestFolder"`, `""`, absent                    |

Note: all dimensional fields are **stringified numbers**, not real JSON numbers. This matters
for downstream type coercion (see §4.2).

---

## §3. SQL emission strategy

### §3.1 Output filename pattern

`generate.ts:135`:

```ts
path: 'gameDataFile/' + constants.SQL_FILE_NAME_PREFIX + '_' +
      familyId + '-' + gameNumber + '_' + constants.SQL_FILE_NAME_SUFFIX,
```

With `constants.ts:2-3`:
- `SQL_FILE_NAME_PREFIX = 'load_gc'`
- `SQL_FILE_NAME_SUFFIX = 'data.sql'`

Final filename pattern: `gameDataFile/load_gc_<familyId>-<gameNumber>_data.sql`.

Examples from tests:
- `gameDataFile/load_gc_1389-0_data.sql` (`defaultValueTest.ts:11`)
- `gameDataFile/load_gc_1389-1_data.sql` (`multipleSoftwareIDsTest.ts:11`)
- `gameDataFile/load_gc_1389-2_data.sql`, `1389-3`, `1389-9` (one per software id)

Note the task prompt said `load_gc_<swid>_data.sql` — actual format includes BOTH family AND
software id separated by `-`. The `<swid>` in the README (`README.md:21`) abbreviates the full
`<familyId>-<gameNumber>` tuple.

### §3.2 Output directory creation

`write.ts:3-7`:

```ts
export function createDirectory(outputDir) {
  if (!fs.existsSync('./' + outputDir)) {
    fs.mkdirSync('./' + outputDir);
  }
}
```

Uses CWD-relative path with leading `./`. Hardcoded to single-level mkdir (no recursive option),
so multi-level `outputDir` (`-o some/nested/dir`) will throw `ENOENT` on the parent.

Note also `constants.ts:1`: `OUTPUT_FOLDER = 'gameDataFile'`. And `index.ts:20` actually mis-reads
the option as `options.outPutDir` (capital P) — see §7.1 for the bug discussion.

### §3.3 SQL output structure (the emitted document)

Every output file is one PL/pgSQL anonymous block. Concatenated as a single template by
`constructSQL()` (`generate.ts:69-108`). The template is:

```sql
DO $$
DECLARE
  ln_Dummy integer;
BEGIN
  ln_Dummy := pgRgs_Game_fnRgs_InsUpdGameClientVersion('<familyId>', <gameNumber>, <version|NULL>);
  ln_Dummy := pgRgs_Game_fnRgs_Update_GameClientInfo('<familyId>', <gameNumber>, '<replay|N>');
  ln_Dummy := pgrgs_game_fnrgs_LoadchannelPtype('Y','<familyId>', <gameNumber>,
                GAME_CHNLPRES_TYP(
                  game_chnlpres_Obj('<channel>', '<presentation>', <width>, <height>, <meterwidth>, <meterheight>, '<gameFolder>', <enableFreeSpin>),
                  game_chnlpres_Obj(...),   -- one per gameClient[]
                  ...
                ),
                lookup_typ('<technology>', '<technology>', ...),
                lookup_typ('<code>', '<code>', ...),
                lookup_typ('<version>', '<version>', ...) -- or lookup_typ(NULL, NULL, ...)
              );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION USING
      errcode = '20999',
      message = 'LOADGAME: An error was encountered - 20999 -ERROR- '||SQLERRM;
END;
$$
```

Verified verbatim by `tests/resources/defaultValues/empty/expected.sql:1-15` and the other
`expected*.sql` fixtures.

### §3.4 Per-call mapping (JSON → stored procedure)

The transpiler calls three stored procedures, in a fixed order:

| Order | Stored procedure                              | Arguments produced from                                                                                | Source citation |
|:-----:|:----------------------------------------------|:-------------------------------------------------------------------------------------------------------|:----------------|
| 1     | `pgRgs_Game_fnRgs_InsUpdGameClientVersion`    | `(familyId, gameNumber, version?)` — version single-quoted if present, raw `NULL` keyword if absent. | `generate.ts:71-82`; constant at `constants.ts:9` |
| 2     | `pgRgs_Game_fnRgs_Update_GameClientInfo`      | `(familyId, gameNumber, replay)` — replay always quoted; defaults to `'N'`.                          | `generate.ts:83-91`; constant at `constants.ts:10` |
| 3     | `pgrgs_game_fnrgs_LoadchannelPtype`           | First positional arg literal `'Y'`. Then `(familyId, gameNumber, GAME_CHNLPRES_TYP(...), lookup_typ(...) × 3)`. | `generate.ts:93-104`; constant at `constants.ts:11` |

### §3.5 `GAME_CHNLPRES_TYP` collection-type emission

`constants.ts:12`: `SQL_gameChnlpres = "GAME_CHNLPRES_TYP"`.
`constants.ts:13`: `SQL_gameChnlpresObj = 'game_chnlpres_Obj'`.

Per gameClient entry, `generate.ts:44-53` emits:

```
game_chnlpres_Obj('<channel>', '<presentation>',<width>,<height>,<meterwidth>,<meterheight>,<gameFolder>,<enableFreeSpin>),
```

The trailing comma of the LAST emitted obj is then trimmed by
`gameClientString[0].substring(0, gameClientString[0].length - 1)` at `generate.ts:97`.
This is the **only trailing-comma cleanup** in the whole transpiler — there is no general join
helper.

**Field order inside `game_chnlpres_Obj(...)`** (positional, NOT named):

| Index | Source field          | Quoted? | Notes |
|:-----:|:----------------------|:-------:|:------|
| 1     | `channel`             | yes     | From map, double-emitted by `parseChannelPresentation()` |
| 2     | `presentation`        | yes     | Same — `generate.ts:11` |
| 3     | `width`               | no      | Bare numeric literal — `generate.ts:47` |
| 4     | `height`              | no      | Bare numeric literal — `generate.ts:48` |
| 5     | `meterwidth`          | no      | Bare numeric literal — `generate.ts:49` |
| 6     | `meterheight`         | no      | Bare numeric literal — `generate.ts:50` |
| 7     | `gameFolder`          | yes (or derived) | `generate.ts:37-40, 51` — fallback PascalCased name from `package.json.name` |
| 8     | `enableFreeSpin`      | yes (or `NULL` keyword) | `generate.ts:42, 52` — empty → bare `NULL`; present → quoted |

**Note `width` precedes `height`** in the SQL even though the JSON convention reads height first
on the `client.height`/`client.width` lines (`generate.ts:33-34`). This is a positional contract
with the Oracle/Postgres composite type and must be preserved exactly.

### §3.6 Three parallel `lookup_typ(...)` lists

`generate.ts:21-23` initialises three accumulators:

```ts
clientConfigString[1] = constants.SQL_LOOKUP_TYPE;  // 'lookup_typ('   — technology
clientConfigString[2] = constants.SQL_LOOKUP_TYPE;  //               — assetpack/clientcode
clientConfigString[3] = constants.SQL_LOOKUP_TYPE;  //               — Client Version
```

Each `gameClient[]` iteration appends one quoted token to each (`generate.ts:55-62`). The
trailing commas are trimmed in `constructSQL()` lines 99/101/103 the same way as the type
collection.

So for **N** gameClient entries the SQL contains:
- 1 `GAME_CHNLPRES_TYP(...)` with N `game_chnlpres_Obj(...)` entries,
- 3 sibling `lookup_typ(...)` lists with N tokens each,
- all of which the stored proc unpacks pairwise by index.

Index correspondence (assumed by the proc):
- `game_chnlpres_Obj[i]` ↔ `lookup_typ[i] for technology` ↔ `lookup_typ[i] for code` ↔ `lookup_typ[i] for version`.
- Version is **the same** across all entries (it comes from `packageJson.version`, not per-entry)
  — verified by `expected_2.sql:7` showing `lookup_typ('1.3.0-test-test','1.3.0-test-test',
  '1.3.0-test-test','1.3.0-test-test','1.3.0-test-test')` (five copies for five entries).

### §3.7 Table mapping (JSON entity → SQL target)

> The original prompt asked for "Table mapping (JSON entity → SQL table → columns)". The actual
> emission strategy is **stored-procedure calls**, not raw INSERTs. There are no `INSERT INTO`
> statements anywhere in the source (`grep -n "INSERT" src/*.ts` = zero hits). The procedures
> presumably wrap the underlying RGS tables (the proc names hint at `Rgs_Game_*` schema).
>
> Therefore the mapping table below is JSON entity → stored procedure → procedure positional args,
> NOT JSON entity → DB table → DB columns.

| JSON / package.json entity                      | Stored procedure                            | Positional args produced                                            |
|:------------------------------------------------|:--------------------------------------------|:--------------------------------------------------------------------|
| `package.json.id` segment 1 + segment 2 + `version` | `pgRgs_Game_fnRgs_InsUpdGameClientVersion` | `('<familyId>', <gameNumber>, '<version>' \| NULL)`               |
| `package.json.id` segments + `config.json.enableReplay` | `pgRgs_Game_fnRgs_Update_GameClientInfo` | `('<familyId>', <gameNumber>, '<replay>')`                       |
| `config.json.gameClient[*]` + `package.json.{name,version}` | `pgrgs_game_fnrgs_LoadchannelPtype` | `('Y', '<familyId>', <gameNumber>, GAME_CHNLPRES_TYP(...), lookup_typ(...) × 3)` |

### §3.8 Insert order, FK resolution

- **Hard-coded sequence**: Version → Info → ChannelPType. Always in that order (`generate.ts:71,
  83, 93`).
- No foreign-key wiring done in the transpiler — every call passes `familyId` + `gameNumber`
  again as a positional argument; the FK resolution is delegated to the DB-side proc bodies.
- All three calls are wrapped in a single transactional `DO $$ … END; $$` block with an
  `EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING errcode='20999'` catch-all
  (`constants.ts:14-20`). So if any one call fails, the entire block raises a single
  `'20999'` error.

### §3.9 ID generation strategy

- **Deterministic**: every id comes from input fields. No `nextval()`, no `currval()`, no
  auto-increment in the emitted SQL.
- `familyId` and `gameNumber` come from `package.json.id` (parsed at `generate.ts:122-127`).
- No internal ID generation in the transpiler at all (e.g. no UUID, no hash).

### §3.10 Migration / versioning

- Per-game version is `package.json.version` and is shipped as a string into stored-proc args.
- Tool version (the transpiler itself) is `package.json:3` `1.0.2`. There is no in-file `--
  version 1.0.2` header in the emitted SQL.
- No idempotency markers (`IF NOT EXISTS`, `ON CONFLICT`, `MERGE`) in the emitted SQL — the
  stored procedures must handle re-runs themselves (the `InsUpd` prefix on the first proc hints
  at upsert semantics on that side).
- Multi-id capability (per CHANGELOG 1.0.0) means a single run emits N independent SQL files;
  each file's `EXCEPTION` block fences its own transaction.

---

## §4. Transformation pipeline

### §4.1 Validators

There are **exactly two** validators in the source. Both are simple guard `throw`s, not a
schema-based system:

| Validator                  | Source           | Trigger                                                          | Error message                          |
|:---------------------------|:-----------------|:-----------------------------------------------------------------|:---------------------------------------|
| Missing `code` per client  | `generate.ts:8-9`| `!Boolean(client.code)` (i.e. `undefined`, `null`, `""`, `0`)    | `'Client code attribute is missing'`   |
| Wrong `id` format          | `generate.ts:123-125`| `gameIdParts.length != 3` after `.split('-')`                | `'invalid game id'`                    |

CLI-level guard at `index.ts:22-25`:

```ts
if (program.args.length == 0 || !program.args[0].includes('.json')) {
  console.error('json file is not part of the command');
  process.exit(1);
}
```

That is the **complete** validation surface. Notable omissions:
- No check that `gameClient` is an array (treats whatever is there as iterable).
- No check that `gameClient` is non-empty (an empty array produces SQL with empty
  `GAME_CHNLPRES_TYP()` — likely fails inside Postgres but not inside the transpiler).
- No type / enum checks for `channel`, `presentation`, `technology`.
- No check that `package.json.id` segment 0 is `'200'` (the studio family prefix).
- No check that `version` matches semver.
- No "math invariants" (RTP, volatility) — because there are no math fields.
- No regulator gate.

### §4.2 Normalizers

Five normalisers, all inline inside `generateString()`:

1. **Empty-string-to-`"0"`** for the four dimensional fields (`generate.ts:33-36`).
   ```ts
   const height      = client.height      === "" ? "0" : client.height;
   const width       = client.width       === "" ? "0" : client.width;
   const meterHeight = client.meterheight === "" ? "0" : client.meterheight;
   const meterWidth  = client.meterwidth  === "" ? "0" : client.meterwidth;
   ```
   Only catches `""`, not `undefined`. Note camel-case variable on LHS, snake-cased on RHS
   reading `client.meterheight` (`meterheight` is the JSON key per `constants.ts:27-28`; the
   variable rebinds to `meterHeight` for SQL).

2. **`gameFolder` fallback** (`generate.ts:37-40`):
   ```ts
   let gameFolder = gameName;
   if (Boolean(client.gameFolder)) {
     gameFolder = '\'' + client.gameFolder + '\'';
   }
   ```
   Already-quoted derived `gameName` (single-quoted at `generate.ts:25`) is the fallback;
   present `gameFolder` is re-quoted at this point.

3. **`enableFreeSpin` quote-or-NULL** (`generate.ts:42`).

4. **Game-name PascalCase + dehyphenate** (`generate.ts:24-30`). See §2.9.

5. **`enableReplay` default** (`generate.ts:129`, then `generate.ts:87-91`): falsy → `"NULL"`
   sentinel → emitted as `'N'`. Two-stage default.

There are **no reel-weight normalisers, symbol-id canonicalisations, currency normalisations,
or unit converters** — the schema has nothing of that nature.

### §4.3 Optimizers

NOT FOUND. There is no deduplication, no compression, no minification, no merging of equal
gameClient entries. Every entry → one `game_chnlpres_Obj(...)` literal, even if two entries are
identical. Candidate locations checked: `generate.ts:1-141` (whole file); no `Set`, `Map`-as-
cache, or `Object.keys`-based merge anywhere.

### §4.4 Pipeline shape (verbal)

```
config.json + package.json
    │
    ▼
JSON.parse × 2
    │
    ▼
Validate package.json.id  → throw "invalid game id"
    │  (per software id)
    ▼
parseChannelPresentation(gameClient)         ── builds Map<code, "channel,presentation,">
    │
    ▼
generateString(gameClient, packageJson, map, version)
    │   ── builds 4 parallel strings (chnlpres_obj list + 3 lookup_typ lists)
    │   ── derives gameName fallback, normalises empty → "0"
    ▼
constructSQL(familyId, gameNumber, version, replay, strings)
    │   ── header (DO $$ DECLARE … BEGIN)
    │   ── 3 stored-proc calls
    │   ── footer (EXCEPTION … END $$)
    ▼
{ path, sql }
    │
    ▼  (results.push for each software id)
write.createDirectory(outputDir) → fs.mkdirSync
    │
    ▼
write.resultsToFile(results)     → fs.writeFileSync per result
```

### §4.5 Streaming / batching

None. The whole pipeline is in-memory string concatenation. For a 5-entry `gameClient[]`,
output is ~ 700 chars; for hypothetical 100-entry input the string grows linearly. No `Buffer`s,
no streams.

---

## §5. Public API surface

### §5.1 Exported functions (TypeScript public API)

| Module          | Export                                                                             | Signature                                                                                  | Source citation |
|:----------------|:-----------------------------------------------------------------------------------|:-------------------------------------------------------------------------------------------|:----------------|
| `src/generate.ts` | `content`                                                                        | `(jsonPath: string, packageDir: string) → Array<{ path: string; sql: string }>`            | `generate.ts:111-141` |
| `src/write.ts`  | `createDirectory`                                                                  | `(outputDir) → void` (no return)                                                           | `write.ts:3-7` |
| `src/write.ts`  | `resultsToFile`                                                                    | `(results: any[]) → void`                                                                  | `write.ts:9-13` |
| `src/constants.ts` | every `export const …`                                                          | string constants only — see table below                                                    | `constants.ts:1-35` |
| `src/index.ts`  | (none — side-effect entry point)                                                   | runs at import; calls `generate.content()` then `write.*`                                  | `index.ts:1-31` |

**Helper functions (NOT exported)** in `generate.ts`:
- `parseChannelPresentation(gameClient) → Map<string, string>` (`generate.ts:4-15`).
- `generateString(gameClient, packageJson, channelPresentationMap, version) → string[]` (`generate.ts:17-67`).
- `constructSQL(familyCode, gameNumber, version, replay, gameClientString) → string` (`generate.ts:69-108`).

These are module-private (function declarations without `export`), so they cannot be unit-tested
in isolation — only through `content()`.

### §5.2 Exported constants (`constants.ts`)

| Name                                | Value (literal)                                                                                                  | Used at                          |
|:------------------------------------|:------------------------------------------------------------------------------------------------------------------|:---------------------------------|
| `OUTPUT_FOLDER`                     | `'gameDataFile'`                                                                                                 | `index.ts:20`                    |
| `SQL_FILE_NAME_PREFIX`              | `'load_gc'`                                                                                                      | `generate.ts:135`                |
| `SQL_FILE_NAME_SUFFIX`              | `'data.sql'`                                                                                                     | `generate.ts:135`                |
| `SQL_BEGIN`                         | `"DO $$\nDECLARE\n  ln_Dummy integer;\nBEGIN\n"`                                                                 | `generate.ts:71`                 |
| `SQL_UPDATE_GAME_CLIENT_VERSION`    | `'  ln_Dummy := pgRgs_Game_fnRgs_InsUpdGameClientVersion('`                                                      | `generate.ts:72`                 |
| `SQL_UPDATE_GAME_CLIENT_INFO`       | `'  ln_Dummy := pgRgs_Game_fnRgs_Update_GameClientInfo('`                                                        | `generate.ts:83`                 |
| `SQL_LOAD_CHANNEL_PRESENTATION_CONFIG` | `'  ln_Dummy := pgrgs_game_fnrgs_LoadchannelPtype(\\'Y\\','`                                                  | `generate.ts:93`                 |
| `SQL_gameChnlpres`                  | `"GAME_CHNLPRES_TYP"`                                                                                            | `generate.ts:96`                 |
| `SQL_gameChnlpresObj`               | `'game_chnlpres_Obj'`                                                                                            | `generate.ts:44`                 |
| `SQL_END`                           | `"EXCEPTION\n  WHEN OTHERS THEN\n    RAISE EXCEPTION USING\n      errcode = '20999',\n      message = '…'\nEND;\n$$"` | `generate.ts:106`           |
| `SQL_LOOKUP_TYPE`                   | `'lookup_typ('`                                                                                                  | `generate.ts:21-23`              |
| `kHeight`, `kWidth`, `kMeterHeight`, `kMeterWidth`, `kGameFolder`, `kEnableFreeSpin`, `kClientCode`, `kGameClient`, `kTechnology`, `kGameId`, `kClientVersion` | string field-name constants matching their JSON keys                              | **declared but NOT referenced** anywhere in `src/` |

The `k*` constants at `constants.ts:25-35` are **dead code** — none of them are imported into
`generate.ts` (which uses string literals like `client.height` directly). This is a soft form of
"reserved field name" registry that never got wired up.

### §5.3 CLI flags (commander.js definition)

`src/index.ts:10-15`:

```ts
program
    .description('Parses json configuration file with into a sql file, `load_gc_${software id}_data.sql`.')
    .option('-d, --dir <path>', 'directory path where the config.json file is located (default to current directory)')
    .option('-p, --dirPackageJson <path>', 'directory of project with target package.json, if not set, -d will be used')
    .option('-o, --outputDir <path>', 'directory of output sql file, if not set, a new folder called gameDataFile will be created')
    .parse(process.argv);
```

Positional argument: the json filename (e.g. `parseconfig config.json`). Required —
`index.ts:22-25` exits with code 1 if absent or if it does not contain the literal substring
`.json` (so `parseconfig myconfig` exits, `parseconfig my.json.bak` accidentally passes).

`README.md:18-37` also documents a `-V, --version` and `-h, --help` flag (auto-injected by
commander) but these are not configured in source.

**Bug**: `index.ts:20` reads `options.outPutDir` (camel-case typo — capital `P` mid-name), but
commander would have populated `options.outputDir` per the `--outputDir <path>` definition at
`index.ts:14`. So the `-o` flag **always falls through to the `OUTPUT_FOLDER = 'gameDataFile'`
constant**, regardless of what the user passes. Documented as pitfall in §7.1.

### §5.4 Error codes

JS-side throws (uncaught at the CLI boundary, so they propagate as process exit code != 0):

| Throw                                  | Where                  | Trigger                                       |
|:---------------------------------------|:-----------------------|:----------------------------------------------|
| `Error('Client code attribute is missing')` | `generate.ts:9`    | `gameClient[i].code` falsy                    |
| `Error('invalid game id')`             | `generate.ts:124`      | `package.json.id` segment count != 3 after `.split('-')` |
| `console.error('json file is not part of the command'); process.exit(1)` | `index.ts:23-24` | argv[0] missing or has no `.json` substring |
| Native `fs` errors (ENOENT, EACCES) from `readFileSync` / `mkdirSync` / `writeFileSync` | `generate.ts:114-115`, `write.ts:5`, `write.ts:11` | I/O failure |

SQL-side: a single error code is wired into the emitted block — `errcode = '20999'`
(`constants.ts:17`) with message prefix `'LOADGAME: An error was encountered - 20999 -ERROR- '`.
This is the contract with the RGS DB administrator; any failure inside any of the three stored
procs gets caught and re-raised as a uniform `20999` so the loader runner can grep on a single
code.

### §5.5 Unused imports

- `colors ^1.4.0` is listed as a dependency (`package.json:32, 42`). `grep -n "colors" src/`
  = zero hits. Unused at runtime.
- `path` is imported at `index.ts:4` and used at `index.ts:28` to resolve the JSON path. OK.
- `fs` is imported at `index.ts:3` (unused inside `index.ts` actually — `grep` shows only `path`
  use), at `generate.ts:2` (used for `readFileSync`), and at `write.ts:1` (used for `existsSync`,
  `mkdirSync`, `writeFileSync`).

---

## §6. Reverse-engineering insights for `slot-gdd-factory` parser

> This section is the synthesis lift. **Vendor names retired here per `rule_no_vendor_mentions`
> — referred to as "the industry standard manifest transpiler" inside the raw §1-§5 above, here generically as
> "the industry-standard JSON→SQL deployment-manifest transpiler" pattern.**

### §6.1 First-order finding: scope mismatch

The reference transpiler we just dissected is **NOT a math-model carrier**. It produces a
deployment manifest (which channels × presentations × screen-dims × technologies the game
client supports), not a paytable. So the question "what patterns can we lift INTO our parser
`src/parser.mjs`?" needs reframing:

- The parser in this repo (`slot-gdd-factory/src/parser.mjs`, 3203 LOC) already covers a much
  larger surface than the industry standard manifest transpiler ever did: topology, symbols, features, theme,
  confidence scoring, defensive null handling.
- What we CAN lift are **emission-layer patterns** — the way the industry standard transpiler turns its IR
  into a downstream artefact (SQL). These map onto our future PAR / SQL / DB-loader layer, not
  onto the parser itself.

### §6.2 Patterns worth lifting (for SGF emission layer, not parser)

| Pattern                                                       | Why it matters for SGF                                                              | Reference citation |
|:--------------------------------------------------------------|:-------------------------------------------------------------------------------------|:-------------------|
| **Single transactional `DO $$ … EXCEPTION … END; $$` envelope** with a single sentinel error code (`'20999'`) | When SGF emits a DB-loadable PAR / paytable artefact (phase 2), wrap all DML in one transactional block keyed by one error code. Lets a DBA grep one code regardless of which sub-call failed. | `constants.ts:5-20` |
| **Deterministic filename pattern keyed by canonical id** (`load_gc_<family>-<gameNumber>_data.sql`) | SGF's PAR exporter should emit `par_<family>-<gameNumber>_v<version>.sql` so multi-game / multi-version pipelines stay sortable. | `generate.ts:135` |
| **Multi-output-from-single-input fan-out** (one JSON → N SQL files, one per software id) | Our PAR pipeline should treat the GDD as the single source of truth and emit one artefact per (jurisdiction × denom × language) tuple, all derived deterministically. | `generate.ts:121-138` |
| **Parallel `lookup_typ(...)` lists indexed by position** for collection types | When emitting reel strips to a downstream DB schema that uses Oracle/Postgres composite types, the "N parallel lists, joined by index" trick avoids needing per-strip primary keys. | `generate.ts:55-62`, `expected_2.sql:7` |
| **`Map<code, "channel,presentation,">` pre-build pass** before the main string concat | Two-pass approach (build lookup map first, then iterate generating output) keeps the per-entry emission O(1) and the code dramatically clearer. Worth copying into our `buildSlotHTML` orchestrator when it has to cross-reference symbols ↔ paylines ↔ pay tiers. | `generate.ts:4-15` then `:17-67` |
| **Stringified booleans (`"Y" \| "N"`) with two-stage default** (truthy → quote, falsy → sentinel keyword) | Our PAR layer will emit Postgres booleans; the two-stage `"NULL" sentinel → "N" at emission time` pattern lets a missing source field decay gracefully without a separate validator pass. | `generate.ts:129`, `generate.ts:87-91` |
| **Output directory creation is idempotent** (`if (!fs.existsSync) { fs.mkdirSync }`) | Trivial but worth being explicit — SGF currently writes only browser output, so when we add a PAR file dump, copy this idiom. | `write.ts:3-7` |
| **Default-on EXCEPTION envelope with hardcoded error code prefix in the SQL message** | The exception message `'LOADGAME: An error was encountered - 20999 -ERROR- '||SQLERRM` is a single grep target for the DBA. We should adopt a similar prefix when SGF emits any DB-loadable script. | `constants.ts:14-20` |

### §6.3 Patterns NOT worth lifting (anti-patterns for our purposes)

| Anti-pattern                                                  | Why we should NOT copy it                                                            | Reference citation |
|:--------------------------------------------------------------|:--------------------------------------------------------------------------------------|:-------------------|
| **String concatenation via `+=` over typed accumulators** (`generate.ts:44-62`) | Brittle, leaks trailing commas (which the transpiler then has to `substring(-1)` away), no SQL-injection escaping for user-supplied strings (`gameFolder` is concatenated raw). SGF's parser already uses a structured ParsedModel — keep it that way and serialize at the boundary, not via `+=`. | `generate.ts:44-104` |
| **Field-name constants declared but never used** (`constants.ts:25-35`) | Dead code: 11 `kXxx` constants exist but `generate.ts` reads `client.height` etc. directly. Either commit to the constants-registry pattern fully or delete it — half-measure is worst of both worlds. | `constants.ts:25-35` |
| **`noImplicitAny: false`** (`tsconfig.json:8`) erases parameter types in `parseChannelPresentation(gameClient)`, `generateString(gameClient, packageJson, ...)`, `constructSQL(...gameClientString: string[])` | We've already chosen ESM + JSDoc in SGF; keep typedness up. | `generate.ts:4, 17, 69`; `tsconfig.json:8` |
| **No schema validator at the IR boundary**; only two ad-hoc `throw`s | An empty `gameClient: []` passes silently and produces broken SQL. SGF parser already returns `confidence._failures[]` — keep / extend that, do NOT regress to bare throws. | `generate.ts:8-9, 123-125`; SGF `parser.mjs:78-86` |
| **Unused `options.outPutDir` typo** (`index.ts:20` reads camel-cased wrong vs `index.ts:14` flag `--outputDir`) | Means `-o` flag has never worked. Lesson: don't read commander options by hand; use TypeScript types or destructure with a typed shape. | `index.ts:14, 20` |
| **Side-effect-only `index.ts` with no library export** means `require('config-parser')` does NOTHING useful — only the CLI works. | SGF should keep its parser importable from tests, app.js, and any future Node consumers. Don't entangle parsing with file I/O. | `index.ts:1-31`; SGF `parser.mjs` is already pure |
| **`for (var index in gameIDArray)` over a JS Array** (`generate.ts:121`) | Iterates inherited keys; a polluted `Array.prototype` would break it. Use `for…of`. | `generate.ts:121` |
| **No idempotency markers in emitted SQL** (`IF NOT EXISTS`, `ON CONFLICT`) | The industry standard transpiler delegates idempotency to stored-proc bodies. SGF's PAR pipeline should NOT rely on a sister team for idempotency; bake `ON CONFLICT DO NOTHING` (or equivalent) into the emit layer. | `generate.ts:69-108` (no idempotency keyword) |

### §6.4 IR shape we need to match for downstream PAR / Math layer

The industry standard manifest transpiler's IR (channel × presentation × dimensions) is **insufficient** for
the math layer. The math layer needs the union:

```
ParsedModel ⊕ ManifestIR
```

where `ParsedModel` is what `parser.mjs:23-58` already returns and `ManifestIR` is the industry standard-style
client-deployment manifest. Practical decision:

- Keep `ParsedModel` as the single source of math truth in SGF.
- When (and only when) SGF needs to emit a DB-loadable artefact for a real production loader,
  add a SEPARATE manifest IR alongside, modelled on the config.json shape (`gameClient[]` with
  channel/presentation/dimensions). Do NOT pollute `ParsedModel` with deployment fields.

### §6.5 file:line claims summary for §6

| Claim                                                                          | Citation |
|:-------------------------------------------------------------------------------|:---------|
| industry standard transpiler is NOT a math carrier                                           | `generate.ts:111-141` (full pipeline visible), `tests/resources/**/config.json` (no math fields) |
| Single-transaction envelope is the right pattern                               | `constants.ts:5-20`                                                                              |
| Filename pattern is deterministic and grep-able                                | `generate.ts:135`                                                                                |
| Fan-out (N-output) per multi-id pkg.id                                         | `generate.ts:121-138`                                                                            |
| Parallel `lookup_typ(...)` lists trick                                         | `generate.ts:21-23`, `:55-62`, `:99-104`                                                         |
| Map-pre-build idiom                                                            | `generate.ts:4-15`, `:17-67`                                                                     |
| Dead constants                                                                 | `constants.ts:25-35` (cross-checked: zero `import` of `kXxx` in `generate.ts`)                   |
| `outPutDir` typo bug                                                           | `index.ts:14` (flag declared as `--outputDir`) vs `index.ts:20` (read as `options.outPutDir`)    |
| No schema validator                                                            | `generate.ts:8-9`, `:123-125` (the only two guards)                                              |

---

## §7. Pitfalls + lessons learned

### §7.1 Pitfalls present in the reference (do NOT repeat in SGF)

1. **`-o` CLI flag has been broken since at least 1.0.0** because of a typo. `index.ts:14`
   declares `.option('-o, --outputDir <path>', ...)` so commander writes to `options.outputDir`.
   `index.ts:20` reads `options.outPutDir` (capital P in the middle). Result: `-o` is silently
   ignored and output always lands in `./gameDataFile/` per the default.
   - **Lesson**: never hand-read `program.opts()` properties by string key. Destructure with a
     typed interface so the compiler catches typos.

2. **Trailing-comma cleanup via `substring(-1)`** (`generate.ts:97, 99, 101, 103`). If a future
   refactor changes the loop body to skip an entry, the off-by-one becomes silent SQL corruption.
   - **Lesson**: use `Array<string>.join(',')` instead of accumulate-and-trim.

3. **`for (var index in arr)` over a JS Array** (`generate.ts:121`). On a polluted prototype, or
   when iterating sparse arrays, this gives surprising keys.
   - **Lesson**: `for (const id of gameIDArray)`.

4. **Empty `gameClient: []` would emit broken SQL** with empty `GAME_CHNLPRES_TYP()` collection.
   No code path checks `length >= 1`.
   - **Lesson**: SGF parser should fail loudly (or at least record into
     `confidence._failures`) on empty topology arrays.

5. **`Boolean(value)` for guard, but it accepts the string `"false"`** at `generate.ts:8`. A
   `config.json` with `"code": "false"` would pass the missing-code guard but then write the
   literal string `"false"` into SQL.
   - **Lesson**: don't use `Boolean()` as a validator; use explicit `=== undefined` /
     `=== ''` / `=== null` checks.

6. **The PascalCase derivation strips ALL `-`** at `generate.ts:29`. So `Game-Of-The-Year`
   becomes `GameOfTheYear`, fine, but `super-bonus-v2` becomes `SuperBonusV2`, which loses the
   `v` separation if the game name embeds a version. Not a real bug given current naming
   convention, but a fragile assumption.

7. **Per-software-id loop re-parses package.json fields every iteration** at
   `generate.ts:121-138`. Cheap for small inputs but wasteful — the version, name, replay flag
   are constant across ids.
   - **Lesson**: hoist invariants out of the loop. Trivial in our parser since `parseGDD()`
     already executes once per upload.

8. **No SQL escaping**. If `client.gameFolder` is `"my'folder"`, the emitted SQL becomes
   `…,'my'folder',…` — syntax error. No injection guard.
   - **Lesson**: when SGF starts emitting any SQL, escape via a dedicated quote helper
     (replace `'` → `''`), not raw `+`.

9. **`tsconfig.json:8 noImplicitAny: false`** weakens the entire type story — the helper
   signatures `(gameClient)` etc. accept `any`. Catches no errors that an `any` propagation
   would already mask.
   - **Lesson**: SGF already uses JSDoc; ensure all new exports have explicit `@param` /
     `@returns` even when ESM-without-TS makes it optional.

10. **`bin/` is committed alongside `src/`** (`package.json:21-23` ships only `bin/` to npm).
    Two duplicates of every source-equivalent file in the repo means PRs can drift —
    `bin/src/generate.js` could be left stale after a `src/generate.ts` change.
    - **Lesson**: SGF already gitignores `node_modules` and dev artefacts; keep doing that.

11. **Read-side `experimentalDecorators: true`** (`tsconfig.json:7`) but no decorator anywhere
    in source. Vestigial config that suggests a copy-paste from a Nest/Angular tsconfig.
    - **Lesson**: prune unused flags whenever encountered.

12. **Imports `colors` but never uses it**. (`package.json:32, 42` declare it; `grep -n
    "colors" src/` is empty.)
    - **Lesson**: `yarn list --pattern colors` should be empty; remove unused deps to reduce
      lockfile and attack surface.

13. **No graceful Unicode handling**. The PascalCase regex `\w*` matches only `[A-Za-z0-9_]` —
    a game name with Cyrillic or accented chars would not be capitalised and the un-dehyphened
    bits would stay literal. Not a fixture-exercised case.
    - **Lesson**: SGF parser already normalises Unicode in its theme/symbol extractor; carry
      the same approach.

### §7.2 Edge cases the config-parser DOES handle correctly

| Edge case                                                  | How it's handled                                                                          | Source citation |
|:-----------------------------------------------------------|:------------------------------------------------------------------------------------------|:----------------|
| `enableReplay` absent                                       | Defaults to sentinel `"NULL"`, then to `'N'` at emit                                       | `generate.ts:129, 87-91` |
| `version` absent in `package.json`                         | Defaults to sentinel `"NULL"`, emitted as bare `NULL` keyword without quotes              | `generate.ts:130, 58-62, 76-80` |
| `gameFolder` empty string                                  | Falls back to PascalCased package name                                                    | `generate.ts:37-40` |
| `gameFolder` absent altogether                             | Same path (`Boolean(undefined) === false`) — fallback used                                 | `generate.ts:37-40`; behaviour matches 1.0.2 changelog "make gameFolder attribute optional" |
| Empty-string numeric fields                                | Coerced to `"0"`                                                                          | `generate.ts:33-36` |
| Empty-string `enableFreeSpin`                              | Emitted as bare `NULL` keyword                                                            | `generate.ts:42` |
| Multiple software ids in one `package.json.id`             | One SQL file per id, all written in one CLI run                                           | `generate.ts:121-138`; fixture `multipleSoftwareIDs/threeSoftwareIDsWithoutReplay` |
| Missing per-client `code`                                  | Throws with specific message                                                              | `generate.ts:8-9`; test `errorTest.ts:13-18` |
| Malformed `id` (segments != 3)                             | Throws with specific message                                                              | `generate.ts:123-125`; test `errorTest.ts:6-11`; fixture `errors/invalidGameID/package.json:5` (`"id": "200-1389"`) |
| Output dir missing                                         | Created via `fs.mkdirSync` if absent                                                      | `write.ts:3-7` |

### §7.3 Reliability assessment

- **Hand-written LOC**: 223 across 4 files.
- **Test coverage**: 5 mocha files exercising 8 distinct it-blocks. All happy paths + 2 error
  cases. Uses end-to-end fixtures rather than unit mocks.
- **Mutation tests / property tests**: NONE.
- **Static analysis**: TSLint config but TSLint is deprecated; no ESLint migration.
- **Dependency review**: 2 runtime deps. Low attack surface.
- **Code smell**: dead constants (`kXxx`), unused dep (`colors`), broken flag (`-o`), no schema
  validator. Net: this is "good enough for an internal industry standard studio tool" but **not the gold
  standard** SGF aims for under `rule_senior_grade_code`.

---

## §8. Cross-reference to `slot-gdd-factory`

### §8.1 Bridge table — industry standard layer ↔ SGF equivalent ↔ gap

| industry standard config-parser concept                          | SGF equivalent                                                       | Gap / lift-opportunity                                                 |
|:---------------------------------------------------|:---------------------------------------------------------------------|:-----------------------------------------------------------------------|
| `config.json` (channel × presentation × dims)      | NOT PRESENT in SGF — SGF parses GDD-as-document, not deployment manifest. | If SGF ever needs to emit deployment SQL, model a separate `ManifestIR` alongside `ParsedModel`. Don't graft. |
| `package.json` sibling (name, id, version)         | Implicit per-upload session — SGF uses the GDD filename + Boki's UI state. | Worth introducing a lightweight `meta` block (name, version, family-hint) into `ParsedModel.theme` for downstream PAR emit. |
| `gameClient[].channel`/`presentation`              | NOT PRESENT (and not needed at parse time)                            | Future PAR/SQL emit phase. Out of scope of `parser.mjs`. |
| `gameClient[].technology`                          | Implied as "browser HTML" everywhere                                 | Single-valued — bake the constant when SQL emit lands. |
| `gameClient[].height/width/meterheight/meterwidth` | Read by `src/blocks/layout.mjs` for in-browser rendering            | The dimensions industry standard emits are per-CHANNEL; SGF dimensions are per-RESPONSIVE-BREAKPOINT. Different abstraction; no merge needed. |
| `enableReplay` flag                                | `src/blocks/replay.mjs` (if present)                                  | Same boolean; map onto same JSON key when SGF gains a manifest emit. |
| `enableFreeSpin` flag                              | SGF has `freespin` block (`src/blocks/freespin.mjs` typical)         | SGF already detects FS feature via `parser.mjs` feature extractor. |
| Two-validator design (only `code` + `id`)          | SGF parser uses `_safeExtract` wrapper + `confidence._failures` (`parser.mjs:78-86`). | SGF is **already stronger** here. Hold the line — don't regress to bare throws. |
| Single `errcode = '20999'` SQL exception envelope  | SGF browser-side has no equivalent.                                  | When SGF gets a future PAR / database loader, adopt the same single-error-code envelope idiom. |
| Filename pattern `load_gc_<family>-<game>_data.sql`| SGF currently emits HTML only; no file naming policy.                | When SGF gets PAR output, lift the deterministic, grep-friendly pattern. |
| Inline string `+=` SQL builder                     | SGF parser uses structured `ParsedModel`.                            | Keep SGF's structured-model approach; do NOT regress to `+=`. |
| Per-software-id fan-out                            | NOT PRESENT in SGF; single GDD → single in-browser preview.          | If/when SGF emits multi-jurisdiction variants from one GDD, this fan-out pattern is the model. |
| `bin/` committed alongside `src/`                  | SGF is ESM-only, no transpile step required.                          | SGF already simpler. No lift needed. |
| Whole pipeline = in-memory string concat (no streams) | SGF same (parser is pure, no I/O).                                 | OK at GDD scale (~100 KB). No lift needed. |
| Hardcoded RGS stored-proc names in `constants.ts`  | SGF has no SQL surface (yet).                                        | When SQL surface exists, mirror the "all SQL idioms in one constants file" approach. |
| Hardcoded SQL_BEGIN / SQL_END boilerplate          | SGF has no SQL surface (yet).                                        | Same recommendation. |
| `outputDir` typo bug (`outPutDir`)                 | SGF has no CLI yet (it's a browser-side tool).                       | When SGF grows a CLI, prefer destructure-typed-options over hand-read map. |
| `package.json.id` split-by-`-` format              | SGF has no software-id concept.                                      | If SGF emits PARs per jurisdiction, jurisdiction-id token in filename is the analog. |
| Stringified Y/N booleans                           | SGF parser uses real JS booleans.                                    | SGF is **stronger** here. When SQL emit lands, do the Y/N transformation at the emit boundary, not in the model. |
| PascalCase-and-dehyphen game name                  | SGF parser uses `model.name` raw                                     | When SQL emit lands, mirror this exact transformer (preserves wire-compatible naming). |
| `colors` runtime dep unused                        | N/A                                                                  | Lesson only: SGF should `npm uninstall` any unused dep on each cleanup pass. |

### §8.2 Concrete recommendation for SGF parser (`src/parser.mjs`)

After reading both this repo and `parser.mjs` (`src/parser.mjs:1-100` reviewed), the SGF parser
is already **far** more sophisticated than the industry standard manifest transpiler. The only LIFT that
applies at the parser layer (not the emit layer) is:

- **`Map<key, value>` pre-build pass** before main iteration when cross-referencing two
  sub-structures (e.g. symbols ↔ paylines, or pay tier ↔ symbol id). The industry standard transpiler uses
  this at `generate.ts:5-13` to avoid quadratic lookups in the per-client emission loop.
  SGF could apply this idiom in any future feature extractor that needs to cross-reference
  multiple sub-structures of the GDD.

Everything else from the industry standard transpiler (transactional envelope, deterministic filenames,
fan-out, Y/N transform) is **emit-layer** territory and belongs to a future SGF PAR/SQL exporter,
NOT to `parser.mjs`.

### §8.3 What NOT to do because of this RE

1. **Do NOT** start adding channel/presentation/dimension fields to `ParsedModel`. They are a
   deployment-time concern, not a parse-time concern.
2. **Do NOT** copy the `+=` string-builder for any future SQL emit. SGF should use a typed
   builder (e.g. an array of statement objects, joined at the boundary).
3. **Do NOT** assume the industry standard config-parser carries any usable math model. It does not.
4. **Do NOT** regress to bare `throw`s. SGF's `_safeExtract` + `confidence._failures` is the
   correct, senior-grade pattern.
5. **Do NOT** treat the industry standard transpiler as a reference for paytable / reel-strip serialisation.
   The actual paytable serialisation lives elsewhere (likely in the `playa-slot` runtime or in
   a separate math-config repo we have not yet RE'd; explicit follow-up).

### §8.4 Follow-up RE candidates (companion repos to dissect next)

Because this repo is the **manifest** half of the pipeline, the math half must live somewhere
else. Likely candidates worth a similar RE pass:

| Suspected repo / artefact                          | Why                                                                                       | Where to look |
|:---------------------------------------------------|:------------------------------------------------------------------------------------------|:--------------|
| `playa-slot` (math runtime)                        | Per `defaultValues/empty/package.json:113`, dep `playa-slot 1.3.0`. The actual reel/paytable model probably ships there. | `~/industry standard/` siblings — not yet on disk |
| `playa-core`                                       | Per `package.json:112`, dep `playa-core 1.3.0`. Channel / RGS contract.                  | `~/industry standard/` siblings |
| Whatever ships `copy-configs` postinstall          | Per `defaultValues/empty/package.json:18`: `"postinstall": "copy-configs"`. That step probably copies the real math config in. | Track the binary `copy-configs` to its parent package |
| RGS-side stored-procs                              | `pgRgs_Game_fnRgs_InsUpdGameClientVersion` body would reveal the schema.                  | DBA-controlled, likely not in any git repo we have access to |

### §8.5 Headline verdict

> **The industry standard config-parser is a 223-LOC client-manifest emitter, not a slot-math transpiler.
> It teaches us emission-layer patterns (single-transaction envelope, deterministic filenames,
> fan-out, parallel-list trick) we can lift INTO a future SGF PAR/SQL exporter, but it teaches
> us NOTHING about reel strips, paytables, RTP, or features — because none of that data is
> inside the IR it parses. SGF's current `src/parser.mjs` already exceeds this reference on
> defensiveness, modularity, and confidence handling. The lift opportunity is therefore
> downstream of parser.mjs, not inside it.**

---

## Appendix A — Citation manifest

Every file from `~/industry standard/config-parser/` that was opened during this RE:

| Path                                                                           | Read scope     |
|:-------------------------------------------------------------------------------|:---------------|
| `~/industry standard/config-parser/package.json`                                             | full (1-45)    |
| `~/industry standard/config-parser/tsconfig.json`                                            | full (1-25)    |
| `~/industry standard/config-parser/tslint.json`                                              | full (1-125)   |
| `~/industry standard/config-parser/Jenkinsfile`                                              | full (1-59)    |
| `~/industry standard/config-parser/README.md`                                                | full (1-37)    |
| `~/industry standard/config-parser/CHANGELOG.md`                                             | full (1-55)    |
| `~/industry standard/config-parser/.gitignore`                                               | full (1-8)     |
| `~/industry standard/config-parser/.vscode/launch.json`                                      | full (1-35)    |
| `~/industry standard/config-parser/src/constants.ts`                                         | full (1-36)    |
| `~/industry standard/config-parser/src/generate.ts`                                          | full (1-141)   |
| `~/industry standard/config-parser/src/index.ts`                                             | full (1-31)    |
| `~/industry standard/config-parser/src/write.ts`                                             | full (1-13)    |
| `~/industry standard/config-parser/tests/defaultValueTest.ts`                                | full (1-36)    |
| `~/industry standard/config-parser/tests/errorTest.ts`                                       | full (1-19)    |
| `~/industry standard/config-parser/tests/multipleSoftwareIDsTest.ts`                         | full (1-67)    |
| `~/industry standard/config-parser/tests/withEnableReplayTest.ts`                            | full (1-35)    |
| `~/industry standard/config-parser/tests/withoutEnableReplayTest.ts`                         | full (1-22)    |
| `~/industry standard/config-parser/tests/resources/defaultValues/empty/config.json`          | full (1-28)    |
| `~/industry standard/config-parser/tests/resources/defaultValues/empty/package.json`         | full (1-124)   |
| `~/industry standard/config-parser/tests/resources/defaultValues/empty/expected.sql`         | full (1-15)    |
| `~/industry standard/config-parser/tests/resources/defaultValues/nonExistentGameFolder/config.json` | full (1-59) |
| `~/industry standard/config-parser/tests/resources/defaultValues/nonExistentGameFolder/package.json` | full (1-124) |
| `~/industry standard/config-parser/tests/resources/defaultValues/nonExistentGameFolder/expected.sql` | full (1-14) |
| `~/industry standard/config-parser/tests/resources/multipleSoftwareIDs/oneSoftwareIDWithoutReplay/config.json` | full (1-64) |
| `~/industry standard/config-parser/tests/resources/multipleSoftwareIDs/oneSoftwareIDWithoutReplay/package.json` | full (1-124) |
| `~/industry standard/config-parser/tests/resources/multipleSoftwareIDs/threeSoftwareIDsWithoutReplay/config.json` | full (1-64) |
| `~/industry standard/config-parser/tests/resources/multipleSoftwareIDs/threeSoftwareIDsWithoutReplay/package.json` | full (1-124) |
| `~/industry standard/config-parser/tests/resources/multipleSoftwareIDs/threeSoftwareIDsWithoutReplay/expected_2.sql` | full (1-15) |
| `~/industry standard/config-parser/tests/resources/multipleSoftwareIDs/threeSoftwareIDsWithoutReplay/expected_3.sql` | full (1-15) |
| `~/industry standard/config-parser/tests/resources/multipleSoftwareIDs/threeSoftwareIDsWithoutReplay/expected_9.sql` | full (1-15) |
| `~/industry standard/config-parser/tests/resources/multipleSoftwareIDs/twoSoftwareIDsWithReplay/expected_0.sql` | full (1-15) |
| `~/industry standard/config-parser/tests/resources/replay/withEnableReplay/configYes.json`   | full (1-65)    |
| `~/industry standard/config-parser/tests/resources/replay/withEnableReplay/configNo.json`    | full (1-65)    |
| `~/industry standard/config-parser/tests/resources/replay/withEnableReplay/expectedYes.sql`  | full (1-15)    |
| `~/industry standard/config-parser/tests/resources/replay/withEnableReplay/expectedNo.sql`   | full (1-15)    |
| `~/industry standard/config-parser/tests/resources/replay/withoutEnableReplay/config.json`   | full (1-64)    |
| `~/industry standard/config-parser/tests/resources/replay/withoutEnableReplay/expected.sql`  | full (1-15)    |
| `~/industry standard/config-parser/tests/resources/errors/invalidGameID/config.json`         | full (1-16)    |
| `~/industry standard/config-parser/tests/resources/errors/invalidGameID/package.json`        | full (1-124)   |
| `~/industry standard/config-parser/tests/resources/errors/missingClientCode/config.json`     | full (1-15)    |

Files in `bin/` (compiled `.js`, `.d.ts`, `.js.map`) were **not** independently RE'd because
they are mechanically derived from `src/*.ts` and would duplicate citations. Yarn lockfile not
read in full (its content is not load-bearing for RE).

## Appendix B — `src/` complete inventory (size + LOC)

| File                  | Bytes  | LOC  | Purpose                                                                |
|:----------------------|------:|----:|:------------------------------------------------------------------------|
| `src/constants.ts`    |   ~1.8 KB | 36 | SQL fragment constants + dead field-name registry                       |
| `src/generate.ts`     |   ~5.1 KB | 141 | Core transpiler: validate, parse channel map, build strings, assemble SQL |
| `src/index.ts`        |   ~1.1 KB | 31 | CLI shim — commander setup, args validation, calls generate + write    |
| `src/write.ts`        |   ~0.4 KB | 13 | fs sink — mkdir + writeFileSync                                         |
| **Total**             | **~8.4 KB** | **221** | (4 modules, zero classes, zero decorators, zero async/await)        |

## Appendix C — Open questions (worth follow-up if time permits)

1. What does the RGS `pgRgs_Game_fnRgs_InsUpdGameClientVersion` proc actually do? (DBA-only.)
2. Where is the actual paytable / reel-strip math config defined? (Hypothesis: `playa-slot`
   runtime package — not in this repo, needs separate RE.)
3. What populates `package.json.id` in production game projects? (Hypothesis: studio-side build
   tool, possibly the `playa-cli` referenced in fixture package.jsons at
   `defaultValues/empty/package.json:88`.)
4. Has the `outPutDir` typo been observed and ignored, or genuinely undiscovered? (Indicates
   how widely the `-o` flag is exercised in production.)
5. Why is `colors` declared as a runtime dep if no code uses it? (Likely vestigial from an
   earlier CLI banner that got removed.)

— end of report —
