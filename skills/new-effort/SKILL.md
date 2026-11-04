---
name: new-effort
description: Start a new piece of work in its own git worktree ($WORKTREE_ROOT/<effort>, branch $BRANCH_PREFIX/<effort>). Use before writing any code for a new feature or fix, so parallel terminals never share a HEAD.
---

# /new-effort <effort-name>

Configuration comes from the kit env file (`${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}`, see the kit's `.env.example`). Load it first with `set -a; . "${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}"; set +a`. If a variable you need is unset, ask once instead of guessing.

Never edit in the main worktree (`$MAIN_WORKTREE`): it stays on `$DEFAULT_BRANCH`, clean. All work happens in `$WORKTREE_ROOT/<effort>`. Name it by the **effort** (`booking-canvas`), never by the terminal; terminals are fungible, efforts are not.

## Steps

1. **From the main worktree:**
   ```bash
   cd "$MAIN_WORKTREE"
   git fetch origin && git pull --ff-only

   # NEW effort:
   git worktree add -b "$BRANCH_PREFIX/<effort>" "$WORKTREE_ROOT/<effort>"
   # RESUME an existing origin branch instead:
   # git worktree add "$WORKTREE_ROOT/<effort>" "$BRANCH_PREFIX/<effort>"

   cd "$WORKTREE_ROOT/<effort>"
   ```
   A branch can only be checked out in one worktree at a time; git refusing is the point, it stops two terminals editing the same branch.

2. **Link the gitignored files the project needs to run** (`$LINK_PATHS`, e.g. `.env node_modules`). A fresh worktree lacks them. Use absolute targets so the link depth can't be miscounted. If the path is a *tracked* placeholder directory, remove that placeholder first, otherwise `ln -s` nests the link inside it:
   ```bash
   for p in $LINK_PATHS; do
     [ -e "$MAIN_WORKTREE/$p" ] || { echo "skip $p (absent in main)"; continue; }
     [ -L "$p" ] && continue
     [ -d "$p" ] && git ls-files --error-unmatch "$p" >/dev/null 2>&1 && rm -rf "$p"
     ln -s "$MAIN_WORKTREE/$p" "$p"
   done
   ```

3. **Check shared memory first**: read the relevant topic files in `$MEMORY_DIR` so you don't redo or contradict parallel work. `git worktree list` shows what other terminals have in flight.

4. **Stay current.** If the branch sits for days: `git fetch && git rebase origin/$DEFAULT_BRANCH` inside the worktree before opening the PR. All worktrees share one `.git`, so one fetch updates refs for everyone.

5. **When done:** push, `gh pr create --base $DEFAULT_BRANCH --fill`, run a code review, then `/land`.
