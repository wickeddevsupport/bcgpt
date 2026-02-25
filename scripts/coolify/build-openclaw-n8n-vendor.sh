#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKERFILE="$REPO_ROOT/Dockerfile.openclaw.nx"

IMAGE_REPO="${IMAGE_REPO:-local/openclaw-n8n-vendor}"
N8N_VERSION="${N8N_VERSION:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
PUSH_LOCAL_REGISTRY=false
ENSURE_LOCAL_REGISTRY=true
LOCAL_REGISTRY_ADDR="${LOCAL_REGISTRY_ADDR:-127.0.0.1:5000}"
LOCAL_REGISTRY_CONTAINER="${LOCAL_REGISTRY_CONTAINER:-openclaw-local-registry}"
LOCAL_REGISTRY_VOLUME="${LOCAL_REGISTRY_VOLUME:-openclaw_local_registry}"
ALSO_TAG_STABLE=false
PRINT_ONLY=false

usage() {
  cat <<'EOF'
Build and optionally publish the OpenClaw vendored n8n image on the server.

Usage:
  scripts/coolify/build-openclaw-n8n-vendor.sh [options]

Options:
  --version <n8n@x.y.z>     n8n git tag/branch (default: read from Dockerfile.openclaw.nx)
  --tag <image-tag>         image tag (default: derived from version, e.g. n8n-1.76.1)
  --image-repo <repo>       local image repo name (default: local/openclaw-n8n-vendor)
  --push-local-registry     push to a local Docker registry (defaults to 127.0.0.1:5000)
  --local-registry <addr>   local registry host:port (default: 127.0.0.1:5000)
  --no-registry-create      do not auto-create/start the local registry container
  --also-tag-stable         also tag/push :stable
  --print-only              print resolved refs/build args without building
  -h, --help                show help

Environment overrides:
  IMAGE_REPO, N8N_VERSION, IMAGE_TAG, LOCAL_REGISTRY_ADDR
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      N8N_VERSION="${2:-}"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --image-repo)
      IMAGE_REPO="${2:-}"
      shift 2
      ;;
    --push-local-registry)
      PUSH_LOCAL_REGISTRY=true
      shift
      ;;
    --local-registry)
      LOCAL_REGISTRY_ADDR="${2:-}"
      shift 2
      ;;
    --no-registry-create)
      ENSURE_LOCAL_REGISTRY=false
      shift
      ;;
    --also-tag-stable)
      ALSO_TAG_STABLE=true
      shift
      ;;
    --print-only)
      PRINT_ONLY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "Dockerfile not found: $DOCKERFILE" >&2
  exit 1
fi

resolve_n8n_version() {
  if [[ -n "$N8N_VERSION" ]]; then
    printf '%s\n' "$N8N_VERSION"
    return 0
  fi
  local value
  value="$(grep -E '^ARG N8N_VERSION=' "$DOCKERFILE" | head -1 | sed -E 's/^ARG N8N_VERSION=//')"
  if [[ -z "$value" ]]; then
    echo "Could not resolve ARG N8N_VERSION from $DOCKERFILE" >&2
    exit 1
  fi
  printf '%s\n' "$value"
}

derive_tag() {
  local version="$1"
  if [[ -n "$IMAGE_TAG" ]]; then
    printf '%s\n' "$IMAGE_TAG"
    return 0
  fi
  printf '%s\n' "$version" | sed -E 's/^n8n@/n8n-/'
}

ensure_local_registry() {
  local addr="$1"
  local host="${addr%:*}"
  local port="${addr##*:}"
  if ! docker ps --format '{{.Names}}' | grep -Fxq "$LOCAL_REGISTRY_CONTAINER"; then
    if docker ps -a --format '{{.Names}}' | grep -Fxq "$LOCAL_REGISTRY_CONTAINER"; then
      echo "Starting existing local registry container: $LOCAL_REGISTRY_CONTAINER"
      docker start "$LOCAL_REGISTRY_CONTAINER" >/dev/null
    else
      echo "Creating local registry container: $LOCAL_REGISTRY_CONTAINER ($addr)"
      docker volume create "$LOCAL_REGISTRY_VOLUME" >/dev/null
      docker run -d \
        --name "$LOCAL_REGISTRY_CONTAINER" \
        --restart unless-stopped \
        -p "${host}:${port}:5000" \
        -v "${LOCAL_REGISTRY_VOLUME}:/var/lib/registry" \
        registry:2 >/dev/null
    fi
  fi
}

N8N_VERSION="$(resolve_n8n_version)"
IMAGE_TAG="$(derive_tag "$N8N_VERSION")"
LOCAL_REF="${IMAGE_REPO}:${IMAGE_TAG}"
STABLE_LOCAL_REF="${IMAGE_REPO}:stable"
REGISTRY_REPO="${LOCAL_REGISTRY_ADDR}/${IMAGE_REPO}"
REGISTRY_REF="${REGISTRY_REPO}:${IMAGE_TAG}"
STABLE_REGISTRY_REF="${REGISTRY_REPO}:stable"

if $PRINT_ONLY; then
  echo "Resolved n8n version: $N8N_VERSION"
  echo "Local image ref:      $LOCAL_REF"
  if $PUSH_LOCAL_REGISTRY; then
    echo "Registry image ref:    $REGISTRY_REF"
    echo "Coolify build arg:     N8N_VENDOR_IMAGE=$REGISTRY_REF"
  else
    echo "Coolify build arg:     N8N_VENDOR_IMAGE=$LOCAL_REF"
  fi
  exit 0
fi

echo "=== Build OpenClaw n8n vendor image (server-side) ==="
echo "Repo root:       $REPO_ROOT"
echo "Dockerfile:      $DOCKERFILE"
echo "n8n version:     $N8N_VERSION"
echo "Local image ref: $LOCAL_REF"

echo
echo "Building vendor stage image..."
docker build \
  --file "$DOCKERFILE" \
  --target n8n_vendor_build \
  --build-arg INCLUDE_VENDORED_N8N=true \
  --build-arg "N8N_VERSION=$N8N_VERSION" \
  --tag "$LOCAL_REF" \
  "$REPO_ROOT"

if $ALSO_TAG_STABLE; then
  docker tag "$LOCAL_REF" "$STABLE_LOCAL_REF"
fi

if $PUSH_LOCAL_REGISTRY; then
  if $ENSURE_LOCAL_REGISTRY; then
    ensure_local_registry "$LOCAL_REGISTRY_ADDR"
  fi
  echo
  echo "Pushing vendor image to local registry: $LOCAL_REGISTRY_ADDR"
  docker tag "$LOCAL_REF" "$REGISTRY_REF"
  docker push "$REGISTRY_REF"
  if $ALSO_TAG_STABLE; then
    docker tag "$LOCAL_REF" "$STABLE_REGISTRY_REF"
    docker push "$STABLE_REGISTRY_REF"
  fi
fi

echo
echo "Done."
echo "Use this in Coolify build args for PMOS/OpenClaw:"
if $PUSH_LOCAL_REGISTRY; then
  echo "  N8N_VENDOR_IMAGE=$REGISTRY_REF"
else
  echo "  N8N_VENDOR_IMAGE=$LOCAL_REF"
fi
echo "  INCLUDE_VENDORED_N8N=true"
echo
echo "Tip: rebuild only when Dockerfile.openclaw.nx or n8n-nodes-basecamp changes."
