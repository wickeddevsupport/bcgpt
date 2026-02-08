import { t } from 'i18next';
import { useMemo } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { TagWithBright } from '@/components/ui/tag-with-bright';
import { PieceIcon } from '@/features/pieces/components/piece-icon';
import { Template } from '@activepieces/shared';

type TemplateCardProps = {
  template: Template;
  onTemplateSelect: (template: Template) => void;
  pieceLogoByName: Record<string, { displayName?: string; logoUrl?: string }>;
};

export const ExploreTemplateCard = ({
  template,
  onTemplateSelect,
  pieceLogoByName,
}: TemplateCardProps) => {
  const displayTags = template.tags.slice(0, 2);

  const gradient = useMemo(() => {
    // Deterministic, zero-network gradient based on the template's pieces.
    // Avoids per-template API calls that caused massive request fanout.
    const seeds = template.pieces?.slice(0, 6) ?? [];
    const hash = seeds
      .join('|')
      .split('')
      .reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 5381);
    const palette = [
      ['#1d4ed8', '#38bdf8'],
      ['#0f766e', '#34d399'],
      ['#7c3aed', '#fb7185'],
      ['#b45309', '#f59e0b'],
      ['#334155', '#a78bfa'],
      ['#be123c', '#fb7185'],
    ];
    const [a, b] = palette[hash % palette.length];
    return `linear-gradient(135deg, ${a}20, ${b}25)`;
  }, [template.pieces?.join('|')]);

  const visiblePieceNames = useMemo(() => {
    const unique = Array.from(new Set(template.pieces ?? [])).slice(0, 4);
    return unique;
  }, [template.pieces?.join('|')]);

  return (
    <Card
      onClick={() => onTemplateSelect(template)}
      variant={'interactive'}
      className="h-[260px] w-[330px] flex flex-col"
    >
      <CardContent className="py-5 px-4 flex flex-col gap-1 flex-1 min-h-0">
        <div className="h-14 flex flex-col justify-start flex-shrink-0">
          <h3 className="font-semibold text-lg leading-tight line-clamp-2">
            {template.name}
          </h3>
        </div>

        <p className="text-muted-foreground text-sm line-clamp-3 mt-1 flex-shrink-0">
          {template.summary ? (
            template.summary
          ) : (
            <span className="italic">{t('No summary')}</span>
          )}
        </p>

        <div className="h-8 flex gap-2 flex-wrap overflow-hidden mt-1 flex-shrink-0">
          {displayTags.length > 0 ? (
            displayTags
              .slice(0, 1)
              .map((tag, index) => (
                <TagWithBright
                  key={index}
                  index={index}
                  prefix={t('Save')}
                  title={tag.title}
                  color={tag.color}
                  size="sm"
                />
              ))
          ) : (
            <div />
          )}
        </div>
      </CardContent>

      <div
        className="h-16 flex items-center px-4 rounded-b-lg transition-all duration-300"
        style={{
          background: gradient || 'transparent',
        }}
      >
        <div className="flex gap-0.5">
          {visiblePieceNames.map((pieceName) => {
            const piece = pieceLogoByName[pieceName];
            return (
              <PieceIcon
                key={pieceName}
                logoUrl={piece?.logoUrl}
                displayName={piece?.displayName ?? pieceName}
                showTooltip={true}
                circle={false}
                size="md"
                border={true}
                background="white"
              />
            );
          })}
        </div>
      </div>
    </Card>
  );
};
