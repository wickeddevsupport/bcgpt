import { createAction } from '@activepieces/pieces-framework';
import { bcgptPost, type BcgptAuthConnection } from '../common/client';

export const listAccounts = createAction({
  name: 'list_accounts',
  displayName: 'List Basecamp Accounts',
  description: 'List Basecamp accounts available for the connected user.',
  requireAuth: true,
  props: {},
  async run(context) {
    const auth = context.auth as BcgptAuthConnection | undefined;
    if (!auth?.props?.base_url) {
      throw new Error('Missing BCGPT base URL in connection.');
    }
    if (!auth?.props?.api_key) {
      throw new Error('Missing API key in connection.');
    }

    return await bcgptPost({
      baseUrl: auth.props.base_url,
      path: '/action/startbcgpt',
      auth,
    });
  },
});
