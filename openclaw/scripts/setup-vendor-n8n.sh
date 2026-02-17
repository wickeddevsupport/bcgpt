#!/usr/bin/env bash
# Setup vendored n8n for local development
#
# Usage:
#   bash openclaw/scripts/setup-vendor-n8n.sh [--version=TAG]
#
# This clones n8n into openclaw/vendor/n8n/, builds it, and installs
# the custom Basecamp node. For Docker builds, use:
#   --build-arg INCLUDE_VENDORED_N8N=true
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCLAW_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$OPENCLAW_DIR")"
VENDOR_DIR="$OPENCLAW_DIR/vendor"
N8N_DIR="$VENDOR_DIR/n8n"

# Default pinned version
N8N_VERSION="n8n@1.76.1"

for arg in "$@"; do
  case $arg in
    --version=*)
      N8N_VERSION="${arg#*=}"
      ;;
  esac
done

echo "=== OpenClaw n8n Vendor Setup ==="
echo "Version: $N8N_VERSION"
echo "Target:  $N8N_DIR"
echo ""

# Check if already vendored
if [ -d "$N8N_DIR/packages/cli" ]; then
  echo "n8n already vendored at $N8N_DIR"
  echo "To re-vendor, remove the directory first: rm -rf $N8N_DIR"
  exit 0
fi

# Clone n8n
echo "--- Cloning n8n ($N8N_VERSION) ---"
mkdir -p "$VENDOR_DIR"
git clone --depth 1 --branch "$N8N_VERSION" https://github.com/n8n-io/n8n.git "$N8N_DIR"

# Build n8n
echo ""
echo "--- Building n8n ---"
cd "$N8N_DIR"
corepack enable
pnpm install --frozen-lockfile
pnpm build

# Install custom Basecamp node
BASECAMP_NODE_DIR="$REPO_ROOT/n8n-nodes-basecamp"
if [ -d "$BASECAMP_NODE_DIR" ]; then
  echo ""
  echo "--- Installing Basecamp custom node ---"
  cd "$BASECAMP_NODE_DIR"
  npm run build 2>/dev/null || echo "  (build skipped or already built)"

  TARGET="$N8N_DIR/packages/cli/node_modules/n8n-nodes-basecamp"
  mkdir -p "$TARGET"
  cp -r dist package.json "$TARGET/"
  echo "  Installed to $TARGET"
fi

echo ""
echo "=== Done ==="
echo "Start n8n with: N8N_LOCAL_URL=http://localhost:5678 node $N8N_DIR/packages/cli/bin/n8n start"
echo "Or let OpenClaw auto-detect it via n8n-embed.ts"
