# claude-code-multiterminal-kit

How I run several [Claude Code](https://claude.com/claude-code) terminals against one repo at the
same time without them colliding, and without me becoming the copy-paste router between windows.
It is the tooling I use daily, pulled out of a private project and made generic: nothing here
names that project, and every path, host and repo name lives in one config file.

- **Worktree-per-effort skills**: `/new-effort`, `/land`, `/deploy-prod`, `/checkpoint`, `/state`
- **Advisor / builder terminal model**: one terminal you talk to, the rest do the work ([docs](docs/ADVISOR-BUILDER.md))
- **Checkpoint hook**: after a PR merge or deploy, Claude is told to record the verified result in shared memory
- **Daily drift report**: cron job that compares main vs the deployed commit, health, stale PRs and leftover worktrees
- **verify-effects**: "verify the effect, not the deploy". Checks what a deploy actually *did*, driven by a config table
- **md-gdocs-sync**: post-commit hook that mirrors repo markdown into Google Docs, updated in place so links stay stable

## Why

Six terminals sharing one working folder share one `HEAD`. A checkout in one yanks the branch out
from under another, edits intermingle, and a deploy sweeps in half-finished work. Worktrees fix the
git half of that. The rest is process: terminals only share what is written down, so memory has to
be updated the moment something merges or ships, and "it's merged" has to stop being mistaken for
"it's live". Two real outages taught me that last one: security headers that were merged but never
reached the edge (a proxy config pinned to an old inode), and background jobs that were deployed
for weeks but defaulted to off. `git log` and a health 200 were green for both.

## The workflow

```
            you (human)
                |  talk only to...
                v
        +----------------+     dispatches one job each (model chosen per job)
        |    ADVISOR     |---------------------------------+
        | verifies first |                                 |
        | (/state)       |                                 v
        +----------------+                     +----------------------+
                ^                              |  BUILDER terminal    |
                |  reports: what changed,      |  /new-effort <name>  |
                |  commits, checks, to test    |  wt/<name>, own HEAD |
                +------------------------------|  edit, test, PR      |
                                               +----------+-----------+
                                                          |
        /land  squash-merge, remove worktree  <-----------+
          |
          +--> hook nudges: "run /checkpoint now"
          |
          v
   /deploy-prod   staging first, then prod; HEAD == origin, health 200
          |
          v
   verify-effects   headers at the edge? flags actually on? secrets placed?
          |
          v
   /checkpoint   verified facts -> $MEMORY_DIR (feature file, RESUME-HERE, index)
          ^
          |   09:23 daily
   drift-check ----> $MEMORY_DIR/drift-report.md  (advisor reads it at session start)
```

Rules that make it work: the main worktree is never edited; efforts are named by the work, not the
terminal; only the advisor dispatches; nothing is written to memory unless it was verified.

## Install

Needs git, Node 20+, and the [GitHub CLI](https://cli.github.com/) (`gh`) for the PR and drift pieces.
No npm dependencies for anything except md-gdocs-sync.

```bash
git clone https://github.com/michaelbasarah/claude-code-multiterminal-kit && cd claude-code-multiterminal-kit
sh install.sh                    # skills -> ~/.claude/skills, env file -> ~/.config/claude-multiterminal/env
$EDITOR ~/.config/claude-multiterminal/env
```

`install.sh --project DIR` installs into one repo's `.claude/skills` instead, and never overwrites an
existing skill without `--force`. Then merge [`settings.example.json`](settings.example.json) into your
Claude Code `settings.json` (with the absolute path to this clone) to enable the checkpoint hook.

Everything reads the one env file (real environment variables win). The variables are documented in
[`.env.example`](.env.example): `MAIN_WORKTREE`, `WORKTREE_ROOT`, `MEMORY_DIR`, `PROD_SSH`,
`HEALTH_URL` and friends. Leave `PROD_SSH` empty and every remote check is skipped, so the kit is
useful for a repo that never deploys anywhere.

For the advisor/builder model, paste the snippet in [docs/ADVISOR-BUILDER.md](docs/ADVISOR-BUILDER.md)
into your `~/.claude/CLAUDE.md`.

### Daily drift report

```
23 9 * * *  node /path/to/claude-code-multiterminal-kit/tools/drift-check.mjs
```

Writes `$MEMORY_DIR/drift-report.md` with a verdict of `IN SYNC` or `DRIFT`, listing merged-but-undeployed
commits, bad health endpoints, open PRs older than `STALE_PR_DAYS` and the current worktrees.
`--stdout` prints instead of writing; `--strict` exits 1 on drift. On WSL2 use Task Scheduler
(`wsl.exe -- node ...`) since Windows owns the clock.

### verify-effects

```bash
cp verify-effects/effects.config.example.json effects.config.json   # targets, headers, flags
node verify-effects/verify-effects.mjs                              # prod
node verify-effects/verify-effects.mjs --target staging
node verify-effects/verify-effects.mjs --expect-on digest_sweep     # FAIL if it still reports off
```

Layers: app code (checkout HEAD vs origin via `ls-remote`, container up), edge (real response
headers, health), env-gated flags (boot-log status plus env key *names*, never values), a separate
web deploy (live page), hand-placed secrets (file names only). It is read-only over ssh. A flag that
is off is reported as `DARK`, informational, because dark is the shipped default. It only fails when you
claim it is on. Exit codes: 0 pass, 1 a check failed, 2 bad usage or config.

### md-gdocs-sync

Keeps Google Docs mirrors of your markdown live. Each commit that touches a mapped `.md` updates the
matching Doc in place, so shared links never change. The hook always exits 0, so a Drive outage can
never block a commit. It lives in [`md-gdocs-sync/`](md-gdocs-sync/) with its own `package.json`;
follow [SETUP.md](md-gdocs-sync/SETUP.md) (about 10 minutes, once), then `sh md-gdocs-sync/install-hook.sh`
from inside the repo you want mirrored.

## Tests

```bash
npm test      # node:test, offline, nothing to install
```

30+ tests cover the env loader, the hook's matching and process contract, drift-check's verdict logic
and report, verify-effects' config validation, log/header/env parsers and strict argument handling,
and md-gdocs-sync's map validation, path matching, Drive query escaping and hook installer. CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same on Node 20 and 22. The parts that talk to
ssh, Docker, Google or GitHub are thin wrappers around those pure functions and were checked by hand.

## Layout

```
skills/            new-effort land deploy-prod checkpoint state   (Claude Code skills)
hooks/             checkpoint-reminder.mjs
tools/             drift-check.mjs
verify-effects/    verify-effects.mjs, lib.mjs, effects.config.example.json
md-gdocs-sync/     sync-doc.mjs, auth/consent/drive, install-hook.sh, SETUP.md
docs/              ADVISOR-BUILDER.md, GIT-WORKFLOW.md
lib/env.mjs        shared config loader
```

## What's deliberately not in this repo

My memory files, any real hosts, IPs, Drive folder IDs or Google credentials (the OAuth client and
token live in `~/.config/md-gdocs-sync/`, outside every repo), and the project these were extracted
from. The skills are written against placeholders and read your values at run time.

## License

MIT, see [LICENSE](LICENSE).
