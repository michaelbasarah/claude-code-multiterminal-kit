#!/usr/bin/env node
// PostToolUse(Bash) hook: after a PR merge or deploy command, tell Claude to run /checkpoint
// before moving on. Shared memory that lags reality makes the advisor terminal give stale advice.
//
// The trigger is CHECKPOINT_TRIGGER_REGEX (default: `gh pr merge|deploy\.sh`).
import { loadConfig } from "../lib/env.mjs";

/** PURE: does this Bash command look like a merge or deploy? An invalid regex never throws. */
export function shouldRemind(command, pattern) {
  if (!command || !pattern) return false;
  try {
    return new RegExp(pattern).test(command);
  } catch {
    return false;
  }
}

export const REMINDER =
  "A PR merge or deploy just ran. Standing rule: run /checkpoint NOW. Update the feature's memory file, " +
  "the state file's RESUME-HERE block and the MEMORY.md index line with the VERIFIED result " +
  "(commit hash, deploy status, what was actually tested). Do this before moving on.";

export function buildOutput(command, pattern) {
  if (!shouldRemind(command, pattern)) return null;
  return {
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: REMINDER },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let command = "";
    try {
      command = JSON.parse(raw)?.tool_input?.command || "";
    } catch {
      /* malformed hook input: do nothing, never break the tool call */
    }
    const out = buildOutput(command, loadConfig().CHECKPOINT_TRIGGER_REGEX);
    if (out) console.log(JSON.stringify(out));
  });
}
