"""Tests for the canonical PM file set (KAN-187).

The bug these guard against: the file set was a hardcoded 7-entry list, copied
inline into the SessionStart briefing hook. It named `specs/SPRINT_0_PLAN.md` (a
182-byte TODO stub) and omitted SPRINT_1..4_PLAN.md, ~91 KB of real planning. So
the stub synced to Confluence for four sprints while every actual sprint plan was
silently skipped.

Two properties therefore need asserting, not just the happy path:

  1. Sprint plans are matched by GLOB — a new sprint must need no code change.
     `test_new_sprint_plan_needs_no_code_change` is the regression test for the
     original bug; it fails if anyone replaces the glob with an enumeration.
  2. The hook and the daemon resolve the SAME set. They are different languages
     and different processes, so this is an end-to-end test that actually runs
     the hook — comparing the two source lists by reading them would pass even if
     the hook could not import the module at all.

Standard library only (unittest), same as test_watcher_lock.py, so it runs
without the venv: python3 -m unittest discover -s scripts/pm -p 'test_*.py'
"""

from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _canonical_pm_files import (  # noqa: E402
    BRIEFING_SUMMARY_FILES,
    CURATED_PM_FILES,
    SPRINT_GLOBS,
    canonical_pm_files,
    could_be_canonical,
    page_title_for,
)

_PM_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _PM_DIR.parent.parent
_HOOK = _REPO_ROOT / ".claude" / "hooks" / "sessionstart-pm-briefing.sh"


def _make_repo(tmp: Path, names: list[str]) -> Path:
    """Minimal fake checkout: specs/<names> plus the real scripts/pm module."""
    (tmp / "specs").mkdir(parents=True, exist_ok=True)
    for name in names:
        (tmp / "specs" / name).write_text(f"# {name}\n\nbody\n", encoding="utf-8")
    pm = tmp / "scripts" / "pm"
    pm.mkdir(parents=True, exist_ok=True)
    (pm / "_canonical_pm_files.py").write_text(
        (_PM_DIR / "_canonical_pm_files.py").read_text(encoding="utf-8"), encoding="utf-8"
    )
    return tmp


class TestCanonicalSet(unittest.TestCase):
    def test_sprint_plans_are_globbed_not_enumerated(self):
        """The curated list must NOT enumerate sprint plans beyond the 0 stub."""
        enumerated = [p for p in CURATED_PM_FILES if re.match(r"specs/SPRINT_\d+_PLAN\.md$", p)]
        self.assertEqual(
            enumerated,
            ["specs/SPRINT_0_PLAN.md"],
            "Sprint plans must come from SPRINT_GLOBS. Enumerating them re-creates "
            "KAN-187: the next sprint silently stops syncing.",
        )
        self.assertIn("specs/SPRINT_*_PLAN.md", SPRINT_GLOBS)

    def test_new_sprint_plan_needs_no_code_change(self):
        """Regression test for KAN-187 itself: drop in SPRINT_9, it must be found."""
        with tempfile.TemporaryDirectory() as td:
            root = _make_repo(Path(td), ["plan.md", "SPRINT_0_PLAN.md"])
            before = canonical_pm_files(root)
            self.assertNotIn(Path("specs/SPRINT_9_PLAN.md"), before)

            (root / "specs" / "SPRINT_9_PLAN.md").write_text("# s9\n", encoding="utf-8")

            after = canonical_pm_files(root)
            self.assertIn(
                Path("specs/SPRINT_9_PLAN.md"),
                after,
                "A new sprint plan must be picked up with no edit to Python.",
            )

    def test_resolution_is_not_cached_at_import(self):
        """Two roots in one process must give different answers."""
        with tempfile.TemporaryDirectory() as td:
            a = _make_repo(Path(td) / "a", ["SPRINT_1_PLAN.md"])
            b = _make_repo(Path(td) / "b", ["SPRINT_2_PLAN.md"])
            self.assertEqual(canonical_pm_files(a), [Path("specs/SPRINT_1_PLAN.md")])
            self.assertEqual(canonical_pm_files(b), [Path("specs/SPRINT_2_PLAN.md")])

    def test_sprint_zero_appears_once(self):
        """SPRINT_0 is both curated and glob-matched; dedupe must collapse it."""
        with tempfile.TemporaryDirectory() as td:
            root = _make_repo(Path(td), ["SPRINT_0_PLAN.md"])
            found = canonical_pm_files(root)
            self.assertEqual(found.count(Path("specs/SPRINT_0_PLAN.md")), 1)

    def test_sprint_plans_sort_numerically(self):
        """SPRINT_10 must follow SPRINT_2, not sit between SPRINT_1 and SPRINT_2."""
        with tempfile.TemporaryDirectory() as td:
            root = _make_repo(
                Path(td), ["SPRINT_1_PLAN.md", "SPRINT_2_PLAN.md", "SPRINT_10_PLAN.md"]
            )
            names = [p.name for p in canonical_pm_files(root)]
            self.assertEqual(
                names, ["SPRINT_1_PLAN.md", "SPRINT_2_PLAN.md", "SPRINT_10_PLAN.md"]
            )

    def test_missing_files_are_omitted(self):
        with tempfile.TemporaryDirectory() as td:
            root = _make_repo(Path(td), [])
            self.assertEqual(canonical_pm_files(root), [])

    def test_page_titles_are_stable_and_version_free(self):
        # Derived fallback must render sprint plans correctly — this is why
        # CANONICAL_PAGE_TITLES needs no per-sprint entry (KAN-109 forbids a
        # version prefix, since pages are looked up by title).
        self.assertEqual(page_title_for(Path("specs/SPRINT_4_PLAN.md")), "Sprint 4 Plan")
        self.assertEqual(page_title_for(Path("specs/SPRINT_0_PLAN.md")), "Sprint 0 Plan")
        self.assertEqual(page_title_for(Path("specs/roadmap.md")), "Project Roadmap")
        for name in ("SPRINT_4_PLAN.md", "roadmap.md", "plan.md"):
            self.assertNotIn("v0.", page_title_for(Path("specs") / name))


class TestCouldBeCanonical(unittest.TestCase):
    """The no-I/O reject used by the watchdog hot path.

    The observer runs recursive=True over the whole workspace, so this is called
    for every file event in the repo. It must be cheap AND it must never reject
    something canonical_pm_files() would accept — a false negative here silently
    stops syncing a real plan.
    """

    def test_accepts_every_curated_and_sprint_basename(self):
        for relative_path in CURATED_PM_FILES:
            self.assertTrue(could_be_canonical(Path(relative_path).name), relative_path)
        for name in ("SPRINT_1_PLAN.md", "SPRINT_10_PLAN.md", "SPRINT_999_PLAN.md"):
            self.assertTrue(could_be_canonical(name), name)

    def test_rejects_the_noise_it_exists_to_reject(self):
        for name in ("main.js", "index.html", "ORIG_HEAD", "package.json", "SPRINT_NOTES.md"):
            self.assertFalse(could_be_canonical(name), name)

    def test_never_rejects_what_canonical_pm_files_accepts(self):
        """The invariant that matters: the fast path must not shadow the slow one."""
        with tempfile.TemporaryDirectory() as td:
            root = _make_repo(
                Path(td),
                [Path(p).name for p in CURATED_PM_FILES]
                + ["SPRINT_2_PLAN.md", "SPRINT_11_PLAN.md"],
            )
            for relative_path in canonical_pm_files(root):
                self.assertTrue(could_be_canonical(relative_path.name), relative_path)

    def test_does_no_filesystem_access(self):
        # Cheapness is the entire point; a path that does not exist anywhere must
        # still answer instantly and correctly.
        self.assertTrue(could_be_canonical("SPRINT_7_PLAN.md"))
        self.assertFalse(could_be_canonical("nope.md"))


class TestBriefingSummarySet(unittest.TestCase):
    """The briefing set is narrower than the sync set on purpose (12k cap), but
    it must be DEFINED once — it was a drifted copy in atlassian_pm_link.py."""

    def test_briefing_set_is_a_subset_of_the_curated_set(self):
        self.assertTrue(set(BRIEFING_SUMMARY_FILES).issubset(set(CURATED_PM_FILES)))

    def test_briefing_set_excludes_sprint_plans(self):
        # ~91 KB of sprint plans would evict everything else from a 12k briefing.
        for relative_path in BRIEFING_SUMMARY_FILES:
            self.assertNotIn("SPRINT_", relative_path)

    def test_atlassian_pm_link_imports_the_shared_set(self):
        """Pins the de-duplication itself: KAN-187 named this file's local list as
        duplicate #3, and the first cut of the fix left it in place."""
        src = (_PM_DIR / "atlassian_pm_link.py").read_text(encoding="utf-8")
        self.assertIn("from _canonical_pm_files import BRIEFING_SUMMARY_FILES", src)
        self.assertNotIn("LOCAL_PM_FILES", src)


class TestStdlibOnly(unittest.TestCase):
    """The briefing hook imports this module under the SYSTEM python3, outside the
    daemon's .venv. A third-party import here would make the hook fail open and
    silently stop briefing every session."""

    def test_module_imports_only_stdlib(self):
        src = (_PM_DIR / "_canonical_pm_files.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        roots = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
        third_party = roots - set(sys.stdlib_module_names)
        self.assertEqual(
            third_party,
            set(),
            f"Non-stdlib import(s) {third_party} break the SessionStart hook.",
        )


class TestHookAgreesWithDaemon(unittest.TestCase):
    """End-to-end: run the real hook and compare its file set to the module's.

    This is the drift guard. Comparing two hardcoded lists textually would not
    catch the hook failing to import the module — it would silently take its
    fallback branch and still look plausible.
    """

    def _hook_files(self, root: Path) -> list[str]:
        proc = subprocess.run(
            ["bash", str(_HOOK)],
            input=json.dumps({"source": "startup", "cwd": str(root), "hook_event_name": "SessionStart"}),
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0, f"hook must always exit 0: {proc.stderr}")
        if not proc.stdout.strip():
            return []
        ctx = json.loads(proc.stdout)["hookSpecificOutput"]["additionalContext"]
        return re.findall(r"--- (specs/\S+) ---", ctx)

    @unittest.skipUnless(_HOOK.is_file(), "briefing hook not present")
    def test_hook_and_module_resolve_the_same_set(self):
        with tempfile.TemporaryDirectory() as td:
            root = _make_repo(
                Path(td),
                [
                    "plan.md",
                    "roadmap.md",
                    "SPRINT_0_PLAN.md",
                    "SPRINT_3_PLAN.md",
                    "SPRINT_4_PLAN.md",
                    "ux-backlog.md",  # deliberately out of scope
                ],
            )
            expected = [p.as_posix() for p in canonical_pm_files(root)]
            self.assertEqual(self._hook_files(root), expected)

    @unittest.skipUnless(_HOOK.is_file(), "briefing hook not present")
    def test_hook_picks_up_a_new_sprint_plan(self):
        with tempfile.TemporaryDirectory() as td:
            root = _make_repo(Path(td), ["plan.md"])
            self.assertNotIn("specs/SPRINT_7_PLAN.md", self._hook_files(root))
            (root / "specs" / "SPRINT_7_PLAN.md").write_text("# s7\n", encoding="utf-8")
            self.assertIn("specs/SPRINT_7_PLAN.md", self._hook_files(root))

    @unittest.skipUnless(_HOOK.is_file(), "briefing hook not present")
    def test_hook_excludes_non_sprint_specs(self):
        """Adam's 2026-07-30 scope call: sprint plans only, not every specs/*.md."""
        with tempfile.TemporaryDirectory() as td:
            root = _make_repo(
                Path(td), ["plan.md", "ux-backlog.md", "KAN-119_LOOP_PLAN.md", "SPRINT_4_PLAN.md"]
            )
            files = self._hook_files(root)
            self.assertIn("specs/SPRINT_4_PLAN.md", files)
            self.assertNotIn("specs/ux-backlog.md", files)
            self.assertNotIn("specs/KAN-119_LOOP_PLAN.md", files)

    @unittest.skipUnless(_HOOK.is_file(), "briefing hook not present")
    def test_hook_is_fail_open_without_the_module(self):
        """Missing scripts/pm must degrade to the fallback, never go silent."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "specs").mkdir(parents=True)
            (root / "specs" / "plan.md").write_text("# plan\n", encoding="utf-8")
            (root / "specs" / "SPRINT_5_PLAN.md").write_text("# s5\n", encoding="utf-8")
            files = self._hook_files(root)
            self.assertIn("specs/plan.md", files)
            self.assertIn("specs/SPRINT_5_PLAN.md", files)

    @unittest.skipUnless(_HOOK.is_file(), "briefing hook not present")
    def test_fallback_sorts_sprints_numerically_like_the_module(self):
        """Review catch on #3315: the fallback lex-sorted, so SPRINT_10 landed
        between SPRINT_1 and SPRINT_2 while the module ordered them numerically.
        Only reachable in the fail-open path, but a silent reordering of the
        briefing is exactly the kind of difference nobody would think to check."""
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)  # no scripts/pm — forces the fallback branch
            (root / "specs").mkdir(parents=True)
            for name in ("SPRINT_1_PLAN.md", "SPRINT_2_PLAN.md", "SPRINT_10_PLAN.md"):
                (root / "specs" / name).write_text(f"# {name}\n", encoding="utf-8")
            self.assertEqual(
                self._hook_files(root),
                ["specs/SPRINT_1_PLAN.md", "specs/SPRINT_2_PLAN.md", "specs/SPRINT_10_PLAN.md"],
            )


if __name__ == "__main__":
    unittest.main()
