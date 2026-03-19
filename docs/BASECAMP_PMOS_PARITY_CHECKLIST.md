# Basecamp PMOS Parity Checklist

**Last Updated:** 2026-03-19

## Goal

PMOS should be able to do everything a strong Basecamp user can do manually, while adding AI-native advantages:

- ask in plain language instead of hunting through screens
- move from summaries into exact item-level detail without losing context
- sync workspace state deeply enough that the AI can answer from current data
- keep one-click paths from object -> discussion -> action -> follow-up

## Current Audit Findings

These are the main reasons PMOS/Basecamp still feels shallow or inconsistent today:

- `buildListPayload()` compacts many collection responses by default.
- `projectSummary()` strips dock tools down to a tiny summary.
- `get_project_structure()` used to trim dock payloads to a small diagnostic subset instead of exposing the full dock tool objects.
- PMOS still lacks a deliberate distinction between:
  - at-a-glance summary reads
  - exact record reads
  - full project sync / deep inspection

## Product Standard

For every Basecamp object type, PMOS should support all three layers:

1. `Glance`
   Short, useful, manager-friendly summaries.
2. `Inspect`
   Full detail for one item or one scoped list.
3. `Act`
   Create, update, complete, move, comment, assign, or route work.

If PMOS cannot do all three for a Basecamp object, parity is incomplete.

## Basecamp Capability Checklist

### Workspace + Identity

- [ ] Show current Basecamp identity, account, access state, and auth health cleanly.
- [ ] List all accounts and switch context safely when multiple accounts exist.
- [ ] Explain what PMOS can and cannot access in the current account.

### Projects + Dock

- [x] List projects.
- [x] Resolve projects by name.
- [x] Read project dock / structure.
- [ ] Return full dock metadata by default to PMOS sync layers when requested.
- [ ] Build a project capability map from the dock so PMOS knows exactly which tools are enabled.
- [ ] Surface disabled vs enabled features clearly in the UI.

### People

- [x] List people and project people.
- [x] Resolve a person by name.
- [x] Read current-user profile.
- [ ] Provide robust person detail views in PMOS UI.
- [ ] Support person-centric cockpit views: workload, recent activity, blockers, overdue items.

### Todos + Todolists

- [x] List todolists.
- [x] List todos by project and list.
- [x] Read one todo.
- [x] Create / update / complete / uncomplete todos.
- [x] Find current-user assigned todos.
- [x] Find overdue todos.
- [ ] Distinguish summary vs detailed assignment reads everywhere.
- [ ] Always expose enough metadata for PMOS to answer follow-up questions like:
  - what does this todo mean?
  - what list is it in?
  - who owns it?
  - what project is it tied to?
  - what changed recently?
- [ ] Add reliable “today / tomorrow / next 7 days / no due date / recently completed” views.

### Card Tables

- [x] List card tables, columns, and cards.
- [x] Read and update cards.
- [ ] Expose richer card detail in PMOS without forcing raw API calls.
- [ ] Support board-level AI views: bottlenecks, stalled columns, cards without owners, aging cards.

### Messages + Comments

- [x] List boards and messages.
- [x] Read messages.
- [x] List and create comments.
- [ ] Provide thread-first PMOS views so a user can jump from item -> discussion cleanly.
- [ ] Support AI summaries at board, thread, and message level.

### Docs + Uploads + Vault

- [x] List documents and uploads.
- [x] Read single documents/uploads.
- [ ] Provide better search and preview paths in PMOS UI.
- [ ] Add “why does this file matter?” / “where is this referenced?” AI workflows.

### Schedule

- [x] List schedule entries.
- [x] Read one schedule entry.
- [x] Create and update schedule entries.
- [ ] Support clearer calendar agenda views in PMOS.
- [ ] Add AI planning views for workload and upcoming deadlines.

### Campfire

- [x] List campfires and lines.
- [x] Post campfire lines.
- [ ] Provide better timeline/chat views inside PMOS so Campfire is usable without context loss.

### Client-facing Tools

- [x] Inboxes, forwards, replies.
- [x] Approvals.
- [x] Correspondences.
- [x] Questionnaires and answers.
- [ ] Audit these end-to-end in PMOS UI with clear entry points, not only MCP tools.

### Admin / Automation / Advanced

- [x] Webhooks.
- [x] Templates.
- [x] Reminders.
- [x] Timesheets.
- [x] Lineup markers.
- [ ] Build PMOS workflows that can watch these objects continuously and report changes proactively.

### URL + Entity Resolution

- [x] Resolve pasted Basecamp URLs to entities.
- [ ] Guarantee that every major Basecamp URL type can open into a PMOS detail view.
- [ ] Guarantee follow-up AI questions can stay anchored to the resolved object.

## PMOS UX / UI Backlog

### Command Center

- [ ] Replace the current messy command center with a data-first workspace home.
- [ ] Show:
  - my work today
  - overdue items
  - due tomorrow
  - active risks
  - blocked projects
  - recent conversations
- [ ] Let every card open a detail drawer with AI actions, raw data, and linked objects.

### Project Cockpit

- [ ] One PMOS project screen per Basecamp project.
- [ ] Tabs / sections:
  - Overview
  - Todos
  - Board
  - Schedule
  - Messages
  - Files
  - People
  - Activity
- [ ] AI should be scoped to the open project automatically.

### Detail Drawer Standard

- [ ] Every object should open with:
  - core metadata
  - linked project
  - linked people
  - linked discussion / comments
  - AI actions
  - raw JSON / source links when needed

### AI Everywhere

- [ ] “Explain this item”
- [ ] “Summarize changes”
- [ ] “Draft reply”
- [ ] “Find blockers”
- [ ] “What should happen next?”
- [ ] “Show related work”

## Data Layer / Sync Backlog

- [ ] Separate summary reads from deep-sync reads explicitly in the MCP contract.
- [ ] Add PMOS-oriented sync tools for:
  - project dock sync
  - full project object sync
  - item detail hydration
  - incremental activity refresh
- [ ] Cache raw objects and normalized objects side-by-side.
- [ ] Let PMOS request exact detail on demand without forcing the LLM to infer missing fields.

## Recommended Execution Order

1. Fix compaction / detail boundaries in MCP responses.
2. Add PMOS sync-oriented dock + project detail tools.
3. Build a usable command center around real Basecamp states.
4. Build a proper project cockpit with inspectable objects.
5. Layer AI actions on top of reliable live data.

## Definition Of Done

We should consider this direction healthy when a normal Basecamp user can:

- ask “what do I need to do today?”
- ask “show me the full details of that todo”
- jump into the linked project, discussion, and files
- take action from the same screen
- trust that PMOS is grounded in current Basecamp state

without having to fall back to raw API troubleshooting or guess which tool path the system took.
