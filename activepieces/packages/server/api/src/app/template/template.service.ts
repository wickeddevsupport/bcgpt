import { ActivepiecesError, apId, CreateTemplateRequestBody, ErrorCode, FlowVersionTemplate, isNil, ListTemplatesRequestQuery, SeekPage, spreadIfDefined, Template, TemplateStatus, TemplateType, UpdateTemplateRequestBody } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { ArrayContains, ArrayOverlap, Equal, IsNull } from 'typeorm'
import { repoFactory } from '../core/db/repo-factory'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { templateValidator } from './template-validator'
import { TemplateEntity } from './template.entity'

const templateRepo = repoFactory<Template>(TemplateEntity)
const TEMPLATE_OWNER_USER_ID_METADATA_KEY = 'createdByUserId'

function toMetadataObject(metadata: unknown): Record<string, unknown> {
    if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
        return { ...(metadata as Record<string, unknown>) }
    }
    return {}
}

function getTemplateOwnerUserId(metadata: unknown): string | null {
    const metadataObject = toMetadataObject(metadata)
    const ownerUserId = metadataObject[TEMPLATE_OWNER_USER_ID_METADATA_KEY]
    if (typeof ownerUserId === 'string' && ownerUserId.trim().length > 0) {
        return ownerUserId
    }
    return null
}

function withTemplateOwnerMetadata(metadata: unknown, ownerUserId?: string): Record<string, unknown> | null {
    const nextMetadata = toMetadataObject(metadata)
    const resolvedOwnerUserId = ownerUserId ?? getTemplateOwnerUserId(metadata)
    if (!isNil(resolvedOwnerUserId) && resolvedOwnerUserId.trim().length > 0) {
        nextMetadata[TEMPLATE_OWNER_USER_ID_METADATA_KEY] = resolvedOwnerUserId
    }
    return Object.keys(nextMetadata).length > 0 ? nextMetadata : null
}

export const templateService = (log: FastifyBaseLogger) => ({
    async getOne({ id }: GetParams): Promise<Template | null> {
        return templateRepo().findOneBy({ id })
    },
    async getOneOrThrow({ id }: GetParams): Promise<Template> {
        const template = await templateRepo().findOneBy({ id })
        if (isNil(template)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'template',
                    entityId: id,
                    message: `Template ${id} not found`,
                },
            })
        }
        return template
    },
    async create({ platformId, params, createdByUserId }: CreateParams): Promise<Template> {
        const preparedTemplate = await templateValidator.validateAndPrepare({
            flows: params.flows,
            platformId,
            log,
        })

        const { flows, pieces } = preparedTemplate
        const { name, summary, description, tags, blogUrl, metadata, author, categories, type } = params
        const templateMetadata = withTemplateOwnerMetadata(metadata, createdByUserId)

        const newTags = tags ?? []

        switch (type) {
            case TemplateType.OFFICIAL:
            case TemplateType.SHARED: {
                const newTemplate: NewTemplate = {
                    id: apId(),
                    name,
                    type,
                    summary,
                    description,
                    platformId,
                    tags: newTags,
                    blogUrl,
                    metadata: templateMetadata,
                    author,
                    categories,
                    pieces,
                    flows,
                    status: TemplateStatus.PUBLISHED,
                }
                return templateRepo().save(newTemplate)
            }
            case TemplateType.CUSTOM: {
                if (isNil(platformId)) {
                    throw new ActivepiecesError({
                        code: ErrorCode.VALIDATION,
                        params: {
                            message: 'Platform ID is required to create a custom template',
                        },
                    })
                }
                const newTemplate: NewTemplate = {
                    id: apId(),
                    name,
                    type,
                    summary,
                    description,
                    platformId,
                    tags: newTags,
                    blogUrl,
                    metadata: templateMetadata,
                    author,
                    categories,
                    pieces,
                    flows,
                    status: TemplateStatus.PUBLISHED,
                }
                return templateRepo().save(newTemplate)
            }
        }
    },

    async update({ id, params, actorId }: UpdateParams): Promise<Template> {
        const { name, summary, description, tags, blogUrl, metadata, categories, status } = params
        const template = await this.getOneOrThrow({ id })
        const existingOwnerUserId = getTemplateOwnerUserId(template.metadata) ?? actorId
        const nextMetadata = !isNil(metadata)
            ? withTemplateOwnerMetadata(metadata, existingOwnerUserId)
            : undefined

        const newTags = tags ?? []

        let sanatizedFlows: FlowVersionTemplate[] | undefined = undefined
        let pieces: string[] | undefined = undefined
        if (!isNil(params.flows) && params.flows.length > 0) {
            const preparedTemplate = await templateValidator.validateAndPrepare({
                flows: params.flows,
                platformId: undefined,
                log,
            })
            sanatizedFlows = preparedTemplate.flows
            pieces = preparedTemplate.pieces
        }

        switch (template.type) {
            case TemplateType.OFFICIAL:
            case TemplateType.SHARED: {
                await templateRepo().update(id, {
                    ...spreadIfDefined('name', name),
                    ...spreadIfDefined('summary', summary),
                    ...spreadIfDefined('description', description),
                    ...spreadIfDefined('tags', tags),
                    ...spreadIfDefined('blogUrl', blogUrl),
                    ...spreadIfDefined('metadata', nextMetadata),
                    ...spreadIfDefined('categories', categories),
                    ...spreadIfDefined('flows', sanatizedFlows),
                    ...spreadIfDefined('pieces', pieces),
                    ...spreadIfDefined('tags', newTags),
                    ...spreadIfDefined('status', status),
                })
                return templateRepo().findOneByOrFail({ id })
            }
            case TemplateType.CUSTOM: {
                await templateRepo().update(id, {
                    ...spreadIfDefined('name', name),
                    ...spreadIfDefined('summary', summary),
                    ...spreadIfDefined('description', description),
                    ...spreadIfDefined('tags', tags),
                    ...spreadIfDefined('blogUrl', blogUrl),
                    ...spreadIfDefined('metadata', nextMetadata),
                    ...spreadIfDefined('categories', categories),
                    ...spreadIfDefined('flows', sanatizedFlows),
                    ...spreadIfDefined('pieces', pieces),
                    ...spreadIfDefined('tags', newTags),
                    ...spreadIfDefined('status', status),
                })
                return templateRepo().findOneByOrFail({ id })
            }
        }
    },

    async list({ platformId, pieces, tags, search, type, category, includeArchived }: ListParams): Promise<SeekPage<Template>> {
        const commonFilters: Record<string, unknown> = {}

        if (pieces) {
            commonFilters.pieces = ArrayOverlap(pieces)
        }
        if (category) {
            commonFilters.categories = ArrayContains([category])
        }
        switch (type) {
            case TemplateType.OFFICIAL:
                commonFilters.type = Equal(TemplateType.OFFICIAL)
                commonFilters.platformId = IsNull()
                break
            case TemplateType.CUSTOM:
                commonFilters.type = Equal(TemplateType.CUSTOM)
                if (isNil(platformId)) {
                    throw new ActivepiecesError({
                        code: ErrorCode.VALIDATION,
                        params: {
                            message: 'Platform ID is required to list custom templates',
                        },
                    })
                }
                commonFilters.platformId = Equal(platformId)
                break
            case TemplateType.SHARED:
                throw new ActivepiecesError({
                    code: ErrorCode.VALIDATION,
                    params: {
                        message: 'Shared templates are not supported to being listed',
                    },
                })
        }
        if (!includeArchived) {
            commonFilters.status = Equal(TemplateStatus.PUBLISHED)
        }
        const queryBuilder = templateRepo()
            .createQueryBuilder('template')
            .where(commonFilters)

        if (tags && tags.length > 0) {
            queryBuilder.andWhere(
                '(SELECT array_agg(tag->>\'title\') FROM jsonb_array_elements(template.tags) tag) @> :tags::text[]',
                { tags },
            )
        }
        if (search) {
            queryBuilder.andWhere(
                '(template.name ILIKE :search OR template.summary ILIKE :search OR template.description ILIKE :search)',
                { search: `%${search}%` },
            )
        }

        const templates = await queryBuilder.getMany()
        return paginationHelper.createPage(templates, null)
    },

    async delete({ id }: DeleteParams): Promise<void> {
        await templateRepo().delete({ id })
    },
})

type GetParams = {
    id: string
}

type CreateParams = {
    platformId: string | undefined
    params: CreateTemplateRequestBody
    createdByUserId?: string
}

type NewTemplate = Omit<Template, 'created' | 'updated'>

type ListParams = Omit<ListTemplatesRequestQuery, 'type'> & {
    platformId: string | null
    type: TemplateType
}

type DeleteParams = {
    id: string
}

type UpdateParams = {
    id: string
    params: UpdateTemplateRequestBody
    actorId?: string
}

