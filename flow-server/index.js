/**
 * Flow Server - The Executor
 * Execution layer providing automation and workflow capabilities
 */

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import FlowMCPServer from './mcp.js';

const app = express();
const mcpServer = new FlowMCPServer();

// Middleware
app.use(cors());
app.use(express.json());

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
    service: 'flow-server',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

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
              name: 'flow-server',
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

app.get('/api/status', async (req, res) => {
  try {
    const status = await mcpServer.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Quick flows list endpoint
app.get('/api/flows', async (req, res) => {
  try {
    const result = await mcpServer.handleToolCall('flow_list', {});
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Quick flow trigger endpoint
app.post('/api/flows/:flowId/trigger', async (req, res) => {
  try {
    const result = await mcpServer.handleToolCall('flow_trigger', {
      flow_id: req.params.flowId,
      payload: req.body
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
const PORT = config.port;
const HOST = config.host;

app.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   Flow Server - The Executor                              ║
║   Execution Layer for BCGPT                               ║
║                                                           ║
║   Status: OPERATIONAL                                     ║
║   Port: ${PORT}                                            ║
║   Tools: ${mcpServer.tools.length} flow tools available               ║
║                                                           ║
║   MCP Endpoint: http://${HOST}:${PORT}/mcp                 ║
║   REST API: http://${HOST}:${PORT}/api                     ║
║   Activepieces: ${config.activepiecesUrl}                 
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
  
  // Display available tools
  console.log('\n⚡ Available Flow Tools:\n');
  const categories = {
    'Management': mcpServer.tools.filter(t => ['flow_list', 'flow_get', 'flow_create', 'flow_update', 'flow_delete'].includes(t.name)),
    'Execution': mcpServer.tools.filter(t => ['flow_trigger', 'flow_runs_list', 'flow_run_get'].includes(t.name)),
    'Projects': mcpServer.tools.filter(t => t.name.startsWith('flow_project')),
    'Pieces': mcpServer.tools.filter(t => t.name.includes('pieces')),
    'Connections': mcpServer.tools.filter(t => t.name.includes('connection')),
    'Utility': mcpServer.tools.filter(t => t.name === 'flow_status')
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
  
  console.log('⚡ Flow is ready to automate!\n');
});

export default app;
