---
name: state
description: Verified reality check of project state. Main vs prod HEAD, health, open PRs, worktrees, effect gaps, and drift between memory claims and reality. Use at advisor-session start or before asserting any status.
---

# /state

Configuration comes from the kit env file (`${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}`, see the kit's `.env.example`). Load it first with `set -a; . "${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}"; set +a`. If a variable you need is unset, ask once instead of guessing.

"Verify before you assert." Check the real thing, never report from memory or a plan doc. Run these (in parallel where possible) and produce a drift report.

## Checks

```bash
cd "$MAIN_WORKTREE"
git fetch origin
git log --oneline -5 origin/$DEFAULT_BRANCH                            # what main actually contains
git worktree list                                                    # efforts in flight
gh pr list --state open --json number,title,headRefName,createdAt
gh pr list --state merged --limit 5 --json number,title,mergedAt
ssh "$PROD_SSH" "git -C $PROD_CHECKOUT rev-parse --short HEAD"       # prod HEAD (skip if PROD_SSH unset)
curl -fsS -o /dev/null -w '%{http_code}\n' "$HEALTH_URL"
curl -fsS -o /dev/null -w '%{http_code}\n' "$STAGING_HEALTH_URL"       # if set
```

## Effect checks: `git log` is not delivery

`git log` and a health 200 only prove the **app code baked into the image** shipped. Other layers can be merged, "on prod" and still never have run: edge config pinned to an old inode, env-gated flags that default to off, a separately deployed frontend, a secret nobody placed. Check the effect at each boundary. The kit runs the whole table as one command:

```bash
node "<kit>/verify-effects/verify-effects.mjs"        # add --target staging, --expect-on <flag>
```

| Layer | `git log` proves it? | Check the effect with |
|---|---|---|
| App code (in image) | yes | prod HEAD == origin default branch |
| Edge / bind-mounted config | **no** | request the edge, assert the headers |
| Env-gated flags | **no** | boot log `status:"on"` plus the env key present |
| Separate web deploy | **no** | fetch the live page, not the build output |
| Hand-placed secrets | **no** | has it ever completed one successful run? |

If a memory line claims a ship-dark feature is DONE or LIVE, it must say **dark or live on prod**.

Then read `$MEMORY_DIR/MEMORY.md`, `$MEMORY_DIR/$STATE_FILE` (RESUME-HERE) and the latest `$MEMORY_DIR/$DRIFT_REPORT_FILE`.

## Report, in this order

1. **Deploy drift**: is prod HEAD == origin default branch? If not, list the merged-but-undeployed commits (`git log --oneline <prodHEAD>..origin/$DEFAULT_BRANCH`).
2. **Health**: prod and staging status codes.
3. **Open PRs**: flag any open longer than `$STALE_PR_DAYS` days (land or kill).
4. **Worktrees**: flag any whose branch is already merged (cleanup missed).
5. **Memory vs reality**: any index line claiming DEPLOYED/LIVE that prod HEAD contradicts, or OPEN for a merged PR.
6. **Effect gaps**: merged and deployed features whose effect was never verified at its boundary (flags still dark, headers missing at the edge, a hand-placed secret never placed).

End with a one-line verdict: `IN SYNC` or `DRIFT: <items>`. If drift was found and fixed later, run `/checkpoint`.
