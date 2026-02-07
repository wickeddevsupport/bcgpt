import { Property, createAction } from '@activepieces/pieces-framework';
import { bcgptPost, type BcgptAuthConnection } from '../common/client';

export const selectAccount = createAction({
  name: 'select_account',
  displayName: 'Select Basecamp Account',
  description: 'Choose which Basecamp account to use for subsequent requests.',
  requireAuth: true,
  props: {
    account_id: Property.ShortText({
      displayName: 'Account ID',
      required: true,
    }),
  },
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
      path: '/select_account',
      body: {
        account_id: context.propsValue.account_id,
      },
      auth,
    });
  },
});
