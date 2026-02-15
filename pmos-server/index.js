/**
 * PMOS Server - The Brain
 * Intelligence layer providing predictions, patterns, context, and insights
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import PMOSMCPServer from './mcp.js';

const app = express();
const mcpServer = new PMOSMCPServer();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, 'public');

// Middleware
app.use(cors());
app.use(express.json());
app.use('/static', express.static(publicPath));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'pmos-server',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint now serves the PMOS product shell UI
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/api/info', (req, res) => {
  res.json({
    service: 'pmos-server',
    status: 'operational',
    version: '1.0.0',
    integration_config: {
      bcgpt_url: config.bcgptUrl,
      flow_url: config.flowUrl,
      bcgpt_api_key_configured: !!config.bcgptApiKey,
      per_request_bcgpt_api_key_supported: true,
      shell_auth_configured: !!config.shellToken
    },
    endpoints: {
      dashboard: '/api/dashboard',
      command: '/api/command',
      chat: '/api/chat',
      operations: '/api/operations',
      mcp_call: '/api/mcp-call',
      health: '/health',
      status: '/api/status',
      tools: '/api/tools',
      mcp: '/mcp'
    }
  });
});

async function checkExternalService(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      url,
      ok: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

const commandMap = {
  status: { tool: 'pmos_status' },
  insights: { tool: 'pmos_insights_list', defaults: { limit: 25, acknowledged: false } },
  cleanup: { tool: 'pmos_cleanup', highRisk: true },
  health_project: { tool: 'pmos_health_project', requiresProjectId: true },
  predict_completion: { tool: 'pmos_predict_completion', requiresProjectId: true },
  context_analyze: { tool: 'pmos_context_analyze', requiresProjectId: true },
  patterns_work: { tool: 'pmos_patterns_work', requiresProjectId: true }
};

function normalizeKey(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function getHeaderValue(req, name) {
  if (!req) return null;
  const direct = req.get?.(name);
  const fallback = req.headers?.[String(name || '').toLowerCase()];
  const value = direct ?? fallback;
  if (Array.isArray(value)) return value[0];
  return value ?? null;
}

function getAuthToken(req) {
  return req.get('x-pmos-token') || req.body?.token || req.query?.token || '';
}

function getBCGPTApiKey(req) {
  return normalizeKey(
    getHeaderValue(req, 'x-bcgpt-api-key') ||
      req.body?.bcgpt_api_key ||
      req.body?.bcgptApiKey ||
      req.query?.bcgpt_api_key ||
      req.query?.bcgptApiKey
  );
}

function requireShellAuth(req, res, next) {
  if (!config.shellToken) {
    return next();
  }

  if (getAuthToken(req) !== config.shellToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      hint: 'Provide x-pmos-token with the configured PMOS_SHELL_TOKEN'
    });
  }

  return next();
}

function createHttpError(status, payload) {
  const error = new Error(payload.error || payload.message || 'Request failed');
  error.status = status;
  error.payload = payload;
  return error;
}

function summarizeResult(result) {
  if (result === null || result === undefined) {
    return 'No result';
  }
  const text = JSON.stringify(result);
  if (text.length <= 220) {
    return text;
  }
  return `${text.slice(0, 220)}...`;
}

function buildCommandInvocation(command, args = {}, projectIdRaw = null, bcgptApiKey = null) {
  const selected = commandMap[command];
  if (!selected) {
    throw createHttpError(400, {
      error: `unsupported command: ${command}`,
      supported_commands: Object.keys(commandMap)
    });
  }

  const projectId = projectIdRaw || args.project_id;
  if (selected.requiresProjectId && !projectId) {
    throw createHttpError(400, {
      error: `command ${command} requires project_id`
    });
  }

  if (selected.requiresProjectId && !(config.bcgptApiKey || bcgptApiKey)) {
    throw createHttpError(400, {
      error: 'BCGPT_API_KEY is not configured on PMOS server',
      hint: 'Set BCGPT_API_KEY in PMOS env or provide x-bcgpt-api-key from your /connect key when calling PMOS APIs'
    });
  }

  const toolArgs = {
    ...(selected.defaults || {}),
    ...args
  };

  if (selected.requiresProjectId) {
    toolArgs.project_id = String(projectId);
  }

  return {
    selected,
    projectId: selected.requiresProjectId ? String(projectId) : null,
    toolArgs
  };
}

function parseChatIntent(message, projectIdHint = null) {
  const trimmed = String(message || '').trim();
  const text = trimmed.toLowerCase();
  const explicitCommand = /^\/([a-z_]+)/i.exec(trimmed);
  if (explicitCommand) {
    return {
      command: explicitCommand[1].toLowerCase(),
      projectId: projectIdHint,
      confidence: 1
    };
  }

  const projectMatch = /project(?:\s*id)?\s*[:=#-]?\s*([a-z0-9_-]+)/i.exec(trimmed);
  const projectId = projectMatch?.[1] || projectIdHint || null;

  if (text.includes('cleanup') || text.includes('clean up') || text.includes('purge')) {
    return { command: 'cleanup', projectId, confidence: 0.95 };
  }
  if (text.includes('insight')) {
    return { command: 'insights', projectId, confidence: 0.9 };
  }
  if (text.includes('status') || text.includes('health of pmos') || text === 'health') {
    return { command: 'status', projectId, confidence: 0.9 };
  }
  if (text.includes('predict') || text.includes('eta') || text.includes('completion')) {
    return { command: 'predict_completion', projectId, confidence: 0.82 };
  }
  if (text.includes('context') || text.includes('analy')) {
    return { command: 'context_analyze', projectId, confidence: 0.82 };
  }
  if (text.includes('pattern')) {
    return { command: 'patterns_work', projectId, confidence: 0.82 };
  }
  if (text.includes('health') || text.includes('risk score')) {
    return { command: 'health_project', projectId, confidence: 0.82 };
  }

  return { command: null, projectId, confidence: 0 };
}

async function executeMappedCommand({
  command,
  args = {},
  projectId = null,
  bcgptApiKey = null,
  source = 'api',
  sessionId = null,
  actor = 'system',
  requireApproval = false,
  operationId = null,
  approved = false
}) {
  const invocation = buildCommandInvocation(command, args, projectId, bcgptApiKey);
  const approvalRequired = Boolean(requireApproval || invocation.selected.highRisk);

  let operation = operationId ? mcpServer.db.getOperation(operationId) : null;
  if (!operation) {
    operation = mcpServer.db.createOperation({
      source,
      actor,
      session_id: sessionId,
      command,
      tool: invocation.selected.tool,
      arguments: invocation.toolArgs,
      project_id: invocation.projectId,
      risk: invocation.selected.highRisk ? 'high' : 'low',
      approval_required: approvalRequired,
      status: approvalRequired ? 'pending_approval' : 'running'
    });
  }

  if (approvalRequired && !approved) {
    mcpServer.db.updateOperation(operation.id, {
      status: 'pending_approval',
      approval_required: true
    });

    return {
      ok: false,
      pending_approval: true,
      operation_id: operation.id,
      command,
      tool: invocation.selected.tool,
      args: invocation.toolArgs,
      message: `Approval required before running "${command}".`
    };
  }

  mcpServer.db.updateOperation(operation.id, {
    status: 'running',
    approved_at: Date.now()
  });

  const activeBCGPTApiKey = bcgptApiKey || config.bcgptApiKey || '';
  const previousBCGPTApiKey = mcpServer.bcgpt.apiKey;
  mcpServer.bcgpt.apiKey = activeBCGPTApiKey;

  const start = Date.now();
  try {
    const result = await mcpServer.handleToolCall(invocation.selected.tool, invocation.toolArgs);
    const durationMs = Date.now() - start;

    mcpServer.db.updateOperation(operation.id, {
      status: 'completed',
      duration_ms: durationMs,
      result_excerpt: summarizeResult(result),
      error: null
    });

    return {
      ok: true,
      operation_id: operation.id,
      command,
      tool: invocation.selected.tool,
      args: invocation.toolArgs,
      result
    };
  } catch (error) {
    mcpServer.db.updateOperation(operation.id, {
      status: 'failed',
      duration_ms: Date.now() - start,
      error: error.message
    });
    throw error;
  } finally {
    mcpServer.bcgpt.apiKey = previousBCGPTApiKey;
  }
}

// MCP Protocol endpoint
app.post('/mcp', async (req, res) => {
  try {
    const { jsonrpc, id, method, params } = req.body;
    
    // Validate JSON-RPC format
    if (jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32600,
          message: 'Invalid Request: jsonrpc must be "2.0"'
        }
      });
    }
    
    // Handle different MCP methods
    switch (method) {
      case 'initialize':
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'pmos-server',
              version: '1.0.0'
            }
          }
        });
        break;
      
      case 'tools/list':
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: mcpServer.tools
          }
        });
        break;
      
      case 'tools/call':
        const { name, arguments: args } = params;
        
        if (!name) {
          return res.status(400).json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: 'Invalid params: name is required'
            }
          });
        }
        
        try {
          const result = await mcpServer.handleToolCall(name, args || {});
          
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          });
        } catch (toolError) {
          res.status(500).json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: `Tool execution error: ${toolError.message}`
            }
          });
        }
        break;
      
      default:
        res.status(400).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        });
    }
  } catch (error) {
    console.error('MCP endpoint error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id || null,
      error: {
        code: -32603,
        message: `Internal error: ${error.message}`
      }
    });
  }
});

// REST API endpoints (for convenience)
app.get('/api/tools', (req, res) => {
  res.json({
    tools: mcpServer.tools,
    count: mcpServer.tools.length
  });
});

app.get('/api/status', (req, res) => {
  try {
    const status = mcpServer.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const [bcgpt, flow] = await Promise.all([
      checkExternalService(`${config.bcgptUrl}/health`),
      checkExternalService(`${config.flowUrl}/`)
    ]);

    const status = mcpServer.getStatus();
    const insights = await mcpServer.handleToolCall('pmos_insights_list', {
      limit: 10,
      acknowledged: false
    });
    const operations = mcpServer.db.getOperations(25);
    const pendingApprovals = operations.filter((item) => item.status === 'pending_approval').length;

    res.json({
      status,
      readiness: {
        bcgpt_api_key_configured: !!config.bcgptApiKey,
        shell_auth_configured: !!config.shellToken
      },
      integrations: {
        bcgpt,
        flow
      },
      operations: {
        total_recent: operations.length,
        pending_approvals: pendingApprovals,
        items: operations
      },
      insights
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post('/api/command', requireShellAuth, async (req, res) => {
  try {
    const command = String(req.body.command || '').trim();
    const args = (req.body.arguments && typeof req.body.arguments === 'object')
      ? req.body.arguments
      : {};
    const projectId = req.body.project_id || req.body.projectId || args.project_id || null;
    const approved = req.body.approved === true;
    const requireApproval = req.body.require_approval === true;
    const operationId = req.body.operation_id || req.body.operationId || null;
    const bcgptApiKey = getBCGPTApiKey(req);

    if (!command) {
      return res.status(400).json({
        error: 'command is required'
      });
    }

    const result = await executeMappedCommand({
      command,
      args,
      projectId,
      bcgptApiKey,
      source: 'command_api',
      actor: 'api',
      requireApproval,
      operationId,
      approved
    });

    if (result.pending_approval) {
      return res.status(202).json(result);
    }

    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(error.payload || {
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/chat', requireShellAuth, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    const sessionId = req.body.session_id ? String(req.body.session_id) : null;
    const projectHint = req.body.project_id ? String(req.body.project_id) : null;
    const bcgptApiKey = getBCGPTApiKey(req);

    if (!message) {
      return res.status(400).json({
        error: 'message is required'
      });
    }

    const intent = parseChatIntent(message, projectHint);
    if (!intent.command) {
      return res.json({
        ok: true,
        session_id: sessionId,
        assistant_message: 'I could not map that to a PMOS command yet. Try: status, insights, cleanup, health project <id>, predict completion for project <id>.',
        supported_commands: Object.keys(commandMap)
      });
    }

    const result = await executeMappedCommand({
      command: intent.command,
      projectId: intent.projectId,
      bcgptApiKey,
      source: 'chat',
      sessionId,
      actor: 'chat',
      approved: false
    });

    if (result.pending_approval) {
      return res.status(202).json({
        ...result,
        session_id: sessionId,
        assistant_message: `Action "${intent.command}" is queued and waiting for approval.`,
        confidence: intent.confidence
      });
    }

    return res.json({
      ...result,
      session_id: sessionId,
      assistant_message: `Executed "${intent.command}" successfully.`,
      confidence: intent.confidence
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(error.payload || {
      ok: false,
      error: error.message
    });
  }
});

app.get('/api/operations', requireShellAuth, (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const status = req.query.status ? String(req.query.status) : null;
  const operations = mcpServer.db.getOperations(limit, status);
  res.json({
    count: operations.length,
    operations
  });
});

app.post('/api/operations/:operationId/approve', requireShellAuth, async (req, res) => {
  try {
    const operationId = req.params.operationId;
    const bcgptApiKey = getBCGPTApiKey(req);
    const operation = mcpServer.db.getOperation(operationId);
    if (!operation) {
      return res.status(404).json({
        error: `operation not found: ${operationId}`
      });
    }

    if (operation.status !== 'pending_approval') {
      return res.status(409).json({
        error: `operation ${operationId} is not pending approval`,
        status: operation.status
      });
    }

    const result = await executeMappedCommand({
      command: operation.command,
      args: operation.arguments || {},
      projectId: operation.project_id || null,
      bcgptApiKey,
      source: 'approval',
      sessionId: operation.session_id || null,
      actor: 'approver',
      operationId: operation.id,
      approved: true
    });

    return res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json(error.payload || {
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/mcp-call', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const args = (req.body.arguments && typeof req.body.arguments === 'object')
      ? req.body.arguments
      : {};

    if (!name) {
      return res.status(400).json({
        error: 'name is required'
      });
    }

    const result = await mcpServer.handleToolCall(name, args);
    res.json({
      ok: true,
      name,
      args,
      result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Quick health score endpoint
app.get('/api/health/project/:projectId', async (req, res) => {
  try {
    const bcgptApiKey = getBCGPTApiKey(req);
    if (!(config.bcgptApiKey || bcgptApiKey)) {
      return res.status(400).json({
        error: 'BCGPT_API_KEY is not configured on PMOS server',
        hint: 'Set BCGPT_API_KEY in PMOS env or provide x-bcgpt-api-key from your /connect key when calling PMOS APIs'
      });
    }

    const previousBCGPTApiKey = mcpServer.bcgpt.apiKey;
    mcpServer.bcgpt.apiKey = bcgptApiKey || config.bcgptApiKey || '';
    let result;
    try {
      result = await mcpServer.handleToolCall('pmos_health_project', {
        project_id: req.params.projectId
      });
    } finally {
      mcpServer.bcgpt.apiKey = previousBCGPTApiKey;
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Quick predictions endpoint
app.get('/api/predict/completion/:projectId', async (req, res) => {
  try {
    const bcgptApiKey = getBCGPTApiKey(req);
    if (!(config.bcgptApiKey || bcgptApiKey)) {
      return res.status(400).json({
        error: 'BCGPT_API_KEY is not configured on PMOS server',
        hint: 'Set BCGPT_API_KEY in PMOS env or provide x-bcgpt-api-key from your /connect key when calling PMOS APIs'
      });
    }

    const previousBCGPTApiKey = mcpServer.bcgpt.apiKey;
    mcpServer.bcgpt.apiKey = bcgptApiKey || config.bcgptApiKey || '';
    let result;
    try {
      result = await mcpServer.handleToolCall('pmos_predict_completion', {
        project_id: req.params.projectId
      });
    } finally {
      mcpServer.bcgpt.apiKey = previousBCGPTApiKey;
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Quick insights endpoint
app.get('/api/insights', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const acknowledged = req.query.acknowledged === 'true';
    
    const result = await mcpServer.handleToolCall('pmos_insights_list', {
      limit,
      acknowledged
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Single page shell fallback.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/mcp') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down PMOS server...');
  mcpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down PMOS server...');
  mcpServer.close();
  process.exit(0);
});

// Start server
const PORT = config.port;
const HOST = config.host;

app.listen(PORT, HOST, () => {
  console.log(`PMOS integrations: BCGPT_URL=${config.bcgptUrl} FLOW_URL=${config.flowUrl}`);
  console.log(`PMOS auth: BCGPT_API_KEY=${config.bcgptApiKey ? 'set' : 'missing'} PMOS_SHELL_TOKEN=${config.shellToken ? 'set' : 'not_set'}`);
  console.log(`PMOS server started on http://${HOST}:${PORT}`);
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
  console.log(`REST base: http://${HOST}:${PORT}/api`);
  console.log(`Tools: ${mcpServer.tools.length}`);

  console.log('');
  console.log('Available Intelligence Tools:');
  console.log('');

  const categories = {
    Health: mcpServer.tools.filter((t) => t.name.startsWith('pmos_health_')),
    Predictions: mcpServer.tools.filter((t) => t.name.startsWith('pmos_predict_')),
    Context: mcpServer.tools.filter((t) => t.name.startsWith('pmos_context_')),
    Patterns: mcpServer.tools.filter((t) => t.name.startsWith('pmos_patterns_')),
    Insights: mcpServer.tools.filter((t) => t.name.startsWith('pmos_insights_')),
    Memory: mcpServer.tools.filter((t) => t.name.startsWith('pmos_memory_')),
    Utility: mcpServer.tools.filter((t) => !['health_', 'predict_', 'context_', 'patterns_', 'insights_', 'memory_'].some((p) => t.name.includes(p)))
  };

  for (const [category, tools] of Object.entries(categories)) {
    if (tools.length > 0) {
      console.log(`  ${category} (${tools.length}):`);
      tools.forEach((tool) => {
        console.log(`    - ${tool.name}`);
      });
      console.log('');
    }
  }

  console.log('PMOS is ready.');
  console.log('');
});

export default app;

