import {
    ActivepiecesError,
    ErrorCode,
    isNil,
    ListTemplatesRequestQuery,
    SeekPage,
    Template,
    TemplateStatus,
    TemplateType,
    FlowTriggerType,
    FlowActionType,
    PropertyExecutionType,
} from '@activepieces/shared'

const TEMPLATES_SOURCE_URL = 'https://cloud.activepieces.com/api/v1/templates'
const LOCAL_TEMPLATES: Template[] = buildLocalTemplates()
const LOCAL_CATEGORIES = Array.from(
    new Set(LOCAL_TEMPLATES.flatMap((t) => t.categories || [])),
)
export const communityTemplates = {
    getOrThrow: async (id: string): Promise<Template> => {
        const local = LOCAL_TEMPLATES.find((t) => t.id === id)
        if (local) {
            return local
        }
        const url = `${TEMPLATES_SOURCE_URL}/${id}`
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })
        if (!response.ok) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'template',
                    entityId: id,
                    message: `Template ${id} not found`,
                },
            })
        }
        const template = await response.json()
        return template
    },
    getCategories: async (): Promise<string[]> => {
        const url = `${TEMPLATES_SOURCE_URL}/categories`
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })
        if (!response.ok) {
            // Templates are a convenience feature; avoid breaking the UI if the cloud endpoint is down.
            return Array.from(new Set([...LOCAL_CATEGORIES]))
        }

        const payload: unknown = await response.json()
        const remoteCategoriesRaw: unknown =
            Array.isArray(payload)
                ? payload
                : payload != null && typeof payload === 'object' && 'value' in payload
                    ? (payload as { value?: unknown }).value
                    : payload != null && typeof payload === 'object' && 'data' in payload
                        ? (payload as { data?: unknown }).data
                        : []

        const remoteCategories = Array.isArray(remoteCategoriesRaw)
            ? remoteCategoriesRaw.filter((c): c is string => typeof c === 'string')
            : []

        return Array.from(new Set([...remoteCategories, ...LOCAL_CATEGORIES]))
    },
    list: async (request: ListTemplatesRequestQuery): Promise<SeekPage<Template>> => {
        const queryString = convertToQueryString(request)
        const url = `${TEMPLATES_SOURCE_URL}?${queryString}`
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })
        const templates = await response.json()
        const localMatches = filterTemplates(LOCAL_TEMPLATES, request)
        const data = Array.isArray(templates?.data)
            ? [...localMatches, ...templates.data]
            : localMatches
        return {
            data,
            next: templates?.next ?? null,
            previous: templates?.previous ?? null,
        }
    },
}

function filterTemplates(templates: Template[], request: ListTemplatesRequestQuery): Template[] {
    const search = request.search ? request.search.toLowerCase() : null
    return templates.filter((template) => {
        if (request.type && template.type !== request.type) {
            return false
        }
        if (request.category && !(template.categories || []).includes(request.category)) {
            return false
        }
        if (request.pieces?.length) {
            const hasPiece = request.pieces.some((piece) =>
                (template.pieces || []).includes(piece),
            )
            if (!hasPiece) return false
        }
        if (request.tags?.length) {
            const tagTitles = (template.tags || []).map((t) => t.title)
            const hasTag = request.tags.some((tag) => tagTitles.includes(tag))
            if (!hasTag) return false
        }
        if (search) {
            const haystack = `${template.name} ${template.summary} ${template.description}`.toLowerCase()
            if (!haystack.includes(search)) return false
        }
        return true
    })
}

function buildLocalTemplates(): Template[] {
    const now = new Date().toISOString()
    const templateId = 'wickedflow-basecamp-todo-slack-whatsapp'

    return [
        {
            id: templateId,
            created: now,
            updated: now,
            name: 'New Basecamp Todo -> Slack + WhatsApp',
            summary: 'Notify Slack and WhatsApp when a new Basecamp todo is created.',
            description:
                'Watches a Basecamp project for new todos and notifies both Slack and WhatsApp.',
            tags: [
                {
                    title: 'Basecamp',
                    color: '#FF415B',
                    icon: '/branding/basecamp.svg',
                },
            ],
            blogUrl: null,
            metadata: null,
            author: 'Wicked Flow',
            categories: ['Basecamp'],
            pieces: [
                '@activepieces/piece-basecamp',
                '@activepieces/piece-slack',
                '@activepieces/piece-whatsapp',
            ],
            platformId: null,
            flows: [buildBasecampSlackWhatsappFlow()],
            tables: [],
            status: TemplateStatus.PUBLISHED,
            type: TemplateType.OFFICIAL,
        },
    ]
}

function buildBasecampSlackWhatsappFlow() {
    const basecampTrigger = {
        name: 'trigger',
        displayName: 'New Todo',
        type: FlowTriggerType.PIECE,
        valid: true,
        settings: {
            pieceName: '@activepieces/piece-basecamp',
            pieceVersion: '0.0.1',
            triggerName: 'new_todo',
            input: {
                project: '',
            },
            propertySettings: {
                project: { type: PropertyExecutionType.MANUAL },
            },
        },
        nextAction: buildSlackAction(),
    }

    return {
        displayName: 'Basecamp Todo Notifications',
        trigger: basecampTrigger,
        valid: true,
        schemaVersion: '16',
        description: 'Send new Basecamp todos to Slack and WhatsApp.',
        notes: [],
    }
}

function buildSlackAction() {
    return {
        name: 'slack_notify',
        displayName: 'Send Slack Message',
        type: FlowActionType.PIECE,
        valid: true,
        settings: {
            pieceName: '@activepieces/piece-slack',
            pieceVersion: '0.11.5',
            actionName: 'send_channel_message',
            input: {
                channel: '',
                text: 'New Basecamp todo: {{trigger.content}} ({{trigger.project.name}})',
                sendAsBot: true,
            },
            propertySettings: {
                channel: { type: PropertyExecutionType.MANUAL },
                text: { type: PropertyExecutionType.MANUAL },
                sendAsBot: { type: PropertyExecutionType.MANUAL },
            },
            errorHandlingOptions: {},
        },
        nextAction: buildWhatsappAction(),
    }
}

function buildWhatsappAction() {
    return {
        name: 'whatsapp_notify',
        displayName: 'Send WhatsApp Message',
        type: FlowActionType.PIECE,
        valid: true,
        settings: {
            pieceName: '@activepieces/piece-whatsapp',
            pieceVersion: '0.2.1',
            actionName: 'sendMessage',
            input: {
                phone_number_id: '',
                to: '',
                text: 'New Basecamp todo: {{trigger.content}} ({{trigger.project.name}})',
            },
            propertySettings: {
                phone_number_id: { type: PropertyExecutionType.MANUAL },
                to: { type: PropertyExecutionType.MANUAL },
                text: { type: PropertyExecutionType.MANUAL },
            },
            errorHandlingOptions: {},
        },
        nextAction: undefined,
    }
}

function convertToQueryString(params: ListTemplatesRequestQuery): string {
    const searchParams = new URLSearchParams()

    Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach((val) => {
                if (!isNil(val)) {
                    searchParams.append(key, typeof val === 'string' ? val : JSON.stringify(val))
                }
            })
        }
        else if (!isNil(value)) {
            searchParams.set(key, value.toString())
        }
    })

    return searchParams.toString()
}
