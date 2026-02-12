import { useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  ChevronsUpDown,
  LogOut,
  Moon,
  Sun,
  Shield,
  UserCogIcon,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useEmbedding } from '@/components/embed-provider';
import { useTelemetry } from '@/components/telemetry-provider';
import { useTheme } from '@/components/theme-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar-shadcn';
import { Switch } from '@/components/ui/switch';
import { UserAvatar } from '@/components/ui/user-avatar';
import { InviteUserDialog } from '@/features/members/component/invite-user/invite-user-dialog';
import {
  useIsPlatformAdmin,
  useAuthorization,
} from '@/hooks/authorization-hooks';
import { userHooks } from '@/hooks/user-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';
import { isNil, Permission } from '@activepieces/shared';

import AccountSettingsDialog from '../account-settings';
import { HelpAndFeedback } from '../help-and-feedback';

export function SidebarUser() {
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [inviteUserOpen, setInviteUserOpen] = useState(false);
  const { state } = useSidebar();
  const location = useLocation();
  const { data: user } = userHooks.useCurrentUser();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const { reset } = useTelemetry();
  const { checkAccess } = useAuthorization();
  const canInviteUsers = checkAccess(Permission.WRITE_INVITATION);
  const isInPlatformAdmin = location.pathname.startsWith('/platform');
  const isCollapsed = state === 'collapsed';
  const isDark = theme === 'dark';

  const handleLogout = () => {
    userHooks.invalidateCurrentUser(queryClient);
    authenticationSession.logOut();
    reset();
  };

  const fallbackName = t('Account');
  const displayName = user ? `${user.firstName} ${user.lastName}` : fallbackName;
  const displayEmail = user?.email ?? '';
  const displayAvatarName = user ? `${user.firstName} ${user.lastName}` : fallbackName;
  const displayImageUrl = user?.imageUrl;
  const canShowRichUserMenu = Boolean(user);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu modal>
          <DropdownMenuTrigger className="w-full">
            <SidebarMenuButton className="h-10! pl-1! group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:pl-1!">
              <div className="size-6 shrink-0 overflow-hidden flex items-center justify-center rounded-full">
                <UserAvatar
                  className={cn('size-full object-cover', {
                    'scale-150': isNil(displayImageUrl),
                  })}
                  name={displayAvatarName}
                  email={displayEmail}
                  imageUrl={displayImageUrl}
                  size={24}
                  disableTooltip={true}
                />
              </div>

              {!isCollapsed && (
                <>
                  <span className="truncate">{displayName}</span>
                  <ChevronsUpDown className="ml-auto size-4" />
                </>
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg z-999"
            side="top"
            align="start"
            sideOffset={10}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <div className="size-8 shrink-0 overflow-hidden rounded-full">
                  <UserAvatar
                    className="size-full object-cover"
                    name={displayAvatarName}
                    email={displayEmail}
                    imageUrl={displayImageUrl}
                    size={32}
                    disableTooltip={true}
                  />
                </div>

                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayName}</span>
                  <span className="truncate text-xs">
                    {displayEmail || t('Session detected')}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canShowRichUserMenu ? (
              <>
                {!isInPlatformAdmin && <SidebarPlatformAdminButton />}
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setAccountSettingsOpen(true)}>
                    <UserCogIcon className="w-4 h-4 mr-2" />
                    {t('Account Settings')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(event) => event.preventDefault()}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      {isDark ? (
                        <Moon className="w-4 h-4 text-primary" />
                      ) : (
                        <Sun className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span>{t('Dark Mode')}</span>
                    </div>
                    <Switch
                      checked={isDark}
                      onCheckedChange={(checked) =>
                        setTheme(checked ? 'dark' : 'light')
                      }
                      checkedIcon={<Moon className="w-3 h-3 text-primary" />}
                      uncheckedIcon={
                        <Sun className="w-3 h-3 text-muted-foreground" />
                      }
                      aria-label="Toggle dark mode"
                    />
                  </DropdownMenuItem>
                  {canInviteUsers && (
                    <DropdownMenuItem onClick={() => setInviteUserOpen(true)}>
                      <UserPlus className="w-4 h-4 mr-2" />
                      {t('Invite User')}
                    </DropdownMenuItem>
                  )}
                  <HelpAndFeedback />
                </DropdownMenuGroup>
              </>
            ) : (
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => window.location.reload()}>
                  <UserCogIcon className="w-4 h-4 mr-2" />
                  {t('Refresh Session')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              {t('Log out')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      {canShowRichUserMenu && (
        <AccountSettingsDialog
          open={accountSettingsOpen}
          onClose={() => setAccountSettingsOpen(false)}
        />
      )}
      <InviteUserDialog open={inviteUserOpen} setOpen={setInviteUserOpen} />
    </SidebarMenu>
  );
}

function SidebarPlatformAdminButton() {
  const showPlatformAdminDashboard = useIsPlatformAdmin();
  const { embedState } = useEmbedding();
  const navigate = useNavigate();

  if (embedState.isEmbedded || !showPlatformAdminDashboard) {
    return null;
  }

  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        onClick={() => navigate('/platform/projects')}
        className="w-full flex items-center justify-center relative"
      >
        <div className={`w-full flex items-center gap-2`}>
          <Shield className="size-4" />
          <span className={`text-sm`}>{t('Platform Admin')}</span>
        </div>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}
