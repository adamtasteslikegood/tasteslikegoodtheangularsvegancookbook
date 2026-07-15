# Atlassian Site & Space Triage — Critical Chore

Loop contract: each iteration, work exactly ONE unchecked task, run its Verify
command/check, check the box with a one-line dated note, then stop. If a task
needs a decision only Adam can make, move it under "## Blocked (needs Adam)"
with the question, and continue with the next task. The run is DONE when every
box is checked or blocked. Print `TRIAGE_COMPLETE` only when Phase gates 0-3
are all verified.

## Context

Two projects share five Jira/Confluence spaces across two Atlassian sites, and
work items are mixed together:

- **Projects:** (a) recipe app `tasteslikegood.org`, (b) "10110 TLG Plaza"
  office game.
- **tasteslikegood.atlassian.net** (software + delivery site):
  - `RCP` — Recipe Delivery (company-managed software)
  - `KAN` — Recipe Task tracking (team-managed software)
  - `PLZG` — Office Delivery (company-managed software)
  - `TO` — 10110 Tasteslikegood Plaza (team-managed business)
- **tasteslikegood-dev.atlassian.net** (intended: public-facing service site):
  - `TO` — "Tasteslikegood.org" (team-managed business) — duplicate key with
    the other site's TO; wrong site for delivery work

Root cause (fixed going forward, verify anyway): scripts/pm pointed at the
-dev site until this week, and keys were mixed up.

## Goal

The four tasteslikegood.atlassian.net spaces each serve their stated purpose
with only their own project's items; -dev is left as a service-site shell with
NO unique work items (its TO is frozen/renamed, not deleted, until verified
empty of unique items). Service-desk scaffolding beyond visual differentiation
is OUT of scope.

## Safety rails (apply to every task)

- Phase 0 is strictly read-only against Atlassian. No mutations before the
  Phase 0 gate is checked off.
- Never delete a Jira item or Confluence page. Move/clone/label/archive only.
- Export a full inventory snapshot to triage/ (in this worktree) before any
  mutation, so every move is reversible by hand.
- -dev site: read + rename/description changes only. No item moves INTO it.

## Phase 0 — Inventory (read-only)

- [x] 0.1 Enumerate both sites: cloud IDs, all Jira projects, all Confluence
      spaces (Atlassian MCP: getAccessibleAtlassianResources,
      getVisibleJiraProjects, getConfluenceSpaces). Write
      triage/sites-inventory.md.
      Verify: file exists and lists both cloud IDs and all 5+ spaces.
      DONE 2026-07-11: both cloud IDs recorded; main site has 6 Jira projects
      (DR + TT service desks were NOT in plan context — parked below), dev has
      3 (TO + DEMO/JIA). MCP grant covers main site only; -dev reached via
      read-only REST with .env API token.
- [x] 0.2 Export every issue in RCP, KAN, PLZG, TO(main), TO(dev) via JQL
      (key, summary, type, status, labels, updated) to
      triage/issues-<PROJECT>.json. Record per-project counts in
      triage/counts-before.md.
      Verify: 5 JSON files exist; counts match a re-run of JQL counts.
      DONE 2026-07-11: RCP 37, KAN 40, PLZG 69, TO-main 48, TO-dev 41 (235
      total); all five verified against /search/approximate-count. NOTE: quote
      "TO" in JQL (reserved word).
- [x] 0.3 Export Confluence page trees for the related spaces to
      triage/confluence-<SPACE>.md.
      Verify: files exist; page counts recorded in triage/counts-before.md.
      DONE 2026-07-11: TLG-main 120, PLZA-main 3, SD-main 20, TWC-main 10,
      SD-dev 19 pages.
- [x] GATE 0: inventory complete, counts recorded, zero write calls made.
      PASSED 2026-07-11: all reads via MCP (main) + REST GET / count POST
      (both sites); no create/update/delete calls issued.

## Phase 1 — Classification

- [x] 1.1 Classify every exported issue as recipe / plaza / unknown
      (summary+description heuristics; ambiguous -> unknown). Write
      triage/classification.csv (issueKey, currentProject, classification,
      targetProject, evidence).
      Verify: every issue from Phase 0 exports appears exactly once.
      DONE 2026-07-11 (subagent): 144 recipe / 80 plaza / 11 unknown.
      Independently verified: 235 rows, no dupes, no missing keys.
- [x] 1.2 Diff TO(dev) against the main site: list items existing ONLY on
      -dev in triage/dev-unique-items.md (the blocker list for freezing
      dev-TO).
      Verify: every dev-TO issue is matched to a main-site item or listed.
      DONE 2026-07-11: 40/41 matched to main-site items; 1 unique (TO-36
      "Ship v0.3.0"). A few matched dev copies hold unique detail to preserve
      (TO-14, TO-41, TO-1/TO-5 labels) — see dev-unique-items.md.
- [x] 1.3 Put unknown + dev-unique lists under "## Blocked (needs Adam)" for
      disposition. Do not guess.
      DONE 2026-07-11: see Blocked section below.
- [x] GATE 1: classification covers 100% of inventory; unknowns queued for
      Adam.
      PASSED 2026-07-11: 235/235 classified; 11 unknowns + 1 dev-unique + new
      scope findings queued below. NOTE for Phase 2: the misfile count (89) is
      dominated by bot-generated status tickets — see Blocked items before
      executing 2.1/2.2 as written.

## Phase 2 — Separation (mutations, main site only)

- [x] 2.1 Move/clone misfiled recipe items -> RCP or KAN; label originals
      triage-moved-<date> where team/company-managed moves force clones.
      Verify: JQL on targets shows moved keys; write triage/counts-after.md.
      DONE 2026-07-12: 13 TO-main items cloned to KAN-83…95 with
      migrated-from-TO labels + description markers; originals labeled,
      commented with clone key, closed. TO-main now has 0 open issues.
      (Note: the other 33 "misfiled" TO-main items were bot noise closed
      earlier, not moved — per Adam's disposition.)
- [x] 2.2 Move/clone misfiled plaza items -> PLZG or TO(main). Same verify.
      DONE 2026-07-12 as NO-OP: classification found zero misfiled plaza
      items on the main site; dev's 17 plaza items are all duplicates of
      existing PLZG/TO-main content and freeze in place.
- [x] 2.3 After Adam's disposition of dev-unique items, migrate keepers to
      the main site, then rename dev TO key/name (e.g. TOSVC /
      "SERVICE-HOLD — do not use") and set a banner description. DO NOT
      delete it.
      Verify: dev site has no project keyed TO; description states frozen.
      DONE 2026-07-12: dev TO-36 → RCP-38 (closed as historical Done —
      v0.3.x shipped); dev project re-keyed TO→TOSVC, renamed "SERVICE-HOLD
      — do not use (frozen 2026-07-12)" with banner description. Dev project
      list verified: DEMO, JIA, TOSVC only. Nothing deleted.
- [x] GATE 2: counts-after reconciles with counts-before + classification
      (no item lost); dev-TO frozen.
      PASSED 2026-07-12: every project total = before + clones (235 → 249,
      +14 clones); open counts all match expectations (TO-main 0); spot-check
      TO-80/KAN-87 pair verified. Full ledger in triage/counts-after.md.

## Phase 3 — Guardrails (each sub-task delegable to a subagent)

- [x] 3.1 Space/project descriptions + landing pages for RCP, KAN, PLZG,
      TO(main): one paragraph a 9-year-old gamer or an agent can route by.
      Verify: fetch each description via MCP; it names its project and its
      counterpart spaces.
      DONE 2026-07-13: routing descriptions set on all four main-site projects
      during PR #3102.
- [x] 3.2 Harden scripts/pm: site allowlist = tasteslikegood.atlassian.net
      only; project allowlist = RCP + KAN only (this repo must never touch
      PLZG/TO/-dev); fail loudly otherwise; add unit test or dry-run assert.
      Verify: test demonstrating a -dev URL or PLZG key is refused.
      DONE 2026-07-13: `_atlassian_guard.py` is wired into PM entry points and
      covered by `scripts/pm/test_atlassian_guard.py`.
- [x] 3.3 Docs sweep — scripts/pm docs, CLAUDE.md, AGENTS.md + other agent
      instructions, README.md, .env.example, docs/* — update every Atlassian
      URL/key/space reference to the corrected layout.
      Verify: grep -rn 'tasteslikegood-dev.atlassian' scripts docs *.md
      .env.example returns only intentional service-site references.
      DONE 2026-07-13: corrected site/project routing is documented across the
      repository guidance and PM tooling docs.
- [x] 3.4 Log session + decisions to Confluence Agent Session Logs; link the
      Jira item tracking this chore.
      DONE 2026-07-13: PR #3102 links the durable Agent Session Log.
- [x] GATE 3: all guardrail verifies pass; changes committed on this branch;
      PR opened against dev.
      PASSED 2026-07-13: PR #3102 merged to dev.

## Blocked (needs Adam)

- **GitGuardian→Jira double-filing fix (dashboard-side, only Adam can).**
  dashboard.gitguardian.com (workspace 847072) → Settings → Integrations →
  Jira: there are likely two project mappings (RCP and PLZG) or duplicate
  integration configs. Remove the Jira issue-creation mapping, or point it at
  exactly ONE destination (if kept: KAN + a security label for cookbook-repo
  alerts; non-cookbook repos shouldn't file here at all). Verify on the next
  incident: at most one Jira issue, in the intended project.
- **Bot-firehose verdict 2026-07-12 (no repo change made):** the Jira copies
  of [repo-status] reports were filed by the scripts/pm API token and stopped
  2026-05-29; the guard now hard-blocks that path. The GitHub-issue side is
  the intended product (Adam fixed it via TO-113; succeeded 2026-07-12) and
  was left alone. Optional cleanup: 46 open [repo-status]/[aw]-failure GitHub
  issues could be bulk-closed.
- ~~Scope: DR + TT~~ RESOLVED 2026-07-12: Adam confirmed both empty; verified
  0 issues twice, deleted via REST with enableUndo=true (Jira recycle bin,
  ~60-day restore window). DEMO + JIA on -dev remain untouched (service-site
  scaffold, out of scope).
- ~~Move policy~~ RESOLVED 2026-07-12: close-vs-move was already done for the
  plaza backlog in the 2026-04-28 PLZG cleanup — full reconstruction in
  triage/prior-migration-report.md (18 keepers migrated from old TO keys; 26
  duplicates labeled cleanup-2026-04-28 + duplicate and closed Done; nothing
  deleted). Phase 2 follows the same house pattern, plus: write the new key
  into each closed copy so cross-links don't go dead.
- ~~Bot-noise tickets~~ RESOLVED 2026-07-12: Adam approved close-in-place.
  41 found by exact match (33 TO-main + 8 KAN — one more than the Phase 1
  estimate); 40 closed with label `triage-bot-noise` + audit comment (TO-113
  was already Done). All verified Done server-side. See
  triage/closures-2026-07-12.json.
- ~~Unknowns (11)~~ RESOLVED 2026-07-12: Adam hand-checked KAN-14 + RCP-35,
  confirmed noise/false-positives (gbrain tests intentionally contain example
  creds). All 11 closed: 10 GitGuardian tickets labeled
  `triage-security-alert-false-positive`, KAN-14 labeled `triage-noise`, each
  with audit comment. Verified Done. Follow-up still open: repoint/disable
  the GitGuardian→Jira sync that double-files incidents into RCP+PLZG.
- **Dev-unique disposition:** TO-36 "Ship v0.3.0" (v0.3.3 already shipped —
  migrate as historical record to RCP, or just note-and-freeze?). Plus
  preserve-before-freeze details: TO-14 (v0.1.0 correction), TO-41 (GH#121 +
  4 draft-PR triage list), TO-1/TO-5 (Release-v0.3.0 / ReleaseBlocker
  labels). See dev-unique-items.md.
- ~~Duplicate closes~~ RESOLVED 2026-07-12: Adam reviewed
  triage/triplicates-proposal.md and said Execute. All 5 closed (RCP-32→
  KAN-17, KAN-21→KAN-68, KAN-63→RCP-2, KAN-71→KAN-77, TO-122→KAN-82) with
  duplicate + cleanup-2026-07-12 labels and keeper-pointer comments; all
  verified Done. Still flagged, no action: KAN-73/RCP-19 pairing and
  KAN-78/79 GH-tag collision (Adam judgment, low stakes); TO-80 queued as a
  Phase 2.1 move.

## Log

- 2026-07-12 (Phase 2 complete): Adam approved ("make it so"). 13 TO-main
  recipe items migrated to KAN-83…95; dev TO-36 → RCP-38 (historical Done);
  dev-TO frozen AND re-keyed to TOSVC (key rename succeeded via REST). GATE 2
  passed with full server-side reconciliation: 235 → 249 (+14 clones), zero
  lost, TO-main at 0 open. Remaining: Phase 3 guardrails (3.1–3.4) + two soft
  flags (KAN-73/RCP-19, KAN-78/79).
- 2026-07-12 (later): Adam approved unknowns + bot-ticket closes. 51 issues
  closed + verified (10 GitGuardian false-positives, KAN-14 filler, 40
  repo-status bot tickets; TO-113 already Done).
- 2026-07-12 (dedup): Adam reviewed the proposal and executed. 5 duplicates
  closed + verified. Server-verified open counts, reconciling exactly with
  totals (235 preserved, nothing lost): RCP 31, KAN 17, PLZG 37, TO-main 13,
  TO-dev 33. Mutations so far: 56 closes + 2 empty-project deletes; zero
  moves yet. Next up: 2.1 — move TO-main's 13 remaining open recipe items
  (incl. TO-80) to KAN/RCP, then 2.3 dev-TO freeze after TO-36 disposition.
- 2026-07-11: Worktree chore+atlassian-pm-triage created off origin/dev; plan seeded.
- 2026-07-11: Phase 0 complete (this session). Inventory + exports in triage/;
  all counts server-verified; GATE 0 passed with zero writes. -dev site is NOT
  in the MCP OAuth grant — all -dev access (and the eventual 2.3 freeze) must
  use the REST API token from .env. Atlassian also notes the SSE MCP endpoint
  is deprecated post-2026-06-30; the pm-skills connector config should point
  at https://mcp.atlassian.com/v1/mcp.
- 2026-07-12: Adam's dispositions round 1. DR + TT deleted (empty, verified,
  recycle-bin recoverable). 2026-07-12 re-export diffed against Phase 0
  snapshot: ZERO changes across 235 issues — the "already done" close-vs-move
  is the 2026-04-28 PLZG cleanup, reconstructed in
  triage/prior-migration-report.md. Unknowns + TO-36 elaborated for Adam
  (see triage/unknowns-elaboration.md); bot-noise disposition still open.
- 2026-07-11: Phase 1 complete (same session, classification via subagent,
  gate verified independently). Headline: the mixup is entirely in the two TO
  projects — RCP/KAN/PLZG have zero cross-product misfiles. TO-main is 100%
  recipe content (mostly bot status reports); TO-dev is 24 recipe + 17 plaza,
  40/41 already duplicated on the main site. Phase 2 is HELD: the five new
  Blocked items above change what 2.1/2.2 should do (bot-noise closes vs
  moves, duplicate handling). Do not start Phase 2 until Adam disposes of the
  Blocked list.
