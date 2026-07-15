"""Tests for the Atlassian site/project allowlist (_atlassian_guard.py).

Standard-library only (unittest), matching the dependency-free constraint of
the modules under test. Run from the repo root with either:

    python3 -m unittest discover -s scripts/pm -p 'test_*.py' -v
    scripts/pm/.venv/bin/python -m unittest discover -s scripts/pm -p 'test_*.py' -v

(pytest also picks these up if installed: python3 -m pytest scripts/pm)
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Make the modules under test importable regardless of the runner's cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _atlassian_guard import (  # noqa: E402
    ALLOWED_ATLASSIAN_SITE,
    AtlassianGuardError,
    validate_atlassian_site,
    validate_jira_project_key,
    validate_jira_project_keys,
)
from _jira_projects import resolve_jira_projects  # noqa: E402


class TestSiteAllowlist(unittest.TestCase):
    def test_dev_service_site_is_refused(self):
        for value in (
            "tasteslikegood-dev.atlassian.net",
            "https://tasteslikegood-dev.atlassian.net",
            "https://tasteslikegood-dev.atlassian.net/wiki",
            "http://tasteslikegood-dev.atlassian.net/",
        ):
            with self.subTest(value=value):
                with self.assertRaises(AtlassianGuardError) as ctx:
                    validate_atlassian_site(value)
                message = str(ctx.exception)
                self.assertIn("BLOCKED", message)
                self.assertIn(ALLOWED_ATLASSIAN_SITE, message)
                self.assertIn("TOSVC", message)

    def test_any_other_host_is_refused(self):
        for value in (
            "evil.example.com",
            "https://someoneelse.atlassian.net",
            # Suffix-spoofing attempt must not pass a naive "contains" check.
            "tasteslikegood.atlassian.net.evil.com",
            "",
        ):
            with self.subTest(value=value):
                with self.assertRaises(AtlassianGuardError) as ctx:
                    validate_atlassian_site(value)
                self.assertIn(ALLOWED_ATLASSIAN_SITE, str(ctx.exception))

    def test_main_site_passes_and_is_normalized(self):
        for value in (
            "tasteslikegood.atlassian.net",
            "https://tasteslikegood.atlassian.net",
            "https://tasteslikegood.atlassian.net/",
            "tasteslikegood.atlassian.net/wiki",
            "TASTESLIKEGOOD.ATLASSIAN.NET",
        ):
            with self.subTest(value=value):
                self.assertEqual(validate_atlassian_site(value), ALLOWED_ATLASSIAN_SITE)


class TestJiraProjectAllowlist(unittest.TestCase):
    def test_plzg_is_refused(self):
        with self.assertRaises(AtlassianGuardError) as ctx:
            validate_jira_project_key("PLZG")
        message = str(ctx.exception)
        self.assertIn("BLOCKED", message)
        # The error must name the allowlist.
        self.assertIn("KAN", message)
        self.assertIn("RCP", message)

    def test_other_disallowed_keys_are_refused(self):
        for key in ("TO", "TOSVC", "plzg", "ABC", ""):
            with self.subTest(key=key):
                with self.assertRaises(AtlassianGuardError):
                    validate_jira_project_key(key)

    def test_allowed_keys_pass_and_are_normalized(self):
        self.assertEqual(validate_jira_project_key("KAN"), "KAN")
        self.assertEqual(validate_jira_project_key("RCP"), "RCP")
        self.assertEqual(validate_jira_project_key(" kan "), "KAN")
        self.assertEqual(validate_jira_project_keys(["KAN", "RCP"]), ["KAN", "RCP"])

    def test_read_only_admits_plaza_projects(self):
        """Rollup/briefing paths may READ the plaza projects, never write."""
        self.assertEqual(validate_jira_project_key("PLZG", read_only=True), "PLZG")
        self.assertEqual(validate_jira_project_key("TO", read_only=True), "TO")
        self.assertEqual(
            validate_jira_project_keys(["KAN", "RCP", "PLZG", "TO"], read_only=True),
            ["KAN", "RCP", "PLZG", "TO"],
        )

    def test_read_only_still_refuses_frozen_and_unknown_keys(self):
        for key in ("TOSVC", "ABC", ""):
            with self.subTest(key=key):
                with self.assertRaises(AtlassianGuardError):
                    validate_jira_project_key(key, read_only=True)


class TestResolverIntegration(unittest.TestCase):
    """resolve_jira_projects (shared by the PM scripts) enforces the allowlist."""

    def test_default_resolution_passes(self):
        self.assertEqual(resolve_jira_projects({}.get), ["KAN", "RCP"])

    def test_explicit_allowed_csv_passes(self):
        env = {"JIRA_PROJECTS": "RCP,KAN"}
        self.assertEqual(resolve_jira_projects(env.get), ["RCP", "KAN"])

    def test_plaza_csv_passes_read_only_resolution(self):
        # Both resolver consumers only read Jira, so cross-project rollups
        # including the plaza projects are allowed here.
        env = {"JIRA_PROJECTS": "KAN,PLZG"}
        self.assertEqual(resolve_jira_projects(env.get), ["KAN", "PLZG"])

    def test_unknown_csv_is_refused(self):
        env = {"JIRA_PROJECTS": "KAN,ABC"}
        with self.assertRaises(AtlassianGuardError):
            resolve_jira_projects(env.get)

    def test_disallowed_single_key_var_is_refused(self):
        env = {"ATLASSIAN_JIRA_PROJECT_KEY": "TOSVC"}
        with self.assertRaises(AtlassianGuardError):
            resolve_jira_projects(env.get)


if __name__ == "__main__":
    unittest.main()
