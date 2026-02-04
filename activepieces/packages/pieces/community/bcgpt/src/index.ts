import { createPiece, PieceAuth, Property } from '@activepieces/pieces-framework';
import { PieceCategory } from '@activepieces/shared';
import { callTool } from './lib/actions/call-tool';
import { listTools } from './lib/actions/list-tools';
import { startSession } from './lib/actions/start-session';

const markdown = `
Create a session using the Start Session action, then open the reauth URL to connect Basecamp.
Paste the session key here after you connect.
`;

export const bcgptAuth = PieceAuth.CustomAuth({
  description: markdown,
  required: false,
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

export const bcgpt = createPiece({
  displayName: 'BCGPT',
  description: 'Basecamp GPT MCP server actions and tools',
  auth: bcgptAuth,
  minimumSupportedRelease: '0.77.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/new-core/mcp.svg',
  categories: [PieceCategory.PRODUCTIVITY, PieceCategory.ARTIFICIAL_INTELLIGENCE],
  actions: [startSession, listTools, callTool],
  triggers: [],
  authors: ['wickeddevsupport'],
});
