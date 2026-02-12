import { authenticationSession } from '@/lib/authentication-session';
import { SeekPage, Template } from '@activepieces/shared';

export type AppInputFieldOption = {
  label: string;
  value: string;
};

export type AppInputFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'boolean'
  | 'password';

export type AppInputField = {
  name: string;
  label?: string;
  type?: AppInputFieldType;
  required?: boolean;
  placeholder?: string;
  options?: AppInputFieldOption[];
};

export type AppGalleryMetadata = {
  description?: string;
  icon?: string;
  author?: string;
  category?: string;
  tags?: string[];
  featured?: boolean;
  displayOrder?: number;
  flowId?: string;
  outputType?: string;
  outputSchema?: Record<string, unknown>;
  inputSchema?: {
    fields?: AppInputField[];
  };
  runCount?: number;
  successCount?: number;
  failedCount?: number;
  averageExecutionMs?: number;
  updated?: string;
};

export type AppTemplate = Template & {
  galleryMetadata?: AppGalleryMetadata;
};

type PublisherListResponse = {
  data: AppTemplate[];
};

type PublisherPayload = {
  templateId: string;
  flowId?: string;
  description?: string;
  icon?: string;
  category?: string;
  tags?: string[];
  featured?: boolean;
  displayOrder?: number;
  inputSchema?: {
    fields: AppInputField[];
  };
  outputType?: string;
  outputSchema?: Record<string, unknown>;
};

export type ExecuteAppResponse = {
  output?: unknown;
  executionTime?: number;
  queued?: boolean;
  requestId?: string | null;
  message?: string;
};

export type AppRun = {
  id: string;
  created: string;
  status: 'queued' | 'success' | 'failed';
  executionTimeMs: number | null;
  outputType: string | null;
  error: string | null;
};

export type AppRunsResponse = {
  data: AppRun[];
};

export type AppStatsResponse = {
  runCount: number;
  successCount: number;
  failedCount: number;
  averageExecutionMs: number | null;
  medianExecutionMs?: number | null;
  failureBuckets?: Array<{
    reason: string;
    count: number;
  }>;
  lastExecutionAt: string | null;
};

const APPS_BASE_URL = `${window.location.origin}/apps`;

async function request<TResponse>(
  path: string,
  init: RequestInit = {},
  authenticated = false,
): Promise<TResponse> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (authenticated) {
    const token = authenticationSession.getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(`${APPS_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : typeof body === 'string' && body.length > 0
          ? body
          : 'Request failed';
    throw new Error(message);
  }

  return body as TResponse;
}

export const appsApi = {
  listPublicApps(params?: {
    search?: string;
    category?: string;
    featured?: boolean;
    limit?: number;
    cursor?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.category) query.set('category', params.category);
    if (typeof params?.featured === 'boolean') {
      query.set('featured', String(params.featured));
    }
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<SeekPage<AppTemplate>>(`/api/apps${suffix}`);
  },

  getPublicApp(templateId: string) {
    return request<AppTemplate>(`/api/apps/${encodeURIComponent(templateId)}`);
  },

  executeApp(
    templateId: string,
    payload: { inputs: Record<string, unknown> },
    mode: 'sync' | 'async' = 'sync',
    signal?: AbortSignal,
  ) {
    return request<ExecuteAppResponse>(
      `/${encodeURIComponent(templateId)}/execute?mode=${mode}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      },
    );
  },

  getAppStats(templateId: string) {
    return request<AppStatsResponse>(
      `/api/apps/${encodeURIComponent(templateId)}/stats`,
    );
  },

  listAppRuns(templateId: string, limit = 10) {
    return request<AppRunsResponse>(
      `/api/apps/${encodeURIComponent(templateId)}/runs?${new URLSearchParams({
        limit: String(limit),
      }).toString()}`,
    );
  },

  listPublisherApps(search?: string) {
    const suffix = search
      ? `?${new URLSearchParams({ search }).toString()}`
      : '';
    return request<PublisherListResponse>(
      `/api/publisher/apps${suffix}`,
      {},
      true,
    );
  },

  listPublisherTemplates(search?: string) {
    const suffix = search
      ? `?${new URLSearchParams({ search }).toString()}`
      : '';
    return request<PublisherListResponse>(
      `/api/publisher/templates${suffix}`,
      {},
      true,
    );
  },

  publish(payload: PublisherPayload) {
    return request<AppTemplate>(
      '/api/publisher/publish',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      true,
    );
  },

  update(templateId: string, payload: Omit<PublisherPayload, 'templateId'>) {
    return request<AppTemplate>(
      `/api/publisher/apps/${encodeURIComponent(templateId)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      true,
    );
  },

  unpublish(templateId: string) {
    return request<void>(
      `/api/publisher/apps/${encodeURIComponent(templateId)}`,
      {
        method: 'DELETE',
      },
      true,
    );
  },

  seedDefaults(reset = false) {
    return request<{ createdApps: number; createdTemplates: number }>(
      '/api/publisher/seed-defaults',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirm: 'SEED_DEFAULTS',
          reset,
        }),
      },
      true,
    );
  },
};
