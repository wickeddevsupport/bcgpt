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
    endpoints: {
      dashboard: '/api/dashboard',
      command: '/api/command',
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

    res.json({
      status,
      integrations: {
        bcgpt,
        flow
      },
      insights
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.post('/api/command', async (req, res) => {
  try {
    const command = String(req.body.command || '').trim();
    const args = (req.body.arguments && typeof req.body.arguments === 'object')
      ? req.body.arguments
      : {};

    if (!command) {
      return res.status(400).json({
        error: 'command is required'
      });
    }

    const commandMap = {
      status: { tool: 'pmos_status' },
      insights: { tool: 'pmos_insights_list', defaults: { limit: 25, acknowledged: false } },
      cleanup: { tool: 'pmos_cleanup' },
      health_project: { tool: 'pmos_health_project', requiresProjectId: true },
      predict_completion: { tool: 'pmos_predict_completion', requiresProjectId: true },
      context_analyze: { tool: 'pmos_context_analyze', requiresProjectId: true },
      patterns_work: { tool: 'pmos_patterns_work', requiresProjectId: true }
    };

    const selected = commandMap[command];
    if (!selected) {
      return res.status(400).json({
        error: `unsupported command: ${command}`,
        supported_commands: Object.keys(commandMap)
      });
    }

    const projectId = req.body.project_id || req.body.projectId || args.project_id;
    if (selected.requiresProjectId && !projectId) {
      return res.status(400).json({
        error: `command ${command} requires project_id`
      });
    }

    const toolArgs = {
      ...(selected.defaults || {}),
      ...args
    };

    if (selected.requiresProjectId) {
      toolArgs.project_id = String(projectId);
    }

    const result = await mcpServer.handleToolCall(selected.tool, toolArgs);
    res.json({
      ok: true,
      command,
      tool: selected.tool,
      args: toolArgs,
      result
    });
  } catch (error) {
    res.status(500).json({
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
    const result = await mcpServer.handleToolCall('pmos_health_project', {
      project_id: req.params.projectId
    });
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
    const result = await mcpServer.handleToolCall('pmos_predict_completion', {
      project_id: req.params.projectId
    });
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
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   PMOS Server - The Brain                                 ║
║   Intelligence Layer for BCGPT                            ║
║                                                           ║
║   Status: OPERATIONAL                                     ║
║   Port: ${PORT}                                            ║
║   Tools: ${mcpServer.tools.length} intelligence tools available          ║
║                                                           ║
║   MCP Endpoint: http://${HOST}:${PORT}/mcp                 ║
║   REST API: http://${HOST}:${PORT}/api                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
  
  // Display available tools
  console.log('\n📊 Available Intelligence Tools:\n');
  const categories = {
    'Health': mcpServer.tools.filter(t => t.name.startsWith('pmos_health_')),
    'Predictions': mcpServer.tools.filter(t => t.name.startsWith('pmos_predict_')),
    'Context': mcpServer.tools.filter(t => t.name.startsWith('pmos_context_')),
    'Patterns': mcpServer.tools.filter(t => t.name.startsWith('pmos_patterns_')),
    'Insights': mcpServer.tools.filter(t => t.name.startsWith('pmos_insights_')),
    'Memory': mcpServer.tools.filter(t => t.name.startsWith('pmos_memory_')),
    'Utility': mcpServer.tools.filter(t => !['health_', 'predict_', 'context_', 'patterns_', 'insights_', 'memory_'].some(p => t.name.includes(p)))
  };
  
  for (const [category, tools] of Object.entries(categories)) {
    if (tools.length > 0) {
      console.log(`  ${category} (${tools.length}):`);
      tools.forEach(tool => {
        console.log(`    • ${tool.name}`);
      });
      console.log('');
    }
  }
  
  console.log('🧠 PMOS is ready to think!\n');
});

export default app;
