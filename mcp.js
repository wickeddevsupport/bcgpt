
import { basecampFetch } from "./basecamp.js";
import { resolveByName } from "./resolvers.js";

export async function handleMCP({ id, method, params }, ctx) {
  const { TOKEN, accountId } = ctx;

  if (method === "tools/list") {
    return { jsonrpc:"2.0", id, result:{ tools:[
      "list_projects","get_project_by_name","list_todos_for_project",
      "create_task_naturally","complete_task_by_name",
      "summarize_project","summarize_overdue_tasks","basecamp_request"
    ]}};
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;

    if (name === "list_projects") {
      const data = await basecampFetch(TOKEN, `/${accountId}/projects.json`);
      return { jsonrpc:"2.0", id, result:data };
    }

    if (name === "get_project_by_name") {
      const projects = await basecampFetch(TOKEN, `/${accountId}/projects.json`);
      const project = resolveByName(projects, args.name, "project");
      return { jsonrpc:"2.0", id, result:project };
    }

    if (name === "basecamp_request") {
      const data = await basecampFetch(TOKEN, args.path, {
        method: args.method || "GET",
        body: args.body
      });
      return { jsonrpc:"2.0", id, result:data };
    }
  }

  return { jsonrpc:"2.0", id, error:"UNKNOWN_MCP_METHOD" };
}
