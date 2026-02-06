import { Property, createAction } from '@activepieces/pieces-framework';
import { gatewayPost, type BasecampGatewayAuthConnection } from '../common/client';

export const listTodosForProject = createAction({
  name: 'list_todos_for_project',
  displayName: 'List Todos For Project',
  description: 'List todolists and todos for a project by name.',
  requireAuth: true,
  props: {
    project: Property.ShortText({
      displayName: 'Project',
      description: 'Project name or ID.',
      required: true,
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

    return await gatewayPost({
      baseUrl: auth.props.base_url,
      path: '/action/list_todos_for_project',
      body: {
        project: context.propsValue.project,
      },
      auth,
    });
  },
});
