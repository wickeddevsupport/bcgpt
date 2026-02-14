import { securityAccess } from '@activepieces/server-shared'
import {
    ApiKeyResponseWithValue,
    ApiKeyResponseWithoutValue,
    CreateApiKeyRequest,
    PrincipalType,
} from '@activepieces/shared'
import { FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox'
import { StatusCodes } from 'http-status-codes'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { platformService } from '../platform/platform.service'
import { apiKeyService } from './api-key-service'

export const apiKeyController: FastifyPluginAsyncTypebox = async (fastify) => {
    // List API keys
    fastify.get('/', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER]),
        },
        schema: {
            tags: ['api-keys'],
            description: 'List all API keys for the current platform',
            querystring: Type.Object({
                cursor: Type.Optional(Type.String()),
                limit: Type.Optional(Type.Number()),
            }),
            response: {
                [StatusCodes.OK]: Type.Object({
                    data: Type.Array(ApiKeyResponseWithoutValue),
                    next: Type.Union([Type.String(), Type.Null()]),
                    previous: Type.Union([Type.String(), Type.Null()]),
                }),
            },
        },
    }, async (request) => {
        const platformId = request.principal.platform?.id ?? null
        
        return apiKeyService(request.log).list({
            platformId,
            cursor: request.query.cursor ?? null,
            limit: request.query.limit ?? 10,
        })
    })

    // Create API key
    fastify.post('/', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER]),
        },
        schema: {
            tags: ['api-keys'],
            description: 'Create a new API key. The key value is only returned once.',
            body: CreateApiKeyRequest,
            response: {
                [StatusCodes.CREATED]: ApiKeyResponseWithValue,
            },
        },
    }, async (request, reply) => {
        const platformId = request.principal.platform?.id ?? null
        
        const apiKey = await apiKeyService(request.log).create({
            displayName: request.body.displayName,
            platformId,
        })
        
        reply.code(StatusCodes.CREATED)
        return apiKey
    })

    // Delete API key
    fastify.delete('/:id', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER]),
        },
        schema: {
            tags: ['api-keys'],
            description: 'Delete an API key',
            params: Type.Object({
                id: Type.String(),
            }),
            response: {
                [StatusCodes.NO_CONTENT]: Type.Never(),
            },
        },
    }, async (request, reply) => {
        const platformId = request.principal.platform?.id ?? null
        
        await apiKeyService(request.log).delete({
            id: request.params.id,
            platformId,
        })
        
        reply.code(StatusCodes.NO_CONTENT)
    })
}
