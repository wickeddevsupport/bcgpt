import { securityAccess } from '@activepieces/server-shared'
import { ApiKeyResponseWithoutValue, ApiKeyResponseWithValue, ApId, CreateApiKeyRequest, PrincipalType, SeekPage, SERVICE_KEY_SECURITY_OPENAPI } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox'
import { StatusCodes } from 'http-status-codes'
import { apiKeyService } from './api-key-service'

export const apiKeyController: FastifyPluginAsyncTypebox = async (app) => {
    app.get('/', ListApiKeysRequest, async (request) => {
        return apiKeyService(request.log).list(request.principal.platform.id)
    })

    app.post('/', CreateApiKeyRequestOptions, async (request, reply) => {
        const created = await apiKeyService(request.log).create(request.principal.platform.id, request.body)
        return reply.status(StatusCodes.CREATED).send(created)
    })

    app.delete('/:id', DeleteApiKeyRequest, async (request, reply) => {
        await apiKeyService(request.log).delete(request.principal.platform.id, request.params.id)
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const ListApiKeysRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['api-keys'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: SeekPage(ApiKeyResponseWithoutValue),
        },
    },
}

const CreateApiKeyRequestOptions = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['api-keys'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        body: CreateApiKeyRequest,
        response: {
            [StatusCodes.CREATED]: ApiKeyResponseWithValue,
        },
    },
}

const DeleteApiKeyRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        tags: ['api-keys'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        params: Type.Object({
            id: ApId,
        }),
        response: {
            [StatusCodes.NO_CONTENT]: Type.Never(),
        },
    },
}

