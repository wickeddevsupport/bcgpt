import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { ArrowUpRight, Eye, Plus, RefreshCcw, Search, Trash2, Wand2 } from 'lucide-react';
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
import { authenticationSession } from '@/lib/authentication-session';

type DraftField = {
  id: string;
  name: string;
  label: string;
  type: AppInputField['type'];
  required: boolean;
  placeholder: string;
  optionsText: string;
};

type PublisherDraft = {
  templateId: string;
  flowId: string;
  description: string;
  icon: string;
  category: string;
  tagsText: string;
  featured: boolean;
  outputType: string;
  fields: DraftField[];
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
    outputType: '',
    fields: [],
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

function toDraft(app: AppTemplate): PublisherDraft {
  const metadata = app.galleryMetadata ?? {};
  const sourceFields = metadata.inputSchema?.fields ?? [];
  return {
    templateId: app.id,
    flowId: metadata.flowId ?? '',
    description: metadata.description ?? '',
    icon: metadata.icon ?? '',
    category: metadata.category ?? '',
    tagsText: (metadata.tags ?? []).join(', '),
    featured: Boolean(metadata.featured),
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
  };
}

const ALLOWED_OUTPUT_TYPES = ['', 'json', 'text', 'image', 'markdown', 'html'] as const;

function validateDraft(draft: PublisherDraft): string[] {
  const errors: string[] = [];
  const templateId = draft.templateId.trim();
  if (!templateId.length) {
    errors.push(t('Template ID is required.'));
  }

  if (draft.outputType && !ALLOWED_OUTPUT_TYPES.includes(draft.outputType as (typeof ALLOWED_OUTPUT_TYPES)[number])) {
    errors.push(t('Output type must be one of: json, text, image, markdown, html.'));
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

const AppsPublisherPage = () => {
  const [templateSearch, setTemplateSearch] = useState('');
  const [publishedSearch, setPublishedSearch] = useState('');
  const [draft, setDraft] = useState<PublisherDraft>(createInitialDraft);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const queryClient = useQueryClient();

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
        tags: draft.tagsText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        featured: draft.featured,
        outputType: draft.outputType.trim() || undefined,
        inputSchema: fields.length ? { fields } : undefined,
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
        tags: draft.tagsText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        featured: draft.featured,
        outputType: draft.outputType.trim() || undefined,
        inputSchema: fields.length ? { fields } : undefined,
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

  const isSubmitting = publishMutation.isPending || updateMutation.isPending;

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === draft.templateId),
    [templates, draft.templateId],
  );

  const templatesPath = authenticationSession.appendProjectRoutePrefix('/templates');

  const runValidation = (): boolean => {
    const errors = validateDraft(draft);
    setValidationErrors(errors);
    if (errors.length > 0) {
      toast.error(t('Please resolve validation issues before publishing'));
      return false;
    }
    return true;
  };

  const applyTemplate = (template: AppTemplate) => {
    setValidationErrors([]);
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
  };

  const applyPublished = (app: AppTemplate) => {
    setValidationErrors([]);
    setDraft(toDraft(app));
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
            {t('Create Template')}
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
          <Button
            variant="outline"
            onClick={() => seedMutation.mutate(false)}
            disabled={seedMutation.isPending}
          >
            {seedMutation.isPending ? t('Seeding...') : t('Seed defaults')}
          </Button>
        </div>
      </DashboardPageHeader>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 py-4 md:grid-cols-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              {t('Step 1')}
            </div>
            <div className="mt-1 text-sm font-medium">{t('Select template')}</div>
            <div className="text-xs text-muted-foreground">
              {t('Pick an existing template or create one from Templates.')}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              {t('Step 2')}
            </div>
            <div className="mt-1 text-sm font-medium">{t('Configure app schema')}</div>
            <div className="text-xs text-muted-foreground">
              {t('Define input fields, metadata, and output type.')}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              {t('Step 3')}
            </div>
            <div className="mt-1 text-sm font-medium">{t('Publish and share')}</div>
            <div className="text-xs text-muted-foreground">
              {t('Publish and open your app runtime URL immediately.')}
            </div>
          </div>
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
                <div className="text-sm text-muted-foreground">
                  {t('No templates found')}
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
                  <CardFooter className="px-0 pt-3 pb-0 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => applyPublished(app)}>
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
                      disabled={unpublishMutation.isPending}
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
            <CardTitle>{t('App editor')}</CardTitle>
            <CardDescription>
              {selectedTemplate
                ? t('Publishing template: {{name}}', { name: selectedTemplate.name })
                : t('Configure app metadata and input schema')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Template ID')}</label>
              <Input
                value={draft.templateId}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, templateId: event.target.value }))
                }
                placeholder={t('Template ID')}
              />
            </div>

            {draft.templateId.trim().length > 0 && (
              <div className="rounded-md border bg-muted/20 p-3 text-xs">
                <div className="font-medium">{t('Runtime URL')}</div>
                <div className="mt-1 text-muted-foreground break-all">
                  {`${window.location.origin}/apps/${draft.templateId.trim()}`}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Flow ID')}</label>
              <Input
                value={draft.flowId}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, flowId: event.target.value }))
                }
                placeholder={t('Optional runtime flow ID override')}
              />
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

            <div className="flex items-center gap-2">
              <Checkbox
                checked={draft.featured}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({ ...prev, featured: Boolean(checked) }))
                }
              />
              <span className="text-sm">{t('Featured app')}</span>
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

            {validationErrors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="font-medium text-destructive">
                  {t('Fix these issues before publishing')}
                </div>
                <ul className="mt-2 list-disc pl-5 text-destructive">
                  {validationErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

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
                  {t('Output')}: <span className="font-medium text-foreground">{draft.outputType || t('Auto')}</span>
                </div>
                <div>
                  {t('Input fields')}: <span className="font-medium text-foreground">{normalizeFields(draft.fields).length}</span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (!runValidation()) {
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
                if (!runValidation()) {
                  return;
                }
                updateMutation.mutate();
              }}
              disabled={!draft.templateId.trim() || isSubmitting}
            >
              {updateMutation.isPending ? t('Updating...') : t('Update')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setValidationErrors([]);
                setDraft(createInitialDraft());
              }}
              disabled={isSubmitting}
            >
              {t('Reset')}
            </Button>
            {draft.templateId.trim().length > 0 && (
              <Badge variant="outline">{draft.templateId}</Badge>
            )}
            {draft.templateId.trim().length > 0 && (
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
