#!/usr/bin/env bash
set -euo pipefail

# Secure restart helper for the legacy BCGPT container.
# Secrets must come from the caller environment (or an injected env-file), never hardcoded.

REQUIRED_VARS=(
  OTP_SECRET
  BASECAMP_CLIENT_ID
  BASECAMP_CLIENT_SECRET
  BASECAMP_DEFAULT_ACCOUNT_ID
  DATABASE_URL
)

missing=()
for key in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("${key}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "Missing required env vars: ${missing[*]}" >&2
  echo "Export them from your secret manager before running this script." >&2
  exit 1
fi

if [[ -n "${ACTIVEPIECES_URL:-}" || -n "${ACTIVEPIECES_API_KEY:-}" ]]; then
  echo "Warning: ACTIVEPIECES_* variables are deprecated and ignored by this script." >&2
fi

APP_BASE_URL="${APP_BASE_URL:-https://bcgpt.wickedlab.io}"
PMOS_URL="${PMOS_URL:-https://os.wickedlab.io}"
PORT="${PORT:-10000}"
SQLITE_PATH="${SQLITE_PATH:-/data/bcgpt.sqlite}"
IMAGE="${IMAGE:-bcgptapi-bcgpt:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-bcgptapi-bcgpt-1}"
PRIMARY_NETWORK="${PRIMARY_NETWORK:-bcgptapi_default}"
TRAEFIK_NETWORK="${TRAEFIK_NETWORK:-coolify}"
ROUTER_HOST="${ROUTER_HOST:-bcgpt.wickedlab.io}"

sudo docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true
sudo docker run -d --name "${CONTAINER_NAME}" --restart=unless-stopped \
  -v bcgpt-data:/data \
  --network "${PRIMARY_NETWORK}" \
  -l "traefik.enable=true" \
  -l "traefik.docker.network=${TRAEFIK_NETWORK}" \
  -l "traefik.http.routers.bcgpt.rule=Host(\`${ROUTER_HOST}\`)" \
  -l "traefik.http.routers.bcgpt.entrypoints=http,https" \
  -l "traefik.http.routers.bcgpt.tls=true" \
  -l "traefik.http.routers.bcgpt.tls.certresolver=letsencrypt" \
  -l "traefik.http.services.bcgpt.loadbalancer.server.port=${PORT}" \
  -e OTP_SECRET \
  -e BASECAMP_CLIENT_ID \
  -e BASECAMP_CLIENT_SECRET \
  -e BASECAMP_DEFAULT_ACCOUNT_ID \
  -e APP_BASE_URL="${APP_BASE_URL}" \
  -e PORT="${PORT}" \
  -e DATABASE_URL \
  -e SQLITE_PATH="${SQLITE_PATH}" \
  -e PMOS_URL="${PMOS_URL}" \
  "${IMAGE}"

sudo docker network connect "${TRAEFIK_NETWORK}" "${CONTAINER_NAME}" 2>/dev/null || true
echo "Container started: ${CONTAINER_NAME}"
