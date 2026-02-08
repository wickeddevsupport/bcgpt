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
const CLOUD_FETCH_TIMEOUT_MS = 15000
const LIST_CACHE_TTL_MS = 5 * 60 * 1000
const LIST_CACHE_STALE_TTL_MS = 12 * 60 * 60 * 1000
const TEMPLATE_CACHE_TTL_MS = 60 * 60 * 1000
const TEMPLATE_CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000
const CATEGORIES_CACHE_TTL_MS = 60 * 60 * 1000
const CATEGORIES_CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000

type CacheEntry<T> = {
    value: T
    fetchedAtMs: number
}

const listCache = new Map<string, CacheEntry<SeekPage<Template>>>()
const listInFlight = new Map<string, Promise<void>>()
let categoriesCache: CacheEntry<string[]> | null = null
let categoriesInFlight: Promise<void> | null = null
const templateCache = new Map<string, CacheEntry<Template>>()
const templateInFlight = new Map<string, Promise<void>>()
let lastRemoteTemplatesErrorLogAtMs = 0
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

        const cached = templateCache.get(id)
        if (cached && isFresh(cached, TEMPLATE_CACHE_TTL_MS)) {
            return cached.value
        }
        if (cached && isStaleOk(cached, TEMPLATE_CACHE_STALE_TTL_MS)) {
            refreshTemplateAsync(id)
            return cached.value
        }

        const remote = await fetchRemoteTemplate(id)
        if (!remote) {
            if (cached) {
                return cached.value
            }
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'template',
                    entityId: id,
                    message: 'Templates service is temporarily unavailable. Please try again in a moment.',
                },
            })
        }
        templateCache.set(id, { value: remote, fetchedAtMs: Date.now() })
        return remote
    },
    getCategories: async (): Promise<string[]> => {
        if (categoriesCache && isFresh(categoriesCache, CATEGORIES_CACHE_TTL_MS)) {
            return categoriesCache.value
        }
        if (categoriesCache && isStaleOk(categoriesCache, CATEGORIES_CACHE_STALE_TTL_MS)) {
            refreshCategoriesAsync()
            return categoriesCache.value
        }

        const url = `${TEMPLATES_SOURCE_URL}/categories`
        const payload: unknown = await fetchJsonOrNull(url)
        if (!payload) {
            return Array.from(new Set([...LOCAL_CATEGORIES]))
        }

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

        const merged = Array.from(new Set([...remoteCategories, ...LOCAL_CATEGORIES]))
        categoriesCache = { value: merged, fetchedAtMs: Date.now() }
        return merged
    },
    list: async (request: ListTemplatesRequestQuery): Promise<SeekPage<Template>> => {
        const queryString = convertToQueryString(request)
        const url = `${TEMPLATES_SOURCE_URL}?${queryString}`
        const cached = listCache.get(queryString)
        if (cached && isFresh(cached, LIST_CACHE_TTL_MS)) {
            return mergeLocalTemplates(cached.value, request)
        }
        if (cached && isStaleOk(cached, LIST_CACHE_STALE_TTL_MS)) {
            refreshListAsync(queryString, url)
            return mergeLocalTemplates(cached.value, request)
        }

        const remote = await fetchRemoteList(url)
        if (remote) {
            listCache.set(queryString, { value: remote, fetchedAtMs: Date.now() })
            return mergeLocalTemplates(remote, request)
        }
        if (cached) {
            return mergeLocalTemplates(cached.value, request)
        }
        const localMatches = filterTemplates(LOCAL_TEMPLATES, request)
        return {
            data: localMatches,
            next: null,
            previous: null,
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

function isFresh<T>(entry: CacheEntry<T>, ttlMs: number): boolean {
    return Date.now() - entry.fetchedAtMs < ttlMs
}

function isStaleOk<T>(entry: CacheEntry<T>, staleTtlMs: number): boolean {
    return Date.now() - entry.fetchedAtMs < staleTtlMs
}

function logRemoteTemplatesError(message: string, error?: unknown): void {
    const now = Date.now()
    if (now - lastRemoteTemplatesErrorLogAtMs < 5 * 60 * 1000) {
        return
    }
    lastRemoteTemplatesErrorLogAtMs = now
    // eslint-disable-next-line no-console
    console.error(`[communityTemplates] ${message}`, error)
}

async function fetchJsonOrNull(url: string): Promise<unknown | null> {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
            return null
        }
        return await response.json()
    }
    catch (error) {
        return null
    }
}

function extractSeekPage(payload: unknown): SeekPage<Template> | null {
    const candidates: unknown[] = [payload]
    if (payload != null && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>
        if ('value' in obj) candidates.push(obj.value)
        if ('data' in obj) candidates.push(obj.data)
    }

    for (const candidate of candidates) {
        if (candidate == null || typeof candidate !== 'object') {
            continue
        }
        const obj = candidate as Record<string, unknown>
        if (Array.isArray(obj.data)) {
            return {
                data: obj.data as Template[],
                next: (obj.next as string | null | undefined) ?? null,
                previous: (obj.previous as string | null | undefined) ?? null,
            }
        }
    }
    return null
}

async function fetchRemoteList(url: string): Promise<SeekPage<Template> | null> {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
            logRemoteTemplatesError(`Remote templates list returned ${response.status} for ${url}`)
            return null
        }
        const payload = await response.json()
        const page = extractSeekPage(payload)
        if (!page) {
            logRemoteTemplatesError(`Remote templates list returned unexpected payload for ${url}`)
            return null
        }
        return page
    }
    catch (error) {
        logRemoteTemplatesError(`Remote templates list failed for ${url}`, error)
        return null
    }
}

function refreshListAsync(cacheKey: string, url: string): void {
    if (listInFlight.has(cacheKey)) {
        return
    }
    const promise = fetchRemoteList(url)
        .then((page) => {
            if (page) {
                listCache.set(cacheKey, { value: page, fetchedAtMs: Date.now() })
            }
        })
        .catch(() => undefined)
        .finally(() => {
            listInFlight.delete(cacheKey)
        })
    listInFlight.set(cacheKey, promise)
}

async function fetchRemoteTemplate(id: string): Promise<Template | null> {
    const url = `${TEMPLATES_SOURCE_URL}/${id}`
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
            return null
        }
        const payload = await response.json()
        if (payload == null || typeof payload !== 'object') {
            return null
        }
        const template = payload as Template
        return typeof template.id === 'string' ? template : null
    }
    catch (error) {
        return null
    }
}

function refreshTemplateAsync(id: string): void {
    if (templateInFlight.has(id)) {
        return
    }
    const promise = fetchRemoteTemplate(id)
        .then((template) => {
            if (template) {
                templateCache.set(id, { value: template, fetchedAtMs: Date.now() })
            }
        })
        .catch(() => undefined)
        .finally(() => {
            templateInFlight.delete(id)
        })
    templateInFlight.set(id, promise)
}

async function fetchRemoteCategories(): Promise<string[] | null> {
    const url = `${TEMPLATES_SOURCE_URL}/categories`
    const payload = await fetchJsonOrNull(url)
    if (!payload) {
        return null
    }
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
}

function refreshCategoriesAsync(): void {
    if (categoriesInFlight) {
        return
    }
    categoriesInFlight = fetchRemoteCategories()
        .then((cats) => {
            if (cats) {
                categoriesCache = { value: cats, fetchedAtMs: Date.now() }
            }
        })
        .catch(() => undefined)
        .finally(() => {
            categoriesInFlight = null
        })
}

function mergeLocalTemplates(
    remote: SeekPage<Template>,
    request: ListTemplatesRequestQuery,
): SeekPage<Template> {
    const localMatches = filterTemplates(LOCAL_TEMPLATES, request)
    const combined = [...localMatches, ...(remote.data ?? [])]

    const seen = new Set<string>()
    const deduped: Template[] = []
    for (const t of combined) {
        if (t?.id && !seen.has(t.id)) {
            seen.add(t.id)
            deduped.push(t)
        }
    }

    return {
        data: deduped,
        next: remote.next ?? null,
        previous: remote.previous ?? null,
    }
}
