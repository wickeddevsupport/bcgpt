import { useVirtualizer } from '@tanstack/react-virtual';
import { t } from 'i18next';
import {
  Search,
  Plus,
  LineChart,
  Trophy,
  Compass,
  LayoutGrid,
  MousePointerClick,
} from 'lucide-react';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDebounce } from 'use-debounce';

import { NewProjectDialog } from '@/app/routes/platform/projects/new-project-dialog';
import { useEmbedding } from '@/components/embed-provider';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarSeparator,
  useSidebar,
  SidebarGroupLabel,
  SidebarMenuItem,
} from '@/components/ui/sidebar-shadcn';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { templatesTelemetryApi } from '@/features/templates/lib/templates-telemetry-api';
import { platformHooks } from '@/hooks/platform-hooks';
import { projectCollectionUtils } from '@/hooks/project-collection';
import { userHooks } from '@/hooks/user-hooks';
import { cn } from '@/lib/utils';
import {
  isNil,
  PlatformRole,
  ProjectType,
  ProjectWithLimits,
  TeamProjectsLimit,
  TemplateTelemetryEventType,
} from '@activepieces/shared';

import { SidebarGeneralItemType } from '../ap-sidebar-group';
import { ApSidebarItem, SidebarItemType } from '../ap-sidebar-item';
import ProjectSideBarItem from '../project';
import { AppSidebarHeader } from '../sidebar-header';
import SidebarUsageLimits from '../sidebar-usage-limits';
import { SidebarUser } from '../sidebar-user';

export function ProjectDashboardSidebar() {
  const { data: projects } = projectCollectionUtils.useAll();
  const { embedState } = useEmbedding();
  const { state } = useSidebar();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const projectsScrollRef = useRef<HTMLDivElement>(null);
  const { data: currentUser } = userHooks.useCurrentUser();
  const { platform } = platformHooks.useCurrentPlatform();

  const projectsForSidebar = useMemo(() => {
    if (currentUser?.platformRole === PlatformRole.ADMIN) {
      return projects.filter((project) => project.ownerId === currentUser.id);
    }
    return projects;
  }, [projects, currentUser?.id, currentUser?.platformRole]);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery('');
    }
  }, [searchOpen]);

  const shouldShowNewProjectButton = useMemo(() => {
    if (platform.plan.teamProjectsLimit === TeamProjectsLimit.NONE) {
      return false;
    }
    return currentUser?.platformRole === PlatformRole.ADMIN;
  }, [platform.plan.teamProjectsLimit]);

  const shouldShowSearchButton = useMemo(() => {
    if (platform.plan.teamProjectsLimit === TeamProjectsLimit.NONE) {
      return false;
    }
    return true;
  }, [platform.plan.teamProjectsLimit]);

  const shouldDisableNewProjectButton = useMemo(() => {
    if (platform.plan.teamProjectsLimit === TeamProjectsLimit.ONE) {
      const teamProjects = projectsForSidebar.filter(
        (project) => project.type === ProjectType.TEAM,
      );
      return teamProjects.length >= 1;
    }
    return false;
  }, [platform.plan.teamProjectsLimit, projectsForSidebar]);

  const isSearchMode = debouncedSearchQuery.length > 0;

  const displayProjects = useMemo(() => {
    if (isSearchMode) {
      const query = debouncedSearchQuery.toLowerCase();
      return projectsForSidebar.filter((project) =>
        project.displayName.toLowerCase().includes(query),
      );
    }
    return projectsForSidebar;
  }, [isSearchMode, debouncedSearchQuery, projectsForSidebar]);

  const handleProjectSelect = useCallback(
    async (projectId: string) => {
      projectCollectionUtils.setCurrentProject(projectId);
      navigate(`/projects/${projectId}/flows`);
      setSearchOpen(false);
    },
    [navigate],
  );

  // Virtual scrolling setup
  const ITEM_HEIGHT = state === 'collapsed' ? 40 : 44;

  const rowVirtualizer = useVirtualizer({
    count: displayProjects.length,
    getScrollElement: () => projectsScrollRef.current,
    estimateSize: useCallback(() => ITEM_HEIGHT, [ITEM_HEIGHT]),
    overscan: 10,
    getItemKey: useCallback(
      (index: number) => displayProjects[index]?.id ?? index,
      [displayProjects],
    ),
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const renderProjectItem = useCallback(
    (project: ProjectWithLimits) => {
      return (
        <ProjectSideBarItem
          key={project.id}
          project={project}
          isCurrentProject={location.pathname.includes(
            `/projects/${project.id}`,
          )}
          handleProjectSelect={handleProjectSelect}
        />
      );
    },
    [location.pathname, handleProjectSelect],
  );

  const permissionFilter = (link: SidebarGeneralItemType) => {
    if (link.type === 'link') {
      return isNil(link.hasPermission) || link.hasPermission;
    }
    return true;
  };

  const handleTemplatesClick = useCallback(() => {
    templatesTelemetryApi.sendEvent({
      eventType: TemplateTelemetryEventType.EXPLORE_VIEW,
      userId: currentUser?.id,
    });
  }, []);

  const templatesLink: SidebarItemType = {
    type: 'link',
    to: '/templates',
    label: t('Templates'),
    show: true,
    icon: Compass,
    hasPermission: true,
    isSubItem: false,
    onClick: handleTemplatesClick,
  };

  const impactLink: SidebarItemType = {
    type: 'link',
    to: '/impact',
    label: t('Impact'),
    icon: LineChart,
    show: true,
    hasPermission: true,
    isSubItem: false,
  };

  const leaderboardLink: SidebarItemType = {
    type: 'link',
    to: '/leaderboard',
    label: t('Leaderboard'),
    icon: Trophy,
    show: true,
    hasPermission: true,
    isSubItem: false,
  };

  const appsLink: SidebarItemType = {
    type: 'link',
    to: '/apps',
    label: t('Apps'),
    icon: LayoutGrid,
    show: true,
    hasPermission: true,
    isSubItem: false,
    forceReload: true,
  };

  const publisherLink: SidebarItemType = {
    type: 'link',
    to: '/apps/publisher',
    label: t('Publisher'),
    icon: MousePointerClick,
    show: true,
    hasPermission: true,
    isSubItem: false,
    forceReload: true,
  };

  const items = [
    appsLink,
    publisherLink,
    templatesLink,
    impactLink,
    leaderboardLink,
  ].filter(permissionFilter);

  return (
    !embedState.hideSideNav && (
      <Sidebar collapsible="icon">
        <AppSidebarHeader />

        <SidebarContent className="overflow-x-hidden">
          <SidebarGroup>
            <SidebarMenu>
              {items.map((item) => (
                <ApSidebarItem key={item.label} {...item} />
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup className="flex-1">
            <div className="flex items-center justify-between group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel>{t('Projects')}</SidebarGroupLabel>
              <div className="flex items-center justify-center gap-2">
                {shouldShowNewProjectButton && (
                  <>
                    {!shouldDisableNewProjectButton ? (
                      <NewProjectDialog
                        onCreate={(project) => {
                          navigate(`/projects/${project.id}/flows`);
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-accent"
                        >
                          <Plus />
                        </Button>
                      </NewProjectDialog>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled
                              className="h-6 w-6"
                            >
                              <Plus />
                            </Button>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[250px]">
                          <p className="text-xs mb-1">
                            {t(
                              'Upgrade your plan to create additional team projects.',
                            )}{' '}
                            <button
                              className="text-xs text-primary underline hover:no-underline"
                              onClick={() =>
                                window.open(
                                  'https://wickedlab.io/pricing',
                                  '_blank',
                                )
                              }
                            >
                              {t('View Plans')}
                            </button>
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </>
                )}
                {shouldShowSearchButton && (
                  <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 hover:bg-accent"
                      >
                        <Search />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[280px] p-3"
                      align="start"
                      side="right"
                      sideOffset={8}
                    >
                      <SearchInput
                        placeholder={t('Search projects...')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e)}
                        className="h-9"
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
            <div
              ref={projectsScrollRef}
              className={cn(
                'flex-1 overflow-y-auto',
                state === 'collapsed'
                  ? 'flex flex-col items-center scrollbar-none'
                  : 'scrollbar-hover',
              )}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              {displayProjects.length > 0 ? (
                <SidebarMenu
                  className={cn('flex flex-col items-start w-full')}
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    position: 'relative',
                  }}
                >
                  {virtualItems.map((virtualItem) => {
                    const project = displayProjects[virtualItem.index];
                    return (
                      <SidebarMenuItem
                        key={virtualItem.key}
                        data-virtual-index={virtualItem.index}
                        className="w-full"
                      >
                        {renderProjectItem(project)}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              ) : (
                isSearchMode && (
                  <div className="px-2 py-2 text-sm text-muted-foreground">
                    {state === 'expanded' && t('No projects found.')}
                  </div>
                )
              )}
            </div>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {state === 'expanded' && <DelayedSidebarUsageLimits />}
          <SidebarUser />
        </SidebarFooter>
      </Sidebar>
    )
  );
}

function DelayedSidebarUsageLimits() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(timer);
  }, []);

  return show ? (
    <div>
      <SidebarUsageLimits />
    </div>
  ) : null;
}
