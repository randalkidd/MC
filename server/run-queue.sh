#!/usr/bin/env bash
# Runs one queue on the queue server: `run-queue.sh plan` or `run-queue.sh subdivisions`.
# Called by the systemd timers (see server/systemd). Safe to run by hand.
# Skips the Claude run entirely when the queue is empty, so an idle night uses none of your Claude plan.
set -euo pipefail
JOB="${1:?usage: run-queue.sh plan|subdivisions}"
BASE="${MCQ_HOME:-$HOME}"
MC="$BASE/MC"; MCQ="$BASE/MC-queue"
mkdir -p "$BASE/logs"; LOG="$BASE/logs/$JOB-$(date +%F-%H%M).log"
exec >>"$LOG" 2>&1
echo "== $(date -Is) start $JOB"

# Only one run at a time (a long night must not overlap the next timer).
exec 9>"$BASE/.queue.lock"; flock -n 9 || { echo "another run is active — skipping"; exit 0; }

git -C "$MC" pull -q --rebase
[ -d "$MCQ" ] && git -C "$MCQ" pull -q --rebase

case "$JOB" in
  plan)
    ROUTINE="$MC/tools/process-plan-review-queue.md"; WORK="$MCQ"
    # retention runs every night even when nothing is queued
    [ -f "$MCQ/tools/retention.py" ] && python3 "$MCQ/tools/retention.py" "$MCQ" || true
    if [ -n "$(git -C "$MCQ" status --porcelain)" ]; then
      git -C "$MCQ" add -A && git -C "$MCQ" commit -qm "Retention: expired plans and data removed" && git -C "$MCQ" push -q || true
    fi
    N=$(python3 - "$MCQ" <<'EOF'
import json, glob, os, sys
n = 0
for f in glob.glob(os.path.join(sys.argv[1], 'queue', '*.json')):
    try: j = json.load(open(f))
    except Exception: continue
    if not os.path.exists(f[:-5] + '.pdf'): continue
    s = j.get('status')
    if s == 'queued': n += 1
    elif s == 'processing': n += 1  # Claude applies the routine's 6-hour rule
print(n)
EOF
) ;;
  subdivisions)
    ROUTINE="$MC/tools/process-subdivision-queue.md"; WORK="$MC"
    N=$(python3 -c "import json;print(sum(1 for i in json.load(open('$MC/data/subdivision-queue.json')).get('items',[]) if i.get('status')!='needs-manual'))") ;;
  *) echo "unknown job $JOB"; exit 2 ;;
esac

if [ "${N:-0}" = "0" ]; then echo "nothing queued — done"; exit 0; fi
echo "$N item(s) to process"

PROMPT="You are running unattended on the MC queue server (no one is watching; do not ask questions).
Follow the routine in $ROUTINE exactly, with the server notes in $MC/server/SERVER-NOTES.md (they replace any step that says to use the built-in browser or to attach/clone repos).
The repos are already cloned and up to date: $MC (public randalkidd/MC) and $MCQ (private randalkidd/MC-queue). Push with plain git push.
End with the routine's short report."

cd "$WORK"
timeout 4h claude -p "$PROMPT" \
  --add-dir "$MC" --add-dir "$MCQ" \
  --permission-mode acceptEdits \
  --allowedTools "Read" "Write" "Edit" "Glob" "Grep" "Bash(git:*)" "Bash(python3:*)" "Bash(curl:*)" "Bash(pdftoppm:*)" "Bash(pdfinfo:*)" "Bash(mkdir:*)" "Bash(ls:*)" "Bash(rm -f /tmp/mcq/*)" "mcp__playwright" \
  --max-turns 300 || echo "claude exited with $?"

find "$BASE/logs" -name '*.log' -mtime +30 -delete
echo "== $(date -Is) end $JOB"
