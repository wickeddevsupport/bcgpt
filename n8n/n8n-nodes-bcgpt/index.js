const Bcgpt = require("./nodes/Bcgpt.node.js");
const BcgptApi = require("./credentials/BcgptApi.credentials.js");

module.exports = {
  nodes: [Bcgpt],
  credentials: [BcgptApi],
};
