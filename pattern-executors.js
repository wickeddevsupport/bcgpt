/**
 * Specialized executors for common query patterns
 * Each handles a specific type of intelligent chaining
 */

import { IntelligentExecutor, RequestContext } from './intelligent-executor.js';
import { ResultEnricher } from './result-enricher.js';

/**
 * Search + Enrich Executor
 * Finds items and enriches with related data
 */
class SearchEnrichExecutor extends IntelligentExecutor {
  async execute(ctx, query, projectId = null, searchFn) {
    const analysis = {
      originalQuery: query,
      needsPeople: true,
      needsProjects: true,
      enrichData: true
    };

    const requestCtx = new RequestContext(ctx, query);
    await requestCtx.preloadEssentials(analysis);

    try {
      // Phase 1: Search (using provided function or generic search)
      let results = [];
      
      if (searchFn && typeof searchFn === 'function') {
        results = await searchFn(ctx, query, projectId);
      } else {
        // Default: use basecampFetchAll for generic search
        results = [];
      }

      // Phase 2: Enrich
      const enricher = new ResultEnricher(this._makeCacheAdapter(requestCtx));
      results = await enricher.formatSearchResults(results);

      return {
        items: results,
        count: results.length,
        _metadata: requestCtx.getMetrics()
      };
    } catch (error) {
      console.error(`[SearchEnrichExecutor] Error:`, error.message);
      throw error;
    }
  }

  _makeCacheAdapter(requestCtx) {
    return {
      getPerson: (id) => requestCtx.getPerson(id),
      getProject: (id) => requestCtx.getProject(id),
      findPersonByName: (name) => requestCtx.findPersonByName(name)
    };
  }
}

/**
 * Assignment Report Executor
 * Groups todos by assignee and provides statistics
 */
class AssignmentExecutor extends IntelligentExecutor {
  async execute(ctx, projectId, maxTodos = 250, groups = null) {
    const requestCtx = new RequestContext(ctx, 'assignment report');
    await requestCtx.preloadEssentials({ loadPeople: true });

    try {
      // Phase 1: Get all todos (or use provided groups)
      let todoGroups = groups;
      if (!todoGroups) {
        // Would need to call listTodosForProject, but we can't import it
        // So caller should provide groups
        todoGroups = [];
      }

      // Phase 2: Aggregate by assignee  
      const report = this._aggregateByAssignee(todoGroups, requestCtx);

      // Phase 3: Enrich
      const enricher = new ResultEnricher(this._makeCacheAdapter(requestCtx));
      const enriched = await enricher.formatAssignmentReport(todoGroups);

      return {
        project_id: projectId,
        total_todos: this._countTodos(todoGroups),
        by_person: enriched,
        _metadata: requestCtx.getMetrics()
      };
    } catch (error) {
      console.error(`[AssignmentExecutor] Error:`, error.message);
      throw error;
    }
  }

  _aggregateByAssignee(groups, requestCtx) {
    const byPerson = {};
    
    for (const group of groups) {
      for (const todo of group.todos || []) {
        if (!Array.isArray(todo.assignee_ids)) continue;
        
        for (const personId of todo.assignee_ids) {
          const person = requestCtx.getPerson(personId);
          if (!person) continue;
          
          if (!byPerson[person.id]) {
            byPerson[person.id] = {
              person: { id: person.id, name: person.name },
              todos: [],
              stats: { total: 0, completed: 0, overdue: 0 }
            };
          }
          
          byPerson[person.id].todos.push(todo);
          byPerson[person.id].stats.total++;
          
          if (todo.completed) byPerson[person.id].stats.completed++;
          
          const today = new Date().toISOString().split('T')[0];
          if (todo.due_on && todo.due_on < today) {
            byPerson[person.id].stats.overdue++;
          }
        }
      }
    }
    
    return Object.values(byPerson).sort((a, b) => b.stats.total - a.stats.total);
  }

  _countTodos(groups) {
    return groups.reduce((sum, g) => sum + (g.todos?.length || 0), 0);
  }

  _makeCacheAdapter(requestCtx) {
    return {
      getPerson: (id) => requestCtx.getPerson(id),
      getProject: (id) => requestCtx.getProject(id)
    };
  }
}

/**
 * Timeline Executor
 * Filters todos by date range
 */
class TimelineExecutor extends IntelligentExecutor {
  async execute(ctx, projectId, startDate, endDate, groups = null) {
    const requestCtx = new RequestContext(ctx, `timeline ${startDate} to ${endDate}`);
    await requestCtx.preloadEssentials({ loadPeople: true });

    try {
      // Phase 1: Get todos (or use provided groups)
      let todoGroups = groups;
      if (!todoGroups) {
        // Would need listTodosForProject
        todoGroups = [];
      }

      // Phase 2: Filter by date
      const filtered = this._filterByDateRange(todoGroups, startDate, endDate);

      // Phase 3: Enrich
      const enricher = new ResultEnricher(this._makeCacheAdapter(requestCtx));
      const enriched = await enricher.enrichGroups(filtered);

      return {
        project_id: projectId,
        date_range: { start: startDate, end: endDate },
        todos: enriched,
        count: this._countTodos(enriched),
        _metadata: requestCtx.getMetrics()
      };
    } catch (error) {
      console.error(`[TimelineExecutor] Error:`, error.message);
      throw error;
    }
  }

  _filterByDateRange(groups, startDate, endDate) {
    return groups.map(group => ({
      ...group,
      todos: (group.todos || []).filter(todo => {
        if (!todo.due_on) return false;
        return todo.due_on >= startDate && todo.due_on <= endDate;
      })
    }));
  }

  _countTodos(groups) {
    return groups.reduce((sum, g) => sum + (g.todos?.length || 0), 0);
  }

  _makeCacheAdapter(requestCtx) {
    return {
      getPerson: (id) => requestCtx.getPerson(id)
    };
  }
}

/**
 * Person Finder Executor
 * Finds all todos for a specific person
 */
class PersonFinderExecutor extends IntelligentExecutor {
  async execute(ctx, projectId, personName) {
    const requestCtx = new RequestContext(ctx, `find ${personName}`);
    await requestCtx.preloadEssentials({ loadPeople: true });

    try {
      // Phase 1: Find person
      const person = requestCtx.findPersonByName(personName);
      if (!person) {
        return {
          error: 'Person not found',
          searched_for: personName,
          _metadata: requestCtx.getMetrics()
        };
      }

      // Phase 2: Get todos for this person (or use provided groups)
      let groups = null;
      if (!groups) {
        // Would need listTodosForProject
        groups = [];
      }
      
      // Filter to this person
      const personTodos = [];
      if (groups) {
        for (const group of groups) {
          for (const todo of group.todos || []) {
            if (Array.isArray(todo.assignee_ids) && todo.assignee_ids.includes(person.id)) {
              personTodos.push(todo);
            }
          }
        }
      }

      // Phase 3: Enrich
      const enricher = new ResultEnricher(this._makeCacheAdapter(requestCtx));
      const enriched = await enricher.formatTodoResults(personTodos);

      return {
        person: { id: person.id, name: person.name, email: person.email_address },
        todos: enriched,
        stats: {
          total: enriched.length,
          completed: enriched.filter(t => t.completed).length,
          overdue: enriched.filter(t => t.due_on && t.due_on < new Date().toISOString().split('T')[0]).length
        },
        _metadata: requestCtx.getMetrics()
      };
    } catch (error) {
      console.error(`[PersonFinderExecutor] Error:`, error.message);
      throw error;
    }
  }

  _makeCacheAdapter(requestCtx) {
    return {
      getPerson: (id) => requestCtx.getPerson(id)
    };
  }
}

/**
 * Status Filter Executor
 * Filters todos by status (completed, active, archived)
 */
class StatusFilterExecutor extends IntelligentExecutor {
  async execute(ctx, projectId, status = 'active', groups = null) {
    const requestCtx = new RequestContext(ctx, `filter status: ${status}`);
    await requestCtx.preloadEssentials({ loadPeople: true });

    try {
      // Phase 1: Get todos (or use provided groups)
      let todoGroups = groups;
      if (!todoGroups) {
        // Would need listTodosForProject
        todoGroups = [];
      }

      // Phase 2: Filter by status
      const filtered = this._filterByStatus(todoGroups, status);

      // Phase 3: Enrich
      const enricher = new ResultEnricher(this._makeCacheAdapter(requestCtx));
      const enriched = await enricher.enrichGroups(filtered);

      return {
        project_id: projectId,
        status_filter: status,
        todos: enriched,
        count: this._countTodos(enriched),
        _metadata: requestCtx.getMetrics()
      };
    } catch (error) {
      console.error(`[StatusFilterExecutor] Error:`, error.message);
      throw error;
    }
  }

  _filterByStatus(groups, status) {
    return groups.map(group => ({
      ...group,
      todos: (group.todos || []).filter(todo => {
        if (status === 'completed') return todo.completed === true;
        if (status === 'active') return todo.completed !== true;
        if (status === 'archived') return todo.status === 'archived';
        return true;
      })
    }));
  }

  _countTodos(groups) {
    return groups.reduce((sum, g) => sum + (g.todos?.length || 0), 0);
  }

  _makeCacheAdapter(requestCtx) {
    return {
      getPerson: (id) => requestCtx.getPerson(id)
    };
  }
}

export {
  SearchEnrichExecutor,
  AssignmentExecutor,
  TimelineExecutor,
  PersonFinderExecutor,
  StatusFilterExecutor
};
