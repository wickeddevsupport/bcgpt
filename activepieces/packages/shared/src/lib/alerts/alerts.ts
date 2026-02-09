import { Static, Type } from '@sinclair/typebox'
import { BaseModelSchema, SAFE_STRING_PATTERN } from '../common'

export enum AlertChannel {
    EMAIL = 'EMAIL',
}

export const Alert = Type.Object({
    ...BaseModelSchema,
    receiver: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
    channel: Type.Enum(AlertChannel),
    projectId: Type.String(),
})
export type Alert = Static<typeof Alert>

export const CreateAlertParams = Type.Object({
    receiver: Type.String({
        pattern: SAFE_STRING_PATTERN,
    }),
    channel: Type.Enum(AlertChannel),
    projectId: Type.String(),
})
export type CreateAlertParams = Static<typeof CreateAlertParams>

export const ListAlertsParams = Type.Object({
    projectId: Type.String(),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
})
export type ListAlertsParams = Static<typeof ListAlertsParams>

