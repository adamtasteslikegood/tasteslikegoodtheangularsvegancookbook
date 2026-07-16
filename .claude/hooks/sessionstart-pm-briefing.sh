#!/usr/bin/env bash
# SessionStart hook — inject the PM briefing so every session opens briefed.
#
# Mirrors the pm-daemon `get_project_status` MCP tool EXACTLY, but as a plain
# file read so it can't race the MCP server's startup: it reads
# .agent-work/pm/PROJECT_PM_BRIEFING.md (first 12k chars) if present, else falls
# back to the canonical specs/*.md planning files (first 1500 chars each). The
# result is injected as SessionStart additionalContext.
#
# Doing this as a command hook (not an mcp_tool hook) is deliberate: the briefing
# is a local file with no network dependency, and the pm-daemon stdio child may
# not have finished connecting at the instant SessionStart fires. A file read is
# deterministic and fast.
#
# Design rules: fail-open (always exit 0), bounded output, recursion-guarded.
#
# SessionStart stdin (JSON): session_id, transcript_path, cwd, hook_event_name,
#                            source ("startup"|"resume"|"clear"|"compact").

set -uo pipefail
trap 'exit 0' ERR

# The session-log summarizer runs `claude -p`, which re-enters this hook. Bail.
if [ -n "${CLAUDE_PM_SESSION_LOG_ACTIVE:-}" ]; then
  exit 0
fi

INPUT=$(cat 2>/dev/null || true)

_field() {
  printf '%s' "$INPUT" | python3 -c "
import json,sys
try: print((json.load(sys.stdin) or {}).get('$1','') or '')
except Exception: print('')
" 2>/dev/null
}

SOURCE=$(_field source)
CWD=$(_field cwd)
[ -n "$CWD" ] || CWD="$(pwd)"

# A compaction is not a fresh session; re-injecting the briefing there is noise.
if [ "$SOURCE" = "compact" ]; then
  exit 0
fi

# Resolve the main checkout: the gitignored briefing file lives in .agent-work/
# which is NOT present in fresh worktrees, so prefer cwd but fall back to main.
COMMON_GIT=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
if [ -n "$COMMON_GIT" ] && [ -d "$COMMON_GIT" ]; then
  MAIN_REPO=$(dirname "$COMMON_GIT")
else
  MAIN_REPO="$CWD"
fi

# Build the briefing text the same way get_project_status() does. Python keeps
# the char caps and file list identical to the MCP tool and handles encoding.
BRIEFING=$(CWD="$CWD" MAIN_REPO="$MAIN_REPO" python3 <<'PY' 2>/dev/null || true
import os
from pathlib import Path

BRIEFING_FILE = Path(".agent-work/pm/PROJECT_PM_BRIEFING.md")
CANONICAL = [
    "specs/plan.md",
    "specs/roadmap.md",
    "specs/planning_notes.md",
    "specs/design-plan.md",
    "specs/SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md",
    "specs/SPRINT_0_PLAN.md",
    "specs/ATLASSIAN_PM_LINK.md",
]

roots = []
for r in (os.environ.get("CWD"), os.environ.get("MAIN_REPO")):
    if r and r not in roots:
        roots.append(Path(r))

# Prefer the pre-baked briefing file from whichever root has it.
for root in roots:
    bp = root / BRIEFING_FILE
    if bp.exists():
        try:
            c = bp.read_text(encoding="utf-8", errors="replace")
            print("CURRENT PM BRIEFING:\n" + c[:12000] + ("..." if len(c) > 12000 else ""))
            raise SystemExit(0)
        except SystemExit:
            raise
        except Exception:
            pass

# Fall back to canonical planning files (cwd first, then main checkout).
status = []
seen = set()
for root in roots:
    for rel in CANONICAL:
        fp = root / rel
        if rel in seen or not fp.exists():
            continue
        try:
            c = fp.read_text(encoding="utf-8", errors="replace")
            status.append(f"--- {rel} ---\n{c[:1500]}" + ("..." if len(c) > 1500 else ""))
            seen.add(rel)
        except Exception:
            pass

if status:
    print("CURRENT PM BRIEFING:\n" + "\n".join(status))
PY
)

# Nothing to inject? Stay silent.
[ -n "$BRIEFING" ] || exit 0

python3 -c "
import json,sys
ctx = sys.stdin.read()
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': ctx}}))
" <<<"$BRIEFING" 2>/dev/null || true

exit 0
