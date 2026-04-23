#!/bin/bash
# git-ahead-behind - Check ahead/behind status for git repos and submodules
# Usage: git-ahead-behind [N=10] [REPO_PATH]... [--submodules]

# Handle --help first
if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
  cat << 'EOF'
git-ahead-behind - Check ahead/behind status for git repos and submodules
Usage: git-ahead-behind [N=10] [REPO_PATH]... [--submodules]

Examples:
  git-ahead-behind                     # Top 10 branches in current dir
  git-ahead-behind 5                   # Top 5 branches in current dir
  git-ahead-behind --submodules        # Top 10 in current + all submodules
  git-ahead-behind 5 . Backend/        # Top 5 in current and Backend/
  git-ahead-behind Backend/ --submodules  # Backend + its submodules

Options:
  N               Number of top divergent branches to show (default 10)
  REPO_PATH       Specific git repo paths to check (default: current dir)
  --submodules    Also check submodules found in .gitmodules

Icons:
  ⬆️ = ahead (commits to push), ⬇️ = behind (commits to pull)
  ✅ = synced, 🔄 = both ahead & behind, ❓ = no upstream
  💎 = working tree has uncommitted changes
EOF
  exit 0
fi

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Default values
N=${1:-10}
shift || true

# Parse options
SUBMODULES=false
if [[ "${1:-}" == "--submodules" ]]; then
  SUBMODULES=true
  shift
fi

# If args given, treat as specific paths
REPOS=()
if [[ $# -gt 0 ]]; then
  REPOS=("$@")
else
  # Default: current directory
  REPOS=(".")
fi

# Function to process a single repo path
process_repo() {
  local path="$1"
  local display_path="$2"
  local status_icon=""

  # Check if it's a git repo
  if ! git -C "$path" rev-parse --git-dir >/dev/null 2>&1; then
    printf "%-50s %s\n" "$display_path" "❌ Not a git repo" >&2
    return 1
  fi

  # Get the working tree state
  local branch
  branch=$(git -C "$path" symbolic-ref --short HEAD 2>/dev/null || git -C "$path" rev-parse --short HEAD 2>/dev/null)

  # Fetch to get latest remote state
  if ! git -C "$path" fetch --quiet --all --prune 2>/dev/null; then
    printf "%-50s %s\n" "$display_path ($branch)" "⚠️  Fetch failed" >&2
    return 1
  fi

  # Get overall status (ahead/behind, working tree)
  local ahead=0 behind=0 dirty=""
  local upstream

  # Try to find upstream
  upstream=$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || echo "")

  if [[ -n "$upstream" ]]; then
    # Parse ahead/behind from rev-list
    local counts
    counts=$(git -C "$path" rev-list --left-right --count "$branch...$upstream" 2>/dev/null || echo "0 0")
    read -r ahead behind <<< "$counts"

    # Status icon based on divergence
    if [[ $ahead -gt 0 ]] && [[ $behind -gt 0 ]]; then
      status_icon="🔄"
    elif [[ $ahead -gt 0 ]]; then
      status_icon="⬆️"
    elif [[ $behind -gt 0 ]]; then
      status_icon="⬇️"
    else
      status_icon="✅"
    fi
  else
    status_icon="❓"  # No upstream
  fi

  # Check working tree status
  local status
  status=$(git -C "$path" status --porcelain --untracked-files=no 2>/dev/null)
  if [[ -n "$status" ]]; then
    dirty=" 💎"
  fi

  printf "%-50s %s %2d↑ %2d↓ %s\n" "$display_path ($branch)" "$status_icon" "$ahead" "$behind" "$dirty"
}

# Function to get top N divergent branches in a repo
show_top_branches() {
  local path="$1"
  local display_path="$2"

  printf "\n📁 %s\n" "$display_path"
  printf "%-20s %10s %10s %10s\n" "Branch" "Ahead" "Behind" "Total"
  printf "%-20s %10s %10s %10s\n" "------" "-----" "------" "-----"

  git -C "$path" for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads/ | (
    while read -r branch upstream; do
      if [[ -n "$upstream" ]]; then
        local counts
        counts=$(git -C "$path" rev-list --left-right --count "$branch" -- "$upstream" 2>/dev/null || echo "0 0")
        read -r ahead behind <<< "$counts"
        local total=$((ahead + behind))
        printf "%-20s ahead=%-4d behind=%-4d total=%-4d\n" "$branch" "$ahead" "$behind" "$total"
      fi
    done
  ) | sort -k4 -nr | head -n "$N"
}

# Collect all repos to process
all_repos=()
for repo in "${REPOS[@]}"; do
  if [[ ! -d "$repo" ]]; then
    printf "⚠️  Skipping non-directory: %s\n" "$repo" >&2
    continue
  fi

  # Add the repo itself
  all_repos+=("$repo" "$repo")

  # If submodules requested, find and add them
  if [[ "$SUBMODULES" == true ]]; then
    while IFS= read -r -d '' submodule; do
      # Convert .gitmodules relative path to absolute
      local mod_path
      mod_path=$(git -C "$repo" config --file .gitmodules --get submodule."$submodule".path)
      mod_path=$(realpath "$repo/$mod_path" 2>/dev/null || echo "$repo/$mod_path")
      if [[ -d "$mod_path" ]]; then
        all_repos+=("$mod_path" "$repo/${mod_path#$repo/} (submodule)")
      fi
    done < <(git -C "$repo" config --file .gitmodules --get-regexp '^submodule\.' | cut -d. -f2 | tr -d '\n' | tr ' ' '\0')
  fi
done

# Remove duplicates and process
declare -A seen
unique_repos=()
for i in "${!all_repos[@]}"; do
  local path="${all_repos[$i]}"
  local display="${all_repos[$((i+1))]}"

  # Skip if already seen
  if [[ -n "${seen[$path]}" ]]; then
    continue
  fi
  seen[$path]=1

  unique_repos+=("$path" "$display")
done

# Summary header
printf "🔍 Checking %d repo(s)/submodule(s), top %d branches by divergence:\n" "${#unique_repos[@]}" $(( ${#unique_repos[@]} / 2 )) "$N"
printf "%s\n" "================================================================================"

# Process each repo
summary_divergent=0
for i in "${!unique_repos[@]}"; do
  if (( i % 2 == 0 )); then
    path="${unique_repos[$i]}"
    display="${unique_repos[$((i+1))]}"

    # Quick status
    if process_repo "$path" "$display" | grep -q '[↑↓]'; then
      ((summary_divergent++))
    fi

    # Detailed branches if requested or if we have divergence
    if [[ "$N" -gt 0 ]] && process_repo "$path" "$display" | grep -q '[↑↓]'; then
      show_top_branches "$path" "$display"
    fi
  fi
done

# Summary
if [[ $summary_divergent -gt 0 ]]; then
  printf "\n📊 SUMMARY: %d/%d repos have divergence (ahead or behind)\n" "$summary_divergent" $(( ${#unique_repos[@]} / 2 ))
else
  printf "\n✅ All repos up to date!\n"
fi
