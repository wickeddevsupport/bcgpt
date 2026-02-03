# True MCP Deep Audit

Last updated: 2026-02-03

This audit enumerates every failure surface and required capability for a truly reliable Basecamp MCP server. It is intentionally exhaustive and is the authoritative checklist before claiming correctness.

## Scope
All Basecamp entity types, all CRUD and comment surfaces, all search paths, all pagination and chunking behavior, all resolver paths from UI URLs, and all OpenAPI wrapper constraints.

## 0) Non-negotiables
- A tool must never claim "not found" unless all authoritative sources were checked or the tool returns a structured "insufficient evidence" error.
- Every list or search response must include coverage metadata.
- Large results must be chunked with a payload key and retrievable chunks.
- `/mcp` is the authoritative interface. `/action` is a best-effort compatibility wrapper.

---

## 1) Input and Intent Layer
### Required behavior
- Parse user intent: search, list, get, create, update, delete, comment, assign, move, report.
- Extract entity targets: person, project, todo, card, message, document, upload, schedule, hill chart, campfire.
- Parse Basecamp UI URLs for any entity.
- Disambiguate only when multiple exact matches exist.
- Reject missing query for search tools (`MISSING_QUERY`).

### Failure modes
- Empty query silently returning a chunked list.
- URL parsed to the wrong entity type.
- Partial matches returned without asking for clarification.
- Incorrect inference of entity from generic language.

### Required fixes
- Enforce `query` on search-like tools.
- Add a resolver tool for URLs and typed entity hints.
- Add deterministic disambiguation rules (exact > contains > fuzzy).

---

## 2) Resolver Layer (URL + ID)
### Required behavior
- Resolve UI URLs to API endpoints for cards, todos, recordings, messages, docs, uploads, and comments.
- Resolve card ID to recording ID when comments are requested.
- Resolve comment ID to its parent and the correct comments endpoint.
- Report "resolved_as" in the response for traceability.

### Failure modes
- Using UI URLs as API endpoints (404).
- Cards resolved as recordings without recording_id.
- Comments created against the wrong parent.

### Required fixes
- Dedicated `resolve_entity_from_url` tool.
- Card resolution helper (card -> recording_id).
- Comment parent resolution helper with explicit fallbacks.

---

## 3) Search Layer (API)
### Required behavior
- Search must be authoritative for people, projects, recordings, todos, cards, docs, messages, uploads.
- Search fallbacks follow a clear hierarchy: API search -> project scan -> local index.
- Searches must return coverage metadata, even when empty.

### Failure modes
- People search missing due to empty directory list.
- Cards not searchable by title or ID without a scan.
- Recordings search not filtered by creator_id.

### Required fixes
- `search_people`, `search_projects`, `search_cards`, `search_entities`.
- Activity search based on creator_id, not name search.

---

## 4) Indexing Layer
### Required behavior
- Miner indexes people, projects, cards, todos, messages, documents.
- Index is used as a fallback for search.
- Index is scoped by account and authenticated user.

### Failure modes
- No card index -> impossible to find by title at scale.
- Index stale or cross-user.

### Required fixes
- Extend miner to index cards and todos.
- Add timestamp and scope to every index payload.

---

## 5) Pagination and Chunking
### Required behavior
- All list and search endpoints must fully paginate.
- Chunked payloads must include payload key and chunk count.
- Clients must retrieve chunks or tools must return higher inline limits for search-like responses.

### Failure modes
- Missing Link headers cause partial data.
- Connector ignores chunks, causing false negatives.

### Required fixes
- Fallback page iteration when Link header is missing.
- Inline limits for search tools that exceed typical connector limits.

---

## 6) Commenting and Creation Surfaces
### Required behavior
- Comments on recordings, todos, cards, messages, and docs.
- Create and update operations for project, todo, card, message, document, schedule entry.
- Accept UI URL input for any comment or create tool.

### Failure modes
- Card comments posted to wrong endpoint.
- Missing or wrong ID extracted from UI URL.

### Required fixes
- Route cards to the recording comments endpoint when available.
- Accept URL input and resolve it before posting.

---

## 7) Activity Layer
### Required behavior
- Person activity must use creator_id and project context.
- Activity should be scoped to projects when possible.

### Failure modes
- Name-based search used instead of creator_id.
- Activity missing in archived projects.

### Required fixes
- `list_person_activity` tool with optional project scoping.
- Include archived-project toggle.

---

## 8) Access and Permissions
### Required behavior
- Explicitly handle missing tools in the dock.
- Client vs member visibility differences must be explained.

### Failure modes
- Tools appear empty due to missing dock features.
- Wrong error message for permission failure.

### Required fixes
- Typed notices and hints when dock tools are disabled or unavailable.
- Permission errors must include the tool name and required access.

---

## 9) OpenAPI Wrapper (Compatibility)
### Required behavior
- Enforce query requirements for search actions.
- Route generic "find" to `smart_action` or `search_entities`.
- Prevent silent truncation for search and list actions.

### Failure modes
- Connector sends `{}` and gets partial lists.
- Responses truncated without a payload key.

### Required fixes
- Required `query` fields in OpenAPI for search-like actions.
- Inline limits for search responses to avoid chunk drops.

---

## 10) Auth, Account, and Environment
### Required behavior
- Ensure account_id is resolved deterministically or returned as an error.
- Handle missing or invalid tokens with a clear auth flow.
- Support multi-account selection in a predictable order.

### Failure modes
- Default account used when it should be confirmed.
- Token refresh not persisted.

### Required fixes
- Strict account resolution rules with logs.
- Explicit "account mismatch" errors.

---

## 11) Request Context and Caching
### Required behavior
- Preloads must not mask missing data.
- Cache hits must still return coverage metadata.
- Cache invalidation must be explicit for write operations.

### Failure modes
- Cached empty lists treated as authoritative.
- Cached search results returned after writes.

### Required fixes
- Cache freshness markers and per-tool TTLs.
- Explicit cache bust for write paths.

---

## 12) Rate Limits, Retries, and Backoff
### Required behavior
- Honor Basecamp rate limits.
- Retry transient failures with exponential backoff.
- Surface throttling state in logs.

### Failure modes
- Throttling causes partial lists.
- Retries duplicate writes.

### Required fixes
- Only retry idempotent requests.
- Write retries require explicit idempotency keys.

---

## 13) Data Normalization
### Required behavior
- Normalize names for comparison (case, whitespace, punctuation).
- Normalize emails (lowercase).
- Normalize date and time outputs to ISO 8601.

### Failure modes
- Name match fails because of whitespace or punctuation.
- Date parsing incorrect due to locale.

### Required fixes
- Centralized normalization helpers.
- Use timezone-aware conversions.

---

## 14) Error Handling and Observability
### Required behavior
- All errors are typed and actionable.
- Logs include tool name, inputs, endpoint, and fallback path.
- Every "no results" includes coverage metadata.

### Failure modes
- Generic 500 errors without context.
- Missing logs for fallbacks.

### Required fixes
- Standard error envelope.
- Structured debug flags per tool.

---

## 15) Uploads and Attachments
### Required behavior
- Uploads must be multi-step with error handling.
- Attachments in comments must be resolvable to URLs.

### Failure modes
- Upload step succeeded but attachment link missing.
- Comments fail due to missing bucket context.

### Required fixes
- Explicit upload state machine.
- Enforce required bucket or project context.

---

## 16) Concurrency and Idempotency
### Required behavior
- Safe parallelization for list endpoints.
- Idempotent write support for create and update.

### Failure modes
- Duplicate creation on retries.
- Concurrent list calls exceeding rate limits.

### Required fixes
- Idempotency keys for create.
- Bounded concurrency in `apiAll`.

---

## 17) Security and Privacy
### Required behavior
- Redact tokens and secrets from logs.
- Avoid leaking private data across accounts.

### Failure modes
- Tokens logged in debug output.
- Cached payload from one user visible to another.

### Required fixes
- Log redaction rules.
- Cache scoping by account and user.

---

## 18) Verification and Regression
### Required behavior
- Regression suite for search, people, projects, recordings, cards, comments.
- Cross-check API list vs search results.

### Failure modes
- False negatives on people search.
- Missing cards due to board size.

### Required fixes
- Automated tests for known people and cards.
- Coverage comparison between search and list endpoints.

---

## Summary of Gaps to Eliminate
- Card deletion tools are still missing.
- Indexing remains incomplete for messages, documents, and uploads.
- Activity scoping to project is heuristic and needs stronger verification.
- Search tools returning partial lists without forcing chunk retrieval must be audited continuously.
- Idempotency protections for create operations remain incomplete.

This audit is the checklist for completion before calling the MCP "bulletproof".
