import { bcFetch } from "./basecamp.js";

function ok(id, result){ return { jsonrpc:"2.0", id, result }; }
function fail(id, code, message){ return { jsonrpc:"2.0", id, error:{ code, message } }; }

export async function handleMCP(body, ctx) {
  const { id, method, params } = body;
  const { token, account, identity, authLink } = ctx;

  if (method === "initialize") {
    return ok(id, { name:"bcgpt-production", version:"5.0" });
  }

  if (method === "tools/list") {
    return ok(id, { tools: [
      { name:"startbcgpt", description:"Show current user + reauth link", inputSchema:{type:"object",properties:{}} },
      { name:"daily_report", description:"Todos due today + overdue", inputSchema:{type:"object",properties:{}} },
      { name:"search_todos", description:"Search todos across all projects", inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]} },
      { name:"create_todo", description:"Create a todo from natural language", inputSchema:{type:"object",properties:{project:{type:"string"},content:{type:"string"},due_on:{type:"string"}},required:["project","content"]} },
      { name:"post_update", description:"Post a message update", inputSchema:{type:"object",properties:{project:{type:"string"},content:{type:"string"}},required:["project","content"]} },
      { name:"basecamp_raw", description:"Raw Basecamp API escape hatch", inputSchema:{type:"object",properties:{path:{type:"string"},method:{type:"string"},body:{type:"object"}},required:["path"]} }
    ]});
  }

  if (method !== "tools/call") return fail(id,"BAD_METHOD","Invalid method");

  const name = params.name;
  const args = params.arguments || {};

  if (name === "startbcgpt") {
    return ok(id, {
      connected: !!token,
      user: identity || null,
      reauth_url: authLink
    });
  }

  if (!token) return fail(id,"NOT_AUTHENTICATED","Run /startbcgpt first");

  if (name === "daily_report") {
    const projects = await bcFetch(token, `/${account.id}/projects.json`);
    const today = new Date().toISOString().slice(0,10);
    const due=[], overdue=[];

    for (const p of projects) {
      const lists = await bcFetch(token, `/buckets/${p.id}/todolists.json`);
      for (const l of lists) {
        const todos = await bcFetch(token, `/buckets/${p.id}/todolists/${l.id}/todos.json`);
        for (const t of todos) {
          if (t.completed) continue;
          if (t.due_on === today) due.push({project:p.name,task:t.content});
          if (t.due_on && t.due_on < today) overdue.push({project:p.name,task:t.content});
        }
      }
    }
    return ok(id,{today,due,overdue});
  }

  if (name === "search_todos") {
    const q = args.query.toLowerCase();
    const projects = await bcFetch(token, `/${account.id}/projects.json`);
    const hits=[];

    for (const p of projects) {
      const lists = await bcFetch(token, `/buckets/${p.id}/todolists.json`);
      for (const l of lists) {
        const todos = await bcFetch(token, `/buckets/${p.id}/todolists/${l.id}/todos.json`);
        for (const t of todos) {
          if (!t.completed && t.content.toLowerCase().includes(q)) {
            hits.push({project:p.name,task:t.content});
          }
        }
      }
    }
    return ok(id,{query:args.query,count:hits.length,hits});
  }

  if (name === "create_todo") {
    const projects = await bcFetch(token, `/${account.id}/projects.json`);
    const p = projects.find(x=>x.name.toLowerCase().includes(args.project.toLowerCase()));
    if (!p) return fail(id,"NO_PROJECT","Project not found");

    const lists = await bcFetch(token, `/buckets/${p.id}/todolists.json`);
    const list = lists[0];
    const todo = await bcFetch(token, `/buckets/${p.id}/todolists/${list.id}/todos.json`, {
      method:"POST",
      body:{ content: args.content, due_on: args.due_on }
    });
    return ok(id,{created:todo});
  }

  if (name === "post_update") {
    const projects = await bcFetch(token, `/${account.id}/projects.json`);
    const p = projects.find(x=>x.name.toLowerCase().includes(args.project.toLowerCase()));
    const boards = await bcFetch(token, `/buckets/${p.id}/message_boards.json`);
    const board = boards[0];
    const post = await bcFetch(token, `/buckets/${p.id}/message_boards/${board.id}/messages.json`, {
      method:"POST",
      body:{ subject:"Update", content: args.content }
    });
    return ok(id,{posted:post});
  }

  if (name === "basecamp_raw") {
    const data = await bcFetch(token, args.path, { method: args.method || "GET", body: args.body });
    return ok(id,data);
  }

  return fail(id,"UNKNOWN_TOOL","Tool not supported");
}
