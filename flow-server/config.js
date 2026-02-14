/**
 * Flow Server Configuration
 * Configuration for Activepieces integration layer
 */

export const config = {
  // Server configuration
  port: process.env.FLOW_SERVER_PORT || 10002,
  host: process.env.FLOW_SERVER_HOST || 'localhost',
  
  // Activepieces configuration
  activepiecesUrl: process.env.ACTIVEPIECES_URL || 'https://flow.wickedlab.io',
  activepiecesApiKey: process.env.ACTIVEPIECES_API_KEY || '',
  
  // BCGPT integration
  bcgptUrl: process.env.BCGPT_URL || 'http://localhost:10000',
  
  // PMOS integration
  pmosUrl: process.env.PMOS_URL || 'http://localhost:10001',
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

export default config;
