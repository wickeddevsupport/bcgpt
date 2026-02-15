import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
} from '../database/database-common'

/**
 * Audit Event Entity - Track all important app platform actions
 * 
 * Records:
 * - Publish template as app
 * - Update published app metadata
 * - Unpublish app
 * - Execute app (with status)
 * - Seed default apps
 */

export type AuditEventSchema = {
    id: string
    created: Date
    platformId: string | null
    appId: string | null
    userId: string | null
    eventType: 'publish' | 'update' | 'unpublish' | 'execute' | 'seed'
    status: 'success' | 'failed'
    ipAddress: string | null
    userAgent: string | null
    eventMetadata: Record<string, unknown>
    errorMessage: string | null
}

export const AuditEventEntity = new EntitySchema<AuditEventSchema>({
    name: 'audit_events',
    columns: {
        id: {
            ...ApIdSchema,
            primary: true,
        },
        created: {
            type: 'timestamp with time zone',
            default: 'now()',
        },
        platformId: {
            type: String,
            nullable: true,
        },
        appId: {
            type: String,
            nullable: true,
        },
        userId: {
            type: String,
            nullable: true,
        },
        eventType: {
            type: String,
            enum: ['publish', 'update', 'unpublish', 'execute', 'seed'],
        },
        status: {
            type: String,
            enum: ['success', 'failed'],
        },
        ipAddress: {
            type: String,
            nullable: true,
        },
        userAgent: {
            type: String,
            nullable: true,
        },
        eventMetadata: {
            type: 'jsonb',
            default: {},
        },
        errorMessage: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_audit_events_platform_created',
            columns: ['platformId', 'created'],
        },
        {
            name: 'idx_audit_events_app_created',
            columns: ['appId', 'created'],
        },
        {
            name: 'idx_audit_events_user_created',
            columns: ['userId', 'created'],
        },
        {
            name: 'idx_audit_events_type',
            columns: ['eventType'],
        },
    ],
})
