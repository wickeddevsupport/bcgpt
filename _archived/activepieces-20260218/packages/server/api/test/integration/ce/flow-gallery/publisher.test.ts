import { apId, TemplateStatus, TemplateType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { initializeDatabase } from '../../../../../src/app/database'
import { databaseConnection } from '../../../../../src/app/database/database-connection'
import { setupServer } from '../../../../../src/app/server'

let app: FastifyInstance | null = null

beforeAll(async () => {
    await initializeDatabase({ runMigrations: false })
    app = await setupServer()
})

beforeEach(async () => {
    await databaseConnection().getRepository('flow_gallery_run').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('flow_gallery_app').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('template').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('project').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('platform').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('user').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('user_identity').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('flag').createQueryBuilder().delete().execute()
})

afterAll(async () => {
    await databaseConnection().destroy()
    await app?.close()
})

async function createSignedInUser() {
    const email = `publisher-${apId()}@example.com`
    const password = 'TestPassword123!'
    const response = await app?.inject({
        method: 'POST',
        url: '/v1/authentication/sign-up',
        body: {
            email,
            password,
            firstName: 'Publisher',
            lastName: 'User',
            trackEvents: true,
            newsLetter: false,
        },
    })
    expect(response?.statusCode).toBe(StatusCodes.OK)
    const body = response?.json()
    return {
        token: body.token as string,
        platformId: body.platformId as string,
    }
}

async function createTemplateForPlatform(platformId: string) {
    const templateId = apId()
    await databaseConnection().getRepository('template').insert({
        id: templateId,
        name: 'Publisher Template',
        summary: 'Template used for publisher integration tests',
        description: 'Template description',
        type: TemplateType.CUSTOM,
        platformId,
        status: TemplateStatus.DRAFT,
        flows: [],
        tables: [],
        tags: [],
        blogUrl: null,
        metadata: null,
        author: 'QA',
        categories: ['QA'],
        pieces: [],
    } as never)
    return templateId
}

describe('Flow Gallery Publisher API', () => {
    it('publishes, updates, lists, and unpublishes an app', async () => {
        const { token, platformId } = await createSignedInUser()
        const templateId = await createTemplateForPlatform(platformId)

        const publishResponse = await app?.inject({
            method: 'POST',
            url: '/apps/api/publisher/publish',
            headers: {
                authorization: `Bearer ${token}`,
            },
            body: {
                templateId,
                description: 'Initial publish description',
                category: 'OPERATIONS',
                featured: true,
                outputType: 'json',
                inputSchema: {
                    fields: [
                        {
                            name: 'request',
                            label: 'Request',
                            type: 'textarea',
                            required: true,
                        },
                    ],
                },
            },
        })

        expect(publishResponse?.statusCode).toBe(StatusCodes.CREATED)
        const publishedBody = publishResponse?.json()
        expect(publishedBody.templateId).toBe(templateId)
        expect(publishedBody.category).toBe('OPERATIONS')
        expect(publishedBody.featured).toBe(true)

        const listResponse = await app?.inject({
            method: 'GET',
            url: '/apps/api/publisher/apps',
            headers: {
                authorization: `Bearer ${token}`,
            },
        })
        expect(listResponse?.statusCode).toBe(StatusCodes.OK)
        const listed = listResponse?.json()
        expect(Array.isArray(listed.data)).toBe(true)
        expect(listed.data.some((item: { id: string }) => item.id === templateId)).toBe(true)

        const updateResponse = await app?.inject({
            method: 'PUT',
            url: `/apps/api/publisher/apps/${templateId}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
            body: {
                description: 'Updated description',
                featured: false,
                outputType: 'markdown',
            },
        })
        expect(updateResponse?.statusCode).toBe(StatusCodes.OK)
        const updatedBody = updateResponse?.json()
        expect(updatedBody.description).toBe('Updated description')
        expect(updatedBody.featured).toBe(false)
        expect(updatedBody.outputType).toBe('markdown')

        const unpublishResponse = await app?.inject({
            method: 'DELETE',
            url: `/apps/api/publisher/apps/${templateId}`,
            headers: {
                authorization: `Bearer ${token}`,
            },
        })
        expect(unpublishResponse?.statusCode).toBe(StatusCodes.NO_CONTENT)
    })

    it('rejects unauthenticated publish requests', async () => {
        const response = await app?.inject({
            method: 'POST',
            url: '/apps/api/publisher/publish',
            body: {
                templateId: apId(),
                description: 'Should fail',
            },
        })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        const body = response?.json()
        expect(body.code).toBe('AUTHORIZATION')
    })
})

