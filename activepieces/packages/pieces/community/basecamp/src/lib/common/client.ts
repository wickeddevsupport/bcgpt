import { HttpMethod, httpClient } from '@activepieces/pieces-common';

export type BasecampGatewayAuthProps = {
  base_url?: string;
  session_key?: string;
  user_key?: string;
};

export const normalizeBaseUrl = (value?: string): string => {
  const raw = value ?? '';
  return raw.replace(/\/+$/, '');
};

export const buildGatewayHeaders = (auth?: { props: BasecampGatewayAuthProps }) => {
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

export const gatewayPost = async (params: {
  baseUrl: string;
  path: string;
  body?: unknown;
  auth?: { props: BasecampGatewayAuthProps };
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
