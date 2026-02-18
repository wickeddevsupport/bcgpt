import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';
import { extractList, toInt } from '../common/payload';

type Vault = { id?: number; title?: string; name?: string };

const vaultDropdown = (required: boolean) =>
  Property.Dropdown({
    auth: basecampAuth,
    displayName: 'Vault',
    description: 'Select a vault (optional).',
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
        toolName: 'list_vaults',
        args: { project: String(project) },
      });
      const vaults = extractList<Vault>(result, 'vaults');
      return {
        disabled: false,
        options: vaults.map((v) => ({
          label: v.title ?? v.name ?? String(v.id ?? 'Unknown vault'),
          value: String(v.id ?? ''),
        })),
        placeholder: vaults.length ? 'Select a vault' : 'No vaults found',
      };
    },
  });

export const filesAction = createAction({
  auth: basecampAuth,
  name: 'files',
  displayName: 'Files',
  description: 'Work with uploads (files).',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List uploads', value: 'list_uploads' },
          { label: 'Get upload', value: 'get_upload' },
          { label: 'Create upload', value: 'create_upload' },
          { label: 'Update upload', value: 'update_upload' },
          { label: 'Summarize upload', value: 'summarize_upload' },
        ],
      },
    }),
    project: projectDropdown(true),
    vault: vaultDropdown(false),
    inputs: Property.DynamicProperties({
      displayName: 'Inputs',
      required: false,
      auth: basecampAuth,
      refreshers: ['operation', 'vault'],
      props: async ({ operation, vault }) => {
        const op = String(operation ?? '');
        const hasVault = Boolean(vault);
        const fields: DynamicPropsValue = {};

        switch (op) {
          case 'list_uploads':
            fields['vault_id'] = Property.Number({
              displayName: 'Vault ID (optional)',
              description:
                'If you selected a Vault above, you can leave this empty.',
              required: false,
            });
            break;
          case 'get_upload':
          case 'summarize_upload':
            fields['upload_id'] = Property.Number({
              displayName: 'Upload ID',
              required: true,
            });
            break;
          case 'update_upload':
            fields['upload_id'] = Property.Number({
              displayName: 'Upload ID',
              required: true,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields.',
              required: true,
            });
            break;
          case 'create_upload':
            fields['vault_id'] = Property.Number({
              displayName: 'Vault ID',
              description:
                'If you selected a Vault above, you can leave this empty.',
              required: !hasVault,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON)',
              description: 'Official Basecamp fields.',
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
    const vaultFromDropdown = context.propsValue.vault;
    const inputs = (context.propsValue.inputs ?? {}) as Record<string, unknown>;

    const resolveVaultIdOptional = (): number | undefined => {
      const raw =
        inputs['vault_id'] ??
        (vaultFromDropdown ? toInt(vaultFromDropdown, 'Vault') : null);
      if (raw == null) return undefined;
      return toInt(raw, 'Vault ID');
    };

    const resolveVaultIdRequired = (): number => {
      const v = resolveVaultIdOptional();
      if (v == null) {
        throw new Error('Vault is required');
      }
      return v;
    };

    switch (op) {
      case 'list_uploads':
        return await callGatewayTool({
          auth,
          toolName: 'list_uploads',
          args: { project, vault_id: resolveVaultIdOptional() },
        });
      case 'get_upload':
        return await callGatewayTool({
          auth,
          toolName: 'get_upload',
          args: { project, upload_id: inputs['upload_id'] },
        });
      case 'summarize_upload':
        return await callGatewayTool({
          auth,
          toolName: 'summarize_upload',
          args: { project, upload_id: inputs['upload_id'] },
        });
      case 'create_upload':
        return await callGatewayTool({
          auth,
          toolName: 'create_upload',
          args: {
            project,
            vault_id: resolveVaultIdRequired(),
            body: inputs['body'] ?? {},
          },
        });
      case 'update_upload':
        return await callGatewayTool({
          auth,
          toolName: 'update_upload',
          args: { project, upload_id: inputs['upload_id'], body: inputs['body'] ?? {} },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
