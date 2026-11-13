#!/usr/bin/env bash
# Run the Quest Journal core unit tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- locate a Node binary ---------------------------------------------------
find_node() {
  if [[ -n "${DSH_NODE:-}" ]]; then
    echo "$DSH_NODE"; return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node; return 0
  fi
  local n
  for n in "$HOME"/.dsh/dsh-runtimes/*/dependencies/node/bin/node; do
    if [[ -x "$n" ]]; then echo "$n"; return 0; fi
  done
  return 1
}

if ! NODE_BIN="$(find_node)"; then
  echo "error: no Node binary found (set DSH_NODE=/path/to/node >= 24)" >&2
  exit 1
fi

"$NODE_BIN" "$ROOT_DIR/test/core.test.mjs"

echo
"$NODE_BIN" "$ROOT_DIR/test/preview-import.test.mjs"

echo
# lib/web.js is a `.js` ESM file; the workspace sandbox refuses to import `.js`
# from a Node child, so copy it to a temporary `.mjs` for the route tests.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
sed -n '1,$p' "$ROOT_DIR/packages/dsh-quest-journal/lib/web.js" > "$TMP_DIR/web.mjs"
QJ_WEB_MODULE="file://$TMP_DIR/web.mjs" "$NODE_BIN" "$ROOT_DIR/test/routes.test.mjs"

sed -n '1,$p' "$ROOT_DIR/packages/dsh-client-ui-quest-journal/lib/client.js" > "$TMP_DIR/client.txt"
QJ_CLIENT_MODULE="$TMP_DIR/client.txt" "$NODE_BIN" "$ROOT_DIR/test/client.test.mjs"

"$NODE_BIN" "$ROOT_DIR/test/commands.test.mjs"

# Activate the actual plugin entries with service doubles; copy .js as .mjs.
for module in quest-core.mjs journal.mjs commands.mjs deadline.mjs todo-core.mjs; do
  sed -n '1,$p' "$ROOT_DIR/packages/dsh-quest-journal/lib/$module" > "$TMP_DIR/$module"
done
sed 's|"./web.js"|"./web.mjs"|' "$ROOT_DIR/packages/dsh-quest-journal/lib/web-entry.js" > "$TMP_DIR/web-entry.mjs"
sed -n '1,$p' "$ROOT_DIR/packages/dsh-quest-journal/lib/tools.js" > "$TMP_DIR/tools.mjs"
QJ_ENTRY_MODULE="file://$TMP_DIR/web-entry.mjs" QJ_TOOLS_MODULE="file://$TMP_DIR/tools.mjs" "$NODE_BIN" "$ROOT_DIR/test/entry.test.mjs"

"$NODE_BIN" "$ROOT_DIR/test/reorder.test.mjs"

"$NODE_BIN" "$ROOT_DIR/test/creation.test.mjs"

"$NODE_BIN" "$ROOT_DIR/test/todos.test.mjs"
