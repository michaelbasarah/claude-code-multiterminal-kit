---
name: checkpoint
description: Record verified work state into shared memory (feature file, RESUME-HERE block, MEMORY.md index). Run immediately after any merge, deploy or live test; the advisor terminal depends on it being current.
---

# /checkpoint

Configuration comes from the kit env file (`${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}`, see the kit's `.env.example`). Load it first with `set -a; . "${MULTITERMINAL_ENV:-$HOME/.config/claude-multiterminal/env}"; set +a`. If a variable you need is unset, ask once instead of guessing.

Multiple terminals coordinate through `$MEMORY_DIR`. Stale memory makes the advisor give wrong advice. This skill is the standing rule made executable.

## Record VERIFIED facts only

Confirm against reality, not against your plan:
- merge: `gh pr view <N> --json state,mergeCommit`
- deploy: `ssh "$PROD_SSH" "git -C $PROD_CHECKOUT rev-parse --short HEAD"` and `curl "$HEALTH_URL"`
- tests: the actual test output you ran, with counts

Write "MERGED, NOT DEPLOYED" or "deployed, NOT live-tested" explicitly when true. Never write "should work". A ship-dark feature is DONE only when the note says whether it is **dark or live on prod**, verified from the boot log or `verify-effects`, never inferred from the merge.

## Update all three, in this order

1. **The feature's own memory file** in `$MEMORY_DIR`: what shipped, PR number and squash hash, deploy status (which prod hash), what was actually tested, what is still pending. Convert relative dates to absolute. Link related notes.

2. **`$MEMORY_DIR/$STATE_FILE`**: refresh the RESUME-HERE block at the top (only if the work touches the main product).

3. **`MEMORY.md` index**: update the feature's line or add one under the right heading. HARD RULE: **one line, 200 characters or fewer**: status, PR/hash, next step. Everything else belongs in the topic file. The index is loaded into every session, and long lines get truncated.

If an item moved from in-flight to done, also move its index line from "Active" to "Shipped and verified".
