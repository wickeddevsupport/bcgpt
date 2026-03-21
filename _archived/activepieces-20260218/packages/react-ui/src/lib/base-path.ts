const trimTrailingSlash = (value: string): string => {
  if (value.length <= 1) {
    return value;
  }
  return value.replace(/\/+$/, '');
};

const ensureLeadingSlash = (value: string): string =>
  value.startsWith('/') ? value : `/${value}`;

const normalizeBasePath = (value: string | undefined): string => {
  const raw = value?.trim() || '/';
  if (raw === '/' || raw === './') {
    return '/';
  }
  return trimTrailingSlash(ensureLeadingSlash(raw));
};

export const UI_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL);

export const toUiPath = (pathname: string): string => {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (UI_BASE_PATH === '/') {
    return normalizedPath;
  }
  return `${UI_BASE_PATH}${normalizedPath}`;
};
