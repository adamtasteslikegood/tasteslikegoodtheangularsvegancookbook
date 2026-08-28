#!/usr/bin/env python3
"""Focused regression tests for Sprint 9 board-truth handling."""

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _jira_client import Jira  # noqa: E402
from sprint9_board import truth_status  # noqa: E402


def issue_with_transitions(*transitions):
    histories = []
    for at, author, old, new in transitions:
        histories.append({
            "created": at,
            "author": {"displayName": author},
            "items": [{
                "field": "status",
                "fromString": old,
                "toString": new,
            }],
        })
    return {"changelog": {"histories": histories}}


class JiraClientTests(unittest.TestCase):
    def test_issue_changelog_reads_every_page(self):
        jira = Jira.__new__(Jira)
        jira.call = Mock(side_effect=[
            {"total": 3, "values": [{"id": "1"}, {"id": "2"}]},
            {"total": 3, "values": [{"id": "3"}]},
        ])

        self.assertEqual(
            jira.issue_changelog("KAN-1"),
            [{"id": "1"}, {"id": "2"}, {"id": "3"}],
        )
        self.assertEqual(
            [call.args[1] for call in jira.call.call_args_list],
            [
                "/rest/api/3/issue/KAN-1/changelog?startAt=0&maxResults=100",
                "/rest/api/3/issue/KAN-1/changelog?startAt=2&maxResults=100",
            ],
        )


class TruthStatusTests(unittest.TestCase):
    def test_trailing_automation_is_rewound_to_last_human_status(self):
        data = issue_with_transitions(
            ("2026-08-27T10:00:00Z", "Adam", "To Do", "In Review"),
            ("2026-08-27T11:00:00Z", "Automation for Jira", "In Review", "Done"),
        )

        target, why = truth_status(data, ["Automation for Jira"])

        self.assertEqual(target, "In Review")
        self.assertIn("last human transition", why)

    def test_human_transition_after_automation_is_already_truthful(self):
        data = issue_with_transitions(
            ("2026-08-27T10:00:00Z", "Automation for Jira", "To Do", "Done"),
            ("2026-08-27T11:00:00Z", "Adam", "Done", "In Progress"),
        )

        target, why = truth_status(data, ["Automation for Jira"])

        self.assertIsNone(target)
        self.assertEqual(why, "latest transition is human-authored")

    def test_bot_only_history_restores_original_status(self):
        data = issue_with_transitions(
            ("2026-08-27T10:00:00Z", "Automation for Jira", "To Do", "In Progress"),
            ("2026-08-27T11:00:00Z", "Automation for Jira", "In Progress", "Done"),
        )

        target, why = truth_status(data, ["Automation for Jira"])

        self.assertEqual(target, "To Do")
        self.assertIn("original status", why)


if __name__ == "__main__":
    unittest.main()
