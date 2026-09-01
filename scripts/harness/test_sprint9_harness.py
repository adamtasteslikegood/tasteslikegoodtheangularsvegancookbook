#!/usr/bin/env python3
"""Focused regression tests for Sprint 9 board-truth handling."""

import contextlib
import io
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _jira_client import Jira  # noqa: E402
import sprint9_hard_gate as hard_gate  # noqa: E402
from sprint9_board import (  # noqa: E402
    AUTO_TRANSITION_REPO,
    _parse_ts,
    cmd_drop,
    github_merge_times,
    truth_status,
)
from sprint9_hard_gate import ACCEPTANCE, DROPPABLE, SI_EXECUTION  # noqa: E402


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
    def test_scalar_key_call_returns_a_list_for_backward_compat(self, run):
        run.return_value = Mock(
            returncode=0,
            stdout='[{"title": "chore [KAN-258]", "mergedAt": "2026-08-28T06:12:16Z"}]',
        )

        self.assertEqual(
            github_merge_times("KAN-258"),
            [_parse_ts("2026-08-28T06:12:16Z")],
        )
        cmd = run.call_args.args[0]
        self.assertEqual(cmd[cmd.index("-R") + 1], AUTO_TRANSITION_REPO)
        self.assertNotIn("adamtasteslikegood/tasteslikegood.com", cmd)
        self.assertEqual(cmd[cmd.index("--search") + 1], "KAN-258 in:title")

    @patch("sprint9_board.subprocess.run")
    def test_bulk_lookup_is_a_single_subprocess_call(self, run):
        run.return_value = Mock(
            returncode=0,
            stdout=(
                '[{"title": "release: KAN-249 pointer bump",'
                ' "mergedAt": "2026-08-28T06:12:16Z"},'
                ' {"title": "chore(models): tail [KAN-258]",'
                ' "mergedAt": "2026-08-28T05:00:00Z"}]'
            ),
        )

        out = github_merge_times(["KAN-249", "KAN-258"])

        self.assertEqual(run.call_count, 1, "bulk lookup must batch, not spawn per key")
        cmd = run.call_args.args[0]
        self.assertEqual(
            cmd[cmd.index("--search") + 1],
            "KAN-249 OR KAN-258 in:title",
            "GitHub search ANDs bare terms; batched keys must be joined with OR",
        )
        self.assertEqual(out["KAN-249"], [_parse_ts("2026-08-28T06:12:16Z")])
        self.assertEqual(out["KAN-258"], [_parse_ts("2026-08-28T05:00:00Z")])

    @patch("sprint9_board.subprocess.run")
    def test_word_boundary_matching_rejects_superset_keys(self, run):
        # The workflow uses `grep -oE '\b(KAN|RCP)-[0-9]+\b'`; a KAN-258 search
        # must not accept a KAN-2580 title as a KAN-258 correlation.
        run.return_value = Mock(
            returncode=0,
            stdout=(
                '[{"title": "chore: fix KAN-2580 regression",'
                ' "mergedAt": "2026-08-28T06:12:16Z"}]'
            ),
        )

        self.assertEqual(github_merge_times(["KAN-258"]), {"KAN-258": []})

    @patch("sprint9_board.subprocess.run")
    def test_non_zero_returncode_yields_empty_correlation(self, run):
        run.return_value = Mock(returncode=1, stdout="")
        self.assertEqual(
            github_merge_times(["KAN-258"]), {"KAN-258": []},
            "author matching alone must remain the fallback, not a crash")

    @patch("sprint9_board.subprocess.run")
    def test_non_list_json_yields_empty_correlation(self, run):
        # `gh` should always emit a list on success, but a defensive isinstance
        # guard keeps the "returns [] on failure" contract intact if it ever
        # writes `null` or an object on a rare error path.
        run.return_value = Mock(returncode=0, stdout="null")
        self.assertEqual(github_merge_times(["KAN-258"]), {"KAN-258": []})

    @patch("sprint9_board.subprocess.run")
    def test_timeout_yields_empty_correlation(self, run):
        run.side_effect = subprocess.TimeoutExpired(cmd=[], timeout=1)
        self.assertEqual(github_merge_times(["KAN-258"]), {"KAN-258": []})

    @patch("sprint9_board.subprocess.run")
    def test_empty_key_list_is_a_noop(self, run):
        self.assertEqual(github_merge_times([]), {})
        run.assert_not_called()


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



class DropSIAsAUnitTests(unittest.TestCase):
    """An SI drops as a unit — execution row AND acceptance row.

    Regression cover for the #3471 review finding: dropping only the execution key
    strands the acceptance row on board 168, because the hard gate's rule 4 exempts
    an SI as soon as its execution key leaves the sprint. Both gates then read green
    over an unexplained row for a supposedly dropped item.
    """

    def _drop(self, key):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 52, "name": "Sprint 9", "state": "active"}]
        args = Mock(key=key, rationale="timeboxed out under D6")
        rc = cmd_drop(jira, args)
        removed = [c for c in jira.call.call_args_list
                   if c.args[1] == "/rest/agile/1.0/backlog/issue"]
        return rc, jira, removed

    def test_drops_both_rows_for_every_droppable_si(self):
        # S5 -> KAN-209 + RCP-95, S8 -> KAN-176 + RCP-91.
        for exec_key in ("KAN-209", "KAN-176"):
            with self.subTest(key=exec_key):
                si = next(s for s, keys in SI_EXECUTION.items() if exec_key in keys)
                acceptance = ACCEPTANCE[si]
                rc, jira, removed = self._drop(exec_key)
                self.assertEqual(rc, 0)
                self.assertEqual(len(removed), 1, "removal must be ONE atomic call")
                self.assertEqual(sorted(removed[0].args[2]["issues"]),
                                 sorted([exec_key, acceptance]))
                commented = [c.args[0] for c in jira.comment.call_args_list]
                self.assertIn(exec_key, commented)
                self.assertIn(acceptance, commented,
                              "acceptance row must carry the drop rationale too")

    def test_s7_deduplicates_execution_and_acceptance(self):
        # RCP-67 is both its own execution row and its own acceptance row.
        self.assertEqual(SI_EXECUTION["S7"], ["RCP-67"])
        self.assertEqual(ACCEPTANCE["S7"], "RCP-67")
        rc, jira, removed = self._drop("RCP-67")
        self.assertEqual(rc, 0)
        self.assertEqual(removed[0].args[2]["issues"], ["RCP-67"],
                         "must not remove the same row twice")
        self.assertEqual(jira.comment.call_count, 1,
                         "must not comment on the same row twice")

    def test_required_item_is_still_refused(self):
        jira = Mock()
        rc = cmd_drop(jira, Mock(key="KAN-151", rationale="nope"))
        self.assertEqual(rc, 1)
        jira.comment.assert_not_called()
        jira.call.assert_not_called()

    def test_every_droppable_maps_to_an_si_with_an_acceptance_row(self):
        # Guards the lookup cmd_drop relies on: a DROPPABLE key with no SI mapping
        # would silently fall back to dropping the execution row alone.
        for key in DROPPABLE:
            si = next((s for s, keys in SI_EXECUTION.items() if key in keys), None)
            self.assertIsNotNone(si, "%s has no SI mapping" % key)
            self.assertTrue(ACCEPTANCE.get(si), "%s (%s) has no acceptance row"
                            % (key, si))

    def test_missing_si_mapping_fails_closed(self):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 52, "name": "Sprint 9", "state": "active"}]

        with patch.dict("sprint9_board.SI_EXECUTION", {"S5": []}, clear=True):
            rc = cmd_drop(
                jira, Mock(key="KAN-209", rationale="timeboxed out under D6"))

        self.assertEqual(rc, 1)
        jira.comment.assert_not_called()
        jira.call.assert_not_called()

    def test_missing_acceptance_mapping_fails_closed(self):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 52, "name": "Sprint 9", "state": "active"}]

        with patch.dict("sprint9_board.ACCEPTANCE", {"S5": None}, clear=False):
            rc = cmd_drop(
                jira, Mock(key="KAN-209", rationale="timeboxed out under D6"))

        self.assertEqual(rc, 1)
        jira.comment.assert_not_called()
        jira.call.assert_not_called()

    def test_partial_comment_failure_does_not_remove_either_row(self):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 52, "name": "Sprint 9", "state": "active"}]
        jira.comment.side_effect = [None, RuntimeError("comment API failed")]

        with self.assertRaisesRegex(RuntimeError, "comment API failed"):
            cmd_drop(jira, Mock(key="KAN-209", rationale="timeboxed out under D6"))

        jira.call.assert_not_called()

    def test_backlog_failure_is_one_failed_batch_not_two_removals(self):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 52, "name": "Sprint 9", "state": "active"}]
        jira.call.side_effect = RuntimeError("backlog API failed")

        with self.assertRaisesRegex(RuntimeError, "backlog API failed"):
            cmd_drop(jira, Mock(key="KAN-176", rationale="timeboxed out under D6"))

        self.assertEqual(jira.call.call_count, 1)
        self.assertEqual(
            jira.call.call_args.args[2]["issues"], ["KAN-176", "RCP-91"])


class HardGateDropIntegrityTests(unittest.TestCase):
    def _members(self):
        return (
            set(hard_gate.REQUIRED)
            | set(hard_gate.DROPPABLE)
            | {row for row in hard_gate.ACCEPTANCE.values() if row}
        )

    def _run_gate(self, members):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 52, "name": "Sprint 9", "state": "active"}]
        jira.sprint_issues.return_value = [
            {"key": key} for key in sorted(members)]
        jira.board_sprint_issues.return_value = [
            {"key": row} for row in sorted(
                set(hard_gate.ACCEPTANCE.values()) & set(members))]
        jira.issue.return_value = {
            "fields": {
                "summary": "test",
                "status": {
                    "name": "In Progress",
                    "statusCategory": {
                        "key": "indeterminate",
                        "name": "In Progress",
                    },
                },
            },
        }

        output = io.StringIO()
        with (
            patch("sprint9_hard_gate.Jira", return_value=jira),
            patch.object(sys, "argv", ["sprint9_hard_gate.py"]),
            contextlib.redirect_stdout(output),
        ):
            rc = hard_gate.main()
        return rc, output.getvalue()

    def test_stranded_acceptance_row_fails_the_gate(self):
        members = self._members()
        members.remove("KAN-209")

        rc, output = self._run_gate(members)

        self.assertEqual(rc, 1)
        self.assertIn("RCP-95 remains in the sprint/board", output)

    def test_fully_removed_droppable_si_passes_drop_integrity(self):
        members = self._members()
        members.remove("KAN-209")
        members.remove("RCP-95")

        rc, output = self._run_gate(members)

        self.assertEqual(rc, 0, output)
        self.assertIn("S5", output)
        self.assertIn("dropped", output)


if __name__ == "__main__":
    unittest.main()
