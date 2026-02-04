import { HttpMethod, httpClient } from '@activepieces/pieces-common';
import { Property, createAction } from '@activepieces/pieces-framework';
import { normalizeBaseUrl } from '../common/client';

export const startSession = createAction({
  name: 'start_session',
  displayName: 'Start Session',
  description: 'Create or resume a BCGPT session and get the Basecamp auth link.',
  requireAuth: false,
  props: {
    base_url: Property.ShortText({
      displayName: 'BCGPT Base URL',
      required: true,
      defaultValue: 'https://bcgpt.wickedlab.io',
    }),
    session_key: Property.ShortText({
      displayName: 'Session Key (optional)',
      description: 'Provide an existing session key to resume it.',
      required: false,
    }),
  },
  async run(context) {
    const baseUrl = normalizeBaseUrl(context.propsValue.base_url);
    const body: Record<string, unknown> = {};
    if (context.propsValue.session_key) {
      body.session_key = context.propsValue.session_key;
    }
    const response = await httpClient.sendRequest({
      method: HttpMethod.POST,
      url: `${baseUrl}/action/startbcgpt`,
      headers: { 'content-type': 'application/json' },
      body,
    });
    return response.body;
  },
});
