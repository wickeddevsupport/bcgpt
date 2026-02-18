import { createAction, Property, DynamicPropsValue } from '@activepieces/pieces-framework';
import { basecampAuth } from '../../index';
import type { BasecampGatewayAuthConnection } from '../common/client';
import { projectDropdown } from '../common/dropdowns';
import { callGatewayTool, requireGatewayAuth } from '../common/gateway';

export const commentsAction = createAction({
  auth: basecampAuth,
  name: 'comments',
  displayName: 'Comments',
  description: 'Work with comments and attachments.',
  requireAuth: true,
  props: {
    operation: Property.StaticDropdown({
      displayName: 'Operation',
      required: true,
      options: {
        options: [
          { label: 'List comments', value: 'list_comments' },
          { label: 'Get comment', value: 'get_comment' },
          { label: 'Create comment', value: 'create_comment' },
          { label: 'Update comment', value: 'update_comment' },
          { label: 'Create attachment', value: 'create_attachment' },
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
          case 'list_comments':
            fields['recording'] = Property.ShortText({
              displayName: 'Recording ID or URL',
              description:
                'The recording you want comments for (message, doc, todo, card, etc). You can paste a Basecamp URL.',
              required: true,
            });
            break;
          case 'get_comment':
            fields['comment_id'] = Property.Number({
              displayName: 'Comment ID',
              required: true,
            });
            break;
          case 'create_comment':
            fields['recording'] = Property.ShortText({
              displayName: 'Recording ID or URL',
              description:
                'The recording to comment on. You can paste a Basecamp URL.',
              required: true,
            });
            fields['content'] = Property.LongText({
              displayName: 'Comment',
              required: true,
            });
            fields['recording_query'] = Property.ShortText({
              displayName: 'Recording query (optional)',
              description:
                'Optional hint to help the server resolve the recording when you paste a URL.',
              required: false,
            });
            break;
          case 'update_comment':
            fields['comment_id'] = Property.Number({
              displayName: 'Comment ID',
              required: true,
            });
            fields['content'] = Property.LongText({
              displayName: 'Content (optional)',
              required: false,
            });
            fields['body'] = Property.Json({
              displayName: 'Body (JSON, optional)',
              description: 'Advanced: official Basecamp fields to update.',
              required: false,
            });
            break;
          case 'create_attachment':
            fields['name'] = Property.ShortText({
              displayName: 'File name',
              required: true,
            });
            fields['content_type'] = Property.ShortText({
              displayName: 'Content type',
              description: 'Example: image/png',
              required: true,
            });
            fields['content_base64'] = Property.LongText({
              displayName: 'File content (base64)',
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
    const project = context.propsValue.project
      ? String(context.propsValue.project)
      : null;
    const inputs = (context.propsValue.inputs ?? {}) as Record<string, unknown>;

    switch (op) {
      case 'create_attachment':
        return await callGatewayTool({
          auth,
          toolName: 'create_attachment',
          args: {
            name: inputs['name'],
            content_type: inputs['content_type'],
            content_base64: inputs['content_base64'],
          },
        });
      case 'list_comments': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'list_comments',
          args: { project, recording_id: inputs['recording'] },
        });
      }
      case 'get_comment': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'get_comment',
          args: { project, comment_id: inputs['comment_id'] },
        });
      }
      case 'create_comment': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'create_comment',
          args: {
            project,
            recording_id: inputs['recording'],
            content: inputs['content'],
            recording_query: inputs['recording_query'] || undefined,
          },
        });
      }
      case 'update_comment': {
        if (!project) {
          throw new Error('Project is required');
        }
        return await callGatewayTool({
          auth,
          toolName: 'update_comment',
          args: {
            project,
            comment_id: inputs['comment_id'],
            content: inputs['content'] || undefined,
            body: inputs['body'] || undefined,
          },
        });
      }
      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  },
});
