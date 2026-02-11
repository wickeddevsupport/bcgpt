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

const templateRepo = repoFactory<Template>(TemplateEntity)
const flowGalleryAppRepo = repoFactory(FlowGalleryAppEntity)

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

type AppOutputType = 'json' | 'text' | 'image' | 'markdown' | 'html'
type AppInputType = 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'password'

const MAX_SCHEMA_FIELDS = 30
const MAX_TAGS = 12
const MAX_TAG_LENGTH = 40
const ALLOWED_OUTPUT_TYPES = new Set<AppOutputType>(['json', 'text', 'image', 'markdown', 'html'])
const ALLOWED_INPUT_TYPES = new Set<AppInputType>(['text', 'textarea', 'number', 'select', 'boolean', 'password'])

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
        lastExecutionAt: Date | null
    } | null> {
        const app = await flowGalleryAppRepo().findOneBy({
            templateId: appId,
        })
        if (isNil(app)) {
            return null
        }
        return {
            runCount: app.runCount ?? 0,
            successCount: app.successCount ?? 0,
            failedCount: app.failedCount ?? 0,
            averageExecutionMs: app.averageExecutionMs ?? null,
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
    }: ExecuteFlowParams): Promise<EngineHttpResponse> {
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
            async: false,
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
    async logExecution({
        templateId,
        executionStatus,
        executionTimeMs,
        outputs,
        error,
    }: {
        templateId: string
        executionStatus: 'success' | 'failed'
        executionTimeMs: number
        outputs?: unknown
        error?: string
    }): Promise<void> {
        const app = await flowGalleryAppRepo().findOneBy({
            templateId,
        })
        if (!isNil(app)) {
            const nextRunCount = (app.runCount ?? 0) + 1
            const nextSuccess = (app.successCount ?? 0) + (executionStatus === 'success' ? 1 : 0)
            const nextFailed = (app.failedCount ?? 0) + (executionStatus === 'failed' ? 1 : 0)
            const previousAverage = app.averageExecutionMs ?? executionTimeMs
            const nextAverage = Math.round(((previousAverage * (nextRunCount - 1)) + executionTimeMs) / nextRunCount)

            await flowGalleryAppRepo().update({
                id: app.id,
            }, {
                runCount: nextRunCount,
                successCount: nextSuccess,
                failedCount: nextFailed,
                averageExecutionMs: nextAverage,
                lastExecutionAt: new Date(),
                lastError: error ? error.slice(0, 1000) : null,
            } as never)
        }

        log.info({
            msg: 'Flow Gallery App Execution',
            templateId,
            status: executionStatus,
            timeMs: executionTimeMs,
            hasError: !!error,
        })
    },
})

