import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareWorkspaceFigmaPluginBridge,
  readWorkspaceFigmaPluginBridgeSnapshot,
  readWorkspaceFigmaPluginBridgeStatus,
  syncWorkspaceFigmaPluginBridgeSnapshot,
} from "./figma-plugin-bridge.js";
import { workspaceConnectorsPath } from "./workspace-connectors.js";

describe("figma plugin bridge", () => {
  const workspaceId = `figma-plugin-bridge-${Date.now()}`;
  const connectorPath = workspaceConnectorsPath(workspaceId);

  afterEach(async () => {
    try {
      await fs.rm(path.dirname(connectorPath), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("prepares a stable workspace bridge token", async () => {
    const first = await prepareWorkspaceFigmaPluginBridge(workspaceId);
    const second = await prepareWorkspaceFigmaPluginBridge(workspaceId);

    expect(first.bridgeToken).toMatch(/^figpb_/);
    expect(second.bridgeToken).toBe(first.bridgeToken);
    expect(second.status.configured).toBe(true);
    expect(second.status.syncedFileCount).toBe(0);
  });

  it("stores and filters synced annotation snapshots by file", async () => {
    const prepared = await prepareWorkspaceFigmaPluginBridge(workspaceId);

    await syncWorkspaceFigmaPluginBridgeSnapshot({
      workspaceId,
      bridgeToken: prepared.bridgeToken,
      payload: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        fileName: "OKA Online Audit",
        scope: "selection",
        selectionNodeIds: ["0-1"],
        pluginVersion: "0.1.0",
        editorType: "dev",
        categories: [{ id: "cat-a11y", label: "Accessibility" }],
        annotations: [
          {
            id: "ann-1",
            nodeId: "0-1",
            nodeName: "Hero",
            labelMarkdown: "Fix contrast on CTA",
            categoryId: "cat-a11y",
            authorName: "Design QA",
          },
        ],
      },
    });

    const snapshot = await readWorkspaceFigmaPluginBridgeSnapshot(
      workspaceId,
      "https://www.figma.com/design/3INmNiG3X3NKAZtCI3SMg6/OKA-Online-Audit?node-id=0-1",
    );
    const status = await readWorkspaceFigmaPluginBridgeStatus(workspaceId);

    expect(snapshot?.fileKey).toBe("3INmNiG3X3NKAZtCI3SMg6");
    expect(snapshot?.categories[0]).toEqual(
      expect.objectContaining({ id: "cat-a11y", label: "Accessibility" }),
    );
    expect(snapshot?.annotations[0]).toEqual(
      expect.objectContaining({
        id: "ann-1",
        nodeId: "0:1",
        categoryLabel: "Accessibility",
      }),
    );
    expect(status.syncedFileCount).toBe(1);
    expect(status.availableFileKeys).toEqual(["3INmNiG3X3NKAZtCI3SMg6"]);
    expect(status.lastSyncedAt).toBeTruthy();
  });
});
