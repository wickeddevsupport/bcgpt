type AnyRecord = Record<string, unknown>;

export const extractList = <T = unknown>(payload: unknown, key: string): T[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const obj = payload as AnyRecord;
  const primary = obj[key];
  if (Array.isArray(primary)) {
    return primary as T[];
  }
  const preview = obj[`${key}_preview`];
  if (Array.isArray(preview)) {
    return preview as T[];
  }
  const items = obj['items'];
  if (Array.isArray(items)) {
    return items as T[];
  }
  const data = obj['data'];
  if (Array.isArray(data)) {
    return data as T[];
  }
  return [];
};

export const toInt = (value: unknown, fieldName: string): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a number`);
  }
  return n;
};

