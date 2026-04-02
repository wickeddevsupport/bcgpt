function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, "");
}

export function getPmosLibreChatUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = (window as Window & { __OPENCLAW_PMOS_LIBRECHAT_URL__?: string | null })
    .__OPENCLAW_PMOS_LIBRECHAT_URL__;
  return typeof raw === "string" ? normalizeUrl(raw) : null;
}

export function isPmosLibreChatEnabled(): boolean {
  return Boolean(getPmosLibreChatUrl());
}
