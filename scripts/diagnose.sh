#!/usr/bin/env bash
# Compose the installed profile in an isolated copy and report what DSH skips.
#
# DSH silently drops a bundle whose package is incompatible with the running
# dsh version (`engines.dsh`) or whose patch cannot be resolved — the desktop app
# only prints that to its own stderr, which a normal launch swallows. This script
# uses the dsh CLI shipped inside the app, against a copy of the profile (the
# desktop profile itself is marked "managed exclusively by the Electron
# application" and cannot be booted from a terminal).
#
# Usage: bash scripts/diagnose.sh [profile-name]
#   DSH_APP=/path/to/DeepSeek Harness.app   override when the app lives elsewhere
#   DSH_HOME=/path/to/.dsh                  override the DSH home

set -euo pipefail

APP="${DSH_APP:-/Applications/DeepSeek Harness.app}"
PROFILE="${1:-desktop}"
HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
CLI="$APP/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
BIN="$APP/Contents/MacOS/DeepSeek Harness"

if [[ ! -d "$APP" ]]; then
  echo "error: app not found at $APP (set DSH_APP)" >&2
  exit 1
fi

SRC="$HOME_DIR/profiles/$PROFILE"
if [[ ! -d "$SRC" ]]; then
  echo "error: profile not found at $SRC" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/profiles"
cp -an "$SRC" "$TMP/profiles/diag"

# The copy keeps relative `link:` symlinks that no longer resolve; re-point them
# at the absolute targets of the original profile.
for link in "$SRC"/node_modules/@deepseek-ai/*; do
  [[ -L "$link" ]] || continue
  target="$(cd "$(dirname "$link")" && pwd -P)/$(readlink "$link")"
  ln -sfn "$(cd "$(dirname "$target")" && pwd -P)/$(basename "$target")" \
    "$TMP/profiles/diag/node_modules/@deepseek-ai/$(basename "$link")"
done

echo "—— composing profile '$PROFILE' in an isolated copy ——"
if ! DSH_HOME="$TMP" ELECTRON_RUN_AS_NODE=1 "$BIN" "$CLI" --profile diag --dump-config > "$TMP/dump.yml" 2> "$TMP/err.txt"; then
  echo "error: --dump-config failed:" >&2
  cat "$TMP/err.txt" >&2
  exit 1
fi

if [[ -s "$TMP/err.txt" ]]; then
  echo "!! DSH reported problems (skipped bundles, incompatible packages):"
  cat "$TMP/err.txt"
else
  echo "ok: no skipped bundles or compatibility warnings"
fi

echo
echo "—— quest journal rows in the composed tree ——"
if grep -q "dsh-quest-journal\|dsh-client-ui-quest-journal" "$TMP/dump.yml"; then
  grep -B1 -A2 -E "id: (quest-journal|quest-journal-web|quest-journal-ui)" "$TMP/dump.yml" || true
else
  echo "!! no quest-journal rows — the bundle is not in dsh.profile.bundles or was skipped"
fi
