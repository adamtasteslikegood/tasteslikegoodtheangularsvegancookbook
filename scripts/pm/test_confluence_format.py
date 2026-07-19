"""Tests for the shared Markdown -> Confluence storage converter (KAN-107).

These lock in the behaviour that the old python-markdown / hand-rolled
converters got wrong: fenced code must become a Confluence *code macro* with a
CDATA body (so special characters can't corrupt the storage XHTML), and tables
must render as real storage tables.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _confluence_format import markdown_to_storage


def test_heading_and_bold():
    out = markdown_to_storage("# Title\n\nsome **bold** text")
    assert "<h1>Title</h1>" in out
    assert "<strong>bold</strong>" in out


def test_fenced_code_uses_storage_code_macro_with_cdata():
    # The whole point of KAN-107: fenced code becomes a Confluence code macro
    # with a CDATA body, so `<`, `>` and `&` can't corrupt the storage XHTML.
    out = markdown_to_storage("```python\nif a < b & c:\n    print('x')\n```")
    assert "ac:structured-macro" in out
    assert 'ac:name="code"' in out
    assert "<![CDATA[" in out
    assert "if a < b & c:" in out  # raw, unescaped, inside CDATA


def test_table_renders_as_storage_table():
    out = markdown_to_storage("| A | B |\n|---|---|\n| 1 | 2 |")
    assert "<table>" in out
    assert "<th>A</th>" in out
    assert "<td>1</td>" in out


def test_ampersand_in_prose_is_escaped():
    out = markdown_to_storage("Tom & Jerry")
    assert "&amp;" in out
