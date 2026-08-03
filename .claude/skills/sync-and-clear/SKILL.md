---
name: sync-and-clear
description: Write a session log to Confluence before clearing context. Use at the end of a session, or when the user says "wrap", "wrap up", "sync and clear", "log this session", or is about to run /clear or /compact and wants the session summary persisted first. Also use when context is running low and work should be checkpointed to Confluence.
---

# Sync and Clear

Persist this session to Confluence **before** the context is thrown away, then
tell the user it is safe to clear.

## Why this exists

`/clear` gives the model no turn — the context is dropped instantly, so nothing
can react to it. There is no hook and no instruction that can save a summary at
`/clear` time. The only reliable way to capture a session is for the user to run
*this* skill instead of typing `/clear`, and then clear.

A `PreCompact` hook (`.claude/hooks/precompact-session-log.sh`) covers the
`/compact` and auto-compact paths as a best-effort safety net. This skill is the
deliberate, verified path: you compose the summary, you confirm the URL.

## Steps

### 1. Compose the summary yourself

Do **not** shell out to summarize this session. You have the context in front of
you — that is the whole point. Write it directly.

Gather the facts first, so the log is concrete rather than vague:

```bash
git branch --show-current
git status --short
git log --oneline origin/dev..HEAD 2>/dev/null | head -20
```

### 2. Call the MCP tool

Call `mcp__pm-daemon__log_agent_session` with these arguments:

- `summary` (required) — 2-4 sentences. What the session was about and what
  changed. Lead with the outcome.
- `agent_name` — e.g. `"Claude Code (Opus 4.8)"`. Include the model.
- `branch` — from `git branch --show-current`.
- `key_decisions` — list. Each entry is a decision **and why**. Note reversals
  explicitly.
- `files_changed` — list of paths actually modified this session.
- `follow_up_items` — list of work left undone, deferred, or flagged.
- `pr_links` — list of PR URLs opened or touched.
- `kan_issue` / `rcp_issue` — Jira keys this session worked (e.g. `KAN-101`).
- `jira_updates` / `kan_updates` — lists of Jira mutations made.
- `duration_minutes` — rough estimate.

The tool creates a new Confluence page under the Agent Session Logs index
(parent `ATLASSIAN_CONFLUENCE_SESSION_LOG_PARENT_PAGE_ID`, default `34635777`)
and applies the `agent-session-log` label.

If the daemon is unavailable, fall back to the script path:

```bash
# write the markdown yourself, then:
bash scripts/pm/run_pm_script.sh publish_session_log.py --file <path.md>
```

### 3. Assess Atlassian alignment

Before you call the tool, decide whether Atlassian actually matches the work.
Read [`references/AOTA_MODEL.md`](references/AOTA_MODEL.md) and commit to one
verdict — **Aligned**, **Partially aligned**, or **Drifting** — then lead the
`summary` with it and name the KAN/RCP keys that justify it.

This is the judgement a transcript cannot supply, and it is why logs kept
rendering "Atlassian Alignment: Not assessed". The auto-capture hooks now emit
the same verdict from a compressed copy of the rubric inlined in their prompts,
so manual and automatic logs stay comparable.

If the verdict is anything but **Aligned**, convert the gap into concrete
follow-ups using [`references/TODO_SCHEMA.md`](references/TODO_SCHEMA.md) —
KAN execution, RCP delivery, and Confluence buckets kept separate — and pass
them as `follow_up_items`. A "Drifting" verdict with no TODOs is a
note-to-nobody.

### 4. Sync any modified planning docs

If this session changed anything under `specs/`, call
`mcp__pm-daemon__sync_pm_documents` so Confluence matches the repo.

### 5. Verify, then hand off

The tool returns a Confluence URL. **Check the return value**:

- Success => report the URL to the user verbatim.
- A `Warning: agent-session-log label not applied` in the response means the page
  exists but is missing its label, so it will **not** appear in the Agent Session
  Logs index (which filters by CQL on that label). Say so plainly — do not report
  it as a clean success.
- An error => report it and do **not** tell the user it is safe to clear.

Close with the URL and an explicit: *"Session logged. Safe to `/clear` now."*

## Rules

- Never claim the session was logged without a URL in hand.
- Write the summary from context, not from a script. A vague log is worse than
  none — it looks like a record and isn't one.
- Record decisions and *why*, not a narration of tool calls. The next session
  needs the reasoning, not the transcript.
- If something failed this session, the log says so. Session logs that only
  record wins are how a team learns the wrong lesson twice.
- Never put secrets on the page — no API keys, tokens, or `.env` contents. If
  sensitive material surfaced, record only that it did, that it was omitted, and
  whether rotation is warranted.

## References

- [`references/AOTA_MODEL.md`](references/AOTA_MODEL.md) — the Atlassian
  Outside The Agent operating model and the three-way alignment rubric.
- [`references/TODO_SCHEMA.md`](references/TODO_SCHEMA.md) — the shape for
  splitting follow-up work across KAN, RCP, and Confluence.

Both are ported from `.pi/skills/atlassian-session-log/references/`, which stays
in place for the pi agent. The pi extension
(`.pi/extensions/atlassian-aota/index.js`) registers pi's own `/session-log` and
`/sync-clear` commands against the *same* publisher, `publish_session_log.py` —
so pi and Claude write to one Confluence index, not two.
