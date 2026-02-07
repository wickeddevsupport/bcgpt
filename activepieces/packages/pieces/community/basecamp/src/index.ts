import { createPiece, PieceAuth, Property } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { listProjects } from './lib/actions/list-projects';
import { listTodosForProject } from './lib/actions/list-todos-for-project';
import { createTodo } from './lib/actions/create-todo';
import { listMessages } from './lib/actions/list-messages';
import { createMessage } from './lib/actions/create-message';
import { newTodoTrigger } from './lib/triggers/new-todo';

const markdown = `
Connect via your BCGPT gateway and paste your API key here.
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
    api_key: PieceAuth.SecretText({
      displayName: 'API Key',
      required: true,
    }),
  },
});

export const basecamp = createPiece({
  displayName: 'Basecamp',
  description: 'Basecamp actions via BCGPT gateway',
  auth: basecampAuth,
  minimumSupportedRelease: '0.77.0',
  logoUrl: '/branding/basecamp.svg',
  categories: [PieceCategory.PRODUCTIVITY],
  actions: [listProjects, listTodosForProject, createTodo, listMessages, createMessage],
  triggers: [newTodoTrigger],
  authors: ['wickeddevsupport'],
});
