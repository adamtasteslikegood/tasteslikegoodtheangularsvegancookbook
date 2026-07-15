"""Tests for the lightweight MCP stdio driver used by the run-pm-daemon skill."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DRIVER_PATH = _REPO_ROOT / ".claude/skills/run-pm-daemon/driver.py"
_SPEC = importlib.util.spec_from_file_location("run_pm_daemon_driver", _DRIVER_PATH)
assert _SPEC and _SPEC.loader
driver = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(driver)


class TestDriverHelpers(unittest.TestCase):
    def test_find_repo_root_locates_project_markers(self):
        self.assertEqual(driver.find_repo_root(), _REPO_ROOT)

    def test_text_of_extracts_fastmcp_text_blocks(self):
        result = {
            "content": [
                {"type": "text", "text": "first"},
                {"type": "image", "data": "ignored"},
                {"type": "text", "text": "second"},
            ]
        }
        self.assertEqual(driver.text_of(result), "first\nsecond")

    def test_text_of_ignores_non_content_results(self):
        self.assertEqual(driver.text_of({"value": 3}), "")


class TestDaemonProtocol(unittest.TestCase):
    def make_daemon(self):
        daemon = driver.Daemon.__new__(driver.Daemon)
        daemon._id = 0
        daemon._send = Mock()
        daemon._read_response = Mock(return_value={"ok": True})
        return daemon

    def test_request_sends_incrementing_json_rpc_id(self):
        daemon = self.make_daemon()

        result = daemon.request("tools/list", {"cursor": "next"})

        self.assertEqual(result, {"ok": True})
        daemon._send.assert_called_once_with(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {"cursor": "next"},
            }
        )
        daemon._read_response.assert_called_once_with(1)
        self.assertEqual(daemon._id, 1)

    def test_read_response_skips_notifications(self):
        daemon = driver.Daemon.__new__(driver.Daemon)
        daemon.timeout = 1
        stdout = Mock()
        stdout.readline.side_effect = [
            json.dumps({"jsonrpc": "2.0", "method": "notifications/progress"}) + "\n",
            json.dumps({"jsonrpc": "2.0", "id": 4, "result": {"done": True}}) + "\n",
        ]
        daemon.proc = Mock(stdout=stdout)

        with patch.object(driver.select, "select", return_value=([stdout], [], [])):
            result = daemon._read_response(4)

        self.assertEqual(result, {"done": True})

    def test_read_response_reports_json_rpc_error(self):
        daemon = driver.Daemon.__new__(driver.Daemon)
        daemon.timeout = 1
        stdout = Mock()
        stdout.readline.return_value = (
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 4,
                    "error": {"code": -32601, "message": "missing"},
                }
            )
            + "\n"
        )
        daemon.proc = Mock(stdout=stdout)
        daemon.close = Mock()

        with (
            patch.object(driver.select, "select", return_value=([stdout], [], [])),
            self.assertRaisesRegex(SystemExit, "missing"),
        ):
            daemon._read_response(4)

        daemon.close.assert_called_once_with()

    def test_read_response_reports_daemon_stderr_on_eof(self):
        daemon = driver.Daemon.__new__(driver.Daemon)
        daemon.timeout = 1
        stdout = Mock()
        stdout.readline.return_value = ""
        daemon.proc = Mock(stdout=stdout)
        daemon.close = Mock()

        with (
            patch.object(driver.select, "select", return_value=([stdout], [], [])),
            self.assertRaisesRegex(SystemExit, "daemon closed stdout"),
        ):
            daemon._read_response(1)

        daemon.close.assert_called_once_with()

    def test_close_closes_stdin_and_waits_for_daemon(self):
        proc = Mock()
        daemon = driver.Daemon.__new__(driver.Daemon)
        daemon.proc = proc

        daemon.close()

        proc.stdin.close.assert_called_once_with()
        proc.wait.assert_called_once_with(timeout=10)
        proc.kill.assert_not_called()

    def test_close_kills_daemon_that_does_not_terminate(self):
        proc = Mock()
        proc.wait.side_effect = subprocess.TimeoutExpired("pm-daemon", 10)
        daemon = driver.Daemon.__new__(driver.Daemon)
        daemon.proc = proc

        daemon.close()

        proc.kill.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
