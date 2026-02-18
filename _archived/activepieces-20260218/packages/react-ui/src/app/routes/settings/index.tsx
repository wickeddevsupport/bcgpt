import { useQuery } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  AppWindow,
  Camera,
  ExternalLink,
  Link2,
  Mail,
  Puzzle,
  Settings,
  User,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { DashboardPageHeader } from '@/app/components/dashboard-page-header';
import { ProjectSettingsDialog } from '@/app/components/project-settings';
import { ApSidebarToggle } from '@/components/custom/ap-sidebar-toggle';
import { UserBadges } from '@/components/custom/user-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/user-avatar';
import { appConnectionsApi } from '@/features/connections/lib/api/app-connections';
import { appsApi } from '@/features/apps/lib/apps-api';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { platformHooks } from '@/hooks/platform-hooks';
import { projectCollectionUtils } from '@/hooks/project-collection';
import { userHooks } from '@/hooks/user-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { userApi } from '@/lib/user-api';
import {
  AP_MAXIMUM_PROFILE_PICTURE_SIZE,
  AppConnectionStatus,
  Permission,
  PlatformRole,
  PROFILE_PICTURE_ALLOWED_TYPES,
  ProjectType,
  UserWithBadges,
} from '@activepieces/shared';

import ThemeToggle from '@/app/components/account-settings/theme-toggle';
import LanguageToggle from '@/app/components/account-settings/language-toggle';

export function ProjectSettingsPage() {
  const { project } = projectCollectionUtils.useCurrentProject();
  const { platform } = platformHooks.useCurrentPlatform();
  const { checkAccess } = useAuthorization();
  const { data: user } = userHooks.useCurrentUser();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);

  /* ── data queries ── */

  const connectionsQuery = useQuery({
    queryKey: ['workspace-settings-connections', project.id],
    queryFn: () =>
      appConnectionsApi.list({ limit: 100, cursor: undefined, projectId: project.id }),
    staleTime: 30_000,
  });

  const appsQuery = useQuery({
    queryKey: ['workspace-settings-apps'],
    queryFn: () => appsApi.listPublisherApps(''),
    staleTime: 30_000,
  });

  /* ── avatar upload ── */

  const uploadMutation = useMutation({
    mutationFn: (file: File) => userApi.updateMe(file),
    onSuccess: () => {
      userHooks.invalidateCurrentUser(queryClient);
      toast.success(t('Profile picture updated'));
    },
    onError: (err: Error) => {
      toast.error(err.message || t('Failed to upload'));
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > AP_MAXIMUM_PROFILE_PICTURE_SIZE) {
        toast.error(t('File size exceeds 5MB limit'));
        return;
      }
      if (!PROFILE_PICTURE_ALLOWED_TYPES.includes(file.type)) {
        toast.error(t('Invalid file type. Allowed: JPEG, PNG, GIF, WEBP'));
        return;
      }
      uploadMutation.mutate(file);
    }
    event.target.value = '';
  };

  /* ── derived state ── */

  const connections = connectionsQuery.data?.data ?? [];
  const apps = appsQuery.data?.data ?? [];

  const activeConnections = connections.filter(
    (c) => c.status === AppConnectionStatus.ACTIVE,
  ).length;
  const errorConnections = connections.filter(
    (c) => c.status === AppConnectionStatus.ERROR,
  ).length;

  const hasGeneralSettings =
    project.type === ProjectType.TEAM ||
    (platform.plan.embeddingEnabled &&
      user?.platformRole === PlatformRole.ADMIN);

  const connectionsPath = authenticationSession.appendProjectRoutePrefix('/connections');
  const appsPath = authenticationSession.appendProjectRoutePrefix('/apps');
  const publisherPath = authenticationSession.appendProjectRoutePrefix('/apps/publisher');

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('Workspace Settings')}
        description={t('Manage your account, apps, and project settings in one place.')}
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setProjectSettingsOpen(true)}>
            <Settings className="mr-2 size-4" />
            {t('Project Settings')}
          </Button>
        </div>
      </DashboardPageHeader>

      <div className="flex items-center gap-3">
        <ApSidebarToggle />
      </div>

      {/* ── Account ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4" />
            {t('Account')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div
              className="relative group cursor-pointer shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <UserAvatar
                name={(user?.firstName ?? '') + ' ' + (user?.lastName ?? '')}
                email={user?.email ?? ''}
                size={56}
                disableTooltip
                imageUrl={user?.imageUrl}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="size-4 text-white" />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploadMutation.isPending}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Mail className="size-3" />
                {user?.email}
              </div>
              <div className="mt-1.5">
                <UserBadges user={user as UserWithBadges | null} />
              </div>
            </div>

            <div className="flex gap-2 sm:gap-3">
              <ThemeToggle />
              <LanguageToggle />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Stats Overview ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* My Apps card */}
        <Card
          className="cursor-pointer transition-colors hover:border-primary/50"
          onClick={() => (window.location.href = publisherPath)}
        >
          <CardContent className="flex items-center gap-4 pt-5 pb-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <AppWindow className="size-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">{t('My Apps')}</div>
              {appsQuery.isLoading ? (
                <Skeleton className="h-6 w-12 mt-0.5" />
              ) : (
                <div className="text-xl font-bold">{apps.length}</div>
              )}
            </div>
            <ExternalLink className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>

        {/* Connections card */}
        <Card
          className="cursor-pointer transition-colors hover:border-primary/50"
          onClick={() => (window.location.href = connectionsPath)}
        >
          <CardContent className="flex items-center gap-4 pt-5 pb-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Link2 className="size-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">{t('Connections')}</div>
              {connectionsQuery.isLoading ? (
                <Skeleton className="h-6 w-12 mt-0.5" />
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold">{connections.length}</span>
                  {activeConnections > 0 && (
                    <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200">
                      {activeConnections} {t('active')}
                    </Badge>
                  )}
                  {errorConnections > 0 && (
                    <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
                      {errorConnections} {t('error')}
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <ExternalLink className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>

        {/* Project card */}
        <Card
          className="cursor-pointer transition-colors hover:border-primary/50"
          onClick={() => setProjectSettingsOpen(true)}
        >
          <CardContent className="flex items-center gap-4 pt-5 pb-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10">
              <Puzzle className="size-5 text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">{t('Project')}</div>
              <div className="text-base font-semibold truncate">{project.displayName}</div>
            </div>
            <Settings className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>

      {/* ── My Apps (recent) ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <AppWindow className="size-4" />
                {t('My Published Apps')}
              </CardTitle>
              <CardDescription className="mt-1">
                {t('Apps you\'ve published to the gallery')}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => (window.location.href = publisherPath)}>
              {t('Publisher')}
              <ExternalLink className="ml-1.5 size-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {appsQuery.isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          )}
          {!appsQuery.isLoading && apps.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center">
              <AppWindow className="mx-auto size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                {t('No apps published yet.')}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => (window.location.href = publisherPath)}
              >
                {t('Go to Publisher')}
              </Button>
            </div>
          )}
          {!appsQuery.isLoading && apps.length > 0 && (
            <div className="space-y-2">
              {apps.slice(0, 8).map((app) => (
                <div
                  key={app.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="text-lg">
                    {app.galleryMetadata?.icon || '📦'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {app.name || app.description || t('Untitled')}
                    </div>
                    {app.galleryMetadata?.category && (
                      <span className="text-[10px] text-muted-foreground">
                        {app.galleryMetadata.category}
                      </span>
                    )}
                  </div>
                  {app.galleryMetadata?.runCount !== undefined && (
                    <Badge variant="outline" className="text-[10px]">
                      {app.galleryMetadata.runCount} {t('runs')}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      window.open(
                        authenticationSession.appendProjectRoutePrefix('/apps'),
                        '_blank',
                      )
                    }
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </div>
              ))}
              {apps.length > 8 && (
                <p className="text-center text-xs text-muted-foreground pt-1">
                  {`and ${apps.length - 8} more...`}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recent Connections ── */}
      {checkAccess(Permission.READ_APP_CONNECTION) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="size-4" />
                  {t('Connections')}
                </CardTitle>
                <CardDescription className="mt-1">
                  {t('Your active integrations and API connections')}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => (window.location.href = connectionsPath)}>
                {t('Manage All')}
                <ExternalLink className="ml-1.5 size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {connectionsQuery.isLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-md" />
                ))}
              </div>
            )}
            {!connectionsQuery.isLoading && connections.length === 0 && (
              <div className="rounded-md border border-dashed p-6 text-center">
                <Link2 className="mx-auto size-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t('No connections yet.')}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => (window.location.href = connectionsPath)}
                >
                  {t('Add Connection')}
                </Button>
              </div>
            )}
            {!connectionsQuery.isLoading && connections.length > 0 && (
              <div className="space-y-1.5">
                {connections.slice(0, 10).map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {conn.displayName}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {conn.pieceName}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        conn.status === AppConnectionStatus.ACTIVE
                          ? 'text-[10px] text-emerald-600 border-emerald-200'
                          : 'text-[10px] text-destructive border-destructive/30'
                      }
                    >
                      {conn.status === AppConnectionStatus.ACTIVE
                        ? t('Active')
                        : t('Error')}
                    </Badge>
                  </div>
                ))}
                {connections.length > 10 && (
                  <p className="text-center text-xs text-muted-foreground pt-1">
                    {`and ${connections.length - 10} more...`}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Project Settings Dialog ── */}
      <ProjectSettingsDialog
        open={projectSettingsOpen}
        onClose={() => setProjectSettingsOpen(false)}
        initialTab={hasGeneralSettings ? 'general' : 'pieces'}
        initialValues={{
          projectName: project?.displayName,
        }}
      />
    </div>
  );
}
