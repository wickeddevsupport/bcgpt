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
  const body = await gatewayPost({
    baseUrl: params.auth.props.base_url,
    path: `/action/${params.toolName}`,
    body: params.args ?? {},
    auth: params.auth,
  });

  // BCGPT returns 200 even for tool errors to avoid "connector failed" UX.
  // Surface these as real errors inside Activepieces so users see the message.
  if (body && typeof body === 'object' && (body as { ok?: unknown }).ok === false) {
    const errBody = body as {
      ok?: boolean;
      error?: string;
      code?: string;
      details?: unknown;
    };
    const err = new Error(errBody.error || 'BCGPT gateway error');
    (err as { code?: string }).code = errBody.code || 'BCGPT_GATEWAY_ERROR';
    (err as { details?: unknown }).details = errBody.details;
    throw err;
  }

  return body;
};
