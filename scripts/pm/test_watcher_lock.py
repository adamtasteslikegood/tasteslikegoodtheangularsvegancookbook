"""Tests for the PM daemon's single-watcher lock.

The behaviour that matters is cross-PROCESS exclusion: a second daemon must be
denied while a first one is alive, and must take over the moment it dies. flock
is per-open-file-description, so a same-process second acquire can succeed and
would prove nothing — these tests spawn real subprocesses.

Standard library only (unittest), same as test_atlassian_guard.py, so it runs
without the venv: python3 -m unittest discover -s scripts/pm -p 'test_*.py'
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _watcher_lock import (  # noqa: E402
    DISABLE_ENV,
    LOCK_RELPATH,
    acquire_watcher_lock,
    lock_path_for,
    read_lock_holder,
    release_watcher_lock,
    resolve_main_checkout,
    watcher_disabled,
)

_PM_DIR = Path(__file__).resolve().parent

# Holds the lock, announces the pid, then idles until killed.
_HOLDER = textwrap.dedent(
    """
    import sys, time
    sys.path.insert(0, {pm_dir!r})
    from _watcher_lock import acquire_watcher_lock
    h = acquire_watcher_lock({workspace!r})
    print("ACQUIRED" if h else "DENIED", flush=True)
    if not h:
        sys.exit(1)
    time.sleep(120)
    """
)

# Tries once and reports the verdict.
_PROBE = textwrap.dedent(
    """
    import sys
    sys.path.insert(0, {pm_dir!r})
    from _watcher_lock import acquire_watcher_lock
    h = acquire_watcher_lock({workspace!r})
    print("ACQUIRED" if h else "DENIED", flush=True)
    """
)


def _probe(workspace: str, env: dict | None = None) -> str:
    """Run a one-shot acquire in a fresh process; return ACQUIRED or DENIED."""
    out = subprocess.run(
        [sys.executable, "-c", _PROBE.format(pm_dir=str(_PM_DIR), workspace=workspace)],
        capture_output=True,
        text=True,
        timeout=30,
        env={**os.environ, **(env or {})},
    )
    return (out.stdout or "").strip()


class TestWatcherLockExclusion(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.workspace = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def test_first_acquire_succeeds(self):
        handle = acquire_watcher_lock(self.workspace)
        self.addCleanup(release_watcher_lock, handle)
        self.assertIsNotNone(handle, "the first daemon must get the watcher lock")

    def _spawn_holder(self) -> subprocess.Popen:
        """Start a process that takes the lock and holds it until killed."""
        holder = subprocess.Popen(
            [sys.executable, "-c", _HOLDER.format(pm_dir=str(_PM_DIR), workspace=self.workspace)],
            stdout=subprocess.PIPE,
            text=True,
        )

        def _cleanup():
            holder.kill()
            holder.wait(timeout=10)
            if holder.stdout:
                holder.stdout.close()

        self.addCleanup(_cleanup)
        self.assertEqual(holder.stdout.readline().strip(), "ACQUIRED")
        return holder

    def test_second_process_is_denied_while_first_is_alive(self):
        self._spawn_holder()

        # This is the regression under test: 13 daemons, 13 observers.
        self.assertEqual(
            _probe(self.workspace),
            "DENIED",
            "a second daemon must NOT start a competing watcher",
        )

    def test_lock_is_released_when_holder_is_killed(self):
        """No stale-lock recovery path: the kernel frees an flock on death."""
        holder = self._spawn_holder()
        self.assertEqual(_probe(self.workspace), "DENIED")

        holder.kill()  # SIGKILL — the harshest case, no cleanup handler runs
        holder.wait(timeout=10)

        deadline = time.time() + 10
        verdict = "DENIED"
        while time.time() < deadline:
            verdict = _probe(self.workspace)
            if verdict == "ACQUIRED":
                break
            time.sleep(0.2)
        self.assertEqual(verdict, "ACQUIRED", "lock must free itself when the holder is SIGKILLed")

    def test_release_allows_reacquire_in_same_process(self):
        first = acquire_watcher_lock(self.workspace)
        self.assertIsNotNone(first)
        release_watcher_lock(first)

        second = acquire_watcher_lock(self.workspace)
        self.addCleanup(release_watcher_lock, second)
        self.assertIsNotNone(second, "an explicitly released lock must be retakeable")

    def test_release_is_safe_on_none_and_double_call(self):
        release_watcher_lock(None)  # must not raise
        handle = acquire_watcher_lock(self.workspace)
        self.assertIsNotNone(handle)
        release_watcher_lock(handle)
        release_watcher_lock(handle)  # idempotent


class TestWatcherLockDisableSwitch(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.workspace = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()
        os.environ.pop(DISABLE_ENV, None)

    def test_disable_env_prevents_acquisition(self):
        self.assertEqual(_probe(self.workspace, env={DISABLE_ENV: "1"}), "DENIED")

    def test_disable_env_falsey_values_do_not_disable(self):
        for value in ("", "0", "false", "no"):
            os.environ[DISABLE_ENV] = value
            self.assertFalse(watcher_disabled(), f"{value!r} must not disable the watcher")
        for value in ("1", "true", "yes"):
            os.environ[DISABLE_ENV] = value
            self.assertTrue(watcher_disabled(), f"{value!r} must disable the watcher")


class TestLockPathResolution(unittest.TestCase):
    def test_lock_lives_in_main_checkout_not_the_worktree(self):
        """Worktrees share one Confluence space, so they must share one lock.

        A per-worktree lock would elect one watcher per worktree and reintroduce
        the exact race this lock exists to kill.
        """
        repo_root = Path(__file__).resolve().parents[2]
        expected = resolve_main_checkout(repo_root) / LOCK_RELPATH

        # This test file may itself be running from inside a linked worktree.
        resolved = lock_path_for(repo_root)
        self.assertEqual(resolved, expected)
        self.assertNotIn(".claude/worktrees", str(resolved).replace(os.sep, "/"))

    def test_falls_back_to_start_dir_outside_a_git_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(resolve_main_checkout(tmp), Path(tmp))

    def test_holder_pid_is_recorded_for_diagnostics(self):
        with tempfile.TemporaryDirectory() as tmp:
            handle = acquire_watcher_lock(tmp)
            self.addCleanup(release_watcher_lock, handle)
            self.assertEqual(read_lock_holder(tmp), os.getpid())


if __name__ == "__main__":
    unittest.main()
