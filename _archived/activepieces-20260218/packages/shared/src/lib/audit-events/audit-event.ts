import { Static, Type } from '@sinclair/typebox'
import { BaseModelSchema, Nullable } from '../common'
import { SeekPage } from '../common/seek-page'

export enum ApplicationEventName {
    FLOW_CREATED = 'FLOW_CREATED',
    FLOW_UPDATED = 'FLOW_UPDATED',
    FLOW_DELETED = 'FLOW_DELETED',

    FOLDER_CREATED = 'FOLDER_CREATED',
    FOLDER_UPDATED = 'FOLDER_UPDATED',
    FOLDER_DELETED = 'FOLDER_DELETED',

    CONNECTION_UPSERTED = 'CONNECTION_UPSERTED',
    CONNECTION_DELETED = 'CONNECTION_DELETED',

    FLOW_RUN_STARTED = 'FLOW_RUN_STARTED',
    FLOW_RUN_FINISHED = 'FLOW_RUN_FINISHED',

    USER_SIGNED_UP = 'USER_SIGNED_UP',
    USER_SIGNED_IN = 'USER_SIGNED_IN',
    USER_PASSWORD_RESET = 'USER_PASSWORD_RESET',
    USER_EMAIL_VERIFIED = 'USER_EMAIL_VERIFIED',

    API_KEY_CREATED = 'API_KEY_CREATED',
    API_KEY_DELETED = 'API_KEY_DELETED',

    TEMPLATE_CREATED = 'TEMPLATE_CREATED',
    TEMPLATE_UPDATED = 'TEMPLATE_UPDATED',
    TEMPLATE_PUBLISHED = 'TEMPLATE_PUBLISHED',
}

export const ApplicationEvent = Type.Object({
    ...BaseModelSchema,
    action: Type.Enum(ApplicationEventName),
    userId: Type.String(),
    userEmail: Nullable(Type.String()),
    projectId: Nullable(Type.String()),
    // Backwards-compatible "envelope" used by the UI; keep permissive.
    data: Type.Any(),
})
export type ApplicationEvent = Static<typeof ApplicationEvent>

export const ListAuditEventsRequest = Type.Object({
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
    action: Type.Optional(Type.Array(Type.Enum(ApplicationEventName))),
    projectId: Type.Optional(Type.Array(Type.String())),
    userId: Type.Optional(Type.String()),
    createdBefore: Type.Optional(Type.String()),
    createdAfter: Type.Optional(Type.String()),
})
export type ListAuditEventsRequest = Static<typeof ListAuditEventsRequest>

export type ListAuditEventsResponse = SeekPage<ApplicationEvent>

