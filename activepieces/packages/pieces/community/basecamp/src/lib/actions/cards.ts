import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';
import { extractList, toInt, toOptionalInt } from '../common/payload';

type CardTable = { id?: number; title?: string; name?: string };
type CardColumn = { id?: number; title?: string; name?: string };
type Card = { id?: number; title?: string; status?: string; due_on?: string | null };
type CardStep = { id?: number; title?: string; name?: string; content?: string };

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

const cardColumnDropdown = (required: boolean) =>
  Property.Dropdown({
    auth: basecampAuth,
    displayName: 'Column',
    description: 'Select a column in the selected card table.',
    required,
    refreshers: ['auth', 'project', 'card_table'],
    options: async ({ auth, project, card_table }) => {
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
      if (!card_table) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a card table first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_card_table_columns',
        args: {
          project: String(project),
          card_table_id: toInt(card_table, 'Card table'),
        },
      });
      const columns = extractList<CardColumn>(result, 'columns');
      return {
        disabled: false,
        options: columns
          .filter((c) => c?.id != null)
          .map((c) => ({
            label: c.title ?? c.name ?? String(c.id ?? 'Unknown column'),
            value: String(c.id ?? ''),
          })),
        placeholder: columns.length ? 'Select a column' : 'No columns found',
      };
    },
  });

const cardDropdown = (required: boolean) =>
  Property.Dropdown({
    auth: basecampAuth,
    displayName: 'Card',
    description: 'Select a card from the selected card table.',
    required,
    refreshers: ['auth', 'project', 'card_table'],
    options: async ({ auth, project, card_table }) => {
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
      if (!card_table) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a card table first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_card_table_cards',
        args: {
          project: String(project),
          card_table_id: toInt(card_table, 'Card table'),
          max_cards_per_column: 200,
          include_details: false,
        },
      });
      const cards = extractList<Card>(result, 'cards');

      return {
        disabled: false,
        options: cards
          .filter((c) => c?.id != null)
          .map((c) => ({
            label:
              (c.title ?? String(c.id ?? 'Unknown card')) +
              (c.due_on ? ` (due ${c.due_on})` : ''),
            value: String(c.id ?? ''),
          })),
        placeholder: cards.length ? 'Select a card' : 'No cards found',
      };
    },
  });

const cardStepDropdown = (required: boolean) =>
  Property.Dropdown({
    auth: basecampAuth,
    displayName: 'Step',
    description: 'Select a step (checklist item) from the selected card.',
    required,
    refreshers: ['auth', 'project', 'card'],
    options: async ({ auth, project, card }) => {
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
      if (!card) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a card first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_card_steps',
        args: {
          project: String(project),
          card_id: toInt(card, 'Card'),
        },
      });
      const steps = extractList<CardStep>(result, 'steps');

      return {
        disabled: false,
        options: steps
          .filter((s) => s?.id != null)
          .map((s) => ({
            label:
              s.title ?? s.name ?? s.content ?? String(s.id ?? 'Unknown step'),
            value: String(s.id ?? ''),
          })),
        placeholder: steps.length ? 'Select a step' : 'No steps found',
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
            if (!hasTable) {
              fields['card_table_id'] = Property.Number({
                displayName: 'Card table ID',
                required: true,
              });
            }
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
            if (!hasTable) {
              fields['card_table_id'] = Property.Number({
                displayName: 'Card table ID',
                required: true,
              });
            }
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
            if (hasTable) {
              fields['column'] = cardColumnDropdown(false);
            } else {
              fields['column_id'] = Property.Number({
                displayName: 'Column ID (optional)',
                required: false,
              });
            }
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
            if (hasTable) {
              fields['card'] = cardDropdown(true);
              fields['column'] = cardColumnDropdown(false);
            } else {
              fields['card_id'] = Property.Number({
                displayName: 'Card ID',
                required: true,
              });
              fields['column_id'] = Property.Number({
                displayName: 'Column ID (optional)',
                required: false,
              });
            }
            fields['position'] = Property.Number({
              displayName: 'Position (optional)',
              required: false,
            });
            break;
          case 'archive_card':
          case 'unarchive_card':
          case 'trash_card':
          case 'get_card':
            if (hasTable) {
              fields['card'] = cardDropdown(true);
            } else {
              fields['card_id'] = Property.Number({
                displayName: 'Card ID',
                required: true,
              });
            }
            break;
          case 'update_card':
            if (hasTable) {
              fields['card'] = cardDropdown(true);
            } else {
              fields['card_id'] = Property.Number({
                displayName: 'Card ID',
                required: true,
              });
            }
            fields['title'] = Property.ShortText({
              displayName: 'Title (optional)',
              required: false,
            });
            fields['content'] = Property.LongText({
              displayName: 'Content (optional)',
              required: false,
            });
            fields['description'] = Property.LongText({
              displayName: 'Description (optional)',
              required: false,
            });
            if (hasTable) {
              fields['column'] = cardColumnDropdown(false);
            } else {
              fields['column_id'] = Property.Number({
                displayName: 'Column ID (optional)',
                required: false,
              });
            }
            fields['due_on'] = Property.ShortText({
              displayName: 'Due on (optional)',
              description: 'Date string (YYYY-MM-DD).',
              required: false,
            });
            fields['position'] = Property.Number({
              displayName: 'Position (optional)',
              required: false,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              description: 'Advanced: official Basecamp fields to update.',
              required: false,
            });
            break;
          case 'list_card_steps':
          case 'create_card_step':
          case 'reposition_card_step':
            if (hasTable) {
              fields['card'] = cardDropdown(true);
            } else {
              fields['card_id'] = Property.Number({
                displayName: 'Card ID',
                required: true,
              });
            }
            if (op === 'create_card_step') {
              fields['title'] = Property.ShortText({
                displayName: 'Title',
                required: true,
              });
              fields['body'] = Property.Json({
                displayName: 'Body (JSON, optional)',
                description: 'Advanced: official Basecamp fields to create a step.',
                required: false,
              });
            }
            if (op === 'reposition_card_step') {
              if (hasTable) {
                fields['step'] = cardStepDropdown(true);
              } else {
                fields['step_id'] = Property.Number({
                  displayName: 'Step ID',
                  required: true,
                });
              }
              fields['position'] = Property.Number({
                displayName: 'Position',
                required: true,
              });
            }
            break;
          case 'update_card_step':
            if (hasTable) {
              fields['card'] = cardDropdown(true);
              fields['step'] = cardStepDropdown(true);
            } else {
              fields['step_id'] = Property.Number({
                displayName: 'Step ID',
                required: true,
              });
            }
            fields['title'] = Property.ShortText({
              displayName: 'Title (optional)',
              required: false,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              description: 'Advanced: official Basecamp fields to update a step.',
              required: false,
            });
            break;
          case 'complete_card_step':
          case 'uncomplete_card_step':
            if (hasTable) {
              fields['card'] = cardDropdown(true);
              fields['step'] = cardStepDropdown(true);
            } else {
              fields['step_id'] = Property.Number({
                displayName: 'Step ID',
                required: true,
              });
            }
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

    const resolveCardId = (): number => {
      const raw = inputs['card_id'] ?? inputs['card'];
      if (raw == null || raw === '') {
        throw new Error('Card is required');
      }
      return toInt(raw, 'Card ID');
    };

    const resolveStepId = (): number => {
      const raw = inputs['step_id'] ?? inputs['step'];
      if (raw == null || raw === '') {
        throw new Error('Step is required');
      }
      return toInt(raw, 'Step ID');
    };

    const resolveColumnId = (): number | undefined => {
      const raw = inputs['column_id'] ?? inputs['column'];
      return toOptionalInt(raw, 'Column ID');
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
            column_id: resolveColumnId(),
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
            card_id: resolveCardId(),
            column_id: resolveColumnId(),
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
            card_id: resolveCardId(),
          },
        });
      case 'update_card': {
        const baseBody =
          inputs['body'] && typeof inputs['body'] === 'object'
            ? (inputs['body'] as Record<string, unknown>)
            : {};
        const body: Record<string, unknown> = { ...baseBody };
        if (inputs['title']) body['title'] = inputs['title'];
        if (inputs['content']) body['content'] = inputs['content'];
        if (inputs['description']) body['description'] = inputs['description'];
        const columnId = resolveColumnId();
        if (columnId !== undefined) body['column_id'] = columnId;
        if (inputs['due_on']) body['due_on'] = inputs['due_on'];
        if (inputs['position'] !== undefined && inputs['position'] !== null) {
          body['position'] = inputs['position'];
        }

        if (Object.keys(body).length === 0) {
          throw new Error('Provide at least one field to update.');
        }

        return await callGatewayTool({
          auth,
          toolName: 'update_card',
          args: {
            project,
            card_id: resolveCardId(),
            body,
          },
        });
      }
      case 'list_card_steps':
        return await callGatewayTool({
          auth,
          toolName: 'list_card_steps',
          args: {
            project,
            card_id: resolveCardId(),
          },
        });
      case 'create_card_step':
        return await callGatewayTool({
          auth,
          toolName: 'create_card_step',
          args: {
            project,
            card_id: resolveCardId(),
            body: (() => {
              const base =
                inputs['body'] && typeof inputs['body'] === 'object'
                  ? (inputs['body'] as Record<string, unknown>)
                  : {};
              return {
                ...base,
                title: inputs['title'],
              };
            })(),
          },
        });
      case 'update_card_step':
      case 'complete_card_step':
      case 'uncomplete_card_step': {
        if (op !== 'update_card_step') {
          return await callGatewayTool({
            auth,
            toolName: op,
            args: {
              project,
              step_id: resolveStepId(),
            },
          });
        }

        const base =
          inputs['body'] && typeof inputs['body'] === 'object'
            ? (inputs['body'] as Record<string, unknown>)
            : {};
        const body: Record<string, unknown> = { ...base };
        if (inputs['title']) body['title'] = inputs['title'];
        if (Object.keys(body).length === 0) {
          throw new Error('Provide at least one field to update.');
        }

        return await callGatewayTool({
          auth,
          toolName: 'update_card_step',
          args: {
            project,
            step_id: resolveStepId(),
            body,
          },
        });
      }
      case 'reposition_card_step':
        return await callGatewayTool({
          auth,
          toolName: 'reposition_card_step',
          args: {
            project,
            card_id: resolveCardId(),
            step_id: resolveStepId(),
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
