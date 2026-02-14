/**
 * Pattern Detector
 * Detects recurring patterns in project behavior, work habits, communication
 */

export class PatternDetector {
  constructor(db, bcgptClient) {
    this.db = db;
    this.bcgpt = bcgptClient;
  }

  /**
   * Detect work patterns in a project
   */
  async detectWorkPatterns(projectId) {
    try {
      const todos = await this.bcgpt.getTodolists(projectId);
      const messages = await this.bcgpt.getMessages(projectId, { limit: 200 });
      
      const patterns = [];
      
      // Detect time-of-day patterns
      const timePattern = this.detectTimePatterns(messages, todos);
      if (timePattern) patterns.push(timePattern);
      
      // Detect day-of-week patterns
      const dayPattern = this.detectDayPatterns(messages, todos);
      if (dayPattern) patterns.push(dayPattern);
      
      // Detect completion patterns
      const completionPattern = this.detectCompletionPatterns(todos);
      if (completionPattern) patterns.push(completionPattern);
      
      // Detect communication patterns
      const commPattern = this.detectCommunicationPatterns(messages);
      if (commPattern) patterns.push(commPattern);
      
      // Save patterns to database
      for (const pattern of patterns) {
        this.db.savePattern(
          pattern.type,
          pattern.data,
          pattern.occurrences,
          pattern.confidence,
          { project_id: projectId }
        );
      }
      
      return {
        project_id: projectId,
        patterns,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Error detecting work patterns: ${error.message}`);
      throw error;
    }
  }

  detectTimePatterns(messages, todos) {
    const hours = {};
    
    // Analyze message times
    messages.forEach(msg => {
      const hour = new Date(msg.created_at).getHours();
      hours[hour] = (hours[hour] || 0) + 1;
    });
    
    // Analyze todo completion times
    todos.flatMap(td => td.todos || [])
      .filter(t => t.completed_at)
      .forEach(t => {
        const hour = new Date(t.completed_at).getHours();
        hours[hour] = (hours[hour] || 0) + 1;
      });
    
    // Find peak hours
    const sortedHours = Object.entries(hours)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    if (sortedHours.length > 0) {
      const totalActivity = Object.values(hours).reduce((a, b) => a + b, 0);
      const peakActivity = sortedHours.reduce((sum, [_, count]) => sum + count, 0);
      
      return {
        type: 'time_of_day',
        data: {
          peak_hours: sortedHours.map(([hour, count]) => ({
            hour: parseInt(hour),
            activity_count: count,
            percentage: Math.round((count / totalActivity) * 100)
          })),
          pattern: `Most active between ${sortedHours[0][0]}:00-${sortedHours[0][0]}:59`
        },
        occurrences: peakActivity,
        confidence: Math.min(0.9, peakActivity / 50)
      };
    }
    
    return null;
  }

  detectDayPatterns(messages, todos) {
    const days = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Analyze message days
    messages.forEach(msg => {
      const day = new Date(msg.created_at).getDay();
      days[day] = (days[day] || 0) + 1;
    });
    
    // Analyze todo completion days
    todos.flatMap(td => td.todos || [])
      .filter(t => t.completed_at)
      .forEach(t => {
        const day = new Date(t.completed_at).getDay();
        days[day] = (days[day] || 0) + 1;
      });
    
    const sortedDays = Object.entries(days)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    if (sortedDays.length > 0) {
      const totalActivity = Object.values(days).reduce((a, b) => a + b, 0);
      
      return {
        type: 'day_of_week',
        data: {
          peak_days: sortedDays.map(([day, count]) => ({
            day: dayNames[parseInt(day)],
            activity_count: count,
            percentage: Math.round((count / totalActivity) * 100)
          })),
          pattern: `Most active on ${dayNames[sortedDays[0][0]]}`
        },
        occurrences: totalActivity,
        confidence: 0.8
      };
    }
    
    return null;
  }

  detectCompletionPatterns(todos) {
    const allTodos = todos.flatMap(td => td.todos || []);
    const completedTodos = allTodos.filter(t => t.completed && t.completed_at && t.created_at);
    
    if (completedTodos.length < 5) return null;
    
    // Calculate time-to-completion
    const completionTimes = completedTodos.map(t => {
      const created = new Date(t.created_at).getTime();
      const completed = new Date(t.completed_at).getTime();
      return (completed - created) / (24 * 60 * 60 * 1000); // days
    });
    
    const avgCompletion = completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length;
    const medianCompletion = completionTimes.sort((a, b) => a - b)[Math.floor(completionTimes.length / 2)];
    
    return {
      type: 'completion_time',
      data: {
        average_days: Math.round(avgCompletion * 10) / 10,
        median_days: Math.round(medianCompletion * 10) / 10,
        sample_size: completionTimes.length,
        pattern: `Todos typically completed in ${Math.round(medianCompletion)} days`
      },
      occurrences: completionTimes.length,
      confidence: Math.min(0.9, completionTimes.length / 20)
    };
  }

  detectCommunicationPatterns(messages) {
    if (messages.length < 10) return null;
    
    // Analyze message frequency
    const messageDates = messages.map(m => new Date(m.created_at).toDateString());
    const dateFrequency = {};
    messageDates.forEach(d => {
      dateFrequency[d] = (dateFrequency[d] || 0) + 1;
    });
    
    const avgMessagesPerDay = messages.length / Object.keys(dateFrequency).length;
    
    // Analyze response patterns (replies)
    const conversations = messages.filter(m => m.parent_id);
    const avgResponseTime = 'N/A'; // Would need more detailed analysis
    
    return {
      type: 'communication',
      data: {
        avg_messages_per_active_day: Math.round(avgMessagesPerDay * 10) / 10,
        conversation_rate: Math.round((conversations.length / messages.length) * 100),
        total_messages: messages.length,
        pattern: `Averages ${Math.round(avgMessagesPerDay)} messages per active day`
      },
      occurrences: messages.length,
      confidence: 0.75
    };
  }

  /**
   * Detect recurring issues or blockers
   */
  async detectRecurringIssues(projectId) {
    try {
      const messages = await this.bcgpt.getMessages(projectId, { limit: 300 });
      
      // Look for issue keywords
      const issueKeywords = ['blocked', 'issue', 'problem', 'stuck', 'help', 'urgent', 'bug', 'error'];
      const issueMessages = messages.filter(m => 
        m.content && issueKeywords.some(keyword => 
          m.content.toLowerCase().includes(keyword)
        )
      );
      
      if (issueMessages.length < 3) return null;
      
      // Group by week
      const weeklyIssues = {};
      issueMessages.forEach(msg => {
        const date = new Date(msg.created_at);
        const weekKey = `${date.getFullYear()}-W${this.getWeekNumber(date)}`;
        weeklyIssues[weekKey] = (weeklyIssues[weekKey] || 0) + 1;
      });
      
      const avgIssuesPerWeek = issueMessages.length / Object.keys(weeklyIssues).length;
      
      const pattern = {
        type: 'recurring_issues',
        data: {
          total_issues: issueMessages.length,
          avg_per_week: Math.round(avgIssuesPerWeek * 10) / 10,
          weeks_with_issues: Object.keys(weeklyIssues).length,
          pattern: avgIssuesPerWeek > 2 ? 'Frequent issues detected' : 'Occasional issues'
        },
        occurrences: issueMessages.length,
        confidence: 0.7
      };
      
      this.db.savePattern(
        pattern.type,
        pattern.data,
        pattern.occurrences,
        pattern.confidence,
        { project_id: projectId }
      );
      
      // Generate insight if issues are frequent
      if (avgIssuesPerWeek > 3) {
        this.db.saveInsight(
          'recurring_pattern',
          'Frequent issues detected',
          `Project averages ${Math.round(avgIssuesPerWeek)} issue-related messages per week. Consider investigating root causes.`,
          'medium',
          true,
          { project_id: projectId, pattern: 'recurring_issues' }
        );
      }
      
      return pattern;
    } catch (error) {
      console.error(`Error detecting recurring issues: ${error.message}`);
      throw error;
    }
  }

  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
}

export default PatternDetector;
