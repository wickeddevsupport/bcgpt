import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  createAgentEndHandler,
  createBeforeAgentStartHandler,
  pluginConfigSchema,
  resolvePmosSmartMemoryConfig,
} from "./runtime.js";

const pmosSmartMemoryPlugin = {
  id: "pmos-smart-memory",
  name: "PMOS Smart Memory",
  description: "Workspace-scoped auto-recall and durable fact capture for PMOS chats",
  configSchema: pluginConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolvePmosSmartMemoryConfig(api.pluginConfig);
    api.on("before_agent_start", createBeforeAgentStartHandler({ config, logger: api.logger }));
    api.on("agent_end", createAgentEndHandler({ config, logger: api.logger }));
  },
};

export default pmosSmartMemoryPlugin;