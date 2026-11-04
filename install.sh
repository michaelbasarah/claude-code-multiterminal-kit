#!/bin/sh
# Install the kit's skills and print the hook snippet.
#
#   sh install.sh                 # skills -> ~/.claude/skills
#   sh install.sh --project DIR   # skills -> DIR/.claude/skills (per-repo install)
#   sh install.sh --force         # overwrite skills that already exist
#
# Skills are copied (not linked) with the kit's absolute path substituted for "<kit>", and an
# existing skill of the same name is never overwritten without --force.
# Nothing in settings.json is edited: merge settings.example.json yourself.
set -eu

kit="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.claude/skills"
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project) dest="$(cd "$2" && pwd)/.claude/skills"; shift 2 ;;
    --force) force=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$dest"
for src in "$kit"/skills/*/; do
  name="$(basename "$src")"
  if [ -e "$dest/$name" ] && [ "$force" -ne 1 ]; then
    echo "skip   $name (exists; --force to overwrite)"
    continue
  fi
  mkdir -p "$dest/$name"
  sed "s#<kit>#$kit#g" "$src/SKILL.md" > "$dest/$name/SKILL.md"
  echo "copied $name -> $dest/$name"
done

cfg="$HOME/.config/claude-multiterminal"
if [ ! -f "$cfg/env" ]; then
  mkdir -p "$cfg"
  cp "$kit/.env.example" "$cfg/env"
  chmod 600 "$cfg/env"
  echo "created $cfg/env from .env.example: edit it"
fi

echo
echo "Next: add the checkpoint hook to your Claude Code settings.json (see settings.example.json),"
echo "pointing at: node $kit/hooks/checkpoint-reminder.mjs"
