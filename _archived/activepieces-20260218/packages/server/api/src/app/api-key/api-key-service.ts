import {
    ActivepiecesError,
    apId,
    assertNotNullOrUndefined,
    ErrorCode,
    isNil,
    PlatformId,
    SeekPage,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import crypto from 'node:crypto'
import { repoFactory } from '../core/db/repo-factory'
import { buildPaginator } from '../helper/pagination/build-paginator'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { ApiKeyEntity, ApiKey } from './api-key-entity'

export const apiKeyRepo = repoFactory(ApiKeyEntity)

export const apiKeyService = (log: FastifyBaseLogger) => ({
    async create(params: CreateParams): Promise<ApiKeyWithValue> {
        log.info({ params }, '[ApiKeyService#create]')
        
        const value = generateApiKey()
        const hashedValue = hashApiKey(value)
        const truncatedValue = value.slice(-4) // Last 4 characters for display
        
        const apiKey = {
            id: apId(),
            displayName: params.displayName,
            hashedValue: hashedValue,
            truncatedValue: truncatedValue,
            platformId: params.platformId ?? null,
            lastUsedAt: null,
        }
        
        const savedApiKey = await apiKeyRepo().save(apiKey)
        
        // Return the unhashed value only once (for the user to save)
        return {
            ...savedApiKey,
            value,
        }
    },

    async list(params: ListParams): Promise<SeekPage<ApiKeyWithoutValue>> {
        log.info({ params }, '[ApiKeyService#list]')
        
        const decodedCursor = paginationHelper.decodeCursor(params.cursor ?? null)
        const paginator = buildPaginator({
            entity: ApiKeyEntity,
            query: {
                limit: params.limit ?? 10,
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        
        const queryBuilder = apiKeyRepo().createQueryBuilder('api_key')
        
        if (!isNil(params.platformId)) {
            queryBuilder.where('api_key.platformId = :platformId', { platformId: params.platformId })
        }
        
        queryBuilder.orderBy('api_key.created', 'DESC')
        
        const { data, cursor } = await paginator.paginate(queryBuilder)
        
        return paginationHelper.createPage<ApiKeyWithoutValue>(
            data.map((apiKey: ApiKey) => ({
                id: apiKey.id,
                created: apiKey.created,
                updated: apiKey.updated,
                displayName: apiKey.displayName,
                lastUsedAt: apiKey.lastUsedAt,
            })),
            cursor,
        )
    },

    async delete(params: DeleteParams): Promise<void> {
        log.info({ params }, '[ApiKeyService#delete]')
        
        const whereCondition = params.platformId 
            ? { id: params.id, platformId: params.platformId }
            : { id: params.id }
        
        const apiKey = await apiKeyRepo().findOneBy(whereCondition)
        
        if (isNil(apiKey)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'api_key',
                    entityId: params.id,
                },
            })
        }
        
        await apiKeyRepo().delete({ id: params.id })
    },

    async getByValue(value: string): Promise<ApiKeyForAuth | null> {
        const hashedValue = hashApiKey(value)
        
        const apiKey = await apiKeyRepo().findOneBy({
            hashedValue: hashedValue,
        })
        
        if (isNil(apiKey)) {
            return null
        }
        
        // Update last used timestamp (don't await to avoid slowing down requests)
        apiKeyRepo().update({ id: apiKey.id }, { lastUsedAt: new Date().toISOString() })
            .catch(err => log.error({ err, apiKeyId: apiKey.id }, '[ApiKeyService#getByValue] Failed to update lastUsedAt'))
        
        return {
            id: apiKey.id,
            platformId: apiKey.platformId,
        }
    },
})

function generateApiKey(): string {
    // Generate a secure random key with prefix
    const randomBytes = crypto.randomBytes(32)
    return `ap_${randomBytes.toString('base64url')}`
}

function hashApiKey(value: string): string {
    // Hash the API key for secure storage
    return crypto.createHash('sha256').update(value).digest('hex')
}

// Types
export interface ApiKeyWithValue {
    id: string
    created: string
    updated: string
    displayName: string
    value: string // Unhashed value (only returned on creation)
    platformId: string | null
    lastUsedAt: string | null
}

export interface ApiKeyWithoutValue {
    id: string
    created: string
    updated: string
    displayName: string
    lastUsedAt: string | null
}

export interface ApiKeyForAuth {
    id: string
    platformId: string | null
}

interface CreateParams {
    displayName: string
    platformId?: PlatformId | null
}

interface ListParams {
    platformId?: PlatformId | null
    cursor?: string | null
    limit?: number
}

interface DeleteParams {
    id: string
    platformId?: PlatformId | null
}
