import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { flowGalleryController } from './flow-gallery.controller'

/**
 * Flow Gallery Module
 * 
 * Registers the public gallery and app execution endpoints
 * 
 * Routes:
 * - GET /apps - Gallery home page (HTML)
 * - GET /apps/api/apps - List apps (JSON API)
 * - GET /apps/:id - App runtime page (HTML)
 * - POST /apps/:id/execute - Execute workflow
 * 
 * PRD Reference: Flow App Store - Module Integration
 */

export const flowGalleryModule: FastifyPluginAsyncTypebox = async (fastify) => {
    await fastify.register(flowGalleryController, { prefix: '/apps' })
}
