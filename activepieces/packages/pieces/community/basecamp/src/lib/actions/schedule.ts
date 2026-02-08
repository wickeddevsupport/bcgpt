import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';

export const scheduleAction = createAction({
  auth: basecampAuth,
  name: 'schedule',
  displayName: 'Schedule',
  description: 'Work with Basecamp schedules and schedule entries.',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List schedule entries', value: 'list_schedule_entries' },
          { label: 'Get schedule', value: 'get_schedule' },
          { label: 'Update schedule', value: 'update_schedule' },
          { label: 'Get schedule entry', value: 'get_schedule_entry' },
          { label: 'Create schedule entry', value: 'create_schedule_entry' },
          { label: 'Update schedule entry', value: 'update_schedule_entry' },
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
          case 'list_schedule_entries':
            fields['start'] = Property.ShortText({
              displayName: 'Start (optional)',
              description: 'Date string (YYYY-MM-DD).',
              required: false,
            });
            fields['end'] = Property.ShortText({
              displayName: 'End (optional)',
              description: 'Date string (YYYY-MM-DD).',
              required: false,
            });
            break;
          case 'get_schedule':
            fields['schedule_id'] = Property.Number({
              displayName: 'Schedule ID',
              required: true,
            });
            break;
          case 'update_schedule':
            fields['schedule_id'] = Property.Number({
              displayName: 'Schedule ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to update.',
              required: true,
            });
            break;
          case 'get_schedule_entry':
            fields['entry_id'] = Property.Number({
              displayName: 'Entry ID',
              required: true,
            });
            break;
          case 'update_schedule_entry':
            fields['entry_id'] = Property.Number({
              displayName: 'Entry ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to update.',
              required: true,
            });
            break;
          case 'create_schedule_entry':
            fields['schedule_id'] = Property.Number({
              displayName: 'Schedule ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to create an entry.',
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
      case 'list_schedule_entries':
        return await callGatewayTool({
          auth,
          toolName: 'list_schedule_entries',
          args: {
            project,
            start: inputs['start'] || undefined,
            end: inputs['end'] || undefined,
          },
        });
      case 'get_schedule':
        return await callGatewayTool({
          auth,
          toolName: 'get_schedule',
          args: { project, schedule_id: inputs['schedule_id'] },
        });
      case 'update_schedule':
        return await callGatewayTool({
          auth,
          toolName: 'update_schedule',
          args: {
            project,
            schedule_id: inputs['schedule_id'],
            body: inputs['body'] ?? {},
          },
        });
      case 'get_schedule_entry':
        return await callGatewayTool({
          auth,
          toolName: 'get_schedule_entry',
          args: { project, entry_id: inputs['entry_id'] },
        });
      case 'create_schedule_entry':
        return await callGatewayTool({
          auth,
          toolName: 'create_schedule_entry',
          args: {
            project,
            schedule_id: inputs['schedule_id'],
            body: inputs['body'] ?? {},
          },
        });
      case 'update_schedule_entry':
        return await callGatewayTool({
          auth,
          toolName: 'update_schedule_entry',
          args: {
            project,
            entry_id: inputs['entry_id'],
            body: inputs['body'] ?? {},
          },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
