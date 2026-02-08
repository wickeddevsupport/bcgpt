import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';
import { extractList, toInt } from '../common/payload';

type CardTable = { id?: number; title?: string; name?: string };

const cardTableDropdown = (required: boolean) =>
  Property.Dropdown({
    auth: basecampAuth,
    displayName: 'Card table',
    description: 'Select a card table (kanban board).',
    required,
    refreshers: ['auth', 'project'],
    options: async ({ auth, project }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Connect Basecamp first',
        };
      }
      if (!project) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a project first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_card_tables',
        args: { project: String(project), include_archived: false },
      });
      const tables = extractList<CardTable>(result, 'card_tables');
      return {
        disabled: false,
        options: tables.map((t) => ({
          label: t.title ?? t.name ?? String(t.id ?? 'Unknown table'),
          value: String(t.id ?? ''),
        })),
        placeholder: tables.length ? 'Select a card table' : 'No card tables found',
      };
    },
  });

export const cardsAction = createAction({
  auth: basecampAuth,
  name: 'cards',
  displayName: 'Cards',
  description: 'Work with card tables (kanban) and cards.',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List card tables', value: 'list_card_tables' },
          { label: 'List columns', value: 'list_card_table_columns' },
          { label: 'List cards', value: 'list_card_table_cards' },
          { label: 'Search cards', value: 'search_cards' },
          { label: 'Create card', value: 'create_card' },
          { label: 'Move card', value: 'move_card' },
          { label: 'Archive card', value: 'archive_card' },
          { label: 'Unarchive card', value: 'unarchive_card' },
          { label: 'Trash card', value: 'trash_card' },
          { label: 'Get card', value: 'get_card' },
          { label: 'Update card', value: 'update_card' },
          { label: 'List card steps', value: 'list_card_steps' },
          { label: 'Create card step', value: 'create_card_step' },
          { label: 'Update card step', value: 'update_card_step' },
          { label: 'Complete card step', value: 'complete_card_step' },
          { label: 'Uncomplete card step', value: 'uncomplete_card_step' },
          { label: 'Reposition card step', value: 'reposition_card_step' },
          { label: 'Get hill chart', value: 'get_hill_chart' },
        ],
      },
    }),
    project: projectDropdown(true),
    card_table: cardTableDropdown(false),
    inputs: Property.DynamicProperties({
      displayName: 'Inputs',
      required: false,
      auth: basecampAuth,
      refreshers: ['operation', 'card_table'],
      props: async ({ operation, card_table }) => {
        const op = String(operation ?? '');
        const hasTable = Boolean(card_table);
        const fields: DynamicPropsValue = {};

        switch (op) {
          case 'list_card_tables':
            fields['include_archived'] = Property.Checkbox({
              displayName: 'Include archived',
              required: false,
              defaultValue: false,
            });
            fields['include_columns'] = Property.Checkbox({
              displayName: 'Include columns',
              required: false,
              defaultValue: false,
            });
            break;
          case 'list_card_table_columns':
          case 'list_card_table_cards':
            fields['card_table_id'] = Property.Number({
              displayName: 'Card table ID',
              description:
                'If you selected a Card table above, you can leave this empty.',
              required: !hasTable,
            });
            if (op === 'list_card_table_cards') {
              fields['max_cards_per_column'] = Property.Number({
                displayName: 'Max cards per column',
                required: false,
                defaultValue: 200,
              });
              fields['include_details'] = Property.Checkbox({
                displayName: 'Include details',
                required: false,
                defaultValue: false,
              });
            }
            break;
          case 'search_cards':
            fields['query'] = Property.ShortText({
              displayName: 'Search query',
              required: true,
            });
            fields['include_archived_projects'] = Property.Checkbox({
              displayName: 'Include archived projects',
              required: false,
              defaultValue: false,
            });
            fields['limit'] = Property.Number({
              displayName: 'Limit',
              required: false,
            });
            fields['max_cards_per_column'] = Property.Number({
              displayName: 'Max cards per column (optional)',
              required: false,
            });
            break;
          case 'create_card':
            fields['card_table_id'] = Property.Number({
              displayName: 'Card table ID',
              description:
                'If you selected a Card table above, you can leave this empty.',
              required: !hasTable,
            });
            fields['title'] = Property.ShortText({
              displayName: 'Title',
              required: true,
            });
            fields['content'] = Property.LongText({
              displayName: 'Content (optional)',
              required: false,
            });
            fields['description'] = Property.LongText({
              displayName: 'Description (optional)',
              required: false,
            });
            fields['column_id'] = Property.Number({
              displayName: 'Column ID (optional)',
              required: false,
            });
            fields['due_on'] = Property.ShortText({
              displayName: 'Due on (optional)',
              description: 'Date string (YYYY-MM-DD).',
              required: false,
            });
            fields['position'] = Property.Number({
              displayName: 'Position (optional)',
              required: false,
            });
            break;
          case 'move_card':
            fields['card_id'] = Property.Number({
              displayName: 'Card ID',
              required: true,
            });
            fields['column_id'] = Property.Number({
              displayName: 'Column ID (optional)',
              required: false,
            });
            fields['position'] = Property.Number({
              displayName: 'Position (optional)',
              required: false,
            });
            break;
          case 'archive_card':
          case 'unarchive_card':
          case 'trash_card':
          case 'get_card':
            fields['card_id'] = Property.Number({
              displayName: 'Card ID',
              required: true,
            });
            break;
          case 'update_card':
            fields['card_id'] = Property.Number({
              displayName: 'Card ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to update.',
              required: true,
            });
            break;
          case 'list_card_steps':
          case 'create_card_step':
          case 'reposition_card_step':
            fields['card_id'] = Property.Number({
              displayName: 'Card ID',
              required: true,
            });
            if (op === 'create_card_step') {
              fields['body'] = Property.Json({
                displayName: 'Body (JSON)',
                description: 'Official Basecamp fields to create a step.',
                required: true,
              });
            }
            if (op === 'reposition_card_step') {
              fields['step_id'] = Property.Number({
                displayName: 'Step ID',
                required: true,
              });
              fields['position'] = Property.Number({
                displayName: 'Position',
                required: true,
              });
            }
            break;
          case 'update_card_step':
            fields['step_id'] = Property.Number({
              displayName: 'Step ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to update a step.',
              required: true,
            });
            break;
          case 'complete_card_step':
          case 'uncomplete_card_step':
            fields['step_id'] = Property.Number({
              displayName: 'Step ID',
              required: true,
            });
            break;
          case 'get_hill_chart':
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
    const cardTableFromDropdown = context.propsValue.card_table;
    const inputs = (context.propsValue.inputs ?? {}) as Record<string, unknown>;

    const resolveCardTableId = (): number => {
      const raw =
        inputs['card_table_id'] ??
        (cardTableFromDropdown ? toInt(cardTableFromDropdown, 'Card table') : null);
      if (raw == null) {
        throw new Error('Card table is required');
      }
      return toInt(raw, 'Card table ID');
    };

    switch (op) {
      case 'list_card_tables':
        return await callGatewayTool({
          auth,
          toolName: 'list_card_tables',
          args: {
            project,
            include_archived: Boolean(inputs['include_archived']),
            include_columns: Boolean(inputs['include_columns']),
          },
        });
      case 'list_card_table_columns':
        return await callGatewayTool({
          auth,
          toolName: 'list_card_table_columns',
          args: {
            project,
            card_table_id: resolveCardTableId(),
          },
        });
      case 'list_card_table_cards':
        return await callGatewayTool({
          auth,
          toolName: 'list_card_table_cards',
          args: {
            project,
            card_table_id: resolveCardTableId(),
            max_cards_per_column: inputs['max_cards_per_column'],
            include_details: Boolean(inputs['include_details']),
          },
        });
      case 'search_cards':
        return await callGatewayTool({
          auth,
          toolName: 'search_cards',
          args: {
            query: inputs['query'],
            project,
            include_archived_projects: Boolean(inputs['include_archived_projects']),
            limit: inputs['limit'],
            max_cards_per_column: inputs['max_cards_per_column'],
          },
        });
      case 'create_card':
        return await callGatewayTool({
          auth,
          toolName: 'create_card',
          args: {
            project,
            card_table_id: resolveCardTableId(),
            title: inputs['title'],
            content: inputs['content'] || undefined,
            description: inputs['description'] || undefined,
            column_id: inputs['column_id'] || undefined,
            due_on: inputs['due_on'] || undefined,
            position: inputs['position'] || undefined,
          },
        });
      case 'move_card':
        return await callGatewayTool({
          auth,
          toolName: 'move_card',
          args: {
            project,
            card_id: inputs['card_id'],
            column_id: inputs['column_id'] || undefined,
            position: inputs['position'] || undefined,
          },
        });
      case 'archive_card':
      case 'unarchive_card':
      case 'trash_card':
      case 'get_card':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: {
            project,
            card_id: inputs['card_id'],
          },
        });
      case 'update_card':
        return await callGatewayTool({
          auth,
          toolName: 'update_card',
          args: {
            project,
            card_id: inputs['card_id'],
            body: inputs['body'] ?? {},
          },
        });
      case 'list_card_steps':
        return await callGatewayTool({
          auth,
          toolName: 'list_card_steps',
          args: {
            project,
            card_id: inputs['card_id'],
          },
        });
      case 'create_card_step':
        return await callGatewayTool({
          auth,
          toolName: 'create_card_step',
          args: {
            project,
            card_id: inputs['card_id'],
            body: inputs['body'] ?? {},
          },
        });
      case 'update_card_step':
      case 'complete_card_step':
      case 'uncomplete_card_step':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: {
            project,
            step_id: inputs['step_id'],
            ...(op === 'update_card_step' ? { body: inputs['body'] ?? {} } : {}),
          },
        });
      case 'reposition_card_step':
        return await callGatewayTool({
          auth,
          toolName: 'reposition_card_step',
          args: {
            project,
            card_id: inputs['card_id'],
            step_id: inputs['step_id'],
            position: inputs['position'],
          },
        });
      case 'get_hill_chart':
        return await callGatewayTool({
          auth,
          toolName: 'get_hill_chart',
          args: { project },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
