import { HttpMethod, httpClient } from '@activepieces/pieces-common';
import type { AppConnectionValueForAuthProperty } from '@activepieces/pieces-framework';
import type { basecampAuth } from '../../index';

export type BasecampGatewayAuthConnection = AppConnectionValueForAuthProperty<
  typeof basecampAuth
>;
export type BasecampGatewayAuthProps = BasecampGatewayAuthConnection['props'];

export const DEFAULT_BCGPT_BASE_URL = 'https://bcgpt.wickedlab.io';

export const normalizeBaseUrl = (value?: string): string => {
  const raw = value ?? DEFAULT_BCGPT_BASE_URL;
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return DEFAULT_BCGPT_BASE_URL;
  }
  return trimmed.replace(/\/+$/, '');
};

export const resolveGatewayBaseUrl = (
  auth?: BasecampGatewayAuthConnection,
): string => {
  const legacyBaseUrl = ((auth?.props as unknown as Record<string, unknown> | undefined)?.base_url);
  const raw =
    typeof legacyBaseUrl === 'string'
      ? legacyBaseUrl
      : DEFAULT_BCGPT_BASE_URL;
  return normalizeBaseUrl(raw);
};

export const buildGatewayHeaders = (auth?: BasecampGatewayAuthConnection) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (auth?.props?.api_key) {
    headers['x-bcgpt-api-key'] = auth.props.api_key;
  }
  return headers;
};

export const gatewayPost = async (params: {
  baseUrl: string;
  path: string;
  body?: unknown;
  auth?: BasecampGatewayAuthConnection;
}) => {
  const url = `${normalizeBaseUrl(params.baseUrl)}${
    params.path.startsWith('/') ? params.path : `/${params.path}`
  }`;
  const response = await httpClient.sendRequest({
    method: HttpMethod.POST,
    url,
    headers: buildGatewayHeaders(params.auth),
    body: params.body ?? {},
  });
  return response.body;
};
