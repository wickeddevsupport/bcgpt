/**
 * Intelligent Chaining Integration Examples
 * Shows how to update specific mcp.js handlers
 */

const intelligent = require('./intelligent-integration.js');

/**
 * EXAMPLE 1: search_todos handler (search + enrichment)
 * 
 * BEFORE (Lines ~1278-1323):
 * Searches for todos, returns raw results with IDs
 * 
 * AFTER:
 * Automatically enriches with person details, project info
 */
async function example_search_todos(ctx, args) {
  try {
    // Old way: just search
    // return await searchRecordings(ctx, args.query, { type: 'Todo' });

    // New way: search + enrich
    const result = await intelligent.executeIntelligentSearch(
      ctx,
      args.query,
      args.project_id // optional
    );

    return {
      success: true,
      query: args.query,
      count: result.count,
      results: result.items,
      metrics: result._metadata
    };
  } catch (error) {
    console.error(`[search_todos] Error:`, error.message);
    throw error;
  }
}

/**
 * EXAMPLE 2: daily_report handler
 * 
 * BEFORE (Lines ~1220-1265):
 * Manually loops through todos, does basic aggregation
 * 
 * AFTER:
 * Uses intelligent context for caching, parallel loading, enrichment
 */
async function example_daily_report(ctx, args) {
  try {
    // Initialize intelligent context once
    const requestCtx = await intelligent.initializeIntelligentContext(
      ctx,
      'daily report'
    );

    // Use parallel execution for independent calls
    const [projects, todos] = await intelligent.executeParallel([
      async () => requestCtx.getProjects?.() || [],
      async () => {
        // Get todos for first project (or specified project)
        const { listTodosForProject } = require('./mcp.js');
        return await listTodosForProject(ctx, args.project_id);
      }
    ]);

    // Filter completed today
    const today = new Date().toISOString().split('T')[0];
    const completedToday = [];
    const dueTodayRemaining = [];

    for (const group of todos) {
      for (const todo of group.todos || []) {
        if (todo.completed && todo.completion?.created_at?.startsWith(today)) {
          completedToday.push(todo);
        } else if (!todo.completed && todo.due_on === today) {
          dueTodayRemaining.push(todo);
        }
      }
    }

    // Enrich results
    const enricher = intelligent.createEnricher(requestCtx);
    const enrichedCompleted = await enricher.enrichArray(completedToday);
    const enrichedDue = await enricher.enrichArray(dueTodayRemaining);

    return {
      date: today,
      completed_today: enrichedCompleted,
      due_today: enrichedDue,
      metrics: requestCtx.getMetrics()
    };
  } catch (error) {
    console.error(`[daily_report] Error:`, error.message);
    throw error;
  }
}

/**
 * EXAMPLE 3: assignment_report handler
 * 
 * BEFORE (Lines ~1278-1323):
 * Manual grouping by assignee
 * 
 * AFTER:
 * Uses specialized AssignmentExecutor with intelligent aggregation
 */
async function example_assignment_report(ctx, args) {
  try {
    const { projectByName } = require('./mcp.js');
    const project = await projectByName(ctx, args.project);

    // Use intelligent executor designed for this pattern
    const result = await intelligent.executeAssignmentReport(
      ctx,
      project.id,
      args.maxTodos || 250
    );

    return {
      project: project.name,
      project_id: project.id,
      report: result.by_person,
      summary: {
        total_todos: result.total_todos,
        total_people: result.by_person.length,
        metrics: result._metadata
      }
    };
  } catch (error) {
    console.error(`[assignment_report] Error:`, error.message);
    throw error;
  }
}

/**
 * EXAMPLE 4: list_todos_due handler
 * 
 * BEFORE (Lines ~1220-1265):
 * Manual date filtering
 * 
 * AFTER:
 * Uses TimelineExecutor with intelligent date filtering
 */
async function example_list_todos_due(ctx, args) {
  try {
    const { projectByName } = require('./mcp.js');
    const project = await projectByName(ctx, args.project);

    // Calculate date range
    const today = new Date();
    const endDate = new Date(today.getTime() + (parseInt(args.days || 7) * 86400000));

    // Use timeline executor
    const result = await intelligent.executeTimeline(
      ctx,
      project.id,
      today.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0]
    );

    return {
      project: project.name,
      date_range: result.date_range,
      todos_due: result.todos,
      count: result.count,
      metrics: result._metadata
    };
  } catch (error) {
    console.error(`[list_todos_due] Error:`, error.message);
    throw error;
  }
}

/**
 * EXAMPLE 5: Custom query handler using pattern detection
 * 
 * This shows how to detect user intent and route to appropriate executor
 */
async function example_smart_query(ctx, args) {
  try {
    // Analyze query to detect pattern
    const analysis = intelligent.analyzeQuery(args.query);

    const { projectByName } = require('./mcp.js');
    const project = await projectByName(ctx, args.project);

    let result;

    switch (analysis.pattern) {
      case 'person_finder':
        // User asking about a specific person
        const personName = analysis.personNames[0];
        result = await intelligent.executePersonFinder(
          ctx,
          project.id,
          personName
        );
        break;

      case 'timeline':
        // User asking about dates
        result = await intelligent.executeTimeline(
          ctx,
          project.id,
          analysis.constraints.dateRange?.start || new Date().toISOString().split('T')[0],
          analysis.constraints.dateRange?.end || new Date(Date.now() + 604800000).toISOString().split('T')[0]
        );
        break;

      case 'assignment':
        // User asking about assignments
        result = await intelligent.executeAssignmentReport(ctx, project.id);
        break;

      case 'status_filter':
        // User filtering by status
        result = await intelligent.executeStatusFilter(
          ctx,
          project.id,
          analysis.constraints.status || 'active'
        );
        break;

      default:
        // Generic search
        result = await intelligent.executeIntelligentSearch(ctx, args.query, project.id);
    }

    return {
      query: args.query,
      detected_pattern: analysis.pattern,
      result: result,
      analysis: analysis
    };
  } catch (error) {
    console.error(`[smart_query] Error:`, error.message);
    throw error;
  }
}

/**
 * EXAMPLE 6: Robust execution with fallbacks
 * 
 * If intelligent chaining fails, fall back to simple approach
 */
async function example_robust_search(ctx, args) {
  try {
    const { projectByName, searchProject } = require('./mcp.js');
    const project = await projectByName(ctx, args.project);

    return await intelligent.robustExecute(
      // Primary: Intelligent chaining
      async () => await intelligent.executeIntelligentSearch(
        ctx,
        args.query,
        project.id
      ),
      // Fallback 1: Simple search without enrichment
      [
        async () => {
          const results = await searchProject(ctx, project.id, { query: args.query });
          return {
            items: results,
            count: results.length,
            fallback: 'simple_search'
          };
        },
        // Fallback 2: Return empty gracefully
        async () => ({
          items: [],
          count: 0,
          fallback: 'empty_result'
        })
      ]
    );
  } catch (error) {
    console.error(`[robust_search] Error:`, error.message);
    throw error;
  }
}

/**
 * EXAMPLE 7: Parallel loading for multiple independent data sources
 * 
 * Load todos, people, projects in parallel, then combine
 */
async function example_project_dashboard(ctx, args) {
  try {
    const { projectByName, listTodosForProject, listPeople } = require('./mcp.js');
    const project = await projectByName(ctx, args.project);

    // Load multiple data sources in parallel
    const [todos, people] = await intelligent.executeParallel([
      async () => await listTodosForProject(ctx, project.id),
      async () => await listPeople(ctx)
    ]);

    // Enrich everything
    const requestCtx = await intelligent.initializeIntelligentContext(ctx, 'dashboard');
    const enricher = intelligent.createEnricher(requestCtx);

    return {
      project: project,
      dashboard: {
        total_todos: todos.reduce((sum, g) => sum + (g.todos?.length || 0), 0),
        todos_by_person: await enricher.formatAssignmentReport(todos),
        teams: people.map(p => ({
          id: p.id,
          name: p.name,
          email: p.email_address
        }))
      },
      metrics: requestCtx.getMetrics()
    };
  } catch (error) {
    console.error(`[project_dashboard] Error:`, error.message);
    throw error;
  }
}

/**
 * IMPLEMENTATION STEPS
 * 
 * To add intelligent chaining to mcp.js:
 * 
 * 1. At the top of mcp.js (after imports):
 *    const intelligent = require('./intelligent-integration.js');
 * 
 * 2. Update each handler using the examples above
 * 
 * 3. Most common updates:
 *    - search_todos → use executeIntelligentSearch
 *    - assignment_report → use executeAssignmentReport
 *    - list_todos_due → use executeTimeline
 *    - list_todos_for_project → add enrichment via createEnricher
 *    - Any handler returning people IDs → use enrichArray to get names
 * 
 * 4. Test each handler to ensure no regression
 * 
 * 5. Commit with message like:
 *    "feat: Add intelligent chaining to [handler_name]"
 */

module.exports = {
  example_search_todos,
  example_daily_report,
  example_assignment_report,
  example_list_todos_due,
  example_smart_query,
  example_robust_search,
  example_project_dashboard
};
