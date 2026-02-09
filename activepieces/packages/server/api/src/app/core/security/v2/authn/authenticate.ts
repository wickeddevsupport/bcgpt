import { ActivepiecesError, ErrorCode, isNil, Principal, PrincipalType } from '@activepieces/shared'
import { nanoid } from 'nanoid'
import { accessTokenManager } from '../../../../authentication/lib/access-token-manager'
import { system } from '../../../../helper/system/system'

export const authenticateOrThrow = async (rawToken: string | null): Promise<Principal> => {
    // TODO: Implement API key authentication when available
    // if (!isNil(rawToken) && rawToken.startsWith('Bearer sk-')) {
    //     const trimBearerPrefix = rawToken.replace('Bearer ', '')
    //     return createPrincipalForApiKey(trimBearerPrefix)
    // }
    if (!isNil(rawToken) && rawToken.startsWith('Bearer ')) {
        const trimBearerPrefix = rawToken.replace('Bearer ', '')
        return accessTokenManager.verifyPrincipal(trimBearerPrefix)
    }
    return {
        id: nanoid(),
        type: PrincipalType.UNKNOWN,
    }
}

// TODO: Implement API key authentication when available
// async function createPrincipalForApiKey(apiKeyValue: string): Promise<Principal> {
//     const apiKey = await apiKeyService(system.globalLogger()).getByValue(apiKeyValue)
//     if (isNil(apiKey)) {
//         throw new ActivepiecesError({
//             code: ErrorCode.AUTHENTICATION,
//             params: {
//                 message: 'invalid api key',
//             },
//         })
//     }
//     return {
//         id: apiKey.id,
//         type: PrincipalType.SERVICE,
//         platform: {
//             id: apiKey.platformId,
//         },
//     }
// }

