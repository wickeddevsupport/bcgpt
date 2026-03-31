import {
  loadModelCatalog,
  type ModelCatalogEntry,
  resetModelCatalogCacheForTest,
} from "../agents/model-catalog.js";

export type GatewayModelChoice = ModelCatalogEntry;
export type GatewayModelCatalogParams = NonNullable<Parameters<typeof loadModelCatalog>[0]>;

// Test-only escape hatch: model catalog is cached at module scope for the
// process lifetime, which is fine for the real gateway daemon, but makes
// isolated unit tests harder. Keep this intentionally obscure.
export function __resetModelCatalogCacheForTest() {
  resetModelCatalogCacheForTest();
}

export async function loadGatewayModelCatalog(
  params?: GatewayModelCatalogParams,
): Promise<GatewayModelChoice[]> {
  return await loadModelCatalog(params);
}
