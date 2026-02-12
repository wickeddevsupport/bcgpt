import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Link2,
  ArrowUpRight,
  LoaderCircle,
  Play,
  Search,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { DashboardPageHeader } from '@/app/components/dashboard-page-header';
import { ApSidebarToggle } from '@/components/custom/ap-sidebar-toggle';
import { InputWithIcon } from '@/components/custom/input-with-icon';
import { ApMarkdown } from '@/components/custom/markdown';
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
import {
  AppInputField,
  AppTemplate,
  appsApi,
} from '@/features/apps/lib/apps-api';
import { cn } from '@/lib/utils';
import { MarkdownVariant } from '@activepieces/shared';

type AppFormState = Record<string, string | number | boolean | null>;
type SortMode = 'featured' | 'runs' | 'name';
type AppOutputType = 'text' | 'json' | 'image' | 'markdown' | 'html';
type AppAudience = 'internal' | 'external';
type AppAuthMode = 'workspace_connection' | 'user_secret' | 'user_oauth' | 'none';
type AppRunnerMode = 'workspace_only' | 'public_page';
type RunnerStepKey = 'requirements' | 'connect' | 'configure' | 'test' | 'run';

type RunnerStep = {
  key: RunnerStepKey;
  title: string;
  description: string;
};

type AppRunnerContract = {
  audience: AppAudience;
  authMode: AppAuthMode;
  runnerMode: AppRunnerMode;
  requirements: string[];
  credentialHint: string;
  secretsFields: AppInputField[];
};

const RUNNER_STEPS: RunnerStep[] = [
  {
    key: 'requirements',
    title: t('Requirements'),
    description: t('Check prerequisites'),
  },
  {
    key: 'connect',
    title: t('Connect'),
    description: t('Set credentials'),
  },
  {
    key: 'configure',
    title: t('Configure'),
    description: t('Fill required inputs'),
  },
  {
    key: 'test',
    title: t('Test'),
    description: t('Validate output'),
  },
  {
    key: 'run',
    title: t('Run'),
    description: t('Execute app'),
  },
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
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

function getAppFields(app: AppTemplate): AppInputField[] {
  return app.galleryMetadata?.inputSchema?.fields ?? [];
}

function getRunnerContract(app: AppTemplate | null): AppRunnerContract {
  const outputSchema = asRecord(app?.galleryMetadata?.outputSchema);
  const publisherSchema = asRecord(outputSchema?.publisher);
  const secretsSchema = asRecord(publisherSchema?.secretsSchema);
  const secretsFieldsRaw = Array.isArray(secretsSchema?.fields)
    ? secretsSchema?.fields
    : [];
  const secretsFields: AppInputField[] = secretsFieldsRaw
    .map((item) => {
      const field = asRecord(item);
      const name = typeof field?.name === 'string' ? field.name.trim() : '';
      if (!name.length) {
        return null;
      }
      const type = typeof field?.type === 'string' ? field.type : 'password';
      return {
        name,
        label: typeof field?.label === 'string' ? field.label : name,
        type: ['text', 'password', 'select', 'boolean', 'number', 'textarea'].includes(type)
          ? (type as AppInputField['type'])
          : 'password',
        required: field?.required !== false,
        placeholder:
          typeof field?.placeholder === 'string' ? field.placeholder : undefined,
        options: Array.isArray(field?.options)
          ? (field.options as Array<{ label: string; value: string }>)
          : undefined,
      } satisfies AppInputField;
    })
    .filter((item) => item !== null) as AppInputField[];

  const audience = publisherSchema?.audience === 'external' ? 'external' : 'internal';
  const authMode =
    publisherSchema?.authMode === 'user_secret' ||
    publisherSchema?.authMode === 'user_oauth' ||
    publisherSchema?.authMode === 'none'
      ? (publisherSchema.authMode as AppAuthMode)
      : 'workspace_connection';
  const runnerMode =
    publisherSchema?.runnerMode === 'public_page' ? 'public_page' : 'workspace_only';
  const requirements = asStringArray(publisherSchema?.requirements);
  const credentialHint =
    typeof publisherSchema?.credentialHint === 'string'
      ? publisherSchema.credentialHint
      : '';

  return {
    audience,
    authMode,
    runnerMode,
    requirements,
    credentialHint,
    secretsFields,
  };
}

function getDefaultValueByField(field: AppInputField) {
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return null;
  return '';
}

function getSampleValueByField(field: AppInputField): string | number | boolean | null {
  if (field.type === 'boolean') {
    return true;
  }
  if (field.type === 'number') {
    return 1;
  }
  if (field.type === 'select') {
    return field.options?.[0]?.value ?? '';
  }
  if (field.type === 'password') {
    return 'demo-key';
  }
  if (field.type === 'textarea') {
    return field.placeholder?.trim() || t('Sample multi-line input');
  }
  return field.placeholder?.trim() || t('Sample value');
}

function normalizeFieldLabel(field: AppInputField) {
  return field.label?.trim().length ? field.label : field.name;
}

function isFeatured(app: AppTemplate) {
  return Boolean(app.galleryMetadata?.featured);
}

function getRunCount(app: AppTemplate) {
  return Number(app.galleryMetadata?.runCount ?? 0);
}

function getSuccessRate(app: AppTemplate) {
  const runCount = getRunCount(app);
  const successCount = Number(app.galleryMetadata?.successCount ?? 0);
  if (!runCount) return null;
  return Math.max(0, Math.min(100, Math.round((successCount / runCount) * 100)));
}

function extractImageSource(output: unknown): string | null {
  if (typeof output === 'string') {
    return output;
  }
  if (!output || typeof output !== 'object') {
    return null;
  }
  const candidateKeys = ['url', 'imageUrl', 'image_url', 'image', 'src', 'dataUrl', 'data_url'];
  for (const key of candidateKeys) {
    const value = (output as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function resolveOutputType(app: AppTemplate | null, output: unknown): AppOutputType {
  const fromMetadata = String(app?.galleryMetadata?.outputType ?? '').toLowerCase();
  if (fromMetadata === 'text' || fromMetadata === 'json' || fromMetadata === 'image' || fromMetadata === 'markdown' || fromMetadata === 'html') {
    return fromMetadata as AppOutputType;
  }
  if (typeof output === 'string') {
    if (output.startsWith('http') || output.startsWith('data:image/')) {
      return 'image';
    }
    return 'text';
  }
  if (Array.isArray(output) || typeof output === 'object') {
    return 'json';
  }
  return 'text';
}

function formatRuntime(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return `${Math.round(value)}ms`;
}

function validateInputs(app: AppTemplate, formState: AppFormState): string[] {
  const fields = getAppFields(app);
  const errors: string[] = [];
  for (const field of fields) {
    const value = formState[field.name];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0);
    const label = normalizeFieldLabel(field);
    if (field.required && missing) {
      errors.push(t('"{{label}}" is required', { label }));
      continue;
    }
    if (missing) {
      continue;
    }
    if (field.type === 'number' && typeof value !== 'number') {
      errors.push(t('"{{label}}" must be a number', { label }));
    }
    if (field.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(t('"{{label}}" must be true or false', { label }));
    }
    if (field.type === 'select' && field.options?.length) {
      const allowed = new Set(field.options.map((option) => option.value));
      if (typeof value !== 'string' || !allowed.has(value)) {
        errors.push(t('"{{label}}" has an invalid option', { label }));
      }
    }
  }
  return errors.slice(0, 5);
}

const AppsPage = () => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('featured');
  const [selectedApp, setSelectedApp] = useState<AppTemplate | null>(null);
  const [formState, setFormState] = useState<AppFormState>({});
  const [runOutput, setRunOutput] = useState<unknown>(null);
  const [runMeta, setRunMeta] = useState<string>('');
  const [runError, setRunError] = useState<string>('');
  const [currentRuntimeStep, setCurrentRuntimeStep] = useState<RunnerStepKey>('requirements');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [testRunResult, setTestRunResult] = useState<{ passed: boolean; message: string } | null>(null);
  const queryClient = useQueryClient();
  const activeRunController = useRef<AbortController | null>(null);

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
      signal,
    }: {
      appId: string;
      payload: { inputs: Record<string, unknown> };
      signal: AbortSignal;
    }) => {
      return appsApi.executeApp(appId, payload, 'sync', signal);
    },
    onSuccess: (result) => {
      setRunOutput(result.output ?? result.message ?? null);
      setRunMeta(`${t('Execution time')}: ${formatRuntime(result.executionTime ?? null)}`);
      setRunError('');
      queryClient.invalidateQueries({ queryKey: ['apps-gallery'] });
      toast.success(t('App executed successfully'));
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? t('Run cancelled')
            : error.message
          : String(error);
      setRunError(message);
      setRunMeta('');
      if (message === t('Run cancelled')) {
        toast.message(message);
      } else {
        toast.error(message);
      }
    },
    onSettled: () => {
      activeRunController.current = null;
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

  const sortedApps = useMemo(() => {
    const next = [...apps];
    if (sortMode === 'name') {
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    }
    if (sortMode === 'runs') {
      next.sort((a, b) => getRunCount(b) - getRunCount(a));
      return next;
    }
    next.sort((a, b) => {
      const featuredDelta = Number(isFeatured(b)) - Number(isFeatured(a));
      if (featuredDelta !== 0) {
        return featuredDelta;
      }
      return getRunCount(b) - getRunCount(a);
    });
    return next;
  }, [apps, sortMode]);

  const featuredApps = useMemo(
    () => sortedApps.filter((app) => isFeatured(app)).slice(0, 4),
    [sortedApps],
  );

  const openRunner = (app: AppTemplate) => {
    const next: AppFormState = {};
    getAppFields(app).forEach((field) => {
      next[field.name] = getDefaultValueByField(field);
    });
    setFormState(next);
    setRunOutput(null);
    setRunMeta('');
    setRunError('');
    setCredentials({});
    setTestRunResult(null);
    setCurrentRuntimeStep('requirements');
    setSelectedApp(app);
  };

  const closeRunner = () => {
    activeRunController.current?.abort();
    activeRunController.current = null;
    setSelectedApp(null);
    setCurrentRuntimeStep('requirements');
    setCredentials({});
    setTestRunResult(null);
  };

  const getRuntimeContract = (): AppRunnerContract | null => {
    if (!selectedApp) return null;
    return getRunnerContract(selectedApp);
  };

  const validateStepRequirements = (step: RunnerStepKey): boolean => {
    const contract = getRuntimeContract();
    if (!contract) return false;

    switch (step) {
      case 'requirements':
        return contract.requirements.length === 0 || true; // Always allow to view requirements
      case 'connect':
        return contract.authMode !== 'none'; // Only required if auth needed
      case 'configure':
        return getAppFields(selectedApp!).length > 0 || true; // Allow even if no fields
      case 'test':
        return true; // Optional step
      case 'run':
        return true;
      default:
        return false;
    }
  };

  const canAdvanceFromStep = (step: RunnerStepKey): boolean => {
    const contract = getRuntimeContract();
    if (!contract) return false;

    switch (step) {
      case 'requirements':
        return true; // Always allow to proceed from requirements
      case 'connect':
        if (contract.authMode === 'none') return true;
        return Object.values(credentials).some((c) => c?.trim().length > 0);
      case 'configure':
        return true; // Validation happens at final submit
      case 'test':
        return true;
      case 'run':
        return false; // Last step
      default:
        return false;
    }
  };

  const goToStep = (step: RunnerStepKey) => {
    setCurrentRuntimeStep(step);
    setRunError('');
  };

  const nextStep = () => {
    const steps: RunnerStepKey[] = ['requirements', 'connect', 'configure', 'test', 'run'];
    const currentIndex = steps.indexOf(currentRuntimeStep);
    if (~currentIndex && currentIndex < steps.length - 1) {
      const nextStepKey = steps[currentIndex + 1];
      if (canAdvanceFromStep(currentRuntimeStep)) {
        goToStep(nextStepKey);
      } else {
        toast.error(t('Please complete this step before continuing'));
      }
    }
  };

  const previousStep = () => {
    const steps: RunnerStepKey[] = ['requirements', 'connect', 'configure', 'test', 'run'];
    const currentIndex = steps.indexOf(currentRuntimeStep);
    if (currentIndex > 0) {
      goToStep(steps[currentIndex - 1]);
    }
  };

  const buildInputs = (): Record<string, unknown> => {
    if (!selectedApp) return {};
    const inputs: Record<string, unknown> = {};
    getAppFields(selectedApp).forEach((field) => {
      const value = formState[field.name];
      if (value !== undefined) {
        inputs[field.name] = value;
      }
    });
    return inputs;
  };

  const submitRun = () => {
    if (!selectedApp) {
      return;
    }

    const validationErrors = validateInputs(selectedApp, formState);
    if (validationErrors.length > 0) {
      const message = validationErrors.join(' | ');
      setRunError(message);
      setRunMeta('');
      toast.error(t('Please fix input errors before running the app'));
      return;
    }

    const payload = { inputs: buildInputs() };
    const controller = new AbortController();
    activeRunController.current = controller;

    setRunError('');
    setRunMeta(t('Running app...'));
    runMutation.mutate({
      appId: selectedApp.id,
      payload,
      signal: controller.signal,
    });
  };

  const cancelRun = () => {
    if (!activeRunController.current) {
      return;
    }
    activeRunController.current.abort();
    activeRunController.current = null;
  };

  const renderRequirementsStep = () => {
    const contract = getRuntimeContract();
    if (!contract) return null;

    return (
      <div className="space-y-4">
        <div className="rounded-md border bg-muted/20 p-4">
          <h3 className="font-medium mb-3">{t('Setup requirements')}</h3>
          {contract.requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No setup required for this app.')}</p>
          ) : (
            <ul className="space-y-2">
              {contract.requirements.map((req, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="size-4 mt-0.5 text-emerald-600 flex-shrink-0" />
                  <span>{req}</span>
                </li>
              ))}
            </ul>
          )}
          {contract.credentialHint && (
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded text-sm text-blue-900">
              <span className="font-medium">{t('Tip')}: </span>
              {contract.credentialHint}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderConnectStep = () => {
    const contract = getRuntimeContract();
    if (!contract) return null;

    if (contract.authMode === 'none') {
      return (
        <div className="rounded-md border bg-emerald-500/10 p-4">
          <p className="text-sm">{t('This app does not require any credentials.')}</p>
        </div>
      );
    }

    if (contract.authMode === 'workspace_connection') {
      return (
        <div className="space-y-4">
          <div className="rounded-md border-l-4 border-l-blue-500 bg-blue-500/5 p-4">
            <h3 className="font-medium text-blue-900 mb-2">{t('Workspace Connection Required')}</h3>
            <p className="text-sm text-blue-800 mb-3">
              {t('This app uses a workspace-level connection. An administrator must set up the connection in the workspace settings.')}
            </p>
            <div className="text-xs text-blue-700 space-y-1">
              <p>{t('Connection type')}: <span className="font-medium">{contract.secretsFields.map(f => f.label).join(', ') || t('API Key')}</span></p>
              {contract.credentialHint && (
                <p className="mt-2">{contract.credentialHint}</p>
              )}
            </div>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => window.open('/settings/connections', '_blank')}>
              <KeyRound className="mr-1 size-3.5" />
              {t('Manage Connections')}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {t('Authentication mode')}: <span className="font-medium">{contract.authMode}</span>
        </div>
        {contract.secretsFields.length > 0 ? (
          <div className="space-y-3">
            {contract.secretsFields.map((field) => (
              <div key={field.name} className="space-y-2">
                <label className="text-sm font-medium">
                  {normalizeFieldLabel(field)}
                  {field.required && <span className="text-destructive ml-1">*</span>}
                </label>
                <Input
                  type={field.type === 'password' ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  value={(credentials[field.name] as string) ?? ''}
                  onChange={(e) =>
                    setCredentials((prev) => ({ ...prev, [field.name]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Waiting for connection...')}</p>
        )}
      </div>
    );
  };

  const renderConfigureStep = () => {
    const fields = getAppFields(selectedApp!);
    if (fields.length === 0) {
      return (
        <div className="rounded-md border bg-muted/20 p-4">
          <p className="text-sm text-muted-foreground">{t('This app has no required inputs.')}</p>
        </div>
      );
    }

    return (
      <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
        {fields.map(renderField)}
      </div>
    );
  };

  const renderTestStep = () => {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('Run a test to validate setup and configuration before publishing.')}
        </p>
        {testRunResult && (
          <div
            className={cn(
              'rounded-md border p-3 text-sm',
              testRunResult.passed
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900'
                : 'border-destructive/40 bg-destructive/5 text-destructive',
            )}
          >
            {testRunResult.message}
          </div>
        )}
        {runMeta && (
          <div className="text-xs text-muted-foreground">{runMeta}</div>
        )}
      </div>
    );
  };

  const renderRunStep = () => {
    return (
      <div className="space-y-4">
        <div className="rounded-md border bg-muted/20 p-4">
          <h3 className="font-medium mb-2">{t('Ready to run')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('Click "Execute" below to run this app and see the results.')}
          </p>
        </div>
        {runOutput !== null && (
          <div>
            <h4 className="text-sm font-medium mb-2">{t('Output')}</h4>
            <Card>
              <CardContent className="pt-4">
                {renderOutput()}
              </CardContent>
            </Card>
          </div>
        )}
        {runError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {runError}
          </div>
        )}
      </div>
    );
  };

  const renderStepContent = () => {
    switch (currentRuntimeStep) {
      case 'requirements':
        return renderRequirementsStep();
      case 'connect':
        return renderConnectStep();
      case 'configure':
        return renderConfigureStep();
      case 'test':
        return renderTestStep();
      case 'run':
        return renderRunStep();
      default:
        return null;
    }
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
              <span className="text-xs text-muted-foreground">{field.placeholder}</span>
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

  const renderOutput = () => {
    if (runOutput === null) {
      return (
        <div className="mt-2 text-sm text-muted-foreground">
          {t('No run yet. Configure inputs and click Run app.')}
        </div>
      );
    }

    const outputType = resolveOutputType(selectedApp, runOutput);
    if (outputType === 'markdown') {
      return (
        <div className="mt-2 rounded-md border p-3">
          <ApMarkdown
            markdown={typeof runOutput === 'string' ? runOutput : JSON.stringify(runOutput, null, 2)}
            variant={MarkdownVariant.BORDERLESS}
            className="text-sm"
          />
        </div>
      );
    }

    if (outputType === 'image') {
      const imageSource = extractImageSource(runOutput);
      if (imageSource) {
        return (
          <div className="mt-2 space-y-2">
            <img
              src={imageSource}
              alt={t('App output')}
              className="max-h-[320px] w-full rounded-md border object-contain bg-muted"
            />
            <a
              href={imageSource}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline"
            >
              {t('Open image in new tab')}
            </a>
          </div>
        );
      }
    }

    if (outputType === 'html') {
      return (
        <div className="mt-2 space-y-2">
          <iframe
            title={t('App HTML output')}
            sandbox=""
            srcDoc={typeof runOutput === 'string' ? runOutput : JSON.stringify(runOutput, null, 2)}
            className="h-[320px] w-full rounded-md border bg-white"
          />
          <div className="text-xs text-muted-foreground">
            {t('Rendered in a sandboxed frame for safety.')}
          </div>
        </div>
      );
    }

    return (
      <pre className={cn('mt-2 max-h-[320px] overflow-auto rounded bg-muted p-3 text-xs')}>
        {typeof runOutput === 'string' ? runOutput : JSON.stringify(runOutput, null, 2)}
      </pre>
    );
  };

  return (
    <div className="space-y-4">
      <DashboardPageHeader
        title={t('Apps')}
        description={t('Run ready-made apps with simple inputs. Use Templates and Publisher from the left sidebar to create new apps.')}
      />

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
        <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="featured">{t('Featured')}</SelectItem>
            <SelectItem value="runs">{t('Most runs')}</SelectItem>
            <SelectItem value="name">{t('Name')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {featuredApps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              {t('Featured apps')}
            </CardTitle>
            <CardDescription>
              {t('Recommended production-ready apps for your team.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {featuredApps.map((app) => (
              <Card key={`featured-${app.id}`} className="border-primary/25">
                <CardHeader className="space-y-2 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm leading-tight">{app.name}</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 -mr-2 -mt-1"
                      onClick={() => window.open(`/apps/${app.id}`, '_blank')}
                      title={t('Open app page')}
                    >
                      <ArrowUpRight className="size-4" />
                    </Button>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {app.galleryMetadata?.description || app.summary}
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex w-full items-center">
                  <Button size="sm" className="w-full min-w-0" onClick={() => openRunner(app)}>
                    <Play className="mr-1 size-3.5" />
                    {t('Run')}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      {appsQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {t('Loading apps...')}
        </div>
      )}
      {appsQuery.isError && (
        <div className="text-sm text-destructive">
          {appsQuery.error instanceof Error
            ? appsQuery.error.message
            : t('Failed to load apps')}
        </div>
      )}

      {!appsQuery.isLoading && !sortedApps.length && (
        <Card>
          <CardHeader>
            <CardTitle>{t('No apps found')}</CardTitle>
            <CardDescription>
              {t('Publish templates from Publisher to make apps available here.')}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!!sortedApps.length && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedApps.map((app) => {
            const metadata = app.galleryMetadata ?? {};
            const runCount = getRunCount(app);
            const successRate = getSuccessRate(app);
            const icon = metadata.icon?.trim() || '/branding/wicked-flow-icon.svg?v=20260208';

            return (
              <Card key={app.id} className="flex flex-col">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex gap-2">
                      <img
                        src={icon}
                        alt=""
                        className="mt-0.5 h-9 w-9 rounded-md border object-cover"
                      />
                      <div className="space-y-1">
                        <CardTitle className="text-base">{app.name}</CardTitle>
                        <CardDescription className="line-clamp-2">
                          {metadata.description || app.summary || app.description}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={metadata.featured ? 'default' : 'outline'}>
                        {metadata.featured ? t('Featured') : metadata.category ?? t('General')}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => window.open(`/apps/${app.id}`, '_blank')}
                        title={t('Open app page')}
                      >
                        <ArrowUpRight className="size-4" />
                      </Button>
                    </div>
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
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{t('Creator')}</span>
                    <span className="font-medium text-foreground">
                      {metadata.author || t('Wicked Flow')}
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
                <CardFooter className="mt-auto flex w-full items-center">
                  <Button className="w-full min-w-0" onClick={() => openRunner(app)}>
                    <Play className="mr-1 size-4" />
                    {t('Run app')}
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
            closeRunner();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedApp?.name ?? t('Run app')}</DialogTitle>
            <DialogDescription>
              {selectedApp?.galleryMetadata?.description ??
                selectedApp?.summary ??
                ''}
            </DialogDescription>
          </DialogHeader>

          {/* Step Indicator */}
          <div className="flex items-center gap-2 border-b pb-4">
            {RUNNER_STEPS.map((step, idx) => {
              const isActive = step.key === currentRuntimeStep;
              const isCompleted = RUNNER_STEPS.findIndex((s) => s.key === currentRuntimeStep) > idx;
              return (
                <div key={step.key} className="flex items-center flex-1">
                  <button
                    onClick={() => goToStep(step.key)}
                    disabled={!isCompleted && !canAdvanceFromStep(RUNNER_STEPS[Math.max(0, idx - 1)]?.key ?? ('requirements' as RunnerStepKey))}
                    className={cn(
                      'flex items-center justify-center flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isCompleted
                          ? 'bg-emerald-500/20 text-emerald-900 hover:bg-emerald-500/30'
                          : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                    )}
                  >
                    <span>{step.title}</span>
                  </button>
                  {idx < RUNNER_STEPS.length - 1 && (
                    <div className="h-0.5 w-2 bg-border" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Step Content */}
          <div className="min-h-[300px] max-h-[55vh] overflow-y-auto pr-3">
            {renderStepContent()}
          </div>

          {/* Footer Actions */}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={closeRunner}>
              {t('Close')}
            </Button>
            {currentRuntimeStep !== 'requirements' && (
              <Button
                variant="outline"
                onClick={previousStep}
              >
                <ChevronLeft className="mr-1 size-4" />
                {t('Back')}
              </Button>
            )}
            {currentRuntimeStep !== 'run' && (
              <Button
                onClick={nextStep}
                disabled={!canAdvanceFromStep(currentRuntimeStep)}
              >
                {t('Next')}
                <ChevronRight className="ml-1 size-4" />
              </Button>
            )}
            {currentRuntimeStep === 'test' && (
              <Button
                variant="outline"
                onClick={() => submitRun()}
                disabled={runMutation.isPending}
              >
                {runMutation.isPending ? (
                  <>
                    <LoaderCircle className="mr-1 size-4 animate-spin" />
                    {t('Testing...')}
                  </>
                ) : (
                  <>
                    <Zap className="mr-1 size-4" />
                    {t('Test')}
                  </>
                )}
              </Button>
            )}
            {currentRuntimeStep === 'run' && (
              <>
                <Button
                  variant="outline"
                  onClick={cancelRun}
                  disabled={!runMutation.isPending}
                >
                  <Square className="mr-1 size-4" />
                  {t('Cancel')}
                </Button>
                <Button onClick={() => submitRun()} disabled={runMutation.isPending}>
                  {runMutation.isPending ? (
                    <>
                      <LoaderCircle className="mr-1 size-4 animate-spin" />
                      {t('Running...')}
                    </>
                  ) : (
                    <>
                      <Play className="mr-1 size-4" />
                      {t('Execute')}
                    </>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export { AppsPage };
