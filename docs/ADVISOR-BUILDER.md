# The advisor / builder terminal model

When you run several Claude Code terminals at once, the failure mode is not the tools, it is you:
you become the router, pasting prompts between windows and losing track of what landed. This model
removes that by giving each terminal exactly one role.

## Roles

**One advisor terminal.** The only terminal you talk to. It does not build anything (no code, no
design docs, no notes). Its job is to look at reality, decide what should happen next, and dispatch
the work. Every job goes to another agent: a background subagent (pick the model per job) or a
message to a terminal already open on that effort.

**Builder terminals and subagents.** They take one job each, do it in their own worktree, and report
back to the advisor: what changed, commit hashes, checks run, anything the human must test. They do
not write prompts for other terminals and do not ask you to paste things elsewhere. That is the
advisor's job.

**You.** You keep the parts only a human can do (playtests, logins, approvals) and you decide when
work lands or ships.

## The advisor's standing rules

1. **Verify first, every turn.** Before saying anything about state, check it: `git log`,
   `git status`, `git worktree list`, open PRs, agent reports. Use `/state`. Never report from
   memory or from a plan.
2. **Say what you dispatched.** For each job: which model, and what the job does, in one or two
   lines.
3. **One sequential prompt at a time** when work is dependent. Parallel only for genuinely
   independent efforts, each in its own worktree.
4. **Pick the model per job.** Cheap and fast for mechanical edits and searches, the strongest model
   for design, hard debugging and review.
5. **Keep the human updated in plain words**, not in diffs.

## The builder's standing rules

1. Do the job you were given, in your own `wt/<effort>` worktree (`/new-effort`).
2. Report: what changed, commits, checks, what the human needs to test.
3. Follow the repo's own `CLAUDE.md` (worktrees, checks).
4. Run `/checkpoint` after any merge, deploy or live test. The checkpoint hook nags you if you forget.

## Why the memory directory matters

Terminals share no context except what is written down. `MEMORY_DIR` is that channel: topic files per
feature, a RESUME-HERE block, a one-line-per-item index, and the daily drift report. The advisor reads
it at session start; builders write VERIFIED facts into it (`/checkpoint`). Stale memory makes the
advisor give wrong advice, so the hook, the skill and the drift report all exist to keep it honest.

## Snippet for your `~/.claude/CLAUDE.md`

```markdown
## If you are the advisor terminal
- Don't build anything yourself (code, design docs, notes). Send every job to another agent: start a
  background subagent (pick the model per job), or message a terminal that's already open on that effort.
- Verify first every turn (git log/status, worktrees, agent reports) and keep me updated in plain words.
- For each job you dispatch, tell me the model and what the job does in 1-2 lines.
- I still do the manual parts (playtests, logins, approvals) and decide when work lands or ships.

## If you are a builder agent or a worker terminal
- Do the job you were given, then report back to the advisor: what changed, commits, checks, anything I need to test.
- Don't write prompts for other terminals or tell me to paste things elsewhere. That's the advisor's job.
- Follow the repo's own CLAUDE.md (worktrees, checks) and run /checkpoint when you finish.
```
