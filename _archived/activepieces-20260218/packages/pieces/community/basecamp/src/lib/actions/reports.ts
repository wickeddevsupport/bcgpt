import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';

export const reportsAction = createAction({
  auth: basecampAuth,
  name: 'reports',
  displayName: 'Reports',
  description: 'Reporting and summaries (to-dos, timeline, timesheets).',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'Daily report', value: 'daily_report' },
          { label: 'List to-dos due', value: 'list_todos_due' },
          { label: 'Search to-dos', value: 'search_todos' },
          { label: 'Assignment report (by assignee)', value: 'assignment_report' },
          { label: 'Person assignments (in project)', value: 'get_person_assignments' },
          { label: 'Assigned to me', value: 'list_assigned_to_me' },
          { label: 'Timesheet report (account)', value: 'list_timesheet_report' },
          { label: 'Timesheet (project)', value: 'list_project_timesheet' },
          { label: 'Timesheet (recording)', value: 'list_recording_timesheet' },
          { label: 'Report: people who can be assigned', value: 'report_todos_assigned' },
          { label: 'Report: to-dos assigned to person', value: 'report_todos_assigned_person' },
          { label: 'Report: overdue to-dos', value: 'report_todos_overdue' },
          { label: 'Report: upcoming schedules', value: 'report_schedules_upcoming' },
          { label: 'Report: timeline (account)', value: 'report_timeline' },
          { label: 'Timeline (project)', value: 'project_timeline' },
          { label: 'Timeline (person)', value: 'user_timeline' },
          { label: 'Report: timesheet (account)', value: 'report_timesheet' },
          { label: 'Timesheet (project, query)', value: 'project_timesheet' },
          { label: 'Timesheet (recording, query)', value: 'recording_timesheet' },
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
          case 'daily_report':
            fields['date'] = Property.ShortText({
              displayName: 'Date (optional)',
              description: 'YYYY-MM-DD (defaults to today).',
              required: false,
            });
            break;
          case 'list_todos_due':
            fields['date'] = Property.ShortText({
              displayName: 'Date (optional)',
              description: 'YYYY-MM-DD (defaults to today).',
              required: false,
            });
            fields['include_overdue'] = Property.Checkbox({
              displayName: 'Include overdue',
              required: false,
              defaultValue: false,
            });
            break;
          case 'search_todos':
            fields['query'] = Property.ShortText({
              displayName: 'Query',
              required: true,
            });
            break;
          case 'assignment_report':
            fields['max_todos'] = Property.Number({
              displayName: 'Max to-dos (optional)',
              required: false,
            });
            break;
          case 'get_person_assignments':
            fields['person'] = Property.ShortText({
              displayName: 'Person',
              description: 'Name, email, or person ID.',
              required: true,
            });
            break;
          case 'list_timesheet_report':
            fields['start_date'] = Property.ShortText({
              displayName: 'Start date (optional)',
              description: 'YYYY-MM-DD',
              required: false,
            });
            fields['end_date'] = Property.ShortText({
              displayName: 'End date (optional)',
              description: 'YYYY-MM-DD',
              required: false,
            });
            fields['person_id'] = Property.Number({
              displayName: 'Person ID (optional)',
              required: false,
            });
            fields['bucket_id'] = Property.Number({
              displayName: 'Project ID (bucket_id, optional)',
              required: false,
            });
            break;
          case 'list_recording_timesheet':
            fields['recording_id'] = Property.Number({
              displayName: 'Recording ID',
              required: true,
            });
            break;
          case 'report_todos_assigned_person':
            fields['person'] = Property.ShortText({
              displayName: 'Person (optional)',
              description: 'Name/email/person ID. Alternative to Person ID.',
              required: false,
            });
            fields['person_id'] = Property.Number({
              displayName: 'Person ID (optional)',
              required: false,
            });
            fields['compact'] = Property.Checkbox({
              displayName: 'Compact',
              required: false,
              defaultValue: true,
            });
            break;
          case 'report_schedules_upcoming':
          case 'report_timeline':
          case 'report_timesheet':
            fields['query'] = Property.ShortText({
              displayName: 'Query (optional)',
              required: false,
            });
            break;
          case 'project_timeline':
          case 'project_timesheet':
            fields['query'] = Property.ShortText({
              displayName: 'Query (optional)',
              required: false,
            });
            break;
          case 'user_timeline':
            fields['person_id'] = Property.Number({
              displayName: 'Person ID',
              required: true,
            });
            fields['query'] = Property.ShortText({
              displayName: 'Query (optional)',
              required: false,
            });
            break;
          case 'recording_timesheet':
            fields['recording_id'] = Property.Number({
              displayName: 'Recording ID',
              required: true,
            });
            fields['query'] = Property.ShortText({
              displayName: 'Query (optional)',
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
      case 'daily_report':
        return await callGatewayTool({
          auth,
          toolName: 'daily_report',
          args: { date: inputs['date'] || undefined },
        });
      case 'list_todos_due':
        return await callGatewayTool({
          auth,
          toolName: 'list_todos_due',
          args: {
            date: inputs['date'] || undefined,
            include_overdue: Boolean(inputs['include_overdue']),
          },
        });
      case 'search_todos':
        return await callGatewayTool({
          auth,
          toolName: 'search_todos',
          args: { query: inputs['query'] },
        });
      case 'assignment_report': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'assignment_report',
          args: { project, max_todos: inputs['max_todos'] },
        });
      }
      case 'get_person_assignments': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'get_person_assignments',
          args: { project, person: inputs['person'] },
        });
      }
      case 'list_assigned_to_me':
        return await callGatewayTool({
          auth,
          toolName: 'list_assigned_to_me',
          args: { project: project || undefined },
        });
      case 'list_timesheet_report':
        return await callGatewayTool({
          auth,
          toolName: 'list_timesheet_report',
          args: {
            start_date: inputs['start_date'] || undefined,
            end_date: inputs['end_date'] || undefined,
            person_id: inputs['person_id'] || undefined,
            bucket_id: inputs['bucket_id'] || undefined,
          },
        });
      case 'list_project_timesheet': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'list_project_timesheet',
          args: { project },
        });
      }
      case 'list_recording_timesheet': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'list_recording_timesheet',
          args: { project, recording_id: inputs['recording_id'] },
        });
      }
      case 'report_todos_assigned':
      case 'report_todos_overdue':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: {},
        });
      case 'report_todos_assigned_person':
        return await callGatewayTool({
          auth,
          toolName: 'report_todos_assigned_person',
          args: {
            person: inputs['person'] || undefined,
            person_id: inputs['person_id'] || undefined,
            compact: Boolean(inputs['compact']),
          },
        });
      case 'report_schedules_upcoming':
      case 'report_timeline':
      case 'report_timesheet':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: { query: inputs['query'] || undefined },
        });
      case 'project_timeline':
      case 'project_timesheet': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: op,
          args: { project, query: inputs['query'] || undefined },
        });
      }
      case 'user_timeline':
        return await callGatewayTool({
          auth,
          toolName: 'user_timeline',
          args: {
            person_id: inputs['person_id'],
            query: inputs['query'] || undefined,
          },
        });
      case 'recording_timesheet': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'recording_timesheet',
          args: {
            project,
            recording_id: inputs['recording_id'],
            query: inputs['query'] || undefined,
          },
        });
      }
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
