// db.js
//
// Storage adapter:
// - Default: SQLite (better-sqlite3) via ./db.sqlite.js
// - Optional: Postgres via DATABASE_URL (./db.postgres.js)
//
// All exports are async so callers can `await` regardless of backend.

const usePostgres = !!(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());

const impl = usePostgres ? await import("./db.postgres.js") : await import("./db.sqlite.js");

export const DB_KIND = usePostgres ? "postgres" : "sqlite";

export const getToken = async (...args) => await impl.getToken(...args);
export const setToken = async (...args) => await impl.setToken(...args);
export const clearToken = async (...args) => await impl.clearToken(...args);

export const getAuthCache = async (...args) => await impl.getAuthCache(...args);
export const setAuthCache = async (...args) => await impl.setAuthCache(...args);
export const clearAuthCache = async (...args) => await impl.clearAuthCache(...args);

export const getUserToken = async (...args) => await impl.getUserToken(...args);
export const setUserToken = async (...args) => await impl.setUserToken(...args);
export const clearUserToken = async (...args) => await impl.clearUserToken(...args);

export const getUserAuthCache = async (...args) => await impl.getUserAuthCache(...args);
export const setUserAuthCache = async (...args) => await impl.setUserAuthCache(...args);
export const clearUserAuthCache = async (...args) => await impl.clearUserAuthCache(...args);

export const createSession = async (...args) => await impl.createSession(...args);
export const bindSession = async (...args) => await impl.bindSession(...args);
export const getSessionUser = async (...args) => await impl.getSessionUser(...args);
export const deleteSession = async (...args) => await impl.deleteSession(...args);

export const getApiKeyForUser = async (...args) => await impl.getApiKeyForUser(...args);
export const createApiKeyForUser = async (...args) => await impl.createApiKeyForUser(...args);
export const getUserByApiKey = async (...args) => await impl.getUserByApiKey(...args);
export const bindApiKeyToUser = async (...args) => await impl.bindApiKeyToUser(...args);

export const getSelectedAccount = async (...args) => await impl.getSelectedAccount(...args);
export const setSelectedAccount = async (...args) => await impl.setSelectedAccount(...args);

export const indexSearchItem = async (...args) => await impl.indexSearchItem(...args);
export const clearSearchIndex = async (...args) => await impl.clearSearchIndex(...args);
export const searchIndex = async (...args) => await impl.searchIndex(...args);
export const getIndexStats = async (...args) => await impl.getIndexStats(...args);

export const upsertEntityCache = async (...args) => await impl.upsertEntityCache(...args);
export const listEntityCache = async (...args) => await impl.listEntityCache(...args);

export const getIdempotencyResponse = async (...args) => await impl.getIdempotencyResponse(...args);
export const setIdempotencyResponse = async (...args) => await impl.setIdempotencyResponse(...args);

export const setToolCache = async (...args) => await impl.setToolCache(...args);
export const listToolCache = async (...args) => await impl.listToolCache(...args);

export const getMineState = async (...args) => await impl.getMineState(...args);
export const setMineState = async (...args) => await impl.setMineState(...args);

export const getEntityStats = async (...args) => await impl.getEntityStats(...args);
export const getToolCacheStats = async (...args) => await impl.getToolCacheStats(...args);

export const getActivepiecesProject = async (...args) => await impl.getActivepiecesProject(...args);
export const setActivepiecesProject = async (...args) => await impl.setActivepiecesProject(...args);
export const clearActivepiecesProject = async (...args) => await impl.clearActivepiecesProject(...args);

export default impl.default ?? null;

