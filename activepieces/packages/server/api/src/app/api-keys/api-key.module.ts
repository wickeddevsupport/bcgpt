import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { apiKeyController } from './api-key.controller'

export const apiKeyModule: FastifyPluginAsyncTypebox = async (app) => {
    await app.register(apiKeyController, { prefix: '/v1/api-keys' })
}

