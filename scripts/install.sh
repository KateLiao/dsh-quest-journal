#!/usr/bin/env bash
# Install the Quest Journal plugin into the current DSH profile.
#
# This script only edits the profile manifest (package.json dependencies +
# dsh.profile.bundles). It does NOT restart DSH or run the package manager,
# so the running application is never interrupted. After running it, install
# the linked packages and reload the profile (see the printed next steps).
#
# Usage:  bash scripts/install.sh [--profile <dir>] [--install]
#   --profile <dir>  override the profile directory (default: <DSH_HOME>/profiles/desktop)
#   --install        also run `pnpm install` in the profile (requires pnpm on PATH)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND_PKG="@deepseek-ai/dsh-quest-journal"
BACKEND_DIR="$ROOT_DIR/packages/dsh-quest-journal"

# --- locate a Node binary ---------------------------------------------------
# The DSH Desktop app ships its own Node under ~/.dsh/dsh-runtimes; the system
# `node` may not be on PATH, so search several places.
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
  echo "error: no Node binary found." >&2
  echo "       set DSH_NODE=/path/to/node (>= 24) and retry." >&2
  exit 1
fi
echo "node: $NODE_BIN"

# --- locate pnpm (only needed with --install) ------------------------------
find_pnpm() {
  if [[ -n "${DSH_PNPM:-}" ]]; then
    echo "$DSH_PNPM"; return 0
  fi
  if command -v pnpm >/dev/null 2>&1; then
    command -v pnpm; return 0
  fi
  local p
  for p in "$HOME"/.dsh/dsh-runtimes/*/dependencies/pnpm/bin/pnpm.mjs; do
    if [[ -f "$p" ]]; then echo "$p"; return 0; fi
  done
  return 1
}

# --- locate profile ---------------------------------------------------------
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/desktop"
RUN_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_DIR="$2"; shift 2 ;;
    --install) RUN_INSTALL=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

PROFILE_PKG="$PROFILE_DIR/package.json"
if [[ ! -f "$PROFILE_PKG" ]]; then
  echo "error: profile package.json not found at $PROFILE_PKG" >&2
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/package.json" ]]; then
  echo "error: backend package not found at $BACKEND_DIR" >&2
  exit 1
fi

# --- edit profile package.json ---------------------------------------------
echo "profile: $PROFILE_PKG"
echo "backend: $BACKEND_DIR"

cp "$PROFILE_PKG" "$PROFILE_PKG.qj-backup"
echo "backup:  $PROFILE_PKG.qj-backup"

"$NODE_BIN" - "$PROFILE_PKG" "$BACKEND_PKG" "$BACKEND_DIR" "$ROOT_DIR" <<'NODE'
const fs = require("fs");
const [profilePath, backendPkg, backendDir, rootDir] = process.argv.slice(2);
const uiPkg = "@deepseek-ai/dsh-client-ui-quest-journal";
const uiDir = rootDir + "/packages/dsh-client-ui-quest-journal";
const pkg = JSON.parse(fs.readFileSync(profilePath, "utf8"));

pkg.dependencies = pkg.dependencies || {};
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || [];

pkg.dependencies[backendPkg] = "link:" + backendDir;
// The Web panel ships as a `dsh.client` package. It is a Loader entry inserted
// by the backend bundle patch, so it only needs to be resolvable from the
// profile — it is not a bundle of its own.
pkg.dependencies[uiPkg] = "link:" + uiDir;

if (!pkg.dsh.profile.bundles.includes(backendPkg)) {
  pkg.dsh.profile.bundles.push(backendPkg);
}
// The panel is its own bundle: it carries a `dsh.client` manifest, and its
// patch inserts the `quest-journal-ui` Loader entry.
if (!pkg.dsh.profile.bundles.includes(uiPkg)) {
  pkg.dsh.profile.bundles.push(uiPkg);
}

fs.writeFileSync(profilePath, JSON.stringify(pkg, null, 2) + "\n");
console.log("updated: dependencies += " + backendPkg);
console.log("updated: dependencies += " + uiPkg);
console.log("updated: dsh.profile.bundles += " + backendPkg + ", " + uiPkg);
NODE

echo ""
echo "done. next steps:"
echo "  1. Install the linked packages (run this script with --install, or run"
echo "     \`pnpm install\` inside '$PROFILE_DIR', or use the DSH Plugins page)."
echo "  2. Reload the profile: restart DSH (Host code only loads at boot)."
echo "  3. The Agent tools (\`quest_*\`) and the in-app panel (\`sidebar.panellist\`"
echo "     entry + \`main\` page) are available after the restart."

if [[ "$RUN_INSTALL" -eq 1 ]]; then
  echo ""
  if PNPM_BIN="$(find_pnpm)"; then
    echo "running pnpm install in $PROFILE_DIR ..."
    if [[ "$PNPM_BIN" == *.mjs ]]; then
      ( cd "$PROFILE_DIR" && "$NODE_BIN" "$PNPM_BIN" install )
    else
      ( cd "$PROFILE_DIR" && "$PNPM_BIN" install )
    fi
  else
    echo "warning: pnpm not found; install the linked packages via the DSH"
    echo "         Plugins page, or restart DSH and let it resolve the links." >&2
  fi
fi
