import { securityAccess } from '@activepieces/server-shared'
import {
    ActivepiecesError,
    ApId,
    ErrorCode,
    FileType,
    PlatformWithoutSensitiveData,
    PrincipalType,
    SERVICE_KEY_SECURITY_OPENAPI,
    UpdatePlatformRequestBody,
} from '@activepieces/shared'
import {
    FastifyPluginAsyncTypebox,
    Type,
} from '@fastify/type-provider-typebox'
import { StatusCodes } from 'http-status-codes'
import { fileService } from '../file/file.service'
import { platformService } from './platform.service'

export const platformController: FastifyPluginAsyncTypebox = async (app) => {
    app.post('/:id', UpdatePlatformRequest, async (req, _res) => {
        const platformId = req.principal.platform.id

        const [logoIconUrl, fullLogoUrl, favIconUrl] = await Promise.all([
            fileService(app.log).uploadPublicAsset({
                file: req.body.logoIcon,
                type: FileType.PLATFORM_ASSET,
                platformId,
                metadata: { platformId },
            }),
            fileService(app.log).uploadPublicAsset({
                file: req.body.fullLogo,
                type: FileType.PLATFORM_ASSET,
                platformId,
                metadata: { platformId },
            }),
            fileService(app.log).uploadPublicAsset({
                file: req.body.favIcon,
                type: FileType.PLATFORM_ASSET,
                platformId,
                metadata: { platformId },
            }),
        ])

        await platformService.update({
            id: req.params.id,
            ...req.body,
            logoIconUrl,
            fullLogoUrl,
            favIconUrl,
        })
        return platformService.getOneWithPlanAndUsageOrThrow(req.params.id)
    })

    app.get('/:id', GetPlatformRequest, async (req) => {
        if (req.principal.platform.id !== req.params.id) {
            throw new ActivepiecesError({
                code: ErrorCode.AUTHORIZATION,
                params: {
                    message: 'You are not authorized to access this platform',
                },
            })
        }
        return platformService.getOneWithPlanAndUsageOrThrow(req.principal.platform.id)
    })

    app.get('/assets/:id', GetAssetRequest, async (req, reply) => {
        const [file, data] = await Promise.all([
            fileService(app.log).getFileOrThrow({ fileId: req.params.id }),
            fileService(app.log).getDataOrThrow({ fileId: req.params.id })])

        return reply
            .header(
                'Content-Disposition',
                `attachment; filename="${encodeURI(file.fileName ?? '')}"`,
            )
            .type(file.metadata?.mimetype ?? 'application/octet-stream')
            .status(StatusCodes.OK)
            .send(data.data)
    })

}

const UpdatePlatformRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        body: UpdatePlatformRequestBody,
        params: Type.Object({
            id: ApId,
        }),
        response: {
            [StatusCodes.OK]: PlatformWithoutSensitiveData,
        },
    },
}


const GetPlatformRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['platforms'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Get a platform by id',
        params: Type.Object({
            id: ApId,
        }),
        response: {
            [StatusCodes.OK]: PlatformWithoutSensitiveData,
        },
    },
}

const GetAssetRequest = {
    config: {
        security: securityAccess.public(),
    },
    schema: {
        params: Type.Object({
            id: Type.String(),
        }),
    },
}
