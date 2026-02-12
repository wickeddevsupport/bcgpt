import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Eye,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DashboardPageHeader } from '@/app/components/dashboard-page-header';
import { ApSidebarToggle } from '@/components/custom/ap-sidebar-toggle';
import { InputWithIcon } from '@/components/custom/input-with-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  appsApi,
  AppInputField,
  AppTemplate,
} from '@/features/apps/lib/apps-api';
import { userHooks } from '@/hooks/user-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { PlatformRole } from '@activepieces/shared';

type DraftField = {
  id: string;
  name: string;
  label: string;
  type: AppInputField['type'];
  required: boolean;
  placeholder: string;
  optionsText: string;
};

type Audience = 'internal' | 'external';
type AuthMode = 'workspace_connection' | 'user_secret' | 'user_oauth' | 'none';
type RunnerMode = 'workspace_only' | 'public_page';
type PublishStatus = 'draft' | 'ready' | 'published';
type WizardStepKey = 'template' | 'audience' | 'setup' | 'inputs' | 'review';

type WizardStep = {
  key: WizardStepKey;
  title: string;
  description: string;
};

const WIZARD_STEPS: WizardStep[] = [
  {
    key: 'template',
    title: t('Select template'),
    description: t('Choose what to publish'),
  },
  {
    key: 'audience',
    title: t('Audience'),
    description: t('Define who can run it'),
  },
  {
    key: 'setup',
    title: t('Connection setup'),
    description: t('Set auth and requirements'),
  },
  {
    key: 'inputs',
    title: t('Input form'),
    description: t('Design user inputs'),
  },
  {
    key: 'review',
    title: t('Review & publish'),
    description: t('Validate and ship'),
  },
];

type PublisherDraft = {
  templateId: string;
  flowId: string;
  description: string;
  icon: string;
  category: string;
  tagsText: string;
  featured: boolean;
  displayOrderText: string;
  outputType: string;
  fields: DraftField[];
  audience: Audience;
  authMode: AuthMode;
  runnerMode: RunnerMode;
  publishStatus: PublishStatus;
  requirementsText: string;
  credentialHint: string;
};

function createField(seed?: Partial<DraftField>): DraftField {
  return {
    id: crypto.randomUUID(),
    name: seed?.name ?? '',
    label: seed?.label ?? '',
    type: seed?.type ?? 'text',
    required: seed?.required ?? false,
    placeholder: seed?.placeholder ?? '',
    optionsText: seed?.optionsText ?? '',
  };
}

function createInitialDraft(): PublisherDraft {
  return {
    templateId: '',
    flowId: '',
    description: '',
    icon: '',
    category: '',
    tagsText: '',
    featured: false,
    displayOrderText: '',
    outputType: '',
    fields: [],
    audience: 'internal',
    authMode: 'workspace_connection',
    runnerMode: 'workspace_only',
    publishStatus: 'draft',
    requirementsText: '',
    credentialHint: '',
  };
}

function normalizeFields(fields: DraftField[]): AppInputField[] {
  return fields
    .map((field) => {
      const name = field.name.trim();
      if (!name) {
        return null;
      }
      const options = field.optionsText
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((value) => ({ label: value, value }));

      const normalized: AppInputField = {
        name,
        label: field.label.trim() || name,
        type: field.type ?? 'text',
        required: field.required,
        placeholder: field.placeholder.trim() || undefined,
      };

      if (normalized.type === 'select' && options.length > 0) {
        normalized.options = options;
      }

      return normalized;
    })
    .filter((field): field is AppInputField => Boolean(field));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function parseList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPublisherMetadata(draft: PublisherDraft): Record<string, unknown> {
  return {
    audience: draft.audience,
    authMode: draft.authMode,
    runnerMode: draft.runnerMode,
    publishStatus: draft.publishStatus,
    requirements: parseList(draft.requirementsText),
    credentialHint: draft.credentialHint.trim() || undefined,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}

function toDraft(app: AppTemplate): PublisherDraft {
  const metadata = app.galleryMetadata ?? {};
  const sourceFields = metadata.inputSchema?.fields ?? [];
  const outputSchema = asRecord(metadata.outputSchema);
  const publisherMetadata = asRecord(outputSchema?.publisher);
  const requirements = asStringArray(publisherMetadata?.requirements);

  return {
    templateId: app.id,
    flowId: metadata.flowId ?? '',
    description: metadata.description ?? '',
    icon: metadata.icon ?? '',
    category: metadata.category ?? '',
    tagsText: (metadata.tags ?? []).join(', '),
    featured: Boolean(metadata.featured),
    displayOrderText:
      typeof metadata.displayOrder === 'number'
        ? String(metadata.displayOrder)
        : '',
    outputType: metadata.outputType ?? '',
    fields: sourceFields.map((field) =>
      createField({
        name: field.name ?? '',
        label: field.label ?? '',
        type: field.type ?? 'text',
        required: Boolean(field.required),
        placeholder: field.placeholder ?? '',
        optionsText: (field.options ?? []).map((item) => item.value).join('|'),
      }),
    ),
    audience:
      publisherMetadata?.audience === 'external' ? 'external' : 'internal',
    authMode:
      publisherMetadata?.authMode === 'user_secret' ||
      publisherMetadata?.authMode === 'user_oauth' ||
      publisherMetadata?.authMode === 'none'
        ? (publisherMetadata.authMode as AuthMode)
        : 'workspace_connection',
    runnerMode:
      publisherMetadata?.runnerMode === 'public_page'
        ? 'public_page'
        : 'workspace_only',
    publishStatus:
      publisherMetadata?.publishStatus === 'ready' ||
      publisherMetadata?.publishStatus === 'published'
        ? (publisherMetadata.publishStatus as PublishStatus)
        : 'draft',
    requirementsText: requirements.join('\n'),
    credentialHint:
      typeof publisherMetadata?.credentialHint === 'string'
        ? publisherMetadata.credentialHint
        : '',
  };
}

const ALLOWED_OUTPUT_TYPES = ['', 'json', 'text', 'image', 'markdown', 'html'] as const;

function validateDraft(draft: PublisherDraft): string[] {
  const errors: string[] = [];
  const templateId = draft.templateId.trim();
  if (!templateId.length) {
    errors.push(t('Select a template before publishing.'));
  }

  if (draft.outputType && !ALLOWED_OUTPUT_TYPES.includes(draft.outputType as (typeof ALLOWED_OUTPUT_TYPES)[number])) {
    errors.push(t('Output type must be one of: json, text, image, markdown, html.'));
  }

  if (draft.audience === 'external' && draft.runnerMode !== 'public_page') {
    errors.push(t('External audience apps must use Public Page runner mode.'));
  }

  if (draft.audience === 'internal' && draft.runnerMode !== 'workspace_only') {
    errors.push(t('Internal audience apps must use Workspace Only runner mode.'));
  }

  if (draft.authMode !== 'none' && parseList(draft.requirementsText).length === 0) {
    errors.push(
      t('Add at least one setup requirement when authentication is needed.'),
    );
  }

  const seenFieldNames = new Set<string>();
  for (const field of draft.fields) {
    const name = field.name.trim();
    if (!name.length) {
      errors.push(t('Every input field needs a field name.'));
      continue;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      errors.push(
        t('Input field "{{name}}" must use only letters, numbers, and underscores.', {
          name,
        }),
      );
    }
    if (seenFieldNames.has(name)) {
      errors.push(t('Input field "{{name}}" is duplicated.', { name }));
    }
    seenFieldNames.add(name);
    if (field.type === 'select' && field.optionsText.trim().length === 0) {
      errors.push(
        t('Select field "{{name}}" needs at least one option.', { name }),
      );
    }
  }

  return Array.from(new Set(errors)).slice(0, 6);
}

function validateStep(step: WizardStepKey, draft: PublisherDraft): string[] {
  switch (step) {
    case 'template':
      return draft.templateId.trim() ? [] : [t('Select a template first.')];
    case 'audience':
      if (draft.audience === 'external' && draft.runnerMode !== 'public_page') {
        return [t('External apps should use Public Page runner mode.')];
      }
      if (draft.audience === 'internal' && draft.runnerMode !== 'workspace_only') {
        return [t('Internal apps should use Workspace Only runner mode.')];
      }
      return [];
    case 'setup':
      if (draft.authMode !== 'none' && parseList(draft.requirementsText).length === 0) {
        return [t('Add at least one setup requirement for this auth mode.')];
      }
      return [];
    case 'inputs':
      return validateDraft(draft).filter(
        (error) =>
          error.includes('field') ||
          error.includes('Output type') ||
          error.includes('Every input'),
      );
    case 'review':
      return validateDraft(draft);
    default:
      return [];
  }
}

function stepIndex(step: WizardStepKey): number {
  return WIZARD_STEPS.findIndex((item) => item.key === step);
}

const AppsPublisherPage = () => {
  const [templateSearch, setTemplateSearch] = useState('');
  const [publishedSearch, setPublishedSearch] = useState('');
  const [draft, setDraft] = useState<PublisherDraft>(createInitialDraft);
  const [currentStep, setCurrentStep] = useState<WizardStepKey>('template');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [selectedPublishedApp, setSelectedPublishedApp] =
    useState<AppTemplate | null>(null);
  const queryClient = useQueryClient();
  const { data: currentUser } = userHooks.useCurrentUser();

  const templatesQuery = useQuery({
    queryKey: ['apps-publisher-templates', templateSearch],
    queryFn: () => appsApi.listPublisherTemplates(templateSearch.trim() || undefined),
  });

  const publishedQuery = useQuery({
    queryKey: ['apps-publisher-published', publishedSearch],
    queryFn: () => appsApi.listPublisherApps(publishedSearch.trim() || undefined),
  });

  const publishMutation = useMutation({
    mutationFn: () => {
      const fields = normalizeFields(draft.fields);
      return appsApi.publish({
        templateId: draft.templateId.trim(),
        flowId: draft.flowId.trim() || undefined,
        description: draft.description.trim() || undefined,
        icon: draft.icon.trim() || undefined,
        category: draft.category.trim() || undefined,
        tags: parseTags(draft.tagsText),
        featured: draft.featured,
        displayOrder:
          draft.displayOrderText.trim().length > 0
            ? Number(draft.displayOrderText)
            : undefined,
        outputType: draft.outputType.trim() || undefined,
        inputSchema: fields.length ? { fields } : undefined,
        outputSchema: {
          publisher: buildPublisherMetadata(draft),
        },
      });
    },
    onSuccess: () => {
      toast.success(t('App published successfully'));
      queryClient.invalidateQueries({ queryKey: ['apps-publisher-published'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      const fields = normalizeFields(draft.fields);
      return appsApi.update(draft.templateId.trim(), {
        flowId: draft.flowId.trim() || undefined,
        description: draft.description.trim() || undefined,
        icon: draft.icon.trim() || undefined,
        category: draft.category.trim() || undefined,
        tags: parseTags(draft.tagsText),
        featured: draft.featured,
        displayOrder:
          draft.displayOrderText.trim().length > 0
            ? Number(draft.displayOrderText)
            : undefined,
        outputType: draft.outputType.trim() || undefined,
        inputSchema: fields.length ? { fields } : undefined,
        outputSchema: {
          publisher: buildPublisherMetadata(draft),
        },
      });
    },
    onSuccess: () => {
      toast.success(t('App updated successfully'));
      queryClient.invalidateQueries({ queryKey: ['apps-publisher-published'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: (templateId: string) => appsApi.unpublish(templateId),
    onSuccess: () => {
      toast.success(t('App unpublished'));
      queryClient.invalidateQueries({ queryKey: ['apps-publisher-published'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  const seedMutation = useMutation({
    mutationFn: (reset: boolean) => appsApi.seedDefaults(reset),
    onSuccess: (result) => {
      toast.success(
        t('Seed complete: {{apps}} apps, {{templates}} templates', {
          apps: result.createdApps,
          templates: result.createdTemplates,
        }),
      );
      queryClient.invalidateQueries({ queryKey: ['apps-publisher-published'] });
      queryClient.invalidateQueries({ queryKey: ['apps-publisher-templates'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  const templates = templatesQuery.data?.data ?? [];
  const publishedApps = publishedQuery.data?.data ?? [];
  const canSeedDefaults = currentUser?.platformRole === PlatformRole.ADMIN;

  const isSubmitting = publishMutation.isPending || updateMutation.isPending;

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === draft.templateId),
    [templates, draft.templateId],
  );

  const templatesPath = authenticationSession.appendProjectRoutePrefix('/my-templates');
  const currentStepMeta =
    WIZARD_STEPS.find((item) => item.key === currentStep) ?? WIZARD_STEPS[0];
  const currentStepNumber = stepIndex(currentStep);
  const readinessErrors = validateDraft(draft);
  const selectedPublishedCanManage =
    selectedPublishedApp?.galleryMetadata?.canManage ?? true;

  const applyTemplate = (template: AppTemplate) => {
    setValidationErrors([]);
    setSelectedPublishedApp(null);
    setDraft((prev) => ({
      ...prev,
      templateId: template.id,
      description: template.summary ?? prev.description,
      category: template.galleryMetadata?.category ?? prev.category,
      tagsText:
        template.galleryMetadata?.tags?.join(', ') ??
        template.tags?.map((tag) => tag.title).join(', ') ??
        prev.tagsText,
    }));
    setCurrentStep('audience');
  };

  const applyPublished = (app: AppTemplate) => {
    setValidationErrors([]);
    setSelectedPublishedApp(app);
    setDraft(toDraft(app));
    setCurrentStep('audience');
  };

  const updateField = (fieldId: string, patch: Partial<DraftField>) => {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((field) =>
        field.id === fieldId ? { ...field, ...patch } : field,
      ),
    }));
  };

  const removeField = (fieldId: string) => {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.filter((field) => field.id !== fieldId),
    }));
  };

  const goToStep = (step: WizardStepKey) => {
    const targetIndex = stepIndex(step);
    if (targetIndex <= currentStepNumber) {
      setCurrentStep(step);
      setValidationErrors([]);
      return;
    }
    const errors = validateStep(currentStep, draft);
    if (errors.length > 0) {
      setValidationErrors(errors);
      toast.error(t('Complete this step before continuing.'));
      return;
    }
    setValidationErrors([]);
    setCurrentStep(step);
  };

  const goBack = () => {
    const previous = WIZARD_STEPS[currentStepNumber - 1];
    if (previous) {
      setValidationErrors([]);
      setCurrentStep(previous.key);
    }
  };

  const goNext = () => {
    const errors = validateStep(currentStep, draft);
    if (errors.length > 0) {
      setValidationErrors(errors);
      toast.error(t('Complete this step before continuing.'));
      return;
    }
    const next = WIZARD_STEPS[currentStepNumber + 1];
    if (next) {
      setValidationErrors([]);
      setCurrentStep(next.key);
    }
  };

  const runFinalValidation = (): boolean => {
    const errors = validateDraft(draft);
    setValidationErrors(errors);
    if (errors.length > 0) {
      setCurrentStep('review');
      toast.error(t('Please resolve validation issues before publishing.'));
      return false;
    }
    return true;
  };

  return (
    <div className="space-y-4">
      <DashboardPageHeader
        title={t('Publisher')}
        description={t('Turn templates into runnable apps with a guided no-code workflow.')}
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => (window.location.href = templatesPath)}
          >
            <Wand2 className="mr-2 size-4" />
            {t('Open Templates')}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              Promise.all([
                templatesQuery.refetch(),
                publishedQuery.refetch(),
              ])
            }
          >
            <RefreshCcw className="mr-2 size-4" />
            {t('Reload')}
          </Button>
          {canSeedDefaults && (
            <Button
              variant="outline"
              onClick={() => seedMutation.mutate(false)}
              disabled={seedMutation.isPending}
            >
              {seedMutation.isPending ? t('Seeding...') : t('Seed defaults')}
            </Button>
          )}
        </div>
      </DashboardPageHeader>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 py-4 md:grid-cols-5">
          {WIZARD_STEPS.map((step, index) => {
            const active = step.key === currentStep;
            const complete = index < currentStepNumber;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => goToStep(step.key)}
                className={`rounded-md border p-3 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary/5'
                    : complete
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-border bg-muted/30'
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                      complete
                        ? 'bg-emerald-600 text-white'
                        : active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {index + 1}
                  </span>
                  {complete && <CheckCircle2 className="size-4 text-emerald-600" />}
                </div>
                <div className="text-sm font-medium">{step.title}</div>
                <div className="text-xs text-muted-foreground">{step.description}</div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <ApSidebarToggle />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('Templates')}</CardTitle>
            <CardDescription>
              {t('Select a template to publish as an app')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <InputWithIcon
              icon={<Search className="size-4 text-muted-foreground" />}
              placeholder={t('Search templates')}
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
            />
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {templatesQuery.isLoading && (
                <div className="text-sm text-muted-foreground">{t('Loading...')}</div>
              )}
              {!templatesQuery.isLoading && !templates.length && (
                <div className="space-y-2 rounded-md border border-dashed p-3">
                  <div className="text-sm text-muted-foreground">
                    {t('No templates found. Create one first, then return here.')}
                  </div>
                  <Button size="sm" onClick={() => (window.location.href = templatesPath)}>
                    {t('Create template')}
                  </Button>
                </div>
              )}
              {templates.map((template) => (
                <Card
                  key={template.id}
                  variant="interactive"
                  isSelected={draft.templateId === template.id}
                  className="p-3"
                  onClick={() => applyTemplate(template)}
                >
                  <CardTitle className="text-sm">{template.name}</CardTitle>
                  <CardDescription>{template.summary}</CardDescription>
                  <CardFooter className="px-0 pt-2 pb-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        window.open(`/templates/${template.id}`, '_blank');
                      }}
                    >
                      {t('Preview template')}
                      <ArrowUpRight className="ml-1 size-3.5" />
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('Published apps')}</CardTitle>
            <CardDescription>
              {t('Edit or unpublish existing apps')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <InputWithIcon
              icon={<Search className="size-4 text-muted-foreground" />}
              placeholder={t('Search published apps')}
              value={publishedSearch}
              onChange={(event) => setPublishedSearch(event.target.value)}
            />
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {publishedQuery.isLoading && (
                <div className="text-sm text-muted-foreground">{t('Loading...')}</div>
              )}
              {!publishedQuery.isLoading && !publishedApps.length && (
                <div className="text-sm text-muted-foreground">
                  {t('No apps published yet')}
                </div>
              )}
              {publishedApps.map((app) => (
                <Card key={app.id} className="p-3">
                  <CardTitle className="text-sm">{app.name}</CardTitle>
                  <CardDescription>
                    {app.galleryMetadata?.description || app.summary}
                  </CardDescription>
                  {!app.galleryMetadata?.canManage && (
                    <Badge variant="outline" className="mt-2">
                      {t('Read only')}
                    </Badge>
                  )}
                  <CardFooter className="px-0 pt-3 pb-0 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => applyPublished(app)}
                      disabled={!app.galleryMetadata?.canManage}
                    >
                      {t('Edit')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`/apps/${app.id}`, '_blank')}
                    >
                      {t('Open')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (window.confirm(t('Unpublish this app?'))) {
                          unpublishMutation.mutate(app.id);
                        }
                      }}
                      disabled={unpublishMutation.isPending || !app.galleryMetadata?.canManage}
                    >
                      {t('Unpublish')}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{currentStepMeta.title}</CardTitle>
            <CardDescription>{currentStepMeta.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            {currentStep === 'template' && (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="text-sm font-medium">{t('Selected template')}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {selectedTemplate?.name ?? t('No template selected yet')}
                  </div>
                  {selectedTemplate?.summary && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {selectedTemplate.summary}
                    </div>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t(
                    'Select a template from the left panel. This template becomes the base for your app.',
                  )}
                </div>
              </div>
            )}

            {currentStep === 'audience' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('Audience')}</label>
                    <Select
                      value={draft.audience}
                      onValueChange={(value) =>
                        setDraft((prev) => ({
                          ...prev,
                          audience: value as Audience,
                          runnerMode:
                            value === 'external' ? 'public_page' : 'workspace_only',
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="internal">
                          {t('Internal (workspace users)')}
                        </SelectItem>
                        <SelectItem value="external">
                          {t('External (public users)')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('Runner mode')}</label>
                    <Select
                      value={draft.runnerMode}
                      onValueChange={(value) =>
                        setDraft((prev) => ({
                          ...prev,
                          runnerMode: value as RunnerMode,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="workspace_only">
                          {t('Workspace only')}
                        </SelectItem>
                        <SelectItem value="public_page">{t('Public page')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('Publish status')}</label>
                    <Select
                      value={draft.publishStatus}
                      onValueChange={(value) =>
                        setDraft((prev) => ({
                          ...prev,
                          publishStatus: value as PublishStatus,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">{t('Draft')}</SelectItem>
                        <SelectItem value="ready">{t('Ready')}</SelectItem>
                        <SelectItem value="published">{t('Published')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('Display order')}</label>
                    <Input
                      value={draft.displayOrderText}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          displayOrderText: event.target.value.replace(/[^\d]/g, ''),
                        }))
                      }
                      placeholder={t('Optional sort priority')}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('Description')}</label>
                  <Textarea
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                    placeholder={t('Describe what this app does')}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('Category')}</label>
                    <Input
                      value={draft.category}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, category: event.target.value }))
                      }
                      placeholder={t('e.g. OPERATIONS')}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('Icon URL')}</label>
                    <Input
                      value={draft.icon}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, icon: event.target.value }))
                      }
                      placeholder={t('https://...')}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={draft.featured}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, featured: Boolean(checked) }))
                    }
                  />
                  <span className="text-sm">{t('Featured app')}</span>
                </div>
              </div>
            )}

            {currentStep === 'setup' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('Authentication mode')}</label>
                  <Select
                    value={draft.authMode}
                    onValueChange={(value) =>
                      setDraft((prev) => ({
                        ...prev,
                        authMode: value as AuthMode,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="workspace_connection">
                        {t('Workspace connection')}
                      </SelectItem>
                      <SelectItem value="user_secret">{t('User API key')}</SelectItem>
                      <SelectItem value="user_oauth">{t('User OAuth')}</SelectItem>
                      <SelectItem value="none">{t('No auth required')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t('Setup requirements (one per line)')}
                  </label>
                  <Textarea
                    value={draft.requirementsText}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        requirementsText: event.target.value,
                      }))
                    }
                    placeholder={t('Connect Basecamp\nAdd API key\nChoose project')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('Credential hint')}</label>
                  <Input
                    value={draft.credentialHint}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        credentialHint: event.target.value,
                      }))
                    }
                    placeholder={t('Shown when user setup is missing')}
                  />
                </div>

                <details className="rounded-md border bg-muted/20 p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t('Advanced settings')}
                  </summary>
                  <div className="mt-3 space-y-2">
                    <label className="text-sm font-medium">{t('Flow override ID (optional)')}</label>
                    <Input
                      value={draft.flowId}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, flowId: event.target.value }))
                      }
                      placeholder={t('Only set if runtime flow should differ')}
                    />
                  </div>
                </details>
              </div>
            )}

            {currentStep === 'inputs' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('Tags')}</label>
                  <Input
                    value={draft.tagsText}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, tagsText: event.target.value }))
                    }
                    placeholder={t('comma, separated, tags')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('Output type')}</label>
                  <Select
                    value={draft.outputType || '__auto__'}
                    onValueChange={(value) =>
                      setDraft((prev) => ({
                        ...prev,
                        outputType: value === '__auto__' ? '' : value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">{t('Auto (infer from output)')}</SelectItem>
                      <SelectItem value="json">json</SelectItem>
                      <SelectItem value="text">text</SelectItem>
                      <SelectItem value="image">image</SelectItem>
                      <SelectItem value="markdown">markdown</SelectItem>
                      <SelectItem value="html">html</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{t('Input schema')}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          fields: [...prev.fields, createField()],
                        }))
                      }
                    >
                      <Plus className="mr-1 size-4" />
                      {t('Add field')}
                    </Button>
                  </div>
                  {!draft.fields.length && (
                    <div className="text-sm text-muted-foreground">
                      {t('No input fields configured')}
                    </div>
                  )}
                  {draft.fields.map((field) => (
                    <div
                      key={field.id}
                      className="grid grid-cols-1 gap-2 rounded-md border p-2 md:grid-cols-2"
                    >
                      <Input
                        placeholder={t('Field name')}
                        value={field.name}
                        onChange={(event) =>
                          updateField(field.id, { name: event.target.value })
                        }
                      />
                      <Input
                        placeholder={t('Label')}
                        value={field.label}
                        onChange={(event) =>
                          updateField(field.id, { label: event.target.value })
                        }
                      />
                      <Select
                        value={field.type ?? 'text'}
                        onValueChange={(value) =>
                          updateField(field.id, {
                            type: value as DraftField['type'],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">text</SelectItem>
                          <SelectItem value="textarea">textarea</SelectItem>
                          <SelectItem value="number">number</SelectItem>
                          <SelectItem value="select">select</SelectItem>
                          <SelectItem value="boolean">boolean</SelectItem>
                          <SelectItem value="password">password</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder={t('Placeholder')}
                        value={field.placeholder}
                        onChange={(event) =>
                          updateField(field.id, { placeholder: event.target.value })
                        }
                      />
                      {field.type === 'select' && (
                        <Input
                          className="md:col-span-2"
                          placeholder={t('Options (separate with |)')}
                          value={field.optionsText}
                          onChange={(event) =>
                            updateField(field.id, { optionsText: event.target.value })
                          }
                        />
                      )}
                      <div className="md:col-span-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={field.required}
                            onCheckedChange={(checked) =>
                              updateField(field.id, { required: Boolean(checked) })
                            }
                          />
                          <span className="text-sm">{t('Required')}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeField(field.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {currentStep === 'review' && (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Eye className="size-4" />
                    {t('Runner preview')}
                  </div>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div>
                      {t('Public URL')}:
                      <span className="ml-1 font-medium text-foreground break-all">
                        {draft.templateId.trim().length
                          ? `${window.location.origin}/apps/${draft.templateId.trim()}`
                          : t('Set template ID to preview URL')}
                      </span>
                    </div>
                    <div>
                      {t('Audience')}:{' '}
                      <span className="font-medium text-foreground">{draft.audience}</span>
                    </div>
                    <div>
                      {t('Auth mode')}:{' '}
                      <span className="font-medium text-foreground">{draft.authMode}</span>
                    </div>
                    <div>
                      {t('Output')}:{' '}
                      <span className="font-medium text-foreground">
                        {draft.outputType || t('Auto')}
                      </span>
                    </div>
                    <div>
                      {t('Input fields')}:{' '}
                      <span className="font-medium text-foreground">
                        {normalizeFields(draft.fields).length}
                      </span>
                    </div>
                  </div>
                </div>

                {readinessErrors.length > 0 ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    <div className="font-medium text-destructive">
                      {t('Fix these issues before publishing')}
                    </div>
                    <ul className="mt-2 list-disc pl-5 text-destructive">
                      {readinessErrors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700">
                    {t('This app is publish-ready.')}
                  </div>
                )}
              </div>
            )}

            {validationErrors.length > 0 && currentStep !== 'review' && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="font-medium text-destructive">
                  {t('Fix these issues before continuing')}
                </div>
                <ul className="mt-2 list-disc pl-5 text-destructive">
                  {validationErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={currentStepNumber === 0 || isSubmitting}
            >
              <ArrowLeft className="mr-2 size-4" />
              {t('Back')}
            </Button>
            {currentStepNumber < WIZARD_STEPS.length - 1 && (
              <Button onClick={goNext} disabled={isSubmitting}>
                {t('Next')}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            )}
            {currentStep === 'review' && (
              <>
            <Button
              onClick={() => {
                if (!runFinalValidation()) {
                  return;
                }
                publishMutation.mutate();
              }}
              disabled={!draft.templateId.trim() || isSubmitting}
            >
              {publishMutation.isPending ? t('Publishing...') : t('Publish')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!runFinalValidation()) {
                  return;
                }
                updateMutation.mutate();
              }}
              disabled={
                !draft.templateId.trim() ||
                isSubmitting ||
                (Boolean(selectedPublishedApp) && !selectedPublishedCanManage)
              }
            >
              {updateMutation.isPending ? t('Updating...') : t('Update')}
            </Button>
              </>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setValidationErrors([]);
                setSelectedPublishedApp(null);
                setCurrentStep('template');
                setDraft(createInitialDraft());
              }}
              disabled={isSubmitting}
            >
              {t('Reset')}
            </Button>
            {draft.templateId.trim().length > 0 && currentStep === 'review' && (
              <Badge variant="outline">{draft.templateId}</Badge>
            )}
            {draft.templateId.trim().length > 0 && currentStep === 'review' && (
              <Button
                variant="outline"
                onClick={() =>
                  window.open(`/apps/${encodeURIComponent(draft.templateId.trim())}`, '_blank')
                }
              >
                {t('Open app runtime')}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};

export { AppsPublisherPage };
