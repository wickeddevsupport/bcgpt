# Product Vision

**Last Updated:** 2026-03-10

## Vision

PMOS should become a true operating system for agency work: one place where AI can understand the workspace, act across tools, keep durable memory, and produce clean visible outcomes instead of vague assistant chatter.

The product is not "chat plus some integrations." The product is:

- a workspace-aware AI operator
- a project manager on top of Basecamp
- a workflow assistant on top of Flow / Activepieces
- a creative director on top of FM + Figma
- a durable organizational memory layer across agents, projects, and sessions

## What PMOS Should Feel Like

For the user, the ideal experience is simple:

1. open PMOS
2. ask for work in plain language
3. watch the system reason, call tools, and make progress live
4. get a clean answer, artifact, or action
5. come back later and find that the workspace still remembers context

The UI should feel operational, not ceremonial. The assistant should not hide behind "I can help with..." filler when the tools are already available.

## Core Product Pillars

### 1. Autonomous Project Manager

PMOS should understand Basecamp deeply enough to manage real project operations:

- list and inspect projects, todos, schedules, messages, people, and assignments
- answer project questions from live data, not memory-only recall
- use `bcgpt_smart_action` as the default Basecamp router when appropriate
- produce useful summaries, next actions, risks, blockers, and status updates
- keep outputs grounded in the current workspace context

The standard is not "Basecamp is connected." The standard is "the assistant behaves like a competent PM using live Basecamp data."

### 2. Workflow Assistant

PMOS should make Flow / Activepieces usable through language first and canvas second:

- inspect workflows, runs, credentials, and node capabilities
- create and update workflows without dumping raw JSON on the user
- monitor workflow health and explain failures
- surface real execution state and history inside PMOS
- treat workflow automation as a first-class operational capability, not a side panel

The standard is not "workflow tools exist." The standard is "a user can ask for a workflow, understand what was created, and trust it."

### 3. Creative Director

PMOS should make design operations and design analysis feel built-in:

- FM MCP for file-manager tasks: files, tags, folders, categories, links, sync state
- official Figma access or PAT-backed REST audit for design/document analysis
- clear routing between FM tasks and Figma document tasks
- audits for components, styles, variables, fonts, auto-layout, and structural regression
- project-aware design guidance that references the selected file and workspace state

The standard is not "Figma is authenticated." The standard is "the assistant can inspect the right file, explain what is wrong, and suggest the next design move clearly."

### 4. Durable Workspace Memory

PMOS should remember the right things permanently:

- user preferences
- project facts
- design standards
- workflow conventions
- ongoing decisions
- corrections and exceptions

This memory must survive:

- session changes
- compaction
- deploys
- restarts
- container replacement

The memory model should be:

- per workspace
- per agent
- optionally shared only when intentionally promoted

The standard is not "chat history exists." The standard is "the workspace gets smarter over time without leaking context."

## Interaction Principles

### Live, Visible Work

When PMOS is working, the user should see:

- thinking / plan updates
- tool calls
- intermediate findings
- final answer synthesis

Runs should not disappear into silent background work and end with no visible output.

### Deterministic Outcomes Over Vibes

When a tool succeeded, PMOS should produce a final user-visible answer even if the model fails to write one elegantly. Tool success should collapse into clean output, not dead-end loops.

### Workspace Context First

The assistant should always prefer:

- workspace connectors
- selected project context
- selected Figma/FM context
- live workspace tools

before falling back to memory or generic explanation.

### Honest Capability Boundaries

PMOS should never blur distinct systems into one vague "integration":

- FM MCP is not official Figma MCP
- official Figma MCP is not the PAT-backed REST audit path
- Basecamp live data is not memory recall
- workflow execution is not the same as workflow generation

If one path is down, the assistant should name the failed path precisely and use the right fallback.

## Product Direction

### Near-Term Direction

- make chat runs reliable and always output-bearing
- strengthen deterministic routing for Basecamp, FM, Figma, and workflow tasks
- harden refresh/reconnect behavior for all chat panels
- improve durable memory extraction and retrieval quality
- keep the top-level docs and deploy path aligned with reality

### Mid-Term Direction

- stronger project-level operating views, not just chat answers
- richer workflow monitoring and remediation
- better design audit/report formats with actionable recommendations
- production-grade multi-user regression coverage
- workspace-level knowledge graphs / structured memory

### Long-Term Direction

PMOS should become the control plane for the agency:

- project state
- design state
- automation state
- organizational memory
- AI operator execution

The user should not need to think in terms of separate apps most of the time. PMOS should coordinate them.

## Success Criteria

We should consider the vision on track when all of these feel true:

- a Basecamp question returns live, useful project intelligence
- a workflow request becomes a real working workflow with clear confirmation
- a Figma/design request uses the right tool path and returns a meaningful audit
- every chat panel shows live progress and a final answer
- memory survives deploys and makes later work better
- the system behaves like one coherent product, not four loosely connected tools

## Related Documentation

- [DOCS_INDEX.md](DOCS_INDEX.md)
- [PMOS_ACTIVEPIECES_STATUS.md](PMOS_ACTIVEPIECES_STATUS.md)
- [ROADMAP_AND_STATUS.md](ROADMAP_AND_STATUS.md)
- [NEXT_STEPS.md](NEXT_STEPS.md)
