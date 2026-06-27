#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#   S L O T   G D D   B U I L D E R  —  ULTIMATIVNI LAUNCHER  (v3 — BLOCK-3+4)
#   VanVinkl Studio
#
#   Dupli klik. Sve radi samo. Uvek najsveziji kod. Sve scenarije pokriva.
#   Sad pokriva i math-backend (port 9001) za convergence profile dugmiće.
#
#   Workflow:
#     [1]  preduslovi (toolchain + Xcode CLT + Python ≥3.8 + cargo opt)
#     [2]  kill (port 5180 + 9001 + http.server + Playwright zombiji)
#     [3]  disk space + auto-cleanup
#     [4]  network probe (offline graceful fallback)
#     [5]  git: clone ili fetch-all + main-guard + auto-stash + ff/rebase/merge
#                 + sister-repo (`slot-math-engine-template`) sync
#     [6]  npm install (lock hash diff) + Playwright chromium
#     [7]  Rust kernel build (sister repo `http_server` release binary)
#     [8]  LEGO integrity grep (orchestrator nema inline definicije)
#     [9]  `npm run verify` (full gate · 100+ steps · ALL GREEN required)
#     [10] math-backend (port 9001) + http.server (5180) — oba u background
#     [11] ready probe za oba servera (HTTP 200, max 25s svaki)
#     [12] open browser + macOS notification + BLOCK-3 profile info
#
#   Idempotentno. Bezbedno na ponovni klik. Bez hang-a u headless kontekstu.
#
#   Log: ~/Library/Logs/SlotGDDBuilder/launcher.log
#   Pull: ALWAYS — fetch --all --tags --prune --force na svaki klik
#
#   Servera:
#     127.0.0.1:5180  → Python http.server (slot.html + samples + dashboard)
#     127.0.0.1:9001  → Node math-backend (POST /batch sa profile za MC panel)
#
#   BLOCK-3 profili (klik unutar slot HTML-a, MC Batch panel):
#     Quick      5M smoke (~20s)               · pre-commit
#     Standard   100M Wilson ≤ 5pp (~5min)     · commit gate
#     Strict     100M→1B→5B (3× confirm)       · pre-release
#     Regulator  1B→5B→10B (audit grade)       · GLI/UKGC
#
#   Escape hatches:
#     SKIP_VERIFY=1   preskoči glavni gate (1-2 min ušteda)
#     SKIP_TESTS=1    alias za SKIP_VERIFY
#     AUTO_CHOICE=N   default index pri choice prompt-ima (0=safe)
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

# ── ARG PARSING ─────────────────────────────────────────────────────────────
# BLOCK-6+ (2026-06-27): launcher može da radi u režimu server-only
# (bez otvaranja browser-a) da ga SlotGDDOpener.app može pozivati u pozadini.
SERVER_ONLY=0
NO_BROWSER=0
for arg in "$@"; do
  case "$arg" in
    --server-only) SERVER_ONLY=1 ;;
    --no-browser)  NO_BROWSER=1 ;;
  esac
done

# ── CONFIG ──────────────────────────────────────────────────────────────────
PROJECT_DIR="/Users/vanvinklstudio/Projects/slot-gdd-factory"
SISTER_DIR="/Users/vanvinklstudio/Projects/slot-math-engine-template"
REPO_URL="https://github.com/Bojan20/slot-gdd-factory.git"
GIT_BRANCH_DEFAULT="main"
GIT_REMOTE="origin"

SERVER_HOST="127.0.0.1"
SERVER_PORT=5180
SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}/"
SERVER_READY_TIMEOUT_SEC=25

BACKEND_PORT=9001
BACKEND_URL="http://${SERVER_HOST}:${BACKEND_PORT}/"
BACKEND_HEALTH_URL="${BACKEND_URL}health"

LOG_DIR="$HOME/Library/Logs/SlotGDDBuilder"
LOG_FILE="$LOG_DIR/launcher.log"
TEST_LOG_DIR="$LOG_DIR/tests"
mkdir -p "$LOG_DIR" "$TEST_LOG_DIR" 2>/dev/null

# Disk pragovi (GB)
DISK_MIN_FREE_GB=2
DISK_CLEANUP_TRIGGER_GB=5
FAST_PATH_HASH_FILE="$PROJECT_DIR/.last-build-hash"

# ── LEGO POLICY (rule_slot_gdd_lego_blocks.md) ─────────────────────────────
LEGO_FORBIDDEN_NAMES="detectLineWins|drawPaylineOverlay|playWinSymCycle|_buildStandardPaylines|emitScatterCelebrationRuntime|emitWinPresentationRuntime|emitDetectWinCombosRuntime|emitAnticipationRuntime|emitSpinTempoRuntime|emitFreeSpinsRuntime|emitStageBadgeRuntime|emitPostSpinRuntime|emitReelEngineRuntime|emitReelEngineCSS|emitPaylineOverlayRuntime|emitTriggerCountingRuntime|buildStandardPaylines"
LEGO_INLINE_REGEX="^(export[[:space:]]+)?(async[[:space:]]+)?(function[[:space:]]+(${LEGO_FORBIDDEN_NAMES})[[:space:]]*\(|(const|let|var)[[:space:]]+(${LEGO_FORBIDDEN_NAMES})[[:space:]]*=)"
LEGO_ORCHESTRATOR="src/buildSlotHTML.mjs"

TOTAL_STEPS=12
START_TS=$(date +%s)

# ── UI / LOGGING ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; PURPLE='\033[0;35m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

echo "=== Slot GDD Builder Launcher v3 — $(date '+%Y-%m-%d %H:%M:%S') ===" > "$LOG_FILE"

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

pause_if_tty() { :; }

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

prompt_choice() {
  local prompt="$1"; shift
  local options=("$@")
  local choice="${AUTO_CHOICE:-0}"
  log "${DIM}? $prompt → auto-pick #$((choice + 1)) (${options[$choice]})${NC}"
  echo "Auto-choice: $((choice + 1)) — ${options[$choice]}" >> "$LOG_FILE"
  return "$choice"
}

# Bootstrap PATH za Finder context
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/sbin:/usr/sbin:/sbin"

SERVER_PID=""
SERVER_LOG=""
BACKEND_PID=""
BACKEND_LOG=""
cleanup_on_exit() {
  [ -n "$SERVER_LOG" ] && [ -f "$SERVER_LOG" ] && rm -f "$SERVER_LOG" 2>/dev/null
  [ -n "$BACKEND_LOG" ] && [ -f "$BACKEND_LOG" ] && rm -f "$BACKEND_LOG" 2>/dev/null
}
trap cleanup_on_exit EXIT

# SKIP_TESTS alias za SKIP_VERIFY (legacy compat)
if [ "${SKIP_TESTS:-0}" = "1" ] && [ "${SKIP_VERIFY:-0}" != "1" ]; then
  SKIP_VERIFY=1
fi

# ── BANNER ──────────────────────────────────────────────────────────────────
clear
echo ""
log "${BOLD}🎰 Slot GDD Builder — Ultimate Launcher v3${NC}"
log "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
log "${PURPLE}════════════════════════════════════════${NC}"
log "${DIM}Projekat:  $PROJECT_DIR${NC}"
log "${DIM}Sister:    $SISTER_DIR${NC}"
log "${DIM}Server:    $SERVER_URL${NC}"
log "${DIM}Backend:   $BACKEND_URL${NC}"
log "${DIM}Log:       $LOG_FILE${NC}"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# STEP 1: PREDUSLOVI
# ════════════════════════════════════════════════════════════════════════════
step 1 "Provera preduslova (toolchain + Rust opt)"

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
  fail "Toolchain nepotpun"
fi

PY_MAJOR=$(python3 -c 'import sys; print(sys.version_info.major)' 2>/dev/null || echo 0)
PY_MINOR=$(python3 -c 'import sys; print(sys.version_info.minor)' 2>/dev/null || echo 0)
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 8 ]; }; then
  fail "Python 3.8+ je potreban (imaš $PY_MAJOR.$PY_MINOR)"
fi

HAS_CARGO=0
if command -v cargo >/dev/null 2>&1; then
  HAS_CARGO=1
  echo "cargo: $(cargo --version)" >> "$LOG_FILE"
fi

{
  echo "node:    $(node --version)"
  echo "npm:     $(npm --version)"
  echo "git:     $(git --version)"
  echo "python3: $(python3 --version)"
  [ "$HAS_CARGO" -eq 1 ] && echo "cargo:   $(cargo --version)"
} >> "$LOG_FILE"

if [ "$HAS_CARGO" -eq 1 ]; then
  ok "Toolchain: node $(node --version) · npm $(npm --version) · python3 ${PY_MAJOR}.${PY_MINOR} · cargo ✓"
else
  ok "Toolchain: node $(node --version) · npm $(npm --version) · python3 ${PY_MAJOR}.${PY_MINOR}"
  info "cargo nije nadjen — preskačem Rust kernel rebuild (koristim postojeci binary)"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 2: KILL OLD SERVERA (5180 + 9001)
# ════════════════════════════════════════════════════════════════════════════
step 2 "Zaustavljanje starih instanci (port $SERVER_PORT + $BACKEND_PORT)"

KILLED=0
for P in "$SERVER_PORT" "$BACKEND_PORT"; do
  PIDS=$(lsof -ti tcp:"$P" 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    info "Port $P zauzet (PID: $PIDS) — TERM pa KILL"
    echo "$PIDS" | xargs kill -TERM 2>/dev/null || true
    sleep 1
    PIDS=$(lsof -ti tcp:"$P" 2>/dev/null || true)
    [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -KILL 2>/dev/null || true
    KILLED=1
  fi
done

for PATTERN in \
  "python3.*http\.server.*${SERVER_PORT}" \
  "playwright.*headless_shell" \
  "math-backend\.mjs" \
  "http_server"; do
  if pgrep -f "$PATTERN" >/dev/null 2>&1; then
    pkill -9 -f "$PATTERN" 2>/dev/null || true
    KILLED=1
  fi
done

for P in "$SERVER_PORT" "$BACKEND_PORT"; do
  ATTEMPT=0
  while [ "$ATTEMPT" -lt 8 ]; do
    if ! lsof -ti tcp:"$P" >/dev/null 2>&1; then
      break
    fi
    PIDS=$(lsof -ti tcp:"$P" 2>/dev/null || true)
    [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -KILL 2>/dev/null || true
    ATTEMPT=$((ATTEMPT + 1))
    sleep 0.4
  done
  if lsof -ti tcp:"$P" >/dev/null 2>&1; then
    fail "Port $P i dalje zauzet posle TERM+KILL+retry — ručno: lsof -ti tcp:$P | xargs kill -9"
  fi
done

if [ "$KILLED" -eq 1 ]; then
  ok "Stare instance zaustavljene, portovi slobodni"
else
  ok "Nije bilo aktivnih instanci"
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
  HEAD_SHORT="${CURRENT_HEAD:0:8}"
  HEAD_MSG=$(git log -1 --format='%s' 2>/dev/null | head -c 60)
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
  SISTER_HEAD=""
  [ -d "$SISTER_DIR/.git" ] && SISTER_HEAD=$(cd "$SISTER_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "?")
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
  rm -rf "$PROJECT_DIR/dist" 2>/dev/null || true
  rm -rf "$PROJECT_DIR/node_modules/.cache" "$PROJECT_DIR/node_modules/.vite" 2>/dev/null || true
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
  AUTO_CHOICE=1 prompt_choice "Bez mreze. Sta da radim?" \
    "Prekini (sacekacu mrezu)" \
    "Nastavi sa lokalnim kodom"
  info "Nastavljam offline — koristim lokalni kod"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 5: GIT SYNC — uvek najsveziji kod sa origin/main
# ════════════════════════════════════════════════════════════════════════════
step 5 "Git sync — slot-gdd-factory + sister slot-math-engine-template"

# Clone factory ako ne postoji
if [ ! -d "$PROJECT_DIR/.git" ]; then
  if [ "$NETWORK_OK" -eq 1 ]; then
    info "Repo ne postoji — kloniram..."
    mkdir -p "$(dirname "$PROJECT_DIR")"
    git clone "$REPO_URL" "$PROJECT_DIR" >> "$LOG_FILE" 2>&1 || fail "git clone failed"
    ok "git clone OK"
  else
    fail "Repo ne postoji a nema mreze — abort"
  fi
fi

cd "$PROJECT_DIR" || fail "cd $PROJECT_DIR"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
info "Trenutna grana: $CURRENT_BRANCH"

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

if [ "$NETWORK_OK" -eq 1 ]; then
  log "  ${BLUE}▸${NC} git fetch --all --tags --prune --force"
  if ! git fetch --all --tags --prune --force >> "$LOG_FILE" 2>&1; then
    [ "$STASH_CREATED" -eq 1 ] && git stash pop >> "$LOG_FILE" 2>&1 || true
    fail "git fetch"
  fi
  ok "Fetch OK — svi refs sveži"
fi

if [ "$CURRENT_BRANCH" != "$GIT_BRANCH_DEFAULT" ] && [ "$CURRENT_BRANCH" != "detached" ]; then
  warn "Nisi na '$GIT_BRANCH_DEFAULT' (na: $CURRENT_BRANCH)"
  AUTO_CHOICE=0 prompt_choice "Sta sa branch-om?" \
    "Ostani na $CURRENT_BRANCH" \
    "Switch → $GIT_BRANCH_DEFAULT"
  info "Ostajem na $CURRENT_BRANCH"
fi

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
      AUTO_CHOICE=0 prompt_choice "Strategija?" "Rebase" "Merge" "Skip"
      if ! git rebase "$GIT_REMOTE/$CURRENT_BRANCH" >> "$LOG_FILE" 2>&1; then
        git rebase --abort >> "$LOG_FILE" 2>&1 || true
        [ "$STASH_CREATED" -eq 1 ] && git stash pop >> "$LOG_FILE" 2>&1 || true
        fail "Rebase conflict — riješi ručno"
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
      info "Imas $AHEAD lokalnih commits-a (nepush-ovani)"
    fi
  fi
fi

if [ "$STASH_CREATED" -eq 1 ]; then
  if git stash pop >> "$LOG_FILE" 2>&1; then
    ok "Lokalne izmene vraćene"
  else
    warn "Stash pop pao (conflict) — izmene u: git stash list"
  fi
fi

HEAD_SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
HEAD_MSG=$(git log -1 --format='%s' 2>/dev/null | head -c 60)
log "${GREEN}🟢 Factory HEAD: ${HEAD_SHORT}${NC} ${DIM}— ${HEAD_MSG}${NC}"

# Sister repo sync (opt-in)
SISTER_HEAD=""
if [ -d "$SISTER_DIR/.git" ]; then
  ( cd "$SISTER_DIR" || exit 0
    if [ "$NETWORK_OK" -eq 1 ]; then
      git fetch --all --tags --prune --force >> "$LOG_FILE" 2>&1 || true
      SBR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      SRM=$(git rev-parse "origin/$SBR" 2>/dev/null || echo "")
      SLO=$(git rev-parse HEAD 2>/dev/null || echo "")
      if [ -n "$SRM" ] && [ "$SLO" != "$SRM" ]; then
        git pull --ff-only origin "$SBR" >> "$LOG_FILE" 2>&1 || true
      fi
    fi
  )
  SISTER_HEAD=$(cd "$SISTER_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "?")
  log "${GREEN}🟢 Sister  HEAD: ${SISTER_HEAD}${NC} ${DIM}— $SISTER_DIR${NC}"
else
  warn "Sister repo ne postoji: $SISTER_DIR"
  info "Bez sister-a, math-backend ne moze da pokrene Rust kernel"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 6: NPM INSTALL + PLAYWRIGHT CHROMIUM
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
    info "package-lock.json promenjen"
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

if [ "$NETWORK_OK" -eq 1 ] && [ -d "node_modules/playwright" ]; then
  PW_DRY=$(npx --no-install playwright install --dry-run chromium 2>&1 || true)
  if echo "$PW_DRY" | grep -qiE "(downloading|missing|will install)"; then
    info "Playwright chromium nedostaje — instalira"
    if npx playwright install chromium >> "$LOG_FILE" 2>&1; then
      ok "Playwright chromium spreman"
    else
      warn "Playwright install pao — F1 walker ce biti preskocen"
    fi
  else
    ok "Playwright chromium već prisutan"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 7: RUST KERNEL CHECK (BLOCK-8 · vendored u repo · jedan projekat)
# ════════════════════════════════════════════════════════════════════════════
step 7 "Rust kernel (vendor/bin/mc_runtime_real — jedan projekat)"

VENDOR_BINARY="$PROJECT_DIR/vendor/bin/mc_runtime_real"
if [ -x "$VENDOR_BINARY" ]; then
  BIN_SIZE=$(stat -f%z "$VENDOR_BINARY" 2>/dev/null || echo "?")
  ok "Rust kernel vendored u repo: vendor/bin/mc_runtime_real (${BIN_SIZE} bytes)"
else
  warn "vendor/bin/mc_runtime_real ne postoji u repo-u"
  if [ -d "$SISTER_DIR" ] && [ "$HAS_CARGO" -eq 1 ]; then
    info "Auto-build iz sister-a + copy u vendor/bin/"
    if ( cd "$SISTER_DIR" && cargo build --release --bin mc_runtime_real >> "$LOG_FILE" 2>&1 ); then
      SISTER_BIN="$SISTER_DIR/target/release/mc_runtime_real"
      if [ -x "$SISTER_BIN" ]; then
        mkdir -p "$PROJECT_DIR/vendor/bin"
        cp "$SISTER_BIN" "$VENDOR_BINARY"
        chmod +x "$VENDOR_BINARY"
        ok "Vendored: vendor/bin/mc_runtime_real"
      fi
    else
      warn "cargo build pao — vidi log"
    fi
  else
    warn "Nema vendor binary-ja, nema sister+cargo fallback-a"
    info "Profile dugmici (Quick/Standard/Strict/Regulator) ce vratiti 502"
    info "Rebuild instrukcije: vendor/bin/README.md"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 8: LEGO INTEGRITY
# ════════════════════════════════════════════════════════════════════════════
step 8 "LEGO integrity — orchestrator je samo dirigent"

if [ ! -f "$LEGO_ORCHESTRATOR" ]; then
  warn "$LEGO_ORCHESTRATOR ne postoji — preskacem"
else
  HITS=$(grep -nE "$LEGO_INLINE_REGEX" "$LEGO_ORCHESTRATOR" 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    log "${RED}✗ LEGO PRAVILO PREKRŠENO — inline definicija u orchestratoru:${NC}"
    echo "$HITS" | sed 's/^/  /' | tee -a "$LOG_FILE"
    fail "LEGO integrity — inline funkcija u orchestratoru"
  else
    ok "LEGO čist — sve emit/build funkcije su u src/blocks/*.mjs"
  fi
  ORCH_LOC=$(wc -l < "$LEGO_ORCHESTRATOR" | tr -d ' ')
  BLOCKS_COUNT=$(ls src/blocks/*.mjs 2>/dev/null | wc -l | tr -d ' ')
  info "Orchestrator: ${ORCH_LOC} LOC · Blokovi: ${BLOCKS_COUNT}"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 9: NPM RUN VERIFY (full gate · 100+ steps)
# ════════════════════════════════════════════════════════════════════════════
step 9 "Verify gate — npm run verify (full · 100+ steps · ALL GREEN required)"

if [ "${SKIP_VERIFY:-0}" = "1" ]; then
  warn "SKIP_VERIFY=1 — preskačem glavni verify gate (1-2 min ušteda)"
  info "Pokreni 'npm run verify' ručno za pun audit kasnije"
else
  log "${YELLOW}${BOLD}⏳ Verify gate traje 1-2 minuta — STRPLJENJE${NC}"
  log "${DIM}   Glavni gate (verify.mjs) pokreće 100+ koraka uključujući:${NC}"
  log "${DIM}     · LEGO discipline · block tests · contract suites${NC}"
  log "${DIM}     · UQ-MASTERY 1-6 audit · MATH-1-12 · BLOCK-1-e gate test${NC}"
  log "${DIM}     · zero-fault runtime walker · render smoke${NC}"
  log "${DIM}   Brzi mode: SKIP_VERIFY=1 bash ~/Desktop/SlotGDDBuilder.command${NC}"
  log ""

  VERIFY_LOG="${TEST_LOG_DIR}/verify-$(date +%s).log"
  if npm run verify > "$VERIFY_LOG" 2>&1; then
    PASSED=$(grep -cE "^\s*✓" "$VERIFY_LOG" 2>/dev/null || echo 0)
    ok "Verify gate ZELEN (${PASSED} step-ova prošlo)"
    tail -n 5 "$VERIFY_LOG" >> "$LOG_FILE"
  else
    PASSED=$(grep -cE "^\s*✓" "$VERIFY_LOG" 2>/dev/null || echo 0)
    FAILED=$(grep -cE "^\s*✗" "$VERIFY_LOG" 2>/dev/null || echo 0)
    warn "Verify gate PAO (${PASSED} pass / ${FAILED} fail) — log: $VERIFY_LOG"
    tail -n 30 "$VERIFY_LOG" | sed 's/^/    /' | tee -a "$LOG_FILE"
    AUTO_CHOICE=1 prompt_choice "Verify gate ima FAIL. Sta da radim?" \
      "Prekini (popravi pa restartuj)" \
      "Nastavi (pokreni server svejedno)"
    warn "Nastavljam uprkos verify FAIL — log: $VERIFY_LOG"
  fi
fi

fi   # <-- kraj FAST_PATH=0 bloka (Steps 3-9)

# ════════════════════════════════════════════════════════════════════════════
# STEP 10: MATH BACKEND + HTTP SERVER (oba u background-u)
# ════════════════════════════════════════════════════════════════════════════
step 10 "Math backend (port $BACKEND_PORT) + HTTP server (port $SERVER_PORT)"

cd "$PROJECT_DIR" || fail "cd $PROJECT_DIR"

# Math backend
BACKEND_LOG=$(mktemp -t slotgdd-backend.XXXXXX)
if [ -f "$PROJECT_DIR/tools/math-backend.mjs" ]; then
  ( cd "$PROJECT_DIR" && nohup node tools/math-backend.mjs > "$BACKEND_LOG" 2>&1 ) &
  BACKEND_PID=$!
  info "Math backend pokrenut (PID: $BACKEND_PID) — port $BACKEND_PORT"
  echo "Backend log: $BACKEND_LOG" >> "$LOG_FILE"
else
  warn "tools/math-backend.mjs ne postoji — convergence profile dugmici ce vratiti 502"
fi

# HTTP server
SERVER_LOG=$(mktemp -t slotgdd-server.XXXXXX)
( cd "$PROJECT_DIR" && nohup python3 -u -m http.server "$SERVER_PORT" --bind "$SERVER_HOST" > "$SERVER_LOG" 2>&1 ) &
SERVER_PID=$!
info "HTTP server pokrenut (PID: $SERVER_PID) — port $SERVER_PORT"
echo "Server log: $SERVER_LOG" >> "$LOG_FILE"

# ════════════════════════════════════════════════════════════════════════════
# STEP 11: READY PROBE (oba servera)
# ════════════════════════════════════════════════════════════════════════════
step 11 "Cekam da budu ready (max ${SERVER_READY_TIMEOUT_SEC}s svaki)"

ELAPSED=0
SERVER_READY=0
while [ "$ELAPSED" -lt "$SERVER_READY_TIMEOUT_SEC" ]; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    log "${RED}✗ HTTP server proces je umro:${NC}"
    tail -30 "$SERVER_LOG" | sed 's/^/  /' | tee -a "$LOG_FILE"
    fail "HTTP server crashed"
  fi
  HTTP_CODE=$(curl -s -m 2 -o /dev/null -w "%{http_code}" "$SERVER_URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    SERVER_READY=1
    break
  fi
  sleep 0.5
  ELAPSED=$((ELAPSED + 1))
done
if [ "$SERVER_READY" -eq 0 ]; then
  log "${RED}✗ HTTP server nije postao ready u ${SERVER_READY_TIMEOUT_SEC}s${NC}"
  tail -30 "$SERVER_LOG" | sed 's/^/  /' | tee -a "$LOG_FILE"
  kill -9 "$SERVER_PID" 2>/dev/null || true
  fail "HTTP server ready timeout"
fi
ok "HTTP server ready: $SERVER_URL"

BACKEND_READY=0
if [ -n "$BACKEND_PID" ]; then
  ELAPSED=0
  while [ "$ELAPSED" -lt "$SERVER_READY_TIMEOUT_SEC" ]; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      warn "Math backend proces je umro — convergence neće raditi"
      tail -20 "$BACKEND_LOG" | sed 's/^/  /' | tee -a "$LOG_FILE"
      BACKEND_PID=""
      break
    fi
    HC=$(curl -s -m 2 -o /dev/null -w "%{http_code}" "$BACKEND_HEALTH_URL" 2>/dev/null || echo "000")
    if [ "$HC" = "200" ]; then
      BACKEND_READY=1
      break
    fi
    sleep 0.5
    ELAPSED=$((ELAPSED + 1))
  done
  if [ "$BACKEND_READY" -eq 1 ]; then
    ok "Math backend ready: $BACKEND_URL"
  else
    warn "Math backend nije postao ready u ${SERVER_READY_TIMEOUT_SEC}s — convergence offline"
  fi
fi

MJS_PROBE_PATH="/src/parser.mjs"
MJS_CT=$(curl -s -m 2 -o /dev/null -w "%{content_type}" "${SERVER_URL%/}${MJS_PROBE_PATH}" 2>/dev/null || echo "")
if echo "$MJS_CT" | grep -qiE "(javascript|ecmascript)"; then
  ok ".mjs MIME OK ($MJS_CT)"
else
  warn ".mjs MIME = '$MJS_CT' (očekivano text/javascript)"
fi

cat "$SERVER_LOG" >> "$LOG_FILE" 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════════════
# STEP 12: OPEN BROWSER (direktno simulator — slot.html sa MC Batch panel)
# ════════════════════════════════════════════════════════════════════════════
step 12 "Otvaranje simulator-a u default browser-u"

# BLOCK-6-fix (Boki 2026-06-27): launcher otvara DIREKTNO simulator
# (Cash Eruption slot.html sa MC Batch panelom — Quick/Standard/Strict/
# Regulator dugmići). Dashboard sa listom igara je sporedan i ne otvara
# se automatski; do njega se stiže preko `$SERVER_URL` ako treba.
SIM_REL_PATH="dist/build-gated/cash-eruption/slot.html"
SIM_FULL_PATH="$PROJECT_DIR/$SIM_REL_PATH"
if [ -f "$SIM_FULL_PATH" ]; then
  TARGET_URL="${SERVER_URL%/}/$SIM_REL_PATH"
else
  # Fallback: ako flagship slot.html ne postoji, otvori dashboard tako da
  # Boki može da klikne bilo koju drugu zgrazenu igru.
  warn "Cash Eruption slot.html ne postoji u dist/build-gated/ — otvaram dashboard"
  TARGET_URL="$SERVER_URL"
fi

if [ "$SERVER_ONLY" -eq 0 ] && [ "$NO_BROWSER" -eq 0 ]; then
  open "$TARGET_URL" || fail "open $TARGET_URL"
  ok "Simulator otvoren: $TARGET_URL"
else
  info "Režim server-only / no-browser — ne otvara browser automatski"
fi

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
log "${BOLD}URL:${NC}        $TARGET_URL"
log "${BOLD}HTTP PID:${NC}   $SERVER_PID (python3 http.server :${SERVER_PORT})"
if [ -n "$BACKEND_PID" ]; then
  log "${BOLD}Math PID:${NC}   $BACKEND_PID (math-backend :${BACKEND_PORT})"
fi
log "${DIM}Factory:    $HEAD_SHORT — $HEAD_MSG${NC}"
[ -n "$SISTER_HEAD" ] && log "${DIM}Sister:     $SISTER_HEAD${NC}"
log "${DIM}Branch:     $CURRENT_BRANCH${NC}"
log "${DIM}Log:        $LOG_FILE${NC}"
log ""
log "${YELLOW}Brze adrese:${NC}"
log "  ${DIM}• Simulator (upload GDD):   $SERVER_URL${NC}"
[ -d "$PROJECT_DIR/dist/gallery" ] && log "  ${DIM}• Grid gallery:             ${SERVER_URL%/}/dist/gallery/${NC}"
[ -d "$PROJECT_DIR/samples" ] && log "  ${DIM}• Sample GDDs:              ${SERVER_URL%/}/samples/${NC}"
[ "${BACKEND_READY:-0}" -eq 1 ] && log "  ${DIM}• Math backend health:      $BACKEND_HEALTH_URL${NC}"
log ""
log "${YELLOW}BLOCK-3 profile dugmici (klik na 📊 MC Batch u slot HTML-u):${NC}"
log "  ${DIM}• Quick      5M smoke              ~20s   pre-commit${NC}"
log "  ${DIM}• Standard   100M Wilson ≤ 5pp    ~5min  commit gate${NC}"
log "  ${DIM}• Strict     100M→1B→5B confirm   ~24h   pre-release${NC}"
log "  ${DIM}• Regulator  1B→5B→10B audit      ~80h   GLI/UKGC${NC}"
log ""
log "${YELLOW}Da zaustavis servera:${NC}"
log "  ${DIM}kill $SERVER_PID${NC}"
[ -n "$BACKEND_PID" ] && log "  ${DIM}kill $BACKEND_PID${NC}"
log "  ${DIM}ili:  lsof -ti tcp:$SERVER_PORT,tcp:$BACKEND_PORT | xargs kill -9${NC}"
log ""

notify "Slot GDD Builder 🎰" "Server ready @ ${SERVER_PORT}, backend @ ${BACKEND_PORT}" "${ELAPSED_SEC}s · HEAD ${HEAD_SHORT}"

if [ "$FAST_PATH" -eq 0 ]; then
  FINAL_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
  FINAL_LOCK=$(shasum -a 256 package-lock.json 2>/dev/null | awk '{print $1}')
  {
    echo "HEAD:$FINAL_HEAD"
    echo "LOCK:$FINAL_LOCK"
    echo "TIME:$(date +%s)"
  } > "$FAST_PATH_HASH_FILE"
fi

if [ "$SERVER_ONLY" -eq 0 ]; then
  log "Prozor će se zatvoriti za 5 sekundi..."
  sleep 5
else
  log "Server-only režim — zatvaram odmah, serveri ostaju u pozadini"
fi
exit 0
