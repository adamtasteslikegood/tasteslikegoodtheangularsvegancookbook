---
description: |
  This workflow creates daily repo status reports. It gathers recent repository
  activity (issues, PRs, discussions, releases, code changes) and generates
  engaging GitHub issues with productivity insights, community highlights,
  and project recommendations.

on:
  schedule: daily
  workflow_dispatch:
  steps:
    - name: Validate COPILOT_GITHUB_TOKEN secret
      run: bash "${RUNNER_TEMP}/gh-aw/actions/validate_multi_secret.sh" COPILOT_GITHUB_TOKEN 'GitHub Copilot CLI' https://github.github.com/gh-aw/reference/engines/#github-copilot-default
      env:
        COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}

permissions:
  contents: read
  issues: read
  pull-requests: read

pre-steps:
  - name: Install GitHub Copilot CLI from npm
    run: npm_config_ignore_scripts=false npm install --prefix "${{ runner.temp }}/gh-aw/copilot-cli" @github/copilot@1.0.32
  - name: Install AWF binary
    run: bash "${RUNNER_TEMP}/gh-aw/actions/install_awf_binary.sh" v0.25.20

network: defaults

tools:
  github:
    # If in a public repo, setting `lockdown: false` allows
    # reading issues, pull requests and comments from 3rd-parties
    # If in a private repo this has no particular effect.
    lockdown: false

safe-outputs:
  mentions: false
  allowed-github-references: []
  create-issue:
    title-prefix: '[repo-status] '
    labels: [report, daily-status]
source: githubnext/agentics/workflows/daily-repo-status.md@442992eda2ccb11ee75a39c019ec6d38ae5a84a2
engine:
  id: copilot
  version: "1.0.32"
  command: ${{ runner.temp }}/gh-aw/copilot-cli/node_modules/.bin/copilot
---

# Daily Repo Status

Create an upbeat daily status report for the repo as a GitHub issue.

## What to include

- Recent repository activity (issues, PRs, discussions, releases, code changes)
- Progress tracking, goal reminders and highlights
- Project status and recommendations
- Actionable next steps for maintainers

## Style

- Be positive, encouraging, and helpful 🌟
- Use emojis moderately for engagement
- Keep it concise - adjust length based on actual activity

## Process

1. Gather recent activity from the repository
2. Study the repository, its issues and its pull requests
3. Create a new GitHub issue with your findings and insights
