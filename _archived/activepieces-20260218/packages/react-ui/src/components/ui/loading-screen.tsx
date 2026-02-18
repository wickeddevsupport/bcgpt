import { RotateCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '../../lib/utils';

import { Button } from './button';
import { Progress } from './progress';
import { LoadingSpinner } from './spinner';

type LoadingScreenProps = {
  brightSpinner?: boolean;
  mode?: 'fullscreen' | 'container';
  title?: string;
  showProgress?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
};
export const LoadingScreen = ({
  brightSpinner = false,
  mode = 'fullscreen',
  title,
  showProgress = true,
  onRetry,
  retryLabel = 'Retry',
}: LoadingScreenProps) => {
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!showProgress) {
      return;
    }
    const start = Date.now();
    setProgress(8);
    setElapsedMs(0);

    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      setElapsedMs(elapsed);
      // Ease out towards 95% while loading. We don't have real progress here.
      setProgress((prev) => {
        const target = 95;
        const next = prev + (target - prev) * 0.06;
        return Math.min(target, Math.max(0, next));
      });
    }, 250);

    return () => clearInterval(interval);
  }, [showProgress]);

  const subtitle = useMemo(() => {
    if (!showProgress) {
      return undefined;
    }
    if (elapsedMs > 25_000) {
      return "This is taking longer than expected. Check your connection or try again.";
    }
    if (elapsedMs > 10_000) {
      return "Still working. The first load can take a bit while we fetch everything.";
    }
    return 'Loading…';
  }, [elapsedMs, showProgress]);

  return (
    <div
      className={cn('flex h-screen w-screen items-center justify-center', {
        'h-full w-full': mode === 'container',
      })}
    >
      <div className="flex flex-col items-center gap-4 w-full max-w-md px-6">
        <LoadingSpinner
          className={cn({
            'stroke-background!': brightSpinner,
          })}
          isLarge={true}
        ></LoadingSpinner>

        {showProgress && (
          <div className="w-full">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>{title ?? subtitle}</span>
              <span className="tabular-nums">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
            {title && subtitle && (
              <div className="mt-2 text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
        )}

        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
            <RotateCw className="h-4 w-4" />
            {retryLabel}
          </Button>
        )}
      </div>
    </div>
  );
};
