# Edge Case Framework

This document describes the global edge-case handling strategy used by the MCP handlers.

## Goals
- Prefer dock discovery over hardcoded endpoints.
- Follow link fields when available.
- Provide structured notices for disabled tools or missing resources.
- Avoid hard failures for read-only operations when a tool is not enabled.

## Core Rules
1. **Dock-first for optional tools**  
   For tools like message boards, documents, schedule, hill charts, card tables, and chat, the dock
   is the source of truth for what is enabled and what URLs to follow.

2. **Link-following**  
   If the API response includes `*_url` fields, prefer those instead of constructing paths.

3. **Typed errors -> user-facing notices**  
   Errors are normalized into:
   - `TOOL_NOT_ENABLED` (dock missing or disabled)
   - `TOOL_UNAVAILABLE` (dock exists but no usable URL)
   - `RESOURCE_NOT_FOUND` (ID not found or not in project)

4. **Read operations return empty + notice**  
   When a tool is disabled, read handlers return:
   - empty data arrays
   - a `notice` payload explaining why
   - a hint for next action (enable tool / call list endpoint)

5. **Write operations return explicit failures**  
   For create/update/delete, the handler returns a failure with the typed code and hint.

6. **Intelligent search fallbacks**  
   When the intelligent layer returns empty or makes zero API calls, fall back to:
   - API search
   - Local DB index (as a last resort)

## Examples
- `list_message_boards` -> empty array + notice if message boards not enabled.
- `list_documents` -> empty array + notice if documents not enabled.
- `list_schedule_entries` -> empty array + notice if schedule not enabled.
- `list_card_table_cards` -> empty array + notice if card table ID not found.

## Notes
- This framework is designed to make the MCP resilient to missing tools and stale IDs.
- If a tool is optional, handlers should avoid throwing hard errors for read calls.
