# Working on many terminals at once: git worktrees

## The problem

If every terminal shares one working folder, they share one HEAD. A `git checkout` in terminal A
yanks the rug out from terminal B, uncommitted edits from different efforts intermingle, and a
deploy from `main` can sweep in someone else's half-finished work.

## The fix

One repository, many working folders. Each worktree has its own branch and HEAD, but all share one
`.git` (one object store, one `git fetch`). Switching branches in one worktree affects none of the
others. One desk each, one shared filing cabinet.

```
$MAIN_WORKTREE/        main worktree: stays on the default branch, CLEAN, sync only
$WORKTREE_ROOT/
  <effort>/            one folder per active piece of work, branch <prefix>/<effort>
```

Name a worktree by the **effort**, not the terminal. A terminal just `cd`s into whichever worktree
matches what it is doing.

**Golden rule: never edit in the main worktree.** Pull, read live state and fetch there; all code
happens in `$WORKTREE_ROOT/<effort>`. This is what keeps the default branch clean and shippable.

## Lifecycle (each step has a skill)

```
/new-effort   git worktree add -b feat/<effort> $WORKTREE_ROOT/<effort>
   |          edit, commit inside the worktree
   v
push branch -> open PR -> code review
   |
/land         squash-merge, delete remote branch, pull main, remove worktree + local branch
   |
/deploy-prod  staging first (default), then prod; verify HEAD == origin, health 200
   |
verify-effects  check what the deploy DID at each boundary
   |
/checkpoint   write the verified result to shared memory
```

Prod only ever pulls the default branch, and that branch only advances through a merged PR, so
half-finished branch work physically cannot ship.

## Staging first, risk decides how long

Merged is not deployed. Every change soaks on staging before prod; risk decides how *long*, not
whether. Low-risk (docs, UI copy, anything flagged dark) needs a green gate and a quick look.
High-risk (core pipeline, state machines, schema, anything a live user depends on) gets driven by
hand and watched in logs first. Deploy in quiet windows and batch merged PRs. Rollback must be one
command on every stack.

## Verify the EFFECT, not just the delivery

"Prod HEAD == origin" and "health 200" only prove the app code in the image shipped. Everything
else needs its effect checked at its own boundary:

| Layer | `git log` proves it? | Check the effect with |
|---|---|---|
| App code (in image) | yes | prod HEAD == origin default branch |
| Edge / bind-mounted config | **no** (can be pinned to an old inode) | request the edge, assert the header |
| Env-gated flags | **no** | boot log shows `status:"on"` and the env key is present |
| Separately deployed web | **no** | fetch the live page, not the build output |
| Hand-placed secrets | **no** | has it ever completed one successful run? |

`verify-effects` runs the table as one command. When you *deliberately* turn something on, say so
(`--expect-on <flag>`) and let the checker disagree: that is the difference between a status claim and
a verified one.

## Gotchas

- Gitignored files (`.env`, `node_modules`) are missing in a fresh worktree; `/new-effort` links them.
- A branch left for days falls behind: `git fetch && git rebase origin/<default>` before the PR.
- A branch can't be open in two worktrees at once. That is a feature.
- Squash merges make `git branch -d` refuse; verify with `gh pr list --state merged`, then `-D`.

| Want to... | Run |
|---|---|
| List worktrees | `git worktree list` |
| Resume an existing branch | `git worktree add $WORKTREE_ROOT/<effort> <prefix>/<effort>` |
| Throwaway experiment | `git worktree add --detach $WORKTREE_ROOT/scratch` |
| Remove a worktree | `git worktree remove $WORKTREE_ROOT/<effort>` (`--force` if dirty) |
| Clean dead worktree refs | `git worktree prune` |
