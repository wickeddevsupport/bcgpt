import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import {
  projectDropdown,
  messageTypeDropdown,
  projectPeopleMultiSelectDropdown,
} from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';
import { extractList, toInt, toOptionalIntArray } from '../common/payload';

type MessageBoard = { id?: number; title?: string; name?: string };
type Message = { id?: number; subject?: string; title?: string };

const messageBoardDropdown = (required: boolean) =>
  Property.Dropdown({
    auth: basecampAuth,
    displayName: 'Message board',
    description: 'Select a message board.',
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
        toolName: 'list_message_boards',
        args: { project: String(project) },
      });
      const boards = extractList<MessageBoard>(result, 'message_boards');

      return {
        disabled: false,
        options: boards.map((b) => ({
          label: b.title ?? b.name ?? String(b.id ?? 'Unknown board'),
          value: String(b.id ?? ''),
        })),
        placeholder: boards.length ? 'Select a message board' : 'No boards found',
      };
    },
  });

const messageDropdown = (required: boolean) =>
  Property.Dropdown({
    auth: basecampAuth,
    displayName: 'Message',
    description: 'Select a message from the selected message board.',
    required,
    refreshers: ['auth', 'project', 'board'],
    options: async ({ auth, project, board }) => {
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
      if (!board) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Select a message board first',
        };
      }

      const result = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_messages',
        args: {
          project: String(project),
          message_board_id: toInt(board, 'Message board'),
        },
      });
      const messages = extractList<Message>(result, 'messages');

      return {
        disabled: false,
        options: messages
          .filter((m) => m?.id != null)
          .map((m) => ({
            label: m.subject ?? m.title ?? String(m.id ?? 'Unknown message'),
            value: String(m.id ?? ''),
          })),
        placeholder: messages.length ? 'Select a message' : 'No messages found',
      };
    },
  });

export const messagesAction = createAction({
  auth: basecampAuth,
  name: 'messages',
  displayName: 'Messages',
  description: 'Work with message boards and messages.',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List message boards', value: 'list_message_boards' },
          { label: 'Get message board', value: 'get_message_board' },
          { label: 'List messages', value: 'list_messages' },
          { label: 'Get message', value: 'get_message' },
          { label: 'Create message', value: 'create_message' },
          { label: 'Update message', value: 'update_message' },
          { label: 'List message types', value: 'list_message_types' },
          { label: 'Get message type', value: 'get_message_type' },
          { label: 'Create message type', value: 'create_message_type' },
          { label: 'Update message type', value: 'update_message_type' },
          { label: 'Delete message type', value: 'delete_message_type' },
          { label: 'Pin recording', value: 'pin_recording' },
          { label: 'Unpin recording', value: 'unpin_recording' },
        ],
      },
    }),
    project: projectDropdown(true),
    board: messageBoardDropdown(false),
    inputs: Property.DynamicProperties({
      displayName: 'Inputs',
      required: false,
      auth: basecampAuth,
      refreshers: ['operation', 'board'],
      props: async ({ operation, board }) => {
        const op = String(operation ?? '');
        const hasBoard = Boolean(board);
        const fields: DynamicPropsValue = {};

        switch (op) {
          case 'list_message_boards':
            break;
          case 'get_message_board':
            if (!hasBoard) {
              fields['board_id'] = Property.Number({
                displayName: 'Board ID',
                required: true,
              });
            }
            break;
          case 'list_messages':
          case 'list_message_types':
            if (!hasBoard) {
              fields['message_board_id'] = Property.Number({
                displayName: 'Message board ID (optional)',
                required: false,
              });
            }
            break;
          case 'get_message':
          case 'update_message':
            if (hasBoard) {
              fields['message'] = messageDropdown(true);
            } else {
              fields['message_id'] = Property.Number({
                displayName: 'Message ID',
                required: true,
              });
            }
            if (op === 'update_message') {
              fields['subject'] = Property.ShortText({
                displayName: 'Subject (optional)',
                required: false,
              });
              fields['content'] = Property.LongText({
                displayName: 'Content (optional)',
                required: false,
              });
              fields['status'] = Property.ShortText({
                displayName: 'Status (optional)',
                required: false,
              });
              fields['message_type'] = messageTypeDropdown(false);
              fields['body'] = Property.Json({
                displayName: 'Body (JSON, optional)',
                description: 'Advanced: official Basecamp fields to update.',
                required: false,
              });
            }
            break;
          case 'create_message':
            if (!hasBoard) {
              fields['board_id'] = Property.Number({
                displayName: 'Board ID',
                required: true,
              });
            }
            fields['subject'] = Property.ShortText({
              displayName: 'Subject (optional)',
              required: false,
            });
            fields['content'] = Property.LongText({
              displayName: 'Content (optional)',
              required: false,
            });
            fields['status'] = Property.ShortText({
              displayName: 'Status (optional)',
              required: false,
            });
            fields['message_type'] = messageTypeDropdown(false);
            fields['subscriptions'] = projectPeopleMultiSelectDropdown({
              required: false,
              displayName: 'Subscriptions (optional)',
              description: 'People to notify and subscribe.',
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              description: 'Advanced: official Basecamp fields to create.',
              required: false,
            });
            break;
          case 'get_message_type':
          case 'update_message_type':
          case 'delete_message_type':
            fields['message_type'] = messageTypeDropdown(true);
            if (op === 'update_message_type') {
              fields['name'] = Property.ShortText({
                displayName: 'Name (optional)',
                required: false,
              });
              fields['body'] = Property.Json({
                displayName: 'Body (JSON, optional)',
                description: 'Advanced: official Basecamp fields to update.',
                required: false,
              });
            }
            break;
          case 'create_message_type':
            fields['name'] = Property.ShortText({
              displayName: 'Name',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              description: 'Advanced: official Basecamp fields to create.',
              required: false,
            });
            break;
          case 'pin_recording':
          case 'unpin_recording':
            fields['recording_id'] = Property.Number({
              displayName: 'Recording ID',
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
    const boardFromDropdown = context.propsValue.board;
    const inputs = (context.propsValue.inputs ?? {}) as Record<string, unknown>;

    const resolveBoardId = (): number => {
      const raw =
        inputs['board_id'] ??
        inputs['message_board_id'] ??
        (boardFromDropdown ? toInt(boardFromDropdown, 'Message board') : null);
      if (raw == null) {
        throw new Error('Message board is required');
      }
      return toInt(raw, 'Board ID');
    };

    const resolveMessageId = (): number => {
      const raw = inputs['message_id'] ?? inputs['message'];
      if (raw == null || raw === '') {
        throw new Error('Message is required');
      }
      return toInt(raw, 'Message ID');
    };

    const baseBody =
      inputs['body'] && typeof inputs['body'] === 'object'
        ? (inputs['body'] as Record<string, unknown>)
        : {};

    const mergeMessageType = (body: Record<string, unknown>) => {
      const raw = inputs['message_type'];
      if (raw != null && raw !== '') {
        body['category_id'] = toInt(raw, 'Message type');
      }
    };

    switch (op) {
      case 'list_message_boards':
        return await callGatewayTool({
          auth,
          toolName: 'list_message_boards',
          args: { project },
        });
      case 'get_message_board':
        return await callGatewayTool({
          auth,
          toolName: 'get_message_board',
          args: { project, board_id: resolveBoardId() },
        });
      case 'list_messages': {
        const maybeBoardId =
          inputs['message_board_id'] ??
          (boardFromDropdown ? toInt(boardFromDropdown, 'Message board') : null);
        return await callGatewayTool({
          auth,
          toolName: 'list_messages',
          args: {
            project,
            message_board_id:
              maybeBoardId != null ? toInt(maybeBoardId, 'Board ID') : undefined,
          },
        });
      }
      case 'get_message':
        return await callGatewayTool({
          auth,
          toolName: 'get_message',
          args: { project, message_id: resolveMessageId() },
        });
      case 'create_message':
        return await callGatewayTool({
          auth,
          toolName: 'create_message',
          args: {
            project,
            board_id: resolveBoardId(),
            subject: inputs['subject'] || undefined,
            content: inputs['content'] || undefined,
            status: inputs['status'] || undefined,
            body: (() => {
              const body: Record<string, unknown> = { ...baseBody };
              mergeMessageType(body);
              const subscriptions = toOptionalIntArray(
                inputs['subscriptions'],
                'Subscriptions',
              );
              if (subscriptions) {
                body['subscriptions'] = subscriptions;
              }
              return body;
            })(),
          },
        });
      case 'update_message':
        return await callGatewayTool({
          auth,
          toolName: 'update_message',
          args: {
            project,
            message_id: resolveMessageId(),
            subject: inputs['subject'] || undefined,
            content: inputs['content'] || undefined,
            status: inputs['status'] || undefined,
            body: (() => {
              const body: Record<string, unknown> = { ...baseBody };
              mergeMessageType(body);
              return body;
            })(),
          },
        });
      case 'list_message_types': {
        const maybeBoardId =
          inputs['message_board_id'] ??
          (boardFromDropdown ? toInt(boardFromDropdown, 'Message board') : null);
        return await callGatewayTool({
          auth,
          toolName: 'list_message_types',
          args: {
            project,
            message_board_id:
              maybeBoardId != null ? toInt(maybeBoardId, 'Board ID') : undefined,
          },
        });
      }
      case 'get_message_type':
        return await callGatewayTool({
          auth,
          toolName: 'get_message_type',
          args: {
            project,
            message_type_id: toInt(inputs['message_type'], 'Message type'),
          },
        });
      case 'create_message_type': {
        const body: Record<string, unknown> = { ...baseBody };
        if (inputs['name']) {
          body['name'] = inputs['name'];
        }
        return await callGatewayTool({
          auth,
          toolName: 'create_message_type',
          args: {
            project,
            body,
          },
        });
      }
      case 'update_message_type':
        return await callGatewayTool({
          auth,
          toolName: 'update_message_type',
          args: {
            project,
            message_type_id: toInt(inputs['message_type'], 'Message type'),
            body: (() => {
              const body: Record<string, unknown> = { ...baseBody };
              if (inputs['name']) {
                body['name'] = inputs['name'];
              }
              return body;
            })(),
          },
        });
      case 'delete_message_type':
        return await callGatewayTool({
          auth,
          toolName: 'delete_message_type',
          args: {
            project,
            message_type_id: toInt(inputs['message_type'], 'Message type'),
          },
        });
      case 'pin_recording':
      case 'unpin_recording':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: { project, recording_id: inputs['recording_id'] },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
