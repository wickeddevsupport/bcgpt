---
name: figma-mcp-workflows
description: Use Figma MCP tools correctly for design-to-code, code-connect, variable extraction, screenshots, and live UI capture. Use when the user wants to inspect Figma, pull design context, compare code to design, or send a live UI into Figma.
---

# Figma MCP Workflows

Use this skill when the task depends on Figma MCP rather than generic design advice.

## Setup Facts

- The preferred remote MCP endpoint is `https://mcp.figma.com/mcp`.
- Codex manual setup uses `codex mcp add figma --url https://mcp.figma.com/mcp`.
- The remote server supports OAuth sign-in and works across projects once added globally in the MCP client.
- Remote mode is best for cross-project use and for live UI capture.
- Desktop mode allows selection-based prompting inside the Figma desktop app.

## Choose The Right Workflow

### 1. Design context from Figma

Use when the user wants implementation guidance, token info, or details from an existing frame.

- Ask for a Figma frame or layer link if remote mode is being used.
- Use `get_design_context` first.
- Use `get_variable_defs` when token details matter.
- Use `get_screenshot` when the returned structure needs visual confirmation.

### 2. Compare implementation to design

Use when the user wants to check whether code matches Figma.

- Fetch `get_design_context` for the relevant node.
- Inspect the local codebase for the target component or page.
- Use `get_code_connect_map` if the file already has Code Connect mappings.
- Report differences as implementation drift, missing states, token drift, or layout drift.

### 3. Improve design-system handoff

Use when the user wants reusable rules or better design-to-code translation.

- Use `get_variable_defs` to inspect tokens and variables.
- Use `create_design_system_rules` when the user wants reusable implementation guidance.
- Use `get_code_connect_suggestions` and `send_code_connect_mappings` only when the goal is to formalize mappings.

### 4. Send live UI to Figma

Use when the user wants the app or site captured into Figma.

- This is remote-only and currently supported for Claude Code, Codex, and VS Code.
- Make sure a live local or remote URL is available.
- Prompt explicitly for capture, for example:
  - `Start a local server for my app and capture the UI in a new Figma file.`
- Use `generate_figma_design`.

## Guardrails

- Do not pretend selection-based prompts work in remote mode; they require a link-based node reference.
- Do not promise file edits inside Figma unless the relevant MCP workflow supports it.
- If the MCP server is disconnected, stop and report the missing connection instead of fabricating context.
- If the user wants code, specify the target stack because Figma context defaults can skew toward React-style output.

## Response Shape

When using this skill, respond with:

1. The workflow you are using.
2. Any missing prerequisite.
3. The MCP calls to make or that were made.
4. The result or next concrete step.
