import { ActivepiecesError, ErrorCode, isNil, Principal, PrincipalType } from '@activepieces/shared'
import { nanoid } from 'nanoid'
import { accessTokenManager } from '../../../../authentication/lib/access-token-manager'
import { system } from '../../../../helper/system/system'
import { apiKeyService } from '../../../../api-key/api-key-service'

export const authenticateOrThrow = async (rawToken: string | null): Promise<Principal> => {
    // API key authentication (Bearer ap_...)
    if (!isNil(rawToken) && rawToken.startsWith('Bearer ap_')) {
        const trimBearerPrefix = rawToken.replace('Bearer ', '')
        return createPrincipalForApiKey(trimBearerPrefix)
    }
    // JWT authentication (Bearer eyJ...)
    if (!isNil(rawToken) && rawToken.startsWith('Bearer ')) {
        const trimBearerPrefix = rawToken.replace('Bearer ', '')
        return accessTokenManager.verifyPrincipal(trimBearerPrefix)
    }
    return {
        id: nanoid(),
        type: PrincipalType.UNKNOWN,
    }
}

async function createPrincipalForApiKey(apiKeyValue: string): Promise<Principal> {
    const apiKey = await apiKeyService(system.globalLogger()).getByValue(apiKeyValue)
    if (isNil(apiKey)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHENTICATION,
            params: {
                message: 'invalid api key',
            },
        })
    }
    if (isNil(apiKey.platformId)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHENTICATION,
            params: {
                message: 'api key has no associated platform',
            },
        })
    }
    return {
        id: apiKey.id,
        type: PrincipalType.SERVICE,
        platform: {
            id: apiKey.platformId,
        },
    }
}
