import { Static, Type } from '@sinclair/typebox'
import { SAFE_STRING_PATTERN } from '../common'
import { Metadata } from '../common/metadata'
import { ProjectIcon, ProjectPlan } from './project'

export const ListProjectRequestForPlatformQueryParams = Type.Object({
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
})
export type ListProjectRequestForPlatformQueryParams = Static<
    typeof ListProjectRequestForPlatformQueryParams
>

export const CreatePlatformProjectRequest = Type.Object({
    displayName: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
})
export type CreatePlatformProjectRequest = Static<typeof CreatePlatformProjectRequest>

export const UpdateProjectPlatformRequest = Type.Object({
    displayName: Type.Optional(
        Type.String({
            pattern: SAFE_STRING_PATTERN,
        }),
    ),
    metadata: Type.Optional(Metadata),
    releasesEnabled: Type.Optional(Type.Boolean()),
    externalId: Type.Optional(Type.String()),
    icon: Type.Optional(ProjectIcon),
    plan: Type.Optional(ProjectPlan),
})
export type UpdateProjectPlatformRequest = Static<typeof UpdateProjectPlatformRequest>

