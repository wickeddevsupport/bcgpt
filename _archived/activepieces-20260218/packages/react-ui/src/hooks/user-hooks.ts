import { QueryClient, useQuery, useSuspenseQuery } from '@tanstack/react-query';

import { authenticationSession } from '@/lib/authentication-session';
import { userApi } from '@/lib/user-api';
import { isNil, UserWithBadges } from '@activepieces/shared';

export const userHooks = {
  useCurrentUser: () => {
    const token = authenticationSession.getToken();
    const expired = token
      ? authenticationSession.isJwtExpired(token)
      : true;
    return useSuspenseQuery<UserWithBadges | null, Error>({
      queryKey: ['currentUser', token],
      queryFn: async () => {
        // Skip user data fetch if JWT is expired to prevent redirect to sign-in page
        // This is especially important for embedding scenarios where we need to accept
        // a new JWT token rather than triggering the global error handler

        if (!token || expired) {
          return null;
        }
        try {
          const result = await userApi.getMe();
          return result;
        } catch (error) {
          console.error(error);
          return null;
        }
      },
      staleTime: 0,
      refetchOnMount: true,
    });
  },
  useUserById: (id: string | null) => {
    return useQuery({
      queryKey: ['user', id],
      queryFn: async () => {
        try {
          return await userApi.getUserById(id!);
        } catch (error) {
          console.error(error);
          return null;
        }
      },
      enabled: !isNil(id),
      staleTime: Infinity,
    });
  },
  invalidateCurrentUser: (queryClient: QueryClient) => {
    queryClient.invalidateQueries({ queryKey: ['currentUser'] });
  },
  getCurrentUserPlatformRole: () => {
    const { data: user } = userHooks.useCurrentUser();
    return user?.platformRole;
  },
};
