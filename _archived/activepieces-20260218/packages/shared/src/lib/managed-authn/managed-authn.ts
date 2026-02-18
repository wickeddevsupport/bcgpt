import { Static, Type } from '@sinclair/typebox'

// Used by the "managed auth" API for exchanging an external token into an AP session.
// In CE builds this can be disabled, but the shared type remains for compilation.
export const ManagedAuthnRequestBody = Type.Object({
    externalToken: Type.String(),
    platformId: Type.Optional(Type.String()),
})
export type ManagedAuthnRequestBody = Static<typeof ManagedAuthnRequestBody>

