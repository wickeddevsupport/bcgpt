# PM OS Intelligence Patterns Library
**Reusable patterns for AI-powered project management**

Last Updated: 2026-02-14

## Overview
This document catalogs proven intelligence patterns, algorithms, and decision frameworks that power PM OS features. These patterns are **platform-agnostic** and can be applied to any project management system.

## Table of Contents
1. [Scoring & Ranking Patterns](#1-scoring--ranking-patterns)
2. [Prediction Patterns](#2-prediction-patterns)
3. [Detection Patterns](#3-detection-patterns)
4. [Optimization Patterns](#4-optimization-patterns)
5. [Agent Behavior Patterns](#5-agent-behavior-patterns)
6. [NLP Patterns](#6-nlp-patterns)
7. [Graph Patterns](#7-graph-patterns)

---

## 1. Scoring & Ranking Patterns

### Pattern 1.1: Composite Health Score
**Purpose:** Combine multiple metrics into a single 0-100 health score

**Algorithm:**
```javascript
function compositeHealthScore(metrics, weights = null) {
  // Default equal weights if not specified
  const defaultWeights = Object.keys(metrics).reduce((acc, key) => {
    acc[key] = 1.0 / Object.keys(metrics).length;
    return acc;
  }, {});
  
  const w = weights || defaultWeights;
  
  // Weighted sum
  let score = 0;
  for (const [metric, value] of Object.entries(metrics)) {
    score += value * (w[metric] || 0);
  }
  
  // Normalize to 0-100
  return Math.max(0, Math.min(100, score));
}

// Grade conversion
function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
```

**Example Usage:**
```javascript
const projectHealth = compositeHealthScore({
  velocity: 22,    // 0-25
  risk: 18,        // 0-25
  communication: 20, // 0-25
  balance: 23      // 0-25
}); // = 83 (B grade)
```

**When to Use:**
- Combining disparate metrics into single score
- Comparing entities on overall performance
- Defining health thresholds for alerts

---

### Pattern 1.2: Priority Scoring (Multi-Factor)
**Purpose:** Rank items by urgency, impact, context, and other factors

**Algorithm:**
```javascript
function priorityScore(item, context) {
  const factors = [];
  
  // Factor 1: Time pressure (0-25)
  if (item.due_date) {
    const daysUntilDue = (item.due_date - Date.now()) / (24*60*60*1000);
    const urgency = daysUntilDue < 0 ? 25 : // overdue = max
                   daysUntilDue < 1 ? 22 : // due today
                   daysUntilDue < 3 ? 18 : // due soon
                   daysUntilDue < 7 ? 12 : // due this week
                   5; // future
    factors.push({ name: 'urgency', value: urgency });
  }
  
  // Factor 2: Impact (0-25) - is it blocking others?
  const blockedCount = countBlockedItems(item);
  const impact = Math.min(25, blockedCount * 5);
  factors.push({ name: 'impact', value: impact });
  
  // Factor 3: Context efficiency (0-25) - working same project?
  const sameContext = context.currentProject === item.project_id;
  const contextScore = sameContext ? 25 : 10;
  factors.push({ name: 'context', value: contextScore });
  
  // Factor 4: Effort match (0-25) - can I finish it now?
  const availableTime = context.availableHours || 4;
  const estimatedEffort = item.effort_estimate || 2;
  const effortScore = estimatedEffort <= availableTime ? 20 : 10;
  factors.push({ name: 'effort', value: effortScore });
  
  const total = factors.reduce((sum, f) => sum + f.value, 0);
  
  return {
    score: total,
    factors: factors.reduce((acc, f) => {
      acc[f.name] = f.value;
      return acc;
    }, {}),
    reason: generateReason(factors)
  };
}

function generateReason(factors) {
  const top = factors.sort((a, b) => b.value - a.value)[0];
  const reasons = {
    urgency: "Due date approaching",
    impact: "Blocks other work",
    context: "Already working in this area",
    effort: "Can complete in available time"
  };
  return reasons[top.name];
}
```

**When to Use:**
- "What should I work on next?" queries
- Auto-assignment optimization
- Triage queue sorting

---

### Pattern 1.3: Workload Balance (Gini Coefficient)
**Purpose:** Measure inequality in workload distribution

**Algorithm:**
```javascript
function calculateGini(values) {
  // Filter out zeros and sort
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  
  // Gini formula: G = (2 * Σ(i * x[i])) / (n * Σ(x[i])) - (n + 1) / n
  let numerator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i + 1) * sorted[i]; // i+1 because 1-indexed
  }
  
  const gini = (2 * numerator) / (n * sum) - (n + 1) / n;
  return gini;
}

function analyzeWorkloadBalance(team) {
  const workloads = team.map(person => person.active_task_count);
  const gini = calculateGini(workloads);
  
  // Interpret
  let balance = 'excellent';
  if (gini > 0.4) balance = 'poor';
  else if (gini > 0.3) balance = 'fair';
  else if (gini > 0.2) balance = 'good';
  
  // Find outliers
  const mean = workloads.reduce((a, b) => a + b, 0) / workloads.length;
  const overloaded = team.filter(p => p.active_task_count > mean * 1.5);
  const underloaded = team.filter(p => p.active_task_count < mean * 0.5);
  
  return {
    gini,
    balance,
    mean_workload: mean,
    overloaded,
    underloaded,
    recommendation: gini > 0.3 ? 
      `Redistribute ${overloaded.length} overloaded people's tasks` : 
      null
  };
}
```

**When to Use:**
- Team health monitoring
- Assignment optimization
- Manager dashboards

**Interpretation:**
- Gini = 0: Perfect equality (everyone has same workload)
- Gini < 0.2: Excellent balance
- Gini 0.2-0.3: Good balance
- Gini 0.3-0.4: Fair (some imbalance)
- Gini > 0.4: Poor (high inequality, intervention needed)

---

## 2. Prediction Patterns

### Pattern 2.1: Velocity-Based Completion Prediction
**Purpose:** Predict when work will be completed based on historical velocity

**Algorithm:**
```javascript
function predictCompletion(item, person, team) {
  // 1. Calculate historical velocity
  const velocityWindow = 14; // days
  const completed = getCompletedTasks(person, velocityWindow);
  const velocity = completed.length / velocityWindow; // tasks per day
  
  // 2. Adjust for person's current load
  const currentLoad = getCurrentActiveTasks(person).length;
  const loadFactor = currentLoad > 5 ? 0.7 : // overloaded
                     currentLoad > 3 ? 1.0 : // normal
                     1.2; // light load
  
  const adjustedVelocity = velocity * loadFactor;
  
  // 3. Estimate days to complete
  const effort = item.effort_estimate || getAverageEffort(person);
  const daysToComplete = effort / adjustedVelocity;
  
  // 4. Add buffer for uncertainty
  const uncertainty = calculateUncertainty(person, item);
  const bufferedDays = daysToComplete * (1 + uncertainty);
  
  // 5. Compute predicted date
  const predictedDate = new Date(Date.now() + bufferedDays * 24*60*60*1000);
  
  // 6. Confidence interval
  const confidence = 1 - uncertainty;
  
  return {
    predicted_date: predictedDate,
    expected_days: Math.ceil(bufferedDays),
    confidence: Math.round(confidence * 100),
    velocity: adjustedVelocity,
    factors: {
      historical_velocity: velocity,
      load_factor: loadFactor,
      uncertainty: uncertainty
    }
  };
}

function calculateUncertainty(person, item) {
  let uncertainty = 0.2; // baseline 20%
  
  // Increase for novel work
  const similarTasks = findSimilarTasks(person, item);
  if (similarTasks.length < 3) uncertainty += 0.2;
  
  // Increase for complex items
  if (item.effort_estimate > 8) uncertainty += 0.15;
  
  // Decrease for experienced person
  const experience = person.completed_task_count || 0;
  if (experience > 100) uncertainty -= 0.1;
  
  return Math.min(0.5, Math.max(0.1, uncertainty));
}
```

**When to Use:**
- "When will this be done?" queries
- Deadline risk assessment
- Sprint planning

**Accuracy Factors:**
- Historical data: More past completions = better predictions
- Load awareness: Current workload affects capacity
- Uncertainty quantification: Complex/novel work has wider confidence intervals

---

### Pattern 2.2: Burnout Risk Scoring
**Purpose:** Detect early warning signs of team member burnout

**Algorithm:**
```javascript
function assessBurnoutRisk(person, period = 21) { // 3 weeks
  const signals = [];
  let riskScore = 0; // 0-100
  
  // Signal 1: Sustained overload (40%)
  const avgLoad = getAverageWorkload(person, period);
  const capacity = person.capacity || 100;
  if (avgLoad > capacity * 1.2) {
    riskScore += 40;
    signals.push({
      type: 'overload',
      severity: 'high',
      description: `${Math.round(avgLoad/capacity*100)}% capacity for ${period} days`,
      contribution: 40
    });
  } else if (avgLoad > capacity * 1.1) {
    riskScore += 25;
    signals.push({
      type: 'overload',
      severity: 'medium',
      description: `${Math.round(avgLoad/capacity*100)}% capacity`,
      contribution: 25
    });
  }
  
  // Signal 2: Velocity decline (25%)
  const currentVelocity = getVelocity(person, 7);
  const historicalVelocity = getVelocity(person, 90);
  const velocityRatio = currentVelocity / historicalVelocity;
  if (velocityRatio < 0.6) {
    riskScore += 25;
    signals.push({
      type: 'velocity_decline',
      severity: 'high',
      description: `Velocity dropped to ${Math.round(velocityRatio*100)}% of average`,
      contribution: 25
    });
  }
  
  // Signal 3: Communication changes (20%)
  const recentMessages = countMessages(person, 7);
  const historicalMessages = countMessages(person, 90) / (90/7);
  if (recentMessages < historicalMessages * 0.5) {
    riskScore += 15;
    signals.push({
      type: 'withdrawal',
      severity: 'medium',
      description: 'Communication frequency dropped 50%',
      contribution: 15
    });
  }
  
  // Check sentiment
  const sentiment = analyzeSentiment(person, 7);
  if (sentiment < -0.3) { // negative
    riskScore += 5;
    signals.push({
      type: 'negative_sentiment',
      severity: 'low',
      description: 'Recent communication tone is negative',
      contribution: 5
    });
  }
  
  // Signal 4: Working hours pattern (15%)
  const offHoursWork = detectOffHoursActivity(person, 14);
  if (offHoursWork > 0.3) { // 30% of work outside normal hours
    riskScore += 15;
    signals.push({
      type: 'unsustainable_hours',
      severity: 'high',
      description: '30% of activity outside normal working hours',
      contribution: 15
    });
  }
  
  // Risk level
  const level = riskScore > 60 ? 'critical' :
                riskScore > 40 ? 'high' :
                riskScore > 20 ? 'medium' : 'low';
  
  return {
    risk_score: Math.min(100, riskScore),
    risk_level: level,
    signals,
    recommendations: generateBurnoutRecommendations(signals, person),
    urgent: level === 'critical'
  };
}

function generateBurnoutRecommendations(signals, person) {
  const recs = [];
  
  if (signals.some(s => s.type === 'overload')) {
    recs.push({
      action: 'redistribute_workload',
      description: `Redistribute ${person.name}'s tasks to team members with capacity`,
      priority: 'high'
    });
  }
  
  if (signals.some(s => s.type === 'velocity_decline')) {
    recs.push({
      action: 'check_in',
      description: `Schedule 1-on-1 with ${person.name} to discuss challenges`,
      priority: 'high'
    });
  }
  
  if (signals.some(s => s.type === 'unsustainable_hours')) {
    recs.push({
      action: 'enforce_boundaries',
      description: `Set expectation for ${person.name} to disconnect after hours`,
      priority: 'medium'
    });
  }
  
  return recs;
}
```

**When to Use:**
- Weekly team health checks
- Manager dashboards
- Proactive intervention triggers

**Thresholds:**
- 0-20: Low risk (normal variation)
- 21-40: Medium risk (watch closely)
- 41-60: High risk (intervention recommended)
- 61+: Critical risk (immediate action required)

---

### Pattern 2.3: Scope Creep Detection
**Purpose:** Identify projects with expanding scope

**Algorithm:**
```javascript
function detectScopeCreep(project, baseline_date) {
  // Get tasks at baseline vs. now
  const baselineTasks = getTasksAtDate(project, baseline_date);
  const currentTasks = getCurrentTasks(project);
  
  const added = currentTasks.filter(t => 
    t.created_at > baseline_date
  );
  const removed = baselineTasks.filter(bt => 
    !currentTasks.some(ct => ct.id === bt.id)
  );
  
  // Metrics
  const creepIndex = added.length / (baselineTasks.length || 1);
  const churnRate = removed.length / (baselineTasks.length || 1);
  const netChange = (added.length - removed.length) / (baselineTasks.length || 1);
  
  // Severity
  let severity = 'none';
  if (netChange > 0.5) severity = 'critical'; // 50%+ growth
  else if (netChange > 0.3) severity = 'high'; // 30-50% growth
  else if (netChange > 0.15) severity = 'medium'; // 15-30% growth
  else if (netChange > 0.05) severity = 'low'; // 5-15% growth
  
  // Analysis
  const analysis = {
    baseline_count: baselineTasks.length,
    current_count: currentTasks.length,
    added_count: added.length,
    removed_count: removed.length,
    net_change: netChange,
    creep_index: creepIndex,
    churn_rate: churnRate,
    severity,
    causes: identifyCreepCauses(added, project)
  };
  
  return analysis;
}

function identifyCreepCauses(addedTasks, project) {
  const causes = [];
  
  // Cause 1: New features
  const newFeatures = addedTasks.filter(t => 
    t.description?.includes?.('new feature') ||
    t.description?.includes?.('enhancement')
  );
  if (newFeatures.length > 0) {
    causes.push({
      type: 'feature_additions',
      count: newFeatures.length,
      impact: 'high'
    });
  }
  
  // Cause 2: Bug fixes (technical debt)
  const bugs = addedTasks.filter(t =>
    t.description?.match?.(/bug|fix|issue|defect/i)
  );
  if (bugs.length > 0) {
    causes.push({
      type: 'technical_debt',
      count: bugs.length,
      impact: 'medium'
    });
  }
  
  // Cause 3: External requests
  const clientRequested = addedTasks.filter(t =>
    t.creator?.type === 'client' ||
    t.description?.match?.(/client request|customer|stakeholder/i)
  );
  if (clientRequested.length > 0) {
    causes.push({
      type: 'external_requests',
      count: clientRequested.length,
      impact: 'high'
    });
  }
  
  return causes;
}
```

**When to Use:**
- Project health monitoring
- Retrospective analysis
- Stakeholder reporting

---

## 3. Detection Patterns

### Pattern 3.1: Bottleneck Detection
**Purpose:** Identify constraints in workflow

**Algorithm:**
```javascript
function detectBottlenecks(project, threshold_days = 3) {
  const bottlenecks = [];
  
  // Method 1: Stage analysis (for card tables)
  const boards = getBoards(project);
  for (const board of boards) {
    const columns = board.columns;
    for (const column of columns) {
      const cards = column.cards;
      const avgDwellTime = calculateAverageDwellTime(cards, column);
      
      if (avgDwellTime > threshold_days) {
        bottlenecks.push({
          type: 'stage_bottleneck',
          location: `${board.name} → ${column.name}`,
          avg_dwell_time: avgDwellTime,
          stalled_items: cards.filter(c => 
            getDwellTime(c, column) > threshold_days
          ).length,
          severity: avgDwellTime > 7 ? 'high' : 'medium'
        });
      }
    }
  }
  
  // Method 2: Person analysis
  const people = getProjectPeople(project);
  for (const person of people) {
    const assignedTasks = getTasksAssignedTo(person, project);
    const staleTasks = assignedTasks.filter(t => {
      const lastActivity = getLastActivity(t);
      return (Date.now() - lastActivity) > threshold_days * 24*60*60*1000;
    });
    
    if (staleTasks.length > 3) {
      bottlenecks.push({
        type: 'person_bottleneck',
        person: person.name,
        stalled_count: staleTasks.length,
        possible_causes: diagnoseCauses(person, assignedTasks),
        severity: staleTasks.length > 5 ? 'high' : 'medium'
      });
    }
  }
  
  // Method 3: Dependency analysis
  const blockedTasks = getBlockedTasks(project);
  const blockingTasks = getBlockingTasks(project);
  
  for (const task of blockingTasks) {
    const blockedCount = countTasksBlockedBy(task);
    if (blockedCount > 2) {
      bottlenecks.push({
        type: 'dependency_bottleneck',
        task: task.title,
        blocking_count: blockedCount,
        assignee: task.assignees?.[0]?.name,
        severity: blockedCount > 5 ? 'high' : 'medium'
      });
    }
  }
  
  return {
    bottlenecks,
    total_impact: calculateImpact(bottlenecks),
    recommendations: generateBottleneckRecommendations(bottlenecks)
  };
}

function diagnoseCauses(person, tasks) {
  const causes = [];
  
  // Overload?
  if (tasks.length > 8) {
    causes.push({
      cause: 'overload',
      description: `${person.name} has ${tasks.length} active tasks`,
      confidence: 0.8
    });
  }
  
  // Blocking on others?
  const blockedCount = tasks.filter(t => isBlocked(t)).length;
  if (blockedCount > tasks.length * 0.4) {
    causes.push({
      cause: 'blocked_dependency',
      description: `${blockedCount} tasks waiting on others`,
      confidence: 0.9
    });
  }
  
  // Skill mismatch?
  const unfamiliarTasks = tasks.filter(t => 
    !personHasSkill(person, inferSkill(t))
  );
  if (unfamiliarTasks.length > tasks.length * 0.5) {
    causes.push({
      cause: 'skill_mismatch',
      description: `${unfamiliarTasks.length} tasks outside expertise`,
      confidence: 0.6
    });
  }
  
  return causes;
}
```

**When to Use:**
- Daily standups (automated)
- Sprint retrospectives
- Process improvement initiatives

---

*(Continue with 40+ more patterns...)*

## 4. Optimization Patterns

### Pattern 4.1: Assignment Optimization
**Purpose:** Find optimal task assignments considering skills, load, and context

**Algorithm:**
```javascript
function optimizeAssignments(tasks, team, constraints = {}) {
  // Build cost matrix: task × person
  const costMatrix = [];
  
  for (const task of tasks) {
    const row = [];
    for (const person of team) {
      const cost = calculateAssignmentCost(task, person, constraints);
      row.push(cost);
    }
    costMatrix.push(row);
  }
  
  // Solve assignment problem (Hungarian algorithm or greedy)
  const assignments = solveAssignment(costMatrix, tasks, team);
  
  return {
    assignments,
    total_cost: calculateTotalCost(assignments),
    balance_score: calculateBalance(assignments, team),
    estimated_completion: estimateCompletion(assignments)
  };
}

function calculateAssignmentCost(task, person, constraints) {
  let cost = 100; // start high, reduce for good fits
  
  // Factor 1: Skill match (0-40 reduction)
  const requiredSkills = inferSkills(task);
  const skillMatch = requiredSkills.filter(s => 
    person.skills?.includes(s)
  ).length / requiredSkills.length;
  cost -= skillMatch * 40;
  
  // Factor 2: Current load (0-30 reduction)
  const currentLoad = person.currentLoad || 0;
  const capacity = person.capacity || 100;
  const loadScore = 1 - (currentLoad / capacity);
  cost -= loadScore * 30;
  
  // Factor 3: Context (0-20 reduction)
  const sameProject = person.activeProjects?.includes(task.project_id);
  if (sameProject) cost -= 20;
  
  // Factor 4: Historical performance (0-10 reduction)
  const successRate = getSuccessRate(person, task.type);
  cost -= successRate * 10;
  
  // Constraints
  if (constraints.must_assign?.[task.id] === person.id) {
    cost = 0; // forced assignment
  }
  if (constraints.avoid?.[task.id]?.includes(person.id)) {
    cost = 999; // avoid this assignment
  }
  
  return Math.max(0, cost);
}
```

**When to Use:**
- Sprint planning
- "Who should work on this?" queries
- Load balancing

---

## 5. Agent Behavior Patterns

### Pattern 5.1: Observe-Analyze-Decide-Act (OADA Loop)
**Purpose:** Standard agent reasoning cycle

**Algorithm:**
```javascript
class AgentOADALoop {
  async run() {
    while (this.active) {
      // 1. OBSERVE
      const observations = await this.observe();
      
      // 2. ANALYZE
      const analysis = await this.analyze(observations);
      
      // 3. DECIDE
      const decisions = await this.decide(analysis);
      
      // 4. ACT
      const results = await this.act(decisions);
      
      // 5. LEARN
      await this.learn(decisions, results);
      
      // Wait before next cycle
      await this.sleep(this.interval);
    }
  }
  
  async observe() {
    // Collect relevant events
    return {
      new_tasks: await this.getNewTasks(this.lastCheckTime),
      changed_tasks: await this.getChangedTasks(this.lastCheckTime),
      new_messages: await this.getNewMessages(this.lastCheckTime),
      deadlines_approaching: await this.getApproachingDeadlines(3), // 3 days
      stalled_items: await this.getStalledItems(7) // 7 days no activity
    };
  }
  
  async analyze(observations) {
    const insights = [];
    
    // Pattern: Overdue without activity
    for (const task of observations.deadlines_approaching) {
      if (this.hasNoRecentActivity(task, 2)) { // 2 days
        insights.push({
          type: 'at_risk',
          entity: task,
          reason: 'Due soon but no recent activity',
          urgency: 'high'
        });
      }
    }
    
    // Pattern: Unassigned new tasks
    const unassigned = observations.new_tasks.filter(t => !t.assignees?.length);
    if (unassigned.length > 0) {
      insights.push({
        type: 'needs_triage',
        entities: unassigned,
        reason: 'New tasks created without assignees',
        urgency: 'medium'
      });
    }
    
    return insights;
  }
  
  async decide(insights) {
    const decisions = [];
    
    for (const insight of insights) {
      // Decision rules based on agent role
      if (this.role === 'pm' && insight.type === 'at_risk') {
        decisions.push({
          action: 'send_reminder',
          target: insight.entity.assignees,
          message: this.generateReminderMessage(insight.entity)
        });
      }
      
      if (this.role === 'triage' && insight.type === 'needs_triage') {
        for (const task of insight.entities) {
          const suggestedAssignee = await this.suggestAssignee(task);
          decisions.push({
            action: 'suggest_assignment',
            task: task.id,
            assignee: suggestedAssignee,
            confidence: suggestedAssignee.confidence
          });
        }
      }
    }
    
    return decisions;
  }
  
  async act(decisions) {
    const results = [];
    
    for (const decision of decisions) {
      if (decision.action === 'send_reminder') {
        // Post a message
        const result = await this.postMessage(
          decision.target.project_id,
          decision.message
        );
        results.push({ decision, result, success: true });
      }
      
      if (decision.action === 'suggest_assignment') {
        // Create a comment with suggestion
        const result = await this.createComment(
          decision.task,
          `Suggested assignee: ${decision.assignee.name} (${decision.confidence}% confidence)`
        );
        results.push({ decision, result, success: true });
      }
    }
    
    return results;
  }
  
  async learn(decisions, results) {
    // Store outcomes for future learning
    for (const result of results) {
      await this.memory.store({
        decision: result.decision,
        outcome: result.success,
        timestamp: Date.now()
      });
    }
    
    // Update success rates
    if (this.memory.size() > 100) {
      await this.updateSuccessRates();
    }
  }
}
```

**When to Use:**
- Any autonomous agent implementation
- Background monitoring tasks
- Proactive assistance

---

### Pattern 5.2: Multi-Agent Coordination
**Purpose:** Multiple agents working together

**Algorithm:**
```javascript
class AgentCoordinator {
  constructor() {
    this.agents = new Map();
    this.eventBus = new EventEmitter();
    this.sharedMemory = new SharedMemory();
  }
  
  registerAgent(agent) {
    this.agents.set(agent.id, agent);
    
    // Subscribe agent to relevant events
    agent.interests.forEach(eventType => {
      this.eventBus.on(eventType, (event) => {
        agent.notify(event);
      });
    });
  }
  
  async coordinateAction(action, originAgent) {
    // Broadcast intent
    this.eventBus.emit('action_proposed', {
      agent: originAgent.id,
      action,
      timestamp: Date.now()
    });
    
    // Wait for objections (100ms window)
    await this.sleep(100);
    
    const objections = await this.sharedMemory.get(`objections:${action.id}`);
    
    if (objections.length > 0) {
      // Conflict resolution
      return await this.resolveConflict(action, objections);
    }
    
    // No conflicts, proceed
    const result = await originAgent.execute(action);
    
    // Broadcast result
    this.eventBus.emit('action_completed', {
      agent: originAgent.id,
      action,
      result,
      timestamp: Date.now()
    });
    
    return result;
  }
  
  async resolveConflict(action, objections) {
    // Priority-based resolution
    const priorities = {
      'pm': 10,
      'quality': 8,
      'triage': 6,
      'client': 9
    };
    
    const originAgent = this.agents.get(action.agent_id);
    const originPriority = priorities[originAgent.role] || 5;
    
    for (const objection of objections) {
      const objector = this.agents.get(objection.agent_id);
      const objectorPriority = priorities[objector.role] || 5;
      
      if (objectorPriority > originPriority) {
        // Higher priority agent blocks action
        return {
          status: 'blocked',
          reason: objection.reason,
          by: objector.role
        };
      }
    }
    
    // Origin agent has highest priority, proceed
    return await originAgent.execute(action);
  }
}
```

**When to Use:**
- Multiple agent types active
- Complex workflows requiring collaboration
- Conflict-prone scenarios (multiple agents might try to act on same entity)

---

## 6. NLP Patterns

### Pattern 6.1: Intent Classification
**Purpose:** Determine what the user wants to do

**Algorithm:**
```javascript
const INTENT_PATTERNS = {
  query: {
    patterns: [/^(show|list|get|find|what|who|when|where)/, /\?$/],
    examples: ['show me todos', 'what projects are at risk?']
  },
  create: {
    patterns: [/^create/, /^add/, /^new/, /^make/],
    examples: ['create a task', 'add Sarah to the project']
  },
  update: {
    patterns: [/^update/, /^change/, /^modify/, /^set/, /^move/],
    examples: ['update the deadline', 'move this card to Done']
  },
  delete: {
    patterns: [/^delete/, /^remove/, /^trash/],
    examples: ['delete this task', 'remove Mike from the project']
  },
  analyze: {
    patterns: [/^analyze/, /^report/, /^summarize/, /^explain/],
    examples: ['analyze project health', 'report on velocity']
  }
};

function classifyIntent(query) {
  const normalized = query.toLowerCase().trim();
  
  for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(normalized)) {
        return {
          intent,
          confidence: 0.9,
          matched_pattern: pattern.toString()
        };
      }
    }
  }
  
  // LLM fallback for ambiguous
  return await classifyWithLLM(query);
}
```

**When to Use:**
- Natural language interface
- Query routing
- Command parsing

---

## 7. Graph Patterns

### Pattern 7.1: Dependency Graph & Critical Path
**Purpose:** Find the longest chain of dependencies

**Algorithm:**
```javascript
class DependencyGraph {
  constructor(tasks) {
    this.nodes = new Map();
    this.edges = [];
    
    // Build graph
    for (const task of tasks) {
      this.nodes.set(task.id, task);
      
      const deps = this.extractDependencies(task);
      for (const depId of deps) {
        this.edges.push({ from: depId, to: task.id });
      }
    }
  }
  
  extractDependencies(task) {
    const deps = [];
    
    // Explicit dependencies (if stored)
    if (task.depends_on) {
      deps.push(...task.depends_on);
    }
    
    // Implicit from description
    const mentions = task.description?.match(/#\d+/g) || [];
    deps.push(...mentions.map(m => m.substring(1)));
    
    // Implicit from "after X" language
    const afterMatch = task.description?.match(/after (task|item) #?(\d+)/i);
    if (afterMatch) {
      deps.push(afterMatch[2]);
    }
    
    return deps;
  }
  
  findCriticalPath() {
    // Topological sort + longest path
    const sorted = this.topologicalSort();
    const distances = new Map();
    
    // Initialize
    for (const node of sorted) {
      distances.set(node, 0);
    }
    
    // Calculate longest path
    for (const node of sorted) {
      const nodeDistance = distances.get(node);
      const task = this.nodes.get(node);
      const effort = task.effort_estimate || 1;
      
      // Update successors
      const successors = this.edges.filter(e => e.from === node);
      for (const edge of successors) {
        const newDistance = nodeDistance + effort;
        if (newDistance > distances.get(edge.to)) {
          distances.set(edge.to, newDistance);
        }
      }
    }
    
    // Find the path
    const endNodes = sorted.filter(node => 
      !this.edges.some(e => e.from === node)
    );
    const maxDistance = Math.max(...endNodes.map(n => distances.get(n)));
    const criticalEnd = endNodes.find(n => distances.get(n) === maxDistance);
    
    // Backtrack to build path
    const path = this.backtrackPath(criticalEnd, distances);
    
    return {
      path: path.map(id => this.nodes.get(id)),
      total_duration: maxDistance,
      critical_tasks: path
    };
  }
  
  topologicalSort() {
    const inDegree = new Map();
    const queue = [];
    const result = [];
    
    // Calculate in-degrees
    for (const node of this.nodes.keys()) {
      inDegree.set(node, 0);
    }
    for (const edge of this.edges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
    
    // Start with nodes that have no dependencies
    for (const [node, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(node);
    }
    
    // Process
    while (queue.length > 0) {
      const node = queue.shift();
      result.push(node);
      
      // Reduce in-degree for successors
      const successors = this.edges.filter(e => e.from === node);
      for (const edge of successors) {
        const newDegree = inDegree.get(edge.to) - 1;
        inDegree.set(edge.to, newDegree);
        if (newDegree === 0) queue.push(edge.to);
      }
    }
    
    return result;
  }
}
```

**When to Use:**
- Project planning
- Schedule optimization
- "What's blocking what?" queries

---

## Pattern Index

| Pattern | Category | Use Case | Complexity |
|---------|----------|----------|------------|
| Composite Health Score | Scoring | Combining metrics | Low |
| Priority Scoring | Ranking | Task prioritization | Medium |
| Gini Coefficient | Balance | Workload distribution | Low |
| Velocity Prediction | Prediction | Completion dates | Medium |
| Burnout Detection | Detection | Team health | High |
| Scope Creep Detection | Detection | Project monitoring | Medium |
| Bottleneck Detection | Detection | Process optimization | High |
| Assignment Optimization | Optimization | Resource allocation | High |
| OADA Loop | Agent | Autonomous behavior | Medium |
| Multi-Agent Coordination | Agent | Collaboration | High |
| Intent Classification | NLP | Query understanding | Low |
| Dependency Graph | Graph | Critical path | Medium |

---

**This library grows with every implementation. Document new patterns here.**
