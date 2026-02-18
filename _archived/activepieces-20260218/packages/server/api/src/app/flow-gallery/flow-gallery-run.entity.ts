import { EntitySchema } from 'typeorm'
import {
    BaseColumnSchemaPart,
} from '../database/database-common'

export type FlowGalleryRunSchema = {
    id: string
    created: Date
    updated: Date
    appId: string
    status: 'queued' | 'success' | 'failed'
    executionTimeMs: number | null
    inputKeys: string[] | null
    outputType: string | null
    error: string | null
    requestId: string | null
}

export const FlowGalleryRunEntity = new EntitySchema<FlowGalleryRunSchema>({
    name: 'flow_gallery_run',
    columns: {
        ...BaseColumnSchemaPart,
        appId: {
            type: String,
            nullable: false,
        },
        status: {
            type: String,
            nullable: false,
        },
        executionTimeMs: {
            type: Number,
            nullable: true,
        },
        inputKeys: {
            type: String,
            array: true,
            nullable: true,
        },
        outputType: {
            type: String,
            nullable: true,
        },
        error: {
            type: String,
            nullable: true,
        },
        requestId: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_flow_gallery_run_app_id_created',
            columns: ['appId', 'created'],
        },
        {
            name: 'idx_flow_gallery_run_status',
            columns: ['status'],
        },
    ],
})
