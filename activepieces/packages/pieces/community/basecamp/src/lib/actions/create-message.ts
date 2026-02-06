import { Property, createAction } from '@activepieces/pieces-framework';
import { gatewayPost, type BasecampGatewayAuthConnection } from '../common/client';

export const createMessage = createAction({
  name: 'create_message',
  displayName: 'Create Message',
  description: 'Create a Basecamp message in a project message board.',
  requireAuth: true,
  props: {
    project: Property.ShortText({
      displayName: 'Project',
      description: 'Project name or ID.',
      required: true,
    }),
    board_id: Property.Number({
      displayName: 'Message Board ID',
      required: true,
    }),
    subject: Property.ShortText({
      displayName: 'Subject',
      required: false,
    }),
    content: Property.LongText({
      displayName: 'Content',
      required: false,
    }),
    status: Property.ShortText({
      displayName: 'Status (optional)',
      description: 'Draft or active, depending on Basecamp settings.',
      required: false,
    }),
    body: Property.Json({
      displayName: 'Body (optional)',
      description: 'Advanced fields for the Basecamp API payload.',
      required: false,
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

    const body: Record<string, unknown> = {
      project: context.propsValue.project,
      board_id: context.propsValue.board_id,
    };

    if (context.propsValue.subject) body.subject = context.propsValue.subject;
    if (context.propsValue.content) body.content = context.propsValue.content;
    if (context.propsValue.status) body.status = context.propsValue.status;
    if (context.propsValue.body) body.body = context.propsValue.body;

    return await gatewayPost({
      baseUrl: auth.props.base_url,
      path: '/action/create_message',
      body,
      auth,
    });
  },
});
