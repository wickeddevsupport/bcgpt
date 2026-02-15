/**
 * PMOS MCP Server Implementation
 * Provides intelligence tools via Model Context Protocol
 */

import PMOSDatabase from './db.js';
import BCGPTClient from './bcgpt-client.js';
import { HealthScorer } from './intelligence/health-scoring.js';
import { PredictionEngine } from './intelligence/predictions.js';
import { ContextAnalyzer } from './intelligence/context-analyzer.js';
import { PatternDetector } from './intelligence/pattern-detector.js';
import { config } from './config.js';

export class PMOSMCPServer {
  constructor() {
    this.db = new PMOSDatabase();
    this.bcgpt = new BCGPTClient(config.bcgptUrl, config.bcgptApiKey);
    this.healthScorer = new HealthScorer(this.db, this.bcgpt);
    this.predictions = new PredictionEngine(this.db, this.bcgpt);
    this.contextAnalyzer = new ContextAnalyzer(this.db, this.bcgpt);
    this.patternDetector = new PatternDetector(this.db, this.bcgpt);
    
    this.tools = this.defineTools();
  }

  defineTools() {
    return [
      // Health Scoring Tools
      {
        name: 'pmos_health_project',
        description: 'Calculate comprehensive health score for a project including activity, velocity, completion rate, and communication metrics',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Basecamp project ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'pmos_health_person',
        description: 'Calculate health score for a person based on workload, responsiveness, and completion rate',
        inputSchema: {
          type: 'object',
          properties: {
            person_id: {
              type: 'string',
              description: 'Basecamp person ID'
            }
          },
          required: ['person_id']
        }
      },

      // Prediction Tools
      {
        name: 'pmos_predict_completion',
        description: 'Predict project completion date based on historical velocity and remaining work',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Basecamp project ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'pmos_predict_deadline_risk',
        description: 'Analyze risk of missing deadlines for project todos',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Basecamp project ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'pmos_predict_blockers',
        description: 'Identify potential blockers - todos that may be stuck or at risk',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Basecamp project ID'
            }
          },
          required: ['project_id']
        }
      },

      // Context Tools
      {
        name: 'pmos_context_analyze',
        description: 'Analyze and extract contextual information about a project including people, timelines, topics, and status',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Basecamp project ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'pmos_context_related_projects',
        description: 'Find projects related to a given project based on context similarity',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Basecamp project ID'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of related projects to return',
              default: 5
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'pmos_context_smart_search',
        description: 'Get smart contextual information relevant to a query',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            },
            entity_type: {
              type: 'string',
              description: 'Optional entity type to scope search'
            },
            entity_id: {
              type: 'string',
              description: 'Optional entity ID to scope search'
            }
          },
          required: ['query']
        }
      },

      // Pattern Detection Tools
      {
        name: 'pmos_patterns_work',
        description: 'Detect work patterns including time-of-day, day-of-week, completion time, and communication patterns',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Basecamp project ID'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'pmos_patterns_issues',
        description: 'Detect recurring issues or blockers in project communications',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Basecamp project ID'
            }
          },
          required: ['project_id']
        }
      },

      // Insights Tools
      {
        name: 'pmos_insights_list',
        description: 'Get actionable insights generated by PMOS intelligence',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of insights to return',
              default: 50
            },
            acknowledged: {
              type: 'boolean',
              description: 'Whether to show acknowledged insights',
              default: false
            }
          },
          required: []
        }
      },
      {
        name: 'pmos_insights_acknowledge',
        description: 'Mark an insight as acknowledged',
        inputSchema: {
          type: 'object',
          properties: {
            insight_id: {
              type: 'string',
              description: 'Insight ID'
            }
          },
          required: ['insight_id']
        }
      },

      // Memory Tools
      {
        name: 'pmos_memory_save',
        description: 'Save important information to PMOS memory for future recall',
        inputSchema: {
          type: 'object',
          properties: {
            memory_type: {
              type: 'string',
              description: 'Type of memory (conversation, decision, fact, etc.)'
            },
            content: {
              type: 'string',
              description: 'Memory content'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization'
            },
            importance: {
              type: 'number',
              description: 'Importance score (0-1)',
              default: 0.5
            }
          },
          required: ['memory_type', 'content']
        }
      },
      {
        name: 'pmos_memory_recall',
        description: 'Recall memories from PMOS memory store',
        inputSchema: {
          type: 'object',
          properties: {
            memory_type: {
              type: 'string',
              description: 'Optional memory type filter'
            },
            min_importance: {
              type: 'number',
              description: 'Minimum importance threshold',
              default: 0.5
            },
            limit: {
              type: 'number',
              description: 'Maximum number of memories to return',
              default: 50
            }
          },
          required: []
        }
      },

      // Utility Tools
      {
        name: 'pmos_status',
        description: 'Get PMOS server status and statistics',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'pmos_cleanup',
        description: 'Clean up old data from PMOS database',
        inputSchema: {
          type: 'object',
          properties: {
            days_to_keep: {
              type: 'number',
              description: 'Number of days of data to keep',
              default: 90
            }
          },
          required: []
        }
      }
    ];
  }

  async handleToolCall(toolName, args) {
    try {
      switch (toolName) {
        // Health Tools
        case 'pmos_health_project':
          return await this.healthScorer.calculateProjectHealth(args.project_id);
        
        case 'pmos_health_person':
          return await this.healthScorer.calculatePersonHealth(args.person_id);
        
        // Prediction Tools
        case 'pmos_predict_completion':
          return await this.predictions.predictProjectCompletion(args.project_id);
        
        case 'pmos_predict_deadline_risk':
          return await this.predictions.predictDeadlineRisk(args.project_id);
        
        case 'pmos_predict_blockers':
          return await this.predictions.predictBlockers(args.project_id);
        
        // Context Tools
        case 'pmos_context_analyze':
          return await this.contextAnalyzer.analyzeProjectContext(args.project_id);
        
        case 'pmos_context_related_projects':
          return await this.contextAnalyzer.findRelatedProjects(args.project_id, args.limit || 5);
        
        case 'pmos_context_smart_search':
          return await this.contextAnalyzer.getSmartContext(args.query, args.entity_type, args.entity_id);
        
        // Pattern Tools
        case 'pmos_patterns_work':
          return await this.patternDetector.detectWorkPatterns(args.project_id);
        
        case 'pmos_patterns_issues':
          return await this.patternDetector.detectRecurringIssues(args.project_id);
        
        // Insights Tools
        case 'pmos_insights_list':
          return {
            insights: this.db.getInsights(args.limit || 50, args.acknowledged || false),
            timestamp: Date.now()
          };
        
        case 'pmos_insights_acknowledge':
          this.db.db.prepare('UPDATE insights SET acknowledged = 1 WHERE id = ?').run(args.insight_id);
          return { success: true, insight_id: args.insight_id };
        
        // Memory Tools
        case 'pmos_memory_save':
          const memoryId = this.db.saveMemory(
            args.memory_type,
            args.content,
            args.tags || [],
            args.importance || 0.5
          );
          return { success: true, memory_id: memoryId.lastInsertRowid };
        
        case 'pmos_memory_recall':
          return {
            memories: this.db.getMemories(args.memory_type, args.min_importance || 0.5, args.limit || 50),
            timestamp: Date.now()
          };
        
        // Utility Tools
        case 'pmos_status':
          return this.getStatus();
        
        case 'pmos_cleanup':
          return this.db.cleanupOldData(args.days_to_keep || 90);
        
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      throw error;
    }
  }

  getStatus() {
    const healthCount = this.db.db.prepare('SELECT COUNT(*) as count FROM health_scores').get();
    const predictionCount = this.db.db.prepare('SELECT COUNT(*) as count FROM predictions WHERE resolved = 0').get();
    const insightCount = this.db.db.prepare('SELECT COUNT(*) as count FROM insights WHERE acknowledged = 0').get();
    const patternCount = this.db.db.prepare('SELECT COUNT(*) as count FROM patterns').get();
    const memoryCount = this.db.db.prepare('SELECT COUNT(*) as count FROM memory').get();
    const operationCount = this.db.db.prepare('SELECT COUNT(*) as count FROM operations').get();
    
    return {
      status: 'operational',
      version: '1.0.0',
      tools: this.tools.length,
      database: {
        health_scores: healthCount.count,
        active_predictions: predictionCount.count,
        unacknowledged_insights: insightCount.count,
        patterns: patternCount.count,
        memories: memoryCount.count,
        operations: operationCount.count
      },
      config: {
        bcgpt_url: config.bcgptUrl,
        flow_url: config.flowUrl,
        bcgpt_api_key_configured: !!config.bcgptApiKey,
        shell_auth_configured: !!config.shellToken
      },
      timestamp: Date.now()
    };
  }

  close() {
    this.db.close();
  }
}

export default PMOSMCPServer;
