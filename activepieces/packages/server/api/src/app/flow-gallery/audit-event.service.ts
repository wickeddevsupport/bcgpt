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

function isQueuedExecution(event: AuditEventSchema): boolean {
    const executionStatus = event.eventMetadata?.executionStatus
    return executionStatus === 'queued'
}

function toMeasuredExecutions(events: AuditEventSchema[]): AuditEventSchema[] {
    return events.filter((event) => !isQueuedExecution(event))
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
        const measuredExecutions = toMeasuredExecutions(executions)

        const successCount = measuredExecutions.filter((e) => e.status === 'success').length
        const failedCount = measuredExecutions.filter((e) => e.status === 'failed').length
        const runCount = measuredExecutions.length

        // Extract execution times from metadata
        const executionTimes = measuredExecutions
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
        const measuredFailures = toMeasuredExecutions(failures)

        const breakdown: Record<string, number> = {}
        for (const failure of measuredFailures) {
            const errorType = (failure.eventMetadata.errorType as string) ?? 'unknown'
            breakdown[errorType] = (breakdown[errorType] ?? 0) + 1
        }

        return breakdown
    },

    /**
     * Get platform-wide telemetry for dashboard
     */
    async getPlatformTelemetry(platformId: string): Promise<{
        totalExecutions: number
        successfulExecutions: number
        failedExecutions: number
        successRate: number
        medianExecutionMs: number | null
        p95ExecutionMs: number | null
        p99ExecutionMs: number | null
    }> {
        const repo = auditEventRepo()

        const executions = await repo.find({
            where: {
                platformId,
                eventType: 'execute',
            },
        })
        const measuredExecutions = toMeasuredExecutions(executions)

        const successCount = measuredExecutions.filter((e) => e.status === 'success').length
        const failedCount = measuredExecutions.filter((e) => e.status === 'failed').length
        const totalCount = measuredExecutions.length

        const executionTimes = measuredExecutions
            .map((e) => e.eventMetadata.executionTimeMs as number | undefined)
            .filter((t): t is number => typeof t === 'number')
            .sort((a, b) => a - b)

        return {
            totalExecutions: totalCount,
            successfulExecutions: successCount,
            failedExecutions: failedCount,
            successRate: totalCount > 0 ? (successCount / totalCount) * 100 : 0,
            medianExecutionMs: executionTimes.length > 0
                ? executionTimes[Math.floor(executionTimes.length / 2)]
                : null,
            p95ExecutionMs: executionTimes.length > 0
                ? executionTimes[Math.floor(executionTimes.length * 0.95)]
                : null,
            p99ExecutionMs: executionTimes.length > 0
                ? executionTimes[Math.floor(executionTimes.length * 0.99)]
                : null,
        }
    },

    /**
     * Get top apps by execution count for dashboard
     */
    async getTopAppsByUsage(
        platformId: string,
        limit = 10,
    ): Promise<Array<{
        appId: string
        executionCount: number
        successCount: number
        failureCount: number
        successRate: number
    }>> {
        const repo = auditEventRepo()

        const executions = await repo.find({
            where: {
                platformId,
                eventType: 'execute',
            },
        })
        const measuredExecutions = toMeasuredExecutions(executions)

        const appMetrics = new Map<
            string,
            { success: number; failed: number }
        >()

        for (const exec of measuredExecutions) {
            if (!exec.appId) continue
            const current = appMetrics.get(exec.appId) ?? {
                success: 0,
                failed: 0,
            }
            if (exec.status === 'success') {
                current.success++
            } else {
                current.failed++
            }
            appMetrics.set(exec.appId, current)
        }

        return Array.from(appMetrics.entries())
            .map(([appId, metrics]) => ({
                appId,
                executionCount: metrics.success + metrics.failed,
                successCount: metrics.success,
                failureCount: metrics.failed,
                successRate:
                    metrics.success + metrics.failed > 0
                        ? (metrics.success / (metrics.success + metrics.failed)) * 100
                        : 0,
            }))
            .sort((a, b) => b.executionCount - a.executionCount)
            .slice(0, limit)
    },

    /**
     * Get execution time distribution for histogram
     */
    async getExecutionTimeDistribution(
        platformId: string,
    ): Promise<Record<string, number>> {
        const repo = auditEventRepo()

        const executions = await repo.find({
            where: {
                platformId,
                eventType: 'execute',
                status: 'success',
            },
        })
        const measuredExecutions = toMeasuredExecutions(executions)

        const times = measuredExecutions
            .map((e) => e.eventMetadata.executionTimeMs as number | undefined)
            .filter((t): t is number => typeof t === 'number')

        // Bucket into ranges: <1s, 1-2s, 2-5s, 5-10s, >10s
        const distribution = {
            '<1s': 0,
            '1-2s': 0,
            '2-5s': 0,
            '5-10s': 0,
            '>10s': 0,
        }

        for (const time of times) {
            const seconds = time / 1000
            if (seconds < 1) distribution['<1s']++
            else if (seconds < 2) distribution['1-2s']++
            else if (seconds < 5) distribution['2-5s']++
            else if (seconds < 10) distribution['5-10s']++
            else distribution['>10s']++
        }

        return distribution
    },
}

