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
        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                map_file.write_text(
                    '{"kan_charter":"KAN-436","rcp_charter":"RCP-175","minted_rcp":{"S16":"RCP-185"},"dropped_sis":["S16"]}'
                )
                hard_gate.apply_rcp_map(map_file)
                self.assertIn("S16", hard_gate.DROPPABLE_SIS)
                self.assertEqual(hard_gate.SI_EXECUTION["S16"], ["KAN-425"])
                self.assertEqual(hard_gate.ACCEPTANCE["S16"], "RCP-185")
                self.assertNotIn("KAN-425", hard_gate.REQUIRED)
                self.assertIn("KAN-425", hard_gate.DROPPABLE)
                self.assertIn("RCP-185", hard_gate.DROPPABLE)
        finally:
            hard_gate.reset_state()

    def test_dropped_si_retains_mapping_removes_both_rows_on_rerun_and_fails_charter_if_stranded(self):
        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                map_file.write_text(
                    '{"charter_kan":"KAN-436","acceptance":{"charter":"RCP-175","S16":"RCP-916"},"dropped_sis":["S16"]}'
                )
                hard_gate.apply_rcp_map(map_file)

                # 1. Charter gate MUST fail if KAN-425 and/or RCP-916 remain in Sprint 12 / board 168.
                active_members = (
                    set(hard_gate.REQUIRED)
                    | {
                        hard_gate.ACCEPTANCE[si]
                        for si in hard_gate.SI_EXECUTION
                        if si not in hard_gate.DROPPABLE_SIS
                    }
                )
                stranded_members = active_members | {"KAN-425", "RCP-916"}
                stranded_rendered = (
                    set(hard_gate.ACCEPTANCE.values()) & stranded_members
                )
                with patch.object(hard_gate, "RCP_MAP_PATH", map_file):
                    rc, output = self._run_gate(
                        stranded_members,
                        charter=True,
                        rendered=stranded_rendered,
                    )
                self.assertEqual(rc, 1, output)
                self.assertIn("S16 is dropped via spillover swap", output)
                self.assertIn("KAN-425/RCP-916", output)

                # 2. Charter gate passes once both KAN-425 and RCP-916 are removed from Sprint 12 / board 168.
                clean_rendered = {
                    hard_gate.ACCEPTANCE[si]
                    for si in hard_gate.SI_EXECUTION
                    if si not in hard_gate.DROPPABLE_SIS
                }
                with patch.object(hard_gate, "RCP_MAP_PATH", map_file):
                    rc_clean, out_clean = self._run_gate(
                        active_members,
                        charter=True,
                        rendered=clean_rendered,
                    )
                self.assertEqual(rc_clean, 0, out_clean)

                # 3. A rerun of bootstrap_charter moves both KAN-425 and RCP-916 to backlog.
                jira = Mock()
                jira.sprints.return_value = [
                    {"id": 121, "name": "Sprint 11", "state": "closed"},
                    {"id": 122, "name": "Sprint 12", "state": "active"},
                ]
                jira.sprint_issues.return_value = [
                    {"key": "KAN-425"},
                    {"key": "RCP-916"},
                    {"key": "KAN-356"},
                ]
                seq = {"rcp": 200}

                def fake_call(method, path, body=None):
                    if method == "POST" and path == "/rest/api/3/issue":
                        k = "RCP-%d" % seq["rcp"]
                        seq["rcp"] += 1
                        return {"key": k}
                    return {}

                jira.call.side_effect = fake_call
                with contextlib.redirect_stdout(io.StringIO()):
                    rc_boot = hard_gate.bootstrap_charter(jira, map_path=map_file)
                self.assertEqual(rc_boot, 0)
                jira.call.assert_any_call(
                    "POST",
                    "/rest/agile/1.0/backlog/issue",
                    {"issues": ["KAN-425", "RCP-916"]},
                )
        finally:
            hard_gate.reset_state()

    def test_bootstrap_charter_checkpoints_before_linking_and_reconciles_links_on_retry(self):
        import json as _json

        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                jira1 = Mock()
                jira1.sprints.return_value = [
                    {"id": 121, "name": "Sprint 11", "state": "closed"},
                    {"id": 122, "name": "Sprint 12", "state": "future"},
                ]
                jira1.sprint_issues.return_value = []
                seq = {"kan": 436, "rcp": 900}
                created_summaries = []

                def call_fail_on_s10_link(method, path, body=None):
                    if method == "POST" and path == "/rest/api/3/issue":
                        proj = body["fields"]["project"]["key"]
                        if proj == "KAN":
                            k = "KAN-%d" % seq["kan"]
                            seq["kan"] += 1
                            return {"key": k}
                        k = "RCP-%d" % seq["rcp"]
                        seq["rcp"] += 1
                        created_summaries.append((k, body["fields"]["summary"]))
                        return {"key": k}
                    if method == "POST" and path == "/rest/api/3/issueLink":
                        if body["inwardIssue"]["key"] == "KAN-421":
                            raise RuntimeError("transient link failure on S10")
                    return {}

                jira1.call.side_effect = call_fail_on_s10_link
                with self.assertRaises(RuntimeError):
                    hard_gate.bootstrap_charter(jira1, map_path=map_file)

                # S10's newly created RCP key MUST already be persisted in the checkpoint
                # even though POST /rest/api/3/issueLink raised!
                self.assertTrue(map_file.exists())
                checkpoint1 = _json.loads(map_file.read_text(encoding="utf-8"))
                s10_rcp = checkpoint1["acceptance"].get("S10")
                self.assertIsNotNone(s10_rcp)
                self.assertRegex(s10_rcp, r"^RCP-\d+$")
                self.assertNotIn("S10", checkpoint1.get("linked_sis", []))

                # Simulate a fresh process restart and retry bootstrap_charter.
                hard_gate.reset_state()
                jira2 = Mock()
                jira2.sprints.return_value = [
                    {"id": 121, "name": "Sprint 11", "state": "closed"},
                    {"id": 122, "name": "Sprint 12", "state": "future"},
                ]
                jira2.sprint_issues.return_value = []
                s10_links_on_retry = []

                def call_retry(method, path, body=None):
                    if method == "POST" and path == "/rest/api/3/issue":
                        k = "RCP-%d" % seq["rcp"]
                        seq["rcp"] += 1
                        created_summaries.append((k, body["fields"]["summary"]))
                        return {"key": k}
                    if method == "POST" and path == "/rest/api/3/issueLink":
                        if body["inwardIssue"]["key"] == "KAN-421":
                            s10_links_on_retry.append(body)
                    return {}

                jira2.call.side_effect = call_retry
                with contextlib.redirect_stdout(io.StringIO()):
                    rc2 = hard_gate.bootstrap_charter(jira2, map_path=map_file)
                self.assertEqual(rc2, 0)

                # Verify S10 story was created only ONCE across both runs, and its
                # issueLink was reconciled on the retry.
                s10_creations = [
                    k for k, s in created_summaries if "KAN-421" in s
                ]
                self.assertEqual(s10_creations, [s10_rcp])
                self.assertEqual(len(s10_links_on_retry), 1)
                self.assertEqual(
                    s10_links_on_retry[0]["outwardIssue"]["key"], s10_rcp
                )
                checkpoint2 = _json.loads(map_file.read_text(encoding="utf-8"))
                self.assertIn("S10", checkpoint2.get("linked_sis", []))
        finally:
            hard_gate.reset_state()

    def test_bootstrap_charter_recovers_a_committed_create_whose_response_was_lost(self):
        """Jira commits POST /issue but the client never sees the key (DX-DEC-1).

        The row is not a Sprint 12 member until the bootstrap finishes, so the
        sprint-member index cannot see it. A fresh restart must find it by its
        exact summary in the RCP project under the epic instead of creating a
        second identical Story.
        """
        import json as _json

        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                sprints = [
                    {"id": 121, "name": "Sprint 11", "state": "closed"},
                    {"id": 122, "name": "Sprint 12", "state": "future"},
                ]
                committed = []  # rows Jira holds, whatever the client saw
                seq = {"kan": 436, "rcp": 900}

                def create(body):
                    proj = body["fields"]["project"]["key"]
                    k = "%s-%d" % (proj, seq[proj.lower()])
                    seq[proj.lower()] += 1
                    committed.append((k, body["fields"]["summary"]))
                    return k

                def search(body):
                    return {
                        "issues": [
                            {"key": k, "fields": {"summary": s}}
                            for k, s in committed
                            if s in body["jql"]
                        ]
                    }

                jira1 = Mock()
                jira1.sprints.return_value = sprints
                jira1.sprint_issues.return_value = []

                def call_lose_s10_response(method, path, body=None):
                    if method == "POST" and path == "/rest/api/3/search/jql":
                        return search(body)
                    if method == "POST" and path == "/rest/api/3/issue":
                        key = create(body)
                        if "KAN-421" in body["fields"]["summary"]:
                            raise RuntimeError("connection dropped after create")
                        return {"key": key}
                    return {}

                jira1.call.side_effect = call_lose_s10_response
                with self.assertRaises(RuntimeError):
                    hard_gate.bootstrap_charter(jira1, map_path=map_file)
                checkpoint1 = _json.loads(map_file.read_text(encoding="utf-8"))
                self.assertNotIn("S10", checkpoint1["acceptance"])
                self.assertEqual(checkpoint1["create_intent"]["si"], "S10")
                self.assertEqual(checkpoint1["create_intent"]["project"], "RCP")
                s10_key = [k for k, s in committed if "KAN-421" in s][0]

                hard_gate.reset_state()
                jira2 = Mock()
                jira2.sprints.return_value = sprints
                jira2.sprint_issues.return_value = []

                def call_retry(method, path, body=None):
                    if method == "POST" and path == "/rest/api/3/search/jql":
                        return search(body)
                    if method == "POST" and path == "/rest/api/3/issue":
                        return {"key": create(body)}
                    return {}

                jira2.call.side_effect = call_retry
                with contextlib.redirect_stdout(io.StringIO()):
                    rc2 = hard_gate.bootstrap_charter(jira2, map_path=map_file)
                self.assertEqual(rc2, 0)

                s10_rows = [k for k, s in committed if "KAN-421" in s]
                self.assertEqual(s10_rows, [s10_key])
                checkpoint2 = _json.loads(map_file.read_text(encoding="utf-8"))
                self.assertEqual(checkpoint2["acceptance"]["S10"], s10_key)
                self.assertIn("S10", checkpoint2.get("linked_sis", []))
                self.assertNotIn("create_intent", checkpoint2)
                # The charter KAN row is looked up project-wide the same way.
                kan_rows = [k for k, s in committed if s.startswith("Charter Sprint 12")]
                self.assertEqual(len(kan_rows), 1)
                self.assertEqual(checkpoint2["charter_kan"], kan_rows[0])
        finally:
            hard_gate.reset_state()

    def _lose_s10_create_response(self, map_file, committed, seq, lag):
        """Run one bootstrap whose S10 create commits in Jira but whose response is lost.

        ``lag['empty_polls']`` is how many searches for the S10 summary should
        come back empty before the committed row appears; it is 0 during this
        first run and set by the caller before the restart.
        """
        sprints = [
            {"id": 121, "name": "Sprint 11", "state": "closed"},
            {"id": 122, "name": "Sprint 12", "state": "future"},
        ]

        def create(body):
            proj = body["fields"]["project"]["key"]
            k = "%s-%d" % (proj, seq[proj.lower()])
            seq[proj.lower()] += 1
            committed.append((k, body["fields"]["summary"]))
            return k

        def search(body):
            if "KAN-421" in body["jql"] and lag["empty_polls"] > 0:
                lag["empty_polls"] -= 1
                return {"issues": []}  # index not caught up yet
            return {
                "issues": [
                    {"key": k, "fields": {"summary": s}}
                    for k, s in committed
                    if s in body["jql"]
                ]
            }

        jira1 = Mock()
        jira1.sprints.return_value = sprints
        jira1.sprint_issues.return_value = []

        def call_lose_s10_response(method, path, body=None):
            if method == "POST" and path == "/rest/api/3/search/jql":
                return search(body)
            if method == "POST" and path == "/rest/api/3/issue":
                key = create(body)
                if "KAN-421" in body["fields"]["summary"]:
                    raise RuntimeError("connection dropped after create")
                return {"key": key}
            return {}

        jira1.call.side_effect = call_lose_s10_response
        with self.assertRaises(RuntimeError):
            hard_gate.bootstrap_charter(jira1, map_path=map_file)

        hard_gate.reset_state()
        jira2 = Mock()
        jira2.sprints.return_value = sprints
        jira2.sprint_issues.return_value = []
        creates = []

        def call_retry(method, path, body=None):
            if method == "POST" and path == "/rest/api/3/search/jql":
                return search(body)
            if method == "POST" and path == "/rest/api/3/issue":
                creates.append(body["fields"]["summary"])
                return {"key": create(body)}
            return {}

        jira2.call.side_effect = call_retry
        return jira2, creates

    def test_bootstrap_charter_waits_for_the_search_index_before_trusting_an_empty_result(self):
        """/rest/api/3/search/jql is eventually consistent.

        A restart after a lost create response can get ``issues: []`` for a row
        Jira has already committed. The bootstrap must poll with bounded
        backoff and recover the row, not treat the first empty result as proof
        the create failed and mint a duplicate.
        """
        import json as _json

        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                committed, seq, lag = [], {"kan": 436, "rcp": 900}, {"empty_polls": 0}
                jira2, creates = self._lose_s10_create_response(
                    map_file, committed, seq, lag
                )
                s10_key = [k for k, s in committed if "KAN-421" in s][0]
                lag["empty_polls"] = 3  # three stale reads before the index catches up

                sleep = Mock()
                with patch.object(hard_gate, "_sleep", sleep), contextlib.redirect_stdout(
                    io.StringIO()
                ):
                    rc2 = hard_gate.bootstrap_charter(jira2, map_path=map_file)
                self.assertEqual(rc2, 0)

                self.assertEqual([c.args[0] for c in sleep.call_args_list], [1, 2, 4])
                self.assertEqual([k for k, s in committed if "KAN-421" in s], [s10_key])
                self.assertFalse([s for s in creates if "KAN-421" in s])
                checkpoint2 = _json.loads(map_file.read_text(encoding="utf-8"))
                self.assertEqual(checkpoint2["acceptance"]["S10"], s10_key)
                self.assertIn("S10", checkpoint2.get("linked_sis", []))
                self.assertNotIn("create_intent", checkpoint2)
        finally:
            hard_gate.reset_state()

    def test_bootstrap_charter_fails_closed_while_a_lost_create_is_still_unresolved(self):
        """If the committed row never surfaces within the poll budget, refuse to create again.

        An empty search is not proof the create failed, so the restart exits
        1 with a DX error, keeps the intent on disk, and mutates nothing.
        """
        import json as _json

        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                committed, seq, lag = [], {"kan": 436, "rcp": 900}, {"empty_polls": 0}
                jira2, creates = self._lose_s10_create_response(
                    map_file, committed, seq, lag
                )
                s10_key = [k for k, s in committed if "KAN-421" in s][0]
                lag["empty_polls"] = 10**6  # the index never catches up

                sleep = Mock()
                err = io.StringIO()
                with patch.object(hard_gate, "_sleep", sleep), contextlib.redirect_stdout(
                    io.StringIO()
                ), contextlib.redirect_stderr(err):
                    rc2 = hard_gate.bootstrap_charter(jira2, map_path=map_file)
                self.assertEqual(rc2, 1)

                self.assertEqual(
                    [c.args[0] for c in sleep.call_args_list],
                    list(hard_gate.CREATE_INTENT_POLL_DELAYS),
                )
                self.assertEqual(creates, [])
                self.assertEqual([k for k, s in committed if "KAN-421" in s], [s10_key])
                jira2.add_to_sprint.assert_not_called()
                jira2.start_sprint.assert_not_called()
                self.assertIn("create still in flight", err.getvalue())
                checkpoint2 = _json.loads(map_file.read_text(encoding="utf-8"))
                self.assertEqual(checkpoint2["create_intent"]["si"], "S10")
                self.assertNotIn("S10", checkpoint2["acceptance"])
        finally:
            hard_gate.reset_state()

    def test_day1_cutover_with_applied_spillover_swap_persists_adds_and_gates_carried_in_work(self):
        import json as _json

        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                jira = Mock()
                jira.sprints.return_value = [
                    {"id": 121, "name": "Sprint 11", "state": "closed"},
                    {"id": 122, "name": "Sprint 12", "state": "future"},
                ]
                jira.sprint_issues.side_effect = lambda sid: (
                    [
                        {
                            "key": "KAN-306",
                            "fields": {
                                "summary": "Carried Sprint 11 bug",
                                "status": {
                                    "name": "In Progress",
                                    "statusCategory": {"key": "indeterminate"},
                                },
                            },
                        }
                    ]
                    if sid == 121
                    else [{"key": "KAN-425"}, {"key": "KAN-356"}]
                )
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
                with contextlib.redirect_stdout(out):
                    rc = hard_gate.run_day1_cutover(
                        jira,
                        dry_run=False,
                        apply_spillover_swaps=True,
                        map_path=map_file,
                    )
                self.assertEqual(rc, 0, out.getvalue())

                # 1. Verify KAN-306 is required in the gate and KAN-425 is dropped.
                self.assertIn("KAN-306", hard_gate.REQUIRED)
                self.assertNotIn("KAN-425", hard_gate.REQUIRED)
                self.assertIn("KAN-425", hard_gate.DROPPABLE)
                self.assertIn("CARRY-KAN-306", hard_gate.SI_EXECUTION)
                carry_rcp = hard_gate.ACCEPTANCE["CARRY-KAN-306"]
                self.assertRegex(carry_rcp, r"^RCP-\d+$")

                # 2. Verify both KAN-306 and its minted RCP acceptance row were added to Sprint 12,
                #    while KAN-425 was moved to backlog and excluded from add_to_sprint.
                jira.call.assert_any_call(
                    "POST",
                    "/rest/agile/1.0/backlog/issue",
                    {"issues": ["KAN-425"]},
                )
                added_keys = set(jira.add_to_sprint.call_args[0][1])
                self.assertIn("KAN-306", added_keys)
                self.assertIn(carry_rcp, added_keys)
                self.assertNotIn("KAN-425", added_keys)

                # 3. Verify the persisted map contains the full swap mapping + acceptance_rcp.
                saved = _json.loads(map_file.read_text(encoding="utf-8"))
                self.assertEqual(saved["dropped_sis"], ["S16"])
                self.assertEqual(len(saved["swaps"]), 1)
                self.assertEqual(saved["swaps"][0]["carried_in"], "KAN-306")
                self.assertEqual(saved["swaps"][0]["deferred_si"], "S16")
                self.assertEqual(saved["swaps"][0]["deferred_kan"], "KAN-425")
                self.assertEqual(saved["swaps"][0]["acceptance_rcp"], carry_rcp)

                # 4. Verify the charter gate requires KAN-306 and its acceptance row on board 168.
                active_members = added_keys
                rendered = {
                    hard_gate.ACCEPTANCE[si]
                    for si in hard_gate.SI_EXECUTION
                    if si not in hard_gate.DROPPABLE_SIS
                }
                with patch.object(hard_gate, "RCP_MAP_PATH", map_file):
                    rc_pass, out_pass = self._run_gate(
                        active_members, charter=True, rendered=rendered
                    )
                    self.assertEqual(rc_pass, 0, out_pass)

                    rc_missing_kan, out_missing_kan = self._run_gate(
                        active_members - {"KAN-306"},
                        charter=True,
                        rendered=rendered,
                    )
                    self.assertEqual(rc_missing_kan, 1)
                    self.assertIn("KAN-306 is not in Sprint 12", out_missing_kan)

                    rc_missing_rcp, out_missing_rcp = self._run_gate(
                        active_members,
                        charter=True,
                        rendered=rendered - {carry_rcp},
                    )
                    self.assertEqual(rc_missing_rcp, 1)
                    self.assertIn(
                        f"{carry_rcp} is not rendered by board 168",
                        out_missing_rcp,
                    )
        finally:
            hard_gate.reset_state()

    def test_print_dx_error_docs_anchor_exists_in_the_sprint_12_plan(self):
        # The DOCS line of every diagnostic must land on a real heading.
        import inspect
        import re as _re

        docs = inspect.signature(hard_gate.print_dx_error).parameters["docs"].default
        rel_path, _, fragment = docs.partition("#")
        plan = (Path(hard_gate.__file__).resolve().parents[2] / rel_path).read_text(
            encoding="utf-8"
        )
        slugs = set()
        for line in plan.splitlines():
            if line.startswith("#"):
                heading = line.lstrip("#").strip().lower()
                slugs.add(_re.sub(r"[^\w\- ]", "", heading).replace(" ", "-"))
        self.assertIn(fragment, slugs)

    def test_check_spillover_overload_says_apply_swaps_was_skipped(self):
        # --apply-spillover-swaps persists nothing on overload; the operator
        # must be told, not left to discover an empty map on the next run.
        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                jira = Mock()
                jira.sprint_issues.return_value = [
                    {
                        "key": "KAN-%d" % n,
                        "fields": {
                            "summary": "open %d" % n,
                            "status": {
                                "name": "In Progress",
                                "statusCategory": {"key": "indeterminate"},
                            },
                        },
                    }
                    for n in (301, 302, 303, 304)
                ]
                err = io.StringIO()
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                    rc = hard_gate.check_spillover(jira, apply_swaps=True, map_path=map_file)
                self.assertEqual(rc, 1)
                self.assertFalse(map_file.exists())
                self.assertIn(
                    "--apply-spillover-swaps was requested but nothing was persisted",
                    err.getvalue(),
                )
                # A dry run never persists, so it does not raise the alarm.
                err_dry = io.StringIO()
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(
                    err_dry
                ):
                    hard_gate.check_spillover(
                        jira, apply_swaps=True, map_path=map_file, dry_run=True
                    )
                self.assertNotIn("nothing was persisted", err_dry.getvalue())
        finally:
            hard_gate.reset_state()

    def test_bootstrap_charter_skips_the_relates_link_a_carried_in_row_already_has(self):
        # A carried-in swap's acceptance row pre-dates this run and is usually
        # linked to its KAN already; posting the link again duplicates it.
        import json as _json

        try:
            with tempfile.TemporaryDirectory() as tmp:
                map_file = Path(tmp) / "sprint12_rcp_map.json"
                map_file.write_text(
                    _json.dumps(
                        {
                            "dropped_sis": ["S16"],
                            "swaps": [
                                {
                                    "si": "CARRY-KAN-306",
                                    "carried_in": "KAN-306",
                                    "carried_summary": "Carried Sprint 11 bug",
                                    "acceptance_rcp": "RCP-499",
                                    "deferred_si": "S16",
                                    "deferred_kan": "KAN-425",
                                }
                            ],
                        }
                    ),
                    encoding="utf-8",
                )
                jira = Mock()
                jira.sprints.return_value = [
                    {"id": 121, "name": "Sprint 11", "state": "closed"},
                    {"id": 122, "name": "Sprint 12", "state": "future"},
                ]
                jira.sprint_issues.return_value = []
                seq = {"kan": 436, "rcp": 900}
                links = []

                def fake_call(method, path, body=None):
                    if method == "GET" and path == "/rest/api/3/issue/RCP-499?fields=issuelinks":
                        return {
                            "fields": {
                                "issuelinks": [
                                    {
                                        "type": {"name": "Relates"},
                                        "inwardIssue": {"key": "KAN-306"},
                                    }
                                ]
                            }
                        }
                    if method == "POST" and path == "/rest/api/3/issue":
                        proj = body["fields"]["project"]["key"]
                        k = "%s-%d" % (proj, seq[proj.lower()])
                        seq[proj.lower()] += 1
                        return {"key": k}
                    if method == "POST" and path == "/rest/api/3/issueLink":
                        links.append((body["inwardIssue"]["key"], body["outwardIssue"]["key"]))
                    return {}

                jira.call.side_effect = fake_call
                with contextlib.redirect_stdout(io.StringIO()):
                    rc = hard_gate.bootstrap_charter(jira, map_path=map_file)
                self.assertEqual(rc, 0)
                self.assertNotIn(("KAN-306", "RCP-499"), links)
                # Rows minted in this run are still linked.
                self.assertIn("KAN-421", [k for k, _ in links])
                saved = _json.loads(map_file.read_text(encoding="utf-8"))
                self.assertIn("CARRY-KAN-306", saved.get("linked_sis", []))
        finally:
            hard_gate.reset_state()

    def test_write_rcp_map_checkpoint_preserves_override_spillover_reason(self):
        # check_spillover persists override_spillover_reason as an audit record.
        # A later bootstrap_charter checkpoint must not overwrite the file in a
        # way that erases that reason before the sprint even starts.
        with tempfile.TemporaryDirectory() as tmp:
            map_file = Path(tmp) / "sprint12_rcp_map.json"
            map_file.write_text(
                '{"dropped_sis":["S16"],"override_spillover_reason":'
                '"Sprint 11 crunch, approved by Adam 2026-10-21"}'
            )
            hard_gate._write_rcp_map_checkpoint(
                map_file,
                charter_kan="KAN-436",
                minted_acceptance={"S10": "RCP-179"},
                dropped_sis={"S16"},
            )
            import json as _json
            payload = _json.loads(map_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["charter_kan"], "KAN-436")
            self.assertEqual(payload["acceptance"], {"S10": "RCP-179"})
            self.assertEqual(payload["dropped_sis"], ["S16"])
            self.assertEqual(
                payload["override_spillover_reason"],
                "Sprint 11 crunch, approved by Adam 2026-10-21",
            )

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
