/**
 * Query Parser - Analyzes natural language queries to identify requirements
 * Extracts entities, constraints, and determines optimal API chains
 */

class QueryAnalysis {
  constructor(query) {
    this.originalQuery = query;
    this.normalized = query.toLowerCase().trim();
    
    // What we need to load
    this.needsPeople = false;
    this.needsProjects = false;
    this.needsDock = false;
    
    // Detected entities
    this.personNames = [];
    this.projectNames = [];
    this.resources = []; // "todos", "messages", "documents", etc.
    
    // Constraints
    this.constraints = {
      status: null,         // "completed", "active", "archived"
      dateRange: null,      // { start, end }
      dueDate: null,        // specific date
      priority: null        // "high", "critical", etc.
    };
    
    // Pattern detected
    this.pattern = null;
    this.chain = [];       // Required API calls in order
    this.enrichData = true;
  }

  toString() {
    return JSON.stringify({
      pattern: this.pattern,
      personNames: this.personNames,
      projectNames: this.projectNames,
      resources: this.resources,
      constraints: this.constraints,
      chain: this.chain
    }, null, 2);
  }
}

class QueryParser {
  constructor() {
    this.patterns = [
      this._createPersonFinderPattern(),
      this._createTimelinePattern(),
      this._createAssignmentPattern(),
      this._createSearchEnrichPattern(),
      this._createStatusFilterPattern()
    ];
  }

  /**
   * Parse a natural language query
   */
  parse(query) {
    const analysis = new QueryAnalysis(query);
    
    // Extract entities
    this._extractEntities(analysis);
    
    // Extract constraints
    this._extractConstraints(analysis);
    
    // Match pattern
    this._matchPattern(analysis);
    
    // Determine what to load
    analysis.needsPeople = analysis.personNames.length > 0 || analysis.pattern === 'assignment' || analysis.pattern === 'search_enrich';
    analysis.needsProjects = analysis.projectNames.length > 0;
    analysis.needsDock = analysis.resources.includes('documents') || analysis.resources.includes('messages');
    
    return analysis;
  }

  /**
   * Extract entity names from query
   */
  _extractEntities(analysis) {
    const query = analysis.normalized;
    
    // Find person names (prefer multi-word proper nouns, filter stopwords)
    const stopwords = new Set([
      "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "with",
      "audit", "active", "archived", "archive", "projects", "project", "list", "check", "recent", "comments", "comment",
      "todos", "todo", "tasks", "task", "user", "id", "report", "activity", "assigned", "assign", "member", "members", "membership",
      "find", "search", "show", "what", "who", "where", "why", "how", "which", "tell", "me", "about", "doing", "here", "there"
    ]);

    const fullNameMatches = analysis.originalQuery.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
    const nameMatches = analysis.originalQuery.match(/\b[A-Z][a-z]+\b/g) || [];

    const fullNames = fullNameMatches
      .map(n => n.trim())
      .filter(n => {
        const tokens = n.split(/\s+/).map(t => t.toLowerCase());
        return tokens.some(t => !stopwords.has(t));
      });

    const singleNames = nameMatches
      .map(n => n.trim())
      .filter(n => !stopwords.has(n.toLowerCase()))
      .filter(n => !fullNames.some(fn => fn.includes(n)));

    let personNames = [...new Set([...fullNames, ...singleNames])];

    // Fallback: handle lowercase or uncapitalized names in person-intent queries
    if (personNames.length === 0) {
      const looksLikePersonQuery =
        query.includes("who is") ||
        query.includes("about") ||
        query.includes("tell me") ||
        query.includes("find") ||
        query.includes("person") ||
        query.includes("user") ||
        query.includes("member") ||
        query.includes("collaborator") ||
        query.includes("employee") ||
        query.includes("audit");

      if (looksLikePersonQuery) {
        const resourceSet = new Set(resources.map(r => r.toLowerCase()));
        const tokens = query
          .split(/\s+/)
          .map(t => t.trim())
          .filter(Boolean)
          .filter(t => !stopwords.has(t))
          .filter(t => !resourceSet.has(t))
          .filter(t => !/^\d+$/.test(t));

        if (tokens.length) {
          personNames = [tokens.slice(0, 3).join(" ").trim()];
        }
      }
    }

    analysis.personNames = personNames;
    
    // Find resource types
    const resources = ['todo', 'todos', 'message', 'messages', 'document', 'documents', 'schedule', 'card', 'cards', 'comment', 'comments'];
    for (const resource of resources) {
      if (query.includes(resource)) {
        analysis.resources.push(resource);
      }
    }
    
    // Find project mentions
    if (query.includes('project')) {
      analysis.projectNames.push('[current_project]');
    }
  }

  /**
   * Extract date/status constraints
   */
  _extractConstraints(analysis) {
    const query = analysis.normalized;
    
    // Status constraints
    if (query.includes('complete') || query.includes('done')) {
      analysis.constraints.status = 'completed';
    } else if (query.includes('active') || query.includes('incomplete')) {
      analysis.constraints.status = 'active';
    } else if (query.includes('archive')) {
      analysis.constraints.status = 'archived';
    }
    
    // Date constraints
    if (query.includes('today')) {
      const today = new Date();
      analysis.constraints.dueDate = today.toISOString().split('T')[0];
    } else if (query.includes('tomorrow')) {
      const tomorrow = new Date(Date.now() + 86400000);
      analysis.constraints.dueDate = tomorrow.toISOString().split('T')[0];
    } else if (query.includes('next week') || query.includes('week')) {
      const start = new Date();
      const end = new Date(Date.now() + 604800000);
      analysis.constraints.dateRange = {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      };
    }
    
    // Priority
    if (query.includes('urgent') || query.includes('critical') || query.includes('important')) {
      analysis.constraints.priority = 'high';
    }
  }

  /**
   * Match detected patterns
   */
  _matchPattern(analysis) {
    for (const patternDef of this.patterns) {
      if (patternDef.matcher(analysis)) {
        analysis.pattern = patternDef.name;
        analysis.chain = patternDef.chain;
        return;
      }
    }
    
    // Default: generic search
    analysis.pattern = 'generic';
    analysis.chain = ['search', 'enrich'];
  }

  // ========== Pattern Definitions ==========

  _createPersonFinderPattern() {
    return {
      name: 'person_finder',
      matcher: (analysis) => {
        return analysis.personNames.length > 0 && 
               (analysis.resources.length === 0 || analysis.resources.includes('todo'));
      },
      chain: [
        'find_person_by_name',
        'list_todos_for_project',
        'filter_by_assignee',
        'enrich_results'
      ]
    };
  }

  _createTimelinePattern() {
    return {
      name: 'timeline',
      matcher: (analysis) => {
        return analysis.constraints.dateRange || 
               analysis.constraints.dueDate ||
               analysis.normalized.includes('week') ||
               analysis.normalized.includes('month');
      },
      chain: [
        'list_todos_for_project',
        'filter_by_date',
        'sort_by_date',
        'enrich_results'
      ]
    };
  }

  _createAssignmentPattern() {
    return {
      name: 'assignment',
      matcher: (analysis) => {
        return analysis.normalized.includes('assign') ||
               analysis.normalized.includes('who has') ||
               analysis.normalized.includes('who is') ||
               analysis.normalized.includes('assigned');
      },
      chain: [
        'list_todos_for_project',
        'group_by_assignee',
        'enrich_assignees',
        'aggregate_stats'
      ]
    };
  }

  _createSearchEnrichPattern() {
    return {
      name: 'search_enrich',
      matcher: (analysis) => {
        return analysis.resources.includes('document') ||
               analysis.resources.includes('message') ||
               analysis.normalized.includes('search') ||
               analysis.normalized.includes('find');
      },
      chain: [
        'search_project',
        'extract_references',
        'fetch_related_data',
        'enrich_results'
      ]
    };
  }

  _createStatusFilterPattern() {
    return {
      name: 'status_filter',
      matcher: (analysis) => {
        return analysis.constraints.status !== null;
      },
      chain: [
        'list_todos_for_project',
        'filter_by_status',
        'enrich_results'
      ]
    };
  }
}

export { QueryAnalysis, QueryParser };
