# TO-dev (tasteslikegood-dev.atlassian.net, project TO) — diff vs main-site exports

Scope: all 41 TO-dev issues diffed against the four main-site exports
(RCP 37, KAN 40, PLZG 69, TO-main 48). An item counts as **matched** when a
main-site issue carries the same or clearly equivalent summary (near-duplicate
wording counts). 40 of 41 are matched; 1 exists only on -dev.

## 1. Matched on the main site (40)

| devKey | Matched main-site key(s) | Match basis |
| ------ | ------------------------ | ----------- |
| TO-1  | KAN-77 | Identical summary + identical description ("Repository Setup and Configuration, Cleanup and Maintenance") |
| TO-2  | KAN-71 | Identical "CLONE - Repository Setup and Configuration..." |
| TO-3  | KAN-17, RCP-32 | Same GH#162 Valkey singleton-guard issue (identical body text) |
| TO-4  | KAN-16, RCP-30 | Same GH#163 Valkey quit()-failure issue (identical body text) |
| TO-5  | RCP-28 | Same GH#103 pytest / generate_ai_image() Flask-context failure |
| TO-6  | RCP-27 | Identical "Frontend — Angular 21 SPA Development" workstream |
| TO-7  | RCP-25 | Identical "Backend — Flask API (Python) Development" workstream |
| TO-8  | KAN-76 | Identical "DevOps & Cloud Infrastructure" workstream |
| TO-9  | KAN-72 | Identical "Security & Reliability" workstream |
| TO-10 | KAN-66 | "Atlassian / Knowledge Base / Tooling" workstream (KAN-66 has evolved into the source-of-truth ticket, same summary) |
| TO-11 | KAN-73, RCP-19 | Same GH#104 "Add or enforce CI for Angular+Flask" |
| TO-12 | KAN-79 | Same GH#103 "Set up numbered versioning — publish official releases" |
| TO-13 | KAN-78, KAN-19 | Same GH#102 "Set up numbered versioning on build/deploy CI/CD pipeline" |
| TO-14 | KAN-63, RCP-2 | Same GH#101 first published GitHub Release (see note below) |
| TO-15 | KAN-68, KAN-21 | Same GH#100 "Establish PR size/reviewability best practices" |
| TO-16 | KAN-70 | Same Backend GH#73 "are Backend CI checks actually working?" |
| TO-17 | KAN-64 | Same Backend GH#72 ".agent/skills" documentation |
| TO-18 | KAN-62 | Same Backend GH#71 "Add/enforce CI for lint, tests, and required checks" |
| TO-19 | PLZG-86 (+ dup PLZG-37) | "Phase 0 — Pre-work: Data Prep & Content Definition" — PLZG copy says "Migrated from TO-19" |
| TO-20 | PLZG-3 (+ dup PLZG-23) | "Phase 1 — Godot 4 Prototype (Weeks 1–3)" — "Migrated from TO-20" |
| TO-21 | PLZG-87 (+ dup PLZG-29) | "Phase 2 — I/O Bridge: Live Agent Output" — "Migrated from TO-21" |
| TO-22 | PLZG-2 (+ dup PLZG-32) | "Phase 3 — Polish, All 9 Floors & Full Tutorial Arc" — "Migrated from TO-22" |
| TO-23 | PLZG-88 (+ dup PLZG-66) | "Define in-world assistant — name and personality" — "Migrated from TO-23" |
| TO-24 | PLZG-89 (+ dup PLZG-64) | "Define tutorial startup — company name and backstory" — "Migrated from TO-24" |
| TO-25 | PLZG-90 (+ dup PLZG-75) | "Export 137 agent .md files to agents.json" — "Migrated from TO-25" |
| TO-26 | PLZG-91 (+ dup PLZG-76) | "Define art direction and rough visual moodboard" — "Migrated from TO-26" |
| TO-27 | PLZG-8 (+ dup PLZG-77) | "M1 — Install Godot 4 + first-person controller" — "Migrated from TO-27" |
| TO-28 | PLZG-13 (+ dup PLZG-78) | "M2 — Grey-box the office layout" — "Migrated from TO-28" |
| TO-29 | PLZG-19 (+ dup PLZG-79) | "M3 — Agent data layer" — "Migrated from TO-29" |
| TO-30 | PLZG-24 (+ dup PLZG-80) | "M4 — First NPC + proximity dialogue" — "Migrated from TO-30" |
| TO-31 | PLZG-30 (+ dup PLZG-81) | "M5 — Assistant chat UI overlay" — "Migrated from TO-31" |
| TO-32 | PLZG-35 (+ dup PLZG-82) | "M6 — Unlock gate system + 2D building map" — "Migrated from TO-32" |
| TO-33 | PLZG-92 (+ dup PLZG-84) | "M7 — Python WebSocket bridge" — "Migrated from TO-33" |
| TO-34 | PLZG-93 (+ dup PLZG-85) | "M8 — First live agent output in-world" — "Migrated from TO-34" |
| TO-35 | PLZG-5 (+ dup PLZG-83) | "Phase 3 planning — define specifics once M8 is working" — "Migrated from TO-35" |
| TO-37 | TO-79 (main) | Same task: verify Cloud Build tag-push trigger regex `^v[0-9]+\.[0-9]+\.[0-9]+$` (GH#2898, deferred-from-v0.2.1) |
| TO-38 | TO-80 (main) | Same task: reconcile .gcloudignore `.git` exclusion with cloudbuild.yaml submodule init (GH#2896) |
| TO-39 | TO-78 (main) | Same task: decide on .cloudbuildignore vs .gcloudignore (GH#2897) |
| TO-40 | TO-77 (main) | Same task: solo-repo merge friction — ruleset requires review, auto-merge disabled (GH#2895) |
| TO-41 | TO-82 (main) | Same underlying work: fix the broken Gemini GitHub workflows ("Gemini workflows needs fixing") |

**Content-delta notes (matched, but the dev copy is richer — carry these over
before freezing TO-dev):**

- **TO-14** carries a 2026-07-01 correction ("corrected version number from
  v1.0.0 to v0.1.0 to match SemVer scheme; v0.3.0 release in progress") that is
  absent from KAN-63 / RCP-2.
- **TO-41** is far more specific than TO-82: it cites Backend GH#121 and lists
  the four stacked draft PRs to triage (#122, #123, #124, #136). Merge that
  detail into the surviving ticket.
- **TO-1** (unlike KAN-77) is In Progress, carries `Release-v0.3.0`, and was
  updated 2026-07-01; TO-5 likewise gained `Release-v0.3.0` + `ReleaseBlocker`
  labels on the dev copy only.

## 2. Existing ONLY on -dev (1)

| devKey | Summary | Classification | Proposed disposition |
| ------ | ------- | -------------- | -------------------- |
| TO-36 | Ship v0.3.0 — merge release PR #2981, tag, deploy to Cloud Run | recipe | migrate-to-RCP (release umbrella = delivery-level). Note: v0.3.0 has since shipped (repo is on v0.3.3), so migrate it as a historical/Done record or let Adam confirm closing it instead of migrating — but its checklist (PR #2981, backend PR #120, trigger-regex check, smoke tests) exists nowhere on the main site, so it should be rescued before TO-dev is frozen. |

Coverage check: 40 matched + 1 dev-only = 41 = all TO-dev issues; each appears
in exactly one table.
