export function isPmosFigmaPanelEnabled(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return (
    (window as Window & { __OPENCLAW_PMOS_FIGMA_PANEL_ENABLED__?: boolean })
      .__OPENCLAW_PMOS_FIGMA_PANEL_ENABLED__ !== false
  );
}
