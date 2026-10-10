#!/usr/bin/env python3
"""Sprint 11 PM driver — the Sprint 10 driver run against the Sprint 11 plan.

The rules are ``sprint10_driver.py``'s, unchanged: one controller state per SI,
``depends_on`` order, exact-Done starts (``requires_done``), WIP <= 3, 12
iterations and 3 attempts per SI, and ``soak`` for a task whose only remaining
evidence is a time window. Only the plan and the state dir differ:

* plan:  ``specs/harness/SPRINT_11_HARNESS_PLAN.json``
* state: ``<main checkout>/.agent-harness/sprint11/`` (gitignored)

Charter D6 for Sprint 11 adds that an item waiting on a date or on Adam holds
no WIP slot. Two existing rules cover it. A task that has not started holds no
slot, so work that waits on Adam first (S22's profile edits) is simply not
started. A task whose work is recorded and that waits on a dated count declares
``soak_window_hours`` in the plan and is soaked.

Usage::

    python3 scripts/harness/sprint11_driver.py status
    python3 scripts/harness/sprint11_driver.py start T1
    python3 scripts/harness/sprint11_driver.py start T26 --dry-run

Exit codes are the Sprint 10 driver's: 0 ok, 2 config/API error, 3 refused.
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sprint10_driver as driver  # noqa: E402

PLAN = HERE.parents[1] / "specs" / "harness" / "SPRINT_11_HARNESS_PLAN.json"
STATE_NAME = "sprint11"


def main(argv=None):
    return driver.main(argv, plan=PLAN, state_name=STATE_NAME, description=__doc__)


if __name__ == "__main__":
    sys.exit(main())
