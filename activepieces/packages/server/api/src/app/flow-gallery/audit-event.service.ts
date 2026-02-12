import { apId } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { AuditEventEntity, AuditEventSchema } from './audit-event.entity'

const auditEventRepo = repoFactory<AuditEventSchema>(AuditEventEntity)

/**
 * Audit Event Service
 * 
 * Logs all important app platform events for compliance and debugging:
 * - Publish/Update/Unpublish app actions
 * - App executions (success/failure)
 * - Default app seeding
 * 
 * Supports:
 * - Event retrieval by platform/app/user
 * - Metrics aggregation (run count, success rate)
 * - Export for compliance audits
 */

interface LogEventParams {
    platformId: string | null
    appId?: string | null
    userId?: string | null
    eventType: 'publish' | 'update' | 'unpublish' | 'execute' | 'seed'
    status: 'success' | 'failed'
    eventMetadata?: Record<string, unknown>
    errorMessage?: string | null
    ipAddress?: string | null
    userAgent?: string | null
}

interface GetAuditLogsParams {
    platformId?: string | null
    appId?: string
    userId?: string
    eventType?: string
    limit?: number
    cursor?: string
}

export const auditEventService = {
    /**
     * Log an audit event
     */
    async logEvent(params: LogEventParams): Promise<AuditEventSchema> {
        const event: AuditEventSchema = {
            id: apId(),
            created: new Date(),
            platformId: params.platformId,
            appId: params.appId ?? null,
            userId: params.userId ?? null,
            eventType: params.eventType,
            status: params.status,
            ipAddress: params.ipAddress ?? null,
            userAgent: params.userAgent ?? null,
            eventMetadata: params.eventMetadata ?? {},
            errorMessage: params.errorMessage ?? null,
        }

        const repo = auditEventRepo()
        return await repo.save(event)
    },

    /**
     * Get audit logs with optional filtering
     */
    async getAuditLogs(params: GetAuditLogsParams): Promise<AuditEventSchema[]> {
        const repo = auditEventRepo()
        let query = repo.createQueryBuilder('audit_events')

        if (params.platformId) {
            query = query.where('audit_events.platformId = :platformId', {
                platformId: params.platformId,
            })
        }

        if (params.appId) {
            query = query.andWhere('audit_events.appId = :appId', {
                appId: params.appId,
            })
        }

        if (params.userId) {
            query = query.andWhere('audit_events.userId = :userId', {
                userId: params.userId,
            })
        }

        if (params.eventType) {
            query = query.andWhere('audit_events.eventType = :eventType', {
                eventType: params.eventType,
            })
        }

        if (params.cursor) {
            query = query.andWhere('audit_events.created < :cursor', {
                cursor: new Date(params.cursor),
            })
        }

        const limit = params.limit ?? 100
        return await query
            .orderBy('audit_events.created', 'DESC')
            .limit(limit + 1)
            .getMany()
    },

    /**
     * Get execution metrics for an app
     */
    async getAppMetrics(
        appId: string,
    ): Promise<{
        runCount: number
        successCount: number
        failedCount: number
        successRate: number
        medianExecutionMs: number | null
    }> {
        const repo = auditEventRepo()

        const executions = await repo.find({
            where: {
                appId,
                eventType: 'execute',
            },
        })

        const successCount = executions.filter((e) => e.status === 'success').length
        const failedCount = executions.filter((e) => e.status === 'failed').length
        const runCount = executions.length

        // Extract execution times from metadata
        const executionTimes = executions
            .map((e) => e.eventMetadata.executionTimeMs as number | undefined)
            .filter((t): t is number => typeof t === 'number')
            .sort((a, b) => a - b)

        const medianExecutionMs = executionTimes.length > 0
            ? executionTimes[Math.floor(executionTimes.length / 2)]
            : null

        return {
            runCount,
            successCount,
            failedCount,
            successRate: runCount > 0 ? (successCount / runCount) * 100 : 0,
            medianExecutionMs,
        }
    },

    /**
     * Get failure breakdown for debugging
     */
    async getFailureBreakdown(
        appId: string,
    ): Promise<Record<string, number>> {
        const repo = auditEventRepo()

        const failures = await repo.find({
            where: {
                appId,
                eventType: 'execute',
                status: 'failed',
            },
        })

        const breakdown: Record<string, number> = {}
        for (const failure of failures) {
            const errorType = (failure.eventMetadata.errorType as string) ?? 'unknown'
            breakdown[errorType] = (breakdown[errorType] ?? 0) + 1
        }

        return breakdown
    },
}
