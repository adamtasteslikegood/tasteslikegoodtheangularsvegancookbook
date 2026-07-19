"""Tests for the shared Markdown -> Confluence storage converter (KAN-107).

These lock in the behaviour the old python-markdown / hand-rolled converters got
wrong: fenced code must become a Confluence *code macro* with a CDATA body (so
special characters can't corrupt the storage XHTML), and tables must render as
real storage tables.

Unlike the other scripts/pm tests, the module under test needs a dependency
(md2cf), so run this with the pm venv from the repo root:

    scripts/pm/.venv/bin/python -m unittest discover -s scripts/pm -p 'test_*.py' -v

The whole case self-skips when md2cf isn't importable, so a bare
`python3 -m unittest discover -s scripts/pm` (system python, no venv) still
succeeds instead of erroring on import.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from _confluence_format import markdown_to_storage

    _IMPORT_ERROR: Exception | None = None
except Exception as exc:  # md2cf/mistune absent (e.g. bare system python)
    markdown_to_storage = None  # type: ignore[assignment]
    _IMPORT_ERROR = exc


@unittest.skipIf(markdown_to_storage is None, f"md2cf not importable: {_IMPORT_ERROR}")
class MarkdownToStorageTests(unittest.TestCase):
    def test_heading_and_bold(self):
        out = markdown_to_storage("# Title\n\nsome **bold** text")
        self.assertIn("<h1>Title</h1>", out)
        self.assertIn("<strong>bold</strong>", out)

    def test_fenced_code_uses_storage_code_macro_with_cdata(self):
        # The whole point of KAN-107: fenced code becomes a Confluence code macro
        # with a CDATA body, so `<`, `>` and `&` can't corrupt the storage XHTML.
        out = markdown_to_storage("```python\nif a < b & c:\n    print('x')\n```")
        self.assertIn("ac:structured-macro", out)
        self.assertIn('ac:name="code"', out)
        self.assertIn("<![CDATA[", out)
        self.assertIn("if a < b & c:", out)  # raw, unescaped, inside CDATA

    def test_table_renders_as_storage_table(self):
        out = markdown_to_storage("| A | B |\n|---|---|\n| 1 | 2 |")
        self.assertIn("<table>", out)
        self.assertIn("<th>A</th>", out)
        self.assertIn("<td>1</td>", out)

    def test_ampersand_in_prose_is_escaped(self):
        out = markdown_to_storage("Tom & Jerry")
        self.assertIn("&amp;", out)


if __name__ == "__main__":
    unittest.main()
