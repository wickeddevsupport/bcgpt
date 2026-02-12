import { t } from 'i18next';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { ProjectSettingsDialog } from '@/app/components/project-settings';
import { ApSidebarToggle } from '@/components/custom/ap-sidebar-toggle';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { platformHooks } from '@/hooks/platform-hooks';
import { projectCollectionUtils } from '@/hooks/project-collection';
import { userHooks } from '@/hooks/user-hooks';
import { Permission, PlatformRole, ProjectType } from '@activepieces/shared';

type TabId =
  | 'general'
  | 'members'
  | 'alerts'
  | 'pieces'
  | 'environment'
  | 'mcp';

export function ProjectSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { project } = projectCollectionUtils.useCurrentProject();
  const { platform } = platformHooks.useCurrentPlatform();
  const { checkAccess } = useAuthorization();
  const { data: user } = userHooks.useCurrentUser();

  const hash = location.hash.slice(1).toLowerCase();
  const validTabs: TabId[] = [
    'general',
    'members',
    'alerts',
    'pieces',
    'environment',
    'mcp',
  ];

  const hasGeneralSettings =
    project.type === ProjectType.TEAM ||
    (platform.plan.embeddingEnabled &&
      user?.platformRole === PlatformRole.ADMIN);

  const getDefaultTab = (): TabId => {
    if (validTabs.includes(hash as TabId)) return hash as TabId;
    if (hasGeneralSettings) return 'general';
    if (
      project.type === ProjectType.TEAM &&
      checkAccess(Permission.READ_PROJECT_MEMBER)
    )
      return 'members';
    return 'pieces';
  };

  const [dialogOpen, setDialogOpen] = useState(true);

  const handleClose = () => {
    setDialogOpen(false);
    navigate(-1);
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <ApSidebarToggle />
        <Settings className="size-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{t('Project Settings')}</h1>
      </div>
      <ProjectSettingsDialog
        open={dialogOpen}
        onClose={handleClose}
        initialTab={getDefaultTab()}
        initialValues={{
          projectName: project?.displayName,
        }}
      />
    </div>
  );
}
