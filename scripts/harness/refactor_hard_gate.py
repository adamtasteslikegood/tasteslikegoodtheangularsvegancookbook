#!/usr/bin/env python3
"""Refactoring Backlog HARD GATE — verifies structural decomposition and Jira progress for KAN-460..KAN-467.

Enforces two orthogonal layers of truth across the 4 refactoring groups (`G1`..`G4`):

1. **Structural outcome checks (`--task T1..T8`, `--group G1..G4`, `--close`):**
   - Every target oversized file exists, stays at or below its post-refactoring
     line-count ceiling, and retains its required backwards-compatible facade
     symbols/exports.
   - Every extracted module declared for the task exists and is non-empty
     (`>= min_extracted_lines`).
2. **Jira status checks (`--issues`, `--group`, `--close`):**
   - Every targeted `KAN-460`..`KAN-467` issue exists on `tasteslikegood.atlassian.net`,
     carries the `refactor` label, and has moved out of `To Do` (or is `Done` when
     `--require-done` / `--close` is passed).

Usage
-----
    python3 scripts/harness/refactor_hard_gate.py --task T1 --structural-only
    python3 scripts/harness/refactor_hard_gate.py --issues KAN-460
    python3 scripts/harness/refactor_hard_gate.py --group G1
    python3 scripts/harness/refactor_hard_gate.py --close
    python3 scripts/harness/refactor_hard_gate.py --json

Exit codes: 0 pass · 1 gate failed · 2 configuration or API error.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _jira_client import Jira  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pm"))
from _atlassian_guard import AtlassianGuardError  # noqa: E402

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[2]
REQUIRED_LABEL = "refactor"

REQUIRED = {
    "KAN-460": "R1 (G1) — Refactor Backend/repositories/db_recipe_repository.py into slug, worker, and image-queue modules",
    "KAN-461": "R2 (G1) — Refactor Backend/blueprints/public_bp.py: extract SEO/JSON-LD, responsive image, and hub-taxonomy services",
    "KAN-462": "R3 (G2) — Refactor Backend worker_api_bp.py and generation_api_bp.py orchestration into service modules",
    "KAN-463": "R4 (G2) — Refactor Backend auth_api_bp.py and valkey_auth.py into cohesive OAuth, session, and rate-limit modules",
    "KAN-464": "R5 (G3) — Refactor PersistenceService and AuthService: extract outcome parsers and local user library store",
    "KAN-465": "R6 (G3) — Refactor RecipeViewBase and large Angular templates (generator, kitchen, recipe-detail) into sub-components",
    "KAN-466": "R7 (G4) — Refactor server/index.ts routes/middleware and modularize public/rum/consent.js",
    "KAN-467": "R8 (G4) — Refactor oversized repo scripts: gsc_tools.py, git-workflow.sh, and atlassian_pm_link.py",
}

GROUPS = {
    "G1": {
        "name": "Group 1 — Backend Core Repository & Public SSR Blueprint",
        "tasks": ["T1", "T2"],
        "checkin_task": "C1",
        "jira": ["KAN-460", "KAN-461"],
    },
    "G2": {
        "name": "Group 2 — Backend Worker, Generation & Auth Blueprints",
        "tasks": ["T3", "T4"],
        "checkin_task": "C2",
        "jira": ["KAN-462", "KAN-463"],
    },
    "G3": {
        "name": "Group 3 — Cookbook Frontend Services, View Base & Templates",
        "tasks": ["T5", "T6"],
        "checkin_task": "C3",
        "jira": ["KAN-464", "KAN-465"],
    },
    "G4": {
        "name": "Group 4 — Express SSR Server, RUM Consent & Repo Tooling Scripts",
        "tasks": ["T7", "T8"],
        "checkin_task": "C4",
        "jira": ["KAN-466", "KAN-467"],
    },
}

TASK_SPECS = {
    "T1": {
        "si": "R1",
        "group": "G1",
        "jira": ["KAN-460"],
        "targets": [
            {
                "path": "Backend/repositories/db_recipe_repository.py",
                "baseline_lines": 1737,
                "max_lines": 800,
                "required_substrings": ["class DbRecipeRepository"],
            }
        ],
        "extracted": [
            "Backend/repositories/recipe_slugs.py",
            "Backend/repositories/recipe_worker_ops.py",
            "Backend/repositories/recipe_image_queue.py",
        ],
        "min_extracted_lines": 25,
    },
    "T2": {
        "si": "R2",
        "group": "G1",
        "jira": ["KAN-461"],
        "targets": [
            {
                "path": "Backend/blueprints/public_bp.py",
                "baseline_lines": 1722,
                "max_lines": 700,
                "required_substrings": ["public_bp = Blueprint"],
            }
        ],
        "extracted": [
            "Backend/services/public_images.py",
            "Backend/services/public_seo.py",
            "Backend/services/public_hubs.py",
        ],
        "min_extracted_lines": 25,
    },
    "T3": {
        "si": "R3",
        "group": "G2",
        "jira": ["KAN-462"],
        "targets": [
            {
                "path": "Backend/blueprints/worker_api_bp.py",
                "baseline_lines": 822,
                "max_lines": 450,
                "required_substrings": ["worker_api_bp = Blueprint"],
            },
            {
                "path": "Backend/blueprints/generation_api_bp.py",
                "baseline_lines": 734,
                "max_lines": 450,
                "required_substrings": ["generation_api_bp = Blueprint"],
            },
        ],
        "extracted": [
            "Backend/services/worker_orchestration.py",
            "Backend/services/generation_orchestration.py",
        ],
        "min_extracted_lines": 25,
    },
    "T4": {
        "si": "R4",
        "group": "G2",
        "jira": ["KAN-463"],
        "targets": [
            {
                "path": "Backend/blueprints/auth_api_bp.py",
                "baseline_lines": 637,
                "max_lines": 380,
                "required_substrings": ["auth_api_bp = Blueprint"],
            },
            {
                "path": "Backend/utils/valkey_auth.py",
                "baseline_lines": 608,
                "max_lines": 380,
                "required_substrings": [],
            },
        ],
        "extracted": [
            "Backend/services/oauth_flow.py",
            "Backend/utils/valkey_sessions.py",
            "Backend/utils/valkey_ratelimit.py",
        ],
        "min_extracted_lines": 20,
    },
    "T5": {
        "si": "R5",
        "group": "G3",
        "jira": ["KAN-464"],
        "targets": [
            {
                "path": "src/services/persistence.service.ts",
                "baseline_lines": 855,
                "max_lines": 550,
                "required_substrings": ["export class PersistenceService"],
            },
            {
                "path": "src/services/auth.service.ts",
                "baseline_lines": 661,
                "max_lines": 380,
                "required_substrings": ["export class AuthService"],
            },
        ],
        "extracted": [
            "src/services/persistence-outcomes.ts",
            "src/services/user-library.store.ts",
        ],
        "min_extracted_lines": 25,
    },
    "T6": {
        "si": "R6",
        "group": "G3",
        "jira": ["KAN-465"],
        "targets": [
            {
                "path": "src/components/shared/recipe-view.base.ts",
                "baseline_lines": 526,
                "max_lines": 360,
                "required_substrings": ["export abstract class RecipeViewBase"],
            },
            {
                "path": "src/components/generator/generator.component.html",
                "baseline_lines": 701,
                "max_lines": 480,
                "required_substrings": [],
            },
            {
                "path": "src/components/kitchen/kitchen.component.html",
                "baseline_lines": 706,
                "max_lines": 480,
                "required_substrings": [],
            },
            {
                "path": "src/components/recipe-detail/recipe-detail.component.html",
                "baseline_lines": 606,
                "max_lines": 480,
                "required_substrings": [],
            },
        ],
        "extracted": [
            "src/components/shared/recipe-publish-state.ts",
        ],
        "min_extracted_lines": 20,
    },
    "T7": {
        "si": "R7",
        "group": "G4",
        "jira": ["KAN-466"],
        "targets": [
            {
                "path": "server/index.ts",
                "baseline_lines": 572,
                "max_lines": 350,
                "required_substrings": ["export const app"],
            },
            {
                "path": "public/rum/consent.js",
                "baseline_lines": 835,
                "max_lines": 450,
                "required_substrings": [],
            },
        ],
        "extracted": [
            "server/middleware.ts",
            "public/rum/consent-ui.js",
        ],
        "min_extracted_lines": 20,
    },
    "T8": {
        "si": "R8",
        "group": "G4",
        "jira": ["KAN-467"],
        "targets": [
            {
                "path": "scripts/monitoring/gsc_tools.py",
                "baseline_lines": 1662,
                "max_lines": 750,
                "required_substrings": ["def register("],
            },
            {
                "path": "scripts/git/git-workflow.sh",
                "baseline_lines": 1531,
                "max_lines": 750,
                "required_substrings": ["#!/"],
            },
            {
                "path": "scripts/pm/atlassian_pm_link.py",
                "baseline_lines": 898,
                "max_lines": 500,
                "required_substrings": [],
            },
        ],
        "extracted": [
            "scripts/monitoring/gsc_client.py",
            "scripts/pm/confluence_markdown.py",
        ],
        "min_extracted_lines": 25,
    },
}


def _line_count(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    return len(text.splitlines())


def check_task_structure(task_id: str, repo_root: Path = DEFAULT_REPO_ROOT) -> list:
    """Return a list of structural failure strings for ``task_id`` (empty == pass)."""
    if task_id not in TASK_SPECS:
        return [f"unknown task {task_id!r} (expected one of {sorted(TASK_SPECS)})"]
    spec = TASK_SPECS[task_id]
    failures = []
    root = Path(repo_root)

    for target in spec["targets"]:
        rel = target["path"]
        fpath = root / rel
        if not fpath.exists():
            failures.append(f"{task_id}: target file {rel} does not exist")
            continue
        lines = _line_count(fpath)
        max_lines = target["max_lines"]
        if lines > max_lines:
            failures.append(
                f"{task_id}: {rel} has {lines} lines (ceiling <= {max_lines}, "
                f"baseline was {target['baseline_lines']})"
            )
        content = fpath.read_text(encoding="utf-8")
        for needle in target.get("required_substrings", []):
            if needle not in content:
                failures.append(
                    f"{task_id}: {rel} is missing required facade symbol/substring {needle!r}"
                )

    min_ext = spec.get("min_extracted_lines", 20)
    for rel in spec["extracted"]:
        epath = root / rel
        if not epath.exists():
            failures.append(f"{task_id}: extracted module {rel} does not exist yet")
            continue
        lines = _line_count(epath)
        if lines < min_ext:
            failures.append(
                f"{task_id}: extracted module {rel} has only {lines} lines "
                f"(expected >= {min_ext})"
            )

    return failures


def check_jira_issues(
    keys: list,
    jira_client=None,
    require_done: bool = False,
) -> list:
    """Verify each key in ``keys`` exists, carries ``refactor``, and meets status rules."""
    failures = []
    jira = jira_client or Jira()
    for key in keys:
        if key not in REQUIRED:
            failures.append(f"{key}: not in refactoring scope ({sorted(REQUIRED)})")
            continue
        issue = jira.issue(key, fields="summary,status,labels")
        fields = issue.get("fields") or {}
        status_obj = fields.get("status") or {}
        status_name = status_obj.get("name", "")
        cat_key = (status_obj.get("statusCategory") or {}).get("key", "")
        labels = set(fields.get("labels") or [])
        if REQUIRED_LABEL not in labels:
            failures.append(
                f"{key}: missing required label {REQUIRED_LABEL!r} (labels={sorted(labels)})"
            )
        if require_done:
            if status_name != "Done" and cat_key != "done":
                failures.append(
                    f"{key}: status is {status_name!r} (requires exact Done)"
                )
        else:
            if status_name == "To Do" or cat_key == "new":
                failures.append(
                    f"{key}: still in To Do ({status_name!r}); move to In Progress / In Review / Done"
                )
    return failures


def transition_jira_issues(keys: list, target_status: str, jira_client=None) -> list:
    """Transition each Jira issue in ``keys`` to ``target_status``."""
    failures = []
    jira = jira_client or Jira()
    target_norm = target_status.strip().lower()
    for key in keys:
        if key not in REQUIRED:
            failures.append(f"{key}: not in refactoring scope ({sorted(REQUIRED)})")
            continue
        resp = jira.call("GET", f"/rest/api/3/issue/{key}/transitions")
        transitions = (resp or {}).get("transitions") or []
        match = None
        for t in transitions:
            to_name = ((t.get("to") or {}).get("name") or t.get("name") or "").strip().lower()
            t_name = (t.get("name") or "").strip().lower()
            if to_name == target_norm or t_name == target_norm:
                match = t
                break
        if not match:
            avail = [((t.get("to") or {}).get("name") or t.get("name")) for t in transitions]
            failures.append(f"{key}: no transition matching {target_status!r} (available={avail})")
            continue
        jira.call("POST", f"/rest/api/3/issue/{key}/transitions", {"transition": {"id": match["id"]}})
    return failures


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--task",
        choices=sorted(TASK_SPECS),
        help="Check structural decomposition (and Jira status unless --structural-only) for one task.",
    )
    p.add_argument(
        "--group",
        choices=sorted(GROUPS),
        help="Check structural decomposition and Jira status for every task in a group (G1..G4).",
    )
    p.add_argument(
        "--issues",
        nargs="+",
        help="Scoped Jira check for specific KAN refactoring ticket(s).",
    )
    p.add_argument(
        "--transition",
        metavar="STATUS",
        help="Transition the selected Jira issue(s) to STATUS (e.g., 'In Progress', 'Done') before checking.",
    )
    p.add_argument(
        "--close",
        action="store_true",
        help="Full close gate: all T1..T8 structural checks pass and all KAN-460..KAN-467 are Done.",
    )
    p.add_argument(
        "--require-done",
        action="store_true",
        help="Require Jira issues to be in Done status (not just out of To Do).",
    )
    p.add_argument(
        "--structural-only",
        action="store_true",
        help="Run only local file line-count and extraction checks (skip Jira API calls).",
    )
    p.add_argument(
        "--repo-root",
        default=str(DEFAULT_REPO_ROOT),
        help="Repository root directory to inspect (default: workspace root).",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON verdict.",
    )
    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    repo_root = Path(args.repo_root)

    try:
        failures = []
        checked_tasks = []
        checked_issues = []
        require_done = bool(args.require_done or args.close)

        if args.task:
            checked_tasks.append(args.task)
            failures.extend(check_task_structure(args.task, repo_root=repo_root))
            if not args.structural_only:
                checked_issues.extend(TASK_SPECS[args.task]["jira"])

        if args.group:
            grp = GROUPS[args.group]
            for tid in grp["tasks"]:
                if tid not in checked_tasks:
                    checked_tasks.append(tid)
                    failures.extend(check_task_structure(tid, repo_root=repo_root))
            if not args.structural_only:
                for k in grp["jira"]:
                    if k not in checked_issues:
                        checked_issues.append(k)

        if args.issues:
            for k in args.issues:
                if k not in checked_issues:
                    checked_issues.append(k)

        if args.close or (not args.task and not args.group and not args.issues):
            for tid in sorted(TASK_SPECS):
                if tid not in checked_tasks:
                    checked_tasks.append(tid)
                    failures.extend(check_task_structure(tid, repo_root=repo_root))
            if not args.structural_only:
                for k in sorted(REQUIRED):
                    if k not in checked_issues:
                        checked_issues.append(k)

        if checked_issues and not args.structural_only:
            if args.transition:
                failures.extend(
                    transition_jira_issues(checked_issues, args.transition)
                )
            failures.extend(
                check_jira_issues(checked_issues, require_done=require_done)
            )

        passed = len(failures) == 0
        payload = {
            "verdict": "PASS" if passed else "FAIL",
            "checked_tasks": checked_tasks,
            "checked_issues": checked_issues,
            "structural_only": bool(args.structural_only),
            "require_done": require_done,
            "failures": failures,
        }
        if args.json:
            print(json.dumps(payload, indent=2))
        else:
            if passed:
                scope = (
                    f"task {args.task}"
                    if args.task
                    else f"group {args.group}"
                    if args.group
                    else f"issues {' '.join(checked_issues)}"
                    if args.issues
                    else "all refactoring groups (G1..G4)"
                )
                print(f"REFACTOR GATE PASSED — {scope}")
            else:
                print("REFACTOR GATE FAILED:")
                for f in failures:
                    print(f"  - {f}")
        return 0 if passed else 1
    except (AtlassianGuardError, RuntimeError, SystemExit) as exc:
        if isinstance(exc, SystemExit) and isinstance(exc.code, int):
            return exc.code
        print(f"CONFIG/API ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
