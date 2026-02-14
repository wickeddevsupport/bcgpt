// agent-runtime.js
// ============================================================================
// PMOS Agent Runtime - LLM-powered chat with MCP tool execution
// ============================================================================
// Connects the 50+ MCP tools to an LLM for intelligent chat interactions.
// Supports Gemini (default), Claude, and OpenAI.
// ============================================================================

import { getTools } from "./mcp/tools.js";
import { handleMCP } from "./mcp.js";

// System prompt for the PM assistant
const SYSTEM_PROMPT = `You are PMOS (Project Management Operating System), an intelligent assistant for managing projects in Basecamp.

You have access to powerful tools that can:
- List and search projects, todos, messages, documents
- Create and update todos, schedules, messages
- Analyze workload, assignments, and progress
- Generate reports and dashboards
- Execute complex workflows and automations

Guidelines:
1. Be concise and action-oriented
2. When asked about data, use tools to fetch real information - don't make up data
3. Confirm destructive actions before executing
4. Group related information logically
5. Use markdown formatting for better readability
6. When listing items, include relevant details (dates, assignees, status)

Current context will be provided with each request.`;

// Convert MCP tool format to Gemini function declaration format
function convertToolsToGemini(mcpTools) {
  return mcpTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "OBJECT",
      properties: convertProperties(tool.inputSchema?.properties || {}),
      required: tool.inputSchema?.required || []
    }
  }));
}

function convertProperties(props) {
  const result = {};
  for (const [key, value] of Object.entries(props)) {
    result[key] = {
      type: mapType(value.type),
      description: value.description || ""
    };
    if (value.enum) {
      result[key].enum = value.enum;
    }
  }
  return result;
}

function mapType(type) {
  const typeMap = {
    string: "STRING",
    number: "NUMBER",
    integer: "INTEGER",
    boolean: "BOOLEAN",
    array: "ARRAY",
    object: "OBJECT"
  };
  return typeMap[type] || "STRING";
}

// Convert MCP tools to Anthropic Claude format
function convertToolsToClaude(mcpTools) {
  return mcpTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema || { type: "object", properties: {} }
  }));
}

// Convert MCP tools to OpenAI format
function convertToolsToOpenAI(mcpTools) {
  return mcpTools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: "object", properties: {} }
    }
  }));
}

// Execute an MCP tool and return the result
async function executeMcpTool(toolName, toolArgs, ctx) {
  const request = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: toolName,
      arguments: toolArgs
    }
  };
  
  const response = await handleMCP(request, ctx);
  
  if (response.error) {
    return {
      success: false,
      error: response.error.message || "Tool execution failed"
    };
  }
  
  return {
    success: true,
    result: response.result
  };
}

// Call Gemini API
async function callGemini(messages, tools, apiKey, options = {}) {
  const model = options.model || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  // Convert messages to Gemini format
  const contents = messages.map(msg => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }]
  }));
  
  // Add tool results if present
  for (const msg of messages) {
    if (msg.tool_calls) {
      // Gemini expects function calls in a specific format
      const lastContent = contents[contents.length - 1];
      if (lastContent.role === "model") {
        lastContent.parts = msg.tool_calls.map(tc => ({
          functionCall: {
            name: tc.name,
            args: tc.arguments
          }
        }));
      }
    }
    if (msg.tool_result) {
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: msg.tool_name,
            response: { result: msg.tool_result }
          }
        }]
      });
    }
  }
  
  const body = {
    contents,
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT + (options.context || "") }]
    },
    tools: tools.length > 0 ? [{
      functionDeclarations: tools
    }] : undefined,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192
    }
  };
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return parseGeminiResponse(data);
}

function parseGeminiResponse(data) {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("No response from Gemini");
  }
  
  const parts = candidate.content?.parts || [];
  const result = {
    type: "text",
    content: "",
    tool_calls: []
  };
  
  for (const part of parts) {
    if (part.text) {
      result.content += part.text;
    }
    if (part.functionCall) {
      result.type = "tool_calls";
      result.tool_calls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args || {}
      });
    }
  }
  
  return result;
}

// Call Anthropic Claude API
async function callClaude(messages, tools, apiKey, options = {}) {
  const model = options.model || "claude-3-haiku-20240307";
  const url = "https://api.anthropic.com/v1/messages";
  
  const body = {
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT + (options.context || ""),
    messages: messages.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    tools: tools.length > 0 ? tools : undefined
  };
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return parseClaudeResponse(data);
}

function parseClaudeResponse(data) {
  const result = {
    type: "text",
    content: "",
    tool_calls: []
  };
  
  for (const block of data.content || []) {
    if (block.type === "text") {
      result.content += block.text;
    }
    if (block.type === "tool_use") {
      result.type = "tool_calls";
      result.tool_calls.push({
        id: block.id,
        name: block.name,
        arguments: block.input || {}
      });
    }
  }
  
  return result;
}

// Call OpenAI API
async function callOpenAI(messages, tools, apiKey, options = {}) {
  const model = options.model || "gpt-4o-mini";
  const url = "https://api.openai.com/v1/chat/completions";
  
  const formattedMessages = [
    { role: "system", content: SYSTEM_PROMPT + (options.context || "") },
    ...messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  ];
  
  const body = {
    model,
    messages: formattedMessages,
    tools: tools.length > 0 ? tools : undefined,
    max_tokens: 4096
  };
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return parseOpenAIResponse(data);
}

function parseOpenAIResponse(data) {
  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error("No response from OpenAI");
  }
  
  const message = choice.message;
  const result = {
    type: "text",
    content: message.content || "",
    tool_calls: []
  };
  
  if (message.tool_calls) {
    result.type = "tool_calls";
    result.tool_calls = message.tool_calls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}")
    }));
  }
  
  return result;
}

// Main agent runtime - executes the tool-calling loop
export async function runAgent(userMessage, ctx, options = {}) {
  const provider = options.provider || "gemini";
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const maxIterations = options.maxIterations || 10;
  
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider}. Set ${provider.toUpperCase()}_API_KEY environment variable.`);
  }
  
  // Get MCP tools and convert to provider format
  const mcpTools = getTools();
  let providerTools;
  let callLLM;
  
  switch (provider) {
    case "gemini":
      providerTools = convertToolsToGemini(mcpTools);
      callLLM = (msgs, opts) => callGemini(msgs, providerTools, apiKey, opts);
      break;
    case "anthropic":
    case "claude":
      providerTools = convertToolsToClaude(mcpTools);
      callLLM = (msgs, opts) => callClaude(msgs, providerTools, apiKey, opts);
      break;
    case "openai":
    case "gpt":
      providerTools = convertToolsToOpenAI(mcpTools);
      callLLM = (msgs, opts) => callOpenAI(msgs, providerTools, apiKey, opts);
      break;
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
  
  // Build context string
  const contextParts = [];
  if (ctx.basecampAccountId) {
    contextParts.push(`Basecamp Account ID: ${ctx.basecampAccountId}`);
  }
  if (options.projectContext) {
    contextParts.push(`Current Project: ${options.projectContext}`);
  }
  const context = contextParts.length > 0 
    ? `\n\nContext:\n${contextParts.join("\n")}` 
    : "";
  
  // Initialize conversation
  const messages = [
    { role: "user", content: userMessage }
  ];
  
  const toolResults = [];
  let iterations = 0;
  
  // Tool-calling loop
  while (iterations < maxIterations) {
    iterations++;
    
    const response = await callLLM(messages, { context, ...options });
    
    if (response.type === "text") {
      // LLM returned a text response - we're done
      return {
        success: true,
        response: response.content,
        toolResults,
        iterations
      };
    }
    
    if (response.type === "tool_calls") {
      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        const toolResult = await executeMcpTool(toolCall.name, toolCall.arguments, ctx);
        toolResults.push({
          tool: toolCall.name,
          arguments: toolCall.arguments,
          result: toolResult
        });
        
        // Add tool result to messages for next iteration
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [toolCall]
        });
        messages.push({
          role: "user",
          content: JSON.stringify(toolResult),
          tool_result: toolResult.success ? toolResult.result : toolResult.error,
          tool_name: toolCall.name
        });
      }
    }
  }
  
  // Max iterations reached
  return {
    success: false,
    error: "Max iterations reached without completing",
    toolResults,
    iterations
  };
}

// Stream agent responses using SSE
export async function runAgentStreaming(userMessage, ctx, res, options = {}) {
  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  
  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  try {
    sendEvent("start", { message: "Processing your request..." });
    
    const result = await runAgent(userMessage, ctx, options);
    
    // Send tool results as progress events
    for (const tr of result.toolResults || []) {
      sendEvent("tool", { 
        name: tr.tool, 
        success: tr.result.success 
      });
    }
    
    if (result.success) {
      sendEvent("response", { content: result.response });
    } else {
      sendEvent("error", { message: result.error });
    }
    
    sendEvent("done", { iterations: result.iterations });
  } catch (error) {
    sendEvent("error", { message: error.message });
  } finally {
    res.end();
  }
}

export default {
  runAgent,
  runAgentStreaming,
  SYSTEM_PROMPT
};
