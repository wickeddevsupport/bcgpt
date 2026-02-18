import { Static, Type } from '@sinclair/typebox'
import { BaseModelSchema, Nullable, SAFE_STRING_PATTERN } from '../common'
import { ApId } from '../common/id-generator'

export enum DefaultProjectRole {
    ADMIN = 'Admin',
    EDITOR = 'Editor',
    VIEWER = 'Viewer',
}

// Minimal shape used by the Community UI (team projects / members screens).
// In CE deployments where project members are disabled, these types still need
// to exist for compilation even if the endpoints are never hit.
export const ProjectMemberWithUser = Type.Object({
    ...BaseModelSchema,
    userId: ApId,
    projectId: ApId,
    project: Type.Optional(Type.Object({
        id: ApId,
        displayName: Type.String(),
    })),
    projectRole: Type.Object({
        id: Type.Optional(ApId),
        name: Type.String({
            pattern: SAFE_STRING_PATTERN,
        }),
        permissions: Type.Optional(Type.Array(Type.String())),
    }),
    user: Type.Object({
        id: Type.Optional(ApId),
        firstName: Type.String(),
        lastName: Type.String(),
        email: Type.Optional(Type.String()),
    }),
    status: Type.Optional(Type.String()),
    invitationId: Nullable(Type.String()),
})
export type ProjectMemberWithUser = Static<typeof ProjectMemberWithUser>

