import { Static, Type } from '@sinclair/typebox'
import { BaseModelSchema, SAFE_STRING_PATTERN } from '../common'

export const OAuthApp = Type.Object({
    ...BaseModelSchema,
    pieceName: Type.String(),
    clientId: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
    // Never return clientSecret in list responses. Keep optional for upsert.
    clientSecret: Type.Optional(Type.String()),
})
export type OAuthApp = Static<typeof OAuthApp>

export const ListOAuth2AppRequest = Type.Object({
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
})
export type ListOAuth2AppRequest = Static<typeof ListOAuth2AppRequest>

export const UpsertOAuth2AppRequest = Type.Object({
    pieceName: Type.String(),
    clientId: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
    clientSecret: Type.String(),
})
export type UpsertOAuth2AppRequest = Static<typeof UpsertOAuth2AppRequest>

