#!/bin/bash
# git-ahead-behind - Check ahead/behind status for git repos and submodules
# Usage: git-ahead-behind [N] [OPTIONS] [REPO_PATH]...
# Options:
#   -n, --count N    Number of branches to show (default: 10)
#   --sort MODE      Sort branches by "divergence" or "newest" (default: divergence)
#   --newest         Shortcut for --sort newest
#   --submodules     Include submodules in checks
#   -h, --help       Show this help message

# Show help if requested
show_help() {
  cat << 'EOF'
git-ahead-behind - Check ahead/behind status for git repos and submodules
Usage: git-ahead-behind [N] [OPTIONS] [REPO_PATH]...

Options:
  N                Positional shortcut for branch count, e.g. git-ahead-behind 5
  -n, --count N    Number of branches to show (default: 10)
  --sort MODE      Sort branches by "divergence" or "newest" (default: divergence)
  --newest         Shortcut for --sort newest
  --submodules     Include submodules in checks
  -h, --help       Show this help message

Examples:
  git-ahead-behind                     # Top 10 branches by ahead/behind divergence
  git-ahead-behind 5                   # Top 5 branches by ahead/behind divergence
  git-ahead-behind -n 5                # Top 5 branches by ahead/behind divergence
  git-ahead-behind 5 --newest          # Top 5 branches with the newest commits
  git-ahead-behind -n 5 --sort newest  # Same as --newest
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

PRs column:
  0 = no open PRs
  1 (#123) = one open PR
  1 (#123D) = one draft PR
  2 (#123,#124D) = multiple open/draft PRs
EOF
  exit 0
}

# Parse command line arguments
N=10
SORT_MODE="divergence"
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
    --sort)
      if [[ $# -lt 2 ]]; then
        echo "Error: --sort requires one of: divergence, newest" >&2
        exit 1
      fi
      case "$2" in
        divergence|divergent)
          SORT_MODE="divergence"
          ;;
        newest|recent|date)
          SORT_MODE="newest"
          ;;
        *)
          echo "Error: Unknown sort mode '$2'. Use: divergence or newest" >&2
          exit 1
          ;;
      esac
      shift 2
      ;;
    --newest|--recent)
      SORT_MODE="newest"
      shift
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
      if [[ "$1" =~ ^[0-9]+$ ]] && [[ "$N" == "10" ]] && [[ ${#REPOS[@]} -eq 0 ]]; then
        N="$1"
      else
        REPOS+=("$1")
      fi
      shift
      ;;
  esac
done

# Default to current directory if no repos specified
if [[ ${#REPOS[@]} -eq 0 ]]; then
  REPOS=(".")
fi

case "$SORT_MODE" in
  divergence)
    SORT_LABEL="divergence"
    ;;
  newest)
    SORT_LABEL="newest commit"
    ;;
esac

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

  if [[ $total -gt 0 ]]; then
    return 2
  fi

  return 0
}

# Function to format open GitHub PRs associated with a branch
format_branch_prs() {
  local path="$1"
  local branch="$2"
  local pr_lines pr_count pr_list

  if ! command -v gh >/dev/null 2>&1; then
    echo "-"
    return 0
  fi

  if ! git -C "$path" remote get-url origin 2>/dev/null | grep -qi 'github.com'; then
    echo "-"
    return 0
  fi

  pr_lines=$(
    cd "$path" && gh pr list --state open --head "$branch" --json number,isDraft --jq '.[] | "#" + (.number | tostring) + (if .isDraft then "D" else "" end)' 2>/dev/null || true
  )

  if [[ -z "$pr_lines" ]]; then
    echo "0"
    return 0
  fi

  pr_count=$(printf "%s\n" "$pr_lines" | sed '/^$/d' | wc -l | tr -d ' ')
  pr_list=$(printf "%s\n" "$pr_lines" | paste -sd, -)
  echo "$pr_count ($pr_list)"
}

# Function to show top N branches in a repo
show_top_branches() {
  local path="$1"
  local display_path="$2"
  local branch upstream counts ahead behind total commit_unix commit_date prs

  echo -e "\n📁 $display_path"

  if [[ "$SORT_MODE" == "newest" ]]; then
    printf "%-44s %12s %8s %8s %8s %-24s\n" "Branch" "Updated" "Ahead" "Behind" "Total" "PRs"
    printf "%-44s %12s %8s %8s %8s %-24s\n" "------" "-------" "-----" "------" "-----" "---"

    git -C "$path" for-each-ref --sort=-committerdate --format='%(committerdate:unix) %(committerdate:short) %(refname:short) %(upstream:short)' refs/heads/ | while read -r commit_unix commit_date branch upstream; do
      if [[ -n "$upstream" ]]; then
        counts=$(git -C "$path" rev-list --left-right --count "$branch...$upstream" 2>/dev/null || echo "0 0")
      else
        counts="0 0"
      fi
      read -r ahead behind <<< "$counts"
      total=$((ahead + behind))
      printf "%s\t%s\t%s\t%d\t%d\t%d\n" "$commit_unix" "$commit_date" "$branch" "$ahead" "$behind" "$total"
    done | sort -t $'\t' -k1,1nr | head -n "$N" | while IFS=$'\t' read -r commit_unix commit_date branch ahead behind total; do
      prs=$(format_branch_prs "$path" "$branch")
      printf "%-44s %12s %8d %8d %8d %-24s\n" "$branch" "$commit_date" "$ahead" "$behind" "$total" "$prs"
    done
  else
    printf "%-44s %12s %8s %8s %8s %-24s\n" "Branch" "Updated" "Ahead" "Behind" "Total" "PRs"
    printf "%-44s %12s %8s %8s %8s %-24s\n" "------" "-------" "-----" "------" "-----" "---"

    git -C "$path" for-each-ref --format='%(committerdate:short) %(refname:short) %(upstream:short)' refs/heads/ | while read -r commit_date branch upstream; do
      if [[ -n "$upstream" ]]; then
        counts=$(git -C "$path" rev-list --left-right --count "$branch...$upstream" 2>/dev/null || echo "0 0")
        read -r ahead behind <<< "$counts"
        total=$((ahead + behind))
        printf "%d\t%s\t%s\t%d\t%d\n" "$total" "$commit_date" "$branch" "$ahead" "$behind"
      fi
    done | sort -t $'\t' -k1,1nr | head -n "$N" | while IFS=$'\t' read -r total commit_date branch ahead behind; do
      prs=$(format_branch_prs "$path" "$branch")
      printf "%-44s %12s %8d %8d %8d %-24s\n" "$branch" "$commit_date" "$ahead" "$behind" "$total" "$prs"
    done
  fi
}

# Function to check if any local branch in a repo is divergent from its upstream
repo_has_divergent_branch() {
  local path="$1"
  local branch upstream counts ahead behind total

  while read -r branch upstream; do
    if [[ -z "$upstream" ]]; then
      continue
    fi

    counts=$(git -C "$path" rev-list --left-right --count "$branch...$upstream" 2>/dev/null || echo "0 0")
    read -r ahead behind <<< "$counts"
    total=$((ahead + behind))

    if [[ $total -gt 0 ]]; then
      return 0
    fi
  done < <(git -C "$path" for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads/)

  return 1
}

# Main execution
echo -e "🔍 Checking ${#REPOS[@]} repo(s), top $N branches by $SORT_LABEL:"
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
  repo_status_output=$(process_repo "$repo" "$display_path")
  repo_status_code=$?
  echo "$repo_status_output"

  if repo_has_divergent_branch "$repo"; then
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
