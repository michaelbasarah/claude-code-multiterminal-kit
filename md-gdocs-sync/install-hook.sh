#!/bin/sh
# Install (or refresh) the post-commit hook that live-syncs .md docs -> Google Docs.
# Run it from inside the repo whose markdown you want mirrored. Idempotent. The hook always exits 0,
# so it can never break a commit.
#
#   sh /path/to/claude-code-multiterminal-kit/md-gdocs-sync/install-hook.sh [--force]
#
# .git/hooks isn't tracked by git, so run this once per checkout. An existing post-commit hook that
# this script did not write is left alone unless you pass --force.
set -eu

force=0
[ "${1:-}" = "--force" ] && force=1

here="$(cd "$(dirname "$0")" && pwd)"
hook_dir="$(git rev-parse --git-dir)/hooks"
mkdir -p "$hook_dir"
hook="$hook_dir/post-commit"
marker="# md-gdocs-sync post-commit hook"

if [ -f "$hook" ] && ! grep -q "$marker" "$hook" && [ "$force" -ne 1 ]; then
  echo "A post-commit hook already exists at $hook and was not written by md-gdocs-sync." >&2
  echo "Re-run with --force to replace it." >&2
  exit 1
fi

cat > "$hook" <<HOOK
#!/bin/sh
$marker
# Live-sync committed .md docs -> Google Docs using the map in ./doc-sync-map.json
# (or \$DOC_SYNC_MAP). Runs AFTER the commit completes; git ignores a post-commit hook's exit code and
# this one always exits 0, so a Drive/network outage can never block a commit. The sync is skipped,
# logged to .doc-sync.log, and retried next time the doc is committed.
cd "\$(git rev-parse --show-toplevel)" || exit 0
[ -f "\${DOC_SYNC_MAP:-doc-sync-map.json}" ] || exit 0
changed=\$(git diff-tree --no-commit-id --name-only --diff-filter=ACMR -r HEAD -- '*.md')
[ -z "\$changed" ] && exit 0
{
  echo "===== \$(date '+%Y-%m-%d %H:%M:%S') commit \$(git rev-parse --short HEAD) ====="
  printf '%s\n' "\$changed" | xargs node "$here/sync-doc.mjs"
} >> .doc-sync.log 2>&1
exit 0
HOOK

chmod +x "$hook"
echo "Installed post-commit hook -> $hook"
