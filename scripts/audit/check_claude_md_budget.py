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
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

# 39,831 bytes load today (CLAUDE.md 26,558 + scripts/release/RUNBOOK.md 13,273,
# after KAN-416). 48 KiB leaves about 20% headroom: room for normal edits, not
# for another imported document. Raising it is a deliberate decision, made here.
BUDGET_BYTES = 48 * 1024
MAX_DEPTH = 5
ROOT_FILE = "CLAUDE.md"

FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
CODE_SPAN_RE = re.compile(r"(`+).*?\1", re.S)
# A backslash-escaped space is part of the path: @Design\ Docs/api.md.
IMPORT_RE = re.compile(r"(?:^|(?<=\s))@((?:\\ |\S)+)")
# Destination: <angle-bracketed>, or bare with one level of balanced parens.
# Title: "double", 'single' or (parenthesised), as CommonMark allows.
LINK_RE = re.compile(
    r"\[[^\]]*\]\((?:<([^>\n]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^()]*\)))?\)"
)
TRAILING_PUNCT = "*)]}>,.;:!?'\"`"  # _ is handled apart: it is also a path character
# A line that is a block of its own, or starts one: a code span cannot cross it.
HEADING_RE = re.compile(r"^ {0,3}#{1,6}(\s|$)")
BLOCK_START_RE = re.compile(r"^\s*(?:[-*+]|\d{1,9}[.)])\s|^ {0,3}(?:[-*_]\s*){3,}$")
# Block-quote markers, nested or not; what follows them is parsed as its own text.
QUOTE_RE = re.compile(r"^(?: {0,3}> ?)+")
# Four spaces or a tab, outside a paragraph: an indented code block.
INDENTED_CODE_RE = re.compile(r"^(?: {4}|\t)")


@dataclass
class Report:
    loaded: list[tuple[str, int]] = field(default_factory=list)  # (path, bytes), load order
    texts: dict[str, str] = field(default_factory=dict)  # name -> decoded text, reused by find_drift
    too_deep: list[str] = field(default_factory=list)  # imports past MAX_DEPTH, not walked
    missing_imports: list[str] = field(default_factory=list)  # "file:line — @target"
    broken_links: list[str] = field(default_factory=list)  # "file:line — target"
    skipped_imports: list[str] = field(default_factory=list)  # user-level ~/ imports
    drift: list[str] = field(default_factory=list)  # "file:line — names deleted path"

    @property
    def total(self) -> int:
        return sum(size for _, size in self.loaded)


def blank_code_spans(lines: list[tuple[int, str]]):
    """Blank code spans across one paragraph's lines (a span may wrap), keeping line numbers.

    Yields (line_number, line, earlier), where earlier is the paragraph's text before that line.
    """
    joined = "\n".join(line for _, line in lines)
    joined = CODE_SPAN_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), joined)
    blanked = joined.split("\n")
    for i, (number, _) in enumerate(lines):
        yield number, blanked[i], "\n".join(blanked[:i])


def prose_lines(text: str):
    """Yield (line_number, line, earlier) for prose: fenced and indented code dropped,
    code spans blanked, and earlier holding the paragraph's preceding lines.

    A fence closes only on the same character, at least as long, with nothing
    after it (CommonMark), so a ```` block can show a ``` example. Code spans are
    matched within a paragraph, so one that wraps onto the next line still hides;
    a heading, a list item or a rule starts a new block, so a stray backtick there
    cannot pair with one in the next block. Block-quote markers are stripped, so a
    quoted paragraph is one paragraph; entering or leaving a quote starts a new one.
    An indented code block (four spaces, not continuing a paragraph) is dropped.
    """
    opener = None
    paragraph: list[tuple[int, str]] = []
    was_quoted = False
    for number, raw in enumerate(text.splitlines(), start=1):
        quote = QUOTE_RE.match(raw)
        line = raw[quote.end() :] if quote else raw
        fence = FENCE_RE.match(line)
        if opener is not None:
            if fence and fence.group(1)[0] == opener[0] and len(fence.group(1)) >= len(opener) and not fence.group(2).strip():
                opener = None
            continue
        if bool(quote) != was_quoted:
            yield from blank_code_spans(paragraph)
            paragraph = []
        was_quoted = bool(quote)
        if not paragraph and line.strip() and INDENTED_CODE_RE.match(line):
            continue  # indented code
        if fence or not line.strip() or HEADING_RE.match(line) or BLOCK_START_RE.match(line):
            yield from blank_code_spans(paragraph)
            paragraph = []
        if fence:
            opener = fence.group(1)
        elif HEADING_RE.match(line):
            yield from blank_code_spans([(number, line)])  # a heading is one line, alone
        elif line.strip():
            paragraph.append((number, line))
    yield from blank_code_spans(paragraph)


def open_emphasis(run: str, before: str) -> bool:
    """Whether an underscore run of this length is left open in the text before it.

    Only delimiter runs count: an underscore inside a word (my_file) is not emphasis.
    Runs of exactly this length are paired off; an odd count leaves one open.
    """
    count = 0
    for m in re.finditer(r"(?<!_)_+(?!_)", before):
        prev = before[m.start() - 1 : m.start()]
        nxt = before[m.end() : m.end() + 1]
        if m.group() == run and not (prev.isalnum() and nxt.isalnum()):
            count += 1
    return count % 2 == 1


def trim_import(raw: str, before: str) -> str:
    """Drop markdown punctuation after an import. A trailing _ run is dropped only
    when it closes emphasis left open earlier in the paragraph (__see @a.md__);
    otherwise it is part of the name (@docs/foo_, even after a closed _word_)."""
    target = raw
    while True:
        trimmed = target.rstrip(TRAILING_PUNCT)
        run = re.search(r"_+$", trimmed)
        if run and open_emphasis(run.group(), before):
            trimmed = trimmed[: run.start()]
        if trimmed == target:
            return target
        target = trimmed


def find_imports(text: str) -> list[tuple[int, str]]:
    found = []
    for number, line, earlier in prose_lines(text):
        for match in IMPORT_RE.finditer(line):
            before = f"{earlier}\n{line[: match.start()]}"
            target = trim_import(match.group(1), before).replace("\\ ", " ")
            if target:
                found.append((number, target))
    return found


def find_links(text: str) -> list[tuple[int, str]]:
    found = []
    for number, line, _ in prose_lines(text):
        for match in LINK_RE.finditer(line):
            target = urllib.parse.unquote(re.split(r"[#?]", match.group(1) or match.group(2), maxsplit=1)[0])
            # A scheme (https:, mailto:) or an authority (//host/path) is not a repo file.
            # A single leading / is: GitHub resolves it from the repository root (walk does too).
            if target and not target.startswith("//") and not re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I):
                found.append((number, target))
    return found


def rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def walk(root: Path) -> Report:
    # Breadth-first, so each file is reached at its shallowest depth and the result
    # does not depend on import order.
    report = Report()
    seen: set[Path] = set()
    too_deep: list[tuple[Path, str]] = []
    queue = deque([(root / ROOT_FILE, 0)])
    while queue:
        path, depth = queue.popleft()
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        data = path.read_bytes()
        name = rel(path, root)
        report.loaded.append((name, len(data)))
        text = data.decode("utf-8", errors="replace")
        report.texts[name] = text

        for number, target in find_links(text):
            base = root if target.startswith("/") else path.parent
            if not (base / target.lstrip("/")).exists():
                report.broken_links.append(f"{name}:{number} — {target}")

        for number, target in find_imports(text):
            # ~/... is a user-level file outside the repo; /... would escape via pathlib's
            # absolute-right-wins join and read from the filesystem root. Both are skipped.
            if target.startswith(("~", "/")):
                report.skipped_imports.append(f"{name}:{number} — @{target}")
                continue
            child = path.parent / target
            if not child.resolve().is_relative_to(root.resolve()):
                # @../outside.md leaves the repository: not this repo's budget to count.
                report.skipped_imports.append(f"{name}:{number} — @{target}")
                continue
            if not child.is_file():
                # @copilot or @dependabot[bot] is a mention, not a path: no / and no dot.
                # An extensionless import that exists (@Makefile) still loads. One that is
                # missing is skipped here; write @./Makefile to make it fail. A deleted
                # file named that way is still flagged by the weekly drift scan.
                if "/" not in target and "." not in target:
                    report.skipped_imports.append(f"{name}:{number} — @{target}")
                else:
                    report.missing_imports.append(f"{name}:{number} — @{target}")
            elif depth < MAX_DEPTH:
                queue.append((child, depth + 1))
            else:
                too_deep.append((child.resolve(), f"{name}:{number} — @{target}"))

    # Past the limit on one path but audited through another (or a cycle back): not a gap.
    report.too_deep = [entry for target, entry in too_deep if target not in seen]
    return report


def deleted_paths(root: Path, days: int) -> set[str]:
    """Paths deleted or renamed away in the window and absent at HEAD."""
    # A merge's own changes (a conflict resolution that deletes) count, against its first parent.
    # -z: NUL-separated and unquoted, so names git would quote (non-ASCII, tabs) arrive as written.
    out = subprocess.run(
        ["git", "log", f"--since={days} days ago", "--name-status", "-z", "--diff-merges=first-parent", "--diff-filter=DR", "--format="],
        cwd=root, check=True, capture_output=True,
    ).stdout
    tokens = iter(t.strip(b"\n") for t in out.split(b"\0"))
    gone = set()
    for status in tokens:
        if status[:1] not in (b"D", b"R"):
            continue
        raw = next(tokens, b"")
        if status[:1] == b"R":
            next(tokens, b"")  # the new name
        try:
            old = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue  # a UTF-8 markdown file cannot name it
        if old and not (root / old).exists():
            gone.add(old)
    return gone


def names_path(line: str, path: str) -> bool:
    """Whether the line names the complete path, not a longer one that contains it.

    The path is matched as written, so names with spaces, parentheses or ``+``
    still match. Before it: line start, a character that cannot be part of a path,
    or ``./``. After it: line end, or anything but a path character; a trailing
    full stop counts as punctuation unless a name continues after it
    (``report.md.bak``).
    """
    for match in re.finditer(re.escape(path), line):
        before, after = line[: match.start()], line[match.end() :]
        if before.endswith("./"):
            before = before[:-2]
        if before and (before[-1].isalnum() or before[-1] in "_./+-"):
            continue
        if after and (after[0].isalnum() or after[0] in "_/+-" or (after[0] == "." and after[1:2].isalnum())):
            continue
        return True
    return False


def find_drift(root: Path, report: Report, gone: set[str]) -> None:
    sorted_gone = sorted(gone)
    for name, _ in report.loaded:
        lines = report.texts[name].splitlines()
        # A file may name a path relative to its own directory (RUNBOOK.md says ./train-run.sh),
        # or with ../ when the path lies outside it.
        here = os.path.dirname(name) or "."
        needles = {old: {old, os.path.relpath(old, here)} for old in gone}
        for number, line in enumerate(lines, start=1):
            # The complete path only: deleting report.md must not flag weekly-report.md.
            for old in sorted_gone:
                if any(names_path(line, needle) for needle in needles[old]):
                    report.drift.append(f"{name}:{number} — names `{old}`, deleted or renamed")


def failures(report: Report, budget: int) -> list[str]:
    problems = []
    if report.total > budget:
        problems.append(f"loaded bytes {report.total:,} exceed the budget {budget:,}")
    problems += [f"missing @-import: {m}" for m in report.missing_imports]
    problems += [f"import deeper than {MAX_DEPTH} hops, not audited: {t}" for t in report.too_deep]
    problems += [f"broken link: {b}" for b in report.broken_links]
    problems += [f"drift: {d}" for d in report.drift]
    return problems


def render(report: Report, budget: int, markdown: bool) -> str:
    bullet = "- " if markdown else "  "
    out = [("## " if markdown else "") + f"CLAUDE.md context budget: {report.total:,} / {budget:,} bytes"]
    out += [f"{bullet}{name}: {size:,} bytes" for name, size in report.loaded]
    for title, items in (
        ("Missing @-imports", report.missing_imports),
        (f"Imports deeper than {MAX_DEPTH} hops", report.too_deep),
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
    print("\nNo findings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
