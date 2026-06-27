#!/usr/bin/env bash
# Parallel multi-worker Monte Carlo for Wrath runtime math.
# Spawns N workers each running M spins with a unique seed, then aggregates.
#
# Usage: ./scripts/wrath-runtime-mc-parallel.sh <TOTAL_SPINS> [WORKERS]
#
# Example: ./scripts/wrath-runtime-mc-parallel.sh 10000000000 8   # 10B / 8 workers

set -euo pipefail

TOTAL_SPINS=${1:-1000000000}
WORKERS=${2:-8}
PER_WORKER=$(( TOTAL_SPINS / WORKERS ))
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$SCRIPT_DIR/wrath-runtime-mc-fast.mjs"

OUTDIR="/tmp/wrath-mc-${TOTAL_SPINS}"
mkdir -p "$OUTDIR"
rm -f "$OUTDIR"/*.json "$OUTDIR"/*.log

echo "Launching $WORKERS workers × $PER_WORKER spins each = $TOTAL_SPINS total..."
echo "Output: $OUTDIR"
echo ""

PIDS=()
t0=$(date +%s)
for i in $(seq 1 "$WORKERS"); do
  seed=$((12345 + i * 1000))
  node "$SCRIPT" "$PER_WORKER" "$seed" > "$OUTDIR/w${i}.json" 2> "$OUTDIR/w${i}.log" &
  pid=$!
  PIDS+=("$pid")
  echo "  worker $i pid=$pid seed=$seed"
done

echo ""
echo "Waiting for $WORKERS workers..."
for pid in "${PIDS[@]}"; do
  wait "$pid"
done
t1=$(date +%s)
wallclock=$(( t1 - t0 ))

echo ""
echo "All workers done in ${wallclock}s.  Aggregating..."
node -e "
const fs = require('fs');
const path = require('path');
const dir = '$OUTDIR';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => path.join(dir, f));
let agg = {
  totalWagered: 0, totalWon: 0, hits: 0, maxWin: 0,
  baseLineWins: 0, scatterPays: 0, lightningUplift: 0, freeSpins: 0, holdAndWin: 0,
  fsTrig: 0, hnwTrig: 0, lightTrig: 0,
  workerCount: 0, workerRtps: [],
};
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  agg.totalWagered += r.totalWagered;
  agg.totalWon += r.totalWon;
  agg.hits += r.hits;
  if (r.maxWin > agg.maxWin) agg.maxWin = r.maxWin;
  agg.baseLineWins += r.buckets.baseLineWins * r.totalWagered;
  agg.scatterPays += r.buckets.scatterPays * r.totalWagered;
  agg.lightningUplift += r.buckets.lightningUplift * r.totalWagered;
  agg.freeSpins += r.buckets.freeSpins * r.totalWagered;
  agg.holdAndWin += r.buckets.holdAndWin * r.totalWagered;
  agg.fsTrig += r.triggers.fs;
  agg.hnwTrig += r.triggers.hnw;
  agg.lightTrig += r.triggers.lightning;
  agg.workerCount++;
  agg.workerRtps.push(r.rtpPct);
}
const N = agg.totalWagered;
const rtp = (agg.totalWon / N) * 100;
const buckets = {
  baseLineWins:    agg.baseLineWins / N,
  scatterPays:     agg.scatterPays / N,
  lightningUplift: agg.lightningUplift / N,
  freeSpins:       agg.freeSpins / N,
  holdAndWin:      agg.holdAndWin / N,
};
const sum = Object.values(buckets).reduce((s, v) => s + v, 0);
// Cross-worker stderr on RTP (independent seeds)
const wmean = agg.workerRtps.reduce((s, v) => s + v, 0) / agg.workerRtps.length;
const wvar = agg.workerRtps.reduce((s, v) => s + (v - wmean) ** 2, 0) / (agg.workerRtps.length - 1);
const stderrAcrossWorkers = Math.sqrt(wvar / agg.workerRtps.length);

const target = {
  rtp: 96.0232, base: 27.8188, scatter: 1.7522, lightning: 6.7750, fs: 20.0922, hnw: 39.6979,
  fsFreq: 117.98, hnwFreq: 110.91, totalRtp: 96.1360,
};

const fmt = (m, t) => {
  const d = (m - t);
  const sign = d >= 0 ? '+' : '';
  return \`\${m.toFixed(4)}%   \${t.toFixed(4)}%   \${sign}\${d.toFixed(4)}pp\`;
};

console.log('');
console.log('  ╔══════════════════════════════════════════════════════════════════════╗');
console.log(\`  ║   Wrath MC aggregate — \${(N / 1e9).toFixed(2)}B spins · \${agg.workerCount} workers · \${'$wallclock'}s wallclock     ║\`);
console.log('  ╚══════════════════════════════════════════════════════════════════════╝');
console.log('');
console.log(\`  Total wagered:     \${N.toLocaleString()}\`);
console.log(\`  Total won:         \${agg.totalWon.toFixed(2).toLocaleString()}\`);
console.log(\`  Hits:              \${agg.hits.toLocaleString()}\`);
console.log(\`  Max win observed:  \${agg.maxWin.toFixed(2)}×\`);
console.log('');
console.log(\`  Per-worker RTPs:   \${agg.workerRtps.map(r => r.toFixed(4)).join(', ')}\`);
console.log(\`  Cross-worker stderr(RTP): \${stderrAcrossWorkers.toFixed(4)}pp\`);
console.log(\`  CI95(RTP):         \${(rtp - 1.96 * stderrAcrossWorkers).toFixed(4)}%  …  \${(rtp + 1.96 * stderrAcrossWorkers).toFixed(4)}%\`);
console.log('');
console.log('  ┌────────────────────────┬─────────────┬─────────────┬───────────────┐');
console.log('  │ Bucket                 │ Measured    │ Target      │ Delta         │');
console.log('  ├────────────────────────┼─────────────┼─────────────┼───────────────┤');
const row = (label, m, t) => {
  const d = (m - t);
  const sign = d >= 0 ? '+' : '';
  return \`  │ \${label.padEnd(22)} │ \${m.toFixed(4).padStart(8)}%   │ \${t.toFixed(4).padStart(8)}%   │ \${(sign + d.toFixed(4)).padStart(10)}pp │\`;
};
console.log(row('base_line_wins',    buckets.baseLineWins * 100,    target.base));
console.log(row('scatter_pays',      buckets.scatterPays * 100,     target.scatter));
console.log(row('lightning_uplift',  buckets.lightningUplift * 100, target.lightning));
console.log(row('free_spins',        buckets.freeSpins * 100,       target.fs));
console.log(row('hold_and_win',      buckets.holdAndWin * 100,      target.hnw));
console.log('  ├────────────────────────┼─────────────┼─────────────┼───────────────┤');
console.log(row('TOTAL_RTP',         rtp,                           target.rtp));
console.log('  └────────────────────────┴─────────────┴─────────────┴───────────────┘');
console.log('');
const fsFreq = N / agg.fsTrig;
const hnwFreq = N / agg.hnwTrig;
console.log(\`  FS  freq:   1-in-\${fsFreq.toFixed(2)}   (target 1-in-\${target.fsFreq})   delta \${(fsFreq - target.fsFreq).toFixed(2)}\`);
console.log(\`  H&W freq:   1-in-\${hnwFreq.toFixed(2)}   (target 1-in-\${target.hnwFreq})   delta \${(hnwFreq - target.hnwFreq).toFixed(2)}\`);
console.log('');
const totalDelta = Math.abs(rtp - target.rtp);
const passInd  = totalDelta < 0.05;
const passLoose = totalDelta < 0.50;
console.log(\`  Industry gate ±0.05pp:  \${passInd ? '✓ PASS' : '✗ FAIL'}  (delta \${totalDelta.toFixed(4)}pp)\`);
console.log(\`  Loose gate    ±0.50pp:  \${passLoose ? '✓ PASS' : '✗ FAIL'}\`);

// Write JSON for later aggregation across runs
const report = { totalSpins: N, walltimeSec: ${wallclock:-0}, workerCount: agg.workerCount, rtpPct: rtp, buckets, target, fsFreq, hnwFreq, maxWin: agg.maxWin, workerRtps: agg.workerRtps, crossStderrPp: stderrAcrossWorkers };
fs.writeFileSync(path.join(dir, 'AGGREGATE.json'), JSON.stringify(report, null, 2));
console.log('');
console.log(\`  Aggregate written: \${path.join(dir, 'AGGREGATE.json')}\`);
"
