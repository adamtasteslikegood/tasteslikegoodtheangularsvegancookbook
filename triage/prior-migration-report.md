# Prior close-vs-move work — detailed reconstruction (2026-07-12)

Adam confirmed the close-vs-move work was already done; this documents exactly
what and which, from the data.

## Verification that nothing new happened since Phase 0

A full re-export of all five projects on 2026-07-12 (triage/recheck/) was
diffed field-by-field (summary, status, labels, resolution, type, parent)
against the 2026-07-11 Phase 0 snapshot: **zero changes across all 235
issues**, and all five counts still match the server (37/40/69/48/41). So the
"already done" work is not recent — it is the **2026-04-28 PLZG cleanup**,
reconstructed below.

## What the 2026-04-28 cleanup did (all inside PLZG, nothing deleted)

**1. Moved the plaza backlog out of old TO keys into PLZG.** 18 surviving
PLZG issues carry explicit "Migrated from TO-nn" markers (source keys TO-19
through TO-35 — an *older* TO numbering; those source keys are dead now,
which is why PLZG-60/67/71/73 contain dangling references to TO-45/52/54/55):

| PLZG key | Migrated from | Item |
| --- | --- | --- |
| PLZG-4  | TO-19 | Godot 4 Game — Agent Knowledge Base Explorer |
| PLZG-86 | TO-19 | Phase 0 — Pre-work: Data Prep & Content Definition |
| PLZG-3  | TO-20 | Phase 1 — Godot 4 Prototype (Weeks 1–3) |
| PLZG-87 | TO-21 | Phase 2 — I/O Bridge: Live Agent Output (Weeks 4–6) |
| PLZG-2  | TO-22 | Phase 3 — Polish, All 9 Floors & Full Tutorial Arc |
| PLZG-88 | TO-23 | Define in-world assistant — name and personality |
| PLZG-89 | TO-24 | Define tutorial startup — company name and backstory |
| PLZG-90 | TO-25 | Export 137 agent .md files to agents.json |
| PLZG-91 | TO-26 | Define art direction and rough visual moodboard |
| PLZG-8  | TO-27 | M1 — Install Godot 4 + first-person controller |
| PLZG-13 | TO-28 | M2 — Grey-box the office layout |
| PLZG-19 | TO-29 | M3 — Agent data layer |
| PLZG-24 | TO-30 | M4 — First NPC + proximity dialogue [CRITICAL PATH] |
| PLZG-30 | TO-31 | M5 — Assistant chat UI overlay |
| PLZG-35 | TO-32 | M6 — Unlock gate system + 2D building map |
| PLZG-92 | TO-33 | M7 — Python WebSocket bridge |
| PLZG-93 | TO-34 | M8 — First live agent output in-world [PROTOTYPE COMPLETE] |
| PLZG-5  | TO-35 | Phase 3 planning — define specifics once M8 works |

**2. Closed the duplicate copies in place.** Exactly 26 PLZG issues were
labeled `cleanup-2026-04-28` + `duplicate` and transitioned to Done. The
three sets — duplicate-labeled, cleanup-labeled, Done-status — are
*identical* (verified programmatically), and none of the 18 migrated keepers
is among them. The 26 closed duplicates:

PLZG-6, PLZG-7, PLZG-9, PLZG-11, PLZG-14, PLZG-15, PLZG-17, PLZG-20,
PLZG-22, PLZG-23, PLZG-29, PLZG-32, PLZG-37, PLZG-64, PLZG-66, PLZG-75,
PLZG-76, PLZG-77, PLZG-78, PLZG-79, PLZG-80, PLZG-81, PLZG-82, PLZG-83,
PLZG-84, PLZG-85

**Established house pattern for Phase 2** (per this precedent): migrate/clone
the keeper to the right project with a "Migrated from <KEY>" marker; label the
leftover copy (`duplicate` + a dated cleanup label) and close it Done; delete
nothing. Improvement for this round: also write the *new* key into the closed
copy so links don't go dead like the TO-45/52/54/55 references did.

**Not part of that cleanup:** KAN-82's lone `cleanup` label is unrelated —
it's the worktree-prune chore itself (same-day duplicate of TO-122), still
To Do. The 40 bot "[repo-status]" tickets and the ~18 triplicated recipe
issues (TO-dev = KAN = RCP) were NOT touched by the April cleanup and remain
open items for Phase 2.

## Mutations performed this session (2026-07-12)

- Jira project **DR** ("Development requests", service desk, main site) —
  verified 0 issues twice, then DELETE /rest/api/3/project/DR?enableUndo=true
  → HTTP 204. In Jira recycle bin (restorable ~60 days).
- Jira project **TT** ("Tastelikegood-team", service desk, main site) — same
  verification and call → HTTP 204. In recycle bin.
- Authorized by Adam 2026-07-12 ("literally zero content in either TT or DR
  so go ahead and get rid of them").
