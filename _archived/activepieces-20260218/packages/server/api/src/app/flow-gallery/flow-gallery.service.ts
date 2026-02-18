import {
    ActivepiecesError,
    EngineHttpResponse,
    apId,
    ErrorCode,
    EventPayload,
    FAIL_PARENT_ON_FAILURE_HEADER,
    isNil,
    PARENT_RUN_ID_HEADER,
    SeekPage,
    Template,
    TemplateStatus,
    TemplateType,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { Equal, In } from 'typeorm'
import { repoFactory } from '../core/db/repo-factory'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { TemplateEntity } from '../template/template.entity'
import { WebhookFlowVersionToRun } from '../webhooks/webhook-handler'
import { webhookService } from '../webhooks/webhook.service'
import { FlowGalleryAppEntity, FlowGalleryAppSchema } from './flow-gallery.entity'
import { FlowGalleryRunEntity } from './flow-gallery-run.entity'

const templateRepo = repoFactory<Template>(TemplateEntity)
const flowGalleryAppRepo = repoFactory(FlowGalleryAppEntity)
const flowGalleryRunRepo = repoFactory(FlowGalleryRunEntity)

/**
 * Flow Gallery Service
 * 
 * Handles public app store functionality:
 * - Listing published templates as browseable apps
 * - Fetching app metadata for display
 * - Triggering flow execution via webhooks
 * - Logging execution history
 * 
 * PRD Reference: Flow App Store - Gallery & Execution
 */

interface ListPublicAppsParams {
    cursor: string | null
    limit: number
    search?: string
    category?: string
    featured?: boolean
    platformId: string | null
}

interface GetAppParams {
    id: string
    platformId: string | null
}

interface GetAppWithTemplateParams {
    id: string
    platformId: string | null
}

interface ExecuteFlowParams {
    appId: string
    inputs: Record<string, unknown>
}

type ExecuteMode = 'sync' | 'async'

interface PublishTemplateAsAppParams {
    templateId: string
    platformId: string
    publishedBy: string
    flowId?: string
    description?: string
    icon?: string
    category?: string
    tags?: string[]
    featured?: boolean
    displayOrder?: number
    inputSchema?: Record<string, unknown>
    outputType?: string
    outputSchema?: Record<string, unknown>
}

interface UpdatePublishedAppParams extends Omit<PublishTemplateAsAppParams, 'templateId' | 'platformId' | 'publishedBy'> {
    templateId: string
    platformId: string
}

type DefaultTemplateSeed = {
    key: string
    name: string
    summary: string
    description: string
    categories: string[]
    pieces: string[]
    tags: string[]
    type: TemplateType
}

type DefaultAppSeed = {
    key: string
    templateKey: string
    name: string
    description: string
    category: string
    tags: string[]
    featured: boolean
    displayOrder: number
    icon: string
    outputType: AppOutputType
    inputSchema: Record<string, unknown>
}

type AppOutputType = 'json' | 'text' | 'image' | 'markdown' | 'html'
type AppInputType = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'password'

const MAX_SCHEMA_FIELDS = 30
const MAX_TAGS = 12
const MAX_TAG_LENGTH = 40
const ALLOWED_OUTPUT_TYPES = new Set<AppOutputType>(['json', 'text', 'image', 'markdown', 'html'])
const ALLOWED_INPUT_TYPES = new Set<AppInputType>(['text', 'textarea', 'number', 'select', 'boolean', 'password'])
const DEFAULT_SEED_VERSION = 1
const DEFAULT_SEED_AUTHOR = 'Wicked Flow'

const DEFAULT_TEMPLATE_SEEDS: DefaultTemplateSeed[] = [
    // ── PROJECT MANAGEMENT ──────────────────────────────────────
    {
        key: 'app_meeting_notes_to_tasks',
        name: 'Meeting Notes → Basecamp Tasks',
        summary: 'Turn Fathom call notes into assigned Basecamp tasks.',
        description: 'Parses meeting transcripts from Fathom, extracts action items with owners and due dates, and creates organized Basecamp to-do lists per project.',
        categories: ['Project Management', 'Meetings'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['fathom', 'basecamp', 'meeting-notes', 'tasks', 'ai'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_kickoff_builder',
        name: 'Project Kickoff Builder',
        summary: 'Convert scope into kickoff tasks and sprint checklist.',
        description: 'Takes project scope, timeline, and constraints to generate a complete kickoff packet with Basecamp to-do lists, message board topics, and first-sprint backlog.',
        categories: ['Project Management'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['kickoff', 'sprint', 'planning', 'basecamp', 'scope'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_retro_summarizer',
        name: 'Sprint Retro Summarizer',
        summary: 'Summarize retro notes into action items and Basecamp updates.',
        description: 'Collects what went well, what didn\'t, and improvement ideas from a sprint retrospective. Produces a structured summary, posts it to Basecamp message board, and creates follow-up to-dos.',
        categories: ['Project Management', 'Operations'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['retro', 'sprint', 'basecamp', 'continuous-improvement'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_standup_digest',
        name: 'Daily Standup → Slack Digest',
        summary: 'Collect async standups and post a team digest to Slack.',
        description: 'Team members submit their standup (yesterday, today, blockers) via a simple form. The flow aggregates responses, highlights blockers, and posts a formatted digest to Slack with a Basecamp campfire summary.',
        categories: ['Project Management', 'Communication'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
        tags: ['standup', 'slack', 'basecamp', 'daily', 'async'],
        type: TemplateType.SHARED,
    },
    // ── CLIENT SUCCESS ──────────────────────────────────────────
    {
        key: 'app_client_update_writer',
        name: 'Client Update Writer',
        summary: 'Draft weekly client updates from wins, blockers, and next steps.',
        description: 'Takes this week\'s wins, blockers, and next steps and generates a polished, professional client status email in your agency\'s voice. Optionally posts to Basecamp message board.',
        categories: ['Client Success', 'Communication'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['client-update', 'weekly-report', 'basecamp', 'ai-writer'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_client_onboarding_checklist',
        name: 'Client Onboarding Checklist Generator',
        summary: 'Generate a complete onboarding checklist for new clients.',
        description: 'Input client type, project scope, and team size to generate a tailored onboarding checklist. Creates Basecamp project with to-do lists for credentials, brand assets, access setup, kickoff scheduling, and welcome comms.',
        categories: ['Client Success', 'Operations'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['onboarding', 'checklist', 'client', 'basecamp'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_nps_followup',
        name: 'NPS Score → Follow-up Actions',
        summary: 'Route NPS responses to the right team action.',
        description: 'Receives NPS survey responses, classifies sentiment, and routes accordingly — promoters get referral asks via Slack, passives get check-in tasks in Basecamp, detractors trigger escalation alerts to management.',
        categories: ['Client Success', 'Sales'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
        tags: ['nps', 'feedback', 'client-success', 'slack', 'basecamp'],
        type: TemplateType.SHARED,
    },
    // ── SALES & MARKETING ───────────────────────────────────────
    {
        key: 'app_lead_qualifier',
        name: 'Lead Qualifier & CRM Router',
        summary: 'Score inbound leads and route to the right salesperson.',
        description: 'Takes lead details (company, budget, timeline, needs) and uses AI to score fit, assign priority, and route to the right team member. Creates a qualified lead to-do in Basecamp and posts a Slack notification.',
        categories: ['Sales', 'Marketing'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
        tags: ['lead-scoring', 'sales', 'basecamp', 'slack', 'qualification'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_proposal_draft',
        name: 'Proposal Draft Generator',
        summary: 'Generate a proposal draft from discovery call notes.',
        description: 'Input discovery call notes, budget range, and project type to generate a complete proposal draft with scope, timeline, pricing tiers, and terms. Outputs polished markdown ready for review.',
        categories: ['Sales'],
        pieces: ['@activepieces/piece-webhook'],
        tags: ['proposal', 'sales', 'ai-writer', 'discovery'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_campaign_planner',
        name: 'Campaign Brief → Content Plan',
        summary: 'Turn campaign goals into a channel-by-channel content plan.',
        description: 'Takes campaign objectives, target audience, budget, and timeline to generate a production-ready content plan with channel strategy, asset requirements, copy angles, and a due-date checklist as Basecamp to-dos.',
        categories: ['Marketing', 'Creative'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['campaign', 'marketing', 'content-plan', 'basecamp'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_social_post_generator',
        name: 'Social Post Generator',
        summary: 'Generate platform-specific social posts from a single brief.',
        description: 'Provide a topic, key message, and brand voice to generate tailored posts for LinkedIn, Twitter/X, Instagram, and Facebook. Includes hashtag suggestions, optimal posting times, and image direction notes.',
        categories: ['Marketing', 'Creative'],
        pieces: ['@activepieces/piece-webhook'],
        tags: ['social-media', 'content', 'marketing', 'ai-writer'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_seo_audit_brief',
        name: 'SEO Page Audit & Brief',
        summary: 'Analyze a URL and generate an SEO improvement brief.',
        description: 'Input a page URL and target keywords to get a structured SEO audit with title/meta suggestions, content gaps, internal linking opportunities, and a prioritized action list as Basecamp to-dos.',
        categories: ['Marketing', 'Engineering'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['seo', 'audit', 'marketing', 'content', 'basecamp'],
        type: TemplateType.SHARED,
    },
    // ── DESIGN & CREATIVE ───────────────────────────────────────
    {
        key: 'app_image_generator',
        name: 'Image Generator with Brand Context',
        summary: 'Generate creative assets from brand context and prompt.',
        description: 'Provide a creative brief, brand guidelines, and art direction to generate on-brand image concepts. Supports campaign assets, social graphics, and hero images with style consistency.',
        categories: ['Design', 'Creative'],
        pieces: ['@activepieces/piece-webhook'],
        tags: ['image-gen', 'creative', 'design', 'brand'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_design_request_brief',
        name: 'Design Request → Creative Brief',
        summary: 'Turn messy design requests into structured creative briefs.',
        description: 'Standardizes free-form design requests into a complete creative brief with objectives, deliverables, dimensions, copy, brand guidelines, and deadline. Posts the brief to Basecamp and notifies the design channel in Slack.',
        categories: ['Design', 'Operations'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
        tags: ['design', 'brief', 'creative', 'slack', 'basecamp'],
        type: TemplateType.SHARED,
    },
    // ── ENGINEERING & QA ────────────────────────────────────────
    {
        key: 'app_bug_triage',
        name: 'Bug Report Triage & Task Creator',
        summary: 'Classify bugs by severity and create prioritized Basecamp tasks.',
        description: 'Receives bug reports with steps to reproduce, classifies severity (critical/high/medium/low), assigns to the right developer, and creates a detailed Basecamp to-do with acceptance criteria. Critical bugs also trigger a Slack alert.',
        categories: ['Engineering', 'QA'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
        tags: ['bug', 'triage', 'engineering', 'basecamp', 'slack', 'qa'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_code_review_checklist',
        name: 'PR Review Checklist Generator',
        summary: 'Generate a code review checklist from PR description.',
        description: 'Input a pull request description, tech stack, and changed files summary to generate a structured review checklist covering security, performance, accessibility, testing, and coding standards. Creates a Basecamp comment or to-do.',
        categories: ['Engineering'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['code-review', 'pr', 'engineering', 'checklist', 'qa'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_release_notes',
        name: 'Release Notes Generator',
        summary: 'Generate client-friendly release notes from commit/PR logs.',
        description: 'Provide raw commit messages or PR titles from a release and get polished, client-friendly release notes organized by feature, fix, and improvement. Posts to Basecamp message board and Slack channel.',
        categories: ['Engineering', 'Client Success'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
        tags: ['release-notes', 'engineering', 'client', 'basecamp', 'slack'],
        type: TemplateType.SHARED,
    },
    // ── OPERATIONS & MANAGEMENT ─────────────────────────────────
    {
        key: 'app_triage_assistant',
        name: 'Request Triage Assistant',
        summary: 'Triage inbound requests into priority and ownership.',
        description: 'Classifies incoming requests (client, internal, vendor) by urgency and type, assigns ownership based on team rules, and creates prioritized Basecamp to-dos with SLA deadlines.',
        categories: ['Operations', 'Support'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['triage', 'priority', 'operations', 'basecamp'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_timeoff_coordinator',
        name: 'Time-Off Request Coordinator',
        summary: 'Process PTO requests and update team availability.',
        description: 'Team members submit PTO requests with dates and coverage plan. The flow checks for conflicts, notifies the manager in Slack, creates a Basecamp schedule entry, and updates the team availability board.',
        categories: ['Operations', 'HR'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
        tags: ['pto', 'timeoff', 'hr', 'slack', 'basecamp', 'schedule'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_weekly_digest',
        name: 'Weekly Team Digest Builder',
        summary: 'Compile team highlights into a weekly digest for leadership.',
        description: 'Collects project updates, metrics, wins, and risks from across the team and compiles them into a polished weekly digest. Posts to Basecamp message board and sends a summary to the leadership Slack channel.',
        categories: ['Management', 'Communication'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
        tags: ['weekly-digest', 'management', 'reporting', 'slack', 'basecamp'],
        type: TemplateType.SHARED,
    },
]

const DEFAULT_APP_SEEDS: DefaultAppSeed[] = [
    // ── PROJECT MANAGEMENT ──────────────────────────────────────
    {
        key: 'app_meeting_notes_to_tasks',
        templateKey: 'app_meeting_notes_to_tasks',
        name: 'Meeting Notes → Basecamp Tasks',
        description: 'Paste Fathom meeting notes and auto-generate organized Basecamp tasks with owners and due dates.',
        category: 'PROJECT_MANAGEMENT',
        tags: ['fathom', 'basecamp', 'tasks', 'ai'],
        featured: true,
        displayOrder: 10,
        icon: '📋',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'meeting_notes', label: 'Meeting notes / transcript', type: 'textarea', required: true, placeholder: 'Paste Fathom notes or transcript...' },
                { name: 'project_name', label: 'Project name', type: 'text', required: true, placeholder: 'Which Basecamp project?' },
                { name: 'attendees', label: 'Attendees', type: 'textarea', required: false, placeholder: 'List attendees for ownership assignment' },
                { name: 'priority_focus', label: 'Priority focus', type: 'select', required: false, options: [{ label: 'All items', value: 'all' }, { label: 'Blockers only', value: 'blockers' }, { label: 'Client-facing', value: 'client' }] },
            ],
        },
    },
    {
        key: 'app_kickoff_builder',
        templateKey: 'app_kickoff_builder',
        name: 'Project Kickoff Builder',
        description: 'Generate a complete kickoff packet with to-do lists, milestones, and first-sprint backlog from project scope.',
        category: 'PROJECT_MANAGEMENT',
        tags: ['kickoff', 'sprint', 'scope', 'basecamp'],
        featured: true,
        displayOrder: 20,
        icon: '🚀',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'scope', label: 'Project scope', type: 'textarea', required: true, placeholder: 'What\'s included? Pages, features, integrations...' },
                { name: 'client_name', label: 'Client name', type: 'text', required: true, placeholder: 'Client or project name' },
                { name: 'timeline', label: 'Timeline', type: 'text', required: true, placeholder: 'e.g. 8 weeks, launch by March 15' },
                { name: 'team_members', label: 'Team members', type: 'textarea', required: false, placeholder: 'Names and roles (PM, designer, dev...)' },
                { name: 'constraints', label: 'Constraints / dependencies', type: 'textarea', required: false, placeholder: 'Budget, third-party APIs, legal, etc.' },
            ],
        },
    },
    {
        key: 'app_retro_summarizer',
        templateKey: 'app_retro_summarizer',
        name: 'Sprint Retro Summarizer',
        description: 'Turn retro feedback into structured summaries with action items posted to Basecamp.',
        category: 'PROJECT_MANAGEMENT',
        tags: ['retro', 'sprint', 'continuous-improvement'],
        featured: false,
        displayOrder: 30,
        icon: '🔄',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'went_well', label: 'What went well', type: 'textarea', required: true, placeholder: 'Highlights and wins from this sprint' },
                { name: 'went_wrong', label: 'What didn\'t go well', type: 'textarea', required: true, placeholder: 'Pain points, delays, miscommunication' },
                { name: 'improvements', label: 'Improvement ideas', type: 'textarea', required: true, placeholder: 'What should we try next sprint?' },
                { name: 'sprint_name', label: 'Sprint name', type: 'text', required: false, placeholder: 'e.g. Sprint 12 - Homepage Redesign' },
            ],
        },
    },
    {
        key: 'app_standup_digest',
        templateKey: 'app_standup_digest',
        name: 'Daily Standup → Slack Digest',
        description: 'Submit async standup updates and get a formatted team digest in Slack and Basecamp.',
        category: 'PROJECT_MANAGEMENT',
        tags: ['standup', 'slack', 'async', 'daily'],
        featured: false,
        displayOrder: 40,
        icon: '☀️',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'yesterday', label: 'What I did yesterday', type: 'textarea', required: true, placeholder: 'Completed tasks and progress' },
                { name: 'today', label: 'What I\'m doing today', type: 'textarea', required: true, placeholder: 'Planned work for today' },
                { name: 'blockers', label: 'Blockers', type: 'textarea', required: false, placeholder: 'Anything blocking your progress?' },
                { name: 'team_member', label: 'Your name', type: 'text', required: true, placeholder: 'Your name' },
            ],
        },
    },
    // ── CLIENT SUCCESS ──────────────────────────────────────────
    {
        key: 'app_client_update_writer',
        templateKey: 'app_client_update_writer',
        name: 'Client Update Writer',
        description: 'Generate polished weekly client status emails from quick bullet points.',
        category: 'CLIENT_SUCCESS',
        tags: ['client-update', 'weekly', 'ai-writer'],
        featured: true,
        displayOrder: 50,
        icon: '✉️',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'client_name', label: 'Client name', type: 'text', required: true, placeholder: 'Client name' },
                { name: 'wins', label: 'Wins this week', type: 'textarea', required: true, placeholder: 'Major progress and deliverables completed' },
                { name: 'blockers', label: 'Blockers / risks', type: 'textarea', required: false, placeholder: 'Any issues or risks to flag' },
                { name: 'next_steps', label: 'Next steps', type: 'textarea', required: true, placeholder: 'Planned work for next week' },
                { name: 'tone', label: 'Tone', type: 'select', required: false, options: [{ label: 'Professional', value: 'professional' }, { label: 'Friendly', value: 'friendly' }, { label: 'Executive', value: 'executive' }] },
            ],
        },
    },
    {
        key: 'app_client_onboarding_checklist',
        templateKey: 'app_client_onboarding_checklist',
        name: 'Client Onboarding Checklist',
        description: 'Generate a tailored onboarding checklist with Basecamp to-do lists for new clients.',
        category: 'CLIENT_SUCCESS',
        tags: ['onboarding', 'checklist', 'client', 'basecamp'],
        featured: false,
        displayOrder: 60,
        icon: '📝',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'client_name', label: 'Client name', type: 'text', required: true, placeholder: 'New client name' },
                { name: 'project_type', label: 'Project type', type: 'select', required: true, options: [{ label: 'Website Design', value: 'website' }, { label: 'Web App', value: 'webapp' }, { label: 'E-commerce', value: 'ecommerce' }, { label: 'Branding', value: 'branding' }, { label: 'Marketing Campaign', value: 'campaign' }] },
                { name: 'scope_summary', label: 'Scope summary', type: 'textarea', required: true, placeholder: 'Brief description of what we\'re building' },
                { name: 'team_size', label: 'Team size', type: 'number', required: false, placeholder: 'How many people on the team?' },
            ],
        },
    },
    {
        key: 'app_nps_followup',
        templateKey: 'app_nps_followup',
        name: 'NPS → Follow-up Actions',
        description: 'Route NPS responses to the right team — promoters get referral asks, detractors get escalation alerts.',
        category: 'CLIENT_SUCCESS',
        tags: ['nps', 'feedback', 'client-success', 'slack'],
        featured: false,
        displayOrder: 70,
        icon: '📊',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'client_name', label: 'Client name', type: 'text', required: true, placeholder: 'Client who responded' },
                { name: 'nps_score', label: 'NPS Score (0-10)', type: 'number', required: true, placeholder: '0-10' },
                { name: 'feedback', label: 'Verbatim feedback', type: 'textarea', required: false, placeholder: 'What did they say?' },
                { name: 'account_manager', label: 'Account manager', type: 'text', required: false, placeholder: 'Who manages this account?' },
            ],
        },
    },
    // ── SALES & MARKETING ───────────────────────────────────────
    {
        key: 'app_lead_qualifier',
        templateKey: 'app_lead_qualifier',
        name: 'Lead Qualifier & Router',
        description: 'AI-score inbound leads and route to the right salesperson with Slack notifications.',
        category: 'SALES',
        tags: ['lead-scoring', 'sales', 'slack', 'qualification'],
        featured: true,
        displayOrder: 80,
        icon: '🎯',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'company_name', label: 'Company name', type: 'text', required: true, placeholder: 'Lead company name' },
                { name: 'contact_name', label: 'Contact name', type: 'text', required: true, placeholder: 'Primary contact' },
                { name: 'project_needs', label: 'Project needs', type: 'textarea', required: true, placeholder: 'What do they need? Website, app, campaign...' },
                { name: 'budget_range', label: 'Budget range', type: 'select', required: true, options: [{ label: 'Under $10k', value: 'under_10k' }, { label: '$10k-$25k', value: '10k_25k' }, { label: '$25k-$50k', value: '25k_50k' }, { label: '$50k-$100k', value: '50k_100k' }, { label: '$100k+', value: '100k_plus' }] },
                { name: 'timeline', label: 'Timeline', type: 'text', required: false, placeholder: 'When do they want to start?' },
                { name: 'source', label: 'Lead source', type: 'select', required: false, options: [{ label: 'Referral', value: 'referral' }, { label: 'Website', value: 'website' }, { label: 'Social Media', value: 'social' }, { label: 'Conference', value: 'conference' }, { label: 'Cold Outreach', value: 'cold' }] },
            ],
        },
    },
    {
        key: 'app_proposal_draft',
        templateKey: 'app_proposal_draft',
        name: 'Proposal Draft Generator',
        description: 'Generate a complete proposal draft from discovery call notes with scope, timeline, and pricing.',
        category: 'SALES',
        tags: ['proposal', 'sales', 'ai-writer', 'discovery'],
        featured: true,
        displayOrder: 90,
        icon: '📄',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'discovery_notes', label: 'Discovery call notes', type: 'textarea', required: true, placeholder: 'Raw notes from the discovery call or Fathom transcript' },
                { name: 'project_type', label: 'Project type', type: 'select', required: true, options: [{ label: 'Website Design & Dev', value: 'website' }, { label: 'Web Application', value: 'webapp' }, { label: 'E-commerce Build', value: 'ecommerce' }, { label: 'Branding Package', value: 'branding' }, { label: 'Marketing Retainer', value: 'marketing' }] },
                { name: 'budget_range', label: 'Budget range', type: 'text', required: true, placeholder: '$25k-$50k' },
                { name: 'company_info', label: 'Our company blurb', type: 'textarea', required: false, placeholder: 'About us section to include' },
            ],
        },
    },
    {
        key: 'app_campaign_planner',
        templateKey: 'app_campaign_planner',
        name: 'Campaign Brief → Content Plan',
        description: 'Turn campaign objectives into a channel-by-channel content plan with Basecamp to-dos.',
        category: 'MARKETING',
        tags: ['campaign', 'content-plan', 'marketing', 'basecamp'],
        featured: false,
        displayOrder: 100,
        icon: '📣',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'campaign_name', label: 'Campaign name', type: 'text', required: true, placeholder: 'e.g. Spring Product Launch' },
                { name: 'objectives', label: 'Campaign objectives', type: 'textarea', required: true, placeholder: 'What are we trying to achieve?' },
                { name: 'target_audience', label: 'Target audience', type: 'textarea', required: true, placeholder: 'Who are we targeting?' },
                { name: 'budget', label: 'Budget', type: 'text', required: false, placeholder: 'Total campaign budget' },
                { name: 'timeline', label: 'Campaign timeline', type: 'text', required: true, placeholder: 'e.g. Feb 15 - Mar 30' },
                { name: 'channels', label: 'Channels', type: 'select', required: true, options: [{ label: 'Social + Email', value: 'social_email' }, { label: 'Social + Blog + Email', value: 'all_organic' }, { label: 'Paid + Organic', value: 'paid_organic' }, { label: 'Full Omnichannel', value: 'omnichannel' }] },
            ],
        },
    },
    {
        key: 'app_social_post_generator',
        templateKey: 'app_social_post_generator',
        name: 'Social Post Generator',
        description: 'Generate tailored posts for LinkedIn, X, Instagram, and Facebook from a single brief.',
        category: 'MARKETING',
        tags: ['social-media', 'content', 'ai-writer'],
        featured: false,
        displayOrder: 110,
        icon: '📱',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'topic', label: 'Topic / announcement', type: 'textarea', required: true, placeholder: 'What do you want to post about?' },
                { name: 'key_message', label: 'Key message', type: 'text', required: true, placeholder: 'The one takeaway for the audience' },
                { name: 'brand_voice', label: 'Brand voice', type: 'select', required: false, options: [{ label: 'Professional', value: 'professional' }, { label: 'Playful', value: 'playful' }, { label: 'Bold & Edgy', value: 'bold' }, { label: 'Warm & Approachable', value: 'warm' }] },
                { name: 'cta', label: 'Call to action', type: 'text', required: false, placeholder: 'e.g. Book a demo, Visit our site' },
            ],
        },
    },
    {
        key: 'app_seo_audit_brief',
        templateKey: 'app_seo_audit_brief',
        name: 'SEO Page Audit & Brief',
        description: 'Analyze a page URL and generate an SEO improvement brief with prioritized actions.',
        category: 'MARKETING',
        tags: ['seo', 'audit', 'content', 'basecamp'],
        featured: false,
        displayOrder: 120,
        icon: '🔍',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'page_url', label: 'Page URL', type: 'text', required: true, placeholder: 'https://example.com/page' },
                { name: 'target_keywords', label: 'Target keywords', type: 'textarea', required: true, placeholder: 'Primary and secondary keywords, one per line' },
                { name: 'competitor_urls', label: 'Competitor URLs', type: 'textarea', required: false, placeholder: 'Competitor pages to benchmark against' },
                { name: 'priority', label: 'Priority area', type: 'select', required: false, options: [{ label: 'Technical SEO', value: 'technical' }, { label: 'Content & Copy', value: 'content' }, { label: 'Backlinks & Authority', value: 'backlinks' }, { label: 'Full Audit', value: 'full' }] },
            ],
        },
    },
    // ── DESIGN & CREATIVE ───────────────────────────────────────
    {
        key: 'app_image_generator',
        templateKey: 'app_image_generator',
        name: 'Image Generator with Brand Context',
        description: 'Generate on-brand creative assets from prompts with brand guidelines and art direction.',
        category: 'DESIGN',
        tags: ['image-gen', 'creative', 'brand', 'design'],
        featured: true,
        displayOrder: 130,
        icon: '🎨',
        outputType: 'image',
        inputSchema: {
            fields: [
                { name: 'prompt', label: 'Creative brief / prompt', type: 'textarea', required: true, placeholder: 'Describe the image you want to generate' },
                { name: 'brand_style', label: 'Brand style guide', type: 'textarea', required: false, placeholder: 'Colors, typography, mood, photographic style...' },
                { name: 'dimensions', label: 'Dimensions', type: 'select', required: false, options: [{ label: 'Square (1:1)', value: '1:1' }, { label: 'Landscape (16:9)', value: '16:9' }, { label: 'Portrait (9:16)', value: '9:16' }, { label: 'Banner (3:1)', value: '3:1' }] },
                { name: 'use_case', label: 'Use case', type: 'select', required: false, options: [{ label: 'Social Media', value: 'social' }, { label: 'Website Hero', value: 'hero' }, { label: 'Ad Creative', value: 'ad' }, { label: 'Blog Header', value: 'blog' }] },
            ],
        },
    },
    {
        key: 'app_design_request_brief',
        templateKey: 'app_design_request_brief',
        name: 'Design Request → Creative Brief',
        description: 'Turn messy design requests into structured briefs. Posts to Basecamp and notifies designers in Slack.',
        category: 'DESIGN',
        tags: ['design', 'brief', 'creative', 'slack'],
        featured: false,
        displayOrder: 140,
        icon: '✏️',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'request', label: 'Design request', type: 'textarea', required: true, placeholder: 'What do you need designed? Be as messy as you want, AI will structure it.' },
                { name: 'project_name', label: 'Project / client', type: 'text', required: true, placeholder: 'Which project is this for?' },
                { name: 'deadline', label: 'Deadline', type: 'text', required: true, placeholder: 'When do you need it?' },
                { name: 'deliverables', label: 'Deliverable types', type: 'select', required: false, options: [{ label: 'Social Graphics', value: 'social' }, { label: 'Web Design', value: 'web' }, { label: 'Print/PDF', value: 'print' }, { label: 'Presentation', value: 'presentation' }, { label: 'Video/Motion', value: 'video' }] },
                { name: 'brand_assets_url', label: 'Brand assets link', type: 'text', required: false, placeholder: 'Link to brand kit or Figma file' },
            ],
        },
    },
    // ── ENGINEERING & QA ────────────────────────────────────────
    {
        key: 'app_bug_triage',
        templateKey: 'app_bug_triage',
        name: 'Bug Report Triage & Task Creator',
        description: 'Classify bugs by severity, assign to developers, and create Basecamp tasks with acceptance criteria.',
        category: 'ENGINEERING',
        tags: ['bug', 'triage', 'qa', 'basecamp', 'slack'],
        featured: false,
        displayOrder: 150,
        icon: '🐛',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'bug_description', label: 'Bug description', type: 'textarea', required: true, placeholder: 'What went wrong? Steps to reproduce.' },
                { name: 'expected_behavior', label: 'Expected behavior', type: 'textarea', required: true, placeholder: 'What should have happened?' },
                { name: 'environment', label: 'Environment', type: 'select', required: true, options: [{ label: 'Production', value: 'production' }, { label: 'Staging', value: 'staging' }, { label: 'Development', value: 'development' }] },
                { name: 'browser_device', label: 'Browser / device', type: 'text', required: false, placeholder: 'e.g. Chrome 120, iPhone 15' },
                { name: 'screenshot_url', label: 'Screenshot URL', type: 'text', required: false, placeholder: 'Link to screenshot or recording' },
            ],
        },
    },
    {
        key: 'app_code_review_checklist',
        templateKey: 'app_code_review_checklist',
        name: 'PR Review Checklist',
        description: 'Generate a structured code review checklist from a PR description covering security, performance, and a11y.',
        category: 'ENGINEERING',
        tags: ['code-review', 'pr', 'checklist', 'qa'],
        featured: false,
        displayOrder: 160,
        icon: '🔎',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'pr_description', label: 'PR description', type: 'textarea', required: true, placeholder: 'What does this PR do? Copy the description.' },
                { name: 'tech_stack', label: 'Tech stack', type: 'text', required: true, placeholder: 'e.g. React, Node.js, PostgreSQL' },
                { name: 'files_changed', label: 'Key files changed', type: 'textarea', required: false, placeholder: 'List of important changed files' },
                { name: 'focus_areas', label: 'Focus areas', type: 'select', required: false, options: [{ label: 'Security', value: 'security' }, { label: 'Performance', value: 'performance' }, { label: 'Accessibility', value: 'a11y' }, { label: 'All areas', value: 'all' }] },
            ],
        },
    },
    {
        key: 'app_release_notes',
        templateKey: 'app_release_notes',
        name: 'Release Notes Generator',
        description: 'Turn commit logs into polished client-friendly release notes. Posts to Basecamp and Slack.',
        category: 'ENGINEERING',
        tags: ['release-notes', 'client', 'basecamp', 'slack'],
        featured: false,
        displayOrder: 170,
        icon: '📦',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'commits_or_prs', label: 'Commits / PR titles', type: 'textarea', required: true, placeholder: 'Paste commit messages or PR titles from this release' },
                { name: 'version', label: 'Version number', type: 'text', required: true, placeholder: 'e.g. v2.4.0' },
                { name: 'audience', label: 'Audience', type: 'select', required: true, options: [{ label: 'Client-facing', value: 'client' }, { label: 'Internal team', value: 'internal' }, { label: 'Both', value: 'both' }] },
                { name: 'highlights', label: 'Key highlights', type: 'textarea', required: false, placeholder: 'Any features to emphasize?' },
            ],
        },
    },
    // ── OPERATIONS & MANAGEMENT ─────────────────────────────────
    {
        key: 'app_triage_assistant',
        templateKey: 'app_triage_assistant',
        name: 'Request Triage Assistant',
        description: 'Classify inbound requests by urgency and type, assign ownership, and create prioritized Basecamp to-dos.',
        category: 'OPERATIONS',
        tags: ['triage', 'priority', 'ops', 'basecamp'],
        featured: false,
        displayOrder: 180,
        icon: '🚦',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'request', label: 'Request details', type: 'textarea', required: true, placeholder: 'Describe the issue, request, or task' },
                { name: 'source', label: 'Source', type: 'select', required: true, options: [{ label: 'Client', value: 'client' }, { label: 'Internal', value: 'internal' }, { label: 'Vendor', value: 'vendor' }, { label: 'Other', value: 'other' }] },
                { name: 'client_name', label: 'Client / requester', type: 'text', required: false, placeholder: 'Who is requesting this?' },
                { name: 'due_date', label: 'Due date', type: 'text', required: false, placeholder: 'When is this needed?' },
            ],
        },
    },
    {
        key: 'app_timeoff_coordinator',
        templateKey: 'app_timeoff_coordinator',
        name: 'Time-Off Request Coordinator',
        description: 'Submit PTO requests — checks conflicts, notifies managers in Slack, and updates the Basecamp schedule.',
        category: 'OPERATIONS',
        tags: ['pto', 'timeoff', 'hr', 'slack', 'schedule'],
        featured: false,
        displayOrder: 190,
        icon: '🏖️',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'employee_name', label: 'Your name', type: 'text', required: true, placeholder: 'Your name' },
                { name: 'start_date', label: 'Start date', type: 'text', required: true, placeholder: 'e.g. 2026-03-15' },
                { name: 'end_date', label: 'End date', type: 'text', required: true, placeholder: 'e.g. 2026-03-20' },
                { name: 'type', label: 'Type', type: 'select', required: true, options: [{ label: 'Vacation', value: 'vacation' }, { label: 'Sick Leave', value: 'sick' }, { label: 'Personal Day', value: 'personal' }, { label: 'Conference', value: 'conference' }] },
                { name: 'coverage_plan', label: 'Coverage plan', type: 'textarea', required: false, placeholder: 'Who will cover your responsibilities?' },
            ],
        },
    },
    {
        key: 'app_weekly_digest',
        templateKey: 'app_weekly_digest',
        name: 'Weekly Team Digest Builder',
        description: 'Compile project updates, wins, and risks into a polished weekly digest for leadership.',
        category: 'MANAGEMENT',
        tags: ['weekly-digest', 'reporting', 'management', 'basecamp'],
        featured: true,
        displayOrder: 200,
        icon: '📰',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'project_updates', label: 'Project updates', type: 'textarea', required: true, placeholder: 'Status of active projects — one per line' },
                { name: 'wins', label: 'Team wins', type: 'textarea', required: true, placeholder: 'Highlights and accomplishments' },
                { name: 'risks', label: 'Risks / blockers', type: 'textarea', required: false, placeholder: 'Any risks leadership should know about?' },
                { name: 'metrics', label: 'Key metrics', type: 'textarea', required: false, placeholder: 'Revenue, utilization %, new leads...' },
                { name: 'shoutouts', label: 'Team shoutouts', type: 'textarea', required: false, placeholder: 'Anyone who went above and beyond?' },
            ],
        },
    },
]

function toValidationError(message: string): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.VALIDATION,
        params: {
            message,
        },
    })
}

function normalizeCategory(category?: string): string {
    if (isNil(category) || category.trim().length === 0) {
        return 'GENERAL'
    }
    const normalized = category.trim().replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, '_').toUpperCase()
    return normalized.length ? normalized.slice(0, 40) : 'GENERAL'
}

function normalizeTags(tags?: string[]): string[] {
    if (isNil(tags)) {
        return []
    }
    return Array.from(new Set(tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .map((tag) => tag.slice(0, MAX_TAG_LENGTH))
        .slice(0, MAX_TAGS)))
}

function normalizeOutputType(outputType?: string): AppOutputType | null {
    if (isNil(outputType) || outputType.trim().length === 0) {
        return null
    }
    const normalized = outputType.trim().toLowerCase() as AppOutputType
    if (!ALLOWED_OUTPUT_TYPES.has(normalized)) {
        throw toValidationError(`Unsupported outputType "${outputType}". Allowed: ${Array.from(ALLOWED_OUTPUT_TYPES).join(', ')}`)
    }
    return normalized
}

function sanitizeExecutionError(error?: string): string | null {
    if (isNil(error) || error.trim().length === 0) {
        return null
    }
    return error
        .replace(/(api[_-]?key|token|authorization|password)\s*[:=]\s*['"]?([^\s,'"]+)/gi, '$1=[REDACTED]')
        .replace(/([A-Za-z0-9_\-]{24,})/g, (match) => {
            // Preserve short IDs; redact only likely secrets.
            if (match.startsWith('flow_') || match.startsWith('tmpl_') || match.startsWith('req_')) {
                return match
            }
            return '[REDACTED]'
        })
        .slice(0, 1000)
}

function summarizeFailureReason(error?: string): string {
    const safe = sanitizeExecutionError(error)
    if (isNil(safe) || safe.length === 0) {
        return 'unknown'
    }
    const firstLine = safe.split('\n')[0] ?? safe
    const firstSentence = firstLine.split('. ')[0] ?? firstLine
    return firstSentence.trim().slice(0, 80) || 'unknown'
}

function median(values: number[]): number | null {
    if (values.length === 0) {
        return null
    }
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 0) {
        return Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    }
    return sorted[middle]
}

function normalizeInputSchema(inputSchema?: Record<string, unknown>): Record<string, unknown> | null {
    if (isNil(inputSchema)) {
        return null
    }

    const raw = inputSchema as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw toValidationError('inputSchema must be an object')
    }

    let fields: Array<Record<string, unknown>> = []
    const withFields = raw as { fields?: unknown }
    if (Array.isArray(withFields.fields)) {
        fields = withFields.fields as Array<Record<string, unknown>>
    }
    else {
        fields = Object.entries(raw as Record<string, unknown>).map(([name, config]) => {
            if (typeof config === 'string') {
                return {
                    name,
                    type: config,
                    label: name,
                }
            }
            if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
                return {
                    name,
                    ...(config as Record<string, unknown>),
                }
            }
            return {
                name,
                type: 'text',
                label: name,
            }
        })
    }

    if (fields.length > MAX_SCHEMA_FIELDS) {
        throw toValidationError(`inputSchema supports at most ${MAX_SCHEMA_FIELDS} fields`)
    }

    const normalizedFields = fields.map((field, index) => {
        const nameValue = typeof field.name === 'string' ? field.name.trim() : ''
        if (!nameValue.length) {
            throw toValidationError(`inputSchema.fields[${index}].name is required`)
        }
        const safeName = nameValue.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64)
        const typeValue = typeof field.type === 'string' ? field.type.trim().toLowerCase() : 'text'
        if (!ALLOWED_INPUT_TYPES.has(typeValue as AppInputType)) {
            throw toValidationError(`inputSchema field "${safeName}" has unsupported type "${typeValue}"`)
        }
        const options = Array.isArray(field.options)
            ? field.options
                .map((option) => {
                    if (typeof option === 'string') {
                        return {
                            label: option.slice(0, 100),
                            value: option.slice(0, 100),
                        }
                    }
                    if (typeof option === 'object' && option !== null) {
                        const label = typeof (option as Record<string, unknown>).label === 'string'
                            ? ((option as Record<string, unknown>).label as string).slice(0, 100)
                            : ''
                        const value = typeof (option as Record<string, unknown>).value === 'string'
                            ? ((option as Record<string, unknown>).value as string).slice(0, 100)
                            : label
                        return {
                            label: label || value,
                            value: value || label,
                        }
                    }
                    return null
                })
                .filter((option): option is { label: string, value: string } => !isNil(option) && option.label.length > 0)
                .slice(0, 50)
            : undefined

        return {
            name: safeName,
            label: typeof field.label === 'string' && field.label.trim().length > 0 ? field.label.trim().slice(0, 120) : safeName,
            type: typeValue,
            required: Boolean(field.required),
            placeholder: typeof field.placeholder === 'string' ? field.placeholder.slice(0, 200) : '',
            ...(options ? { options } : {}),
        }
    })

    return {
        fields: normalizedFields,
    }
}

function buildSeedTags(tags: string[]): Array<{ title: string, color: string }> {
    return tags.slice(0, 6).map((tag) => ({
        title: tag,
        color: '#FF415B',
    }))
}

export const flowGalleryService = (log: FastifyBaseLogger) => ({
    /**
     * List published apps in gallery
     * Returns templates marked as PUBLISHED with optional gallery metadata
     */
    async listPublicApps({
        cursor,
        limit = 20,
        search,
        category,
        featured = false,
        platformId,
    }: ListPublicAppsParams): Promise<SeekPage<Template>> {
        const appFilters: Record<string, unknown> = {}
        if (!isNil(category)) {
            appFilters.category = Equal(category)
        }
        if (featured) {
            appFilters.featured = Equal(true)
        }
        if (!isNil(platformId)) {
            appFilters.platformId = Equal(platformId)
        }

        const galleryApps = await flowGalleryAppRepo().find({
            where: appFilters,
            order: {
                featured: 'DESC',
                displayOrder: 'ASC',
                updated: 'DESC',
            } as never,
        })

        if (galleryApps.length === 0) {
            return paginationHelper.createPage([], null)
        }

        const templateIds = galleryApps.map((item) => item.templateId)
        const templates = await templateRepo().findBy({
            id: In(templateIds),
            status: Equal(TemplateStatus.PUBLISHED),
            type: In([TemplateType.OFFICIAL, TemplateType.SHARED]),
        })
        const templateById = new Map(templates.map((template) => [template.id, template]))

        const items = galleryApps
            .map((gallery) => {
                const template = templateById.get(gallery.templateId)
                if (isNil(template)) {
                    return null
                }
                if (!isNil(search)) {
                    const searchText = `${template.name} ${template.summary ?? ''} ${template.description ?? ''}`.toLowerCase()
                    if (!searchText.includes(search.toLowerCase())) {
                        return null
                    }
                }
                return {
                    ...template,
                    galleryMetadata: gallery,
                } as Template
            })
            .filter((item): item is Template => !isNil(item))

        return paginationHelper.createPage(items.slice(0, limit), null)
    },

    /**
     * Get single app by ID with full template details
     */
    async getPublicApp({
        id,
        platformId,
    }: GetAppWithTemplateParams): Promise<(Template & { galleryMetadata?: unknown }) | null> {
        const filters: Record<string, unknown> = {
            id,
            status: Equal(TemplateStatus.PUBLISHED),
        }
        if (!isNil(platformId)) {
            filters.platformId = Equal(platformId)
        }

        const template = await templateRepo().findOneBy(filters)

        if (!template) {
            return null
        }

        // Optionally fetch gallery-specific metadata
        const galleryApp = await flowGalleryAppRepo().findOneBy({
            templateId: id,
        })

        return {
            ...template,
            galleryMetadata: galleryApp,
        }
    },

    async getPublicAppStats(appId: string): Promise<{
        runCount: number
        successCount: number
        failedCount: number
        averageExecutionMs: number | null
        medianExecutionMs: number | null
        failureBuckets: Array<{ reason: string, count: number }>
        lastExecutionAt: Date | null
    } | null> {
        const app = await flowGalleryAppRepo().findOneBy({
            templateId: appId,
        })
        if (isNil(app)) {
            return null
        }

        const recentRuns = await flowGalleryRunRepo().find({
            where: {
                appId,
            },
            order: {
                created: 'DESC',
            },
            take: 250,
        })
        const measuredExecutionTimes = recentRuns
            .filter((run) => run.status !== 'queued' && !isNil(run.executionTimeMs))
            .map((run) => Number(run.executionTimeMs))
            .filter((value) => Number.isFinite(value) && value >= 0)
        const failureMap = new Map<string, number>()
        for (const run of recentRuns) {
            if (run.status !== 'failed') {
                continue
            }
            const reason = summarizeFailureReason(run.error ?? undefined)
            failureMap.set(reason, (failureMap.get(reason) ?? 0) + 1)
        }
        const failureBuckets = Array.from(failureMap.entries())
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)

        return {
            runCount: app.runCount ?? 0,
            successCount: app.successCount ?? 0,
            failedCount: app.failedCount ?? 0,
            averageExecutionMs: app.averageExecutionMs ?? null,
            medianExecutionMs: median(measuredExecutionTimes),
            failureBuckets,
            lastExecutionAt: app.lastExecutionAt ?? null,
        }
    },

    async listPublisherApps({
        platformId,
        search,
    }: {
        platformId: string
        search?: string
    }): Promise<Array<Template & { galleryMetadata: FlowGalleryAppSchema }>> {
        const galleryApps = await flowGalleryAppRepo().find({
            where: {
                platformId,
            },
            order: {
                updated: 'DESC',
            } as never,
        })

        if (galleryApps.length === 0) {
            return []
        }

        const templateIds = galleryApps.map((app) => app.templateId)
        const templates = await templateRepo().findBy({
            id: In(templateIds),
        })
        const templateById = new Map(templates.map((template) => [template.id, template]))

        return galleryApps
            .map((gallery) => {
                const template = templateById.get(gallery.templateId)
                if (isNil(template)) {
                    return null
                }
                if (!isNil(search)) {
                    const searchText = `${template.name} ${template.summary ?? ''} ${template.description ?? ''}`.toLowerCase()
                    if (!searchText.includes(search.toLowerCase())) {
                        return null
                    }
                }
                return {
                    ...template,
                    galleryMetadata: gallery,
                }
            })
            .filter((item): item is Template & { galleryMetadata: FlowGalleryAppSchema } => !isNil(item))
    },

    async listPublisherTemplates({
        platformId,
        search,
    }: {
        platformId: string
        search?: string
    }): Promise<Template[]> {
        const queryBuilder = templateRepo()
            .createQueryBuilder('template')
            .where('template.platformId = :platformId', {
                platformId,
            })
            .andWhere('template.type IN (:...types)', {
                types: [TemplateType.CUSTOM, TemplateType.SHARED],
            })
            .orderBy('template.updated', 'DESC')

        if (!isNil(search)) {
            queryBuilder.andWhere(
                '(template.name ILIKE :search OR template.description ILIKE :search OR template.summary ILIKE :search)',
                { search: `%${search}%` },
            )
        }

        return queryBuilder.getMany()
    },

    async seedDefaultCatalog({
        platformId,
        publishedBy,
        reset = false,
    }: {
        platformId: string
        publishedBy: string
        reset?: boolean
    }): Promise<{
        templates: { created: number, updated: number, total: number }
        apps: { created: number, updated: number, skipped: number, total: number }
    }> {
        const existingTemplates = await templateRepo().findBy({
            platformId: Equal(platformId),
        })
        const templateBySeedKey = new Map<string, Template>()
        const templateByName = new Map<string, Template>()

        for (const template of existingTemplates) {
            templateByName.set(template.name.toLowerCase(), template)
            const metadata = template.metadata as Record<string, unknown> | null
            const seedKey = metadata?.appsSeedKey
            if (typeof seedKey === 'string' && seedKey.length > 0) {
                templateBySeedKey.set(seedKey, template)
            }
        }

        let templatesCreated = 0
        let templatesUpdated = 0
        const seededTemplatesByKey = new Map<string, Template>()

        for (const seed of DEFAULT_TEMPLATE_SEEDS) {
            const existing = templateBySeedKey.get(seed.key) ?? templateByName.get(seed.name.toLowerCase()) ?? null
            const nextMetadata = {
                ...(existing?.metadata as Record<string, unknown> | null ?? {}),
                appsSeedKey: seed.key,
                appsSeedVersion: DEFAULT_SEED_VERSION,
                createdByUserId: (existing?.metadata as Record<string, unknown> | null)?.createdByUserId ?? publishedBy,
            }

            if (isNil(existing)) {
                const createdTemplateId = apId()
                await templateRepo().save({
                    id: createdTemplateId,
                    name: seed.name,
                    summary: seed.summary,
                    description: seed.description,
                    type: seed.type,
                    platformId,
                    status: TemplateStatus.PUBLISHED,
                    tags: buildSeedTags(seed.tags),
                    blogUrl: null,
                    metadata: nextMetadata,
                    author: DEFAULT_SEED_AUTHOR,
                    categories: seed.categories,
                    pieces: seed.pieces,
                    flows: [],
                    tables: [],
                } as never)
                const created = await templateRepo().findOneByOrFail({
                    id: createdTemplateId,
                })
                seededTemplatesByKey.set(seed.key, created)
                templatesCreated++
                continue
            }

            const shouldPatch = reset || isNil((existing.metadata as Record<string, unknown> | null)?.appsSeedKey)
            if (shouldPatch) {
                await templateRepo().update({
                    id: existing.id,
                }, {
                    name: seed.name,
                    summary: seed.summary,
                    description: seed.description,
                    type: seed.type,
                    status: TemplateStatus.PUBLISHED,
                    tags: buildSeedTags(seed.tags),
                    metadata: nextMetadata,
                    author: DEFAULT_SEED_AUTHOR,
                    categories: seed.categories,
                    pieces: seed.pieces,
                    ...(reset ? { flows: existing.flows ?? [], tables: existing.tables ?? [] } : {}),
                } as never)
                templatesUpdated++
            }
            seededTemplatesByKey.set(seed.key, {
                ...existing,
                metadata: nextMetadata,
            })
        }

        const existingApps = await flowGalleryAppRepo().findBy({
            platformId: Equal(platformId),
        })
        const appByTemplateId = new Map(existingApps.map((app) => [app.templateId, app]))
        let appsCreated = 0
        let appsUpdated = 0
        let appsSkipped = 0

        for (const seed of DEFAULT_APP_SEEDS) {
            const template = seededTemplatesByKey.get(seed.templateKey)
            if (isNil(template)) {
                appsSkipped++
                continue
            }

            const existing = appByTemplateId.get(template.id)
            const normalizedInputSchema = normalizeInputSchema(seed.inputSchema)
            const normalizedOutputType = normalizeOutputType(seed.outputType)
            if (isNil(existing)) {
                await flowGalleryAppRepo().save({
                    id: apId(),
                    templateId: template.id,
                    platformId,
                    flowId: null,
                    description: seed.description,
                    icon: seed.icon,
                    category: normalizeCategory(seed.category),
                    tags: normalizeTags(seed.tags),
                    featured: seed.featured,
                    displayOrder: seed.displayOrder,
                    inputSchema: normalizedInputSchema,
                    outputType: normalizedOutputType,
                    outputSchema: {
                        seedKey: seed.key,
                        seedVersion: DEFAULT_SEED_VERSION,
                    },
                    publishedBy,
                    runCount: 0,
                    successCount: 0,
                    failedCount: 0,
                } as never)
                appsCreated++
                continue
            }

            const shouldPatch = reset || isNil(existing.outputSchema) || isNil((existing.outputSchema as Record<string, unknown>)?.seedKey)
            if (shouldPatch) {
                await flowGalleryAppRepo().update({
                    id: existing.id,
                }, {
                    description: seed.description,
                    icon: seed.icon,
                    category: normalizeCategory(seed.category),
                    tags: normalizeTags(seed.tags),
                    featured: seed.featured,
                    displayOrder: seed.displayOrder,
                    inputSchema: normalizedInputSchema,
                    outputType: normalizedOutputType,
                    outputSchema: {
                        seedKey: seed.key,
                        seedVersion: DEFAULT_SEED_VERSION,
                    },
                    flowId: existing.flowId ?? null,
                    publishedBy: existing.publishedBy ?? publishedBy,
                } as never)
                appsUpdated++
            }
        }

        return {
            templates: {
                created: templatesCreated,
                updated: templatesUpdated,
                total: DEFAULT_TEMPLATE_SEEDS.length,
            },
            apps: {
                created: appsCreated,
                updated: appsUpdated,
                skipped: appsSkipped,
                total: DEFAULT_APP_SEEDS.length,
            },
        }
    },

    async publishTemplateAsApp(params: PublishTemplateAsAppParams): Promise<FlowGalleryAppSchema> {
        const template = await templateRepo().findOneBy({
            id: params.templateId,
        })
        if (isNil(template)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'template',
                    entityId: params.templateId,
                    message: `Template ${params.templateId} not found`,
                },
            })
        }

        if (template.platformId !== params.platformId) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: {
                    message: 'Template does not belong to the current platform',
                },
            })
        }

        const templatePatch: Record<string, unknown> = {}
        if (template.status !== TemplateStatus.PUBLISHED) {
            templatePatch.status = TemplateStatus.PUBLISHED
        }
        if (template.type === TemplateType.CUSTOM) {
            templatePatch.type = TemplateType.SHARED
        }
        if (Object.keys(templatePatch).length > 0) {
            await templateRepo().update({ id: template.id }, templatePatch as never)
        }

        const normalizedCategory = normalizeCategory(params.category)
        const normalizedTags = normalizeTags(params.tags)
        const normalizedInputSchema = normalizeInputSchema(params.inputSchema)
        const normalizedOutputType = normalizeOutputType(params.outputType)

        const existing = await flowGalleryAppRepo().findOneBy({
            templateId: params.templateId,
            platformId: params.platformId,
        })

        if (existing) {
            const updatedPatch = {
                flowId: params.flowId ?? existing.flowId ?? null,
                description: params.description ?? existing.description ?? null,
                icon: params.icon ?? existing.icon ?? null,
                category: params.category ? normalizedCategory : (existing.category ?? 'GENERAL'),
                tags: params.tags ? normalizedTags : (existing.tags ?? []),
                featured: params.featured ?? existing.featured ?? false,
                displayOrder: params.displayOrder ?? existing.displayOrder ?? 0,
                inputSchema: params.inputSchema ? normalizedInputSchema : (existing.inputSchema ?? null),
                outputType: params.outputType ? normalizedOutputType : (existing.outputType ?? null),
                outputSchema: params.outputSchema ?? existing.outputSchema ?? null,
                publishedBy: params.publishedBy ?? existing.publishedBy ?? null,
            }

            await flowGalleryAppRepo().update({ id: existing.id }, updatedPatch as never)
            const saved = await flowGalleryAppRepo().findOneBy({ id: existing.id })
            if (isNil(saved)) {
                throw new ActivepiecesError({
                    code: ErrorCode.ENTITY_NOT_FOUND,
                    params: {
                        entityType: 'flow_gallery_app',
                        entityId: existing.id,
                        message: 'Failed to reload published app after update',
                    },
                })
            }
            return saved
        }

        const appId = apId()
        await flowGalleryAppRepo().insert({
            id: appId,
            templateId: params.templateId,
            platformId: params.platformId,
            flowId: params.flowId ?? null,
            description: params.description ?? null,
            icon: params.icon ?? null,
            category: normalizedCategory,
            tags: normalizedTags,
            featured: params.featured ?? false,
            displayOrder: params.displayOrder ?? 0,
            inputSchema: normalizedInputSchema,
            outputType: normalizedOutputType,
            outputSchema: params.outputSchema ?? null,
            publishedBy: params.publishedBy,
        } as never)

        const created = await flowGalleryAppRepo().findOneBy({ id: appId })
        if (isNil(created)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'flow_gallery_app',
                    entityId: appId,
                    message: 'Failed to load published app after creation',
                },
            })
        }
        return created
    },

    async updatePublishedApp(params: UpdatePublishedAppParams): Promise<FlowGalleryAppSchema> {
        const existing = await flowGalleryAppRepo().findOneBy({
            templateId: params.templateId,
            platformId: params.platformId,
        })
        if (isNil(existing)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'flow_gallery_app',
                    entityId: params.templateId,
                    message: `Published app ${params.templateId} not found`,
                },
            })
        }

        const normalizedCategory = !isNil(params.category) ? normalizeCategory(params.category) : undefined
        const normalizedTags = !isNil(params.tags) ? normalizeTags(params.tags) : undefined
        const normalizedInputSchema = !isNil(params.inputSchema) ? normalizeInputSchema(params.inputSchema) : undefined
        const normalizedOutputType = !isNil(params.outputType) ? normalizeOutputType(params.outputType) : undefined

        const updatedPatch = {
            flowId: params.flowId ?? existing.flowId,
            description: params.description ?? existing.description,
            icon: params.icon ?? existing.icon,
            category: normalizedCategory ?? existing.category,
            tags: normalizedTags ?? existing.tags,
            featured: params.featured ?? existing.featured,
            displayOrder: params.displayOrder ?? existing.displayOrder,
            inputSchema: normalizedInputSchema ?? existing.inputSchema,
            outputType: normalizedOutputType ?? existing.outputType,
            outputSchema: params.outputSchema ?? existing.outputSchema,
        }

        await flowGalleryAppRepo().update({ id: existing.id }, updatedPatch as never)
        const saved = await flowGalleryAppRepo().findOneBy({ id: existing.id })
        if (isNil(saved)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'flow_gallery_app',
                    entityId: existing.id,
                    message: 'Failed to reload published app after metadata update',
                },
            })
        }
        return saved
    },

    async getPublishedAppByTemplate({
        templateId,
        platformId,
    }: {
        templateId: string
        platformId: string
    }): Promise<FlowGalleryAppSchema | null> {
        return flowGalleryAppRepo().findOneBy({
            templateId,
            platformId,
        })
    },

    async unpublishTemplateApp({
        templateId,
        platformId,
    }: {
        templateId: string
        platformId: string
    }): Promise<void> {
        await flowGalleryAppRepo().delete({
            templateId,
            platformId,
        })
    },

    async executePublicApp({
        appId,
        inputs,
        mode = 'sync',
    }: ExecuteFlowParams & { mode?: ExecuteMode }): Promise<EngineHttpResponse> {
        const app = await flowGalleryAppRepo().findOneBy({
            templateId: appId,
        })

        if (isNil(app)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'flow_gallery_app',
                    entityId: appId,
                    message: `Published app ${appId} not found`,
                },
            })
        }

        if (isNil(app.flowId) || app.flowId.trim().length === 0) {
            throw toValidationError('This app is a starter draft and is not linked to a workflow yet. Open /apps/publisher and set flowId to enable execution.')
        }

        const flowIdToExecute = app.flowId ?? app.templateId
        const payload: EventPayload = {
            body: inputs,
            headers: {
                [PARENT_RUN_ID_HEADER]: '',
                [FAIL_PARENT_ON_FAILURE_HEADER]: 'false',
            },
            method: 'POST',
            queryParams: {},
        }

        return webhookService.handleWebhook({
            logger: log,
            flowId: flowIdToExecute,
            async: mode === 'async',
            saveSampleData: false,
            flowVersionToRun: WebhookFlowVersionToRun.LOCKED_FALL_BACK_TO_LATEST,
            payload,
            execute: true,
            data: async () => payload,
            failParentOnFailure: false,
        })
    },

    /**
     * Get app flow data for form generation
     * Extracts input schema from template flows
     */
    async getAppFlowSchema(templateId: string): Promise<{
        flowId: string
        version: number
        inputSchema: unknown
    } | null> {
        const template = await templateRepo().findOneBy({ id: templateId })

        if (!template || !template.flows || !Array.isArray(template.flows) || template.flows.length === 0) {
            return null
        }

        return {
            flowId: templateId,
            version: 1,
            inputSchema: {},
        }
    },

    /**
     * Log app execution for analytics
     * Tracks usage patterns and performance
     */
    async listRecentRuns({
        templateId,
        limit = 10,
    }: {
        templateId: string
        limit?: number
    }): Promise<Array<{
        id: string
        created: string
        status: 'queued' | 'success' | 'failed'
        executionTimeMs: number | null
        outputType: string | null
        error: string | null
    }>> {
        const rows = await flowGalleryRunRepo().find({
            where: {
                appId: templateId,
            },
            order: {
                created: 'DESC',
            },
            take: Math.max(1, Math.min(limit, 50)),
        })

        return rows.map((row) => ({
            id: row.id,
            created: row.created.toISOString(),
            status: row.status,
            executionTimeMs: row.executionTimeMs ?? null,
            outputType: row.outputType ?? null,
            error: row.error ?? null,
        }))
    },

    async logExecution({
        templateId,
        executionStatus,
        executionTimeMs,
        outputs,
        error,
        inputKeys,
        requestId,
    }: {
        templateId: string
        executionStatus: 'queued' | 'success' | 'failed'
        executionTimeMs: number
        outputs?: unknown
        error?: string
        inputKeys?: string[]
        requestId?: string
    }): Promise<void> {
        const app = await flowGalleryAppRepo().findOneBy({
            templateId,
        })
        const safeError = sanitizeExecutionError(error)
        if (!isNil(app)) {
            // Use atomic increments to prevent race conditions under concurrent load
            const qb = flowGalleryAppRepo().createQueryBuilder()
                .update()
                .set({
                    runCount: () => '"runCount" + 1',
                    successCount: executionStatus === 'success' ? () => '"successCount" + 1' : undefined,
                    failedCount: executionStatus === 'failed' ? () => '"failedCount" + 1' : undefined,
                    lastExecutionAt: new Date(),
                    lastError: safeError,
                } as never)
                .where('id = :id', { id: app.id })
            await qb.execute()
        }

        const outputType = isNil(outputs)
            ? null
            : Array.isArray(outputs)
                ? 'array'
                : typeof outputs === 'object'
                    ? 'json'
                    : typeof outputs

        await flowGalleryRunRepo().save({
            id: apId(),
            appId: templateId,
            status: executionStatus,
            executionTimeMs: executionTimeMs > 0 ? executionTimeMs : null,
            inputKeys: inputKeys?.slice(0, 50) ?? null,
            outputType,
            error: safeError,
            requestId: requestId?.slice(0, 120) ?? null,
        } as never)

        log.info({
            msg: 'Flow Gallery App Execution',
            templateId,
            status: executionStatus,
            timeMs: executionTimeMs,
            hasError: !!safeError,
        })
    },
})

