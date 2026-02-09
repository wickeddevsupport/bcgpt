import { Static, Type } from '@sinclair/typebox'

export const GetCurrentProjectMemberRoleQuery = Type.Object({
    projectId: Type.String(),
})
export type GetCurrentProjectMemberRoleQuery = Static<typeof GetCurrentProjectMemberRoleQuery>

export const ListProjectMembersRequestQuery = Type.Object({
    projectId: Type.String(),
    projectRoleId: Type.Optional(Type.String()),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
})
export type ListProjectMembersRequestQuery = Static<
    typeof ListProjectMembersRequestQuery
>

export const UpdateProjectMemberRoleRequestBody = Type.Object({
    role: Type.String(),
})
export type UpdateProjectMemberRoleRequestBody = Static<
    typeof UpdateProjectMemberRoleRequestBody
>
