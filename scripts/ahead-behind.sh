#!/bin/bash
# git-ahead-behind - Check ahead/behind status for git repos and submodules
# Usage: git-ahead-behind [OPTIONS] [REPO_PATH]...
# Options:
#   -n, --count N    Number of top divergent branches to show (default: 10)
#   --submodules     Include submodules in checks
#   -h, --help       Show this help message

# Show help if requested
show_help() {
  cat << 'EOF'
git-ahead-behind - Check ahead/behind status for git repos and submodules
Usage: git-ahead-behind [OPTIONS] [REPO_PATH]...

Options:
  -n, --count N    Number of top divergent branches to show (default: 10)
  --submodules     Include submodules in checks
  -h, --help       Show this help message

Examples:
  git-ahead-behind                     # Top 10 branches in current directory
  git-ahead-behind -n 5                # Top 5 branches in current directory
  git-ahead-behind --submodules        # Top 10 in current dir + all submodules
  git-ahead-behind -n 3 . Backend/     # Top 3 branches in current dir and Backend/
  git-ahead-behind Backend/ --submodules  # Backend + its submodules

Status Icons:
  ⬆️  Ahead of upstream (commits to push)
  ⬇️  Behind upstream (commits to pull)
  🔄  Both ahead and behind
  ✅  Synced with upstream
  ❓  No upstream configured
  ❌  Not a git repository
  ⚠️  Fetch failed
  💎  Working tree has uncommitted changes
EOF
  exit 0
}

# Parse command line arguments
N=10
SUBMODULES=false
REPOS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    -n|--count)
      if [[ $# -lt 2 ]]; then
        echo "Error: --count requires a numeric argument" >&2
        exit 1
      fi
      N="$2"
      if ! [[ "$N" =~ ^[0-9]+$ ]]; then
        echo "Error: --count must be a positive integer" >&2
        exit 1
      fi
      shift 2
      ;;
    --submodules)
      SUBMODULES=true
      shift
      ;;
    -*)
      echo "Error: Unknown option $1" >&2
      exit 1
      ;;
    *)
      REPOS+=("$1")
      shift
      ;;
  esac
done

# Default to current directory if no repos specified
if [[ ${#REPOS[@]} -eq 0 ]]; then
  REPOS=(".")
fi

# Function to process a single repository
process_repo() {
  local path="$1"
  local display_path="$2"
  local branch upstream counts ahead behind total dirty status_icon

  # Check if path is a git repo
  if ! git -C "$path" rev-parse --git-dir >/dev/null 2>&1; then
    echo -e "$display_path\t❌ Not a git repo"
    return 1
  fi

  # Fetch latest remote data
  if ! git -C "$path" fetch --quiet --all --prune 2>/dev/null; then
    echo -e "$display_path\t⚠️ Fetch failed"
    return 1
  fi

  # Get current branch
  branch=$(git -C "$path" symbolic-ref --short HEAD 2>/dev/null || git -C "$path" rev-parse --short HEAD 2>/dev/null)
  if [[ -z "$branch" ]]; then
    echo -e "$display_path\t❌ Could not determine branch"
    return 1
  fi

  # Check working tree status
  dirty=""
  if [[ -n "$(git -C "$path" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
    dirty=" 💎"
  fi

  # Get upstream tracking info
  upstream=$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || echo "")
  if [[ -z "$upstream" ]]; then
    echo -e "$display_path ($branch)\t❓ No upstream$dirty"
    return 0
  fi

  # Get ahead/behind counts
  counts=$(git -C "$path" rev-list --left-right --count "$branch...$upstream" 2>/dev/null || echo "0 0")
  read -r ahead behind <<< "$counts"
  total=$((ahead + behind))

  # Determine status icon
  if [[ $ahead -gt 0 ]] && [[ $behind -gt 0 ]]; then
    status_icon="🔄"
  elif [[ $ahead -gt 0 ]]; then
    status_icon="⬆️"
  elif [[ $behind -gt 0 ]]; then
    status_icon="⬇️"
  else
    status_icon="✅"
  fi

  echo -e "$display_path ($branch)\t$status_icon $ahead↑ $behind↓$dirty"
  return 0
}

# Function to show top N divergent branches in a repo
show_top_branches() {
  local path="$1"
  local display_path="$2"
  local branch upstream counts ahead behind total

  echo -e "\n📁 $display_path"
  echo -e "Branch\t\tAhead\tBehind\tTotal"
  echo -e "------\t\t-----\t------\t-----"

  git -C "$path" for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads/ | while read -r branch upstream; do
    if [[ -n "$upstream" ]]; then
      counts=$(git -C "$path" rev-list --left-right --count "$branch" -- "$upstream" 2>/dev/null || echo "0 0")
      read -r ahead behind <<< "$counts"
      total=$((ahead + behind))
      printf "%-20s\t%d\t%d\t%d\n" "$branch" "$ahead" "$behind" "$total"
    fi
  done | sort -k4 -nr | head -n "$N"
}

# Main execution
echo -e "🔍 Checking ${#REPOS[@]} repo(s), top $N branches by divergence:"
echo "================================================================================"

# Collect all repos (including submodules)
all_repos=()
for repo in "${REPOS[@]}"; do
  if [[ ! -d "$repo" ]]; then
    echo "⚠️ Skipping non-directory: $repo" >&2
    continue
  fi
  # Add main repo
  all_repos+=("$repo")
  # Add submodules if enabled
  if [[ "$SUBMODULES" = true ]]; then
    if [[ -f "$repo/.gitmodules" ]]; then
      while IFS= read -r mod_path; do
        mod_path=$(realpath "$repo/$mod_path" 2>/dev/null)
        if [[ -d "$mod_path" ]]; then
          all_repos+=("$mod_path")
        fi
      done < <(git -C "$repo" config --file .gitmodules --get-regexp 'submodule\..*\.path' 2>/dev/null | awk '{print $2}')
    fi
  fi
done

# Deduplicate repos
declare -A seen
unique_repos=()
for repo in "${all_repos[@]}"; do
  if [[ -z "${seen[$repo]}" ]]; then
    seen[$repo]=1
    unique_repos+=("$repo")
  fi
done

# Process each unique repo
summary_divergent=0
for repo in "${unique_repos[@]}"; do
  # Get display path relative to original repo if possible
  display_path="$repo"
  for original_repo in "${REPOS[@]}"; do
    if [[ "$repo" == "$original_repo"/* ]] && [[ "$repo" != "$original_repo" ]]; then
      display_path="$original_repo/${repo#$original_repo/} (submodule)"
      break
    fi
  done

  # Process repo summary
  if process_repo "$repo" "$display_path" | grep -q '[↑↓]'; then
    ((summary_divergent++))
  fi

  # Show top branches if divergence exists
  if [[ "$N" -gt 0 ]]; then
    show_top_branches "$repo" "$display_path"
  fi
done

# Final summary
echo -e "\n📊 SUMMARY: $summary_divergent/${#unique_repos[@]} repos have divergence (ahead or behind)"
if [[ $summary_divergent -eq 0 ]]; then
  echo "✅ All repos are up to date!"
fi
