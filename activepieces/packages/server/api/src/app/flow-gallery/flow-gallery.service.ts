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
    {
        key: 'app_meeting_notes_to_tasks',
        name: 'Meeting Notes -> Basecamp Tasks',
        summary: 'Turn Fathom call notes into assigned Basecamp tasks.',
        description: 'Starter app template that parses meeting notes and drafts prioritized Basecamp tasks by owner and due date.',
        categories: ['Operations', 'Project Management'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['fathom', 'basecamp', 'meeting-notes', 'tasks'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_image_generator_with_context',
        name: 'Image Generator with Project Context',
        summary: 'Generate creative assets from project context and prompt.',
        description: 'Starter app template to generate images using project context, art direction, and campaign goals.',
        categories: ['Design', 'Creative'],
        pieces: ['@activepieces/piece-webhook'],
        tags: ['image-gen', 'creative', 'design'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_client_update_writer',
        name: 'Client Update Writer',
        summary: 'Draft weekly client updates from wins, blockers, and next steps.',
        description: 'Starter app template to generate polished client-ready status updates in your agency voice.',
        categories: ['Client Success', 'Communication'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['client-update', 'weekly-report', 'basecamp'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_triage_assistant',
        name: 'Triage App',
        summary: 'Triage inbound requests into priority and ownership.',
        description: 'Starter app template that classifies incoming requests by severity, urgency, and owner.',
        categories: ['Operations', 'Support'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['triage', 'priority', 'operations'],
        type: TemplateType.SHARED,
    },
    {
        key: 'app_kickoff_builder',
        name: 'Kickoff Builder',
        summary: 'Convert scope into kickoff tasks and sprint checklist.',
        description: 'Starter app template that turns project scope and constraints into a kickoff plan and first sprint backlog.',
        categories: ['Project Management'],
        pieces: ['@activepieces/piece-basecamp', '@activepieces/piece-webhook'],
        tags: ['kickoff', 'sprint', 'planning', 'basecamp'],
        type: TemplateType.SHARED,
    },
    {
        key: 'tpl_basecamp_kickoff_packet',
        name: 'Basecamp Project Kickoff Packet Creator',
        summary: 'Build kickoff packet sections and starter task lists.',
        description: 'Internal template for converting discovery notes into a complete kickoff packet plus Basecamp setup checklist.',
        categories: ['Internal', 'Project Management'],
        pieces: ['@activepieces/piece-basecamp'],
        tags: ['internal', 'kickoff', 'basecamp'],
        type: TemplateType.CUSTOM,
    },
    {
        key: 'tpl_lead_intake_qualification',
        name: 'Lead Intake -> Qualification -> Basecamp Todo Set',
        summary: 'Normalize lead intake and generate a qualification todo set.',
        description: 'Internal template for routing leads through qualification and generating standard task bundles in Basecamp.',
        categories: ['Internal', 'Sales'],
        pieces: ['@activepieces/piece-basecamp'],
        tags: ['internal', 'lead-intake', 'sales', 'basecamp'],
        type: TemplateType.CUSTOM,
    },
    {
        key: 'tpl_design_request_normalizer',
        name: 'Design Request Normalizer + Brief Generator',
        summary: 'Standardize design requests and output a usable creative brief.',
        description: 'Internal template to clean noisy design requests and output a complete brief for the design team.',
        categories: ['Internal', 'Design'],
        pieces: ['@activepieces/piece-webhook'],
        tags: ['internal', 'design', 'brief'],
        type: TemplateType.CUSTOM,
    },
    {
        key: 'tpl_bug_report_prioritizer',
        name: 'Bug Report to Prioritized Task Template',
        summary: 'Turn bug reports into prioritized engineering-ready tasks.',
        description: 'Internal template for transforming bug reports into triaged tasks with severity, owner, and acceptance checks.',
        categories: ['Internal', 'Engineering'],
        pieces: ['@activepieces/piece-basecamp'],
        tags: ['internal', 'bug', 'engineering', 'basecamp'],
        type: TemplateType.CUSTOM,
    },
    {
        key: 'tpl_campaign_brief_content_plan',
        name: 'Campaign Brief -> Content Plan Template',
        summary: 'Convert campaign brief into a production-ready content plan.',
        description: 'Internal template to transform campaign goals into channel plan, asset requirements, and due-date checklist.',
        categories: ['Internal', 'Marketing'],
        pieces: ['@activepieces/piece-webhook'],
        tags: ['internal', 'campaign', 'marketing', 'content-plan'],
        type: TemplateType.CUSTOM,
    },
]

const DEFAULT_APP_SEEDS: DefaultAppSeed[] = [
    {
        key: 'app_meeting_notes_to_tasks',
        templateKey: 'app_meeting_notes_to_tasks',
        name: 'Meeting Notes -> Basecamp Tasks',
        description: 'Paste Fathom meeting notes and auto-generate organized Basecamp tasks.',
        category: 'PROJECT_MANAGEMENT',
        tags: ['fathom', 'basecamp', 'tasks'],
        featured: true,
        displayOrder: 10,
        icon: '/branding/wicked-flow-icon.svg?v=20260208',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'meeting_notes', label: 'Meeting notes', type: 'textarea', required: true, placeholder: 'Paste notes or transcript excerpts...' },
                { name: 'project_context', label: 'Project context', type: 'textarea', required: false, placeholder: 'Client goals, constraints, sprint focus' },
                { name: 'default_owner', label: 'Default owner', type: 'text', required: false, placeholder: 'Optional default assignee' },
            ],
        },
    },
    {
        key: 'app_image_generator_with_context',
        templateKey: 'app_image_generator_with_context',
        name: 'Image Generator with Project Context',
        description: 'Generate ad-ready image concepts using campaign and brand context.',
        category: 'DESIGN',
        tags: ['image-gen', 'ads', 'design'],
        featured: true,
        displayOrder: 20,
        icon: '/branding/wicked-flow-icon.svg?v=20260208',
        outputType: 'image',
        inputSchema: {
            fields: [
                { name: 'prompt', label: 'Image prompt', type: 'textarea', required: true, placeholder: 'Describe the image you want to generate' },
                { name: 'brand_style', label: 'Brand style', type: 'text', required: false, placeholder: 'Tone, color, typography cues' },
                { name: 'api_key', label: 'Model API key', type: 'password', required: false, placeholder: 'Optional BYOK for testing' },
            ],
        },
    },
    {
        key: 'app_client_update_writer',
        templateKey: 'app_client_update_writer',
        name: 'Client Update Writer',
        description: 'Draft polished weekly updates from wins, blockers, and next steps.',
        category: 'CLIENT_SUCCESS',
        tags: ['client-update', 'weekly', 'status'],
        featured: true,
        displayOrder: 30,
        icon: '/branding/wicked-flow-icon.svg?v=20260208',
        outputType: 'markdown',
        inputSchema: {
            fields: [
                { name: 'wins', label: 'Wins this week', type: 'textarea', required: true, placeholder: 'Major progress highlights' },
                { name: 'blockers', label: 'Blockers', type: 'textarea', required: false, placeholder: 'Any blockers or risks' },
                { name: 'next_steps', label: 'Next steps', type: 'textarea', required: true, placeholder: 'Planned work for next week' },
            ],
        },
    },
    {
        key: 'app_triage_assistant',
        templateKey: 'app_triage_assistant',
        name: 'Triage App',
        description: 'Classify inbound requests by priority and assign ownership fast.',
        category: 'OPERATIONS',
        tags: ['triage', 'priority', 'ops'],
        featured: false,
        displayOrder: 40,
        icon: '/branding/wicked-flow-icon.svg?v=20260208',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'request', label: 'Request details', type: 'textarea', required: true, placeholder: 'Describe the issue or request' },
                { name: 'client_name', label: 'Client name', type: 'text', required: false, placeholder: 'Optional client name' },
                { name: 'due_date', label: 'Due date', type: 'text', required: false, placeholder: 'Optional due date' },
            ],
        },
    },
    {
        key: 'app_kickoff_builder',
        templateKey: 'app_kickoff_builder',
        name: 'Kickoff Builder',
        description: 'Generate kickoff checklist and first sprint tasks from scope.',
        category: 'PROJECT_MANAGEMENT',
        tags: ['kickoff', 'sprint', 'scope'],
        featured: false,
        displayOrder: 50,
        icon: '/branding/wicked-flow-icon.svg?v=20260208',
        outputType: 'json',
        inputSchema: {
            fields: [
                { name: 'scope', label: 'Scope summary', type: 'textarea', required: true, placeholder: 'What is included in this project?' },
                { name: 'timeline', label: 'Timeline', type: 'text', required: false, placeholder: 'Target dates and milestones' },
                { name: 'constraints', label: 'Constraints', type: 'textarea', required: false, placeholder: 'Budget, legal, or technical constraints' },
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
            const nextRunCount = (app.runCount ?? 0) + 1
            const nextSuccess = (app.successCount ?? 0) + (executionStatus === 'success' ? 1 : 0)
            const nextFailed = (app.failedCount ?? 0) + (executionStatus === 'failed' ? 1 : 0)
            const previousMeasuredRuns = Math.max((app.successCount ?? 0) + (app.failedCount ?? 0), 0)
            const nextMeasuredRuns = executionStatus === 'queued' ? previousMeasuredRuns : previousMeasuredRuns + 1
            const previousAverage = app.averageExecutionMs ?? executionTimeMs
            const nextAverage = nextMeasuredRuns === 0
                ? app.averageExecutionMs
                : Math.round(
                    executionStatus === 'queued'
                        ? previousAverage
                        : ((previousAverage * previousMeasuredRuns) + executionTimeMs) / nextMeasuredRuns,
                )

            await flowGalleryAppRepo().update({
                id: app.id,
            }, {
                runCount: nextRunCount,
                successCount: nextSuccess,
                failedCount: nextFailed,
                averageExecutionMs: nextAverage,
                lastExecutionAt: new Date(),
                lastError: safeError,
            } as never)
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

