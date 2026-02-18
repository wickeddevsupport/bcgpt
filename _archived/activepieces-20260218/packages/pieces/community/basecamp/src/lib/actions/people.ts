import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';

export const peopleAction = createAction({
  auth: basecampAuth,
  name: 'people',
  displayName: 'People',
  description: 'Work with people and project memberships.',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List all people', value: 'list_all_people' },
          { label: 'Search people', value: 'search_people' },
          { label: 'Get person', value: 'get_person' },
          { label: 'Get my profile', value: 'get_my_profile' },
          { label: 'List people on a project', value: 'list_project_people' },
          { label: 'List pingable people', value: 'list_pingable_people' },
          { label: "List a person's projects", value: 'list_person_projects' },
          { label: "List a person's activity", value: 'list_person_activity' },
          { label: 'Audit person', value: 'audit_person' },
          { label: 'Summarize person', value: 'summarize_person' },
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
          case 'list_all_people':
            fields['query'] = Property.ShortText({
              displayName: 'Query',
              description:
                'Name or email to search for. Use empty string to list all.',
              required: false,
            });
            fields['deep_scan'] = Property.Checkbox({
              displayName: 'Deep scan',
              description: 'Force a deep scan across project memberships (slower).',
              required: false,
              defaultValue: false,
            });
            fields['include_archived_projects'] = Property.Checkbox({
              displayName: 'Include archived projects',
              required: false,
              defaultValue: false,
            });
            break;
          case 'search_people':
            fields['query'] = Property.ShortText({
              displayName: 'Query',
              required: true,
            });
            fields['include_archived_projects'] = Property.Checkbox({
              displayName: 'Include archived projects',
              required: false,
              defaultValue: false,
            });
            break;
          case 'get_person':
            fields['person_id'] = Property.Number({
              displayName: 'Person ID',
              required: true,
            });
            break;
          case 'list_person_projects':
            fields['person'] = Property.ShortText({
              displayName: 'Person',
              description: 'Name, email, or person ID.',
              required: true,
            });
            fields['include_archived_projects'] = Property.Checkbox({
              displayName: 'Include archived projects',
              required: false,
              defaultValue: false,
            });
            break;
          case 'list_person_activity':
            fields['person'] = Property.ShortText({
              displayName: 'Person',
              description: 'Name, email, or person ID.',
              required: true,
            });
            fields['query'] = Property.ShortText({
              displayName: 'Query (optional)',
              required: false,
            });
            fields['include_archived_projects'] = Property.Checkbox({
              displayName: 'Include archived projects',
              required: false,
              defaultValue: false,
            });
            fields['limit'] = Property.Number({
              displayName: 'Limit (optional)',
              required: false,
            });
            break;
          case 'audit_person':
            fields['person'] = Property.ShortText({
              displayName: 'Person',
              description: 'Name, email, or person ID.',
              required: true,
            });
            fields['include_archived_projects'] = Property.Checkbox({
              displayName: 'Include archived projects',
              required: false,
              defaultValue: false,
            });
            fields['include_assignments'] = Property.Checkbox({
              displayName: 'Include assignments',
              required: false,
              defaultValue: true,
            });
            fields['include_activity'] = Property.Checkbox({
              displayName: 'Include activity',
              required: false,
              defaultValue: true,
            });
            fields['activity_limit'] = Property.Number({
              displayName: 'Activity limit (optional)',
              required: false,
            });
            fields['compact'] = Property.Checkbox({
              displayName: 'Compact',
              description: 'Return compact payloads to avoid huge responses.',
              required: false,
              defaultValue: true,
            });
            break;
          case 'summarize_person':
            fields['person'] = Property.ShortText({
              displayName: 'Person',
              description: 'Name, email, or person ID.',
              required: true,
            });
            fields['include_archived_projects'] = Property.Checkbox({
              displayName: 'Include archived projects',
              required: false,
              defaultValue: false,
            });
            fields['include_assignments'] = Property.Checkbox({
              displayName: 'Include assignments',
              required: false,
              defaultValue: true,
            });
            fields['include_activity'] = Property.Checkbox({
              displayName: 'Include activity',
              required: false,
              defaultValue: true,
            });
            fields['activity_limit'] = Property.Number({
              displayName: 'Activity limit (optional)',
              required: false,
            });
            fields['preview_limit'] = Property.Number({
              displayName: 'Preview limit (optional)',
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
      case 'list_all_people':
        return await callGatewayTool({
          auth,
          toolName: 'list_all_people',
          args: {
            query: inputs['query'] ?? '',
            deep_scan: Boolean(inputs['deep_scan']),
            include_archived_projects: Boolean(inputs['include_archived_projects']),
          },
        });
      case 'search_people':
        return await callGatewayTool({
          auth,
          toolName: 'search_people',
          args: {
            query: inputs['query'],
            include_archived_projects: Boolean(inputs['include_archived_projects']),
          },
        });
      case 'get_person':
        return await callGatewayTool({
          auth,
          toolName: 'get_person',
          args: { person_id: inputs['person_id'] },
        });
      case 'get_my_profile':
      case 'list_pingable_people':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: {},
        });
      case 'list_project_people': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'list_project_people',
          args: { project },
        });
      }
      case 'list_person_projects':
        return await callGatewayTool({
          auth,
          toolName: 'list_person_projects',
          args: {
            person: inputs['person'],
            include_archived_projects: Boolean(inputs['include_archived_projects']),
          },
        });
      case 'list_person_activity':
        return await callGatewayTool({
          auth,
          toolName: 'list_person_activity',
          args: {
            person: inputs['person'],
            project: project || undefined,
            query: inputs['query'] || undefined,
            include_archived_projects: Boolean(inputs['include_archived_projects']),
            limit: inputs['limit'],
          },
        });
      case 'audit_person':
        return await callGatewayTool({
          auth,
          toolName: 'audit_person',
          args: {
            person: inputs['person'],
            include_archived_projects: Boolean(inputs['include_archived_projects']),
            include_assignments: Boolean(inputs['include_assignments']),
            include_activity: Boolean(inputs['include_activity']),
            activity_limit: inputs['activity_limit'],
            compact: Boolean(inputs['compact']),
          },
        });
      case 'summarize_person':
        return await callGatewayTool({
          auth,
          toolName: 'summarize_person',
          args: {
            person: inputs['person'],
            include_archived_projects: Boolean(inputs['include_archived_projects']),
            include_assignments: Boolean(inputs['include_assignments']),
            include_activity: Boolean(inputs['include_activity']),
            activity_limit: inputs['activity_limit'],
            preview_limit: inputs['preview_limit'],
          },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
