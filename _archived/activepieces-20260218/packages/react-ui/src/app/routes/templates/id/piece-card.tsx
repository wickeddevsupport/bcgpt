import { Card, CardContent } from '@/components/ui/card';
import { PieceIcon } from '@/features/pieces/components/piece-icon';
import { piecesHooks } from '@/features/pieces/lib/pieces-hooks';
import { formatUtils } from '@/lib/utils';

type PieceCardProps = {
  pieceName: string;
};

export const PieceCard = ({ pieceName }: PieceCardProps) => {
  // Avoid fetching full piece metadata just to show an icon/name.
  // This page can otherwise trigger many concurrent /v1/pieces/:name requests.
  const { pieces } = piecesHooks.usePieces({
    includeHidden: false,
    includeTags: false,
  });
  const piece = pieces?.find((p) => p.name === pieceName);

  return (
    <Card>
      <CardContent className="p-2 w-[165px] flex items-center gap-3">
        <PieceIcon
          circle={true}
          size="md"
          border={true}
          displayName={piece?.displayName}
          logoUrl={piece?.logoUrl}
          showTooltip={true}
        />
        <span className="text-sm font-medium">
          {piece?.displayName ||
            formatUtils.convertEnumToHumanReadable(pieceName)}
        </span>
      </CardContent>
    </Card>
  );
};
