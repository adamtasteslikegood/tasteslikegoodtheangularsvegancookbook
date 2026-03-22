# Agent Work Plan

## Project Principles

When working on this IntelliJ plugin project:
- **Write clean, well-formatted code** following Java/Kotlin best practices
- **Use IntelliJ tools first**: `intellij_read_file`, `intellij_write_file`, `search_symbols`, `find_references`
- **Always format and optimize** after changes: `format_code` + `optimize_imports`
- **Test before commit**: `build_project` + `run_tests` to ensure nothing breaks
- **Make logical commits**: Group related changes, separate unrelated changes

## Multi-Step Task Workflow

When fixing multiple issues:
1. Scan and group by problem TYPE (not by file)
2. Fix ONE problem type completely (may span multiple files)
3. Format, build, test, commit
4. ⚠️ **STOP and ASK** before continuing to next type

## Current Tasks

_Use checkboxes below to track your progress:_

- [ ] Task 1
- [ ] Task 2

## Notes

_Add any context, decisions, or findings here_