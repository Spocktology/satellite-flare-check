#!/usr/bin/env bash
# Commit and push changes in the history checkout ($1), retrying if another
# job pushed first. index.json is rebuilt from the files after each rebase,
# so concurrent jobs writing different days never conflict for real.
set -euo pipefail
HIST="$1"; MSG="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"

python -c "import sys; sys.path.insert(0, '$HERE'); from history_index import build_index; build_index('$HIST')"
git -C "$HIST" add -A
if git -C "$HIST" diff --cached --quiet -- . ':!index.json'; then echo "nothing to commit"; exit 0; fi
git -C "$HIST" commit --quiet -m "$MSG"

for attempt in 1 2 3 4 5; do
  if git -C "$HIST" push --quiet origin history; then echo "pushed"; exit 0; fi
  echo "push rejected (attempt $attempt), rebasing on latest history"
  git -C "$HIST" fetch --quiet --depth 50 origin history
  git -C "$HIST" rebase -X theirs origin/history || { git -C "$HIST" checkout --theirs . && git -C "$HIST" add -A && GIT_EDITOR=true git -C "$HIST" rebase --continue; }
  python -c "import sys; sys.path.insert(0, '$HERE'); from history_index import build_index; build_index('$HIST')"
  git -C "$HIST" add index.json
  git -C "$HIST" commit --quiet --amend --no-edit
  sleep $((attempt * 10))
done
echo "could not push after 5 attempts" >&2
exit 1
