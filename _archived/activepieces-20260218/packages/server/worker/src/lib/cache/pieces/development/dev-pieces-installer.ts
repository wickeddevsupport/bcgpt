import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { filePiecesUtils } from '@activepieces/server-shared'
import { FastifyBaseLogger } from 'fastify'

const baseDistPath = resolve(cwd(), 'dist', 'packages')
const linkType: 'junction' | 'dir' = process.platform === 'win32' ? 'junction' : 'dir'
const sharedPiecesPackages = () => {
    const packages: Record<string, { path: string }> = {
        '@activepieces/pieces-framework': {
            path: resolve(baseDistPath, 'pieces', 'community', 'framework'),
        },
        '@activepieces/pieces-common': {
            path: resolve(baseDistPath, 'pieces', 'community', 'common'),
        },
        '@activepieces/shared': {
            path: resolve(cwd(), 'dist', 'packages', 'shared'),
        },
    }

    return packages
}

const linkDependencyToPackage = (log: FastifyBaseLogger, packagePath: string, dependency: string, targetPath: string): void => {
    try {
        if (!existsSync(targetPath)) {
            log.error({ dependency, targetPath }, 'Dependency target path does not exist')
            return
        }

        const scopeDir = resolve(packagePath, 'node_modules', '@activepieces')
        mkdirSync(scopeDir, { recursive: true })

        const dependencyName = dependency.split('/')[1]
        const linkPath = resolve(scopeDir, dependencyName)
        rmSync(linkPath, { recursive: true, force: true })
        symlinkSync(targetPath, linkPath, linkType)
    }
    catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e)
        log.error({
            name: 'linkDependencyToPackage',
            dependency,
            packagePath,
            targetPath,
            error: errorMessage,
        }, 'Error linking dependency to package (non-fatal)')
    }
}


export const devPiecesInstaller = (log: FastifyBaseLogger) => ({
    linkSharedActivepiecesPackagesToPiece: async (packageName: string): Promise<void> => {
        const packagePath = await filePiecesUtils(log).findDistPiecePathByPackageName(packageName)
        if (!packagePath) {
            log.error({ packageName }, 'Could not find dist path for package')
            return
        }

        const dependencies = await filePiecesUtils(log).getPieceDependencies(packagePath)
        const packages = sharedPiecesPackages()
        const apDependencies = Object.keys(dependencies ?? {}).filter(
            dep => dep.startsWith('@activepieces/') && packageName !== dep && packages[dep],
        )

        for (const dependency of apDependencies) {
            linkDependencyToPackage(log, packagePath, dependency, packages[dependency].path)
        }
    },

    initSharedPackagesLinks: async (): Promise<void> => {
        // No-op when using filesystem links instead of bun link.
        return
    },

    linkSharedActivepiecesPackagesToEachOther: async (): Promise<void> => {
        const packages = sharedPiecesPackages()
        const packageNames = Object.keys(packages)

        for (const [packageName, pkg] of Object.entries(packages)) {
            const dependencies = await filePiecesUtils(log).getPieceDependencies(pkg.path)
            const apDependencies = Object.keys(dependencies ?? {}).filter(
                dep => dep.startsWith('@activepieces/') && packageName !== dep && packageNames.includes(dep),
            )

            for (const dependency of apDependencies) {
                linkDependencyToPackage(log, pkg.path, dependency, packages[dependency].path)
            }
        }
    },
})
