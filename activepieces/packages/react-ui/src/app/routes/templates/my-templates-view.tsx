import { useMutation } from '@tanstack/react-query';
import { t } from 'i18next';
import {
  Archive,
  Eye,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

import { ConfirmationDeleteDialog } from '@/components/delete-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { templatesApi } from '@/features/templates/lib/templates-api';
import { formatUtils } from '@/lib/utils';
import { Template, TemplateStatus } from '@activepieces/shared';

import { EditTemplateDialog } from './edit-template-dialog';

type MyTemplatesViewProps = {
  templates: Template[];
  isLoading?: boolean;
  onTemplateSelect: (template: Template) => void;
  onTemplatesChanged: () => void;
};

const MyTemplatesView = ({
  templates,
  isLoading = false,
  onTemplateSelect,
  onTemplatesChanged,
}: MyTemplatesViewProps) => {
  const toggleStatusMutation = useMutation({
    mutationFn: async (template: Template) => {
      const nextStatus =
        template.status === TemplateStatus.PUBLISHED
          ? TemplateStatus.ARCHIVED
          : TemplateStatus.PUBLISHED;
      await templatesApi.update(template.id, {
        status: nextStatus,
        metadata: template.metadata,
      });
      return nextStatus;
    },
    onSuccess: (nextStatus) => {
      toast.success(
        nextStatus === TemplateStatus.PUBLISHED
          ? t('Template published')
          : t('Template unpublished'),
      );
      onTemplatesChanged();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      await templatesApi.delete(templateId);
    },
    onSuccess: () => {
      toast.success(t('Template deleted'));
      onTemplatesChanged();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((id) => (
          <Card key={id} className="border">
            <CardContent className="h-28 animate-pulse" />
          </Card>
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <Empty className="min-h-[300px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Archive />
          </EmptyMedia>
          <EmptyTitle>{t('No templates yet')}</EmptyTitle>
          <EmptyDescription>
            {t('Create your first template from a flow to start publishing apps.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {templates.map((template) => {
        const isPublished = template.status === TemplateStatus.PUBLISHED;
        return (
          <Card key={template.id} className="border">
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{template.name}</h3>
                    <Badge variant={isPublished ? 'default' : 'outline'}>
                      {isPublished ? t('Published') : t('Unpublished')}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {template.summary || template.description || t('No description')}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {t('Updated')} {formatUtils.formatDate(new Date(template.updated))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onTemplateSelect(template)}
                >
                  <Eye className="mr-1 size-4" />
                  {t('Open')}
                </Button>

                <EditTemplateDialog
                  template={template}
                  onUpdated={onTemplatesChanged}
                >
                  <Button variant="outline" size="sm">
                    <Pencil className="mr-1 size-4" />
                    {t('Edit')}
                  </Button>
                </EditTemplateDialog>

                <Button
                  variant={isPublished ? 'secondary' : 'default'}
                  size="sm"
                  onClick={() => toggleStatusMutation.mutate(template)}
                  disabled={toggleStatusMutation.isPending}
                >
                  <Upload className="mr-1 size-4" />
                  {isPublished ? t('Unpublish') : t('Publish')}
                </Button>

                <ConfirmationDeleteDialog
                  title={t('Delete Template')}
                  message={t('Are you sure you want to delete this template?')}
                  entityName={template.name}
                  mutationFn={async () => deleteMutation.mutateAsync(template.id)}
                >
                  <Button variant="destructive" size="sm">
                    <Trash2 className="mr-1 size-4" />
                    {t('Delete')}
                  </Button>
                </ConfirmationDeleteDialog>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export { MyTemplatesView };

