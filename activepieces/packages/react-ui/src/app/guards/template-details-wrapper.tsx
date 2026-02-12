import { Navigate, useParams, useLocation } from 'react-router-dom';

import { PageTitle } from '@/app/components/page-title';
import { ProjectDashboardLayout } from '@/app/components/project-layout';
import { TemplateDetailsPage } from '@/app/routes/templates/id';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { ShareTemplate } from '@/features/templates/components/share-template';
import { templatesHooks } from '@/features/templates/hooks/templates-hook';
import { api } from '@/lib/api';
import { authenticationSession } from '@/lib/authentication-session';
import { FROM_QUERY_PARAM } from '@/lib/navigation-utils';
import { ErrorCode, TemplateType, isNil } from '@activepieces/shared';

const TemplateDetailsWrapper = () => {
  const { templateId } = useParams<{ templateId: string }>();
  const location = useLocation();
  const {
    data: template,
    isLoading,
    isError,
    error,
    refetch,
  } = templatesHooks.useTemplate(templateId!);
  const templatesBasePath = location.pathname.startsWith('/my-templates')
    ? '/my-templates'
    : '/templates';

  if (isLoading) {
    return (
      <LoadingScreen
        title="Loading template…"
        onRetry={() => refetch()}
        retryLabel="Try again"
      />
    );
  }

  if (isError) {
    const isNotFound = api.isApError(error, ErrorCode.ENTITY_NOT_FOUND);
    return (
      <div className="flex h-screen w-screen items-center justify-center px-6">
        <Alert variant="warning" className="max-w-lg w-full">
          <div>
            <AlertTitle>
              {isNotFound ? "We couldn't find that template" : "We couldn't load this template"}
            </AlertTitle>
            <AlertDescription>
              {isNotFound
                ? 'It may have been removed or is temporarily unavailable.'
                : 'Please check your connection and try again.'}
              <div className="mt-3 flex flex-row gap-2">
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Try again
                </Button>
                <Button size="sm" onClick={() => (window.location.href = templatesBasePath)}>
                  Back to templates
                </Button>
              </div>
            </AlertDescription>
          </div>
        </Alert>
      </div>
    );
  }

  if (!template) {
    return <Navigate to={templatesBasePath} replace />;
  }

  const token = authenticationSession.getToken();
  const isNotAuthenticated = isNil(token);
  const useProjectLayout = template.type !== TemplateType.SHARED;

  if (isNotAuthenticated && useProjectLayout) {
    return (
      <Navigate
        to={`/sign-in?${FROM_QUERY_PARAM}=${location.pathname}${location.search}`}
        replace
      />
    );
  }

  const content = (
    <PageTitle title={template.name}>
      <TemplateDetailsPage template={template} />
    </PageTitle>
  );

  if (useProjectLayout) {
    return <ProjectDashboardLayout>{content}</ProjectDashboardLayout>;
  }

  return <ShareTemplate template={template} />;
};

export { TemplateDetailsWrapper };
