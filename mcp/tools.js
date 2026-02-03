// mcp/tools.js
import { ENDPOINT_TOOLS } from "./endpoint-tools.js";

function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}

function noProps() {
  return { type: "object", properties: {}, additionalProperties: false };
}

export function getTools() {
  const tools = [
    tool("startbcgpt", "Show connection status, current user (name/email), plus re-auth and logout links.", noProps()),
    tool("whoami", "Return account id + authorized accounts list.", noProps()),

    tool("list_accounts", "List Basecamp accounts available to the authenticated user.", noProps()),
    tool("list_projects", "List projects (supports archived).", {
      type: "object",
      properties: { archived: { type: "boolean" } },
      additionalProperties: false
    }),
    tool("find_project", "Resolve a project by name (fuzzy).", {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false
    }),

    tool("daily_report", "Across projects: totals + per-project breakdown + due today + overdue (open only).", {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD (defaults today)" } },
      additionalProperties: false
    }),
    tool("list_todos_due", "Across projects: list open todos due on date; optionally include overdue.", {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD (defaults today)" },
        include_overdue: { type: "boolean" }
      },
      additionalProperties: false
    }),
    tool("search_todos", "Search open todos across all projects by keyword.", {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false
    }),
    tool("assignment_report", "Group open todos by assignee within a project (optimized).", {
      type: "object",
      properties: { project: { type: "string" }, max_todos: { type: "integer" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("get_person_assignments", "List todos assigned to a specific person within a project.", {
      type: "object",
      properties: { project: { type: "string" }, person: { type: "string" } },
      required: ["project", "person"],
      additionalProperties: false
    }),
    tool("list_assigned_to_me", "List todos assigned to the current user (optionally within a project).", {
      type: "object",
      properties: { project: { type: "string", nullable: true } },
      additionalProperties: false
    }),
    tool("smart_action", "Smart router: decide which action to call based on natural language query and context.", {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string", nullable: true }
      },
      required: ["query"],
      additionalProperties: false
    }),
    tool("audit_person", "Summarize a person's Basecamp presence (projects, assigned todos, recent activity).", {
      type: "object",
      properties: {
        person: { type: "string", description: "Name, email, or person ID." },
        include_archived_projects: { type: "boolean" },
        include_assignments: { type: "boolean" },
        include_activity: { type: "boolean" },
        activity_limit: { type: "integer" }
      },
      required: ["person"],
      additionalProperties: false
    }),
    tool("mcp_call", "Proxy call to any MCP tool by name (full toolset access).", {
      type: "object",
      properties: {
        tool: { type: "string", description: "MCP tool name to invoke." },
        args: { type: "object", additionalProperties: true, description: "Arguments for the tool." }
      },
      required: ["tool"],
      additionalProperties: false
    }),

    tool("search_people", "Search people by name/email (server-side).", {
      type: "object",
      properties: {
        query: { type: "string" },
        include_archived_projects: { type: "boolean" }
      },
      required: ["query"],
      additionalProperties: false
    }),

    tool("search_projects", "Search projects by name.", {
      type: "object",
      properties: {
        query: { type: "string" },
        include_archived_projects: { type: "boolean" },
        limit: { type: "integer" }
      },
      required: ["query"],
      additionalProperties: false
    }),

    tool("search_cards", "Search cards by title/content (project required unless index is available).", {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string", nullable: true },
        include_archived_projects: { type: "boolean" },
        limit: { type: "integer" },
        max_cards_per_column: { type: "integer" }
      },
      required: ["query"],
      additionalProperties: false
    }),

    tool("list_person_projects", "List projects a person belongs to (by name, email, or ID).", {
      type: "object",
      properties: {
        person: { type: "string" },
        include_archived_projects: { type: "boolean" }
      },
      required: ["person"],
      additionalProperties: false
    }),

    tool("list_person_activity", "List recent activity for a person (timeline-based).", {
      type: "object",
      properties: {
        person: { type: "string" },
        project: { type: "string", nullable: true },
        query: { type: "string", nullable: true },
        include_archived_projects: { type: "boolean" },
        limit: { type: "integer" }
      },
      required: ["person"],
      additionalProperties: false
    }),

    tool("resolve_entity_from_url", "Resolve a Basecamp UI/API URL into a structured entity reference.", {
      type: "object",
      properties: {
        url: { type: "string" },
        fetch: { type: "boolean", nullable: true }
      },
      required: ["url"],
      additionalProperties: false
    }),

    tool("search_entities", "Search across people/projects/recordings/todos (and cards by ID when project provided).", {
      type: "object",
      properties: {
        query: { type: "string" },
        project: { type: "string", nullable: true },
        include_archived_projects: { type: "boolean" },
        include_people: { type: "boolean" },
        include_projects: { type: "boolean" },
        include_recordings: { type: "boolean" },
        include_todos: { type: "boolean" },
        include_cards: { type: "boolean" },
        limit: { type: "integer" }
      },
      required: ["query"],
      additionalProperties: false
    }),

    tool("list_todos_for_project", "List todolists + todos for a project by name.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),

    // Schema uses "task". We'll accept task OR content for backward compatibility.
    tool("create_todo", "Create a to-do in a project; optionally specify todolist, due date, and assignees.", {
      type: "object",
      properties: {
        project: { type: "string" },
        task: { type: "string", description: "Todo text (alias: content)" },
        content: { type: "string", description: "Todo text (alias: task)" },
        todolist: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
        due_on: { type: "string", nullable: true },
        starts_on: { type: "string", nullable: true },
        assignee_ids: { type: "array", items: { type: "integer" }, nullable: true },
        notify: { type: "boolean", nullable: true }
      },
      required: ["project"],
      additionalProperties: false
    }),
    tool("update_todo_details", "Update a to-do in a project. Fields omitted are preserved.", {
      type: "object",
      properties: {
        project: { type: "string" },
        todo_id: { type: "integer" },
        content: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
        due_on: { type: "string", nullable: true },
        starts_on: { type: "string", nullable: true },
        assignee_ids: { type: "array", items: { type: "integer" }, nullable: true },
        completion_subscriber_ids: { type: "array", items: { type: "integer" }, nullable: true },
        notify: { type: "boolean", nullable: true }
      },
      required: ["project", "todo_id"],
      additionalProperties: false
    }),
    tool("get_todo", "Get a to-do by ID.", {
      type: "object",
      properties: { project: { type: "string" }, todo_id: { type: "integer" } },
      required: ["project", "todo_id"],
      additionalProperties: false
    }),
    tool("list_todos_for_list", "List to-dos in a specific todolist.", {
      type: "object",
      properties: { project: { type: "string" }, todolist_id: { type: "integer" } },
      required: ["project", "todolist_id"],
      additionalProperties: false
    }),
    tool("uncomplete_todo", "Mark a to-do as incomplete.", {
      type: "object",
      properties: { project: { type: "string" }, todo_id: { type: "integer" } },
      required: ["project", "todo_id"],
      additionalProperties: false
    }),
    tool("complete_todo", "Mark a to-do as complete.", {
      type: "object",
      properties: { project: { type: "string" }, todo_id: { type: "integer" } },
      required: ["project", "todo_id"],
      additionalProperties: false
    }),
    tool("reposition_todo", "Move/reposition a to-do within its list.", {
      type: "object",
      properties: { project: { type: "string" }, todo_id: { type: "integer" }, position: { type: "integer" } },
      required: ["project", "todo_id", "position"],
      additionalProperties: false
    }),
    tool("complete_task_by_name", "Complete a todo in a project by fuzzy-matching its content.", {
      type: "object",
      properties: { project: { type: "string" }, task: { type: "string" } },
      required: ["project", "task"],
      additionalProperties: false
    }),

    tool("list_card_tables", "List card tables (kanban boards) for a project.", {
      type: "object",
      properties: {
        project: { type: "string" },
        include_archived: { type: "boolean" },
        debug: { type: "boolean" },
        include_columns: { type: "boolean" }
      },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_card_table_columns", "List columns for a card table.", {
      type: "object",
      properties: { project: { type: "string" }, card_table_id: { type: "integer" } },
      required: ["project", "card_table_id"],
      additionalProperties: false
    }),
    tool("list_card_table_cards", "List cards for a card table.", {
      type: "object",
      properties: {
        project: { type: "string" },
        card_table_id: { type: "integer", nullable: true },
        max_cards_per_column: { type: "integer" },
        include_details: { type: "boolean" },
        max_boards: { type: "integer" },
        cursor: { type: "integer" }
      },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_card_table_summaries", "List card table summaries for a project, optionally including card titles.", {
      type: "object",
      properties: {
        project: { type: "string" },
        include_cards: { type: "boolean" },
        max_cards_per_column: { type: "integer" },
        include_archived: { type: "boolean" }
      },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_card_table_summaries_iter", "Iterate card table summaries one board per call.", {
      type: "object",
      properties: {
        project: { type: "string" },
        include_cards: { type: "boolean" },
        max_cards_per_column: { type: "integer" },
        include_archived: { type: "boolean" },
        cursor: { type: "integer" }
      },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_project_card_table_contents", "List card table contents for a project, chunked by boards.", {
      type: "object",
      properties: {
        project: { type: "string" },
        include_details: { type: "boolean" },
        include_cards: { type: "boolean" },
        max_cards_per_column: { type: "integer" },
        max_boards: { type: "integer" },
        cursor: { type: "integer" },
        auto_all: { type: "boolean" },
        max_boards_total: { type: "integer" },
        cache_output: { type: "boolean" },
        cache_chunk_boards: { type: "integer" },
        full_dump: { type: "boolean" }
      },
      required: ["project"],
      additionalProperties: false
    }),
    tool("get_cached_payload_chunk", "Retrieve a chunk from the large payload cache.", {
      type: "object",
      properties: {
        payload_key: { type: "string" },
        index: { type: "integer" }
      },
      required: ["payload_key"],
      additionalProperties: false
    }),
    tool("export_cached_payload", "Export a cached payload to a JSON file and return the file path.", {
      type: "object",
      properties: {
        payload_key: { type: "string" }
      },
      required: ["payload_key"],
      additionalProperties: false
    }),
    tool("create_card", "Create a card in a card table.", {
      type: "object",
      properties: {
        project: { type: "string" },
        card_table_id: { type: "integer" },
        title: { type: "string" },
        content: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
        column_id: { type: "integer", nullable: true },
        due_on: { type: "string", nullable: true },
        position: { type: "integer", nullable: true },
        idempotency_key: { type: "string", nullable: true }
      },
      required: ["project", "card_table_id", "title"],
      additionalProperties: false
    }),
    tool("move_card", "Move/update a card (column/position).", {
      type: "object",
      properties: {
        project: { type: "string" },
        card_id: { type: "integer" },
        column_id: { type: "integer", nullable: true },
        position: { type: "integer", nullable: true },
        idempotency_key: { type: "string", nullable: true }
      },
      required: ["project", "card_id"],
      additionalProperties: false
    }),
    tool("archive_card", "Archive a card (recording).", {
      type: "object",
      properties: { project: { type: "string" }, card_id: { type: "integer" } },
      required: ["project", "card_id"],
      additionalProperties: false
    }),
    tool("unarchive_card", "Unarchive a card (recording).", {
      type: "object",
      properties: { project: { type: "string" }, card_id: { type: "integer" } },
      required: ["project", "card_id"],
      additionalProperties: false
    }),
    tool("trash_card", "Trash a card (recording).", {
      type: "object",
      properties: { project: { type: "string" }, card_id: { type: "integer" } },
      required: ["project", "card_id"],
      additionalProperties: false
    }),
    tool("list_card_steps", "List steps (checklist) for a card.", {
      type: "object",
      properties: { project: { type: "string" }, card_id: { type: "integer" } },
      required: ["project", "card_id"],
      additionalProperties: false
    }),
    tool("create_card_step", "Create a step on a card. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, card_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "card_id", "body"],
      additionalProperties: false
    }),
    tool("update_card_step", "Update a card step. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, step_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "step_id", "body"],
      additionalProperties: false
    }),
    tool("complete_card_step", "Mark a card step completed.", {
      type: "object",
      properties: { project: { type: "string" }, step_id: { type: "integer" } },
      required: ["project", "step_id"],
      additionalProperties: false
    }),
    tool("uncomplete_card_step", "Mark a card step as incomplete.", {
      type: "object",
      properties: { project: { type: "string" }, step_id: { type: "integer" } },
      required: ["project", "step_id"],
      additionalProperties: false
    }),
    tool("reposition_card_step", "Reposition a card step within its card.", {
      type: "object",
      properties: { project: { type: "string" }, card_id: { type: "integer" }, step_id: { type: "integer" }, position: { type: "integer" } },
      required: ["project", "card_id", "step_id", "position"],
      additionalProperties: false
    }),

    tool("get_hill_chart", "Fetch the hill chart for a project (if enabled).", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_message_boards", "List message boards for a project.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_messages", "List messages in a message board. If message_board_id omitted, uses the first board.", {
      type: "object",
      properties: { project: { type: "string" }, message_board_id: { type: "integer", nullable: true } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_message_types", "List message types (categories) for a project.", {
      type: "object",
      properties: { project: { type: "string" }, message_board_id: { type: "integer", nullable: true } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("get_message_type", "Get a message type (category) by ID.", {
      type: "object",
      properties: { project: { type: "string" }, message_type_id: { type: "integer" } },
      required: ["project", "message_type_id"],
      additionalProperties: false
    }),
    tool("create_message_type", "Create a message type (category). Provide fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, message_board_id: { type: "integer", nullable: true }, body: { type: "object", additionalProperties: true } },
      required: ["project", "body"],
      additionalProperties: false
    }),
    tool("update_message_type", "Update a message type (category). Provide fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, message_type_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "message_type_id", "body"],
      additionalProperties: false
    }),
    tool("delete_message_type", "Delete a message type (category).", {
      type: "object",
      properties: { project: { type: "string" }, message_type_id: { type: "integer" } },
      required: ["project", "message_type_id"],
      additionalProperties: false
    }),
    tool("pin_recording", "Pin a message or other recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("unpin_recording", "Unpin a message or other recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),

    tool("list_client_correspondences", "List client correspondences for a project.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("get_client_correspondence", "Get a client correspondence by ID.", {
      type: "object",
      properties: { project: { type: "string" }, correspondence_id: { type: "integer" } },
      required: ["project", "correspondence_id"],
      additionalProperties: false
    }),
    tool("list_client_approvals", "List client approvals for a project.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("get_client_approval", "Get a client approval by ID.", {
      type: "object",
      properties: { project: { type: "string" }, approval_id: { type: "integer" } },
      required: ["project", "approval_id"],
      additionalProperties: false
    }),
    tool("list_client_replies", "List client replies for a correspondence/approval recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("get_client_reply", "Get a specific client reply by recording + reply ID.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" }, reply_id: { type: "integer" } },
      required: ["project", "recording_id", "reply_id"],
      additionalProperties: false
    }),

    tool("list_documents", "List documents/files in the project vault.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("get_vault", "Get a vault by ID.", {
      type: "object",
      properties: { project: { type: "string" }, vault_id: { type: "integer" } },
      required: ["project", "vault_id"],
      additionalProperties: false
    }),
    tool("list_child_vaults", "List child vaults within a vault.", {
      type: "object",
      properties: { project: { type: "string" }, vault_id: { type: "integer" } },
      required: ["project", "vault_id"],
      additionalProperties: false
    }),
    tool("create_child_vault", "Create a child vault within a vault. Provide official fields in body.", {
      type: "object",
      properties: {
        project: { type: "string" },
        vault_id: { type: "integer" },
        body: { type: "object", additionalProperties: true }
      },
      required: ["project", "vault_id", "body"],
      additionalProperties: false
    }),
    tool("update_vault", "Update vault metadata. Provide official fields in body.", {
      type: "object",
      properties: {
        project: { type: "string" },
        vault_id: { type: "integer" },
        body: { type: "object", additionalProperties: true }
      },
      required: ["project", "vault_id", "body"],
      additionalProperties: false
    }),
    tool("list_schedule_entries", "List schedule entries for a project (date range optional).", {
      type: "object",
      properties: { project: { type: "string" }, start: { type: "string", nullable: true }, end: { type: "string", nullable: true } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("search_project", "Search within a project (dock-driven search if enabled).", {
      type: "object",
      properties: { project: { type: "string" }, query: { type: "string" } },
      required: ["project", "query"],
      additionalProperties: false
    }),

    // People endpoints
    tool("list_all_people", "List all people visible in the Basecamp account (use empty query to list all).", {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or email to search for. Use empty string to list all." },
        deep_scan: { type: "boolean", description: "Force a deep scan across project memberships." },
        include_archived_projects: { type: "boolean", description: "Include archived projects when deep scanning." }
      },
      required: ["query"],
      additionalProperties: false
    }),
    tool("get_person", "Get profile of a specific person by ID.", {
      type: "object",
      properties: { person_id: { type: "integer" } },
      required: ["person_id"],
      additionalProperties: false
    }),
    tool("get_my_profile", "Get current authenticated user's profile.", noProps()),
    tool("list_project_people", "List all people on a project.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),

    // Comments endpoints
    tool("list_comments", "List comments on a recording (message, document, todo, etc).", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: ["integer", "string"] } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("get_comment", "Get a specific comment by ID.", {
      type: "object",
      properties: { project: { type: "string" }, comment_id: { type: "integer" } },
      required: ["project", "comment_id"],
      additionalProperties: false
    }),
    tool("create_comment", "Create a comment on a recording.", {
      type: "object",
      properties: {
        project: { type: "string" },
        recording_id: { type: ["integer", "string"] },
        recording_query: { type: "string", nullable: true, description: "Title or search query to resolve the recording when ID is unknown." },
        recording_title: { type: "string", nullable: true },
        content: { type: "string", nullable: true },
        body: { type: "object", additionalProperties: true }
      },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),

    // Uploads endpoints
    tool("list_uploads", "List files/uploads in a project vault.", {
      type: "object",
      properties: { project: { type: "string" }, vault_id: { type: "integer", nullable: true } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("get_upload", "Get details of a specific file/upload.", {
      type: "object",
      properties: { project: { type: "string" }, upload_id: { type: "integer" } },
      required: ["project", "upload_id"],
      additionalProperties: false
    }),

    tool("get_recordings", "Query all recordings across projects by type (Todo, Message, Document, Upload, etc).", {
      type: "object",
      properties: {
        type: { type: "string", enum: ["Todo", "Message", "Document", "Upload", "CampfireLine", "Question", "Card", "Schedule::Entry", "Inbox::Forward", "Client::Correspondence", "Client::Approval"] },
        status: { type: "string", enum: ["active", "archived", "trashed"], nullable: true },
        project: { type: "string", nullable: true },
        per_page: { type: "integer", nullable: true },
        page: { type: "integer", nullable: true }
      },
      required: ["type"],
      additionalProperties: false
    }),
    tool("trash_recording", "Move a recording to trash.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("archive_recording", "Archive a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("unarchive_recording", "Unarchive a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),

    tool("list_vaults", "List document storage vaults for a project.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),

    // Campfires
    tool("list_campfires", "List campfires (chats). If project omitted, lists all visible chats.", {
      type: "object",
      properties: { project: { type: "string", nullable: true } },
      additionalProperties: false
    }),
    tool("get_campfire", "Get a campfire (chat) by ID or from project dock.", {
      type: "object",
      properties: { project: { type: "string" }, campfire_id: { type: "integer", nullable: true } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_campfire_lines", "List chat lines in a campfire.", {
      type: "object",
      properties: { project: { type: "string" }, chat_id: { type: "integer" } },
      required: ["project", "chat_id"],
      additionalProperties: false
    }),
    tool("get_campfire_line", "Get a specific chat line.", {
      type: "object",
      properties: { project: { type: "string" }, chat_id: { type: "integer" }, line_id: { type: "integer" } },
      required: ["project", "chat_id", "line_id"],
      additionalProperties: false
    }),
    tool("create_campfire_line", "Create a chat line. Provide official fields in body (content, etc).", {
      type: "object",
      properties: {
        project: { type: "string" },
        chat_id: { type: "integer" },
        content: { type: "string", nullable: true },
        body: { type: "object", additionalProperties: true }
      },
      required: ["project", "chat_id"],
      additionalProperties: false
    }),
    tool("delete_campfire_line", "Delete a chat line.", {
      type: "object",
      properties: { project: { type: "string" }, chat_id: { type: "integer" }, line_id: { type: "integer" } },
      required: ["project", "chat_id", "line_id"],
      additionalProperties: false
    }),

    // Campfire chatbots (integrations)
    tool("list_chatbots", "List chatbots (integrations) for a campfire.", {
      type: "object",
      properties: { project: { type: "string" }, chat_id: { type: "integer" } },
      required: ["project", "chat_id"],
      additionalProperties: false
    }),
    tool("get_chatbot", "Get a chatbot by integration id.", {
      type: "object",
      properties: { project: { type: "string" }, chat_id: { type: "integer" }, chatbot_id: { type: "integer" } },
      required: ["project", "chat_id", "chatbot_id"],
      additionalProperties: false
    }),
    tool("create_chatbot", "Create a chatbot (integration). Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, chat_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "chat_id", "body"],
      additionalProperties: false
    }),
    tool("update_chatbot", "Update a chatbot. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, chat_id: { type: "integer" }, chatbot_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "chat_id", "chatbot_id", "body"],
      additionalProperties: false
    }),
    tool("delete_chatbot", "Delete a chatbot.", {
      type: "object",
      properties: { project: { type: "string" }, chat_id: { type: "integer" }, chatbot_id: { type: "integer" } },
      required: ["project", "chat_id", "chatbot_id"],
      additionalProperties: false
    }),
    tool("post_chatbot_line", "Post a chat line as a chatbot using integration key. Provide body if needed.", {
      type: "object",
      properties: {
        project: { type: "string" },
        chat_id: { type: "integer" },
        chatbot_id: { type: "integer", nullable: true },
        integration_key: { type: "string", nullable: true },
        content: { type: "string", nullable: true },
        body: { type: "object", additionalProperties: true }
      },
      required: ["project", "chat_id"],
      additionalProperties: false
    }),

    tool("list_webhooks", "List webhooks for a project.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("get_webhook", "Get a webhook by ID.", {
      type: "object",
      properties: { project: { type: "string" }, webhook_id: { type: "integer" } },
      required: ["project", "webhook_id"],
      additionalProperties: false
    }),
    tool("create_webhook", "Create a webhook. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "body"],
      additionalProperties: false
    }),
    tool("update_webhook", "Update a webhook. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, webhook_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "webhook_id", "body"],
      additionalProperties: false
    }),
    tool("delete_webhook", "Delete a webhook.", {
      type: "object",
      properties: { project: { type: "string" }, webhook_id: { type: "integer" } },
      required: ["project", "webhook_id"],
      additionalProperties: false
    }),

    tool("list_timesheet_report", "List timesheet entries account-wide (optionally filtered).", {
      type: "object",
      properties: {
        start_date: { type: "string", nullable: true },
        end_date: { type: "string", nullable: true },
        person_id: { type: "integer", nullable: true },
        bucket_id: { type: "integer", nullable: true }
      },
      additionalProperties: false
    }),
    tool("list_project_timesheet", "List timesheet entries for a project.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_recording_timesheet", "List timesheet entries for a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),

    tool("search_recordings", "Search all recordings across projects by title/content.", {
      type: "object",
      properties: {
        query: { type: "string" },
        bucket: { type: ["integer", "string"], nullable: true },
        type: { type: "string", nullable: true, description: "Filter by recording type (e.g., comment, message, todo)" },
        creator_id: { type: ["integer", "string"], nullable: true },
        file_type: { type: "string", nullable: true },
        exclude_chat: { type: "boolean", nullable: true }
      },
      required: ["query"],
      additionalProperties: false
    }),

    tool("get_project", "Get project by ID.", {
      type: "object",
      properties: { project_id: { type: "integer" } },
      required: ["project_id"],
      additionalProperties: false
    }),
    tool("create_project", "Create a project. Provide official fields in body.", {
      type: "object",
      properties: { body: { type: "object", additionalProperties: true } },
      required: ["body"],
      additionalProperties: false
    }),
    tool("update_project", "Update a project. Provide official fields in body.", {
      type: "object",
      properties: { project_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project_id", "body"],
      additionalProperties: false
    }),
    tool("trash_project", "Trash a project by ID.", {
      type: "object",
      properties: { project_id: { type: "integer" } },
      required: ["project_id"],
      additionalProperties: false
    }),

    tool("list_pingable_people", "List people who can be pinged.", noProps()),
    tool("update_project_people", "Grant/revoke project access. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "body"],
      additionalProperties: false
    }),

    tool("update_comment", "Update a comment's content.", {
      type: "object",
      properties: {
        project: { type: "string" },
        comment_id: { type: "integer" },
        content: { type: "string", nullable: true },
        body: { type: "object", additionalProperties: true }
      },
      required: ["project", "comment_id"],
      additionalProperties: false
    }),

    tool("create_attachment", "Create an attachment (binary) from base64. Provide name, content_type, content_base64.", {
      type: "object",
      properties: {
        name: { type: "string" },
        content_type: { type: "string" },
        content_base64: { type: "string" }
      },
      required: ["name", "content_type", "content_base64"],
      additionalProperties: false
    }),

    tool("get_message_board", "Get a message board by ID.", {
      type: "object",
      properties: { project: { type: "string" }, board_id: { type: "integer" } },
      required: ["project", "board_id"],
      additionalProperties: false
    }),
    tool("get_message", "Get a message by ID.", {
      type: "object",
      properties: { project: { type: "string" }, message_id: { type: "integer" } },
      required: ["project", "message_id"],
      additionalProperties: false
    }),
    tool("create_message", "Create a message. Provide official fields in body.", {
      type: "object",
      properties: {
        project: { type: "string" },
        board_id: { type: "integer" },
        subject: { type: "string", nullable: true },
        content: { type: "string", nullable: true },
        status: { type: "string", nullable: true },
        body: { type: "object", additionalProperties: true }
      },
      required: ["project", "board_id"],
      additionalProperties: false
    }),
    tool("update_message", "Update a message. Provide official fields in body.", {
      type: "object",
      properties: {
        project: { type: "string" },
        message_id: { type: "integer" },
        subject: { type: "string", nullable: true },
        content: { type: "string", nullable: true },
        status: { type: "string", nullable: true },
        body: { type: "object", additionalProperties: true }
      },
      required: ["project", "message_id"],
      additionalProperties: false
    }),

    tool("get_document", "Get a document by ID.", {
      type: "object",
      properties: { project: { type: "string" }, document_id: { type: "integer" } },
      required: ["project", "document_id"],
      additionalProperties: false
    }),
    tool("create_document", "Create a document in a vault. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, vault_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "vault_id", "body"],
      additionalProperties: false
    }),
    tool("update_document", "Update a document. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, document_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "document_id", "body"],
      additionalProperties: false
    }),

    tool("create_upload", "Create an upload in a vault. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, vault_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "vault_id", "body"],
      additionalProperties: false
    }),
    tool("update_upload", "Update an upload. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, upload_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "upload_id", "body"],
      additionalProperties: false
    }),

    tool("update_client_visibility", "Update client visibility for a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "recording_id", "body"],
      additionalProperties: false
    }),

    tool("list_recording_events", "List events for a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),

    tool("get_subscription", "Get subscription info for a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("subscribe_recording", "Subscribe the current user to a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("unsubscribe_recording", "Unsubscribe the current user from a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("update_subscription", "Update subscribers list for a recording.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "recording_id", "body"],
      additionalProperties: false
    }),

    tool("report_todos_assigned", "List people who can have todos assigned.", noProps()),
    tool("report_todos_assigned_person", "List todos assigned to a person (report).", {
      type: "object",
      properties: { person_id: { type: "integer" } },
      required: ["person_id"],
      additionalProperties: false
    }),
    tool("report_todos_overdue", "List overdue todos across all projects.", noProps()),
    tool("report_schedules_upcoming", "List upcoming schedule entries (report). Optional query string.", {
      type: "object",
      properties: { query: { type: "string", nullable: true } },
      additionalProperties: false
    }),
    tool("report_timeline", "Timeline events across all projects. Optional query string.", {
      type: "object",
      properties: { query: { type: "string", nullable: true } },
      additionalProperties: false
    }),
    tool("project_timeline", "Timeline events for a project. Optional query string.", {
      type: "object",
      properties: { project: { type: "string" }, query: { type: "string", nullable: true } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("user_timeline", "Timeline events for a person. Optional query string.", {
      type: "object",
      properties: { person_id: { type: "integer" }, query: { type: "string", nullable: true } },
      required: ["person_id"],
      additionalProperties: false
    }),
    tool("report_timesheet", "Timesheet entries across the account. Optional query string.", {
      type: "object",
      properties: { query: { type: "string", nullable: true } },
      additionalProperties: false
    }),
    tool("project_timesheet", "Timesheet entries for a project. Optional query string.", {
      type: "object",
      properties: { project: { type: "string" }, query: { type: "string", nullable: true } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("recording_timesheet", "Timesheet entries for a recording. Optional query string.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" }, query: { type: "string", nullable: true } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),

    tool("get_inbox", "Get an inbox by ID.", {
      type: "object",
      properties: { project: { type: "string" }, inbox_id: { type: "integer" } },
      required: ["project", "inbox_id"],
      additionalProperties: false
    }),
    tool("list_inboxes", "List inboxes for a project.", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),
    tool("list_inbox_forwards", "List forwards for an inbox.", {
      type: "object",
      properties: { project: { type: "string" }, inbox_id: { type: "integer" } },
      required: ["project", "inbox_id"],
      additionalProperties: false
    }),
    tool("get_inbox_forward", "Get a forward by ID.", {
      type: "object",
      properties: { project: { type: "string" }, forward_id: { type: "integer" } },
      required: ["project", "forward_id"],
      additionalProperties: false
    }),
    tool("list_inbox_replies", "List replies for an inbox forward.", {
      type: "object",
      properties: { project: { type: "string" }, forward_id: { type: "integer" } },
      required: ["project", "forward_id"],
      additionalProperties: false
    }),
    tool("get_inbox_reply", "Get a specific inbox reply.", {
      type: "object",
      properties: { project: { type: "string" }, forward_id: { type: "integer" }, reply_id: { type: "integer" } },
      required: ["project", "forward_id", "reply_id"],
      additionalProperties: false
    }),

    tool("get_questionnaire", "Get a questionnaire by ID.", {
      type: "object",
      properties: { project: { type: "string" }, questionnaire_id: { type: "integer" } },
      required: ["project", "questionnaire_id"],
      additionalProperties: false
    }),
    tool("list_questions", "List questions in a questionnaire.", {
      type: "object",
      properties: { project: { type: "string" }, questionnaire_id: { type: "integer" } },
      required: ["project", "questionnaire_id"],
      additionalProperties: false
    }),
    tool("get_question", "Get a question by ID.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" } },
      required: ["project", "question_id"],
      additionalProperties: false
    }),
    tool("create_question", "Create a question. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, questionnaire_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "questionnaire_id", "body"],
      additionalProperties: false
    }),
    tool("update_question", "Update a question. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "question_id", "body"],
      additionalProperties: false
    }),
    tool("pause_question", "Pause a question.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" } },
      required: ["project", "question_id"],
      additionalProperties: false
    }),
    tool("resume_question", "Resume a question.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" } },
      required: ["project", "question_id"],
      additionalProperties: false
    }),
    tool("update_question_notification_settings", "Update question notification settings. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "question_id", "body"],
      additionalProperties: false
    }),
    tool("list_question_answers", "List answers for a question.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" } },
      required: ["project", "question_id"],
      additionalProperties: false
    }),
    tool("list_question_answers_by", "List people who answered a question.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" } },
      required: ["project", "question_id"],
      additionalProperties: false
    }),
    tool("list_question_answers_by_person", "List answers by person for a question.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" }, person_id: { type: "integer" } },
      required: ["project", "question_id", "person_id"],
      additionalProperties: false
    }),
    tool("get_question_answer", "Get a question answer by ID.", {
      type: "object",
      properties: { project: { type: "string" }, answer_id: { type: "integer" } },
      required: ["project", "answer_id"],
      additionalProperties: false
    }),
    tool("create_question_answer", "Create an answer to a question. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, question_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "question_id", "body"],
      additionalProperties: false
    }),
    tool("update_question_answer", "Update a question answer. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, answer_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "answer_id", "body"],
      additionalProperties: false
    }),
    tool("list_question_reminders", "List pending question reminders for the current user.", noProps()),

    tool("list_templates", "List templates.", noProps()),
    tool("get_template", "Get a template by ID.", {
      type: "object",
      properties: { template_id: { type: "integer" } },
      required: ["template_id"],
      additionalProperties: false
    }),
    tool("create_template", "Create a template. Provide official fields in body.", {
      type: "object",
      properties: { body: { type: "object", additionalProperties: true } },
      required: ["body"],
      additionalProperties: false
    }),
    tool("update_template", "Update a template. Provide official fields in body.", {
      type: "object",
      properties: { template_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["template_id", "body"],
      additionalProperties: false
    }),
    tool("trash_template", "Trash a template by ID.", {
      type: "object",
      properties: { template_id: { type: "integer" } },
      required: ["template_id"],
      additionalProperties: false
    }),
    tool("create_project_construction", "Create a project from a template. Provide official fields in body.", {
      type: "object",
      properties: { template_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["template_id", "body"],
      additionalProperties: false
    }),
    tool("get_project_construction", "Get a project construction by ID.", {
      type: "object",
      properties: { template_id: { type: "integer" }, construction_id: { type: "integer" } },
      required: ["template_id", "construction_id"],
      additionalProperties: false
    }),

    // Dock tools
    tool("get_dock_tool", "Get a dock tool by ID.", {
      type: "object",
      properties: { project: { type: "string" }, tool_id: { type: "integer" } },
      required: ["project", "tool_id"],
      additionalProperties: false
    }),
    tool("create_dock_tool", "Create a dock tool by cloning. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "body"],
      additionalProperties: false
    }),
    tool("update_dock_tool", "Update a dock tool name. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, tool_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "tool_id", "body"],
      additionalProperties: false
    }),
    tool("enable_dock_tool", "Enable a tool by recording ID. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "recording_id", "body"],
      additionalProperties: false
    }),
    tool("move_dock_tool", "Move a tool by recording ID. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "recording_id", "body"],
      additionalProperties: false
    }),
    tool("disable_dock_tool", "Disable a tool by recording ID.", {
      type: "object",
      properties: { project: { type: "string" }, recording_id: { type: "integer" } },
      required: ["project", "recording_id"],
      additionalProperties: false
    }),
    tool("trash_dock_tool", "Trash a dock tool by ID.", {
      type: "object",
      properties: { project: { type: "string" }, tool_id: { type: "integer" } },
      required: ["project", "tool_id"],
      additionalProperties: false
    }),

    tool("create_lineup_marker", "Create a lineup marker. Provide official fields in body.", {
      type: "object",
      properties: { body: { type: "object", additionalProperties: true } },
      required: ["body"],
      additionalProperties: false
    }),
    tool("update_lineup_marker", "Update a lineup marker. Provide official fields in body.", {
      type: "object",
      properties: { marker_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["marker_id", "body"],
      additionalProperties: false
    }),
    tool("delete_lineup_marker", "Delete a lineup marker.", {
      type: "object",
      properties: { marker_id: { type: "integer" } },
      required: ["marker_id"],
      additionalProperties: false
    }),
    tool("list_lineup_markers", "List all lineup markers.", {
      type: "object",
      properties: {},
      additionalProperties: false
    }),

    tool("list_todolist_groups", "List groups in a todolist.", {
      type: "object",
      properties: { project: { type: "string" }, todolist_id: { type: "integer" } },
      required: ["project", "todolist_id"],
      additionalProperties: false
    }),
    tool("get_todolist_group", "Get a todolist group by ID.", {
      type: "object",
      properties: { project: { type: "string" }, group_id: { type: "integer" } },
      required: ["project", "group_id"],
      additionalProperties: false
    }),
    tool("create_todolist_group", "Create a todolist group. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, todolist_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "todolist_id", "body"],
      additionalProperties: false
    }),
    tool("reposition_todolist_group", "Reposition a todolist group.", {
      type: "object",
      properties: { project: { type: "string" }, group_id: { type: "integer" }, position: { type: "integer" } },
      required: ["project", "group_id", "position"],
      additionalProperties: false
    }),

    tool("get_todoset", "Get a todoset by ID.", {
      type: "object",
      properties: { project: { type: "string" }, todoset_id: { type: "integer" } },
      required: ["project", "todoset_id"],
      additionalProperties: false
    }),
    tool("get_todolist", "Get a todolist by ID.", {
      type: "object",
      properties: { project: { type: "string" }, todolist_id: { type: "integer" } },
      required: ["project", "todolist_id"],
      additionalProperties: false
    }),
    tool("create_todolist", "Create a todolist. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, todoset_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "todoset_id", "body"],
      additionalProperties: false
    }),
    tool("update_todolist", "Update a todolist. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, todolist_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "todolist_id", "body"],
      additionalProperties: false
    }),

    tool("get_schedule", "Get a schedule by ID.", {
      type: "object",
      properties: { project: { type: "string" }, schedule_id: { type: "integer" } },
      required: ["project", "schedule_id"],
      additionalProperties: false
    }),
    tool("update_schedule", "Update a schedule.", {
      type: "object",
      properties: { project: { type: "string" }, schedule_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "schedule_id", "body"],
      additionalProperties: false
    }),
    tool("get_schedule_entry", "Get a schedule entry by ID.", {
      type: "object",
      properties: { project: { type: "string" }, entry_id: { type: "integer" } },
      required: ["project", "entry_id"],
      additionalProperties: false
    }),
    tool("create_schedule_entry", "Create a schedule entry. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, schedule_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "schedule_id", "body"],
      additionalProperties: false
    }),
    tool("update_schedule_entry", "Update a schedule entry. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, entry_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "entry_id", "body"],
      additionalProperties: false
    }),

    tool("search_metadata", "Get search filter metadata.", noProps()),

    tool("get_card_table", "Get a card table by ID.", {
      type: "object",
      properties: { project: { type: "string" }, card_table_id: { type: "integer" } },
      required: ["project", "card_table_id"],
      additionalProperties: false
    }),
    tool("get_card_table_column", "Get a card table column by ID.", {
      type: "object",
      properties: { project: { type: "string" }, column_id: { type: "integer" } },
      required: ["project", "column_id"],
      additionalProperties: false
    }),
    tool("create_card_table_column", "Create a card table column. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, card_table_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "card_table_id", "body"],
      additionalProperties: false
    }),
    tool("update_card_table_column", "Update a card table column. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, column_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "column_id", "body"],
      additionalProperties: false
    }),
    tool("move_card_table_column", "Move a card table column. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, card_table_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "card_table_id", "body"],
      additionalProperties: false
    }),
    tool("subscribe_card_table_column", "Subscribe to a card table column.", {
      type: "object",
      properties: { project: { type: "string" }, column_id: { type: "integer" } },
      required: ["project", "column_id"],
      additionalProperties: false
    }),
    tool("unsubscribe_card_table_column", "Unsubscribe from a card table column.", {
      type: "object",
      properties: { project: { type: "string" }, column_id: { type: "integer" } },
      required: ["project", "column_id"],
      additionalProperties: false
    }),
    tool("create_card_table_on_hold", "Create on-hold section for a column.", {
      type: "object",
      properties: { project: { type: "string" }, column_id: { type: "integer" } },
      required: ["project", "column_id"],
      additionalProperties: false
    }),
    tool("delete_card_table_on_hold", "Delete on-hold section for a column.", {
      type: "object",
      properties: { project: { type: "string" }, column_id: { type: "integer" } },
      required: ["project", "column_id"],
      additionalProperties: false
    }),
    tool("update_card_table_column_color", "Update a card table column color. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, column_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "column_id", "body"],
      additionalProperties: false
    }),
    tool("get_card", "Get a card by ID.", {
      type: "object",
      properties: { project: { type: "string" }, card_id: { type: "integer" } },
      required: ["project", "card_id"],
      additionalProperties: false
    }),
    tool("update_card", "Update a card. Provide official fields in body.", {
      type: "object",
      properties: { project: { type: "string" }, card_id: { type: "integer" }, body: { type: "object", additionalProperties: true } },
      required: ["project", "card_id", "body"],
      additionalProperties: false
    }),

    tool("get_project_structure", "Inspect a project's dock and available API endpoints (for diagnostics).", {
      type: "object",
      properties: { project: { type: "string" } },
      required: ["project"],
      additionalProperties: false
    }),

    tool("basecamp_request", "Raw Basecamp API call. Provide full URL or a /path.", {
      type: "object",
      properties: {
        path: { type: "string" },
        method: { type: "string", nullable: true },
        body: { type: "object", nullable: true },
        paginate: { type: "boolean", nullable: true }
      },
      required: ["path"],
      additionalProperties: false
    }),
    tool("basecamp_raw", "Alias of basecamp_request for backward compatibility.", {
      type: "object",
      properties: {
        path: { type: "string" },
        method: { type: "string", nullable: true },
        body: { type: "object", nullable: true },
        paginate: { type: "boolean", nullable: true }
      },
      required: ["path"],
      additionalProperties: false
    })
  ];

  // Append auto-generated endpoint tools (api_* wrappers)
  for (const endpoint of ENDPOINT_TOOLS || []) {
    tools.push(tool(endpoint.name, endpoint.description, endpoint.inputSchema));
  }

  return tools;
}
