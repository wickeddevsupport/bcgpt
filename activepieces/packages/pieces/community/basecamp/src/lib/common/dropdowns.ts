import { Property } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from './client';
import { callGatewayTool } from './gateway';
import { extractList } from './payload';

type Project = { id?: number; name?: string };

export const projectDropdown = <R extends boolean>(required: R) =>
  Property.Dropdown<string, R, typeof basecampAuth>({
    auth: basecampAuth,
    displayName: 'Project',
    description: 'Select a project.',
    required,
    refreshers: ['auth'],
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Connect Basecamp first',
        };
      }
      const projectsResult = await callGatewayTool({
        auth: auth as unknown as BasecampGatewayAuthConnection,
        toolName: 'list_projects',
        args: {},
      });
      const projects = extractList<Project>(projectsResult, 'projects');
      return {
        disabled: false,
        options: projects.map((p) => ({
          label: p.name ?? String(p.id ?? 'Unknown project'),
          value: String(p.id ?? ''),
        })),
        placeholder: projects.length ? 'Select a project' : 'No projects found',
      };
    },
  });
