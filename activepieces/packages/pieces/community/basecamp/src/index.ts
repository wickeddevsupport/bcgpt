import { createPiece, PieceAuth, Property } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { listProjects } from './lib/actions/list-projects';
import { listTodosForProject } from './lib/actions/list-todos-for-project';
import { createTodo } from './lib/actions/create-todo';
import { listMessages } from './lib/actions/list-messages';
import { createMessage } from './lib/actions/create-message';

const markdown = `
Connect via your BCGPT gateway.
Create a session using the BCGPT piece, connect Basecamp, then paste the session key here.
`;

export const basecampAuth = PieceAuth.CustomAuth({
  description: markdown,
  required: true,
  props: {
    base_url: Property.ShortText({
      displayName: 'BCGPT Base URL',
      required: true,
      defaultValue: 'https://bcgpt.wickedlab.io',
    }),
    session_key: PieceAuth.SecretText({
      displayName: 'Session Key',
      required: false,
    }),
    user_key: Property.ShortText({
      displayName: 'User Key (optional)',
      required: false,
    }),
  },
});

export const basecamp = createPiece({
  displayName: 'Basecamp',
  description: 'Basecamp actions via BCGPT gateway',
  auth: basecampAuth,
  minimumSupportedRelease: '0.77.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/basecamp.png',
  categories: [PieceCategory.PRODUCTIVITY],
  actions: [listProjects, listTodosForProject, createTodo, listMessages, createMessage],
  triggers: [],
  authors: ['wickeddevsupport'],
});
