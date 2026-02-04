import { Property, createAction } from '@activepieces/pieces-framework';
import { bcgptPost } from '../common/client';

export const callTool = createAction({
  name: 'call_tool',
  displayName: 'Call Tool',
  description: 'Run a BCGPT tool by name using the /action endpoint.',
  requireAuth: true,
  props: {
    tool: Property.ShortText({
      displayName: 'Tool Name',
      required: true,
    }),
    arguments: Property.Json({
      displayName: 'Arguments',
      description: 'Tool arguments as JSON.',
      required: false,
    }),
  },
  async run(context) {
    const auth = context.auth;
    if (!auth?.props?.base_url) {
      throw new Error('Missing BCGPT base URL in connection.');
    }
    if (!auth?.props?.session_key && !auth?.props?.user_key) {
      throw new Error('Provide a session key or user key in the connection.');
    }

    const toolName = context.propsValue.tool;
    const body = (context.propsValue.arguments ?? {}) as Record<string, unknown>;
    return await bcgptPost({
      baseUrl: auth.props.base_url,
      path: `/action/${encodeURIComponent(toolName)}`,
      body,
      auth,
    });
  },
});
