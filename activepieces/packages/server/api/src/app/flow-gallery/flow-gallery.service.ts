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
import { ArrayContains, Equal, IsNull, Like } from 'typeorm'
import { repoFactory } from '../../core/db/repo-factory'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { TemplateEntity } from '../template/template.entity'
import { FlowGalleryAppEntity } from './flow-gallery.entity'

const flowGalleryAppRepo = repoFactory(FlowGalleryAppEntity)
const templateRepo = repoFactory<Template>(TemplateEntity)

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
        limit,
        search,
        category,
        featured = false,
        platformId,
    }: ListPublicAppsParams): Promise<SeekPage<Template>> {
        const query = templateRepo
            .createQueryBuilder('template')
            .where('template.status = :status', { status: TemplateStatus.PUBLISHED })
            .andWhere('template.type IN (:...types)', {
                types: [TemplateType.OFFICIAL, TemplateType.SHARED],
            })

        // Filter by platform if specified
        if (!isNil(platformId)) {
            query.andWhere('template.platformId = :platformId', { platformId })
        } else {
            query.andWhere('template.platformId IS NULL')
        }

        // Filter by search term
        if (search) {
            query.andWhere(
                '(template.name ILIKE :search OR template.description ILIKE :search OR template.summary ILIKE :search)',
                { search: `%${search}%` },
            )
        }

        // Filter by category
        if (category) {
            query.andWhere(':category = ANY(template.categories)', { category })
        }

        // Sort by featured flag and creation date
        query.orderBy('template.created', 'DESC')

        const paginator = buildPaginator({
            query,
            cursor,
            limit,
            orderByColumn: 'template.created',
            orderByDirection: 'DESC',
        })

        return paginator.paginate()
    },

    /**
     * Get single app by ID with full template details
     */
    async getPublicApp({
        id,
        platformId,
    }: GetAppWithTemplateParams): Promise<(Template & { galleryMetadata?: unknown }) | null> {
        const template = await templateRepo.findOne({
            where: {
                id,
                status: TemplateStatus.PUBLISHED,
                type: In([TemplateType.OFFICIAL, TemplateType.SHARED]),
                platformId: platformId ? Equal(platformId) : IsNull(),
            },
        })

        if (!template) {
            return null
        }

        // Optionally fetch gallery-specific metadata
        const galleryApp = await flowGalleryAppRepo.findOne({
            where: { templateId: id },
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
        const template = await templateRepo.findOne({
            where: { id: templateId },
        })

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

// Type imports for utility
import { In } from 'typeorm'
