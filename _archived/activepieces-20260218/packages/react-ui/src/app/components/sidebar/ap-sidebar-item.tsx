import { ComponentType, SVGProps } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Dot } from '@/components/ui/dot';
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar-shadcn';
import { cn } from '@/lib/utils';

export type SidebarItemType = {
  to: string;
  label: string;
  type: 'link';
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  notification?: boolean;
  locked?: boolean;
  newWindow?: boolean;
  forceReload?: boolean;
  isActive?: (pathname: string) => boolean;
  isSubItem?: boolean;
  show?: boolean;
  hasPermission?: boolean;
  onClick?: () => void;
};

export const ApSidebarItem = (item: SidebarItemType) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const isLinkActive =
    location.pathname.startsWith(item.to) || item.isActive?.(location.pathname);
  const isCollapsed = state === 'collapsed';

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className={cn(
          { 'bg-sidebar-accent hover:bg-sidebar-accent!': isLinkActive },
          '',
        )}
        onClick={() => {
          item.onClick?.();
          if (item.newWindow) {
            window.open(item.to, '_blank', 'noopener,noreferrer');
            return;
          }
          if (item.forceReload) {
            window.location.assign(item.to);
            return;
          }
          navigate(item.to);
        }}
      >
        {item.icon && <item.icon className="size-4" />}
        {!isCollapsed && <span className="text-sm">{item.label}</span>}
        {item.notification && (
          <Dot
            variant="destructive"
            className="absolute right-1 top-2 transform -translate-y-1/2 size-2 rounded-full"
          />
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};
