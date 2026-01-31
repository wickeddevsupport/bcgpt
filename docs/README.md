# Basecamp GPT – Production AI Agent

This is a **single-user, production-ready Basecamp AI agent**.
It turns natural language into real Basecamp actions.

## What it does
- `/startbcgpt` → shows user name, email, and re-auth link
- Read/write **todos, messages, chat, schedule**
- Global reporting (today, overdue, search)
- Dock-aware (only uses enabled tools)
- Raw fallback for 100% Basecamp coverage

## Run
```bash
npm install
cp .env.example .env
npm start
```

Server:
POST /mcp
GET  /auth/basecamp/start
GET  /auth/basecamp/callback

## Philosophy
- One user
- One token
- Zero bullshit
- Agent always tries
