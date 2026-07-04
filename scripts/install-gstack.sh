#!/usr/bin/env bash
# install-gstack.sh — bootstrap the gstack skill bundle for this project.
#
# gstack itself is NOT vendored into this repo (the `skills` and `.gstack/`
# entries in .gitignore keep agent skills out of git). Teammates run this
# script once to clone gstack into ~/.claude/skills/gstack and register its
# skills with their local agent. Re-running it updates an existing install.
#
# Usage: ./scripts/install-gstack.sh
set -euo pipefail

GSTACK_REPO="https://github.com/garrytan/gstack.git"
GSTACK_DIR="${HOME}/.claude/skills/gstack"

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is required by gstack's setup but was not found on PATH." >&2
  echo "Install bun (https://bun.sh) then re-run this script." >&2
  exit 1
fi

if [ -d "${GSTACK_DIR}/.git" ]; then
  echo "gstack already present at ${GSTACK_DIR} — updating…"
  git -C "${GSTACK_DIR}" pull --ff-only
else
  echo "Cloning gstack into ${GSTACK_DIR}…"
  mkdir -p "$(dirname "${GSTACK_DIR}")"
  git clone --single-branch --depth 1 "${GSTACK_REPO}" "${GSTACK_DIR}"
fi

echo "Running gstack setup…"
( cd "${GSTACK_DIR}" && ./setup )

echo "Done. gstack skills are registered. See the 'gstack' section of CLAUDE.md for usage."
