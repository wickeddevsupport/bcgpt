import { api } from '@/lib/api';
import { AuthenticationResponse } from '@activepieces/shared';
import { ManagedAuthnRequestBody } from '@activepieces/shared';

export const managedAuthApi = {
  generateApToken: async (request: ManagedAuthnRequestBody) => {
    return api.post<AuthenticationResponse>(
      `/v1/managed-authn/external-token`,
      request,
    );
  },
};
