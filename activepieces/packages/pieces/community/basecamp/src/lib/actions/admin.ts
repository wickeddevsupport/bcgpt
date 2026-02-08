import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';

export const adminAction = createAction({
  auth: basecampAuth,
  name: 'admin',
  displayName: 'Admin',
  description: 'Advanced operations (connection, raw requests, webhooks).',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'Connection status', value: 'startbcgpt' },
          { label: 'Who am I', value: 'whoami' },
          { label: 'List accounts', value: 'list_accounts' },
          { label: 'Raw Basecamp request', value: 'basecamp_request' },
          { label: 'List webhooks', value: 'list_webhooks' },
          { label: 'Get webhook', value: 'get_webhook' },
          { label: 'Create webhook', value: 'create_webhook' },
          { label: 'Update webhook', value: 'update_webhook' },
          { label: 'Delete webhook', value: 'delete_webhook' },
          { label: 'MCP call (advanced)', value: 'mcp_call' },
        ],
      },
    }),
    project: projectDropdown(false),
    inputs: Property.DynamicProperties({
      displayName: 'Inputs',
      required: false,
      auth: basecampAuth,
      refreshers: ['operation'],
      props: async ({ operation }) => {
        const op = String(operation ?? '');
        const fields: DynamicPropsValue = {};
        switch (op) {
          case 'basecamp_request':
            fields['path'] = Property.ShortText({
              displayName: 'Path or URL',
              description: 'Example: /projects.json or https://3.basecampapi.com/....',
              required: true,
            });
            fields['method'] = Property.StaticDropdown({
              displayName: 'Method (optional)',
              required: false,
              options: {
                options: [
                  { label: 'GET', value: 'GET' },
                  { label: 'POST', value: 'POST' },
                  { label: 'PUT', value: 'PUT' },
                  { label: 'PATCH', value: 'PATCH' },
                  { label: 'DELETE', value: 'DELETE' },
                ],
              },
            });
            fields['paginate'] = Property.Checkbox({
              displayName: 'Paginate',
              description: 'Follow pagination links when available.',
              required: false,
              defaultValue: false,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              required: false,
            });
            break;
          case 'get_webhook':
          case 'delete_webhook':
            fields['webhook_id'] = Property.Number({
              displayName: 'Webhook ID',
              required: true,
            });
            break;
          case 'create_webhook':
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp webhook fields.',
              required: true,
            });
            break;
          case 'update_webhook':
            fields['webhook_id'] = Property.Number({
              displayName: 'Webhook ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp webhook fields.',
              required: true,
            });
            break;
          case 'mcp_call':
            fields['tool'] = Property.ShortText({
              displayName: 'Tool name',
              required: true,
            });
            fields['args'] = Property.Json({
              displayName: 'Args (JSON)',
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
    const project = context.propsValue.project
      ? String(context.propsValue.project)
      : null;
    const inputs = (context.propsValue.inputs ?? {}) as Record<string, unknown>;

    switch (op) {
      case 'startbcgpt':
      case 'whoami':
      case 'list_accounts':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: {},
        });
      case 'basecamp_request':
        return await callGatewayTool({
          auth,
          toolName: 'basecamp_request',
          args: {
            path: inputs['path'],
            method: inputs['method'] || undefined,
            paginate: Boolean(inputs['paginate']),
            body: inputs['body'] || undefined,
          },
        });
      case 'list_webhooks': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'list_webhooks',
          args: { project },
        });
      }
      case 'get_webhook':
      case 'delete_webhook': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: op,
          args: { project, webhook_id: inputs['webhook_id'] },
        });
      }
      case 'create_webhook': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'create_webhook',
          args: { project, body: inputs['body'] ?? {} },
        });
      }
      case 'update_webhook': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'update_webhook',
          args: {
            project,
            webhook_id: inputs['webhook_id'],
            body: inputs['body'] ?? {},
          },
        });
      }
      case 'mcp_call':
        return await callGatewayTool({
          auth,
          toolName: 'mcp_call',
          args: {
            tool: inputs['tool'],
            args: (inputs['args'] as unknown) ?? {},
          },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
