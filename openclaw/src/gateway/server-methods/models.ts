import type { GatewayRequestHandlers } from "./types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveWorkspaceRequestContext } from "../workspace-request.js";
import type { GatewayClient } from "./types.js";

async function loadModelsConfigForClient(
  client: GatewayClient | null,
  params: unknown,
): Promise<OpenClawConfig> {
  return (
    await resolveWorkspaceRequestContext(client, params, { configLabel: "models" })
  ).cfg as OpenClawConfig;
}

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context, client }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const cfg = await loadModelsConfigForClient(client, params);
      const models = await context.loadGatewayModelCatalog({ config: cfg });
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
