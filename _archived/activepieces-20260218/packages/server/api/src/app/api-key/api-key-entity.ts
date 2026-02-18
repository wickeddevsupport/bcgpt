import { EntitySchema } from 'typeorm'
import { BaseColumnSchemaPart } from '../database/database-common'

export interface ApiKey {
    id: string
    created: string
    updated: string
    displayName: string
    hashedValue: string
    truncatedValue: string
    platformId: string | null
    lastUsedAt: string | null
}

export const ApiKeyEntity = new EntitySchema<ApiKey>({
    name: 'api_key',
    columns: {
        ...BaseColumnSchemaPart,
        displayName: {
            type: String,
            nullable: false,
        },
        hashedValue: {
            type: String,
            nullable: false,
        },
        truncatedValue: {
            type: String,
            nullable: false,
        },
        platformId: {
            type: String,
            nullable: true,
        },
        lastUsedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_api_key_hashed_value',
            columns: ['hashedValue'],
            unique: true,
        },
        {
            name: 'idx_api_key_platform_id',
            columns: ['platformId'],
        },
    ],
})
