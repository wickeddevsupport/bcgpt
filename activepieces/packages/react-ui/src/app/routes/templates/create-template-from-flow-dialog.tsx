import { useMutation, useQuery } from '@tanstack/react-query';
import { t } from 'i18next';
import { Plus, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { flowsApi } from '@/features/flows/lib/flows-api';
import { templatesApi } from '@/features/templates/lib/templates-api';
import { userHooks } from '@/hooks/user-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { Template, TemplateType } from '@activepieces/shared';

type CreateTemplateFromFlowDialogProps = {
  children: ReactNode;
  onCreated: (template: Template) => void;
};

const DEFAULT_TAG_COLOR = '#FF415B';
const UNTITLED_LABEL = 'Untitled';

function parseTags(tagsText: string) {
  const seen = new Set<string>();
  return tagsText
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((title) => ({
      title,
      color: DEFAULT_TAG_COLOR,
    }));
}

function resolveFlowDisplayName(flow: Record<string, unknown> | null | undefined): string {
  if (!flow) {
    return UNTITLED_LABEL;
  }
  const version = flow.version;
  const versionDisplayName =
    version && typeof version === 'object'
      ? (version as Record<string, unknown>).displayName
      : undefined;
  const directDisplayName = flow.displayName;
  const candidates = [versionDisplayName, directDisplayName];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return typeof flow.id === 'string' && flow.id.trim().length > 0
    ? flow.id
    : UNTITLED_LABEL;
}

const CreateTemplateFromFlowDialog = ({
  children,
  onCreated,
}: CreateTemplateFromFlowDialogProps) => {
  const [open, setOpen] = useState(false);
  const [flowId, setFlowId] = useState('');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const projectId = authenticationSession.getProjectId();
  const { data: currentUser } = userHooks.useCurrentUser();

  const flowsQuery = useQuery({
    queryKey: ['templates-create-flow-list', projectId],
    enabled: open && !!projectId,
    queryFn: () =>
      flowsApi.list({
        projectId: projectId!,
        cursor: undefined,
        limit: 200,
      }),
  });

  const flows = flowsQuery.data?.data ?? [];
  const selectedFlow = useMemo(
    () => flows.find((flow) => flow.id === flowId) ?? null,
    [flows, flowId],
  );

  useEffect(() => {
    if (!selectedFlow) {
      return;
    }
    const flowDisplayName = resolveFlowDisplayName(
      selectedFlow as unknown as Record<string, unknown>,
    );
    setName(flowDisplayName);
    setSummary((prev) => prev || flowDisplayName);
    setDescription((prev) => prev || t('Template created from flow "{{name}}"', { name: flowDisplayName }));
  }, [selectedFlow]);

  const resetState = () => {
    setFlowId('');
    setName('');
    setSummary('');
    setDescription('');
    setTagsText('');
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const selectedFlowId = flowId.trim();
      if (!selectedFlowId.length) {
        throw new Error(t('Please select a flow'));
      }
      if (!name.trim().length) {
        throw new Error(t('Template name is required'));
      }

      const sharedTemplate = await flowsApi.getTemplate(selectedFlowId, {});
      const author = currentUser
        ? `${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email
        : 'Unknown User';
      const tags = parseTags(tagsText);

      return templatesApi.create({
        name: name.trim(),
        summary: summary.trim() || sharedTemplate.summary || '',
        description: description.trim() || sharedTemplate.description || '',
        tags: tags.length > 0 ? tags : sharedTemplate.tags,
        blogUrl: sharedTemplate.blogUrl ?? undefined,
        metadata: sharedTemplate.metadata ?? null,
        author,
        categories: sharedTemplate.categories ?? [],
        type: TemplateType.CUSTOM,
        flows: sharedTemplate.flows ?? [],
      });
    },
    onSuccess: (createdTemplate) => {
      toast.success(t('Template created successfully'));
      onCreated(createdTemplate);
      setOpen(false);
      resetState();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            {t('Create Template from Flow')}
          </DialogTitle>
          <DialogDescription>
            {t('Pick one of your existing flows and turn it into a reusable template.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label>{t('Flow')}</Label>
            <Select value={flowId} onValueChange={setFlowId}>
              <SelectTrigger>
                <SelectValue placeholder={t('Select a flow')} />
              </SelectTrigger>
              <SelectContent>
                {flows.map((flow) => (
                  <SelectItem key={flow.id} value={flow.id}>
                    {resolveFlowDisplayName(flow as unknown as Record<string, unknown>)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {flowsQuery.isLoading && (
              <p className="text-xs text-muted-foreground">{t('Loading flows...')}</p>
            )}
            {!flowsQuery.isLoading && flows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t('No flows found in this project yet. Create a flow first, then create a template.')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('Template name')}</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('Template name')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('Summary')}</Label>
            <Input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={t('Short summary')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('Description')}</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('Describe what this template does')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('Tags')}</Label>
            <Input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder={t('automation, basecamp, design')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={createMutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            <Plus className="mr-1 size-4" />
            {createMutation.isPending ? t('Creating...') : t('Create Template')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { CreateTemplateFromFlowDialog };
