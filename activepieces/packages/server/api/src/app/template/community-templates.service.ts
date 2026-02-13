import {
    ActivepiecesError,
    ErrorCode,
    isNil,
    ListTemplatesRequestQuery,
    SeekPage,
    Template,
    TemplateStatus,
    TemplateType,
    FlowTriggerType,
    FlowActionType,
    PropertyExecutionType,
} from '@activepieces/shared'

const TEMPLATES_SOURCE_URL = 'https://cloud.activepieces.com/api/v1/templates'
const CLOUD_FETCH_TIMEOUT_MS = 15000
const LIST_CACHE_TTL_MS = 5 * 60 * 1000
const LIST_CACHE_STALE_TTL_MS = 12 * 60 * 60 * 1000
const TEMPLATE_CACHE_TTL_MS = 60 * 60 * 1000
const TEMPLATE_CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000
const CATEGORIES_CACHE_TTL_MS = 60 * 60 * 1000
const CATEGORIES_CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000

type CacheEntry<T> = {
    value: T
    fetchedAtMs: number
}

const listCache = new Map<string, CacheEntry<SeekPage<Template>>>()
const listInFlight = new Map<string, Promise<void>>()
let categoriesCache: CacheEntry<string[]> | null = null
let categoriesInFlight: Promise<void> | null = null
const templateCache = new Map<string, CacheEntry<Template>>()
const templateInFlight = new Map<string, Promise<void>>()
let lastRemoteTemplatesErrorLogAtMs = 0
const LOCAL_TEMPLATES: Template[] = buildLocalTemplates()
const LOCAL_CATEGORIES = Array.from(
    new Set(LOCAL_TEMPLATES.flatMap((t) => t.categories || [])),
)
export const communityTemplates = {
    getOrThrow: async (id: string): Promise<Template> => {
        const local = LOCAL_TEMPLATES.find((t) => t.id === id)
        if (local) {
            return local
        }

        const cached = templateCache.get(id)
        if (cached && isFresh(cached, TEMPLATE_CACHE_TTL_MS)) {
            return cached.value
        }
        if (cached && isStaleOk(cached, TEMPLATE_CACHE_STALE_TTL_MS)) {
            refreshTemplateAsync(id)
            return cached.value
        }

        const remote = await fetchRemoteTemplate(id)
        if (!remote) {
            if (cached) {
                return cached.value
            }
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'template',
                    entityId: id,
                    message: 'Templates service is temporarily unavailable. Please try again in a moment.',
                },
            })
        }
        templateCache.set(id, { value: remote, fetchedAtMs: Date.now() })
        return remote
    },
    getCategories: async (): Promise<string[]> => {
        if (categoriesCache && isFresh(categoriesCache, CATEGORIES_CACHE_TTL_MS)) {
            return categoriesCache.value
        }
        if (categoriesCache && isStaleOk(categoriesCache, CATEGORIES_CACHE_STALE_TTL_MS)) {
            refreshCategoriesAsync()
            return categoriesCache.value
        }

        const url = `${TEMPLATES_SOURCE_URL}/categories`
        const payload: unknown = await fetchJsonOrNull(url)
        if (!payload) {
            return Array.from(new Set([...LOCAL_CATEGORIES]))
        }

        const remoteCategoriesRaw: unknown =
            Array.isArray(payload)
                ? payload
                : payload != null && typeof payload === 'object' && 'value' in payload
                    ? (payload as { value?: unknown }).value
                    : payload != null && typeof payload === 'object' && 'data' in payload
                        ? (payload as { data?: unknown }).data
                        : []

        const remoteCategories = Array.isArray(remoteCategoriesRaw)
            ? remoteCategoriesRaw.filter((c): c is string => typeof c === 'string')
            : []

        const merged = Array.from(new Set([...remoteCategories, ...LOCAL_CATEGORIES]))
        categoriesCache = { value: merged, fetchedAtMs: Date.now() }
        return merged
    },
    list: async (request: ListTemplatesRequestQuery): Promise<SeekPage<Template>> => {
        const queryString = convertToQueryString(request)
        const url = `${TEMPLATES_SOURCE_URL}?${queryString}`
        const cached = listCache.get(queryString)
        if (cached && isFresh(cached, LIST_CACHE_TTL_MS)) {
            return mergeLocalTemplates(cached.value, request)
        }
        if (cached && isStaleOk(cached, LIST_CACHE_STALE_TTL_MS)) {
            refreshListAsync(queryString, url)
            return mergeLocalTemplates(cached.value, request)
        }

        const remote = await fetchRemoteList(url)
        if (remote) {
            listCache.set(queryString, { value: remote, fetchedAtMs: Date.now() })
            return mergeLocalTemplates(remote, request)
        }
        if (cached) {
            return mergeLocalTemplates(cached.value, request)
        }
        const localMatches = filterTemplates(LOCAL_TEMPLATES, request)
        return {
            data: localMatches,
            next: null,
            previous: null,
        }
    },
}

function filterTemplates(templates: Template[], request: ListTemplatesRequestQuery): Template[] {
    const search = request.search ? request.search.toLowerCase() : null
    return templates.filter((template) => {
        if (request.type && template.type !== request.type) {
            return false
        }
        if (request.category && !(template.categories || []).includes(request.category)) {
            return false
        }
        if (request.pieces?.length) {
            const hasPiece = request.pieces.some((piece) =>
                (template.pieces || []).includes(piece),
            )
            if (!hasPiece) return false
        }
        if (request.tags?.length) {
            const tagTitles = (template.tags || []).map((t) => t.title)
            const hasTag = request.tags.some((tag) => tagTitles.includes(tag))
            if (!hasTag) return false
        }
        if (search) {
            const haystack = `${template.name} ${template.summary} ${template.description}`.toLowerCase()
            if (!haystack.includes(search)) return false
        }
        return true
    })
}

function buildLocalTemplates(): Template[] {
    const now = new Date().toISOString()

    const tpl = (
        id: string,
        name: string,
        summary: string,
        description: string,
        categories: string[],
        pieces: string[],
        tags: Array<{ title: string; color?: string; icon?: string }>,
        flows: unknown[] = [],
    ): Template => ({
        id,
        created: now,
        updated: now,
        name,
        summary,
        description,
        tags,
        blogUrl: null,
        metadata: null,
        author: 'Wicked Flow',
        categories,
        pieces,
        platformId: null,
        flows: flows as Template['flows'],
        tables: [],
        status: TemplateStatus.PUBLISHED,
        type: TemplateType.OFFICIAL,
    })

    const bcTag = { title: 'Basecamp', color: '#FF415B', icon: '/branding/basecamp.svg' }
    const slackTag = { title: 'Slack', color: '#4A154B' }
    const aiTag = { title: 'AI', color: '#7C3AED' }
    const fathomTag = { title: 'Fathom', color: '#1D4ED8' }

    return [
        // ── Original ────────────────────────────────────────────
        tpl(
            'wickedflow-basecamp-todo-slack-whatsapp',
            'New Basecamp Todo → Slack + WhatsApp',
            'Notify Slack and WhatsApp when a new Basecamp todo is created.',
            'Watches a Basecamp project for new todos and notifies both Slack and WhatsApp.',
            ['Basecamp', 'Operations', 'Everyday'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-whatsapp'],
            [bcTag, slackTag, { title: 'WhatsApp', color: '#25D366' }],
            [buildBasecampSlackWhatsappFlow()],
        ),

        // ── PROJECT MANAGEMENT ──────────────────────────────────
        tpl(
            'wickedflow-meeting-notes-tasks',
            'Meeting Notes → Basecamp Tasks',
            'Turn Fathom call notes into assigned Basecamp tasks.',
            'Parses meeting transcripts from Fathom, extracts action items with owners and due dates, and creates organized Basecamp to-do lists per project. Great for PMs after client or standup calls.',
            ['Basecamp', 'Product', 'Everyday', 'Featured'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, fathomTag, aiTag],
            [buildWebhookToBasecampFlow('Meeting Notes → Tasks', 'Parse meeting notes and create Basecamp tasks with owners and due dates')],
        ),
        tpl(
            'wickedflow-kickoff-builder',
            'Project Kickoff Builder',
            'Convert scope into kickoff tasks and sprint checklist.',
            'Takes project scope, timeline, and constraints to generate a complete kickoff packet with Basecamp to-do lists, message board topics, and first-sprint backlog.',
            ['Basecamp', 'Product', 'Featured'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, aiTag],
            [buildWebhookToBasecampFlow('Kickoff Builder', 'Generate kickoff checklist and sprint tasks from project scope')],
        ),
        tpl(
            'wickedflow-retro-summarizer',
            'Sprint Retro Summarizer',
            'Summarize retro notes into action items and Basecamp updates.',
            'Collects what went well, what didn\'t, and improvement ideas from a sprint retrospective. Produces a structured summary, posts it to Basecamp message board, and creates follow-up to-dos.',
            ['Basecamp', 'Product', 'Engineering'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, aiTag],
            [buildWebhookToBasecampFlow('Retro Summarizer', 'Summarize retrospective feedback and create improvement to-dos')],
        ),
        tpl(
            'wickedflow-standup-digest',
            'Daily Standup → Slack Digest',
            'Collect async standups and post a team digest to Slack.',
            'Team members submit their standup (yesterday, today, blockers) via a simple form. The flow aggregates responses, highlights blockers, and posts a formatted digest to Slack with a Basecamp campfire summary.',
            ['Basecamp', 'Product', 'Everyday'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
            [bcTag, slackTag, aiTag],
            [buildWebhookToSlackFlow('Standup Digest', 'Aggregate standup updates and post team digest')],
        ),

        // ── CLIENT SUCCESS ──────────────────────────────────────
        tpl(
            'wickedflow-client-update-writer',
            'Client Update Writer',
            'Draft weekly client updates from wins, blockers, and next steps.',
            'Takes this week\'s wins, blockers, and next steps and generates a polished, professional client status email in your agency\'s voice. Optionally posts to Basecamp message board.',
            ['Basecamp', 'Customer Service', 'Featured'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, aiTag],
            [buildWebhookToBasecampFlow('Client Update Writer', 'Generate polished client status updates')],
        ),
        tpl(
            'wickedflow-client-onboarding',
            'Client Onboarding Checklist Generator',
            'Generate a complete onboarding checklist for new clients.',
            'Input client type, project scope, and team size to generate a tailored onboarding checklist. Creates Basecamp project with to-do lists for credentials, brand assets, access setup, kickoff scheduling, and welcome comms.',
            ['Basecamp', 'Customer Service', 'Operations'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, aiTag],
            [buildWebhookToBasecampFlow('Onboarding Checklist', 'Generate client onboarding to-do lists')],
        ),
        tpl(
            'wickedflow-nps-followup',
            'NPS Score → Follow-up Actions',
            'Route NPS responses to the right team action.',
            'Receives NPS survey responses, classifies sentiment, and routes accordingly — promoters get referral asks via Slack, passives get check-in tasks in Basecamp, detractors trigger escalation alerts to management.',
            ['Basecamp', 'Customer Service', 'Sales'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
            [bcTag, slackTag, aiTag],
            [buildWebhookToSlackFlow('NPS Follow-up', 'Route NPS responses to appropriate team actions')],
        ),

        // ── SALES ───────────────────────────────────────────────
        tpl(
            'wickedflow-lead-qualifier',
            'Lead Qualifier & CRM Router',
            'Score inbound leads and route to the right salesperson.',
            'Takes lead details (company, budget, timeline, needs) and uses AI to score fit, assign priority, and route to the right team member. Creates a qualified lead to-do in Basecamp and posts a Slack notification.',
            ['Basecamp', 'Sales', 'Featured'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
            [bcTag, slackTag, aiTag],
            [buildWebhookToSlackFlow('Lead Qualifier', 'Score and route inbound leads')],
        ),
        tpl(
            'wickedflow-proposal-draft',
            'Proposal Draft Generator',
            'Generate a proposal draft from discovery call notes.',
            'Input discovery call notes, budget range, and project type to generate a complete proposal draft with scope, timeline, pricing tiers, and terms. Outputs polished markdown ready for review.',
            ['Sales', 'Basecamp', 'Featured'],
            ['@activepieces/piece-webhook'],
            [aiTag, fathomTag],
            [buildWebhookFlow('Proposal Draft', 'Generate proposal from discovery notes')],
        ),

        // ── MARKETING ───────────────────────────────────────────
        tpl(
            'wickedflow-campaign-planner',
            'Campaign Brief → Content Plan',
            'Turn campaign goals into a channel-by-channel content plan.',
            'Takes campaign objectives, target audience, budget, and timeline to generate a production-ready content plan with channel strategy, asset requirements, copy angles, and a due-date checklist as Basecamp to-dos.',
            ['Marketing', 'Basecamp'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, aiTag],
            [buildWebhookToBasecampFlow('Campaign Planner', 'Generate content plan from campaign brief')],
        ),
        tpl(
            'wickedflow-social-post-gen',
            'Social Post Generator',
            'Generate platform-specific social posts from a single brief.',
            'Provide a topic, key message, and brand voice to generate tailored posts for LinkedIn, Twitter/X, Instagram, and Facebook. Includes hashtag suggestions, optimal posting times, and image direction notes.',
            ['Marketing', 'Everyday'],
            ['@activepieces/piece-webhook'],
            [aiTag, { title: 'Content', color: '#EC4899' }],
            [buildWebhookFlow('Social Post Generator', 'Generate multi-platform social posts')],
        ),
        tpl(
            'wickedflow-seo-audit',
            'SEO Page Audit & Brief',
            'Analyze a URL and generate an SEO improvement brief.',
            'Input a page URL and target keywords to get a structured SEO audit with title/meta suggestions, content gaps, internal linking opportunities, and a prioritized action list as Basecamp to-dos.',
            ['Marketing', 'Engineering', 'Basecamp'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, aiTag],
            [buildWebhookToBasecampFlow('SEO Audit', 'Analyze URL and generate SEO improvement actions')],
        ),

        // ── DESIGN ──────────────────────────────────────────────
        tpl(
            'wickedflow-image-generator',
            'Image Generator with Brand Context',
            'Generate creative assets from brand context and prompt.',
            'Provide a creative brief, brand guidelines, and art direction to generate on-brand image concepts. Supports campaign assets, social graphics, and hero images with style consistency.',
            ['Marketing', 'Product', 'Featured'],
            ['@activepieces/piece-webhook'],
            [aiTag, { title: 'Design', color: '#F59E0B' }],
            [buildWebhookFlow('Image Generator', 'Generate branded image concepts from creative briefs')],
        ),
        tpl(
            'wickedflow-design-request-brief',
            'Design Request → Creative Brief',
            'Turn messy design requests into structured creative briefs.',
            'Standardizes free-form design requests into a complete creative brief with objectives, deliverables, dimensions, copy, brand guidelines, and deadline. Posts the brief to Basecamp and notifies the design channel in Slack.',
            ['Basecamp', 'Product', 'Operations'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
            [bcTag, slackTag, aiTag],
            [buildWebhookToSlackFlow('Design Brief Generator', 'Structure design requests into creative briefs')],
        ),

        // ── ENGINEERING ─────────────────────────────────────────
        tpl(
            'wickedflow-bug-triage',
            'Bug Report Triage & Task Creator',
            'Classify bugs by severity and create prioritized Basecamp tasks.',
            'Receives bug reports with steps to reproduce, classifies severity (critical/high/medium/low), assigns to the right developer, and creates a detailed Basecamp to-do with acceptance criteria. Critical bugs trigger a Slack alert.',
            ['Engineering', 'Basecamp'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
            [bcTag, slackTag, aiTag],
            [buildWebhookToSlackFlow('Bug Triage', 'Classify and route bug reports')],
        ),
        tpl(
            'wickedflow-pr-review-checklist',
            'PR Review Checklist Generator',
            'Generate a code review checklist from PR description.',
            'Input a pull request description, tech stack, and changed files summary to generate a structured review checklist covering security, performance, accessibility, testing, and coding standards.',
            ['Engineering', 'Basecamp'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, aiTag],
            [buildWebhookToBasecampFlow('PR Review Checklist', 'Generate code review checklist from PR description')],
        ),
        tpl(
            'wickedflow-release-notes',
            'Release Notes Generator',
            'Generate client-friendly release notes from commit/PR logs.',
            'Provide raw commit messages or PR titles from a release and get polished, client-friendly release notes organized by feature, fix, and improvement. Posts to Basecamp message board and Slack channel.',
            ['Engineering', 'Customer Service', 'Basecamp'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
            [bcTag, slackTag, aiTag],
            [buildWebhookToSlackFlow('Release Notes', 'Generate polished release notes from commits')],
        ),

        // ── OPERATIONS & HR ─────────────────────────────────────
        tpl(
            'wickedflow-triage-assistant',
            'Request Triage Assistant',
            'Triage inbound requests into priority and ownership.',
            'Classifies incoming requests (client, internal, vendor) by urgency and type, assigns ownership based on team rules, and creates prioritized Basecamp to-dos with SLA deadlines.',
            ['Operations', 'Basecamp', 'Everyday'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
            [bcTag, aiTag],
            [buildWebhookToBasecampFlow('Triage Assistant', 'Classify and route inbound requests')],
        ),
        tpl(
            'wickedflow-timeoff-coordinator',
            'Time-Off Request Coordinator',
            'Process PTO requests and update team availability.',
            'Team members submit PTO requests with dates and coverage plan. The flow checks for conflicts, notifies the manager in Slack, creates a Basecamp schedule entry, and updates the team availability board.',
            ['HR', 'Operations', 'Basecamp'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
            [bcTag, slackTag],
            [buildWebhookToSlackFlow('Time-Off Coordinator', 'Process PTO requests and notify team')],
        ),
        tpl(
            'wickedflow-weekly-digest',
            'Weekly Team Digest Builder',
            'Compile team highlights into a weekly digest for leadership.',
            'Collects project updates, metrics, wins, and risks from across the team and compiles them into a polished weekly digest. Posts to Basecamp message board and sends a summary to the leadership Slack channel.',
            ['Operations', 'Basecamp', 'Featured'],
            ['@activepieces/piece-basecamp', '@activepieces/piece-slack', '@activepieces/piece-webhook'],
            [bcTag, slackTag, aiTag],
            [buildWebhookToSlackFlow('Weekly Digest', 'Compile team updates into leadership digest')],
        ),
    ]
}

// ── Generic flow builders for seed templates ──────────────────────

function buildWebhookFlow(displayName: string, description: string) {
    return {
        displayName,
        description,
        valid: true,
        schemaVersion: '16',
        notes: [],
        trigger: {
            name: 'trigger',
            displayName: 'Receive Input',
            type: FlowTriggerType.PIECE,
            valid: true,
            settings: {
                pieceName: '@activepieces/piece-webhook',
                pieceVersion: '0.1.0',
                triggerName: 'catch_raw_webhook',
                input: {},
                propertySettings: {},
            },
            nextAction: {
                name: 'ai_process',
                displayName: 'Process with AI',
                type: FlowActionType.CODE,
                valid: true,
                settings: {
                    input: { prompt: '{{trigger.body}}' },
                    sourceCode: {
                        code: `export const code = async (inputs) => {\n  // ${description}\n  return { result: inputs.prompt };\n};`,
                        packageJson: '{}',
                    },
                    errorHandlingOptions: {},
                },
                nextAction: undefined,
            },
        },
    }
}

function buildWebhookToBasecampFlow(displayName: string, description: string) {
    return {
        displayName,
        description,
        valid: true,
        schemaVersion: '16',
        notes: [],
        trigger: {
            name: 'trigger',
            displayName: 'Receive Input',
            type: FlowTriggerType.PIECE,
            valid: true,
            settings: {
                pieceName: '@activepieces/piece-webhook',
                pieceVersion: '0.1.0',
                triggerName: 'catch_raw_webhook',
                input: {},
                propertySettings: {},
            },
            nextAction: {
                name: 'ai_process',
                displayName: 'Process with AI',
                type: FlowActionType.CODE,
                valid: true,
                settings: {
                    input: { prompt: '{{trigger.body}}' },
                    sourceCode: {
                        code: `export const code = async (inputs) => {\n  // ${description}\n  return { title: inputs.prompt, assignee: 'team' };\n};`,
                        packageJson: '{}',
                    },
                    errorHandlingOptions: {},
                },
                nextAction: {
                    name: 'create_todo',
                    displayName: 'Create Basecamp Todo',
                    type: FlowActionType.PIECE,
                    valid: true,
                    settings: {
                        pieceName: '@activepieces/piece-basecamp',
                        pieceVersion: '0.0.1',
                        actionName: 'create_todo',
                        input: {
                            project: '',
                            todolist: '',
                            content: '{{ai_process.title}}',
                        },
                        propertySettings: {
                            project: { type: PropertyExecutionType.MANUAL },
                            todolist: { type: PropertyExecutionType.MANUAL },
                            content: { type: PropertyExecutionType.MANUAL },
                        },
                        errorHandlingOptions: {},
                    },
                    nextAction: undefined,
                },
            },
        },
    }
}

function buildWebhookToSlackFlow(displayName: string, description: string) {
    return {
        displayName,
        description,
        valid: true,
        schemaVersion: '16',
        notes: [],
        trigger: {
            name: 'trigger',
            displayName: 'Receive Input',
            type: FlowTriggerType.PIECE,
            valid: true,
            settings: {
                pieceName: '@activepieces/piece-webhook',
                pieceVersion: '0.1.0',
                triggerName: 'catch_raw_webhook',
                input: {},
                propertySettings: {},
            },
            nextAction: {
                name: 'ai_process',
                displayName: 'Process with AI',
                type: FlowActionType.CODE,
                valid: true,
                settings: {
                    input: { prompt: '{{trigger.body}}' },
                    sourceCode: {
                        code: `export const code = async (inputs) => {\n  // ${description}\n  return { message: inputs.prompt };\n};`,
                        packageJson: '{}',
                    },
                    errorHandlingOptions: {},
                },
                nextAction: {
                    name: 'slack_notify',
                    displayName: 'Send Slack Message',
                    type: FlowActionType.PIECE,
                    valid: true,
                    settings: {
                        pieceName: '@activepieces/piece-slack',
                        pieceVersion: '0.11.5',
                        actionName: 'send_channel_message',
                        input: {
                            channel: '',
                            text: '{{ai_process.message}}',
                            sendAsBot: true,
                        },
                        propertySettings: {
                            channel: { type: PropertyExecutionType.MANUAL },
                            text: { type: PropertyExecutionType.MANUAL },
                            sendAsBot: { type: PropertyExecutionType.MANUAL },
                        },
                        errorHandlingOptions: {},
                    },
                    nextAction: undefined,
                },
            },
        },
    }
}

function buildBasecampSlackWhatsappFlow() {
    const basecampTrigger = {
        name: 'trigger',
        displayName: 'New Todo',
        type: FlowTriggerType.PIECE,
        valid: true,
        settings: {
            pieceName: '@activepieces/piece-basecamp',
            pieceVersion: '0.0.1',
            triggerName: 'new_todo',
            input: {
                project: '',
            },
            propertySettings: {
                project: { type: PropertyExecutionType.MANUAL },
            },
        },
        nextAction: buildSlackAction(),
    }

    return {
        displayName: 'Basecamp Todo Notifications',
        trigger: basecampTrigger,
        valid: true,
        schemaVersion: '16',
        description: 'Send new Basecamp todos to Slack and WhatsApp.',
        notes: [],
    }
}

function buildSlackAction() {
    return {
        name: 'slack_notify',
        displayName: 'Send Slack Message',
        type: FlowActionType.PIECE,
        valid: true,
        settings: {
            pieceName: '@activepieces/piece-slack',
            pieceVersion: '0.11.5',
            actionName: 'send_channel_message',
            input: {
                channel: '',
                text: 'New Basecamp todo: {{trigger.content}} ({{trigger.project.name}})',
                sendAsBot: true,
            },
            propertySettings: {
                channel: { type: PropertyExecutionType.MANUAL },
                text: { type: PropertyExecutionType.MANUAL },
                sendAsBot: { type: PropertyExecutionType.MANUAL },
            },
            errorHandlingOptions: {},
        },
        nextAction: buildWhatsappAction(),
    }
}

function buildWhatsappAction() {
    return {
        name: 'whatsapp_notify',
        displayName: 'Send WhatsApp Message',
        type: FlowActionType.PIECE,
        valid: true,
        settings: {
            pieceName: '@activepieces/piece-whatsapp',
            pieceVersion: '0.2.1',
            actionName: 'sendMessage',
            input: {
                phone_number_id: '',
                to: '',
                text: 'New Basecamp todo: {{trigger.content}} ({{trigger.project.name}})',
            },
            propertySettings: {
                phone_number_id: { type: PropertyExecutionType.MANUAL },
                to: { type: PropertyExecutionType.MANUAL },
                text: { type: PropertyExecutionType.MANUAL },
            },
            errorHandlingOptions: {},
        },
        nextAction: undefined,
    }
}

function convertToQueryString(params: ListTemplatesRequestQuery): string {
    const searchParams = new URLSearchParams()

    Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach((val) => {
                if (!isNil(val)) {
                    searchParams.append(key, typeof val === 'string' ? val : JSON.stringify(val))
                }
            })
        }
        else if (!isNil(value)) {
            searchParams.set(key, value.toString())
        }
    })

    return searchParams.toString()
}

function isFresh<T>(entry: CacheEntry<T>, ttlMs: number): boolean {
    return Date.now() - entry.fetchedAtMs < ttlMs
}

function isStaleOk<T>(entry: CacheEntry<T>, staleTtlMs: number): boolean {
    return Date.now() - entry.fetchedAtMs < staleTtlMs
}

function logRemoteTemplatesError(message: string, error?: unknown): void {
    const now = Date.now()
    if (now - lastRemoteTemplatesErrorLogAtMs < 5 * 60 * 1000) {
        return
    }
    lastRemoteTemplatesErrorLogAtMs = now
    // eslint-disable-next-line no-console
    console.error(`[communityTemplates] ${message}`, error)
}

async function fetchJsonOrNull(url: string): Promise<unknown | null> {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
            return null
        }
        return await response.json()
    }
    catch (error) {
        return null
    }
}

function extractSeekPage(payload: unknown): SeekPage<Template> | null {
    const candidates: unknown[] = [payload]
    if (payload != null && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>
        if ('value' in obj) candidates.push(obj.value)
        if ('data' in obj) candidates.push(obj.data)
    }

    for (const candidate of candidates) {
        if (candidate == null || typeof candidate !== 'object') {
            continue
        }
        const obj = candidate as Record<string, unknown>
        if (Array.isArray(obj.data)) {
            return {
                data: obj.data as Template[],
                next: (obj.next as string | null | undefined) ?? null,
                previous: (obj.previous as string | null | undefined) ?? null,
            }
        }
    }
    return null
}

async function fetchRemoteList(url: string): Promise<SeekPage<Template> | null> {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
            logRemoteTemplatesError(`Remote templates list returned ${response.status} for ${url}`)
            return null
        }
        const payload = await response.json()
        const page = extractSeekPage(payload)
        if (!page) {
            logRemoteTemplatesError(`Remote templates list returned unexpected payload for ${url}`)
            return null
        }
        return page
    }
    catch (error) {
        logRemoteTemplatesError(`Remote templates list failed for ${url}`, error)
        return null
    }
}

function refreshListAsync(cacheKey: string, url: string): void {
    if (listInFlight.has(cacheKey)) {
        return
    }
    const promise = fetchRemoteList(url)
        .then((page) => {
            if (page) {
                listCache.set(cacheKey, { value: page, fetchedAtMs: Date.now() })
            }
        })
        .catch(() => undefined)
        .finally(() => {
            listInFlight.delete(cacheKey)
        })
    listInFlight.set(cacheKey, promise)
}

async function fetchRemoteTemplate(id: string): Promise<Template | null> {
    const url = `${TEMPLATES_SOURCE_URL}/${id}`
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
            return null
        }
        const payload = await response.json()
        if (payload == null || typeof payload !== 'object') {
            return null
        }
        const template = payload as Template
        return typeof template.id === 'string' ? template : null
    }
    catch (error) {
        return null
    }
}

function refreshTemplateAsync(id: string): void {
    if (templateInFlight.has(id)) {
        return
    }
    const promise = fetchRemoteTemplate(id)
        .then((template) => {
            if (template) {
                templateCache.set(id, { value: template, fetchedAtMs: Date.now() })
            }
        })
        .catch(() => undefined)
        .finally(() => {
            templateInFlight.delete(id)
        })
    templateInFlight.set(id, promise)
}

async function fetchRemoteCategories(): Promise<string[] | null> {
    const url = `${TEMPLATES_SOURCE_URL}/categories`
    const payload = await fetchJsonOrNull(url)
    if (!payload) {
        return null
    }
    const remoteCategoriesRaw: unknown =
        Array.isArray(payload)
            ? payload
            : payload != null && typeof payload === 'object' && 'value' in payload
                ? (payload as { value?: unknown }).value
                : payload != null && typeof payload === 'object' && 'data' in payload
                    ? (payload as { data?: unknown }).data
                    : []

    const remoteCategories = Array.isArray(remoteCategoriesRaw)
        ? remoteCategoriesRaw.filter((c): c is string => typeof c === 'string')
        : []

    return Array.from(new Set([...remoteCategories, ...LOCAL_CATEGORIES]))
}

function refreshCategoriesAsync(): void {
    if (categoriesInFlight) {
        return
    }
    categoriesInFlight = fetchRemoteCategories()
        .then((cats) => {
            if (cats) {
                categoriesCache = { value: cats, fetchedAtMs: Date.now() }
            }
        })
        .catch(() => undefined)
        .finally(() => {
            categoriesInFlight = null
        })
}

function mergeLocalTemplates(
    remote: SeekPage<Template>,
    request: ListTemplatesRequestQuery,
): SeekPage<Template> {
    const localMatches = filterTemplates(LOCAL_TEMPLATES, request)
    const combined = [...localMatches, ...(remote.data ?? [])]

    const seen = new Set<string>()
    const deduped: Template[] = []
    for (const t of combined) {
        if (t?.id && !seen.has(t.id)) {
            seen.add(t.id)
            deduped.push(t)
        }
    }

    return {
        data: deduped,
        next: remote.next ?? null,
        previous: remote.previous ?? null,
    }
}
