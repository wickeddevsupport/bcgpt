import { HttpMethod, httpClient } from '@activepieces/pieces-common';
import { Property, createAction } from '@activepieces/pieces-framework';
import { normalizeBaseUrl } from '../common/client';

export const listTools = createAction({
  name: 'list_tools',
  displayName: 'List Tools',
  description: 'List available BCGPT tools from the MCP endpoint.',
  requireAuth: false,
  props: {
    base_url: Property.ShortText({
      displayName: 'BCGPT Base URL',
      required: true,
      defaultValue: 'https://bcgpt.wickedlab.io',
    }),
  },
  async run(context) {
    const baseUrl = normalizeBaseUrl(context.propsValue.base_url);
    const response = await httpClient.sendRequest({
      method: HttpMethod.POST,
      url: `${baseUrl}/mcp`,
      headers: { 'content-type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: 'bcgpt-tools',
        method: 'tools/list',
        params: {},
      },
    });
    return response.body?.result ?? response.body;
  },
});
