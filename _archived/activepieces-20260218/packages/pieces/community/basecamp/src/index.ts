import { createPiece, PieceAuth } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { adminAction } from './lib/actions/admin';
import { cardsAction } from './lib/actions/cards';
import { commentsAction } from './lib/actions/comments';
import { DEFAULT_BCGPT_BASE_URL, gatewayPost } from './lib/common/client';
import { documentsAction } from './lib/actions/documents';
import { filesAction } from './lib/actions/files';
import { messagesAction } from './lib/actions/messages';
import { peopleAction } from './lib/actions/people';
import { projectsAction } from './lib/actions/projects';
import { reportsAction } from './lib/actions/reports';
import { scheduleAction } from './lib/actions/schedule';
import { todosAction } from './lib/actions/todos';
import { newTodoTrigger } from './lib/triggers/new-todo';

export const basecampAuth = PieceAuth.CustomAuth({
  displayName: 'Basecamp Connection',
  required: true,
  props: {
    api_key: PieceAuth.SecretText({
      displayName: 'API Key',
      description:
        'Get this key from https://bcgpt.wickedlab.io/connect. The gateway URL is fixed automatically.',
      required: true,
    }),
  },
  validate: async ({ auth }) => {
    const apiKey = String(auth.api_key ?? '').trim();
    if (!apiKey) {
      return {
        valid: false,
        error: 'API key is required.',
      };
    }

    try {
      const payload = await gatewayPost({
        baseUrl: DEFAULT_BCGPT_BASE_URL,
        path: '/action/startbcgpt',
        body: {},
        auth: {
          props: {
            api_key: apiKey,
          },
        } as never,
      });

      const result =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : null;
      if (!result || result.connected !== true) {
        return {
          valid: false,
          error:
            typeof result?.message === 'string' && result.message.trim()
              ? result.message
              : 'BCGPT did not recognize this API key.',
        };
      }
      if (result.basecamp_connected !== true) {
        return {
          valid: false,
          error:
            'Basecamp is not linked for this key. Open https://bcgpt.wickedlab.io/connect and finish Basecamp authorization.',
        };
      }

      return {
        valid: true,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Failed to validate Basecamp connection.',
      };
    }
  },
});

export const basecamp = createPiece({
  displayName: 'Basecamp',
  description: 'Basecamp actions via BCGPT gateway',
  auth: basecampAuth,
  minimumSupportedRelease: '0.77.0',
  logoUrl: '/branding/basecamp.svg?v=20260306',
  categories: [PieceCategory.PRODUCTIVITY],
  actions: [
    projectsAction,
    todosAction,
    cardsAction,
    messagesAction,
    commentsAction,
    scheduleAction,
    documentsAction,
    filesAction,
    peopleAction,
    reportsAction,
    adminAction,
  ],
  triggers: [newTodoTrigger],
  authors: ['wickeddevsupport'],
});
