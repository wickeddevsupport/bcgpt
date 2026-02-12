import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { ArrowUpRight, Play, Search } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { appsApi, AppInputField, AppTemplate } from '@/features/apps/lib/apps-api';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';

type AppFormState = Record<string, string | number | boolean | null>;

function getAppFields(app: AppTemplate): AppInputField[] {
  return app.galleryMetadata?.inputSchema?.fields ?? [];
}

function getDefaultValueByField(field: AppInputField) {
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return null;
  return '';
}

function normalizeFieldLabel(field: AppInputField) {
  return field.label?.trim().length ? field.label : field.name;
}

const AppsPage = () => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [selectedApp, setSelectedApp] = useState<AppTemplate | null>(null);
  const [runMode, setRunMode] = useState<'sync' | 'async'>('sync');
  const [formState, setFormState] = useState<AppFormState>({});
  const [runOutput, setRunOutput] = useState<unknown>(null);
  const [runMeta, setRunMeta] = useState<string>('');
  const [runError, setRunError] = useState<string>('');
  const queryClient = useQueryClient();

  const appsQuery = useQuery({
    queryKey: ['apps-gallery', search, category],
    queryFn: () =>
      appsApi.listPublicApps({
        search: search.trim() || undefined,
        category: category === 'ALL' ? undefined : category,
        limit: 200,
      }),
  });

  const runMutation = useMutation({
    mutationFn: async ({
      appId,
      payload,
      mode,
    }: {
      appId: string;
      payload: { inputs: Record<string, unknown> };
      mode: 'sync' | 'async';
    }) => {
      return appsApi.executeApp(appId, payload, mode);
    },
    onSuccess: (result) => {
      setRunOutput(result.output ?? result.message ?? null);
      if (result.queued) {
        setRunMeta(t('Run queued in background.'));
      } else {
        const time = result.executionTime ? `${result.executionTime}ms` : '-';
        setRunMeta(`${t('Execution time')}: ${time}`);
      }
      setRunError('');
      queryClient.invalidateQueries({ queryKey: ['apps-gallery'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      setRunError(message);
      setRunMeta('');
      setRunOutput(null);
    },
  });

  const apps = appsQuery.data?.data ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    apps.forEach((app) => {
      const appCategory = app.galleryMetadata?.category;
      if (appCategory) {
        set.add(appCategory);
      }
    });
    return ['ALL', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [apps]);

  const openRunner = (app: AppTemplate) => {
    const next: AppFormState = {};
    getAppFields(app).forEach((field) => {
      next[field.name] = getDefaultValueByField(field);
    });
    setFormState(next);
    setRunOutput(null);
    setRunMeta('');
    setRunError('');
    setRunMode('sync');
    setSelectedApp(app);
  };

  const submitRun = () => {
    if (!selectedApp) {
      return;
    }
    const inputs: Record<string, unknown> = {};
    getAppFields(selectedApp).forEach((field) => {
      const value = formState[field.name];
      if (value !== undefined) {
        inputs[field.name] = value;
      }
    });
    runMutation.mutate({
      appId: selectedApp.id,
      payload: { inputs },
      mode: runMode,
    });
  };

  const renderField = (field: AppInputField) => {
    const label = normalizeFieldLabel(field);
    const value = formState[field.name];
    const isRequired = Boolean(field.required);

    if (field.type === 'boolean') {
      return (
        <div key={field.name} className="flex items-center justify-between rounded-md border p-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{label}</span>
            {field.placeholder && (
              <span className="text-xs text-muted-foreground">
                {field.placeholder}
              </span>
            )}
          </div>
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) =>
              setFormState((prev) => ({ ...prev, [field.name]: checked }))
            }
          />
        </div>
      );
    }

    if (field.type === 'select' && field.options?.length) {
      const selectedValue =
        typeof value === 'string' && value.length
          ? value
          : field.options[0].value;
      return (
        <div key={field.name} className="space-y-2">
          <label className="text-sm font-medium">
            {label}
            {isRequired && <span className="text-destructive ml-1">*</span>}
          </label>
          <Select
            value={selectedValue}
            onValueChange={(next) =>
              setFormState((prev) => ({ ...prev, [field.name]: next }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    if (field.type === 'textarea') {
      return (
        <div key={field.name} className="space-y-2">
          <label className="text-sm font-medium">
            {label}
            {isRequired && <span className="text-destructive ml-1">*</span>}
          </label>
          <Textarea
            placeholder={field.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                [field.name]: event.target.value,
              }))
            }
          />
        </div>
      );
    }

    return (
      <div key={field.name} className="space-y-2">
        <label className="text-sm font-medium">
          {label}
          {isRequired && <span className="text-destructive ml-1">*</span>}
        </label>
        <Input
          type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'}
          placeholder={field.placeholder}
          value={
            typeof value === 'number'
              ? String(value)
              : typeof value === 'string'
                ? value
                : ''
          }
          onChange={(event) => {
            const raw = event.target.value;
            setFormState((prev) => ({
              ...prev,
              [field.name]:
                field.type === 'number'
                  ? raw.trim() === ''
                    ? null
                    : Number(raw)
                  : raw,
            }));
          }}
        />
      </div>
    );
  };

  const publisherPath = authenticationSession.appendProjectRoutePrefix(
    '/apps/publisher',
  );

  return (
    <div className="space-y-4">
      <DashboardPageHeader
        title={t('Apps')}
        description={t('Run and manage published workflow apps in your dashboard.')}
      >
        <Button variant="outline" onClick={() => (window.location.href = publisherPath)}>
          {t('Open Publisher')}
        </Button>
      </DashboardPageHeader>

      <div className="flex items-center gap-3">
        <ApSidebarToggle />
        <InputWithIcon
          icon={<Search className="size-4 text-muted-foreground" />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('Search apps')}
          className="max-w-md bg-sidebar-accent"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((item) => (
              <SelectItem key={item} value={item}>
                {item === 'ALL' ? t('All categories') : item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {appsQuery.isLoading && (
        <div className="text-sm text-muted-foreground">{t('Loading apps...')}</div>
      )}
      {appsQuery.isError && (
        <div className="text-sm text-destructive">
          {appsQuery.error instanceof Error
            ? appsQuery.error.message
            : t('Failed to load apps')}
        </div>
      )}

      {!appsQuery.isLoading && !apps.length && (
        <Card>
          <CardHeader>
            <CardTitle>{t('No apps found')}</CardTitle>
            <CardDescription>
              {t('Publish templates from Publisher to make apps available here.')}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!!apps.length && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {apps.map((app) => {
            const metadata = app.galleryMetadata ?? {};
            const runCount = metadata.runCount ?? 0;
            const successRate =
              runCount > 0 && typeof metadata.successCount === 'number'
                ? Math.round((metadata.successCount / runCount) * 100)
                : null;

            return (
              <Card key={app.id} className="flex flex-col">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{app.name}</CardTitle>
                      <CardDescription>
                        {metadata.description || app.summary || app.description}
                      </CardDescription>
                    </div>
                    <Badge variant={metadata.featured ? 'default' : 'outline'}>
                      {metadata.featured ? t('Featured') : metadata.category ?? t('General')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{t('Runs')}</span>
                    <span className="font-medium text-foreground">{runCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{t('Success rate')}</span>
                    <span className="font-medium text-foreground">
                      {successRate === null ? '-' : `${successRate}%`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(metadata.tags ?? []).slice(0, 4).map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
                <CardFooter className="mt-auto flex items-center gap-2">
                  <Button className="w-full" onClick={() => openRunner(app)}>
                    <Play className="mr-1 size-4" />
                    {t('Run app')}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => window.open(`/apps/${app.id}`, '_blank')}
                    title={t('Open public runtime')}
                  >
                    <ArrowUpRight className="size-4" />
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(selectedApp)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedApp(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedApp?.name ?? t('Run app')}</DialogTitle>
            <DialogDescription>
              {selectedApp?.galleryMetadata?.description ??
                selectedApp?.summary ??
                ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {selectedApp && getAppFields(selectedApp).length === 0 && (
              <div className="text-sm text-muted-foreground">
                {t('This app does not require any inputs.')}
              </div>
            )}
            {selectedApp && getAppFields(selectedApp).map(renderField)}

            <div className="space-y-2 pt-2">
              <label className="text-sm font-medium">{t('Execution mode')}</label>
              <Select value={runMode} onValueChange={(value) => setRunMode(value as 'sync' | 'async')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sync">{t('Sync (wait for response)')}</SelectItem>
                  <SelectItem value="async">{t('Async (queue run)')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(runMeta || runError || runOutput !== null) && (
              <div className="rounded-md border p-3 space-y-2">
                {runMeta && <div className="text-xs text-muted-foreground">{runMeta}</div>}
                {runError && <div className="text-sm text-destructive">{runError}</div>}
                {runOutput !== null && (
                  <pre
                    className={cn(
                      'max-h-[240px] overflow-auto rounded bg-muted p-3 text-xs',
                    )}
                  >
                    {typeof runOutput === 'string'
                      ? runOutput
                      : JSON.stringify(runOutput, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedApp(null)}>
              {t('Close')}
            </Button>
            <Button onClick={submitRun} disabled={runMutation.isPending}>
              {runMutation.isPending ? t('Running...') : t('Run app')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export { AppsPage };
