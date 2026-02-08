import { gatewayPost, type BasecampGatewayAuthConnection } from './client';

export const requireGatewayAuth = (
  auth: BasecampGatewayAuthConnection | undefined,
): BasecampGatewayAuthConnection => {
  if (!auth?.props?.base_url) {
    throw new Error('Missing BCGPT base URL in connection.');
  }
  if (!auth?.props?.api_key) {
    throw new Error('Missing API key in the connection.');
  }
  return auth;
};

export const callGatewayTool = async (params: {
  auth: BasecampGatewayAuthConnection;
  toolName: string;
  args?: unknown;
}) => {
  return await gatewayPost({
    baseUrl: params.auth.props.base_url,
    path: `/action/${params.toolName}`,
    body: params.args ?? {},
    auth: params.auth,
  });
};

