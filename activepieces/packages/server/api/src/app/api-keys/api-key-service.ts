import crypto from 'node:crypto'
import { ActivepiecesError, apId, ApiKeyResponseWithoutValue, ApiKeyResponseWithValue, CreateApiKeyRequest, ErrorCode, isNil, SeekPage } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { repoFactory } from '../core/db/repo-factory'
import { ApiKeyEntity, ApiKeySchema } from './api-key-entity'

const repo = repoFactory<ApiKeySchema>(ApiKeyEntity)

function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex')
}

function generateApiKeyValue(): string {
    // Keep the "sk-" prefix to match existing auth middleware semantics.
    const bytes = crypto.randomBytes(32).toString('base64url')
    return `sk-${bytes}`
}

export const apiKeyService = (log: FastifyBaseLogger) => ({
    async create(platformId: string, request: CreateApiKeyRequest): Promise<ApiKeyResponseWithValue> {
        const now = new Date().toISOString()
        // Retry on the extremely unlikely event of a hash collision.
        for (let i = 0; i < 3; i++) {
            const value = generateApiKeyValue()
            const hashedValue = sha256Hex(value)
            const truncatedValue = value.slice(-6)
            try {
                const saved = await repo().save({
                    id: apId(),
                    created: now,
                    updated: now,
                    displayName: request.displayName,
                    platformId,
                    hashedValue,
                    truncatedValue,
                    lastUsedAt: null,
                })
                return {
                    id: saved.id,
                    created: saved.created,
                    updated: saved.updated,
                    displayName: saved.displayName,
                    lastUsedAt: saved.lastUsedAt,
                    value,
                }
            } catch (e) {
                log.warn({ err: (e as Error)?.message ?? e }, '[apiKeyService#create] insert failed, retrying')
            }
        }
        throw new ActivepiecesError({
            code: ErrorCode.SERVER_ERROR,
            params: {
                message: 'Failed to create API key',
            },
        })
    },

    async list(platformId: string): Promise<SeekPage<ApiKeyResponseWithoutValue>> {
        const keys = await repo().find({
            where: { platformId },
            order: { created: 'DESC' } as unknown as never,
        })
        return {
            data: keys.map((k) => ({
                id: k.id,
                created: k.created,
                updated: k.updated,
                displayName: k.displayName,
                lastUsedAt: k.lastUsedAt ?? null,
            })),
            next: null,
            previous: null,
        }
    },

    async delete(platformId: string, keyId: string): Promise<void> {
        await repo().delete({ id: keyId, platformId })
    },

    async getByValue(apiKeyValue: string): Promise<Pick<ApiKeySchema, 'id' | 'platformId'> | null> {
        const hashedValue = sha256Hex(apiKeyValue)
        const apiKey = await repo().findOneBy({ hashedValue })
        if (isNil(apiKey)) {
            return null
        }
        try {
            await repo().update({ id: apiKey.id }, { lastUsedAt: new Date().toISOString() } as Partial<ApiKeySchema>)
        } catch (e) {
            log.warn({ err: (e as Error)?.message ?? e }, '[apiKeyService#getByValue] failed to update lastUsedAt')
        }
        return { id: apiKey.id, platformId: apiKey.platformId }
    },
})

