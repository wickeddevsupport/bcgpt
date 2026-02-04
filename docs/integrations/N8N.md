# n8n Integration

Last updated: 2026-02-04

This doc shows how to run n8n alongside BCGPT on the same Render service and connect it through MCP.

## Domains
- BCGPT: `https://bcgpt.wickedlab.io`
- n8n: `https://automate.wickedlab.io`

## Environment (BCGPT)
- `N8N_PROXY_ENABLED=true`
- `N8N_PROXY_HOST=automate.wickedlab.io`
- `N8N_PROXY_TARGET=http://127.0.0.1:5678`
- `N8N_INTERNAL_URL=http://127.0.0.1:5678`
- `N8N_API_VERSION=1`
- `N8N_TIMEOUT_MS=15000`
- `N8N_RETRIES=2`

## Environment (n8n runtime)
- `N8N_HOST=automate.wickedlab.io`
- `N8N_PROTOCOL=https`
- `N8N_PORT=5678`
- `WEBHOOK_URL=https://automate.wickedlab.io/`
- `N8N_PROXY_HOPS=1`

## Run (single Render service)
1. Install dependencies: `npm install`
2. Start both processes: `npm run start:all`
3. Verify the endpoints.

- `https://bcgpt.wickedlab.io/health`
- `https://automate.wickedlab.io/`

## API Key Setup
1. Log in to n8n UI.
2. Create an API key (Settings > API Keys).
3. Store it per user in BCGPT using:
   - MCP tool `n8n_set_api_key`

## Using n8n Tools (MCP)
- `n8n_status`: check if an API key is stored
- `n8n_list_workflows`: list workflows
- `n8n_get_workflow`: fetch by id
- `n8n_create_workflow`: requires `confirm=true` and required fields
- `n8n_update_workflow`: requires `confirm=true` and required fields
- `n8n_delete_workflow`: requires `confirm=true`
- `n8n_request`: raw n8n API calls when you need full control

Required workflow fields for create/update:
- `name`
- `nodes`
- `connections`
- `settings`

## Custom n8n Node (BCGPT)
The repo includes a custom node package at `n8n/n8n-nodes-bcgpt`.

Steps:
1. Set `N8N_CUSTOM_EXTENSIONS` to the full path of `n8n/n8n-nodes-bcgpt`
2. Restart n8n
3. Add the **BCGPT** node in the n8n editor

The node calls `POST /action/mcp_call` with your tool name + args, and supports session/user keys.
