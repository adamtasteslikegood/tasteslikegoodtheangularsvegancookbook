#!/usr/bin/env python3
"""plan_qa.py — QA-lint an agent-harness ``plan.v1`` before you spend loop budget.

This is the *mechanical* half of the harness-qa-loop QA session. It reads a
compiled ``plan.json`` and flags tasks whose verification is missing,
tautological, or smoke-only, plus budget/coverage red flags. It does NOT decide
the judgment calls (does the plan cover the goal? are no-touch paths honored? is
each skill the right match?) — it prints those as a human checklist instead.

Exit codes (branch on these):
  0  no hard blockers — warnings may remain, read them before approving.
  1  hard blocker — a task has no runnable verification, or the iteration budget
     cannot cover the task count. Do NOT approve the plan as-is.
  2  plan file missing / unreadable / not an agent-harness plan.

Usage:
  python3 plan_qa.py [--plan .agent-harness/plan.json] [--strict] [--json]

  --strict  treat warnings (tautological / smoke-only verification) as blockers.
  --json    emit the findings as JSON instead of the human report.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Commands whose exit code is independent of whether the task's work happened.
# A verification built from these is reward-hackable — it passes even if nothing
# changed. Same failure mode the harness warns about: never be judged by a gate
# you could satisfy without doing the work.
_ALWAYS_ZERO = {"true", ":", "echo", "echo ok", "exit 0", "printf"}

# Verification kinds that prove the *tool runs*, not that the *goal outcome holds*.
_WEAK_KINDS = {"smoke", "sample"}


def _is_tautology(cmd: str) -> bool:
    c = (cmd or "").strip()
    if c in _ALWAYS_ZERO:
        return True
    return c.startswith("echo ") or c.startswith("printf ")


def _load_plan(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"plan_qa: no plan at {path} — compile a goal first "
              f"(goal_compiler.py ... --out {path})", file=sys.stderr)
        raise SystemExit(2)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"plan_qa: cannot read {path}: {exc}", file=sys.stderr)
        raise SystemExit(2)
    if not isinstance(data, dict):
        print(f"plan_qa: {path} is not an agent-harness plan "
              f"(top-level JSON is {type(data).__name__}, expected object)",
              file=sys.stderr)
        raise SystemExit(2)
    schema = str(data.get("schema", ""))
    if not schema.startswith("agent-harness/plan"):
        print(f"plan_qa: {path} is not an agent-harness plan "
              f"(schema={schema!r})", file=sys.stderr)
        raise SystemExit(2)
    return data


def qa(plan: dict) -> dict:
    """Return {rows:[...], blockers:[...], warnings:[...], goal, domain, task_count, max_iters}."""
    tasks = plan.get("tasks", [])
    loop = plan.get("loop", {})
    order = loop.get("order", "sequential")
    max_iters = int(loop.get("max_loop_iterations", 0) or 0)

    rows, blockers, warnings = [], [], []

    for t in tasks:
        tid = t.get("id", "?")
        skill = t.get("skill", "?")
        checks = t.get("verification", []) or []
        runnable = [c for c in checks if (c.get("cmd") or "").strip()]
        kinds = {c.get("kind", "?") for c in runnable}

        status, note = "ok", ""
        if not runnable:
            status = "BLOCK"
            note = "no runnable verification"
            blockers.append(
                f"{tid} ({skill}) has no verification check — the loop will "
                f"escalate (no_verification_available). Add a real check or drop it.")
        else:
            tauto = [c["cmd"] for c in runnable if _is_tautology(c.get("cmd", ""))]
            if tauto:
                status = "WARN"
                note = "tautological check"
                warnings.append(
                    f"{tid} ({skill}) verification is reward-hackable "
                    f"({tauto[0]!r} always exits 0). Replace with a check that "
                    f"fails when the work is undone.")
            elif kinds and kinds <= _WEAK_KINDS:
                status = "WARN"
                note = f"smoke-only ({','.join(sorted(kinds))})"
                warnings.append(
                    f"{tid} ({skill}) verification is smoke/sample-only — proves "
                    f"the tool runs, not that the goal outcome holds. Add an "
                    f"outcome check tied to done_when.")
        if not str(t.get("done_when", "")).strip():
            warnings.append(f"{tid} ({skill}) has an empty done_when.")

        rows.append({"id": tid, "skill": skill,
                     "checks": len(runnable), "status": status, "note": note})

    # Budget sanity: a sequential loop needs at least one iteration per task
    # (plus retries). Fewer iterations than tasks cannot finish.
    if order == "sequential" and max_iters and max_iters < len(tasks):
        blockers.append(
            f"loop.max_loop_iterations ({max_iters}) < task count ({len(tasks)}) "
            f"— a sequential loop cannot verify every task. Raise the cap.")

    return {"rows": rows, "blockers": blockers, "warnings": warnings,
            "goal": plan.get("goal", ""), "domain": plan.get("domain", ""),
            "task_count": len(tasks), "max_iters": max_iters}


_HUMAN_CHECKLIST = [
    "Do the tasks TOGETHER achieve the goal? Any missing task (coverage gap)?",
    "Does any task write a no-touch path named in the goal?",
    "Is each task's skill the right match for its objective?",
    "Any step needing secrets/human input? It must be a waiver, not a fake check.",
]


def _report(res: dict, strict: bool) -> int:
    icon = {"ok": "✓", "WARN": "⚠", "BLOCK": "✗"}
    print("harness-qa-loop · plan QA")
    print(f"goal:   {res['goal']}")
    print(f"domain: {res['domain']}   tasks: {res['task_count']}   "
          f"loop.max_iters: {res['max_iters']}\n")
    for r in res["rows"]:
        line = f"  {icon.get(r['status'], '?')} {r['id']:<4} {r['skill']:<24} " \
               f"verify:{r['checks']}"
        if r["note"]:
            line += f"   {r['note']}"
        print(line)

    if res["blockers"]:
        print("\nHARD BLOCKERS (fix before approving):")
        for b in res["blockers"]:
            print(f"  ✗ {b}")
    if res["warnings"]:
        print("\nWARNINGS (weak verification — harden or accept with eyes open):")
        for w in res["warnings"]:
            print(f"  ⚠ {w}")

    print("\nHUMAN QA (this tool can't decide — confirm each before approving):")
    for item in _HUMAN_CHECKLIST:
        print(f"  [ ] {item}")

    hard = bool(res["blockers"]) or (strict and bool(res["warnings"]))
    verdict = "BLOCK" if hard else ("REVIEW" if res["warnings"] else "PASS")
    print(f"\nVERDICT: {verdict}"
          f"  ({len(res['blockers'])} blocker(s), {len(res['warnings'])} warning(s))")
    return 1 if hard else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="QA-lint an agent-harness plan.v1")
    ap.add_argument("--plan", default=".agent-harness/plan.json",
                    help="path to compiled plan.json (default: .agent-harness/plan.json)")
    ap.add_argument("--strict", action="store_true",
                    help="treat warnings as hard blockers")
    ap.add_argument("--json", action="store_true",
                    help="emit findings as JSON instead of the human report")
    args = ap.parse_args()

    plan = _load_plan(Path(args.plan))
    res = qa(plan)
    if args.json:
        hard = bool(res["blockers"]) or (args.strict and bool(res["warnings"]))
        print(json.dumps(res, indent=2))
        return 1 if hard else 0
    return _report(res, args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
