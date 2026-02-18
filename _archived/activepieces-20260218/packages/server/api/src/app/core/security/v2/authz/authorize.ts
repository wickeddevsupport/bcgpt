import { AuthorizationRouteSecurity, AuthorizationType, ProjectAuthorizationConfig, RouteKind } from '@activepieces/server-shared'
import { ActivepiecesError, ErrorCode, isNil, PlatformRole, Principal, PrincipalType } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { projectService } from '../../../../project/project-service'
import { userService } from '../../../../user/user-service'

export const authorizeOrThrow = async (principal: Principal, security: AuthorizationRouteSecurity, log: FastifyBaseLogger): Promise<void> => {
    if (security.kind === RouteKind.PUBLIC) {
        return
    }
    switch (security.authorization.type) {
        case AuthorizationType.PROJECT:
            await assertPrinicpalIsOneOf(security.authorization.allowedPrincipals, principal.type)
            await assertAccessToProject(principal, security.authorization, log)
            break
        case AuthorizationType.PLATFORM:
            await assertPrinicpalIsOneOf(security.authorization.allowedPrincipals, principal.type)
            if (security.authorization.adminOnly) {
                await assertPlatformIsOwnedByCurrentPrincipal(principal)
            }
            break
        case AuthorizationType.UNSCOPED:
            await assertPrinicpalIsOneOf(security.authorization.allowedPrincipals, principal.type)
            break
        case AuthorizationType.NONE:
            break
    }
}


async function assertPlatformIsOwnedByCurrentPrincipal(principal: Principal): Promise<void> {
    if (principal.type === PrincipalType.SERVICE) {
        return
    }
    const user = await userService.getOneOrFail({ id: principal.id })
    if (user.platformRole !== PlatformRole.ADMIN) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'User is not an admin/owner of the platform.',
            },
        })
    }
}


async function assertAccessToProject(principal: Principal, projectSecurity: ProjectAuthorizationConfig, log: FastifyBaseLogger): Promise<void> {
    if (isNil(projectSecurity.projectId)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'Project ID is required',
            },
        })
    }

    // CE-safe default authorization:
    // - Service principals are treated as platform-scoped and allowed.
    // - User principals must either own the project or be a privileged platform user.
    // - Worker principals are treated as platform-scoped and allowed.
    if (principal.type === PrincipalType.SERVICE || principal.type === PrincipalType.WORKER) {
        return
    }

    const project = await projectService.getOneOrThrow(projectSecurity.projectId)
    // Platform ID check: only validate if principal has platform info (EE feature)
    if ((principal as any).platform?.id && project.platformId !== (principal as any).platform.id) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: { message: 'User is not allowed to access this project' },
        })
    }

    const user = await userService.getOneOrFail({ id: principal.id })
    if (userService.isUserPrivileged(user) || project.ownerId === principal.id) {
        return
    }

    throw new ActivepiecesError({
        code: ErrorCode.AUTHORIZATION,
        params: { message: 'User is not allowed to access this project' },
    })
}


async function assertPrinicpalIsOneOf< T extends readonly PrincipalType[]>(allowedPrincipals: T, currentPrincipal: PrincipalType): Promise<void> {
    if (!allowedPrincipals.includes(currentPrincipal)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'principal is not allowed for this route',
            },
        })
    }
}
