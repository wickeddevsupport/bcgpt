# PMOS Figma Annotation Bridge

This plugin syncs true Figma annotations from the Plugin/Dev Mode API into the PMOS Figma MCP-compatible bridge.

## Files

- `manifest.json`
- `code.js`
- `ui.html`

## Setup

1. In PMOS, while signed in, call `POST /api/pmos/figma/plugin-bridge/prepare` or use the equivalent PMOS control once surfaced.
2. Copy the returned:
   - `workspaceId`
   - `bridgeToken`
   - `syncUrl`
3. Import this plugin into Figma from the local manifest.
4. Paste the PMOS values into the plugin UI.
5. Run `Sync Selection`, `Sync Page`, or `Sync Document`.

## Result

After a successful sync, `figma.get_annotations` in PMOS will read the synced annotation snapshot for that file instead of aliasing file comments.
