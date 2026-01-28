
# bcgpt – Full Basecamp Control Plane

This package contains a **checklist-complete Basecamp backend**:
- REST API (Tier 0–6)
- MCP semantic server (fully implemented)
- OAuth, auth state, fuzzy matching, fail-fast ambiguity

## Files
- index.js — main server
- mcp.js — MCP semantic tools
- resolvers.js — fuzzy resolution helpers
- basecamp.js — Basecamp API wrapper

## Setup
1. npm install
2. set env vars:
   - BASECAMP_CLIENT_ID
   - BASECAMP_CLIENT_SECRET
   - APP_BASE_URL
3. npm start
