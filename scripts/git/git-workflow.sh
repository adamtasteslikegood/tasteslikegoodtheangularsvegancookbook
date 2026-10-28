#!/bin/bash

################################################################################
# Git Workflow Script - Multi-Submodule & Main Repo Management
################################################################################
# Manages commits and pushes across ALL submodules and the main repository.
# Works with any git repo — auto-detects submodules at runtime.
# Supports --recursive for nested submodule trees.
#
# Usage: ./git-workflow.sh [OPTIONS]
# Example: ./git-workflow.sh -i -m "feat: new feature"
# Example: ./git-workflow.sh --no-submodule --push
# Example: ./git-workflow.sh --all -m "chore: update all"
# Example: ./git-workflow.sh --recursive -m "chore: update everything"
# Example: ./git-workflow.sh --submodule-path Backend -m "fix: backend only"
################################################################################

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Disable pagers for all git commands in this script
export GIT_PAGER=cat

################################################################################
# DEFAULT CONFIGURATION
################################################################################
INTERACTIVE=false
VERBOSE=true
DRY_RUN=false

# What to process
DO_SUBMODULE=true
DO_MAIN=true

# Operations
DO_COMMIT=true
DO_PUSH=true
PUSH_EXPLICIT=false
CONFIRM_PUSH=false
COMMIT_ONLY=false
FORCE_OPERATIONS=false
ALLOW_PROTECTED=false

# Branches that must be changed through a PR, never by a direct commit/push
readonly PROTECTED_BRANCHES_RE='^(main|master|dev)$'

# Run-level failure state. commit_changes/push_changes distinguish two kinds of
# non-zero return:
#   1  benign no-op — nothing to commit, user declined at a prompt
#   2  the operation was requested and did NOT happen
# Only the second sets this flag. Without it the script printed
# "All operations completed successfully!" and exited 0 after a rejected commit
# or a fatal push, which is how a caller (or a release-train step) proceeds on
# work that was never published.
RUN_FAILED=false
RUN_FAILURES=()
readonly RC_NOOP=1
readonly RC_FAILED=2

record_failure() {
    RUN_FAILED=true
    RUN_FAILURES+=("$1")
}

# Consume a commit_changes/push_changes status: record real failures, ignore
# benign no-ops. Returns the original status so callers can still branch on it.
note_status() {
    local status=$1 what=$2
    if (( status >= RC_FAILED )); then
        record_failure "$what"
    fi
    return "$status"
}

# Branches (auto-detected by default)
MAIN_BRANCH=""
SUB_BRANCH=""

# Commit message options
COMMIT_MESSAGE=""
COMMIT_MESSAGE_FILE=""
COMMIT_MESSAGE_EDITOR=""
COMMIT_MESSAGE_AUTO=false
SUB_MESSAGE=""
MAIN_MESSAGE=""
USE_GIT_EDITOR=false

# Hooks
RUN_BEFORE=""
RUN_AFTER=""
PULL_BEFORE=false
PULL_REBASE=false

# Paths — submodule filtering (empty = all detected submodules)
SUBMODULE_FILTER_PATHS=()
RECURSIVE=false
PROJECT_ROOT=""

# Populated at runtime by detect_submodules()
DETECTED_SUBMODULES=()
COMMITTED_SUBMODULES=()

# Staging behavior
STAGE_ALL_FLAG=false
STAGE_TRACKED_ONLY=false
STAGE_INTERACTIVE=false
PROMPT_FOR_UNSTAGED=true
PROMPT_FOR_UNTRACKED=true
ADDITIONAL_FILES=()

# AI Configuration for auto-generation
AI_MODEL="${OPENAI_MODEL:-gpt-4}"
AI_API_KEY="${OPENAI_API_KEY:-}"
AI_ENDPOINT="${OPENAI_ENDPOINT:-https://api.openai.com/v1/chat/completions}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=lib/operations.sh
source "${SCRIPT_DIR}/lib/operations.sh"

################################################################################
# MAIN EXECUTION
################################################################################

show_usage() {
    cat << EOF
${BOLD}Git Workflow Script - Submodule & Main Repo Management${NC}

${BOLD}USAGE:${NC}
    $0 [OPTIONS]

${BOLD}DESCRIPTION:${NC}
    Manages git commits and pushes across all submodules and the main repository.
    Works with any git repo — auto-detects submodules at runtime.
    Default workflow: per submodule (stage → commit → push), then main repo
    (stage submodule refs → stage files → commit → push). Submodules are always
    pushed before the parent pointer commit.

${BOLD}OPTIONS:${NC}
    ${BOLD}Mode:${NC}
    -i, --interactive           Interactive mode (prompts at each step)
    -n, --dry-run              Show what would happen without executing
    -q, --quiet                Minimal output
    -v, --verbose              Verbose output (default)
    -h, --help                 Show this help message

    ${BOLD}Repository Selection:${NC}
    --main                     Process main repo only
    --no-main                  Skip main repo
    --submodule                Process submodule(s) only
    --no-submodule             Skip all submodules
    --submodule-path PATH      Process only this submodule (repeatable)
    -r, --recursive            Include nested submodules (recursive)

    ${BOLD}Operations:${NC}
    --commit-only              Only commit, don't push (order-independent)
    --push                     Enable pushing (default)
    --no-push                  Disable pushing
    --confirm-push             Confirm before each push
    --force                    Force push (use with extreme caution!)
    --allow-protected          Break-glass: permit direct commit/push to
                               main/master/dev. Normal flow uses PRs
                               (dev→main, merge commit), never direct pushes.
    --all                      Stage all changes without prompts (git add -A)

    ${BOLD}Branches:${NC}
    --main-branch BRANCH       Main repo branch (default: current)
    --sub-branch BRANCH        Submodule branch (default: current)

    ${BOLD}Commit Message:${NC}
    -m, --message MSG          Commit message for both repos
    --sub-message MSG          Commit message for submodule only
    --main-message MSG         Commit message for main repo only
    -F, --file FILE            Read commit message from file
    --editor [EDITOR]          Use editor for commit message (default: git config)
    --auto, --generate         Auto-generate commit message using AI
                               Requires OPENAI_API_KEY environment variable

    ${BOLD}Staging:${NC}
    -a, --all                  Stage all changes without prompts (git add -A)
    -u, --update               Stage tracked files only (git add -u)
    -p, --patch                Interactive staging (git add -i)
    --no-prompt-unstaged       Don't prompt for unstaged files
    --no-prompt-untracked      Don't prompt for untracked files
    FILES...                   Stage specific files (as final arguments)

    ${BOLD}Hooks:${NC}
    --run-before CMD           Execute command before workflow
    --run-after CMD            Execute command after workflow
    --pull-before              Pull before committing
    --pull-rebase              Use rebase when pulling

${BOLD}EXAMPLES:${NC}
    ${BOLD}Basic usage:${NC}
    # Default: prompt for staging, use editor, commit all submodules + main
    $0

    # Commit with message (automatically enables push)
    $0 -m "feat: add new feature"

    # Stage all and commit everything with message
    $0 --all -m "chore: update all files"

    # Interactive mode with custom message
    $0 -i -m "feat: add authentication"

    # Include nested submodules
    $0 --recursive --all -m "chore: update everything"

    ${BOLD}Advanced usage:${NC}
    # Commit only, no push
    $0 --commit-only -m "wip: work in progress"

    # Main repo only, specific branch
    $0 --no-submodule --main-branch dev/feature -m "docs: update README"

    # Only process a specific submodule
    $0 --submodule-path Backend -m "fix: backend bug"

    # Multiple specific submodules
    $0 --submodule-path Backend --submodule-path libs/shared -m "chore: update"

    # Different messages for submodule and main
    $0 --sub-message "fix: backend bug" --main-message "chore: update backend ref"

    # AI-generated commit message
    $0 --auto --all

    # Pull before, then commit and push both
    $0 --pull-before -m "chore: sync and update"

    ${BOLD}Force operations (DANGEROUS):${NC}
    # Force push (will prompt for confirmation on main/master)
    $0 --force -m "fix: corrected history" --confirm-push

    ${BOLD}Custom hooks:${NC}
    # Run tests before committing
    $0 --run-before "npm test" -m "feat: new feature"

    # With editor
    $0 --editor vim --all

${BOLD}ENVIRONMENT VARIABLES:${NC}
    OPENAI_API_KEY      API key for AI commit message generation
    OPENAI_MODEL        Model to use (default: gpt-4)
    OPENAI_ENDPOINT     API endpoint (default: OpenAI)
    GIT_WORKFLOW_SUBMODULES
                        Space-separated submodule allowlist processed when no
                        --submodule-path is given (default: "Backend")

${BOLD}WORKFLOW ORDER:${NC}
    1. Run --run-before command (if specified)
    2. Pull changes (if --pull-before specified)
    3. Process Each Submodule (in order detected):
       - Check status
       - Stage files (with prompts or --all)
       - Commit
       - Push (if enabled)
    4. Process Main Repository:
       - Check status
       - Update submodule references (for any submodules that changed)
       - Stage files
       - Commit
       - Push (if enabled)
    5. Run --run-after command (if specified)

EOF
}

parse_arguments() {
    local parsing_files=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -i|--interactive)
                INTERACTIVE=true
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -q|--quiet)
                VERBOSE=false
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            --main)
                DO_MAIN=true
                DO_SUBMODULE=false
                shift
                ;;
            --no-main)
                DO_MAIN=false
                shift
                ;;
            --submodule)
                DO_SUBMODULE=true
                DO_MAIN=false
                shift
                ;;
            --no-submodule)
                DO_SUBMODULE=false
                shift
                ;;
            --submodule-path)
                SUBMODULE_FILTER_PATHS+=("$2")
                shift 2
                ;;
            -r|--recursive)
                RECURSIVE=true
                shift
                ;;
            --commit-only)
                COMMIT_ONLY=true
                DO_PUSH=false
                shift
                ;;
            --push)
                DO_PUSH=true
                PUSH_EXPLICIT=true
                shift
                ;;
            --no-push)
                DO_PUSH=false
                PUSH_EXPLICIT=true
                shift
                ;;
            --confirm-push)
                CONFIRM_PUSH=true
                shift
                ;;
            --force)
                FORCE_OPERATIONS=true
                shift
                ;;
            --allow-protected)
                ALLOW_PROTECTED=true
                shift
                ;;
            --main-branch)
                MAIN_BRANCH="$2"
                shift 2
                ;;
            --sub-branch)
                SUB_BRANCH="$2"
                shift 2
                ;;
            -m|--message)
                COMMIT_MESSAGE="$2"
                # Pushing is already the default; -m must not silently undo an
                # earlier --no-push/--commit-only just because of argument order.
                shift 2
                ;;
            --sub-message)
                SUB_MESSAGE="$2"
                shift 2
                ;;
            --main-message)
                MAIN_MESSAGE="$2"
                shift 2
                ;;
            -F|--file)
                COMMIT_MESSAGE_FILE="$2"
                shift 2
                ;;
            --editor)
                if [[ -n "${2:-}" ]] && [[ ! "$2" =~ ^- ]]; then
                    COMMIT_MESSAGE_EDITOR="$2"
                    shift 2
                else
                    USE_GIT_EDITOR=true
                    shift
                fi
                ;;
            --auto|--generate)
                COMMIT_MESSAGE_AUTO=true
                shift
                ;;
            -a|--all)
                STAGE_ALL_FLAG=true
                PROMPT_FOR_UNSTAGED=false
                PROMPT_FOR_UNTRACKED=false
                shift
                ;;
            -u|--update)
                STAGE_TRACKED_ONLY=true
                shift
                ;;
            -p|--patch)
                STAGE_INTERACTIVE=true
                shift
                ;;
            --no-prompt-unstaged)
                PROMPT_FOR_UNSTAGED=false
                shift
                ;;
            --no-prompt-untracked)
                PROMPT_FOR_UNTRACKED=false
                shift
                ;;
            --run-before)
                RUN_BEFORE="$2"
                shift 2
                ;;
            --run-after)
                RUN_AFTER="$2"
                shift 2
                ;;
            --pull-before)
                PULL_BEFORE=true
                shift
                ;;
            --pull-rebase)
                PULL_REBASE=true
                PULL_BEFORE=true
                shift
                ;;
            --)
                # Everything after -- is treated as files
                shift
                parsing_files=true
                ;;
            -*)
                print_error "Unknown option: $1"
                echo "Use --help for usage information" >&2
                exit 1
                ;;
            *)
                # Treat remaining args as files to stage
                ADDITIONAL_FILES+=("$1")
                shift
                ;;
        esac
    done
}

main() {
    # Parse command line arguments
    parse_arguments "$@"

    # Resolve push intent order-independently
    if [[ "$COMMIT_ONLY" == true ]]; then
        if [[ "$PUSH_EXPLICIT" == true ]] && [[ "$DO_PUSH" == true ]]; then
            print_error "--commit-only and --push are mutually exclusive"
            exit 1
        fi
        DO_PUSH=false
    fi

    # Headless pre-flight: refuse the paths that can only end at a prompt or an
    # editor that cannot open, before anything is staged, committed or pushed.
    if [[ ! -t 0 ]]; then
        if [[ "$INTERACTIVE" == true ]]; then
            print_error "--interactive requires a terminal"
            exit 1
        fi
        if [[ "$STAGE_INTERACTIVE" == true ]]; then
            print_error "--patch (git add -i) requires a terminal"
            exit 1
        fi
        if [[ "$DO_COMMIT" == true ]] &&
           [[ -z "$COMMIT_MESSAGE$SUB_MESSAGE$MAIN_MESSAGE$COMMIT_MESSAGE_FILE" ]] &&
           [[ "$COMMIT_MESSAGE_AUTO" != true ]]; then
            print_error "No commit message supplied and no terminal available for an editor"
            print_error "Pass -m, --sub-message/--main-message, -F, or --auto"
            exit 1
        fi
    fi

    if [[ "$COMMIT_MESSAGE_AUTO" == true ]] && [[ -z "$AI_API_KEY" ]]; then
        print_error "--auto requires the OPENAI_API_KEY environment variable"
        exit 1
    fi

    # Store project root
    PROJECT_ROOT=$(pwd)

    # Validation
    validate_git_repo
    detect_submodules
    validate_submodules
    validate_branches

    # Track what was committed
    MAIN_COMMITTED=false

    # Show configuration in interactive mode
    if [[ "$INTERACTIVE" == true ]]; then
        print_header "Configuration"
        print_info "Submodules: $([ "$DO_SUBMODULE" == true ] && echo "✓ (${#DETECTED_SUBMODULES[@]} found)" || echo "✗")"
        if [[ "$DO_SUBMODULE" == true ]] && [[ ${#DETECTED_SUBMODULES[@]} -gt 0 ]]; then
            for sm in "${DETECTED_SUBMODULES[@]}"; do
                print_info "  - $sm"
            done
        fi
        print_info "Recursive: $([ "$RECURSIVE" == true ] && echo "✓" || echo "✗")"
        print_info "Main repo: $([ "$DO_MAIN" == true ] && echo "✓" || echo "✗")"
        print_info "Commit: $([ "$DO_COMMIT" == true ] && echo "✓" || echo "✗")"
        print_info "Push: $([ "$DO_PUSH" == true ] && echo "✓" || echo "✗")"
        print_info "Pull before: $([ "$PULL_BEFORE" == true ] && echo "✓" || echo "✗")"
        print_info "Stage all: $([ "$STAGE_ALL_FLAG" == true ] && echo "✓" || echo "✗")"
        print_info "Force operations: $([ "$FORCE_OPERATIONS" == true ] && echo "✓ (DANGEROUS)" || echo "✗")"
        print_info "Allow protected branches: $([ "$ALLOW_PROTECTED" == true ] && echo "✓ (DANGEROUS)" || echo "✗")"
        echo ""
        if ! confirm "Continue with this configuration?"; then
            print_warning "Aborted by user"
            exit 0
        fi
    fi

    # Display header
    print_header "Git Workflow Script"
    if [[ "$DRY_RUN" == true ]]; then
        print_info "DRY RUN MODE - No changes will be made"
    fi

    # Run before hook
    if [[ -n "$RUN_BEFORE" ]]; then
        print_info "Executing pre-workflow command: $RUN_BEFORE"
        if [[ "$DRY_RUN" != true ]]; then
            eval "$RUN_BEFORE"
        fi
        echo ""
    fi

    # Execute workflow
    process_submodules
    process_main_repo

    # Run after hook
    if [[ -n "$RUN_AFTER" ]]; then
        print_info "Executing post-workflow command: $RUN_AFTER"
        if [[ "$DRY_RUN" != true ]]; then
            eval "$RUN_AFTER"
        fi
        echo ""
    fi

    # Final summary
    print_header "Workflow Complete"

    if [[ "$DO_SUBMODULE" == true ]] && [[ ${#DETECTED_SUBMODULES[@]} -gt 0 ]]; then
        for sm_path in "${DETECTED_SUBMODULES[@]}"; do
            cd "$PROJECT_ROOT/$sm_path"
            print_info "$sm_path latest commits:"
            git log --oneline -3
            echo ""
            cd "$PROJECT_ROOT"
        done
    fi

    if [[ "$DO_MAIN" == true ]]; then
        print_info "Main repo latest commits:"
        git log --oneline -3
        echo ""
    fi

    if [[ "$RUN_FAILED" == true ]]; then
        print_error "Run FAILED — ${#RUN_FAILURES[@]} operation(s) did not complete:"
        local failure
        for failure in "${RUN_FAILURES[@]}"; do
            print_error "  - $failure"
        done
        if [[ "$DRY_RUN" == true ]]; then
            print_info "This was a DRY RUN - no actual changes were made"
        fi
        exit 1
    fi

    print_success "All operations completed successfully!"

    if [[ "$DRY_RUN" == true ]]; then
        print_info "This was a DRY RUN - no actual changes were made"
    fi
}

# Run main function with all arguments
main "$@"
