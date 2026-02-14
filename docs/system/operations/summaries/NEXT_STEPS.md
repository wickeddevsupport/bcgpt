# Next Steps (True MCP Path)

This is the short, actionable backlog to finish the transition to a **true MCP server** (see `docs/phases/TRUE_MCP_ROADMAP.md`).

## Operational Gate (2026-02-14)
1) ✅ Resolved intermittent `bcgpt.wickedlab.io` gateway failures.
2) Root cause: Traefik/backend network ambiguity when service containers are attached to multiple Docker networks without an explicit Traefik network pin.
3) Live mitigation applied: attached `coolify-proxy` to `bcgptapi_default` to eliminate unreachable backend-IP selections.
4) Permanent config fix committed in compose:
   - `docker-compose.yaml`: added `traefik.docker.network=coolify` and explicit network wiring.
   - `docker-compose.bcgpt.yml`: retained Traefik network pin and added `bcgpt_internal` so `bcgpt` and `bcgpt-postgres` always share an internal network.

## Next Phase (Post-Gateway)
1) Start Phase 8 implementation backlog (hardening code, not docs):
   - Audit events table + logging.
   - Runtime telemetry collection + dashboard.
   - Playwright E2E suite + CI integration.
   - Security hardening pass (rate limits, CORS, secret masking verification).

## Must do (Search + Correctness)
1) Enforce query requirements for all search-like tools (return `MISSING_QUERY` for missing inputs).
2) Ensure chunk integrity: never return partial arrays without `payload_key` + `chunk_count`.
3) Add card restore-from-trash if Basecamp supports it.

## Near-term (Index + Cards)
1) Add regression tests for search (people/projects/cards) and chunk retrieval.
2) Add coverage checks for search_recordings with `creator_id`.

## OpenAPI wrapper hardening
1) Force `query` in `/action` search tools (or return `MISSING_QUERY`).
2) Enforce chunk retrieval when `payload_key` is present.
3) Keep `/action` aligned with the 30-action cap and route extras through `smart_action`.

## Notes
- The most reliable interface is `/mcp` (JSON-RPC). `/action` is best-effort compatibility.
- Use `docs/phases/TRUE_MCP_ROADMAP.md` as the canonical plan.
