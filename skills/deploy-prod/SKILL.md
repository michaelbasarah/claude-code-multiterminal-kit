---
name: deploy-prod
description: Deploy origin's default branch to the production host and verify. Prod HEAD matches origin, health returns 200, effects verified. Use after /land, or whenever memory says "merged, not deployed".
---

# /deploy-prod

Configuration comes from the kit env file (`${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}`, see the kit's `.env.example`). Load it first with `set -a; . "${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}"; set +a`. If a variable you need is unset, ask once instead of guessing.

Target: `$PROD_SSH`, checkout at `$PROD_CHECKOUT`, deploy command `$PROD_DEPLOY_CMD`. If `$PROD_SSH` is unset this project has no remote deploy; say so and stop.

## Steps

0. **Gate before touching prod:**
   - *Risk-classify the change.* High-risk (core request pipeline, state machines, DB schema, anything a live user depends on) soaks on staging first: run `$STAGING_DEPLOY_CMD` over ssh, exercise the flow, then prod. Low-risk (docs, static site, UI copy, anything shipped dark behind a flag) can go straight to prod, or through staging if you have one: staging-first as the default is cheap insurance.
   - *Deploy window.* Respect `$DEPLOY_BLACKOUT` if set. Batch merged PRs into one quiet-window deploy; hotfixes for live breakage are the only exception.

1. **Preconditions (local):**
   ```bash
   cd "$MAIN_WORKTREE"
   git fetch origin
   git log --oneline -1 origin/$DEFAULT_BRANCH   # this is what prod will run: confirm it is what you intend
   ```
   Prod only pulls origin, so anything merged-but-unpushed will NOT deploy.

2. **Deploy:**
   ```bash
   ssh "$PROD_SSH" "$PROD_DEPLOY_CMD"
   ```
   If the deploy script exits non-zero or the app does not report healthy, STOP and read the app logs on the box. Don't retry blind.

3. **Verify (never assert from the deploy script's output alone):**
   ```bash
   ssh "$PROD_SSH" "git -C $PROD_CHECKOUT rev-parse --short HEAD"      # must equal origin/$DEFAULT_BRANCH
   curl -fsS -o /dev/null -w '%{http_code}\n' "$HEALTH_URL"             # must be 200
   node "<kit>/verify-effects/verify-effects.mjs"                        # the effect, not just the delivery
   ```
   If you deliberately enabled a flag, assert it: `--expect-on <flag>` fails the run if it still reports off.

4. **If it goes bad, roll back:**
   - Code: re-run the deploy command with the previous sha (the deploy output should print it). A sha rollback leaves the checkout detached; return to the default branch once fixed.
   - Data (only if a migration corrupted the DB): restore from the pre-deploy snapshot with the app stopped, delete stale WAL/shm files, then start. Never copy a snapshot over a running app.

5. **Gotchas to check for your stack:**
   - Source baked into an image: an env-only change needs a container recreate, not a code deploy.
   - State that lives in the database (seeds, tone, config) is not re-seeded by a deploy.
   - A staging environment without real external integrations can't prove real-device behaviour; that makes the risk classification and window load-bearing.

6. **Report** old -> new prod hash and health status, then run `/checkpoint`.
