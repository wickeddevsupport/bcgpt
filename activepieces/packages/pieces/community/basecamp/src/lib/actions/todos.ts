import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';

export const todosAction = createAction({
  auth: basecampAuth,
  name: 'todos',
  displayName: 'To-dos',
  description: 'Create and manage to-dos and to-do lists.',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List to-dos for a project', value: 'list_todos_for_project' },
          { label: 'List to-dos for a list', value: 'list_todos_for_list' },
          { label: 'Get a to-do', value: 'get_todo' },
          { label: 'Create a to-do', value: 'create_todo' },
          { label: 'Update a to-do', value: 'update_todo_details' },
          { label: 'Complete a to-do', value: 'complete_todo' },
          { label: 'Uncomplete a to-do', value: 'uncomplete_todo' },
          { label: 'Reposition a to-do', value: 'reposition_todo' },
          { label: 'Complete a task by name', value: 'complete_task_by_name' },
          { label: 'List groups in a to-do list', value: 'list_todolist_groups' },
          { label: 'Get a to-do list group', value: 'get_todolist_group' },
          { label: 'Create a to-do list group', value: 'create_todolist_group' },
          { label: 'Reposition a to-do list group', value: 'reposition_todolist_group' },
          { label: 'Get a todoset', value: 'get_todoset' },
          { label: 'Get a to-do list', value: 'get_todolist' },
          { label: 'Create a to-do list', value: 'create_todolist' },
          { label: 'Update a to-do list', value: 'update_todolist' },
        ],
      },
    }),
    project: projectDropdown(true),
    inputs: Property.DynamicProperties({
      displayName: 'Inputs',
      required: false,
      auth: basecampAuth,
      refreshers: ['operation'],
      props: async ({ operation }) => {
        const op = String(operation ?? '');
        const fields: DynamicPropsValue = {};
        switch (op) {
          case 'list_todos_for_project':
            fields['compact'] = Property.Checkbox({
              displayName: 'Compact',
              description: 'When enabled, returns smaller payloads (recommended).',
              required: false,
              defaultValue: true,
            });
            fields['preview_limit'] = Property.Number({
              displayName: 'Preview limit',
              description: 'How many todos to include per list in preview mode.',
              required: false,
              defaultValue: 50,
            });
            fields['inlineLimit'] = Property.Number({
              displayName: 'Inline limit',
              description:
                'If total items exceed this, server may return a cached payload reference.',
              required: false,
              defaultValue: 200,
            });
            break;
          case 'list_todos_for_list':
            fields['todolist_id'] = Property.Number({
              displayName: 'To-do list ID',
              required: true,
            });
            break;
          case 'get_todo':
          case 'complete_todo':
          case 'uncomplete_todo':
            fields['todo_id'] = Property.Number({
              displayName: 'To-do ID',
              required: true,
            });
            break;
          case 'reposition_todo':
            fields['todo_id'] = Property.Number({
              displayName: 'To-do ID',
              required: true,
            });
            fields['position'] = Property.Number({
              displayName: 'Position',
              description: '1-based position in the list.',
              required: true,
            });
            break;
          case 'complete_task_by_name':
            fields['task'] = Property.ShortText({
              displayName: 'Task name',
              description:
                'Fuzzy match against todo content and complete the best match.',
              required: true,
            });
            break;
          case 'create_todo':
            fields['task'] = Property.ShortText({
              displayName: 'To-do',
              required: true,
            });
            fields['todolist'] = Property.ShortText({
              displayName: 'To-do list (optional)',
              description:
                'List name to place the todo into (optional, server will resolve best-effort).',
              required: false,
            });
            fields['description'] = Property.LongText({
              displayName: 'Description (optional)',
              required: false,
            });
            fields['due_on'] = Property.ShortText({
              displayName: 'Due on (optional)',
              description: 'Date string (YYYY-MM-DD).',
              required: false,
            });
            fields['starts_on'] = Property.ShortText({
              displayName: 'Starts on (optional)',
              description: 'Date string (YYYY-MM-DD).',
              required: false,
            });
            fields['assignee_ids'] = Property.Json({
              displayName: 'Assignee IDs (optional)',
              description: 'JSON array of person IDs, e.g. [123, 456].',
              required: false,
            });
            fields['notify'] = Property.Checkbox({
              displayName: 'Notify',
              required: false,
              defaultValue: true,
            });
            break;
          case 'update_todo_details':
            fields['todo_id'] = Property.Number({
              displayName: 'To-do ID',
              required: true,
            });
            fields['content'] = Property.ShortText({
              displayName: 'Content (optional)',
              required: false,
            });
            fields['description'] = Property.LongText({
              displayName: 'Description (optional)',
              required: false,
            });
            fields['due_on'] = Property.ShortText({
              displayName: 'Due on (optional)',
              description: 'Date string (YYYY-MM-DD).',
              required: false,
            });
            fields['starts_on'] = Property.ShortText({
              displayName: 'Starts on (optional)',
              description: 'Date string (YYYY-MM-DD).',
              required: false,
            });
            fields['assignee_ids'] = Property.Json({
              displayName: 'Assignee IDs (optional)',
              description: 'JSON array of person IDs, e.g. [123, 456].',
              required: false,
            });
            fields['completion_subscriber_ids'] = Property.Json({
              displayName: 'Completion subscriber IDs (optional)',
              description: 'JSON array of person IDs, e.g. [123, 456].',
              required: false,
            });
            fields['notify'] = Property.Checkbox({
              displayName: 'Notify',
              required: false,
            });
            break;
          case 'list_todolist_groups':
            fields['todolist_id'] = Property.Number({
              displayName: 'To-do list ID',
              required: true,
            });
            break;
          case 'get_todolist_group':
            fields['group_id'] = Property.Number({
              displayName: 'Group ID',
              required: true,
            });
            break;
          case 'create_todolist_group':
            fields['todolist_id'] = Property.Number({
              displayName: 'To-do list ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to create a group.',
              required: true,
            });
            break;
          case 'reposition_todolist_group':
            fields['group_id'] = Property.Number({
              displayName: 'Group ID',
              required: true,
            });
            fields['position'] = Property.Number({
              displayName: 'Position',
              required: true,
            });
            break;
          case 'get_todoset':
            fields['todoset_id'] = Property.Number({
              displayName: 'Todoset ID',
              required: true,
            });
            break;
          case 'get_todolist':
            fields['todolist_id'] = Property.Number({
              displayName: 'To-do list ID',
              required: true,
            });
            break;
          case 'create_todolist':
            fields['todoset_id'] = Property.Number({
              displayName: 'Todoset ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to create a todolist.',
              required: true,
            });
            break;
          case 'update_todolist':
            fields['todolist_id'] = Property.Number({
              displayName: 'To-do list ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to update a todolist.',
              required: true,
            });
            break;
          default:
            break;
        }

        return fields;
      },
    }),
  },
  async run(context) {
    const auth = requireGatewayAuth(
      context.auth as BasecampGatewayAuthConnection | undefined,
    );

    const op = String(context.propsValue.operation ?? '');
    const project = String(context.propsValue.project ?? '');
    const inputs = (context.propsValue.inputs ?? {}) as Record<string, unknown>;

    switch (op) {
      case 'list_todos_for_project':
        return await callGatewayTool({
          auth,
          toolName: 'list_todos_for_project',
          args: {
            project,
            compact: Boolean(inputs['compact']),
            preview_limit: inputs['preview_limit'],
            inlineLimit: inputs['inlineLimit'],
          },
        });
      case 'list_todos_for_list':
        return await callGatewayTool({
          auth,
          toolName: 'list_todos_for_list',
          args: {
            project,
            todolist_id: inputs['todolist_id'],
          },
        });
      case 'get_todo':
      case 'complete_todo':
      case 'uncomplete_todo':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: {
            project,
            todo_id: inputs['todo_id'],
          },
        });
      case 'reposition_todo':
        return await callGatewayTool({
          auth,
          toolName: 'reposition_todo',
          args: {
            project,
            todo_id: inputs['todo_id'],
            position: inputs['position'],
          },
        });
      case 'complete_task_by_name':
        return await callGatewayTool({
          auth,
          toolName: 'complete_task_by_name',
          args: {
            project,
            task: inputs['task'],
          },
        });
      case 'create_todo':
        return await callGatewayTool({
          auth,
          toolName: 'create_todo',
          args: {
            project,
            task: inputs['task'],
            todolist: inputs['todolist'] || undefined,
            description: inputs['description'] || undefined,
            due_on: inputs['due_on'] || undefined,
            starts_on: inputs['starts_on'] || undefined,
            assignee_ids: inputs['assignee_ids'] || undefined,
            notify: inputs['notify'],
          },
        });
      case 'update_todo_details':
        return await callGatewayTool({
          auth,
          toolName: 'update_todo_details',
          args: {
            project,
            todo_id: inputs['todo_id'],
            content: inputs['content'] || undefined,
            description: inputs['description'] || undefined,
            due_on: inputs['due_on'] || undefined,
            starts_on: inputs['starts_on'] || undefined,
            assignee_ids: inputs['assignee_ids'] || undefined,
            completion_subscriber_ids:
              inputs['completion_subscriber_ids'] || undefined,
            notify: inputs['notify'],
          },
        });
      case 'list_todolist_groups':
        return await callGatewayTool({
          auth,
          toolName: 'list_todolist_groups',
          args: {
            project,
            todolist_id: inputs['todolist_id'],
          },
        });
      case 'get_todolist_group':
        return await callGatewayTool({
          auth,
          toolName: 'get_todolist_group',
          args: {
            project,
            group_id: inputs['group_id'],
          },
        });
      case 'create_todolist_group':
        return await callGatewayTool({
          auth,
          toolName: 'create_todolist_group',
          args: {
            project,
            todolist_id: inputs['todolist_id'],
            body: inputs['body'] ?? {},
          },
        });
      case 'reposition_todolist_group':
        return await callGatewayTool({
          auth,
          toolName: 'reposition_todolist_group',
          args: {
            project,
            group_id: inputs['group_id'],
            position: inputs['position'],
          },
        });
      case 'get_todoset':
        return await callGatewayTool({
          auth,
          toolName: 'get_todoset',
          args: {
            project,
            todoset_id: inputs['todoset_id'],
          },
        });
      case 'get_todolist':
        return await callGatewayTool({
          auth,
          toolName: 'get_todolist',
          args: {
            project,
            todolist_id: inputs['todolist_id'],
          },
        });
      case 'create_todolist':
        return await callGatewayTool({
          auth,
          toolName: 'create_todolist',
          args: {
            project,
            todoset_id: inputs['todoset_id'],
            body: inputs['body'] ?? {},
          },
        });
      case 'update_todolist':
        return await callGatewayTool({
          auth,
          toolName: 'update_todolist',
          args: {
            project,
            todolist_id: inputs['todolist_id'],
            body: inputs['body'] ?? {},
          },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
