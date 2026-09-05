---
name: Daily Report Status
description: Generate a daily repository activity report in a new GitHub issue.
intent: Keep maintainers informed about recent repository activity.
on:
  schedule: daily
  workflow_dispatch:

permissions:
  contents: read
  issues: read
  copilot-requests: write

strict: true

tools:
  github:
    mode: gh-proxy
    toolsets: [repos, issues]

safe-outputs:
  create-issue:
---

# Daily Report Status

Generate an activity report in a new issue.
