/**
 * Context Analyzer
 * Analyzes and maintains contextual relationships between entities
 */

export class ContextAnalyzer {
  constructor(db, bcgptClient) {
    this.db = db;
    this.bcgpt = bcgptClient;
  }

  /**
   * Analyze and extract context for a project
   */
  async analyzeProjectContext(projectId) {
    try {
      const project = await this.bcgpt.getProject(projectId);
      const todos = await this.bcgpt.getTodolists(projectId);
      const messages = await this.bcgpt.getMessages(projectId, { limit: 100 });
      
      const contexts = [];
      
      // Extract people context
      const people = new Set();
      messages.forEach(m => people.add(m.creator.id));
      todos.flatMap(td => td.todos || []).forEach(t => {
        if (t.assignees) t.assignees.forEach(a => people.add(a.id));
      });
      
      contexts.push({
        type: 'people',
        data: {
          active_participants: Array.from(people),
          count: people.size
        },
        relevance: 0.9
      });
      
      // Extract timeline context
      const allTodos = todos.flatMap(td => td.todos || []);
      const upcomingDueDates = allTodos
        .filter(t => !t.completed && t.due_on)
        .map(t => ({ todo_id: t.id, due_date: t.due_on, content: t.content }))
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
        .slice(0, 10);
      
      if (upcomingDueDates.length > 0) {
        contexts.push({
          type: 'timeline',
          data: {
            upcoming_deadlines: upcomingDueDates
          },
          relevance: 0.85
        });
      }
      
      // Extract topic context from messages
      const topics = this.extractTopics(messages);
      if (topics.length > 0) {
        contexts.push({
          type: 'topics',
          data: {
            frequent_topics: topics.slice(0, 10)
          },
          relevance: 0.75
        });
      }
      
      // Extract status context
      const completionRate = allTodos.length > 0 ? 
        allTodos.filter(t => t.completed).length / allTodos.length : 0;
      
      contexts.push({
        type: 'status',
        data: {
          total_todos: allTodos.length,
          completed: allTodos.filter(t => t.completed).length,
          active: allTodos.filter(t => !t.completed).length,
          completion_rate: Math.round(completionRate * 100)
        },
        relevance: 0.8
      });
      
      // Save contexts to database
      for (const ctx of contexts) {
        this.db.saveContext('project', projectId, ctx.type, ctx.data, ctx.relevance);
      }
      
      return {
        project_id: projectId,
        contexts,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Error analyzing project context: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract topics from messages using simple keyword analysis
   */
  extractTopics(messages) {
    const keywords = {};
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them']);
    
    messages.forEach(msg => {
      if (!msg.content) return;
      
      const words = msg.content.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
      
      words.forEach(word => {
        keywords[word] = (keywords[word] || 0) + 1;
      });
    });
    
    return Object.entries(keywords)
      .sort((a, b) => b[1] - a[1])
      .map(([word, count]) => ({ word, occurrences: count }));
  }

  /**
   * Find related projects based on context similarity
   */
  async findRelatedProjects(projectId, limit = 5) {
    try {
      const projectContext = this.db.getContext('project', projectId);
      const allProjects = await this.bcgpt.getProjects();
      
      const similarities = [];
      
      for (const otherProject of allProjects) {
        if (otherProject.id === projectId) continue;
        
        const otherContext = this.db.getContext('project', otherProject.id);
        const similarity = this.calculateContextSimilarity(projectContext, otherContext);
        
        if (similarity > 0.3) {
          similarities.push({
            project_id: otherProject.id,
            project_name: otherProject.name,
            similarity: Math.round(similarity * 100) / 100
          });
        }
      }
      
      similarities.sort((a, b) => b.similarity - a.similarity);
      
      return {
        project_id: projectId,
        related_projects: similarities.slice(0, limit),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Error finding related projects: ${error.message}`);
      throw error;
    }
  }

  calculateContextSimilarity(context1, context2) {
    if (!context1 || !context2 || context1.length === 0 || context2.length === 0) {
      return 0;
    }
    
    // Simple similarity based on shared context types
    const types1 = new Set(context1.map(c => c.context_type));
    const types2 = new Set(context2.map(c => c.context_type));
    const sharedTypes = [...types1].filter(t => types2.has(t)).length;
    const totalTypes = new Set([...types1, ...types2]).size;
    
    return sharedTypes / Math.max(1, totalTypes);
  }

  /**
   * Get smart context for a query
   */
  async getSmartContext(query, entityType = null, entityId = null) {
    try {
      // Extract key terms from query
      const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
      
      const relevantContexts = [];
      
      if (entityType && entityId) {
        // Get context for specific entity
        const contexts = this.db.getContext(entityType, entityId);
        relevantContexts.push(...contexts);
      } else {
        // Search across all contexts
        // This would be more sophisticated in production
        relevantContexts.push(...this.db.getContext('project', null, 10));
      }
      
      return {
        query,
        relevant_contexts: relevantContexts.slice(0, 10),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Error getting smart context: ${error.message}`);
      throw error;
    }
  }
}

export default ContextAnalyzer;
