# Coolify Host Ownership Guardrails

**Last Updated:** 2026-03-04  
**Related:** [`COOLIFY_DEPLOY_NX_RUNBOOK.md`](COOLIFY_DEPLOY_NX_RUNBOOK.md), [`BCGPT_API_MCP_GUIDE.md`](BCGPT_API_MCP_GUIDE.md)

---

## Purpose

Prevent split-brain production behavior caused by multiple services claiming the same public host.

---

## Non-Negotiable Rules

1. One public hostname must be owned by exactly one Coolify application/router.
2. All production deployments must happen through Coolify (UI or API), not manual `docker run`/`docker compose up`.
3. Helper/sidecar services must be internal-only unless they are the canonical public owner.

---

## Canonical Host Ownership (Production)

| Host | Owner App (Coolify) | UUID | Source Compose |
|---|---|---|---|
| `bcgpt.wickedlab.io` | `bcgpt` | `ksc008kkkcw0w448w80o04c0` | `docker-compose.bcgpt.yml` |
| `flow.wickedlab.io` | `Active Pieces` | `ogk8ko8swg4g0g80o0w84go8` | `docker-compose.yaml` |
| `os.wickedlab.io` | `pmos` | `vg88kok000o8csg8occgcskg` | `docker-compose.pmos.yml` |
| `ops.wickedlab.io` | `ops` | `kgcogk04ogkwg40og4k8sksw` | `docker-compose.ops.yml` |
| `bot.wickedlab.io` | `wickedbot` | `n44gwg0w0c0g800gwocc88kg` | Coolify service compose |

If host ownership needs to change, do it as a deliberate migration and update this table in the same PR.

---

## Compose Guardrail Pattern

For internal sidecars (example: `bcgpt` service inside `docker-compose.yaml` used by Active Pieces):

- Do not set `traefik.http.routers.*.rule=Host(...)`.
- Do not attach sidecar service to `coolify` public network unless it is the canonical routed service.
- Keep sidecar on private/internal app network(s) only.

For canonical public service:

- Must include `traefik.enable=true`.
- Must include explicit host rule and TLS labels.
- Must include `traefik.docker.network=coolify`.

---

## Pre-Deploy Collision Check

Run before and after deployments on the server:

```bash
docker ps --format '{{.Names}}' | while read -r c; do
  labels=$(docker inspect --format '{{json .Config.Labels}}' "$c" 2>/dev/null || echo '{}')
  echo "$labels" | jq -r --arg c "$c" '
    to_entries[]
    | select(.key | test("^traefik\\.http\\.routers\\..*\\.rule$"))
    | "\($c)\t\(.value)"
  '
done
```

Review output so each `Host(\`...\`)` value appears under only one app/service.

---

## Incident Signature and Fix

### Signature

- Same API key alternates between `connected=true` and `connected=false`.
- Requests appear to randomly return `API key not recognized`.
- Behavior changes between requests without code changes.

### Root Cause

Two different containers with different data/auth state both routed behind the same host rule.

### Fix

1. Identify canonical owner app for the host.
2. Remove host Traefik labels from non-owner service compose.
3. Redeploy non-owner app through Coolify.
4. Verify only one running container has that host router label.
5. Re-run endpoint smoke checks.

---

## Change Control Checklist

Any PR touching deployment compose files must include:

1. Explicit host ownership impact statement.
2. Confirmation that no duplicate `Host(...)` rules were introduced.
3. Post-deploy verification result (single host owner + smoke checks).

