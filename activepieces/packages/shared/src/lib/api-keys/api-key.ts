import { Static, Type } from '@sinclair/typebox'
import { BaseModelSchema, Nullable, SAFE_STRING_PATTERN } from '../common'

export const CreateApiKeyRequest = Type.Object({
    displayName: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
})
export type CreateApiKeyRequest = Static<typeof CreateApiKeyRequest>

export const ApiKeyResponseWithoutValue = Type.Object({
    ...BaseModelSchema,
    displayName: Type.String(),
    lastUsedAt: Nullable(Type.String()),
})
export type ApiKeyResponseWithoutValue = Static<typeof ApiKeyResponseWithoutValue>

export const ApiKeyResponseWithValue = Type.Composite([
    ApiKeyResponseWithoutValue,
    Type.Object({
        value: Type.String(),
    }),
])
export type ApiKeyResponseWithValue = Static<typeof ApiKeyResponseWithValue>

