/**
 * Integration module - Shows how to integrate intelligent chaining into mcp.js handlers
 * Provides helper functions for common scenarios
 */

const { RequestContext } = require('./intelligent-executor.js');
const { QueryParser } = require('./query-parser.js');
const { ResultEnricher } = require('./result-enricher.js');
const {
  SearchEnrichExecutor,
  AssignmentExecutor,
  TimelineExecutor,
  PersonFinderExecutor,
  StatusFilterExecutor
} = require('./pattern-executors.js');

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

module.exports = {
  // Context management
  initializeIntelligentContext,
  analyzeQuery,
  createEnricher,

  // Specialized executors
  executeIntelligentSearch,
  executeAssignmentReport,
  executeTimeline,
  executePersonFinder,
  executeStatusFilter,

  // Execution helpers
  robustExecute,
  executeParallel,
  executeSequential
};
