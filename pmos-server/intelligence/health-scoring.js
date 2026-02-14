/**
 * Health Scoring Engine
 * Calculates health scores for projects, todos, people, and teams
 */

import { config } from '../config.js';

export class HealthScorer {
  constructor(db, bcgptClient) {
    this.db = db;
    this.bcgpt = bcgptClient;
    this.weights = config.intelligence.healthScoring.factors;
  }

  /**
   * Calculate health score for a project
   */
  async calculateProjectHealth(projectId) {
    try {
      // Fetch project data from BCGPT
      const project = await this.bcgpt.getProject(projectId);
      const todos = await this.bcgpt.getTodolists(projectId);
      const messages = await this.bcgpt.getMessages(projectId, { limit: 100 });
      
      // Calculate individual factors
      const activityScore = this.calculateActivityScore(messages, todos);
      const velocityScore = this.calculateVelocityScore(todos);
      const completionScore = this.calculateCompletionScore(todos);
      const communicationScore = this.calculateCommunicationScore(messages);
      
      // Weighted total
      const totalScore = 
        (activityScore * this.weights.activity) +
        (velocityScore * this.weights.velocity) +
        (completionScore * this.weights.completion) +
        (communicationScore * this.weights.communication);
      
      const factors = {
        activity: activityScore,
        velocity: velocityScore,
        completion: completionScore,
        communication: communicationScore
      };
      
      // Save to database
      this.db.saveHealthScore('project', projectId, totalScore, factors);
      
      // Generate insight if score is concerning
      if (totalScore < 0.5) {
        this.db.saveInsight(
          'health_score',
          `Project ${project.name} health is low`,
          `Health score of ${Math.round(totalScore * 100)}% indicates potential issues. ` +
          `Activity: ${Math.round(activityScore * 100)}%, ` +
          `Velocity: ${Math.round(velocityScore * 100)}%, ` +
          `Completion: ${Math.round(completionScore * 100)}%, ` +
          `Communication: ${Math.round(communicationScore * 100)}%`,
          totalScore < 0.3 ? 'high' : 'medium',
          true,
          { project_id: projectId }
        );
      }
      
      return {
        score: totalScore,
        factors,
        status: this.getHealthStatus(totalScore),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Error calculating project health: ${error.message}`);
      throw error;
    }
  }

  calculateActivityScore(messages, todos) {
    // Recent activity (last 7 days)
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const recentMessages = messages.filter(m => new Date(m.created_at).getTime() > sevenDaysAgo);
    const recentTodoChanges = todos.flatMap(td => td.todos || [])
      .filter(t => new Date(t.updated_at).getTime() > sevenDaysAgo);
    
    const totalActivity = recentMessages.length + recentTodoChanges.length;
    
    // Score based on activity level (0-1)
    if (totalActivity >= 20) return 1.0;
    if (totalActivity >= 10) return 0.8;
    if (totalActivity >= 5) return 0.6;
    if (totalActivity >= 2) return 0.4;
    if (totalActivity >= 1) return 0.2;
    return 0.0;
  }

  calculateVelocityScore(todos) {
    // Completion velocity (todos completed per week)
    const allTodos = todos.flatMap(td => td.todos || []);
    const completedTodos = allTodos.filter(t => t.completed);
    
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentCompletions = completedTodos.filter(t => 
      t.completed_at && new Date(t.completed_at).getTime() > thirtyDaysAgo
    );
    
    const weeksInPeriod = 4;
    const completionsPerWeek = recentCompletions.length / weeksInPeriod;
    
    // Score based on velocity (0-1)
    if (completionsPerWeek >= 10) return 1.0;
    if (completionsPerWeek >= 5) return 0.8;
    if (completionsPerWeek >= 3) return 0.6;
    if (completionsPerWeek >= 1) return 0.4;
    if (completionsPerWeek > 0) return 0.2;
    return 0.0;
  }

  calculateCompletionScore(todos) {
    // Completion ratio
    const allTodos = todos.flatMap(td => td.todos || []);
    if (allTodos.length === 0) return 0.5; // Neutral if no todos
    
    const completedCount = allTodos.filter(t => t.completed).length;
    const completionRatio = completedCount / allTodos.length;
    
    // Factor in overdue todos
    const now = Date.now();
    const overdueTodos = allTodos.filter(t => 
      !t.completed && t.due_on && new Date(t.due_on).getTime() < now
    );
    const overdueRatio = overdueTodos.length / allTodos.length;
    
    // Penalize for overdue
    const adjustedScore = completionRatio - (overdueRatio * 0.3);
    return Math.max(0, Math.min(1, adjustedScore));
  }

  calculateCommunicationScore(messages) {
    // Communication activity and distribution
    if (messages.length === 0) return 0.3;
    
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const recentMessages = messages.filter(m => 
      new Date(m.created_at).getTime() > sevenDaysAgo
    );
    
    // Score based on message frequency
    if (recentMessages.length >= 15) return 1.0;
    if (recentMessages.length >= 10) return 0.8;
    if (recentMessages.length >= 5) return 0.6;
    if (recentMessages.length >= 2) return 0.4;
    if (recentMessages.length >= 1) return 0.2;
    return 0.0;
  }

  getHealthStatus(score) {
    if (score >= 0.8) return 'excellent';
    if (score >= 0.6) return 'good';
    if (score >= 0.4) return 'fair';
    if (score >= 0.2) return 'poor';
    return 'critical';
  }

  /**
   * Calculate health score for a person
   */
  async calculatePersonHealth(personId) {
    try {
      const person = await this.bcgpt.getPerson(personId);
      const assignments = await this.bcgpt.getPersonAssignments(personId);
      
      // Calculate workload score
      const activeAssignments = assignments.filter(a => !a.completed);
      const workloadScore = this.calculateWorkloadScore(activeAssignments);
      
      // Calculate responsiveness score (based on message activity)
      const responsivenessScore = 0.7; // Placeholder - would need message data
      
      // Calculate completion rate
      const completionRate = assignments.filter(a => a.completed).length / Math.max(1, assignments.length);
      
      const totalScore = (workloadScore * 0.4) + (responsivenessScore * 0.3) + (completionRate * 0.3);
      
      const factors = {
        workload: workloadScore,
        responsiveness: responsivenessScore,
        completion: completionRate
      };
      
      this.db.saveHealthScore('person', personId, totalScore, factors);
      
      return {
        score: totalScore,
        factors,
        status: this.getHealthStatus(totalScore),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Error calculating person health: ${error.message}`);
      throw error;
    }
  }

  calculateWorkloadScore(assignments) {
    // Score based on workload (inverted - lower is better)
    const count = assignments.length;
    
    if (count === 0) return 0.5; // No work is neutral
    if (count <= 3) return 1.0; // Manageable
    if (count <= 6) return 0.8;
    if (count <= 10) return 0.6;
    if (count <= 15) return 0.4;
    return 0.2; // Overloaded
  }
}

export default HealthScorer;
