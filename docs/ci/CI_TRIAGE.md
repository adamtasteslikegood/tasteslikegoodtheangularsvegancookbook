# CI triage: platform or code?

Moved out of `CLAUDE.md` (KAN-416). `CLAUDE.md` keeps the two-line summary.

**A stuck or red run: platform or code? Read the jobs before the logs.** Two platform states look exactly like code failures from the PR view, and both cost real time in Sprint 8 (KAN-304):

The endpoint forms are `gh run view <id> --json status,conclusion` and `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`. Set `run_id` to the affected run's ID, the number after `/actions/runs/` in its URL. Don't take "the newest run": a PR starts several workflows (PR Gate, CodeQL, Dependency Review, Prettier) and the newest may be an unrelated one. The jobs call is paginated so "every job" is true:

```bash
run_id=36901421963   # replace with the affected run's ID
gh run view "$run_id" --json status,conclusion # the run as a whole
gh api --paginate "repos/{owner}/{repo}/actions/runs/${run_id}/jobs?per_page=100" \
  --jq '.jobs[] | "\(.status) \(.conclusion) \(.name)"' # every job in it
```

- **All jobs `queued`, none started** means no code ran: an Actions outage or runner shortage, or a scheduling limit (repository concurrency, unavailable runner labels, account or billing limits). It is not a code failure. Check githubstatus.com, repository concurrency, runner availability, and account limits; wait when GitHub or runner capacity is the cause. Re-pushing or editing code does not diagnose a job that never ran.
- **Run conclusion `action_required`** means the run never started: GitHub is holding it for approval because the workflow's triggering actor is not a collaborator (here, Copilot review events triggering the Junie workflow; the policy holds any non-collaborator actor). Who authored the PR does not decide it. It has no logs because nothing ran. Identify the workflow and whether it is required or blocking; approve it in the Actions tab only when it is, and otherwise leave the non-required held run alone.

For the two states above, diagnose the listed platform, scheduling, or approval causes. For any other conclusion where no job started, read the run annotations and inspect the workflow configuration first; startup and configuration errors can fail before a job exists. When a job did run and fail, read that job's logs.
