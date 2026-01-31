# Basecamp GPT – Production AI Agent

This is a **single-user, production-ready Basecamp AI agent** that turns natural language into real Basecamp actions while keeping per-account data isolated.

## What it does
- `/startbcgpt` → shows user name, email, and re-auth link
- Read/write **todos, messages, chat, schedule**
- Global reporting (today, overdue, search)
- Dock-aware (only uses the tools your Basecamp project exposes)
- Raw Basecamp fallback for 100% coverage

## Edge-case handling
- Optional tools (message boards, documents, schedule, hill charts, card tables) are discovered via dock.
- Read handlers return empty results with a `notice` when a tool is disabled or a resource is missing.
- Write handlers return explicit error codes with hints to resolve the issue.
- See `docs/EDGE_CASES_FRAMEWORK.md` for the full strategy.

## Multi-account handling
- The server stores one token, but every cache (search index, entities, tool runs, miner state) is keyed by the authenticated user/account so reauthing another person keeps their data separate.
- `dev.html` now enforces an account selection before running projects/actions/searches and persists the choice per user, keeping the UI, caches, and project state aligned.

## Run
```bash
npm install
cp .env.example .env
npm start
```

Server endpoints you care about:
- POST `/mcp`
- GET `/auth/basecamp/start`
- GET `/auth/basecamp/callback`
- POST `/logout`

## Philosophy
- One user per auth session
- Scoped caches for each account
- Zero bullshit – the agent always tries
