import { HttpMethod, httpClient } from '@activepieces/pieces-common';
import type { AppConnectionValueForAuthProperty } from '@activepieces/pieces-framework';
import type { bcgptAuth } from '../../index';

export type BcgptAuthConnection = AppConnectionValueForAuthProperty<
  typeof bcgptAuth
>;
export type BcgptAuthProps = BcgptAuthConnection['props'];

export const normalizeBaseUrl = (value?: string): string => {
  const raw = value ?? '';
  return raw.replace(/\/+$/, '');
};

export const buildBcgptHeaders = (auth?: BcgptAuthConnection) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (auth?.props?.session_key) {
    headers['x-bcgpt-session'] = auth.props.session_key;
  }
  if (auth?.props?.user_key) {
    headers['x-bcgpt-user'] = auth.props.user_key;
  }
  return headers;
};

export const bcgptPost = async (params: {
  baseUrl: string;
  path: string;
  body?: unknown;
  auth?: BcgptAuthConnection;
}) => {
  const url = `${normalizeBaseUrl(params.baseUrl)}${
    params.path.startsWith('/') ? params.path : `/${params.path}`
  }`;
  const response = await httpClient.sendRequest({
    method: HttpMethod.POST,
    url,
    headers: buildBcgptHeaders(params.auth),
    body: params.body ?? {},
  });
  return response.body;
};
