/**
 * PMOS Server Configuration
 * Central configuration for the intelligence layer
 */

export const config = {
  // Server configuration
  port: process.env.PMOS_PORT || 10001,
  host: process.env.PMOS_HOST || 'localhost',
  
  // BCGPT integration
  bcgptUrl: process.env.BCGPT_URL || 'http://localhost:10000',
  bcgptApiKey: process.env.BCGPT_API_KEY || '',
  
  // Flow integration
  flowUrl: process.env.FLOW_URL || 'https://flow.wickedlab.io',

  // Optional shell auth for PMOS interactive APIs
  shellToken: process.env.PMOS_SHELL_TOKEN || '',
  
  // Database
  dbPath: process.env.PMOS_DB_PATH || './pmos-data.db',
  
  // Intelligence settings
  intelligence: {
    healthScoring: {
      enabled: true,
      updateInterval: 3600000, // 1 hour
      factors: {
        activity: 0.3,
        velocity: 0.25,
        completion: 0.25,
        communication: 0.2
      }
    },
    predictions: {
      enabled: true,
      lookAheadDays: 30,
      confidenceThreshold: 0.7
    },
    contextAnalysis: {
      enabled: true,
      maxContextItems: 50,
      relevanceThreshold: 0.6
    },
    patternDetection: {
      enabled: true,
      minOccurrences: 3,
      timeWindowDays: 90
    }
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json'
  }
};

export default config;
