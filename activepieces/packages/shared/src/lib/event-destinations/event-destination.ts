import { Static, Type } from '@sinclair/typebox'
import { BaseModelSchema, Nullable } from '../common/base-model'
import { SAFE_STRING_PATTERN } from '../common'

export enum EventDestinationScope {
    PLATFORM = 'PLATFORM',
    PROJECT = 'PROJECT',
}

export const EventDestination = Type.Object({
    ...BaseModelSchema,
    platformId: Type.String(),
    projectId: Nullable(Type.String()),
    url: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
    events: Type.Array(Type.String()),
    scope: Type.Enum(EventDestinationScope),
})
export type EventDestination = Static<typeof EventDestination>

export const CreatePlatformEventDestinationRequestBody = Type.Object({
    url: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
    events: Type.Array(Type.String()),
})
export type CreatePlatformEventDestinationRequestBody = Static<
    typeof CreatePlatformEventDestinationRequestBody
>

export const UpdatePlatformEventDestinationRequestBody = Type.Object({
    url: Type.Optional(
        Type.String({
            pattern: SAFE_STRING_PATTERN,
        }),
    ),
    events: Type.Optional(Type.Array(Type.String())),
})
export type UpdatePlatformEventDestinationRequestBody = Static<
    typeof UpdatePlatformEventDestinationRequestBody
>

export const TestPlatformEventDestinationRequestBody = Type.Object({
    url: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
})
export type TestPlatformEventDestinationRequestBody = Static<
    typeof TestPlatformEventDestinationRequestBody
>
