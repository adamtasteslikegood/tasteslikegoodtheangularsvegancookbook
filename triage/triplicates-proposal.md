# Duplicate/triplicate proposal — EXECUTED 2026-07-12 (Adam approved)

All 5 section-A closes performed and verified Done with labels + keeper
comments; results in closures-dedup-2026-07-12.json. Verified open counts
after: RCP 31, KAN 17, PLZG 37, TO-main 13, TO-dev 33 (the preview at the
bottom of this file was estimated before execution and is superseded).

Scope: all open (non-Done) issues across RCP / KAN / TO-main / TO-dev after
today's 51 closures, grouped by GitHub-issue reference + normalized summary.
13 machine-found groups, one split by hand (the GH#101/#102/#103 cluster
chained unrelated items through an ambiguous #103 tag).

House pattern per the 2026-04-28 precedent: keeper stays; each closed copy
gets labels `duplicate` + `cleanup-2026-07-12`, a comment naming the keeper
key (the April round's missing step), and a Done transition. Nothing deleted.

## A. Proposed closes on the main site — 5 issues (THE DECISION)

| Close | Keeper | Why |
| --- | --- | --- |
| RCP-32 | KAN-17 | Same Valkey GH#162 stale-client bug; dev bug's home is KAN |
| KAN-21 | KAN-68 | Same "PR size/reviewability best practices"; keeper carries the GH#100 link |
| KAN-63 | RCP-2  | Same "first published release v1.0.0"; a release milestone's home is RCP (delivery) |
| KAN-71 | KAN-77 | KAN-71 is literally titled "CLONE - Repository Setup…" — clone artifact of KAN-77 |
| TO-122 | KAN-82 | Same-day duplicate worktree-prune chore; recipe chores live in KAN, TO-main must end plaza-only |

## B. No action needed — dup copy lives on TO-dev and freezes with it (Phase 2.3)

TO-15 (=KAN-68), TO-14 (=KAN-63/RCP-2 — carries the v0.1.0-correction note to
preserve at freeze time), TO-5 (=RCP-28 — carries ReleaseBlocker label),
TO-17 (=KAN-64), TO-10 (=KAN-66), TO-1 (=KAN-77 — carries Release-v0.3.0
label), TO-9 (=KAN-72), TO-8 (=KAN-76), TO-7 (=RCP-25), TO-6 (=RCP-27),
TO-38 (=TO-80).

## C. Not duplicates / other lane

- KAN-73 vs RCP-19 (CI for Angular+Flask): near-identical wording, but one is
  the task, one the delivery epic — plausibly intentional pairing. NOT
  proposed for close; flagged for Adam's judgment.
- KAN-78 (GH#102) vs KAN-79 (GH#103, "numbered versioning — publish official
  releases"): different GH numbers, related theme. KAN-79's #103 tag collides
  with RCP-28's #103 (pytest bug) — one of the two is mislabeled at the
  source. Flagged only.
- TO-80 (TO-main): recipe item with no main-site twin (its only dup is dev
  TO-38) — this is a Phase 2.1 MOVE to KAN, not a dedup close.

## Reconciliation preview if A executes

counts stay 37/40/69/48/41 (closes, not moves); Done counts rise by:
RCP +1, KAN +3, TO-main +1. Combined with today's earlier closures, open
totals become: RCP 30, KAN 17, PLZG 43, TO-main 10, TO-dev 33.
