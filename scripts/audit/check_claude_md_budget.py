#!/usr/bin/env python3
"""CLAUDE.md stays inside its context budget and every reference resolves (KAN-417).

``CLAUDE.md`` and every file it ``@``-imports load into every agent session, so
their combined size is a cost every task pays (KAN-415, KAN-416). Nothing kept
it in check: the trims happened by hand, after the file had grown. This script
makes the budget and the references a gate.

Modes
-----
* default - walk ``CLAUDE.md`` and its ``@``-imports, then fail (exit 1) when
  the loaded bytes exceed ``--budget``, when an ``@``-import does not resolve,
  or when a relative markdown link in a loaded file does not resolve.
* ``--drift DAYS`` - the weekly audit: also report every line of a loaded file
  that names a path deleted or renamed in the last ``DAYS`` days and absent at
  HEAD. Needs full git history (``fetch-depth: 0`` in Actions).
* ``--markdown`` - print the report as markdown (for the weekly issue body).

What counts as an import
------------------------
Claude Code resolves ``@path`` anywhere in prose, not only at the start of a
line: the runbook import in ``CLAUDE.md`` sits in a list item and in bold text.
So a token is an import when ``@`` starts a line or follows whitespace, outside
fenced code blocks and inline code spans. Trailing markdown punctuation
(``**``, ``)``, ``,``, ``.``) is trimmed, so ``**…@scripts/release/RUNBOOK.md**,``
names the runbook. ``~/`` imports are user-level files outside the repository,
reported and skipped. Imports recurse up to ``MAX_DEPTH`` hops with a cycle
guard, as Claude Code does.

``@Backend/...`` imports count like any other. ``Backend/`` is a submodule and
the gate job does not check it out, so such an import fails as missing. That is
intended: ``Backend/CLAUDE.md`` is read on demand, never imported, because
importing it would spend the budget on every cookbook session.

Links are relative ``[text](target)`` markdown links, resolved against the file
that contains them. Backtick-quoted paths are not checked: too many name files
that are legitimately absent from a checkout (``.env.local``, build output).

Stdlib only, so the gate job needs no install step.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

# 39,831 bytes load today (CLAUDE.md 26,558 + scripts/release/RUNBOOK.md 13,273,
# after KAN-416). 48 KiB leaves about 20% headroom: room for normal edits, not
# for another imported document. Raising it is a deliberate decision, made here.
BUDGET_BYTES = 48 * 1024
MAX_DEPTH = 5
ROOT_FILE = "CLAUDE.md"

FENCE_RE = re.compile(r"^\s*(```|~~~)")
CODE_SPAN_RE = re.compile(r"(`+).*?\1")
IMPORT_RE = re.compile(r"(?:^|(?<=\s))@(\S+)")
# Destination: <angle-bracketed>, or bare with one level of balanced parens.
LINK_RE = re.compile(r"\[[^\]]*\]\((?:<([^>\n]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+\"[^\"]*\")?\)")
TRAILING_PUNCT = "*_)]}>,.;:!?'\"`"


@dataclass
class Report:
    loaded: list[tuple[str, int]] = field(default_factory=list)  # (path, bytes), load order
    missing_imports: list[str] = field(default_factory=list)  # "file:line — @target"
    broken_links: list[str] = field(default_factory=list)  # "file:line — target"
    skipped_imports: list[str] = field(default_factory=list)  # user-level ~/ imports
    drift: list[str] = field(default_factory=list)  # "file:line — names deleted path"

    @property
    def total(self) -> int:
        return sum(size for _, size in self.loaded)


def prose_lines(text: str):
    """Yield (line_number, line) with fenced blocks dropped and code spans blanked."""
    in_fence = False
    for number, line in enumerate(text.splitlines(), start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if not in_fence:
            yield number, CODE_SPAN_RE.sub(" ", line)


def find_imports(text: str) -> list[tuple[int, str]]:
    found = []
    for number, line in prose_lines(text):
        for match in IMPORT_RE.finditer(line):
            target = match.group(1).rstrip(TRAILING_PUNCT)
            if target:
                found.append((number, target))
    return found


def find_links(text: str) -> list[tuple[int, str]]:
    found = []
    for number, line in prose_lines(text):
        for match in LINK_RE.finditer(line):
            target = urllib.parse.unquote((match.group(1) or match.group(2)).split("#", 1)[0])
            if target and not re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I):
                found.append((number, target))
    return found


def rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def walk(root: Path) -> Report:
    report = Report()
    seen: set[Path] = set()

    def visit(path: Path, depth: int) -> None:
        resolved = path.resolve()
        if resolved in seen:
            return
        seen.add(resolved)
        data = path.read_bytes()
        name = rel(path, root)
        report.loaded.append((name, len(data)))
        text = data.decode("utf-8", errors="replace")

        for number, target in find_links(text):
            if not (path.parent / target).exists():
                report.broken_links.append(f"{name}:{number} — {target}")

        for number, target in find_imports(text):
            if target.startswith("~"):
                report.skipped_imports.append(f"{name}:{number} — @{target}")
                continue
            child = path.parent / target
            if not child.is_file():
                report.missing_imports.append(f"{name}:{number} — @{target}")
            elif depth < MAX_DEPTH:
                visit(child, depth + 1)

    visit(root / ROOT_FILE, 0)
    return report


def deleted_paths(root: Path, days: int) -> set[str]:
    """Paths deleted or renamed away in the window and absent at HEAD."""
    out = subprocess.run(
        ["git", "log", f"--since={days} days ago", "--name-status", "--no-merges", "--diff-filter=DR", "--format="],
        cwd=root, check=True, capture_output=True, text=True,
    ).stdout
    gone = set()
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0][:1] in "DR":
            old = parts[1]
            if not (root / old).exists():
                gone.add(old)
    return gone


def find_drift(root: Path, report: Report, gone: set[str]) -> None:
    for name, _ in report.loaded:
        lines = (root / name).read_text(encoding="utf-8", errors="replace").splitlines()
        # A file may name a path relative to its own directory (RUNBOOK.md says ./train-run.sh).
        here = os.path.dirname(name) or "."
        needles = {old: {old} | {r for r in [os.path.relpath(old, here)] if not r.startswith("..")} for old in gone}
        for number, line in enumerate(lines, start=1):
            for old in sorted(gone):
                if any(needle in line for needle in needles[old]):
                    report.drift.append(f"{name}:{number} — names `{old}`, deleted or renamed")


def failures(report: Report, budget: int) -> list[str]:
    problems = []
    if report.total > budget:
        problems.append(f"loaded bytes {report.total:,} exceed the budget {budget:,}")
    problems += [f"missing @-import: {m}" for m in report.missing_imports]
    problems += [f"broken link: {b}" for b in report.broken_links]
    problems += [f"drift: {d}" for d in report.drift]
    return problems


def render(report: Report, budget: int, markdown: bool) -> str:
    bullet = "- " if markdown else "  "
    out = [("## " if markdown else "") + f"CLAUDE.md context budget: {report.total:,} / {budget:,} bytes"]
    out += [f"{bullet}{name}: {size:,} bytes" for name, size in report.loaded]
    for title, items in (
        ("Missing @-imports", report.missing_imports),
        ("Broken links", report.broken_links),
        ("Drift", report.drift),
        ("Skipped user-level imports", report.skipped_imports),
    ):
        if items:
            out.append(("\n### " if markdown else "") + title)
            out += [f"{bullet}{item}" for item in items]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--root", type=Path, default=Path("."), help="repository root (default: .)")
    parser.add_argument("--budget", type=int, default=BUDGET_BYTES, help=f"byte budget (default: {BUDGET_BYTES})")
    parser.add_argument("--drift", type=int, metavar="DAYS", help="also report lines naming paths deleted in DAYS days")
    parser.add_argument("--markdown", action="store_true", help="print the report as markdown")
    args = parser.parse_args(argv)

    if not (args.root / ROOT_FILE).is_file():
        print(f"error: {args.root / ROOT_FILE} not found", file=sys.stderr)
        return 2
    # Exit 1 means findings; anything that stops the audit itself is exit 2, so the
    # weekly workflow never files a KAN for a crash.
    try:
        report = walk(args.root)
        if args.drift is not None:
            find_drift(args.root, report, deleted_paths(args.root, args.drift))
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"error: audit could not run: {exc}", file=sys.stderr)
        return 2

    print(render(report, args.budget, args.markdown))
    problems = failures(report, args.budget)
    if problems:
        if args.markdown:
            print("\n### Problems")
        for problem in problems:
            print(f"- {problem}" if args.markdown else f"::error::{problem}")
        return 1
    print("\n✅ within budget, every reference resolves." if not args.markdown else "\nNo findings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
