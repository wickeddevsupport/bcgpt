/**
 * Prediction Engine
 * Generates predictions about project outcomes, deadlines, risks
 */

export class PredictionEngine {
  constructor(db, bcgptClient) {
    this.db = db;
    this.bcgpt = bcgptClient;
  }

  /**
   * Predict project completion date
   */
  async predictProjectCompletion(projectId) {
    try {
      const todos = await this.bcgpt.getTodolists(projectId);
      const allTodos = todos.flatMap(td => td.todos || []);
      
      if (allTodos.length === 0) {
        return {
          prediction: 'No todos to complete',
          confidence: 0,
          estimated_date: null
        };
      }
      
      const completedTodos = allTodos.filter(t => t.completed);
      const incompleteTodos = allTodos.filter(t => !t.completed);
      
      // Calculate velocity (todos/day)
      const completionDates = completedTodos
        .filter(t => t.completed_at)
        .map(t => new Date(t.completed_at).getTime())
        .sort((a, b) => a - b);
      
      if (completionDates.length < 3) {
        return {
          prediction: 'Insufficient data for prediction',
          confidence: 0.2,
          estimated_date: null
        };
      }
      
      const dateRange = completionDates[completionDates.length - 1] - completionDates[0];
      const daysOfActivity = dateRange / (24 * 60 * 60 * 1000);
      const velocity = completedTodos.length / Math.max(1, daysOfActivity);
      
      // Estimate remaining days
      const remainingTodos = incompleteTodos.length;
      const estimatedDaysRemaining = remainingTodos / Math.max(0.1, velocity);
      
      const estimatedCompletionDate = Date.now() + (estimatedDaysRemaining * 24 * 60 * 60 * 1000);
      
      // Calculate confidence based on data quality
      const confidence = Math.min(0.9, 
        (completedTodos.length / 20) * // More completed todos = higher confidence
        (daysOfActivity > 7 ? 1 : daysOfActivity / 7) // More history = higher confidence
      );
      
      const prediction = {
        type: 'project_completion',
        estimated_date: new Date(estimatedCompletionDate).toISOString(),
        days_remaining: Math.round(estimatedDaysRemaining),
        velocity: Math.round(velocity * 10) / 10,
        remaining_todos: remainingTodos,
        confidence
      };
      
      this.db.savePrediction(
        'project_completion',
        'project',
        projectId,
        prediction,
        confidence,
        estimatedCompletionDate
      );
      
      return prediction;
    } catch (error) {
      console.error(`Error predicting project completion: ${error.message}`);
      throw error;
    }
  }

  /**
   * Predict risk of missed deadline
   */
  async predictDeadlineRisk(projectId) {
    try {
      const project = await this.bcgpt.getProject(projectId);
      const todos = await this.bcgpt.getTodolists(projectId);
      const allTodos = todos.flatMap(td => td.todos || []);
      
      const risks = [];
      const now = Date.now();
      
      // Check todos with due dates
      const todosDue = allTodos.filter(t => !t.completed && t.due_on);
      
      for (const todo of todosDue) {
        const dueDate = new Date(todo.due_on).getTime();
        const daysUntilDue = (dueDate - now) / (24 * 60 * 60 * 1000);
        
        let risk = 'low';
        let confidence = 0.6;
        
        if (daysUntilDue < 0) {
          risk = 'overdue';
          confidence = 1.0;
        } else if (daysUntilDue < 1) {
          risk = 'critical';
          confidence = 0.9;
        } else if (daysUntilDue < 3) {
          risk = 'high';
          confidence = 0.8;
        } else if (daysUntilDue < 7) {
          risk = 'medium';
          confidence = 0.7;
        }
        
        if (risk !== 'low') {
          risks.push({
            todo_id: todo.id,
            todo_title: todo.content,
            due_date: todo.due_on,
            days_until_due: Math.round(daysUntilDue),
            risk,
            confidence
          });
        }
      }
      
      // Overall project risk
      const overallRisk = risks.length > 0 ? 
        (risks.filter(r => r.risk === 'overdue' || r.risk === 'critical').length > 0 ? 'high' : 'medium') :
        'low';
      
      const prediction = {
        type: 'deadline_risk',
        overall_risk: overallRisk,
        at_risk_items: risks.length,
        risks: risks.slice(0, 10) // Top 10
      };
      
      this.db.savePrediction(
        'deadline_risk',
        'project',
        projectId,
        prediction,
        risks.length > 0 ? 0.8 : 0.6
      );
      
      // Generate insights for high-risk items
      if (risks.length > 0) {
        const criticalCount = risks.filter(r => r.risk === 'critical' || r.risk === 'overdue').length;
        if (criticalCount > 0) {
          this.db.saveInsight(
            'deadline_risk',
            `${criticalCount} todos at critical risk`,
            `Project has ${criticalCount} todos that are overdue or due within 24 hours. Immediate action required.`,
            'high',
            true,
            { project_id: projectId, todo_ids: risks.slice(0, 5).map(r => r.todo_id) }
          );
        }
      }
      
      return prediction;
    } catch (error) {
      console.error(`Error predicting deadline risk: ${error.message}`);
      throw error;
    }
  }

  /**
   * Predict likely blockers
   */
  async predictBlockers(projectId) {
    try {
      const todos = await this.bcgpt.getTodolists(projectId);
      const allTodos = todos.flatMap(td => td.todos || []);
      const incompleteTodos = allTodos.filter(t => !t.completed);
      
      const potentialBlockers = [];
      const now = Date.now();
      
      for (const todo of incompleteTodos) {
        let blockerScore = 0;
        const reasons = [];
        
        // Old todo that hasn't been updated
        const daysSinceUpdate = (now - new Date(todo.updated_at).getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceUpdate > 7) {
          blockerScore += 0.3;
          reasons.push(`No updates in ${Math.round(daysSinceUpdate)} days`);
        }
        
        // Has assignees but no recent activity
        if (todo.assignees && todo.assignees.length > 0 && daysSinceUpdate > 3) {
          blockerScore += 0.2;
          reasons.push('Assigned but stalled');
        }
        
        // Overdue
        if (todo.due_on && new Date(todo.due_on).getTime() < now) {
          blockerScore += 0.3;
          reasons.push('Overdue');
        }
        
        // High priority marker in title
        if (todo.content && /urgent|asap|priority|critical/i.test(todo.content)) {
          blockerScore += 0.2;
          reasons.push('Priority markers in title');
        }
        
        if (blockerScore >= 0.5) {
          potentialBlockers.push({
            todo_id: todo.id,
            todo_title: todo.content,
            blocker_score: Math.round(blockerScore * 100) / 100,
            reasons,
            days_stalled: Math.round(daysSinceUpdate)
          });
        }
      }
      
      // Sort by blocker score
      potentialBlockers.sort((a, b) => b.blocker_score - a.blocker_score);
      
      const prediction = {
        type: 'potential_blockers',
        blocker_count: potentialBlockers.length,
        blockers: potentialBlockers.slice(0, 10)
      };
      
      this.db.savePrediction(
        'potential_blockers',
        'project',
        projectId,
        prediction,
        potentialBlockers.length > 0 ? 0.7 : 0.5
      );
      
      return prediction;
    } catch (error) {
      console.error(`Error predicting blockers: ${error.message}`);
      throw error;
    }
  }
}

export default PredictionEngine;
