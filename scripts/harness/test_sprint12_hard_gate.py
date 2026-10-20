"""Tests for the Sprint 12 hard gate, including ``--charter`` and ``--bootstrap-charter``."""

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprint12_hard_gate as hard_gate  # noqa: E402


class Sprint12HardGateTests(unittest.TestCase):
    def _members(self):
        return set(hard_gate.GATED) | set(hard_gate.ACCEPTANCE.values())

    def _row_fields(self, key):
        """Board fields for a row: a conforming acceptance Story when it is one."""
        for si, row in hard_gate.ACCEPTANCE.items():
            if row == key:
                return {
                    "issuetype": {"name": "Story"},
                    "summary": "S12 acceptance: test (%s)"
                    % ", ".join(hard_gate.SI_EXECUTION[si]),
                }
        return {"issuetype": {"name": "Story"}, "summary": "test"}

    def _run_gate(
        self,
        members,
        state="active",
        charter=False,
        rendered=None,
        todo_keys=None,
        issues=None,
        row_fields=None,
    ):
        members = set(members)
        todo_keys = members if todo_keys is None else set(todo_keys)
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 122, "name": "Sprint 12", "state": state}
        ]
        jira.sprint_issues.return_value = [{"key": k} for k in sorted(members)]
        if rendered is None:
            rendered = set(hard_gate.ACCEPTANCE.values()) & members
        row_fields = row_fields or {}
        jira.board_sprint_issues.return_value = [
            {"key": k, "fields": row_fields.get(k, self._row_fields(k))}
            for k in sorted(rendered)
        ]

        def issue(key, fields):
            todo = key in todo_keys
            return {
                "fields": {
                    "summary": "test",
                    "status": {
                        "name": "To Do" if todo else "In Progress",
                        "statusCategory": {
                            "key": "new" if todo else "indeterminate"
                        },
                    },
                }
            }

        jira.issue.side_effect = issue
        argv = ["sprint12_hard_gate.py"]
        if charter:
            argv.append("--charter")
        elif issues is not None:
            argv.extend(["--issues", *issues])
        output = io.StringIO()
        with (
            patch("sprint12_hard_gate.Jira", return_value=jira),
            patch.object(sys, "argv", argv),
            contextlib.redirect_stdout(output),
        ):
            rc = hard_gate.main()
        return rc, output.getvalue()

    def test_every_si_has_an_acceptance_row_and_no_drops(self):
        self.assertEqual(set(hard_gate.SI_EXECUTION), set(hard_gate.ACCEPTANCE))
        self.assertTrue(all(hard_gate.ACCEPTANCE.values()))
        self.assertEqual(
            len(set(hard_gate.ACCEPTANCE.values())), len(hard_gate.ACCEPTANCE)
        )
        self.assertEqual(hard_gate.DROPPABLE, {})

    def test_every_execution_row_is_required(self):
        executed = {k for rows in hard_gate.SI_EXECUTION.values() for k in rows}
        self.assertEqual(executed | {"RCP-119"}, set(hard_gate.REQUIRED))

    def test_charter_and_scoped_modes_are_mutually_exclusive(self):
        argv = ["sprint12_hard_gate.py", "--charter", "--issues", "KAN-356"]
        with (
            patch.object(sys, "argv", argv),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as raised,
        ):
            hard_gate.main()
        self.assertEqual(raised.exception.code, 2)

    def test_scoped_success_is_not_labeled_as_the_full_gate(self):
        rc, output = self._run_gate((), issues=("KAN-356",), todo_keys=())
        self.assertEqual(rc, 0, output)
        self.assertIn("SCOPED CHECK PASSED", output)
        self.assertNotIn("HARD GATE PASSED", output)

    def test_charter_passes_on_day_one_with_everything_in_todo(self):
        rc, output = self._run_gate(self._members(), charter=True)
        self.assertEqual(rc, 0, output)

    def test_full_gate_fails_on_day_one_because_everything_is_todo(self):
        rc, output = self._run_gate(self._members())
        self.assertEqual(rc, 1)
        self.assertIn("KAN-356 is in To Do", output)

    def test_full_gate_passes_when_nothing_is_in_todo(self):
        rc, output = self._run_gate(self._members(), state="closed", todo_keys=())
        self.assertEqual(rc, 0, output)

    def test_missing_sprint_is_a_failure_not_a_vacuous_pass(self):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 121, "name": "Sprint 11", "state": "closed"}
        ]
        output = io.StringIO()
        with (
            patch("sprint12_hard_gate.Jira", return_value=jira),
            patch.object(sys, "argv", ["sprint12_hard_gate.py", "--charter"]),
            contextlib.redirect_stdout(output),
        ):
            rc = hard_gate.main()
        self.assertEqual(rc, 1)
        self.assertIn("Sprint 12 does not exist", output.getvalue())

    def test_charter_refuses_a_sprint_that_is_not_started(self):
        rc, output = self._run_gate(
            self._members(), state="future", charter=True
        )
        self.assertEqual(rc, 1)
        self.assertIn("expected active", output)

    def test_charter_refuses_a_closed_sprint(self):
        rc, _ = self._run_gate(self._members(), state="closed", charter=True)
        self.assertEqual(rc, 1)

    def test_charter_fails_when_a_required_item_left_the_sprint(self):
        for key in (
            "KAN-356",
            "KAN-411",
            "KAN-434",
            "KAN-290",
            "KAN-425",
            "KAN-277",
        ):
            with self.subTest(key=key):
                rc, output = self._run_gate(
                    self._members() - {key}, charter=True
                )
                self.assertEqual(rc, 1)
                self.assertIn("%s is not in Sprint 12" % key, output)

    def test_charter_fails_when_an_acceptance_row_is_not_rendered(self):
        for row in ("RCP-150", "RCP-138", "RCP-109", "RCP-S12-CHARTER"):
            with self.subTest(row=row):
                rendered = set(hard_gate.ACCEPTANCE.values()) - {row}
                rc, output = self._run_gate(
                    self._members(), charter=True, rendered=rendered
                )
                self.assertEqual(rc, 1)
                self.assertIn("%s is not rendered by board 168" % row, output)

    def test_charter_fails_when_the_rendered_row_is_not_the_acceptance_story(self):
        story = {"name": "Story"}
        cases = (
            (
                "RCP-150",
                {
                    "issuetype": {"name": "Epic"},
                    "summary": "S12 acceptance: test (KAN-356)",
                },
                "RCP-150 is type Epic, not a Story",
            ),
            (
                "RCP-150",
                {"issuetype": story, "summary": "Recipe feedback (KAN-356)"},
                "RCP-150 is not titled 'S12 acceptance: ...'",
            ),
            (
                "RCP-150",
                {
                    "issuetype": story,
                    "summary": "S11 acceptance: test (KAN-356)",
                },
                "RCP-150 is not titled 'S12 acceptance: ...'",
            ),
            (
                "RCP-150",
                {
                    "issuetype": story,
                    "summary": "S12 acceptance: test (KAN-3560)",
                },
                "RCP-150 does not name KAN-356 in its summary",
            ),
            (
                "RCP-150",
                {},
                "RCP-150 is of unknown type, not a Story",
            ),
        )
        for row, fields, expected in cases:
            with self.subTest(expected=expected):
                rc, output = self._run_gate(
                    self._members(), charter=True, row_fields={row: fields}
                )
                self.assertEqual(rc, 1)
                self.assertIn(expected, output)

    def test_an_acceptance_row_outside_rcp_is_named(self):
        fields = {
            "issuetype": {"name": "Story"},
            "summary": "S12 acceptance: test (KAN-356)",
        }
        self.assertEqual(
            hard_gate.acceptance_row_problems("S1", "KAN-999", fields),
            ["is not in project RCP"],
        )
        self.assertEqual(
            hard_gate.acceptance_row_problems("S1", "RCP-150", fields), []
        )

    def test_close_gate_rejects_an_acceptance_row_left_in_todo(self):
        rc, output = self._run_gate(self._members(), todo_keys={"RCP-150"})
        self.assertEqual(rc, 1)
        self.assertIn("RCP-150 is in To Do", output)

    def test_rows_kept_for_later_sprints_or_superseded_are_not_gated(self):
        gated = self._members()
        for key in (
            "KAN-346",
            "RCP-147",
            "KAN-351",
            "RCP-149",
            "RCP-174",
            "KAN-299",
            "RCP-110",
        ):
            with self.subTest(key=key):
                self.assertIn(key, hard_gate.NOT_IN_SPRINT)
                self.assertNotIn(key, gated)

    def test_a_later_sprint_or_superseded_row_in_the_sprint_fails_both_gates(self):
        for key in ("KAN-346", "RCP-147", "KAN-351", "KAN-299"):
            with self.subTest(key=key):
                members = self._members() | {key}
                rc, output = self._run_gate(members, charter=True)
                self.assertEqual(rc, 1)
                self.assertIn("%s (" % key, output)
                self.assertIn("Sprint 12", output)
                rc, _ = self._run_gate(members, state="closed", todo_keys=())
                self.assertEqual(rc, 1)

    def test_bootstrap_charter_refuses_while_sprint_11_is_active(self):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 121, "name": "Sprint 11", "state": "active"},
            {"id": 122, "name": "Sprint 12", "state": "future"},
        ]
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            rc = hard_gate.bootstrap_charter(jira)
        self.assertEqual(rc, 1)
        self.assertIn("Sprint 11 (id 121) is still active", err.getvalue())
        jira.call.assert_not_called()

    def test_bootstrap_charter_removes_superseded_rows_and_mints_rcp_stories(self):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 121, "name": "Sprint 11", "state": "closed"},
            {
                "id": 122,
                "name": "Sprint 12",
                "state": "future",
                "startDate": "2026-10-23T22:00:00.000Z",
                "endDate": "2026-11-06T22:00:00.000Z",
            },
        ]
        jira.sprint_issues.return_value = [
            {"key": "KAN-346"},
            {"key": "RCP-147"},
            {"key": "KAN-356"},
        ]
        seq = {"kan": 436, "rcp": 175}

        def fake_call(method, path, body=None):
            if method == "POST" and path == "/rest/api/3/issue":
                proj = body["fields"]["project"]["key"]
                if proj == "KAN":
                    k = "KAN-%d" % seq["kan"]
                    seq["kan"] += 1
                    return {"key": k}
                k = "RCP-%d" % seq["rcp"]
                seq["rcp"] += 1
                return {"key": k}
            return {}

        jira.call.side_effect = fake_call
        out = io.StringIO()
        orig_required = dict(hard_gate.REQUIRED)
        orig_si_exec = {k: list(v) for k, v in hard_gate.SI_EXECUTION.items()}
        orig_acceptance = dict(hard_gate.ACCEPTANCE)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                with contextlib.redirect_stdout(out):
                    rc = hard_gate.bootstrap_charter(jira, map_path=map_file)
                self.assertEqual(rc, 0, out.getvalue())
                self.assertTrue(map_file.exists())
                jira.call.assert_any_call(
                    "POST",
                    "/rest/agile/1.0/backlog/issue",
                    {"issues": ["KAN-346", "RCP-147"]},
                )
                jira.start_sprint.assert_called_once()
        finally:
            hard_gate.REQUIRED.clear()
            hard_gate.REQUIRED.update(orig_required)
            hard_gate.SI_EXECUTION.clear()
            hard_gate.SI_EXECUTION.update(orig_si_exec)
            hard_gate.ACCEPTANCE.clear()
            hard_gate.ACCEPTANCE.update(orig_acceptance)
            hard_gate._sync_derived_sets()

    def test_s3_summary_interpolates_brand_author_suffix(self):
        self.assertNotIn("{suffix}", hard_gate.SI_SUMMARIES["S3"])
        self.assertIn("classic", hard_gate.SI_SUMMARIES["S3"])

    def test_resolve_issue_aliases_maps_placeholders_to_minted_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            map_file = Path(tmp) / "sprint12_rcp_map.json"
            map_file.write_text(
                '{"kan_charter":"KAN-436","rcp_charter":"RCP-175","minted_rcp":{"S10":"RCP-179"}}'
            )
            resolved = hard_gate.resolve_issue_aliases(
                ["KAN-S12-CHARTER", "RCP-S12-CHARTER", "RCP-S12-S10", "KAN-356"],
                map_path=map_file,
            )
            self.assertEqual(
                resolved, ["KAN-436", "RCP-175", "RCP-179", "KAN-356"]
            )

    def test_apply_rcp_map_moves_dropped_sis_into_droppable(self):
        orig_required = dict(hard_gate.REQUIRED)
        orig_si_exec = {k: list(v) for k, v in hard_gate.SI_EXECUTION.items()}
        orig_acceptance = dict(hard_gate.ACCEPTANCE)
        orig_droppable = dict(hard_gate.DROPPABLE)
        orig_droppable_sis = set(hard_gate.DROPPABLE_SIS)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                map_file.write_text(
                    '{"kan_charter":"KAN-436","rcp_charter":"RCP-175","minted_rcp":{"S16":"RCP-185"},"dropped_sis":["S16"]}'
                )
                hard_gate.apply_rcp_map(map_file)
                self.assertNotIn("S16", hard_gate.SI_EXECUTION)
                self.assertNotIn("S16", hard_gate.ACCEPTANCE)
                self.assertNotIn("KAN-425", hard_gate.REQUIRED)
                self.assertIn("KAN-425", hard_gate.DROPPABLE)
                self.assertIn("RCP-185", hard_gate.DROPPABLE)
        finally:
            hard_gate.REQUIRED.clear()
            hard_gate.REQUIRED.update(orig_required)
            hard_gate.SI_EXECUTION.clear()
            hard_gate.SI_EXECUTION.update(orig_si_exec)
            hard_gate.ACCEPTANCE.clear()
            hard_gate.ACCEPTANCE.update(orig_acceptance)
            hard_gate.DROPPABLE.clear()
            hard_gate.DROPPABLE.update(orig_droppable)
            hard_gate.DROPPABLE_SIS.clear()
            hard_gate.DROPPABLE_SIS.update(orig_droppable_sis)
            hard_gate._sync_derived_sets()

    def test_close_flag_rejects_in_progress_items_and_passes_when_all_done(self):
        members = self._members()
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 122, "name": "Sprint 12", "state": "active"}
        ]
        jira.sprint_issues.return_value = [{"key": k} for k in sorted(members)]
        jira.board_sprint_issues.return_value = [
            {"key": k, "fields": self._row_fields(k)}
            for k in sorted(set(hard_gate.ACCEPTANCE.values()) & members)
        ]

        def in_progress_issue(key, fields):
            return {
                "fields": {
                    "summary": "test",
                    "status": {
                        "name": "In Progress",
                        "statusCategory": {"key": "indeterminate"},
                    },
                }
            }

        jira.issue.side_effect = in_progress_issue
        out = io.StringIO()
        with (
            patch("sprint12_hard_gate.Jira", return_value=jira),
            patch.object(sys, "argv", ["sprint12_hard_gate.py", "--close"]),
            contextlib.redirect_stdout(out),
        ):
            rc = hard_gate.main()
        self.assertEqual(rc, 1)
        self.assertIn("is in In Progress (close/strict gate requires Done)", out.getvalue())

        def done_issue(key, fields):
            return {
                "fields": {
                    "summary": "test",
                    "status": {
                        "name": "Done",
                        "statusCategory": {"key": "done"},
                    },
                }
            }

        jira.issue.side_effect = done_issue
        out_done = io.StringIO()
        with (
            patch("sprint12_hard_gate.Jira", return_value=jira),
            patch.object(sys, "argv", ["sprint12_hard_gate.py", "--close"]),
            contextlib.redirect_stdout(out_done),
        ):
            rc_done = hard_gate.main()
        self.assertEqual(rc_done, 0, out_done.getvalue())
        self.assertIn("HARD GATE PASSED", out_done.getvalue())

    def test_day1_cutover_dry_run_previews_without_mutating_jira(self):
        jira = Mock()
        jira.sprints.return_value = [
            {"id": 121, "name": "Sprint 11", "state": "active"},
            {"id": 122, "name": "Sprint 12", "state": "future"},
        ]
        jira.sprint_issues.side_effect = lambda sid: (
            [
                {
                    "key": "KAN-306",
                    "fields": {
                        "summary": "Carried bug",
                        "status": {
                            "name": "In Progress",
                            "statusCategory": {"key": "indeterminate"},
                        },
                    },
                }
            ]
            if sid == 121
            else [{"key": "KAN-346"}, {"key": "KAN-356"}]
        )
        out = io.StringIO()
        with (
            contextlib.redirect_stdout(out),
            tempfile.TemporaryDirectory() as tmp,
        ):
            rc = hard_gate.run_day1_cutover(
                jira,
                dry_run=True,
                apply_spillover_swaps=True,
                map_path=Path(tmp) / "sprint12_rcp_map.json",
            )
        self.assertEqual(rc, 0, out.getvalue())
        self.assertIn("DRY-RUN ONLY", out.getvalue())
        jira.call.assert_not_called()
        jira.start_sprint.assert_not_called()


if __name__ == "__main__":
    unittest.main()
