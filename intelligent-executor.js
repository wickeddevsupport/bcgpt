/**
 * Intelligent API Executor - Core chaining engine for bcgpt
 * Orchestrates multiple API calls, maintains context, enriches results
 */

import { basecampFetch as api, basecampFetchAll as apiAll } from './basecamp.js';

class RequestContext {
  constructor(apiCtx, userQuery = "") {
    this.apiCtx = apiCtx;
    this.userQuery = userQuery;
    this.cache = {
      people: {},           // personId → person object
      projects: {},         // projectId → project object
      dock: {},             // projectId → dock config
      todolists: {},        // todolistId → todolist object
      recordingDetails: {}  // recordingId → full recording object
    };
    this.callHistory = [];  // Track all API calls
    this.startTime = Date.now();
    this.metrics = {
      apiCallsMade: 0,
      apiCallsPrevented: 0,
      executionTimeMs: 0,
      cacheHitRate: 0
    };
  }

  /**
   * Pre-load essential data that most queries need
   * Runs once per request, then all data cached locally
   */
  async preloadEssentials(options = {}) {
    const { loadPeople = false, loadProjects = false } = options;
    
    try {
      // Parallel load of core data (disabled by default to avoid auth issues)
      const loads = [];
      
      if (loadPeople) {
        loads.push(
          this._loadPeople().catch(e => {
            console.warn(`[RequestContext] Failed to preload people: ${e.message}`);
            return [];
          })
        );
      }
      
      if (loadProjects) {
        loads.push(
          this._loadProjects().catch(e => {
            console.warn(`[RequestContext] Failed to preload projects: ${e.message}`);
            return [];
          })
        );
      }

      if (loads.length) {
        await Promise.all(loads);
      }
      
      console.log(`[RequestContext] Preload complete: { people: ${Object.keys(this.cache.people).length}, projects: ${Object.keys(this.cache.projects).length} }`);
    } catch (e) {
      console.error(`[RequestContext] Preload error: ${e.message}`);
    }
  }

  /**
   * Load all people once, cache by ID
   */
  async _loadPeople() {
    const people = await this._apiCallAll('/people.json');
    if (!Array.isArray(people)) return;
    
    for (const p of people) {
      this.cache.people[p.id] = p;
    }
  }

  /**
   * Load all projects once, cache by ID
   */
  async _loadProjects() {
    const projects = await this._apiCallAll('/projects.json');
    if (!Array.isArray(projects)) return;
    
    for (const p of projects) {
      this.cache.projects[p.id] = p;
    }
  }

  /**
   * Wrapper around API calls for tracking
   */
  async _apiCall(path, options = {}) {
    this.metrics.apiCallsMade++;
    this.callHistory.push({ path, timestamp: Date.now(), ...options });
    if (typeof this.apiCtx?.basecampFetch === "function") {
      return this.apiCtx.basecampFetch(path, options);
    }
    if (this.apiCtx?.TOKEN) {
      return api(this.apiCtx.TOKEN, path, { ...options, accountId: this.apiCtx.accountId, ua: this.apiCtx.ua });
    }
    return api(this.apiCtx, path, options);
  }

  async _apiCallAll(path, options = {}) {
    this.metrics.apiCallsMade++;
    this.callHistory.push({ path, timestamp: Date.now(), paginated: true, ...options });
    if (typeof this.apiCtx?.basecampFetchAll === "function") {
      return this.apiCtx.basecampFetchAll(path, options);
    }
    if (this.apiCtx?.TOKEN) {
      return apiAll(this.apiCtx.TOKEN, path, { ...options, accountId: this.apiCtx.accountId, ua: this.apiCtx.ua });
    }
    return apiAll(this.apiCtx, path, options);
  }

  /**
   * Get person by ID - uses cache
   */
  getPerson(personId) {
    const cached = this.cache.people[personId];
    if (cached) {
      this.metrics.apiCallsPrevented++;
    }
    return cached;
  }

  /**
   * Get person by name - searches cache
   */
  findPersonByName(name) {
    const normalized = (name || "").toLowerCase().trim();
    for (const person of Object.values(this.cache.people)) {
      if (person.name?.toLowerCase() === normalized) {
        return person;
      }
    }
    return null;
  }

  /**
   * Get project by ID - uses cache
   */
  getProject(projectId) {
    return this.cache.projects[projectId];
  }

  /**
   * Get project by name - searches cache
   */
  findProjectByName(name) {
    const normalized = (name || "").toLowerCase().trim();
    for (const project of Object.values(this.cache.projects)) {
      if (project.name?.toLowerCase() === normalized) {
        return project;
      }
    }
    return null;
  }

  /**
   * Enrich a single object with related data (people, projects, etc.)
   */
  async enrichObject(obj) {
    if (!obj) return obj;

    // If has assignee_ids, fetch people objects
    if (Array.isArray(obj.assignee_ids)) {
      obj.assignees = obj.assignee_ids
        .map(id => this.getPerson(id))
        .filter(Boolean);
    }

    // If has creator_id, fetch creator object
    if (obj.creator_id && !obj.creator) {
      const creator = this.getPerson(obj.creator_id);
      if (creator) obj.creator = creator;
    }

    // If has bucket (project) ID, enhance it
    if (obj.bucket?.id) {
      const project = this.getProject(obj.bucket.id);
      if (project) {
        obj.project = project;
      }
    }

    return obj;
  }

  /**
   * Enrich array of objects
   */
  async enrichArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return Promise.all(arr.map(item => this.enrichObject(item)));
  }

  /**
   * Get execution metrics
   */
  getMetrics() {
    this.metrics.executionTimeMs = Date.now() - this.startTime;
    this.metrics.cacheHitRate = this.metrics.apiCallsMade > 0
      ? Math.round((this.metrics.apiCallsPrevented / this.metrics.apiCallsMade) * 100)
      : 0;
    return { ...this.metrics };
  }

  /**
   * Log execution summary
   */
  logSummary() {
    const metrics = this.getMetrics();
    console.log(`[RequestContext] Execution Summary:`, {
      query: this.userQuery.substring(0, 50),
      apiCalls: metrics.apiCallsMade,
      prevented: metrics.apiCallsPrevented,
      timeMs: metrics.executionTimeMs,
      cacheHitRate: `${metrics.cacheHitRate}%`
    });
  }
}

/**
 * Intelligent executor - chains multiple API calls
 */
class IntelligentExecutor {
  constructor(apiCtx) {
    this.apiCtx = apiCtx;
  }

  /**
   * Execute a chain of dependent API calls
   * Returns enriched result
   */
  async executeChain(queryAnalysis) {
    const ctx = new RequestContext(this.apiCtx, queryAnalysis.originalQuery);

    try {
      // Phase 1: Preload what we'll need
      await ctx.preloadEssentials({
        loadPeople: queryAnalysis.needsPeople ?? true,
        loadProjects: queryAnalysis.needsProjects ?? true
      });

      // Phase 2: Execute main chain based on analysis
      let result = await this._executePhase2(ctx, queryAnalysis);

      // Phase 3: Enrich with related data
      if (queryAnalysis.enrichData !== false) {
        result = await ctx.enrichObject(result);
        if (Array.isArray(result.items)) {
          result.items = await ctx.enrichArray(result.items);
        }
      }

      // Phase 4: Add metadata
      result._metadata = ctx.getMetrics();

      ctx.logSummary();
      return result;
    } catch (error) {
      console.error(`[IntelligentExecutor] Chain execution failed:`, error.message);
      throw error;
    }
  }

  /**
   * Execute phase 2 - main business logic
   */
  async _executePhase2(ctx, queryAnalysis) {
    // This is overridden by specific implementations
    throw new Error("Subclass must implement _executePhase2");
  }

  /**
   * Robust execution with fallbacks
   */
  async robustExecute(primaryFn, fallbacks = []) {
    try {
      return await primaryFn();
    } catch (error) {
      console.warn(`[IntelligentExecutor] Primary execution failed:`, error.message);

      for (const fallback of fallbacks) {
        try {
          console.warn(`[IntelligentExecutor] Trying fallback...`);
          return await fallback();
        } catch (fbError) {
          console.warn(`[IntelligentExecutor] Fallback failed:`, fbError.message);
          continue;
        }
      }

      throw error;
    }
  }
}

export { RequestContext, IntelligentExecutor };
