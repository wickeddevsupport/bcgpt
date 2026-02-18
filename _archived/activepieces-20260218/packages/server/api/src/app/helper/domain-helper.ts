import { AppSystemProp } from '@activepieces/server-shared'
import { FastifyBaseLogger } from 'fastify'
import { system } from './system/system'

type PublicUrlParams = {
    path: string
    platformId?: string | null
}

function cleanLeadingSlash(path: string): string {
    return String(path || '').replace(/^\/+/, '')
}

function trimTrailingSlash(url: string): string {
    return String(url || '').replace(/\/+$/, '')
}

function getFrontendUrl(): string {
    // In CE we keep this simple and rely on AP_FRONTEND_URL environment variable.
    // Custom domains (EE) are intentionally not supported here.
    const frontendUrl = process.env['AP_FRONTEND_URL'] || ''
    return trimTrailingSlash(frontendUrl)
}

export const domainHelper = {
    async getPublicUrl({ path, _platformId }: PublicUrlParams & { _platformId?: string | null }): Promise<string> {
        const base = getFrontendUrl()
        const p = cleanLeadingSlash(path ?? '')
        return p ? `${base}/${p}` : base
    },
    async getPublicApiUrl({ path, platformId }: PublicUrlParams): Promise<string> {
        const apiPath = cleanLeadingSlash(path ?? '')
        const withApiPrefix = apiPath ? `api/${apiPath}` : 'api'
        return this.getPublicUrl({ path: withApiPrefix, platformId })
    },
    async getApiUrlForWorker({ path, platformId }: PublicUrlParams): Promise<string> {
        // Workers call back into the public API URL in CE deployments.
        return this.getPublicApiUrl({ path, platformId })
    },
    // Keep the signature used by callers; log is unused in CE.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getPublicApiBaseUrl(_log?: FastifyBaseLogger): Promise<string> {
        return this.getPublicApiUrl({ path: '', platformId: null })
    },
}

