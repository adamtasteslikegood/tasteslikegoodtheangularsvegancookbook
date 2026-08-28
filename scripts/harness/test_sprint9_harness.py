#!/usr/bin/env python3
"""Focused regression tests for Sprint 9 board-truth handling."""

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _jira_client import Jira  # noqa: E402
from sprint9_board import (  # noqa: E402
    AUTO_TRANSITION_REPO,
    _parse_ts,
    github_merge_times,
    truth_status,
)


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


class MergeLookupTests(unittest.TestCase):
    @patch("sprint9_board.subprocess.run")
    def test_only_queries_repository_that_owns_workflow(self, run):
        run.return_value = Mock(
            returncode=0,
            stdout='[{"mergedAt": "2026-08-28T06:12:16Z"}]',
        )

        self.assertEqual(
            github_merge_times("KAN-258"),
            [_parse_ts("2026-08-28T06:12:16Z")],
        )
        cmd = run.call_args.args[0]
        self.assertEqual(cmd[cmd.index("-R") + 1], AUTO_TRANSITION_REPO)
        self.assertNotIn("adamtasteslikegood/tasteslikegood.com", cmd)

class MergeCorrelationTests(unittest.TestCase):
    """The jira-auto-transition workflow authenticates with Adam's personal
    Atlassian token, so Jira records its moves under his display name and it
    posts no comment. Author matching alone therefore cannot see it. This is the
    KAN-249 / KAN-258 case from 2026-08-28, which read as human until the
    workflow runs were checked.
    """

    # Real shape: Adam starts the row, merges the PR, the workflow closes it
    # ~5s later wearing his name.
    HISTORY = issue_with_transitions(
        ("2026-08-27T23:03:25.000+0000", "Adam Schoen", "To Do", "In Progress"),
        ("2026-08-28T06:12:21.000+0000", "Adam Schoen", "In Progress", "Done"),
    )
    MERGED_AT = [_parse_ts("2026-08-28T06:12:16Z")]

    def test_author_matching_alone_is_fooled(self):
        target, why = truth_status(self.HISTORY, ("Automation for Jira",))
        self.assertIsNone(target, "without correlation the workflow's move looks human")
        self.assertIn("human-authored", why)

    def test_merge_correlation_identifies_the_workflow(self):
        target, why = truth_status(
            self.HISTORY, ("Automation for Jira",), self.MERGED_AT)
        self.assertEqual(target, "In Progress")
        self.assertIn("last human transition", why)

    def test_a_human_closing_hours_after_the_merge_is_left_alone(self):
        history = issue_with_transitions(
            ("2026-08-27T23:03:25.000+0000", "Adam Schoen", "To Do", "In Progress"),
            ("2026-08-28T09:00:00.000+0000", "Adam Schoen", "In Progress", "Done"),
        )
        target, _ = truth_status(history, ("Automation for Jira",), self.MERGED_AT)
        self.assertIsNone(target, "outside the window this is a real decision")

    def test_non_done_transitions_are_never_merge_correlated(self):
        # The workflow only ever moves TO Done. A move to In Review beside a
        # merge is somebody working, not the workflow.
        history = issue_with_transitions(
            ("2026-08-27T23:03:25.000+0000", "Adam Schoen", "To Do", "In Progress"),
            ("2026-08-28T06:12:21.000+0000", "Adam Schoen", "In Progress", "In Review"),
        )
        target, _ = truth_status(history, ("Automation for Jira",), self.MERGED_AT)
        self.assertIsNone(target)


if __name__ == "__main__":
    unittest.main()
