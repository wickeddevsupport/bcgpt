import { Static, Type } from '@sinclair/typebox'
import { BaseModelSchema } from '../common/base-model'
import { SAFE_STRING_PATTERN } from '../common'

export enum GitBranchType {
    DEVELOPMENT = 'DEVELOPMENT',
    PRODUCTION = 'PRODUCTION',
}

export enum GitPushOperationType {
    PUSH_FLOW = 'PUSH_FLOW',
    PUSH_TABLE = 'PUSH_TABLE',
    PUSH_EVERYTHING = 'PUSH_EVERYTHING',
    DELETE_FLOW = 'DELETE_FLOW',
}

export const GitRepo = Type.Object({
    ...BaseModelSchema,
    projectId: Type.String(),
    remoteUrl: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
    branch: Type.String(),
    slug: Type.String(),
    branchType: Type.Enum(GitBranchType),
    // Never return the SSH private key in list responses.
})
export type GitRepo = Static<typeof GitRepo>

export const ConfigureRepoRequest = Type.Object({
    projectId: Type.String(),
    remoteUrl: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
    branch: Type.String(),
    slug: Type.String(),
    branchType: Type.Enum(GitBranchType),
    sshPrivateKey: Type.String(),
})
export type ConfigureRepoRequest = Static<typeof ConfigureRepoRequest>

export const PushGitRepoRequest = Type.Object({
    type: Type.Enum(GitPushOperationType),
    commitMessage: Type.String(),
    externalFlowIds: Type.Optional(Type.Array(Type.String())),
    externalTableIds: Type.Optional(Type.Array(Type.String())),
})
export type PushGitRepoRequest = Static<typeof PushGitRepoRequest>

export const PushFlowsGitRepoRequest = Type.Composite([
    PushGitRepoRequest,
    Type.Object({
        type: Type.Literal(GitPushOperationType.PUSH_FLOW),
        externalFlowIds: Type.Array(Type.String()),
    }),
])
export type PushFlowsGitRepoRequest = Static<typeof PushFlowsGitRepoRequest>

export const PushTablesGitRepoRequest = Type.Composite([
    PushGitRepoRequest,
    Type.Object({
        type: Type.Literal(GitPushOperationType.PUSH_TABLE),
        externalTableIds: Type.Array(Type.String()),
    }),
])
export type PushTablesGitRepoRequest = Static<typeof PushTablesGitRepoRequest>

export const PushEverythingGitRepoRequest = Type.Composite([
    PushGitRepoRequest,
    Type.Object({
        type: Type.Literal(GitPushOperationType.PUSH_EVERYTHING),
    }),
])
export type PushEverythingGitRepoRequest = Static<
    typeof PushEverythingGitRepoRequest
>

