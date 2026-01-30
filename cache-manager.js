/**
 * Cache Manager - Handles caching strategy for bcgpt
 * Optimizes repeated lookups and reduces API calls
 */

import { api } from './basecamp.js';

class CacheStore {
  constructor() {
    this.stores = new Map();
    this.timestamps = new Map();
    this.ttls = new Map(); // Time to live in ms
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }

  /**
   * Set cache entry with optional TTL
   */
  set(key, value, ttlMs = null) {
    this.stores.set(key, value);
    this.timestamps.set(key, Date.now());
    if (ttlMs) this.ttls.set(key, ttlMs);
  }

  /**
   * Get cache entry - returns null if expired
   */
  get(key) {
    if (!this.stores.has(key)) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    const ttl = this.ttls.get(key);
    if (ttl) {
      const age = Date.now() - this.timestamps.get(key);
      if (age > ttl) {
        this.stores.delete(key);
        this.timestamps.delete(key);
        this.ttls.delete(key);
        this.stats.evictions++;
        this.stats.misses++;
        return null;
      }
    }

    this.stats.hits++;
    return this.stores.get(key);
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Clear all cache
   */
  clear() {
    this.stores.clear();
    this.timestamps.clear();
    this.ttls.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 100) : 0,
      entries: this.stores.size
    };
  }
}

/**
 * Request-scoped cache for per-request data
 */
class RequestCache {
  constructor() {
    this.data = {};
  }

  set(key, value) {
    this.data[key] = value;
  }

  get(key, defaultValue = null) {
    return this.data[key] ?? defaultValue;
  }

  has(key) {
    return key in this.data;
  }

  /**
   * Get or compute - lazy loading pattern
   */
  async getOrCompute(key, computeFn) {
    if (this.has(key)) {
      return this.get(key);
    }
    const value = await computeFn();
    this.set(key, value);
    return value;
  }

  clear() {
    this.data = {};
  }
}

/**
 * Cache manager for intelligent chaining
 */
class CacheManager {
  constructor() {
    this.globalCache = new CacheStore();
    this.requestCache = new RequestCache();
    
    // Preload strategy
    this.preloadQueue = [];
    this.isPreloaded = false;
  }

  /**
   * Initialize global cache with essential data
   */
  async initializeGlobal(apiCtx) {
    if (this.isPreloaded) return; // Only preload once per session
    
    try {
      // Load people - typically needed by most queries
      const people = await api(apiCtx, '/people.json');
      if (Array.isArray(people)) {
        for (const person of people) {
          this.globalCache.set(`person:${person.id}`, person, 3600000); // 1 hour TTL
        }
        console.log(`[CacheManager] Loaded ${people.length} people`);
      }

      // Load projects
      const projects = await api(apiCtx, '/projects.json');
      if (Array.isArray(projects)) {
        for (const project of projects) {
          this.globalCache.set(`project:${project.id}`, project, 3600000); // 1 hour TTL
        }
        console.log(`[CacheManager] Loaded ${projects.length} projects`);
      }

      this.isPreloaded = true;
    } catch (error) {
      console.warn(`[CacheManager] Failed to initialize global cache:`, error.message);
    }
  }

  /**
   * Get person by ID - checks global then request cache
   */
  getPerson(personId) {
    const key = `person:${personId}`;
    return this.globalCache.get(key) || this.requestCache.get(key);
  }

  /**
   * Get project by ID
   */
  getProject(projectId) {
    const key = `project:${projectId}`;
    return this.globalCache.get(key) || this.requestCache.get(key);
  }

  /**
   * Find person by name - searches cache
   */
  findPersonByName(name) {
    const normalized = (name || "").toLowerCase().trim();
    
    // Try request cache first (it's hot)
    const requestData = this.requestCache.get('all_people', []);
    for (const p of requestData) {
      if (p.name?.toLowerCase() === normalized) return p;
    }

    // Search global cache
    for (let i = 1; i < 10000; i++) {
      const person = this.getPerson(i);
      if (person?.name?.toLowerCase() === normalized) {
        return person;
      }
    }
    return null;
  }

  /**
   * Find project by name
   */
  findProjectByName(name) {
    const normalized = (name || "").toLowerCase().trim();
    
    // Try request cache first
    const requestData = this.requestCache.get('all_projects', []);
    for (const p of requestData) {
      if (p.name?.toLowerCase() === normalized) return p;
    }

    // Search global cache
    for (let i = 1; i < 10000; i++) {
      const project = this.getProject(i);
      if (project?.name?.toLowerCase() === normalized) {
        return project;
      }
    }
    return null;
  }

  /**
   * Cache result for request lifecycle
   */
  cacheRequestData(key, value) {
    this.requestCache.set(key, value);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      global: this.globalCache.getStats(),
      request: Object.keys(this.requestCache.data).length
    };
  }

  /**
   * Clear request cache (but keep global)
   */
  clearRequestCache() {
    this.requestCache.clear();
  }

  /**
   * Clear everything
   */
  clearAll() {
    this.globalCache.clear();
    this.requestCache.clear();
    this.isPreloaded = false;
  }
}

// Global singleton cache manager
let cacheManager = null;

function getCacheManager() {
  if (!cacheManager) {
    cacheManager = new CacheManager();
  }
  return cacheManager;
}

export { CacheStore, RequestCache, CacheManager, getCacheManager };
