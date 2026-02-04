class Bcgpt {
  constructor() {
    this.description = {
      displayName: "BCGPT",
      name: "bcgpt",
      group: ["transform"],
      version: 1,
      description: "Call BCGPT MCP tools",
      defaults: {
        name: "BCGPT",
      },
      inputs: ["main"],
      outputs: ["main"],
      credentials: [
        {
          name: "bcgptApi",
          required: true,
        },
      ],
      properties: [
        {
          displayName: "Tool Name",
          name: "tool",
          type: "string",
          default: "",
          required: true,
          description: "MCP tool name (e.g., list_projects, create_todo).",
        },
        {
          displayName: "Args",
          name: "args",
          type: "json",
          default: "{}",
          description: "JSON arguments for the MCP tool.",
        },
        {
          displayName: "Session Key Override",
          name: "sessionKeyOverride",
          type: "string",
          default: "",
          description: "Leave blank to use the credential session key.",
        },
        {
          displayName: "User Key Override",
          name: "userKeyOverride",
          type: "string",
          default: "",
          description: "Optional override when using user_key-based auth.",
        },
      ],
    };
  }

  async execute() {
    const items = this.getInputData();
    const results = [];
    const credentials = await this.getCredentials("bcgptApi");
    const baseUrl = String(credentials.baseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("Missing Base URL in BCGPT credentials.");
    }

    for (let i = 0; i < items.length; i++) {
      const tool = this.getNodeParameter("tool", i);
      let args = this.getNodeParameter("args", i);

      if (typeof args === "string") {
        try {
          args = args ? JSON.parse(args) : {};
        } catch (e) {
          throw new Error(`Invalid JSON in args: ${e.message}`);
        }
      }
      if (!args || typeof args !== "object") args = {};

      const sessionKeyOverride = this.getNodeParameter("sessionKeyOverride", i);
      const userKeyOverride = this.getNodeParameter("userKeyOverride", i);
      const sessionKey = sessionKeyOverride || credentials.sessionKey || "";
      const userKey = userKeyOverride || credentials.userKey || "";

      const body = {
        tool,
        args,
      };
      if (sessionKey) body.session_key = sessionKey;
      if (userKey) body.user_key = userKey;

      const response = await this.helpers.httpRequest({
        method: "POST",
        url: `${baseUrl}/action/mcp_call`,
        body,
        json: true,
      });

      results.push({ json: response });
    }

    return [results];
  }
}

module.exports = Bcgpt;
