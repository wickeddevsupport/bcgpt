/**
 * Result Enricher - Adds context and related data to API responses
 * Transforms raw API data into rich, user-friendly format
 */

class ResultEnricher {
  constructor(cacheManager) {
    this.cache = cacheManager;
  }

  /**
   * Enrich a single result object
   */
  async enrich(item, options = {}) {
    if (!item) return item;

    const enriched = { ...item };

    // Enrich assignee_ids → assignees objects
    if (Array.isArray(enriched.assignee_ids)) {
      enriched.assignees = enriched.assignee_ids
        .map(id => this.cache.getPerson(id))
        .filter(Boolean)
        .map(p => ({
          id: p.id,
          name: p.name,
          email: p.email_address,
          avatar_url: p.avatar_url
        }));
    }

    // Enrich creator_id → creator object
    if (enriched.creator_id && !enriched.creator_details) {
      const creator = this.cache.getPerson(enriched.creator_id);
      if (creator) {
        enriched.creator_details = {
          id: creator.id,
          name: creator.name,
          email: creator.email_address
        };
      }
    }

    // Enrich bucket (project) reference
    if (enriched.bucket?.id && !enriched.project_details) {
      const project = this.cache.getProject(enriched.bucket.id);
      if (project) {
        enriched.project_details = {
          id: project.id,
          name: project.name
        };
      }
    }

    // Format dates to readable format
    if (enriched.due_on) {
      enriched.due_on_readable = this._formatDate(enriched.due_on);
    }
    if (enriched.created_at) {
      enriched.created_at_readable = this._formatDate(enriched.created_at);
    }
    if (enriched.updated_at) {
      enriched.updated_at_readable = this._formatDate(enriched.updated_at);
    }

    // Enrich completion info
    if (enriched.completed && enriched.completion?.creator_id) {
      const completor = this.cache.getPerson(enriched.completion.creator_id);
      if (completor) {
        enriched.completed_by = {
          name: completor.name,
          email: completor.email_address
        };
      }
    }

    return enriched;
  }

  /**
   * Enrich array of results
   */
  async enrichArray(items, options = {}) {
    if (!Array.isArray(items)) return items;
    
    return Promise.all(
      items.map(item => this.enrich(item, options))
    );
  }

  /**
   * Enrich with group context
   */
  async enrichGroups(groups, options = {}) {
    if (!Array.isArray(groups)) return groups;
    
    return Promise.all(
      groups.map(async group => ({
        ...group,
        todos: group.todos ? await this.enrichArray(group.todos, options) : []
      }))
    );
  }

  /**
   * Format search results
   */
  async formatSearchResults(results, options = {}) {
    if (!Array.isArray(results)) return results;

    const enriched = await this.enrichArray(results, options);
    
    return enriched.map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      content: item.plain_text_content?.substring(0, 200),
      url: item.app_url,
      created_at: item.created_at_readable,
      assignees: item.assignees,
      status: item.status,
      completed: item.completed
    }));
  }

  /**
   * Format todo list results
   */
  async formatTodoResults(todos, options = {}) {
    if (!Array.isArray(todos)) return todos;

    const enriched = await this.enrichArray(todos, options);

    return enriched.map(todo => ({
      id: todo.id,
      title: todo.title || todo.content,
      status: todo.status,
      completed: todo.completed,
      due_on: todo.due_on,
      due_on_readable: todo.due_on_readable,
      assignees: todo.assignees || [],
      priority: this._extractPriority(todo.content),
      created_at: todo.created_at_readable,
      url: todo.app_url
    }));
  }

  /**
   * Format assignment report
   */
  async formatAssignmentReport(groups, options = {}) {
    const enriched = await this.enrichGroups(groups, options);
    
    const byAssignee = {};
    
    for (const group of enriched) {
      for (const todo of group.todos || []) {
        if (!todo.assignees || todo.assignees.length === 0) continue;
        
        for (const assignee of todo.assignees) {
          if (!byAssignee[assignee.id]) {
            byAssignee[assignee.id] = {
              person: assignee,
              todos: [],
              stats: { total: 0, completed: 0, overdue: 0 }
            };
          }
          
          byAssignee[assignee.id].todos.push(todo);
          byAssignee[assignee.id].stats.total++;
          
          if (todo.completed) {
            byAssignee[assignee.id].stats.completed++;
          }
          
          if (todo.due_on && todo.due_on < new Date().toISOString().split('T')[0]) {
            byAssignee[assignee.id].stats.overdue++;
          }
        }
      }
    }
    
    return Object.values(byAssignee).sort((a, b) => 
      b.stats.total - a.stats.total
    );
  }

  /**
   * Helper: Extract priority from content
   */
  _extractPriority(content) {
    if (!content) return 'normal';
    const lower = content.toLowerCase();
    if (lower.includes('urgent') || lower.includes('asap')) return 'urgent';
    if (lower.includes('critical') || lower.includes('critical')) return 'critical';
    if (lower.includes('high')) return 'high';
    if (lower.includes('low')) return 'low';
    return 'normal';
  }

  /**
   * Helper: Format ISO date to readable
   */
  _formatDate(isoDate) {
    if (!isoDate) return null;
    try {
      return new Date(isoDate).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return isoDate;
    }
  }

  /**
   * Helper: Calculate days until due
   */
  _daysUntilDue(dueDate) {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const today = new Date();
    const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    
    if (diff < 0) return `${Math.abs(diff)} days overdue`;
    if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    return `Due in ${diff} days`;
  }
}

module.exports = {
  ResultEnricher
};
