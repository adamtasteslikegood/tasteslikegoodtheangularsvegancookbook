"""Unit tests for check_claude_md_budget.py (KAN-417)."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_claude_md_budget as budget  # noqa: E402


def write(root: Path, name: str, text: str) -> None:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class FindImports(unittest.TestCase):
    def test_import_mid_line_and_in_bold(self):
        text = "- @docs/a.md\n**The full procedure is @docs/a.md**, driven by x.\n"
        self.assertEqual(budget.find_imports(text), [(1, "docs/a.md"), (2, "docs/a.md")])

    def test_code_spans_and_fences_are_not_imports(self):
        text = "An `@path` entry, `@angular/*` too.\n```\n@inside/fence.md\n```\n"
        self.assertEqual(budget.find_imports(text), [])

    def test_email_is_not_an_import(self):
        self.assertEqual(budget.find_imports("mail me at someone@example.org\n"), [])


class FindLinks(unittest.TestCase):
    def test_relative_links_only(self):
        text = "[a](./README.md) [b](https://x.org) [c](#anchor) [d](mailto:x@y) [e](docs/f.md#sec)\n"
        self.assertEqual(budget.find_links(text), [(1, "./README.md"), (1, "docs/f.md")])


class Walk(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_recurses_dedupes_and_sums(self):
        write(self.root, "CLAUDE.md", "- @docs/a.md\n**see @docs/a.md**,\n")
        write(self.root, "docs/a.md", "see @b.md\n")
        write(self.root, "docs/b.md", "back to @a.md\n")  # cycle
        report = budget.walk(self.root)
        self.assertEqual([name for name, _ in report.loaded], ["CLAUDE.md", "docs/a.md", "docs/b.md"])
        self.assertEqual(report.total, sum((self.root / n).stat().st_size for n, _ in report.loaded))
        self.assertEqual(budget.failures(report, 10_000), [])

    def test_missing_import_broken_link_and_budget_fail(self):
        write(self.root, "CLAUDE.md", "@Backend/CLAUDE.md and [x](nope.md)\n")
        report = budget.walk(self.root)
        problems = budget.failures(report, 10)
        self.assertEqual(report.missing_imports, ["CLAUDE.md:1 — @Backend/CLAUDE.md"])
        self.assertEqual(report.broken_links, ["CLAUDE.md:1 — nope.md"])
        self.assertTrue(problems[0].startswith("loaded bytes"))
        self.assertEqual(len(problems), 3)

    def test_user_level_import_is_skipped(self):
        write(self.root, "CLAUDE.md", "@~/.claude/personal.md\n")
        report = budget.walk(self.root)
        self.assertEqual(report.skipped_imports, ["CLAUDE.md:1 — @~/.claude/personal.md"])
        self.assertEqual(budget.failures(report, 10_000), [])

    def test_drift_reports_lines_naming_deleted_paths(self):
        git = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        write(self.root, "old/tool.sh", "x\n")
        write(self.root, "CLAUDE.md", "Run `old/tool.sh` first.\n")
        subprocess.run(git + ["add", "-A"], cwd=self.root, check=True)
        subprocess.run(git + ["commit", "-qm", "add"], cwd=self.root, check=True)
        subprocess.run(git + ["rm", "-q", "old/tool.sh"], cwd=self.root, check=True)
        subprocess.run(git + ["commit", "-qm", "rm"], cwd=self.root, check=True)
        report = budget.walk(self.root)
        budget.find_drift(self.root, report, budget.deleted_paths(self.root, 7))
        self.assertEqual(report.drift, ["CLAUDE.md:1 — names `old/tool.sh`, deleted or renamed"])


class RealTree(unittest.TestCase):
    def test_repository_claude_md_passes(self):
        root = Path(__file__).resolve().parents[2]
        report = budget.walk(root)
        self.assertEqual(budget.failures(report, budget.BUDGET_BYTES), [])
        self.assertEqual(report.loaded[0][0], "CLAUDE.md")


if __name__ == "__main__":
    unittest.main()
