claude -p "explain basic ralph loop syntac=x"
The "Ralph loop" (Geoff Huntley's "Ralph Wiggum" technique) is deliberately dumb: run a coding agent in an infinite bash loop, feeding it the *same* prompt every iteration, and let the repo state be the memory. The basic syntax is:

```bash
while :; do
  cat PROMPT.md | claude -p --dangerously-skip-permissions
done
```

That's the whole thing. Breaking it down:

- **`while :; do ... done`** — an infinite loop. Each pass spawns a *fresh* agent process with a clean context window. No conversation carryover; when the agent exits (finishes, errors, or runs out of context), the loop just starts it again.
- **`cat PROMPT.md |`** — the prompt is a fixed file, piped in identically every time. All the intelligence lives here, not in the loop. A typical PROMPT.md says something like: "Read `plan.md`. Pick the ONE most important unfinished task. Implement it. Run the tests. Update `plan.md` to mark it done. Commit."
- **`claude -p`** — headless/print mode (non-interactive, exits when done). The original used `amp`; any CLI agent works.
- **`--dangerously-skip-permissions`** — no permission prompts, since nobody's watching. This is why you run Ralph in a sandbox/container/throwaway VM, not on your main machine.

The key insight: **state lives in files, not context.** Each iteration re-reads the plan, the code, and git history to figure out where things stand. Progress accumulates in commits and a checklist file (`plan.md`, `TODO.md`, `fix_plan.md` — naming varies).

Common refinements:

```bash
# Bounded iterations instead of infinite
for i in $(seq 1 50); do cat PROMPT.md | claude -p --dangerously-skip-permissions; done

# Stop when the agent signals completion
while :; do
  cat PROMPT.md | claude -p --dangerously-skip-permissions
  grep -q "ALL TASKS COMPLETE" plan.md && break
  sleep 5
done
```

Prompt-side conventions that make it work: "do ONE task per run" (prevents context exhaustion mid-task), "run the build/tests before committing" (self-verification), and an explicit completion sentinel the loop can grep for.

Side note: in this session you also have a built-in `/loop` skill, which is the harness-native version of the same idea — it re-fires a prompt on an interval or self-paced schedule without needing a bash loop or skipping permissions. If you want a Ralph-style loop *inside* this session rather than in a terminal, that's the tool for it.
� tasteslikegoodtheangularsvegancookbook � cat PMMIXUPPROMPT_DRAFT.md | claude -p "recomend workflow options for this task - simmilar too ralph loop or with /loop and /goal. Output three unique options 1) a bash script/command that creaetes a new worktree/sandbox and a plan.md 2) a prompt that uses the shipped /loop /goal 3) your choice. Create a new worktree off dev for this session as a kickoff point"
**Worktree is ready.** Session is now in `.claude/worktrees/chore+atlassian-pm-triage` on branch `worktree-chore+atlassian-pm-triage`, cut from `origin/dev` (local dev was exactly at the remote tip, 0↑ 0↓, Backend too). Baseline is clean: `npm install` + `npm test` → 52/52 passing. I seeded **`PLAN.md`** there — a phased, checkbox plan compiled from your `PMMIXUPPROMPT_DRAFT.md` (read-only inventory → classification → separation/dev-TO freeze → guardrails, with a verify command per task, "Blocked (needs Adam)" parking, and safety rails: never delete, export before mutating, no writes to `-dev` beyond rename/description). All three options below consume this same file. One scan note: no open PRs touch `scripts/pm` or the Atlassian config, and this week's landed fixes (#3080, #3079, #3065) are already in your base — so nothing in flight conflicts.

---

## Option 1 — Ralph loop: bash script that makes the sandbox + plan.md and hammers one prompt

Classic Ralph: identical prompt every iteration, all state lives in `PLAN.md`, hard iteration cap. Save as `triage-loop.sh` (don't commit it; or commit under `scripts/pm/` in Phase 3 if you like it):

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="$HOME/Projects/tasteslikegoodtheangularsvegancookbook"
cd "$REPO" && git fetch origin --prune
WT=".claude/worktrees/atlassian-triage-$(date +%m%d-%H%M)"
git worktree add "$WT" -b "chore/atlassian-triage-$(date +%m%d-%H%M)" origin/dev
cp "$REPO/.claude/worktrees/chore+atlassian-pm-triage/PLAN.md" "$WT/PLAN.md"  # or seed from a heredoc
cd "$WT" && npm install --no-audit --no-fund && mkdir -p triage

PROMPT='Read PLAN.md. Work exactly ONE unchecked task (top-most, respecting the
phase GATEs and safety rails), verify it with its listed check, check the box
with a dated note, and exit. Unresolvable decisions go under "## Blocked
(needs Adam)". If every box is checked or blocked, print TRIAGE_COMPLETE.'

for i in $(seq 1 25); do
  claude -p "$PROMPT" --permission-mode acceptEdits | tee "triage/iter-$i.log"
  grep -q TRIAGE_COMPLETE "triage/iter-$i.log" && break
done
echo "Loop ended after $i iteration(s); review PLAN.md and triage/ before opening the PR."
```

Since you already have this session's worktree, you can point `WT` at it instead of creating another. Cheap, transparent, resumable (`PLAN.md` is the state) — but no built-in gate enforcement beyond what the prompt says.

## Option 2 — Shipped `/loop`, self-paced

Note: `/goal` isn't a registered skill in this session — the goal statement gets embedded in the loop prompt instead (the closest shipped "goal → verified plan" machinery is Option 3). Run this in the current worktree, omitting the interval so the loop self-paces:

```
/loop Drive PLAN.md to completion: each firing, work the single top-most
unchecked task respecting the phase GATEs (Phase 0 is read-only against
Atlassian; never delete anything; no moves into the -dev site). Use the
Atlassian MCP tools for Jira/Confluence work and subagents for the Phase 3
sub-tasks (space descriptions, scripts/pm hardening, docs sweep — one agent
each). Verify each task with its listed check before checking the box, and
park judgment calls under "## Blocked (needs Adam)" instead of guessing.
Stop the loop when every box is checked or blocked, then summarize what is
blocked and open the PR against dev.
```

Middle ground: harness-managed pacing and background continuation without you babysitting a terminal, and it can fan sub-tasks out to subagents — but verification rigor is still only as strong as the prompt.

## Option 3 (my pick) — `pm-skills:cs-pm-loop`, optionally grilled first

This is literally the purpose-built tool for this task: a bounded PM-delivery loop that snapshots Jira via MCP, routes each lane to the right sub-skill (`jira-expert`, `confluence-expert`, `atlassian-admin`), enforces **machine-verified gates**, and *refuses to close* until every gate passes or you explicitly waive it — exactly the "counts-before must reconcile with counts-after" property you want when moving work items around. It also forks heavy Jira snapshots out of the parent context, and its orchestrator delegates your sub-tasks to subagents natively.

```
/pm-skills:cs-grill-pm PLAN.md      ← 5 minutes; locks the two decisions that matter
/pm-skills:cs-pm-loop Execute PLAN.md in this worktree; gates 0–3 are the machine checks; blocked items surface to me, never guessed.
```

The grill step is worth it here because two decisions shape everything downstream and only you can make them: (1) disposition of items that exist *only* on dev-TO, and (2) whether cross-managed-type moves should clone-and-close or hard-move (it changes how counts reconcile).

**My recommendation:** Option 3 for the Atlassian data work (Phases 0–2, where an unverified move loses tickets), and either loop style is fine for Phase 3's repo-side cleanup — those sub-tasks are independent and low-risk, so Option 2's subagent fan-out handles them well. Whichever you pick, the worktree and `PLAN.md` are live right now, and Phase 0 can start immediately since it's read-only.
