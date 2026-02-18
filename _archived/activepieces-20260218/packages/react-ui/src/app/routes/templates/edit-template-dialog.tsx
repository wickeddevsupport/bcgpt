import { useMutation } from '@tanstack/react-query';
import { t } from 'i18next';
import { useEffect, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { templatesApi } from '@/features/templates/lib/templates-api';
import { Template } from '@activepieces/shared';

type EditTemplateDialogProps = {
  template: Template;
  onUpdated: () => void;
  children: React.ReactNode;
};

const EditTemplateDialog = ({
  template,
  onUpdated,
  children,
}: EditTemplateDialogProps) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template.name);
  const [summary, setSummary] = useState(template.summary ?? '');
  const [description, setDescription] = useState(template.description ?? '');
  const [blogUrl, setBlogUrl] = useState(template.blogUrl ?? '');

  useEffect(() => {
    if (!open) {
      setName(template.name);
      setSummary(template.summary ?? '');
      setDescription(template.description ?? '');
      setBlogUrl(template.blogUrl ?? '');
    }
  }, [open, template]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName.length) {
        throw new Error(t('Template name is required'));
      }

      await templatesApi.update(template.id, {
        name: trimmedName,
        summary: summary.trim(),
        description: description.trim(),
        blogUrl: blogUrl.trim() || undefined,
        metadata: template.metadata,
        categories: template.categories,
        tags: template.tags,
      });
    },
    onSuccess: () => {
      toast.success(t('Template updated'));
      setOpen(false);
      onUpdated();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('Edit Template')}</DialogTitle>
          <DialogDescription>
            {t('Update template details for your creators and app users.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>{t('Name')}</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('Summary')}</Label>
            <Input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('Description')}</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('Guide URL')}</Label>
            <Input
              value={blogUrl}
              onChange={(event) => setBlogUrl(event.target.value)}
              placeholder={t('Optional setup guide URL')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={updateMutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? t('Saving...') : t('Save Changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export { EditTemplateDialog };
