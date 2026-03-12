"use strict";

const STORAGE_KEY = "pmos-figma-annotation-bridge-settings";
const DEFAULT_SERVER_URL = "https://os.wickedlab.io";

figma.showUI(__html__, { width: 420, height: 620, themeColors: true });

function normalizeNodeId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = decodeURIComponent(value.trim());
  if (!trimmed) {
    return null;
  }
  return /^\d+-\d+$/.test(trimmed) ? trimmed.replace("-", ":") : trimmed;
}

function collectNodes(scope) {
  if (scope === "selection") {
    return figma.currentPage.selection.slice();
  }
  if (scope === "current_page") {
    return figma.currentPage.findAll(() => true);
  }
  return figma.root.findAll(() => true);
}

function getNodeAnnotations(node) {
  try {
    return Array.isArray(node.annotations) ? node.annotations : [];
  } catch {
    return [];
  }
}

async function loadSettings() {
  const stored = (await figma.clientStorage.getAsync(STORAGE_KEY)) || {};
  return {
    serverUrl: typeof stored.serverUrl === "string" && stored.serverUrl.trim() ? stored.serverUrl.trim() : DEFAULT_SERVER_URL,
    syncUrl: typeof stored.syncUrl === "string" && stored.syncUrl.trim() ? stored.syncUrl.trim() : "",
    workspaceId: typeof stored.workspaceId === "string" ? stored.workspaceId.trim() : "",
    bridgeToken: typeof stored.bridgeToken === "string" ? stored.bridgeToken.trim() : "",
  };
}

async function saveSettings(next) {
  const normalized = {
    serverUrl: typeof next.serverUrl === "string" && next.serverUrl.trim() ? next.serverUrl.trim().replace(/\/+$/, "") : DEFAULT_SERVER_URL,
    syncUrl: typeof next.syncUrl === "string" ? next.syncUrl.trim() : "",
    workspaceId: typeof next.workspaceId === "string" ? next.workspaceId.trim() : "",
    bridgeToken: typeof next.bridgeToken === "string" ? next.bridgeToken.trim() : "",
  };
  await figma.clientStorage.setAsync(STORAGE_KEY, normalized);
  return normalized;
}

async function loadCategories() {
  const api = figma.annotations;
  if (!api) {
    return [];
  }
  try {
    if (typeof api.getLocalCategoriesAsync === "function") {
      const categories = await api.getLocalCategoriesAsync();
      return Array.isArray(categories) ? categories : [];
    }
  } catch {}
  try {
    if (typeof api.getCategoriesAsync === "function") {
      const categories = await api.getCategoriesAsync();
      return Array.isArray(categories) ? categories : [];
    }
  } catch {}
  return [];
}

async function buildSnapshot(scope) {
  const fileKey = typeof figma.fileKey === "string" && figma.fileKey.trim() ? figma.fileKey.trim() : null;
  if (!fileKey) {
    throw new Error("This file is not saved yet. Open a saved Figma file before syncing annotations.");
  }

  const nodes = collectNodes(scope);
  const categories = await loadCategories();
  const categoryMap = new Map(
    categories
      .map((category) => {
        const id = typeof category.id === "string" ? category.id : null;
        if (!id) {
          return null;
        }
        return [
          id,
          {
            id,
            label: typeof category.label === "string" ? category.label : null,
            description: typeof category.description === "string" ? category.description : null,
            color: typeof category.color === "string" ? category.color : null,
          },
        ];
      })
      .filter(Boolean),
  );

  const annotations = [];
  for (const node of nodes) {
    for (const annotation of getNodeAnnotations(node)) {
      const categoryId = typeof annotation.categoryId === "string" ? annotation.categoryId : null;
      const category = categoryId ? categoryMap.get(categoryId) : null;
      annotations.push({
        id: typeof annotation.id === "string" ? annotation.id : null,
        nodeId: normalizeNodeId(node.id),
        nodeName: typeof node.name === "string" ? node.name : null,
        pageId: normalizeNodeId(node.parent && node.parent.type === "PAGE" ? node.parent.id : figma.currentPage.id),
        pageName:
          node.parent && node.parent.type === "PAGE" && typeof node.parent.name === "string"
            ? node.parent.name
            : typeof figma.currentPage.name === "string"
              ? figma.currentPage.name
              : null,
        labelMarkdown:
          typeof annotation.labelMarkdown === "string"
            ? annotation.labelMarkdown
            : typeof annotation.label === "string"
              ? annotation.label
              : null,
        categoryId,
        categoryLabel: category ? category.label : null,
        authorName: typeof annotation.authorName === "string" ? annotation.authorName : null,
        authorId: typeof annotation.authorId === "string" ? annotation.authorId : null,
        createdAt: typeof annotation.createdAt === "string" ? annotation.createdAt : null,
        updatedAt: typeof annotation.updatedAt === "string" ? annotation.updatedAt : null,
      });
    }
  }

  return {
    fileKey,
    fileName: typeof figma.root.name === "string" ? figma.root.name : null,
    selectionNodeIds: figma.currentPage.selection.map((node) => normalizeNodeId(node.id)).filter(Boolean),
    scope,
    pluginVersion: "0.1.0",
    editorType: typeof figma.editorType === "string" ? figma.editorType : null,
    categories: Array.from(categoryMap.values()),
    annotations,
  };
}

async function syncAnnotations(scope, settings) {
  if (!settings.workspaceId) {
    throw new Error("Workspace ID is required.");
  }
  if (!settings.bridgeToken) {
    throw new Error("Bridge token is required.");
  }
  const serverUrl =
    typeof settings.serverUrl === "string" && settings.serverUrl.trim()
      ? settings.serverUrl.trim().replace(/\/+$/, "")
      : DEFAULT_SERVER_URL;
  const syncUrl =
    typeof settings.syncUrl === "string" && settings.syncUrl.trim()
      ? settings.syncUrl.trim()
      : `${serverUrl}/figma/plugin-bridge/sync`;
  const payload = await buildSnapshot(scope);
  payload.workspaceId = settings.workspaceId;
  const response = await fetch(syncUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.bridgeToken}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!response.ok) {
    throw new Error((json && json.error) || text || `Sync failed with ${response.status}`);
  }
  return json;
}

async function postInitialState() {
  const settings = await loadSettings();
  figma.ui.postMessage({
    type: "bridge-state",
    settings,
    file: {
      fileKey: typeof figma.fileKey === "string" ? figma.fileKey : null,
      fileName: typeof figma.root.name === "string" ? figma.root.name : null,
      currentPage: typeof figma.currentPage.name === "string" ? figma.currentPage.name : null,
      selectionCount: figma.currentPage.selection.length,
    },
  });
}

figma.ui.onmessage = async (msg) => {
  try {
    if (!msg || typeof msg !== "object") {
      return;
    }
    if (msg.type === "load-bridge-state") {
      await postInitialState();
      return;
    }
    if (msg.type === "save-settings") {
      const settings = await saveSettings(msg.settings || {});
      figma.ui.postMessage({ type: "save-complete", settings });
      return;
    }
    if (msg.type === "sync-annotations") {
      const settings = await saveSettings(msg.settings || {});
      const scope =
        msg.scope === "document" || msg.scope === "current_page" || msg.scope === "selection"
          ? msg.scope
          : "selection";
      const result = await syncAnnotations(scope, settings);
      figma.ui.postMessage({
        type: "sync-complete",
        scope,
        result,
      });
      return;
    }
    if (msg.type === "close-plugin") {
      figma.closePlugin();
    }
  } catch (error) {
    figma.ui.postMessage({
      type: "sync-error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

void postInitialState();
