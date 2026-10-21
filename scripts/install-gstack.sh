#!/usr/bin/env bash
# install-gstack.sh — bootstrap the gstack skill bundle for this project.
#
# gstack itself is NOT vendored into this repo (the `skills` and `.gstack/`
# entries in .gitignore keep agent skills out of git). Teammates run this
# script once to clone gstack into ~/.claude/skills/gstack and register its
# skills with their local agent. Re-running it updates an existing install.
#
# Usage:
#   ./scripts/install-gstack.sh              # default host (Claude Code)
#   ./scripts/install-gstack.sh --host agy   # Antigravity CLI (agy)
#   ./scripts/install-gstack.sh --host auto  # every detected agent
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
( cd "${GSTACK_DIR}" && ./setup "$@" )

# Antigravity CLI (agy) migrated global customization discovery from
# ~/.gemini/antigravity-cli/ to ~/.gemini/config/ while upstream gstack's
# `./setup --host agy` still writes symlinks into ~/.gemini/antigravity-cli/skills.
# Bridge ~/.gemini/config/skills and ~/.gemini/config/skills.json when gstack's
# .agy bundle exists so agy discovers all gstack-* skills automatically.
if [ -d "${GSTACK_DIR}/.agy/skills" ] && [ -d "${HOME}/.gemini/config" ]; then
  if [ ! -e "${HOME}/.gemini/config/skills" ] && [ -d "${HOME}/.gemini/antigravity-cli/skills" ]; then
    ln -s ../antigravity-cli/skills "${HOME}/.gemini/config/skills"
  fi
  if [ ! -f "${HOME}/.gemini/config/skills.json" ]; then
    cat > "${HOME}/.gemini/config/skills.json" <<'EOF'
{
  "entries": [
    {
      "path": "~/.claude/skills/gstack/.agy/skills"
    }
  ]
}
EOF
  fi
fi

# Ensure repo-local .agents/skills points at .claude/skills (single source of
# truth for project skills across Claude Code, Antigravity, Gemini CLI, and Codex).
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [ -d "${REPO_ROOT}/.claude/skills" ] && [ ! -L "${REPO_ROOT}/.agents/skills" ]; then
  mkdir -p "${REPO_ROOT}/.agents"
  if [ -d "${REPO_ROOT}/.agents/skills" ] && [ -n "$(ls -A "${REPO_ROOT}/.agents/skills" 2>/dev/null)" ]; then
    echo "WARN: ${REPO_ROOT}/.agents/skills is a non-empty directory; refusing to replace it with a symlink." >&2
    echo "      Move or merge its contents into .claude/skills/, remove the directory, then re-run." >&2
  else
    rm -rf "${REPO_ROOT}/.agents/skills"
    ln -s ../.claude/skills "${REPO_ROOT}/.agents/skills"
  fi
fi

echo "Done. gstack skills are registered. See CLAUDE.md and AGENTS.md for usage."
