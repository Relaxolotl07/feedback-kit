#!/usr/bin/env bash
# Install the feedback widget kit. Two independent, additive modes — safe by default.
#   ./install.sh --global              # copy inert /feedback-widget skill into ~/.claude/skills/
#   ./install.sh --target <repo>       # copy templates/feedback/ into <repo>/src/feedback/
#   add --force to overwrite existing files (off by default)
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GLOBAL=0; TARGET=""; FORCE=0
while [ $# -gt 0 ]; do case "$1" in
  --global) GLOBAL=1;; --target) TARGET="$2"; shift;; --force) FORCE=1;;
  *) echo "unknown arg: $1"; exit 1;; esac; shift; done

copy_if_absent() { # src dst
  if [ -e "$2" ] && [ "$FORCE" -eq 0 ]; then echo "  skip (exists): $2"; return; fi
  mkdir -p "$(dirname "$2")"; cp "$1" "$2"; echo "  wrote: $2"
}

if [ "$GLOBAL" -eq 0 ] && [ -z "$TARGET" ]; then
  echo "Nothing to do. Use --global and/or --target <repo>."; exit 0
fi

if [ "$GLOBAL" -eq 1 ]; then
  CLAUDE="$HOME/.claude"
  echo "Installing global (inert) skill into $CLAUDE ..."
  copy_if_absent "$KIT/claude/skills/feedback-widget/SKILL.md" "$CLAUDE/skills/feedback-widget/SKILL.md"
  echo "Done. /feedback-widget available across repos (inert until invoked)."
fi

if [ -n "$TARGET" ]; then
  [ -d "$TARGET" ] || { echo "Target not found: $TARGET"; exit 1; }
  # Find the source root: prefer <target>/src/, fall back to <target>/.
  if [ -d "$TARGET/src" ]; then SRC_ROOT="$TARGET/src"; else SRC_ROOT="$TARGET"; fi
  DST="$SRC_ROOT/feedback"
  echo "Copying feedback module into $DST ..."
  for f in "$KIT"/templates/feedback/*; do
    [ -f "$f" ] && copy_if_absent "$f" "$DST/$(basename "$f")"
  done
  echo "Done. Module copied. Next steps:"
  echo "  1. Wire src/app/api/feedback/route.ts (use createFeedbackPOST from ./server)."
  echo "  2. Mount <FeedbackButton/> in your root client shell."
  echo "  3. Apply src/feedback/schema.sql to your dev + prod DBs."
  echo "  TIP: with Claude Code installed (--global), run /feedback-widget in the repo to do steps 1-3 from the actual code."
fi
