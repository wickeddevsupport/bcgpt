import { Property, createAction } from '@activepieces/pieces-framework';
import { gatewayPost, type BasecampGatewayAuthConnection } from '../common/client';

export const listMessages = createAction({
  name: 'list_messages',
  displayName: 'List Messages',
  description: 'List messages for a project and message board.',
  requireAuth: true,
  props: {
    project: Property.ShortText({
      displayName: 'Project',
      description: 'Project name or ID.',
      required: true,
    }),
    message_board_id: Property.Number({
      displayName: 'Message Board ID (optional)',
      required: false,
    }),
  },
  async run(context) {
    const auth = context.auth as BasecampGatewayAuthConnection | undefined;
    if (!auth?.props?.base_url) {
      throw new Error('Missing BCGPT base URL in connection.');
    }
    if (!auth?.props?.api_key) {
      throw new Error('Missing API key in the connection.');
    }

    const body: Record<string, unknown> = {
      project: context.propsValue.project,
    };
    if (context.propsValue.message_board_id) {
      body.message_board_id = context.propsValue.message_board_id;
    }

    return await gatewayPost({
      baseUrl: auth.props.base_url,
      path: '/action/list_messages',
      body,
      auth,
    });
  },
});
