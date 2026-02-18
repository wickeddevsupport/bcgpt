import { createPiece, PieceAuth, Property } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { adminAction } from './lib/actions/admin';
import { cardsAction } from './lib/actions/cards';
import { commentsAction } from './lib/actions/comments';
import { documentsAction } from './lib/actions/documents';
import { filesAction } from './lib/actions/files';
import { messagesAction } from './lib/actions/messages';
import { peopleAction } from './lib/actions/people';
import { projectsAction } from './lib/actions/projects';
import { reportsAction } from './lib/actions/reports';
import { scheduleAction } from './lib/actions/schedule';
import { todosAction } from './lib/actions/todos';
import { newTodoTrigger } from './lib/triggers/new-todo';

const markdown = `
Connect via your BCGPT gateway and paste your API key here.

**To get your API key:**
1. Go to [bcgpt.wickedlab.io/connect](https://bcgpt.wickedlab.io/connect)
2. Sign in with your Basecamp account
3. Copy the API key provided
4. Paste it below
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
