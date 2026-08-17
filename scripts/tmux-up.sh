#!/usr/bin/env bash
# Ensures the tmux session hosting the site exists. Safe to run repeatedly:
# if the session is already up this is a no-op.
set -eu

SESSION="${SESSION:-cascade-site}"
cd "$(dirname "$0")/.."
ROOT="$PWD"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "session '$SESSION' already running"
  exit 0
fi

tmux new-session -d -s "$SESSION" -c "$ROOT" "$ROOT/scripts/serve.sh"
echo "started tmux session '$SESSION'"
