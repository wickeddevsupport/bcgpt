import { Property, createAction } from '@activepieces/pieces-framework';
import { gatewayPost, type BasecampGatewayAuthConnection } from '../common/client';

export const createTodo = createAction({
  name: 'create_todo',
  displayName: 'Create Todo',
  description: 'Create a Basecamp todo in a project.',
  requireAuth: true,
  props: {
    project: Property.ShortText({
      displayName: 'Project',
      description: 'Project name or ID.',
      required: true,
    }),
    task: Property.ShortText({
      displayName: 'Todo Title',
      required: true,
    }),
    todolist: Property.ShortText({
      displayName: 'Todo List (optional)',
      required: false,
    }),
    description: Property.LongText({
      displayName: 'Description',
      required: false,
    }),
    due_on: Property.ShortText({
      displayName: 'Due On (YYYY-MM-DD)',
      required: false,
    }),
    starts_on: Property.ShortText({
      displayName: 'Starts On (YYYY-MM-DD)',
      required: false,
    }),
    assignee_ids: Property.Array({
      displayName: 'Assignee IDs',
      required: false,
    }),
    notify: Property.Checkbox({
      displayName: 'Notify assignees',
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

    const body: Record<string, unknown> = {
      project: context.propsValue.project,
      task: context.propsValue.task,
    };

    if (context.propsValue.todolist) body.todolist = context.propsValue.todolist;
    if (context.propsValue.description) body.description = context.propsValue.description;
    if (context.propsValue.due_on) body.due_on = context.propsValue.due_on;
    if (context.propsValue.starts_on) body.starts_on = context.propsValue.starts_on;
    if (context.propsValue.assignee_ids?.length) body.assignee_ids = context.propsValue.assignee_ids;
    if (context.propsValue.notify) body.notify = true;

    return await gatewayPost({
      baseUrl: auth.props.base_url,
      path: '/action/create_todo',
      body,
      auth,
    });
  },
});
