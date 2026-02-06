import { Property, createAction } from '@activepieces/pieces-framework';
import { gatewayPost, type BasecampGatewayAuthConnection } from '../common/client';

export const listProjects = createAction({
  name: 'list_projects',
  displayName: 'List Projects',
  description: 'List Basecamp projects via BCGPT.',
  requireAuth: true,
  props: {
    archived: Property.Checkbox({
      displayName: 'Include archived projects',
      required: false,
      defaultValue: false,
    }),
  },
  async run(context) {
    const auth = context.auth as BasecampGatewayAuthConnection | undefined;
    if (!auth?.props?.base_url) {
      throw new Error('Missing BCGPT base URL in connection.');
    }
    if (!auth?.props?.session_key && !auth?.props?.user_key) {
      throw new Error('Provide a session key or user key in the connection.');
    }

    const body: Record<string, unknown> = {};
    if (context.propsValue.archived) {
      body.archived = true;
    }

    return await gatewayPost({
      baseUrl: auth.props.base_url,
      path: '/action/list_projects',
      body,
      auth,
    });
  },
});
