---
name: land
description: Land an approved PR. Squash-merge, clean up branch and worktree, sync the main worktree, then hand off to /deploy-prod and /checkpoint. Use after review passes and CI is green.
---

# /land <PR-number-or-current-branch>

Configuration comes from the kit env file (`${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}`, see the kit's `.env.example`). Load it first with `set -a; . "${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}"; set +a`. If a variable you need is unset, ask once instead of guessing.

The post-approval ritual, done the same way every time. Preconditions: the PR exists, review findings are addressed, CI is green.

## Steps

1. **Identify the PR and branch.** With no argument, derive it from the current worktree's branch:
   `gh pr view --json number,headRefName,state,mergeable,statusCheckRollup`
   Abort and report (don't force) if checks are failing or the PR isn't mergeable.

2. **Squash-merge and delete the remote branch:**
   ```bash
   gh pr merge <N> --squash --delete-branch
   ```
   (The checkpoint hook will nudge you right after this runs.)

3. **Sync the main worktree** (never edit there, it is the sync surface):
   ```bash
   cd "$MAIN_WORKTREE"
   git pull --ff-only
   git log --oneline -1   # record this squash hash, the checkpoint needs it
   ```

4. **Remove the effort worktree and local branch:**
   ```bash
   git worktree remove "$WORKTREE_ROOT/<effort>"   # --force only if intentionally discarding dirt
   git branch -D "$BRANCH_PREFIX/<effort>"
   ```
   GOTCHA: squash-merged PRs make `git branch --merged` / `-d` claim the branch is unmerged. That is expected. Verify the merge with `gh pr list --state merged --json number,headRefName`, then use `-D`.

5. **Decide deploy.** Merged is not deployed. Either run `/deploy-prod` now or explicitly record "MERGED, NOT DEPLOYED". Never leave it ambiguous. Batching several merged PRs into one deploy in a quiet window is normal, not a failure to finish.

6. **Run `/checkpoint`** with: PR number, squash hash, deploy status, what was live-tested.
