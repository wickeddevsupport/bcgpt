import { useEmbedding } from '@/components/embed-provider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar-shadcn';

import { ProjectDashboardSidebar } from '../sidebar/dashboard';

export function BuilderLayout({ children }: { children: React.ReactNode }) {
  const { embedState } = useEmbedding();

  return (
    <SidebarProvider hoverMode={true} defaultOpen={false}>
      {!embedState.isEmbedded && <ProjectDashboardSidebar />}
      <SidebarInset>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
