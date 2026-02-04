class BcgptApi {
  constructor() {
    this.name = "bcgptApi";
    this.displayName = "BCGPT API";
    this.documentationUrl = "";
    this.properties = [
      {
        displayName: "Base URL",
        name: "baseUrl",
        type: "string",
        default: "https://bcgpt.wickedlab.io",
        placeholder: "https://bcgpt.wickedlab.io",
      },
      {
        displayName: "Session Key",
        name: "sessionKey",
        type: "string",
        default: "",
        description: "Session key returned by /startbcgpt.",
      },
      {
        displayName: "User Key (Optional)",
        name: "userKey",
        type: "string",
        default: "",
        description: "Optional override when using user_key-based auth.",
      },
    ];
  }
}

module.exports = BcgptApi;
