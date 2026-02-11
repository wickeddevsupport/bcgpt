import {
    ActivepiecesError,
    apId,
    ErrorCode,
    isNil,
    SeekPage,
    Template,
    TemplateStatus,
    TemplateType,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { Equal, IsNull } from 'typeorm'
import { repoFactory } from '../core/db/repo-factory'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { TemplateEntity } from '../template/template.entity'
import { FlowGalleryAppEntity } from './flow-gallery.entity'

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
    templateId: string
    inputs: Record<string, unknown>
    platformId: string | null
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
        const filters: Record<string, unknown> = {
            status: Equal(TemplateStatus.PUBLISHED),
        }

        const queryBuilder = templateRepo()
            .createQueryBuilder('template')
            .where(filters)

        // Only show OFFICIAL and SHARED templates
        queryBuilder.andWhere(
            "template.type IN (:...types)",
            { types: [TemplateType.OFFICIAL, TemplateType.SHARED] }
        )

        // Filter by search term
        if (search) {
            queryBuilder.andWhere(
                '(template.name ILIKE :search OR template.description ILIKE :search OR template.summary ILIKE :search)',
                { search: `%${search}%` },
            )
        }

        // Sort by creation date
        queryBuilder.orderBy('template.created', 'DESC')

        const templates = await queryBuilder.getMany()

        // Simple pagination for Phase 1
        const startIndex = cursor ? parseInt(cursor, 10) : 0
        const endIndex = startIndex + (limit || 20)
        const paginatedTemplates = templates.slice(startIndex, endIndex)
        const nextCursor = endIndex < templates.length ? String(endIndex) : null

        return paginationHelper.createPage(paginatedTemplates, nextCursor)
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

        if (!template || !template.flows || !Array.isArray(template.flows)) {
            return null
        }

        // Get the first flow as the primary execution flow
        const primaryFlow = template.flows[0]

        if (!primaryFlow) {
            return null
        }

        return {
            flowId: primaryFlow.id,
            version: primaryFlow.version,
            inputSchema: primaryFlow.trigger?.inputs || {},
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
        log.info({
            msg: 'Flow Gallery App Execution',
            templateId,
            status: executionStatus,
            timeMs: executionTimeMs,
            hasError: !!error,
        })
        // Future: Store in execution_log table for analytics dashboard
    },
})

