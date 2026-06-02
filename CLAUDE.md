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

## 📂 Repo cilj

Jedno dugme → ubaciš GDD (MD/JSON/TXT) → otvori se playable slot template u browser tabu. Math je placeholder dummy. PAR/Math hot-swap je faza 2 (roadmap).

## 🔗 Vezani repoovi

- `~/Projects/slot-math-engine-template/` — heavy CORTEX matični engine (Rust sim, PAR library, Studio v5)
- Ovaj repo: minimalni front-end + parser. **Coexists**, ne replace.

## 🎯 GDD test fixture lista (jedini fajlovi koji idu u `samples/`)

| Fajl | Status |
|---|:--:|
| `WRATH_OF_OLYMPUS_GAME_GDD.md` | ✅ GDD |
| `CRYSTAL_FORGE_GAME_GDD.md` | ✅ GDD |
| (buduća: provera 1-4 koraka iznad pre dodavanja) | — |

Nikad: `*_AUDIO_*.md`, `*_ADB.md`, `*_SDD.md`, `*_SFX_*.md`.
