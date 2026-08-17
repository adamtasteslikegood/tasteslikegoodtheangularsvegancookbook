#!/usr/bin/env bash
# PreToolUse nudge — PR review feedback.
#
# Fires right before the agent posts a reply to PR review feedback (via the
# GitHub MCP reply tools or a `gh pr comment` / `gh pr review` / `gh api ...`
# post). Injects a reminder to have applied the superpowers:receiving-code-review
# skill — verify claims against the code, push a fix or give a concrete rebuttal
# (no performative agreement), and sign the reply on Adam's behalf.
#
# Non-blocking: it only injects additionalContext; the tool still proceeds. The
# hard rule lives in CLAUDE.md's "Pull request lifecycle" section — this is the
# reinforcement, not the gate.
#
# Registered on two PreToolUse matchers in .claude/settings.json:
#   - the GitHub MCP reply tools (tool-name match)
#   - Bash, guarded by `if: "Bash(gh *)"` so it only runs for gh commands
#
# Fail-open, matching the repo's other hooks: any unexpected error exits 0 so a
# transient failure (malformed stdin, missing jq, etc.) can never interfere with
# the tool call it's attached to.
set -uo pipefail
trap 'exit 0' ERR

payload="$(cat)"
tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"

is_pr_reply=0
is_merge=0
is_reading_comments=0

case "$tool_name" in
  mcp__plugin_github_github__add_reply_to_pull_request_comment | \
    mcp__plugin_github_github__add_comment_to_pending_review | \
    mcp__plugin_github_github__pull_request_review_write | \
    mcp__plugin_github_github__add_issue_comment)
    is_pr_reply=1
    ;;
  mcp__plugin_github_github__merge_pull_request)
    is_merge=1
    ;;
  Bash)
    cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
    if printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+(comment|review)([[:space:]]|$)'; then
      is_pr_reply=1
    elif printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+api[[:space:]]' \
      && printf '%s' "$cmd" | grep -Eq 'pulls/[0-9]+/comments' \
      && printf '%s' "$cmd" | grep -Eq '(-X[[:space:]]*POST|--method[[:space:]]*POST|--input[[:space:]])'; then
      is_pr_reply=1
    elif printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
      is_merge=1
    elif printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+api[[:space:]]' \
      && printf '%s' "$cmd" | grep -Eq 'pulls/[0-9]+/comments' \
      && ! printf '%s' "$cmd" | grep -Eq '(-X[[:space:]]*POST|--method[[:space:]]*POST|--input[[:space:]])'; then
      is_reading_comments=1
    fi
    ;;
esac

if [ "$is_pr_reply" -eq 1 ]; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"You are about to post a reply to PR review feedback. Per the CLAUDE.md Pull request lifecycle rules: if you have not already this turn, invoke the superpowers:receiving-code-review skill and evaluate this feedback with technical rigor — verify each claim against the code, then either push a fix commit or give a concrete technical rebuttal (never performative agreement, never silently ignore). End the reply with the attribution line: _Replied by Claude on Adam's behalf_"}}
JSON
elif [ "$is_merge" -eq 1 ]; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"STOP — you are about to merge a PR. Before merging, you MUST check for unanswered review comments (gh api repos/{owner}/{repo}/pulls/{n}/comments AND gh api repos/{owner}/{repo}/pulls/{n}/reviews — suppressed comments hide in review bodies). Every comment must be answered or have a fix pushed. If ANY are unaddressed, do NOT merge — address them first. Also verify all required checks have passed (gh pr checks)."}}
JSON
elif [ "$is_reading_comments" -eq 1 ]; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"You are reading PR review comments. If you have not already this turn, invoke the superpowers:receiving-code-review skill before responding to any feedback."}}
JSON
fi

exit 0
