"""Single source of truth for which planning docs sync to Confluence.

WHY THIS MODULE EXISTS (KAN-187):
The set of PM files was hardcoded in four places — `pm_daemon.py`,
`.claude/hooks/sessionstart-pm-briefing.sh` (an inline copy in a separate Python
heredoc), `atlassian_pm_link.py` (a drifted 4-entry subset), and three docs. The
daemon's list named `specs/SPRINT_0_PLAN.md` — a 182-byte TODO stub — and omitted
`SPRINT_1..4_PLAN.md`, ~91 KB of real planning. So the placeholder synced and four
actual sprint plans never did, silently: `sync_pm_documents` reports what it synced
and never what it skipped, so it returned "Sync successful" every time.

Two rules follow from that, and both are load-bearing:

1. **Sprint plans are matched by GLOB, not enumerated.** A curated list means every
   new sprint silently repeats the bug until someone remembers to edit Python. The
   glob is the fix; enumerating `SPRINT_4_PLAN.md` would not have been.
2. **Resolution happens at CALL time against a root, never at import time.** The
   daemon is long-lived: a `SPRINT_5_PLAN.md` created mid-session must be picked up
   without a restart. A module-level constant computed at import cannot do that.

Scope decision (Adam, 2026-07-30): sprint plans only. `ux-backlog.md`,
`KAN-119_LOOP_PLAN.md` and `CANONICAL_RECIPES_ROLLOUT.md` stay out of Confluence.

STDLIB ONLY — no requests, no dotenv, no watchdog. The SessionStart hook imports
this module directly and must keep working with the system `python3`, outside the
daemon's `.venv`, with no network. Adding a third-party import here breaks the hook
silently (it is fail-open by design and would just stop injecting the briefing).
"""

from fnmatch import fnmatch
from pathlib import Path

# Curated entries, in briefing order. These are exact paths, always included when
# present. SPRINT_0_PLAN.md is kept deliberately: it also matches SPRINT_GLOBS, and
# the dedupe in canonical_pm_files() collapses it to one entry.
CURATED_PM_FILES = [
    "specs/plan.md",
    "specs/roadmap.md",
    "specs/planning_notes.md",
    "specs/design-plan.md",
    "specs/SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md",
    "specs/SPRINT_0_PLAN.md",
    "specs/ATLASSIAN_PM_LINK.md",
]

# Every sprint plan, forever, without a code change. This line is the actual fix.
SPRINT_GLOBS = ["specs/SPRINT_*_PLAN.md"]

# The narrower set summarised into .agent-work/pm/PROJECT_PM_BRIEFING.md by
# atlassian_pm_link.py. Deliberately NOT the full canonical set: the briefing is
# injected at session start under a 12k-char cap, and the four sprint plans alone
# are ~91 KB — they would evict everything else. Narrow on purpose, in one place.
#
# It lives here rather than in atlassian_pm_link.py because that copy (formerly
# LOCAL_PM_FILES) had already drifted away from the sync set, and was named in
# KAN-187 as duplicate #3. Two DIFFERENT sets is fine; two DEFINITIONS is not.
BRIEFING_SUMMARY_FILES = [
    "specs/planning_notes.md",
    "specs/plan.md",
    "specs/roadmap.md",
    "specs/design-plan.md",
]

# Basenames that could possibly be canonical, for callers that must reject a path
# cheaply. The watchdog observer runs recursive=True over the whole workspace
# (pm_daemon.py), so on_modified fires for every file event in the repo — Angular
# builds, node_modules writes, git index churn, thousands per session. Without a
# no-I/O reject, each of those would re-glob specs/ and stat every candidate.
#
# Derived from the same constants above rather than re-stated as a regex, so it
# cannot drift from SPRINT_GLOBS — a hand-written r"SPRINT_\d+_PLAN\.md" in the
# daemon would be a new copy of the very thing this module exists to hold once.
_CURATED_BASENAMES = frozenset(Path(p).name for p in CURATED_PM_FILES)
_SPRINT_BASENAME_GLOBS = frozenset(Path(p).name for p in SPRINT_GLOBS)


def could_be_canonical(name: str) -> bool:
    """True if `name` might be a canonical PM file. Cheap, no filesystem access.

    A `True` answer is not a decision — callers still confirm against
    canonical_pm_files(). A `False` answer is final, which is the point: it lets
    the hot path bail before touching the disk.
    """
    return name in _CURATED_BASENAMES or any(
        fnmatch(name, pattern) for pattern in _SPRINT_BASENAME_GLOBS
    )

# Stable, version-free Confluence page titles. Titles must NOT carry a release
# version: the daemon looks pages up by title, so a moving prefix (the old
# hardcoded "v0.2 ...") would strand each page under its old name and spawn a
# duplicate on the next bump. See KAN-109.
#
# Sprint plans are deliberately absent — the derived fallback in page_title_for()
# already renders SPRINT_4_PLAN.md as "Sprint 4 Plan", which is exactly the wanted
# title and matches the explicit "Sprint 0 Plan" entry below. Listing each sprint
# here would reintroduce the per-sprint manual step this module exists to remove.
CANONICAL_PAGE_TITLES = {
    "roadmap.md": "Project Roadmap",
    "plan.md": "Execution Plan",
    "planning_notes.md": "Planning Session Review & Notes",
    "design-plan.md": "Design Implementation Plan",
    "SCRUM_BOOTSTRAP_AND_BOARD_PLAN.md": "Scrum Bootstrap & Board Plan",
    "SPRINT_0_PLAN.md": "Sprint 0 Plan",
    "ATLASSIAN_PM_LINK.md": "Atlassian PM Link",
}


def _sprint_sort_key(relative_path: str) -> tuple:
    """Order sprint plans numerically: SPRINT_2 before SPRINT_10, not after.

    Plain string sort would put SPRINT_10 between SPRINT_1 and SPRINT_2. Falls back
    to lexicographic for any name that does not carry a parseable number.
    """
    stem = Path(relative_path).name
    middle = stem[len("SPRINT_"):-len("_PLAN.md")] if stem.startswith("SPRINT_") else ""
    return (0, int(middle), "") if middle.isdigit() else (1, 0, stem)


def canonical_pm_files(root=".") -> list:
    """Relative paths of the PM files that exist under `root`, in briefing order.

    Curated entries first, then any additional sprint plans found by glob, sorted
    numerically. Deduplicated, so SPRINT_0_PLAN.md appears once despite being both
    curated and glob-matched. Only existing files are returned.

    Resolved fresh on every call — see rule 2 in the module docstring.
    """
    root_path = Path(root)
    ordered = []
    seen = set()

    def _add(relative_path: str) -> None:
        if relative_path not in seen and (root_path / relative_path).is_file():
            seen.add(relative_path)
            ordered.append(relative_path)

    for relative_path in CURATED_PM_FILES:
        _add(relative_path)

    globbed = []
    for pattern in SPRINT_GLOBS:
        for match in root_path.glob(pattern):
            if match.is_file():
                globbed.append(match.relative_to(root_path).as_posix())
    for relative_path in sorted(set(globbed), key=_sprint_sort_key):
        _add(relative_path)

    return [Path(relative_path) for relative_path in ordered]


def page_title_for(filepath) -> str:
    """Stable Confluence page title for a PM file (no version prefix).

    The derived fallback turns SPRINT_4_PLAN.md into "Sprint 4 Plan", which is why
    sprint plans need no entry in CANONICAL_PAGE_TITLES.
    """
    name = Path(filepath).name
    return CANONICAL_PAGE_TITLES.get(
        name,
        name.replace(".md", "").replace("_", " ").title(),
    )
