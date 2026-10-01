#!/usr/bin/env python3
"""Every secret a workflow references must be configured (KAN-300, Sprint 10 S12).

Extracts every ``secrets.<NAME>`` reference under ``.github/workflows`` with the
authoritative pattern ``secrets\\.[A-Za-z0-9_]+`` and diffs the names against
the secrets that actually exist. ``GITHUB_TOKEN`` is the only exemption, by
exact name: GitHub mints it per run and never lists it.

Why there are two ways to learn what is configured
--------------------------------------------------
Listing secret names (``gh secret list``, ``GET .../actions/secrets``) needs a
token with admin access to the repo. The workflow's own ``GITHUB_TOKEN`` has no
``secrets`` permission at all, so CI cannot list anything. What CI *can* do is
evaluate an expression per name: ``secrets.NAME != ''`` is ``true`` when the
secret is set and ``false`` when it is not, and the value itself never reaches
the runner. ``pr-gate.yml`` therefore carries one such line per referenced name,
between two marker comments (the "presence block"), and this script checks:

* ``--static`` - the presence block names exactly the referenced set: no
  reference without a presence line, no stale line for a name nothing uses. The
  block's own lines are left out of the referenced set; otherwise a stale line
  would keep its name "referenced" forever. Needs no secrets, runs everywhere.
* ``--env`` - ``--static``, then every ``SECRET_PRESENT_*`` variable the
  presence step exported must be ``true``.
* ``--gh`` - for a human with admin credentials: ``--static``, then the diff
  against ``gh secret list`` (repo scope plus every environment's scope).
* ``--emit-block`` - print the presence block for the current references, so
  regenerating it is mechanical.

Exit codes: 0 pass, 1 check failed, 2 could not inspect.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
GATE_FILE = WORKFLOWS / "pr-gate.yml"

# The authoritative pattern is ``secrets\.[A-Za-z0-9_]+``. The left boundary is
# a deliberate refinement: without it ``redact_secrets.cjs`` (a filename in the
# gh-aw lock files) yields a phantom secret called ``cjs``.
REFERENCE_RE = re.compile(r"(?<![A-Za-z0-9_./-])secrets\.([A-Za-z0-9_]+)")

# GitHub creates it for every run and never lists it. Exact name only:
# GITHUB_TOKEN_X or GH_AW_GITHUB_TOKEN are ordinary secrets and must exist.
BUILTIN_EXEMPT = "GITHUB_TOKEN"

# Referenced secrets that may legitimately be unset, with the reason. Empty on
# purpose: an entry here is a product decision (Adam's), not a way to go green.
OPTIONAL_SECRETS: dict[str, str] = {}

BLOCK_BEGIN = "# secret-presence: begin"
BLOCK_END = "# secret-presence: end"
PRESENCE_PREFIX = "SECRET_PRESENT_"
PRESENCE_LINE_RE = re.compile(
    r"^\s*" + PRESENCE_PREFIX + r"([A-Za-z0-9_]+):\s*"
    r"\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*!=\s*''\s*\}\}\s*$"
)
# A job-level ``environment:`` key means some secrets may live in that
# environment's store, which the pr-gate presence step cannot see.
ENVIRONMENT_RE = re.compile(r"^\s+environment\s*:", re.MULTILINE)


class InspectError(Exception):
    """The check could not run (exit 2), as opposed to running and failing."""


def normalize(name: str) -> str:
    # Secret names are case-insensitive in GitHub; ``secrets.foo`` resolves FOO.
    return name.upper()


def extract_names(text: str) -> set[str]:
    return {normalize(m.group(1)) for m in REFERENCE_RE.finditer(text)}


def is_exempt(name: str) -> bool:
    return normalize(name) == BUILTIN_EXEMPT


def split_presence_block(text: str) -> tuple[str, list[str] | None]:
    """Return (text outside the block, block lines) - block is None if absent."""
    lines = text.splitlines()
    begins = [i for i, line in enumerate(lines) if line.strip() == BLOCK_BEGIN]
    ends = [i for i, line in enumerate(lines) if line.strip() == BLOCK_END]
    if not begins and not ends:
        return text, None
    if len(begins) != 1 or len(ends) != 1 or ends[0] < begins[0]:
        raise InspectError(
            f"expected exactly one '{BLOCK_BEGIN}' followed by one '{BLOCK_END}'"
        )
    b, e = begins[0], ends[0]
    outside = "\n".join(lines[:b] + lines[e + 1 :])
    return outside, lines[b + 1 : e]


def parse_presence_block(block: list[str]) -> set[str]:
    names: set[str] = set()
    for line in block:
        if not line.strip() or line.strip().startswith("#"):
            continue
        m = PRESENCE_LINE_RE.match(line)
        if not m:
            raise InspectError(f"unrecognised presence-block line: {line.strip()!r}")
        key, secret = normalize(m.group(1)), normalize(m.group(2))
        if key != secret:
            raise InspectError(
                f"presence line {PRESENCE_PREFIX}{key} tests secret {secret}; names must match"
            )
        names.add(secret)
    return names


def workflow_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.is_file())


def scan(root: Path, gate_file: Path) -> tuple[set[str], set[str] | None, list[str]]:
    """Return (referenced names minus the exemption, presence names, env files)."""
    referenced: set[str] = set()
    presence: set[str] | None = None
    env_files: list[str] = []
    for path in workflow_files(root):
        text = path.read_text(encoding="utf-8", errors="replace")
        if path.resolve() == gate_file.resolve():
            text, block = split_presence_block(text)
            if block is not None:
                presence = parse_presence_block(block)
        referenced |= extract_names(text)
        if path.suffix in (".yml", ".yaml") and ENVIRONMENT_RE.search(text):
            env_files.append(path.name)
    return {n for n in referenced if not is_exempt(n)}, presence, env_files


def static_problems(referenced: set[str], presence: set[str] | None, env_files: list[str]) -> list[str]:
    problems = []
    if presence is None:
        problems.append(f"no presence block ('{BLOCK_BEGIN}' ... '{BLOCK_END}') in pr-gate.yml")
        presence = set()
    for name in sorted(referenced - presence):
        problems.append(f"{name}: referenced by a workflow but has no presence line in pr-gate.yml")
    for name in sorted(presence - referenced):
        problems.append(f"{name}: presence line in pr-gate.yml but no workflow references it")
    for name in sorted(OPTIONAL_SECRETS):
        if not OPTIONAL_SECRETS[name].strip():
            problems.append(f"{name}: optional-secret entry has no reason")
    if env_files:
        problems.append(
            "job-level 'environment:' found in "
            + ", ".join(env_files)
            + ": environment-scoped secrets are invisible to the pr-gate presence step;"
            " decide how this check covers them before adding one"
        )
    return problems


def missing_problems(referenced: set[str], configured: set[str]) -> list[str]:
    return [
        f"{name}: referenced by a workflow but not configured"
        for name in sorted(referenced - configured)
        if name not in OPTIONAL_SECRETS
    ]


def configured_from_env(names: set[str], environ: dict[str, str]) -> set[str]:
    configured = set()
    for name in names:
        value = environ.get(PRESENCE_PREFIX + name)
        if value is None:
            raise InspectError(f"{PRESENCE_PREFIX}{name} not exported; run --env inside the presence step")
        if value == "true":
            configured.add(name)
        elif value != "false":
            raise InspectError(f"{PRESENCE_PREFIX}{name} is neither 'true' nor 'false'")
    return configured


def _gh_json(args: list[str]) -> object:
    try:
        out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        raise InspectError(f"gh {' '.join(args)} failed: {exc}") from exc
    return json.loads(out or "[]")


def configured_from_gh() -> set[str]:
    """Names only - gh never returns secret values."""
    names = {normalize(s["name"]) for s in _gh_json(["secret", "list", "--json", "name"])}
    envs = _gh_json(["api", "repos/{owner}/{repo}/environments", "--jq", "[.environments[].name]"])
    for env in envs or []:
        names |= {normalize(s["name"]) for s in _gh_json(["secret", "list", "--env", env, "--json", "name"])}
    return names


def emit_block(referenced: set[str], indent: str = "          ") -> str:
    lines = [indent + BLOCK_BEGIN]
    lines += [f"{indent}{PRESENCE_PREFIX}{n}: ${{{{ secrets.{n} != '' }}}}" for n in sorted(referenced)]
    lines.append(indent + BLOCK_END)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--static", action="store_true")
    mode.add_argument("--env", action="store_true")
    mode.add_argument("--gh", action="store_true")
    mode.add_argument("--emit-block", action="store_true")
    args = parser.parse_args(argv)

    try:
        referenced, presence, env_files = scan(WORKFLOWS, GATE_FILE)
        if args.emit_block:
            print(emit_block(referenced))
            return 0
        problems = static_problems(referenced, presence, env_files)
        if args.env:
            problems += missing_problems(referenced, configured_from_env(referenced, dict(os.environ)))
        elif args.gh:
            problems += missing_problems(referenced, configured_from_gh())
    except InspectError as exc:
        print(f"::error::cannot inspect workflow secrets: {exc}")
        return 2

    print(f"{len(referenced)} secret name(s) referenced (excluding {BUILTIN_EXEMPT}): " + ", ".join(sorted(referenced)))
    if problems:
        for p in problems:
            print(f"::error::{p}")
        return 1
    print("✅ workflow secret references are consistent" + ("" if args.static else " and configured"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
