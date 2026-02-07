import { createPiece, PieceAuth, Property } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { callTool } from './lib/actions/call-tool';
import { listTools } from './lib/actions/list-tools';
import { startSession } from './lib/actions/start-session';
import { listAccounts } from './lib/actions/list-accounts';
import { selectAccount } from './lib/actions/select-account';

const markdown = `
Connect your Basecamp account via the BCGPT connect page and paste your API key here.
`;

export const bcgptAuth = PieceAuth.CustomAuth({
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

export const bcgpt = createPiece({
  displayName: 'BCGPT',
  description: 'Basecamp GPT MCP server actions and tools',
  auth: bcgptAuth,
  minimumSupportedRelease: '0.77.0',
  logoUrl: '/branding/bcgpt.svg',
  categories: [PieceCategory.PRODUCTIVITY, PieceCategory.ARTIFICIAL_INTELLIGENCE],
  actions: [startSession, listAccounts, selectAccount, listTools, callTool],
  triggers: [],
  authors: ['wickeddevsupport'],
});
