/**
 * Integration module - Shows how to integrate intelligent chaining into mcp.js handlers
 * Provides helper functions for common scenarios
 */

import { RequestContext } from './intelligent-executor.js';
import { QueryParser } from './query-parser.js';
import { ResultEnricher } from './result-enricher.js';
import {
  SearchEnrichExecutor,
  AssignmentExecutor,
  TimelineExecutor,
  PersonFinderExecutor,
  StatusFilterExecutor
} from './pattern-executors.js';

/**
 * Initialize intelligent chaining for a request
 * Call once at the start of each tool handler
 */
async function initializeIntelligentContext(apiCtx, query) {
  const ctx = new RequestContext(apiCtx, query);
  await ctx.preloadEssentials();
  return ctx;
}

/**
 * Parse a user query to understand their intent
 */
function analyzeQuery(query) {
  const parser = new QueryParser();
  return parser.parse(query);
}

/**
 * Create enricher for results
 */
function createEnricher(requestContext) {
  const cacheAdapter = {
    getPerson: (id) => requestContext.getPerson(id),
    getProject: (id) => requestContext.getProject(id),
    findPersonByName: (name) => requestContext.findPersonByName(name),
    findProjectByName: (name) => requestContext.findProjectByName(name)
  };
  return new ResultEnricher(cacheAdapter);
}

/**
 * Execute search with intelligent enrichment
 */
async function executeIntelligentSearch(apiCtx, query, projectId = null) {
  const executor = new SearchEnrichExecutor(apiCtx);
  return executor.execute(apiCtx, query, projectId);
}

/**
 * Execute assignment report with intelligent aggregation
 */
async function executeAssignmentReport(apiCtx, projectId, maxTodos = 250) {
  const executor = new AssignmentExecutor(apiCtx);
  return executor.execute(apiCtx, projectId, maxTodos);
}

/**
 * Execute timeline query with intelligent filtering
 */
async function executeTimeline(apiCtx, projectId, startDate, endDate) {
  const executor = new TimelineExecutor(apiCtx);
  return executor.execute(apiCtx, projectId, startDate, endDate);
}

/**
 * Execute daily report with intelligent aggregation
 * Loads all todos and organizes by project with enrichment
 */
async function executeDailyReport(apiCtx, date) {
  // Initialize context for caching and enrichment
  const ctx = new RequestContext(apiCtx, `daily report for ${date}`);
  await ctx.preloadEssentials();

  try {
    // Load all open todos (this will be cached)
    const rows = await apiCtx.listAllOpenTodos();

    // Enrich with person and project details
    const enricher = createEnricher(ctx);
    const enrichedTodos = await Promise.all(
      rows.map(async (todo) => {
        return enricher.enrich(todo, {
          getPerson: (id) => ctx.getPerson(id),
          getProject: (id) => ctx.getProject(id)
        });
      })
    );

    // Filter by date
    const dueToday = enrichedTodos.filter((r) => r.due_on === date);
    const overdue = enrichedTodos.filter((r) => r.due_on && r.due_on < date);

    // Aggregate per project
    const perProject = {};
    for (const todo of enrichedTodos) {
      const projectId = todo.projectId || todo.project_id;
      const projectName = todo.project_name || todo.project || "Unknown";
      
      if (!perProject[projectId]) {
        perProject[projectId] = {
          projectId,
          project: projectName,
          openTodos: 0,
          dueToday: 0,
          overdue: 0
        };
      }

      perProject[projectId].openTodos += 1;
      if (todo.due_on === date) perProject[projectId].dueToday += 1;
      if (todo.due_on && todo.due_on < date) perProject[projectId].overdue += 1;
    }

    const perProjectArr = Object.values(perProject).sort(
      (a, b) =>
        (b.overdue - a.overdue) ||
        (b.dueToday - a.dueToday) ||
        (a.project || "").localeCompare(b.project || "")
    );

    return {
      date,
      totals: {
        projects: Object.keys(perProject).length,
        dueToday: dueToday.length,
        overdue: overdue.length
      },
      perProject: perProjectArr,
      dueToday: dueToday.map(t => ({ id: t.id, title: t.title, project: t.project, assignee: t.assignee })),
      overdue: overdue.map(t => ({ id: t.id, title: t.title, project: t.project, assignee: t.assignee, due_on: t.due_on })),
      _metadata: ctx.getMetrics()
    };
  } catch (error) {
    console.error(`[executeDailyReport] Error:`, error.message);
    throw error;
  }
}

/**
 * Find all todos for a person
 */
async function executePersonFinder(apiCtx, projectId, personName) {
  const executor = new PersonFinderExecutor(apiCtx);
  return executor.execute(apiCtx, projectId, personName);
}

/**
 * Filter todos by status
 */
async function executeStatusFilter(apiCtx, projectId, status = 'active') {
  const executor = new StatusFilterExecutor(apiCtx);
  return executor.execute(apiCtx, projectId, status);
}

/**
 * Helper: Execute with fallback strategies
 */
async function robustExecute(primaryFn, fallbacks = []) {
  try {
    return await primaryFn();
  } catch (primaryError) {
    console.warn(`[Integration] Primary execution failed:`, primaryError.message);

    for (let i = 0; i < fallbacks.length; i++) {
      try {
        console.log(`[Integration] Trying fallback ${i + 1}...`);
        return await fallbacks[i]();
      } catch (fbError) {
        console.warn(`[Integration] Fallback ${i + 1} failed:`, fbError.message);
        if (i === fallbacks.length - 1) throw fbError;
      }
    }
  }
}

/**
 * Helper: Parallel execution of independent calls
 */
async function executeParallel(tasks) {
  return Promise.all(tasks.map(task => task().catch(e => ({ error: e.message }))));
}

/**
 * Helper: Sequential execution with error handling
 */
async function executeSequential(tasks) {
  const results = [];
  for (const task of tasks) {
    try {
      results.push(await task());
    } catch (error) {
      results.push({ error: error.message });
    }
  }
  return results;
}

/**
 * Example: How to update a tool handler with intelligent chaining
 * 
 * BEFORE (Simple):
 * async function handleSearch(ctx, args) {
 *   const results = await searchProject(ctx, projectId, { query: args.query });
 *   return results;  // Raw IDs, no enrichment
 * }
 * 
 * AFTER (Intelligent):
 * async function handleSearch(ctx, args) {
 *   try {
 *     return await executeIntelligentSearch(ctx, args.query, projectId);
 *   } catch (error) {
 *     // Fallback to simple search
 *     return await searchProject(ctx, projectId, { query: args.query });
 *   }
 * }
 */

/**
 * Migration guide for updating mcp.js handlers:
 * 
 * 1. At the top of mcp.js, add imports:
 *    const intelligent = require('./intelligent-integration.js');
 * 
 * 2. For search handlers, replace:
 *    OLD: return await searchProject(ctx, projectId, { query });
 *    NEW: return await intelligent.executeIntelligentSearch(ctx, query, projectId);
 * 
 * 3. For assignment reports:
 *    OLD: return assignmentReport(ctx, projectName);
 *    NEW: return await intelligent.executeAssignmentReport(ctx, projectId);
 * 
 * 4. For timeline queries:
 *    OLD: return listTodosForProject(ctx, projectId);
 *    NEW: return await intelligent.executeTimeline(ctx, projectId, start, end);
 * 
 * 5. For person-specific queries:
 *    OLD: Manual filtering and enrichment
 *    NEW: return await intelligent.executePersonFinder(ctx, projectId, personName);
 */

export {
  // Context management
  initializeIntelligentContext,
  analyzeQuery,
  createEnricher,

  // Specialized executors
  executeIntelligentSearch,
  executeAssignmentReport,
  executeTimeline,
  executeDailyReport,
  executePersonFinder,
  executeStatusFilter,

  // Execution helpers
  robustExecute,
  executeParallel,
  executeSequential
};
