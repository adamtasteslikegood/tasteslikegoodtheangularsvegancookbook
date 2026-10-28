#!/bin/bash
################################################################################
# Git Workflow Script - Git Operations & Repository Workflow Functions
# Sourced by scripts/git/git-workflow.sh (KAN-467).
################################################################################

################################################################################
# GIT OPERATIONS
################################################################################

get_repo_status() {
    local repo_name=$1
    local repo_path=${2:-.}

    print_header "$repo_name Status"

    pushd "$repo_path" >/dev/null

    local current_branch
    current_branch=$(get_current_branch)

    print_info "Branch: $current_branch"
    print_info "Location: $(pwd)"
    echo ""

    if [[ "$VERBOSE" == true ]]; then
        git status
    else
        git status -s
    fi
    echo ""

    popd >/dev/null

    echo "$current_branch"
}

handle_unstaged_and_untracked() {
    local repo_name=$1

    # A dry run must not mutate the index, and must not open a staging prompt
    if [[ "$DRY_RUN" == true ]]; then
        if has_unstaged_changes || has_untracked_files; then
            print_info "[DRY RUN] Would prompt to stage unstaged/untracked files in $repo_name"
            git status --short >&2
        fi
        return 0
    fi

    # Fail closed rather than prompt into a closed stdin: silently falling back
    # to "only what is already staged" would produce a wrong commit.
    if [[ ! -t 0 ]]; then
        if { has_unstaged_changes && [[ "$PROMPT_FOR_UNSTAGED" == true ]]; } ||
           { has_untracked_files && [[ "$PROMPT_FOR_UNTRACKED" == true ]]; }; then
            if [[ "$STAGE_ALL_FLAG" != true ]]; then
                print_error "No terminal available to answer the staging prompt for $repo_name"
                print_error "Pass --all, --update, explicit FILES, or --no-prompt-unstaged/--no-prompt-untracked"
                exit 1
            fi
        fi
    fi

    # Check for unstaged changes
    if has_unstaged_changes && [[ "$PROMPT_FOR_UNSTAGED" == true ]] && [[ "$STAGE_ALL_FLAG" != true ]]; then
        echo ""
        print_warning "Unstaged changes detected in $repo_name"
        git status -s
        echo ""
        echo "Options:"
        echo "  1) Stage all changes (git add -A)"
        echo "  2) Stage tracked files only (git add -u)"
        echo "  3) Interactive staging (git add -i)"
        echo "  4) Skip staging (use only already staged files)"
        echo "  5) Abort"
        echo ""
        local choice
        if ! read -rp "$(echo -e "${CYAN}Choose an option [1-5]:${NC} ")" choice; then
            print_error "No input available for the staging prompt. Re-run with --all or --update."
            exit 1
        fi

        case $choice in
            1)
                git add -A || { print_error "git add -A failed in $repo_name"; exit 1; }
                print_success "Staged all changes"
                ;;
            2)
                git add -u || { print_error "git add -u failed in $repo_name"; exit 1; }
                print_success "Staged tracked files"
                ;;
            3)
                git add -i
                ;;
            4)
                print_info "Using only staged files"
                ;;
            5)
                print_error "Aborted by user"
                exit 1
                ;;
            *)
                print_error "Invalid choice. Aborting."
                exit 1
                ;;
        esac
        echo ""
    fi

    # Check for untracked files
    if has_untracked_files && [[ "$PROMPT_FOR_UNTRACKED" == true ]] && [[ "$STAGE_ALL_FLAG" != true ]]; then
        echo ""
        print_warning "Untracked files detected in $repo_name"
        git ls-files --others --exclude-standard
        echo ""
        if confirm "Stage untracked files?"; then
            git add -A || { print_error "git add -A failed in $repo_name"; exit 1; }
            print_success "Staged untracked files"
        else
            print_info "Untracked files will not be included in commit"
        fi
        echo ""
    fi
}

stage_files() {
    local repo_name=$1

    # Handle --all flag (stage everything no questions asked)
    if [[ "$STAGE_ALL_FLAG" == true ]]; then
        print_info "Staging all changes (--all flag)"
        # A partial `git add` exits non-zero while still staging the rest, which
        # would otherwise slip through as a partial commit.
        git add -A || { print_error "git add -A failed in $repo_name"; return 1; }
        echo "" >&2
        print_info "Staged changes:"
        git diff --cached --stat >&2
        echo "" >&2
        return 0
    fi

    # Handle specific files
    if [[ ${#ADDITIONAL_FILES[@]} -gt 0 ]]; then
        print_info "Staging specific files: ${ADDITIONAL_FILES[*]}"
        git add "${ADDITIONAL_FILES[@]}" || { print_error "git add failed in $repo_name"; return 1; }
    elif [[ "$STAGE_TRACKED_ONLY" == true ]]; then
        print_info "Staging tracked files only (git add -u)"
        git add -u || { print_error "git add -u failed in $repo_name"; return 1; }
    elif [[ "$STAGE_INTERACTIVE" == true ]]; then
        print_info "Interactive staging..."
        git add -i
    fi

    # Handle unstaged and untracked files with prompts
    handle_unstaged_and_untracked "$repo_name"

    echo ""
    if has_staged_changes; then
        print_info "Staged changes:"
        git diff --cached --stat
    else
        print_warning "No changes staged"
    fi
    echo ""
}

get_commit_message() {
    local repo_name=$1
    local is_submodule=$2
    local message=""

    # Priority order:
    # 1. Repo-specific message (SUB_MESSAGE or MAIN_MESSAGE)
    # 2. General COMMIT_MESSAGE
    # 3. Auto-generate from AI
    # 4. Prompt user or use editor

    if [[ "$is_submodule" == true ]] && [[ -n "$SUB_MESSAGE" ]]; then
        message="$SUB_MESSAGE"
    elif [[ "$is_submodule" == false ]] && [[ -n "$MAIN_MESSAGE" ]]; then
        message="$MAIN_MESSAGE"
    elif [[ -n "$COMMIT_MESSAGE" ]]; then
        message="$COMMIT_MESSAGE"
    elif [[ "$COMMIT_MESSAGE_AUTO" == true ]]; then
        local diff_output
        if [[ "$DRY_RUN" == true ]]; then
            # Nothing is staged during a dry run, so preview off the worktree diff
            diff_output=$(git diff HEAD)
        else
            diff_output=$(git diff --cached)
        fi
        if ! message=$(generate_ai_commit_message "$diff_output" "$repo_name") || [[ -z "$message" ]]; then
            print_error "Failed to generate AI commit message"
            # return, not exit: this runs inside $(...) so exit would only kill
            # the subshell and the caller would commit the diagnostic text.
            return 1
        fi
        print_success "Generated commit message:"
        # stderr — stdout of this function IS the commit message
        echo "$message" >&2
        echo "" >&2
        if [[ "$INTERACTIVE" == true ]]; then
            if ! confirm "Use this commit message?"; then
                print_info "Please enter commit message manually:"
                read -r message
            fi
        fi
    fi

    echo "$message"
}

commit_changes() {
    local repo_name=$1
    local branch=$2
    local is_submodule=${3:-false}

    print_header "Committing $repo_name"

    # The commit lands on whatever is checked out, but push_changes targets
    # "$branch" — a mismatch would publish a different ref than was committed.
    local actual_branch
    actual_branch=$(get_current_branch)
    if [[ "$actual_branch" != "$branch" ]]; then
        print_error "$repo_name is on '$actual_branch' but the requested branch is '$branch'"
        print_error "Refusing to commit: the commit would land on '$actual_branch' while the push targets 'origin/$branch'."
        print_error "Check out the intended branch, or drop the --main-branch/--sub-branch override."
        exit 1
    fi

    # Dry run must precede staging — `git add` here would mutate a real index
    if [[ "$DRY_RUN" == true ]]; then
        if [[ -z "$(git status --porcelain)" ]] && ! has_staged_changes; then
            print_warning "No changes to commit in $repo_name"
            return 1
        fi
        print_info "[DRY RUN] Would stage and commit to $repo_name ($branch):"
        git status --short >&2
        local msg
        msg=$(get_commit_message "$repo_name" "$is_submodule") || msg=""
        print_info "[DRY RUN] Message: ${msg:-<would use editor>}"
        return 0
    fi

    # Stage files first. A failed `git add` is a real failure, not a no-op:
    # committing after it would publish a partial change set.
    stage_files "$repo_name" || return "$RC_FAILED"

    # Check if there are changes to commit
    if ! has_staged_changes; then
        print_warning "No changes staged for commit in $repo_name"
        return 1
    fi

    if [[ "$INTERACTIVE" == true ]]; then
        echo ""
        print_info "Ready to commit to $repo_name ($branch)"
        print_info "Staged files:"
        git diff --cached --name-status
        echo ""
        if ! confirm "Proceed with commit?"; then
            print_warning "Skipping commit for $repo_name"
            return 1
        fi
    fi

    # Determine how to commit
    local message
    if ! message=$(get_commit_message "$repo_name" "$is_submodule"); then
        print_error "Could not determine a commit message for $repo_name"
        exit 1
    fi

    # commit_changes is always called from an `if`, which disables errexit for
    # everything below it — so every git commit needs its own status check.
    local commit_status=0
    if [[ -n "$COMMIT_MESSAGE_FILE" ]]; then
        # Commit with message from file
        git commit -F "$COMMIT_MESSAGE_FILE" || commit_status=$?
    elif [[ -n "$message" ]]; then
        # Commit with provided message
        git commit -m "$message" || commit_status=$?
    elif [[ "$USE_GIT_EDITOR" == true ]]; then
        # Use editor (default git behavior)
        if [[ "$STAGE_ALL_FLAG" == true ]]; then
            git commit --all --verbose || commit_status=$?
        else
            git commit --verbose || commit_status=$?
        fi
    elif [[ -n "$COMMIT_MESSAGE_EDITOR" ]]; then
        # Use specific editor
        EDITOR="$COMMIT_MESSAGE_EDITOR" git commit || commit_status=$?
    else
        # Default: use git's default editor
        git commit --verbose || commit_status=$?
    fi

    if (( commit_status != 0 )); then
        print_error "Commit FAILED in $repo_name (git commit exited $commit_status)"
        print_warning "Changes remain staged; nothing was pushed for $repo_name."
        return "$RC_FAILED"
    fi

    print_success "Committed to $repo_name"
    print_info "Latest commit:"
    git log --oneline -1
    echo ""

    return 0
}

push_changes() {
    local repo_name=$1
    local branch=$2

    print_header "Pushing $repo_name"

    # Defense in depth for the --main-branch/--sub-branch overrides and the
    # interactive branch prompts, both of which run after the pre-flight check.
    if [[ "$branch" == "HEAD" ]] || [[ -z "$branch" ]]; then
        print_error "Refusing to push $repo_name: detached HEAD has no branch to publish"
        return "$RC_FAILED"
    fi
    if [[ "$branch" =~ $PROTECTED_BRANCHES_RE ]] && [[ "$ALLOW_PROTECTED" != true ]]; then
        print_error "Refusing to push $repo_name to protected branch origin/$branch"
        print_error "Open a PR instead, or pass --allow-protected."
        return "$RC_FAILED"
    fi
    if [[ "$(get_current_branch)" != "$branch" ]]; then
        print_error "Refusing to push $repo_name: HEAD is '$(get_current_branch)', push target is '$branch'"
        return "$RC_FAILED"
    fi

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would push $repo_name to origin/$branch"
        if [[ "$FORCE_OPERATIONS" == true ]]; then
            print_warning "[DRY RUN] With --force flag"
        fi
        return 0
    fi

    # Safety check for protected branches with force
    if [[ "$FORCE_OPERATIONS" == true ]] && [[ "$branch" =~ $PROTECTED_BRANCHES_RE ]]; then
        print_error "Refusing to force push to $branch branch!"
        print_warning "This is extremely dangerous and can destroy team history."
        if [[ "$INTERACTIVE" == true ]]; then
            if ! confirm "Are you ABSOLUTELY sure you want to force push to $branch?"; then
                print_warning "Skipping force push for $repo_name"
                return 1
            fi
        else
            print_error "Use --interactive flag to confirm force push to $branch"
            return "$RC_FAILED"
        fi
    fi

    # Check if remote branch exists
    if ! remote_branch_exists "$branch"; then
        print_warning "Remote branch 'origin/$branch' does not exist"
        if [[ "$INTERACTIVE" == true ]] || [[ "$CONFIRM_PUSH" == true ]]; then
            if confirm "Create new remote branch 'origin/$branch'?"; then
                git push -u origin "$branch" || {
                    print_error "Push FAILED for $repo_name (origin/$branch, new branch)"
                    return "$RC_FAILED"
                }
                print_success "Pushed $repo_name to origin/$branch (new branch)"
                return 0
            else
                print_warning "Skipping push for $repo_name"
                return 1
            fi
        else
            print_info "Creating new remote branch 'origin/$branch'"
            git push -u origin "$branch" || {
                print_error "Push FAILED for $repo_name (origin/$branch, new branch)"
                return "$RC_FAILED"
            }
            print_success "Pushed $repo_name to origin/$branch (new branch)"
            return 0
        fi
    fi

    if [[ "$INTERACTIVE" == true ]] || [[ "$CONFIRM_PUSH" == true ]]; then
        echo ""
        print_info "Ready to push $repo_name to origin/$branch"
        if [[ "$FORCE_OPERATIONS" == true ]]; then
            print_warning "This will be a FORCE PUSH!"
        fi
        if ! confirm "Proceed with push?"; then
            print_warning "Skipping push for $repo_name"
            return 1
        fi
    fi

    # Perform push
    if [[ "$FORCE_OPERATIONS" == true ]]; then
        print_warning "Force pushing $repo_name..."
        git push --force origin "$branch" || {
            print_error "Force push FAILED for $repo_name (origin/$branch)"
            return "$RC_FAILED"
        }
        print_success "Force pushed $repo_name to origin/$branch"
    else
        git push origin "$branch" || {
            print_error "Push FAILED for $repo_name (origin/$branch)"
            return "$RC_FAILED"
        }
        print_success "Pushed $repo_name to origin/$branch"
    fi
    echo ""

    return 0
}

pull_changes() {
    local repo_name=$1
    local branch=$2

    print_info "Pulling latest changes for $repo_name..."

    if [[ "$DRY_RUN" == true ]]; then
        print_info "[DRY RUN] Would pull $repo_name from origin/$branch"
        return 0
    fi

    # Check if working tree is clean
    if ! is_clean_working_tree; then
        print_warning "Working tree is dirty in $repo_name"
        if [[ "$INTERACTIVE" == true ]]; then
            if confirm "Stash changes before pull?"; then
                git stash push -m "Auto-stash before pull by git-workflow.sh"
                print_info "Changes stashed"
            else
                print_error "Cannot pull with dirty working tree"
                return 1
            fi
        else
            print_error "Cannot pull with dirty working tree. Use --interactive or commit/stash changes."
            return 1
        fi
    fi

    if [[ "$PULL_REBASE" == true ]]; then
        git pull --rebase origin "$branch"
    else
        git pull origin "$branch"
    fi

    print_success "Pulled latest changes for $repo_name"
    echo ""
}

################################################################################
# WORKFLOW FUNCTIONS
################################################################################

process_submodules() {
    if [[ "$DO_SUBMODULE" != true ]]; then
        return 0
    fi

    if [[ ${#DETECTED_SUBMODULES[@]} -eq 0 ]]; then
        return 0
    fi

    for sm_path in "${DETECTED_SUBMODULES[@]}"; do
        local sm_name
        sm_name=$(basename "$sm_path")

        print_header "Processing Submodule: $sm_path"

        cd "$PROJECT_ROOT/$sm_path"

        # Auto-detect branch (--sub-branch overrides all)
        local branch="$SUB_BRANCH"
        if [[ -z "$branch" ]]; then
            branch=$(get_current_branch)
            print_info "Auto-detected branch for $sm_path: $branch"
        fi

        # Interactive branch confirmation
        if [[ "$INTERACTIVE" == true ]]; then
            local response
            if ! read -rp "$(echo -e "${CYAN}Branch for $sm_path [$branch]:${NC} ")" response; then
                print_error "No input available for the branch prompt in $sm_path"
                exit 1
            fi
            if [[ -n "$response" ]]; then
                branch="$response"
            fi
        fi

        # Pull before if requested
        if [[ "$PULL_BEFORE" == true ]]; then
            pull_changes "$sm_path" "$branch"
        fi

        # Show status
        get_repo_status "$sm_path" "." >/dev/null

        # Commit
        local committed=false
        if [[ "$DO_COMMIT" == true ]]; then
            if commit_changes "$sm_path" "$branch" true; then
                committed=true
                COMMITTED_SUBMODULES+=("$sm_path")
            else
                note_status $? "commit in submodule '$sm_path'" || true
            fi
        fi

        # Push whenever the remote is missing this submodule's HEAD — not only
        # when THIS run created a commit. Otherwise a previously-committed but
        # unpushed submodule gets pinned by the parent as a dangling gitlink.
        if [[ "$DO_PUSH" == true ]]; then
            local sm_head
            sm_head=$(git rev-parse HEAD)
            if [[ "$committed" == true ]] || ! git merge-base --is-ancestor "$sm_head" "origin/$branch" 2>/dev/null; then
                push_changes "$sm_path" "$branch" || note_status $? "push of submodule '$sm_path' to origin/$branch" || true
            fi
        fi

        cd "$PROJECT_ROOT"
    done
}

# Invariant: the parent must never publish a pointer to a commit the submodule
# remote cannot serve (Cloud Build clones fail with "reference is not a tree").
assert_submodules_published() {
    if [[ "$DO_SUBMODULE" != true ]]; then
        return 0
    fi

    local sm_path head_sha sm_branch
    for sm_path in "${DETECTED_SUBMODULES[@]}"; do
        head_sha=$(git -C "$PROJECT_ROOT/$sm_path" rev-parse HEAD)
        sm_branch=$(git -C "$PROJECT_ROOT/$sm_path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
        if [[ -n "$sm_branch" ]] && [[ "$sm_branch" != "HEAD" ]]; then
            git -C "$PROJECT_ROOT/$sm_path" fetch -q origin "$sm_branch" 2>/dev/null || true
        fi
        if ! git -C "$PROJECT_ROOT/$sm_path" branch -r --contains "$head_sha" 2>/dev/null | grep -q .; then
            if [[ "$DRY_RUN" == true ]]; then
                print_warning "[DRY RUN] $sm_path@${head_sha:0:8} is not on any remote branch — a real run would refuse to commit the parent pointer"
                continue
            fi
            print_error "Refusing to commit parent pointer: $sm_path@${head_sha:0:8} is not on any remote branch."
            print_error "Push $sm_path first, or re-run with --no-main."
            exit 1
        fi
    done
}

process_main_repo() {
    if [[ "$DO_MAIN" != true ]]; then
        return 0
    fi

    print_header "Processing Main Repository"

    cd "$PROJECT_ROOT"

    # Auto-detect branch if not specified
    if [[ -z "$MAIN_BRANCH" ]]; then
        MAIN_BRANCH=$(get_current_branch)
        print_info "Auto-detected main branch: $MAIN_BRANCH"
    fi

    # Interactive branch confirmation
    if [[ "$INTERACTIVE" == true ]]; then
        local response
        if ! read -rp "$(echo -e "${CYAN}Main repo branch [$MAIN_BRANCH]:${NC} ")" response; then
            print_error "No input available for the main repo branch prompt"
            exit 1
        fi
        if [[ -n "$response" ]]; then
            MAIN_BRANCH="$response"
        fi
    fi

    # Pull before if requested
    if [[ "$PULL_BEFORE" == true ]]; then
        pull_changes "Main Repo" "$MAIN_BRANCH"
    fi

    # Show status
    get_repo_status "Main Repository" "." >/dev/null

    # `git add -A` below stages moved gitlinks regardless of COMMITTED_SUBMODULES,
    # so the published-pointer gate has to run for every detected submodule.
    assert_submodules_published

    # If any submodules were committed, update their references
    if [[ ${#COMMITTED_SUBMODULES[@]} -gt 0 ]]; then
        print_info "Updating submodule references in main repo..."
        for sm_path in "${COMMITTED_SUBMODULES[@]}"; do
            if [[ "$DRY_RUN" == true ]]; then
                print_info "  [DRY RUN] Would update reference: $sm_path"
            else
                git add "$sm_path"
                print_info "  Updated reference: $sm_path"
            fi
        done
    fi

    # Commit
    if [[ "$DO_COMMIT" == true ]]; then
        if commit_changes "Main Repository" "$MAIN_BRANCH" false; then
            MAIN_COMMITTED=true
        else
            note_status $? "commit in the main repository" || true
        fi
    fi

    # Push
    if [[ "$DO_PUSH" == true ]] && [[ "$MAIN_COMMITTED" == true ]]; then
        push_changes "Main Repository" "$MAIN_BRANCH" || note_status $? "push of the main repository to origin/$MAIN_BRANCH" || true
    fi
}
