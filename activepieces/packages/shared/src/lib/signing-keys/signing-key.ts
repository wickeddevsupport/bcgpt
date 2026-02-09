import { Static, Type } from '@sinclair/typebox'
import { BaseModelSchema, SAFE_STRING_PATTERN } from '../common'

export type SigningKeyId = string

export const SigningKey = Type.Object({
    ...BaseModelSchema,
    displayName: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
})
export type SigningKey = Static<typeof SigningKey>

export const AddSigningKeyRequestBody = Type.Object({
    displayName: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
})
export type AddSigningKeyRequestBody = Static<typeof AddSigningKeyRequestBody>

export const AddSigningKeyResponse = Type.Composite([
    SigningKey,
    Type.Object({
        privateKey: Type.String(),
    }),
])
export type AddSigningKeyResponse = Static<typeof AddSigningKeyResponse>

