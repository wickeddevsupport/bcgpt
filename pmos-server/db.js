/**
 * PMOS Database Manager
 * Manages intelligence data, predictions, patterns, and context
 * Using in-memory storage for simplicity (can be upgraded to SQLite later)
 */

import fs from 'fs';
import { config } from './config.js';

class PMOSDatabase {
  constructor() {
    this.dbPath = config.dbPath.replace('.db', '.json');
    this.data = this.loadData();
    this.ensureShape();
    
    // Auto-save every 30 seconds
    setInterval(() => this.saveData(), 30000);
  }

  loadData() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (error) {
      console.error('Error loading database:', error.message);
    }
    
    return {
      health_scores: {},
      predictions: [],
      patterns: [],
      context: [],
      insights: [],
      memory: [],
      operations: []
    };
  }

  ensureShape() {
    const defaults = {
      health_scores: {},
      predictions: [],
      patterns: [],
      context: [],
      insights: [],
      memory: [],
      operations: []
    };

    for (const [key, fallback] of Object.entries(defaults)) {
      if (this.data[key] === undefined || this.data[key] === null) {
        this.data[key] = fallback;
      }
    }
  }

  saveData() {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error saving database:', error.message);
    }
  }

  // Health Scores
  saveHealthScore(entityType, entityId, score, factors) {
    const key = `${entityType}:${entityId}`;
    this.data.health_scores[key] = {
      entity_type: entityType,
      entity_id: entityId,
      score,
      factors,
      timestamp: Date.now()
    };
    return { success: true };
  }

  getHealthScore(entityType, entityId) {
    const key = `${entityType}:${entityId}`;
    return this.data.health_scores[key] || null;
  }

  // Predictions
  savePrediction(predictionType, entityType, entityId, prediction, confidence, predictedDate = null) {
    const pred = {
      id: this.data.predictions.length + 1,
      prediction_type: predictionType,
      entity_type: entityType,
      entity_id: entityId,
      prediction,
      confidence,
      predicted_date: predictedDate,
      created_at: Date.now(),
      resolved: false,
      actual_outcome: null
    };
    this.data.predictions.push(pred);
    return { lastInsertRowid: pred.id };
  }

  getPredictions(entityType, entityId, limit = 10) {
    return this.data.predictions
      .filter(p => p.entity_type === entityType && p.entity_id === entityId && !p.resolved)
      .sort((a, b) => b.confidence - a.confidence || b.created_at - a.created_at)
      .slice(0, limit);
  }

  // Patterns
  savePattern(patternType, patternData, occurrences, confidence, metadata = null) {
    const pattern = {
      id: this.data.patterns.length + 1,
      pattern_type: patternType,
      pattern_data: patternData,
      occurrences,
      confidence,
      first_seen: Date.now(),
      last_seen: Date.now(),
      metadata
    };
    this.data.patterns.push(pattern);
    return { lastInsertRowid: pattern.id };
  }

  getPatterns(patternType, minConfidence = 0.7) {
    return this.data.patterns
      .filter(p => p.pattern_type === patternType && p.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);
  }

  // Context
  saveContext(entityType, entityId, contextType, contextData, relevanceScore) {
    const ctx = {
      id: this.data.context.length + 1,
      entity_type: entityType,
      entity_id: entityId,
      context_type: contextType,
      context_data: contextData,
      relevance_score: relevanceScore,
      timestamp: Date.now()
    };
    this.data.context.push(ctx);
    return { lastInsertRowid: ctx.id };
  }

  getContext(entityType, entityId, limit = 20) {
    return this.data.context
      .filter(c => c.entity_type === entityType && c.entity_id === entityId)
      .sort((a, b) => b.relevance_score - a.relevance_score || b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Insights
  saveInsight(insightType, title, description, severity, actionable, entityRefs = null) {
    const insight = {
      id: this.data.insights.length + 1,
      insight_type: insightType,
      title,
      description,
      severity,
      actionable,
      entity_refs: entityRefs,
      created_at: Date.now(),
      acknowledged: false
    };
    this.data.insights.push(insight);
    return { lastInsertRowid: insight.id };
  }

  getInsights(limit = 50, acknowledged = false) {
    const severityOrder = { critical: 1, high: 2, medium: 3, low: 4 };
    return this.data.insights
      .filter(i => i.acknowledged === acknowledged)
      .sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        return severityDiff !== 0 ? severityDiff : b.created_at - a.created_at;
      })
      .slice(0, limit);
  }

  // Memory
  saveMemory(memoryType, content, tags, importance) {
    const memory = {
      id: this.data.memory.length + 1,
      memory_type: memoryType,
      content,
      tags,
      importance,
      created_at: Date.now(),
      accessed_count: 0,
      last_accessed: null
    };
    this.data.memory.push(memory);
    return { lastInsertRowid: memory.id };
  }

  getMemories(memoryType = null, minImportance = 0.5, limit = 50) {
    let memories = this.data.memory.filter(m => m.importance >= minImportance);
    
    if (memoryType) {
      memories = memories.filter(m => m.memory_type === memoryType);
    }
    
    return memories
      .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
      .slice(0, limit);
  }

  updateMemoryAccess(memoryId) {
    const memory = this.data.memory.find(m => m.id === memoryId);
    if (memory) {
      memory.accessed_count++;
      memory.last_accessed = Date.now();
    }
    return { success: true };
  }

  // Operations timeline
  createOperation(operation) {
    const entry = {
      id: this.data.operations.length + 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      status: 'queued',
      risk: 'low',
      approval_required: false,
      ...operation
    };
    this.data.operations.push(entry);
    return entry;
  }

  updateOperation(operationId, patch) {
    const id = parseInt(operationId, 10);
    const operation = this.data.operations.find((item) => item.id === id);
    if (!operation) {
      return null;
    }

    Object.assign(operation, patch, { updated_at: Date.now() });
    return operation;
  }

  getOperation(operationId) {
    const id = parseInt(operationId, 10);
    return this.data.operations.find((item) => item.id === id) || null;
  }

  getOperations(limit = 50, status = null) {
    const normalizedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
    const filtered = status
      ? this.data.operations.filter((item) => item.status === status)
      : this.data.operations;

    return filtered
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, normalizedLimit);
  }

  // Cleanup old data
  cleanupOldData(daysToKeep = 90) {
    const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    // Clean health scores
    Object.keys(this.data.health_scores).forEach(key => {
      if (this.data.health_scores[key].timestamp < cutoff) {
        delete this.data.health_scores[key];
      }
    });
    
    // Clean context
    this.data.context = this.data.context.filter(c => c.timestamp >= cutoff);
    
    // Clean resolved predictions
    this.data.predictions = this.data.predictions.filter(p => 
      p.created_at >= cutoff || !p.resolved
    );
    
    // Clean acknowledged insights
    this.data.insights = this.data.insights.filter(i => 
      i.created_at >= cutoff || !i.acknowledged
    );
    
    this.saveData();
    return { success: true, cutoffDate: new Date(cutoff) };
  }

  // Helper for SQL-like queries (used by tools)
  db = {
    prepare: (query) => {
      return {
        get: () => {
          // Mock SQL COUNT queries for status
          if (query.includes('COUNT(*)')) {
            if (query.includes('health_scores')) return { count: Object.keys(this.data.health_scores).length };
            if (query.includes('predictions')) return { count: this.data.predictions.filter(p => !p.resolved).length };
            if (query.includes('insights')) return { count: this.data.insights.filter(i => !i.acknowledged).length };
            if (query.includes('patterns')) return { count: this.data.patterns.length };
            if (query.includes('memory')) return { count: this.data.memory.length };
            if (query.includes('operations')) return { count: this.data.operations.length };
          }
          return { count: 0 };
        },
        run: (...args) => {
          // Mock UPDATE for insights
          if (query.includes('UPDATE insights')) {
            const insightId = args[args.length - 1];
            const insight = this.data.insights.find(i => i.id === parseInt(insightId));
            if (insight) {
              insight.acknowledged = true;
              this.saveData();
            }
          }
          return { success: true };
        }
      };
    }
  };

  close() {
    this.saveData();
  }
}

export default PMOSDatabase;
