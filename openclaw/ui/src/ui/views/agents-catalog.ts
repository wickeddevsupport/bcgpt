import { html, nothing, type TemplateResult } from "lit";

export type AgentArchetypeDivision =
  | "engineering"
  | "design"
  | "product"
  | "marketing"
  | "sales"
  | "project-management"
  | "testing"
  | "support"
  | "specialized";

export type ModelTier = "fast" | "balanced" | "reasoning";
export type AgentToolsProfile = "coding" | "messaging" | "full";

export type AgentArchetype = {
  id: string;
  name: string;
  emoji: string;
  division: AgentArchetypeDivision;
  shortDescription: string;
  theme: string;
  modelTier: ModelTier;
  recommendedSkills: string[];
  toolsProfile: AgentToolsProfile;
  sourcePath: string;
  keywords?: string[];
  featured?: boolean;
};

export type DivisionMeta = {
  id: AgentArchetypeDivision;
  label: string;
  emoji: string;
  countHint?: string;
};

export const DIVISION_META: DivisionMeta[] = [
  { id: "engineering", label: "Engineering", emoji: "💻", countHint: "12 roles" },
  { id: "design", label: "Design", emoji: "🎨", countHint: "6 roles" },
  { id: "product", label: "Product", emoji: "📦", countHint: "5 roles" },
  { id: "marketing", label: "Marketing", emoji: "📣", countHint: "4 roles" },
  { id: "sales", label: "Sales", emoji: "💼", countHint: "7 roles" },
  { id: "project-management", label: "Project Mgmt", emoji: "📋", countHint: "2 roles" },
  { id: "testing", label: "Testing", emoji: "🧪", countHint: "5 roles" },
  { id: "support", label: "Support", emoji: "🛟", countHint: "2 roles" },
  { id: "specialized", label: "Specialized", emoji: "🔧", countHint: "4 roles" },
];

const RAW_ARCHETYPE_BASE_URL =
  "https://raw.githubusercontent.com/msitarzewski/agency-agents/main";
const FRONTMATTER_RE = /^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/;
const soulCache = new Map<string, string>();
const soulRequests = new Map<string, Promise<string>>();

function toolsProfileLabel(profile: AgentToolsProfile): string {
  switch (profile) {
    case "coding":
      return "Build + tools";
    case "full":
      return "Autonomous";
    default:
      return "Interactive";
  }
}

function tierLabel(tier: ModelTier): string {
  switch (tier) {
    case "fast":
      return "Fast";
    case "reasoning":
      return "Reasoning";
    default:
      return "Balanced";
  }
}

function tierTone(tier: ModelTier): string {
  switch (tier) {
    case "fast":
      return "#16a34a";
    case "reasoning":
      return "#ea580c";
    default:
      return "#2563eb";
  }
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, "").trim();
}

export function getDivisionMeta(id: AgentArchetypeDivision): DivisionMeta {
  return DIVISION_META.find((division) => division.id === id) ?? {
    id,
    label: id,
    emoji: "•",
  };
}

export function getArchetypeById(id: string | null | undefined): AgentArchetype | null {
  if (!id) {
    return null;
  }
  return AGENT_ARCHETYPES.find((archetype) => archetype.id === id) ?? null;
}

export function buildFallbackSoul(archetype: AgentArchetype): string {
  const division = getDivisionMeta(archetype.division);
  const skillLine =
    archetype.recommendedSkills.length > 0
      ? archetype.recommendedSkills.join(", ")
      : "none";
  return [
    `You are ${archetype.name}.`,
    "",
    "## Core Mission",
    archetype.shortDescription,
    "",
    "## Operating Context",
    `Division: ${division.label}.`,
    `Focus area: ${archetype.theme}.`,
    `Preferred runtime profile: ${toolsProfileLabel(archetype.toolsProfile)}.`,
    `Recommended model tier: ${tierLabel(archetype.modelTier)}.`,
    `Recommended skills: ${skillLine}.`,
    "",
    "## Working Style",
    "- Clarify the user's goal before proposing output.",
    "- Be explicit about trade-offs, risks, and assumptions.",
    "- Produce concrete deliverables that can be executed immediately.",
    "- Stay aligned with the selected persona and division expertise.",
  ].join("\n");
}

export async function loadArchetypeSoul(archetype: AgentArchetype): Promise<string> {
  const cached = soulCache.get(archetype.id);
  if (cached) {
    return cached;
  }
  const existing = soulRequests.get(archetype.id);
  if (existing) {
    return existing;
  }
  const request = (async () => {
    const response = await fetch(`${RAW_ARCHETYPE_BASE_URL}/${archetype.sourcePath}`);
    if (!response.ok) {
      throw new Error(`Failed to load persona (${response.status})`);
    }
    const markdown = stripFrontmatter(await response.text());
    const content = markdown || buildFallbackSoul(archetype);
    soulCache.set(archetype.id, content);
    return content;
  })().finally(() => {
    soulRequests.delete(archetype.id);
  });
  soulRequests.set(archetype.id, request);
  return request;
}

export const AGENT_ARCHETYPES: AgentArchetype[] = [
  {
    id: "engineering-frontend-developer",
    name: "Frontend Developer",
    emoji: "🖥️",
    division: "engineering",
    shortDescription: "Builds responsive, accessible web apps with pixel-perfect precision.",
    theme: "frontend engineering and UI implementation",
    modelTier: "reasoning",
    recommendedSkills: ["github", "terminal"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-frontend-developer.md",
    keywords: ["react", "css", "accessibility", "responsive"],
    featured: true,
  },
  {
    id: "engineering-backend-architect",
    name: "Backend Architect",
    emoji: "🏗️",
    division: "engineering",
    shortDescription: "Designs the systems that hold everything up: APIs, data, scale, and resilience.",
    theme: "backend systems design and API architecture",
    modelTier: "reasoning",
    recommendedSkills: ["github", "terminal"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-backend-architect.md",
    keywords: ["api", "database", "infrastructure", "distributed systems"],
  },
  {
    id: "engineering-ai-engineer",
    name: "AI Engineer",
    emoji: "🤖",
    division: "engineering",
    shortDescription: "Turns ML models into production features that actually scale.",
    theme: "AI integration, evaluation, and production deployment",
    modelTier: "reasoning",
    recommendedSkills: ["github", "terminal", "knowledge"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-ai-engineer.md",
    keywords: ["llm", "rag", "agents", "evaluation"],
    featured: true,
  },
  {
    id: "engineering-security-engineer",
    name: "Security Engineer",
    emoji: "🔒",
    division: "engineering",
    shortDescription: "Models threats, reviews code, and designs security architecture that actually holds.",
    theme: "application and infrastructure security",
    modelTier: "reasoning",
    recommendedSkills: ["github", "terminal"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-security-engineer.md",
    keywords: ["owasp", "auth", "hardening", "threat modeling"],
  },
  {
    id: "engineering-devops-automator",
    name: "DevOps Automator",
    emoji: "⚙️",
    division: "engineering",
    shortDescription: "Automates infrastructure so your team ships faster and sleeps better.",
    theme: "CI/CD, infrastructure automation, and DevOps",
    modelTier: "balanced",
    recommendedSkills: ["github", "terminal"],
    toolsProfile: "full",
    sourcePath: "engineering/engineering-devops-automator.md",
    keywords: ["terraform", "deployment", "automation", "ops"],
  },
  {
    id: "engineering-code-reviewer",
    name: "Code Reviewer",
    emoji: "👁️",
    division: "engineering",
    shortDescription: "Reviews code like a mentor, not a gatekeeper. Every comment teaches something.",
    theme: "code review, correctness, and maintainability",
    modelTier: "reasoning",
    recommendedSkills: ["github"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-code-reviewer.md",
    keywords: ["review", "bugs", "performance", "maintainability"],
  },
  {
    id: "engineering-senior-developer",
    name: "Senior Developer",
    emoji: "💎",
    division: "engineering",
    shortDescription: "Premium full-stack craftsperson with strong execution and mentoring instincts.",
    theme: "senior full-stack software development",
    modelTier: "reasoning",
    recommendedSkills: ["github", "terminal"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-senior-developer.md",
    keywords: ["full-stack", "mentorship", "architecture", "delivery"],
    featured: true,
  },
  {
    id: "engineering-software-architect",
    name: "Software Architect",
    emoji: "🏛️",
    division: "engineering",
    shortDescription: "Designs systems that survive the team that built them. Every decision has a trade-off.",
    theme: "software architecture and system evolution",
    modelTier: "reasoning",
    recommendedSkills: ["github", "knowledge"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-software-architect.md",
    keywords: ["architecture", "scalability", "tradeoffs", "system design"],
  },
  {
    id: "engineering-database-optimizer",
    name: "Database Optimizer",
    emoji: "🗄️",
    division: "engineering",
    shortDescription: "Indexes, query plans, and schema design for databases that don't wake you at 3am.",
    theme: "database performance and schema optimization",
    modelTier: "reasoning",
    recommendedSkills: ["terminal", "github"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-database-optimizer.md",
    keywords: ["sql", "indexing", "query plan", "postgres"],
  },
  {
    id: "engineering-sre",
    name: "SRE",
    emoji: "🛡️",
    division: "engineering",
    shortDescription: "Reliability is a feature. Error budgets fund velocity, so spend them wisely.",
    theme: "site reliability, incident response, and observability",
    modelTier: "balanced",
    recommendedSkills: ["terminal", "github"],
    toolsProfile: "full",
    sourcePath: "engineering/engineering-sre.md",
    keywords: ["slo", "incident", "observability", "reliability"],
  },
  {
    id: "engineering-technical-writer",
    name: "Technical Writer",
    emoji: "📚",
    division: "engineering",
    shortDescription: "Writes the docs that developers actually read and use.",
    theme: "technical writing and developer documentation",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "engineering/engineering-technical-writer.md",
    keywords: ["docs", "guides", "readme", "api reference"],
  },
  {
    id: "engineering-data-engineer",
    name: "Data Engineer",
    emoji: "🔧",
    division: "engineering",
    shortDescription: "Builds the pipelines that turn raw data into trusted, analytics-ready assets.",
    theme: "data engineering and pipeline architecture",
    modelTier: "reasoning",
    recommendedSkills: ["github", "terminal", "reports"],
    toolsProfile: "coding",
    sourcePath: "engineering/engineering-data-engineer.md",
    keywords: ["etl", "warehouse", "pipelines", "analytics"],
  },
  {
    id: "design-ui-designer",
    name: "UI Designer",
    emoji: "🎨",
    division: "design",
    shortDescription: "Creates beautiful, consistent, accessible interfaces that feel just right.",
    theme: "visual interface design and design systems",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "design/design-ui-designer.md",
    keywords: ["figma", "visual design", "components", "polish"],
    featured: true,
  },
  {
    id: "design-ux-architect",
    name: "UX Architect",
    emoji: "📐",
    division: "design",
    shortDescription: "Gives builders solid foundations, CSS systems, and clear implementation paths.",
    theme: "UX architecture, flows, and information design",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "design/design-ux-architect.md",
    keywords: ["flows", "architecture", "navigation", "information"],
  },
  {
    id: "design-ux-researcher",
    name: "UX Researcher",
    emoji: "🔬",
    division: "design",
    shortDescription: "Validates design decisions with real user data, not assumptions.",
    theme: "UX research, testing, and insight synthesis",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "design/design-ux-researcher.md",
    keywords: ["research", "interviews", "testing", "personas"],
  },
  {
    id: "design-brand-guardian",
    name: "Brand Guardian",
    emoji: "🎨",
    division: "design",
    shortDescription: "Protects and evolves brand identity across every touchpoint.",
    theme: "brand systems, voice, and consistency",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "design/design-brand-guardian.md",
    keywords: ["brand", "voice", "guidelines", "consistency"],
  },
  {
    id: "design-visual-storyteller",
    name: "Visual Storyteller",
    emoji: "🎬",
    division: "design",
    shortDescription: "Transforms complex information into visual narratives that move people.",
    theme: "narrative design, presentations, and visual storytelling",
    modelTier: "balanced",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "design/design-visual-storyteller.md",
    keywords: ["storytelling", "slides", "infographics", "visual narrative"],
  },
  {
    id: "design-image-prompt-engineer",
    name: "Image Prompt Engineer",
    emoji: "📷",
    division: "design",
    shortDescription: "Translates visual concepts into precise prompts that produce striking AI imagery.",
    theme: "AI image direction and prompt engineering",
    modelTier: "balanced",
    recommendedSkills: ["knowledge"],
    toolsProfile: "messaging",
    sourcePath: "design/design-image-prompt-engineer.md",
    keywords: ["midjourney", "image generation", "prompts", "art direction"],
  },
  {
    id: "product-product-manager",
    name: "Product Manager",
    emoji: "🧭",
    division: "product",
    shortDescription: "Ships the right thing, not just the next thing. Outcome-obsessed and ruthless about focus.",
    theme: "product management, strategy, and prioritization",
    modelTier: "reasoning",
    recommendedSkills: ["basecamp", "reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "product/product-manager.md",
    keywords: ["roadmap", "strategy", "discovery", "prioritization"],
    featured: true,
  },
  {
    id: "product-sprint-prioritizer",
    name: "Sprint Prioritizer",
    emoji: "🎯",
    division: "product",
    shortDescription: "Maximizes sprint value through data-driven prioritization and ruthless focus.",
    theme: "backlog refinement and sprint planning",
    modelTier: "fast",
    recommendedSkills: ["basecamp", "reports"],
    toolsProfile: "messaging",
    sourcePath: "product/product-sprint-prioritizer.md",
    keywords: ["sprint", "backlog", "priorities", "planning"],
  },
  {
    id: "product-feedback-synthesizer",
    name: "Feedback Synthesizer",
    emoji: "🔍",
    division: "product",
    shortDescription: "Distills a thousand user voices into the five things you need to build next.",
    theme: "feedback analysis and voice-of-customer synthesis",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "product/product-feedback-synthesizer.md",
    keywords: ["feedback", "support", "voice of customer", "insights"],
  },
  {
    id: "product-trend-researcher",
    name: "Trend Researcher",
    emoji: "🔭",
    division: "product",
    shortDescription: "Spots emerging trends before they hit the mainstream.",
    theme: "market intelligence and product trend research",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "product/product-trend-researcher.md",
    keywords: ["market", "research", "competitive", "signals"],
  },
  {
    id: "product-behavioral-nudge-engine",
    name: "Behavioral Nudge Engine",
    emoji: "🧠",
    division: "product",
    shortDescription: "Adapts software interactions to increase motivation through behavioral psychology.",
    theme: "behavioral design and user motivation systems",
    modelTier: "reasoning",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "product/product-behavioral-nudge-engine.md",
    keywords: ["behavior", "motivation", "habits", "nudges"],
  },
  {
    id: "sales-outbound-strategist",
    name: "Outbound Strategist",
    emoji: "🎯",
    division: "sales",
    shortDescription: "Turns buying signals into booked meetings before the competition notices.",
    theme: "outbound prospecting and signal-based sales",
    modelTier: "fast",
    recommendedSkills: ["email", "calendar", "reports"],
    toolsProfile: "messaging",
    sourcePath: "sales/sales-outbound-strategist.md",
    keywords: ["outbound", "prospecting", "signals", "email"],
  },
  {
    id: "sales-discovery-coach",
    name: "Discovery Coach",
    emoji: "🔍",
    division: "sales",
    shortDescription: "Asks one more question than everyone else, and that's the one that closes the deal.",
    theme: "sales discovery and qualification coaching",
    modelTier: "balanced",
    recommendedSkills: ["reports", "calendar"],
    toolsProfile: "messaging",
    sourcePath: "sales/sales-discovery-coach.md",
    keywords: ["discovery", "qualification", "calls", "objections"],
  },
  {
    id: "sales-deal-strategist",
    name: "Deal Strategist",
    emoji: "♟️",
    division: "sales",
    shortDescription: "Qualifies deals like a surgeon and kills happy ears on contact.",
    theme: "deal qualification and close planning",
    modelTier: "reasoning",
    recommendedSkills: ["reports", "calendar"],
    toolsProfile: "messaging",
    sourcePath: "sales/sales-deal-strategist.md",
    keywords: ["pipeline", "forecast", "close", "meddpicc"],
  },
  {
    id: "sales-engineer",
    name: "Sales Engineer",
    emoji: "🛠️",
    division: "sales",
    shortDescription: "Wins the technical decision before the deal even hits procurement.",
    theme: "technical pre-sales and solution engineering",
    modelTier: "reasoning",
    recommendedSkills: ["github", "reports", "knowledge"],
    toolsProfile: "coding",
    sourcePath: "sales/sales-engineer.md",
    keywords: ["demo", "technical fit", "proof of concept", "pre-sales"],
  },
  {
    id: "sales-pipeline-analyst",
    name: "Pipeline Analyst",
    emoji: "📊",
    division: "sales",
    shortDescription: "Tells you your forecast is wrong before you realize it yourself.",
    theme: "forecasting, analytics, and revenue diagnostics",
    modelTier: "balanced",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "sales/sales-pipeline-analyst.md",
    keywords: ["forecast", "analytics", "pipeline", "revenue"],
  },
  {
    id: "sales-account-strategist",
    name: "Account Strategist",
    emoji: "🗺️",
    division: "sales",
    shortDescription: "Maps the org, finds the whitespace, and turns customers into platforms.",
    theme: "account planning and expansion strategy",
    modelTier: "balanced",
    recommendedSkills: ["reports", "calendar", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "sales/sales-account-strategist.md",
    keywords: ["account plan", "expansion", "org mapping", "stakeholders"],
  },
  {
    id: "sales-proposal-strategist",
    name: "Proposal Strategist",
    emoji: "🏹",
    division: "sales",
    shortDescription: "Turns RFP responses into stories buyers can't put down.",
    theme: "proposal writing and RFP strategy",
    modelTier: "balanced",
    recommendedSkills: ["reports", "knowledge", "email"],
    toolsProfile: "messaging",
    sourcePath: "sales/sales-proposal-strategist.md",
    keywords: ["proposal", "rfp", "responses", "buyer story"],
  },
  {
    id: "marketing-content-creator",
    name: "Content Creator",
    emoji: "✍️",
    division: "marketing",
    shortDescription: "Crafts compelling stories across every platform your audience lives on.",
    theme: "content strategy and cross-channel creation",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "marketing/marketing-content-creator.md",
    keywords: ["content", "blogs", "copy", "campaigns"],
    featured: true,
  },
  {
    id: "marketing-seo-specialist",
    name: "SEO Specialist",
    emoji: "🔍",
    division: "marketing",
    shortDescription: "Drives sustainable organic traffic through technical SEO and content strategy.",
    theme: "search engine optimization and organic growth",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "marketing/marketing-seo-specialist.md",
    keywords: ["seo", "keywords", "organic", "search"],
  },
  {
    id: "marketing-social-media-strategist",
    name: "Social Media Strategist",
    emoji: "📣",
    division: "marketing",
    shortDescription: "Orchestrates cross-platform campaigns that build community and drive engagement.",
    theme: "social strategy and community growth",
    modelTier: "fast",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "marketing/marketing-social-media-strategist.md",
    keywords: ["social", "community", "campaigns", "engagement"],
  },
  {
    id: "marketing-growth-hacker",
    name: "Growth Hacker",
    emoji: "🚀",
    division: "marketing",
    shortDescription: "Finds the growth channel nobody's exploited yet, then scales it.",
    theme: "growth experimentation and channel discovery",
    modelTier: "balanced",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "marketing/marketing-growth-hacker.md",
    keywords: ["growth", "experiments", "acquisition", "funnel"],
  },
  {
    id: "testing-accessibility-auditor",
    name: "Accessibility Auditor",
    emoji: "♿",
    division: "testing",
    shortDescription: "If it's not tested with a screen reader, it's not accessible.",
    theme: "accessibility auditing and inclusive QA",
    modelTier: "reasoning",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "testing/testing-accessibility-auditor.md",
    keywords: ["a11y", "wcag", "screen reader", "audit"],
  },
  {
    id: "testing-api-tester",
    name: "API Tester",
    emoji: "🔌",
    division: "testing",
    shortDescription: "Breaks your API before your users do.",
    theme: "API validation, test coverage, and contract testing",
    modelTier: "reasoning",
    recommendedSkills: ["github", "terminal"],
    toolsProfile: "coding",
    sourcePath: "testing/testing-api-tester.md",
    keywords: ["api", "contracts", "qa", "regression"],
  },
  {
    id: "testing-performance-benchmarker",
    name: "Performance Benchmarker",
    emoji: "⏱️",
    division: "testing",
    shortDescription: "Measures everything, optimizes what matters, and proves the improvement.",
    theme: "performance testing and benchmarking",
    modelTier: "reasoning",
    recommendedSkills: ["terminal", "reports"],
    toolsProfile: "coding",
    sourcePath: "testing/testing-performance-benchmarker.md",
    keywords: ["performance", "latency", "benchmarks", "load"],
  },
  {
    id: "testing-workflow-optimizer",
    name: "Workflow Optimizer",
    emoji: "⚡",
    division: "testing",
    shortDescription: "Finds the bottleneck, fixes the process, and automates the rest.",
    theme: "workflow analysis and process optimization",
    modelTier: "balanced",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "full",
    sourcePath: "testing/testing-workflow-optimizer.md",
    keywords: ["workflow", "process", "bottlenecks", "automation"],
  },
  {
    id: "testing-tool-evaluator",
    name: "Tool Evaluator",
    emoji: "🔧",
    division: "testing",
    shortDescription: "Tests and recommends the right tools so your team doesn't waste time on the wrong ones.",
    theme: "tool evaluation and tooling recommendations",
    modelTier: "balanced",
    recommendedSkills: ["knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "testing/testing-tool-evaluator.md",
    keywords: ["tools", "evaluation", "selection", "comparison"],
  },
  {
    id: "project-management-senior-project-manager",
    name: "Senior Project Manager",
    emoji: "📝",
    division: "project-management",
    shortDescription: "Converts specs to tasks with realistic scope. No gold-plating, no fantasy.",
    theme: "project execution, planning, and delivery management",
    modelTier: "balanced",
    recommendedSkills: ["basecamp", "calendar", "reports"],
    toolsProfile: "full",
    sourcePath: "project-management/project-manager-senior.md",
    keywords: ["project", "timeline", "delivery", "planning"],
  },
  {
    id: "project-management-project-shepherd",
    name: "Project Shepherd",
    emoji: "🐑",
    division: "project-management",
    shortDescription: "Herds cross-functional chaos into on-time, on-scope delivery.",
    theme: "cross-functional coordination and project shepherding",
    modelTier: "balanced",
    recommendedSkills: ["basecamp", "calendar", "reports"],
    toolsProfile: "full",
    sourcePath: "project-management/project-management-project-shepherd.md",
    keywords: ["coordination", "delivery", "cross-functional", "follow-through"],
  },
  {
    id: "support-support-responder",
    name: "Support Responder",
    emoji: "💬",
    division: "support",
    shortDescription: "Turns frustrated users into loyal advocates, one interaction at a time.",
    theme: "customer support and empathetic response handling",
    modelTier: "fast",
    recommendedSkills: ["email", "knowledge", "reports"],
    toolsProfile: "messaging",
    sourcePath: "support/support-support-responder.md",
    keywords: ["support", "tickets", "customer", "responses"],
    featured: true,
  },
  {
    id: "support-analytics-reporter",
    name: "Analytics Reporter",
    emoji: "📊",
    division: "support",
    shortDescription: "Transforms raw data into the insights that drive your next decision.",
    theme: "analytics reporting and decision support",
    modelTier: "balanced",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "support/support-analytics-reporter.md",
    keywords: ["analytics", "reporting", "dashboards", "metrics"],
  },
  {
    id: "specialized-developer-advocate",
    name: "Developer Advocate",
    emoji: "🗣️",
    division: "specialized",
    shortDescription: "Bridges your product team and the developer community through authentic engagement.",
    theme: "developer advocacy and community enablement",
    modelTier: "balanced",
    recommendedSkills: ["github", "reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "specialized/specialized-developer-advocate.md",
    keywords: ["community", "docs", "content", "developer relations"],
  },
  {
    id: "specialized-mcp-builder",
    name: "MCP Builder",
    emoji: "🔌",
    division: "specialized",
    shortDescription: "Builds the tools that make AI agents actually useful in the real world.",
    theme: "MCP servers, integrations, and agent tooling",
    modelTier: "reasoning",
    recommendedSkills: ["github", "terminal", "knowledge"],
    toolsProfile: "coding",
    sourcePath: "specialized/specialized-mcp-builder.md",
    keywords: ["mcp", "tools", "integrations", "agents"],
    featured: true,
  },
  {
    id: "specialized-workflow-architect",
    name: "Workflow Architect",
    emoji: "🗺️",
    division: "specialized",
    shortDescription: "Maps every path the system can take before a single line is written.",
    theme: "workflow architecture and automation design",
    modelTier: "reasoning",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "full",
    sourcePath: "specialized/specialized-workflow-architect.md",
    keywords: ["workflow", "orchestration", "automation", "mapping"],
  },
  {
    id: "specialized-document-generator",
    name: "Document Generator",
    emoji: "📄",
    division: "specialized",
    shortDescription: "Produces professional PDFs, slides, spreadsheets, and reports from code and data.",
    theme: "document automation and structured output generation",
    modelTier: "balanced",
    recommendedSkills: ["reports", "knowledge"],
    toolsProfile: "messaging",
    sourcePath: "specialized/specialized-document-generator.md",
    keywords: ["documents", "pdf", "slides", "reports"],
  },
];

function archetypeSearchBlob(archetype: AgentArchetype): string {
  return [
    archetype.name,
    archetype.shortDescription,
    archetype.theme,
    archetype.division,
    tierLabel(archetype.modelTier),
    toolsProfileLabel(archetype.toolsProfile),
    ...archetype.recommendedSkills,
    ...(archetype.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function renderArchetypeCard(
  archetype: AgentArchetype,
  active: boolean,
  onPreviewArchetype: (archetype: AgentArchetype) => void,
  onSelectArchetype: (archetype: AgentArchetype) => void,
): TemplateResult {
  return html`
    <article class="catalog-card ${archetype.featured ? "catalog-card--featured" : ""} ${active ? "catalog-card--active" : ""}">
      <button
        type="button"
        class="catalog-card__body"
        @click=${() => onPreviewArchetype(archetype)}
      >
        <div class="catalog-card__header">
          <span class="catalog-card__emoji">${archetype.emoji}</span>
          ${archetype.featured ? html`<span class="catalog-card__featured">Featured</span>` : nothing}
        </div>
        <div class="catalog-card__name-row">
          <div class="catalog-card__name">${archetype.name}</div>
          <div class="catalog-card__desc">${archetype.shortDescription}</div>
        </div>
        <div class="catalog-card__meta">
          <span class="catalog-chip">${getDivisionMeta(archetype.division).label}</span>
          <span class="catalog-chip" style="color:${tierTone(archetype.modelTier)}; border-color:${tierTone(archetype.modelTier)}40;">
            ${tierLabel(archetype.modelTier)}
          </span>
          <span class="catalog-chip">${toolsProfileLabel(archetype.toolsProfile)}</span>
        </div>
      </button>
      <div class="catalog-card__footer">
        <button type="button" class="btn btn--sm" @click=${() => onPreviewArchetype(archetype)}>
          Preview
        </button>
        <button type="button" class="btn btn--sm primary" @click=${() => onSelectArchetype(archetype)}>
          Use Agent
        </button>
      </div>
    </article>
  `;
}

export type CatalogBrowserProps = {
  archetypes: AgentArchetype[];
  divisions: DivisionMeta[];
  selectedDivision: AgentArchetypeDivision | "all";
  searchQuery: string;
  previewArchetypeId: string | null;
  previewSoulContent: string;
  previewLoading: boolean;
  previewError: string | null;
  onDivisionChange: (division: AgentArchetypeDivision | "all") => void;
  onSearchChange: (query: string) => void;
  onSelectArchetype: (archetype: AgentArchetype) => void;
  onPreviewArchetype: (archetype: AgentArchetype | null) => void;
  onStartFromScratch: () => void;
};

export function renderCatalogBrowser(props: CatalogBrowserProps): TemplateResult {
  const query = props.searchQuery.trim().toLowerCase();
  const filtered = props.archetypes.filter((archetype) => {
    if (props.selectedDivision !== "all" && archetype.division !== props.selectedDivision) {
      return false;
    }
    if (!query) {
      return true;
    }
    return archetypeSearchBlob(archetype).includes(query);
  });
  const sorted = [...filtered].sort((left, right) => {
    if (!query && props.selectedDivision === "all") {
      const leftRank = left.featured ? 0 : 1;
      const rightRank = right.featured ? 0 : 1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
    }
    return left.name.localeCompare(right.name);
  });
  const divisionCounts = new Map<AgentArchetypeDivision, number>();
  props.archetypes.forEach((archetype) => {
    divisionCounts.set(
      archetype.division,
      (divisionCounts.get(archetype.division) ?? 0) + 1,
    );
  });
  const previewArchetype = getArchetypeById(props.previewArchetypeId);
  const previewSoul =
    previewArchetype && props.previewSoulContent.trim()
      ? props.previewSoulContent.trim()
      : previewArchetype
        ? buildFallbackSoul(previewArchetype)
        : "";
  const featured = props.archetypes.filter((archetype) => archetype.featured).slice(0, 6);
  const groupedSections =
    props.selectedDivision === "all" && !query
      ? props.divisions
          .map((division) => ({
            division,
            items: sorted.filter((archetype) => archetype.division === division.id),
          }))
          .filter((section) => section.items.length > 0)
      : [];

  return html`
    <section class="card catalog-shell" style="margin-top: 14px;">
      <div class="catalog-shell__hero">
        <div>
          <div class="card-title">Agent Catalog</div>
          <div class="card-sub">
            Pick an archetype and we’ll pre-wire the name, model tier, tool profile, skills, and SOUL.md persona.
          </div>
        </div>
        <button type="button" class="btn primary" @click=${props.onStartFromScratch}>
          Start From Scratch
        </button>
      </div>

      <div class="catalog-toolbar">
        <label class="field catalog-toolbar__search">
          <span>Search agents</span>
          <input
            type="text"
            .value=${props.searchQuery}
            placeholder="Try ui, seo, api, support, workflow..."
            @input=${(event: Event) =>
              props.onSearchChange((event.target as HTMLInputElement).value)}
          />
        </label>
        <div class="catalog-toolbar__stats">
          <div class="catalog-stat">
            <span class="catalog-stat__value">${sorted.length}</span>
            <span class="catalog-stat__label">${query || props.selectedDivision !== "all" ? "matching roles" : "available roles"}</span>
          </div>
          <div class="catalog-stat">
            <span class="catalog-stat__value">${props.divisions.length}</span>
            <span class="catalog-stat__label">divisions</span>
          </div>
        </div>
      </div>

      ${props.selectedDivision === "all" && !query
        ? html`
            <div class="catalog-spotlight">
              <div class="catalog-spotlight__title">Quick picks</div>
              <div class="catalog-spotlight__list">
                ${featured.map(
                  (archetype) => html`
                    <button
                      type="button"
                      class="catalog-spotlight__pill"
                      @click=${() => props.onPreviewArchetype(archetype)}
                    >
                      <span>${archetype.emoji}</span>
                      <span>${archetype.name}</span>
                    </button>
                  `,
                )}
              </div>
            </div>
          `
        : nothing}

      <div class="catalog-layout">
        <aside class="catalog-sidebar">
          <button
            type="button"
            class="catalog-sidebar__item ${props.selectedDivision === "all" ? "catalog-sidebar__item--active" : ""}"
            @click=${() => props.onDivisionChange("all")}
          >
            <span class="catalog-sidebar__label">All Roles</span>
            <span class="catalog-sidebar__count">${props.archetypes.length}</span>
          </button>
          ${props.divisions.map(
            (division) => html`
              <button
                type="button"
                class="catalog-sidebar__item ${props.selectedDivision === division.id ? "catalog-sidebar__item--active" : ""}"
                @click=${() => props.onDivisionChange(division.id)}
              >
                <span class="catalog-sidebar__label">
                  <span>${division.emoji}</span>
                  <span>${division.label}</span>
                </span>
                <span class="catalog-sidebar__count">${divisionCounts.get(division.id) ?? 0}</span>
              </button>
            `,
          )}
        </aside>

        <div class="catalog-content">
          ${previewArchetype
            ? html`
                <section class="catalog-preview">
                  <div class="catalog-preview__header">
                    <div class="catalog-preview__identity">
                      <div class="catalog-preview__emoji">${previewArchetype.emoji}</div>
                      <div>
                        <div class="catalog-preview__name">${previewArchetype.name}</div>
                        <div class="catalog-preview__desc">${previewArchetype.shortDescription}</div>
                      </div>
                    </div>
                    <div class="catalog-preview__actions">
                      <button
                        type="button"
                        class="btn btn--sm"
                        @click=${() => props.onPreviewArchetype(null)}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        class="btn btn--sm primary"
                        @click=${() => props.onSelectArchetype(previewArchetype)}
                      >
                        Use This Agent
                      </button>
                    </div>
                  </div>
                  <div class="catalog-preview__meta">
                    <span class="catalog-chip">${getDivisionMeta(previewArchetype.division).label}</span>
                    <span class="catalog-chip" style="color:${tierTone(previewArchetype.modelTier)}; border-color:${tierTone(previewArchetype.modelTier)}40;">
                      ${tierLabel(previewArchetype.modelTier)}
                    </span>
                    <span class="catalog-chip">${toolsProfileLabel(previewArchetype.toolsProfile)}</span>
                    ${previewArchetype.recommendedSkills.map(
                      (skill) => html`<span class="catalog-chip">${skill}</span>`,
                    )}
                  </div>
                  ${props.previewError
                    ? html`<div class="callout info">${props.previewError}</div>`
                    : nothing}
                  <div class="catalog-preview__soul">
                    ${props.previewLoading
                      ? html`<div class="muted">Loading full persona…</div>`
                      : html`<pre>${previewSoul}</pre>`}
                  </div>
                </section>
              `
            : nothing}

          ${sorted.length === 0
            ? html`
                <div class="catalog-empty">
                  <div class="catalog-empty__title">No agent matches that filter.</div>
                  <div class="catalog-empty__sub">
                    Try a broader keyword, switch divisions, or start from scratch.
                  </div>
                </div>
              `
            : nothing}

          ${groupedSections.length > 0
            ? groupedSections.map(
                (section) => html`
                  <section class="catalog-section">
                    <div class="catalog-section__header">
                      <div>
                        <div class="catalog-section__title">
                          ${section.division.emoji} ${section.division.label}
                        </div>
                        <div class="catalog-section__sub">
                          ${section.items.length} role${section.items.length === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                    <div class="catalog-grid">
                      ${section.items.map((archetype) =>
                        renderArchetypeCard(
                          archetype,
                          props.previewArchetypeId === archetype.id,
                          (next) => props.onPreviewArchetype(next),
                          props.onSelectArchetype,
                        ),
                      )}
                    </div>
                  </section>
                `,
              )
            : nothing}

          ${groupedSections.length === 0 && sorted.length > 0
            ? html`
                <div class="catalog-grid">
                  ${sorted.map((archetype) =>
                    renderArchetypeCard(
                      archetype,
                      props.previewArchetypeId === archetype.id,
                      (next) => props.onPreviewArchetype(next),
                      props.onSelectArchetype,
                    ),
                  )}
                </div>
              `
            : nothing}
        </div>
      </div>
    </section>
  `;
}
