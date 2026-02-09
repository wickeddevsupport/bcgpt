import { Static, Type } from '@sinclair/typebox'
import { AiCreditsAutoTopUpState } from '../platform/platform.model'

export const PRICE_PER_EXTRA_ACTIVE_FLOWS = 0

export enum ApSubscriptionStatus {
    ACTIVE = 'active',
    INCOMPLETE = 'incomplete',
    INCOMPLETE_EXPIRED = 'incomplete_expired',
    TRIALING = 'trialing',
    PAST_DUE = 'past_due',
    CANCELED = 'canceled',
    UNPAID = 'unpaid',
}

export const UpdateActiveFlowsAddonParams = Type.Object({
    newActiveFlowsLimit: Type.Number(),
})
export type UpdateActiveFlowsAddonParams = Static<typeof UpdateActiveFlowsAddonParams>

export const CreateSubscriptionParams = Type.Object({
    newActiveFlowsLimit: Type.Number(),
})
export type CreateSubscriptionParams = Static<typeof CreateSubscriptionParams>

export const CreateAICreditCheckoutSessionParamsSchema = Type.Object({
    credits: Type.Number(),
    successUrl: Type.Optional(Type.String()),
    cancelUrl: Type.Optional(Type.String()),
})
export type CreateAICreditCheckoutSessionParamsSchema = Static<
    typeof CreateAICreditCheckoutSessionParamsSchema
>

export const UpdateAICreditsAutoTopUpParamsSchema = Type.Object({
    minThreshold: Type.Number(),
    creditsToAdd: Type.Number(),
    maxMonthlyLimit: Type.Union([Type.Number(), Type.Null()]),
    state: Type.Enum(AiCreditsAutoTopUpState),
})
export type UpdateAICreditsAutoTopUpParamsSchema = Static<
    typeof UpdateAICreditsAutoTopUpParamsSchema
>
