import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'

export type ApiKeySchema = {
    id: string
    created: string
    updated: string
    displayName: string
    platformId: string
    hashedValue: string
    truncatedValue: string
    lastUsedAt: string | null
}

export const ApiKeyEntity = new EntitySchema<ApiKeySchema>({
    name: 'api_key',
    columns: {
        ...BaseColumnSchemaPart,
        displayName: {
            type: String,
            nullable: false,
        },
        platformId: {
            ...ApIdSchema,
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
        lastUsedAt: {
            type: String,
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_api_key_platform_id',
            columns: ['platformId'],
        },
        {
            name: 'idx_api_key_hashed_value',
            columns: ['hashedValue'],
            unique: true,
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
                foreignKeyConstraintName: 'fk_api_key_platform_id',
            },
        },
    },
})

