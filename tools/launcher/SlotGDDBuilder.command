#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#   S L O T   G D D   B U I L D E R   —   FAST + NO-CACHE
#   VanVinkl Studio · 2026-06-09
#
#   Kill stari server → start Node no-cache server → otvori browser sa
#   cache-bust query (?v=timestamp) tako da browser uvek vidi fresh fajlove.
#
#   Log: ~/Library/Logs/SlotGDDBuilder/launcher-fast.log
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail

PROJECT_DIR="/Users/vanvinklstudio/Projects/slot-gdd-factory"
SERVER_HOST="127.0.0.1"
SERVER_PORT=5180
LOG_DIR="$HOME/Library/Logs/SlotGDDBuilder"
LOG_FILE="$LOG_DIR/launcher-fast.log"
mkdir -p "$LOG_DIR" 2>/dev/null

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'
RED=$'\033[0;31m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; NC=$'\033[0m'

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo -e "$*" | tee -a "$LOG_FILE"; }
ok()   { log "${GREEN}✓${NC} $*"; }
warn() { log "${YELLOW}⚠${NC} $*"; }
err()  { log "${RED}✗${NC} $*"; }
info() { log "${CYAN}ℹ${NC} $*"; }

T0=$(date +%s)
log ""
log "${BOLD}🚦 Slot GDD Builder — FAST + NO-CACHE${NC} ${DIM}($(ts))${NC}"
log ""

# ── 1. Project dir provera ─────────────────────────────────────────
if [ ! -d "$PROJECT_DIR" ]; then
  err "Project dir ne postoji: $PROJECT_DIR"
  read -rsn1 -p "Pritisni bilo koje dugme za izlaz…" _
  exit 1
fi
cd "$PROJECT_DIR" || exit 1

# ── 2. Kill stari server na portu 5180 + sve python http.server zombije ──
PIDS_ON_PORT=$(lsof -ti :"$SERVER_PORT" 2>/dev/null || true)
if [ -n "$PIDS_ON_PORT" ]; then
  warn "Port $SERVER_PORT zauzet (PID-ovi: $PIDS_ON_PORT) — gasim"
  echo "$PIDS_ON_PORT" | xargs -r kill -9 2>/dev/null || true
  sleep 0.3
fi
pkill -9 -f "python3.*http.server.*$SERVER_PORT" 2>/dev/null || true
pkill -9 -f "node.*slot-no-cache-server" 2>/dev/null || true

# ── 3. Node no-cache server (inline) ────────────────────────────────
# macOS mktemp adds a SECOND random suffix when template ends in .mjs,
# so the file becomes slot-no-cache-server.XXXXXX.mjs.RANDOM → Node refuses
# the unknown extension. Use a stable, predictable filename instead.
SERVER_LOG=$(mktemp -t slotgdd-fast.XXXXXX)
SERVER_SCRIPT="${TMPDIR:-/tmp}/slot-no-cache-server-$$.mjs"
cat > "$SERVER_SCRIPT" <<'NODE_EOF'
import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import url  from 'node:url';
const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 5180);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.pdf':  'application/pdf',
  '.md':   'text/markdown; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma':        'no-cache',
  'Expires':       '0',
};
http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(url.parse(req.url).pathname || '/');
    if (p === '/') p = '/index.html';
    /* path traversal guard */
    const fpath = path.normalize(path.join(ROOT, p));
    if (!fpath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    fs.stat(fpath, (err, st) => {
      if (err || !st.isFile()) {
        if (!err && st.isDirectory()) {
          const idx = path.join(fpath, 'index.html');
          if (fs.existsSync(idx)) return _serve(idx, res);
        }
        res.writeHead(404, NO_CACHE);
        return res.end('not found: ' + p);
      }
      _serve(fpath, res);
    });
  } catch (e) {
    res.writeHead(500, NO_CACHE);
    res.end('server error: ' + e.message);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('listening on http://127.0.0.1:' + PORT + ' (no-store)');
});
function _serve(fpath, res) {
  const ext = path.extname(fpath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, ...NO_CACHE });
  fs.createReadStream(fpath).pipe(res);
}
NODE_EOF

( cd "$PROJECT_DIR" && PORT="$SERVER_PORT" nohup node "$SERVER_SCRIPT" > "$SERVER_LOG" 2>&1 ) &
SERVER_PID=$!
info "Node no-cache server (PID: $SERVER_PID) — log: $SERVER_LOG"

# ── 4. Probe da je server ready (max 5s) ───────────────────────────
SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}/"
READY=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null -w "%{http_code}" --max-time 1 "$SERVER_URL" 2>/dev/null | grep -q "200"; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 1 ]; then
  ok "Server ready (no-cache headers): $SERVER_URL"
else
  err "Server NIJE ready za 5 s — proveri log: $SERVER_LOG"
  read -rsn1 -p "Pritisni bilo koje dugme za izlaz…" _
  exit 1
fi

# ── 5. NE otvaraj browser — Boki: "ne otvaraj mi ti" (09.06.2026) ──
# Server je spreman, URL je ispod. Boki sam klikne / copy-paste.
BUST=$(date +%s)
TARGET_URL="${SERVER_URL}?v=${BUST}"

# ── 6. Notification + summary ──────────────────────────────────────
T1=$(date +%s)
ELAPSED=$((T1 - T0))
osascript -e "display notification \"Server spreman za ${ELAPSED}s — otvori manuelno\" with title \"Slot GDD Builder\" sound name \"Glass\"" 2>/dev/null || true

log ""
log "${BOLD}${GREEN}✓ Server READY za ${ELAPSED}s${NC}  ${DIM}no-store + cache-bust query${NC}"
log ""
log "${BOLD}${CYAN}🔗 Otvori manuelno:${NC}"
log "   ${BOLD}${TARGET_URL}${NC}"
log ""
log "${DIM}   Server PID: $SERVER_PID — ostaje u pozadini${NC}"
log "${DIM}   Cmd+dblclick link iznad ili copy → paste u browser${NC}"
log "${DIM}   Da ugasiš server: lsof -ti :$SERVER_PORT | xargs kill${NC}"
log ""

exit 0
