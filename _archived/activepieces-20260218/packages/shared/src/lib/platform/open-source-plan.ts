import { AiCreditsAutoTopUpState, PlatformPlanLimits, TeamProjectsLimit } from './platform.model'

// CE-safe defaults. These flags gate UI features; keep conservative defaults.
export const OPEN_SOURCE_PLAN: PlatformPlanLimits = {
    includedAiCredits: 0,
    tablesEnabled: true,
    eventStreamingEnabled: false,
    aiCreditsAutoTopUpState: AiCreditsAutoTopUpState.DISABLED,
    environmentsEnabled: false,
    analyticsEnabled: false,
    showPoweredBy: false,
    auditLogEnabled: false,
    embeddingEnabled: true,
    managePiecesEnabled: true,
    manageTemplatesEnabled: true,
    customAppearanceEnabled: true,
    teamProjectsLimit: TeamProjectsLimit.UNLIMITED,
    projectRolesEnabled: false,
    customDomainsEnabled: false,
    globalConnectionsEnabled: false,
    customRolesEnabled: false,
    apiKeysEnabled: false,
    ssoEnabled: false,
    projectsLimit: null,
    activeFlowsLimit: null,
    maxAutoTopUpCreditsMonthly: null,
    dedicatedWorkers: null,
}

