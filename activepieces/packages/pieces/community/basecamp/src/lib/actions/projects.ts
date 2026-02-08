import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';
import { projectDropdown } from '../common/dropdowns';
import { toInt } from '../common/payload';

export const projectsAction = createAction({
  auth: basecampAuth,
  name: 'projects',
  displayName: 'Projects',
  description: 'Work with Basecamp projects.',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List projects', value: 'list_projects' },
          { label: 'Find project by name', value: 'find_project' },
          { label: 'Search projects', value: 'search_projects' },
          { label: 'Get project (by ID)', value: 'get_project' },
          { label: 'Get project structure (dock)', value: 'get_project_structure' },
          { label: 'Search within a project', value: 'search_project' },
          { label: 'Summarize project', value: 'summarize_project' },
          { label: 'Create project', value: 'create_project' },
          { label: 'Update project', value: 'update_project' },
          { label: 'Trash project', value: 'trash_project' },
        ],
      },
    }),
    project: projectDropdown(false),
    inputs: Property.DynamicProperties({
      displayName: 'Inputs',
      required: false,
      auth: basecampAuth,
      refreshers: ['operation', 'project'],
      props: async ({ operation }) => {
        const op = String(operation ?? '');
        const fields: DynamicPropsValue = {};
        switch (op) {
          case 'list_projects':
            fields['archived'] = Property.Checkbox({
              displayName: 'Include archived projects',
              required: false,
              defaultValue: false,
            });
            break;
          case 'find_project':
            fields['name'] = Property.ShortText({
              displayName: 'Project name',
              required: true,
            });
            break;
          case 'search_projects':
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
            break;
          case 'get_project':
          case 'trash_project':
            fields['project_id'] = Property.Number({
              displayName: 'Project ID (optional)',
              description:
                'If you selected a Project above, you can leave this empty.',
              required: false,
            });
            break;
          case 'update_project':
            fields['project_id'] = Property.Number({
              displayName: 'Project ID (optional)',
              description:
                'If you selected a Project above, you can leave this empty.',
              required: false,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields to update.',
              required: true,
            });
            break;
          case 'create_project':
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields for creating a project.',
              required: true,
            });
            break;
          case 'get_project_structure':
            break;
          case 'search_project':
            fields['query'] = Property.ShortText({
              displayName: 'Search query',
              required: true,
            });
            break;
          case 'summarize_project':
            fields['include_todolists'] = Property.Checkbox({
              displayName: 'Include to-dos',
              required: false,
              defaultValue: true,
            });
            fields['include_card_tables'] = Property.Checkbox({
              displayName: 'Include card tables',
              required: false,
              defaultValue: true,
            });
            fields['include_message_boards'] = Property.Checkbox({
              displayName: 'Include message boards',
              required: false,
              defaultValue: true,
            });
            fields['include_vaults'] = Property.Checkbox({
              displayName: 'Include vaults',
              required: false,
              defaultValue: true,
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
    const projectFromDropdown = context.propsValue.project;
    const inputs = (context.propsValue.inputs ?? {}) as Record<string, unknown>;

    switch (op) {
      case 'list_projects':
        return await callGatewayTool({
          auth,
          toolName: 'list_projects',
          args: {
            archived: Boolean(inputs['archived']),
          },
        });
      case 'find_project':
        return await callGatewayTool({
          auth,
          toolName: 'find_project',
          args: { name: inputs['name'] },
        });
      case 'search_projects':
        return await callGatewayTool({
          auth,
          toolName: 'search_projects',
          args: {
            query: inputs['query'],
            include_archived_projects: Boolean(inputs['include_archived_projects']),
            limit: inputs['limit'],
          },
        });
      case 'get_project': {
        const projectId =
          inputs['project_id'] ??
          (projectFromDropdown ? toInt(projectFromDropdown, 'Project') : null);
        if (projectId == null) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'get_project',
          args: { project_id: toInt(projectId, 'Project ID') },
        });
      }
      case 'get_project_structure': {
        if (!projectFromDropdown) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'get_project_structure',
          args: { project: projectFromDropdown },
        });
      }
      case 'search_project': {
        if (!projectFromDropdown) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'search_project',
          args: {
            project: projectFromDropdown,
            query: inputs['query'],
          },
        });
      }
      case 'summarize_project': {
        if (!projectFromDropdown) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'summarize_project',
          args: {
            project: projectFromDropdown,
            include_todolists: Boolean(inputs['include_todolists']),
            include_card_tables: Boolean(inputs['include_card_tables']),
            include_message_boards: Boolean(inputs['include_message_boards']),
            include_vaults: Boolean(inputs['include_vaults']),
          },
        });
      }
      case 'create_project':
        return await callGatewayTool({
          auth,
          toolName: 'create_project',
          args: { body: inputs['body'] ?? {} },
        });
      case 'update_project': {
        const projectId =
          inputs['project_id'] ??
          (projectFromDropdown ? toInt(projectFromDropdown, 'Project') : null);
        if (projectId == null) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'update_project',
          args: {
            project_id: toInt(projectId, 'Project ID'),
            body: inputs['body'] ?? {},
          },
        });
      }
      case 'trash_project': {
        const projectId =
          inputs['project_id'] ??
          (projectFromDropdown ? toInt(projectFromDropdown, 'Project') : null);
        if (projectId == null) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'trash_project',
          args: { project_id: toInt(projectId, 'Project ID') },
        });
      }
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
