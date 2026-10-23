#!/bin/bash
################################################################################
# Git Workflow Script - Common Helpers, Validation, & AI Commit Generation
# Sourced by scripts/git/git-workflow.sh (KAN-467).
################################################################################

################################################################################
# COLORS & FORMATTING
################################################################################
readonly RED=$'\033[0;31m'
readonly GREEN=$'\033[0;32m'
readonly YELLOW=$'\033[1;33m'
readonly BLUE=$'\033[0;34m'
readonly MAGENTA=$'\033[0;35m'
readonly CYAN=$'\033[0;36m'
readonly BOLD=$'\033[1m'
readonly NC=$'\033[0m' # No Color

################################################################################
# HELPER FUNCTIONS
################################################################################

# All progress output goes to stderr: several functions return their value on
# stdout via $(...) and would otherwise capture these banners into it.
print_color() {
    local color=$1
    shift
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${color}$*${NC}" >&2
    fi
}

# Diagnostics are never gated on VERBOSE — -q must not silence the reason for an
# exit 1 — and always land on stderr.
print_diag() {
    local color=$1
    shift
    echo -e "${color}$*${NC}" >&2
}

print_header() {
    if [[ "$VERBOSE" == true ]]; then
        echo "" >&2
        echo -e "${YELLOW}==========================================" >&2
        echo "  $1" >&2
        echo -e "==========================================${NC}" >&2
        echo "" >&2
    fi
}

print_success() { print_color "$GREEN" "✅ $*"; }
print_info() { print_color "$BLUE" "ℹ️  $*"; }
print_warning() { print_diag "$YELLOW" "⚠️  $*"; }
print_error() { print_diag "$RED" "❌ $*"; }

confirm() {
    local prompt="$1"
    local response
    if [[ ! -t 0 ]]; then
        print_error "No terminal available to answer: ${prompt}"
        exit 1
    fi
    if ! read -rp "$(echo -e "${CYAN}${prompt} [y/N]:${NC} ")" response; then
        print_error "No input available for: ${prompt}"
        exit 1
    fi
    [[ "$response" =~ ^[Yy]$ ]]
}

get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

# git rev-parse --abbrev-ref prints the literal "HEAD" when detached, so test the
# state directly — committing on a detached HEAD orphans the commit.
is_detached_head() {
    ! git symbolic-ref --quiet HEAD >/dev/null 2>&1
}

is_clean_working_tree() {
    git diff-index --quiet HEAD -- 2>/dev/null
}

has_staged_changes() {
    ! git diff --cached --quiet 2>/dev/null
}

has_unstaged_changes() {
    ! git diff --quiet 2>/dev/null
}

has_untracked_files() {
    [[ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]]
}

branch_exists() {
    git rev-parse --verify "$1" >/dev/null 2>&1
}

remote_branch_exists() {
    git ls-remote --heads origin "$1" 2>/dev/null | grep -q "$1"
}

################################################################################
# VALIDATION FUNCTIONS
################################################################################

validate_git_repo() {
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
        print_error "Not a git repository. Please run from project root."
        exit 1
    fi
}

validate_submodules() {
    if [[ "$DO_SUBMODULE" != true ]]; then
        return 0
    fi

    for sm_path in "${DETECTED_SUBMODULES[@]}"; do
        if [[ ! -d "$sm_path" ]]; then
            print_error "Submodule directory '$sm_path' not found."
            print_error "Try: git submodule update --init${RECURSIVE:+ --recursive}"
            exit 1
        fi

        if [[ ! -d "$sm_path/.git" ]] && [[ ! -f "$sm_path/.git" ]]; then
            print_error "'$sm_path' is not a git repository."
            print_error "Try: git submodule update --init${RECURSIVE:+ --recursive}"
            exit 1
        fi
    done
}

# True when a submodule has nothing to commit AND nothing this run would push:
# a clean tree whose HEAD is already contained in some remote branch. Uses the
# local remote-tracking refs rather than fetching — this is a pre-flight, and
# assert_submodules_published still does the strict check before the parent
# commits a pointer.
submodule_is_noop() {
    local dir="$1" head
    [[ -z "$(git -C "$dir" status --porcelain 2>/dev/null)" ]] || return 1
    head=$(git -C "$dir" rev-parse HEAD 2>/dev/null) || return 1
    [[ -n "$(git -C "$dir" branch -r --contains "$head" 2>/dev/null)" ]]
}

# Pre-flight, run before ANY repo is touched: process_submodules commits and
# pushes every submodule before the main repo is reached, so a refusal
# discovered mid-flight would leave the tree half-published.
validate_branches() {
    local bad=0 branch sm_path

    if [[ "$DO_SUBMODULE" == true ]]; then
        for sm_path in "${DETECTED_SUBMODULES[@]}"; do
            # A submodule with nothing to commit and nothing to push is a no-op
            # for this run. Refusing it on branch identity alone would block the
            # most common submodule-spanning workflow in this repo — the pointer
            # bump, where Backend/ sits clean on `dev` (or detached at the pinned
            # SHA, as `git submodule update` leaves it) and only the parent has
            # work. The checks below are about what we are ABOUT TO WRITE.
            if submodule_is_noop "$PROJECT_ROOT/$sm_path"; then
                continue
            fi
            if ( cd "$PROJECT_ROOT/$sm_path" && is_detached_head ); then
                print_error "Submodule '$sm_path' is in detached HEAD — commits here would be orphaned."
                print_error "Fix: git -C $sm_path switch ${SUB_BRANCH:-dev}   (then re-run)"
                bad=1
                continue
            fi
            branch="$SUB_BRANCH"
            if [[ -z "$branch" ]]; then
                branch=$(git -C "$PROJECT_ROOT/$sm_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
            fi
            if [[ "$branch" =~ $PROTECTED_BRANCHES_RE ]] && [[ "$ALLOW_PROTECTED" != true ]]; then
                print_error "Refusing to commit/push directly to protected branch '$branch' in submodule '$sm_path'."
                bad=1
            fi
        done
    fi

    if [[ "$DO_MAIN" == true ]]; then
        if is_detached_head; then
            print_error "Main repository is in detached HEAD — commits here would be orphaned."
            print_error "Fix: git switch <branch>   (then re-run)"
            bad=1
        else
            branch="$MAIN_BRANCH"
            [[ -z "$branch" ]] && branch=$(get_current_branch)
            if [[ "$branch" =~ $PROTECTED_BRANCHES_RE ]] && [[ "$ALLOW_PROTECTED" != true ]]; then
                print_error "Refusing to commit/push directly to protected branch '$branch' in the main repo."
                bad=1
            fi
        fi
    fi

    if [[ $bad -eq 1 ]]; then
        print_error "Branch off dev first (git switch -c fix/<topic> origin/dev), or pass --allow-protected to override."
        exit 1
    fi
}

detect_submodules() {
    if [[ "$DO_SUBMODULE" != true ]]; then
        return 0
    fi

    local recursive_flag=""
    if [[ "$RECURSIVE" == true ]]; then
        recursive_flag="--recursive"
    fi

    # Read submodule paths from git
    local all_submodules=()
    local init_state=()
    while IFS= read -r line; do
        # git submodule status output: " <sha> <path> (<describe>)" or "-<sha> <path>"
        local sm_path
        sm_path=$(echo "$line" | awk '{print $2}')
        if [[ -n "$sm_path" ]]; then
            all_submodules+=("$sm_path")
            # A leading '-' means the submodule is not initialized
            if [[ "${line:0:1}" == "-" ]]; then
                init_state+=("uninit")
            else
                init_state+=("ok")
            fi
        fi
    done < <(git submodule status $recursive_flag 2>/dev/null)

    if [[ ${#all_submodules[@]} -eq 0 ]]; then
        print_warning "No submodules found in this repository"
        DO_SUBMODULE=false
        return 0
    fi

    # Apply filter if --submodule-path was specified
    if [[ ${#SUBMODULE_FILTER_PATHS[@]} -gt 0 ]]; then
        for filter_path in "${SUBMODULE_FILTER_PATHS[@]}"; do
            local found=false
            for sm_path in "${all_submodules[@]}"; do
                if [[ "$sm_path" == "$filter_path" ]]; then
                    DETECTED_SUBMODULES+=("$sm_path")
                    found=true
                    break
                fi
            done
            if [[ "$found" == false ]]; then
                print_error "Specified submodule '$filter_path' not found."
                print_error "Available submodules: ${all_submodules[*]}"
                exit 1
            fi
        done
    else
        # Default to the required submodule(s) only. Committing/pushing every
        # entry in .gitmodules would publish to optional third-party skill repos
        # (and abort outright when they are left uninitialized, as intended).
        local -a allow_list
        read -r -a allow_list <<< "${GIT_WORKFLOW_SUBMODULES:-Backend}"
        local i=0
        for sm_path in "${all_submodules[@]}"; do
            if [[ " ${allow_list[*]} " == *" $sm_path "* ]]; then
                DETECTED_SUBMODULES+=("$sm_path")
            elif [[ "${init_state[$i]}" == "ok" ]]; then
                print_info "Skipping non-allowlisted submodule '$sm_path' (use --submodule-path to include)"
            fi
            i=$((i + 1))
        done

        if [[ ${#DETECTED_SUBMODULES[@]} -eq 0 ]]; then
            print_warning "No allowlisted submodule found (looked for: ${allow_list[*]})"
            print_warning "Available: ${all_submodules[*]} — use --submodule-path or set GIT_WORKFLOW_SUBMODULES"
            DO_SUBMODULE=false
            return 0
        fi
    fi

    print_info "Detected ${#DETECTED_SUBMODULES[@]} submodule(s): ${DETECTED_SUBMODULES[*]}"
}

################################################################################
# AI COMMIT MESSAGE GENERATION
################################################################################

generate_ai_commit_message() {
    local diff_output="$1"
    local repo_name="$2"

    if [[ -z "$AI_API_KEY" ]]; then
        print_error "AI commit message generation requires OPENAI_API_KEY environment variable"
        print_error "Set it with: export OPENAI_API_KEY='your-key-here'"
        return 1
    fi

    print_info "Generating commit message using AI ($AI_MODEL)..."

    # Prepare the prompt
    local prompt="Based on the following git diff, generate a concise, conventional commit message (e.g., feat:, fix:, chore:, docs:).
Include a clear summary line and bullet points for key changes.

Git diff:
$diff_output

Generate a commit message following conventional commits format."

    # Create JSON payload
    local json_payload
    json_payload=$(jq -n \
        --arg model "$AI_MODEL" \
        --arg prompt "$prompt" \
        '{
            model: $model,
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant that generates clear, concise git commit messages following conventional commits format."
                },
                {
                    role: "user",
                    content: $prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 500
        }')

    # Make API request
    local response
    response=$(curl -s -X POST "$AI_ENDPOINT" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $AI_API_KEY" \
        -d "$json_payload")

    # Extract message from response
    local message
    message=$(echo "$response" | jq -r '.choices[0].message.content // empty')

    if [[ -z "$message" ]]; then
        print_error "Failed to generate AI commit message"
        print_error "API Response: $response"
        return 1
    fi

    echo "$message"
}
