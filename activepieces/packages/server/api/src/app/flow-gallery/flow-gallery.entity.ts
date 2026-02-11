import { Platform, Template } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../database/database-common'

/**
 * Gallery App Entity - Public-facing metadata for featured apps
 * Extends Template system with gallery-specific properties
 * 
 * References PRD: Flow App Store MVP
 * - Allows templates to be featured in public gallery
 * - Stores custom metadata for app store presentation
 * - Tracks execution statistics for future analytics
 */

export type FlowGalleryAppSchema = {
    id: string
    created: Date
    updated: Date
    templateId: string
    platformId: string | null
    flowId: string | null
    featured: boolean
    displayOrder: number
    description: string
    icon: string | null
    category: string
    tags: string[]
    inputSchema: Record<string, unknown> | null
    outputType: string | null
    outputSchema: Record<string, unknown> | null
    publishedBy: string | null
    runCount: number
    successCount: number
    failedCount: number
    averageExecutionMs: number | null
    lastExecutionAt: Date | null
    lastError: string | null
    platform: Platform
}

export const FlowGalleryAppEntity = new EntitySchema<FlowGalleryAppSchema>({
    name: 'flow_gallery_app',
    columns: {
        ...BaseColumnSchemaPart,
        templateId: {
            type: String,
            nullable: false,
        },
        platformId: {
            type: String,
            nullable: true,
        },
        flowId: {
            type: String,
            nullable: true,
        },
        featured: {
            type: 'boolean',
            default: false,
        },
        displayOrder: {
            type: 'integer',
            default: 0,
        },
        description: {
            type: String,
            nullable: true,
        },
        icon: {
            type: String,
            nullable: true,
        },
        category: {
            type: String,
            nullable: true,
        },
        tags: {
            type: String,
            array: true,
            nullable: true,
        },
        inputSchema: {
            type: 'jsonb',
            nullable: true,
        },
        outputType: {
            type: String,
            nullable: true,
        },
        outputSchema: {
            type: 'jsonb',
            nullable: true,
        },
        publishedBy: {
            type: String,
            nullable: true,
        },
        runCount: {
            type: Number,
            default: 0,
        },
        successCount: {
            type: Number,
            default: 0,
        },
        failedCount: {
            type: Number,
            default: 0,
        },
        averageExecutionMs: {
            type: Number,
            nullable: true,
        },
        lastExecutionAt: {
            type: Date,
            nullable: true,
        },
        lastError: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_flow_gallery_app_platform_id_featured',
            columns: ['platformId', 'featured'],
        },
        {
            name: 'idx_flow_gallery_app_display_order',
            columns: ['displayOrder'],
        },
        {
            name: 'idx_flow_gallery_app_category',
            columns: ['category'],
        },
    ],
    relations: {
        platform: {
            type: 'many-to-one',
            target: 'platform',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
                referencedColumnName: 'id',
            },
        },
    },
})
