import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import {
  projectDropdown,
  todolistDropdown,
  todoDropdown,
  todolistGroupDropdown,
  projectPeopleMultiSelectDropdown,
} from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';
import { toInt, toOptionalIntArray } from '../common/payload';

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
    todolist: todolistDropdown(false),
    inputs: Property.DynamicProperties({
      displayName: 'Inputs',
      required: false,
      auth: basecampAuth,
      refreshers: ['operation', 'todolist'],
      props: async ({ operation, todolist }) => {
        const op = String(operation ?? '');
        const hasTodoList = Boolean(todolist);
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
            if (!hasTodoList) {
              fields['todolist_id'] = Property.Number({
                displayName: 'To-do list ID',
                required: true,
              });
            }
            break;
          case 'get_todo':
          case 'complete_todo':
          case 'uncomplete_todo':
            if (hasTodoList) {
              fields['todo'] = todoDropdown(true);
            } else {
              fields['todo_id'] = Property.Number({
                displayName: 'To-do ID',
                required: true,
              });
            }
            break;
          case 'reposition_todo':
            if (hasTodoList) {
              fields['todo'] = todoDropdown(true);
            } else {
              fields['todo_id'] = Property.Number({
                displayName: 'To-do ID',
                required: true,
              });
            }
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
            fields['assignee_ids'] = projectPeopleMultiSelectDropdown({
              required: false,
              displayName: 'Assignees (optional)',
              description: 'Assign this to-do to one or more people.',
            });
            fields['notify'] = Property.Checkbox({
              displayName: 'Notify',
              required: false,
              defaultValue: true,
            });
            break;
          case 'update_todo_details':
            if (hasTodoList) {
              fields['todo'] = todoDropdown(true);
            } else {
              fields['todo_id'] = Property.Number({
                displayName: 'To-do ID',
                required: true,
              });
            }
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
            fields['assignee_ids'] = projectPeopleMultiSelectDropdown({
              required: false,
              displayName: 'Assignees (optional)',
              description: 'Replace assignees. Leave unset to keep current.',
            });
            fields['completion_subscriber_ids'] = projectPeopleMultiSelectDropdown({
              required: false,
              displayName: 'Completion subscribers (optional)',
              description:
                'Replace completion subscribers. Leave unset to keep current.',
            });
            fields['notify'] = Property.Checkbox({
              displayName: 'Notify',
              required: false,
            });
            break;
          case 'list_todolist_groups':
            if (!hasTodoList) {
              fields['todolist_id'] = Property.Number({
                displayName: 'To-do list ID',
                required: true,
              });
            }
            break;
          case 'get_todolist_group':
            if (hasTodoList) {
              fields['group'] = todolistGroupDropdown(true);
            } else {
              fields['group_id'] = Property.Number({
                displayName: 'Group ID',
                required: true,
              });
            }
            break;
          case 'create_todolist_group':
            if (!hasTodoList) {
              fields['todolist_id'] = Property.Number({
                displayName: 'To-do list ID',
                required: true,
              });
            }
            fields['name'] = Property.ShortText({
              displayName: 'Group name',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              description: 'Advanced: official Basecamp fields to create a group.',
              required: false,
            });
            break;
          case 'reposition_todolist_group':
            if (hasTodoList) {
              fields['group'] = todolistGroupDropdown(true);
            } else {
              fields['group_id'] = Property.Number({
                displayName: 'Group ID',
                required: true,
              });
            }
            fields['position'] = Property.Number({
              displayName: 'Position',
              required: true,
            });
            break;
          case 'get_todoset':
            break;
          case 'get_todolist':
            if (!hasTodoList) {
              fields['todolist_id'] = Property.Number({
                displayName: 'To-do list ID',
                required: true,
              });
            }
            break;
          case 'create_todolist':
            fields['name'] = Property.ShortText({
              displayName: 'List name',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              description: 'Advanced: official Basecamp fields to create a list.',
              required: false,
            });
            break;
          case 'update_todolist':
            if (!hasTodoList) {
              fields['todolist_id'] = Property.Number({
                displayName: 'To-do list ID',
                required: true,
              });
            }
            fields['name'] = Property.ShortText({
              displayName: 'List name',
              required: false,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              description: 'Advanced: official Basecamp fields to update a list.',
              required: false,
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
    const todolistFromDropdown = context.propsValue.todolist;
    const inputs = (context.propsValue.inputs ?? {}) as Record<string, unknown>;

    const resolveTodolistId = (): number => {
      const raw = inputs['todolist_id'] ?? todolistFromDropdown;
      if (raw === undefined || raw === null || raw === '') {
        throw new Error('To-do list is required');
      }
      return toInt(raw, 'To-do list');
    };

    const resolveTodoId = (): number => {
      const raw = inputs['todo'] ?? inputs['todo_id'];
      if (raw === undefined || raw === null || raw === '') {
        throw new Error('To-do is required');
      }
      return toInt(raw, 'To-do ID');
    };

    const resolveGroupId = (): number => {
      const raw = inputs['group'] ?? inputs['group_id'];
      if (raw === undefined || raw === null || raw === '') {
        throw new Error('Group is required');
      }
      return toInt(raw, 'Group ID');
    };

    const resolveTodosetId = async (): Promise<number> => {
      const structure = await callGatewayTool({
        auth,
        toolName: 'get_project_structure',
        args: { project },
      });
      const dock = (structure as { dock?: unknown })?.dock;
      if (Array.isArray(dock)) {
        const match = dock.find(
          (d: any) =>
            d &&
            d.enabled !== false &&
            ['todoset', 'todos', 'todo_set'].includes(String(d.name ?? '')),
        );
        if (match?.id != null) {
          return toInt(match.id, 'Todoset ID');
        }
      }
      throw new Error(
        'Could not resolve todoset for this project. Make sure the Todos tool is enabled in Basecamp.',
      );
    };

    const todolistSelector =
      todolistFromDropdown !== undefined &&
      todolistFromDropdown !== null &&
      todolistFromDropdown !== ''
        ? String(todolistFromDropdown)
        : undefined;

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
            todolist_id: resolveTodolistId(),
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
            todo_id: resolveTodoId(),
          },
        });
      case 'reposition_todo':
        return await callGatewayTool({
          auth,
          toolName: 'reposition_todo',
          args: {
            project,
            todo_id: resolveTodoId(),
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
            todolist: todolistSelector,
            description: inputs['description'] || undefined,
            due_on: inputs['due_on'] || undefined,
            starts_on: inputs['starts_on'] || undefined,
            assignee_ids: toOptionalIntArray(
              inputs['assignee_ids'],
              'Assignees',
            ),
            notify: inputs['notify'],
          },
        });
      case 'update_todo_details':
        return await callGatewayTool({
          auth,
          toolName: 'update_todo_details',
          args: {
            project,
            todo_id: resolveTodoId(),
            content: inputs['content'] || undefined,
            description: inputs['description'] || undefined,
            due_on: inputs['due_on'] || undefined,
            starts_on: inputs['starts_on'] || undefined,
            assignee_ids: toOptionalIntArray(
              inputs['assignee_ids'],
              'Assignees',
            ),
            completion_subscriber_ids:
              toOptionalIntArray(
                inputs['completion_subscriber_ids'],
                'Completion subscribers',
              ),
            notify: inputs['notify'],
          },
        });
      case 'list_todolist_groups':
        return await callGatewayTool({
          auth,
          toolName: 'list_todolist_groups',
          args: {
            project,
            todolist_id: resolveTodolistId(),
          },
        });
      case 'get_todolist_group':
        return await callGatewayTool({
          auth,
          toolName: 'get_todolist_group',
          args: {
            project,
            group_id: resolveGroupId(),
          },
        });
      case 'create_todolist_group':
        return await callGatewayTool({
          auth,
          toolName: 'create_todolist_group',
          args: {
            project,
            todolist_id: resolveTodolistId(),
            body: (() => {
              const base =
                inputs['body'] && typeof inputs['body'] === 'object'
                  ? (inputs['body'] as Record<string, unknown>)
                  : {};
              return {
                ...base,
                name: inputs['name'],
              };
            })(),
          },
        });
      case 'reposition_todolist_group':
        return await callGatewayTool({
          auth,
          toolName: 'reposition_todolist_group',
          args: {
            project,
            group_id: resolveGroupId(),
            position: inputs['position'],
          },
        });
      case 'get_todoset':
        return await callGatewayTool({
          auth,
          toolName: 'get_todoset',
          args: {
            project,
            todoset_id: await resolveTodosetId(),
          },
        });
      case 'get_todolist':
        return await callGatewayTool({
          auth,
          toolName: 'get_todolist',
          args: {
            project,
            todolist_id: resolveTodolistId(),
          },
        });
      case 'create_todolist':
        return await callGatewayTool({
          auth,
          toolName: 'create_todolist',
          args: {
            project,
            todoset_id: await resolveTodosetId(),
            body: (() => {
              const base =
                inputs['body'] && typeof inputs['body'] === 'object'
                  ? (inputs['body'] as Record<string, unknown>)
                  : {};
              return {
                ...base,
                name: inputs['name'],
              };
            })(),
          },
        });
      case 'update_todolist':
        return await callGatewayTool({
          auth,
          toolName: 'update_todolist',
          args: {
            project,
            todolist_id: resolveTodolistId(),
            body: (() => {
              const base =
                inputs['body'] && typeof inputs['body'] === 'object'
                  ? (inputs['body'] as Record<string, unknown>)
                  : {};
              const body: Record<string, unknown> = { ...base };
              if (inputs['name']) {
                body['name'] = inputs['name'];
              }
              if (Object.keys(body).length === 0) {
                throw new Error('Provide at least one field to update.');
              }
              return body;
            })(),
          },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
