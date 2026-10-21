#!/bin/bash
# Starts the demo in the background on port 3030 (restarts if it crashes).
cd "$(dirname "$0")"
[ -f data/daypass.db ] || node seed.js
pkill -f "node server.js" 2>/dev/null
setsid nohup bash -c 'while true; do node server.js >> server.log 2>&1; sleep 2; done' >/dev/null 2>&1 &
echo "Hotel Day Club demo: http://localhost:${PORT:-3030}"
