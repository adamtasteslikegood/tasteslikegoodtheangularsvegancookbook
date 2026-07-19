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
case "$tool_name" in
  mcp__plugin_github_github__add_reply_to_pull_request_comment | \
    mcp__plugin_github_github__add_comment_to_pending_review | \
    mcp__plugin_github_github__pull_request_review_write | \
    mcp__plugin_github_github__add_issue_comment)
    # add_issue_comment covers PR conversation comments too.
    is_pr_reply=1
    ;;
  Bash)
    cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
    if printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+(comment|review)([[:space:]]|$)'; then
      is_pr_reply=1
    elif printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+api[[:space:]]' \
      && printf '%s' "$cmd" | grep -Eq 'pulls/[0-9]+/comments' \
      && printf '%s' "$cmd" | grep -Eq '(-X[[:space:]]*POST|--method[[:space:]]*POST|-f[[:space:]]|-F[[:space:]]|--field[[:space:]]|--input[[:space:]])'; then
      is_pr_reply=1
    fi
    ;;
esac

if [ "$is_pr_reply" -eq 1 ]; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"You are about to post a reply to PR review feedback. Per the CLAUDE.md Pull request lifecycle rules: if you have not already this turn, invoke the superpowers:receiving-code-review skill and evaluate this feedback with technical rigor — verify each claim against the code, then either push a fix commit or give a concrete technical rebuttal (never performative agreement, never silently ignore). End the reply with the attribution line: _Replied by Claude on Adam's behalf_"}}
JSON
fi

exit 0
