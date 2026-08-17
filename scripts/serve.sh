#!/usr/bin/env bash
# Supervisor loop: keeps the Bun server running forever inside tmux.
# If the server exits for any reason it is restarted after a short backoff.
set -u

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
LOG_DIR="${LOG_DIR:-logs}"
mkdir -p "$LOG_DIR"

export PATH="$HOME/.bun/bin:$PATH"

while true; do
  echo "[$(date -Is)] starting bun server on port $PORT" | tee -a "$LOG_DIR/server.log"
  PORT="$PORT" bun run server.ts 2>&1 | tee -a "$LOG_DIR/server.log"
  code=${PIPESTATUS[0]}
  echo "[$(date -Is)] server exited (code $code) — restarting in 2s" | tee -a "$LOG_DIR/server.log"
  sleep 2
done
