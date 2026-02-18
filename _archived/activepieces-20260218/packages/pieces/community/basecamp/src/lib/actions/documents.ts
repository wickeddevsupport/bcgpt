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
    description: 'Select a document vault.',
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

export const documentsAction = createAction({
  auth: basecampAuth,
  name: 'documents',
  displayName: 'Documents',
  description: 'Work with vaults and documents.',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List vaults', value: 'list_vaults' },
          { label: 'Get vault', value: 'get_vault' },
          { label: 'List child vaults', value: 'list_child_vaults' },
          { label: 'Create child vault', value: 'create_child_vault' },
          { label: 'Update vault', value: 'update_vault' },
          { label: 'List documents', value: 'list_documents' },
          { label: 'Get document', value: 'get_document' },
          { label: 'Create document', value: 'create_document' },
          { label: 'Update document', value: 'update_document' },
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
          case 'list_vaults':
          case 'list_documents':
            break;
          case 'get_vault':
          case 'list_child_vaults':
            fields['vault_id'] = Property.Number({
              displayName: 'Vault ID',
              description:
                'If you selected a Vault above, you can leave this empty.',
              required: !hasVault,
            });
            break;
          case 'create_child_vault':
          case 'update_vault':
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
          case 'get_document':
          case 'update_document':
            fields['document_id'] = Property.Number({
              displayName: 'Document ID',
              required: true,
            });
            if (op === 'update_document') {
              fields['body'] = Property.Json({
                displayName: 'Body (JSON)',
                description: 'Official Basecamp fields.',
                required: true,
              });
            }
            break;
          case 'create_document':
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

    const resolveVaultId = (): number => {
      const raw =
        inputs['vault_id'] ??
        (vaultFromDropdown ? toInt(vaultFromDropdown, 'Vault') : null);
      if (raw == null) {
        throw new Error('Vault is required');
      }
      return toInt(raw, 'Vault ID');
    };

    switch (op) {
      case 'list_vaults':
      case 'list_documents':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: { project },
        });
      case 'get_vault':
      case 'list_child_vaults':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: { project, vault_id: resolveVaultId() },
        });
      case 'create_child_vault':
      case 'update_vault':
        return await callGatewayTool({
          auth,
          toolName: op,
          args: { project, vault_id: resolveVaultId(), body: inputs['body'] ?? {} },
        });
      case 'get_document':
        return await callGatewayTool({
          auth,
          toolName: 'get_document',
          args: { project, document_id: inputs['document_id'] },
        });
      case 'create_document':
        return await callGatewayTool({
          auth,
          toolName: 'create_document',
          args: { project, vault_id: resolveVaultId(), body: inputs['body'] ?? {} },
        });
      case 'update_document':
        return await callGatewayTool({
          auth,
          toolName: 'update_document',
          args: { project, document_id: inputs['document_id'], body: inputs['body'] ?? {} },
        });
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
