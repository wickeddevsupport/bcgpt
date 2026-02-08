import { t } from 'i18next';
import { AlertTriangle, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApSidebarToggle } from '@/components/custom/ap-sidebar-toggle';
import { InputWithIcon } from '@/components/custom/input-with-icon';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { flowHooks } from '@/features/flows/lib/flow-hooks';
import { piecesHooks } from '@/features/pieces/lib/pieces-hooks';
import { templatesHooks } from '@/features/templates/hooks/templates-hook';
import { templatesTelemetryApi } from '@/features/templates/lib/templates-telemetry-api';
import { platformHooks } from '@/hooks/platform-hooks';
import {
  Template,
  TemplateTelemetryEventType,
  TemplateType,
  UncategorizedFolderId,
} from '@activepieces/shared';

import { AllCategoriesView } from './all-categories-view';
import { CategoryFilterCarousel } from './category-filter-carousel';
import { EmptyTemplatesView } from './empty-templates-view';
import { SelectedCategoryView } from './selected-category-view';

const TemplatesPage = () => {
  const navigate = useNavigate();
  const { platform } = platformHooks.useCurrentPlatform();

  const canManageTemplates = platform.plan.manageTemplatesEnabled;
  const [selectedTemplateType, setSelectedTemplateType] = useState<TemplateType>(
    TemplateType.OFFICIAL,
  );
  const isShowingOfficialTemplates =
    selectedTemplateType === TemplateType.OFFICIAL;

  useEffect(() => {
    // Safety: if templates management is disabled, don't allow the UI to get
    // stuck on a type that the backend will never return.
    if (!canManageTemplates && selectedTemplateType !== TemplateType.OFFICIAL) {
      setSelectedTemplateType(TemplateType.OFFICIAL);
    }
  }, [canManageTemplates, selectedTemplateType]);

  const templateCategoriesQuery =
    templatesHooks.useTemplateCategories(isShowingOfficialTemplates);
  const templateCategories = templateCategoriesQuery.data;
  const {
    templates,
    isLoading,
    isError: isTemplatesError,
    error: templatesError,
    refetch: refetchTemplates,
    search,
    setSearch,
    category,
    setCategory,
  } = templatesHooks.useTemplates(selectedTemplateType);
  const selectedCategory = category as string;
  const {
    data: allOfficialTemplates,
    isLoading: isAllTemplatesLoading,
    isError: isAllTemplatesError,
    error: allTemplatesError,
    refetch: refetchAllTemplates,
  } = templatesHooks.useAllOfficialTemplates(isShowingOfficialTemplates);
  const { mutate: createFlow, isPending: isCreateFlowPending } =
    flowHooks.useStartFromScratch(UncategorizedFolderId);

  const { pieces: availablePieces } = piecesHooks.usePieces({
    includeHidden: false,
    includeTags: false,
  });
  const pieceLogoByName = useMemo(() => {
    const map: Record<string, { displayName?: string; logoUrl?: string }> = {};
    for (const p of availablePieces ?? []) {
      map[p.name] = { displayName: p.displayName, logoUrl: p.logoUrl };
    }
    return map;
  }, [availablePieces]);

  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMessage, setLoadMessage] = useState(t('Loading templates…'));

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
  };

  const handleTemplateSelect = (template: Template) => {
    navigate(`/templates/${template.id}`);
    if (template.type === TemplateType.OFFICIAL) {
      templatesTelemetryApi.sendEvent({
        eventType: TemplateTelemetryEventType.VIEW,
        templateId: template.id,
      });
    }
  };

  const templatesByCategory = useMemo(() => {
    const grouped: Record<string, Template[]> = {} as Record<
      string,
      Template[]
    >;

    const templatesForGrouping =
      isShowingOfficialTemplates && search.trim().length === 0
        ? (allOfficialTemplates ?? templates ?? [])
        : [];

    if (isShowingOfficialTemplates) {
      templatesForGrouping.forEach((template: Template) => {
        if (template.categories?.length) {
          template.categories?.forEach((category: string) => {
            if (!grouped[category]) {
              grouped[category] = [];
            }
            grouped[category].push(template);
          });
        }
      });
    }

    return grouped;
  }, [allOfficialTemplates, isShowingOfficialTemplates, search, templates]);

  const categoriesForFilter = useMemo(() => {
    return ['All', ...(templateCategories || [])];
  }, [templateCategories]);

  const showLoading =
    isLoading ||
    (isShowingOfficialTemplates &&
      (templateCategoriesQuery.isLoading || isAllTemplatesLoading));
  const hasCategories = (templateCategories?.length ?? 0) > 0;
  const showAllCategories =
    isShowingOfficialTemplates &&
    selectedCategory === 'All' &&
    search.trim().length === 0 &&
    hasCategories &&
    !isAllTemplatesError;
  const hasTemplates = (templates?.length ?? 0) > 0;
  const showCategoryTitleForOfficialTemplates =
    isShowingOfficialTemplates && selectedCategory !== 'All';

  const hasAnyLoadError =
    isTemplatesError ||
    (isShowingOfficialTemplates &&
      (templateCategoriesQuery.isError || isAllTemplatesError));

  useEffect(() => {
    if (!showLoading) {
      setLoadProgress(0);
      setLoadMessage(t('Loading templates…'));
      return;
    }

    const start = Date.now();
    setLoadProgress(8);
    setLoadMessage(t('Loading templates…'));

    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      setLoadProgress((prev) => {
        const target = 95;
        const next = prev + (target - prev) * 0.07;
        return Math.min(target, Math.max(0, next));
      });

      if (elapsed > 25_000) {
        setLoadMessage(
          t(
            "This is taking longer than expected. You can wait, refresh the page, or click Retry if it doesn't load.",
          ),
        );
      } else if (elapsed > 10_000) {
        setLoadMessage(
          t('Still loading. The first load can take a bit while we fetch everything.'),
        );
      }
    }, 250);

    return () => clearInterval(interval);
  }, [showLoading]);

  return (
    <div>
      <div>
        <div className="sticky top-0 z-10 bg-background mb-6 pt-4">
          <div className="flex flex-row w-full justify-between gap-2">
            <ApSidebarToggle />
            <InputWithIcon
              icon={<Search className="text-gray-500 w-4 h-4" />}
              type="text"
              value={search}
              onChange={handleSearchChange}
              className="bg-sidebar-accent w-[50%]"
              placeholder={t('Search templates by name or description')}
            />
            <div className="flex flex-row justify-end w-[50%]">
              <Button
                variant="outline"
                className="gap-2 h-full"
                onClick={() => createFlow()}
                disabled={isCreateFlowPending}
              >
                <Plus className="w-4 h-4" />
                {t('Start from scratch')}
              </Button>
            </div>
          </div>

          {canManageTemplates && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <Tabs
                value={selectedTemplateType}
                onValueChange={(value) => {
                  const nextType = value as TemplateType;
                  setSelectedTemplateType(nextType);
                  if (nextType === TemplateType.CUSTOM) {
                    // Custom templates don't use categories in the current UI.
                    setCategory('All');
                  }
                }}
              >
                <TabsList variant="outline">
                  <TabsTrigger variant="outline" value={TemplateType.OFFICIAL}>
                    {t('Official')}
                  </TabsTrigger>
                  <TabsTrigger variant="outline" value={TemplateType.CUSTOM}>
                    {t('Custom')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}

          {isShowingOfficialTemplates && categoriesForFilter.length > 1 && (
            <CategoryFilterCarousel
              categories={categoriesForFilter}
              selectedCategory={selectedCategory}
              onCategorySelect={setCategory}
            />
          )}
        </div>

        {showLoading && !hasAnyLoadError && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>{loadMessage}</span>
              <span className="tabular-nums">{Math.round(loadProgress)}%</span>
            </div>
            <Progress value={loadProgress} />
          </div>
        )}

        {hasAnyLoadError && (
          <Alert variant="warning" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <div>
              <AlertTitle>{t("We couldn't load templates")}</AlertTitle>
              <AlertDescription>
                {t(
                  'Please check your connection and try again. If this keeps happening, refresh the page.',
                )}
                <div className="mt-3 flex flex-row gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      refetchTemplates();
                      if (isShowingOfficialTemplates) {
                        templateCategoriesQuery.refetch();
                        refetchAllTemplates();
                      }
                    }}
                  >
                    {t('Retry')}
                  </Button>
                </div>
              </AlertDescription>
            </div>
          </Alert>
        )}

        {!hasTemplates && !showLoading && !hasAnyLoadError ? (
          <EmptyTemplatesView />
        ) : showAllCategories ? (
          <AllCategoriesView
            templatesByCategory={templatesByCategory}
            categories={templateCategories || []}
            onCategorySelect={setCategory}
            onTemplateSelect={handleTemplateSelect}
            pieceLogoByName={pieceLogoByName}
            isLoading={showLoading}
            hideHeader={!isShowingOfficialTemplates}
          />
        ) : (
          <SelectedCategoryView
            category={selectedCategory}
            templates={templates || []}
            onTemplateSelect={handleTemplateSelect}
            pieceLogoByName={pieceLogoByName}
            isLoading={showLoading}
            showCategoryTitle={showCategoryTitleForOfficialTemplates}
          />
        )}
      </div>
    </div>
  );
};

export { TemplatesPage };
