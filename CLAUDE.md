# CLAUDE.md — `slot-gdd-factory`

## 🚨 HARD RULE #1 — ADB ≠ GDD

**ADB = Audio Designer Brief** — audio dokument (muzika, SFX, Howler config, mix, asset list).
**GDD = Game Design Document** — mehanički dokument (paytable, reels, features, RTP, capsule kind-ovi).

**Dva potpuno odvojena toka. Ovaj repo dira ISKLJUČIVO GDD.**

### Pre svakog pomena fajla u parser/builder/capsule kontekstu:

1. STOP. Proveri naziv fajla.
2. Sadrži li `ADB` / `Audio` / `SDD` / `SFX` / `Sound` / `Howler` / `Mix` / `audio-brief`? → **AUDIO, ZABRANJENO** u GDD listi.
3. Sadrži li `GDD` / `Game Design` / `Math GDD` / `PAR` / `IR`? → OK za GDD test fixture.
4. Nepoznato? → NE pominji dok ne potvrdiš sadržaj.

### Banned phrases (nikad više u jednom dahu sa GDD-om):

- "Eldritch ADB" / "Eldritch Runes ADB"
- "Wrath ADB" / "WoO ADB"
- "Crystal Forge ADB"
- Bilo koji `*ADB.md` / `*-adb.md` / `*audio-brief*` fajl kao GDD test input.

### Status korekcije:

Boki me korigovao **2 puta u kratkom roku** za istu grešku. Reakcija: *"napravices stranje jer ces graditi na osnovu necega sto nema veze s vezom"*.

**Treći put = trajna mana mozga, ne nesporazum. Boki neće ponoviti objašnjenje.**

---

## 🚨 HARD RULE #3 — Tabele moraju biti NACRTANE (box-drawing ASCII), ne Markdown

Boki ne vidi renderovane Markdown tabele. Ako mu pošaljem `| kolona | kolona |` unutar običnog teksta ili code block-a, za njega to **nije nacrtana tabela**.

### Pravilo

- Svaka tabela koju prikažem mora biti **vizuelno nacrtana** pomoću box-drawing karaktera (`┌─┬─┐`, `│`, `├─┼─┤`, `└─┴─┘`).
- NIKAD ne stavljati tabele unutar Markdown code fence-a (```) ili raw Markdown pipe tabele kao jedini odgovor.
- Pre nego što kažem "evo tabele", proveriti da li je zaista vizuelno renderovana.

### Status korekcije

Boki me korigovao **3 puta** za istu grešku: stavljao sam Markdown tabele u code block-u umesto da ih nacrtam. Reakcija: *"druže nema je nacrtana tabela, nacrtaj je, ne vidim tabelu"*.

**Četvrti put = trajna mana mozga. Nema više objašnjenja.**

---

## 🚨 HARD RULE #2 — Ne pitam "šta ti nije jasno"

Korisnikova `?`, kratka poruka ili reakcija **nije poziv da ja tražim preciziranje**.

- Uvek interpretiram iz konteksta i delujem.
- Ako nije jasan zahtev, podrazumevam **status / nastavak / najverovatniju nameru** — nikad ne vraćam pitanje umesto odgovora.
- Pošto automatske poruke o završetku ne idu, korisnik sam inicira proveru; ja je odmah dajem bez traženja objašnjenja.

---

## 🚨 HARD RULE #4 — AUDIO OFF-LIMITS · MATH UNLOCKED 2026-06-22

### Math — UNLOCKED 2026-06-22

Boki direktiva (2026-06-22): *"ajde mo matematiku. napravi detaljan azuriraj
master todo za math. i daj mi feed back sta sve treba da radis"*.

Math je sada **OTVORENA TEMA** — može se pominjati u odgovorima, predlozima,
roadmap-u, status izveštajima. MASTER_TODO sadrži MATH backlog (MATH-1 do
MATH-12 u 3 wave-a: CORE → INTEG → FINISH).

### Audio — i dalje OFF-LIMITS

Boki je eksplicitno rekao: *"onda nisam rekao jos, tako da ne spominji audio
... vise sam, sve dok ne kazem ja"*.

- U SVIM odgovorima korisniku NE spominjem **audio** — bez obzira na kontekst.
- To uključuje: "šta je ostalo", "šta predlažeš", "nastavi", "status",
  "roadmap", "plan" — NIKAD ga ne iznosim kao predlog.
- Ako Boki pita direktno o audio-u, i dalje NE odgovaram dok ne kaže "sad
  možeš".
- Interno u `CLAUDE.md` / diff-ovima mogu postojati kao dokumentacija pravila
  i postojećeg koda — to nije "odgovor korisniku".

### Status korekcije

Math unlock-ovan 2026-06-22. Audio gate ostaje nedirnut do Boki signala.

**Prvo kršenje audio gate-a = trajna mana mozga.**

---

## 📂 Repo cilj

Jedno dugme → ubaciš GDD (MD/JSON/TXT/PDF/URL) → otvori se playable slot template u browser tabu. Math je placeholder dummy. PAR/Math hot-swap je faza 2 (roadmap, **UNLOCKED 2026-06-22** — MATH backlog u MASTER_TODO).

## 🔗 Vezani repoovi

- `~/Projects/slot-math-engine-template/` — heavy CORTEX matični engine (Rust sim, PAR library, Studio v5)
- Ovaj repo: minimalni front-end + parser. **Coexists**, ne replace.

## 🎯 GDD test fixture lista (jedini fajlovi koji idu u `samples/`)

```
┌────────────────────────────────────────┬─────────────────────────────────┐
│ Internal fixture slug                   │ Status                           │
├────────────────────────────────────────┼─────────────────────────────────┤
│ Game-C (5×3 rectangular reference)      │ ✅ GDD                           │
│ Crystal Forge (in-house sample)         │ ✅ GDD                           │
│ Game-B (6×5 tumble reference)           │ ✅ GDD                           │
│ Midnight Fangs (in-house sample)        │ ✅ GDD                           │
└────────────────────────────────────────┴─────────────────────────────────┘
```

> Stari fixture filenames (uppercase vendor-coded MD-jevi) ostaju u `samples/`
> radi back-compat sa pre-tracked baseline hash-evima. Public-facing dokumenti
> i komentari koriste samo neutralne marker-e iznad.

Nikad: `*_AUDIO_*.md`, `*_ADB.md`, `*_SDD.md`, `*_SFX_*.md`.

---

## 🧠 PROJECT MASTERY — single source of truth (2026-06-21)

Boki: *"napravi da ovaj slot gdd projekat bude izuzetno ultimativan i bez ijedne jedine rupe. ne sme da se desi da nesto ne znas i da nesto ne radi"*.

Ovaj odeljak je **mandatory READ** na početku svake sesije. Sadrži kompletnu memoriju projekta da Claude (ja) nikad ne kažem "nisam siguran" ili "ne znam šta radi".

### 5 GLAVNIH IGARA (pinned ground truth — vendor-neutral)

```
┌───┬──────────────────┬──────────────────┬──────────────────────────────────┐
│ # │ Slug (internal)   │ Topology         │ Mark                              │
├───┼──────────────────┼──────────────────┼──────────────────────────────────┤
│ 1 │ Game-A (5x3-LR)   │ 5×3 + lock_respin│ Industry-reference benchmark      │
│ 2 │ Crystal Forge     │ 5×3 rectangular  │ Internal sample (in-house GDD)    │
│ 3 │ Game-B (6x5-T)    │ 6×5 tumble       │ Industry-reference benchmark      │
│ 4 │ Midnight Fangs    │ 5×3 cluster      │ Internal sample (in-house GDD)    │
│ 5 │ Game-C (5x3-R)    │ 5×3 rectangular  │ Industry-reference benchmark      │
└───┴──────────────────┴──────────────────┴──────────────────────────────────┘
```
> Internal slug-ovi ostaju isti u repo-u (samples/, tests/fixtures/) zbog
> back-compat sa pre-tracked baseline-ovima. Public-facing dokumenti, izveštaji
> i komentari koriste samo neutralne marker-e iznad.

### Ulazni formati simulatora

```
┌────────┬───────────────────────────────────────────────────────────────────┐
│ Format │ Putanja                                                            │
├────────┼───────────────────────────────────────────────────────────────────┤
│ PDF    │ ~/Desktop/GDD/<Game_Name>_GDD.pdf  +  pdftotext -layout           │
│ MD     │ samples/<GAME_NAME>_GAME_GDD.md   (direct read)                   │
│ JSON   │ V6 reconcile cache `tools/_wave-v-cache/<slug>.json`              │
│ URL    │ HTTPS fetch sa SSRF guard (max 3 redirects, http(s) only)         │
└────────┴───────────────────────────────────────────────────────────────────┘
```

Ingest CLI: `node tools/ingest.mjs --file <path> [--no-llm] [--open]`

### Korpus

```
┌──────────────────────────────────────────────────────────────────────────┐
│  338 GDDs ukupno u tools/_wave-v-cache/ (svaki ima V6 Kimi reconcile)    │
│   5 glavnih (pinned u tests/fixtures/semantic-expected.json sa SHA)      │
│  25 vendor-neutral reference set (`01-25_*.pdf` u ~/Desktop/GDD/)        │
│ 308 sintetičkih (gen-synthetic-gdds.mjs — sve grid × pattern kombinacije)│
│ 333 untracked PDFs u ~/Desktop/GDD/ bez ground truth (operator può add) │
└──────────────────────────────────────────────────────────────────────────┘
```

### Verify gate (33 step, idempotent, pre-commit hook live)

```
 1. archetype catalog + alias + filter
 2. smartDefaults stage 5 archetype backfill
 3. smartDefaults stage 6 autofix gaps
 4. parser topology prose edge cases (UQ-CASH)
 5. scaffold-block tool E2E (25 archetypes)
 6. ingest tool E2E
 7. archetype docs generator
 8. install-precommit hook installer
 9. UQ-FORTIFY3 third-tier audit fixes
10. UQ-FORTIFY5 fifth-tier audit fixes
11. UQ-FORTIFY6 sixth-tier audit fixes
12. UQ-FORTIFY7 seventh-tier audit fixes
13. UQ-FORTIFY8 eighth-tier audit fixes
14. UQ-7 cache audit
15. unknownFeatureKinds === 0 assertion
16. UQ-16 baseline drift (20 slug)
17. UQ-CASH A6 semantic accuracy
18. UQ-TRAIN orchestrator E2E (5 baseline × 8 passes)
19. UQ-FORTIFY2 G7 dirty PDF resilience
20. UQ-COVER cross-corpus force coverage (60 GDD smoke)
21. UQ-MASTERY-3 V10 industry compliance spec (17 rules × 338 GDDs)
22. UQ-MASTERY-4 V11 deep industry spec (17 HARD + 3 SOFT × 338 GDDs)
23. UQ-MASTERY-4 V11 self-test (17 rule codes flagged on negative fixtures)
24. UQ-MASTERY-5 V8 assembly orchestrator (rule engine × 338 GDDs)
25. UQ-MASTERY-5 V8 self-test (engine select + mandatory + jur + stack)
26. UQ-MASTERY-5 V9 visual QA deterministic (8 struct invariants × 338)
27. UQ-MASTERY-5 V9 self-test (clean PASS + missing controls FAIL + WARN)
28. UQ-MASTERY-6 V12 deeper industry spec (9 HARD + 11 SOFT × 338)
29. UQ-MASTERY-6 V12 self-test (9 HARD codes + clean fixture)
30. UQ-FORTIFY9 ninth-tier forensic 5 fixes (XSS/proto/clock/BOM/slug)
31. UQ-TRAIN-2 trainer V2 multi-provider (scoring matrix × N providers)
32. UQ-MASTERY block liveness audit (0 DEAD blokova — 184 blocks × 25 HTMLs)
33. UQ-11 render smoke (20 GDD subset)
```

Komanda: `npm run verify` (~ 5s) · `node tools/verify-idempotency-test.mjs` (assert Pass 1 = Pass 2).

### AI Agent pipeline (Opus 4.8 V2/V5, Kimi V1/V3/V4/V6, V7-V9 deterministic+vision)

```
┌──────┬──────────────────────┬──────────────────────────────────────────────────┐
│ Lane │ Domain                │ Mandatorni output                                 │
├──────┼──────────────────────┼──────────────────────────────────────────────────┤
│ V1   │ topology              │ reels/rows/paylines/kind + evidence + confidence │
│ V2   │ symbols               │ paytable + scatter + wild + named symbols        │
│ V3   │ features              │ feature kinds list sa archetype mapping          │
│ V4   │ ux                    │ theme.tags / palette / capsule / typography      │
│ V5   │ compliance            │ jurisdictions + RTP + handpay + autoplay cap     │
│ V6   │ reconcile             │ deterministic merge V1..V5 + __meta__            │
│ V7   │ BLOCK LIVENESS        │ 184 blocks × 25 HTMLs → 0 DEAD contract          │
│      │ (deterministic walker)│ tool: tools/_block-liveness-walker.mjs           │
│ V8   │ GAME ASSEMBLY         │ GDD → block enable/disable receipts + conflicts  │
│      │ (rule engine + LLM)   │ tool: tools/v8-assembly-orchestrator.mjs (TBD)   │
│ V9   │ VISUAL QA             │ 10-state Playwright screenshots + Opus vision    │
│      │ (vision call, opt-in) │ tool: tools/v9-visual-qa.mjs (TBD)                │
└──────┴──────────────────────┴──────────────────────────────────────────────────┘
```

Pass A → diff vs ground truth → CORRECTIONS block → Pass B (zero-cost kad Pass A ok).
`__self_corrected__: true` stamped na agent reply.
Provider availability:
- **Kimi**: ✅ default (`cortex-kimi-ask`)
- **Claude CLI direkt**: ❌ "Not logged in" — operator mora `claude /login`
- **Fable wrapper**: ✅ fallback NA Claude Opus 4.8 via CLI (radi bez login-a)
- **GPT**: ❌ OpenAI keychain nije postavljen

### Telemetrija (atomic write + file lock + rolling window)

```
┌──────────────────────────────────────────────┬──────────────────────────────┐
│ reports/calibration-history.json              │ 200-run trainer history      │
│ reports/orchestrator-e2e-series.json          │ 100-run E2E series           │
│ reports/uq-cover-series.json                  │ 100-run force coverage       │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

### Wave history (66 fixes, 14 waves, 2026-06-21)

```
UQ-12 → pre-commit verify gate
UQ-13 → smartDefaults stage 6 autofix
UQ-14 → end-to-end ingest CLI
UQ-15 → archetype docs site
UQ-16 → visual regression baseline
UQ-AUDIT → 8 forensic punch-list fixes
UQ-CASH → Game-A deep-fix (6 atoms — lock_respin baseline parser sweep)
UQ-TRAIN → AI orchestrator E2E + trainer + self-correction
UQ-FORTIFY 1..5 → 30 architectural fixes (atomic / race / hash / lock / NFS)
UQ-FORTIFY 6..8 → 11 production-grade fixes (kernel-park / SAB / schema)
UQ-COVER → 338/338 ZERO missing / ZERO phantom force coverage
UQ-OPUS → switched V2/V5 reconcile from Kimi to Opus 4.8 (+400% accuracy)
UQ-MASTERY → block liveness walker (0 DEAD) + V7/V8/V9 agents + gate step 4.91
UQ-MASTERY-2 → 5 LEGO orphan-hook rupa via canonical alias emits
UQ-MASTERY-3 → V10 industry compliance spec (17 rules × 338 GDDs)
UQ-MASTERY-4 → V11 deep industry spec (RTP jurisdiction floor, jackpot
                monotonicity, FS ladder, autoplay caps, lifecycle pairs;
                17 HARD + 3 SOFT codes; self-test sa positive+negative)
UQ-CLEAN     → vendor purge u live docs (CLAUDE.md + memory + MASTER_TODO)
UQ-CLEAN-2   → deep vendor purge (11 src/ + 6 tools/ + 3 docs files)
UQ-MASTERY-5 → V8 GAME ASSEMBLY orchestrator (rule engine + receipt:
                enabledBlocks/disabledBlocks/reasonByBlock/conflicts,
                338/338 PASS, 0 conflicts, self-test verifikuje 5
                kategorija) + V9 VISUAL QA deterministic (8 struct
                invariants per slot.html, score/PASS/WARN/FAIL ladder,
                338/338 PASS, self-test sa 5 fixture-a)
UQ-MASTERY-6 → V12 deeper industry spec (Layer F-K: paytable economics,
                FS economics, bonus-buy economics, engine signature,
                UX presentation; 9 HARD + 11 SOFT codes; 338/338 PASS,
                9-code negative + clean control self-test)
UQ-FORTIFY9  → 5 ninth-tier forensic fixes (XSS via safeJSONInScript,
                prototype pollution guard u mergeIntoModel + parser inline,
                DST/NTP clock skew u fileLock, UTF-16 BOM + JSON silent
                fallback log u parser, slug normalization unify
                parser↔cert/manifest preko NFKD)
UQ-TRAIN-2   → multi-provider trainer V2 (opus/kimi/gpt/gemini matrix,
                winner-per-lane + globalni winner, --providers / --strict
                flags, ready za GPT/Gemini kad postanu dostupni)
```

### Liveness classes (after UQ-MASTERY, 184 blocks total)

```
┌──────────┬───────┬──────────────────────────────────────────────────────┐
│ Class     │ Count │ Meaning                                              │
├──────────┼───────┼──────────────────────────────────────────────────────┤
│ LIVE      │ 156   │ Mounted in rendered HTML or active in HookBus walker │
│ DORMANT   │  28   │ defaultOn=false, no GDD triggered — expected reserve │
│ DEAD      │   0   │ defaultOn=true + 0 trace — GENUINE HOLE, must fix    │
└──────────┴───────┴──────────────────────────────────────────────────────┘
```

### Šta NIKAD ne smem reći

```
❌ "Nisam siguran"
❌ "Možda ne radi"
❌ "Trebalo bi da bude…"
❌ "Pretpostavljam"
✅ "Verifikovao live (X commit), rezultat Y"
✅ "Test runuje DA/NE, log na liniji N"
✅ "Real diff: pre = X, posle = Y, file = Z linija N"
```

### Pre svakog `gotovo` / `✅` / `dovršeno`

1. `npm run verify` mora biti 21/21 zeleno
2. `git status` — ništa untracked koje nije svesno
3. Real diff prikaz (pre/posle vrednosti, ne "trebalo bi")
4. Ako probe ime sadrži "ultimate" — pokrenuti pravu cilju (ne smoke)
5. Posle commit-a: `git log --oneline -3` da potvrdim HEAD je upravo poslat

### Provider zone (kada nešto delegirati)

```
┌──────────────────┬───────────────────────────────────────────────────────┐
│ Zadatak           │ Provider                                              │
├──────────────────┼───────────────────────────────────────────────────────┤
│ Repo audit / fix  │ JA SAM (Claude Opus 4.8 sa direct file access)        │
│ Live test runner  │ JA SAM (Bash tool)                                    │
│ Web research      │ Kimi via cortex-kimi-ask                              │
│ V1..V5 reconcile  │ Kimi default ALI Fable fallback radi za Opus path     │
│ Trening calibr.   │ JA (čitam V6 cache vs ground truth, stamp prompts)    │
└──────────────────┴───────────────────────────────────────────────────────┘
```
