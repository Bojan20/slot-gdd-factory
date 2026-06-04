#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#   S L O T   G D D   B U I L D E R  —  ULTIMATIVNI LAUNCHER  (v2 — QA-pass)
#   VanVinkl Studio
#
#   Dupli klik. Sve radi samo. Uvek najsveziji kod. Sve scenarije pokriva.
#
#   Workflow:
#     [1]  preduslovi (toolchain + Xcode CLT + Python ≥3.8)
#     [2]  kill (port 5180 + http.server + Playwright zombiji) + verify free
#     [3]  disk space + auto-cleanup
#     [4]  network probe (offline graceful fallback)
#     [5]  git: clone ili fetch-all + main-guard + auto-stash + ff/rebase/merge
#     [6]  npm install (lock hash diff) + Playwright chromium
#     [7]  LEGO integrity grep (orchestrator nema inline definicije)
#     [8]  test suite po fazama (parse · grids · browser · qa · fs)
#     [9]  regen demo (WoO + svi samples koji se promene)
#     [10] python3 http.server :5180 background (--bind 127.0.0.1)
#     [11] ready probe (HTTP 200 sa 127.0.0.1, max 20s)
#     [12] open browser + macOS notification
#
#   Idempotentno. Bezbedno na ponovni klik. Bez hang-a u headless kontekstu.
#
#   Log: ~/Library/Logs/SlotGDDBuilder/launcher.log
#   Pull: ALWAYS — fetch --all --tags --prune --force na svaki klik
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

# ── CONFIG ──────────────────────────────────────────────────────────────────
PROJECT_DIR="/Users/vanvinklstudio/Projects/slot-gdd-factory"
REPO_URL="https://github.com/Bojan20/slot-gdd-factory.git"
GIT_BRANCH_DEFAULT="main"
GIT_REMOTE="origin"

SERVER_HOST="127.0.0.1"   # explicitan IPv4 — izbegava IPv6 fallback delay
SERVER_PORT=5180
SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}/"
SERVER_READY_TIMEOUT_SEC=20

LOG_DIR="$HOME/Library/Logs/SlotGDDBuilder"
LOG_FILE="$LOG_DIR/launcher.log"
TEST_LOG_DIR="$LOG_DIR/tests"
mkdir -p "$LOG_DIR" "$TEST_LOG_DIR" 2>/dev/null

# Disk pragovi (GB)
DISK_MIN_FREE_GB=2
DISK_CLEANUP_TRIGGER_GB=5
FAST_PATH_HASH_FILE="$PROJECT_DIR/.last-build-hash"

# ── LEGO POLICY (rule_slot_gdd_lego_blocks.md) ─────────────────────────────
# Sve emit/build funkcije MORAJU biti definisane u src/blocks/*.mjs.
# `buildSlotHTML.mjs` je samo orchestrator (import + glue), nikad definicija.
# Regex hvata SVE forme deklaracije:
#   function name(            const name = function(      const name = (
#   export function name(     let/var name = ...           async function name(
# Ali NE matchuje assignment (`window.name = name`) ni poziv (`name(...)`).
LEGO_FORBIDDEN_NAMES="detectLineWins|drawPaylineOverlay|playWinSymCycle|_buildStandardPaylines|emitScatterCelebrationRuntime|emitWinPresentationRuntime|emitDetectWinCombosRuntime|emitAnticipationRuntime|emitSpinTempoRuntime|emitFreeSpinsRuntime|emitStageBadgeRuntime|emitPostSpinRuntime|emitReelEngineRuntime|emitReelEngineCSS|emitPaylineOverlayRuntime|emitTriggerCountingRuntime|buildStandardPaylines"
LEGO_INLINE_REGEX="^(export[[:space:]]+)?(async[[:space:]]+)?(function[[:space:]]+(${LEGO_FORBIDDEN_NAMES})[[:space:]]*\(|(const|let|var)[[:space:]]+(${LEGO_FORBIDDEN_NAMES})[[:space:]]*=)"
LEGO_ORCHESTRATOR="src/buildSlotHTML.mjs"

TOTAL_STEPS=12
START_TS=$(date +%s)

# ── UI / LOGGING ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; PURPLE='\033[0;35m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

echo "=== Slot GDD Builder Launcher v2 — $(date '+%Y-%m-%d %H:%M:%S') ===" > "$LOG_FILE"

log()  { echo -e "$1" | tee -a "$LOG_FILE"; }
step() {
  local n="$1"; local title="$2"
  echo "" | tee -a "$LOG_FILE"
  log "${BOLD}${PURPLE}[$n/$TOTAL_STEPS]${NC} ${BOLD}$title${NC}"
  log "${PURPLE}────────────────────────────────────────${NC}"
}
ok()   { log "${GREEN}✓${NC} $1"; }
info() { log "  ${CYAN}ℹ${NC} $1"; }
warn() { log "${YELLOW}⚠${NC} $1"; }

# Ultimativni mode — launcher NIKAD ne ceka unos. `pause_if_tty` zadrzan kao
# no-op stub zbog kompatibilnosti sa starim call site-ovima.
pause_if_tty() { :; }

# macOS native notifikacija — tih, ne blokira terminal
notify() {
  local title="${1:-Slot GDD Builder}"
  local msg="${2:-}"
  local subtitle="${3:-}"
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"$msg\" with title \"$title\" subtitle \"$subtitle\" sound name \"Glass\"" 2>/dev/null || true
}

fail() {
  local what="$1"; local code="${2:-1}"
  echo "" | tee -a "$LOG_FILE"
  log "${RED}${BOLD}✗ GREŠKA: $what (exit $code)${NC}"
  log "${RED}────────────────────────────────────────${NC}"
  log "${YELLOW}Poslednje 60 linija loga:${NC}"
  log ""
  tail -n 60 "$LOG_FILE" | sed 's/^/  /'
  log ""
  log "${YELLOW}Pun log: $LOG_FILE${NC}"
  log ""
  notify "Slot GDD Builder ✗" "$what" "exit $code"
  pause_if_tty
  exit "$code"
}

## ULTIMATE / AUTONOMOUS MODE — launcher NIKAD ne pita Boki-ja.
## Boki direktiva: "ultimativno, sve autonomno, nikad da me ne pita".
## Svaki choice site mora setovati `AUTO_CHOICE=<index>` pre poziva.
## Default ako nije setovan: 0 (prva opcija — uvek "safe/abort" varijanta).
prompt_choice() {
  local prompt="$1"; shift
  local options=("$@")
  local choice="${AUTO_CHOICE:-0}"
  log "${DIM}? $prompt → auto-pick #$((choice + 1)) (${options[$choice]})${NC}"
  echo "Auto-choice: $((choice + 1)) — ${options[$choice]}" >> "$LOG_FILE"
  return "$choice"
}

# Bootstrap PATH za Finder context (dupli klik nema shell rc)
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/sbin:/usr/sbin:/sbin"

# Cleanup — server radi i posle završetka launchera (to je svrha)
SERVER_PID=""
SERVER_LOG=""
cleanup_on_exit() {
  [ -n "$SERVER_LOG" ] && [ -f "$SERVER_LOG" ] && rm -f "$SERVER_LOG" 2>/dev/null
}
trap cleanup_on_exit EXIT
# Namerno NE postavljamo `trap ... ERR` — `set -uo pipefail` bez `-e` ne
# escalira ne-nule do top-level shell-a; eksplicitne `|| fail` rute pokrivaju
# sve scenarije i ne-eksplicitne grane su uglavnom `command || true`.

# ── BANNER ──────────────────────────────────────────────────────────────────
clear
echo ""
log "${BOLD}🎰 Slot GDD Builder — Ultimate Launcher v2${NC}"
log "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
log "${PURPLE}════════════════════════════════════════${NC}"
log "${DIM}Projekat: $PROJECT_DIR${NC}"
log "${DIM}Server:   $SERVER_URL${NC}"
log "${DIM}Log:      $LOG_FILE${NC}"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# STEP 1: PREDUSLOVI (toolchain)
# ════════════════════════════════════════════════════════════════════════════
step 1 "Provera preduslova (toolchain)"

# Xcode CLT — git/python su deo Apple toolchain-a, bez CLT mnogo stvari pada
if ! xcode-select -p >/dev/null 2>&1; then
  warn "Xcode Command Line Tools nedostaju — otvaram installer"
  xcode-select --install >/dev/null 2>&1 || true
  fail "Instaliraj Xcode CLT (otvoren prozor) pa restartuj"
fi
ok "Xcode CLT prisutan"

MISSING=""
for cmd in git node npm npx curl shasum lsof python3; do
  command -v "$cmd" >/dev/null 2>&1 || MISSING="$MISSING $cmd"
done
if [ -n "$MISSING" ]; then
  log "${RED}Nedostaju komande:$MISSING${NC}"
  log "${YELLOW}Instaliraj:${NC}"
  log "  ${DIM}• Node + npm:  brew install node${NC}"
  log "  ${DIM}• python3:     brew install python@3.12${NC}"
  log "  ${DIM}• git:         xcode-select --install${NC}"
  fail "Toolchain nepotpun"
fi

# Python verzija — http.server u <3.8 nema thread-safe SimpleHTTPRequestHandler
PY_MAJOR=$(python3 -c 'import sys; print(sys.version_info.major)' 2>/dev/null || echo 0)
PY_MINOR=$(python3 -c 'import sys; print(sys.version_info.minor)' 2>/dev/null || echo 0)
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 8 ]; }; then
  fail "Python 3.8+ je potreban (imaš $PY_MAJOR.$PY_MINOR)"
fi

{
  echo "node:    $(node --version)"
  echo "npm:     $(npm --version)"
  echo "git:     $(git --version)"
  echo "python3: $(python3 --version)"
} >> "$LOG_FILE"

ok "Toolchain: node $(node --version) · npm $(npm --version) · python3 ${PY_MAJOR}.${PY_MINOR}"

# ════════════════════════════════════════════════════════════════════════════
# STEP 2: KILL OLD SERVER (port 5180) + verify free
# ════════════════════════════════════════════════════════════════════════════
step 2 "Zaustavljanje stare instance (port $SERVER_PORT)"

KILLED=0
PIDS=$(lsof -ti tcp:"$SERVER_PORT" 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  info "Port $SERVER_PORT zauzet (PID: $PIDS) — TERM"
  echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
  sleep 1
  PIDS=$(lsof -ti tcp:"$SERVER_PORT" 2>/dev/null || true)
  [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -KILL 2>/dev/null || true
  KILLED=1
fi

# Bilo koji python3 http.server koji slusa na nasem portu — duplikat zastite
if pgrep -f "python3.*http\.server.*${SERVER_PORT}" >/dev/null 2>&1; then
  pkill -9 -f "python3.*http\.server.*${SERVER_PORT}" 2>/dev/null || true
  KILLED=1
fi

# Playwright zombie (test:browser ponekad ostavlja headless_shell)
if pgrep -f "playwright.*headless_shell" >/dev/null 2>&1; then
  pkill -9 -f "playwright.*headless_shell" 2>/dev/null || true
  KILLED=1
fi

# Verifikacija — port MORA biti slobodan pre koraka 10.
# Senior fix: TIME_WAIT na 5180 nekad traje 2-3s posle TERM+KILL, plus su
# python3.HTTPserver socket-i SO_REUSEADDR=false po default-u → moramo
# retry sa kratkim sleep-om umesto jednog provera-pa-die. 8 pokušaja ×
# 0.4s = 3.2s ukupno, više nego dovoljno za TIME_WAIT cleanup.
ATTEMPT=0
while [ "$ATTEMPT" -lt 8 ]; do
  if ! lsof -ti tcp:"$SERVER_PORT" >/dev/null 2>&1; then
    break
  fi
  # Svaki retry: ponovo kill-9 sve sto se pojavi (npr. supervised respawn).
  PIDS=$(lsof -ti tcp:"$SERVER_PORT" 2>/dev/null || true)
  [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -KILL 2>/dev/null || true
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.4
done
# Šire čišćenje za zombi procese vlasnika ovog terminala — uhvati python3
# http.server koji NIJE na našem portu samo ako greška je da je port
# zauzet (defensive sweep, ne agresivno).
if lsof -ti tcp:"$SERVER_PORT" >/dev/null 2>&1; then
  pkill -9 -u "$USER" -f "python3 -m http.server" 2>/dev/null || true
  sleep 0.8
fi
# Poslednja provera — ako i posle 8 pokušaja + user-scoped sweep port još
# uvek zauzet, eskaliraj i pošalji svim PID-ovima poslednji kill-9.
PIDS=$(lsof -ti tcp:"$SERVER_PORT" 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  warn "Port $SERVER_PORT i dalje zauzet posle 8 retry-ja — final KILL na: $PIDS"
  echo "$PIDS" | xargs kill -KILL 2>/dev/null || true
  sleep 1
fi
if lsof -ti tcp:"$SERVER_PORT" >/dev/null 2>&1; then
  fail "Port $SERVER_PORT i dalje zauzet posle TERM+KILL+retry — ručno: lsof -ti tcp:$SERVER_PORT | xargs kill -9"
fi

if [ "$KILLED" -eq 1 ]; then
  ok "Stara instanca zaustavljena, port slobodan"
else
  ok "Nije bilo aktivne instance"
fi

# ════════════════════════════════════════════════════════════════════════════
# FAST PATH — preskoči build/test/git ako je sve čisto
# ════════════════════════════════════════════════════════════════════════════

FAST_PATH=0
CURRENT_HEAD=""
CURRENT_LOCK_HASH=""

if [ -d "$PROJECT_DIR/node_modules" ] && [ -f "$PROJECT_DIR/dist/index.html" ] && [ -f "$FAST_PATH_HASH_FILE" ]; then
  cd "$PROJECT_DIR" || fail "cd $PROJECT_DIR"
  if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
    CURRENT_LOCK_HASH=$(shasum -a 256 package-lock.json 2>/dev/null | awk '{print $1}')
    SAVED_HEAD=$(grep '^HEAD:' "$FAST_PATH_HASH_FILE" 2>/dev/null | cut -d: -f2-)
    SAVED_LOCK=$(grep '^LOCK:' "$FAST_PATH_HASH_FILE" 2>/dev/null | cut -d: -f2-)

    if [ "$CURRENT_HEAD" = "$SAVED_HEAD" ] && [ "$CURRENT_LOCK_HASH" = "$SAVED_LOCK" ]; then
      FAST_PATH=1
    fi
  fi
fi

if [ "$FAST_PATH" -eq 1 ]; then
  log ""
  log "${GREEN}${BOLD}⚡ FAST PATH — preskačem Steps 3-9 (build, test, git sync)${NC}"
  log "${DIM}   Sve čisto — HEAD ${CURRENT_HEAD:0:8} · lock hash match${NC}"
else
  if [ -d "$PROJECT_DIR/node_modules" ] && [ -f "$PROJECT_DIR/dist/index.html" ]; then
    info "Full path — nema fast path (promene u kodu ili dependencies)"
  fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 3: DISK SPACE + AUTO-CLEANUP
# ════════════════════════════════════════════════════════════════════════════
step 3 "Disk space"

FREE_GB=$(df -g "$HOME" | awk 'NR==2 {print $4}')
info "Slobodno: ${FREE_GB}GB"

if [ "$FREE_GB" -lt "$DISK_CLEANUP_TRIGGER_GB" ]; then
  warn "Slobodno < ${DISK_CLEANUP_TRIGGER_GB}GB — cistim cache"
  # dist/ se regeneriše u koraku 9
  rm -rf "$PROJECT_DIR/dist" 2>/dev/null || true
  # Vite/Webpack/Snowpack cache (ako postoje od ranijih eksperimenata)
  rm -rf "$PROJECT_DIR/node_modules/.cache" "$PROJECT_DIR/node_modules/.vite" 2>/dev/null || true
  # Playwright browser cache (~500MB) samo u kriticnoj situaciji
  if [ "$FREE_GB" -lt "$DISK_MIN_FREE_GB" ]; then
    rm -rf "$HOME/Library/Caches/ms-playwright" 2>/dev/null || true
    npm cache clean --force >> "$LOG_FILE" 2>&1 || true
  fi
  FREE_GB=$(df -g "$HOME" | awk 'NR==2 {print $4}')
  ok "Cleanup zavrsen — sada: ${FREE_GB}GB"
fi

[ "$FREE_GB" -ge "$DISK_MIN_FREE_GB" ] || fail "Premalo prostora: ${FREE_GB}GB (min ${DISK_MIN_FREE_GB}GB)"
ok "Disk: ${FREE_GB}GB ≥ ${DISK_MIN_FREE_GB}GB"

# ════════════════════════════════════════════════════════════════════════════
# STEP 4: NETWORK CHECK
# ════════════════════════════════════════════════════════════════════════════
step 4 "Network check"

NETWORK_OK=0
if curl -s -m 3 -o /dev/null -w "%{http_code}" https://github.com 2>/dev/null | grep -qE "^(200|301|302)$"; then
  NETWORK_OK=1
  ok "GitHub dostupan"
else
  warn "GitHub nedostupan (offline)"
  # Auto: nastavi sa lokalnim kodom (ultimativni mode — server bitan, mreza nije)
  AUTO_CHOICE=1 prompt_choice "Bez mreze. Sta da radim?" \
    "Prekini (sacekacu mrezu — preporuka za 'uvek najnovije')" \
    "Nastavi sa lokalnim kodom (preskoci git + npm install)"
  info "Nastavljam offline — koristim lokalni kod"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 5: GIT SYNC (uvek najsveziji kod sa origin/main)
# ════════════════════════════════════════════════════════════════════════════
step 5 "Git sync — uvek najsveziji kod"

# Clone ako ne postoji
if [ ! -d "$PROJECT_DIR/.git" ]; then
  if [ "$NETWORK_OK" -eq 1 ]; then
    info "Repo ne postoji — kloniram..."
    mkdir -p "$(dirname "$PROJECT_DIR")"
    if git clone "$REPO_URL" "$PROJECT_DIR" >> "$LOG_FILE" 2>&1; then
      ok "git clone OK"
    else
      fail "git clone failed"
    fi
  else
    fail "Repo ne postoji a nema mreze — abort"
  fi
fi

cd "$PROJECT_DIR" || fail "cd $PROJECT_DIR"

# Bezbednosna provera — radimo na pravom repo-u
REMOTE_URL=$(git config --get remote."${GIT_REMOTE}".url 2>/dev/null || echo "")
if [ -n "$REMOTE_URL" ] && [ "$REMOTE_URL" != "$REPO_URL" ]; then
  warn "Remote URL ne odgovara očekivanom — radi: $REMOTE_URL"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
info "Trenutna grana: $CURRENT_BRANCH"

# HEAD existence guard (fresh clone bez commit-a — retko, ali moguce)
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  warn "Nema HEAD-a — preskacem stash/pull"
  HAS_CHANGES=0
else
  HAS_CHANGES=0
  git diff-index --quiet HEAD -- 2>/dev/null || HAS_CHANGES=1
  [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ] && HAS_CHANGES=1
fi

STASH_CREATED=0
if [ "$HAS_CHANGES" -eq 1 ]; then
  warn "Postoje lokalne izmene — auto-stash"
  STASH_MSG="slotgdd-launcher-$(date +%s)"
  if git stash push -u -m "$STASH_MSG" >> "$LOG_FILE" 2>&1; then
    STASH_CREATED=1
    ok "Stash kreiran: $STASH_MSG"
  fi
fi

# UVEK fetch — i kad smo na non-main branch-u (da git tags i sve refs budu sveže)
if [ "$NETWORK_OK" -eq 1 ]; then
  log "  ${BLUE}▸${NC} git fetch --all --tags --prune --force"
  if ! git fetch --all --tags --prune --force >> "$LOG_FILE" 2>&1; then
    [ "$STASH_CREATED" -eq 1 ] && git stash pop >> "$LOG_FILE" 2>&1 || true
    fail "git fetch"
  fi
  ok "Fetch OK — svi refs sveži"
fi

# Branch-aware sync
if [ "$CURRENT_BRANCH" != "$GIT_BRANCH_DEFAULT" ] && [ "$CURRENT_BRANCH" != "detached" ]; then
  warn "Nisi na '$GIT_BRANCH_DEFAULT' (na: $CURRENT_BRANCH)"
  # Auto: ostani na current branch — ne diraj Boki-jevu work-grananu
  AUTO_CHOICE=0 prompt_choice "Sta sa branch-om?" \
    "Ostani na $CURRENT_BRANCH (preskacem main pull)" \
    "Switch → $GIT_BRANCH_DEFAULT (preporuka — uvek najnovije)"
  info "Ostajem na $CURRENT_BRANCH"
fi

# Pull samo ako smo na main i mreza radi
if [ "$NETWORK_OK" -eq 1 ] && [ "$CURRENT_BRANCH" = "$GIT_BRANCH_DEFAULT" ]; then
  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
  REMOTE=$(git rev-parse "$GIT_REMOTE/$CURRENT_BRANCH" 2>/dev/null || echo "")

  if [ -z "$REMOTE" ]; then
    warn "Grana nema remote tracking"
  elif [ "$LOCAL" = "$REMOTE" ]; then
    ok "Već na poslednjem commit-u: ${LOCAL:0:8}"
  else
    BASE=$(git merge-base HEAD "$GIT_REMOTE/$CURRENT_BRANCH" 2>/dev/null || echo "")
    AHEAD=$(git rev-list --count "$BASE..HEAD" 2>/dev/null || echo 0)
    BEHIND=$(git rev-list --count "HEAD..$GIT_REMOTE/$CURRENT_BRANCH" 2>/dev/null || echo 0)

    if [ "$AHEAD" -gt 0 ] && [ "$BEHIND" -gt 0 ]; then
      warn "DIVERGENTNA istorija: $AHEAD lokalnih, $BEHIND udaljenih"
      log "  ${DIM}Lokalni:${NC}"
      git log --oneline "$BASE..HEAD" | head -5 | sed 's/^/    /' | tee -a "$LOG_FILE"
      log "  ${DIM}Udaljeni:${NC}"
      git log --oneline "$BASE..$GIT_REMOTE/$CURRENT_BRANCH" | head -5 | sed 's/^/    /' | tee -a "$LOG_FILE"

      # Auto: rebase za clean history (ako conflict → fail i instrukcija)
      AUTO_CHOICE=0 prompt_choice "Strategija (default: rebase za clean history)?" \
        "Rebase (preporuka — uvek najnovije)" \
        "Merge (sacuvaj oba)" \
        "Skip (zadrzi lokalno)"
      if ! git rebase "$GIT_REMOTE/$CURRENT_BRANCH" >> "$LOG_FILE" 2>&1; then
        git rebase --abort >> "$LOG_FILE" 2>&1 || true
        [ "$STASH_CREATED" -eq 1 ] && git stash pop >> "$LOG_FILE" 2>&1 || true
        fail "Rebase conflict — abortovan, riješi ručno"
      fi
      ok "Rebase uspesan"
    elif [ "$BEHIND" -gt 0 ]; then
      log "  ${BLUE}▸${NC} git pull --ff-only ($BEHIND novih commits)"
      if ! git pull --ff-only "$GIT_REMOTE" "$CURRENT_BRANCH" >> "$LOG_FILE" 2>&1; then
        [ "$STASH_CREATED" -eq 1 ] && git stash pop >> "$LOG_FILE" 2>&1 || true
        fail "git pull --ff-only"
      fi
      NEW_HEAD=$(git rev-parse HEAD)
      ok "Pull: ${LOCAL:0:8} → ${NEW_HEAD:0:8}"
    elif [ "$AHEAD" -gt 0 ]; then
      info "Imas $AHEAD lokalnih commits-a (nepush-ovani — sve je iznad origin/main)"
    fi
  fi
fi

# Pop stash
if [ "$STASH_CREATED" -eq 1 ]; then
  if git stash pop >> "$LOG_FILE" 2>&1; then
    ok "Lokalne izmene vraćene"
  else
    warn "Stash pop pao (conflict) — izmene u: git stash list (label: $STASH_MSG)"
  fi
fi

HEAD_SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
HEAD_MSG=$(git log -1 --format='%s' 2>/dev/null | head -c 60)
log "${GREEN}🟢 HEAD: ${HEAD_SHORT}${NC} ${DIM}— ${HEAD_MSG}${NC}"

# ════════════════════════════════════════════════════════════════════════════
# STEP 6: NPM INSTALL (lock hash diff) + PLAYWRIGHT BROWSER
# ════════════════════════════════════════════════════════════════════════════
step 6 "npm install + Playwright chromium"

NEED_INSTALL=0

if [ ! -d "node_modules" ]; then
  info "node_modules ne postoji"
  NEED_INSTALL=1
elif [ ! -f "node_modules/.package-lock.json" ]; then
  info "node_modules nije clean install"
  NEED_INSTALL=1
elif [ -f "package-lock.json" ]; then
  CURRENT_HASH=$(shasum -a 256 package-lock.json | awk '{print $1}')
  CACHED_HASH=$(shasum -a 256 node_modules/.package-lock.json 2>/dev/null | awk '{print $1}')
  if [ "$CURRENT_HASH" != "$CACHED_HASH" ]; then
    info "package-lock.json promenjen od poslednje instalacije"
    NEED_INSTALL=1
  fi
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  if [ "$NETWORK_OK" -eq 1 ]; then
    log "  ${BLUE}▸${NC} npm install (no-fund, no-audit)"
    if npm install --no-fund --no-audit >> "$LOG_FILE" 2>&1; then
      ok "Dependencies instalirane"
    else
      fail "npm install"
    fi
  else
    warn "Treba install ali nema mreze — koristim postojeci node_modules"
  fi
else
  ok "node_modules svez (lock hash match)"
fi

# Playwright chromium — proveri preko `npx playwright install --dry-run`.
# Ako vrati ne-nulu ili ako cache dir prazan → install.
if [ "$NETWORK_OK" -eq 1 ] && [ -d "node_modules/playwright" ]; then
  PW_DRY=$(npx --no-install playwright install --dry-run chromium 2>&1 || true)
  if echo "$PW_DRY" | grep -qiE "(downloading|missing|will install)"; then
    info "Playwright chromium nedostaje — instalira"
    if npx playwright install chromium >> "$LOG_FILE" 2>&1; then
      ok "Playwright chromium spreman"
    else
      warn "Playwright install pao — test:browser ce biti preskocen"
    fi
  else
    ok "Playwright chromium već prisutan"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 7: LEGO INTEGRITY (rule_slot_gdd_lego_blocks.md)
# ════════════════════════════════════════════════════════════════════════════
step 7 "LEGO integrity — orchestrator je samo dirigent"

if [ ! -f "$LEGO_ORCHESTRATOR" ]; then
  warn "$LEGO_ORCHESTRATOR ne postoji — preskacem (mozda preimenovan)"
else
  # Grep hvata samo DEKLARACIJE (function/const/let/var sa imenom funkcije),
  # ne assignment-e (window.foo = foo) ni pozive (foo(...)).
  HITS=$(grep -nE "$LEGO_INLINE_REGEX" "$LEGO_ORCHESTRATOR" 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    log "${RED}✗ LEGO PRAVILO PREKRŠENO — inline definicija u orchestratoru:${NC}"
    echo "$HITS" | sed 's/^/  /' | tee -a "$LOG_FILE"
    log ""
    log "${YELLOW}Sve emit/build funkcije moraju ići u src/blocks/<name>.mjs${NC}"
    log "${YELLOW}Pravilo: ~/.claude/projects/-/memory/rule_slot_gdd_lego_blocks.md${NC}"
    # Auto: LEGO violation = HARD rule (memory rule_slot_gdd_lego_blocks.md).
    # NIKAD nastavljaj — orchestrator zagađenje pravi blok-tree-shake nemogucim.
    AUTO_CHOICE=0 prompt_choice "Sta da radim?" \
      "Prekini (popravi LEGO, pa restartuj)" \
      "Nastavi svejedno (samo dev, NE commituj)"
    fail "LEGO integrity — inline funkcija u orchestratoru"
  else
    ok "LEGO čist — sve emit/build funkcije su u src/blocks/*.mjs"
  fi

  # Statistika orchestratora — info za Boki-ja koliko je tanak
  ORCH_LOC=$(wc -l < "$LEGO_ORCHESTRATOR" | tr -d ' ')
  BLOCKS_COUNT=$(ls src/blocks/*.mjs 2>/dev/null | wc -l | tr -d ' ')
  info "Orchestrator: ${ORCH_LOC} LOC · Blokovi: ${BLOCKS_COUNT}"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 8: TEST SUITE (po fazama)
# ════════════════════════════════════════════════════════════════════════════
step 8 "Test suite (parse · grids · browser · qa · fs)"

# Escape hatch: `SKIP_TESTS=1` env var bypass-uje pun test suite (3-5 min)
# i odmah skoči na demo regen + server start. Korisno kad Boki samo želi
# da vidi slot, ne da regeneriše audit-e. Postavi pre dupli klika ili
# pokreni iz terminala: `SKIP_TESTS=1 bash ~/Desktop/SlotGDDBuilder.command`
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  warn "SKIP_TESTS=1 — preskačem 5-fazni test suite (3-5 min ušteda)"
  info "Pokreni 'npm run test:all' ručno za pun audit kasnije"
else

log "${YELLOW}${BOLD}⏳ Testovi traju 3-5 minuta — STRPLJENJE, ne zatvaraj prozor${NC}"
log "${DIM}   Browser će se otvoriti automatski na kraju Step [12/12].${NC}"
log "${DIM}   Brzi mode kasnije: bash launcher sa env var SKIP_TESTS=1${NC}"
log ""

TEST_PHASES=(
  "test:parse|Parser (markdown/json GDD)"
  "test:grids|Grid rendering (svi shape-ovi)"
  "test:browser|Browser rendering (Playwright)"
  "test:qa|QA audit (full)"
  "test:fs|Free Spins lifecycle audit"
)

FAILED_PHASES=()
PASSED_COUNT=0
for entry in "${TEST_PHASES[@]}"; do
  phase="${entry%%|*}"
  desc="${entry##*|}"
  phase_log="${TEST_LOG_DIR}/${phase//:/-}-$(date +%s).log"
  log "  ${BLUE}▸${NC} npm run $phase — $desc"
  if npm run "$phase" > "$phase_log" 2>&1; then
    ok "$desc: PASS"
    PASSED_COUNT=$((PASSED_COUNT + 1))
    # Append samo summary u glavni log da ne razlije
    tail -n 5 "$phase_log" >> "$LOG_FILE"
  else
    warn "$desc: FAIL (log: $phase_log)"
    tail -n 30 "$phase_log" | sed 's/^/    /' | tee -a "$LOG_FILE"
    FAILED_PHASES+=("$phase")
  fi
done

if [ ${#FAILED_PHASES[@]} -gt 0 ]; then
  log "${RED}✗ Pali testovi:${NC} ${FAILED_PHASES[*]}"
  # Auto: nastavi i pokreni server — test fail ne sme da blokira dev iteraciju.
  # Logovi su u $TEST_LOG_DIR za naknadni triage.
  AUTO_CHOICE=1 prompt_choice "Testovi imaju FAIL. Sta da radim?" \
    "Prekini (popravi pa restartuj)" \
    "Nastavi (pokreni server svejedno)"
  warn "Nastavljam uprkos fail-ovima (${#FAILED_PHASES[@]}/${#TEST_PHASES[@]}) — logovi: $TEST_LOG_DIR"
else
  ok "Svi testovi PASS (${PASSED_COUNT}/${#TEST_PHASES[@]})"
fi

fi   # <-- kraj SKIP_TESTS bloka

# ════════════════════════════════════════════════════════════════════════════
# STEP 9: REGEN DEMO (WoO + svi samples)
# ════════════════════════════════════════════════════════════════════════════
step 9 "Regen demo iz samples/ (playable HTML u dist/)"

DEMO_COUNT=0
if [ -f "tools/gen-woo-demo.mjs" ]; then
  if node tools/gen-woo-demo.mjs >> "$LOG_FILE" 2>&1; then
    ok "Wrath of Olympus demo regenerisan"
    DEMO_COUNT=$((DEMO_COUNT + 1))
  else
    warn "gen-woo-demo.mjs pao — preskacem"
  fi
fi

# Render gallery (sve shape-ove u dist/gallery/)
if [ -f "tools/render-grid-gallery.mjs" ]; then
  if node tools/render-grid-gallery.mjs >> "$LOG_FILE" 2>&1; then
    ok "Grid gallery regenerisana (dist/gallery/)"
    DEMO_COUNT=$((DEMO_COUNT + 1))
  else
    warn "render-grid-gallery.mjs pao — preskacem"
  fi
fi

info "Regenerisano: ${DEMO_COUNT} demo artefakata"

fi   # <-- kraj FAST_PATH=0 bloka (Steps 3-9)

# ════════════════════════════════════════════════════════════════════════════
# STEP 10: HTTP SERVER (python3 http.server, background)
# ════════════════════════════════════════════════════════════════════════════
step 10 "HTTP server (python3 http.server :${SERVER_PORT}, bind ${SERVER_HOST})"

SERVER_LOG=$(mktemp -t slotgdd-server.XXXXXX)

# `--bind 127.0.0.1` izbegava IPv6 binding + brži probe.
# `nohup` + `&` da server preživi exit launchera (Boki radi u browser-u dok
# terminal može slobodno da se zatvori).
( cd "$PROJECT_DIR" && nohup python3 -u -m http.server "$SERVER_PORT" --bind "$SERVER_HOST" > "$SERVER_LOG" 2>&1 ) &
SERVER_PID=$!

info "Server pokrenut (PID: $SERVER_PID)"
echo "Server log: $SERVER_LOG" >> "$LOG_FILE"

# ════════════════════════════════════════════════════════════════════════════
# STEP 11: READY PROBE
# ════════════════════════════════════════════════════════════════════════════
step 11 "Cekam da server bude ready (max ${SERVER_READY_TIMEOUT_SEC}s)"

ELAPSED=0
READY=0
while [ "$ELAPSED" -lt "$SERVER_READY_TIMEOUT_SEC" ]; do
  # Proces živi?
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    log "${RED}✗ Server proces je umro:${NC}"
    tail -30 "$SERVER_LOG" | sed 's/^/  /' | tee -a "$LOG_FILE"
    fail "HTTP server crashed"
  fi

  HTTP_CODE=$(curl -s -m 2 -o /dev/null -w "%{http_code}" "$SERVER_URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    READY=1
    break
  fi

  sleep 0.5
  ELAPSED=$((ELAPSED + 1))
done

if [ "$READY" -eq 0 ]; then
  log "${RED}✗ Server nije postao ready u ${SERVER_READY_TIMEOUT_SEC}s${NC}"
  tail -30 "$SERVER_LOG" | sed 's/^/  /' | tee -a "$LOG_FILE"
  kill -9 "$SERVER_PID" 2>/dev/null || true
  fail "Server ready timeout"
fi

# MIME smoke — .mjs MORA biti text/javascript (inače app.js import puca)
MJS_PROBE_PATH="/src/parser.mjs"
MJS_CT=$(curl -s -m 2 -o /dev/null -w "%{content_type}" "${SERVER_URL%/}${MJS_PROBE_PATH}" 2>/dev/null || echo "")
if echo "$MJS_CT" | grep -qiE "(javascript|ecmascript)"; then
  ok ".mjs MIME OK ($MJS_CT)"
else
  warn ".mjs MIME = '$MJS_CT' (očekivano text/javascript) — ESM može da puca"
fi

# Append server log
cat "$SERVER_LOG" >> "$LOG_FILE" 2>/dev/null || true

ok "Server ready: $SERVER_URL"

# ════════════════════════════════════════════════════════════════════════════
# STEP 12: OPEN BROWSER
# ════════════════════════════════════════════════════════════════════════════
step 12 "Otvaranje u default browser-u"

TARGET_URL="$SERVER_URL"
open "$TARGET_URL" || fail "open $TARGET_URL"
ok "Browser otvoren: $TARGET_URL"

# ════════════════════════════════════════════════════════════════════════════
# FINAL REPORT
# ════════════════════════════════════════════════════════════════════════════
END_TS=$(date +%s)
ELAPSED_SEC=$((END_TS - START_TS))

echo "" | tee -a "$LOG_FILE"
log "${GREEN}${BOLD}╔════════════════════════════════════════════╗${NC}"
log "${GREEN}${BOLD}║  🎰 SLOT GDD BUILDER POKRENUT — ${ELAPSED_SEC}s         ║${NC}"
log "${GREEN}${BOLD}╚════════════════════════════════════════════╝${NC}"
log ""
log "${BOLD}URL:${NC}     $TARGET_URL"
log "${BOLD}PID:${NC}     $SERVER_PID (python3 http.server)"
log "${DIM}Commit:  $HEAD_SHORT — $HEAD_MSG${NC}"
log "${DIM}Branch:  $CURRENT_BRANCH${NC}"
log "${DIM}Log:     $LOG_FILE${NC}"
log ""
log "${YELLOW}Brze adrese:${NC}"
log "  ${DIM}• Simulator (upload GDD):   $SERVER_URL${NC}"
[ -d "$PROJECT_DIR/dist/gallery" ] && log "  ${DIM}• Grid gallery:             ${SERVER_URL%/}/dist/gallery/${NC}"
[ -d "$PROJECT_DIR/samples" ] && log "  ${DIM}• Sample GDDs:              ${SERVER_URL%/}/samples/${NC}"
log ""
log "${YELLOW}Server radi u pozadini. Da ga zaustavis:${NC}"
log "  ${DIM}kill $SERVER_PID${NC}"
log "  ${DIM}ili:  lsof -ti tcp:$SERVER_PORT | xargs kill -9${NC}"
log ""

notify "Slot GDD Builder 🎰" "Server ready @ port ${SERVER_PORT}" "${ELAPSED_SEC}s · HEAD ${HEAD_SHORT}"

# Snimi hash za sledeći fast path (samo ako je full path prošao)
if [ "$FAST_PATH" -eq 0 ]; then
  FINAL_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
  FINAL_LOCK=$(shasum -a 256 package-lock.json 2>/dev/null | awk '{print $1}')
  {
    echo "HEAD:$FINAL_HEAD"
    echo "LOCK:$FINAL_LOCK"
    echo "TIME:$(date +%s)"
  } > "$FAST_PATH_HASH_FILE"
fi

log "Prozor će se zatvoriti za 5 sekundi..."
sleep 5
exit 0
