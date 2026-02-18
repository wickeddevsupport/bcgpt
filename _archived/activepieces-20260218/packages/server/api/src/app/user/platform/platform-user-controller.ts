import { securityAccess } from '@activepieces/server-shared'
import {
    ActivepiecesError,
    ApId,
    assertNotNullOrUndefined,
    ListUsersRequestBody,
    PlatformRole,
    PrincipalType,
    SeekPage,
    SERVICE_KEY_SECURITY_OPENAPI,
    UpdateUserRequestBody,
    UserWithBadges,
    UserWithMetaInformation,
    ErrorCode,
} from '@activepieces/shared'
import {
    FastifyPluginAsyncTypebox,
    Type,
} from '@fastify/type-provider-typebox'
import { StatusCodes } from 'http-status-codes'
import { userService } from '../user-service'

export const platformUserController: FastifyPluginAsyncTypebox = async (app) => {
    // Needed by Sidebar user menu and various UI screens.
    // NOTE: Define `/me` before `/:id` to avoid routing ambiguity.
    app.get('/me', GetMeRequest, async (req) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')
        return userService.getOneByIdAndPlatformIdOrThrow({
            id: req.principal.id,
            platformId,
        })
    })

    app.get('/:id', GetUserRequest, async (req) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')

        // Users can always fetch their own record. Fetching other users is for admins/operators.
        if (req.params.id !== req.principal.id) {
            const requester = await userService.getOrThrow({ id: req.principal.id })
            const privileged =
                requester.platformRole === PlatformRole.ADMIN ||
                requester.platformRole === PlatformRole.OPERATOR
            if (!privileged) {
                throw new ActivepiecesError({
                    code: ErrorCode.AUTHORIZATION,
                    params: {
                        message: 'Not authorized to access this user',
                    },
                })
            }
        }

        return userService.getOneByIdAndPlatformIdOrThrow({
            id: req.params.id,
            platformId,
        })
    })

    app.get('/', ListUsersRequest, async (req) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')

        return userService.list({
            platformId,
            externalId: req.query.externalId,
            cursorRequest: req.query.cursor ?? null,
            limit: req.query.limit ?? 10,
        })
    })

    app.post('/:id', UpdateUserRequest, async (req) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')

        return userService.update({
            id: req.params.id,
            platformId,
            platformRole: req.body.platformRole,
            status: req.body.status,
            externalId: req.body.externalId,
        })
    })

    app.delete('/:id', DeleteUserRequest, async (req, res) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')

        await userService.delete({
            id: req.params.id,
            platformId,
        })

        return res.status(StatusCodes.NO_CONTENT).send()
    })
}

const ListUsersRequest = {
    schema: {
        querystring: ListUsersRequestBody,
        response: {
            [StatusCodes.OK]: SeekPage(UserWithMetaInformation),
        },
        tags: ['users'],
        description: 'List users',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
    },
    response: {
        [StatusCodes.OK]: SeekPage(UserWithMetaInformation),
    },
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
}

const GetMeRequest = {
    schema: {
        response: {
            [StatusCodes.OK]: UserWithBadges,
        },
        tags: ['users'],
        description: 'Get current user',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
    },
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
}

const GetUserRequest = {
    schema: {
        params: Type.Object({
            id: ApId,
        }),
        response: {
            [StatusCodes.OK]: UserWithBadges,
        },
        tags: ['users'],
        description: 'Get user by id',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
    },
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
}

const UpdateUserRequest = {
    schema: {
        params: Type.Object({
            id: ApId,
        }),
        body: UpdateUserRequestBody,
        response: {
            [StatusCodes.OK]: UserWithMetaInformation,
        },
        tags: ['users'],
        description: 'Update user',
        security: [SERVICE_KEY_SECURITY_OPENAPI],
    },
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
}

const DeleteUserRequest = {
    schema: {
        params: Type.Object({
            id: ApId,
        }),
    },
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
}
