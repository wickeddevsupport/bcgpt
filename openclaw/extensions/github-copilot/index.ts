import {
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
  emptyPluginConfigSchema,
} from "openclaw/plugin-sdk";
import { githubCopilotLoginCommand } from "../../src/providers/github-copilot-auth.js";
import { ensureAuthProfileStore } from "../../src/agents/auth-profiles/store.js";
import {
  getDefaultCopilotModelIds,
  buildCopilotModelDefinition,
} from "../../src/providers/github-copilot-models.js";
import { DEFAULT_COPILOT_API_BASE_URL } from "../../src/providers/github-copilot-token.js";

const PROVIDER_ID = "github-copilot";
const PROFILE_ID = "github-copilot:github";
const DEFAULT_MODEL = "github-copilot/gpt-4.1";

async function runGitHubCopilotAuth(ctx: ProviderAuthContext): Promise<ProviderAuthResult> {
  await ctx.prompter.note(
    [
      "This will open a GitHub device login to authorize Copilot.",
      "Requires an active GitHub Copilot subscription.",
    ].join("\n"),
    "GitHub Copilot",
  );

  if (!process.stdin.isTTY) {
    await ctx.prompter.note(
      "GitHub Copilot login requires an interactive terminal (TTY). " +
        "Run this auth step via SSH into the server.",
      "GitHub Copilot",
    );
    return { profiles: [] };
  }

  try {
    await githubCopilotLoginCommand({ yes: true, profileId: PROFILE_ID }, ctx.runtime);
  } catch (err) {
    await ctx.prompter.note(`GitHub Copilot login failed: ${String(err)}`, "GitHub Copilot");
    return { profiles: [] };
  }

  const authStore = ensureAuthProfileStore(undefined, { allowKeychainPrompt: false });
  const credential = authStore.profiles[PROFILE_ID];
  if (!credential || credential.type !== "token") {
    return { profiles: [] };
  }

  const models = getDefaultCopilotModelIds().map(buildCopilotModelDefinition);

  return {
    profiles: [{ profileId: PROFILE_ID, credential }],
    configPatch: {
      models: {
        providers: {
          [PROVIDER_ID]: {
            baseUrl: DEFAULT_COPILOT_API_BASE_URL,
            models,
          } as never,
        },
      },
    },
    defaultModel: DEFAULT_MODEL,
    notes: [
      `Connected to GitHub Copilot. Models available: ${getDefaultCopilotModelIds().join(", ")}`,
      `Default model: ${DEFAULT_MODEL}. Change in PMOS model settings.`,
    ],
  };
}

const githubCopilotPlugin = {
  id: PROVIDER_ID,
  name: "GitHub Copilot Provider",
  description: "GitHub Copilot provider plugin -- device login for GPT-4.1, GPT-4o, and more",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "GitHub Copilot",
      docsPath: "/providers/models",
      envVars: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
      auth: [
        {
          id: "device",
          label: "GitHub device login",
          hint: "Browser device-code flow",
          kind: "device_code",
          run: runGitHubCopilotAuth,
        },
      ],
    });
  },
};

export default githubCopilotPlugin;
